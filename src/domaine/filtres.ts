/**
 * Filtres sur mesure — port de `backend/filtres.py`.
 *
 * Les axes de couleur livrés avec l'application (maison, statut, génération,
 * humeur) répondent aux questions qu'on pose tout le temps. Celui-ci répond aux
 * autres : « les Lannister de plus de trois générations », « tous ceux qui me
 * détestent et vivent au Nord », « qui a le plus de liens ».
 *
 * Un filtre tient en quatre morceaux :
 *
 * - **la variable** : ce qu'on lit sur chaque personne (`variables()` donne le
 *   catalogue, il dépend des joueurs présents) ;
 * - **la segmentation** : `valeurs` range par valeur distincte, `tranches`
 *   découpe un nombre en N paquets d'égale largeur ;
 * - **le dégradé** : deux couleurs, interpolées sur les segments dans l'ordre ;
 * - **les tests** : `champ opérateur valeur`, joints par ET ou par OU. Ce qui
 *   échoue est *exclu* — masqué du plan, quel que soit le segment.
 *
 * Le module ne connaît ni HTTP ni rendu : il prend un `Dataset`, rend des objets.
 */

import { appliquerSurcharges, calculerGenerations } from './genealogie';
import { Dataset, Personne, slugifier, type Objet } from './models';
import { arrondir, versEntier, versFlottant } from './python';

export const SEGMENTS_MINIMUM = 2;
export const SEGMENTS_MAXIMUM = 12;
export const SEGMENTS_DEFAUT = 5;

export const GRADIENT_DEFAUT = { de: '#3f6f9f', vers: '#c1762f' };
export const COULEUR_EXCLU = '#8a8f98';

export const MODES = ['valeurs', 'tranches'] as const;

export const OPERATEURS: Objet[] = [
  { id: '=', label: 'est', valeur: true },
  { id: '≠', label: 'n’est pas', valeur: true },
  { id: 'contient', label: 'contient', valeur: true },
  { id: '<', label: 'inférieur à', valeur: true, nombre: true },
  { id: '≤', label: 'inférieur ou égal à', valeur: true, nombre: true },
  { id: '>', label: 'supérieur à', valeur: true, nombre: true },
  { id: '≥', label: 'supérieur ou égal à', valeur: true, nombre: true },
  // Deux opérateurs à part : leur opérande n'est pas une valeur tapée à la main
  // mais l'id d'une liste nommée (`dataset.listes`), qu'on réutilise d'un filtre
  // à l'autre et qu'on édite au même endroit.
  { id: '∈', label: 'appartient à la liste', valeur: true, liste: true },
  { id: '∉', label: 'n’appartient pas à la liste', valeur: true, liste: true },
  { id: 'vide', label: 'est vide', valeur: false },
  { id: 'non vide', label: 'est renseigné', valeur: false },
];

const IDS_OPERATEURS = new Set(OPERATEURS.map((o) => String(o.id)));

/* --------------------------------------------------------------------------
 * Catalogue des variables
 * -------------------------------------------------------------------------- */

export interface FicheVariable extends Objet {
  id: string;
  label: string;
  genre: 'texte' | 'nombre' | 'liste';
}

/**
 * Ce qu'on peut lire sur une personne, avec le genre de sa valeur.
 * Le genre décide de tout le reste : un texte se range par valeurs, un nombre
 * se découpe en tranches.
 */
