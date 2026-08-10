/* Éditeurs flottants : un lien, un nouveau profil.
 *
 * Ils parlent directement à l'API (création / modification / suppression) et
 * préviennent l'orchestrateur via `surChangement` pour qu'il recharge la vue.
 */

import { Api } from './api.js';
import { h, creerFlottant, choisirFichier } from './dom.js';
import { DEFAUT as HUMEUR_DEFAUT, curseurHumeur } from './humeur.js';

const LIBELLES_CATEGORIE = {
  famille: 'Sang & alliances',
  social: 'Liens sociaux',
  politique: 'Liens politiques',
  autre: 'Autres liens',
};

// ==========================================================================
//  Éditeur de lien
// ==========================================================================

export function creerEditeurLien(rappels = {}) {
  // Fermer, c'est aussi poster ce qui n'est pas encore parti : un lien modifié
  // puis refermé à la volée ne doit rien perdre.
  const socle = creerFlottant({ surFermeture: () => envoyer() });
  let brouillon = null;
  let creation = false;
  let armeSuppression = false;
  let refs = {};
  let minuteur = null;
  let enAttente = false;

  const types = () => (rappels.types?.() || []).filter((type) => type && type.id);
  const nomDe = (id) => rappels.nomDe?.(id) || id;
  const typeCourant = () => types().find((type) => type.id === brouillon.type) || {};

  function ouvrirCreation({ source, cible }, x, y) {
    const liste = types();
    const defaut =
      liste.find((type) => type.categorie === 'social') || liste[0] || { id: 'autre' };
    creation = true;
    armeSuppression = false;
    enAttente = false;
    brouillon = {
      source,
      cible,
      type: defaut.id,
      humeur: HUMEUR_DEFAUT,
      label: '',
      notes: '',
      secret: false,
    };
    socle.monter(construire(), x, y);
    refs.type?.focus();
  }

  function ouvrirModification(arete, x, y) {
    creation = false;
    armeSuppression = false;
    enAttente = false;
    brouillon = {
      id: arete.id,
      source: arete.source,
      cible: arete.cible,
      type: arete.type,
      humeur: arete.humeur ?? HUMEUR_DEFAUT,
      label: arete.label || '',
      notes: arete.notes || '',
      secret: !!arete.secret,
    };
    socle.monter(construire(), x, y);
  }

  // ------------------------------------------------------------------ rendu
  function construire() {
    refs = {};

    refs.titre = h('div', { class: 'fl-titre' });
    refs.pastille = h('span', { class: 'fl-pastille' });
    refs.etat = h('span', { class: 'fl-etat' });

    const selecteur = h(
      'select',
      {
        onchange: (evenement) => {
          brouillon.type = evenement.target.value;
          majEntete();
          marquerModifie();
        },
      },
      groupesDeTypes()
    );
    refs.type = selecteur;

    refs.humeur = curseurHumeur({
      valeur: brouillon.humeur,
      surChangement: (valeur) => {
        brouillon.humeur = valeur ?? HUMEUR_DEFAUT;
        marquerModifie();
      },
    });

    refs.supprimer =
      !creation &&
      h('button', {
        class: 'bouton bouton-danger',
        type: 'button',
        texte: '🗑 Supprimer',
        onclick: supprimer,
      });

    const corps = h('div', { class: 'fl-corps' }, [
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Type de lien' }),
        h('div', { class: 'champ-avec-pastille' }, [refs.pastille, selecteur]),
      ]),
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Humeur — ce que la source éprouve' }),
        refs.humeur,
      ]),
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Libellé (facultatif)' }),
        h('input', {
          type: 'text',
          placeholder: 'Frères d’armes, dette de sang…',
          value: brouillon.label,
          oninput: (evenement) => {
            brouillon.label = evenement.target.value;
            marquerModifie();
          },
        }),
      ]),
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Notes' }),
        h('textarea', {
          rows: 2,
          placeholder: 'Ce que les joueurs ignorent encore…',
          oninput: (evenement) => {
            brouillon.notes = evenement.target.value;
            marquerModifie();
          },
          texte: brouillon.notes,
        }),
      ]),
      h('label', { class: 'option' }, [
        h('input', {
          type: 'checkbox',
          checked: brouillon.secret,
          onchange: (evenement) => {
            brouillon.secret = evenement.target.checked;
            marquerModifie();
          },
        }),
        h('span', { texte: 'Lien secret (masqué par défaut)' }),
      ]),
    ]);

    const panneau = h('div', { class: 'flottant editeur-lien' }, [
      h('div', { class: 'fl-entete' }, [
        refs.titre,
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer (Échap)',
          onclick: socle.fermer,
        }),
      ]),
      corps,
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '⇄ Inverser',
          title: 'Échanger la source et la cible',
          onclick: () => {
            const source = brouillon.source;
            brouillon.source = brouillon.cible;
            brouillon.cible = source;
            majEntete();
            marquerModifie();
          },
        }),
        refs.supprimer,
        refs.etat,
        creation &&
          h('button', {
            class: 'bouton bouton-primaire',
            type: 'button',
            texte: 'Créer le lien',
            onclick: enregistrer,
          }),
      ]),
    ]);

    majEntete();
    if (!creation) definirEtat('Enregistré tout seul');
    return panneau;
  }

  function groupesDeTypes() {
    const parCategorie = new Map();
    types().forEach((type) => {
      const categorie = type.categorie || 'autre';
      if (!parCategorie.has(categorie)) parCategorie.set(categorie, []);
      parCategorie.get(categorie).push(type);
    });
    return [...parCategorie.entries()].map(([categorie, liste]) =>
      h(
        'optgroup',
        { label: LIBELLES_CATEGORIE[categorie] || categorie },
        liste.map((type) => {
          const option = h('option', { value: type.id, texte: type.label || type.id });
          if (type.id === brouillon.type) option.selected = true;
          return option;
        })
      )
    );
  }

  function majEntete() {
    const type = typeCourant();
    const fleche = type.dirige ? '→' : '↔';
    refs.titre.replaceChildren(
      h('span', { class: 'fl-nom', texte: nomDe(brouillon.source) }),
      h('span', { class: 'fl-fleche', texte: ` ${fleche} ` }),
      h('span', { class: 'fl-nom', texte: nomDe(brouillon.cible) })
    );
    refs.pastille.style.background = type.couleur || '#8a8f98';
  }

  function definirEtat(texte, classe = '') {
    refs.etat.textContent = texte;
    refs.etat.className = `fl-etat ${classe}`;
  }

  // ------------------------------------------------------------ persistance
  //
  // Sur un lien qui existe déjà il n'y a rien à valider : le changement part
  // tout seul peu après la dernière frappe, et le serveur pose sur le disque à
  // son rythme (barre du haut). Seule la création garde un bouton — tant que le
  // lien n'existe pas, il n'y a rien à modifier.

  function charge() {
    return {
      source: brouillon.source,
      cible: brouillon.cible,
      type: brouillon.type,
      humeur: brouillon.humeur,
      label: brouillon.label,
      notes: brouillon.notes,
      secret: brouillon.secret,
    };
  }

  function marquerModifie() {
    if (creation || !brouillon) return;
    enAttente = true;
    definirEtat('Modifié…');
    clearTimeout(minuteur);
    minuteur = setTimeout(envoyer, 500);
  }

  async function envoyer() {
    clearTimeout(minuteur);
    minuteur = null;
    if (creation || !enAttente || !brouillon) return;
    enAttente = false;
    const id = brouillon.id;
    try {
      const reponse = await Api.majRelation(id, charge());
      definirEtat('Enregistré tout seul');
      rappels.surChangement?.(reponse.relation, 'modification');
    } catch (erreur) {
      enAttente = true; // rien n'est perdu : on repostera à la prochaine touche
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function enregistrer() {
    definirEtat('Création…');
    try {
      const reponse = await Api.creerRelation(charge());
      socle.fermer();
      rappels.surChangement?.(reponse.relation, 'creation');
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    if (!armeSuppression) {
      armeSuppression = true;
      refs.supprimer.textContent = 'Confirmer ?';
      refs.supprimer.classList.add('arme');
      return;
    }
    // Le lien s'en va : ce qui attendait d'être posté n'a plus de destinataire.
    enAttente = false;
    clearTimeout(minuteur);
    definirEtat('Suppression…');
    try {
      await Api.supprimerRelation(brouillon.id);
      socle.fermer();
      rappels.surChangement?.(null, 'suppression');
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, fermer: socle.fermer };
}

// ==========================================================================
//  Formulaire de nouveau profil
// ==========================================================================

export function creerFormulairePersonne(rappels = {}) {
  const socle = creerFlottant();
  let position = { x: 0, y: 0 };
  let lierA = null;
  let refs = {};

  function ouvrir(x, y, { lierA: ancre = null } = {}) {
    position = { x, y };
    lierA = ancre;
    socle.monter(construire(), x, y);
    refs.prenom.focus();
  }

  function construire() {
    refs = {};
    refs.etat = h('span', { class: 'fl-etat' });

    const surEntree = (evenement) => {
      if (evenement.key === 'Enter') {
        evenement.preventDefault();
        creer();
      }
    };

    refs.prenom = h('input', { type: 'text', placeholder: 'Prénom', onkeydown: surEntree });
    refs.nom = h('input', { type: 'text', placeholder: 'Nom', onkeydown: surEntree });
    refs.surnom = h('input', {
      type: 'text',
      placeholder: 'Surnom (facultatif)',
      onkeydown: surEntree,
    });

    refs.maison = h(
      'select',
      {},
      (rappels.maisons?.() || []).map((maison) =>
        h('option', { value: maison.id, texte: maison.label || maison.id })
      )
    );
    refs.statut = h('select', {}, [
      h('option', { value: 'vivant', texte: 'Vivant' }),
      h('option', { value: 'mort', texte: 'Mort' }),
      h('option', { value: 'inconnu', texte: 'Inconnu' }),
    ]);

    // On note souvent quelque chose au moment même où le personnage apparaît :
    // autant l'écrire ici plutôt que de rouvrir la fiche juste après.
    refs.notes = h('textarea', {
      rows: 3,
      placeholder: 'Ce qu’il faut retenir de lui — première impression, rumeur, dette…',
    });

    return h('div', { class: 'flottant formulaire-personne' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', {
            class: 'fl-nom',
            texte: lierA ? `Nouveau profil relié à ${rappels.nomDe?.(lierA) || lierA}` : 'Nouveau profil',
          }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer (Échap)',
          onclick: socle.fermer,
        }),
      ]),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'grille-champs' }, [
          h('div', { class: 'champ-edit' }, [h('label', { texte: 'Prénom' }), refs.prenom]),
          h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.nom]),
          h('div', { class: 'champ-edit pleine' }, [
            h('label', { texte: 'Surnom' }),
            refs.surnom,
          ]),
          h('div', { class: 'champ-edit' }, [h('label', { texte: 'Maison' }), refs.maison]),
          h('div', { class: 'champ-edit' }, [h('label', { texte: 'Statut' }), refs.statut]),
          h('div', { class: 'champ-edit pleine' }, [
            h('label', { texte: 'Notes' }),
            refs.notes,
          ]),
        ]),
        h('p', {
          class: 'fl-aide',
          texte: lierA
            ? 'Le profil créé, l’éditeur de lien s’ouvre pour choisir la nature de la relation.'
            : 'Le profil apparaît sans lien : glissez la poignée ＋ d’une fiche vers lui pour le relier.',
        }),
      ]),
      h('div', { class: 'fl-pied' }, [
        refs.etat,
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: '＋ Créer le profil',
          onclick: creer,
        }),
      ]),
    ]);
  }

  async function creer() {
    const prenom = refs.prenom.value.trim();
    const nom = refs.nom.value.trim();
    if (!prenom && !nom) {
      refs.etat.textContent = 'Indiquez au moins un nom.';
      refs.etat.className = 'fl-etat erreur';
      refs.prenom.focus();
      return;
    }
    refs.etat.textContent = 'Création…';
    refs.etat.className = 'fl-etat';
    try {
      const reponse = await Api.creerPersonne({
        prenom,
        nom,
        surnom: refs.surnom.value.trim(),
        maison: refs.maison.value,
        statut: refs.statut.value,
        notes: refs.notes.value.trim(),
      });
      socle.fermer();
      rappels.surCreation?.(reponse.personne, { lierA, ...position });
    } catch (erreur) {
      refs.etat.textContent = `Échec : ${erreur.message}`;
      refs.etat.className = 'fl-etat erreur';
    }
  }

  return { ouvrir, fermer: socle.fermer };
}

