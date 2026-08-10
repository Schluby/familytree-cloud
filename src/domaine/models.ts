/**
 * Modèles de données — port de `backend/models.py`.
 *
 * Mêmes noms qu'en Python, exprès : les deux versions doivent pouvoir se
 * relire côte à côte, sinon la première divergence passera inaperçue.
 *
 * Le domaine ne connaît AUCUN détail de rendu. Il expose un jeu de données
 * (personnes + relations + référentiels) et des « vues » (`vues/`) qui le
 * transforment en payload prêt à dessiner.
 *
 * Toutes les clés métier sont en français : elles collent au domaine et aux
 * fichiers de sauvegarde. Les champs inconnus sont conservés tels quels dans
 * `extra` — **on ne perd jamais de donnée à l'écriture**, y compris celle
 * qu'une version future ajouterait et que celle-ci ne comprend pas.
 */

import * as echelle from './humeur';
import * as migrations from './migrations';
import * as portraits from './portraits';
import { arrondir, estVide, versEntier, versFlottant } from './python';

export type Objet = Record<string, unknown>;

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** `str(x or "")` de Python : une valeur creuse devient la chaîne vide. */
function texteOuVide(valeur: unknown, secours = ''): string {
  return valeur ? String(valeur) : secours;
}

/**
 * Lecture d'un catalogue **par propriété propre**.
 *
 * `catalogue[cle]` ne suffit pas : le document vient de l'utilisateur, et une
 * clé comme `__proto__` ou `toString` remonterait un objet du prototype au lieu
 * de rien. En Python, un `dict` n'a pas ce piège — c'est une divergence qu'il
 * faut fermer à la main.
 */
function entree(catalogue: Record<string, Objet>, cle: string): Objet | null {
  return Object.hasOwn(catalogue, cle) ? (catalogue[cle] ?? null) : null;
}

/* --------------------------------------------------------------------------
 * Personnes
 * -------------------------------------------------------------------------- */

export const PERSONNE_CHAMPS = [
  'id',
  'prenom',
  'nom',
  'surnom',
  'maison',
  'titres',
  'genre',
  'statut',
  'naissance',
  'deces',
  'lieu',
  'importance',
  'avatar',
  'couleur',
  'notes',
  'tags',
  'relations_joueurs',
  'decalage',
  'generation',
] as const;

export const STATUTS = ['vivant', 'mort', 'inconnu'] as const;

/** Champs librement éditables depuis l'API (`PATCH /api/personnes/<id>`). */
export const PERSONNE_CHAMPS_EDITABLES = PERSONNE_CHAMPS.filter((champ) => champ !== 'id');

const CHAMPS_PERSONNE = new Set<string>(PERSONNE_CHAMPS);
const EDITABLES_PERSONNE = new Set<string>(PERSONNE_CHAMPS_EDITABLES);

/**
 * Génération forcée à la main. `null` = laisser la généalogie décider.
 *
 * On stocke le numéro tel qu'il s'affiche (« Génération 3 »), pas l'indice
 * interne : c'est ce que quelqu'un tape dans la fiche.
 */
export function normaliserGeneration(brut: unknown): number | null {
  if (brut === null || brut === undefined || brut === '') return null;
  const valeur = versEntier(brut);
  if (valeur === null) return null;
  return Math.max(1, Math.min(99, valeur));
}

/**
 * Déplacement manuel d'une fiche : `[dx, dy]` en unités du plan.
 *
 * C'est un *écart* à la position calculée, pas une position absolue : quand la
 * mise en page change (filtre, nouvelle personne), la fiche garde son déport
 * relatif au lieu d'atterrir n'importe où.
 */
export function normaliserDecalage(brut: unknown): [number, number] | null {
  if (estVide(brut)) return null;

  let paire: unknown[];
  if (estObjet(brut)) {
    paire = [brut.dx ?? 0, brut.dy ?? 0];
  } else if (Array.isArray(brut)) {
    paire = brut;
  } else {
    return null;
  }

  if (paire.length !== 2) return null;
  const dxBrut = versFlottant(paire[0]);
  const dyBrut = versFlottant(paire[1]);
  if (dxBrut === null || dyBrut === null) return null;

  const dx = arrondir(dxBrut, 1);
  const dy = arrondir(dyBrut, 1);
  return dx === 0 && dy === 0 ? null : [dx, dy];
}

