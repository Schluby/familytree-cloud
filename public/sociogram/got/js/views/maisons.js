/* Moteur de rendu « maisons » : une maison à la fois, en écran partagé.
 *
 * À gauche son histoire, à droite ce qu'elle est. C'est le partage que demande
 * la lecture en pleine partie : on cherche « qu'est-ce qui leur est arrivé »
 * d'un côté, « qu'est-ce qu'ils peuvent » de l'autre, et on ne veut pas
 * défiler de l'un à l'autre.
 *
 * Tout est éditable sur place. Les modifications partent au serveur peu après
 * la dernière frappe, comme dans la fiche d'une personne : il n'y a rien à
 * « enregistrer », et le payload local est mis à jour pour que l'affichage ne
 * revienne pas en arrière entre deux rechargements.
 */

import { Api } from '../api.js';
import { h, creerFlottant } from '../dom.js';
import { enregistrerRendu } from '../registry.js';

const DELAI_ENVOI = 500;

export function creerRenduMaisons(conteneur, contexte = {}) {
  const racine = h('div', { class: 'vue-maisons' });
  const onglets = h('div', { class: 'mz-onglets' });
  const colonnes = h('div', { class: 'mz-colonnes' });
  const gauche = h('div', { class: 'mz-colonne mz-histoire' });
  const droite = h('div', { class: 'mz-colonne mz-fiche' });
  colonnes.append(gauche, droite);
  racine.append(onglets, colonnes);
  conteneur.append(racine);

  const socle = creerFlottant();

  let payload = null;
  let options = {};
  let choisie = null; // id de la maison affichée
  const enAttente = new Map(); // id de maison -> patch pas encore parti
  const minuteries = new Map();

  const maisons = () => payload?.maisons || [];
  const courante = () => maisons().find((m) => m.id === choisie) || maisons()[0] || null;
  const typesRelations = () => options.typesRelations || [];

  // ------------------------------------------------------------ persistance

  /**
   * Un patch par maison, posté après une pause de frappe. On garde le dernier
   * état de chaque champ plutôt qu'une file : réécrire « Défense = 4 » deux
   * fois ne mérite pas deux requêtes.
   */
  function modifier(maisonId, patch, { immediat = false } = {}) {
    const accumule = { ...(enAttente.get(maisonId) || {}), ...patch };
    enAttente.set(maisonId, accumule);
    clearTimeout(minuteries.get(maisonId));
    if (immediat) return envoyer(maisonId);
    minuteries.set(maisonId, setTimeout(() => envoyer(maisonId), DELAI_ENVOI));
    return Promise.resolve();
  }

  async function envoyer(maisonId) {
    clearTimeout(minuteries.get(maisonId));
    const patch = enAttente.get(maisonId);
    if (!patch) return;
    enAttente.delete(maisonId);
    definirEtat('Enregistrement…');
    try {
      await Api.majMaison(maisonId, patch);
      definirEtat('Enregistré');
      // Le nom ou la couleur d'une maison se lisent aussi dans le rail.
      if (patch.label || patch.couleur) contexte.surReferentielChange?.();
    } catch (erreur) {
      // Rien n'est perdu : le patch revient dans la file, la frappe suivante
      // le repostera — et l'échec est dit, pas avalé.
      enAttente.set(maisonId, { ...patch, ...(enAttente.get(maisonId) || {}) });
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  let elementEtat = null;
  function definirEtat(texte, classe = '') {
    if (elementEtat) {
      elementEtat.textContent = texte;
      elementEtat.className = `mz-etat ${classe}`;
    }
  }

  // ------------------------------------------------------------------ rendu

  function dessinerOnglets() {
    onglets.replaceChildren(
      ...maisons().map((maison) => {
        const bouton = h('button', {
          type: 'button',
          class: `mz-onglet ${maison.id === courante()?.id ? 'actif' : ''}`,
          title: maison.devise ? `« ${maison.devise} »` : maison.label,
          onclick: () => {
            choisie = maison.id;
            dessiner();
          },
        });
        bouton.style.setProperty('--couleur-maison', maison.couleur);
        bouton.append(
          h('span', { class: 'mz-onglet-pastille' }),
          h('span', { texte: maison.label }),
          h('span', { class: 'nombre', texte: String(maison.membres.length) })
        );
        return bouton;
      })
    );
  }

  function dessiner() {
    const maison = courante();
    dessinerOnglets();
    if (!maison) {
      gauche.replaceChildren(h('p', { class: 'vide', texte: 'Aucune maison dans cette sauvegarde.' }));
      droite.replaceChildren();
      return;
    }
    choisie = maison.id;
    dessinerHistoire(maison);
    dessinerFiche(maison);
  }

  /** Une mention cliquable : elle ouvre la fiche de la personne. */
  function puceePersonne(personne) {
    const puce = h('button', {
      type: 'button',
      class: `mz-personne ${personne.statut === 'mort' ? 'morte' : ''}`,
      title: `Ouvrir la fiche de ${personne.label}`,
      onclick: () => contexte.surSelection?.(personne.id),
    });
    puce.style.setProperty('--couleur-personne', personne.couleur);
    puce.append(h('span', { class: 'mz-personne-pastille' }), h('span', { texte: personne.label }));
    return puce;
  }

  // ------------------------------------------------------------- l'histoire

  function dessinerHistoire(maison) {
    const ecrits = [...maison.evenements];
    const lies = maison.evenements_lies;

    gauche.replaceChildren(
      h('div', { class: 'mz-entete' }, [
        h('h2', { texte: 'Histoire' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '＋ Événement',
          title: 'Ajouter un événement à l’histoire de cette maison',
          onclick: (evenement) => ouvrirEvenement(maison, null, evenement),
        }),
      ]),
      ...(ecrits.length || lies.length
        ? []
        : [
            h('p', {
              class: 'vide mz-vide',
              texte: 'Rien d’écrit pour l’instant.',
            }),
          ]),
      ...ecrits.map((entree, index) => carteEvenement(maison, entree, index)),
      ...(lies.length
        ? [
            h('h3', { class: 'mz-sous-titre', texte: 'Ce que portent ses membres' }),
            h('p', {
              class: 'mz-aide',
              texte: 'Ils s’éditent sur le plan, pas ici.',
            }),
            ...lies.map((lien) => carteEvenementLie(lien)),
          ]
        : [])
    );
  }

  function carteEvenement(maison, entree, index) {
    return h('article', { class: 'mz-evenement' }, [
      h('div', { class: 'mz-evenement-haut' }, [
        entree.annee && h('span', { class: 'mz-annee', texte: entree.annee }),
        h('span', { class: 'mz-evenement-titre', texte: entree.titre || 'Sans titre' }),
        entree.lieu && h('span', { class: 'mz-lieu', texte: `⌖ ${entree.lieu}` }),
        h('button', {
          class: 'bouton bouton-icone mz-modifier',
          type: 'button',
          texte: '✎',
          title: 'Modifier cet événement',
          onclick: (evenement) => ouvrirEvenement(maison, index, evenement),
        }),
      ]),
      entree.texte && h('p', { class: 'mz-evenement-texte', texte: entree.texte }),
      entree.personnes.length &&
        h('div', { class: 'mz-personnes' }, entree.personnes.map(puceePersonne)),
    ]);
  }

  function carteEvenementLie(lien) {
    const article = h('article', { class: `mz-evenement mz-evenement-lie ${lien.revolu ? 'revolu' : ''}` });
    article.style.setProperty('--couleur-type', lien.couleur);
    article.append(
      ...[
        h('div', { class: 'mz-evenement-haut' }, [
          lien.annee && h('span', { class: 'mz-annee', texte: lien.annee }),
          h('span', { class: 'mz-evenement-titre', texte: lien.label || lien.type_label }),
          lien.lieu && h('span', { class: 'mz-lieu', texte: `⌖ ${lien.lieu}` }),
        ]),
        lien.notes ? h('p', { class: 'mz-evenement-texte', texte: lien.notes }) : null,
        h('div', { class: 'mz-personnes' }, lien.personnes.map(puceePersonne)),
      ].filter(Boolean)
    );
    return article;
  }

  // -------------------------------------------------------------- la fiche

  function dessinerFiche(maison) {
    elementEtat = h('span', { class: 'mz-etat' });

    droite.replaceChildren(
      h('div', { class: 'mz-entete' }, [
        h('h2', { texte: maison.label }),
        elementEtat,
      ]),
      maison.devise && h('p', { class: 'mz-devise', texte: `« ${maison.devise} »` }),
      blocRangs(maison),
      blocCaracteristiques(maison),
      // Les unités juste sous les caractéristiques (lot 20.E) : ce sont les
      // deux blocs chiffrés, et on passe de « ce qu'elle a » à « ce qu'elle
      // peut envoyer » sans changer de moitié d'écran.
      // Les compétences d'armée s'intercalent (lot 24) : elles valent pour la
      // troupe entière, et on les lit avant le détail des bannières.
      blocCompetencesArmee(maison),
      blocUnites(maison),
      blocNotes(maison),
      blocLiens(maison)
    );
  }

  function blocRangs(maison) {
    const ligne = (titre, liste, vide) =>
      h('div', { class: 'mz-rang-ligne' }, [
        h('span', { class: 'mz-rang-titre', texte: titre }),
        liste.length
          ? h('div', { class: 'mz-personnes' }, liste.map(puceePersonne))
          : h('span', { class: 'mz-rang-vide', texte: vide }),
      ]);

    return h('section', { class: 'mz-bloc' }, [
      ligne('♔ Chef', maison.chefs, 'personne de désigné'),
      ligne('✦ Héritier', maison.heritiers, 'personne de désigné'),
      h('p', {
        class: 'mz-aide',
        texte: `${maison.membres.length} membre${maison.membres.length > 1 ? 's' : ''}`,
      }),
    ]);
  }

  function blocCaracteristiques(maison) {
    const definitions = payload.caracteristiques || [];
    const scores = maison.caracteristiques || {};

    const lignes = definitions.map((definition) => {
      const valeur = scores[definition.id];
      const champ = h('input', {
        type: 'number',
        min: 0,
        max: 100,
        value: valeur ?? '',
        placeholder: '—',
        oninput: (evenement) => {
          const brut = evenement.target.value;
          const nouveau = { ...(courante().caracteristiques || {}) };
          if (brut === '') delete nouveau[definition.id];
          else nouveau[definition.id] = Math.max(0, Math.min(100, Number(brut)));
          courante().caracteristiques = nouveau;
          jauge.style.width = `${Math.min(100, Number(brut) || 0)}%`;
          modifier(maison.id, { caracteristiques: nouveau });
        },
      });
      const jauge = h('span', { class: 'mz-jauge-barre' });
      jauge.style.width = `${Math.min(100, valeur || 0)}%`;

      return h('div', { class: 'mz-carac', title: definition.aide }, [
        h('span', { class: 'mz-carac-nom', texte: definition.label }),
        h('span', { class: 'mz-jauge' }, [jauge]),
        champ,
      ]);
    });

    return h('section', { class: 'mz-bloc' }, [
      h('h3', { texte: 'Caractéristiques' }),
      h('div', { class: 'mz-caracs' }, lignes),
    ]);
  }

  /* ------------------------------------------------------ unités de guerre
   *
   * Ce qu'une maison peut envoyer sur le terrain (lot 20.E). Chaque champ
   * s'enregistre au fil de la frappe, comme le reste de la vue.
   *
   * **Une seule règle vaut la peine d'être dite** : chaque modification renvoie
   * la liste *entière* des unités, jamais une seule. Le champ `unites` d'une
   * maison est un tableau — il n'a pas d'identifiant par ligne, donc rien ne
   * permettrait au serveur de savoir laquelle on vient de changer. Le patch
   * accumulé par `modifier()` porte donc toujours le dernier état complet, et
   * deux frappes rapprochées dans deux unités différentes ne s'écrasent pas :
   * la seconde part avec ce que la première a déjà écrit dans le payload local.
   */

  /** Nom, type, arme, équipement : quatre petites zones de texte identiques. */
  function champUnite(maison, index, cle, placeholder, { large = false } = {}) {
    return h('input', {
      type: 'text',
      class: large ? 'mz-unite-large' : '',
      value: courante().unites[index][cle] ?? '',
      placeholder,
      oninput: (evenement) => {
        courante().unites[index][cle] = evenement.target.value;
        modifier(maison.id, { unites: courante().unites });
      },
    });
  }

  /** État et entraînement : deux listes fermées, descendues par le serveur. */
  function menuUnite(maison, index, cle, options) {
    const select = h('select', {
      onchange: (evenement) => {
        courante().unites[index][cle] = evenement.target.value;
        modifier(maison.id, { unites: courante().unites });
      },
    });
    for (const option of options) {
      const noeud = h('option', { value: option.id, texte: option.label });
      if (courante().unites[index][cle] === option.id) noeud.selected = true;
      select.append(noeud);
    }
    // L'état colore la ligne : sur une liste de douze unités en pleine
    // bataille, c'est la seule chose qu'on relit vraiment.
    if (cle === 'etat') select.classList.add(`mz-etat-${courante().unites[index].etat}`);
    return select;
  }

  /** Défense, santé (en %) et attaque (un chiffre). Vide reste vide. */
  function nombreUnite(maison, index, cle, { max = null, suffixe = '' } = {}) {
    const champ = h('input', {
      type: 'number',
      min: 0,
      value: courante().unites[index][cle] ?? '',
      placeholder: '—',
      oninput: (evenement) => {
        const brut = evenement.target.value;
        courante().unites[index][cle] = brut === '' ? null : Number(brut);
        modifier(maison.id, { unites: courante().unites });
      },
    });
    if (max !== null) champ.max = max;
    if (!suffixe) return champ;
    return h('span', { class: 'mz-unite-pourcent' }, [champ, h('span', { texte: suffixe })]);
  }

  function ligneUnite(maison, unite, index) {
    const notes = h('textarea', {
      rows: 3,
      placeholder: 'Pertes, moral, ordres reçus, ce qu’elle a vécu…',
      texte: unite.notes || '',
      oninput: (evenement) => {
        courante().unites[index].notes = evenement.target.value;
        modifier(maison.id, { unites: courante().unites });
      },
    });
    // Repliées par défaut : douze unités dépliées feraient trois écrans, et on
    // ouvre celle qu'on regarde. Le `<details>` natif porte l'état lui-même —
    // rien à retenir, rien à redessiner.
    const bloc = h('details', { class: 'mz-unite-notes' }, [
      h('summary', { texte: unite.notes ? 'Notes ✎' : 'Notes' }),
      notes,
    ]);

    return h('div', { class: 'mz-unite' }, [
      h('div', { class: 'mz-unite-haut' }, [
        champUnite(maison, index, 'nom', 'Nom de l’unité', { large: true }),
        champUnite(maison, index, 'type', 'Type (piquiers, cavalerie…)'),
        h('button', {
          class: 'bouton bouton-icone mz-retirer-unite',
          type: 'button',
          texte: '✕',
          title: `Retirer « ${unite.nom || 'cette unité'} »`,
          onclick: () => {
            courante().unites.splice(index, 1);
            modifier(maison.id, { unites: courante().unites }, { immediat: true });
            dessiner();
          },
        }),
      ]),
      h('div', { class: 'mz-unite-grille' }, [
        champUniteEtiquete('État', menuUnite(maison, index, 'etat', payload.etats_unite || [])),
        champUniteEtiquete(
          'Entraînement',
          menuUnite(maison, index, 'entrainement', payload.entrainements_unite || [])
        ),
        champUniteEtiquete('Défense', nombreUnite(maison, index, 'defense', { max: 100, suffixe: '%' })),
        champUniteEtiquete('Santé', nombreUnite(maison, index, 'sante', { max: 100, suffixe: '%' })),
        champUniteEtiquete('Attaque', nombreUnite(maison, index, 'attaque')),
        // Lot 24, quatrième page du classeur : la ligne de bataille d'une
        // unité. Elle prolonge les trois champs du lot 20.E au lieu de les
        // remplacer — « Défense » et « Santé » sont déjà remplies dans les
        // mondes existants, et les renommer aurait vidé leurs fiches en
        // silence.
        champUniteEtiquete('Dégâts CC', nombreUnite(maison, index, 'degats_cc')),
        champUniteEtiquete('Dégâts à distance', nombreUnite(maison, index, 'degats_dis')),
        champUniteEtiquete('Valeur d’armure', nombreUnite(maison, index, 'va')),
        champUniteEtiquete('Discipline', nombreUnite(maison, index, 'discipline')),
        champUniteEtiquete('Mouvement', champUnite(maison, index, 'mouvement', '4, à cheval…')),
        champUniteEtiquete('Arme', champUnite(maison, index, 'arme', 'Pique, arc long…')),
        champUniteEtiquete(
          'Équipement spécial',
          champUnite(maison, index, 'equipement', 'Cottes de mailles, béliers…'),
          { large: true }
        ),
      ]),
      bloc,
    ]);
  }

  function champUniteEtiquete(libelle, controle, { large = false } = {}) {
    return h('label', { class: `mz-unite-champ ${large ? 'pleine' : ''}`.trim() }, [
      h('span', { texte: libelle }),
      controle,
    ]);
  }

  /* --------------------------------------- compétences d'armée (lot 24)
   *
   * Onze des dix-neuf compétences du jeu — celles qui ont un sens pour une
   * troupe. Elles se posent sur la maison et non sur chaque unité : une armée
   * s'entraîne ensemble, et recopier onze rangs sur douze bannières n'aurait
   * rien décrit de plus.
   *
   * Le bloc reste replié tant qu'aucun rang n'est noté : une maison de la
   * cour n'a pas d'armée, et onze champs vides sur sa fiche ne diraient rien.
   */
  function blocCompetencesArmee(maison) {
    if (!maison.competences_armee || typeof maison.competences_armee !== 'object') {
      maison.competences_armee = {};
    }
    const rangs = maison.competences_armee;
    const liste = payload.competences_armee_liste || [];
    const remplies = liste.filter((competence) => rangs[competence.id]).length;

    const champ = (competence) =>
      h('label', { class: 'mz-carac' }, [
        h('span', { class: 'mz-carac-nom', texte: competence.label }),
        h('input', {
          type: 'number',
          min: 0,
          max: 20,
          value: rangs[competence.id] ?? '',
          placeholder: '—',
          oninput: (evenement) => {
            const brut = evenement.target.value;
            // Zéro et vide reviennent au même : le serveur n'écrit pas les
            // rangs nuls, et les garder ici ferait diverger l'affichage.
            if (brut === '' || Number(brut) === 0) delete rangs[competence.id];
            else rangs[competence.id] = Number(brut);
            modifier(maison.id, { competences_armee: rangs });
          },
        }),
      ]);

    const details = h('details', { class: 'mz-bloc' }, [
      h('summary', { texte: remplies ? `Compétences d’armée (${remplies})` : 'Compétences d’armée' }),
      h('div', { class: 'mz-caracs' }, liste.map(champ)),
    ]);
    // Ouvert dès qu'il y a quelque chose à lire.
    if (remplies) details.open = true;
    return details;
  }

  function blocUnites(maison) {
    // `unites` peut manquer d'un monde d'avant le lot 20.E : on l'installe une
    // fois pour toutes, sinon chaque écriture aurait à se demander s'il existe.
    if (!Array.isArray(maison.unites)) maison.unites = [];
    const unites = maison.unites;

    return h('section', { class: 'mz-bloc' }, [
      h('div', { class: 'mz-entete-bloc' }, [
        h('h3', { texte: 'Unités de guerre' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '＋ Unité',
          title: 'Ajouter une unité à cette maison',
          onclick: () => {
            // Un nom par défaut, et pas une ligne vide : le serveur écarte les
            // unités sans nom ni type (voir `unites()` dans `referentiels.ts`),
            // donc une ligne vraiment vide disparaîtrait au rechargement.
            courante().unites.push({
              nom: 'Nouvelle unité',
              type: '',
              etat: 'active',
              entrainement: 'entrainee',
              defense: null,
              sante: null,
              attaque: null,
              arme: '',
              equipement: '',
              notes: '',
              degats_cc: null,
              degats_dis: null,
              va: null,
              discipline: null,
              mouvement: '',
            });
            modifier(maison.id, { unites: courante().unites }, { immediat: true });
            dessiner();
            // Le nom est déjà là mais il est provisoire : on le sélectionne
            // pour que la première frappe le remplace. Le dernier de la liste,
            // et non `:last-of-type` — qui désigne le dernier `div` du parent,
            // pas la dernière unité.
            const champs = droite.querySelectorAll('.mz-unite .mz-unite-large');
            champs[champs.length - 1]?.select();
          },
        }),
      ]),
      ...(unites.length
        ? unites.map((unite, index) => ligneUnite(maison, unite, index))
        : [h('p', { class: 'mz-aide', texte: 'Aucune unité pour cette maison.' })]),
    ]);
  }

  function blocNotes(maison) {
    return h('section', { class: 'mz-bloc' }, [
      h('h3', { texte: 'Notes' }),
      h('textarea', {
        rows: 6,
        placeholder: 'Blason, terres, alliances anciennes, ce que la maison cache…',
        texte: maison.notes || '',
        oninput: (evenement) => {
          courante().notes = evenement.target.value;
          modifier(maison.id, { notes: evenement.target.value });
        },
      }),
    ]);
  }

  function blocLiens(maison) {
    const liens = maison.liens || [];
    return h('section', { class: 'mz-bloc' }, [
      h('div', { class: 'mz-entete-bloc' }, [
        h('h3', { texte: 'Liens avec les autres maisons' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '＋ Lien',
          onclick: (evenement) => ouvrirLien(maison, null, evenement),
        }),
      ]),
      ...(liens.length
        ? liens.map((lien, index) => ligneLien(maison, lien, index))
        : [
            h('p', {
              class: 'mz-aide',
              texte: 'Aucun lien avec une autre maison.',
            }),
          ]),
    ]);
  }

  function ligneLien(maison, lien, index) {
    const ligne = h('div', {
      class: `mz-lien ${lien.revolu ? 'revolu' : ''} ${lien.maison_existe ? '' : 'orphelin'}`,
      title: lien.notes || '',
    });
    ligne.style.setProperty('--couleur-maison', lien.maison_couleur);
    const versMaison = h(
      'button',
      {
        class: 'mz-personne',
        type: 'button',
        title: lien.maison_existe
          ? `Ouvrir la maison ${lien.maison_label}`
          : 'Cette maison n’existe plus dans la sauvegarde',
        onclick: () => {
          if (!lien.maison_existe) return;
          choisie = lien.maison;
          dessiner();
        },
      },
      [h('span', { class: 'mz-personne-pastille' }), h('span', { texte: lien.maison_label })]
    );
    versMaison.style.setProperty('--couleur-personne', lien.maison_couleur);

    // `append` écrirait « false » : contrairement à `h`, il transforme tout ce
    // qu'on lui passe en texte. Les entrées conditionnelles passent donc par la
    // liste d'enfants de `h`, qui, elle, saute ce qui est creux.
    ligne.append(
      ...[
        h('span', {
          class: 'mz-lien-type',
          texte: lien.type_label,
          style: { color: lien.type_couleur },
        }),
        h('span', { class: 'mz-lien-fleche', texte: lien.dirige ? '→' : '↔' }),
        versMaison,
        lien.revolu ? h('span', { class: 'mz-revolu', texte: 'révolu' }) : null,
        h('button', {
          class: 'bouton bouton-icone mz-modifier',
          type: 'button',
          texte: '✎',
          title: 'Modifier ce lien',
          onclick: (evenement) => ouvrirLien(maison, index, evenement),
        }),
      ].filter(Boolean)
    );
    return ligne;
  }

  // ------------------------------------------------------------- éditeurs
  //
  // Deux petits formulaires flottants, montés sur le même socle que les menus :
  // un événement, un lien de maison. Ils écrivent dans le payload local avant
  // de poster, pour que l'écran ne clignote pas entre les deux.

  function ouvrirEvenement(maison, index, declencheur) {
    const creation = index === null;
    const source = creation ? { annee: '', titre: '', texte: '', lieu: '', personnes: [] } : maison.evenements[index];
    const brouillon = {
      annee: source.annee || '',
      titre: source.titre || '',
      texte: source.texte || '',
      lieu: source.lieu || '',
      personnes: (source.personnes || []).map((p) => (typeof p === 'string' ? p : p.id)),
    };

    const listePersonnes = h('div', { class: 'mz-personnes' });
    const redessinerPersonnes = () => {
      listePersonnes.replaceChildren(
        ...brouillon.personnes.map((id) => {
          const fiche = (payload.noeuds || []).find((n) => n.id === id);
          const puce = h('span', { class: 'mz-personne mz-personne-retirable' }, [
            h('span', { class: 'mz-personne-pastille' }),
            h('span', { texte: fiche?.label || id }),
            h('button', {
              class: 'mz-retirer',
              type: 'button',
              texte: '✕',
              title: 'Retirer cette mention',
              onclick: () => {
                brouillon.personnes = brouillon.personnes.filter((autre) => autre !== id);
                redessinerPersonnes();
              },
            }),
          ]);
          puce.style.setProperty('--couleur-personne', fiche?.couleur || '#7a7f87');
          return puce;
        })
      );
    };
    redessinerPersonnes();

    const ajout = h(
      'select',
      {
        onchange: (evenement) => {
          const id = evenement.target.value;
          evenement.target.value = '';
          if (!id || brouillon.personnes.includes(id)) return;
          brouillon.personnes.push(id);
          redessinerPersonnes();
        },
      },
      [
        h('option', { value: '', texte: '＋ Citer quelqu’un…' }),
        ...[...(payload.noeuds || [])]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((noeud) => h('option', { value: noeud.id, texte: noeud.label })),
      ]
    );

    const champ = (cle, libelle, placeholder) =>
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: libelle }),
        h('input', {
          type: 'text',
          value: brouillon[cle],
          placeholder,
          oninput: (evenement) => {
            brouillon[cle] = evenement.target.value;
          },
        }),
      ]);

    const etat = h('span', { class: 'fl-etat' });
    const enregistrer = async () => {
      const evenements = [...maison.evenements].map((entree) => ({
        annee: entree.annee,
        titre: entree.titre,
        texte: entree.texte,
        lieu: entree.lieu,
        personnes: (entree.personnes || []).map((p) => (typeof p === 'string' ? p : p.id)),
      }));
      if (creation) evenements.push(brouillon);
      else evenements[index] = brouillon;
      etat.textContent = 'Enregistrement…';
      try {
        await Api.majMaison(maison.id, { evenements });
        socle.fermer();
        contexte.surRechargement?.();
      } catch (erreur) {
        etat.textContent = `Échec : ${erreur.message}`;
      }
    };

    const supprimer = async () => {
      const evenements = maison.evenements
        .filter((_, autre) => autre !== index)
        .map((entree) => ({
          annee: entree.annee,
          titre: entree.titre,
          texte: entree.texte,
          lieu: entree.lieu,
          personnes: (entree.personnes || []).map((p) => (typeof p === 'string' ? p : p.id)),
        }));
      etat.textContent = 'Suppression…';
      try {
        await Api.majMaison(maison.id, { evenements });
        socle.fermer();
        contexte.surRechargement?.();
      } catch (erreur) {
        etat.textContent = `Échec : ${erreur.message}`;
      }
    };

    socle.monter(
      h('div', { class: 'flottant editeur-referentiel' }, [
        h('div', { class: 'fl-entete' }, [
          h('div', { class: 'fl-titre' }, [
            h('span', { class: 'fl-nom', texte: creation ? 'Nouvel événement' : 'Modifier l’événement' }),
          ]),
          h('button', {
            class: 'bouton bouton-icone fl-fermer',
            type: 'button',
            texte: '✕',
            onclick: socle.fermer,
          }),
        ]),
        h('div', { class: 'fl-corps' }, [
          h('div', { class: 'grille-champs' }, [
            champ('annee', 'Année', payload.annee_courante || '299 AC'),
            champ('lieu', 'Lieu', 'Winterfell'),
          ]),
          champ('titre', 'Titre', 'La Noce Pourpre'),
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Récit' }),
            h('textarea', {
              rows: 4,
              texte: brouillon.texte,
              placeholder: 'Ce qui s’est passé, et ce que la maison en a gardé…',
              oninput: (evenement) => {
                brouillon.texte = evenement.target.value;
              },
            }),
          ]),
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Personnes citées (cliquables dans l’histoire)' }),
            ajout,
          ]),
          listePersonnes,
        ]),
        h('div', { class: 'fl-pied' }, [
          !creation &&
            h('button', {
              class: 'bouton bouton-danger',
              type: 'button',
              texte: '🗑 Supprimer',
              onclick: supprimer,
            }),
          etat,
          h('button', {
            class: 'bouton bouton-primaire',
            type: 'button',
            texte: creation ? '＋ Ajouter' : 'Enregistrer',
            onclick: enregistrer,
          }),
        ]),
      ]),
      declencheur?.clientX ?? 200,
      declencheur?.clientY ?? 140
    );
  }

  function ouvrirLien(maison, index, declencheur) {
    const creation = index === null;
    const autres = maisons().filter((m) => m.id !== maison.id);
    const source = creation
      ? { maison: autres[0]?.id || '', type: typesRelations()[0]?.id || 'autre', notes: '', revolu: false }
      : maison.liens[index];
    const brouillon = {
      maison: source.maison || '',
      type: source.type || 'autre',
      label: source.label || '',
      notes: source.notes || '',
      revolu: !!source.revolu,
    };

    const etat = h('span', { class: 'fl-etat' });
    const listeActuelle = () =>
      (maison.liens || []).map((lien) => ({
        maison: lien.maison,
        type: lien.type,
        label: lien.label,
        notes: lien.notes,
        revolu: lien.revolu,
      }));

    const ecrire = async (liens) => {
      etat.textContent = 'Enregistrement…';
      try {
        await Api.majMaison(maison.id, { liens });
        socle.fermer();
        contexte.surRechargement?.();
      } catch (erreur) {
        etat.textContent = `Échec : ${erreur.message}`;
      }
    };

    socle.monter(
      h('div', { class: 'flottant editeur-referentiel' }, [
        h('div', { class: 'fl-entete' }, [
          h('div', { class: 'fl-titre' }, [
            h('span', { class: 'fl-nom', texte: creation ? 'Nouveau lien de maison' : 'Modifier le lien' }),
          ]),
          h('button', {
            class: 'bouton bouton-icone fl-fermer',
            type: 'button',
            texte: '✕',
            onclick: socle.fermer,
          }),
        ]),
        h('div', { class: 'fl-corps' }, [
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: `${maison.label} est…` }),
            h(
              'select',
              { onchange: (evenement) => { brouillon.type = evenement.target.value; } },
              typesRelations().map((type) => {
                const option = h('option', { value: type.id, texte: type.label });
                if (type.id === brouillon.type) option.selected = true;
                return option;
              })
            ),
          ]),
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: '…de la maison' }),
            h(
              'select',
              { onchange: (evenement) => { brouillon.maison = evenement.target.value; } },
              autres.map((autre) => {
                const option = h('option', { value: autre.id, texte: autre.label });
                if (autre.id === brouillon.maison) option.selected = true;
                return option;
              })
            ),
          ]),
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Notes' }),
            h('textarea', {
              rows: 3,
              texte: brouillon.notes,
              placeholder: 'Depuis la Conquête, contre tribut annuel…',
              oninput: (evenement) => { brouillon.notes = evenement.target.value; },
            }),
          ]),
          h('label', { class: 'option' }, [
            h('input', {
              type: 'checkbox',
              checked: brouillon.revolu,
              onchange: (evenement) => { brouillon.revolu = evenement.target.checked; },
            }),
            h('span', { texte: 'Lien révolu (ancienne vassalité, alliance rompue)' }),
          ]),
        ]),
        h('div', { class: 'fl-pied' }, [
          !creation &&
            h('button', {
              class: 'bouton bouton-danger',
              type: 'button',
              texte: '🗑 Supprimer',
              onclick: () => ecrire(listeActuelle().filter((_, autre) => autre !== index)),
            }),
          etat,
          h('button', {
            class: 'bouton bouton-primaire',
            type: 'button',
            texte: creation ? '＋ Ajouter' : 'Enregistrer',
            onclick: () => {
              if (!brouillon.maison) {
                etat.textContent = 'Choisissez une maison.';
                return;
              }
              const liens = listeActuelle();
              if (creation) liens.push(brouillon);
              else liens[index] = brouillon;
              ecrire(liens);
            },
          }),
        ]),
      ]),
      declencheur?.clientX ?? 200,
      declencheur?.clientY ?? 140
    );
  }

  // ------------------------------------------------------------ cycle de vie

  return {
    rendre(nouveauPayload, nouvellesOptions = {}) {
      payload = nouveauPayload;
      options = { ...options, ...nouvellesOptions };
      dessiner();
      contexte.surDisposition?.({
        personnes: (payload.noeuds || []).length,
        liens: payload.stats?.liens ?? 0,
      });
    },

    majOptions(nouvellesOptions) {
      options = { ...options, ...nouvellesOptions };
    },

    /** Ouvrir quelqu'un depuis ailleurs amène sur la maison à laquelle il tient. */
    focus(id) {
      const noeud = (payload?.noeuds || []).find((n) => n.id === id);
      if (!noeud || noeud.maison === choisie) return;
      choisie = noeud.maison;
      dessiner();
    },

    detruire() {
      minuteries.forEach((minuterie) => clearTimeout(minuterie));
      socle.fermer();
      racine.remove();
    },
  };
}

enregistrerRendu('maisons', creerRenduMaisons);
