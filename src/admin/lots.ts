/**
 * Les lots : un même geste posé sur les sauvegardes de plusieurs comptes.
 *
 * **Pourquoi ça existe.** Depuis le lot 9, tout le monde part du même monde —
 * « Westeros », les mêmes 67 fiches, les mêmes identifiants. Une table qui joue
 * à six a donc six arbres qui se ressemblent, et le maître de jeu doit pouvoir
 * y poser la même maison, le même lien, la même date sans les rouvrir un par
 * un. La procuration du lot 8.F ouvre *un* arbre ; celle-ci en sert plusieurs.
 *
 * **Ce qui n'a pas bougé, et ne bougera pas.**
 *
 * - **On écrit par `ecrireDocument`, et par nulle part ailleurs.** Un lot de N
 *   sauvegardes, ce sont N appels au point d'écriture unique — pas un `UPDATE`
 *   en masse qui court-circuiterait les compteurs, les portraits et le plafond.
 * - **Le plafond est celui du propriétaire**, jamais celui de l'administrateur.
 *   Un compte serré refuse le lot ; les autres passent quand même.
 * - **Chaque sauvegarde réellement écrite laisse une ligne au journal.** Un lot
 *   silencieux serait pire qu'une édition manuelle : il en cache dix.
 *
 * **Et une règle propre aux lots : ils sont idempotents.** L'identifiant de ce
 * qu'on pose est calculé **une fois pour tout le lot**, à partir du nom, puis
 * réutilisé tel quel dans chaque sauvegarde. Une maison « Tully » posée deux
 * fois met à jour la première au lieu de fabriquer un « tully-2 » chez les
 * comptes déjà servis. C'est ce qui rend un lot rejouable — donc rattrapable.
 */

import * as filtres from '../domaine/filtres';
import { appliquerMeta } from '../domaine/meta';
import { Dataset, Personne, Relation, slugifier, type Objet } from '../domaine/models';
import { normaliser as normaliserPortrait } from '../domaine/portraits';
import * as referentiels from '../domaine/referentiels';
import { ErreurReferentiel } from '../domaine/referentiels';
import { ErreurPlafond, ecrireDocument, type Fiche } from '../sauvegardes/depot';
import { journaliser } from './journal';

/**
 * Combien de sauvegardes un seul lot peut toucher.
 *
 * Ce n'est pas une politique de produit, c'est la limite du Worker : chaque
 * sauvegarde coûte une lecture et une écriture, et une requête qui en
 * enchaînerait mille serait coupée en plein milieu — donc appliquée à moitié.
 * Mieux vaut refuser franchement et faire restreindre la sélection.
 */
export const MAX_SAUVEGARDES = 100;

/** Combien de comptes peuvent être nommés dans une sélection. */
export const MAX_COMPTES = 200;

export type Portee = 'toutes' | 'active';

/** Une sauvegarde visée, avec ce qu'il faut pour l'écrire au nom des siens. */
export interface Cible {
  fiche: Fiche;
  utilisateurId: string;
  email: string;
  role: string;
  plafondOctets: number;
  donnees: string | null;
}

export type Etat = 'cree' | 'mis_a_jour' | 'inchange' | 'refuse';

export interface Detail {
  compte_id: string;
  compte: string;
  sauvegarde_id: string;
  sauvegarde: string;
  etat: Etat;
  quoi: string;
  message?: string;
}

export interface Resultat {
  simulation: boolean;
  operation: string;
  resume: {
    comptes: number;
    sauvegardes: number;
    creees: number;
    mises_a_jour: number;
    inchangees: number;
    refusees: number;
  };
  details: Detail[];
}

/* --------------------------------------------------------------------------
 * Résoudre la sélection
 * -------------------------------------------------------------------------- */

interface LigneCible {
  id: string;
  nom: string;
  schema_version: number;
  personnes: number;
  relations: number;
  taille: number;
  revision: number;
  cree_le: number;
  modifie_le: number;
  utilisateur_id: string;
  email: string;
  role: string;
  plafond_octets: number;
  sauvegarde_active: string | null;
  donnees: string | null;
}

