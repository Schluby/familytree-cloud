/**
 * Les grappes : reconnaître une même personne dans les mondes de plusieurs comptes.
 *
 * **Le problème.** Une table à six joue le même Westeros dans six arbres. Le
 * même personnage y vit six fois, et rien ne garantit qu'il porte six fois le
 * même identifiant : il suffit qu'un joueur ait ajouté un titre au nom pour que
 * deux fiches cessent de se reconnaître. Tant qu'elles ne se reconnaissent pas,
 * un maître de jeu ne peut pas poser « le même lien chez tout le monde » — il
 * n'y a pas de « même », il n'y a que six fiches sans rapport.
 *
 * `rapprochement()` (lot 12.C) faisait déjà le constat, par nom exact. Ce
 * module va plus loin, parce que le plan collectif en a besoin : il fabrique
 * des **grappes**, c'est-à-dire des identités reconstituées, chacune tenant les
 * écritures d'une même personne chez les différents comptes.
 *
 * **Trois façons de rapprocher, et une de séparer.**
 *
 * 1. **L'identifiant** — deux fiches nommées `eddard-stark` sont la même
 *    personne. Elles descendent du même monde de départ.
 * 2. **Le nom normalisé** — « Jon Snow » et « jon  snow ».
 * 3. **La ressemblance** — au-dessus d'un seuil que l'intendant règle. C'est ce
 *    qui rattrape « Edard Stark » (faute de frappe) et « Petyr Baelish,
 *    Littlefinger » (titre accolé).
 * 4. **Le verdict manuel**, qui l'emporte sur les trois : « c'est la même » là
 *    où rien ne le disait, et surtout **« ce n'est pas la même »** là où tout
 *    semblait le dire.
 *
 * **Et une règle qui ne se discute pas : deux fiches d'un même compte ne se
 * rejoignent jamais toutes seules.** Un compte est l'autorité sur son propre
 * monde ; s'il a deux fiches, c'est qu'il en a voulu deux. C'est ce qui règle le
 * piège du monde livré, où « Brandon Stark » désigne deux personnages — le
 * frère d'Eddard et son fils Bran — sous le même nom complet, chez tout le
 * monde. Seul un verdict manuel passe outre.
 *
 * **Un verdict `distincte` tient contre la transitivité.** Trois fiches A, B, C
 * où A~B et B~C se rejoindraient toutes trois même si A et C ont été déclarées
 * distinctes. On refuse donc la fusion qui mettrait une paire interdite dans la
 * même grappe, plutôt que de fusionner puis de trancher : le résultat dépend de
 * l'ordre, alors l'ordre est fixe et dit ici — verdicts d'abord, identifiants,
 * noms, puis ressemblances par score décroissant.
 */

import type { Dataset } from '../domaine/models';

export type Verdict = 'meme' | 'distincte';

/** Une écriture d'une personne, dans le monde d'un compte. */
export interface Occurrence {
  compte_id: string;
  /** L'adresse, pour l'afficher — les identifiants nus ne disent rien. */
  compte: string;
  sauvegarde_id: string;
  personne_id: string;
  label: string;
  prenom: string;
  nom: string;
  maison: string;
}

export interface LigneVerdict {
  gauche: string;
  droite: string;
  verdict: Verdict;
}

/** Ce qui a rapproché les écritures d'une grappe. */
export type Raison = 'seule' | 'identifiant' | 'nom' | 'ressemblance' | 'manuel';

export interface Grappe {
  /**
   * L'identifiant de référence : celui que le plus de comptes portent.
   *
   * Ce n'est pas un numéro de série. C'est un identifiant qui existe vraiment
   * dans au moins un arbre, donc lisible dans un message d'erreur, et surtout
   * **unique** — deux fiches de même identifiant se rejoignent toujours (règle
   * 1), donc un identifiant n'appartient qu'à une grappe.
   */
  cle: string;
  label: string;
  occurrences: Occurrence[];
  /** Les comptes qui ont cette personne, dans l'ordre où on les a lus. */
  comptes: string[];
  /** Toutes les écritures portent-elles le même identifiant et le même nom ? */
  accord: boolean;
  raisons: Raison[];
}

