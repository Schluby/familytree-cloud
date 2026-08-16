/* Les gestes du plan collectif : écrire chez plusieurs membres à la fois.
 *
 * **Une seule porte d'écriture.** Ce module ne connaît aucune route d'écriture
 * qui lui soit propre : il envoie des lots, `/api/admin/lots/apercu` puis
 * `/api/admin/lots/appliquer`, exactement comme la page d'administration. Le
 * plan collectif change la façon de désigner ce qu'on touche, jamais la façon
 * de l'écrire.
 *
 * **Et la règle du lot est reconduite telle quelle : rien ne s'écrit sans un
 * aperçu relu.** « Appliquer » reste éteint tant qu'un aperçu n'a pas été lu,
 * et se rééteint dès qu'un champ bouge. Sur un plan où un clic droit touche
 * six arbres d'un coup, c'est encore plus vrai que dans un formulaire : le
 * geste est rapide, la portée ne l'est pas.
 *
 * **Ce que les grappes changent.** Une fiche est désignée par
 * `grappe:<clé>` et non par un identifiant : c'est le serveur qui traduit,
 * sauvegarde par sauvegarde. Sans ça, poser un lien « chez tout le monde »
 * échouerait précisément chez ceux qui ont renommé leur fiche — c'est-à-dire
 * là où le plan collectif sert.
 */

import { h, creerFlottant } from './dom.js';
import { appeler } from './identite.js';

const EFFETS = {
  cree: 'créé',
  mis_a_jour: 'mis à jour',
  inchange: 'déjà en place',
  refuse: 'refusé',
};

