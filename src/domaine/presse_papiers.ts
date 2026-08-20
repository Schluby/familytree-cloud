/**
 * Copier un morceau de plan, le coller ailleurs (lot 23.B).
 *
 * Prendre quelques fiches et leurs liens, et les reposer — dans le même monde,
 * dans un autre des siens, ou chez quelqu'un d'autre à qui on a passé le texte.
 * C'est le geste qu'on fait entre deux campagnes : « la maison Frey me
 * resservira », « ces trois-là viennent avec moi ».
 *
 * ── Ce qu'un extrait emporte, et pourquoi ────────────────────────────────────
 *
 * Une fiche seule ne veut pas dire grand-chose : elle appartient à une maison,
 * ses liens ont un type, et ni l'une ni l'autre n'existent forcément là où on
 * colle. L'extrait emporte donc **les référentiels dont il se sert** — les
 * maisons citées, les types de lien cités — et le collage recrée ce qui manque
 * sans jamais écraser ce qui est déjà là : une maison « stark » qui existe déjà
 * chez l'hôte est la sienne, pas celle qu'on apporte.
 *
 * Il n'emporte **pas les portraits**. Une image tient dans une fiche mais pas
 * dans un message : trois portraits et l'extrait passe de six kilo-octets à
 * quatre cents, ce qui rend illusoire le « je te l'envoie ». Les fiches
 * arrivent sans visage, et c'est un choix, pas un oubli.
 *
 * ── Les liens qui sortent de la sélection ────────────────────────────────────
 *
 * Un lien dont un seul bout est copié pose une question sans bonne réponse :
 * l'oublier, c'est perdre l'information qu'il existait ; le garder, c'est
 * pointer vers quelqu'un qu'on n'a pas. On garde, et on crée à l'arrivée une
 * **fiche de rappel** portant le nom de l'absent et rien d'autre. Elle dit
 * « il y avait là quelqu'un » — ce qui est précisément ce qu'on veut savoir —
 * et se supprime d'un clic si on ne veut pas d'elle.
 */

import { Dataset, Personne, Relation, idsLibres, type Objet } from './models';

/** La signature d'un extrait, pour reconnaître un texte collé. */
export const FORMAT = 'familytree/extrait';
export const VERSION = 1;

/** Au-delà, ce n'est plus un extrait, c'est un déménagement : qu'on exporte. */
export const MAX_FICHES = 200;

/** Refus explicite, affichable tel quel. */
export class ErreurExtrait extends Error {}

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/**
 * Prépare le texte à emporter.
 *
 * Pure : elle ne touche pas au monde d'origine. Ce qu'elle rend est du JSON
 * ordinaire, lisible à l'œil et recollable ailleurs.
 */
export function extraire(dataset: Dataset, idsDemandes: string[]): Objet {
  const choisies = new Set(idsDemandes);
  const personnes = dataset.personnes.filter((personne) => choisies.has(personne.id));
  if (!personnes.length) throw new ErreurExtrait('aucune fiche à copier');
  if (personnes.length > MAX_FICHES) {
    throw new ErreurExtrait(`${MAX_FICHES} fiches au plus dans un extrait`);
  }
  // Ce qui a été demandé mais n'existe pas ne doit pas rester dans l'ensemble :
  // sinon un lien vers une fiche disparue passerait pour « dedans ».
  const dedans = new Set(personnes.map((personne) => personne.id));

  const nomDe = (id: string) => dataset.personne(id)?.nomComplet || '';

  const liens: Objet[] = [];
  for (const relation of dataset.relations) {
    const source = dedans.has(relation.source);
    const cible = dedans.has(relation.cible);
    if (!source && !cible) continue;
    const brut = relation.versDict();
    if (source && cible) {
      liens.push(brut);
      continue;
    }
    // Un seul bout : on note lequel manque et sous quel nom, pour la fiche de
    // rappel que le collage fabriquera.
    liens.push({
      ...brut,
      absent: source ? 'cible' : 'source',
      absent_nom: nomDe(source ? relation.cible : relation.source),
    });
  }

  // Les référentiels cités, et eux seuls : emporter tout le catalogue ferait
  // arriver quarante maisons pour trois fiches.
  const maisons: Objet = {};
  for (const personne of personnes) {
    const id = String(personne.maison || '');
    if (id && dataset.maisons[id] && !maisons[id]) maisons[id] = dataset.maisons[id];
  }
  const types: Objet = {};
  for (const lien of liens) {
    const id = String(lien.type || '');
    if (id && dataset.types_relations[id] && !types[id]) types[id] = dataset.types_relations[id];
  }

  return {
    format: FORMAT,
    version: VERSION,
    // Sans valeur pour la machine ; utile à qui reçoit le texte et se demande
    // d'où il sort.
    origine: String(dataset.meta?.sauvegarde || dataset.meta?.titre || ''),
    personnes: personnes.map((personne) => {
      const brut = personne.versDict();
      delete brut.avatar; // voir l'entête : un extrait doit rester un texte
      return brut;
    }),
    relations: liens,
    maisons,
    types_relations: types,
  };
}