/**
 * Les sauvegardes visées par une sélection de comptes.
 *
 * `toutes` prend tout ce que le compte possède ; `active` ne prend que celle
 * qu'il a ouverte — avec le même repli que `sauvegardeActive` (la plus
 * récemment modifiée) mais **sans l'écrire** : un aperçu ne doit rien changer,
 * pas même une colonne de confort.
 */
export async function resoudreCibles(
  base: D1Database,
  comptes: string[],
  portee: Portee
): Promise<Cible[]> {
  if (!comptes.length) return [];

  const trous = comptes.map(() => '?').join(',');
  const { results } = await base
    .prepare(
      `SELECT s.id, s.nom, s.schema_version, s.personnes, s.relations, s.taille,
              s.revision, s.cree_le, s.modifie_le, s.utilisateur_id,
              u.email, u.role, u.plafond_octets, u.sauvegarde_active,
              c.donnees
         FROM sauvegardes s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
         LEFT JOIN contenus c ON c.sauvegarde_id = s.id
        WHERE s.utilisateur_id IN (${trous})
        ORDER BY u.email, s.modifie_le DESC`
    )
    .bind(...comptes)
    .all<LigneCible>();

  const retenues = portee === 'active' ? uneParCompte(results) : results;
  return retenues.map((ligne) => ({
    fiche: {
      id: ligne.id,
      nom: ligne.nom,
      schema_version: ligne.schema_version,
      personnes: ligne.personnes,
      relations: ligne.relations,
      taille: ligne.taille,
      revision: ligne.revision,
      cree_le: ligne.cree_le,
      modifie_le: ligne.modifie_le,
    },
    utilisateurId: ligne.utilisateur_id,
    email: ligne.email,
    role: ligne.role,
    plafondOctets: ligne.plafond_octets,
    donnees: ligne.donnees,
  }));
}

/** Celle que le compte a ouverte, ou à défaut la plus récemment modifiée. */
function uneParCompte(lignes: LigneCible[]): LigneCible[] {
  const parCompte = new Map<string, LigneCible>();
  for (const ligne of lignes) {
    const tenante = parCompte.get(ligne.utilisateur_id);
    if (!tenante) {
      parCompte.set(ligne.utilisateur_id, ligne);
      continue;
    }
    // La requête est déjà triée par date décroissante : seule l'active peut
    // encore détrôner celle qu'on tient.
    if (ligne.id === ligne.sauvegarde_active) parCompte.set(ligne.utilisateur_id, ligne);
  }
  return [...parCompte.values()];
}

/* --------------------------------------------------------------------------
 * Les opérations
 * -------------------------------------------------------------------------- */

/** Ce qu'une opération a fait à *un* dataset. */
interface Effet {
  etat: 'cree' | 'mis_a_jour' | 'inchange';
  quoi: string;
}

/**
 * Les quatre catalogues qui vivent sous la même forme — un dictionnaire d'id
 * vers une fiche, et une fonction qui fusionne un patch. Les traiter ensemble
 * évite quatre copies de la même vingtaine de lignes.
 */
const CATALOGUES: Record<
  string,
  {
    champ: 'maisons' | 'types_relations' | 'categories' | 'filtres';
    nom: string;
    replis: string;
    appliquer: (base: Objet | null, patch: Objet, rang: number) => Objet;
  }
> = {
  maison: {
    champ: 'maisons',
    nom: 'maison',
    replis: 'maison',
    appliquer: (base, patch) => referentiels.appliquerMaison(base, patch),
  },
  'type-relation': {
    champ: 'types_relations',
    nom: 'type de lien',
    replis: 'type',
    appliquer: (base, patch) => referentiels.appliquerType(base, patch),
  },
  categorie: {
    champ: 'categories',
    nom: 'catégorie',
    replis: 'categorie',
    appliquer: (base, patch, rang) => referentiels.appliquerCategorie(base, patch, rang),
  },
  filtre: {
    champ: 'filtres',
    nom: 'filtre',
    replis: 'filtre',
    appliquer: (base, patch, rang) => filtres.appliquerFiltre(base, patch, rang),
  },
};

