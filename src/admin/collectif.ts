/**
 * Le plan collectif — les mondes de plusieurs comptes superposés en un seul.
 *
 * **Pourquoi.** L'administration savait tout dire d'une table sous forme de
 * tableaux : combien de fiches, quelles maisons en commun, quels doublons. Ce
 * qu'elle ne savait pas montrer, c'est **la table elle-même** — le réseau que
 * les joueurs ont dessiné, et surtout là où leurs versions divergent. Un maître
 * de jeu ne pilote pas six colonnes de chiffres ; il pilote un plan.
 *
 * **Ce que ce module produit.** Exactement le contrat que le moteur de rendu
 * « cartes » consomme déjà — `{noeuds, aretes}` — sans qu'une ligne du moteur
 * ait à changer. C'est la contrainte qui a guidé tout le reste : le plan
 * collectif n'est pas un second moteur de dessin, c'est le même, nourri
 * autrement.
 *
 * **Un nœud n'est pas une fiche, c'est une grappe** (voir `identites.ts`) :
 * l'identité reconstituée d'une personne, avec toutes les écritures que les
 * comptes en ont faites. Deux conséquences qu'il faut avoir en tête :
 *
 * - L'identifiant d'un nœud (`cle`) est celui que le plus de comptes portent.
 *   Il existe donc réellement chez au moins l'un d'eux, et c'est ce qui permet
 *   à un lot de le viser sans inventer de correspondance.
 * - Chaque nœud et chaque lien portent **qui les a** et **qui ne les a pas**.
 *   C'est la seule information que le plan d'un compte seul ne pouvait pas
 *   donner, et c'est celle qu'on vient chercher ici.
 *
 * **La place des notes est empruntée.** Sur une carte, `notes` affiche les
 * notes de la personne. Ici, les notes diffèrent d'un compte à l'autre et en
 * montrer une seule mentirait sur les cinq autres. Le champ sert donc à dire
 * l'état collectif — « absente chez untel », « deux écritures ». C'est
 * l'information qu'on relit sur un plan collectif ; l'autre se lit chez son
 * propriétaire, par « ✎ Éditer ».
 */

import { identifiantsDepart } from '../depart/contenu';
import { calculerGenerations } from '../domaine/genealogie';
import * as humeur from '../domaine/humeur';
import { Dataset, Relation, type Objet } from '../domaine/models';
import { urlPhoto } from '../domaine/portraits';
import {
  grouper,
  occurrencesDe,
  reference,
  type Grappe,
  type LigneVerdict,
  type Occurrence,
} from './identites';
import type { Cible } from './lots';

/** Combien de comptes un seul plan superpose. Au-delà, plus rien ne se lit. */
export const MAX_COMPTES_PLAN = 12;

/**
 * La couleur d'un membre sur le plan.
 *
 * Elle ne sert qu'au rail et aux pastilles de présence — jamais à colorer une
 * carte, qui appartient à tout le monde à la fois. Douze teintes distinctes,
 * dans l'ordre de la sélection : deux membres voisins ne doivent pas se
 * confondre au premier coup d'œil.
 */
const TEINTES = [
  '#c1553f', '#3f7fc1', '#4f9d69', '#a45cb5', '#c19a3f', '#3fa8a8',
  '#b5546f', '#6b7fd7', '#8a9a3f', '#c1743f', '#5f5fb5', '#3f8f5f',
];

export interface CompteDuPlan {
  id: string;
  compte: string;
  sauvegarde_id: string;
  sauvegarde: string;
  personnes: number;
  relations: number;
  couleur: string;
}

interface Monde {
  cible: Cible;
  dataset: Dataset;
}

/** Ce qu'un compte a mis sur un lien, chez lui. */
interface EcritureLien {
  compte_id: string;
  relation_id: string;
  label: string;
  emoji: string;
  humeur: number;
  revolu: boolean;
  secret: boolean;
}

interface LienFusionne {
  cle: string;
  source: string;
  cible: string;
  type: string;
  dirige: boolean;
  ecritures: EcritureLien[];
}

/* --------------------------------------------------------------------------
 * Lire les mondes
 * -------------------------------------------------------------------------- */

