/* Menu contextuel (clic droit).
 *
 * Générique : il ne connaît ni les personnes ni les liens, il affiche la liste
 * d'entrées qu'on lui passe. Un `onclick` peut rouvrir le menu avec d'autres
 * entrées — c'est ainsi qu'est faite la confirmation de suppression.
 */

import { h, creerFlottant } from './dom.js';

export function creerMenu() {
  const socle = creerFlottant();

  function rendre(entree) {
    if (!entree) return null;
    if (entree.separateur) return h('div', { class: 'menu-separateur' });
    if (entree.titre !== undefined) {
      return h('div', { class: 'menu-titre' }, [
        entree.couleur &&
          h('span', { class: 'menu-pastille', style: { background: entree.couleur } }),
        h('span', { class: 'menu-titre-texte', texte: entree.titre }),
      ]);
    }
    if (entree.texte !== undefined) {
      return h('div', { class: 'menu-texte', texte: entree.texte });
    }
    return h(
      'button',
      {
        class: `menu-item${entree.danger ? ' danger' : ''}`,
        type: 'button',
        disabled: !!entree.disabled,
        onclick: (evenement) => {
          evenement.stopPropagation();
          socle.fermer();
          entree.onclick?.(evenement);
        },
      },
      [
        h('span', { class: 'menu-icone', texte: entree.icone || '' }),
        h('span', { class: 'menu-label', texte: entree.label }),
        entree.detail && h('span', { class: 'menu-detail', texte: entree.detail }),
      ]
    );
  }

  return {
    ouvrir(x, y, entrees) {
      socle.monter(
        h('div', { class: 'menu-contextuel', role: 'menu' }, entrees.map(rendre)),
        x,
        y
      );
    },
    fermer: socle.fermer,
    estOuvert: socle.estOuvert,
  };
}
