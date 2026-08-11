/**
 * Les routes du domaine — port de `backend/api.py` et des mutations de
 * `backend/store.py`.
 *
 * **Le contrat d'adresses est celui de l'application locale, à la lettre.**
 * C'est tout l'intérêt : au lot 4, `web/` est recopié tel quel et fonctionne.
 * D'où deux choix qui pourraient surprendre :
 *
 * - Les adresses ne nomment pas la sauvegarde (`/api/personnes/<id>`, pas
 *   `/api/sauvegardes/<x>/personnes/<id>`). Elles portent sur la **sauvegarde
 *   active du compte**, exactement comme la version locale porte sur la
 *   sauvegarde active du dossier. Voir `sauvegardes/depot.ts`.
 * - Un refus de validation répond **400 avec le message tel quel** : ces
 *   messages sont écrits pour être affichés à l'utilisateur, pas pour être
 *   relus par un développeur.
 *
 * Là où la version locale garde le monde en mémoire et écrit sur le disque
 * toutes les minutes, ici **chaque modification écrit en base** : un Worker ne
 * garde rien entre deux requêtes. Le passage obligé est `ecrireDocument`.
 */

import { Hono, type Context } from 'hono';
import { exigerSession, type Variables } from '../intergiciels';
import {
  ecrireDocument,
  ErreurPlafond,
  ficheDe,
  lireTexte as lireDocument,
  sauvegardeActive,
  type Fiche,
} from '../sauvegardes/depot';
import {
  MIME_CSV,
  MIME_XLSX,
  table as tableDe,
  tables as tablesDe,
  versCsv,
  versXlsx,
} from './exports';
import { archiver, type Entree } from './zip';
import * as filtres from './filtres';
import * as humeur from './humeur';
import * as referentiels from './referentiels';
import * as registre from './registre';
import lieuxWesteros from './lieux_westeros.json';
import { Dataset, Personne, Relation, idsLibres, slugifier, type Objet } from './models';
import { ErreurPortrait, normaliser as normaliserPortrait, urlPhoto } from './portraits';
import { ErreurReferentiel } from './referentiels';
import { lireParametres, lireBool, lireTexte } from './vues/base';

type Contexte = Context<{ Bindings: Env; Variables: Variables }>;

export const routesDomaine = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * La surface du domaine, énumérée — et pas un `use('*')`.
 *
 * Ce module est monté sur `/api`, qui porte aussi `/api/auth/*` (où il ne faut
 * surtout pas de session : c'est là qu'on la crée) et `/api/sauvegardes/*`, qui
 * a la sienne. Un intergiciel posé sur `*` s'appliquerait à tout `/api/`, et
 * l'inscription répondrait 401.
 *
 * La liste sert donc deux fois : elle protège les bonnes routes, et elle dit
 * d'un coup d'œil ce que le domaine expose.
 */
const SURFACE = [
  '/referentiels',
  '/dataset',
  '/meta',
  '/vues',
  '/vue/*',
  '/personnes',
  '/personnes/*',
  '/relations',
  '/relations/*',
  '/maisons',
  '/maisons/*',
  '/types-relations',
  '/types-relations/*',
  '/categories',
  '/categories/*',
  '/joueurs',
  '/joueurs/*',
  '/listes',
  '/listes/*',
  '/filtres',
  '/filtres/*',
  '/lieux',
  '/export/*',
];

for (const chemin of SURFACE) routesDomaine.use(chemin, exigerSession);

/* --------------------------------------------------------------------------
 * Le monde courant
 * -------------------------------------------------------------------------- */

interface Monde {
  fiche: Fiche;
  dataset: Dataset;
}

/** Charge la sauvegarde active. Sans sauvegarde, on le dit clairement. */
async function monde(c: Contexte): Promise<Monde | Response> {
  const compte = c.get('compte');
  const fiche = await sauvegardeActive(c.env.DB, compte.id, compte.sauvegarde_active);
  if (!fiche) {
    return c.json(
      {
        erreur: "aucune sauvegarde active",
        indice: "créez ou importez une sauvegarde depuis l'accueil",
      },
      409
    );
  }

  const ligne = await c.env.DB.prepare('SELECT donnees FROM contenus WHERE sauvegarde_id = ?')
    .bind(fiche.id)
    .first<{ donnees: string }>();
  if (!ligne) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  return { fiche, dataset: Dataset.depuisDict(JSON.parse(ligne.donnees) as Objet) };
}

/** Réécrit le document. Passe par `ecrireDocument`, le seul point d'écriture. */
async function enregistrer(c: Contexte, courant: Monde): Promise<void> {
  const compte = c.get('compte');
  courant.dataset.oublierIndex();
  await ecrireDocument(
    c.env.DB,
    compte.id,
    courant.fiche,
    courant.dataset.versDict(),
    compte.plafond_octets
  );
}

/**
 * Traduit les refus du domaine en réponses HTTP.
 *
 * `ErreurReferentiel` et `ErreurPortrait` portent un message écrit pour
 * l'utilisateur : il part tel quel, comme le fait le `except ValueError` de la
 * version locale.
 */
function enErreur(c: Contexte, erreur: unknown): Response {
  if (erreur instanceof ErreurReferentiel || erreur instanceof ErreurPortrait) {
    return c.json({ erreur: erreur.message }, 400);
  }
  if (erreur instanceof ErreurPlafond) {
    return c.json({ erreur: erreur.message, octets: erreur.octets, plafond_octets: erreur.plafond }, 413);
  }
  throw erreur;
}