/** Les sauvegardes lisibles, transformées en datasets. Les illisibles sautent. */
function ouvrir(cibles: Cible[]): Monde[] {
  const mondes: Monde[] = [];
  for (const cible of cibles) {
    if (!cible.donnees) continue;
    try {
      mondes.push({ cible, dataset: Dataset.depuisDict(JSON.parse(cible.donnees) as Objet) });
    } catch {
      // Une sauvegarde illisible ne doit pas emporter le plan des autres.
      continue;
    }
  }
  return mondes;
}

const nomDuCompte = (cible: Cible) => cible.email || `essai ${cible.utilisateurId.slice(0, 8)}`;

/* --------------------------------------------------------------------------
 * Quel arbre de chaque membre le plan regarde (lot 17.G)
 *
 * **Le défaut qu'on répare.** Le plan prenait la sauvegarde ouverte de chacun,
 * sans rien demander. Deux ennuis, signalés le 16/08/2026 :
 *
 * - un membre qui a copié le monde de départ et n'y a jamais touché apportait
 *   **67 fiches de décor** identiques à celles de tout le monde. Le plan
 *   affichait alors le cadeau, pas la table ;
 * - un membre qui joue **deux campagnes** n'a aucune raison que la bonne soit
 *   celle qu'il a ouverte, et personne ne pouvait le corriger.
 *
 * D'où deux choses : un **choix explicite**, arbre par arbre, et un **défaut
 * qui écarte les mondes intacts**.
 * -------------------------------------------------------------------------- */

/** Un arbre d'un membre, tel qu'on le montre pour choisir — sans son contenu. */
export interface ArbreDuMembre {
  id: string;
  nom: string;
  personnes: number;
  relations: number;
  taille: number;
  revision: number;
  cree_le: number;
  modifie_le: number;
  /** Celle que son propriétaire a ouverte. */
  active: boolean;
  /**
   * Jamais réécrite depuis sa création.
   *
   * `revision` part à 1 et n'augmente que dans `ecrireDocument` : à 1, personne
   * n'a rien changé depuis que la sauvegarde existe. C'est le signal le plus
   * honnête dont on dispose sans ouvrir le document — et il ne se trompe que
   * dans un sens sans conséquence : un import jamais retouché passera pour
   * intact, ce qui le met de côté par défaut mais reste choisissable à la main.
   */
  intacte: boolean;
}

export interface MembreEtSesArbres {
  compte_id: string;
  compte: string;
  arbres: ArbreDuMembre[];
  /** Celui que le plan prendra faute de choix explicite. Vide s'il n'y a rien. */
  retenu: string;
}

interface LigneArbre {
  id: string;
  nom: string;
  personnes: number;
  relations: number;
  taille: number;
  revision: number;
  cree_le: number;
  modifie_le: number;
  utilisateur_id: string;
  email: string;
  sauvegarde_active: string | null;
}

/**
 * Lequel prendre, faute de choix.
 *
 * Dans l'ordre : **on écarte les mondes intacts** s'il reste autre chose, puis
 * on prend celui que le membre a ouvert, sinon le plus récemment modifié. Si
 * tout est intact, on ne rend **rien** : le membre figure quand même au rail,
 * annoncé comme n'ayant rien travaillé, et il reste choisissable à la main.
 * Le faire entrer d'office remplirait le plan de décor ; le faire disparaître
 * cacherait quelqu'un de la table.
 */
export function arbreRetenu(arbres: ArbreDuMembre[]): string {
  const travailles = arbres.filter((arbre) => !arbre.intacte);
  if (!travailles.length) return '';
  const ouvert = travailles.find((arbre) => arbre.active);
  if (ouvert) return ouvert.id;
  const parDate = [...travailles].sort((a, b) => b.modifie_le - a.modifie_le);
  return parDate[0]?.id ?? '';
}