/** Deux écritures qui se ressemblent sans avoir été réunies. */
export interface Candidat {
  gauche: Occurrence;
  droite: Occurrence;
  score: number;
  /** Le verdict déjà rendu sur cette paire, s'il y en a un. */
  verdict: Verdict | null;
  /** Deux fiches du même compte : elles ne se rejoindront pas d'elles-mêmes. */
  meme_compte: boolean;
}

export interface Rapprochements {
  grappes: Grappe[];
  candidats: Candidat[];
  /** Ce que le calcul a coûté, pour que la page puisse le dire honnêtement. */
  releve: { occurrences: number; noms: number; comparaisons: number; tronque: boolean };
}

/* --------------------------------------------------------------------------
 * Les noms
 * -------------------------------------------------------------------------- */

/**
 * Le nom réduit à ce qui permet de reconnaître quelqu'un.
 *
 * Accents dépliés, casse effacée, ponctuation retirée, espaces resserrés.
 * « Jon Snow », « jon snow » et « Jon  Snow » se rejoignent. « Jon Snow » et
 * « Jon Snow le Bâtard » restent séparés **à ce stade** — c'est la ressemblance
 * qui les rapprochera, avec un score que l'intendant voit et peut refuser.
 */
export function normaliserNom(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distance d'édition, bornée.
 *
 * Le plafond n'est pas une optimisation de confort : deux noms très différents
 * coûtent le même calcul que deux noms proches, et le plan collectif en compare
 * des milliers de paires dans une requête qui a un budget de temps processeur.
 * Dès qu'une ligne entière dépasse le plafond, la réponse ne peut plus
 * descendre en dessous : on s'arrête.
 */
function distance(a: string, b: string, plafond: number): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  let courante = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    courante[0] = i;
    let minimum = i;
    const lettreA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cout = lettreA === b.charCodeAt(j - 1) ? 0 : 1;
      const valeur = Math.min(
        (courante[j - 1] as number) + 1,
        (precedente[j] as number) + 1,
        (precedente[j - 1] as number) + cout
      );
      courante[j] = valeur;
      if (valeur < minimum) minimum = valeur;
    }
    if (minimum > plafond) return plafond + 1;
    const echange = precedente;
    precedente = courante;
    courante = echange;
  }
  return precedente[b.length] as number;
}

/**
 * Longueur minimale prise au dénominateur d'une comparaison de mots.
 *
 * **Une faute de frappe est une faute de frappe, quelle que soit la longueur du
 * mot.** Sans ce plancher, une lettre de travers coûte 1/4 dans « Wyla » et
 * 1/8 dans « Daenerys » : le même accident, deux fois plus cher sur un prénom
 * court. Mesuré le 16/08/2026, « Wylla » contre « Wyla » rendait 0,80 et
 * restait sous le seuil, là où « Eddard » contre « Edard » passait à 0,83.
 *
 * Avec un plancher à six, une lettre coûte toujours 0,17 environ, et les deux
 * cas se rejoignent. **Le prix à payer se dit** : deux prénoms courts qui
 * diffèrent d'une lettre — « Ned » et « Ted » — se rapprochent aussi. C'est un
 * échange assumé, parce qu'à une table qui part du même monde la faute de
 * frappe est bien plus fréquente que l'homonyme à une lettre près, et parce
 * qu'un verdict « ce ne sont pas les mêmes » règle le second en un clic.
 */
const LONGUEUR_PLANCHER = 6;

/** Deux mots, de 0 à 1. */
function ressemblanceMot(a: string, b: string): number {
  const plus = Math.max(a.length, b.length);
  if (!plus) return 0;
  return 1 - distance(a, b, plus) / Math.max(plus, LONGUEUR_PLANCHER);
}