async function corpsDe(c: Contexte): Promise<Objet> {
  const brut = await c.req.json<unknown>().catch(() => null);
  return typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? (brut as Objet) : {};
}

function absent(c: Contexte, message: string): Response {
  return c.json({ erreur: message }, 404);
}

/* --------------------------------------------------------------------------
 * Sérialisation d'appoint
 * -------------------------------------------------------------------------- */

function resumePersonne(personne: Personne, dataset: Dataset): Objet {
  const maison = dataset.maison(personne.maison);
  return {
    id: personne.id,
    label: personne.nomComplet,
    surnom: personne.surnom,
    maison: personne.maison,
    maison_label: maison.label ?? '',
    couleur: personne.couleur || (maison.couleur ?? '#7a7f87'),
    initiales: personne.initiales,
    statut: personne.statut,
    importance: personne.importance,
  };
}

const ORDRE_CATEGORIES: Record<string, number> = {
  famille: 0,
  social: 1,
  politique: 2,
  autre: 3,
};

function relationsEnrichies(
  dataset: Dataset,
  personneId: string,
  avecFratrie: boolean,
  avecSecrets: boolean
): Objet[] {
  let relations = [...dataset.relations];
  if (avecFratrie) relations = relations.concat(fratrieDeduite(relations));
  if (!avecSecrets) relations = relations.filter((r) => !r.secret);

  const resultat: Objet[] = [];
  for (const rel of relations) {
    if (rel.source !== personneId && rel.cible !== personneId) continue;
    const autreId = rel.source === personneId ? rel.cible : rel.source;
    const autre = dataset.personne(autreId);
    if (!autre) continue;

    const typeRel = dataset.typeRelation(rel.type);
    const dirige = dataset.estDirigee(rel);
    const sens = !dirige ? 'mutuel' : rel.source === personneId ? 'sortant' : 'entrant';
    const cleSens = sens === 'sortant' ? 'label_sortant' : 'label_entrant';
    const cran = humeur.cran(rel.humeur);

    resultat.push({
      id: rel.id,
      type: rel.type,
      type_label: typeRel.label ?? rel.type,
      couleur: typeRel.couleur ?? '#8a8f98',
      categorie: typeRel.categorie ?? 'autre',
      dirige,
      sens,
      sens_label: typeRel[cleSens] ?? typeRel.label ?? rel.type,
      humeur: rel.humeur,
      humeur_label: cran.label,
      humeur_couleur: cran.couleur,
      label: rel.label,
      notes: rel.notes,
      secret: rel.secret,
      deduit: Boolean(rel.extra.deduit),
      autre: resumePersonne(autre, dataset),
    });
  }

  return resultat.sort((a, b) => {
    const ca = ORDRE_CATEGORIES[String(a.categorie)] ?? 9;
    const cb = ORDRE_CATEGORIES[String(b.categorie)] ?? 9;
    if (ca !== cb) return ca - cb;
    const la = String(a.type_label);
    const lb = String(b.type_label);
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

/**
 * Les fratries implicites, pour la fiche d'une personne. Le sociogramme a la
 * sienne : celle-ci ne sert qu'au panneau de droite, et n'a pas à passer par
 * le payload d'une vue.
 */
function fratrieDeduite(relations: Relation[]): Relation[] {
  const enfantsParParent = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.type !== 'parent') continue;
    const liste = enfantsParParent.get(rel.source);
    if (liste) liste.push(rel.cible);
    else enfantsParParent.set(rel.source, [rel.cible]);
  }

  const cle = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const existantes = new Set(
    relations.filter((r) => r.type === 'fratrie').map((r) => cle(r.source, r.cible))
  );

  const deduites: Relation[] = [];
  const vues = new Set<string>();
  for (const enfants of enfantsParParent.values()) {
    const uniques = [...new Set(enfants)].sort();
    for (let i = 0; i < uniques.length; i += 1) {
      for (let j = i + 1; j < uniques.length; j += 1) {
        const a = uniques[i] as string;
        const b = uniques[j] as string;
        const paire = cle(a, b);
        if (existantes.has(paire) || vues.has(paire)) continue;
        vues.add(paire);

        const relation = new Relation();
        relation.id = `auto-fratrie-${a}-${b}`;
        relation.source = a;
        relation.cible = b;
        relation.type = 'fratrie';
        relation.notes = "Lien déduit d'un parent commun.";
        relation.extra = { deduit: true };
        deduites.push(relation);
      }
    }
  }
  return deduites;
}

/* --------------------------------------------------------------------------
 * Catalogues
 * -------------------------------------------------------------------------- */

/** Catalogue complet + effectif réel (une maison vide existe quand même). */
function listeMaisons(dataset: Dataset): Objet[] {
  const effectifs = new Map<string, number>();
  for (const personne of dataset.personnes) {
    effectifs.set(personne.maison, (effectifs.get(personne.maison) ?? 0) + 1);
  }
  return Object.entries(dataset.maisons).map(([cle, valeur]) => ({
    ...valeur,
    id: cle,
    personnes: effectifs.get(cle) ?? 0,
  }));
}

/** Catalogue des catégories + nombre de maisons et de personnes. */
function listeCategories(dataset: Dataset): Objet[] {
  const maisons = new Map<string, number>();
  const personnes = new Map<string, number>();

  for (const maison of Object.values(dataset.maisons)) {
    const categorie = String(maison.categorie || '');
    maisons.set(categorie, (maisons.get(categorie) ?? 0) + 1);
  }
  for (const personne of dataset.personnes) {
    const fiche = Object.hasOwn(dataset.maisons, personne.maison)
      ? dataset.maisons[personne.maison]
      : undefined;
    const categorie = String(fiche?.categorie || '');
    personnes.set(categorie, (personnes.get(categorie) ?? 0) + 1);
  }

  return Object.entries(dataset.categories).map(([cle, valeur]) => ({
    ...valeur,
    id: cle,
    maisons: maisons.get(cle) ?? 0,
    personnes: personnes.get(cle) ?? 0,
  }));
}

function listeTypes(dataset: Dataset): Objet[] {
  const usages = new Map<string, number>();
  for (const relation of dataset.relations) {
    usages.set(relation.type, (usages.get(relation.type) ?? 0) + 1);
  }
  return Object.entries(dataset.types_relations).map(([cle, valeur]) => ({
    ...valeur,
    id: cle,
    liens: usages.get(cle) ?? 0,
  }));
}

/** Trié par (ordre, label), comme le tuple de tri de Python. */
function parOrdrePuisLabel(catalogue: Record<string, Objet>): Objet[] {
  return Object.entries(catalogue)
    .map(([identifiant, fiche]): Objet => ({ ...fiche, id: identifiant }))
    .sort((a, b) => {
      const oa = Number(a.ordre ?? 0);
      const ob = Number(b.ordre ?? 0);
      if (oa !== ob) return oa - ob;
      const la = String(a.label ?? '');
      const lb = String(b.label ?? '');
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
}

/* --------------------------------------------------------------------------
 * Méta
 * -------------------------------------------------------------------------- */

routesDomaine.get('/referentiels', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  return c.json({
    meta: dataset.meta,
    types_relations: listeTypes(dataset),
    maisons: listeMaisons(dataset),
    categories_maisons: listeCategories(dataset),
    // Les filtres sur mesure : des axes de couleur de plus, définis ici.
    filtres: parOrdrePuisLabel(dataset.filtres),
    joueurs: dataset.joueurs,
    // L'échelle d'humeur et ses modificateurs : le web l'affiche, il ne la
    // connaît pas. Une seule table, ici.
    humeurs: humeur.decrire(),
    statuts: [
      { id: 'vivant', label: 'Vivant' },
      { id: 'mort', label: 'Mort' },
      { id: 'inconnu', label: 'Inconnu' },
    ],
    // De quoi construire les formulaires d'édition sans rien coder en dur côté
    // web : styles de trait, catégories, types indéboulonnables.
    ...referentiels.decrireCatalogues(),
  });
});

routesDomaine.get('/dataset', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json(courant.dataset.versDict());
});

/**
 * Les deux clés de `meta` que l'application sache écrire : l'année de la
 * campagne, et l'adresse de son document.
 *
 * L'année est **volontairement du texte libre**, au même format que le champ
 * « Naissance » d'une fiche (« 300 AC ») : Westeros ne compte pas les années
 * comme nous, et un `number` obligerait à trancher une convention que la table
 * n'a pas forcément adoptée. Ce qui compte, c'est qu'on puisse en extraire un
 * entier — c'est lui qui fait les âges, côté navigateur.
 *
 * Le document est passé d'une constante du client à une donnée de la
 * sauvegarde (lot 9.C). Tant que l'application était privée, une adresse en dur
 * suffisait ; à partir du moment où n'importe qui peut ouvrir un monde, le
 * bouton « 📜 » ne doit renvoyer que vers ce que *cette* table y a mis.
 *
 * Le reste de `meta` (titre, univers…) vient du fichier de sauvegarde et ne
 * s'édite pas ici : ce n'est pas un oubli.
 */
routesDomaine.patch('/meta', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const corps = await corpsDe(c);

  const donneAnnee = Object.hasOwn(corps, 'annee_courante');
  const donneDocument = Object.hasOwn(corps, 'document');
  if (!donneAnnee && !donneDocument) {
    return c.json(
      { erreur: 'rien à modifier : « annee_courante » et « document » sont les seules clés' },
      400
    );
  }

  if (donneAnnee) {
    const brut = corps.annee_courante;
    if (brut === null || brut === '') {
      delete courant.dataset.meta.annee_courante;
    } else {
      const texte = String(brut).trim().slice(0, 40);
      if (!/-?\d/.test(texte)) {
        return c.json({ erreur: "l'année doit contenir un nombre (« 300 AC », « 1482 »…)" }, 400);
      }
      courant.dataset.meta.annee_courante = texte;
    }
  }

  if (donneDocument) {
    const brut = corps.document;
    if (brut === null || brut === '') {
      delete courant.dataset.meta.document;
    } else {
      // Cette valeur finit dans le `href` d'un lien. Sans ce filtre, un
      // `javascript:…` rangé dans une sauvegarde s'exécuterait au clic — chez
      // son auteur, mais aussi chez l'administrateur qui ouvre l'arbre par
      // procuration. Seuls `http` et `https` passent.
      const texte = String(brut).trim().slice(0, 2000);
      let adresse: URL;
      try {
        adresse = new URL(texte);
      } catch {
        return c.json({ erreur: 'adresse illisible : il faut une URL complète' }, 400);
      }
      if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
        return c.json({ erreur: 'seules les adresses http(s) sont acceptées' }, 400);
      }
      courant.dataset.meta.document = texte;
    }
  }

  try {
    await enregistrer(c, courant);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
  return c.json({ meta: courant.dataset.meta });
});