/** Ce que chaque membre a, et ce que le plan prendra. Sans lire les documents. */
export async function arbresDesMembres(
  base: D1Database,
  comptes: string[]
): Promise<MembreEtSesArbres[]> {
  if (!comptes.length) return [];
  const trous = comptes.map(() => '?').join(',');
  // Pas de jointure sur `contenus` : cette liste sert à **choisir**, et charger
  // le document de toutes les sauvegardes de tout le monde pour afficher un
  // menu coûterait plus cher que le plan lui-même.
  const { results } = await base
    .prepare(
      `SELECT s.id, s.nom, s.personnes, s.relations, s.taille, s.revision,
              s.cree_le, s.modifie_le, s.utilisateur_id,
              u.email, u.sauvegarde_active
         FROM sauvegardes s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.utilisateur_id IN (${trous}) AND s.demo = 0
        ORDER BY u.email, s.modifie_le DESC`
    )
    .bind(...comptes)
    .all<LigneArbre>();

  const parCompte = new Map<string, MembreEtSesArbres>();
  for (const ligne of results) {
    let membre = parCompte.get(ligne.utilisateur_id);
    if (!membre) {
      membre = {
        compte_id: ligne.utilisateur_id,
        compte: ligne.email || `essai ${ligne.utilisateur_id.slice(0, 8)}`,
        arbres: [],
        retenu: '',
      };
      parCompte.set(ligne.utilisateur_id, membre);
    }
    membre.arbres.push({
      id: ligne.id,
      nom: ligne.nom,
      personnes: ligne.personnes,
      relations: ligne.relations,
      taille: ligne.taille,
      revision: ligne.revision,
      cree_le: ligne.cree_le,
      modifie_le: ligne.modifie_le,
      active: ligne.id === ligne.sauvegarde_active,
      intacte: ligne.revision <= 1,
    });
  }

  const membres = [...parCompte.values()];
  for (const membre of membres) membre.retenu = arbreRetenu(membre.arbres);
  return membres.sort((a, b) => a.compte.localeCompare(b.compte));
}

/**
 * Les arbres nommés, chargés avec leur contenu — et **seulement ceux-là**.
 *
 * Le périmètre est appliqué dans la requête et non après : une liste complète
 * chargée puis élaguée en mémoire, c'est une liste complète qui a existé. Une
 * sauvegarde hors périmètre, inexistante, ou qui n'appartient pas au compte
 * annoncé, disparaît en silence — le plan dira simplement qu'elle n'est pas là.
 */
export async function chargerArbres(
  base: D1Database,
  identifiants: string[],
  perimetre: ReadonlySet<string> | null
): Promise<Cible[]> {
  if (!identifiants.length) return [];
  const trous = identifiants.map(() => '?').join(',');
  const { results } = await base
    .prepare(
      `SELECT s.id, s.nom, s.schema_version, s.personnes, s.relations, s.taille,
              s.revision, s.cree_le, s.modifie_le, s.utilisateur_id,
              u.email, u.role, u.plafond_octets, c.donnees
         FROM sauvegardes s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
         LEFT JOIN contenus c ON c.sauvegarde_id = s.id
        WHERE s.id IN (${trous}) AND s.demo = 0
        ORDER BY u.email`
    )
    .bind(...identifiants)
    .all<Objet & { donnees: string | null }>();

  return results
    .filter((ligne) => perimetre === null || perimetre.has(String(ligne.utilisateur_id)))
    .map((ligne) => ({
      fiche: {
        id: String(ligne.id),
        nom: String(ligne.nom),
        schema_version: Number(ligne.schema_version),
        personnes: Number(ligne.personnes),
        relations: Number(ligne.relations),
        taille: Number(ligne.taille),
        revision: Number(ligne.revision),
        cree_le: Number(ligne.cree_le),
        modifie_le: Number(ligne.modifie_le),
        demo: 0,
      },
      utilisateurId: String(ligne.utilisateur_id),
      email: String(ligne.email ?? ''),
      role: String(ligne.role ?? 'membre'),
      plafondOctets: Number(ligne.plafond_octets),
      donnees: ligne.donnees,
    }));
}

/**
 * Les arbres à superposer : le choix explicite s'il y en a un, le défaut sinon.
 *
 * `choix` est ce que la page a sous les yeux. Le transmettre plutôt que de le
 * recalculer garantit qu'un **geste** posé depuis le plan écrit dans l'arbre
 * qui est **affiché**, et non dans celui que le membre a ouvert de son côté
 * entre-temps.
 */
