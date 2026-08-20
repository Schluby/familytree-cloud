/**
 * Les amitiés — `/api/amis/*` (lot 23.C).
 *
 * Se connaître entre comptes, pour pouvoir se confier un monde. C'est la
 * condition posée à l'écriture partagée : on ne donne pas le droit de modifier
 * son arbre à quelqu'un qui n'a jamais dit oui, et on ne voit pas apparaître
 * dans son rail un arbre qu'on n'a pas accepté.
 *
 * ── Ce que ce module ne fait pas ─────────────────────────────────────────────
 *
 * Il ne cherche personne. On ne peut pas parcourir les comptes, ni savoir si
 * une adresse existe autrement qu'en lui écrivant : la réponse est la même —
 * « demande envoyée » — que le compte existe ou non. Sinon ce serait un
 * annuaire, et un moyen de savoir qui est inscrit ici.
 *
 * Il ne bloque pas non plus. Un refus **efface** la demande au lieu de la
 * marquer : le blocage n'a pas été demandé, et une ligne « refusée » qui
 * traînerait interdirait de se redemander plus tard, ce qui en tient lieu sans
 * le dire.
 */

import { Hono } from 'hono';
import { exigerSession, type Variables } from '../intergiciels';
import { maintenant } from '../sauvegardes/depot';
import type { Objet } from '../domaine/models';

type Contexte = { Bindings: Env; Variables: Variables };

export const routesAmis = new Hono<Contexte>();

routesAmis.use('*', exigerSession);

/** Au-delà, ce n'est plus une table de jeu. */
export const MAX_AMIS = 200;

interface LigneAmitie {
  demandeur_id: string;
  destinataire_id: string;
  etat: string;
  cree_le: number;
  autre_id: string;
  autre_email: string;
  autre_nom: string;
}

/** Les colonnes, écrites en toutes lettres — comme dans `partages`. */
const REQUETE_LISTE = `
  SELECT a.demandeur_id, a.destinataire_id, a.etat, a.cree_le,
         u.id   AS autre_id,
         u.email AS autre_email,
         u.nom_affiche AS autre_nom
    FROM amities a
    JOIN utilisateurs u
      ON u.id = CASE WHEN a.demandeur_id = ?1 THEN a.destinataire_id ELSE a.demandeur_id END
   WHERE a.demandeur_id = ?1 OR a.destinataire_id = ?1
   ORDER BY a.cree_le DESC`;

function personne(ligne: LigneAmitie): Objet {
  return {
    id: ligne.autre_id,
    email: ligne.autre_email,
    nom: ligne.autre_nom || ligne.autre_email,
    depuis: ligne.cree_le,
  };
}

/**
 * Trois listes, et pas une seule avec un état : le rail en fait trois choses
 * différentes — des amis à qui l'on peut confier un monde, des demandes qui
 * attendent **une réponse de moi**, et des demandes qui attendent la leur.
 */
routesAmis.get('/', async (c) => {
  const moi = c.get('compte');
  const { results } = await c.env.DB.prepare(REQUETE_LISTE).bind(moi.id).all<LigneAmitie>();

  const amis: Objet[] = [];
  const recues: Objet[] = [];
  const envoyees: Objet[] = [];
  for (const ligne of results) {
    if (ligne.etat === 'acceptee') amis.push(personne(ligne));
    else if (ligne.destinataire_id === moi.id) recues.push(personne(ligne));
    else envoyees.push(personne(ligne));
  }
  return c.json({ amis, recues, envoyees });
});

/**
 * Demander quelqu'un par son adresse.
 *
 * La réponse ne dit **jamais** si le compte existe : « demande envoyée » dans
 * tous les cas. C'est ce qui empêche de se servir de cette route pour savoir
 * qui est inscrit ici.
 *
 * Une demande croisée — il m'avait déjà demandé — vaut acceptation : refaire
 * dire oui à quelqu'un qui a déjà dit oui n'apporte rien.
 */