/* --------------------------------------------------------------------------
 * Vues
 * -------------------------------------------------------------------------- */

routesDomaine.get('/vues', (c) => c.json({ vues: registre.toutes().map((vue) => vue.decrire()) }));

routesDomaine.get('/vue/:id', async (c) => {
  const vue = registre.obtenir(c.req.param('id'));
  if (!vue) return absent(c, `vue inconnue : ${c.req.param('id')}`);

  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  return c.json(vue.construire(courant.dataset, lireParametres(new URL(c.req.url))));
});

/* --------------------------------------------------------------------------
 * Personnes
 * -------------------------------------------------------------------------- */

routesDomaine.get('/personnes', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({
    personnes: courant.dataset.personnes.map((p) => resumePersonne(p, courant.dataset)),
  });
});

routesDomaine.post('/personnes', async (c) => {
  const corps = await corpsDe(c);
  if (!Object.keys(corps).length) return c.json({ erreur: 'corps vide' }, 400);

  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  try {
    const propose =
      String(corps.id || '') || slugifier(`${corps.prenom ?? ''} ${corps.nom ?? ''}`);
    const donnees: Objet = { ...corps };
    donnees.id = idsLibres(
      dataset.personnes.map((p) => p.id),
      propose
    );
    if (Object.hasOwn(donnees, 'avatar')) donnees.avatar = normaliserPortrait(donnees.avatar);

    const personne = Personne.depuisDict(donnees);
    dataset.personnes.push(personne);
    dataset.oublierIndex();
    await enregistrer(c, courant);
    return c.json({ personne: personne.versDict() }, 201);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.get('/personnes/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const personneId = c.req.param('id');
  const personne = dataset.personne(personneId);
  if (!personne) return absent(c, `personne inconnue : ${personneId}`);

  const params = lireParametres(new URL(c.req.url));
  const maison = dataset.maison(personne.maison);

  return c.json({
    personne: personne.versDict(),
    nom_complet: personne.nomComplet,
    initiales: personne.initiales,
    photo: urlPhoto(personne.avatar),
    maison_detail: { ...maison, id: personne.maison },
    relations: relationsEnrichies(
      dataset,
      personneId,
      lireBool(params, 'fratrie', true),
      lireBool(params, 'secrets', false)
    ),
    joueurs: dataset.joueurs,
  });
});

routesDomaine.patch('/personnes/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const personneId = c.req.param('id');
  const personne = courant.dataset.personne(personneId);
  if (!personne) return absent(c, `personne inconnue : ${personneId}`);

  try {
    if (personne.appliquerPatch(corps).length) await enregistrer(c, courant);
    return c.json({ personne: personne.versDict(), photo: urlPhoto(personne.avatar) });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.delete('/personnes/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const personneId = c.req.param('id');
  if (!dataset.personne(personneId)) return absent(c, `personne inconnue : ${personneId}`);

  dataset.personnes = dataset.personnes.filter((p) => p.id !== personneId);
  dataset.relations = dataset.relations.filter(
    (r) => r.source !== personneId && r.cible !== personneId
  );
  dataset.oublierIndex();
  await enregistrer(c, courant);
  return c.json({ supprime: personneId });
});

/* --------------------------------------------------------------------------
 * Relations
 * -------------------------------------------------------------------------- */

routesDomaine.get('/relations', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ relations: courant.dataset.relations.map((r) => r.versDict()) });
});