export async function arbresDuPlan(
  base: D1Database,
  comptes: string[],
  choix: Record<string, string>,
  perimetre: ReadonlySet<string> | null
): Promise<Cible[]> {
  const membres = await arbresDesMembres(base, comptes);
  const vises: string[] = [];
  for (const membre of membres) {
    const demande = String(choix[membre.compte_id] ?? '');
    // Un choix qui ne désigne pas un arbre de ce membre-là est ignoré : il vient
    // d'un plan devenu vieux, et suivre une indication périmée écrirait ailleurs.
    const valide = membre.arbres.some((arbre) => arbre.id === demande) ? demande : membre.retenu;
    if (valide) vises.push(valide);
  }
  return chargerArbres(base, vises, perimetre);
}

/* --------------------------------------------------------------------------
 * Le plan
 * -------------------------------------------------------------------------- */

export interface Plan extends Objet {
  vue: 'collectif';
  rendu: 'cartes';
  noeuds: Objet[];
  aretes: Objet[];
  legende: Objet;
  comptes: CompteDuPlan[];
  stats: Objet;
}

export function construirePlan(
  cibles: Cible[],
  { seuil, verdicts }: { seuil: number; verdicts: LigneVerdict[] }
): Plan & { rapprochement: Objet } {
  const mondes = ouvrir(cibles);

  const comptes: CompteDuPlan[] = mondes.map((monde, rang) => ({
    id: monde.cible.utilisateurId,
    compte: nomDuCompte(monde.cible),
    sauvegarde_id: monde.cible.fiche.id,
    sauvegarde: monde.cible.fiche.nom,
    personnes: monde.dataset.personnes.length,
    relations: monde.dataset.relations.length,
    couleur: TEINTES[rang % TEINTES.length] as string,
  }));

  // 1. Les grappes ---------------------------------------------------------
  const occurrences: Occurrence[] = [];
  for (const monde of mondes) {
    occurrences.push(
      ...occurrencesDe(
        monde.dataset,
        monde.cible.utilisateurId,
        nomDuCompte(monde.cible),
        monde.cible.fiche.id
      )
    );
  }
  const rapprochement = grouper(occurrences, { seuil, verdicts });

  /** De « compte/fiche » vers la grappe qui la tient. */
  const parReference = new Map<string, Grappe>();
  for (const grappe of rapprochement.grappes) {
    for (const occurrence of grappe.occurrences) parReference.set(reference(occurrence), grappe);
  }
  const grappeDe = (compteId: string, personneId: string): Grappe | null =>
    parReference.get(`${compteId}/${personneId}`) ?? null;

  // 2. Les liens, fusionnés ------------------------------------------------
  //
  // La clé d'un lien, ce sont les deux grappes et le type — pas l'identifiant
  // de la relation, qui n'a de sens que chez son propriétaire. Un lien non
  // orienté est rangé dans l'ordre alphabétique de ses deux bouts : sans ça,
  // « Robb → Jon » et « Jon → Robb » feraient deux traits pour une amitié.
  const liens = new Map<string, LienFusionne>();
  for (const monde of mondes) {
    const compteId = monde.cible.utilisateurId;
    for (const relation of monde.dataset.relations) {
      const source = grappeDe(compteId, relation.source);
      const cible = grappeDe(compteId, relation.cible);
      if (!source || !cible || source.cle === cible.cle) continue;

      const dirige = monde.dataset.estDirigee(relation);
      const [a, b] = dirige
        ? [source.cle, cible.cle]
        : source.cle <= cible.cle
          ? [source.cle, cible.cle]
          : [cible.cle, source.cle];
      // Les deux bouts et le type, séparés par un motif qui ne peut pas
      // apparaître dans un identifiant : celui-ci voyage jusque dans un
      // attribut `data-relation` du DOM, que le moteur relit pour savoir quel
      // lien est sous le curseur.
      const cle = `${a}::${relation.type}::${b}`;

      let lien = liens.get(cle);
      if (!lien) {
        lien = { cle, source: a as string, cible: b as string, type: relation.type, dirige, ecritures: [] };
        liens.set(cle, lien);
      }
      lien.ecritures.push({
        compte_id: compteId,
        relation_id: relation.id,
        label: relation.label,
        emoji: relation.emoji,
        humeur: relation.humeur,
        revolu: relation.revolu,
        secret: relation.secret,
      });
    }
  }

  // 3. Générations ---------------------------------------------------------
  //
  // Sur le graphe fusionné, et non sur celui d'un compte : la mise en page doit
  // être la même quelle que soit la sélection affichée, sinon cocher un membre
  // ferait sauter toutes les cartes.
  const relationsFusionnees = [...liens.values()].map((lien) => {
    const relation = new Relation();
    relation.id = lien.cle;
    relation.source = lien.source;
    relation.cible = lien.cible;
    relation.type = lien.type;
    return relation;
  });
  const generations = calculerGenerations(
    rapprochement.grappes.map((grappe) => grappe.cle),
    relationsFusionnees
  );

  const degres = new Map<string, number>();
  for (const lien of liens.values()) {
    degres.set(lien.source, (degres.get(lien.source) ?? 0) + 1);
    degres.set(lien.cible, (degres.get(lien.cible) ?? 0) + 1);
  }

  // 4. Les nœuds -----------------------------------------------------------
  const total = comptes.length;
  const noeuds = rapprochement.grappes.map((grappe) =>
    construireNoeud(grappe, mondes, generations.get(grappe.cle) ?? 0, degres.get(grappe.cle) ?? 0, comptes)
  );

  // 5. Les arêtes ----------------------------------------------------------
  const compteurPaires = new Map<string, number>();
  for (const lien of liens.values()) {
    const paire = lien.source <= lien.cible ? `${lien.source}|${lien.cible}` : `${lien.cible}|${lien.source}`;
    compteurPaires.set(paire, (compteurPaires.get(paire) ?? 0) + 1);
  }
  const rangPaires = new Map<string, number>();
  const aretes = [...liens.values()].map((lien) => {
    const paire = lien.source <= lien.cible ? `${lien.source}|${lien.cible}` : `${lien.cible}|${lien.source}`;
    const rang = rangPaires.get(paire) ?? 0;
    rangPaires.set(paire, rang + 1);
    return construireArete(lien, mondes, rang, compteurPaires.get(paire) ?? 1, comptes, total);
  });

  return {
    vue: 'collectif',
    rendu: 'cartes',
    noeuds,
    aretes,
    legende: construireLegende(mondes, noeuds, aretes),
    // La légende ne dit que ce qui est **dessiné**. Les formulaires, eux, ont
    // besoin de tout ce qui existe : proposer « vassal » seulement quand un
    // vassal est déjà à l'écran empêcherait d'en poser le premier.
    catalogues: catalogues(mondes),
    comptes,
    rapprochement: {
      candidats: rapprochement.candidats,
      releve: rapprochement.releve,
      seuil,
      // Ce qui mérite un coup d'œil : les grappes que les comptes n'écrivent
      // pas pareil. Les autres n'appellent aucun geste.
      desaccords: rapprochement.grappes
        .filter((grappe) => !grappe.accord)
        .slice(0, 200)
        .map((grappe) => ({
          cle: grappe.cle,
          label: grappe.label,
          raisons: grappe.raisons,
          ecritures: grappe.occurrences.map((occurrence) => ({
            reference: reference(occurrence),
            compte_id: occurrence.compte_id,
            compte: occurrence.compte,
            personne_id: occurrence.personne_id,
            label: occurrence.label,
          })),
        })),
    },
    stats: {
      comptes: total,
      personnes: noeuds.length,
      liens: aretes.length,
      // Ce que la superposition a fait gagner : sans grappes, il y aurait une
      // carte par écriture. C'est le nombre qui dit si le seuil est bien réglé.
      ecritures: occurrences.length,
      partout: noeuds.filter((noeud) => (noeud.comptes as string[]).length === total).length,
      divergentes: noeuds.filter((noeud) => !noeud.accord).length,
      liens_partout: aretes.filter((arete) => (arete.comptes as string[]).length === total).length,
    },
  };
}

