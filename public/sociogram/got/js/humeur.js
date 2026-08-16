/* L'échelle d'humeur, côté web : un widget, une source.
 *
 * La table (libellés, MD, MP, couleurs) vient de /api/referentiels — elle
 * n'est PAS recopiée ici. `definirTable()` est appelée au chargement des
 * référentiels ; tout le reste du code se contente d'appeler `curseurHumeur`
 * ou `couleurHumeur`.
 *
 * Rappel utile en relisant : 1 = Affectueux (le meilleur), 7 = Malveillant.
 */

import { h } from './dom.js';

export const DEFAUT = 4;
const COULEUR_INCONNUE = '#9aa3ae';

let table = [];

export function definirTable(nouvelle) {
  if (Array.isArray(nouvelle) && nouvelle.length) table = nouvelle;
}

export const tableHumeur = () => table;

export const cranHumeur = (valeur) =>
  table.find((cran) => cran.valeur === Number(valeur)) || null;

export const libelleHumeur = (valeur) => cranHumeur(valeur)?.label || '';

/** Couleur d'une humeur ; `null` (pas encore rencontré) reste gris. */
export function couleurHumeur(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return COULEUR_INCONNUE;
  return cranHumeur(Math.round(Number(valeur)))?.couleur || COULEUR_INCONNUE;
}

/** Écart à l'indifférence : ce qui fait l'épaisseur d'un trait. */
export const ecartHumeur = (valeur) => Math.abs((Number(valeur) || DEFAUT) - DEFAUT);

const signe = (nombre) => (nombre > 0 ? `+${nombre}` : `${nombre}`);

/**
 * Le curseur : une ligne de 7 points, le mot en dessous, les deux
 * modificateurs encore en dessous. Un seul point est plein — une humeur est
 * un cran, pas une jauge qu'on remplit.
 *
 * `effacable` : recliquer sur le point actif remet à « pas encore rencontré »
 * (utile pour les joueurs, absurde pour un lien qui existe forcément).
 */
export function curseurHumeur({ valeur = null, effacable = false, surChangement }) {
  const points = h('div', { class: 'humeur-points' });
  const mot = h('div', { class: 'humeur-mot' });
  const modificateurs = h('div', { class: 'humeur-modificateurs' });

  const racine = h('div', { class: 'humeur' }, [points, mot, modificateurs]);

  function peindre(courante) {
    [...points.children].forEach((point, index) => {
      const cran = table[index];
      const actif = cran && Number(courante) === cran.valeur;
      point.classList.toggle('actif', !!actif);
      point.style.background = actif ? cran.couleur : '';
      point.style.borderColor = actif ? cran.couleur : '';
    });

    const cran = cranHumeur(courante);
    mot.textContent = cran ? `${cran.valeur} · ${cran.label}` : 'Pas encore rencontré';
    mot.classList.toggle('vide', !cran);
    modificateurs.replaceChildren(
      ...(cran
        ? [
            h('span', {
              class: 'humeur-mod',
              title: 'Modificateur de Duperie',
              texte: `MD ${signe(cran.md)}`,
            }),
            h('span', {
              class: 'humeur-mod',
              title: 'Modificateur de Persuasion',
              texte: `MP ${signe(cran.mp)}`,
            }),
          ]
        : [h('span', { class: 'humeur-mod vide', texte: 'aucun modificateur' })])
    );
  }

  table.forEach((cran) => {
    points.append(
      h('button', {
        class: 'humeur-point',
        type: 'button',
        title: `${cran.valeur} — ${cran.label} · MD ${signe(cran.md)} · MP ${signe(cran.mp)}`,
        onclick: () => {
          const courante = effacable && racine.dataset.valeur === String(cran.valeur)
            ? null
            : cran.valeur;
          racine.dataset.valeur = courante === null ? '' : String(courante);
          peindre(courante);
          surChangement?.(courante);
        },
      })
    );
  });

  racine.dataset.valeur = valeur === null || valeur === undefined ? '' : String(valeur);
  peindre(valeur);
  return racine;
}