routesDomaine.post('/relations', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const source = String(corps.source || '');
  const cible = String(corps.cible || '');
  if (!dataset.personne(source) || !dataset.personne(cible)) {
    return c.json({ erreur: 'source ou cible inconnue' }, 400);
  }

  const donnees: Objet = { ...corps };
  const propose = String(corps.id || '') || slugifier(`${source}-${corps.type ?? 'autre'}-${cible}`);
  donnees.id = idsLibres(
    dataset.relations.map((r) => r.id),
    propose
  );

  const relation = Relation.depuisDict(donnees);
  dataset.relations.push(relation);
  await enregistrer(c, courant);
  return c.json({ relation: relation.versDict() }, 201);
});

routesDomaine.patch('/relations/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const relationId = c.req.param('id');
  const relation = courant.dataset.relation(relationId);
  if (!relation) return absent(c, `relation inconnue : ${relationId}`);

  if (relation.appliquerPatch(corps).length) await enregistrer(c, courant);
  return c.json({ relation: relation.versDict() });
});

routesDomaine.delete('/relations/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const relationId = c.req.param('id');
  if (!courant.dataset.relation(relationId)) return absent(c, `relation inconnue : ${relationId}`);

  courant.dataset.relations = courant.dataset.relations.filter((r) => r.id !== relationId);
  await enregistrer(c, courant);
  return c.json({ supprime: relationId });
});

/* --------------------------------------------------------------------------
 * Maisons
 * -------------------------------------------------------------------------- */

routesDomaine.get('/maisons', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ maisons: listeMaisons(courant.dataset) });
});

