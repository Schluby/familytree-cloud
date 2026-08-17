/**
 * Référentiels éditables — port de `backend/referentiels.py`.
 *
 * Deux catalogues, mêmes règles. Une personne porte l'*id* de sa maison, une
 * relation porte l'*id* de son type : cet id ne change donc jamais après la
 * création. Renommer, c'est changer le libellé affiché, pas la clé — sinon
 * toutes les fiches qui s'y réfèrent tomberaient dans le vide.
 *
 * Ce module ne fait que valider et normaliser ; les écritures sont dans les
 * routes, qui seules touchent au document.
 */

import { arrondir, versEntier } from './python';
import type { Objet } from './models';

/** Styles de trait honorés par le moteur de rendu (`web/js/views/cartes.js`). */
export const STYLES: Record<string, string> = {
  solide: 'Trait plein',
  tirets: 'Tirets',
  pointille: 'Pointillé',
};

/** Les catégories servent au regroupement dans les menus et la fiche. */
export const CATEGORIES: Record<string, string> = {
  famille: 'Sang & alliances',
  social: 'Liens sociaux',
  politique: 'Liens politiques',
  // Ajoutée au lot 8 : ce qui *a eu lieu* — une bataille, un siège, un serment
  // rompu. Ce ne sont pas des relations entre deux personnes, mais des faits
  // qui les ont mises en présence, et on veut pouvoir les éteindre d'un bloc.
  historique: 'Événements passés',
  autre: 'Autres liens',
};

/**
 * Types dont la sémantique est câblée dans la mise en page : la filiation
 * construit les générations, l'union dessine la barre de couple, la fratrie est
 * déduite des parents communs. On peut les renommer, les recolorer, les
 * restyler — pas les supprimer.
 */
export const TYPES_STRUCTURANTS = ['parent', 'conjoint', 'amant', 'fratrie'] as const;

export const COULEUR_MAISON_DEFAUT = '#7a7f87';
export const COULEUR_TYPE_DEFAUT = '#8a8f98';
export const COULEUR_JOUEUR_DEFAUT = '#7a7f87';

const COULEUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Refus explicite, affichable tel quel dans l'interface. */
export class ErreurReferentiel extends Error {}

/* --------------------------------------------------------------------------
 * Briques de validation
 * -------------------------------------------------------------------------- */

export function normaliserCouleur(brut: unknown, defaut: string): string {
  let texte = String(brut || '').trim();
  if (!texte) return defaut;
  if (!COULEUR.test(texte)) {
    throw new ErreurReferentiel(`couleur invalide : ${texte} (attendu #rrggbb)`);
  }
  if (texte.length === 4) {
    // #abc -> #aabbcc, pour n'avoir qu'une seule forme en base.
    texte = '#' + [...texte.slice(1)].map((c) => c + c).join('');
  }
  return texte.toLowerCase();
}

/** `str(brut if brut is not None else "").strip()[:maximum]`, à la lettre. */
function texte(brut: unknown, maximum = 120): string {
  return String(brut === null || brut === undefined ? '' : brut)
    .trim()
    .slice(0, maximum);
}

function ordre(brut: unknown, defaut = 0): number {
  return versEntier(brut) ?? defaut;
}

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** `"cle" in patch` — propriété propre uniquement (le patch vient du réseau). */
function fourni(patch: Objet, cle: string): boolean {
  return Object.hasOwn(patch, cle);
}

/** `dict(base or {})` : une base vide compte comme absente, comme en Python. */
function partirDe(base: Objet | null | undefined): { fiche: Objet; neuve: boolean } {
  const neuve = !base || Object.keys(base).length === 0;
  return { fiche: { ...(base ?? {}) }, neuve };
}

function choisir(patch: Objet, cle: string, courant: unknown): unknown {
  return fourni(patch, cle) ? patch[cle] : courant;
}

/* --------------------------------------------------------------------------
 * Maisons
 * -------------------------------------------------------------------------- */

export const CHAMPS_MAISON = [
  'label',
  'couleur',
  'devise',
  'categorie',
  'ordre',
  // Lot 8.E : ce qui fait une maison au-delà de sa couleur.
  'caracteristiques',
  'notes',
  'evenements',
  'liens',
  // Lot 20.E : ce qu'elle peut mettre sur le champ de bataille.
  'unites',
] as const;