// ==========================================================================
//  Référentiels : maisons et types de liens
//
//  Deux éditeurs jumeaux. Ce qu'ils ont en commun : l'identifiant fixé à la
//  création ne bouge plus (les fiches s'y réfèrent), et supprimer demande
//  toujours où reverser ce qui reste.
// ==========================================================================

const PALETTE = [
  '#8c2f39', '#b8452f', '#c1762f', '#c9a227', '#6f8f3f', '#3f8f6f', '#2f8f8f',
  '#3f6f9f', '#5b5fb0', '#8a4fa8', '#b0567f', '#7a5c3e', '#6b7280', '#3f4650',
];

/** Sélecteur de couleur : la roue du système, plus une palette maison. */
function champCouleur(valeur, surChangement) {
  const saisie = h('input', {
    type: 'color',
    value: valeur,
    oninput: (evenement) => appliquer(evenement.target.value, false),
  });

  const nuances = PALETTE.map((couleur) =>
    h('button', {
      class: 'nuance',
      type: 'button',
      title: couleur,
      style: { background: couleur },
      onclick: () => appliquer(couleur, true),
    })
  );

  function majActives(couleur) {
    nuances.forEach((bouton, index) =>
      bouton.classList.toggle('actif', PALETTE[index] === couleur.toLowerCase())
    );
  }

  function appliquer(couleur, refleter) {
    if (refleter) saisie.value = couleur;
    majActives(couleur);
    surChangement(couleur);
  }

  majActives(valeur);
  return h('div', { class: 'champ-couleur-edit' }, [
    saisie,
    h('div', { class: 'nuancier' }, nuances),
  ]);
}

function pied(refs, { valider, libelle, supprimer }) {
  return h('div', { class: 'fl-pied' }, [
    supprimer &&
      h('button', {
        class: 'bouton bouton-danger',
        type: 'button',
        texte: '🗑 Supprimer',
        onclick: supprimer,
      }),
    refs.etat,
    h('button', {
      class: 'bouton bouton-primaire',
      type: 'button',
      texte: libelle,
      onclick: valider,
    }),
  ]);
}

function entete(titre, fermer) {
  return h('div', { class: 'fl-entete' }, [
    h('div', { class: 'fl-titre' }, [h('span', { class: 'fl-nom', texte: titre })]),
    h('button', {
      class: 'bouton bouton-icone fl-fermer',
      type: 'button',
      texte: '✕',
      title: 'Fermer (Échap)',
      onclick: fermer,
    }),
  ]);
}

