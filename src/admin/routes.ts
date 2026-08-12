/**
 * La surface d'administration — `/api/admin/*`.
 *
 * **Séparée de tout le reste, et c'est le point.** Les routes de membres
 * n'apprennent jamais qu'un administrateur existe : elles continuent de partir
 * de `c.get('compte').id` et de répondre 404 sur ce qui n'est pas à elles, y
 * compris à un admin. Ce qu'un admin peut faire de plus, il le fait ici, par
 * des routes qui ne savent rien écrire dans un arbre.
 *
 * Trois familles :
 *
 * - **Les comptes** — les lister, relever un plafond, réinitialiser un mot de
 *   passe, supprimer un compte. Ce sont des gestes d'administration, pas des
 *   modifications d'arbre.
 * - **Les arbres en lecture** (`/sauvegardes/*`) — les lire à plat et les
 *   exporter. `lectureSeule` interdit tout verbe autre que GET sur ce chemin :
 *   même une route d'écriture ajoutée par distraction y serait refusée.
 * - **Les arbres en édition** (`/arbres/:id/*`, lot 8.F) — la porte ouverte au
 *   revirement du 10/08/2026. Elle monte **le domaine entier** derrière une
 *   procuration : voir `procuration.ts`, qui dit pourquoi et ce qui n'a pas
 *   bougé. Deux chemins distincts pour deux pouvoirs distincts, plutôt qu'un
 *   seul chemin dont le sens dépendrait d'un verbe.
 * - **Le journal** — consultable, jamais effaçable.
 */

import { Hono, type Context } from 'hono';
import { cleValide } from '../auth/routes';
import { empreinteMotDePasse } from '../auth/empreintes';
import { fermerToutesLesSessions } from '../auth/sessions';
import { tables as tablesDe, versXlsx, MIME_XLSX } from '../domaine/exports';
import { Dataset, slugifier, type Objet } from '../domaine/models';
import * as referentiels from '../domaine/referentiels';
import { routesDomaine } from '../domaine/routes';
import type { Variables } from '../intergiciels';
import { exigerAdmin, lectureSeule } from './intergiciel';
import { dernieres, journaliser } from './journal';
import {
  MAX_COMPTES,
  MAX_SAUVEGARDES,
  appliquerLot,
  panorama,
  resoudreCibles,
  TYPES_OPERATION,
  type Cible,
  type Portee,
} from './lots';
import { parProcuration } from './procuration';

export const routesAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

routesAdmin.use('*', exigerAdmin);
// La garde du verbe est posée sur le chemin, pas sur chaque route : c'est ce
// qui la rend vraie pour les routes qui n'existent pas encore. Elle ne couvre
// que `/sauvegardes/*` — la lecture à plat. L'édition a son propre chemin.
routesAdmin.use('/sauvegardes/*', lectureSeule);

/* --------------------------------------------------------------------------
 * Les arbres en édition — le domaine entier, par procuration
 * -------------------------------------------------------------------------- */

// Toute la surface du domaine, montée sous `/api/admin/arbres/:id`. Rien n'est
// réécrit : ce sont les mêmes routes, les mêmes validations, les mêmes
// plafonds — seulement exécutées au nom du propriétaire de l'arbre visé.
// `parProcuration` fait la substitution et inscrit chaque écriture au journal.
//
// Le paramètre s'appelle `:arbre` et non `:id`, et ce n'est pas un détail de
// style : le domaine a ses propres `/maisons/:id`, `/personnes/:id`… et deux
// paramètres du même nom dans une adresse imbriquée se recouvrent. Avec `:id`
// des deux côtés, `PATCH /arbres/<sauvegarde>/maisons/stark` cherchait une
// maison nommée d'après l'identifiant de la sauvegarde.
routesAdmin.use('/arbres/:arbre/*', parProcuration);
routesAdmin.route('/arbres/:arbre', routesDomaine);

