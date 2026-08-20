/* Le dépliant ⌨ de la barre du haut (lot 16.D).
 *
 * Ces gestes vivaient dans un bloc « Édition » du rail, toujours déplié, qui
 * prenait un écran entier alors qu'on les cherche une fois puis plus jamais.
 * Ici, ils sont à portée sans rien occuper.
 *
 * **Ce fichier ne définit aucun raccourci** : il ne fait que dire ceux que
 * l'application câble ailleurs. La source de vérité reste le `keydown` global
 * de `main.js` et les gestes de `views/cartes.js` — si l'un change, cette
 * liste ment jusqu'à ce qu'on la corrige.
 */

import { creerFlottant, h } from './dom.js';

/** `[touches, ce que ça fait]`, groupés comme on les cherche. */
const GROUPES = [
  {
    titre: 'Partout',
    lignes: [
      [['/'], 'Aller à la recherche'],
      [['Échap'], 'Revenir à la vue générale — ou annuler une liaison en cours'],
      [['Entrée'], 'Depuis la recherche : ouvrir le premier résultat'],
      [['Ctrl', 'S'], 'Rien à enregistrer : tout part déjà au fil de la frappe'],
    ],
  },
  {
    titre: 'Sur le plan',
    lignes: [
      [['Maj', 'clic'], 'Sur deux fiches : les relier sans quitter la vue'],
      [['Ctrl', 'glisser'], 'Déplacer une fiche à la main — ou toute la sélection'],
      [['Clic droit'], 'Sur une fiche, sur un lien ou dans le vide : le menu'],
      [['Appui long'], 'Au doigt, il remplace le clic droit'],
    ],
  },
  // Lots 22.D et 23.B. Ces gestes-là ne s'annonçaient nulle part, et personne
  // ne devine « Maj + glisser dans le vide ». Groupés à part parce qu'ils
  // forment une suite : prendre, copier, poser.
  {
    titre: 'Prendre, copier, coller',
    lignes: [
      [['Maj', 'glisser'], 'Dans le vide : encadrer des fiches pour les prendre'],
      [['Ctrl', 'clic'], 'Sur une fiche : l’ajouter à la sélection, ou l’en retirer'],
      [['Clic'], 'Dans le vide : reposer la sélection'],
      [['Ctrl', 'C'], 'Copier les fiches prises, avec leurs liens'],
      [['Ctrl', 'V'], 'Coller — ici, dans un autre de vos arbres, ou chez un ami'],
    ],
  },
  {
    titre: 'Dans le carnet',
    lignes: [
      [['/'], 'Citer un profil, une maison, un lien, un joueur'],
      [['↑', '↓'], 'Parcourir les suggestions'],
      [['Entrée'], 'Insérer la suggestion retenue'],
      [['Échap'], 'Fermer les suggestions, puis repasser en lecture'],
    ],
  },
];

export function creerRaccourcis() {
  const flottant = creerFlottant();

  function panneau() {
    return h('div', { class: 'flottant flottant-raccourcis' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [h('span', { class: 'fl-nom', texte: 'Raccourcis' })]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer',
          onclick: () => flottant.fermer(),
        }),
      ]),
      h(
        'div',
        { class: 'fl-corps' },
        GROUPES.map((groupe) =>
          h('div', { class: 'rc-groupe' }, [
            h('div', { class: 'rc-titre', texte: groupe.titre }),
            ...groupe.lignes.map(([touches, quoi]) =>
              h('div', { class: 'rc-ligne' }, [
                h(
                  'span',
                  { class: 'rc-touches' },
                  touches.map((touche) => h('kbd', { texte: touche }))
                ),
                h('span', { class: 'rc-quoi', texte: quoi }),
              ])
            ),
          ])
        )
      ),
    ]);
  }

  return {
    /** Ouvre sous le bouton, ou referme si le dépliant est déjà là. */
    basculer(ancre) {
      if (flottant.estOuvert()) {
        flottant.fermer();
        return;
      }
      const boite = ancre.getBoundingClientRect();
      flottant.monter(panneau(), boite.left, boite.bottom + 6);
    },
    fermer: () => flottant.fermer(),
  };
}
