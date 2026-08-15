/* Le petit dépliant 🌐 de la barre du haut (lot 16.G).
 *
 * Deux lignes, une coche : c'est un réglage qu'on pose une fois. Le choix
 * recharge la page — `public/js/langue.js` dit pourquoi.
 */

import { creerFlottant, h } from './dom.js';
import { definirLangue, langueActuelle, LANGUES } from './langue.js';

export function creerChoixLangue() {
  const flottant = creerFlottant();

  function panneau() {
    const courante = langueActuelle();
    return h('div', { class: 'flottant flottant-langue' }, [
      h(
        'div',
        { class: 'fl-corps lg-liste' },
        LANGUES.map((langue) =>
          h('button', {
            class: `lg-choix${langue.code === courante ? ' actif' : ''}`,
            type: 'button',
            onclick: () => {
              flottant.fermer();
              definirLangue(langue.code);
            },
          }, [
            h('span', { class: 'lg-drapeau', texte: langue.drapeau }),
            h('span', { class: 'lg-nom', texte: langue.nom }),
            // La coche plutôt qu'un fond coloré : on lit d'un coup d'œil
            // laquelle est active, y compris en thème sombre.
            h('span', { class: 'lg-coche', texte: langue.code === courante ? '✓' : '' }),
          ])
        )
      ),
    ]);
  }

  return {
    basculer(ancre) {
      if (flottant.estOuvert()) {
        flottant.fermer();
        return;
      }
      const boite = ancre.getBoundingClientRect();
      flottant.monter(panneau(), boite.left, boite.bottom + 6);
    },
  };
}
