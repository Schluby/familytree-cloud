/**
 * Les messages volants — `/api/messages/*` (lot 27.D).
 *
 * Demandé tel quel par l'utilisateur : « un truc qui permette d'envoyer des
 * msg aux autres (pas une messagerie), juste une petite popup temporaire qui
 * permet d'envoyer des msg et qui ne sont pas stockés ». Trois routes, toutes
 * derrière `exigerSession`, et rien d'autre : pas de conversation, pas
 * d'historique, pas de notification. Voir `src/messages/domaine.ts` pour la
 * logique et `migrations/0012_messages_volants.sql` pour le schéma et le
 * choix de D1 plutôt qu'un canal persistant.
 *
 * **« Les autres »** désigne qui voit le même monde que moi sur la
 * sauvegarde visée : son propriétaire, et les comptes de `partages` pour
 * elle, quel que soit leur droit. C'est la question que
 * `src/partages/routes.ts` pose déjà pour ouvrir un arbre à sa lecture ;
 * `acces()` (dans `domaine.ts`) pose la même condition — ce lot ne touche pas
 * à `partages/`, il n'en avait pas besoin.
 */

import { Hono, type Context } from 'hono';
import { exigerSession, type Variables } from '../intergiciels';
import { maintenant } from '../sauvegardes/depot';
import type { Objet } from '../domaine/models';
import {
  acces,
  debitDe,
  destinatairesDe,
  messagesDepuis,
  purger,
  DUREE_VIE,
  TAILLE_MAX_TEXTE,
} from './domaine';

type Contexte = Context<{ Bindings: Env; Variables: Variables }>;

export const routesMessages = new Hono<{ Bindings: Env; Variables: Variables }>();

routesMessages.use('*', exigerSession);

async function corpsDe(c: Contexte): Promise<Objet> {
  const brut = await c.req.json<unknown>().catch(() => null);
  return typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? (brut as Objet) : {};
}

/**
 * Traduit `acces()` en réponse HTTP : 404 si la sauvegarde n'existe pas du
 * tout, 403 si elle existe mais ne m'est pas ouverte, `null` si tout va bien
 * — à charge pour l'appelant de continuer.
 */
async function verifierAcces(c: Contexte, sauvegardeId: string): Promise<Response | null> {
  const etat = await acces(c.env.DB, sauvegardeId, c.get('compte').id);
  if (etat === 'introuvable') return c.json({ erreur: 'sauvegarde introuvable' }, 404);
  if (etat === 'refuse') {
    return c.json(
      {
        erreur: 'cette sauvegarde ne vous est pas ouverte',
        indice:
          'seuls son propriétaire et les comptes à qui il l’a partagée peuvent s’y échanger des messages',
      },
      403
    );
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Lire ce qui m'attend — GET /api/messages?sauvegarde=<id>&depuis=<horodatage>
 * -------------------------------------------------------------------------- */

routesMessages.get('/', async (c) => {
  const sauvegardeId = c.req.query('sauvegarde') ?? '';
  if (!sauvegardeId) return c.json({ erreur: 'il faut préciser ?sauvegarde=' }, 400);

  // Absent au tout premier appel : depuis le début, donc « tout ce qui est
  // encore là » — la péremption borne déjà le résultat à trois minutes.
  const depuisBrut = c.req.query('depuis');
  const depuis = depuisBrut !== undefined ? Number(depuisBrut) : 0;
  if (!Number.isFinite(depuis) || depuis < 0) {
    return c.json({ erreur: '?depuis= doit être un horodatage' }, 400);
  }

  const instant = maintenant();
  await purger(c.env.DB, instant);

  const refus = await verifierAcces(c, sauvegardeId);
  if (refus) return refus;

  const moi = c.get('compte');
  const messages = await messagesDepuis(c.env.DB, sauvegardeId, moi.id, depuis, instant);

  // L'horodatage du serveur : le client le repasse en `?depuis=` au tour
  // suivant, pour ne dépendre d'aucune horloge locale — deux horloges qui
  // divergent, ce sont des messages perdus ou répétés.
  return c.json({ messages, maintenant: instant });
});

/* --------------------------------------------------------------------------
 * Qui est autour de ce monde — GET /api/messages/destinataires?sauvegarde=<id>
 * -------------------------------------------------------------------------- */

routesMessages.get('/destinataires', async (c) => {
  const sauvegardeId = c.req.query('sauvegarde') ?? '';
  if (!sauvegardeId) return c.json({ erreur: 'il faut préciser ?sauvegarde=' }, 400);

  const refus = await verifierAcces(c, sauvegardeId);
  if (refus) return refus;

  const moi = c.get('compte');
  const destinataires = await destinatairesDe(c.env.DB, sauvegardeId, moi.id);
  return c.json({ destinataires });
});

/* --------------------------------------------------------------------------
 * Envoyer un mot — POST /api/messages
 * -------------------------------------------------------------------------- */

routesMessages.post('/', async (c) => {
  const moi = c.get('compte');
  const corps = await corpsDe(c);

  const sauvegardeId = typeof corps.sauvegarde === 'string' ? corps.sauvegarde.trim() : '';
  if (!sauvegardeId) return c.json({ erreur: 'il faut préciser une sauvegarde' }, 400);

  const texte = typeof corps.texte === 'string' ? corps.texte.trim() : '';
  if (!texte) return c.json({ erreur: 'message vide' }, 400);
  if (texte.length > TAILLE_MAX_TEXTE) {
    return c.json({ erreur: `ce message dépasse ${TAILLE_MAX_TEXTE} signes` }, 400);
  }

  // Absent, `null` ou vide : à tout le monde autour de la sauvegarde. Le
  // client n'a pas à distinguer ces trois cas, ils veulent tous dire la même
  // chose côté serveur.
  const destinataireBrut = corps.destinataire;
  const destinataireId =
    typeof destinataireBrut === 'string' && destinataireBrut.trim() ? destinataireBrut.trim() : null;
  if (destinataireId === moi.id) {
    return c.json({ erreur: 'on ne s’envoie pas de message à soi-même' }, 400);
  }

  const instant = maintenant();
  await purger(c.env.DB, instant);

  const refus = await verifierAcces(c, sauvegardeId);
  if (refus) return refus;

  if (destinataireId !== null) {
    const etatDestinataire = await acces(c.env.DB, sauvegardeId, destinataireId);
    if (etatDestinataire !== 'ok') {
      return c.json(
        {
          erreur: 'ce destinataire ne voit pas cette sauvegarde',
          indice: 'un message ne peut aller qu’à quelqu’un à qui cet arbre est déjà ouvert',
        },
        403
      );
    }
  }

  const debit = await debitDe(c.env.DB, moi.id, instant);
  if (debit.bloque) {
    return c.json(
      {
        erreur: `trop de messages envoyés, réessayez dans ${debit.attente} s`,
        attente: debit.attente,
      },
      429
    );
  }

  const id = crypto.randomUUID();
  const expireLe = instant + DUREE_VIE;
  await c.env.DB.prepare(
    `INSERT INTO messages_volants (id, sauvegarde_id, auteur_id, destinataire_id, texte, cree_le, expire_le)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, sauvegardeId, moi.id, destinataireId, texte, instant, expireLe)
    .run();

  return c.json({ ok: true, id, cree_le: instant, expire_le: expireLe }, 201);
});