export function variables(dataset: Dataset): FicheVariable[] {
  const catalogue: FicheVariable[] = [
    { id: 'maison', label: 'Maison', genre: 'texte' },
    { id: 'categorie', label: 'Catégorie de maison', genre: 'texte' },
    { id: 'statut', label: 'Statut', genre: 'texte' },
    { id: 'generation', label: 'Génération', genre: 'nombre' },
    { id: 'naissance', label: 'Année de naissance', genre: 'nombre' },
    { id: 'deces', label: 'Année de décès', genre: 'nombre' },
    { id: 'importance', label: 'Importance', genre: 'nombre' },
    { id: 'liens', label: 'Nombre de liens', genre: 'nombre' },
    { id: 'lieu', label: 'Lieu', genre: 'texte' },
    // Lot 21.D. Ce que la carte du plan montre doit pouvoir servir d'axe : les
    // quatre faits d'une fiche sont maintenant maison, rôle, région et ville.
    { id: 'role', label: 'Rôle dans la maison', genre: 'texte' },
    { id: 'ville', label: 'Ville', genre: 'texte' },
    { id: 'genre', label: 'Genre', genre: 'texte' },
    { id: 'tags', label: 'Tags', genre: 'liste' },
    { id: 'titres', label: 'Titres', genre: 'liste' },
    { id: 'nom', label: 'Nom complet', genre: 'texte' },
    { id: 'notes', label: 'Notes', genre: 'texte' },
    { id: 'humeur', label: 'Humeur moyenne', genre: 'nombre' },
  ];

  for (const joueur of dataset.joueurs) {
    catalogue.push({
      id: `humeur:${joueur.id}`,
      label: `Humeur envers ${joueur.nom || joueur.id}`,
      genre: 'nombre',
    });
  }
  return catalogue;
}

export function variable(dataset: Dataset, identifiant: string): FicheVariable | null {
  return variables(dataset).find((fiche) => fiche.id === identifiant) ?? null;
}

/**
 * La seule variable dont la valeur est un **flottant** au sens de Python :
 * `round(moyenne, 1)` rend `4.0`, que `str()` écrit « 4.0 » alors que
 * JavaScript écrirait « 4 ». Sans ce drapeau, les libellés de segments et les
 * valeurs observées divergeraient dès qu'une moyenne tombe juste.
 */
function estFlottante(identifiant: string): boolean {
  return identifiant === 'humeur';
}

/* --------------------------------------------------------------------------
 * Lecture d'une valeur sur une personne
 * -------------------------------------------------------------------------- */

/** Les champs de `Personne` qu'une variable peut lire directement. */
const CHAMPS_DIRECTS = new Set([
  'statut',
  'lieu',
  'role',
  'ville',
  'genre',
  'tags',
  'titres',
  'notes',
  'importance',
  'maison',
  'couleur',
  'surnom',
  'prenom',
  'nom',
]);

/** Ce qu'il faut précalculer une fois pour lire toutes les personnes. */
export class Contexte {
  readonly dataset: Dataset;
  readonly listes: Record<string, Objet>;
  readonly generations: Map<string, number>;
  readonly degres: Map<string, number>;

  constructor(dataset: Dataset) {
    this.dataset = dataset;
    this.listes = dataset.listes;

    const ids = dataset.personnes.map((p) => p.id);
    this.generations = appliquerSurcharges(
      calculerGenerations(ids, dataset.relations),
      dataset.personnes
    );

    this.degres = new Map(ids.map((identifiant) => [identifiant, 0]));
    for (const relation of dataset.relations) {
      for (const extremite of [relation.source, relation.cible]) {
        const compte = this.degres.get(extremite);
        if (compte !== undefined) this.degres.set(extremite, compte + 1);
      }
    }
  }

  /** Valeur brute : texte, nombre, liste, ou `null` si rien à dire. */
  valeur(personne: Personne, identifiant: string): unknown {
    if (identifiant.startsWith('humeur:')) {
      const note = personne.relations_joueurs?.[identifiant.slice(7)];
      return note?.note ?? null;
    }

    if (identifiant === 'humeur') {
      const notes = Object.values(personne.relations_joueurs ?? {})
        .map((n) => n.note)
        .filter((n): n is number => n !== null && n !== undefined);
      if (!notes.length) return null;
      return arrondir(notes.reduce((somme, n) => somme + n, 0) / notes.length, 1);
    }

    if (identifiant === 'maison') {
      return this.dataset.maison(personne.maison).label || personne.maison;
    }

    if (identifiant === 'categorie') {
      const categorie = this.dataset.maison(personne.maison).categorie || '';
      return categorie ? (this.dataset.categorie(String(categorie)).label ?? null) : null;
    }

    if (identifiant === 'generation') return (this.generations.get(personne.id) ?? 0) + 1;
    if (identifiant === 'liens') return this.degres.get(personne.id) ?? 0;
    if (identifiant === 'naissance' || identifiant === 'deces') return annee(personne[identifiant]);
    if (identifiant === 'nom') return personne.nomComplet;

    return CHAMPS_DIRECTS.has(identifiant)
      ? ((personne as unknown as Objet)[identifiant] ?? null)
      : null;
  }
}