/* --------------------------------------------------------------------------
 * Un nœud
 * -------------------------------------------------------------------------- */

/** La valeur qu'écrivent le plus de comptes. À égalité, la première lue. */
function majoritaire<T>(valeurs: T[]): T | null {
  const poids = new Map<string, { valeur: T; combien: number }>();
  for (const valeur of valeurs) {
    const cle = JSON.stringify(valeur ?? null);
    const deja = poids.get(cle);
    if (deja) deja.combien += 1;
    else poids.set(cle, { valeur, combien: 1 });
  }
  let gagnante: { valeur: T; combien: number } | null = null;
  for (const entree of poids.values()) {
    if (!gagnante || entree.combien > gagnante.combien) gagnante = entree;
  }
  return gagnante ? gagnante.valeur : null;
}

function construireNoeud(
  grappe: Grappe,
  mondes: Monde[],
  generation: number,
  degre: number,
  comptes: CompteDuPlan[]
): Objet {
  const parCompte = new Map(mondes.map((monde) => [monde.cible.utilisateurId, monde]));
  const fiches = grappe.occurrences
    .map((occurrence) => {
      const monde = parCompte.get(occurrence.compte_id);
      const personne = monde?.dataset.personne(occurrence.personne_id) ?? null;
      return personne ? { occurrence, monde: monde as Monde, personne } : null;
    })
    .filter((entree): entree is NonNullable<typeof entree> => entree !== null);

  const premiere = fiches[0];
  const maison = majoritaire(fiches.map((f) => f.personne.maison)) ?? 'autre';
  const ficheMaison = premiere ? premiere.monde.dataset.maison(maison) : {};
  const categorie = String(ficheMaison.categorie || '');

  const presents = new Set(grappe.comptes);
  const absents = comptes.filter((compte) => !presents.has(compte.id));

  // Le personnage d'un joueur : la première tenue par un membre. C'est la seule
  // fiche du plan qui a quelqu'un derrière elle, et le maître de jeu la cherche
  // des yeux avant toutes les autres.
  let joueur: Objet | null = null;
  for (const { occurrence, monde } of fiches) {
    const trouve = monde.dataset.joueurs.find(
      (candidat) => (candidat as Objet).personne_id === occurrence.personne_id
    ) as Objet | undefined;
    if (trouve) {
      joueur = { id: trouve.id, nom: String(trouve.nom ?? ''), couleur: String(trouve.couleur ?? '#7a7f87') };
      break;
    }
  }

  return {
    id: grappe.cle,
    label: grappe.label,
    surnom: majoritaire(fiches.map((f) => f.personne.surnom)) ?? '',
    maison,
    maison_label: String(ficheMaison.label ?? ''),
    categorie,
    categorie_label: categorie && premiere ? String(premiere.monde.dataset.categorie(categorie).label ?? '') : '',
    couleur:
      majoritaire(fiches.map((f) => f.personne.couleur)) ||
      String(ficheMaison.couleur ?? '#7a7f87'),
    initiales: premiere ? premiere.personne.initiales : '',
    avatar: urlPhoto(majoritaire(fiches.map((f) => f.personne.avatar))),
    statut: majoritaire(fiches.map((f) => f.personne.statut)) ?? 'inconnu',
    naissance: majoritaire(fiches.map((f) => f.personne.naissance)) ?? null,
    deces: majoritaire(fiches.map((f) => f.personne.deces)) ?? null,
    lieu: majoritaire(fiches.map((f) => f.personne.lieu)) ?? '',
    titres: majoritaire(fiches.map((f) => f.personne.titres)) ?? [],
    tags: majoritaire(fiches.map((f) => f.personne.tags)) ?? [],
    decalage: majoritaire(fiches.map((f) => f.personne.decalage)) ?? null,
    generation,
    degre,
    joueur,
    // Le champ emprunté : voir l'en-tête du module.
    notes: etatCollectif(grappe, absents),
    notes_joueurs: {},
    note_joueurs_moyenne: null,

    // Ce que le plan collectif ajoute, et que le moteur de rendu ignore.
    comptes: grappe.comptes,
    absents: absents.map((compte) => compte.id),
    // Vient du monde livré, donc du décor : une seule écriture connue suffit à
    // le dire, puisque c'est de là que la personne est arrivée chez tout le
    // monde. La page s'en sert pour montrer « ce que la table a créé ».
    du_depart: grappe.occurrences.some((occurrence) =>
      identifiantsDepart().has(occurrence.personne_id)
    ),
    accord: grappe.accord,
    raisons: grappe.raisons,
    ecritures: grappe.occurrences.map((occurrence) => ({
      reference: reference(occurrence),
      compte_id: occurrence.compte_id,
      compte: occurrence.compte,
      personne_id: occurrence.personne_id,
      label: occurrence.label,
    })),
  };
}