routesDomaine.post('/maisons', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  try {
    const fiche = referentiels.appliquerMaison(null, corps);
    const propose = String(corps.id || '').trim() || String(fiche.label);
    const identifiant = idsLibres(Object.keys(courant.dataset.maisons), slugifier(propose, 'maison'));
    courant.dataset.maisons[identifiant] = fiche;
    await enregistrer(c, courant);
    return c.json({ maison: { ...fiche, id: identifiant } }, 201);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.patch('/maisons/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const base = courant.dataset.maisons;
  if (!Object.hasOwn(base, identifiant)) return absent(c, `maison inconnue : ${identifiant}`);

  try {
    const fiche = referentiels.appliquerMaison(base[identifiant] as Objet, corps);
    if (JSON.stringify(fiche) !== JSON.stringify(base[identifiant])) {
      base[identifiant] = fiche;
      await enregistrer(c, courant);
    }
    return c.json({ maison: { ...fiche, id: identifiant } });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/** Supprime une maison ; ses membres passent dans une autre. */
routesDomaine.delete('/maisons/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const identifiant = c.req.param('id');
  if (!Object.hasOwn(dataset.maisons, identifiant)) {
    return absent(c, `maison inconnue : ${identifiant}`);
  }

  try {
    if (Object.keys(dataset.maisons).length <= 1) {
      throw new ErreurReferentiel("c'est la dernière maison : il en faut au moins une");
    }

    let remplacement = lireTexte(lireParametres(new URL(c.req.url)), 'remplacement');
    if (!remplacement || remplacement === identifiant) {
      const autres = Object.keys(dataset.maisons).filter((cle) => cle !== identifiant);
      remplacement = autres.includes('autre') ? 'autre' : (autres[0] as string);
    }
    if (!Object.hasOwn(dataset.maisons, remplacement)) {
      throw new ErreurReferentiel(`maison de repli inconnue : ${remplacement}`);
    }

    let deplacees = 0;
    for (const personne of dataset.personnes) {
      if (personne.maison === identifiant) {
        personne.maison = remplacement;
        deplacees += 1;
      }
    }
    delete dataset.maisons[identifiant];
    await enregistrer(c, courant);
    return c.json({ supprime: identifiant, remplacement, personnes: deplacees });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/* --------------------------------------------------------------------------
 * Types de liens
 * -------------------------------------------------------------------------- */

routesDomaine.get('/types-relations', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ types_relations: listeTypes(courant.dataset) });
});

routesDomaine.post('/types-relations', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  try {
    const fiche = referentiels.appliquerType(null, corps);
    const propose = String(corps.id || '').trim() || String(fiche.label);
    const identifiant = idsLibres(
      Object.keys(courant.dataset.types_relations),
      slugifier(propose, 'lien')
    );
    courant.dataset.types_relations[identifiant] = fiche;
    await enregistrer(c, courant);
    return c.json({ type: { ...fiche, id: identifiant } }, 201);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.patch('/types-relations/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const base = courant.dataset.types_relations;
  if (!Object.hasOwn(base, identifiant)) {
    return absent(c, `type de lien inconnu : ${identifiant}`);
  }

  try {
    const fiche = referentiels.appliquerType(base[identifiant] as Objet, corps);
    if (JSON.stringify(fiche) !== JSON.stringify(base[identifiant])) {
      base[identifiant] = fiche;
      await enregistrer(c, courant);
    }
    return c.json({ type: { ...fiche, id: identifiant } });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/** Sans `?remplacement=`, les liens de ce type disparaissent avec lui. */
routesDomaine.delete('/types-relations/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const identifiant = c.req.param('id');
  if (!Object.hasOwn(dataset.types_relations, identifiant)) {
    return absent(c, `type de lien inconnu : ${identifiant}`);
  }

  try {
    if ((referentiels.TYPES_STRUCTURANTS as readonly string[]).includes(identifiant)) {
      throw new ErreurReferentiel(
        `« ${dataset.typeRelation(identifiant).label ?? identifiant} » structure l'arbre ` +
          '(générations, couples, fratries) : renommez-le ou changez sa couleur, mais gardez-le'
      );
    }
    if (Object.keys(dataset.types_relations).length <= 1) {
      throw new ErreurReferentiel("c'est le dernier type de lien : il en faut au moins un");
    }

    let remplacement: string | null = lireTexte(
      lireParametres(new URL(c.req.url)),
      'remplacement'
    );
    if (!remplacement || remplacement === identifiant) remplacement = null;
    if (remplacement && !Object.hasOwn(dataset.types_relations, remplacement)) {
      throw new ErreurReferentiel(`type de repli inconnu : ${remplacement}`);
    }

    const concernees = dataset.relations.filter((r) => r.type === identifiant);
    if (remplacement) {
      for (const relation of concernees) relation.type = remplacement;
    } else {
      const aRetirer = new Set(concernees.map((r) => r.id));
      dataset.relations = dataset.relations.filter((r) => !aRetirer.has(r.id));
    }
    delete dataset.types_relations[identifiant];
    await enregistrer(c, courant);

    return c.json({
      supprime: identifiant,
      remplacement,
      liens: concernees.length,
      liens_supprimes: remplacement ? 0 : concernees.length,
    });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/* --------------------------------------------------------------------------
 * Catégories de maisons
 * -------------------------------------------------------------------------- */

routesDomaine.get('/categories', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ categories: listeCategories(courant.dataset) });
});

routesDomaine.post('/categories', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  try {
    const fiche = referentiels.appliquerCategorie(
      null,
      corps,
      Object.keys(courant.dataset.categories).length
    );
    const propose = String(corps.id || '').trim() || String(fiche.label);
    const identifiant = idsLibres(
      Object.keys(courant.dataset.categories),
      slugifier(propose, 'categorie')
    );
    courant.dataset.categories[identifiant] = fiche;
    await enregistrer(c, courant);
    return c.json({ categorie: { ...fiche, id: identifiant, maisons: 0, personnes: 0 } }, 201);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.patch('/categories/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const base = courant.dataset.categories;
  if (!Object.hasOwn(base, identifiant)) return absent(c, `categorie inconnue : ${identifiant}`);

  try {
    const fiche = referentiels.appliquerCategorie(
      base[identifiant] as Objet,
      corps,
      Object.keys(base).indexOf(identifiant)
    );
    if (JSON.stringify(fiche) !== JSON.stringify(base[identifiant])) {
      base[identifiant] = fiche;
      await enregistrer(c, courant);
    }
    return c.json({ categorie: { ...fiche, id: identifiant } });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/** Les maisons concernées perdent leur catégorie, rien de plus. */
routesDomaine.delete('/categories/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const identifiant = c.req.param('id');
  if (!Object.hasOwn(dataset.categories, identifiant)) {
    return absent(c, `categorie inconnue : ${identifiant}`);
  }

  let concernees = 0;
  for (const maison of Object.values(dataset.maisons)) {
    if (maison.categorie === identifiant) {
      maison.categorie = '';
      concernees += 1;
    }
  }
  delete dataset.categories[identifiant];
  await enregistrer(c, courant);
  return c.json({ supprime: identifiant, maisons: concernees });
});

/* --------------------------------------------------------------------------
 * Joueurs
 * -------------------------------------------------------------------------- */

routesDomaine.get('/joueurs', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ joueurs: courant.dataset.joueurs });
});

routesDomaine.post('/joueurs', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  try {
    const fiche = referentiels.appliquerJoueur(null, corps);
    const propose = String(corps.id || '').trim() || String(fiche.nom);
    fiche.id = idsLibres(
      courant.dataset.joueurs.map((j) => String(j.id)),
      slugifier(propose, 'joueur')
    );
    courant.dataset.joueurs.push(fiche);
    await enregistrer(c, courant);
    return c.json({ joueur: fiche }, 201);
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

routesDomaine.patch('/joueurs/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const joueur = courant.dataset.joueurs.find((j) => String(j.id) === identifiant);
  if (!joueur) return absent(c, `joueur inconnu : ${identifiant}`);

  try {
    const fiche = referentiels.appliquerJoueur(joueur, corps);
    fiche.id = identifiant; // l'id ne bouge jamais : les fiches s'y réfèrent
    if (JSON.stringify(fiche) !== JSON.stringify(joueur)) {
      for (const cle of Object.keys(joueur)) delete joueur[cle];
      Object.assign(joueur, fiche);
      await enregistrer(c, courant);
    }
    return c.json({ joueur: fiche });
  } catch (erreur) {
    return enErreur(c, erreur);
  }
});

/** Le joueur quitte la table : ce que les PNJ pensaient de lui aussi. */
routesDomaine.delete('/joueurs/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const identifiant = c.req.param('id');
  const joueur = dataset.joueurs.find((j) => String(j.id) === identifiant);
  if (!joueur) return absent(c, `joueur inconnu : ${identifiant}`);

  dataset.joueurs = dataset.joueurs.filter((j) => String(j.id) !== identifiant);
  let oubliees = 0;
  for (const personne of dataset.personnes) {
    if (Object.hasOwn(personne.relations_joueurs ?? {}, identifiant)) {
      delete personne.relations_joueurs[identifiant];
      oubliees += 1;
    }
  }
  await enregistrer(c, courant);
  return c.json({ supprime: identifiant, nom: joueur.nom ?? '', fiches: oubliees });
});

/* --------------------------------------------------------------------------
 * Listes nommées
 * -------------------------------------------------------------------------- */

routesDomaine.get('/listes', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  return c.json({ listes: parOrdrePuisLabel(courant.dataset.listes) });
});

routesDomaine.post('/listes', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const fiche = filtres.appliquerListe(null, corps, Object.keys(courant.dataset.listes).length);
  const propose = String(corps.id || '').trim() || String(fiche.label);
  const identifiant = filtres.idLibre(Object.keys(courant.dataset.listes), propose);
  courant.dataset.listes[identifiant] = fiche;
  await enregistrer(c, courant);
  return c.json({ liste: { ...fiche, id: identifiant } }, 201);
});

routesDomaine.patch('/listes/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const base = courant.dataset.listes;
  if (!Object.hasOwn(base, identifiant)) return absent(c, `liste inconnue : ${identifiant}`);

  const fiche = filtres.appliquerListe(
    base[identifiant] as Objet,
    corps,
    Object.keys(base).indexOf(identifiant)
  );
  if (JSON.stringify(fiche) !== JSON.stringify(base[identifiant])) {
    base[identifiant] = fiche;
    await enregistrer(c, courant);
  }
  return c.json({ liste: { ...fiche, id: identifiant } });
});

/**
 * Les tests qui s'y référaient ne trouveraient plus personne : on les retire
 * aussi, plutôt que de laisser des filtres qui mentent.
 */
routesDomaine.delete('/listes/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  const identifiant = c.req.param('id');
  if (!Object.hasOwn(dataset.listes, identifiant)) {
    return absent(c, `liste inconnue : ${identifiant}`);
  }

  let touches = 0;
  for (const fiche of Object.values(dataset.filtres)) {
    const tests = (Array.isArray(fiche.tests) ? fiche.tests : []) as Objet[];
    const restants = tests.filter(
      (t) => !((t.operateur === '∈' || t.operateur === '∉') && t.valeur === identifiant)
    );
    if (restants.length !== tests.length) {
      fiche.tests = restants;
      touches += 1;
    }
  }
  delete dataset.listes[identifiant];
  await enregistrer(c, courant);
  return c.json({ supprime: identifiant, filtres: touches });
});

/* --------------------------------------------------------------------------
 * Filtres sur mesure
 * -------------------------------------------------------------------------- */

/**
 * Les valeurs réellement présentes pour une variable, avec leurs effectifs.
 * De quoi composer une liste en cochant plutôt qu'en retapant — et sans faute
 * d'orthographe sur « Peyredragon ».
 */
routesDomaine.get('/filtres/valeurs', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = lireTexte(lireParametres(new URL(c.req.url)), 'variable', 'maison');
  return c.json({
    variable: identifiant,
    valeurs: filtres.valeursObservees(courant.dataset, identifiant),
  });
});

/**
 * Ce que donnerait ce réglage, sans rien enregistrer.
 *
 * C'est ce qui rend l'éditeur utilisable : on voit ses segments et ses
 * effectifs se former pendant qu'on règle, avant de valider quoi que ce soit.
 */
routesDomaine.post('/filtres/apercu', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  return c.json(filtres.appliquer(courant.dataset, filtres.appliquerFiltre(null, corps)));
});