export function creerEditeurMaison(rappels = {}) {
  const socle = creerFlottant();
  let mode = 'edition'; // edition | suppression
  let creation = true;
  let brouillon = null;
  let position = { x: 0, y: 0 };
  let refs = {};

  const autres = () =>
    (rappels.maisons?.() || []).filter((maison) => maison.id !== brouillon.id);

  function ouvrirCreation(x, y) {
    creation = true;
    mode = 'edition';
    brouillon = { label: '', couleur: PALETTE[0], devise: '', categorie: '' };
    monter(x, y);
    refs.label.focus();
  }

  function charger(maison) {
    creation = false;
    brouillon = {
      id: maison.id,
      label: maison.label || '',
      couleur: maison.couleur || PALETTE[0],
      devise: maison.devise || '',
      categorie: maison.categorie || '',
      personnes: maison.personnes ?? maison.nombre ?? 0,
    };
  }

  function ouvrirModification(maison, x, y) {
    charger(maison);
    mode = 'edition';
    monter(x, y);
    refs.label.select();
  }

  /** Entrée directe dans la confirmation, depuis le menu contextuel du rail. */
  function ouvrirSuppression(maison, x, y) {
    charger(maison);
    mode = 'suppression';
    monter(x, y);
  }

  function monter(x, y) {
    position = { x, y };
    socle.monter(mode === 'suppression' ? construireSuppression() : construire(), x, y);
  }

  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.label = h('input', {
      type: 'text',
      value: brouillon.label,
      placeholder: 'Maison Stark, Guilde des voleurs…',
      oninput: (evenement) => {
        brouillon.label = evenement.target.value;
        refs.apercu.textContent = brouillon.label || 'Sans nom';
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter') {
          evenement.preventDefault();
          valider();
        }
      },
    });

    refs.pastille = h('span', { class: 'ap-pastille', style: { background: brouillon.couleur } });
    refs.apercu = h('span', { texte: brouillon.label || 'Sans nom' });

    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(creation ? 'Nouvelle maison' : 'Modifier la maison', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.label]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Couleur' }),
          champCouleur(brouillon.couleur, (couleur) => {
            brouillon.couleur = couleur;
            refs.pastille.style.background = couleur;
          }),
        ]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Devise (facultative)' }),
          h('input', {
            type: 'text',
            value: brouillon.devise,
            placeholder: 'L’hiver vient',
            oninput: (evenement) => {
              brouillon.devise = evenement.target.value;
            },
          }),
        ]),
        champCategorie(),
        h('div', { class: 'fl-apercu' }, [refs.pastille, refs.apercu]),
        !creation &&
          h('p', {
            class: 'fl-aide',
            texte: `${brouillon.personnes} personne${
              brouillon.personnes > 1 ? 's' : ''
            } dans cette maison. Renommer ne casse aucune fiche : l’identifiant « ${
              brouillon.id
            } » ne change pas.`,
          }),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer: !creation && basculerSuppression,
      }),
    ]);
  }

  /**
   * Ranger la maison dans une catégorie — ou en créer une sans quitter le
   * formulaire : c'est au moment où l'on crée une maison qu'on se rend compte
   * qu'il manque un tiroir.
   */
  function champCategorie() {
    const liste = rappels.categories?.() || [];
    refs.categorie = h(
      'select',
      {
        onchange: (evenement) => {
          if (evenement.target.value === '__nouvelle__') {
            evenement.target.value = brouillon.categorie || '';
            rappels.creerCategorie?.(position.x, position.y, brouillon);
            return;
          }
          brouillon.categorie = evenement.target.value;
        },
      },
      [
        h('option', { value: '', texte: '— sans catégorie —' }),
        ...liste.map((categorie) => {
          const option = h('option', { value: categorie.id, texte: categorie.label });
          if (categorie.id === brouillon.categorie) option.selected = true;
          return option;
        }),
        h('option', { value: '__nouvelle__', texte: '＋ Nouvelle catégorie…' }),
      ]
    );
    return h('div', { class: 'champ-edit' }, [
      h('label', { texte: 'Catégorie' }),
      refs.categorie,
    ]);
  }

  function basculerSuppression() {
    mode = 'suppression';
    monter(position.x, position.y);
  }

  function construireSuppression() {
    const liste = autres();
    refs = { etat: h('span', { class: 'fl-etat' }) };
    refs.repli = h(
      'select',
      {},
      liste.map((maison) => h('option', { value: maison.id, texte: maison.label }))
    );
    if (liste.some((maison) => maison.id === 'autre')) refs.repli.value = 'autre';

    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(`Supprimer « ${brouillon.label} » ?`, socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('p', {
          class: 'fl-aide',
          texte: brouillon.personnes
            ? `${brouillon.personnes} personne${
                brouillon.personnes > 1 ? 's y appartiennent' : ' y appartient'
              } encore. Personne n’est supprimé : ces fiches changent de maison.`
            : 'Aucune personne n’y appartient : la suppression ne touche à rien d’autre.',
        }),
        !!liste.length &&
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Les reverser dans' }),
            refs.repli,
          ]),
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '↩ Annuler',
          onclick: () => {
            mode = 'edition';
            monter(position.x, position.y);
          },
        }),
        refs.etat,
        h('button', {
          class: 'bouton bouton-danger arme',
          type: 'button',
          texte: 'Supprimer définitivement',
          onclick: supprimer,
        }),
      ]),
    ]);
  }

  async function valider() {
    const label = refs.label.value.trim();
    if (!label) {
      definirEtat(refs, 'Indiquez un nom.', 'erreur');
      refs.label.focus();
      return;
    }
    const charge = {
      label,
      couleur: brouillon.couleur,
      devise: brouillon.devise,
      categorie: brouillon.categorie || '',
    };
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const reponse = creation
        ? await Api.creerMaison(charge)
        : await Api.majMaison(brouillon.id, charge);
      socle.fermer();
      rappels.surChangement?.(reponse.maison, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerMaison(brouillon.id, refs.repli?.value);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, ouvrirSuppression, fermer: socle.fermer };
}