export const TYPES_OPERATION = ['meta', ...Object.keys(CATALOGUES), 'personne', 'relation'];

/**
 * L'identifiant que le lot posera **dans chaque sauvegarde**.
 *
 * Calculé une seule fois, avant la boucle : c'est toute la différence entre un
 * lot rejouable et un lot qui empile des doublons. Un identifiant fourni à la
 * main l'emporte — c'est ainsi qu'on vise une maison qui existe déjà partout.
 */
export function identifiantDuLot(operation: Objet): string {
  const donne = String(operation.id ?? '').trim();
  if (donne) return slugifier(donne, 'element');

  const type = String(operation.type ?? '');
  if (type === 'personne') {
    return slugifier(`${operation.prenom ?? ''} ${operation.nom ?? ''}`, 'personne');
  }
  if (type === 'relation') {
    return slugifier(
      `${operation.source ?? ''}-${operation.type_lien ?? 'autre'}-${operation.cible ?? ''}`,
      'lien'
    );
  }
  const catalogue = CATALOGUES[type];
  return slugifier(String(operation.label ?? ''), catalogue ? catalogue.replis : 'element');
}

/**
 * Applique l'opération à un dataset. Lève `ErreurReferentiel` pour tout refus
 * dont l'utilisateur doit connaître la raison.
 */
function appliquerOperation(dataset: Dataset, operation: Objet, identifiant: string): Effet {
  const type = String(operation.type ?? '');

  if (type === 'meta') {
    const avant = JSON.stringify(dataset.meta);
    if (!appliquerMeta(dataset.meta, operation).length) {
      throw new ErreurReferentiel(
        'rien à modifier : « annee_courante » et « document » sont les seules clés'
      );
    }
    const apres = JSON.stringify(dataset.meta);
    return {
      etat: avant === apres ? 'inchange' : 'mis_a_jour',
      quoi: decrireMeta(operation),
    };
  }

  const catalogue = CATALOGUES[type];
  if (catalogue) {
    const registre = dataset[catalogue.champ];
    const existante = Object.hasOwn(registre, identifiant) ? (registre[identifiant] as Objet) : null;
    const avant = existante ? JSON.stringify(existante) : null;

    const fiche = catalogue.appliquer(existante, sansMeta(operation), Object.keys(registre).length);
    registre[identifiant] = fiche;

    const quoi = `${catalogue.nom} « ${fiche.label} »`;
    if (avant === null) return { etat: 'cree', quoi };
    return { etat: avant === JSON.stringify(fiche) ? 'inchange' : 'mis_a_jour', quoi };
  }

  if (type === 'personne') return appliquerPersonne(dataset, operation, identifiant);
  if (type === 'relation') return appliquerRelation(dataset, operation, identifiant);

  throw new ErreurReferentiel(
    `opération inconnue : ${type} (${TYPES_OPERATION.join(', ')})`
  );
}

function decrireMeta(operation: Objet): string {
  const morceaux: string[] = [];
  if (Object.hasOwn(operation, 'annee_courante')) {
    const valeur = operation.annee_courante;
    morceaux.push(valeur ? `année « ${valeur} »` : 'année effacée');
  }
  if (Object.hasOwn(operation, 'document')) {
    morceaux.push(operation.document ? 'lien de campagne posé' : 'lien de campagne effacé');
  }
  return morceaux.join(', ');
}

/** Le corps de l'opération, sans les clés d'aiguillage. */
function sansMeta(operation: Objet): Objet {
  const { type: _type, id: _id, portee: _portee, comptes: _comptes, ...reste } = operation;
  return reste;
}