routesAmis.post('/', async (c) => {
  const moi = c.get('compte');
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const adresse = String(corps.email ?? '')
    .trim()
    .toLowerCase();
  if (!adresse) return c.json({ erreur: 'indiquez une adresse' }, 400);

  const cible = await c.env.DB.prepare(
    'SELECT id FROM utilisateurs WHERE email_norm = ? AND id <> ?'
  )
    .bind(adresse, moi.id)
    .first<{ id: string }>();

  // Compte inconnu, ou soi-même : même réponse que si tout s'était bien passé.
  if (!cible) return c.json({ ok: true, etat: 'en_attente' });

  const combien = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM amities
      WHERE (demandeur_id = ?1 OR destinataire_id = ?1) AND etat = 'acceptee'`
  )
    .bind(moi.id)
    .first<{ n: number }>();
  if ((combien?.n ?? 0) >= MAX_AMIS) {
    return c.json({ erreur: `au plus ${MAX_AMIS} amis par compte` }, 400);
  }

  const instant = maintenant();
  // Il m'avait déjà demandé : sa demande devient une amitié.
  const inverse = await c.env.DB.prepare(
    'SELECT etat FROM amities WHERE demandeur_id = ? AND destinataire_id = ?'
  )
    .bind(cible.id, moi.id)
    .first<{ etat: string }>();
  if (inverse) {
    await c.env.DB.prepare(
      `UPDATE amities SET etat = 'acceptee', repondu_le = ?
        WHERE demandeur_id = ? AND destinataire_id = ?`
    )
      .bind(instant, cible.id, moi.id)
      .run();
    return c.json({ ok: true, etat: 'acceptee' });
  }

  // `ON CONFLICT DO NOTHING` : redemander deux fois ne fabrique pas deux lignes
  // et ne remet pas à zéro une amitié déjà acceptée.
  await c.env.DB.prepare(
    `INSERT INTO amities (demandeur_id, destinataire_id, etat, cree_le)
     VALUES (?, ?, 'en_attente', ?)
     ON CONFLICT(demandeur_id, destinataire_id) DO NOTHING`
  )
    .bind(moi.id, cible.id, instant)
    .run();

  return c.json({ ok: true, etat: 'en_attente' });
});

/** Accepter une demande reçue. Seul le destinataire le peut. */
routesAmis.post('/:autre/accepter', async (c) => {
  const moi = c.get('compte');
  const autre = c.req.param('autre');
  const resultat = await c.env.DB.prepare(
    `UPDATE amities SET etat = 'acceptee', repondu_le = ?
      WHERE demandeur_id = ? AND destinataire_id = ? AND etat = 'en_attente'`
  )
    .bind(maintenant(), autre, moi.id)
    .run();

  if (!resultat.meta?.changes) return c.json({ erreur: 'aucune demande de ce compte' }, 404);
  return c.json({ ok: true, etat: 'acceptee' });
});

/**
 * Défaire le lien, quel que soit son état et quel que soit le côté : refuser une
 * demande, annuler la sienne, ou cesser d'être amis. Une seule route, parce que
 * c'est un seul geste — « il n'y a plus rien entre nous ».
 *
 * Les partages en écriture qu'on lui avait ouverts tombent avec l'amitié : les
 * laisser debout donnerait le droit d'écrire à quelqu'un qu'on vient de retirer
 * de ses amis, ce qui est exactement le contraire de ce qu'on demandait.
 */
routesAmis.delete('/:autre', async (c) => {
  const moi = c.get('compte');
  const autre = c.req.param('autre');
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `DELETE FROM amities
          WHERE (demandeur_id = ?1 AND destinataire_id = ?2)
             OR (demandeur_id = ?2 AND destinataire_id = ?1)`
      )
      .bind(moi.id, autre),
    c.env.DB
      .prepare(
        `DELETE FROM partages
          WHERE droit = 'ecriture'
            AND ((utilisateur_id = ?2 AND sauvegarde_id IN
                    (SELECT id FROM sauvegardes WHERE utilisateur_id = ?1))
             OR  (utilisateur_id = ?1 AND sauvegarde_id IN
                    (SELECT id FROM sauvegardes WHERE utilisateur_id = ?2)))`
      )
      .bind(moi.id, autre),
  ]);
  return c.json({ ok: true });
});

/** Les identifiants des comptes avec qui je suis effectivement ami. */
export async function amisDe(base: D1Database, moi: string): Promise<Set<string>> {
  const { results } = await base
    .prepare(
      `SELECT CASE WHEN demandeur_id = ?1 THEN destinataire_id ELSE demandeur_id END AS autre
         FROM amities
        WHERE (demandeur_id = ?1 OR destinataire_id = ?1) AND etat = 'acceptee'`
    )
    .bind(moi)
    .all<{ autre: string }>();
  return new Set(results.map((ligne) => ligne.autre));
}