export function creerEditeurType(rappels = {}) {
  const socle = creerFlottant();
  let mode = 'edition';
  let creation = true;
  let brouillon = null;
  let position = { x: 0, y: 0 };
  let refs = {};

  const catalogues = () => rappels.catalogues?.() || {};
  const styles = () =>
    catalogues().styles || [
      { id: 'solide', label: 'Trait plein' },
      { id: 'tirets', label: 'Tirets' },
      { id: 'pointille', label: 'Pointillé' },
    ];
  const categories = () =>
    catalogues().categories ||
    Object.entries(LIBELLES_CATEGORIE).map(([id, label]) => ({ id, label }));
  const structurant = (id) => (catalogues().types_structurants || []).includes(id);
  const autres = () => (rappels.types?.() || []).filter((type) => type.id !== brouillon.id);

  function ouvrirCreation(x, y) {
    creation = true;
    mode = 'edition';
    brouillon = {
      label: '',
      couleur: PALETTE[7],
      style: 'solide',
      dirige: false,
      categorie: 'social',
      label_sortant: '',
      label_entrant: '',
    };
    monter(x, y);
    refs.label.focus();
  }

  function charger(type) {
    creation = false;
    brouillon = {
      id: type.id,
      label: type.label || '',
      couleur: type.couleur || PALETTE[7],
      style: type.style || 'solide',
      dirige: !!type.dirige,
      categorie: type.categorie || 'autre',
      label_sortant: type.label_sortant || '',
      label_entrant: type.label_entrant || '',
      liens: type.liens ?? type.nombre ?? 0,
    };
  }

  function ouvrirModification(type, x, y) {
    charger(type);
    mode = 'edition';
    monter(x, y);
    refs.label.select();
  }

  function ouvrirSuppression(type, x, y) {
    charger(type);
    mode = structurant(type.id) ? 'edition' : 'suppression';
    monter(x, y);
  }

  function monter(x, y) {
    position = { x, y };
    socle.monter(mode === 'suppression' ? construireSuppression() : construire(), x, y);
  }

  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.label = h('input', {
      type: 'text',
      value: brouillon.label,
      placeholder: 'Dette de sang, Rivalité…',
      oninput: (evenement) => {
        brouillon.label = evenement.target.value;
        majApercu();
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter') {
          evenement.preventDefault();
          valider();
        }
      },
    });

    refs.styles = h(
      'div',
      { class: 'segments' },
      styles().map((style) =>
        h('button', {
          class: `segment ${brouillon.style === style.id ? 'actif' : ''}`,
          type: 'button',
          'data-style': style.id,
          title: style.label,
          texte: style.label,
          onclick: () => {
            brouillon.style = style.id;
            [...refs.styles.children].forEach((bouton) =>
              bouton.classList.toggle('actif', bouton.dataset.style === style.id)
            );
            majApercu();
          },
        })
      )
    );

    refs.dirige = h('input', {
      type: 'checkbox',
      checked: brouillon.dirige,
      onchange: (evenement) => {
        brouillon.dirige = evenement.target.checked;
        refs.sens.hidden = !brouillon.dirige;
        majApercu();
      },
    });

    refs.sortant = h('input', {
      type: 'text',
      value: brouillon.label_sortant,
      placeholder: 'Parent de, Mentor de…',
      oninput: (evenement) => {
        brouillon.label_sortant = evenement.target.value;
      },
    });
    refs.entrant = h('input', {
      type: 'text',
      value: brouillon.label_entrant,
      placeholder: 'Enfant de, Élève de…',
      oninput: (evenement) => {
        brouillon.label_entrant = evenement.target.value;
      },
    });
    refs.sens = h('div', { class: 'grille-champs', hidden: !brouillon.dirige }, [
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Dans ce sens' }),
        refs.sortant,
      ]),
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Vu d’en face' }),
        refs.entrant,
      ]),
    ]);

    refs.categorie = h(
      'select',
      {
        onchange: (evenement) => {
          brouillon.categorie = evenement.target.value;
        },
      },
      categories().map((categorie) => {
        const option = h('option', { value: categorie.id, texte: categorie.label });
        if (categorie.id === brouillon.categorie) option.selected = true;
        return option;
      })
    );

    refs.trait = h('span', { class: 'ap-trait' });
    refs.fleche = h('span', { class: 'ap-fleche', texte: '▶' });
    refs.apercuNom = h('span', {});

    const verrouille = !creation && structurant(brouillon.id);

    const panneau = h('div', { class: 'flottant editeur-referentiel' }, [
      entete(creation ? 'Nouveau type de lien' : 'Modifier le type de lien', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.label]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Couleur' }),
          champCouleur(brouillon.couleur, (couleur) => {
            brouillon.couleur = couleur;
            majApercu();
          }),
        ]),
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Trait' }), refs.styles]),
        h('label', { class: 'option' }, [
          refs.dirige,
          h('span', { texte: 'Lien orienté (flèche d’un côté)' }),
        ]),
        refs.sens,
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Catégorie' }),
          refs.categorie,
        ]),
        h('div', { class: 'fl-apercu' }, [refs.trait, refs.fleche, refs.apercuNom]),
        verrouille &&
          h('p', {
            class: 'fl-aide',
            texte:
              'Ce type structure l’arbre (générations, couples, fratries) : il se renomme et se recolore, mais ne se supprime pas.',
          }),
        !creation &&
          !verrouille &&
          h('p', {
            class: 'fl-aide',
            texte: `${brouillon.liens} lien${
              brouillon.liens > 1 ? 's' : ''
            } de ce type dans la sauvegarde.`,
          }),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer: !creation && !verrouille && basculerSuppression,
      }),
    ]);

    majApercu();
    return panneau;
  }

  function majApercu() {
    refs.trait.style.borderTopColor = brouillon.couleur;
    refs.trait.style.borderTopStyle =
      brouillon.style === 'tirets'
        ? 'dashed'
        : brouillon.style === 'pointille'
        ? 'dotted'
        : 'solid';
    refs.fleche.style.color = brouillon.couleur;
    refs.fleche.hidden = !brouillon.dirige;
    refs.apercuNom.textContent = brouillon.label || 'Sans nom';
  }

  function basculerSuppression() {
    mode = 'suppression';
    monter(position.x, position.y);
  }

  function construireSuppression() {
    const liste = autres();
    refs = { etat: h('span', { class: 'fl-etat' }) };
    refs.repli = h('select', {}, [
      h('option', {
        value: '',
        texte:
          brouillon.liens > 1
            ? `Supprimer aussi ces ${brouillon.liens} liens`
            : 'Supprimer aussi ce lien',
      }),
      ...liste.map((type) =>
        h('option', { value: type.id, texte: `Les requalifier en « ${type.label} »` })
      ),
    ]);
    // Par défaut, on ne détruit rien : on reverse dans le type fourre-tout,
    // ou à défaut dans le premier type venu.
    if (brouillon.liens && liste.length) {
      refs.repli.value = liste.some((type) => type.id === 'autre') ? 'autre' : liste[0].id;
    }

    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(`Supprimer « ${brouillon.label} » ?`, socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('p', {
          class: 'fl-aide',
          texte: brouillon.liens
            ? `${brouillon.liens} lien${
                brouillon.liens > 1 ? 's portent' : ' porte'
              } ce type. Décidez de leur sort avant de continuer.`
            : 'Aucun lien ne porte ce type : la suppression ne touche à rien d’autre.',
        }),
        !!brouillon.liens &&
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Sort des liens' }),
            refs.repli,
          ]),
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '↩ Annuler',
          onclick: () => {
            mode = 'edition';
            monter(position.x, position.y);
          },
        }),
        refs.etat,
        h('button', {
          class: 'bouton bouton-danger arme',
          type: 'button',
          texte: 'Supprimer définitivement',
          onclick: supprimer,
        }),
      ]),
    ]);
  }

  async function valider() {
    const label = refs.label.value.trim();
    if (!label) {
      definirEtat(refs, 'Indiquez un nom.', 'erreur');
      refs.label.focus();
      return;
    }
    const charge = {
      label,
      couleur: brouillon.couleur,
      style: brouillon.style,
      dirige: brouillon.dirige,
      categorie: brouillon.categorie,
      label_sortant: brouillon.dirige ? brouillon.label_sortant : '',
      label_entrant: brouillon.dirige ? brouillon.label_entrant : '',
    };
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const reponse = creation
        ? await Api.creerType(charge)
        : await Api.majType(brouillon.id, charge);
      socle.fermer();
      rappels.surChangement?.(reponse.type, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerType(brouillon.id, refs.repli?.value || undefined);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, ouvrirSuppression, fermer: socle.fermer };
}

function definirEtat(refs, texte, classe = '') {
  if (!refs.etat) return;
  refs.etat.textContent = texte;
  refs.etat.className = `fl-etat ${classe}`;
}

// ==========================================================================
//  Catégories de maisons
//
//  Un regroupement de maisons — « Grandes maisons », « Ordres », « Hors
//  Westeros »… La couleur est proposée par le serveur (teintes réparties),
//  mais on peut toujours la choisir soi-même.
// ==========================================================================

export function creerEditeurCategorie(rappels = {}) {
  const socle = creerFlottant();
  let mode = 'edition';
  let creation = true;
  let brouillon = null;
  let position = { x: 0, y: 0 };
  let refs = {};

  function ouvrirCreation(x, y, { nom = '' } = {}) {
    creation = true;
    mode = 'edition';
    // Sans couleur choisie, le serveur en attribue une : on laisse vide.
    brouillon = { label: nom, couleur: '' };
    monter(x, y);
    refs.label.focus();
  }

  function charger(categorie) {
    creation = false;
    brouillon = {
      id: categorie.id,
      label: categorie.label || '',
      couleur: categorie.couleur || PALETTE[0],
      maisons: categorie.maisons ?? 0,
      personnes: categorie.personnes ?? 0,
    };
  }

  function ouvrirModification(categorie, x, y) {
    charger(categorie);
    mode = 'edition';
    monter(x, y);
    refs.label.select();
  }

  function ouvrirSuppression(categorie, x, y) {
    charger(categorie);
    mode = 'suppression';
    monter(x, y);
  }

  function monter(x, y) {
    position = { x, y };
    socle.monter(mode === 'suppression' ? construireSuppression() : construire(), x, y);
  }

  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.label = h('input', {
      type: 'text',
      value: brouillon.label,
      placeholder: 'Grandes maisons, Ordres, Sauvageons…',
      oninput: (evenement) => {
        brouillon.label = evenement.target.value;
        refs.apercu.textContent = brouillon.label || 'Sans nom';
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter') {
          evenement.preventDefault();
          valider();
        }
      },
    });

    refs.pastille = h('span', {
      class: 'ap-pastille',
      style: { background: brouillon.couleur || '#8a8f98' },
    });
    refs.apercu = h('span', { texte: brouillon.label || 'Sans nom' });

    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(creation ? 'Nouvelle catégorie' : 'Modifier la catégorie', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.label]),
        h('div', { class: 'champ-edit' }, [
          h('label', {
            texte: creation ? 'Couleur (choisie pour vous si vide)' : 'Couleur',
          }),
          champCouleur(brouillon.couleur || '#8a8f98', (couleur) => {
            brouillon.couleur = couleur;
            refs.pastille.style.background = couleur;
          }),
        ]),
        h('div', { class: 'fl-apercu' }, [refs.pastille, refs.apercu]),
        !creation &&
          h('p', {
            class: 'fl-aide',
            texte: `${brouillon.maisons} maison(s), ${brouillon.personnes} personne(s) rangées ici.`,
          }),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer:
          !creation &&
          (() => {
            mode = 'suppression';
            monter(position.x, position.y);
          }),
      }),
    ]);
  }

  function construireSuppression() {
    refs = { etat: h('span', { class: 'fl-etat' }) };
    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(`Supprimer « ${brouillon.label} » ?`, socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('p', {
          class: 'fl-aide',
          texte: brouillon.maisons
            ? `${brouillon.maisons} maison(s) y sont rangées : elles restent, simplement sans catégorie.`
            : 'Aucune maison n’y est rangée : la suppression ne touche à rien.',
        }),
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '↩ Annuler',
          onclick: () => {
            mode = 'edition';
            monter(position.x, position.y);
          },
        }),
        refs.etat,
        h('button', {
          class: 'bouton bouton-danger arme',
          type: 'button',
          texte: 'Supprimer définitivement',
          onclick: supprimer,
        }),
      ]),
    ]);
  }

  async function valider() {
    const label = refs.label.value.trim();
    if (!label) {
      definirEtat(refs, 'Indiquez un nom.', 'erreur');
      refs.label.focus();
      return;
    }
    const charge = { label };
    if (brouillon.couleur) charge.couleur = brouillon.couleur;
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const reponse = creation
        ? await Api.creerCategorie(charge)
        : await Api.majCategorie(brouillon.id, charge);
      socle.fermer();
      rappels.surChangement?.(reponse.categorie, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerCategorie(brouillon.id);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, ouvrirSuppression, fermer: socle.fermer };
}

