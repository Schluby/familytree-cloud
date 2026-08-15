/**
 * Le carnet : les notes de la table, et ce qu'elles citent.
 *
 * Une note est **du Markdown brut**, rien d'autre. Pas de HTML, pas d'arbre de
 * blocs, pas de balisage riche : le texte tel qu'il a été tapé. C'est ce qui
 * rend le carnet économe — une séance de deux mille signes pèse deux kilo-octets,
 * et le document d'une sauvegarde reste sous le plafond de 2 Mo même après une
 * campagne entière.
 *
 * Les notes citent les fiches du monde par une **balise** : `@p:jon-snow`. Trois
 * conséquences, et c'est pour elles que la forme a été choisie :
 *
 * - **elle survit à un renommage.** Ce qui est écrit est l'identifiant, pas le
 *   nom ; le nom est lu dans la fiche au moment de l'affichage. Renommer
 *   « Jon Snow » en « Aegon Targaryen » change toutes les notes d'un coup, sans
 *   en réécrire une seule ;
 * - **elle ne se répète pas.** Un nom stocké dans chaque citation, c'est le nom
 *   payé autant de fois qu'il est cité ;
 * - **elle se relit.** L'identifiant est le nom aplati (`slugifier`), donc la
 *   source reste lisible pendant qu'on tape.
 *
 * Quatre genres, un par catalogue du monde : `p` profil, `m` maison, `j` joueur,
 * `l` lien. Un genre explicite plutôt qu'une recherche dans les quatre listes :
 * rien n'interdit à une maison et à une personne de porter le même identifiant.
 */

import { Dataset, type Objet } from './models';

/* --------------------------------------------------------------------------
 * Le carnet dans le document
 * -------------------------------------------------------------------------- */

export interface Chapitre {
  id: string;
  titre: string;
  resume: string;
  extra: Objet;
}

export interface Note {
  id: string;
  /** Vide : la note n'est rangée nulle part. C'est un état normal. */
  chapitre: string;
  titre: string;
  corps: string;
  extra: Objet;
}

export interface Carnet {
  chapitres: Chapitre[];
  notes: Note[];
}

const CHAMPS_CHAPITRE = new Set(['id', 'titre', 'resume']);
const CHAMPS_NOTE = new Set(['id', 'chapitre', 'titre', 'corps']);

function texte(valeur: unknown): string {
  return valeur === null || valeur === undefined ? '' : String(valeur);
}

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** Ce qui n'est pas un champ connu est gardé de côté et réécrit tel quel. */
function separer(donnees: Objet, connus: Set<string>): Objet {
  const extra: Objet = {};
  for (const [cle, valeur] of Object.entries(donnees)) {
    if (!connus.has(cle)) extra[cle] = valeur;
  }
  return extra;
}

/**
 * Les retours chariot de Windows sont ramenés à `\n`.
 *
 * Sans ça, le même texte tapé sur deux machines donnerait deux documents
 * différents, et un `\r` traînant décalerait les extraits d'une citation.
 */
function corpsPropre(valeur: unknown): string {
  return texte(valeur).replace(/\r\n?/g, '\n');
}

export function lireCarnet(dataset: Dataset): Carnet {
  const brut = estObjet(dataset.carnet) ? dataset.carnet : {};

  const chapitres = (Array.isArray(brut.chapitres) ? brut.chapitres : [])
    .filter(estObjet)
    .map((entree) => ({
      id: texte(entree.id).trim(),
      titre: texte(entree.titre),
      resume: texte(entree.resume),
      extra: separer(entree, CHAMPS_CHAPITRE),
    }))
    .filter((chapitre) => chapitre.id);

  const notes = (Array.isArray(brut.notes) ? brut.notes : [])
    .filter(estObjet)
    .map((entree) => ({
      id: texte(entree.id).trim(),
      chapitre: texte(entree.chapitre).trim(),
      titre: texte(entree.titre),
      corps: corpsPropre(entree.corps),
      extra: separer(entree, CHAMPS_NOTE),
    }))
    .filter((note) => note.id);

  return { chapitres, notes };
}