/** Ce qu'on rend à l'appelant après un collage. */
export interface Collage {
  personnes: string[];
  rappels: string[];
  relations: number;
  maisons: number;
  types: number;
}

/**
 * Repose un extrait dans un monde.
 *
 * `point` est l'endroit du plan où l'on veut voir arriver le groupe : les
 * fiches y sont translatées **en bloc**, ce qui préserve la forme qu'elles
 * avaient. Sans lui, elles retomberaient à leurs coordonnées d'origine, qui ne
 * veulent rien dire dans un autre monde.
 */
export function coller(
  dataset: Dataset,
  brut: unknown,
  point?: { x: number; y: number },
  /**
   * Créer les fiches de rappel pour les liens qui sortaient de la sélection.
   *
   * Vrai par défaut : c'est ce qui a été demandé, et c'est le comportement qui
   * ne perd rien. Mais il faut pouvoir le refuser — copier deux Stark emporte
   * vingt-deux liens vers des enfants et des bannerets qu'on n'a pas pris, donc
   * vingt fiches de rappel pour deux vraies. Quand on voulait juste deux fiches,
   * c'est du bruit.
   */
  rappelsDemandes = true
): Collage {
  if (!estObjet(brut) || brut.format !== FORMAT) {
    throw new ErreurExtrait('ce texte n’est pas un extrait de sociogramme');
  }
  const personnesBrutes = Array.isArray(brut.personnes) ? brut.personnes : [];
  if (!personnesBrutes.length) throw new ErreurExtrait('extrait vide');
  if (personnesBrutes.length > MAX_FICHES) {
    throw new ErreurExtrait(`${MAX_FICHES} fiches au plus dans un extrait`);
  }

  const resultat: Collage = { personnes: [], rappels: [], relations: 0, maisons: 0, types: 0 };

  /* -------------------------------------------------- les référentiels d'abord
   *
   * On ne remplace jamais ce que l'hôte possède déjà : si « stark » existe ici,
   * c'est *sa* maison Stark qui l'emporte, avec sa couleur et son blason. On
   * n'ajoute que ce qui manque. Coller ne doit pas repeindre le monde d'accueil.
   */
  const maisons = estObjet(brut.maisons) ? brut.maisons : {};
  for (const [id, fiche] of Object.entries(maisons)) {
    if (dataset.maisons[id] || !estObjet(fiche)) continue;
    dataset.maisons[id] = { ...fiche, id };
    resultat.maisons += 1;
  }
  const types = estObjet(brut.types_relations) ? brut.types_relations : {};
  for (const [id, fiche] of Object.entries(types)) {
    if (dataset.types_relations[id] || !estObjet(fiche)) continue;
    dataset.types_relations[id] = { ...fiche, id };
    resultat.types += 1;
  }

  /* ------------------------------------------------------------- les fiches
   *
   * Chaque identifiant est renégocié : coller deux fois le même extrait dans le
   * même monde doit donner deux groupes distincts, pas un seul écrasé.
   */
  const pris = new Set(dataset.personnes.map((personne) => personne.id));
  const nouveauId = new Map<string, string>();

  // Le coin haut-gauche du groupe, pour le reposer sous le curseur sans le
  // déformer. Les fiches sans position suivent le mouvement à zéro.
  const positions = personnesBrutes
    .map((fiche) => (estObjet(fiche) ? fiche.position : null))
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2);
  const coinX = positions.length ? Math.min(...positions.map((p) => Number(p[0]))) : 0;
  const coinY = positions.length ? Math.min(...positions.map((p) => Number(p[1]))) : 0;
  const ecartX = point ? Math.round(point.x - coinX) : 0;
  const ecartY = point ? Math.round(point.y - coinY) : 0;

  for (const fiche of personnesBrutes) {
    if (!estObjet(fiche)) continue;
    const ancien = String(fiche.id || '');
    const donnees: Objet = { ...fiche };
    delete donnees.avatar;
    const id = idsLibres(pris, ancien || 'fiche');
    pris.add(id);
    donnees.id = id;
    if (Array.isArray(fiche.position) && fiche.position.length === 2) {
      donnees.position = [Number(fiche.position[0]) + ecartX, Number(fiche.position[1]) + ecartY];
    }
    // Un déport d'avant le lot 22 n'a aucun sens ici : il visait une mise en
    // page qui n'existe pas dans ce monde.
    delete donnees.decalage;
    const personne = Personne.depuisDict(donnees);
    dataset.personnes.push(personne);
    if (ancien) nouveauId.set(ancien, id);
    resultat.personnes.push(id);
  }

  /* ------------------------------------------------------------- les liens */
  const prisRelations = new Set(dataset.relations.map((relation) => relation.id));
  const rappels = new Map<string, string>(); // ancien id absent -> fiche de rappel

  /** La fiche de rappel d'un absent : son nom, et rien d'autre. */
  const rappelPour = (ancien: string, nom: string) => {
    const dejaLa = rappels.get(ancien);
    if (dejaLa) return dejaLa;
    const id = idsLibres(pris, ancien || 'absent');
    pris.add(id);
    const personne = Personne.depuisDict({
      id,
      // Un nom vide rendrait la fiche introuvable dans la liste et impossible à
      // désigner. Celui de l'absent est ce qui reste de plus vrai.
      nom: nom || '?',
      notes: 'Fiche de rappel : le lien venait d’un extrait, cette personne n’a pas été copiée.',
    });
    dataset.personnes.push(personne);
    rappels.set(ancien, id);
    resultat.rappels.push(id);
    return id;
  };

  for (const lien of Array.isArray(brut.relations) ? brut.relations : []) {
    if (!estObjet(lien)) continue;
    const donnees: Objet = { ...lien };
    const absent = String(lien.absent || '');
    if (absent && !rappelsDemandes) continue;
    delete donnees.absent;
    delete donnees.absent_nom;

    const bout = (cote: 'source' | 'cible') => {
      const ancien = String(lien[cote] || '');
      if (absent === cote) return rappelPour(ancien, String(lien.absent_nom || ''));
      return nouveauId.get(ancien) || '';
    };
    const source = bout('source');
    const cible = bout('cible');
    // Les deux bouts doivent exister : un lien qui pend ne se dessine pas et
    // fait trébucher la généalogie.
    if (!source || !cible) continue;

    donnees.source = source;
    donnees.cible = cible;
    donnees.id = idsLibres(prisRelations, `${source}-${lien.type || 'autre'}-${cible}`);
    prisRelations.add(String(donnees.id));
    dataset.relations.push(Relation.depuisDict(donnees));
    resultat.relations += 1;
  }

  dataset.oublierIndex();
  return resultat;
}
