/**
 * Les quelques comportements de Python qu'il faut reproduire à l'identique.
 *
 * Ce module n'existe que pour une raison : la version locale reste la
 * référence, et le lot 3 se juge sur « le même JSON, champ par champ ». Deux
 * fonctions de la bibliothèque standard de Python ne se comportent pas comme
 * leur équivalent JavaScript, et les deux servent dans du code qui produit des
 * valeurs affichées.
 *
 * On les isole ici, avec leur nom d'origine en commentaire, plutôt que de les
 * réécrire de mémoire à chaque appel.
 */

/**
 * `round()` de Python : **la moitié va au pair**, pas vers le haut.
 *
 *   Python : round(12.25, 1) → 12.2      JavaScript naïf : 12.3
 *   Python : round(12.35, 1) → 12.3 (!)  (l'écriture binaire de 12.35 est
 *                                         légèrement en dessous)
 *
 * Ça compte pour `decalage` (le déport d'une fiche, arrondi au dixième) : une
 * fiche déplacée à la souris tombe régulièrement sur une valeur en .x5, et un
 * arrondi différent suffirait à faire diverger les deux versions.
 */
export function arrondir(valeur: number, decimales = 0): number {
  if (!Number.isFinite(valeur)) return valeur;
  const facteur = 10 ** decimales;
  const echelle = valeur * facteur;
  const bas = Math.floor(echelle);
  const reste = echelle - bas;

  let entier: number;
  if (reste > 0.5) entier = bas + 1;
  else if (reste < 0.5) entier = bas;
  else entier = bas % 2 === 0 ? bas : bas + 1;

  return entier / facteur;
}

/**
 * `int()` de Python, et son échec.
 *
 * Renvoie `null` là où Python lèverait `TypeError` / `ValueError`, ce qui
 * laisse l'appelant écrire son `except` sous forme de `?? defaut`.
 *
 * Différences avec `Number()` / `parseInt()` qu'il fallait reprendre :
 * - `int(4.9)` vaut **4** et `int(-4.9)` vaut **-4** : on tronque vers zéro,
 *   là où `Math.floor` descendrait à -5 ;
 * - `int("4.5")` **échoue** en Python, alors que `parseFloat` accepterait ;
 * - `int("")` échoue aussi, alors que `Number("")` vaut 0 — le piège classique.
 */
export function versEntier(brut: unknown): number | null {
  if (typeof brut === 'boolean') return brut ? 1 : 0;

  if (typeof brut === 'number') {
    if (!Number.isFinite(brut)) return null;
    return Math.trunc(brut);
  }

  if (typeof brut === 'string') {
    const propre = brut.trim();
    // Python n'accepte qu'un entier écrit en toutes lettres : pas de décimale,
    // pas de notation exponentielle.
    if (!/^[+-]?\d+$/.test(propre)) return null;
    const valeur = Number.parseInt(propre, 10);
    return Number.isFinite(valeur) ? valeur : null;
  }

  return null;
}

/** `float()` de Python, même contrat : `null` au lieu d'une exception. */
export function versFlottant(brut: unknown): number | null {
  if (typeof brut === 'boolean') return brut ? 1 : 0;
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  if (typeof brut === 'string') {
    const propre = brut.trim();
    if (!propre) return null;
    const valeur = Number(propre);
    return Number.isFinite(valeur) ? valeur : null;
  }
  return null;
}

/** Ce que Python appelle « vrai » pour les valeurs qu'on rencontre ici. */
export function estVide(valeur: unknown): boolean {
  if (valeur === null || valeur === undefined) return true;
  if (typeof valeur === 'string') return valeur === '';
  if (Array.isArray(valeur)) return valeur.length === 0;
  if (typeof valeur === 'object') return Object.keys(valeur).length === 0;
  if (typeof valeur === 'number') return valeur === 0;
  if (typeof valeur === 'boolean') return !valeur;
  return false;
}
