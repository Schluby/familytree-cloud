/**
 * Logique généalogique partagée par les vues — port de `backend/genealogie.py`.
 *
 * Sert à toute vue qui doit empiler les personnes par génération : sociogramme
 * en cartes, arbre d'ascendance, chronologie…
 */

import type { Personne, Relation } from './models';

export const TYPES_UNION = ['conjoint', 'amant'] as const;

export type Paire = [string, string];

/** Sépare les relations en (filiations parent→enfant, unions). */
export function couplesEtFiliations(relations: Relation[]): {
  filiations: Paire[];
  unions: Paire[];
} {
  const filiations: Paire[] = [];
  const unions: Paire[] = [];

  for (const relation of relations) {
    if (relation.type === 'parent') {
      filiations.push([relation.source, relation.cible]);
    } else if ((TYPES_UNION as readonly string[]).includes(relation.type)) {
      unions.push([relation.source, relation.cible]);
    }
  }
  return { filiations, unions };
}

/**
 * Attribue un indice de génération à chaque personne.
 *
 * Deux règles, dans cet ordre de priorité :
 *
 * 1. **Descendance (dure)** : un enfant est au moins une génération sous chacun
 *    de ses parents. C'est le plus long chemin depuis les racines.
 * 2. **Couple (souple)** : on aligne un conjoint sur l'autre *uniquement* s'il
 *    n'a pas d'ascendance connue (les « pièces rapportées »). Sans cette
 *    restriction, un mariage entre générations — Tyrion épousant Sansa — ferait
 *    descendre Tyrion d'un cran sous son frère et sa sœur, et casserait toute
 *    la rangée de sa fratrie.
 */
export function calculerGenerations(
  ids: Iterable<string>,
  relations: Relation[],
  passes = 8
): Map<string, number> {
  const generations = new Map<string, number>();
  for (const identifiant of ids) generations.set(identifiant, 0);

  const brut = couplesEtFiliations(relations);
  const filiations = brut.filiations.filter(
    ([parent, enfant]) => generations.has(parent) && generations.has(enfant)
  );
  const unions = brut.unions.filter(([a, b]) => generations.has(a) && generations.has(b));

  const avecAscendance = new Set(filiations.map(([, enfant]) => enfant));
  const avecUnion = new Set(unions.flat());

  const fratries: Paire[] = relations
    .filter(
      (relation) =>
        relation.type === 'fratrie' &&
        generations.has(relation.source) &&
        generations.has(relation.cible)
    )
    .map((relation) => [relation.source, relation.cible] as Paire);

  // Personnes dont la génération n'est déterminée par rien : on les alignera
  // sur leur fratrie (oncles, frères de rois dont les parents sont inconnus).
  const indeterminees = new Set<string>();
  for (const identifiant of generations.keys()) {
    if (!avecAscendance.has(identifiant) && !avecUnion.has(identifiant)) {
      indeterminees.add(identifiant);
    }
  }

  for (let passe = 0; passe < passes; passe += 1) {
    let modifie = false;

    // 1. Contrainte de descendance (plus long chemin depuis les racines).
    for (let tour = 0; tour < generations.size + 1; tour += 1) {
      let changement = false;
      for (const [parent, enfant] of filiations) {
        const attendu = (generations.get(parent) as number) + 1;
        if ((generations.get(enfant) as number) < attendu) {
          generations.set(enfant, attendu);
          changement = true;
        }
      }
      if (!changement) break;
      modifie = true;
    }

    // 2. Contrainte de couple, réservée aux conjoints sans ascendance.
    for (const [a, b] of unions) {
      const ga = generations.get(a) as number;
      const gb = generations.get(b) as number;
      if (ga === gb) continue;

      const aLibre = !avecAscendance.has(a);
      const bLibre = !avecAscendance.has(b);

      if (aLibre && !bLibre) {
        generations.set(a, gb);
      } else if (bLibre && !aLibre) {
        generations.set(b, ga);
      } else if (aLibre && bLibre) {
        const cible = Math.max(ga, gb);
        generations.set(a, cible);
        generations.set(b, cible);
      } else {
        continue; // deux lignées connues : on ne force rien
      }
      modifie = true;
    }

    // 3. Fratries : uniquement pour caler ceux que rien d'autre ne situe. On
    //    prend le minimum des frères et sœurs déjà placés, pour ne jamais
    //    entraîner de cascade vers le bas.
    const candidats = new Map<string, number[]>();
    for (const [a, b] of fratries) {
      if (indeterminees.has(a) && !indeterminees.has(b)) {
        ajouter(candidats, a, generations.get(b) as number);
      }
      if (indeterminees.has(b) && !indeterminees.has(a)) {
        ajouter(candidats, b, generations.get(a) as number);
      }
    }
    for (const [personne, valeurs] of candidats) {
      const cible = Math.min(...valeurs);
      if (generations.get(personne) !== cible) {
        generations.set(personne, cible);
        modifie = true;
      }
    }

    if (!modifie) break;
  }

  if (generations.size) {
    const minimum = Math.min(...generations.values());
    if (minimum) {
      for (const [identifiant, valeur] of generations) {
        generations.set(identifiant, valeur - minimum);
      }
    }
  }
  return generations;
}

