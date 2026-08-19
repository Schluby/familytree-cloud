/**
 * Les formes de fond du plan (lot 20.D).
 *
 * Des rectangles, des ellipses et des zones de texte posés **derrière** les
 * fiches, pour entourer un groupe et le nommer : « le Nord », « la cour »,
 * « ceux qui savent ». C'est le geste qu'on fait au tableau blanc, et que le
 * sociogramme ne savait pas faire — on ne pouvait que colorer des fiches, ce
 * qui suppose que le groupe existe déjà dans les données.
 *
 * ── Ce qu'une forme n'est pas ────────────────────────────────────────────────
 *
 * Elle ne **contient** personne. Aucune fiche n'y est rattachée, rien n'est
 * recalculé quand on la déplace, et la déplacer sur d'autres gens ne change
 * rien à ce que dit le monde. C'est un trait de crayon, et c'est voulu : un
 * regroupement qui *compte* existe déjà — c'est une maison, une catégorie, un
 * filtre — et celui-là est fait pour tout le reste, ce qu'on voit une séance et
 * qu'on efface la suivante.
 *
 * Conséquence assumée : une forme ne suit pas les fiches. Un filtre qui
 * redessine le plan laisse les formes où elles sont, et il faut les rebouger.
 * Les y accrocher voudrait dire choisir *à quoi* (une personne ? le barycentre
 * d'un groupe ?) et se tromper la moitié du temps.
 *
 * ── Un seul enregistrement pour trois dessins ────────────────────────────────
 *
 * Un rectangle, une ellipse et une zone de texte partagent les mêmes champs :
 * seul le rendu diffère. Une zone de texte est donc une forme sans contour et
 * sans fond — et, en retour, un rectangle peut porter un titre, ce qui est
 * exactement ce qu'on veut pour nommer une zone.
 *
 * ── Où une forme se montre (lot 22.C) ────────────────────────────────────────
 *
 * Le plan se regarde de deux façons : en entier, ou centré sur un profil et ses
 * voisins. Ce ne sont pas les mêmes lectures, donc pas les mêmes annotations —
 * « les prétendants » n'a de sens qu'autour de Daenerys, et l'afficher sur le
 * plan général met un rectangle en travers de Westeros.
 *
 * D'où `vue` : `'plan'` pour le plan général, `'profils'` pour une forme qui ne
 * paraît qu'en centrant sur l'un des `profils` listés. Une forme invisible est
 * **retirée du rendu**, pas seulement transparente : c'est la seule manière
 * d'être sûr qu'elle n'attrape ni un clic ni un glisser.
 */

import { idsLibres, type Objet } from './models';
import { versEntier } from './python';

export const GENRES = ['rectangle', 'ellipse', 'texte'] as const;

/** Refus explicite, affichable tel quel. */
export class ErreurForme extends Error {}

const COULEUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Le plan est vaste mais pas infini : de quoi tenir un monde, pas une dérive. */
const LIMITE_COORDONNEE = 200000;
const TAILLE_MIN = 8;
const TAILLE_MAX = 20000;

/** Combien de formes une sauvegarde accepte. Au-delà, on dessine, on ne range plus. */
export const MAX_FORMES = 200;

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

function couleur(brut: unknown, defaut: string | null): string | null {
  if (brut === null || brut === undefined) return defaut;
  const texte = String(brut).trim();
  if (!texte) return null; // vide = « pas de couleur » (un fond transparent)
  if (!COULEUR.test(texte)) return defaut;
  const complet =
    texte.length === 4 ? '#' + [...texte.slice(1)].map((c) => c + c).join('') : texte;
  return complet.toLowerCase();
}

function nombre(brut: unknown, defaut: number, mini: number, maxi: number): number {
  const entier = versEntier(brut);
  if (entier === null) return defaut;
  return Math.max(mini, Math.min(maxi, entier));
}

function texteBorne(brut: unknown, maximum: number): string {
  return String(brut === null || brut === undefined ? '' : brut)
    .trim()
    .slice(0, maximum);
}

/** Les deux portées d'une forme. Voir l'entête pour le pourquoi. */
export const VUES = ['plan', 'profils'] as const;

/** Autant de profils qu'on veut, mais pas une liste qui remplace le monde. */
const MAX_PROFILS = 60;

/**
 * Les profils qui montrent cette forme, dédoublonnés et bornés.
 *
 * On ne vérifie **pas** que ces identifiants existent : une forme n'est pas une
 * donnée du monde, et une fiche supprimée ne doit pas faire échouer
 * l'enregistrement d'un rectangle. Un identifiant orphelin ne coûte rien — il
 * désigne une vue où l'on n'ira plus.
 */