/**
 * Accepte `{"j1": 4}` ou `{"j1": {"note": 4, "commentaire": "…"}}`.
 *
 * Renvoie toujours la forme complète, ce qui évite au front de gérer deux
 * formats. `note` est une humeur (1 affectueux → 7 malveillant) ; `null`
 * signifie « pas encore rencontré ».
 */
export interface NoteJoueur {
  note: number | null;
  commentaire: string;
}

export function normaliserRelationsJoueurs(brut: unknown): Record<string, NoteJoueur> {
  const resultat: Record<string, NoteJoueur> = {};
  if (!estObjet(brut)) return resultat;

  for (const [joueurId, valeur] of Object.entries(brut)) {
    let note: unknown;
    let commentaire: unknown;
    if (estObjet(valeur)) {
      note = valeur.note;
      commentaire = valeur.commentaire || '';
    } else {
      note = valeur;
      commentaire = '';
    }
    resultat[String(joueurId)] = {
      note: echelle.normaliser(note, null),
      commentaire: String(commentaire),
    };
  }
  return resultat;
}

export class Personne {
  id = '';
  prenom = '';
  nom = '';
  surnom = '';
  maison = 'autre';
  titres: unknown[] = [];
  genre = 'inconnu';
  statut = 'inconnu';
  naissance: string | null = null;
  deces: string | null = null;
  lieu = '';
  importance = 3;
  avatar: string | null = null;
  couleur: string | null = null;
  notes = '';
  tags: unknown[] = [];
  relations_joueurs: Record<string, NoteJoueur> = {};
  decalage: [number, number] | null = null;
  /**
   * Vide : la généalogie la calcule. Renseignée : elle gagne (personnages
   * rapportés, générations sautées — ce que l'arbre ne peut pas deviner).
   */
  generation: number | null = null;
  extra: Objet = {};

  static depuisDict(donnees: Objet): Personne {
    const personne = new Personne();
    const extra: Objet = {};

    for (const [cle, valeur] of Object.entries(donnees)) {
      if (CHAMPS_PERSONNE.has(cle)) {
        (personne as unknown as Objet)[cle] = valeur;
      } else {
        extra[cle] = valeur;
      }
    }
    personne.extra = extra;

    personne.id = texteOuVide(personne.id).trim();
    personne.titres = Array.isArray(personne.titres) ? [...personne.titres] : [];
    personne.tags = Array.isArray(personne.tags) ? [...personne.tags] : [];
    personne.relations_joueurs = normaliserRelationsJoueurs(personne.relations_joueurs);
    personne.decalage = normaliserDecalage(personne.decalage);
    personne.generation = normaliserGeneration(personne.generation);

    // Tolérant à la lecture : une sauvegarde bricolée à la main doit s'ouvrir
    // quand même. C'est `appliquerPatch` qui refuse un portrait douteux, au
    // moment où quelqu'un l'ajoute.
    const avatar: unknown = personne.avatar;
    personne.avatar = typeof avatar === 'string' && avatar ? avatar : null;

    const statut = texteOuVide(personne.statut, 'inconnu').toLowerCase();
    personne.statut = (STATUTS as readonly string[]).includes(statut) ? statut : 'inconnu';

    const importance = versEntier(personne.importance ?? 3);
    personne.importance = importance === null ? 3 : Math.max(1, Math.min(5, importance));

    return personne;
  }

  versDict(): Objet {
    return {
      id: this.id,
      prenom: this.prenom,
      nom: this.nom,
      surnom: this.surnom,
      maison: this.maison,
      titres: this.titres,
      genre: this.genre,
      statut: this.statut,
      naissance: this.naissance,
      deces: this.deces,
      lieu: this.lieu,
      importance: this.importance,
      avatar: this.avatar,
      couleur: this.couleur,
      notes: this.notes,
      tags: this.tags,
      relations_joueurs: this.relations_joueurs,
      decalage: this.decalage,
      generation: this.generation,
      ...this.extra,
    };
  }

  get nomComplet(): string {
    const parties = [this.prenom, this.nom].filter(Boolean);
    return parties.join(' ') || this.id;
  }