/** « 283 AC » → 283, « 20 av. C » → -20. Le reste : `null`. */
export function annee(brut: unknown): number | null {
  if (brut === null || brut === undefined) return null;
  const texte = String(brut);
  const trouve = texte.match(/-?\d+/);
  if (!trouve) return null;
  const valeur = Number.parseInt(trouve[0], 10);
  return /\bav\.?|\bbc\b/i.test(texte) ? -Math.abs(valeur) : valeur;
}

function nombre(brut: unknown): number | null {
  if (typeof brut === 'boolean') return null;
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  if (typeof brut === 'string') {
    const trouve = brut.match(/-?\d+(?:[.,]\d+)?/);
    if (trouve) return versFlottant(trouve[0].replace(',', '.'));
  }
  return null;
}

/** Minuscules sans accents : comparer « Réal » et « real » doit marcher. */
function aplatir(brut: unknown): string {
  return String(brut === null || brut === undefined ? '' : brut)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * `str()` de Python appliqué à une valeur de variable.
 *
 * `flottant` dit qu'on tient une moyenne : Python écrirait « 4.0 » là où
 * JavaScript écrit « 4 ». C'est la seule différence de formatage entre les deux
 * versions, et elle se voit dans les libellés de segments.
 */
function versTexte(brut: unknown, flottant = false): string {
  if (Array.isArray(brut)) return brut.map((v) => versTexte(v, flottant)).join(', ');
  if (brut === null || brut === undefined) return '';
  if (typeof brut === 'boolean') return brut ? 'True' : 'False';
  if (typeof brut === 'number' && flottant && Number.isInteger(brut)) return `${brut}.0`;
  return String(brut);
}

/* --------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

function testUnitaire(
  valeur: unknown,
  operateur: string,
  attendu: unknown,
  listes: Record<string, Objet> = {}
): boolean {
  const vide =
    valeur === null ||
    valeur === undefined ||
    valeur === '' ||
    (Array.isArray(valeur) && valeur.length === 0);

  if (operateur === 'vide') return vide;
  if (operateur === 'non vide') return !vide;

  if (operateur === '∈' || operateur === '∉') {
    // `attendu` est l'id d'une liste nommée. Une valeur multiple (tags, titres)
    // appartient à la liste dès qu'un de ses éléments y est.
    const cle = String(attendu);
    const fiche = Object.hasOwn(listes, cle) ? (listes[cle] ?? {}) : {};
    const brutes = Array.isArray(fiche.valeurs) ? fiche.valeurs : [];
    const membres = new Set(brutes.map((v) => aplatir(v)));
    const candidats = Array.isArray(valeur) ? valeur : [valeur];
    const dedans = candidats.some((v) => membres.has(aplatir(versTexte(v))));
    return operateur === '∈' ? dedans : !dedans;
  }

  if (operateur === '<' || operateur === '≤' || operateur === '>' || operateur === '≥') {
    const gauche = nombre(valeur);
    const droite = nombre(attendu);
    if (gauche === null || droite === null) return false;
    if (operateur === '<') return gauche < droite;
    if (operateur === '≤') return gauche <= droite;
    if (operateur === '>') return gauche > droite;
    return gauche >= droite;
  }

  // Comparaisons de texte : accents et casse ignorés, listes aplaties.
  const gauche = aplatir(versTexte(valeur));
  const droite = aplatir(attendu);
  if (operateur === 'contient') return gauche.includes(droite);
  if (operateur === '≠') return gauche !== droite;
  return gauche === droite;
}

function passeLesTests(
  contexte: Contexte,
  personne: Personne,
  tests: Objet[],
  jointure: string
): boolean {
  const utiles = tests.filter((t) => t.champ && IDS_OPERATEURS.has(String(t.operateur)));
  if (!utiles.length) return true;

  const resultats = utiles.map((t) =>
    testUnitaire(
      contexte.valeur(personne, String(t.champ)),
      String(t.operateur),
      t.valeur,
      contexte.listes
    )
  );
  return jointure === 'ou' ? resultats.some(Boolean) : resultats.every(Boolean);
}

/* --------------------------------------------------------------------------
 * Couleurs : un dégradé réparti sur les segments
 * -------------------------------------------------------------------------- */

function versRvb(hexa: string): [number, number, number] {
  let propre = (hexa || '').replace(/^#+/, '');
  if (propre.length === 3) propre = [...propre].map((c) => c + c).join('');
  if (propre.length !== 6) return [63, 111, 159];
  const canaux = [0, 2, 4].map((i) => Number.parseInt(propre.slice(i, i + 2), 16));
  return canaux.some((c) => Number.isNaN(c))
    ? [63, 111, 159]
    : (canaux as [number, number, number]);
}

function enHexa(canaux: number[]): string {
  return '#' + canaux.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** `nombre` couleurs de `de` à `vers`, extrémités comprises. */
export function degrade(de: string, vers: string, combien: number): string[] {
  const depart = versRvb(de);
  const arrivee = versRvb(vers);
  if (combien <= 1) return [enHexa(depart)];

  const couleurs: string[] = [];
  for (let index = 0; index < combien; index += 1) {
    const part = index / (combien - 1);
    const canaux = [0, 1, 2].map((c) =>
      arrondir((depart[c] as number) + ((arrivee[c] as number) - (depart[c] as number)) * part)
    );
    couleurs.push(enHexa(canaux));
  }
  return couleurs;
}

/* --------------------------------------------------------------------------
 * Normalisation d'une fiche de filtre
 * -------------------------------------------------------------------------- */

function poserDefaut(fiche: Objet, cle: string, valeur: unknown): void {
  if (!Object.hasOwn(fiche, cle)) fiche[cle] = valeur;
}

/** Fusionne un patch dans une fiche de filtre, en bornant tout. */
export function appliquerFiltre(base: Objet | null, patch: Objet, rang = 0): Objet {
  const fiche: Objet = { ...(base ?? {}) };
  poserDefaut(fiche, 'ordre', rang);
  poserDefaut(fiche, 'gradient', { ...GRADIENT_DEFAUT });
  poserDefaut(fiche, 'mode', 'valeurs');
  poserDefaut(fiche, 'segments', SEGMENTS_DEFAUT);
  poserDefaut(fiche, 'retenus', []);
  poserDefaut(fiche, 'tests', []);
  poserDefaut(fiche, 'jointure', 'et');

  if (Object.hasOwn(patch, 'label')) {
    fiche.label = String(patch.label).trim() || fiche.label || 'Filtre';
  }
  if (Object.hasOwn(patch, 'variable')) {
    fiche.variable = String(patch.variable || 'maison');
  }
  if (Object.hasOwn(patch, 'mode')) {
    const mode = String(patch.mode);
    fiche.mode = (MODES as readonly string[]).includes(mode) ? mode : 'valeurs';
  }
  if (Object.hasOwn(patch, 'segments')) {
    const segments = versEntier(patch.segments);
    fiche.segments =
      segments === null
        ? SEGMENTS_DEFAUT
        : Math.max(SEGMENTS_MINIMUM, Math.min(SEGMENTS_MAXIMUM, segments));
  }
  if (Object.hasOwn(patch, 'retenus')) {
    fiche.retenus = (Array.isArray(patch.retenus) ? patch.retenus : []).map((v) => String(v));
  }
  if (Object.hasOwn(patch, 'gradient')) {
    const gradient = (patch.gradient ?? {}) as Objet;
    fiche.gradient = {
      de: String(gradient.de || GRADIENT_DEFAUT.de),
      vers: String(gradient.vers || GRADIENT_DEFAUT.vers),
    };
  }
  if (Object.hasOwn(patch, 'jointure')) {
    fiche.jointure = String(patch.jointure) === 'ou' ? 'ou' : 'et';
  }
  if (Object.hasOwn(patch, 'tests')) {
    fiche.tests = (Array.isArray(patch.tests) ? patch.tests : [])
      .filter((t): t is Objet => typeof t === 'object' && t !== null)
      .map((t) => ({
        champ: String(t.champ || ''),
        operateur: String(t.operateur || '='),
        valeur: Object.hasOwn(t, 'valeur') ? t.valeur : '',
      }))
      .filter((t) => t.champ);
  }
  if (Object.hasOwn(patch, 'ordre')) {
    const valeur = versEntier(patch.ordre);
    if (valeur !== null) fiche.ordre = valeur;
  }

  poserDefaut(fiche, 'label', 'Filtre');
  poserDefaut(fiche, 'variable', 'maison');
  return fiche;
}

/**
 * Une liste nommée : un libellé et des valeurs, rien de plus.
 *
 * Les valeurs sont du texte — celui de la variable qu'on teste (« Stark »,
 * « Winterfell »). Les doublons tombent, l'ordre de saisie tient.
 */
export function appliquerListe(base: Objet | null, patch: Objet, rang = 0): Objet {
  const fiche: Objet = { ...(base ?? {}) };
  poserDefaut(fiche, 'ordre', rang);
  poserDefaut(fiche, 'valeurs', []);
  poserDefaut(fiche, 'variable', '');

  if (Object.hasOwn(patch, 'label')) {
    fiche.label = String(patch.label).trim() || fiche.label || 'Liste';
  }
  if (Object.hasOwn(patch, 'variable')) {
    fiche.variable = String(patch.variable || '');
  }
  if (Object.hasOwn(patch, 'valeurs')) {
    const vues = new Set<string>();
    const propres: string[] = [];
    for (const valeur of Array.isArray(patch.valeurs) ? patch.valeurs : []) {
      const texte = String(valeur).trim();
      const cle = aplatir(texte);
      if (!texte || vues.has(cle)) continue;
      vues.add(cle);
      propres.push(texte);
    }
    fiche.valeurs = propres;
  }
  if (Object.hasOwn(patch, 'ordre')) {
    const valeur = versEntier(patch.ordre);
    if (valeur !== null) fiche.ordre = valeur;
  }

  poserDefaut(fiche, 'label', 'Liste');
  return fiche;
}

/**
 * Les valeurs réellement présentes pour une variable, les plus fréquentes
 * d'abord. C'est ce qui permet de composer une liste en cochant, au lieu de
 * retaper « Winterfell » sans faute.
 */
export function valeursObservees(dataset: Dataset, identifiant: string): Objet[] {
  const contexte = new Contexte(dataset);
  const flottant = estFlottante(identifiant);
  const effectifs = new Map<string, number>();
  const libelles = new Map<string, string>();

  for (const personne of dataset.personnes) {
    const valeur = contexte.valeur(personne, identifiant);
    for (const brut of Array.isArray(valeur) ? valeur : [valeur]) {
      const texte = versTexte(brut, flottant).trim();
      if (!texte) continue;
      const cle = aplatir(texte);
      if (!libelles.has(cle)) libelles.set(cle, texte);
      effectifs.set(cle, (effectifs.get(cle) ?? 0) + 1);
    }
  }

  return trierParEffectif(effectifs, libelles).map(([cle, combien]) => ({
    valeur: libelles.get(cle) as string,
    nombre: combien,
  }));
}

/** Les plus fournis d'abord, puis par libellé — l'ordre de Python, à l'identique. */
function trierParEffectif(
  effectifs: Map<string, number>,
  libelles: Map<string, string>
): [string, number][] {
  return [...effectifs.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    const ga = libelles.get(a[0]) as string;
    const gb = libelles.get(b[0]) as string;
    return ga < gb ? -1 : ga > gb ? 1 : 0;
  });
}

export function idLibre(existants: Iterable<string>, propose: string): string {
  const pris = new Set(existants);
  const base = slugifier(propose, 'filtre');
  if (!pris.has(base)) return base;
  let index = 2;
  while (pris.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/* --------------------------------------------------------------------------
 * Application : segments, couleurs, exclusions
 * -------------------------------------------------------------------------- */

type Retenue = [Personne, unknown];

export interface Segment extends Objet {
  id: string;
  label: string;
  nombre: number;
  couleur?: string;
}

/**
 * Range chaque personne dans un segment et dit qui est exclu.
 *
 * Le résultat est fait pour le front : des segments prêts à lister dans le rail,
 * et une table `id de personne -> id de segment` pour colorer sans rejouer le
 * calcul.
 */
export function appliquer(dataset: Dataset, fiche: Objet): Objet {
  const contexte = new Contexte(dataset);
  const identifiant = String(fiche.variable || 'maison');
  const meta: FicheVariable = variable(dataset, identifiant) ?? {
    id: identifiant,
    label: identifiant,
    genre: 'texte',
  };

  const tests = (Array.isArray(fiche.tests) ? fiche.tests : []) as Objet[];
  const jointure = String(fiche.jointure || 'et');

  const retenues: Retenue[] = [];
  const exclus: string[] = [];
  for (const personne of dataset.personnes) {
    if (passeLesTests(contexte, personne, tests, jointure)) {
      retenues.push([personne, contexte.valeur(personne, identifiant)]);
    } else {
      exclus.push(personne.id);
    }
  }

  const combien = versEntier(fiche.segments) || SEGMENTS_DEFAUT;
  const mode = String(fiche.mode || 'valeurs');
  const { segments, appartenance } =
    mode === 'tranches' && meta.genre !== 'texte'
      ? enTranches(retenues, combien)
      : enValeurs(retenues, combien, estFlottante(identifiant));

  const gradient = (fiche.gradient || GRADIENT_DEFAUT) as Objet;
  const couleurs = degrade(String(gradient.de ?? ''), String(gradient.vers ?? ''), segments.length);
  segments.forEach((segment, index) => {
    segment.couleur = couleurs[index] as string;
  });

  return {
    filtre: { ...fiche, variable: identifiant },
    variable: meta,
    segments,
    noeuds: appartenance,
    exclus,
    retenus: retenues.length,
  };
}

/**
 * Un segment par valeur distincte, les plus fournis d'abord.
 *
 * Au-delà de `maximum`, la traîne est ramassée dans « Autres » : trente segments
 * d'une personne ne se lisent pas.
 */
function enValeurs(
  retenues: Retenue[],
  maximum: number,
  flottant: boolean
): { segments: Segment[]; appartenance: Record<string, string> } {
  const effectifs = new Map<string, number>();
  const libelles = new Map<string, string>();
  const valeurs = new Map<string, string[]>();

  for (const [personne, valeur] of retenues) {
    for (const brut of Array.isArray(valeur) ? valeur : [valeur]) {
      const texte = versTexte(brut, flottant).trim();
      const cle = aplatir(texte) || '—';
      if (!libelles.has(cle)) libelles.set(cle, texte || 'Non renseigné');
      effectifs.set(cle, (effectifs.get(cle) ?? 0) + 1);
      const liste = valeurs.get(personne.id);
      if (liste) liste.push(cle);
      else valeurs.set(personne.id, [cle]);
    }
  }

  const ordonnees = trierParEffectif(effectifs, libelles);
  const gardees = ordonnees.slice(0, maximum).map(([cle]) => cle);
  const reste = ordonnees.slice(maximum).map(([cle]) => cle);

  const segments: Segment[] = gardees.map((cle) => ({
    id: cle,
    label: libelles.get(cle) as string,
    nombre: effectifs.get(cle) as number,
  }));

  if (reste.length) {
    segments.push({
      id: '__autres__',
      label: `Autres (${reste.length} valeur${reste.length > 1 ? 's' : ''})`,
      nombre: reste.reduce((somme, cle) => somme + (effectifs.get(cle) ?? 0), 0),
    });
  }

  const connus = new Set(gardees);
  const appartenance: Record<string, string> = {};
  for (const [personne] of retenues) {
    const cles = valeurs.get(personne.id) ?? [];
    // Une personne peut porter plusieurs tags : elle compte dans le premier
    // segment retenu, sinon dans « Autres ».
    const choisie = cles.find((c) => connus.has(c));
    appartenance[personne.id] = choisie ?? (reste.length ? '__autres__' : '—');
  }
  return { segments, appartenance };
}

/** N paquets d'égale largeur entre le minimum et le maximum observés. */
function enTranches(
  retenues: Retenue[],
  combien: number
): { segments: Segment[]; appartenance: Record<string, string> } {
  const chiffres: [Personne, number | null][] = retenues.map(([p, v]) => [p, nombre(v)]);
  const connus = chiffres.map(([, v]) => v).filter((v): v is number => v !== null);

  const segments: Segment[] = [];
  const appartenance: Record<string, string> = {};

  if (!connus.length) {
    for (const [personne] of retenues) appartenance[personne.id] = '—';
    return {
      segments: [{ id: '—', label: 'Non renseigné', nombre: retenues.length }],
      appartenance,
    };
  }

  const minimum = Math.min(...connus);
  const maximum = Math.max(...connus);

  // Des entiers qui tiennent dans le nombre de paquets demandé : une tranche par
  // valeur. « Génération 1 » se lit mieux que « 1 → 1,2 ».
  const entiers = connus.every((v) => Number.isInteger(v));
  let bornes: [number, number][] = [];
  let largeur = 0;

  if (entiers && maximum - minimum + 1 <= combien) {
    for (let v = minimum; v <= maximum; v += 1) bornes.push([v, v]);
  } else {
    largeur = maximum > minimum ? (maximum - minimum) / combien : 0;
    bornes = [];
    const paquets = largeur ? combien : 1;
    for (let index = 0; index < paquets; index += 1) {
      const debut = minimum + largeur * index;
      const fin = largeur ? minimum + largeur * (index + 1) : maximum;
      bornes.push([debut, fin]);
    }
  }

  const effectifs = new Array<number>(bornes.length).fill(0);
  let sansValeur = 0;

  for (const [personne, valeur] of chiffres) {
    if (valeur === null) {
      appartenance[personne.id] = '—';
      sansValeur += 1;
      continue;
    }
    let index: number;
    if (largeur) {
      index = Math.min(Math.trunc((valeur - minimum) / largeur), bornes.length - 1);
    } else {
      // Une borne par valeur : on cherche la sienne, sinon la plus proche. Le
      // premier minimum gagne, comme `min()` en Python.
      index = 0;
      let meilleure = Math.abs((bornes[0] as [number, number])[0] - valeur);
      for (let i = 1; i < bornes.length; i += 1) {
        const distance = Math.abs((bornes[i] as [number, number])[0] - valeur);
        if (distance < meilleure) {
          meilleure = distance;
          index = i;
        }
      }
    }
    appartenance[personne.id] = String(index);
    effectifs[index] = (effectifs[index] ?? 0) + 1;
  }

  bornes.forEach(([debut, fin], index) => {
    segments.push({
      id: String(index),
      label: libelleTranche(debut, fin),
      nombre: effectifs[index] as number,
    });
  });
  if (sansValeur) segments.push({ id: '—', label: 'Non renseigné', nombre: sansValeur });

  return { segments, appartenance };
}

function libelleTranche(debut: number, fin: number): string {
  const joli = (valeur: number): string =>
    Number.isInteger(valeur) ? String(Math.trunc(valeur)) : arrondir(valeur, 1).toFixed(1);
  return debut === fin ? joli(debut) : `${joli(debut)} → ${joli(fin)}`;
}