/** Le catalogue, plus de quoi construire l'éditeur (variables, opérateurs). */
routesDomaine.get('/filtres', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;
  const { dataset } = courant;

  return c.json({
    filtres: parOrdrePuisLabel(dataset.filtres),
    variables: filtres.variables(dataset),
    operateurs: [...filtres.OPERATEURS],
    listes: parOrdrePuisLabel(dataset.listes),
    gradient_defaut: { ...filtres.GRADIENT_DEFAUT },
    segments: {
      minimum: filtres.SEGMENTS_MINIMUM,
      maximum: filtres.SEGMENTS_MAXIMUM,
      defaut: filtres.SEGMENTS_DEFAUT,
    },
  });
});

routesDomaine.post('/filtres', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const fiche = filtres.appliquerFiltre(null, corps, Object.keys(courant.dataset.filtres).length);
  const propose = String(corps.id || '').trim() || String(fiche.label);
  const identifiant = filtres.idLibre(Object.keys(courant.dataset.filtres), propose);
  courant.dataset.filtres[identifiant] = fiche;
  await enregistrer(c, courant);
  return c.json({ filtre: { ...fiche, id: identifiant } }, 201);
});

routesDomaine.get('/filtres/:id/application', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const fiche = courant.dataset.filtres[identifiant];
  if (!fiche || !Object.hasOwn(courant.dataset.filtres, identifiant)) {
    return absent(c, `filtre inconnu : ${identifiant}`);
  }
  return c.json(filtres.appliquer(courant.dataset, { ...fiche, id: identifiant }));
});