function fichier(nom: string, mime: string, octets: Uint8Array | string): Response {
  const corps = typeof octets === 'string' ? new TextEncoder().encode(octets) : octets;
  return new Response(corps as BodyInit, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Content-Length': String(corps.length),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Les catalogues du domaine — styles de trait, catégories de liens, les sept
 * caractéristiques d'une maison.
 *
 * La page d'administration construit ses formulaires de lot à partir d'ici
 * plutôt que d'en recopier la liste. `GET /api/referentiels` dirait la même
 * chose, mais exige une sauvegarde active : un administrateur qui n'aurait pas
 * de monde à lui ne doit pas perdre ses formulaires pour autant.
 */
routesAdmin.get('/catalogues', (c) => c.json(referentiels.decrireCatalogues()));

/* --------------------------------------------------------------------------
 * Les comptes
 * -------------------------------------------------------------------------- */

routesAdmin.get('/utilisateurs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nom_affiche, u.role, u.cree_le, u.dernier_acces,
            u.plafond_octets, u.plafond_sauvegardes,
            COUNT(s.id)                     AS sauvegardes,
            COALESCE(SUM(s.taille), 0)      AS octets,
            COALESCE(SUM(s.personnes), 0)   AS personnes,
            COALESCE(SUM(s.relations), 0)   AS relations
       FROM utilisateurs u
       LEFT JOIN sauvegardes s ON s.utilisateur_id = u.id
      GROUP BY u.id
      ORDER BY u.cree_le DESC`
  ).all<Objet>();

  return c.json({ utilisateurs: results });
});

routesAdmin.get('/utilisateurs/:id/sauvegardes', async (c) => {
  const id = c.req.param('id');
  const proprietaire = await c.env.DB.prepare(
    'SELECT id, email, nom_affiche, role FROM utilisateurs WHERE id = ?'
  )
    .bind(id)
    .first<Objet>();
  if (!proprietaire) return c.json({ erreur: 'compte inconnu' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, nom, personnes, relations, taille, revision, cree_le, modifie_le
       FROM sauvegardes WHERE utilisateur_id = ? ORDER BY modifie_le DESC`
  )
    .bind(id)
    .all<Objet>();

  return c.json({ proprietaire, sauvegardes: results });
});

/**
 * Relever (ou abaisser) un plafond. Le seul geste d'administration qui touche
 * au compte sans toucher au mot de passe.
 */
routesAdmin.post('/utilisateurs/:id/plafond', async (c) => {
  const id = c.req.param('id');
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);

  const octets = Number(corps.octets);
  const nombre = Number(corps.sauvegardes);
  // Des bornes larges, mais des bornes : un plafond à zéro ou à un gigaoctet
  // n'est pas un réglage, c'est une faute de frappe.
  if (!Number.isFinite(octets) || octets < 64 * 1024 || octets > 64 * 1024 * 1024) {
    return c.json({ erreur: 'plafond en octets hors bornes (64 Ko à 64 Mo)' }, 400);
  }
  if (!Number.isFinite(nombre) || nombre < 1 || nombre > 200) {
    return c.json({ erreur: 'nombre de sauvegardes hors bornes (1 à 200)' }, 400);
  }

  const resultat = await c.env.DB.prepare(
    'UPDATE utilisateurs SET plafond_octets = ?, plafond_sauvegardes = ? WHERE id = ?'
  )
    .bind(Math.round(octets), Math.round(nombre), id)
    .run();
  if (!resultat.meta.changes) return c.json({ erreur: 'compte inconnu' }, 404);

  await journaliser(c.env.DB, c.get('compte').id, 'plafond', id);
  return c.json({ ok: true, plafonds: { octets: Math.round(octets), sauvegardes: Math.round(nombre) } });
});

/**
 * Réinitialisation du mot de passe.
 *
 * La clé arrive **dérivée par le navigateur de l'administrateur**, avec le sel
 * de l'adresse du compte visé : le mot de passe choisi ne circule pas plus ici
 * qu'ailleurs. Toutes les sessions du compte sont fermées — si quelqu'un s'y
 * était installé, il se retrouve dehors.
 *
 * Le code de secours n'est pas retouché : il est indépendant du mot de passe,
 * et le remplacer sans pouvoir le montrer à son propriétaire ne ferait que lui
 * retirer son dernier recours.
 */