/** Ce que la carte dit de l'accord de la table, en une ligne. */
function etatCollectif(grappe: Grappe, absents: CompteDuPlan[]): string {
  const morceaux: string[] = [];
  if (absents.length) {
    const noms = absents.map((compte) => compte.compte);
    morceaux.push(
      noms.length <= 3
        ? `Absente chez ${noms.join(', ')}`
        : `Absente chez ${noms.length} membres`
    );
  }
  const identifiants = [...new Set(grappe.occurrences.map((o) => o.personne_id))];
  if (identifiants.length > 1) {
    morceaux.push(`${identifiants.length} écritures : ${identifiants.join(', ')}`);
  }
  return morceaux.join(' · ');
}

/* --------------------------------------------------------------------------
 * Une arête
 * -------------------------------------------------------------------------- */

function role(typeRelation: string): string {
  if (typeRelation === 'parent') return 'filiation';
  if (typeRelation === 'conjoint' || typeRelation === 'amant') return 'union';
  if (typeRelation === 'fratrie') return 'fratrie';
  return 'social';
}

function construireArete(
  lien: LienFusionne,
  mondes: Monde[],
  rang: number,
  totalPaire: number,
  comptes: CompteDuPlan[],
  total: number
): Objet {
  const premier = mondes[0];
  const typeRel = premier ? premier.dataset.typeRelation(lien.type) : {};
  const porteurs = [...new Set(lien.ecritures.map((ecriture) => ecriture.compte_id))];
  const absents = comptes.filter((compte) => !porteurs.includes(compte.id));

  const humeurMoyenne = moyenne(lien.ecritures.map((ecriture) => ecriture.humeur));
  const cran = humeur.cran(humeurMoyenne);

  return {
    id: lien.cle,
    source: lien.source,
    cible: lien.cible,
    type: lien.type,
    type_label: String(typeRel.label ?? lien.type),
    role: role(lien.type),
    couleur: String(typeRel.couleur ?? '#8a8f98'),
    style: String(typeRel.style ?? 'solide'),
    categorie: String(typeRel.categorie ?? 'autre'),
    dirige: lien.dirige,
    humeur: humeurMoyenne,
    humeur_label: cran.label,
    humeur_couleur: cran.couleur,
    epaisseur: humeur.epaisseur(humeurMoyenne),
    label: majoritaire(lien.ecritures.map((ecriture) => ecriture.label)) ?? '',
    emoji: majoritaire(lien.ecritures.map((ecriture) => ecriture.emoji)) ?? '',
    // Un lien n'est révolu, ou secret, que si **tout le monde** l'a écrit ainsi.
    // L'inverse mettrait au passé chez cinq comptes ce qu'un seul y a rangé.
    revolu: lien.ecritures.every((ecriture) => ecriture.revolu),
    secret: lien.ecritures.every((ecriture) => ecriture.secret),
    deduit: false,
    parallele_rang: rang,
    parallele_total: totalPaire,

    // Le collectif.
    comptes: porteurs,
    absents: absents.map((compte) => compte.id),
    partout: porteurs.length === total,
    ecritures: lien.ecritures,
  };
}

