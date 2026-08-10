/* Champ de saisie avec suggestions.
 *
 * Volontairement pas un `<datalist>` : on veut afficher deux lignes par
 * proposition (le lieu, puis sa maison et sa région), et un datalist ne sait
 * pas faire. Le champ reste libre : ce qui n'est pas dans la liste s'écrit
 * quand même — un lieu inventé en cours de partie a autant de valeur.
 */

import { h } from './dom.js';

/** « Château Noir » → « chateau noir » : la recherche ignore accents et casse. */
export function aplatir(texte) {
  return (texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // les accents deviennent des marques
    .toLowerCase()
    .trim();
}

/**
 * @param {object} options
 *  - valeur : contenu initial
 *  - suggestions : () => [{ valeur, detail }]
 *  - surChangement : (texte) => void, appelé à chaque frappe et à la sélection
 *  - maximum : nombre de propositions affichées
 */
export function champSuggere({
  valeur = '',
  placeholder = '',
  suggestions,
  surChangement,
  maximum = 8,
}) {
  let filtrees = [];
  let survol = -1;

  const liste = h('ul', { class: 'suggestions', hidden: true });

  const saisie = h('input', {
    type: 'text',
    value: valeur,
    placeholder,
    autocomplete: 'off',
    oninput: (evenement) => {
      surChangement?.(evenement.target.value);
      proposer(evenement.target.value);
    },
    onfocus: (evenement) => proposer(evenement.target.value),
    // Le clic sur une proposition passe par `mousedown` : sans ce délai, le
    // `blur` fermerait la liste avant que le clic n'arrive.
    onblur: () => setTimeout(fermer, 120),
    onkeydown: (evenement) => {
      if (liste.hidden) return;
      if (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp') {
        evenement.preventDefault();
        deplacer(evenement.key === 'ArrowDown' ? 1 : -1);
      } else if (evenement.key === 'Enter' && survol >= 0) {
        evenement.preventDefault();
        choisir(filtrees[survol]);
      } else if (evenement.key === 'Escape') {
        fermer();
      }
    },
  });

  function proposer(texte) {
    const requete = aplatir(texte);
    const toutes = suggestions?.() || [];
    // Rien de saisi : on montre le début de la liste, ça vaut mieux qu'un vide.
    filtrees = (requete
      ? toutes.filter((s) => aplatir(s.valeur).includes(requete) || aplatir(s.detail).includes(requete))
      : toutes
    ).slice(0, maximum);
    survol = -1;
    dessiner();
  }

  function dessiner() {
    liste.replaceChildren(
      ...filtrees.map((suggestion, index) =>
        h(
          'li',
          {
            class: index === survol ? 'survol' : '',
            onmousedown: (evenement) => {
              evenement.preventDefault();
              choisir(suggestion);
            },
          },
          [
            h('span', { class: 'sug-valeur', texte: suggestion.valeur }),
            suggestion.detail && h('span', { class: 'sug-detail', texte: suggestion.detail }),
          ]
        )
      )
    );
    liste.hidden = !filtrees.length;
  }

  function deplacer(pas) {
    if (!filtrees.length) return;
    survol = (survol + pas + filtrees.length) % filtrees.length;
    dessiner();
  }

  function choisir(suggestion) {
    if (!suggestion) return;
    saisie.value = suggestion.valeur;
    surChangement?.(suggestion.valeur);
    fermer();
  }

  function fermer() {
    liste.hidden = true;
    survol = -1;
  }

  return h('div', { class: 'champ-suggere' }, [saisie, liste]);
}