/**
 * Réécrit le carnet dans le document — et **l'efface quand il est vide**.
 *
 * Ce n'est pas de la coquetterie. Une sauvegarde qui ne se sert pas du carnet
 * doit ressortir exactement comme elle est entrée : c'est ce qui laisse
 * `outils/comparer.mjs` muet sur les mondes d'avant le lot 15, et ce qui évite
 * de facturer trois octets de `"carnet":{}` aux trente comptes qui n'en
 * ouvriront jamais un.
 */
export function ecrireCarnet(dataset: Dataset, carnet: Carnet): void {
  if (!carnet.chapitres.length && !carnet.notes.length) {
    dataset.carnet = null;
    return;
  }
  dataset.carnet = {
    ...(carnet.chapitres.length
      ? {
          chapitres: carnet.chapitres.map((chapitre) => ({
            id: chapitre.id,
            ...(chapitre.titre ? { titre: chapitre.titre } : {}),
            ...(chapitre.resume ? { resume: chapitre.resume } : {}),
            ...chapitre.extra,
          })),
        }
      : {}),
    ...(carnet.notes.length
      ? {
          notes: carnet.notes.map((note) => ({
            id: note.id,
            ...(note.chapitre ? { chapitre: note.chapitre } : {}),
            ...(note.titre ? { titre: note.titre } : {}),
            ...(note.corps ? { corps: note.corps } : {}),
            ...note.extra,
          })),
        }
      : {}),
  };
}

/* --------------------------------------------------------------------------
 * Les balises
 * -------------------------------------------------------------------------- */

export const GENRES = ['p', 'm', 'j', 'l'] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABEL: Record<Genre, string> = {
  p: 'profil',
  m: 'maison',
  j: 'joueur',
  l: 'lien',
};

/**
 * `@p:jon-snow`. L'identifiant ne se termine jamais par un tiret : sans ça,
 * « demander à @p:jon-snow — puis partir » avalerait le tiret cadratin collé.
 */