function moyenne(valeurs: number[]): number {
  if (!valeurs.length) return humeur.DEFAUT;
  return Math.round(valeurs.reduce((somme, valeur) => somme + valeur, 0) / valeurs.length);
}

/* --------------------------------------------------------------------------
 * La légende
 * -------------------------------------------------------------------------- */

function construireLegende(mondes: Monde[], noeuds: Objet[], aretes: Objet[]): Objet {
  const compteTypes = new Map<string, number>();
  for (const arete of aretes) {
    const type = String(arete.type);
    compteTypes.set(type, (compteTypes.get(type) ?? 0) + 1);
  }
  const compteMaisons = new Map<string, number>();
  for (const noeud of noeuds) {
    const maison = String(noeud.maison);
    compteMaisons.set(maison, (compteMaisons.get(maison) ?? 0) + 1);
  }

  // Les catalogues de tous les comptes réunis : un type de lien qu'un seul
  // membre a inventé doit figurer dans la légende, sinon son trait n'a pas de
  // nom sur le plan.
  const type = (id: string): Objet => {
    for (const monde of mondes) {
      if (Object.hasOwn(monde.dataset.types_relations, id)) return monde.dataset.typeRelation(id);
    }
    return { label: id, couleur: '#8a8f98', style: 'solide', dirige: false, categorie: 'autre' };
  };
  const maison = (id: string): Objet => {
    for (const monde of mondes) {
      if (Object.hasOwn(monde.dataset.maisons, id)) return monde.dataset.maison(id);
    }
    return { label: id, couleur: '#7a7f87', devise: '' };
  };

  return {
    types: [...compteTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, nombre]) => {
        const fiche = type(id);
        return {
          id,
          label: String(fiche.label ?? id),
          couleur: String(fiche.couleur ?? '#8a8f98'),
          style: String(fiche.style ?? 'solide'),
          dirige: Boolean(fiche.dirige),
          categorie: String(fiche.categorie ?? 'autre'),
          nombre,
        };
      }),
    maisons: [...compteMaisons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, nombre]) => {
        const fiche = maison(id);
        return {
          id,
          label: String(fiche.label ?? id),
          couleur: String(fiche.couleur ?? '#7a7f87'),
          devise: String(fiche.devise ?? ''),
          nombre,
        };
      }),
  };
}