/**
 * Les ressources d'une maison, telles que les compte le JDR *Le Trône de Fer*
 * (Green Ronin) : sept scores, tirés à la création puis dépensés et regagnés
 * en jeu.
 *
 * Elles sont **câblées ici mais pas obligatoires** : une maison qui n'en a
 * aucune n'écrit rien dans la sauvegarde, et une table qui joue avec d'autres
 * règles peut laisser le bloc vide et n'utiliser que les notes. Les bornes
 * (0-100) sont larges exprès — le manuel plafonne certains scores plus bas,
 * mais une campagne qui gonfle une maison n'a pas à se battre avec sa fiche.
 */
export const CARACTERISTIQUES_MAISON = [
  { id: 'defense', label: 'Défense', aide: 'Fortifications, garnisons, terrain' },
  { id: 'influence', label: 'Influence', aide: 'Rang, titres, poids à la cour' },
  { id: 'terres', label: 'Terres', aide: 'Étendue et qualité du domaine' },
  { id: 'loi', label: 'Loi', aide: 'Ordre public, justice, brigandage' },
  { id: 'population', label: 'Population', aide: 'Habitants, main-d’œuvre, recrues' },
  { id: 'pouvoir', label: 'Pouvoir', aide: 'Forces armées mobilisables' },
  { id: 'richesse', label: 'Richesse', aide: 'Revenus, réserves, commerce' },
] as const;

const IDS_CARACTERISTIQUES = new Set(CARACTERISTIQUES_MAISON.map((c) => c.id) as string[]);

/* --------------------------------------------------------------------------
 * Unités de guerre (lot 20.E)
 *
 * Les caractéristiques ci-dessus disent ce qu'une maison *possède* ; les unités
 * disent ce qu'elle peut *envoyer*. Deux choses différentes, et la seconde
 * change de séance en séance : une unité se désorganise, se met en déroute,
 * disparaît — d'où l'état, qui est le champ qu'on touche le plus souvent.
 *
 * Les deux listes fermées sont déclarées ici et **descendues au front** par la
 * vue « Maisons » : le navigateur ne recopie aucun de ces mots, et en ajouter
 * un se fait sur une ligne, d'un seul côté.
 * -------------------------------------------------------------------------- */

export const ETATS_UNITE = [
  { id: 'active', label: 'Active' },
  { id: 'desorganisee', label: 'Désorganisée' },
  { id: 'en_deroute', label: 'En déroute' },
  { id: 'detruite', label: 'Détruite' },
] as const;

export const ENTRAINEMENTS_UNITE = [
  { id: 'bleus', label: 'Bleus' },
  { id: 'entrainee', label: 'Entraînée' },
  { id: 'veterans', label: 'Vétérans' },
  { id: 'elite', label: 'Élite' },
] as const;

const IDS_ETATS = new Set(ETATS_UNITE.map((e) => e.id) as string[]);
const IDS_ENTRAINEMENTS = new Set(ENTRAINEMENTS_UNITE.map((e) => e.id) as string[]);

/** Un pourcentage, borné à 0-100. Vide reste vide : « on n'a pas noté ». */
function pourcentage(brut: unknown): number | null {
  if (brut === null || brut === undefined || brut === '') return null;
  const entier = versEntier(brut);
  if (entier === null) return null;
  return Math.max(0, Math.min(100, entier));
}

/**
 * Les unités d'une maison.
 *
 * Une valeur hors liste retombe sur la première entrée plutôt que d'être
 * refusée : une unité qu'on vient de créer n'a pas d'état, et « Active » est ce
 * qu'on veut dire en la créant. Le plafond de 60 est là pour la même raison que
 * partout ailleurs — une sauvegarde est un document JSON, pas une base.
 */
function unites(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(estObjet)
    .slice(0, 60)
    .map((entree) => {
      const etat = texte(entree.etat, 40);
      const entrainement = texte(entree.entrainement, 40);
      return {
        nom: texte(entree.nom, 120),
        type: texte(entree.type, 120),
        etat: IDS_ETATS.has(etat) ? etat : 'active',
        entrainement: IDS_ENTRAINEMENTS.has(entrainement) ? entrainement : 'entrainee',
        defense: pourcentage(entree.defense),
        sante: pourcentage(entree.sante),
        attaque: versEntier(entree.attaque),
        arme: texte(entree.arme, 120),
        equipement: texte(entree.equipement, 160),
        notes: texte(entree.notes, 4000),
      };
    })
    // Une unité sans nom ni type n'est rien : c'est une ligne ajoutée puis
    // abandonnée, et la garder encombrerait la fiche à chaque ouverture.
    .filter((entree) => entree.nom || entree.type);
}