routesDomaine.patch('/filtres/:id', async (c) => {
  const corps = await corpsDe(c);
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  const base = courant.dataset.filtres;
  if (!Object.hasOwn(base, identifiant)) return absent(c, `filtre inconnu : ${identifiant}`);

  const fiche = filtres.appliquerFiltre(
    base[identifiant] as Objet,
    corps,
    Object.keys(base).indexOf(identifiant)
  );
  if (JSON.stringify(fiche) !== JSON.stringify(base[identifiant])) {
    base[identifiant] = fiche;
    await enregistrer(c, courant);
  }
  return c.json({ filtre: { ...fiche, id: identifiant } });
});

/** Un filtre ne porte aucune donnée : le retirer n'affecte personne. */
routesDomaine.delete('/filtres/:id', async (c) => {
  const courant = await monde(c);
  if (courant instanceof Response) return courant;

  const identifiant = c.req.param('id');
  if (!Object.hasOwn(courant.dataset.filtres, identifiant)) {
    return absent(c, `filtre inconnu : ${identifiant}`);
  }
  delete courant.dataset.filtres[identifiant];
  await enregistrer(c, courant);
  return c.json({ supprime: identifiant });
});

/* --------------------------------------------------------------------------
 * Lieux
 * -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Sortir ses données
 *
 * Même adresse qu'en local : `/api/export/<format>`, avec `?sauvegarde=`
 * (défaut : l'active), `?table=` pour le CSV et `?secrets=` (défaut : oui).
 * La vue « tableaux » fabrique ces adresses elle-même — le front pose un lien
 * de téléchargement sans rien savoir du format des routes.
 *
 * `zip` s'ajoute à la liste locale : en ligne, on veut pouvoir tout reprendre
 * d'un coup, sans cliquer sauvegarde par sauvegarde.
 * -------------------------------------------------------------------------- */