/**
 * Ce que les formulaires ont le droit de proposer : la **réunion** des
 * catalogues de tous les membres.
 *
 * Réunion et non intersection : un type de lien qu'un seul joueur a inventé
 * doit pouvoir être posé chez les autres — c'est même l'un des usages du plan,
 * répandre ce qu'un membre a trouvé. Ceux qui ne l'ont pas le recevront avec le
 * lien, puisque les catalogues voyagent avec les lots.
 */
function catalogues(mondes: Monde[]): Objet {
  const rassembler = (
    lire: (monde: Monde) => Record<string, Objet>
  ): { id: string; label: string; couleur: string }[] => {
    const vus = new Map<string, { id: string; label: string; couleur: string }>();
    for (const monde of mondes) {
      for (const [id, fiche] of Object.entries(lire(monde))) {
        if (vus.has(id)) continue;
        vus.set(id, {
          id,
          label: String(fiche?.label ?? id),
          couleur: String(fiche?.couleur ?? '#8a8f98'),
        });
      }
    }
    return [...vus.values()].sort((a, b) => a.label.localeCompare(b.label));
  };

  return {
    types: rassembler((monde) => monde.dataset.types_relations),
    maisons: rassembler((monde) => monde.dataset.maisons),
    categories: rassembler((monde) => monde.dataset.categories),
  };
}

/* --------------------------------------------------------------------------
 * La table des grappes, pour les lots
 * -------------------------------------------------------------------------- */

/**
 * De la clé d'une grappe vers l'identifiant local, sauvegarde par sauvegarde.
 *
 * C'est ce qui permet à un lot de poser « le même lien chez tout le monde »
 * quand tout le monde n'appelle pas la personne de la même façon : le lot nomme
 * la grappe, chaque sauvegarde y lit son propre identifiant. Voir
 * `PREFIXE_GRAPPE` et `Resolution` dans `lots.ts`.
 */
export function tableDesGrappes(
  cibles: Cible[],
  { seuil, verdicts }: { seuil: number; verdicts: LigneVerdict[] }
): Map<string, Map<string, string>> {
  const mondes = ouvrir(cibles);
  const occurrences: Occurrence[] = [];
  for (const monde of mondes) {
    occurrences.push(
      ...occurrencesDe(
        monde.dataset,
        monde.cible.utilisateurId,
        nomDuCompte(monde.cible),
        monde.cible.fiche.id
      )
    );
  }

  const table = new Map<string, Map<string, string>>();
  for (const grappe of grouper(occurrences, { seuil, verdicts }).grappes) {
    const parSauvegarde = new Map<string, string>();
    for (const occurrence of grappe.occurrences) {
      // Une grappe peut tenir deux fiches d'une même sauvegarde (deux écritures
      // d'un même personnage chez un joueur). On garde la première : viser les
      // deux reviendrait à écrire deux fois, et rien ne dit laquelle garder.
      if (!parSauvegarde.has(occurrence.sauvegarde_id)) {
        parSauvegarde.set(occurrence.sauvegarde_id, occurrence.personne_id);
      }
    }
    table.set(grappe.cle, parSauvegarde);
  }
  return table;
}