function profilsBornes(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  for (const entree of brut) {
    const id = texteBorne(entree, 80);
    if (id) vus.add(id);
    if (vus.size >= MAX_PROFILS) break;
  }
  return [...vus];
}

/** Une forme complète, quelles que soient les lacunes de ce qu'on lui donne. */
export function normaliser(brut: Objet, id: string): Objet {
  const genre = texteBorne(brut.genre, 20);
  return {
    id,
    genre: (GENRES as readonly string[]).includes(genre) ? genre : 'rectangle',
    x: nombre(brut.x, 0, -LIMITE_COORDONNEE, LIMITE_COORDONNEE),
    y: nombre(brut.y, 0, -LIMITE_COORDONNEE, LIMITE_COORDONNEE),
    l: nombre(brut.l, 240, TAILLE_MIN, TAILLE_MAX),
    h: nombre(brut.h, 160, TAILLE_MIN, TAILLE_MAX),
    trait: couleur(brut.trait, '#8a8f98'),
    // 0 = pas de contour du tout. C'est ce que vaut une zone de texte nue.
    epaisseur: nombre(brut.epaisseur, 2, 0, 12),
    fond: couleur(brut.fond, null),
    texte: texteBorne(brut.texte, 2000),
    taille: nombre(brut.taille, 16, 8, 96),
    gras: Boolean(brut.gras),
    italique: Boolean(brut.italique),
    couleur_texte: couleur(brut.couleur_texte, '#8a8f98'),
    // En pourcents, et sur la forme entière — contour, fond et texte. Un
    // flottant de 0 à 1 se serait affiché « 0.35000000000000003 » dans la
    // sauvegarde ; un entier se relit à l'œil et se règle au curseur.
    opacite: nombre(brut.opacite, 100, 5, 100),
    vue: (VUES as readonly string[]).includes(texteBorne(brut.vue, 20))
      ? texteBorne(brut.vue, 20)
      : 'plan',
    profils: profilsBornes(brut.profils),
  };
}

/**
 * Les formes d'un monde, remises en forme — **sans le modifier**.
 *
 * Pure, parce que les vues sont pures : la vue « sociogramme » l'appelle pour
 * peupler son payload, et une vue qui réécrirait le document au passage serait
 * un piège. Ce sont les routes qui réassignent le résultat quand elles
 * modifient quelque chose.
 *
 * On ne refuse rien à la lecture : un document bricolé à la main doit s'ouvrir,
 * quitte à voir ses valeurs bornées.
 */
export function liste(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  const vus: string[] = [];
  const resultat: Objet[] = [];
  for (const entree of brut) {
    if (!estObjet(entree)) continue;
    const id = idsLibres(vus, texteBorne(entree.id, 80) || 'forme');
    vus.push(id);
    resultat.push(normaliser(entree, id));
    if (resultat.length >= MAX_FORMES) break;
  }
  return resultat;
}

/** Crée une forme et l'ajoute au monde. Lève si le plafond est atteint. */
export function creer(formes: Objet[], corps: Objet): Objet {
  if (formes.length >= MAX_FORMES) {
    throw new ErreurForme(`plafond atteint : ${MAX_FORMES} formes par sauvegarde`);
  }
  const id = idsLibres(
    formes.map((f) => String(f.id)),
    'forme'
  );
  const forme = normaliser(corps, id);
  formes.push(forme);
  return forme;
}

/**
 * Applique un patch partiel. Renvoie la liste des champs modifiés.
 *
 * On repasse par `normaliser` sur la fusion plutôt que de valider champ par
 * champ : c'est le même code qui borne une création et une modification, donc
 * il n'y a pas deux idées de ce qu'est une forme valable.
 */
export function appliquer(forme: Objet, patch: Objet): string[] {
  const fusion: Objet = { ...forme };
  for (const [cle, valeur] of Object.entries(patch)) {
    if (cle === 'id') continue; // l'identifiant ne se réécrit jamais
    fusion[cle] = valeur;
  }
  const propre = normaliser(fusion, String(forme.id));

  const modifies: string[] = [];
  for (const [cle, valeur] of Object.entries(propre)) {
    if (identique(forme[cle], valeur)) continue;
    forme[cle] = valeur;
    modifies.push(cle);
  }
  return modifies;
}

/**
 * `profils` est un tableau, et `normaliser` en rend un neuf à chaque passage :
 * comparé au `!==`, il serait « modifié » même quand on ne touche qu'à la
 * couleur. Sans ça, déplacer une forme réécrirait la sauvegarde en annonçant un
 * changement de portée qui n'a pas eu lieu.
 */
function identique(avant: unknown, apres: unknown): boolean {
  if (Array.isArray(avant) && Array.isArray(apres)) {
    return avant.length === apres.length && avant.every((v, i) => v === apres[i]);
  }
  return avant === apres;
}