// ==========================================================================
//  Joueurs
//
//  Un joueur, ce n'est pas un personnage : c'est quelqu'un autour de la
//  table. Son id sert de clé aux humeurs que les PNJ lui portent, donc il ne
//  change jamais — renommer ne touche qu'à l'étiquette.
// ==========================================================================

export function creerEditeurJoueur(rappels = {}) {
  const socle = creerFlottant();
  let mode = 'edition'; // edition | suppression
  let creation = true;
  let brouillon = null;
  let position = { x: 0, y: 0 };
  let refs = {};

  const personnes = () => rappels.personnes?.() || [];

  function ouvrirCreation(x, y) {
    creation = true;
    mode = 'edition';
    const pris = (rappels.joueurs?.() || []).length;
    brouillon = {
      nom: '',
      personnage: '',
      couleur: PALETTE[(pris * 3) % PALETTE.length],
      personne_id: '',
    };
    monter(x, y);
    refs.nom.focus();
  }

  function charger(joueur) {
    creation = false;
    brouillon = {
      id: joueur.id,
      nom: joueur.nom || '',
      personnage: joueur.personnage || '',
      couleur: joueur.couleur || PALETTE[0],
      personne_id: joueur.personne_id || '',
    };
  }

  function ouvrirModification(joueur, x, y) {
    charger(joueur);
    mode = 'edition';
    monter(x, y);
    refs.nom.select();
  }

  function ouvrirSuppression(joueur, x, y) {
    charger(joueur);
    mode = 'suppression';
    monter(x, y);
  }

  function monter(x, y) {
    position = { x, y };
    socle.monter(mode === 'suppression' ? construireSuppression() : construire(), x, y);
  }

  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.nom = h('input', {
      type: 'text',
      value: brouillon.nom,
      placeholder: 'Prénom du joueur',
      oninput: (evenement) => {
        brouillon.nom = evenement.target.value;
        refs.apercu.textContent = brouillon.nom || 'Sans nom';
      },
      onkeydown: (evenement) => {
        if (evenement.key === 'Enter') {
          evenement.preventDefault();
          valider();
        }
      },
    });

    refs.pastille = h('span', { class: 'ap-pastille', style: { background: brouillon.couleur } });
    refs.apercu = h('span', { texte: brouillon.nom || 'Sans nom' });

    // Le personnage joué peut avoir sa fiche dans l'arbre : sa carte prend
    // alors un cadre à part sur le plan.
    refs.ouvrirFiche = h('button', {
      class: 'bouton bouton-icone',
      type: 'button',
      texte: '↗',
      title: 'Ouvrir la fiche de son personnage',
      hidden: !brouillon.personne_id,
      onclick: () => {
        const cible = brouillon.personne_id;
        socle.fermer();
        rappels.surFiche?.(cible);
      },
    });

    refs.personne = h(
      'select',
      {
        onchange: (evenement) => {
          brouillon.personne_id = evenement.target.value;
          refs.ouvrirFiche.hidden = !brouillon.personne_id;
        },
      },
      [
        h('option', { value: '', texte: '— aucune fiche —' }),
        ...personnes().map((noeud) => {
          const option = h('option', { value: noeud.id, texte: noeud.label });
          if (noeud.id === brouillon.personne_id) option.selected = true;
          return option;
        }),
      ]
    );

    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(creation ? 'Nouveau joueur' : 'Modifier le joueur', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Joueur' }), refs.nom]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Personnage joué' }),
          h('input', {
            type: 'text',
            value: brouillon.personnage,
            placeholder: 'Ser Aldric Rivers',
            oninput: (evenement) => {
              brouillon.personnage = evenement.target.value;
            },
          }),
        ]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Couleur' }),
          champCouleur(brouillon.couleur, (couleur) => {
            brouillon.couleur = couleur;
            refs.pastille.style.background = couleur;
          }),
        ]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Sa fiche dans l’arbre (facultatif)' }),
          h('div', { class: 'champ-avec-pastille' }, [refs.personne, refs.ouvrirFiche]),
        ]),
        h('div', { class: 'fl-apercu' }, [refs.pastille, refs.apercu]),
        !creation &&
          h('p', {
            class: 'fl-aide',
            texte: `Renommer ne perd aucune humeur : l’identifiant « ${brouillon.id} » ne change pas.`,
          }),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer:
          !creation &&
          (() => {
            mode = 'suppression';
            monter(position.x, position.y);
          }),
      }),
    ]);
  }

  function construireSuppression() {
    refs = { etat: h('span', { class: 'fl-etat' }) };
    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(`Retirer « ${brouillon.nom} » ?`, socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('p', {
          class: 'fl-aide',
          texte:
            'Le joueur quitte la table : les humeurs que les personnages lui ' +
            'portaient sont effacées avec lui. Les personnages, eux, restent.',
        }),
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '↩ Annuler',
          onclick: () => {
            mode = 'edition';
            monter(position.x, position.y);
          },
        }),
        refs.etat,
        h('button', {
          class: 'bouton bouton-danger arme',
          type: 'button',
          texte: 'Retirer définitivement',
          onclick: supprimer,
        }),
      ]),
    ]);
  }

  async function valider() {
    const nom = refs.nom.value.trim();
    if (!nom) {
      definirEtat(refs, 'Indiquez un nom.', 'erreur');
      refs.nom.focus();
      return;
    }
    const charge = {
      nom,
      personnage: brouillon.personnage,
      couleur: brouillon.couleur,
      personne_id: brouillon.personne_id,
    };
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const reponse = creation
        ? await Api.creerJoueur(charge)
        : await Api.majJoueur(brouillon.id, charge);
      socle.fermer();
      rappels.surChangement?.(reponse.joueur, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerJoueur(brouillon.id);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, ouvrirSuppression, fermer: socle.fermer };
}

// ==========================================================================
//  Filtres sur mesure
//
//  Un axe de couleur qu'on fabrique soi-même : une variable, une façon de la
//  découper, un dégradé, et des tests pour écarter ce qui n'entre pas dans la
//  question. Tout le calcul est au serveur ; l'éditeur ne fait que régler et
//  montrer l'aperçu qu'il renvoie.
// ==========================================================================

