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
 *
 * **Deux étages depuis le lot 11.A.** `exigerGestion` laisse entrer l'`admin`
 * et l'`intendant`, et pose sur le contexte le **périmètre** — les comptes sur
 * lesquels celui qui regarde a pouvoir. Chaque route qui reçoit un identifiant
 * de compte le passe par `dansLePerimetre` ; hors périmètre, elle répond le
 * même 404 que pour un compte inexistant. Les gestes qui touchent au compte
 * lui-même — plafond, mot de passe, suppression, rôle, tutelle — sont doublés
 * d'`exigerSouverain` et n'appartiennent qu'à l'`admin`.
 */

import { Hono, type Context } from 'hono';
import { cleValide } from '../auth/routes';
import { empreinteMotDePasse } from '../auth/empreintes';
import { fermerToutesLesSessions } from '../auth/sessions';
import { tables as tablesDe, versXlsx, MIME_XLSX } from '../domaine/exports';
import { Dataset, slugifier, type Objet } from '../domaine/models';
import * as referentiels from '../domaine/referentiels';
import { routesDomaine } from '../domaine/routes';
import {
  dansLePerimetre,
  exigerGestion,
  exigerSouverain,
  lectureSeule,
  type Perimetre,
  type VariablesAdmin,
} from './intergiciel';
import { dernieres, journaliser } from './journal';
import {
  MAX_COMPTES,
  MAX_SAUVEGARDES,
  appliquerLot,
  panorama,
  rapprochement,
  resoudreCibles,
  TYPES_OPERATION,
  type Cible,
  type Portee,
} from './lots';
import { parProcuration } from './procuration';

export const routesAdmin = new Hono<{ Bindings: Env; Variables: VariablesAdmin }>();

routesAdmin.use('*', exigerGestion);
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

/** `?, ?, ?` — un `IN (…)` de N valeurs, toujours lié, jamais interpolé. */
function trous(combien: number): string {
  return combien ? Array.from({ length: combien }, () => '?').join(',') : "''";
}

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

/**
 * Qui regarde, et jusqu'où.
 *
 * La page d'administration doit se dessiner **avant** de savoir ce qu'elle a le
 * droit de montrer : sans cette route, elle afficherait les boutons du
 * souverain à un intendant, qui les verrait refusés un par un. Une interface
 * qui propose ce que l'API refuse ment.
 */
routesAdmin.get('/contexte', (c) => {
  const perimetre = c.get('perimetre');
  const moi = c.get('compte');
  return c.json({
    compte: { id: moi.id, email: moi.email, role: moi.role },
    souverain: perimetre === null,
    comptes_en_charge: perimetre === null ? null : perimetre.size,
  });
});

/* --------------------------------------------------------------------------
 * Les comptes
 * -------------------------------------------------------------------------- */