function appliquerPersonne(dataset: Dataset, operation: Objet, identifiant: string): Effet {
  const donnees = sansMeta(operation);
  if (Object.hasOwn(donnees, 'avatar')) donnees.avatar = normaliserPortrait(donnees.avatar);

  const existante = dataset.personne(identifiant);
  if (existante) {
    const change = existante.appliquerPatch(donnees).length > 0;
    return {
      etat: change ? 'mis_a_jour' : 'inchange',
      quoi: `fiche « ${existante.nomComplet} »`,
    };
  }

  const personne = Personne.depuisDict({ ...donnees, id: identifiant });
  dataset.personnes.push(personne);
  dataset.oublierIndex();
  return { etat: 'cree', quoi: `fiche « ${personne.nomComplet} »` };
}

function appliquerRelation(dataset: Dataset, operation: Objet, identifiant: string): Effet {
  const donnees = sansMeta(operation);
  // `type` porte déjà l'aiguillage du lot ; le type du lien voyage à côté.
  if (Object.hasOwn(donnees, 'type_lien')) {
    donnees.type = donnees.type_lien;
    delete donnees.type_lien;
  }

  const existante = dataset.relation(identifiant);
  if (existante) {
    const change = existante.appliquerPatch(donnees).length > 0;
    return { etat: change ? 'mis_a_jour' : 'inchange', quoi: `lien « ${identifiant} »` };
  }

  // Un lien ne se pose qu'entre deux fiches présentes *dans cette
  // sauvegarde-là* : les comptes partent du même monde, mais rien ne les
  // empêche d'y avoir supprimé quelqu'un.
  const source = String(donnees.source ?? '');
  const cible = String(donnees.cible ?? '');
  if (!dataset.personne(source)) {
    throw new ErreurReferentiel(`la fiche « ${source} » n'existe pas dans cette sauvegarde`);
  }
  if (!dataset.personne(cible)) {
    throw new ErreurReferentiel(`la fiche « ${cible} » n'existe pas dans cette sauvegarde`);
  }

  const relation = Relation.depuisDict({ ...donnees, id: identifiant });
  dataset.relations.push(relation);
  return { etat: 'cree', quoi: `lien « ${identifiant} »` };
}

/* --------------------------------------------------------------------------
 * Appliquer
 * -------------------------------------------------------------------------- */

/**
 * Le lot lui-même.
 *
 * `simulation` ne prend aucun autre chemin : c'est la **même** application sur
 * les mêmes données, à laquelle on retire l'écriture et le journal. Un aperçu
 * qui emprunterait un raccourci ne prédirait pas ce que fera l'application.
 *
 * Un refus n'arrête pas le lot : un compte au plafond, une fiche absente, une
 * couleur illisible — on le note et on continue. Le rapport dit ensuite qui est
 * passé et qui ne l'est pas.
 */
export async function appliquerLot(
  base: D1Database,
  adminId: string,
  cibles: Cible[],
  operation: Objet,
  simulation: boolean
): Promise<Resultat> {
  const identifiant = identifiantDuLot(operation);
  const details: Detail[] = [];
  const comptes = new Set<string>();

  for (const cible of cibles) {
    comptes.add(cible.utilisateurId);
    const base_detail = {
      compte_id: cible.utilisateurId,
      compte: cible.email || `essai ${cible.utilisateurId.slice(0, 8)}`,
      sauvegarde_id: cible.fiche.id,
      sauvegarde: cible.fiche.nom,
    };

    if (!cible.donnees) {
      details.push({
        ...base_detail,
        etat: 'refuse',
        quoi: '',
        message: 'contenu introuvable — sauvegarde vide en base',
      });
      continue;
    }

    try {
      const dataset = Dataset.depuisDict(JSON.parse(cible.donnees) as Objet);
      const effet = appliquerOperation(dataset, operation, identifiant);

      if (effet.etat !== 'inchange' && !simulation) {
        dataset.oublierIndex();
        await ecrireDocument(
          base,
          cible.utilisateurId,
          cible.fiche,
          dataset.versDict(),
          cible.plafondOctets
        );
        // Même règle que la procuration : on n'inscrit pas l'administrateur
        // qui écrit chez lui-même.
        if (adminId !== cible.utilisateurId) {
          await journaliser(base, adminId, 'edition', cible.utilisateurId, cible.fiche.id);
        }
      }

      details.push({ ...base_detail, etat: effet.etat, quoi: effet.quoi });
    } catch (erreur) {
      details.push({
        ...base_detail,
        etat: 'refuse',
        quoi: '',
        message:
          erreur instanceof ErreurReferentiel || erreur instanceof ErreurPlafond
            ? erreur.message
            : 'sauvegarde illisible',
      });
    }
  }

  const compter = (etat: Etat) => details.filter((d) => d.etat === etat).length;
  return {
    simulation,
    operation: String(operation.type ?? ''),
    resume: {
      comptes: comptes.size,
      sauvegardes: details.length,
      creees: compter('cree'),
      mises_a_jour: compter('mis_a_jour'),
      inchangees: compter('inchange'),
      refusees: compter('refuse'),
    },
    details,
  };
}