export function creerEditeurFiltre(rappels = {}) {
  // Panneau persistant : un formulaire de cette taille ne doit pas se refermer
  // parce qu'on a ouvert la roue des couleurs (la fenêtre perd le focus) ou
  // parce qu'il a grandi sous le curseur. On en sort par ✕ ou Échap.
  const socle = creerFlottant({ persistant: true });
  let mode = 'edition'; // edition | suppression
  let creation = true;
  let brouillon = null;
  let position = { x: 0, y: 0 };
  let ancre = null; // position réelle : les remontages ne déplacent plus rien
  let refs = {};
  let catalogue = null;
  let minuteur = null;

  const editeurListe = creerEditeurListe({
    variables: () => catalogue?.variables || [],
    surChangement: async (fiche, action) => {
      catalogue.listes = (await Api.filtres()).listes;
      if (action !== 'suppression' && refs.testEnCours) {
        refs.testEnCours.valeur = fiche.id; // la liste qu'on vient d'écrire
      }
      refs.testEnCours = null;
      majTests();
      apercu();
    },
  });

  async function chargerCatalogue() {
    if (!catalogue) catalogue = await Api.filtres();
    return catalogue;
  }

  const variableCourante = () =>
    (catalogue?.variables || []).find((v) => v.id === brouillon.variable) || {
      genre: 'texte',
    };

  const ficheOperateur = (id) => (catalogue?.operateurs || []).find((o) => o.id === id) || {};

  async function ouvrirCreation(x, y) {
    await chargerCatalogue();
    creation = true;
    mode = 'edition';
    ancre = null;
    brouillon = {
      label: '',
      variable: catalogue.variables?.[0]?.id || 'maison',
      mode: 'valeurs',
      segments: catalogue.segments?.defaut ?? 5,
      gradient: { ...(catalogue.gradient_defaut || { de: '#3f6f9f', vers: '#c1762f' }) },
      tests: [],
      jointure: 'et',
    };
    monter(x, y);
    refs.nom.focus();
    apercu();
  }

  async function ouvrirModification(fiche, x, y) {
    await chargerCatalogue();
    creation = false;
    mode = 'edition';
    ancre = null;
    charger(fiche);
    monter(x, y);
    refs.nom.select();
    apercu();
  }

  async function ouvrirSuppression(fiche, x, y) {
    await chargerCatalogue();
    creation = false;
    ancre = null;
    charger(fiche);
    mode = 'suppression';
    monter(x, y);
  }

  function charger(fiche) {
    brouillon = {
      id: fiche.id,
      label: fiche.label || '',
      variable: fiche.variable || 'maison',
      mode: fiche.mode || 'valeurs',
      segments: fiche.segments ?? 5,
      gradient: { ...(fiche.gradient || { de: '#3f6f9f', vers: '#c1762f' }) },
      tests: (fiche.tests || []).map((test) => ({ ...test })),
      jointure: fiche.jointure || 'et',
    };
  }

  /**
   * Le panneau reste où il a été posé. Sans ça, il se replace à chaque
   * reconstruction : il grandit d'une ligne, remonte de vingt pixels, et le
   * clic suivant tombe à côté.
   */
  function monter(x, y) {
    position = { x, y };
    const contenu = mode === 'suppression' ? construireSuppression() : construire();
    if (ancre) {
      socle.monter(contenu, ancre.x, ancre.y, { exact: true });
      return;
    }
    socle.monter(contenu, x, y);
    const boite = socle.element.getBoundingClientRect();
    ancre = { x: boite.left, y: boite.top };
  }

  // ------------------------------------------------------------- aperçu
  //
  // C'est ce qui rend le réglage tenable : on voit ses segments se former
  // pendant qu'on tourne les boutons, avant d'avoir rien enregistré.

  function planifierApercu() {
    clearTimeout(minuteur);
    minuteur = setTimeout(apercu, 350);
  }

  async function apercu() {
    if (!refs.apercu) return;
    try {
      const resultat = await Api.apercuFiltre(brouillon);
      if (!refs.apercu.isConnected) return;
      dessinerApercu(resultat);
    } catch (erreur) {
      refs.apercu.replaceChildren(
        h('p', { class: 'fl-aide', texte: `Aperçu impossible : ${erreur.message}` })
      );
    }
  }

  function dessinerApercu(resultat) {
    const exclus = resultat.exclus?.length || 0;
    refs.apercu.replaceChildren(
      h('div', { class: 'apercu-resume' }, [
        h('span', {
          texte: `${resultat.retenus} personne${resultat.retenus > 1 ? 's' : ''} retenue${
            resultat.retenus > 1 ? 's' : ''
          }`,
        }),
        exclus
          ? h('span', { class: 'apercu-exclus', texte: `${exclus} écartée(s) par les tests` })
          : null,
      ]),
      h(
        'ul',
        { class: 'apercu-segments' },
        (resultat.segments || []).map((segment) =>
          h('li', {}, [
            h('span', {
              class: 'legende-pastille',
              style: { background: segment.couleur },
            }),
            h('span', { class: 'apercu-label', texte: segment.label }),
            h('span', { class: 'nombre', texte: String(segment.nombre) }),
          ])
        )
      )
    );
  }

  // -------------------------------------------------------------- rendu
  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.nom = h('input', {
      type: 'text',
      value: brouillon.label,
      placeholder: 'Vieux Lannister, Alliés du Nord…',
      oninput: (evenement) => {
        brouillon.label = evenement.target.value;
      },
    });

    // Changer de variable ne reconstruit rien : on met à jour ce qui en
    // dépend, et le formulaire ne bouge pas sous les doigts.
    refs.variable = h(
      'select',
      {
        onchange: (evenement) => {
          brouillon.variable = evenement.target.value;
          if (variableCourante().genre === 'texte' && brouillon.mode === 'tranches') {
            brouillon.mode = 'valeurs';
            refs.mode.value = 'valeurs';
          }
          majDecoupage();
          apercu();
        },
      },
      (catalogue?.variables || []).map((variable) => {
        const option = h('option', { value: variable.id, texte: variable.label });
        if (variable.id === brouillon.variable) option.selected = true;
        return option;
      })
    );

    refs.mode = h(
      'select',
      {
        onchange: (evenement) => {
          brouillon.mode = evenement.target.value;
          majDecoupage();
          apercu();
        },
      },
      [
        { id: 'valeurs', label: 'Une couleur par valeur' },
        { id: 'tranches', label: 'Des tranches de valeurs' },
      ].map((choix) => {
        const option = h('option', { value: choix.id, texte: choix.label });
        if (choix.id === brouillon.mode) option.selected = true;
        return option;
      })
    );

    refs.segments = h('input', {
      type: 'number',
      min: catalogue?.segments?.minimum ?? 2,
      max: catalogue?.segments?.maximum ?? 12,
      value: brouillon.segments,
      oninput: (evenement) => {
        brouillon.segments = Number(evenement.target.value) || 5;
        planifierApercu();
      },
    });
    refs.labelSegments = h('label', {});

    refs.bande = h('div', { class: 'gradient-bande' });
    refs.blocTests = h('div', { class: 'bloc-tests' });
    refs.apercu = h('div', { class: 'apercu-filtre' });

    const panneau = h('div', { class: 'flottant editeur-referentiel editeur-filtre' }, [
      entete(creation ? 'Nouveau filtre' : 'Régler le filtre', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.nom]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Variable à lire' }),
          refs.variable,
        ]),
        h('div', { class: 'grille-champs' }, [
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Découpage' }),
            refs.mode,
          ]),
          h('div', { class: 'champ-edit' }, [refs.labelSegments, refs.segments]),
        ]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Dégradé' }),
          h('div', { class: 'gradient-reglage' }, [
            champCouleur(brouillon.gradient.de, (couleur) => {
              brouillon.gradient.de = couleur;
              majBande();
              planifierApercu();
            }),
            refs.bande,
            champCouleur(brouillon.gradient.vers, (couleur) => {
              brouillon.gradient.vers = couleur;
              majBande();
              planifierApercu();
            }),
          ]),
        ]),
        h('div', { class: 'champ-edit pleine' }, [
          h('label', { texte: 'Tests — ce qui échoue est écarté du plan' }),
          refs.blocTests,
        ]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Aperçu' }),
          refs.apercu,
        ]),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer:
          !creation &&
          (() => {
            mode = 'suppression';
            monter(position.x, position.y);
          }),
      }),
    ]);

    majBande();
    majDecoupage();
    majTests();
    return panneau;
  }

  function majBande() {
    refs.bande.style.background = `linear-gradient(90deg, ${brouillon.gradient.de}, ${brouillon.gradient.vers})`;
  }

  function majDecoupage() {
    const numerique = variableCourante().genre !== 'texte';
    [...refs.mode.options].forEach((option) => {
      if (option.value === 'tranches') option.disabled = !numerique;
    });
    refs.labelSegments.textContent =
      brouillon.mode === 'tranches' ? 'Nombre de tranches' : 'Segments au plus';
  }

  /** Les tests : « maison contient lannister », « lieu appartient à Ports »… */
  function majTests() {
    if (!refs.blocTests) return;
    refs.blocTests.replaceChildren(
      brouillon.tests.length > 1
        ? h(
            'select',
            {
              class: 'jointure',
              onchange: (evenement) => {
                brouillon.jointure = evenement.target.value;
                planifierApercu();
              },
            },
            [
              { id: 'et', label: 'Toutes les conditions (ET)' },
              { id: 'ou', label: 'Au moins une (OU)' },
            ].map((choix) => {
              const option = h('option', { value: choix.id, texte: choix.label });
              if (choix.id === brouillon.jointure) option.selected = true;
              return option;
            })
          )
        : null,
      ...brouillon.tests.map((test) => ligneTest(test)),
      h('button', {
        class: 'bouton bouton-plat',
        type: 'button',
        texte: '＋ Ajouter un test',
        onclick: () => {
          brouillon.tests.push({ champ: brouillon.variable, operateur: '=', valeur: '' });
          majTests();
        },
      })
    );
  }

  function ligneTest(test) {
    const champ = h(
      'select',
      {
        onchange: (evenement) => {
          test.champ = evenement.target.value;
          planifierApercu();
        },
      },
      (catalogue?.variables || []).map((variable) => {
        const option = h('option', { value: variable.id, texte: variable.label });
        if (variable.id === test.champ) option.selected = true;
        return option;
      })
    );

    const operateur = h(
      'select',
      {
        onchange: (evenement) => {
          const avant = ficheOperateur(test.operateur);
          test.operateur = evenement.target.value;
          // Passer d'une valeur tapée à une liste (ou l'inverse) : l'opérande
          // ne veut plus rien dire, on repart de vide.
          if (!!avant.liste !== !!ficheOperateur(test.operateur).liste) test.valeur = '';
          majTests();
          planifierApercu();
        },
      },
      (catalogue?.operateurs || []).map((op) => {
        const option = h('option', { value: op.id, texte: op.label });
        if (op.id === test.operateur) option.selected = true;
        return option;
      })
    );

    return h('div', { class: 'ligne-test' }, [
      champ,
      operateur,
      ...operande(test),
      h('button', {
        class: 'bouton bouton-icone',
        type: 'button',
        texte: '✕',
        title: 'Retirer ce test',
        onclick: () => {
          brouillon.tests.splice(brouillon.tests.indexOf(test), 1);
          majTests();
          apercu();
        },
      }),
    ]);
  }

  /** Ce qu'on compare : rien, une valeur tapée, ou une liste nommée. */
  function operande(test) {
    const fiche = ficheOperateur(test.operateur);
    if (!fiche.valeur) return [];

    if (fiche.liste) {
      const listes = catalogue?.listes || [];
      const select = h(
        'select',
        {
          onchange: (evenement) => {
            if (evenement.target.value === '__creer__') {
              evenement.target.value = test.valeur || '';
              ouvrirListe(test, null);
              return;
            }
            test.valeur = evenement.target.value;
            planifierApercu();
          },
        },
        [
          h('option', { value: '', texte: listes.length ? '— choisir —' : '— aucune liste —' }),
          ...listes.map((liste) => {
            const option = h('option', {
              value: liste.id,
              texte: `${liste.label} (${(liste.valeurs || []).length})`,
            });
            if (liste.id === test.valeur) option.selected = true;
            return option;
          }),
          h('option', { value: '__creer__', texte: '＋ Nouvelle liste…' }),
        ]
      );
      const modifier = h('button', {
        class: 'bouton bouton-icone',
        type: 'button',
        texte: '✎',
        title: 'Modifier cette liste',
        hidden: !test.valeur,
        onclick: () => {
          const liste = (catalogue?.listes || []).find((l) => l.id === test.valeur);
          if (liste) ouvrirListe(test, liste);
        },
      });
      return [select, modifier];
    }

    return [
      h('input', {
        type: fiche.nombre ? 'number' : 'text',
        value: test.valeur ?? '',
        placeholder: fiche.nombre ? '3' : 'lannister',
        oninput: (evenement) => {
          test.valeur = evenement.target.value;
          planifierApercu();
        },
      }),
    ];
  }

  function ouvrirListe(test, liste) {
    refs.testEnCours = test;
    const boite = socle.element.getBoundingClientRect();
    const x = Math.max(10, boite.left - 330);
    if (liste) editeurListe.ouvrirModification(liste, x, boite.top);
    else editeurListe.ouvrirCreation(x, boite.top, { variable: test.champ });
  }

  function construireSuppression() {
    refs = { etat: h('span', { class: 'fl-etat' }) };
    return h('div', { class: 'flottant editeur-referentiel' }, [
      entete(`Supprimer « ${brouillon.label} » ?`, socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('p', {
          class: 'fl-aide',
          texte:
            'Un filtre ne porte aucune donnée : il ne fait que regarder. Le ' +
            'supprimer ne touche ni les personnes, ni les liens.',
        }),
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '↩ Annuler',
          onclick: () => {
            mode = 'edition';
            monter(position.x, position.y);
            apercu();
          },
        }),
        refs.etat,
        h('button', {
          class: 'bouton bouton-danger arme',
          type: 'button',
          texte: 'Supprimer',
          onclick: supprimer,
        }),
      ]),
    ]);
  }

  // ------------------------------------------------------------ persistance
  async function valider() {
    if (!brouillon.label.trim()) {
      definirEtat(refs, 'Donnez-lui un nom.', 'erreur');
      refs.nom.focus();
      return;
    }
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const reponse = creation
        ? await Api.creerFiltre(brouillon)
        : await Api.majFiltre(brouillon.id, brouillon);
      socle.fermer();
      rappels.surChangement?.(reponse.filtre, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerFiltre(brouillon.id);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, ouvrirSuppression, fermer: socle.fermer };
}

