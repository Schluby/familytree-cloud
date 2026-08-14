/**
 * Les sauvegardes d'un compte.
 *
 * Trois choses à savoir avant de lire, parce qu'elles expliquent la plupart des
 * choix :
 *
 * 1. **Aucune requête ne désigne une sauvegarde par son seul identifiant.**
 *    Toutes portent `utilisateur_id` dans leur `WHERE`, et l'absence se dit
 *    **404, jamais 403** : répondre « interdit » confirmerait que l'identifiant
 *    existe, ce qui suffirait à cartographier les arbres des autres.
 *
 * 2. **Un seul point d'écriture du document** : `PUT /<id>/contenu`. La
 *    création, l'import et la restauration passent tous par `preparerDocument`.
 *    Ce qui doit valoir pour l'un vaut pour les trois, sans rien oublier.
 *
 * 3. **Le budget est le temps de CPU, pas la place.** D'où : lister ne lit
 *    jamais les documents (deux tables séparées), et `GET /<id>/contenu` rend
 *    le texte stocké **tel quel**, sans le reparser — il est déjà compact.
 */

import { Hono, type Context } from 'hono';
import { exigerSession, type Variables } from '../intergiciels';
import {
  ERREUR_FORME,
  estDocument,
  preparerDocument,
  reindenter,
  slugifier,
  type Document,
  type DocumentPrepare,
} from './document';
import { squelette } from './squelette';
import {
  activer,
  CHAMPS_FICHE,
  creerDocument,
  ecrireDocument,
  ErreurPlafond,
  ficheDe,
  lireTexte,
  maintenant,
  type Contenu,
  type Fiche,
} from './depot';
import { semerDemonstration } from '../depart';

type Contexte = Context<{ Bindings: Env; Variables: Variables }>;

export const routesSauvegardes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Rien ici n'est accessible sans session. Posé une fois, pour toutes les routes. */
routesSauvegardes.use('*', exigerSession);

/* --------------------------------------------------------------------------
 * Formes et garde-fous
 * -------------------------------------------------------------------------- */

const LONGUEUR_NOM = 120;

/**
 * Plafond de sécurité, avant même de savoir à qui on a affaire : au-delà, on
 * refuse sans analyser le corps. Sans lui, un fichier de 50 Mo brûlerait tout
 * le temps de CPU de la requête rien qu'à être parcouru.
 */
const OCTETS_MAXIMUM_CORPS = 8 * 1024 * 1024;

function nettoyerNom(brut: unknown, secours = ''): string {
  const propose = typeof brut === 'string' ? brut.trim() : '';
  return (propose || secours.trim()).slice(0, LONGUEUR_NOM);
}

/** Lit le corps JSON, en refusant d'avance ce qui est manifestement trop gros. */
async function lireCorpsJson(c: Contexte): Promise<{ valeur: unknown } | Response> {
  const annonce = Number.parseInt(c.req.header('Content-Length') ?? '', 10);
  if (Number.isFinite(annonce) && annonce > OCTETS_MAXIMUM_CORPS) return corpsTropGros(c);

  const texte = await c.req.text();
  // `length` compte des caractères, et un caractère pèse au moins un octet :
  // un texte plus long que le plafond dépasse forcément le plafond.
  if (texte.length > OCTETS_MAXIMUM_CORPS) return corpsTropGros(c);

  try {
    return { valeur: JSON.parse(texte) as unknown };
  } catch {
    return c.json({ erreur: 'corps illisible (du JSON était attendu)' }, 400);
  }
}

function corpsTropGros(c: Contexte): Response {
  return c.json({ erreur: 'document trop volumineux', plafond_octets: OCTETS_MAXIMUM_CORPS }, 413);
}

/**
 * Accepte les deux formes : `{ "nom": …, "document": { … } }` et le document
 * brut. La seconde permet `curl --data-binary @sauvegarde.json` sans rien
 * réemballer, ce qui est exactement ce qu'on veut pour réimporter un fichier
 * sorti de la version locale.
 */
function extraireDocument(
  corps: unknown
): { document: Document; nom: unknown; revision: unknown } | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const enveloppe = corps as Record<string, unknown>;

  if (estDocument(enveloppe.document)) {
    return { document: enveloppe.document, nom: enveloppe.nom, revision: enveloppe.revision };
  }
  if (estDocument(enveloppe)) {
    return { document: enveloppe, nom: undefined, revision: undefined };
  }
  return null;
}

function introuvable(c: Contexte): Response {
  return c.json({ erreur: 'sauvegarde introuvable' }, 404);
}