routesAdmin.post('/utilisateurs/:id/mot-de-passe', async (c) => {
  const id = c.req.param('id');
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const cle = cleValide(corps.cle);
  if (!cle) return c.json({ erreur: 'clé dérivée invalide' }, 400);

  const cible = await c.env.DB.prepare('SELECT id FROM utilisateurs WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!cible) return c.json({ erreur: 'compte inconnu' }, 404);

  await c.env.DB.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?')
    .bind(await empreinteMotDePasse(cle), id)
    .run();
  await fermerToutesLesSessions(c.env.DB, id);

  await journaliser(c.env.DB, c.get('compte').id, 'reinitialisation', id);
  return c.json({ ok: true, sessions_fermees: true });
});

/** Supprimer un compte, et tout ce qui pend après lui (cascade du schéma). */
routesAdmin.delete('/utilisateurs/:id', async (c) => {
  const id = c.req.param('id');
  const moi = c.get('compte');

  // Un administrateur qui s'efface lui-même par cette route contournerait la
  // confirmation par mot de passe de « Vos données ». Qu'il passe par là.
  if (id === moi.id) {
    return c.json(
      { erreur: 'pour supprimer votre propre compte, passez par « Vos données »' },
      400
    );
  }

  const resultat = await c.env.DB.prepare('DELETE FROM utilisateurs WHERE id = ?').bind(id).run();
  if (!resultat.meta.changes) return c.json({ erreur: 'compte inconnu' }, 404);

  await journaliser(c.env.DB, moi.id, 'suppression', id);
  return c.body(null, 204);
});

/* --------------------------------------------------------------------------
 * Les arbres — lecture seule (voir `lectureSeule`)
 * -------------------------------------------------------------------------- */

/** Charge une sauvegarde quelconque, avec son propriétaire. */
async function charger(base: D1Database, id: string) {
  const ligne = await base.prepare(
    `SELECT s.id, s.nom, s.personnes, s.relations, s.taille, s.revision,
            s.cree_le, s.modifie_le, s.utilisateur_id,
            u.email AS proprietaire_email, u.nom_affiche AS proprietaire_nom,
            c.donnees
       FROM sauvegardes s
       JOIN utilisateurs u ON u.id = s.utilisateur_id
       LEFT JOIN contenus c ON c.sauvegarde_id = s.id
      WHERE s.id = ?`
  )
    .bind(id)
    .first<Objet & { donnees: string | null; utilisateur_id: string }>();
  return ligne ?? null;
}

/**
 * L'arbre de quelqu'un d'autre, mis à plat.
 *
 * On renvoie les cinq tableaux d'`exports.ts` plutôt que le document brut :
 * c'est la même chose, mais lisible, et surtout **c'est déjà le format d'une
 * lecture** — il n'existe aucun chemin, depuis cette réponse, pour réécrire
 * quoi que ce soit.
 */
routesAdmin.get('/sauvegardes/:id', async (c) => {
  const ligne = await charger(c.env.DB, c.req.param('id'));
  if (!ligne || !ligne.donnees) return c.json({ erreur: 'sauvegarde inconnue' }, 404);

  const dataset = Dataset.depuisDict(JSON.parse(ligne.donnees) as Objet);
  const { donnees: _ignore, ...fiche } = ligne;

  await journaliser(
    c.env.DB,
    c.get('compte').id,
    'consultation',
    ligne.utilisateur_id,
    String(ligne.id)
  );

  return c.json({
    sauvegarde: fiche,
    univers: dataset.meta.titre ?? '',
    tables: tablesDe(dataset, true).map((table) => ({
      id: table.id,
      titre: table.titre,
      colonnes: table.colonnes,
      lignes: table.lignes,
    })),
    incoherences: dataset.incoherences(),
  });
});

routesAdmin.get('/sauvegardes/:id/export', async (c) => {
  const ligne = await charger(c.env.DB, c.req.param('id'));
  if (!ligne || !ligne.donnees) return c.json({ erreur: 'sauvegarde inconnue' }, 404);

  const base = slugifier(String(ligne.nom), 'sauvegarde');
  const format = new URL(c.req.url).searchParams.get('format') ?? 'json';

  await journaliser(
    c.env.DB,
    c.get('compte').id,
    'export',
    ligne.utilisateur_id,
    String(ligne.id)
  );

  if (format === 'xlsx') {
    const dataset = Dataset.depuisDict(JSON.parse(ligne.donnees) as Objet);
    return fichier(`${base}.xlsx`, MIME_XLSX, await versXlsx(tablesDe(dataset, true)));
  }
  return fichier(`${base}.json`, 'application/json; charset=utf-8', ligne.donnees);
});

/* --------------------------------------------------------------------------
 * Les lots — un même geste sur les arbres de plusieurs comptes (lot 10.A)
 *
 * Trois routes, et **une seule écrit**. Ce n'est pas un drapeau `simulation`
 * dans un corps de requête qui décide : c'est le chemin. Un client qui oublie
 * un booléen se retrouverait à écrire chez cinquante personnes en croyant
 * regarder ; un client qui se trompe de chemin lit.
 * -------------------------------------------------------------------------- */

type Contexte = Context<{ Bindings: Env; Variables: Variables }>;

/** La sélection, validée, résolue en sauvegardes. */
async function preparerLot(
  c: Contexte
): Promise<{ cibles: Cible[]; operation: Objet } | Response> {
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);

  const bruts = Array.isArray(corps.comptes) ? corps.comptes : [];
  const comptes = [...new Set(bruts.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))];
  if (!comptes.length) return c.json({ erreur: 'aucun compte sélectionné' }, 400);
  if (comptes.length > MAX_COMPTES) {
    return c.json({ erreur: `sélection trop large : ${MAX_COMPTES} comptes au plus` }, 400);
  }

  const portee: Portee = corps.portee === 'active' ? 'active' : 'toutes';

  const operation =
    typeof corps.operation === 'object' && corps.operation !== null && !Array.isArray(corps.operation)
      ? (corps.operation as Objet)
      : {};
  const type = String(operation.type ?? '');
  if (!TYPES_OPERATION.includes(type)) {
    return c.json(
      { erreur: `opération inconnue : « ${type} » (${TYPES_OPERATION.join(', ')})` },
      400
    );
  }

  const cibles = await resoudreCibles(c.env.DB, comptes, portee);
  if (!cibles.length) {
    return c.json({ erreur: 'aucune sauvegarde à toucher pour cette sélection' }, 404);
  }
  if (cibles.length > MAX_SAUVEGARDES) {
    return c.json(
      {
        erreur: `ce lot toucherait ${cibles.length} sauvegardes, au-delà des ${MAX_SAUVEGARDES} qu'une requête peut mener à bien`,
        indice: 'restreignez la sélection, ou visez la sauvegarde active seulement',
      },
      400
    );
  }

  return { cibles, operation };
}