function ajouter(carte: Map<string, number[]>, cle: string, valeur: number): void {
  const liste = carte.get(cle);
  if (liste) liste.push(valeur);
  else carte.set(cle, [valeur]);
}

/**
 * Une fiche peut forcer sa génération : elle gagne sur le calcul.
 *
 * L'arbre ne devine pas tout — un personnage rapporté sans ascendance, une
 * génération sautée. Le numéro saisi est celui qui s'affiche (« Génération 3 ») ;
 * l'indice interne part de 0.
 */
export function appliquerSurcharges(
  generations: Map<string, number>,
  personnes: Personne[]
): Map<string, number> {
  for (const personne of personnes) {
    const forcee = personne.generation;
    if (forcee !== null && forcee !== undefined && generations.has(personne.id)) {
      generations.set(personne.id, Math.max(0, forcee - 1));
    }
  }
  return generations;
}

/** Paires d'enfants partageant au moins un parent. */
export function fratriesDeduites(filiations: Paire[]): Set<string> {
  const enfantsParParent = new Map<string, string[]>();
  for (const [parent, enfant] of filiations) ajouterTexte(enfantsParParent, parent, enfant);

  // Les paires deviennent une clé texte : un Set de tableaux comparerait les
  // références, pas le contenu, et ne dédoublonnerait donc rien.
  const paires = new Set<string>();
  for (const enfants of enfantsParParent.values()) {
    const uniques = [...new Set(enfants)].sort();
    for (let i = 0; i < uniques.length; i += 1) {
      for (let j = i + 1; j < uniques.length; j += 1) {
        paires.add(clePaire(uniques[i] as string, uniques[j] as string));
      }
    }
  }
  return paires;
}

/**
 * Le séparateur est un octet nul, écrit ainsi pour qu'il ne se perde pas dans
 * le fichier source : les identifiants sortent de `slugifier` et n'en
 * contiennent jamais, alors qu'un espace ou un tiret, eux, peuvent très bien
 * apparaître dans un document édité à la main.
 */
const SEPARATEUR = String.fromCharCode(0);

/** Clé d'une paire de fiches, pour pouvoir la ranger dans un `Set`. */
export function clePaire(a: string, b: string): string {
  return a < b ? a + SEPARATEUR + b : b + SEPARATEUR + a;
}

function ajouterTexte(carte: Map<string, string[]>, cle: string, valeur: string): void {
  const liste = carte.get(cle);
  if (liste) liste.push(valeur);
  else carte.set(cle, [valeur]);
}