/**
 * Combien deux noms normalisés se ressemblent, de 0 à 1.
 *
 * **Deux noms sont aussi proches que leur mot le plus éloigné.** C'est le
 * maillon faible qui décide, et non la moyenne.
 *
 * **Pourquoi ce n'est pas une subtilité.** La première version comparait les
 * noms entiers par distance d'édition et gardait la mesure la plus favorable.
 * Mesuré le 15/08/2026 sur le Westeros livré, à un seuil de 0,82, elle
 * réunissait :
 *
 * - **Aerys, Daenerys et Viserys Targaryen en une seule personne** — « aerys
 *   targaryen » et « daenerys targaryen » ne diffèrent que de trois lettres sur
 *   dix-huit : 0,83 ;
 * - **Tywin et Tyrion Lannister** — deux lettres sur seize : 0,88.
 *
 * Le nom de famille écrase le prénom, qui est pourtant tout ce qui distingue
 * deux membres d'une maison. En comparant mot à mot et en gardant le pire
 * appariement, « aerys » contre « daenerys » rend 0,63 et « tywin » contre
 * « tyrion » 0,67 : les deux restent séparés, tandis qu'« eddard stark » et
 * « edard starkk » (une faute par mot) tiennent à 0,83 et se rejoignent.
 *
 * Les mots en trop — un titre accolé au nom — sont tolérés mais coûtent :
 * « petyr baelish » et « petyr baelish littlefinger » apparient parfaitement
 * leurs deux mots, puis perdent 12 % pour le troisième, et se rejoignent à
 * 0,88. Un nom entièrement remplacé, lui, ne se rattrapera jamais tout seul :
 * c'est au verdict manuel de le dire.
 */
export function similarite(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;

  const motsA = a.split(' ');
  const motsB = b.split(' ');
  const [courts, longs] = motsA.length <= motsB.length ? [motsA, motsB] : [motsB, motsA];

  // Appariement glouton, sans réemploi : chaque mot du nom le plus court prend
  // son meilleur partenaire encore libre. L'ordre ne compte donc pas —
  // « baelish petyr » retrouve « petyr baelish ».
  const libres = [...longs];
  let faible = 1;
  for (const mot of courts) {
    let meilleur = 0;
    let rang = -1;
    libres.forEach((autre, index) => {
      const score = ressemblanceMot(mot, autre);
      if (score > meilleur) {
        meilleur = score;
        rang = index;
      }
    });
    if (rang >= 0) libres.splice(rang, 1);
    if (meilleur < faible) faible = meilleur;
  }

  const surplus = longs.length - courts.length;
  return faible * Math.max(0.6, 1 - 0.12 * surplus);
}

/* --------------------------------------------------------------------------
 * Les références et les paires
 * -------------------------------------------------------------------------- */

/** Comment on désigne une écriture, d'un bout à l'autre : compte et fiche. */
export function reference(occurrence: { compte_id: string; personne_id: string }): string {
  return `${occurrence.compte_id}/${occurrence.personne_id}`;
}