routesAdmin.get('/utilisateurs', async (c) => {
  const perimetre = c.get('perimetre');
  // Le filtre est dans la requête, pas après : une liste complète chargée puis
  // élaguée en mémoire, c'est une liste complète qui a existé.
  const borne = perimetre === null ? '' : `WHERE u.id IN (${trous(perimetre.size)})`;
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nom_affiche, u.role, u.cree_le, u.dernier_acces,
            u.plafond_octets, u.plafond_sauvegardes,
            COUNT(s.id)                     AS sauvegardes,
            COALESCE(SUM(s.taille), 0)      AS octets,
            COALESCE(SUM(s.personnes), 0)   AS personnes,
            COALESCE(SUM(s.relations), 0)   AS relations
       FROM utilisateurs u
       -- La démonstration est écartée dans le ON, et pas dans un WHERE : la
       -- jointure reste externe, donc un compte qui n'a encore qu'elle figure
       -- bien dans la liste, avec zéro sauvegarde. C'est même ce que la colonne
       -- a de plus utile à dire — celui-là n'a rien commencé.
       LEFT JOIN sauvegardes s ON s.utilisateur_id = u.id AND s.demo = 0
      ${borne}
      GROUP BY u.id
      ORDER BY u.cree_le DESC`
  )
    .bind(...(perimetre === null ? [] : [...perimetre]))
    .all<Objet>();

  return c.json({ utilisateurs: results });
});

routesAdmin.get('/utilisateurs/:id/sauvegardes', async (c) => {
  const id = c.req.param('id');
  const proprietaire = await c.env.DB.prepare(
    'SELECT id, email, nom_affiche, role FROM utilisateurs WHERE id = ?'
  )
    .bind(id)
    .first<Objet>();
  if (!proprietaire || !dansLePerimetre(c.get('perimetre'), id)) {
    return c.json({ erreur: 'compte inconnu' }, 404);
  }

  // Les arbres de quelqu'un, pas le décor qu'on lui a prêté : la démonstration
  // n'a rien à faire ici. L'ouvrir par procuration n'aurait même pas de sens —
  // elle repart à zéro à la prochaine connexion de son propriétaire.
  const { results } = await c.env.DB.prepare(
    `SELECT id, nom, personnes, relations, taille, revision, cree_le, modifie_le
       FROM sauvegardes WHERE utilisateur_id = ? AND demo = 0 ORDER BY modifie_le DESC`
  )
    .bind(id)
    .all<Objet>();

  return c.json({ proprietaire, sauvegardes: results });
});

/* --------------------------------------------------------------------------
 * Ce qui n'appartient qu'au souverain
 *
 * `exigerSouverain` est écrit sur chaque route plutôt que posé sur un préfixe :
 * ces adresses-là sont mêlées à celles que l'intendant peut prendre — même
 * `/utilisateurs/:id`, selon le verbe. Un préfixe commun n'existerait qu'au
 * prix d'un renommage qui séparerait mal, et une garde qu'on ne voit pas en
 * lisant la route est une garde qu'on oublie de reconduire.
 * -------------------------------------------------------------------------- */

/**
 * Relever (ou abaisser) un plafond. Le seul geste d'administration qui touche
 * au compte sans toucher au mot de passe.
 */
routesAdmin.post('/utilisateurs/:id/plafond', exigerSouverain, async (c) => {
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
routesAdmin.post('/utilisateurs/:id/mot-de-passe', exigerSouverain, async (c) => {
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
routesAdmin.delete('/utilisateurs/:id', exigerSouverain, async (c) => {
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
 * Les intendants (lot 11.A)
 *
 * Le souverain délègue, et il délègue **borné** : un intendant reçoit des
 * comptes, pas l'instance. Deux gestes seulement — nommer, et confier — parce
 * que ce sont les deux seules choses qui décident qui verra quoi.
 * -------------------------------------------------------------------------- */

/** Les rôles qu'une route peut poser. `admin` n'en fait pas partie, exprès. */
const ROLES_ACCORDABLES = ['membre', 'intendant'];

/**
 * Nommer ou démettre un intendant.
 *
 * **`admin` ne s'accorde pas ici, et ne s'accordera pas.** Le premier
 * administrateur s'est donné en SQL et ses successeurs feront de même. Une
 * route qui sacre un pair transforme le premier compte compromis en trousseau
 * de toute l'instance ; il n'y a aucun confort qui vaille ça.
 *
 * Démettre un intendant lui retire ses tutelles dans le même geste. Les
 * laisser derrière ferait d'une remise en fonction plus tard une restitution
 * silencieuse de pouvoirs qu'on croyait repris.
 */
routesAdmin.post('/utilisateurs/:id/role', exigerSouverain, async (c) => {
  const id = c.req.param('id');
  const moi = c.get('compte');
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const role = String(corps.role ?? '');

  if (!ROLES_ACCORDABLES.includes(role)) {
    return c.json(
      {
        erreur: `rôle inconnu : « ${role} » (${ROLES_ACCORDABLES.join(', ')})`,
        indice: "le rôle « admin » se donne en SQL, jamais depuis l'interface",
      },
      400
    );
  }

  const cible = await c.env.DB.prepare('SELECT id, email, role FROM utilisateurs WHERE id = ?')
    .bind(id)
    .first<{ id: string; email: string; role: string }>();
  if (!cible) return c.json({ erreur: 'compte inconnu' }, 404);

  // Se démettre soi-même fermerait la porte derrière soi, sans personne pour la
  // rouvrir autrement qu'en SQL. Et démettre un pair reviendrait à contourner
  // la règle du dessus par l'autre bout.
  if (cible.role === 'admin') {
    return c.json(
      {
        erreur: "le rôle d'un administrateur ne se change pas depuis l'interface",
        indice: 'en SQL, comme il a été donné',
      },
      400
    );
  }
  // Un essai (lot 9.C) n'a pas d'adresse : lui confier des comptes reviendrait
  // à donner un pouvoir à un témoin de navigateur.
  if (cible.role === 'invite') {
    return c.json({ erreur: "un compte d'essai ne peut pas devenir intendant" }, 400);
  }

  await c.env.DB.prepare('UPDATE utilisateurs SET role = ? WHERE id = ?').bind(role, id).run();
  if (role !== 'intendant') {
    await c.env.DB.prepare('DELETE FROM tutelles WHERE intendant_id = ?').bind(id).run();
  }

  await journaliser(c.env.DB, moi.id, 'role', id);
  return c.json({ ok: true, compte: { id, email: cible.email, role } });
});

/** Les intendants de l'instance, et les comptes qu'ils ont en charge. */
routesAdmin.get('/intendants', exigerSouverain, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nom_affiche, u.dernier_acces,
            COUNT(t.utilisateur_id) AS charges
       FROM utilisateurs u
       LEFT JOIN tutelles t ON t.intendant_id = u.id
      WHERE u.role = 'intendant'
      GROUP BY u.id
      ORDER BY u.email`
  ).all<Objet>();

  const { results: liens } = await c.env.DB.prepare(
    `SELECT t.intendant_id, t.utilisateur_id, u.email
       FROM tutelles t
       JOIN utilisateurs u ON u.id = t.utilisateur_id
      ORDER BY u.email`
  ).all<{ intendant_id: string; utilisateur_id: string; email: string }>();

  const parIntendant: Record<string, { id: string; email: string }[]> = {};
  for (const lien of liens) {
    const deja = parIntendant[lien.intendant_id] ?? [];
    deja.push({ id: lien.utilisateur_id, email: lien.email });
    parIntendant[lien.intendant_id] = deja;
  }

  return c.json({
    intendants: results.map((fiche) => ({
      ...fiche,
      comptes: parIntendant[String(fiche.id)] ?? [],
    })),
  });
});