/**
 * Les scores. Une caractéristique absente reste absente : `{}` est un état
 * légitime (« on n'a pas encore tiré cette maison »), différent de tout à zéro.
 */
function caracteristiques(brut: unknown, courant: unknown): Objet {
  const base = estObjet(courant) ? { ...courant } : {};
  if (!estObjet(brut)) return base;
  for (const [cle, valeur] of Object.entries(brut)) {
    if (!IDS_CARACTERISTIQUES.has(cle)) continue;
    if (valeur === null || valeur === '') {
      delete base[cle];
      continue;
    }
    const entier = versEntier(valeur);
    if (entier === null) continue;
    base[cle] = Math.max(0, Math.min(100, entier));
  }
  return base;
}

/**
 * L'histoire d'une maison : des événements datés, chacun pouvant citer des
 * personnes. Ce sont ces citations qui deviennent des liens cliquables dans la
 * vue « Maisons ».
 */
function evenements(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(estObjet)
    .slice(0, 200)
    .map((entree) => ({
      annee: texte(entree.annee, 40),
      titre: texte(entree.titre, 160),
      texte: texte(entree.texte, 4000),
      lieu: texte(entree.lieu, 120),
      personnes: (Array.isArray(entree.personnes) ? entree.personnes : [])
        .map((id: unknown) => texte(id, 80))
        .filter(Boolean)
        .slice(0, 40),
    }))
    .filter((entree) => entree.titre || entree.texte);
}

/**
 * Les liens d'une maison vers une autre : vassalité, alliance, rivalité. Ils
 * réutilisent le catalogue des types de liens — un « vassal de » entre deux
 * maisons veut dire la même chose qu'entre deux personnes, et n'a pas besoin
 * d'un second catalogue à tenir à jour.
 */
function liensMaison(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const resultat: Objet[] = [];
  for (const entree of brut) {
    if (!estObjet(entree)) continue;
    const maison = texte(entree.maison, 80);
    const type = texte(entree.type, 80) || 'autre';
    if (!maison) continue;
    const cle = `${maison}|${type}`;
    if (vus.has(cle)) continue; // deux fois « vassal de X » ne dit rien de plus
    vus.add(cle);
    resultat.push({
      maison,
      type,
      label: texte(entree.label, 160),
      notes: texte(entree.notes, 2000),
      revolu: Boolean(entree.revolu),
    });
    if (resultat.length >= 60) break;
  }
  return resultat;
}

/**
 * Fusionne un patch dans une maison existante (ou en crée une).
 *
 * Les champs absents du patch sont conservés, les champs inconnus du référentiel
 * aussi : on ne perd jamais ce qu'on ne comprend pas.
 */
export function appliquerMaison(base: Objet | null, patch: Objet): Objet {
  const { fiche, neuve } = partirDe(base);

  if (fourni(patch, 'label') || neuve) {
    fiche.label = texte(choisir(patch, 'label', fiche.label));
  }
  if (fourni(patch, 'couleur') || neuve) {
    fiche.couleur = normaliserCouleur(
      choisir(patch, 'couleur', fiche.couleur),
      COULEUR_MAISON_DEFAUT
    );
  }
  if (fourni(patch, 'devise') || neuve) {
    fiche.devise = texte(choisir(patch, 'devise', fiche.devise), 200);
  }
  if (fourni(patch, 'categorie') || neuve) {
    // Vide = « sans catégorie », qui est un cas légitime, pas une erreur.
    fiche.categorie = texte(choisir(patch, 'categorie', fiche.categorie), 60);
  }
  if (fourni(patch, 'ordre')) {
    fiche.ordre = ordre(patch.ordre);
  }

  // Les quatre champs du lot 8.E ne s'écrivent **que** si on les fournit, et
  // ils disparaissent de la fiche quand ils sont vides : une maison qui ne s'en
  // sert pas ressort telle qu'elle est entrée.
  if (fourni(patch, 'caracteristiques')) {
    const scores = caracteristiques(patch.caracteristiques, fiche.caracteristiques);
    if (Object.keys(scores).length) fiche.caracteristiques = scores;
    else delete fiche.caracteristiques;
  }
  if (fourni(patch, 'notes')) {
    const valeur = texte(patch.notes, 8000);
    if (valeur) fiche.notes = valeur;
    else delete fiche.notes;
  }
  if (fourni(patch, 'evenements')) {
    const liste = evenements(patch.evenements);
    if (liste.length) fiche.evenements = liste;
    else delete fiche.evenements;
  }
  if (fourni(patch, 'liens')) {
    const liste = liensMaison(patch.liens);
    if (liste.length) fiche.liens = liste;
    else delete fiche.liens;
  }
  if (fourni(patch, 'unites')) {
    const liste = unites(patch.unites);
    if (liste.length) fiche.unites = liste;
    else delete fiche.unites;
  }

  if (!fiche.label) throw new ErreurReferentiel("une maison a besoin d'un nom");
  return fiche;
}

