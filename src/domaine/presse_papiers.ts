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
 * Ils ne sont **pas** copiés. Un extrait ne contient que les liens dont les deux
 * bouts sont là.
 *
 * Le lot 23.B avait tranché l'inverse : le lien était gardé et l'absent devenait
 * une « fiche de rappel » portant son nom. C'était fidèle à la demande, et
 * mauvais à l'usage — deux Stark traînent vingt-deux liens vers des enfants et
 * des bannerets qu'on n'a pas pris, donc une vingtaine de fiches fantômes pour
 * deux vraies. On copie ce qu'on a montré du doigt, rien de plus.
 *
 * ── Ce qu'on copie, et ce qu'on ne copie pas ─────────────────────────────────
 *
 * `profils` et `liens` disent lesquelles des deux moitiés partent. Les régler à
 * la copie plutôt qu'au collage est un choix : on sait ce qu'on prend au moment
 * où on le prend, et le texte obtenu ne réserve pas de surprise à qui le colle.
 *
 * Sans les profils, il ne reste que des liens : ils se posent alors entre des
 * fiches **qui existent déjà** chez l'hôte, retrouvées par leur identifiant. De
 * quoi rejouer un réseau de relations sur un monde qu'on a par ailleurs.
 *
 * ── Les formes de fond (lot 26.B) ───────────────────────────────────────────
 *
 * Elles voyagent aussi, et **seulement celles qu'on a montrées du doigt**. Une
 * forme ne contient personne (voir `formes.ts`) : rien ne permettrait de
 * deviner laquelle « accompagne » un groupe de fiches, et prendre tout ce qui
 * les recouvre emporterait le grand rectangle du Nord avec deux Stark.
 *
 * Leur portée, en revanche, suit les fiches : une forme visible en centrant sur
 * Daenerys vise les identifiants d'ici après le collage, pas ceux du monde d'où
 * le texte vient.
 */

import * as formesDeFond from './formes';
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
export function extraire(
  dataset: Dataset,
  idsDemandes: string[],
  {
    profils = true,
    liens: avecLiens = true,
    notes = true,
    humeurs = true,
    feuille = true,
    formes: avecFormes = true,
    idsFormes = [],
  }: {
    profils?: boolean;
    liens?: boolean;
    notes?: boolean;
    humeurs?: boolean;
    feuille?: boolean;
    formes?: boolean;
    idsFormes?: string[];
  } = {}
): Objet {
  /*
   * Rien de coché, rien de désigné : on refuse plutôt que de rendre un texte
   * vide qu'on croirait avoir copié.
   *
   * La case « Les formes » ne suffit pas à sauver l'extrait : elle est cochée
   * par défaut, et une copie sans forme montrée du doigt n'emporte rien de
   * plus qu'une copie sans elle. C'est la **liste** qui compte ici, pas la
   * case — sans quoi décocher les deux autres cesserait d'être une erreur.
   */
  if (!profils && !avecLiens && (!avecFormes || !idsFormes.length)) {
    throw new ErreurExtrait('il n’y a rien à copier');
  }

  // Les formes désignées, et elles seules — voir l'entête.
  const voulues = new Set(idsFormes);
  const formes = avecFormes
    ? formesDeFond.liste(dataset.formes).filter((forme) => voulues.has(String(forme.id)))
    : [];

  const choisies = new Set(idsDemandes);
  const personnes = dataset.personnes.filter((personne) => choisies.has(personne.id));
  // Des formes sans fiche font un extrait valable : on copie un cadre et son
  // titre pour les reposer ailleurs.
  if (!personnes.length && !formes.length) {
    // Ne montrer que des formes, la case décochée : « aucune fiche à copier »
    // serait exact et incompréhensible — on n'a justement pas montré de fiche.
    // La vraie raison est un réglage, donc on la nomme.
    throw new ErreurExtrait(
      idsFormes.length && !avecFormes
        ? 'les formes ne sont pas cochées dans les réglages du copier-coller'
        : 'aucune fiche à copier'
    );
  }
  if (personnes.length > MAX_FICHES) {
    throw new ErreurExtrait(`${MAX_FICHES} fiches au plus dans un extrait`);
  }
  // Ce qui a été demandé mais n'existe pas ne doit pas rester dans l'ensemble :
  // sinon un lien vers une fiche disparue passerait pour « dedans ».
  const dedans = new Set(personnes.map((personne) => personne.id));

  // Les deux bouts, et rien d'autre. Voir l'entête pour le pourquoi.
  const liens: Objet[] = avecLiens
    ? dataset.relations
        .filter((relation) => dedans.has(relation.source) && dedans.has(relation.cible))
        .map((relation) => relation.versDict())
    : [];

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
    personnes: profils
      ? personnes.map((personne) => {
          const brut = personne.versDict();
          delete brut.avatar; // voir l'entête : un extrait doit rester un texte
          /*
           * Trois morceaux qu'on n'emporte pas toujours (lot 25).
           *
           * Ils appartiennent à la fiche, mais pas à ce qu'on montre du
           * doigt : les notes disent ce qui s'est passé dans **cette**
           * campagne, les humeurs visent **ces** joueurs-là — et le collage
           * les poserait chez un hôte dont les joueurs n'ont rien à voir —,
           * la feuille est le personnage joué, pas le personnage.
           *
           * D'où trois cases plutôt qu'un choix pris à notre place. Elles ne
           * changent rien au collage : ce qui n'est pas dans le texte n'y
           * arrive pas, et le reste se colle comme avant.
           */
          if (!notes) delete brut.notes;
          if (!humeurs) delete brut.relations_joueurs;
          if (!feuille) delete brut.feuille;
          return brut;
        })
      : [],
    relations: liens,
    maisons: profils ? maisons : {},
    types_relations: types,
    // Absent quand il n'y en a pas : un extrait de fiches seules doit rester le
    // texte qu'il était, au caractère près. Un extrait d'avant le lot 26 se
    // colle donc sans rien changer ici — d'où une version qui ne bouge pas.
    ...(formes.length ? { formes } : {}),
  };
}

