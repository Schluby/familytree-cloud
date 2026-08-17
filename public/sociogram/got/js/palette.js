/* La palette des liserés (lot 20.B).
 *
 * **Des cases, et pas un cercle chromatique.** Un sélecteur de couleur libre
 * rend seize millions de teintes, dont quinze qui se ressemblent deux à deux :
 * sur un plan de soixante fiches, deux verts voisins ne se distinguent plus, et
 * le marquage ne veut plus rien dire. Douze cases nommées se choisissent d'un
 * clic, se reconnaissent à distance, et se redisent à voix haute (« les rouges
 * sont ceux qui doivent mourir »).
 *
 * Les teintes sont **moyennes exprès** : elles doivent tenir sur le fond clair
 * comme sur le fond sombre, puisque le thème change et pas les données. Un
 * blanc et un noir de charbon, qui seraient pourtant utiles, disparaîtraient
 * chacun dans un des deux thèmes.
 *
 * Le serveur, lui, n'impose pas cette liste : il accepte tout `#rrggbb` (voir
 * `normaliserBordure` dans `src/domaine/models.ts`). C'est voulu — le jour où
 * cette palette change, les fiches déjà marquées gardent leur couleur au lieu
 * de se vider.
 */

export const PALETTE = [
  { valeur: '#d64545', nom: 'Rouge' },
  { valeur: '#e0803a', nom: 'Orange' },
  { valeur: '#c9a227', nom: 'Or' },
  { valeur: '#6aa84f', nom: 'Vert pomme' },
  { valeur: '#3fa877', nom: 'Vert' },
  { valeur: '#2f9e9e', nom: 'Turquoise' },
  { valeur: '#5fa8d3', nom: 'Bleu' },
  { valeur: '#6b7fd7', nom: 'Indigo' },
  { valeur: '#a06cd5', nom: 'Violet' },
  { valeur: '#cf7fa5', nom: 'Rose' },
  { valeur: '#a3785c', nom: 'Brun' },
  { valeur: '#8a8f98', nom: 'Ardoise' },
];

/**
 * Une grille de cases, plus la case « aucune » en tête.
 *
 * `surChoix(valeur)` reçoit la couleur, ou `null` pour retirer le liseré.
 * L'élément rendu se met à jour tout seul au clic : l'appelant n'a pas à le
 * redessiner, et le plan suit par le rappel.
 */
export function grillePalette(valeurCourante, surChoix) {
  const grille = document.createElement('div');
  grille.className = 'palette';

  const cases = [];
  const marquer = (valeur) => {
    for (const bouton of cases) {
      bouton.classList.toggle('actif', (bouton.dataset.valeur || null) === valeur);
    }
  };

  const ajouter = (valeur, nom, classe = '') => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = `palette-case ${classe}`.trim();
    bouton.title = nom;
    // `aria-label` et non un texte visible : la case est un carré de couleur,
    // et son nom ne doit se lire qu'au survol ou au lecteur d'écran.
    bouton.setAttribute('aria-label', nom);
    if (valeur) {
      bouton.dataset.valeur = valeur;
      bouton.style.background = valeur;
    }
    bouton.addEventListener('click', () => {
      marquer(valeur);
      surChoix(valeur);
    });
    cases.push(bouton);
    grille.append(bouton);
  };

  ajouter(null, 'Aucune couleur', 'palette-aucune');
  for (const entree of PALETTE) ajouter(entree.valeur, entree.nom);

  marquer(valeurCourante || null);
  return grille;
}