/** Le plafond de taille du compte, avec un message qui dit quoi faire. */
function verifierTaille(c: Contexte, prepare: DocumentPrepare): Response | null {
  const plafond = c.get('compte').plafond_octets;
  if (prepare.octets <= plafond) return null;
  return c.json(
    {
      erreur: `cette sauvegarde pèse ${Math.round(prepare.octets / 1024)} Ko, au-delà des ${Math.round(plafond / 1024)} Ko autorisés par compte`,
      indice:
        'les portraits collés sont la cause la plus fréquente ; la version hébergée ne les stocke pas',
      octets: prepare.octets,
      plafond_octets: plafond,
    },
    413
  );
}

/**
 * Le plafond de nombre, vérifié avant toute création.
 *
 * `demo = 0` : la démonstration n'est pas une des dix sauvegardes du compte.
 * Sans ça, un compte plein ne pourrait plus rien créer **à cause du monde
 * d'exemple qu'on lui a offert** — la plus mauvaise façon de faire un cadeau.
 */
async function verifierNombre(c: Contexte): Promise<Response | null> {
  const compte = c.get('compte');
  const ligne = await c.env.DB.prepare(
    'SELECT COUNT(*) AS combien FROM sauvegardes WHERE utilisateur_id = ? AND demo = 0'
  )
    .bind(compte.id)
    .first<{ combien: number }>();

  const combien = ligne?.combien ?? 0;
  if (combien < compte.plafond_sauvegardes) return null;
  return c.json(
    {
      erreur: `vous avez atteint vos ${compte.plafond_sauvegardes} sauvegardes`,
      indice: "exportez-en une puis supprimez-la, ou demandez un relèvement à l'administrateur",
      plafond_sauvegardes: compte.plafond_sauvegardes,
    },
    409
  );
}

/** Écrit une sauvegarde neuve (création, copie ou import) et rend sa fiche. */
async function creerSauvegarde(c: Contexte, nom: string, contenu: Contenu): Promise<Fiche> {
  const compte = c.get('compte');
  return creerDocument(c.env.DB, compte.id, compte.sauvegarde_active, nom, contenu);
}

/* --------------------------------------------------------------------------
 * Lister
 * -------------------------------------------------------------------------- */

routesSauvegardes.get('/', async (c) => {
  const compte = c.get('compte');
  const { results } = await c.env.DB.prepare(
    `SELECT ${CHAMPS_FICHE} FROM sauvegardes WHERE utilisateur_id = ? ORDER BY modifie_le DESC`
  )
    .bind(compte.id)
    .all<Fiche>();

  // `actif` fait partie du contrat de la version locale : le sélecteur de
  // sauvegarde s'en sert pour cocher celle qui est ouverte.
  const actif = results.some((f) => f.id === compte.sauvegarde_active)
    ? compte.sauvegarde_active
    : (results[0]?.id ?? null);

  return c.json({
    actif,
    sauvegardes: results,
    plafonds: {
      sauvegardes: compte.plafond_sauvegardes,
      octets: compte.plafond_octets,
    },
  });
});

/** Ouvrir un autre monde : tout `/api/…` du domaine bascule dessus. */
routesSauvegardes.post('/:id/activer', async (c) => {
  const compte = c.get('compte');
  const fiche = await ficheDe(c.env.DB, compte.id, c.req.param('id'));
  if (!fiche) return introuvable(c);

  await activer(c.env.DB, compte.id, fiche.id);
  return c.json({ sauvegarde: fiche });
});

/* --------------------------------------------------------------------------
 * La démonstration — avant `/:id`, pour que le mot ne soit jamais pris pour un
 * identifiant.
 * -------------------------------------------------------------------------- */

/**
 * Remettre la démonstration à zéro, et l'ouvrir.
 *
 * Une seule route pour deux gestes qui n'en font qu'un : « effacer ce que j'ai
 * bricolé là-dedans » et « refaire le tutoriel proprement ». Elle reconstruit
 * aussi la fiche quand on l'avait supprimée — d'où `forcer` : ailleurs, une
 * démonstration absente est un choix qu'on respecte ; ici, c'est ce qu'on
 * demande.
 *
 * Pas de plafond à vérifier : la démonstration n'en occupe aucun, et rendre le
 * terrain d'essai à quelqu'un ne doit pas dépendre de la place qu'il lui reste.
 */
routesSauvegardes.post('/demonstration', async (c) => {
  const compte = c.get('compte');
  const fiche = await semerDemonstration(c.env.DB, compte.id, compte.sauvegarde_active, true);
  if (!fiche) return c.json({ erreur: 'démonstration indisponible' }, 500);

  await activer(c.env.DB, compte.id, fiche.id);
  return c.json({ sauvegarde: fiche });
});

/* --------------------------------------------------------------------------
 * Importer — avant `/:id`, pour qu'« import » ne soit jamais pris pour un
 * identifiant.
 * -------------------------------------------------------------------------- */