/**
 * Confier des comptes à un intendant — la liste **entière**, pas un ajout.
 *
 * Remplacer plutôt qu'empiler rend le geste rejouable et lisible : ce qu'on
 * envoie est ce qu'il aura, et retirer un compte se fait en le décochant plutôt
 * qu'en trouvant une route de suppression. C'est aussi ce que la page montre.
 */
routesAdmin.put('/intendants/:id/charges', exigerSouverain, async (c) => {
  const id = c.req.param('id');
  const moi = c.get('compte');
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);

  const intendant = await c.env.DB.prepare('SELECT id, role FROM utilisateurs WHERE id = ?')
    .bind(id)
    .first<{ id: string; role: string }>();
  if (!intendant) return c.json({ erreur: 'compte inconnu' }, 404);
  if (intendant.role !== 'intendant') {
    return c.json({ erreur: "ce compte n'est pas intendant", indice: 'nommez-le d’abord' }, 400);
  }

  const bruts = Array.isArray(corps.comptes) ? corps.comptes : [];
  const demandes = [...new Set(bruts.map((v: unknown) => String(v ?? '').trim()).filter(Boolean))];
  if (demandes.length > MAX_COMPTES) {
    return c.json({ erreur: `au plus ${MAX_COMPTES} comptes par intendant` }, 400);
  }

  // On ne confie que des comptes qui existent, et jamais un administrateur ni
  // un autre intendant : la tutelle descend, elle ne traverse pas.
  const retenus = demandes.length
    ? (
        await c.env.DB.prepare(
          `SELECT id FROM utilisateurs
            WHERE id IN (${trous(demandes.length)}) AND role NOT IN ('admin', 'intendant')`
        )
          .bind(...demandes)
          .all<{ id: string }>()
      ).results.map((ligne) => ligne.id)
    : [];

  const maintenant = Math.floor(Date.now() / 1000);
  const gestes: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM tutelles WHERE intendant_id = ?').bind(id),
    ...retenus.map((utilisateur) =>
      c.env.DB
        .prepare(
          `INSERT INTO tutelles (intendant_id, utilisateur_id, cree_le, pose_par)
           VALUES (?, ?, ?, ?)`
        )
        .bind(id, utilisateur, maintenant, moi.id)
    ),
  ];
  // En lot : une tutelle à demi remplacée laisserait l'intendant sans personne,
  // ou avec les anciens et les nouveaux.
  await c.env.DB.batch(gestes);

  await journaliser(c.env.DB, moi.id, 'tutelle', id);
  return c.json({
    ok: true,
    comptes: retenus,
    ecartes: demandes.filter((demande) => !retenus.includes(demande)),
  });
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
  if (!ligne || !ligne.donnees || !dansLePerimetre(c.get('perimetre'), ligne.utilisateur_id)) {
    return c.json({ erreur: 'sauvegarde inconnue' }, 404);
  }

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
  if (!ligne || !ligne.donnees || !dansLePerimetre(c.get('perimetre'), ligne.utilisateur_id)) {
    return c.json({ erreur: 'sauvegarde inconnue' }, 404);
  }

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

