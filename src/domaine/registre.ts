/**
 * Le catalogue des vues — port de `backend/registry.py`.
 *
 * En Python, une vue s'enregistre par un décorateur au moment de l'import. Ici
 * la liste est explicite : un Worker n'a pas d'effet de bord d'import à
 * exploiter, et une liste qu'on lit vaut mieux qu'une magie qu'on suppose.
 *
 * L'ordre compte : c'est celui du rail, et la première vue est celle qui
 * s'ouvre au chargement.
 */

import type { Vue } from './vues/base';
import { VueMaisons } from './vues/maisons';
import { VueSociogramme } from './vues/sociogramme';
import { VueTableau } from './vues/tableau';

const VUES: Vue[] = [new VueSociogramme(), new VueMaisons(), new VueTableau()];

export function toutes(): Vue[] {
  return VUES;
}

export function obtenir(identifiant: string): Vue | null {
  return VUES.find((vue) => vue.id === identifiant) ?? null;
}