  get initiales(): string {
    const source = [this.prenom, this.nom].filter(Boolean);
    const mots = source.length ? source : [this.id];
    // Indexation par point de code, comme Python : `mot[0]` d'un prénom
    // accentué doit rendre la lettre, pas la moitié d'une paire de substitution.
    return mots
      .map((mot) => Array.from(String(mot))[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  /** Applique un patch partiel. Renvoie la liste des champs modifiés. */
  appliquerPatch(patch: Objet): string[] {
    const modifies: string[] = [];

    for (const [champ, brut] of Object.entries(patch)) {
      if (!EDITABLES_PERSONNE.has(champ)) continue;

      let valeur: unknown = brut;
      if (champ === 'relations_joueurs') {
        valeur = normaliserRelationsJoueurs(brut);
      } else if (champ === 'decalage') {
        valeur = normaliserDecalage(brut);
      } else if (champ === 'generation') {
        valeur = normaliserGeneration(brut);
      } else if (champ === 'titres' || champ === 'tags') {
        valeur = (Array.isArray(brut) ? brut : []).map((v) => String(v));
      } else if (champ === 'avatar') {
        valeur = portraits.normaliser(brut); // ErreurPortrait → 400 côté API
      } else if (champ === 'importance') {
        const entier = versEntier(brut);
        if (entier === null) continue;
        valeur = Math.max(1, Math.min(5, entier));
      } else if (champ === 'statut') {
        const statut = String(brut).toLowerCase();
        if (!(STATUTS as readonly string[]).includes(statut)) continue;
        valeur = statut;
      }

      const courant = (this as unknown as Objet)[champ];
      if (!memeValeur(courant, valeur)) {
        (this as unknown as Objet)[champ] = valeur;
        modifies.push(champ);
      }
    }
    return modifies;
  }
}

/* --------------------------------------------------------------------------
 * Relations
 * -------------------------------------------------------------------------- */

/**
 * `intensite` (ancien « niveau du lien » 1-5) n'est plus un champ connu : elle
 * tombe donc dans `extra`, où elle est relue et réécrite sans qu'on y touche.
 * Rien n'est perdu, et plus rien ne s'en sert.
 */
export const RELATION_CHAMPS = [
  'id',
  'source',
  'cible',
  'type',
  'humeur',
  'label',
  'notes',
  'secret',
  'dirige',
  'depuis',
  'jusqu_a',
  // Ajoutés au lot 8 : un lien peut être **révolu** (ancien vassal, serment
  // rompu) sans qu'on sache toujours dire depuis quand — d'où un booléen, et
  // pas une simple lecture de `jusqu_a`. `lieu` sert aux liens d'événement :
  // une bataille se rappelle par l'endroit où elle a eu lieu.
  'revolu',
  'lieu',
] as const;

export const RELATION_CHAMPS_EDITABLES = RELATION_CHAMPS.filter((champ) => champ !== 'id');

const CHAMPS_RELATION = new Set<string>(RELATION_CHAMPS);
const EDITABLES_RELATION = new Set<string>(RELATION_CHAMPS_EDITABLES);

export class Relation {
  id = '';
  source = '';
  cible = '';
  type = 'autre';
  humeur: number = echelle.DEFAUT;
  label = '';
  notes = '';
  secret = false;
  /** `null` : on suit le catalogue de types. */
  dirige: boolean | null = null;
  depuis: string | null = null;
  jusqu_a: string | null = null;
  /** Le lien a existé, il n'existe plus. Voir `RELATION_CHAMPS`. */
  revolu = false;
  lieu = '';
  extra: Objet = {};

  static depuisDict(donnees: Objet): Relation {
    const relation = new Relation();
    const extra: Objet = {};

    for (const [cle, valeur] of Object.entries(donnees)) {
      if (CHAMPS_RELATION.has(cle)) {
        (relation as unknown as Objet)[cle] = valeur;
      } else {
        extra[cle] = valeur;
      }
    }
    relation.extra = extra;

    relation.id = texteOuVide(relation.id).trim();
    relation.source = texteOuVide(relation.source);
    relation.cible = texteOuVide(relation.cible);
    relation.secret = Boolean(relation.secret);
    relation.revolu = Boolean(relation.revolu);
    relation.lieu = texteOuVide(relation.lieu);
    relation.humeur = echelle.normaliser(relation.humeur) as number;

    return relation;
  }

  /**
   * `revolu` et `lieu` ne s'écrivent que lorsqu'ils portent quelque chose.
   *
   * Ce n'est pas de la coquetterie : un document qui n'utilise pas ces champs
   * doit ressortir **octet pour octet** comme il est entré. C'est ce qui permet
   * à une sauvegarde d'aller et venir entre la version en ligne et la version
   * locale sans grossir d'un champ à chaque aller-retour, et c'est ce qui garde
   * `outils/comparer.mjs` muet sur tout ce qui ne touche pas au lot 8.
   */
  versDict(): Objet {
    return {
      id: this.id,
      source: this.source,
      cible: this.cible,
      type: this.type,
      humeur: this.humeur,
      label: this.label,
      notes: this.notes,
      secret: this.secret,
      dirige: this.dirige,
      depuis: this.depuis,
      jusqu_a: this.jusqu_a,
      ...(this.revolu ? { revolu: true } : {}),
      ...(this.lieu ? { lieu: this.lieu } : {}),
      ...this.extra,
    };
  }

  appliquerPatch(patch: Objet): string[] {
    const modifies: string[] = [];

    for (const [champ, brut] of Object.entries(patch)) {
      if (!EDITABLES_RELATION.has(champ)) continue;

      let valeur: unknown = brut;
      if (champ === 'humeur') valeur = echelle.normaliser(brut);
      else if (champ === 'secret' || champ === 'revolu') valeur = Boolean(brut);
      else if (champ === 'lieu') valeur = texteOuVide(brut);

      const courant = (this as unknown as Objet)[champ];
      if (!memeValeur(courant, valeur)) {
        (this as unknown as Objet)[champ] = valeur;
        modifies.push(champ);
      }
    }
    return modifies;
  }
}

/**
 * `!=` de Python sur les valeurs qu'on manipule ici : les listes et les
 * dictionnaires se comparent **par contenu**, pas par identité. Sans ça, tout
 * patch portant `tags` ou `relations_joueurs` se croirait modifiant, et le
 * document serait réécrit à chaque frappe.
 */
function memeValeur(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/* --------------------------------------------------------------------------
 * Jeu de données complet
 * -------------------------------------------------------------------------- */

export interface TypeRelation extends Objet {
  label?: string;
  couleur?: string;
  dirige?: boolean;
  categorie?: string;
  style?: string;
}

/** Un univers complet : personnes, relations et référentiels. */
export class Dataset {
  meta: Objet = {};
  types_relations: Record<string, Objet> = {};
  maisons: Record<string, Objet> = {};
  /**
   * Regroupements de maisons, définis par l'utilisateur (« Grandes maisons »,
   * « Ordres »…). Un axe de couleur et de filtre de plus.
   */
  categories: Record<string, Objet> = {};
  /**
   * Filtres sur mesure : une variable, des segments, un dégradé, des tests.
   * Voir `filtres.ts` pour ce que chaque champ veut dire.
   */
  filtres: Record<string, Objet> = {};
  /**
   * Listes nommées de valeurs (« Maisons du Nord », « Ports »), utilisées par
   * les tests « appartient à » des filtres.
   */
  listes: Record<string, Objet> = {};
  joueurs: Objet[] = [];
  personnes: Personne[] = [];
  relations: Relation[] = [];

  /** Construit une fois par requête, et réutilisé : c'est du CPU en moins. */
  private _index: Map<string, Personne> | null = null;

  indexPersonnes(): Map<string, Personne> {
    if (!this._index) this._index = new Map(this.personnes.map((p) => [p.id, p]));
    return this._index;
  }

  /** À appeler après toute modification de `personnes`. */
  oublierIndex(): void {
    this._index = null;
  }

  personne(personneId: string): Personne | null {
    return this.indexPersonnes().get(personneId) ?? null;
  }

  relation(relationId: string): Relation | null {
    return this.relations.find((r) => r.id === relationId) ?? null;
  }

  relationsDe(personneId: string): Relation[] {
    return this.relations.filter((r) => r.source === personneId || r.cible === personneId);
  }

  /** Ensemble des ids atteignables en `profondeur` sauts (ego-network). */
  voisins(personneId: string, profondeur = 1): Set<string> {
    const atteints = new Set<string>([personneId]);
    let frontiere = new Set<string>([personneId]);

    for (let pas = 0; pas < Math.max(0, profondeur); pas += 1) {
      const suivante = new Set<string>();
      for (const rel of this.relations) {
        if (frontiere.has(rel.source)) suivante.add(rel.cible);
        if (frontiere.has(rel.cible)) suivante.add(rel.source);
      }
      for (const deja of atteints) suivante.delete(deja);
      if (!suivante.size) break;
      for (const nouveau of suivante) atteints.add(nouveau);
      frontiere = suivante;
    }
    return atteints;
  }

  typeRelation(typeId: string): TypeRelation {
    return (
      entree(this.types_relations, typeId) ?? {
        label: typeId,
        couleur: '#8a8f98',
        dirige: false,
        categorie: 'autre',
        style: 'solide',
      }
    );
  }

  categorie(categorieId: string): Objet {
    return (
      entree(this.categories, categorieId || '') ?? {
        label: 'Sans catégorie',
        couleur: '#8a8f98',
      }
    );
  }

  maison(maisonId: string): Objet {
    return (
      entree(this.maisons, maisonId || 'autre') ?? {
        label: maisonId || 'Sans maison',
        couleur: '#7a7f87',
      }
    );
  }

  estDirigee(relation: Relation): boolean {
    if (relation.dirige !== null && relation.dirige !== undefined) return Boolean(relation.dirige);
    return Boolean(this.typeRelation(relation.type).dirige);
  }

  static depuisDict(donnees: Objet): Dataset {
    // Toutes les ouvertures passent par ici : c'est le seul endroit où poser la
    // migration pour être certain qu'aucune sauvegarde n'y échappe.
    migrations.appliquer(donnees);

    const jeu = new Dataset();
    jeu.meta = { ...(estObjet(donnees.meta) ? donnees.meta : {}) };
    jeu.types_relations = copierCatalogue(donnees.types_relations);
    jeu.maisons = copierCatalogue(donnees.maisons);
    jeu.categories = copierCatalogue(donnees.categories);
    jeu.filtres = copierCatalogue(donnees.filtres);
    jeu.listes = copierCatalogue(donnees.listes);
    jeu.joueurs = Array.isArray(donnees.joueurs) ? [...(donnees.joueurs as Objet[])] : [];
    // `filter(estObjet)` : Python planterait sur une entrée qui n'est pas un
    // dictionnaire. On préfère l'ignorer — un document bricolé à la main doit
    // s'ouvrir, et l'application ne peut pas en produire un pareil.
    jeu.personnes = (Array.isArray(donnees.personnes) ? donnees.personnes : [])
      .filter(estObjet)
      .map((p) => Personne.depuisDict(p));
    jeu.relations = (Array.isArray(donnees.relations) ? donnees.relations : [])
      .filter(estObjet)
      .map((r) => Relation.depuisDict(r));
    return jeu;
  }

  versDict(): Objet {
    return {
      meta: this.meta,
      types_relations: this.types_relations,
      maisons: this.maisons,
      categories: this.categories,
      filtres: this.filtres,
      listes: this.listes,
      joueurs: this.joueurs,
      personnes: this.personnes.map((p) => p.versDict()),
      relations: this.relations.map((r) => r.versDict()),
    };
  }

  /** Contrôles non bloquants, exposés par `/api/sante`. */
  incoherences(): string[] {
    const problemes: string[] = [];

    const ids = this.personnes.map((p) => p.id);
    const vus = new Set<string>();
    const doublons = new Set<string>();
    for (const identifiant of ids) {
      if (vus.has(identifiant)) doublons.add(identifiant);
      vus.add(identifiant);
    }
    for (const doublon of [...doublons].sort()) {
      problemes.push(`id de personne en double : ${doublon}`);
    }

    for (const rel of this.relations) {
      if (!vus.has(rel.source)) {
        problemes.push(`relation ${rel.id} : source inconnue (${rel.source})`);
      }
      if (!vus.has(rel.cible)) {
        problemes.push(`relation ${rel.id} : cible inconnue (${rel.cible})`);
      }
      if (!Object.hasOwn(this.types_relations, rel.type)) {
        problemes.push(`relation ${rel.id} : type inconnu (${rel.type})`);
      }
    }

    for (const personne of this.personnes) {
      if (personne.maison && !Object.hasOwn(this.maisons, personne.maison)) {
        problemes.push(`personne ${personne.id} : maison inconnue (${personne.maison})`);
      }
    }
    return problemes;
  }
}

function copierCatalogue(brut: unknown): Record<string, Objet> {
  return estObjet(brut) ? ({ ...brut } as Record<string, Objet>) : {};
}

/* --------------------------------------------------------------------------
 * Identifiants
 * -------------------------------------------------------------------------- */

/** `Maison Stark` → `maison-stark` : de quoi fabriquer un id lisible. */
export function slugifier(texte: string, defaut = 'personne'): string {
  const sansAccent = String(texte || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, ''); // tout ce que Python appelle « combining »
  const propre = sansAccent
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return propre || defaut;
}

/** Génère un id unique de type `base`, `base-2`, `base-3`… */
export function idsLibres(existants: Iterable<string>, base: string): string {
  const pris = new Set(existants);
  if (!pris.has(base)) return base;
  let compteur = 2;
  while (pris.has(`${base}-${compteur}`)) compteur += 1;
  return `${base}-${compteur}`;
}