export const BALISE = /@([pmjl]):([A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?)/g;

/**
 * Neutralise le code sans déplacer un seul caractère.
 *
 * Une balise écrite dans un bloc de code est là pour être *montrée*, pas pour
 * citer quelqu'un — et le navigateur ne la transformera pas non plus. On la
 * remplace donc par des espaces : l'index et l'affichage disent la même chose,
 * et les positions restent bonnes pour découper les extraits.
 */
function masquerCode(source: string): string {
  const blanc = (bloc: string) => bloc.replace(/[^\n]/g, ' ');
  return source
    .replace(/```[\s\S]*?(?:```|$)/g, blanc)
    .replace(/`[^`\n]*`/g, blanc);
}

export interface Balise {
  genre: Genre;
  id: string;
  /** Position dans le texte d'origine (pas dans le texte masqué). */
  debut: number;
  fin: number;
}

export function balisesDe(source: string): Balise[] {
  const lisible = masquerCode(source);
  const trouvees: Balise[] = [];
  for (const trouvee of lisible.matchAll(BALISE)) {
    trouvees.push({
      genre: trouvee[1] as Genre,
      id: trouvee[2] as string,
      debut: trouvee.index,
      fin: trouvee.index + trouvee[0].length,
    });
  }
  return trouvees;
}

/* --------------------------------------------------------------------------
 * Ce qu'une balise désigne
 * -------------------------------------------------------------------------- */

/** Le nom à afficher, lu dans le monde. `null` : la cible n'existe plus. */
export function libelleDe(dataset: Dataset, genre: string, id: string): string | null {
  if (genre === 'p') {
    const personne = dataset.personne(id);
    return personne ? personne.nomComplet : null;
  }
  if (genre === 'm') {
    if (!Object.hasOwn(dataset.maisons, id)) return null;
    return texte(dataset.maison(id).label) || id;
  }
  if (genre === 'j') {
    const joueur = dataset.joueurs.find((entree) => String(entree.id) === id);
    return joueur ? texte(joueur.nom) || id : null;
  }
  if (genre === 'l') {
    const relation = dataset.relation(id);
    if (!relation) return null;
    if (relation.label) return relation.label;
    const source = dataset.personne(relation.source)?.nomComplet ?? relation.source;
    const cible = dataset.personne(relation.cible)?.nomComplet ?? relation.cible;
    return `${source} → ${cible}`;
  }
  return null;
}

/**
 * Tout ce qui peut être cité, à plat : c'est la liste dans laquelle le « / »
 * de l'éditeur va chercher ses propositions.
 */
export function catalogue(dataset: Dataset): Objet[] {
  const entrees: Objet[] = [];

  for (const personne of dataset.personnes) {
    entrees.push({
      genre: 'p',
      id: personne.id,
      libelle: personne.nomComplet,
      detail: texte(dataset.maison(personne.maison).label),
      couleur: personne.couleur || texte(dataset.maison(personne.maison).couleur) || '#7a7f87',
      ...(personne.surnom ? { surnom: personne.surnom } : {}),
    });
  }

  for (const [id, maison] of Object.entries(dataset.maisons)) {
    const categorie = texte(maison.categorie);
    entrees.push({
      genre: 'm',
      id,
      libelle: texte(maison.label) || id,
      detail: categorie ? texte(dataset.categorie(categorie).label) : 'Maison',
      couleur: texte(maison.couleur) || '#7a7f87',
    });
  }

  for (const joueur of dataset.joueurs) {
    entrees.push({
      genre: 'j',
      id: String(joueur.id),
      libelle: texte(joueur.nom) || String(joueur.id),
      detail: texte(joueur.personnage) || 'Joueur',
      couleur: texte(joueur.couleur) || '#7a7f87',
    });
  }

  for (const relation of dataset.relations) {
    const source = dataset.personne(relation.source)?.nomComplet ?? relation.source;
    const cible = dataset.personne(relation.cible)?.nomComplet ?? relation.cible;
    entrees.push({
      genre: 'l',
      id: relation.id,
      libelle: relation.label || `${source} → ${cible}`,
      detail: texte(dataset.typeRelation(relation.type).label) || relation.type,
      couleur: texte(dataset.typeRelation(relation.type).couleur) || '#8a8f98',
    });
  }

  return entrees;
}

/* --------------------------------------------------------------------------
 * L'index inverse : qui parle de qui
 * -------------------------------------------------------------------------- */

const EXTRAITS_PAR_NOTE = 3;
const MARGE = 70;

export interface Extrait {
  /** Rang de l'apparition dans la note, à partir de 1 — c'est l'ancre. */
  rang: number;
  avant: string;
  libelle: string;
  apres: string;
}

export interface CitationNote {
  note: string;
  titre: string;
  chapitre: string;
  chapitre_titre: string;
  occurrences: number;
  extraits: Extrait[];
}

export interface CitationChapitre {
  id: string;
  titre: string;
  occurrences: number;
  notes: number;
}

export interface Citations {
  genre: string;
  id: string;
  libelle: string | null;
  /** Nombre total d'apparitions, toutes notes confondues. */
  total: number;
  par_note: CitationNote[];
  par_chapitre: CitationChapitre[];
}

/**
 * Remplace les balises d'un morceau de texte par les noms qu'elles désignent.
 * Une cible disparue garde son identifiant : mieux vaut un nom brut qu'un trou.
 */
function enClair(dataset: Dataset, morceau: string): string {
  return morceau.replace(BALISE, (_tout, genre: string, id: string) => {
    return libelleDe(dataset, genre, id) ?? id;
  });
}

/** La ligne autour d'une balise, rognée à quelques mots de chaque côté. */
function extraitAutour(dataset: Dataset, corps: string, balise: Balise, rang: number): Extrait {
  const debutLigne = corps.lastIndexOf('\n', Math.max(0, balise.debut - 1)) + 1;
  const finBrute = corps.indexOf('\n', balise.fin);
  const finLigne = finBrute === -1 ? corps.length : finBrute;

  let avant = enClair(dataset, corps.slice(debutLigne, balise.debut));
  let apres = enClair(dataset, corps.slice(balise.fin, finLigne));

  if (avant.length > MARGE) avant = `…${avant.slice(avant.length - MARGE)}`;
  if (apres.length > MARGE) apres = `${apres.slice(0, MARGE)}…`;

  return {
    rang,
    avant: avant.trimStart(),
    libelle: libelleDe(dataset, balise.genre, balise.id) ?? balise.id,
    apres: apres.trimEnd(),
  };
}

/** Toutes les notes qui citent une cible, avec le compte par note et par chapitre. */
export function citations(dataset: Dataset, genre: string, id: string): Citations {
  const carnet = lireCarnet(dataset);
  const titreChapitre = new Map(carnet.chapitres.map((c) => [c.id, c.titre]));

  const parNote: CitationNote[] = [];
  const parChapitre = new Map<string, CitationChapitre>();
  let total = 0;

  for (const note of carnet.notes) {
    const visees = balisesDe(note.corps).filter((b) => b.genre === genre && b.id === id);
    if (!visees.length) continue;

    total += visees.length;
    parNote.push({
      note: note.id,
      titre: note.titre,
      chapitre: note.chapitre,
      chapitre_titre: titreChapitre.get(note.chapitre) ?? '',
      occurrences: visees.length,
      extraits: visees
        .slice(0, EXTRAITS_PAR_NOTE)
        .map((balise, index) => extraitAutour(dataset, note.corps, balise, index + 1)),
    });

    const compte = parChapitre.get(note.chapitre) ?? {
      id: note.chapitre,
      titre: titreChapitre.get(note.chapitre) ?? '',
      occurrences: 0,
      notes: 0,
    };
    compte.occurrences += visees.length;
    compte.notes += 1;
    parChapitre.set(note.chapitre, compte);
  }

  // L'ordre du carnet, pas celui des compteurs : on relit une campagne dans
  // l'ordre où elle s'est jouée.
  const rangChapitre = new Map(carnet.chapitres.map((c, index) => [c.id, index]));
  const rangDe = (chapitre: string) => rangChapitre.get(chapitre) ?? Number.MAX_SAFE_INTEGER;

  return {
    genre,
    id,
    libelle: libelleDe(dataset, genre, id),
    total,
    par_note: parNote,
    par_chapitre: [...parChapitre.values()].sort((a, b) => rangDe(a.id) - rangDe(b.id)),
  };
}

/**
 * Le compte des citations pour **toutes** les cibles d'un genre, en un seul
 * parcours du carnet.
 *
 * La liste des personnes affiche une pastille par fiche citée : la calculer
 * cible par cible relirait le carnet une fois par personne.
 */
export function comptes(dataset: Dataset, genre: string): Record<string, number> {
  const resultat: Record<string, number> = {};
  for (const note of lireCarnet(dataset).notes) {
    for (const balise of balisesDe(note.corps)) {
      if (balise.genre !== genre) continue;
      resultat[balise.id] = (resultat[balise.id] ?? 0) + 1;
    }
  }
  return resultat;
}

/* --------------------------------------------------------------------------
 * Écriture
 * -------------------------------------------------------------------------- */

export class ErreurCarnet extends Error {}

const TAILLE_MAX_CORPS = 200_000;

/**
 * Applique un patch sur une note ou un chapitre.
 *
 * Le corps est borné : au-delà de deux cent mille signes, ce n'est plus une
 * note de séance, c'est un fichier — et le plafond de la sauvegarde entière
 * serait atteint par une seule d'entre elles.
 */
export function appliquerNote(note: Note, patch: Objet): void {
  if ('chapitre' in patch) note.chapitre = texte(patch.chapitre).trim();
  if ('titre' in patch) note.titre = texte(patch.titre);
  if ('corps' in patch) {
    const corps = corpsPropre(patch.corps);
    if (corps.length > TAILLE_MAX_CORPS) {
      throw new ErreurCarnet(
        `Cette note dépasse ${TAILLE_MAX_CORPS.toLocaleString('fr-FR')} signes. ` +
          'Coupez-la en deux : le carnet est fait de notes, pas de volumes.'
      );
    }
    note.corps = corps;
  }
}

export function appliquerChapitre(chapitre: Chapitre, patch: Objet): void {
  if ('titre' in patch) chapitre.titre = texte(patch.titre);
  if ('resume' in patch) chapitre.resume = texte(patch.resume);
}
