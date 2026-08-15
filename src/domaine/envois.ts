/**
 * Une note qui passe d'un monde à un autre (lot 16.E et 16.F).
 *
 * Le carnet cite les fiches par identifiant : `@p:eddard-stark`. C'est ce qui
 * le rend économe et ce qui le fait survivre aux renommages — mais un
 * identifiant ne vaut que **dans le monde qui l'a fabriqué**. Envoyée telle
 * quelle chez quelqu'un d'autre, une note citerait des fiches qui n'existent
 * pas, ou pire, celles qui portent le même identifiant par hasard.
 *
 * D'où deux temps :
 *
 * - **au départ**, `glossaireDe` relève le nom que l'expéditeur donnait à
 *   chaque balise. La note voyage avec ses noms ;
 * - **à l'arrivée**, `rattacher` cherche ces noms dans le monde du
 *   destinataire et réécrit les balises vers *ses* identifiants.
 *
 * Ce qui ne se retrouve pas n'est pas perdu : la balise devient le nom en
 * clair, précédé d'un `@`. `@Eddard Stark` ne cite plus personne — mais on lit
 * de qui on parlait, et c'est tout ce qu'on demandait à cette note.
 */

import { balisesDe, catalogue, libelleDe, type Genre } from './carnet';
import { Dataset, type Objet } from './models';

/** Ce qu'une balise désignait dans le monde d'origine. */
export interface EntreeGlossaire {
  genre: Genre;
  id: string;
  libelle: string;
}

/**
 * Le nom de chaque cible citée, sans doublon.
 *
 * Une cible qui n'existe plus chez l'expéditeur non plus (fiche supprimée
 * depuis) n'entre pas au glossaire : il n'y a pas de nom à transmettre, et la
 * balise finira en clair sur son propre identifiant. C'est le même sort que
 * chez lui, où elle s'affiche déjà comme ça.
 */
export function glossaireDe(dataset: Dataset, corps: string): EntreeGlossaire[] {
  const vues = new Map<string, EntreeGlossaire>();
  for (const balise of balisesDe(corps)) {
    const clef = `${balise.genre}:${balise.id}`;
    if (vues.has(clef)) continue;
    const libelle = libelleDe(dataset, balise.genre, balise.id);
    if (libelle === null) continue;
    vues.set(clef, { genre: balise.genre, id: balise.id, libelle });
  }
  return [...vues.values()];
}

/* --------------------------------------------------------------------------
 * La correspondance souple
 * -------------------------------------------------------------------------- */

/**
 * Ce qui reste d'un nom quand on lui retire tout ce qui varie d'une table à
 * l'autre : la casse, les accents, la ponctuation, les espaces multiples.
 *
 * « Eddard Stark », « eddard stark » et « Eddard  Stark, » donnent la même
 * empreinte. C'est volontairement grossier — on cherche à reconnaître un
 * personnage nommé par deux personnes différentes, pas à valider une saisie.
 */