export function creerGestes({ surFait } = {}) {
  // `persistant` : un aperçu se relit, et un panneau qui se referme au premier
  // clic à côté ferait perdre le rapport qu'on est en train de lire.
  const socle = creerFlottant({ persistant: true });

  let geste = null;
  let valeurs = {};
  let refs = {};
  let apercuLu = null;
  let occupe = '';

  /**
   * Ouvre un geste.
   *
   * `geste` = {
   *   titre, aide,
   *   comptes: [ids],           // qui sera touché
   *   champs: [{nom, label, type, valeur, options, aide, requis}],
   *   operation(valeurs) -> objet d'opération de lot,
   *   verbe                     // « Créer », « Modifier »… pour le bouton
   * }
   */
  function ouvrir(nouveau, x, y) {
    geste = nouveau;
    valeurs = {};
    for (const champ of geste.champs || []) valeurs[champ.nom] = champ.valeur ?? '';
    apercuLu = null;
    occupe = '';
    monter(x, y);
    refs.premier?.focus();
  }

  function monter(x, y) {
    socle.monter(construire(), x, y);
  }

  function corps() {
    return {
      comptes: geste.comptes,
      // `arbres` désigne, membre par membre, **l'arbre que le plan affiche**.
      // C'est ce qui garantit qu'un geste posé sur une carte écrit là où on
      // regardait, et non dans la sauvegarde que son propriétaire a ouverte de
      // son côté. `portee` ne sert plus que de repli si le plan n'a rien dit.
      arbres: geste.arbres ?? {},
      portee: 'active',
      seuil: geste.seuil,
      operation: geste.operation(valeurs),
    };
  }

  function manque() {
    for (const champ of geste.champs || []) {
      if (champ.requis && !String(valeurs[champ.nom] ?? '').trim()) {
        return `« ${champ.label} » est nécessaire.`;
      }
    }
    if (!geste.comptes.length) return 'Aucun membre sélectionné.';
    return '';
  }

  function perimer() {
    apercuLu = null;
    majBoutons();
  }

  function majBoutons() {
    if (!refs.apercu) return;
    const raison = manque();
    refs.apercu.disabled = Boolean(occupe) || Boolean(raison);
    refs.appliquer.disabled = Boolean(occupe) || apercuLu === null;
    refs.apercu.classList.toggle('bouton-primaire', apercuLu === null);
    refs.appliquer.classList.toggle('bouton-primaire', apercuLu !== null);
    refs.etat.textContent =
      occupe === 'apercu'
        ? 'Aperçu en cours…'
        : occupe === 'appliquer'
          ? 'Écriture en cours…'
          : raison ||
            (apercuLu === null
              ? 'Faites un aperçu — rien ne s’écrit avant.'
              : 'Aperçu relu : vous pouvez appliquer.');
    refs.etat.classList.toggle('erreur', Boolean(raison) && !occupe);
  }

  function champ(descripteur) {
    const surSaisie = (evenement) => {
      valeurs[descripteur.nom] =
        descripteur.type === 'bool' ? evenement.target.checked : evenement.target.value;
      perimer();
    };

    if (descripteur.type === 'bool') {
      const entree = h('input', {
        type: 'checkbox',
        checked: Boolean(valeurs[descripteur.nom]),
        onchange: surSaisie,
      });
      return h('label', { class: 'gc-bascule' }, [entree, h('span', { texte: descripteur.label })]);
    }

    let entree;
    if (descripteur.type === 'liste') {
      entree = h(
        'select',
        { onchange: surSaisie },
        (descripteur.options || []).map((option) =>
          h('option', {
            value: option.id,
            texte: option.label,
            selected: option.id === valeurs[descripteur.nom],
          })
        )
      );
    } else if (descripteur.type === 'zone') {
      entree = h('textarea', { rows: 2, oninput: surSaisie });
      entree.value = valeurs[descripteur.nom] ?? '';
    } else {
      entree = h('input', {
        type: 'text',
        value: valeurs[descripteur.nom] ?? '',
        placeholder: descripteur.exemple || '',
        oninput: surSaisie,
      });
    }
    if (!refs.premier) refs.premier = entree;

    return h('div', { class: 'champ-edit' }, [
      h('label', { texte: descripteur.label }),
      entree,
      descripteur.aide && h('span', { class: 'fl-aide', texte: descripteur.aide }),
    ]);
  }

  function construire() {
    refs = { premier: null };
    refs.etat = h('span', { class: 'fl-etat' });
    refs.rapport = h('div', { class: 'gc-rapport', hidden: true });

    refs.apercu = h('button', {
      class: 'bouton bouton-primaire',
      type: 'button',
      texte: 'Aperçu',
      onclick: apercu,
    });
    refs.appliquer = h('button', {
      class: 'bouton',
      type: 'button',
      texte: geste.verbe || 'Appliquer',
      disabled: true,
      onclick: appliquer,
    });

    const panneau = h('div', { class: 'flottant flottant-geste' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', { class: 'fl-nom', texte: geste.titre }),
          h('span', { class: 'gc-portee', texte: portee() }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer',
          onclick: socle.fermer,
        }),
      ]),
      h('div', { class: 'fl-corps' }, [
        geste.aide && h('p', { class: 'fl-aide', texte: geste.aide }),
        ...(geste.champs || []).map(champ),
        refs.rapport,
      ]),
      h('div', { class: 'fl-pied' }, [refs.apercu, refs.appliquer, refs.etat]),
    ]);

    queueMicrotask(majBoutons);
    return panneau;
  }

  function portee() {
    const combien = geste.comptes.length;
    return `chez ${combien} membre${combien > 1 ? 's' : ''}`;
  }

  async function lancer(chemin, quoi) {
    occupe = quoi;
    majBoutons();
    try {
      const { ok, donnees } = await appeler(chemin, {
        method: 'POST',
        body: JSON.stringify(corps()),
      });
      if (!ok) {
        refs.etat.textContent = donnees?.erreur || 'Erreur';
        refs.etat.classList.add('erreur');
        return null;
      }
      dessinerRapport(donnees);
      return donnees;
    } catch (erreur) {
      refs.etat.textContent = `Le serveur n’a pas répondu — ${erreur.message}`;
      refs.etat.classList.add('erreur');
      return null;
    } finally {
      occupe = '';
      majBoutons();
    }
  }

  async function apercu() {
    const resultat = await lancer('/api/admin/lots/apercu', 'apercu');
    if (!resultat) return;
    // Un aperçu sans effet n'arme pas « Appliquer » : il n'y aurait rien à
    // écrire, et le bouton promettrait un geste qui ne se produira pas.
    const sansEffet = resultat.resume.creees + resultat.resume.mises_a_jour === 0;
    apercuLu = sansEffet ? null : JSON.stringify(corps());
    majBoutons();
    if (sansEffet) refs.etat.textContent = 'Rien ne changerait : c’est déjà en place partout.';
  }

  async function appliquer() {
    // Le formulaire a pu bouger entre l'aperçu et le clic.
    if (apercuLu !== JSON.stringify(corps())) {
      perimer();
      refs.etat.textContent = 'Le geste a changé depuis l’aperçu. Refaites un aperçu.';
      refs.etat.classList.add('erreur');
      return;
    }
    const resultat = await lancer('/api/admin/lots/appliquer', 'appliquer');
    if (!resultat) return;
    apercuLu = null;
    majBoutons();
    refs.etat.textContent =
      `${resultat.resume.creees} création(s), ${resultat.resume.mises_a_jour} mise(s) à jour` +
      (resultat.resume.refusees ? `, ${resultat.resume.refusees} refus` : '');
    surFait?.(resultat);
  }

  /**
   * Le rapport, membre par membre.
   *
   * On montre **toutes** les lignes, y compris les « déjà en place ». Sur six
   * arbres, ce sont elles qui disent que le geste a bien porté partout ; les
   * cacher laisserait croire à un lot à moitié appliqué.
   */
  function dessinerRapport(resultat) {
    refs.rapport.hidden = false;
    refs.rapport.replaceChildren(
      h('p', {
        class: 'fl-aide',
        texte:
          `${resultat.resume.sauvegardes} arbre(s) — ` +
          `${resultat.resume.creees} à créer, ${resultat.resume.mises_a_jour} à mettre à jour, ` +
          `${resultat.resume.inchangees} déjà en place, ${resultat.resume.refusees} refusé(s).` +
          (resultat.simulation ? ' Rien n’est écrit à ce stade.' : ''),
      }),
      h(
        'ul',
        { class: 'gc-lignes' },
        resultat.details.map((detail) =>
          h('li', { class: `gc-${detail.etat}` }, [
            h('span', { class: 'gc-qui', texte: detail.compte }),
            h('span', { class: 'gc-etat', texte: EFFETS[detail.etat] || detail.etat }),
            h('span', { class: 'gc-quoi', texte: detail.message || detail.quoi }),
          ])
        )
      )
    );
  }

  return { ouvrir, fermer: socle.fermer, estOuvert: socle.estOuvert };
}
