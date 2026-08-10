/**
 * Le catalogue des vues — port de `backend/registry.py`.
 *
 * En Python, une vue s'enregistre par un décorateur au moment de l'import. Ici
 * la liste est explicite : un Worker n'a pas d'effet de bord d'import à
 * exploiter, et une liste qu'on lit vaut mieux qu'une magie qu'on suppose.
 *
 * La vue « tableaux & exports » n'y est pas encore : elle dépend de
 * `exports.py` (CSV et classeur Excel), qui est le lot 5. Elle arrivera avec
 * lui, pas avant — la déclarer sans son moteur donnerait un onglet qui plante.
 */

import type { Vue } from './vues/base';
import { VueSociogramme } from './vues/sociogramme';

const VUES: Vue[] = [new VueSociogramme()];

export function toutes(): Vue[] {
  return VUES;
}

export function obtenir(identifiant: string): Vue | null {
  return VUES.find((vue) => vue.id === identifiant) ?? null;
}