/** Une paire rangée : le verdict d'une paire ne dépend pas de l'ordre de saisie. */
export function rangerPaire(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

const clePaire = (a: string, b: string) => rangerPaire(a, b).join('|');

/** Une référence est-elle bien formée ? On refuse ce qu'on ne saura pas relire. */
export function referenceValide(brut: unknown): string {
  const texte = String(brut ?? '').trim();
  const coupure = texte.indexOf('/');
  if (coupure <= 0 || coupure === texte.length - 1) return '';
  if (texte.length > 200) return '';
  return texte;
}

/** Le compte nommé par une référence — ce que le périmètre doit contrôler. */
export function compteDeLaReference(ref: string): string {
  const coupure = ref.indexOf('/');
  return coupure > 0 ? ref.slice(0, coupure) : '';
}

/* --------------------------------------------------------------------------
 * Le regroupement
 * -------------------------------------------------------------------------- */

/** Le seuil par défaut, et les bornes que l'interface propose. */
export const SEUIL_DEFAUT = 0.82;
export const SEUIL_MINIMUM = 0.5;

/** En dessous, une paire n'est même pas montrée comme candidate. */
const PLANCHER_CANDIDAT = 0.6;

/**
 * Combien de paires de noms on accepte de comparer.
 *
 * Le blocage par préfixe (voir plus bas) ramène déjà le carré à presque rien
 * quand les comptes partent du même monde. Ce plafond est le filet pour le cas
 * contraire — vingt comptes aux mondes sans rapport — où mieux vaut un
 * rapprochement incomplet, et qui le dit, qu'une requête coupée en plein vol.
 */
const MAX_COMPARAISONS = 60000;

/** Les paires de noms qui valent la peine d'être comparées. */
function paires(noms: string[]): { pistes: [number, number][]; tronque: boolean } {
  // On indexe chaque nom par les deux premières lettres de chacun de ses mots.
  // Deux écritures d'une même personne partagent presque toujours un mot, donc
  // un préfixe — y compris quand l'ordre change (« baelish petyr »).
  const parPrefixe = new Map<string, number[]>();
  noms.forEach((nom, index) => {
    for (const mot of new Set(nom.split(' '))) {
      if (mot.length < 2) continue;
      const prefixe = mot.slice(0, 2);
      const liste = parPrefixe.get(prefixe);
      if (liste) liste.push(index);
      else parPrefixe.set(prefixe, [index]);
    }
  });

  const vues = new Set<string>();
  const pistes: [number, number][] = [];
  let tronque = false;

  for (const liste of parPrefixe.values()) {
    for (let i = 0; i < liste.length && !tronque; i += 1) {
      for (let j = i + 1; j < liste.length; j += 1) {
        const a = liste[i] as number;
        const b = liste[j] as number;
        const cle = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (vues.has(cle)) continue;
        vues.add(cle);

        // Deux noms dont l'un fait moins de la moitié de l'autre ne peuvent pas
        // atteindre un seuil raisonnable : la distance d'édition seule y perd
        // déjà la moitié des points.
        const court = Math.min((noms[a] as string).length, (noms[b] as string).length);
        const long = Math.max((noms[a] as string).length, (noms[b] as string).length);
        if (court * 2 < long) continue;

        pistes.push([a, b]);
        if (pistes.length >= MAX_COMPARAISONS) {
          tronque = true;
          break;
        }
      }
    }
    if (tronque) break;
  }

  return { pistes, tronque };
}

export function grouper(
  occurrences: Occurrence[],
  { seuil, verdicts }: { seuil: number; verdicts: LigneVerdict[] }
): Rapprochements {
  const nombre = occurrences.length;
  const parent = Array.from({ length: nombre }, (_, i) => i);
  const membres = occurrences.map((_, i) => new Set<number>([i]));
  const raisons = occurrences.map(() => new Set<Raison>());
  // Quels comptes une grappe tient déjà — voir `memeCompte` plus bas.
  const detenteurs = occurrences.map((occurrence) => new Set<string>([occurrence.compte_id]));

  const racine = (i: number): number => {
    let courant = i;
    while (parent[courant] !== courant) {
      parent[courant] = parent[parent[courant] as number] as number;
      courant = parent[courant] as number;
    }
    return courant;
  };

  // Ce qu'un verdict interdit de réunir, dans les deux sens.
  const interdits = new Map<string, Set<string>>();
  const imposes: [string, string][] = [];
  const parPaire = new Map<string, Verdict>();
  for (const ligne of verdicts) {
    const [gauche, droite] = rangerPaire(ligne.gauche, ligne.droite);
    parPaire.set(`${gauche}|${droite}`, ligne.verdict);
    if (ligne.verdict === 'meme') {
      imposes.push([gauche, droite]);
      continue;
    }
    for (const [de, vers] of [
      [gauche, droite],
      [droite, gauche],
    ] as [string, string][]) {
      const deja = interdits.get(de);
      if (deja) deja.add(vers);
      else interdits.set(de, new Set([vers]));
    }
  }

  const parReference = new Map<string, number>();
  occurrences.forEach((occurrence, index) => parReference.set(reference(occurrence), index));

  /** Réunir A et B mettrait-il dans la même grappe une paire déclarée distincte ? */
  function separes(a: number, b: number): boolean {
    if (!interdits.size) return false;
    const ra = racine(a);
    const rb = racine(b);
    const petit = (membres[ra] as Set<number>).size <= (membres[rb] as Set<number>).size ? ra : rb;
    const grand = petit === ra ? rb : ra;
    for (const index of membres[petit] as Set<number>) {
      const defense = interdits.get(reference(occurrences[index] as Occurrence));
      if (!defense) continue;
      for (const autre of membres[grand] as Set<number>) {
        if (defense.has(reference(occurrences[autre] as Occurrence))) return true;
      }
    }
    return false;
  }

  /**
   * Réunir A et B mettrait-il **deux fiches d'un même compte** dans une grappe ?
   *
   * **On refuse, et c'est la règle qui protège le mieux.** Un compte est
   * l'autorité sur son propre monde : s'il a deux fiches, c'est qu'il en a
   * voulu deux. Les rapprocher pour lui, sur une ressemblance de nom, revient à
   * décider à sa place — et c'est exactement le piège du monde livré, où
   * « Brandon Stark » désigne deux personnages, le frère d'Eddard et son fils
   * Bran, qui portent le même nom complet chez tout le monde.
   *
   * Le verdict manuel, lui, passe outre : quand l'intendant dit « ce sont les
   * mêmes », il sait quelque chose que les données ne disent pas.
   */
  function memeCompte(ra: number, rb: number): boolean {
    const petit = (detenteurs[ra] as Set<string>).size <= (detenteurs[rb] as Set<string>).size ? ra : rb;
    const grand = petit === ra ? rb : ra;
    for (const compte of detenteurs[petit] as Set<string>) {
      if ((detenteurs[grand] as Set<string>).has(compte)) return true;
    }
    return false;
  }

  function unir(a: number, b: number, raison: Raison): boolean {
    const ra = racine(a);
    const rb = racine(b);
    if (ra === rb) {
      (raisons[ra] as Set<Raison>).add(raison);
      return false;
    }
    if (separes(a, b)) return false;
    if (raison !== 'manuel' && memeCompte(ra, rb)) return false;

    const [garde, absorbe] =
      (membres[ra] as Set<number>).size >= (membres[rb] as Set<number>).size ? [ra, rb] : [rb, ra];
    parent[absorbe] = garde;
    for (const index of membres[absorbe] as Set<number>) (membres[garde] as Set<number>).add(index);
    for (const autre of raisons[absorbe] as Set<Raison>) (raisons[garde] as Set<Raison>).add(autre);
    for (const compte of detenteurs[absorbe] as Set<string>) {
      (detenteurs[garde] as Set<string>).add(compte);
    }
    (raisons[garde] as Set<Raison>).add(raison);
    (membres[absorbe] as Set<number>).clear();
    (raisons[absorbe] as Set<Raison>).clear();
    (detenteurs[absorbe] as Set<string>).clear();
    return true;
  }

  // 1. Ce que l'intendant a tranché lui-même. En premier, parce que c'est la
  //    seule source qui sait quelque chose que les données ne disent pas.
  for (const [gauche, droite] of imposes) {
    const a = parReference.get(gauche);
    const b = parReference.get(droite);
    if (a !== undefined && b !== undefined) unir(a, b, 'manuel');
  }

  // 2. Le même identifiant. Deux `eddard-stark` viennent du même monde.
  const parIdentifiant = new Map<string, number[]>();
  occurrences.forEach((occurrence, index) => {
    const liste = parIdentifiant.get(occurrence.personne_id);
    if (liste) liste.push(index);
    else parIdentifiant.set(occurrence.personne_id, [index]);
  });
  for (const liste of parIdentifiant.values()) {
    for (let i = 1; i < liste.length; i += 1) {
      unir(liste[0] as number, liste[i] as number, 'identifiant');
    }
  }

  // 3. Le même nom normalisé.
  const normalises = occurrences.map((occurrence) => normaliserNom(occurrence.label));
  const parNom = new Map<string, number[]>();
  normalises.forEach((nom, index) => {
    if (!nom) return;
    const liste = parNom.get(nom);
    if (liste) liste.push(index);
    else parNom.set(nom, [index]);
  });
  for (const liste of parNom.values()) {
    for (let i = 1; i < liste.length; i += 1) {
      unir(liste[0] as number, liste[i] as number, 'nom');
    }
  }

  // 4. La ressemblance. On compare des **noms distincts**, pas des écritures :
  //    six comptes qui partagent le même Westeros ont des centaines
  //    d'occurrences pour quelques dizaines de noms, et c'est le carré des noms
  //    qui coûte.
  const noms = [...parNom.keys()];
  const { pistes, tronque } = paires(noms);
  const proches: { a: number; b: number; score: number }[] = [];
  for (const [i, j] of pistes) {
    const score = similarite(noms[i] as string, noms[j] as string);
    if (score < PLANCHER_CANDIDAT) continue;
    proches.push({ a: i, b: j, score });
  }
  // Par score décroissant : la fusion la plus sûre passe la première, et c'est
  // elle qui gagne quand un verdict « distincte » n'en laisse passer qu'une.
  proches.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);

  const candidats: Candidat[] = [];
  for (const { a, b, score } of proches) {
    const gauche = (parNom.get(noms[a] as string) as number[])[0] as number;
    const droite = (parNom.get(noms[b] as string) as number[])[0] as number;
    if (score >= seuil && unir(gauche, droite, 'ressemblance')) continue;
    if (racine(gauche) === racine(droite)) continue;

    // Restent : ce que le seuil laisse dehors, et ce qu'un verdict a séparé.
    // Les deux méritent d'être montrés — l'un pour être accepté, l'autre pour
    // pouvoir être repris.
    const refG = reference(occurrences[gauche] as Occurrence);
    const refD = reference(occurrences[droite] as Occurrence);
    candidats.push({
      gauche: occurrences[gauche] as Occurrence,
      droite: occurrences[droite] as Occurrence,
      score,
      verdict: parPaire.get(clePaire(refG, refD)) ?? null,
      meme_compte:
        (occurrences[gauche] as Occurrence).compte_id ===
        (occurrences[droite] as Occurrence).compte_id,
    });
  }

  // Les grappes, enfin.
  const grappes: Grappe[] = [];
  for (let index = 0; index < nombre; index += 1) {
    if (racine(index) !== index) continue;
    const liste = [...(membres[index] as Set<number>)].map(
      (i) => occurrences[i] as Occurrence
    );
    grappes.push(assembler(liste, [...(raisons[index] as Set<Raison>)]));
  }
  grappes.sort((a, b) => b.comptes.length - a.comptes.length || a.label.localeCompare(b.label));

  return {
    grappes,
    candidats: candidats.slice(0, 200),
    releve: {
      occurrences: nombre,
      noms: noms.length,
      comparaisons: pistes.length,
      tronque,
    },
  };
}

