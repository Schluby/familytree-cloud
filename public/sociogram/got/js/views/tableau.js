/* Moteur de rendu « tableau » : la sauvegarde à plat + les exports.
 *
 * Deuxième rendu du projet, et donc la démonstration que le contrat tient :
 * ce module ne sait rien du sociogramme, il lit `payload.tables` et
 * `payload.exports`. Un futur rendu 3D s'ajoutera de la même façon —
 * backend/views/<vue>.py + web/js/views/<rendu>.js, rien d'autre à toucher.
 */

import { enregistrerRendu } from '../registry.js';
import { h, telecharger } from '../dom.js';

const LIGNES_PAR_PAGE = 200;

function creerTableau(conteneur, contexte = {}) {
  const racine = h('div', { class: 'plan-tableau' });
  const onglets = h('div', { class: 'tb-onglets' });
  const barre = h('div', { class: 'tb-barre' });
  const zone = h('div', { class: 'tb-zone' });
  racine.append(onglets, barre, zone);
  conteneur.append(racine);

  let payload = null;
  let options = {};
  let actif = null;
  let tri = { colonne: null, ordre: 1 };
  let filtre = '';
  let limite = LIGNES_PAR_PAGE;

  // ------------------------------------------------------------------ rendu
  function rendre(nouveau, nouvellesOptions = {}) {
    payload = nouveau;
    options = { ...options, ...nouvellesOptions };
    const tables = payload.tables || [];
    if (!tables.some((table) => table.id === actif)) {
      actif = tables[0]?.id || null;
      tri = { colonne: null, ordre: 1 };
    }
    dessinerOnglets();
    dessinerBarre();
    dessinerTable();
  }

  function majOptions(nouvellesOptions = {}) {
    options = { ...options, ...nouvellesOptions };
    if ('recherche' in nouvellesOptions) {
      limite = LIGNES_PAR_PAGE;
      dessinerTable();
    }
  }

  function tableCourante() {
    return (payload?.tables || []).find((table) => table.id === actif) || null;
  }

  function dessinerOnglets() {
    onglets.replaceChildren(
      ...(payload.tables || []).map((table) =>
        h(
          'button',
          {
            class: `tb-onglet ${table.id === actif ? 'actif' : ''}`,
            type: 'button',
            onclick: () => {
              actif = table.id;
              tri = { colonne: null, ordre: 1 };
              limite = LIGNES_PAR_PAGE;
              dessinerOnglets();
              dessinerBarre();
              dessinerTable();
            },
          },
          [
            h('span', { texte: table.titre }),
            h('span', { class: 'nombre', texte: table.lignes.length }),
          ]
        )
      )
    );
  }

  function dessinerBarre() {
    const table = tableCourante();
    const exports = payload.exports || [];
    const csv = exports.find((sortie) => sortie.table === actif);
    const classeur = exports.find((sortie) => sortie.format === 'xlsx');
    const json = exports.find((sortie) => sortie.format === 'json');

    const champ = h('input', {
      type: 'search',
      class: 'tb-filtre',
      placeholder: `Filtrer ${table ? table.titre.toLowerCase() : ''}…`,
      value: filtre,
      oninput: (evenement) => {
        filtre = evenement.target.value;
        limite = LIGNES_PAR_PAGE;
        dessinerTable();
      },
    });

    barre.replaceChildren(
      champ,
      h('span', { class: 'tb-info', id: 'tb-info' }),
      h('span', { class: 'tb-espace' }),
      csv &&
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '⤓ CSV',
          title: `Exporter « ${table?.titre} » en CSV (séparateur point-virgule)`,
          onclick: () => telecharger(csv.url),
        }),
      classeur &&
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: '⤓ Classeur Excel',
          title: 'Toutes les feuilles dans un seul .xlsx',
          onclick: () => telecharger(classeur.url),
        }),
      json &&
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '⤓ JSON',
          title: 'Le fichier de sauvegarde complet, réimportable',
          onclick: () => telecharger(json.url),
        })
    );
  }

  /** Filtre plein texte + tri, sur les lignes brutes du payload. */
  function lignesAffichees(table) {
    const requete = (filtre || options.recherche || '').trim().toLowerCase();
    let lignes = table.lignes;
    if (requete) {
      lignes = lignes.filter((ligne) =>
        ligne.some((valeur) => texte(valeur).toLowerCase().includes(requete))
      );
    }
    if (tri.colonne !== null) {
      const colonne = table.colonnes[tri.colonne];
      lignes = [...lignes].sort((a, b) => {
        const gauche = a[tri.colonne];
        const droite = b[tri.colonne];
        if (colonne.type === 'nombre') {
          return ((gauche ?? -Infinity) - (droite ?? -Infinity)) * tri.ordre;
        }
        return texte(gauche).localeCompare(texte(droite), 'fr') * tri.ordre;
      });
    }
    return lignes;
  }

  function texte(valeur) {
    if (valeur === null || valeur === undefined) return '';
    if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
    return String(valeur);
  }

  function dessinerTable() {
    const table = tableCourante();
    if (!table) {
      zone.replaceChildren(h('p', { class: 'vide', texte: 'Aucune donnée.' }));
      return;
    }
    const lignes = lignesAffichees(table);
    const visibles = lignes.slice(0, limite);

    const entete = h(
      'tr',
      {},
      table.colonnes.map((colonne, index) =>
        h(
          'th',
          {
            class: `${colonne.type === 'nombre' ? 'nombre' : ''} ${
              tri.colonne === index ? 'trie' : ''
            }`,
            onclick: () => {
              tri =
                tri.colonne === index
                  ? { colonne: index, ordre: -tri.ordre }
                  : { colonne: index, ordre: 1 };
              dessinerTable();
            },
          },
          [
            colonne.label,
            tri.colonne === index
              ? h('span', { class: 'tb-fleche', texte: tri.ordre > 0 ? ' ▲' : ' ▼' })
              : null,
          ]
        )
      )
    );

    const corps = visibles.map((ligne) =>
      h(
        'tr',
        {
          onclick: () => {
            // Les tableaux « personnes » et « liens » commencent par un id :
            // cliquer une ligne ouvre la fiche correspondante.
            const identifiant = table.id === 'personnes' ? ligne[0] : null;
            if (identifiant) contexte.surSelection?.(identifiant);
          },
          class: table.id === 'personnes' ? 'cliquable' : '',
        },
        ligne.map((valeur, index) =>
          h('td', {
            class: table.colonnes[index]?.type === 'nombre' ? 'nombre' : '',
            texte: texte(valeur),
            title: texte(valeur).length > 40 ? texte(valeur) : null,
          })
        )
      )
    );

    zone.replaceChildren(
      h('table', { class: 'tb-table' }, [
        h('thead', {}, [entete]),
        h('tbody', {}, corps.length ? corps : [
          h('tr', {}, [
            h('td', {
              colspan: table.colonnes.length,
              class: 'vide',
              texte: 'Rien ne correspond à ce filtre.',
            }),
          ]),
        ]),
      ]),
      lignes.length > visibles.length
        ? h('button', {
            class: 'bouton tb-plus',
            type: 'button',
            texte: `Afficher les ${lignes.length - visibles.length} lignes suivantes`,
            onclick: () => {
              limite += LIGNES_PAR_PAGE * 4;
              dessinerTable();
            },
          })
        : null
    );

    const info = barre.querySelector('#tb-info');
    if (info) {
      info.textContent =
        lignes.length === table.lignes.length
          ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''}`
          : `${lignes.length} / ${table.lignes.length} lignes`;
    }
    contexte.surDisposition?.({ personnes: payload.stats?.personnes });
  }

  // -------------------------------------------------- contrat des moteurs
  return {
    rendre,
    majOptions,
    /** Un tableau ne « centre » rien : on ouvre l'onglet des personnes. */
    focus(id) {
      if (!id) return;
      const personnes = (payload?.tables || []).find((table) => table.id === 'personnes');
      if (!personnes || actif === 'personnes') return;
      actif = 'personnes';
      dessinerOnglets();
      dessinerBarre();
      dessinerTable();
    },
    recentrer() {
      zone.scrollTo({ top: 0 });
    },
    detruire() {
      racine.remove();
    },
  };
}

enregistrerRendu('tableau', creerTableau);