/* --------------------------------------------------------------------------
 * Types de liens
 * -------------------------------------------------------------------------- */

export const CHAMPS_TYPE = [
  'label',
  'label_sortant',
  'label_entrant',
  'couleur',
  'dirige',
  'style',
  'categorie',
  'ordre',
] as const;

export function appliquerType(base: Objet | null, patch: Objet): Objet {
  const { fiche, neuve } = partirDe(base);

  if (fourni(patch, 'label') || neuve) {
    fiche.label = texte(choisir(patch, 'label', fiche.label));
  }
  if (fourni(patch, 'couleur') || neuve) {
    fiche.couleur = normaliserCouleur(
      choisir(patch, 'couleur', fiche.couleur),
      COULEUR_TYPE_DEFAUT
    );
  }
  if (fourni(patch, 'dirige') || neuve) {
    fiche.dirige = Boolean(choisir(patch, 'dirige', fiche.dirige ?? false));
  }
  if (fourni(patch, 'style') || neuve) {
    const style = String(choisir(patch, 'style', fiche.style ?? 'solide') || 'solide').toLowerCase();
    if (!Object.hasOwn(STYLES, style)) {
      throw new ErreurReferentiel(`style inconnu : ${style} (${Object.keys(STYLES).join(', ')})`);
    }
    fiche.style = style;
  }
  if (fourni(patch, 'categorie') || neuve) {
    const categorie = String(
      choisir(patch, 'categorie', fiche.categorie ?? 'autre') || 'autre'
    ).toLowerCase();
    if (!Object.hasOwn(CATEGORIES, categorie)) {
      throw new ErreurReferentiel(
        `catégorie inconnue : ${categorie} (${Object.keys(CATEGORIES).join(', ')})`
      );
    }
    fiche.categorie = categorie;
  }
  if (fourni(patch, 'ordre')) {
    fiche.ordre = ordre(patch.ordre);
  }

  // Les libellés de sens n'ont de sens que sur un lien orienté : on les range
  // quand le lien l'est, on les efface quand il ne l'est plus.
  for (const champ of ['label_sortant', 'label_entrant'] as const) {
    if (fourni(patch, champ)) fiche[champ] = texte(patch[champ]);
  }
  if (!fiche.dirige) {
    delete fiche.label_sortant;
    delete fiche.label_entrant;
  }
  for (const champ of ['label_sortant', 'label_entrant'] as const) {
    if (Object.hasOwn(fiche, champ) && !fiche[champ]) delete fiche[champ];
  }

  if (!fiche.label) throw new ErreurReferentiel("un type de lien a besoin d'un nom");
  return fiche;
}

/* --------------------------------------------------------------------------
 * Catégories de maisons
 *
 * Une catégorie regroupe des maisons — « Grandes maisons », « Ordres »,
 * « Sauvageons »… C'est un axe de couleur et de filtre de plus, défini par
 * l'utilisateur. Sa couleur est proposée automatiquement (teintes réparties),
 * mais reste modifiable : l'automatique ne doit jamais empêcher de choisir.
 * -------------------------------------------------------------------------- */

export const CHAMPS_CATEGORIE = ['label', 'couleur', 'ordre'] as const;

/**
 * Teintes réparties sur la roue, saturation et clarté fixes : deux catégories
 * voisines se distinguent, et l'ensemble reste dans la même famille de tons.
 */
const TEINTES = [205, 25, 145, 275, 45, 175, 320, 95, 250, 15, 190, 300];