routesSauvegardes.post('/import', async (c) => {
  const lu = await lireCorpsJson(c);
  if (lu instanceof Response) return lu;

  const extrait = extraireDocument(lu.valeur);
  if (!extrait) return c.json({ erreur: ERREUR_FORME }, 400);

  const trop = await verifierNombre(c);
  if (trop) return trop;

  const prepare = preparerDocument(extrait.document);
  const debordement = verifierTaille(c, prepare);
  if (debordement) return debordement;

  const nom = nettoyerNom(
    extrait.nom ?? c.req.query('nom'),
    prepare.nomInterne || 'Sauvegarde importée'
  );

  const fiche = await creerSauvegarde(c, nom, {
    texte: prepare.texte,
    octets: prepare.octets,
    personnes: prepare.personnes,
    relations: prepare.relations,
    schema: prepare.schemaVersion,
  });

  return c.json(
    {
      sauvegarde: fiche,
      portraits_retires: prepare.portraitsRetires,
      message: prepare.portraitsRetires
        ? `${prepare.portraitsRetires} portrait(s) collé(s) ont été retirés : la version en ligne ne stocke pas les images.`
        : null,
    },
    201
  );
});

/* --------------------------------------------------------------------------
 * Créer
 * -------------------------------------------------------------------------- */

routesSauvegardes.post('/', async (c) => {
  const lu = await lireCorpsJson(c);
  if (lu instanceof Response) return lu;

  const corps = (typeof lu.valeur === 'object' && lu.valeur !== null ? lu.valeur : {}) as Record<
    string,
    unknown
  >;
  const nom = nettoyerNom(corps.nom);
  if (!nom) return c.json({ erreur: 'il faut un nom' }, 400);

  const depuis = typeof corps.depuis === 'string' ? corps.depuis : '';
  // Sans source, il n'y a rien à copier : le mode est forcément « vierge ».
  const mode = depuis
    ? corps.contenu === 'referentiels' || corps.contenu === 'vierge'
      ? corps.contenu
      : 'copie'
    : 'vierge';

  const trop = await verifierNombre(c);
  if (trop) return trop;

  if (mode === 'vierge') {
    const prepare = preparerDocument(squelette());
    const fiche = await creerSauvegarde(c, nom, {
      texte: prepare.texte,
      octets: prepare.octets,
      personnes: prepare.personnes,
      relations: prepare.relations,
      schema: prepare.schemaVersion,
    });
    return c.json({ sauvegarde: fiche }, 201);
  }

  const source = await ficheDe(c.env.DB, c.get('compte').id, depuis);
  if (!source) return introuvable(c);

  // `lireTexte` et non un `SELECT donnees` : copier la démonstration est
  // précisément le geste d'« en faire mon monde », et tant qu'on n'y a pas
  // écrit elle n'a pas de ligne à copier.
  const ligne = await lireTexte(c.env.DB, c.get('compte').id, depuis);
  if (!ligne) return introuvable(c);

  if (mode === 'copie') {
    // Copie conforme : le texte stocké est déjà compact et déjà nettoyé, donc
    // rien à reparser. Les compteurs viennent de la fiche source.
    const fiche = await creerSauvegarde(c, nom, {
      texte: ligne.donnees,
      octets: source.taille,
      personnes: source.personnes,
      relations: source.relations,
      schema: source.schema_version,
    });
    return c.json({ sauvegarde: fiche }, 201);
  }

  // « referentiels » : on garde maisons, types de liens, filtres et joueurs,
  // on vide les personnes et les relations. C'est le « repartir du même
  // univers » de la version locale.
  const document = JSON.parse(ligne.donnees) as Document;
  document.personnes = [];
  document.relations = [];
  const prepare = preparerDocument(document);
  const fiche = await creerSauvegarde(c, nom, {
    texte: prepare.texte,
    octets: prepare.octets,
    personnes: 0,
    relations: 0,
    schema: prepare.schemaVersion,
  });
  return c.json({ sauvegarde: fiche }, 201);
});

/* --------------------------------------------------------------------------
 * Une sauvegarde : lire la fiche, renommer, supprimer
 * -------------------------------------------------------------------------- */

routesSauvegardes.get('/:id', async (c) => {
  const fiche = await ficheDe(c.env.DB, c.get('compte').id, c.req.param('id'));
  return fiche ? c.json({ sauvegarde: fiche }) : introuvable(c);
});