/**
 * Ce que les comptes ont fait de leur monde : leurs maisons, catégories, types
 * de liens, filtres et listes, avec ce qui est **commun à toute la sélection**
 * et ce qui n'appartient qu'à certains.
 *
 * C'est une lecture, malgré le POST : la sélection tient mal dans une adresse
 * dès qu'elle dépasse la poignée de comptes.
 */
routesAdmin.post('/lots/panorama', async (c) => {
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const bruts = Array.isArray(corps.comptes) ? corps.comptes : [];
  const comptes = [...new Set(bruts.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))];
  if (!comptes.length) return c.json({ erreur: 'aucun compte sélectionné' }, 400);
  if (comptes.length > MAX_COMPTES) {
    return c.json({ erreur: `sélection trop large : ${MAX_COMPTES} comptes au plus` }, 400);
  }

  const portee: Portee = corps.portee === 'active' ? 'active' : 'toutes';
  return c.json(panorama(await resoudreCibles(c.env.DB, comptes, portee)));
});

/** L'aperçu : exactement le même calcul, sans écrire ni journaliser. */
routesAdmin.post('/lots/apercu', async (c) => {
  const pret = await preparerLot(c);
  if (pret instanceof Response) return pret;
  return c.json(await appliquerLot(c.env.DB, c.get('compte').id, pret.cibles, pret.operation, true));
});

/** L'application. La seule route de cette famille qui touche aux données. */
routesAdmin.post('/lots/appliquer', async (c) => {
  const pret = await preparerLot(c);
  if (pret instanceof Response) return pret;
  return c.json(
    await appliquerLot(c.env.DB, c.get('compte').id, pret.cibles, pret.operation, false)
  );
});

/* --------------------------------------------------------------------------
 * Le journal
 * -------------------------------------------------------------------------- */

routesAdmin.get('/journal', async (c) => {
  const combien = Number(new URL(c.req.url).searchParams.get('combien') ?? '200');
  return c.json({ journal: await dernieres(c.env.DB, Number.isFinite(combien) ? combien : 200) });
});