type Contexte = Context<{ Bindings: Env; Variables: VariablesAdmin }>;

/** Les identifiants reçus, nettoyés et dédoublonnés. */
function nommes(brut: unknown): string[] {
  const bruts = Array.isArray(brut) ? brut : [];
  return [...new Set(bruts.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))];
}

/**
 * La sélection, ramenée au périmètre de celui qui la pose.
 *
 * Les comptes hors périmètre sont **retirés en silence**, et c'est voulu : dire
 * « ce compte ne vous appartient pas » apprendrait à un intendant qu'il existe.
 * Rien ne se perd pour autant — le rapport du lot nomme chaque sauvegarde
 * touchée, et la page ne propose que les comptes qu'il a en charge. Une
 * sélection entièrement hors périmètre tombe sur le 404 « aucune sauvegarde à
 * toucher », le même que pour des comptes qui n'en ont aucune.
 */
function auPerimetre(ids: string[], perimetre: Perimetre): string[] {
  return perimetre === null ? ids : ids.filter((id) => perimetre.has(id));
}

/** La sélection, validée, résolue en sauvegardes. */
async function preparerLot(
  c: Contexte
): Promise<{ cibles: Cible[]; operation: Objet } | Response> {
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);

  const demandes = nommes(corps.comptes);
  if (!demandes.length) return c.json({ erreur: 'aucun compte sélectionné' }, 400);
  if (demandes.length > MAX_COMPTES) {
    return c.json({ erreur: `sélection trop large : ${MAX_COMPTES} comptes au plus` }, 400);
  }
  const comptes = auPerimetre(demandes, c.get('perimetre'));

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
 * Depuis le lot 12.C, la même réponse porte le **rapprochement des fiches** :
 * les personnes qu'une table a écrites plusieurs fois, chacun de son côté. Un
 * seul relevé, deux lectures — le coût est déjà payé, les sauvegardes sont
 * lues et analysées une fois pour toutes.
 *
 * C'est une lecture, malgré le POST : la sélection tient mal dans une adresse
 * dès qu'elle dépasse la poignée de comptes.
 */
routesAdmin.post('/lots/panorama', async (c) => {
  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const demandes = nommes(corps.comptes);
  if (!demandes.length) return c.json({ erreur: 'aucun compte sélectionné' }, 400);
  if (demandes.length > MAX_COMPTES) {
    return c.json({ erreur: `sélection trop large : ${MAX_COMPTES} comptes au plus` }, 400);
  }
  const comptes = auPerimetre(demandes, c.get('perimetre'));

  const portee: Portee = corps.portee === 'active' ? 'active' : 'toutes';
  const cibles = await resoudreCibles(c.env.DB, comptes, portee);
  return c.json({ ...panorama(cibles), rapprochement: rapprochement(cibles) });
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
  const moi = c.get('compte');
  // Un intendant voit ses propres gestes et ce qui a été fait aux comptes qu'on
  // lui a confiés — y compris par le souverain, car c'est justement ce que le
  // registre lui doit. Le reste de l'instance ne le regarde pas.
  return c.json({
    journal: await dernieres(
      c.env.DB,
      Number.isFinite(combien) ? combien : 200,
      c.get('perimetre'),
      moi.id
    ),
  });
});