function fichier(c: Contexte, nom: string, mime: string, octets: Uint8Array | string): Response {
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

/** Toutes les sauvegardes du compte, dans un ZIP, avec de quoi s'y retrouver. */
async function toutTelecharger(c: Contexte): Promise<Response> {
  const compte = c.get('compte');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.nom, s.personnes, s.relations, s.modifie_le, c.donnees
       FROM sauvegardes s JOIN contenus c ON c.sauvegarde_id = s.id
      WHERE s.utilisateur_id = ? ORDER BY s.modifie_le DESC`
  )
    .bind(compte.id)
    .all<{
      id: string;
      nom: string;
      personnes: number;
      relations: number;
      modifie_le: number;
      donnees: string;
    }>();

  const pris = new Set<string>();
  const entrees: Entree[] = [];
  const inventaire: string[] = [];

  for (const ligne of results) {
    // Deux sauvegardes peuvent porter le même nom : dans une archive, deux
    // fichiers de même chemin, c'est une qui écrase l'autre.
    let base = slugifier(ligne.nom, 'sauvegarde');
    if (pris.has(base)) base = `${base}-${ligne.id.slice(0, 8)}`;
    pris.add(base);

    entrees.push({ nom: `sauvegardes/${base}.json`, contenu: ligne.donnees });
    inventaire.push(
      `- sauvegardes/${base}.json — « ${ligne.nom} » : ` +
        `${ligne.personnes} personnes, ${ligne.relations} liens, ` +
        `modifiée le ${new Date(ligne.modifie_le * 1000).toISOString().slice(0, 19).replace('T', ' à ')}`
    );
  }

  const lisezmoi = [
    'FamilyTree — vos données',
    '========================',
    '',
    `Compte : ${compte.email}`,
    `Archive du ${new Date().toISOString().slice(0, 19).replace('T', ' à ')} (UTC).`,
    '',
    inventaire.length
      ? `${inventaire.length} sauvegarde(s) :`
      : "Ce compte n'a aucune sauvegarde.",
    ...inventaire,
    '',
    'Chaque fichier .json est une sauvegarde complète et autonome.',
    'Pour la relire :',
    '  - ici, par « ⤒ Importer » dans le panneau de gauche ;',
    "  - dans l'application locale, en le déposant dans data/sauvegardes/.",
    '',
    "Rien dans cette archive ne dépend du service : c'est du JSON, lisible",
    "avec n'importe quel éditeur de texte.",
    '',
  ].join('\r\n');

  entrees.push({ nom: 'LISEZMOI.txt', contenu: lisezmoi });

  const archive = await archiver(entrees);
  const jour = new Date().toISOString().slice(0, 10);
  return fichier(c, `familytree-${jour}.zip`, 'application/zip', archive);
}

routesDomaine.get('/export/:format', async (c) => {
  const format = c.req.param('format');
  if (format === 'zip') return toutTelecharger(c);

  const compte = c.get('compte');
  const parametres = lireParametres(new URL(c.req.url));
  const demandee = lireTexte(parametres, 'sauvegarde');
  const secrets = lireBool(parametres, 'secrets', true);

  const fiche = demandee
    ? await ficheDe(c.env.DB, compte.id, demandee)
    : await sauvegardeActive(c.env.DB, compte.id, compte.sauvegarde_active);
  if (!fiche) return c.json({ erreur: 'sauvegarde introuvable' }, 404);
  const base = slugifier(fiche.nom, 'sauvegarde');

  const contenu = await lireDocument(c.env.DB, compte.id, fiche.id);
  if (!contenu) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  // Le JSON part tel quel : c'est le document qu'on a écrit, indenté, et non
  // une resérialisation qui pourrait en changer un détail au passage.
  if (format === 'json') {
    return fichier(c, `${base}.json`, 'application/json; charset=utf-8', contenu.donnees);
  }

  const dataset = Dataset.depuisDict(JSON.parse(contenu.donnees) as Objet);

  if (format === 'xlsx') {
    const classeur = await versXlsx(tablesDe(dataset, secrets));
    return fichier(c, `${base}.xlsx`, MIME_XLSX, classeur);
  }

  if (format === 'csv') {
    const nomTable = lireTexte(parametres, 'table', 'personnes');
    const table = tableDe(dataset, nomTable, secrets);
    if (!table) return c.json({ erreur: `tableau inconnu : ${nomTable}` }, 400);
    return fichier(c, `${base}-${table.id}.csv`, MIME_CSV, versCsv(table));
  }

  return c.json({ erreur: `format inconnu : ${format}` }, 400);
});


/**
 * Régions et châteaux de Westeros, pour l'autocomplétion du champ « Lieu ».
 *
 * Fichier de référence, jamais modifié par l'application. En local il est lu
 * une fois sur le disque ; ici il est **embarqué dans le Worker** — 16 Ko qui
 * évitent une requête et un cas d'erreur.
 */
routesDomaine.get('/lieux', (c) => c.json(lieuxWesteros));

/* --------------------------------------------------------------------------
 * Ce que la santé sait dire du monde ouvert
 * -------------------------------------------------------------------------- */

export async function santeDuMonde(
  base: D1Database,
  utilisateurId: string,
  active: string | null
): Promise<Objet | null> {
  const fiche = await sauvegardeActive(base, utilisateurId, active);
  if (!fiche) return null;

  const ligne = await base
    .prepare('SELECT donnees FROM contenus WHERE sauvegarde_id = ?')
    .bind(fiche.id)
    .first<{ donnees: string }>();
  if (!ligne) return null;

  const dataset = Dataset.depuisDict(JSON.parse(ligne.donnees) as Objet);
  return {
    sauvegarde: fiche.nom,
    univers: dataset.meta.titre ?? '',
    personnes: dataset.personnes.length,
    relations: dataset.relations.length,
    vues: registre.toutes().map((vue) => vue.id),
    incoherences: dataset.incoherences(),
  };
}