/** Ce qu'on rend à l'appelant après un collage. */
export interface Collage {
  personnes: string[];
  relations: number;
  maisons: number;
  types: number;
  formes: number;
}

/**
 * Repose un extrait dans un monde.
 *
 * `point` est l'endroit du plan où l'on veut voir arriver le groupe : les
 * fiches y sont translatées **en bloc**, ce qui préserve la forme qu'elles
 * avaient. Sans lui, elles retomberaient à leurs coordonnées d'origine, qui ne
 * veulent rien dire dans un autre monde.
 */
export function coller(dataset: Dataset, brut: unknown, point?: { x: number; y: number }): Collage {
  if (!estObjet(brut) || brut.format !== FORMAT) {
    throw new ErreurExtrait('ce texte n’est pas un extrait de sociogramme');
  }
  const personnesBrutes = Array.isArray(brut.personnes) ? brut.personnes : [];
  const liensBruts = Array.isArray(brut.relations) ? brut.relations : [];
  const formesBrutes = Array.isArray(brut.formes) ? brut.formes : [];
  // Un extrait de liens seuls n'a pas de fiches, et c'est légitime : il se pose
  // sur celles que l'hôte a déjà. Un extrait de formes seules l'est aussi.
  if (!personnesBrutes.length && !liensBruts.length && !formesBrutes.length) {
    throw new ErreurExtrait('extrait vide');
  }
  if (personnesBrutes.length > MAX_FICHES) {
    throw new ErreurExtrait(`${MAX_FICHES} fiches au plus dans un extrait`);
  }

  const resultat: Collage = { personnes: [], relations: 0, maisons: 0, types: 0, formes: 0 };

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

  /*
   * Le coin haut-gauche du groupe, pour le reposer sous le curseur sans le
   * déformer. Les fiches sans position suivent le mouvement à zéro.
   *
   * Les formes comptent dans ce coin (lot 26.B), et il le faut : un rectangle
   * tracé **autour** d'un groupe commence plus haut et plus à gauche que la
   * première fiche. Mesuré sur la seule position des fiches, le cadre se
   * reposerait décalé de ce qu'il entoure.
   */
  const coinsX: number[] = [];
  const coinsY: number[] = [];
  for (const fiche of personnesBrutes) {
    const position = estObjet(fiche) ? fiche.position : null;
    if (Array.isArray(position) && position.length === 2) {
      coinsX.push(Number(position[0]));
      coinsY.push(Number(position[1]));
    }
  }
  for (const forme of formesBrutes) {
    if (!estObjet(forme)) continue;
    coinsX.push(Number(forme.x) || 0);
    coinsY.push(Number(forme.y) || 0);
  }
  const coinX = coinsX.length ? Math.min(...coinsX) : 0;
  const coinY = coinsY.length ? Math.min(...coinsY) : 0;
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

  /**
   * Où poser un bout de lien.
   *
   * D'abord la fiche qu'on vient de coller. Sinon, **une fiche que l'hôte a
   * déjà sous le même identifiant** : c'est ce qui donne son sens au collage de
   * liens seuls, et ce qui permet de rejouer un réseau de relations sur un monde
   * qu'on a par ailleurs. Rien d'autre — un lien dont un bout manque ne se
   * dessine pas et fait trébucher la généalogie.
   */
  const bout = (ancien: string) => {
    const neuf = nouveauId.get(ancien);
    if (neuf) return neuf;
    return dataset.personne(ancien) ? ancien : '';
  };

  for (const lien of liensBruts) {
    if (!estObjet(lien)) continue;
    const donnees: Objet = { ...lien };
    const source = bout(String(lien.source || ''));
    const cible = bout(String(lien.cible || ''));
    if (!source || !cible) continue;

    donnees.source = source;
    donnees.cible = cible;
    donnees.id = idsLibres(prisRelations, `${source}-${lien.type || 'autre'}-${cible}`);
    prisRelations.add(String(donnees.id));
    dataset.relations.push(Relation.depuisDict(donnees));
    resultat.relations += 1;
  }

  /* ------------------------------------------------------------- les formes
   *
   * Lot 26.B. Après les fiches, parce qu'une forme rattachée à des profils doit
   * viser les identifiants **d'ici** — ceux que `bout` vient d'attribuer.
   */
  if (formesBrutes.length) {
    const liste = formesDeFond.liste(dataset.formes);
    for (const brute of formesBrutes) {
      if (!estObjet(brute)) continue;
      // Le plafond arrête les formes sans faire échouer le collage : les fiches
      // sont déjà posées, et les perdre pour un rectangle de trop serait pire
      // que d'en poser une de moins. Le bilan dit combien sont arrivées.
      if (liste.length >= formesDeFond.MAX_FORMES) break;
      const donnees: Objet = { ...brute };
      donnees.x = (Number(brute.x) || 0) + ecartX;
      donnees.y = (Number(brute.y) || 0) + ecartY;
      /*
       * La portée suit les fiches.
       *
       * « Visible en centrant sur Daenerys » ne veut rien dire chez l'hôte tant
       * que Daenerys n'y est pas : chaque identifiant devient celui de la fiche
       * qu'on vient de coller, ou reste tel quel si l'hôte le possède déjà.
       *
       * S'il n'en reste aucun, la forme ne paraîtrait nulle part — donc
       * introuvable, donc perdue, alors qu'on venait de demander à la copier.
       * Elle repasse au plan général : mal placée se corrige, invisible non.
       */
      if (brute.vue === 'profils') {
        const vises = [
          ...new Set(
            (Array.isArray(brute.profils) ? brute.profils : [])
              .map((id) => bout(String(id)))
              .filter(Boolean)
          ),
        ];
        donnees.profils = vises;
        if (!vises.length) donnees.vue = 'plan';
      }
      formesDeFond.creer(liste, donnees);
      resultat.formes += 1;
    }
    dataset.formes = liste;
  }

  dataset.oublierIndex();
  return resultat;
}