/* --------------------------------------------------------------------------
 * Comment les comptes ont structuré leurs vues
 * -------------------------------------------------------------------------- */

interface Nomme {
  id: string;
  label: string;
}

export interface FicheCompte {
  compte_id: string;
  compte: string;
  role: string;
  sauvegardes: number;
  personnes: number;
  relations: number;
  annee: string;
  document: boolean;
  maisons: Nomme[];
  categories: Nomme[];
  types: Nomme[];
  filtres: Nomme[];
  listes: Nomme[];
}

export interface Panorama {
  comptes: FicheCompte[];
  /** Présent chez **tous** les comptes de la sélection — le terrain d'entente. */
  commun: Record<string, Nomme[]>;
  /** Présent chez certains seulement : c'est là que les tables divergent. */
  divergent: Record<string, (Nomme & { comptes: number })[]>;
}

const AXES = ['maisons', 'categories', 'types', 'filtres', 'listes'] as const;

/**
 * Ce que les comptes ont fait de leur monde, mis côte à côte.
 *
 * L'intérêt n'est pas la liste : c'est la séparation entre **ce que tout le
 * monde a** — sur quoi un lot de groupe a du sens — et **ce qui n'appartient
 * qu'à certains**, qu'un lot écraserait sans le dire.
 */
export function panorama(cibles: Cible[]): Panorama {
  const parCompte = new Map<string, FicheCompte>();

  for (const cible of cibles) {
    let fiche = parCompte.get(cible.utilisateurId);
    if (!fiche) {
      fiche = {
        compte_id: cible.utilisateurId,
        compte: cible.email || `essai ${cible.utilisateurId.slice(0, 8)}`,
        role: cible.role,
        sauvegardes: 0,
        personnes: 0,
        relations: 0,
        annee: '',
        document: false,
        maisons: [],
        categories: [],
        types: [],
        filtres: [],
        listes: [],
      };
      parCompte.set(cible.utilisateurId, fiche);
    }

    fiche.sauvegardes += 1;
    fiche.personnes += cible.fiche.personnes;
    fiche.relations += cible.fiche.relations;
    if (!cible.donnees) continue;

    let dataset: Dataset;
    try {
      dataset = Dataset.depuisDict(JSON.parse(cible.donnees) as Objet);
    } catch {
      continue; // une sauvegarde illisible ne doit pas emporter le panorama
    }

    if (!fiche.annee) fiche.annee = String(dataset.meta.annee_courante ?? '');
    if (dataset.meta.document) fiche.document = true;

    fusionner(fiche.maisons, dataset.maisons);
    fusionner(fiche.categories, dataset.categories);
    fusionner(fiche.types, dataset.types_relations);
    fusionner(fiche.filtres, dataset.filtres);
    fusionner(fiche.listes, dataset.listes);
  }

  const comptes = [...parCompte.values()].sort((a, b) => a.compte.localeCompare(b.compte));
  const commun: Record<string, Nomme[]> = {};
  const divergent: Record<string, (Nomme & { comptes: number })[]> = {};

  for (const axe of AXES) {
    const combien = new Map<string, { entree: Nomme; comptes: number }>();
    for (const compte of comptes) {
      for (const entree of compte[axe]) {
        const vu = combien.get(entree.id);
        if (vu) vu.comptes += 1;
        else combien.set(entree.id, { entree, comptes: 1 });
      }
    }

    const partages: Nomme[] = [];
    const propres: (Nomme & { comptes: number })[] = [];
    for (const { entree, comptes: combienDeComptes } of combien.values()) {
      if (comptes.length && combienDeComptes === comptes.length) partages.push(entree);
      else propres.push({ ...entree, comptes: combienDeComptes });
    }

    partages.sort((a, b) => a.label.localeCompare(b.label));
    propres.sort((a, b) => b.comptes - a.comptes || a.label.localeCompare(b.label));
    commun[axe] = partages;
    divergent[axe] = propres;
  }

  return { comptes, commun, divergent };
}