routesSauvegardes.patch('/:id', async (c) => {
  const lu = await lireCorpsJson(c);
  if (lu instanceof Response) return lu;

  const corps = (typeof lu.valeur === 'object' && lu.valeur !== null ? lu.valeur : {}) as Record<
    string,
    unknown
  >;
  const nom = nettoyerNom(corps.nom);
  if (!nom) return c.json({ erreur: 'il faut un nom' }, 400);

  // Le nom vit dans la colonne, pas dans le document : renommer ne relit ni ne
  // réécrit les 70 Ko de JSON. `meta.sauvegarde` est recollé à l'export.
  // La révision ne bouge pas : le document, lui, n'a pas changé.
  const resultat = await c.env.DB.prepare(
    'UPDATE sauvegardes SET nom = ?, modifie_le = ? WHERE id = ? AND utilisateur_id = ?'
  )
    .bind(nom, maintenant(), c.req.param('id'), c.get('compte').id)
    .run();

  if (!resultat.meta.changes) return introuvable(c);

  const fiche = await ficheDe(c.env.DB, c.get('compte').id, c.req.param('id'));
  return fiche ? c.json({ sauvegarde: fiche }) : introuvable(c);
});

routesSauvegardes.delete('/:id', async (c) => {
  const compte = c.get('compte');
  const id = c.req.param('id');

  // `ON DELETE CASCADE` emporte le contenu et les instantanés.
  const resultat = await c.env.DB.prepare(
    'DELETE FROM sauvegardes WHERE id = ? AND utilisateur_id = ?'
  )
    .bind(id, compte.id)
    .run();

  if (!resultat.meta.changes) return introuvable(c);

  // Si c'était l'active, on l'efface : la prochaine lecture repointera d'elle-
  // même sur la plus récente (voir `sauvegardeActive`).
  if (compte.sauvegarde_active === id) await activer(c.env.DB, compte.id, null);

  return c.body(null, 204);
});

/* --------------------------------------------------------------------------
 * Le document
 * -------------------------------------------------------------------------- */

// Ces trois lectures passent par `lireTexte` plutôt que par leur propre
// jointure : c'est lui qui sait qu'une démonstration jamais touchée n'a pas de
// ligne de contenu et qu'il faut alors servir le document livré avec le Worker.
// Trois requêtes en double, c'étaient trois endroits où l'oublier.
routesSauvegardes.get('/:id/contenu', async (c) => {
  const ligne = await lireTexte(c.env.DB, c.get('compte').id, c.req.param('id'));
  if (!ligne) return introuvable(c);

  // Rendu tel quel : le texte stocké *est* la réponse. Ni parse, ni stringify.
  return new Response(ligne.donnees, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      ETag: `"${ligne.revision}"`,
    },
  });
});

/**
 * Le seul point d'écriture du document.
 *
 * `revision` est facultative, mais la fournir protège d'un écrasement : si un
 * autre onglet a enregistré entre-temps, on répond 409 avec la révision
 * courante plutôt que d'effacer son travail en silence.
 */
routesSauvegardes.put('/:id/contenu', async (c) => {
  const lu = await lireCorpsJson(c);
  if (lu instanceof Response) return lu;

  const extrait = extraireDocument(lu.valeur);
  if (!extrait) return c.json({ erreur: ERREUR_FORME }, 400);

  const id = c.req.param('id');
  const fiche = await ficheDe(c.env.DB, c.get('compte').id, id);
  if (!fiche) return introuvable(c);

  const attendue = Number.parseInt(String(extrait.revision ?? ''), 10);
  if (Number.isFinite(attendue) && attendue !== fiche.revision) {
    return c.json(
      {
        erreur: 'la sauvegarde a changé entre-temps (un autre onglet ?)',
        revision: fiche.revision,
      },
      409
    );
  }

  try {
    const ecriture = await ecrireDocument(
      c.env.DB,
      c.get('compte').id,
      fiche,
      extrait.document,
      c.get('compte').plafond_octets
    );
    return c.json({
      sauvegarde: ecriture.fiche,
      portraits_retires: ecriture.portraitsRetires,
    });
  } catch (erreur) {
    if (erreur instanceof ErreurPlafond) {
      return c.json(
        {
          erreur: erreur.message,
          indice:
            'les portraits collés sont la cause la plus fréquente ; la version hébergée ne les stocke pas',
          octets: erreur.octets,
          plafond_octets: erreur.plafond,
        },
        413
      );
    }
    throw erreur;
  }
});

/* --------------------------------------------------------------------------
 * Exporter
 * -------------------------------------------------------------------------- */

routesSauvegardes.get('/:id/export', async (c) => {
  const ligne = await lireTexte(c.env.DB, c.get('compte').id, c.req.param('id'));
  if (!ligne) return introuvable(c);

  return new Response(reindenter(ligne.donnees, ligne.nom), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${slugifier(ligne.nom)}.json"`,
    },
  });
});
