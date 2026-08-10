/**
 * L'humeur : ce qu'un personnage éprouve pour un autre — ou pour un joueur.
 *
 * Port de `backend/humeur.py`, aux mêmes valeurs et aux mêmes noms.
 *
 * Une seule échelle dans toute l'application, parce qu'un maître de jeu ne veut
 * pas se demander laquelle il regarde : **1 est le meilleur, 7 le pire**. Chaque
 * cran porte les deux modificateurs qui servent à table, la Duperie (MD) et la
 * Persuasion (MP) ; c'est la table du Trône de Fer JDR.
 *
 * Attention en relisant du vieux code : l'ancienne note joueur allait dans
 * l'autre sens (1 hostile → 5 dévoué). Toute échelle de couleur héritée est à
 * retourner.
 */

import { arrondir, versEntier } from './python';

export const MINIMUM = 1;
export const MAXIMUM = 7;
export const DEFAUT = 4; // Indifférent : le point neutre, celui d'un inconnu

export interface Cran {
  valeur: number;
  label: string;
  md: number;
  mp: number;
  couleur: string;
}

export const TABLE: readonly Cran[] = [
  { valeur: 1, label: 'Affectueux', md: -2, mp: 5, couleur: '#2f9e78' },
  { valeur: 2, label: 'Amicale', md: -1, mp: 3, couleur: '#6fbf73' },
  { valeur: 3, label: 'Aimable', md: 0, mp: 1, couleur: '#a8c95f' },
  { valeur: 4, label: 'Indifférent', md: 0, mp: 0, couleur: '#9aa0a8' },
  { valeur: 5, label: 'Antipathique', md: 1, mp: -2, couleur: '#e0a63f' },
  { valeur: 6, label: 'Inamicale', md: 2, mp: -4, couleur: '#d97b3f' },
  { valeur: 7, label: 'Malveillant', md: 3, mp: -6, couleur: '#c04141' },
];

const PAR_VALEUR = new Map(TABLE.map((cran) => [cran.valeur, cran]));

/**
 * L'ancienne note joueur (1 hostile → 5 dévoué) disait bien une disposition :
 * celle-là se convertit sans rien inventer. Voir `migrations.ts`.
 */
export const CONVERSION_NOTE_HERITEE: Record<number, number> = {
  1: 7,
  2: 5,
  3: 4,
  4: 2,
  5: 1,
};

/**
 * Ramène n'importe quoi dans 1..7. `null` reste `null` si `defaut` l'est —
 * c'est ainsi qu'on distingue « indifférent » de « pas encore rencontré ».
 */
export function normaliser(brut: unknown, defaut: number | null = DEFAUT): number | null {
  if (brut === null || brut === undefined || brut === '') return defaut;
  const valeur = versEntier(brut);
  if (valeur === null) return defaut;
  return Math.max(MINIMUM, Math.min(MAXIMUM, valeur));
}

export function cran(valeur: unknown): Cran {
  return PAR_VALEUR.get(normaliser(valeur) || DEFAUT) as Cran;
}

export function label(valeur: unknown): string {
  return cran(valeur).label;
}

/**
 * Distance à l'indifférence : l'intensité du sentiment, quel qu'il soit.
 *
 * Un amour et une haine méritent tous deux un trait épais ; c'est le
 * « m'est égal » qui doit s'effacer.
 */
export function ecart(valeur: unknown): number {
  return Math.abs((normaliser(valeur) || DEFAUT) - DEFAUT);
}

export function epaisseur(valeur: unknown): number {
  return arrondir(1.1 + ecart(valeur) * 0.62, 2);
}

/** La table telle quelle, pour que le web n'ait rien à recopier. */
export function decrire(): Cran[] {
  return TABLE.map((cran) => ({ ...cran }));
}
