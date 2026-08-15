/* Moteur de rendu « carnet » : la vue plein écran du carnet de notes.
 *
 * Il ne dessine rien. Le carnet est un composant qui vit ailleurs (`carnet.js`)
 * parce qu'il s'ouvre **aussi** en volet à côté du plan ; ce module se contente
 * d'aller chercher l'exemplaire existant et de le poser dans la scène.
 *
 * C'est le seul rendu du projet qui fonctionne ainsi, et c'est voulu : deux
 * carnets ouverts sur le même monde, ce serait deux brouillons qui s'écrasent.
 */

import { carnetPartage } from '../carnet.js';
import { h } from '../dom.js';
import { enregistrerRendu } from '../registry.js';

function creerRenduCarnet(conteneur, contexte = {}) {
  const carnet = carnetPartage();

  if (!carnet) {
    // Ne devrait pas arriver : `main.js` pose l'exemplaire au démarrage. On le
    // dit plutôt que d'afficher une scène vide sans explication.
    const message = h('p', { class: 'vide', texte: 'Le carnet n’est pas disponible.' });
    conteneur.append(message);
    return {
      rendre() {},
      detruire() {
        message.remove();
      },
    };
  }

  conteneur.append(carnet.element);
  carnet.replacer(true); // pleine page : le sommaire devient une colonne

  return {
    rendre(payload) {
      carnet.appliquer(payload);
      contexte.surDisposition?.({ personnes: payload.stats?.personnes });
    },
    majOptions() {},
    /** Une note ne se « centre » pas : la sélection d'une personne ne la bouge pas. */
    focus() {},
    recentrer() {
      carnet.element.querySelector('.cn-note')?.scrollTo({ top: 0 });
    },
    detruire() {
      // On retire l'exemplaire de la scène **sans le détruire** : il repart
      // vivre dans le volet si quelqu'un l'y rappelle, avec son texte intact.
      carnet.vider();
      carnet.element.remove();
    },
  };
}

enregistrerRendu('carnet', creerRenduCarnet);