/** Couleur de catégorie n° `index`, en parcourant la roue des teintes. */
export function couleurAuto(index: number): string {
  const teinte = TEINTES[((index % TEINTES.length) + TEINTES.length) % TEINTES.length] as number;
  // Chaque tour de roue assombrit légèrement : douze catégories restent
  // distinctes, la treizième ne recommence pas exactement à la première.
  const tour = Math.floor(index / TEINTES.length);
  return hslVersHex(teinte, 0.42 - 0.05 * tour, 0.52 - 0.06 * tour);
}

function hslVersHex(teinte: number, saturationBrute: number, clarteBrute: number): string {
  const saturation = Math.max(0, Math.min(1, saturationBrute));
  const clarte = Math.max(0, Math.min(1, clarteBrute));
  const chroma = (1 - Math.abs(2 * clarte - 1)) * saturation;
  const secteur = (((teinte % 360) + 360) % 360) / 60;
  const seconde = chroma * (1 - Math.abs((secteur % 2) - 1));
  const quartier = Math.trunc(secteur);

  const roue: [number, number, number][] = [
    [chroma, seconde, 0],
    [seconde, chroma, 0],
    [0, chroma, seconde],
    [0, seconde, chroma],
    [seconde, 0, chroma],
    [chroma, 0, seconde],
  ];
  const rvb = roue[((quartier % 6) + 6) % 6] as [number, number, number];
  const decalage = clarte - chroma / 2;

  return (
    '#' +
    rvb
      .map((c) =>
        arrondir((c + decalage) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

export function appliquerCategorie(base: Objet | null, patch: Objet, rang = 0): Objet {
  const { fiche, neuve } = partirDe(base);

  if (fourni(patch, 'label') || neuve) {
    fiche.label = texte(choisir(patch, 'label', fiche.label));
  }
  if (fourni(patch, 'couleur') || neuve) {
    fiche.couleur = normaliserCouleur(choisir(patch, 'couleur', fiche.couleur), couleurAuto(rang));
  }
  if (fourni(patch, 'ordre')) {
    fiche.ordre = ordre(patch.ordre);
  }

  if (!fiche.label) throw new ErreurReferentiel("une catégorie a besoin d'un nom");
  return fiche;
}

/* --------------------------------------------------------------------------
 * Joueurs
 *
 * Un joueur n'est pas un personnage : c'est quelqu'un autour de la table. Son id
 * est la clé sous laquelle chaque fiche range l'humeur qu'on lui porte
 * (`personne.relations_joueurs`), et il ne bouge donc jamais non plus.
 * -------------------------------------------------------------------------- */

export const CHAMPS_JOUEUR = ['nom', 'personnage', 'couleur', 'personne_id', 'ordre'] as const;

export function appliquerJoueur(base: Objet | null, patch: Objet): Objet {
  const { fiche, neuve } = partirDe(base);

  if (fourni(patch, 'nom') || neuve) {
    fiche.nom = texte(choisir(patch, 'nom', fiche.nom));
  }
  if (fourni(patch, 'personnage') || neuve) {
    fiche.personnage = texte(choisir(patch, 'personnage', fiche.personnage));
  }
  if (fourni(patch, 'couleur') || neuve) {
    fiche.couleur = normaliserCouleur(
      choisir(patch, 'couleur', fiche.couleur),
      COULEUR_JOUEUR_DEFAUT
    );
  }
  if (fourni(patch, 'personne_id') || neuve) {
    // Le personnage joué, s'il a sa fiche dans l'arbre : sa carte porte alors
    // un cadre à part. Vide = le joueur n'a pas de fiche.
    fiche.personne_id = texte(choisir(patch, 'personne_id', fiche.personne_id));
  }
  if (fourni(patch, 'ordre')) {
    fiche.ordre = ordre(patch.ordre);
  }

  if (!fiche.nom) throw new ErreurReferentiel("un joueur a besoin d'un nom");
  return fiche;
}

/** Ce que le front a besoin de savoir pour construire ses formulaires. */
export function decrireCatalogues(): Objet {
  return {
    styles: Object.entries(STYLES).map(([id, label]) => ({ id, label })),
    categories: Object.entries(CATEGORIES).map(([id, label]) => ({ id, label })),
    types_structurants: [...TYPES_STRUCTURANTS],
    // Les sept ressources d'une maison : le front construit sa grille à partir
    // d'ici, il ne les recopie pas.
    caracteristiques_maison: CARACTERISTIQUES_MAISON.map((c) => ({ ...c })),
  };
}