function empreinte(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // les accents décomposés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Les mots d'un nom, les courts écartés.
 *
 * « de », « la », « the » ne distinguent personne : les garder ferait de
 * « Maison de la Nuit » et « Ordre de la Rose » des quasi-jumeaux.
 */
function mots(empreinteNom: string): Set<string> {
  return new Set(empreinteNom.split(' ').filter((mot) => mot.length > 2));
}

/**
 * Combien deux noms se ressemblent, entre 0 et 1.
 *
 * On compte les mots partagés (Jaccard) plutôt qu'une distance d'édition :
 * ici les écarts sont des mots entiers — un prénom seul, un titre en plus, un
 * nom de maison ajouté — et non des lettres près. « Eddard » contre « Eddard
 * Stark » vaut 0,5 ; « Ned Stark » contre « Eddard Stark » vaut 0,33.
 */
function ressemblance(a: string, b: string): number {
  const gauche = mots(a);
  const droite = mots(b);
  if (!gauche.size || !droite.size) return 0;
  let communs = 0;
  for (const mot of gauche) if (droite.has(mot)) communs += 1;
  return communs / (gauche.size + droite.size - communs);
}

/**
 * Le seuil au-dessus duquel deux noms sont considérés comme la même fiche.
 *
 * 0,5 est le point où « Eddard » retrouve « Eddard Stark » (un mot commun sur
 * deux) sans que « Robb Stark » ne le retrouve aussi (un sur trois). Plus bas,
 * toute une maison se confondrait ; plus haut, seule l'égalité exacte
 * passerait, et la souplesse demandée n'existerait pas.
 */
const SEUIL = 0.5;

interface Cible {
  id: string;
  empreinte: string;
}

/** Les cibles d'un genre dans le monde d'accueil, prêtes à être comparées. */
function ciblesDe(dataset: Dataset): Map<Genre, Cible[]> {
  const par = new Map<Genre, Cible[]>();
  for (const entree of catalogue(dataset)) {
    const genre = String(entree.genre) as Genre;
    const liste = par.get(genre) ?? [];
    liste.push({ id: String(entree.id), empreinte: empreinte(String(entree.libelle ?? '')) });
    par.set(genre, liste);
  }
  return par;
}

export interface Rattachement {
  /** Balises réécrites vers une fiche du monde d'accueil. */
  rattachees: number;
  /** Balises devenues du texte, faute de correspondance. */
  en_clair: number;
}

/**
 * Réécrit les balises d'une note pour le monde qui l'accueille.
 *
 * Trois passes, de la plus sûre à la plus souple :
 *
 * 1. **le même identifiant existe ici** — deux mondes issus de la même
 *    campagne, ou deux tables qui ont saisi les mêmes noms : les identifiants
 *    étant des noms aplatis, c'est le cas courant, et on ne touche à rien ;
 * 2. **le même nom, à la casse et aux accents près** ;
 * 3. **un nom qui se ressemble assez** — au-dessus du seuil, et le meilleur
 *    des candidats.
 *
 * À défaut, `@p:eddard-stark` devient `@Eddard Stark` : plus une citation,
 * mais une phrase qui se lit encore.
 */
export function rattacher(
  dataset: Dataset,
  corps: string,
  glossaire: EntreeGlossaire[]
): { corps: string; bilan: Rattachement } {
  const noms = new Map<string, EntreeGlossaire>();
  for (const entree of glossaire) noms.set(`${entree.genre}:${entree.id}`, entree);

  const cibles = ciblesDe(dataset);
  // Une même balise revient souvent dans une note : on ne cherche qu'une fois.
  const decisions = new Map<string, string | null>();

  const bilan: Rattachement = { rattachees: 0, en_clair: 0 };

  function decider(genre: Genre, identifiant: string): string | null {
    const clef = `${genre}:${identifiant}`;
    if (decisions.has(clef)) return decisions.get(clef) ?? null;

    let choix: string | null = null;

    // 1. l'identifiant tel quel désigne déjà quelqu'un ici
    if (libelleDe(dataset, genre, identifiant) !== null) {
      choix = identifiant;
    } else {
      const connue = noms.get(clef);
      const cherchee = empreinte(connue?.libelle ?? identifiant.replace(/-/g, ' '));
      const candidats = cibles.get(genre) ?? [];

      // 2. le même nom
      const exact = candidats.find((cible) => cible.empreinte === cherchee);
      if (exact) {
        choix = exact.id;
      } else {
        // 3. le plus ressemblant, s'il l'est assez
        let meilleur: Cible | null = null;
        let meilleurScore = 0;
        for (const cible of candidats) {
          const score = ressemblance(cherchee, cible.empreinte);
          if (score > meilleurScore) {
            meilleurScore = score;
            meilleur = cible;
          }
        }
        if (meilleur && meilleurScore >= SEUIL) choix = meilleur.id;
      }
    }

    decisions.set(clef, choix);
    return choix;
  }

  // `balisesDe` ignore le code : une balise montrée dans un bloc de code doit
  // le rester, mot pour mot. On réécrit donc de la fin vers le début, sur les
  // positions relevées, plutôt qu'avec un `replace` global qui n'en saurait rien.
  const balises = balisesDe(corps);
  let resultat = corps;
  for (let index = balises.length - 1; index >= 0; index -= 1) {
    const balise = balises[index]!;
    const choix = decider(balise.genre, balise.id);
    let remplacement: string;
    if (choix) {
      remplacement = `@${balise.genre}:${choix}`;
      bilan.rattachees += 1;
    } else {
      const connue = noms.get(`${balise.genre}:${balise.id}`);
      remplacement = `@${connue?.libelle ?? balise.id}`;
      bilan.en_clair += 1;
    }
    resultat = resultat.slice(0, balise.debut) + remplacement + resultat.slice(balise.fin);
  }

  return { corps: resultat, bilan };
}

/** Le glossaire tel qu'il ressort de la base : jamais cru sur parole. */
export function glossaireDepuisJson(brut: string): EntreeGlossaire[] {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(donnees)) return [];
  const propres: EntreeGlossaire[] = [];
  for (const entree of donnees) {
    if (typeof entree !== 'object' || entree === null) continue;
    const objet = entree as Objet;
    const genre = String(objet.genre ?? '');
    if (!['p', 'm', 'j', 'l'].includes(genre)) continue;
    propres.push({
      genre: genre as Genre,
      id: String(objet.id ?? ''),
      libelle: String(objet.libelle ?? ''),
    });
  }
  return propres;
}