/* --------------------------------------------------------------------------
 * Le rapprochement des fiches
 * -------------------------------------------------------------------------- */

/**
 * Une écriture d'une même personne : son identifiant, et qui la porte ainsi.
 */
export interface Variante {
  id: string;
  label: string;
  prenom: string;
  nom: string;
  maison: string;
  /** Les comptes dont l'arbre contient **cette** écriture-là. */
  comptes: string[];
}

export interface GroupeFiches {
  /** Ce qui rapproche les variantes : un nom normalisé, ou un identifiant. */
  cle: string;
  /** La forme la plus répandue, celle qu'on montre. */
  label: string;
  /** Combien de comptes distincts, toutes variantes confondues. */
  comptes: number;
  variantes: Variante[];
}

export interface Rapprochement {
  /** Même nom, identifiants différents : deux fiches pour une personne. */
  a_unifier: GroupeFiches[];
  /** Même identifiant, noms différents : quelqu'un a renommé dans son coin. */
  renommees: GroupeFiches[];
  /** Présentes chez plusieurs comptes, et déjà d'accord. */
  alignees: number;
  /** Présentes chez un seul compte : rien à rapprocher. */
  propres: number;
}

/**
 * Le nom réduit à ce qui permet de reconnaître quelqu'un.
 *
 * Accents dépliés, casse effacée, ponctuation retirée, espaces resserrés.
 * « Jon Snow », « jon snow » et « Jon  Snow » se rejoignent ; « Jon Snow » et
 * « Jon Snow le Bâtard » restent séparés — et c'est voulu. Un rapprochement
 * approximatif qui réunit deux personnages différents coûte plus cher que celui
 * qu'il fait gagner : c'est une fiche écrasée dans l'arbre de quelqu'un.
 */