/** Une grappe et ce qu'elle montre : la graphie de la table, pas la première vue. */
function assembler(occurrences: Occurrence[], raisons: Raison[]): Grappe {
  const comptes = [...new Set(occurrences.map((o) => o.compte_id))];

  // L'identifiant de référence est celui que le plus de comptes portent. C'est
  // aussi celui qu'un lot posera : viser la graphie majoritaire, c'est écrire
  // chez le moins de gens possible.
  const poids = new Map<string, number>();
  for (const occurrence of occurrences) {
    poids.set(occurrence.personne_id, (poids.get(occurrence.personne_id) ?? 0) + 1);
  }
  const cle = [...poids.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';

  const poidsLabel = new Map<string, number>();
  for (const occurrence of occurrences) {
    poidsLabel.set(occurrence.label, (poidsLabel.get(occurrence.label) ?? 0) + 1);
  }
  const label =
    [...poidsLabel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? cle;

  return {
    cle,
    label,
    occurrences,
    comptes,
    accord: poids.size === 1 && poidsLabel.size === 1,
    raisons: raisons.length ? raisons : ['seule'],
  };
}

/* --------------------------------------------------------------------------
 * Lire et écrire les verdicts
 * -------------------------------------------------------------------------- */

/**
 * Les verdicts qui concernent une sélection de comptes.
 *
 * On ne rapporte que ceux dont **les deux côtés** sont dans la sélection : un
 * verdict à moitié hors périmètre ne dirait rien d'utile à celui qui regarde, et
 * lui livrerait l'identifiant d'un compte qu'il ne doit pas voir.
 */
export async function verdictsDe(base: D1Database, comptes: string[]): Promise<LigneVerdict[]> {
  if (!comptes.length) return [];
  const { results } = await base
    .prepare('SELECT gauche, droite, verdict FROM identites')
    .all<LigneVerdict>();

  const permis = new Set(comptes);
  return results.filter(
    (ligne) =>
      permis.has(compteDeLaReference(ligne.gauche)) && permis.has(compteDeLaReference(ligne.droite))
  );
}

/** Poser un verdict — ou l'oublier, ce qui rend la paire au calcul automatique. */
export async function poserVerdict(
  base: D1Database,
  gaucheBrut: string,
  droiteBrut: string,
  verdict: Verdict | 'oublier',
  poseParId: string
): Promise<void> {
  const [gauche, droite] = rangerPaire(gaucheBrut, droiteBrut);

  if (verdict === 'oublier') {
    await base
      .prepare('DELETE FROM identites WHERE gauche = ? AND droite = ?')
      .bind(gauche, droite)
      .run();
    return;
  }

  // Une paire n'a qu'un verdict : le second remplace le premier. Sans le
  // remplacement, se raviser demanderait d'oublier puis de reposer, et un
  // « distincte » oublié à moitié laisserait la fusion interdite pour toujours.
  await base
    .prepare(
      `INSERT INTO identites (id, gauche, droite, verdict, pose_par, cree_le)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(gauche, droite)
       DO UPDATE SET verdict = excluded.verdict, pose_par = excluded.pose_par,
                     cree_le = excluded.cree_le`
    )
    .bind(crypto.randomUUID(), gauche, droite, verdict, poseParId, Math.floor(Date.now() / 1000))
    .run();
}

/* --------------------------------------------------------------------------
 * Des sauvegardes aux occurrences
 * -------------------------------------------------------------------------- */

/** Toutes les fiches d'une sauvegarde, sous la forme que le regroupement lit. */
export function occurrencesDe(
  dataset: Dataset,
  compteId: string,
  compte: string,
  sauvegardeId: string
): Occurrence[] {
  return dataset.personnes.map((personne) => ({
    compte_id: compteId,
    compte,
    sauvegarde_id: sauvegardeId,
    personne_id: personne.id,
    label: personne.nomComplet,
    prenom: personne.prenom,
    nom: personne.nom,
    maison: personne.maison,
  }));
}

/** Le seuil reçu, ramené à ce qui a un sens. */
export function seuilValide(brut: unknown): number {
  const valeur = Number(brut);
  if (!Number.isFinite(valeur)) return SEUIL_DEFAUT;
  return Math.min(1, Math.max(SEUIL_MINIMUM, valeur));
}