// ==========================================================================
//  Listes nommées
//
//  « Les maisons du Nord », « les ports » : un paquet de valeurs qu'on
//  réutilise d'un filtre à l'autre. On les compose en cochant ce qui existe
//  déjà dans la sauvegarde — pas en retapant « Peyredragon » sans faute.
// ==========================================================================

export function creerEditeurListe(rappels = {}) {
  const socle = creerFlottant({ persistant: true });
  let creation = true;
  let brouillon = null;
  let observees = [];
  let recherche = '';
  let refs = {};
  let ancre = null;

  async function ouvrirCreation(x, y, { variable = 'maison' } = {}) {
    creation = true;
    ancre = null;
    brouillon = { label: '', variable, valeurs: [] };
    monter(x, y);
    await chargerValeurs();
    refs.nom?.focus();
  }

  async function ouvrirModification(liste, x, y) {
    creation = false;
    ancre = null;
    brouillon = {
      id: liste.id,
      label: liste.label || '',
      variable: liste.variable || 'maison',
      valeurs: [...(liste.valeurs || [])],
    };
    monter(x, y);
    await chargerValeurs();
    refs.nom?.select();
  }

  function monter(x, y) {
    const contenu = construire();
    if (ancre) {
      socle.monter(contenu, ancre.x, ancre.y, { exact: true });
      return;
    }
    socle.monter(contenu, x, y);
    const boite = socle.element.getBoundingClientRect();
    ancre = { x: boite.left, y: boite.top };
  }

  async function chargerValeurs() {
    try {
      observees = (await Api.valeursVariable(brouillon.variable)).valeurs || [];
    } catch (erreur) {
      observees = [];
    }
    majObservees();
  }

  function construire() {
    refs = { etat: h('span', { class: 'fl-etat' }) };

    refs.nom = h('input', {
      type: 'text',
      value: brouillon.label,
      placeholder: 'Maisons du Nord, Ports, Lieux visités…',
      oninput: (evenement) => {
        brouillon.label = evenement.target.value;
      },
    });

    refs.variable = h(
      'select',
      {
        onchange: async (evenement) => {
          brouillon.variable = evenement.target.value;
          await chargerValeurs();
        },
      },
      (rappels.variables?.() || VARIABLES_SECOURS).map((variable) => {
        const option = h('option', { value: variable.id, texte: variable.label });
        if (variable.id === brouillon.variable) option.selected = true;
        return option;
      })
    );

    refs.recherche = h('input', {
      type: 'search',
      placeholder: 'Filtrer les valeurs…',
      oninput: (evenement) => {
        recherche = evenement.target.value;
        majObservees();
      },
    });

    refs.libre = h('input', {
      type: 'text',
      placeholder: 'Ajouter une valeur à la main puis Entrée',
      onkeydown: (evenement) => {
        if (evenement.key !== 'Enter') return;
        evenement.preventDefault();
        ajouter(evenement.target.value);
        evenement.target.value = '';
      },
    });

    refs.observees = h('div', { class: 'liste-valeurs' });
    refs.choisies = h('div', { class: 'puces-valeurs' });

    const panneau = h('div', { class: 'flottant editeur-referentiel editeur-liste' }, [
      entete(creation ? 'Nouvelle liste' : 'Modifier la liste', socle.fermer),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.nom]),
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Valeurs proposées d’après' }),
          refs.variable,
        ]),
        h('div', { class: 'champ-edit' }, [refs.recherche]),
        refs.observees,
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Dans la liste' }),
          refs.choisies,
        ]),
        h('div', { class: 'champ-edit' }, [refs.libre]),
      ]),
      pied(refs, {
        valider,
        libelle: creation ? '＋ Créer' : 'Enregistrer',
        supprimer: !creation && supprimer,
      }),
    ]);

    majChoisies();
    return panneau;
  }

  const aplatir = (texte) =>
    String(texte ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();

  const contient = (valeur) =>
    brouillon.valeurs.some((v) => aplatir(v) === aplatir(valeur));

  function ajouter(valeur) {
    const texte = String(valeur || '').trim();
    if (!texte || contient(texte)) return;
    brouillon.valeurs.push(texte);
    majChoisies();
    majObservees();
  }

  function retirer(valeur) {
    brouillon.valeurs = brouillon.valeurs.filter((v) => aplatir(v) !== aplatir(valeur));
    majChoisies();
    majObservees();
  }

  function majObservees() {
    if (!refs.observees) return;
    const requete = aplatir(recherche);
    const lignes = observees
      .filter((entree) => !requete || aplatir(entree.valeur).includes(requete))
      .slice(0, 200)
      .map((entree) => {
        const coche = h('input', {
          type: 'checkbox',
          checked: contient(entree.valeur),
          onchange: (evenement) =>
            evenement.target.checked ? ajouter(entree.valeur) : retirer(entree.valeur),
        });
        return h('label', { class: 'valeur-observee' }, [
          coche,
          h('span', { class: 'apercu-label', texte: entree.valeur }),
          h('span', { class: 'nombre', texte: String(entree.nombre) }),
        ]);
      });
    refs.observees.replaceChildren(
      ...(lignes.length
        ? lignes
        : [h('p', { class: 'fl-aide', texte: 'Aucune valeur pour cette variable.' })])
    );
  }

  function majChoisies() {
    if (!refs.choisies) return;
    refs.choisies.replaceChildren(
      ...(brouillon.valeurs.length
        ? brouillon.valeurs.map((valeur) =>
            h('span', { class: 'puce-valeur' }, [
              h('span', { texte: valeur }),
              h('button', {
                class: 'puce-retirer',
                type: 'button',
                texte: '✕',
                title: 'Retirer',
                onclick: () => retirer(valeur),
              }),
            ])
          )
        : [h('p', { class: 'fl-aide', texte: 'Rien pour l’instant : cochez au-dessus.' })])
    );
  }

  async function valider() {
    if (!brouillon.label.trim()) {
      definirEtat(refs, 'Donnez-lui un nom.', 'erreur');
      refs.nom.focus();
      return;
    }
    definirEtat(refs, creation ? 'Création…' : 'Enregistrement…');
    try {
      const charge = {
        label: brouillon.label,
        variable: brouillon.variable,
        valeurs: brouillon.valeurs,
      };
      const reponse = creation
        ? await Api.creerListe(charge)
        : await Api.majListe(brouillon.id, charge);
      socle.fermer();
      rappels.surChangement?.(reponse.liste, creation ? 'creation' : 'modification');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimer() {
    definirEtat(refs, 'Suppression…');
    try {
      const reponse = await Api.supprimerListe(brouillon.id);
      socle.fermer();
      rappels.surChangement?.(reponse, 'suppression');
    } catch (erreur) {
      definirEtat(refs, `Échec : ${erreur.message}`, 'erreur');
    }
  }

  return { ouvrirCreation, ouvrirModification, fermer: socle.fermer };
}

// Repli si l'éditeur de liste est ouvert sans catalogue sous la main.
const VARIABLES_SECOURS = [
  { id: 'maison', label: 'Maison' },
  { id: 'lieu', label: 'Lieu' },
  { id: 'statut', label: 'Statut' },
  { id: 'tags', label: 'Tags' },
  { id: 'titres', label: 'Titres' },
  { id: 'nom', label: 'Nom complet' },
];

// ==========================================================================
//  Sauvegardes : création, import, renommage
// ==========================================================================

const CONTENUS = [
  { id: 'copie', label: 'Copie complète (personnes et liens)' },
  { id: 'referentiels', label: 'Vide, mais mêmes maisons et types de liens' },
  { id: 'vierge', label: 'Repartir de zéro (autre univers)' },
];

export function creerEditeurSauvegarde(rappels = {}) {
  const socle = creerFlottant();
  let mode = 'creation'; // creation | renommage
  let brouillon = null;
  let refs = {};

  /** `depuis` : sauvegarde source de la copie (par défaut, l'active). */
  function ouvrirCreation(x, y, { depuis = null, nomSource = '' } = {}) {
    mode = 'creation';
    brouillon = {
      depuis,
      nomSource,
      nom: nomSource ? `${nomSource} — copie` : 'Nouvelle campagne',
      contenu: depuis ? 'copie' : 'referentiels',
    };
    socle.monter(construire(), x, y);
    refs.nom.select();
  }

  function ouvrirRenommage(fiche, x, y) {
    mode = 'renommage';
    brouillon = { id: fiche.id, nom: fiche.nom };
    socle.monter(construire(), x, y);
    refs.nom.select();
  }

  /** Import : le fichier est lu ici, l'API ne reçoit que du JSON validé. */
  async function importer() {
    const fichier = await choisirFichier('.json,application/json');
    if (!fichier) return;
    let donnees;
    try {
      donnees = JSON.parse(fichier.texte);
    } catch (erreur) {
      rappels.surErreur?.(`Fichier illisible : ${erreur.message}`);
      return;
    }
    try {
      const reponse = await Api.creerSauvegarde({
        nom: donnees?.meta?.sauvegarde || fichier.nom.replace(/\.json$/i, ''),
        donnees,
        activer: true,
      });
      rappels.surChangement?.(reponse.sauvegarde, 'import');
    } catch (erreur) {
      rappels.surErreur?.(`Import impossible : ${erreur.message}`);
    }
  }

  function construire() {
    refs = {};
    refs.etat = h('span', { class: 'fl-etat' });

    const surEntree = (evenement) => {
      if (evenement.key === 'Enter') {
        evenement.preventDefault();
        valider();
      }
    };

    refs.nom = h('input', {
      type: 'text',
      value: brouillon.nom,
      placeholder: 'Nom de la sauvegarde',
      onkeydown: surEntree,
    });

    refs.contenu =
      mode === 'creation' &&
      h(
        'select',
        {
          onchange: (evenement) => {
            brouillon.contenu = evenement.target.value;
          },
        },
        CONTENUS.map((choix) => {
          const option = h('option', {
            value: choix.id,
            texte:
              choix.id === 'copie' && brouillon.nomSource
                ? `Copie de « ${brouillon.nomSource} »`
                : choix.label,
          });
          if (choix.id === brouillon.contenu) option.selected = true;
          return option;
        })
      );

    return h('div', { class: 'flottant editeur-sauvegarde' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', {
            class: 'fl-nom',
            texte: mode === 'creation' ? 'Nouvelle sauvegarde' : 'Renommer la sauvegarde',
          }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer (Échap)',
          onclick: socle.fermer,
        }),
      ]),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [h('label', { texte: 'Nom' }), refs.nom]),
        refs.contenu &&
          h('div', { class: 'champ-edit' }, [
            h('label', { texte: 'Contenu de départ' }),
            refs.contenu,
          ]),
        h('p', {
          class: 'fl-aide',
          texte:
            mode === 'creation'
              ? 'Elle devient la sauvegarde active : tout ce que vous modifierez ira dedans.'
              : 'Le fichier du dossier data/sauvegardes est renommé avec elle.',
        }),
      ]),
      h('div', { class: 'fl-pied' }, [
        refs.etat,
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: mode === 'creation' ? '＋ Créer' : 'Renommer',
          onclick: valider,
        }),
      ]),
    ]);
  }

  async function valider() {
    const nom = refs.nom.value.trim();
    if (!nom) {
      refs.etat.textContent = 'Indiquez un nom.';
      refs.etat.className = 'fl-etat erreur';
      refs.nom.focus();
      return;
    }
    refs.etat.textContent = mode === 'creation' ? 'Création…' : 'Renommage…';
    refs.etat.className = 'fl-etat';
    try {
      const reponse =
        mode === 'creation'
          ? await Api.creerSauvegarde({
              nom,
              depuis: brouillon.depuis,
              contenu: brouillon.contenu,
              activer: true,
            })
          : await Api.renommerSauvegarde(brouillon.id, nom);
      socle.fermer();
      rappels.surChangement?.(reponse.sauvegarde, mode);
    } catch (erreur) {
      refs.etat.textContent = `Échec : ${erreur.message}`;
      refs.etat.className = 'fl-etat erreur';
    }
  }

  return { ouvrirCreation, ouvrirRenommage, importer, fermer: socle.fermer };
}