function normaliserNom(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Les fiches que plusieurs comptes ont écrites chacun de leur côté.
 *
 * **Le besoin.** Une table à six joue le même monde dans six arbres. Le même
 * personnage y est créé six fois, et rien ne garantit qu'il porte six fois le
 * même identifiant : il suffit qu'un joueur ait tapé « Petyr Baelish » là où un
 * autre a mis « Petyr Baelish » avec un titre, et les deux fiches ne se
 * reconnaîtront plus jamais. Le maître de jeu voit alors des divergences là où
 * il n'y a qu'une orthographe.
 *
 * On sépare donc deux accidents, qui n'appellent pas le même geste :
 *
 * - **`a_unifier`** — un même nom sous plusieurs identifiants. C'est ce qu'on
 *   corrige en posant une fiche de référence à tout le monde… **quand c'est
 *   bien la même personne**. Ce n'est pas toujours vrai, et le rapprochement ne
 *   peut pas le savoir : dans le monde livré avec l'application, « Brandon
 *   Stark » désigne deux personnages — `brandon-stark-aine`, le frère d'Eddard,
 *   et `bran-stark`, son fils. On signale, on ne conclut pas, et l'interface
 *   dit cet exemple-là plutôt que de laisser croire à une liste de doublons.
 * - **`renommees`** — un même identifiant sous plusieurs noms. Là, personne
 *   n'est en double : quelqu'un a renommé sa fiche, et c'est peut-être exprès.
 *   On le montre, on ne propose rien.
 *
 * **Ce que cette lecture ne fait pas** : elle ne fusionne rien. Poser une fiche
 * de référence *ajoute ou met à jour* — elle ne supprime pas le doublon dans
 * l'arbre où il vit, et ne rebranche pas ses liens. Ce serait une opération
 * destructive à travers plusieurs comptes ; elle mérite son propre lot, avec
 * son propre aperçu.
 */
export function rapprochement(cibles: Cible[]): Rapprochement {
  /** cle normalisée → id de variante → variante, avec ses comptes. */
  const parNom = new Map<string, Map<string, Variante>>();
  /** id → cle normalisée → variante : la lecture inverse, pour les renommages. */
  const parId = new Map<string, Map<string, Variante>>();

  const ranger = (
    index: Map<string, Map<string, Variante>>,
    cle: string,
    sousCle: string,
    fabriquer: () => Variante,
    compte: string
  ) => {
    let groupe = index.get(cle);
    if (!groupe) index.set(cle, (groupe = new Map()));
    let variante = groupe.get(sousCle);
    if (!variante) groupe.set(sousCle, (variante = fabriquer()));
    if (!variante.comptes.includes(compte)) variante.comptes.push(compte);
  };

  for (const cible of cibles) {
    if (!cible.donnees) continue;
    let dataset: Dataset;
    try {
      dataset = Dataset.depuisDict(JSON.parse(cible.donnees) as Objet);
    } catch {
      continue; // une sauvegarde illisible ne doit pas emporter le relevé
    }
    const compte = cible.email || `essai ${cible.utilisateurId.slice(0, 8)}`;

    for (const personne of Object.values(dataset.personnes)) {
      const label = personne.nomComplet;
      const cle = normaliserNom(label);
      if (!cle) continue;
      const fabriquer = (): Variante => ({
        id: personne.id,
        label,
        prenom: personne.prenom,
        nom: personne.nom,
        maison: personne.maison,
        comptes: [],
      });
      ranger(parNom, cle, personne.id, fabriquer, compte);
      ranger(parId, personne.id, cle, fabriquer, compte);
    }
  }

  const rassembler = (index: Map<string, Map<string, Variante>>): GroupeFiches[] =>
    [...index.entries()]
      .filter(([, variantes]) => variantes.size > 1)
      .map(([cle, variantes]) => {
        const liste = [...variantes.values()].sort(
          (a, b) => b.comptes.length - a.comptes.length || a.label.localeCompare(b.label)
        );
        const comptes = new Set(liste.flatMap((variante) => variante.comptes));
        // Le libellé du groupe est celui de la variante la plus portée : c'est
        // la graphie de la table, et non la première rencontrée par hasard.
        return { cle, label: liste[0]?.label ?? cle, comptes: comptes.size, variantes: liste };
      })
      // D'abord ce qui touche le plus de monde : c'est là qu'un lot sert le plus.
      .sort((a, b) => b.comptes - a.comptes || a.label.localeCompare(b.label));

  let alignees = 0;
  let propres = 0;
  for (const variantes of parNom.values()) {
    if (variantes.size > 1) continue;
    const seule = [...variantes.values()][0];
    if (!seule) continue;
    if (seule.comptes.length > 1) alignees += 1;
    else propres += 1;
  }

  return {
    a_unifier: rassembler(parNom),
    renommees: rassembler(parId),
    alignees,
    propres,
  };
}

/** Ajoute les entrées d'un catalogue à la liste d'un compte, sans doublon. */
function fusionner(liste: Nomme[], catalogue: Record<string, Objet>): void {
  const connus = new Set(liste.map((entree) => entree.id));
  for (const [id, fiche] of Object.entries(catalogue)) {
    if (connus.has(id)) continue;
    connus.add(id);
    liste.push({ id, label: String(fiche?.label ?? id) });
  }
}
