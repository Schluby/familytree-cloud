/* Panneau de détail d'une personne : lecture + édition + liens.
 * Générique : il se contente des données de /api/personnes/<id>. */

import { Api } from './api.js';
import { champSuggere } from './autocomplete.js';
import { h } from './dom.js';
import { curseurHumeur } from './humeur.js';

/**
 * Régions et châteaux de Westeros, chargés une fois pour toutes les fiches.
 * L'échec est sans conséquence : le champ « Lieu » reste une saisie libre.
 */
let lieux = null;
async function chargerLieux() {
  if (lieux) return lieux;
  try {
    const donnees = await Api.lieux();
    lieux = [
      ...(donnees.regions || []).map((region) => ({
        valeur: region.nom,
        detail: 'région',
      })),
      ...(donnees.villes || []).map((ville) => ({
        valeur: ville.nom,
        detail: [ville.maison, ville.region].filter(Boolean).join(' · '),
      })),
    ];
  } catch (erreur) {
    lieux = [];
  }
  return lieux;
}

export function creerPanneau(element, rappels = {}) {
  let referentiels = rappels.referentiels || { maisons: [], joueurs: [] };
  let donnees = null;
  let brouillon = null;
  let elementEtat = null;
  // Ce qui n'est pas encore parti au serveur, et la minuterie qui l'y pousse.
  let aEnvoyer = {};
  let minuterie = null;
  const DELAI_ENVOI = 500;

  function definirEtat(texte, classe = '') {
    if (elementEtat) {
      elementEtat.textContent = texte;
      elementEtat.className = `etat-sauvegarde ${classe}`;
    }
  }

  function marquerModifie(champ, valeur) {
    brouillon[champ] = valeur;
    aEnvoyer[champ] = valeur;
    definirEtat('Modification…', 'modifie');
    planifierEnvoi();
  }

  // ------------------------------------------------------------- chargement
  async function afficher(id, { secrets = false } = {}) {
    await envoyer(); // ce qui traîne appartient à la fiche qu'on quitte
    try {
      donnees = await Api.personne(id, { secrets, fratrie: true });
    } catch (erreur) {
      element.replaceChildren(
        h('div', { class: 'pn-section' }, [h('p', { class: 'vide', texte: String(erreur) })])
      );
      ouvrir();
      return;
    }
    brouillon = JSON.parse(JSON.stringify(donnees.personne));
    aEnvoyer = {};
    dessiner();
    ouvrir();
  }

  function ouvrir() {
    element.scrollTop = 0;
    rappels.surOuverture?.();
  }

  function fermer() {
    envoyer();
    element.replaceChildren();
    donnees = null;
    brouillon = null;
  }

  // ----------------------------------------------------------------- rendu
  function dessiner() {
    const personne = brouillon;
    const maison = donnees.maison_detail || {};
    const couleurMaison = personne.couleur || maison.couleur || '#7a7f87';

    // Les notes d'abord : c'est ce qu'on relit en pleine partie. Les liens,
    // eux, ne sont plus listés ici — ils se lisent sur les flèches du plan.
    element.replaceChildren(
      entete(personne, maison, couleurMaison),
      sectionNotes(personne),
      sectionJoueurs(personne),
      sectionIdentite(personne),
      pied()
    );
  }

  // ------------------------------------------------------------ portrait
  //
  // **La version en ligne n'héberge pas d'images** (décision du 06/08) : une
  // sauvegarde est un document JSON en base, et y coller des portraits la
  // ferait grossir de plusieurs mégaoctets par campagne. Le serveur refuse
  // donc les `data:` — ce qui reste, c'est une *adresse* d'image, hébergée
  // ailleurs, que la fiche se contente d'afficher.

  function zonePhoto(couleurMaison) {
    const contenu = donnees.photo
      ? h('img', { src: donnees.photo, alt: '', draggable: 'false' })
      : h('span', { class: 'pn-initiales', texte: donnees.initiales });

    const zone = h(
      'div',
      {
        class: `pn-photo ${donnees.photo ? 'avec-photo' : ''}`,
        style: { background: couleurMaison },
        title: donnees.photo
          ? 'Cliquer pour changer l’adresse du portrait'
          : 'Cliquer pour indiquer l’adresse d’une image (https://…)',
        onclick: () => demanderAdresse(),
      },
      [contenu, h('span', { class: 'pn-photo-voile', texte: '⤒' })]
    );

    if (!donnees.photo) return zone;
    return h('div', { class: 'pn-photo-boite' }, [
      zone,
      h('button', {
        class: 'bouton bouton-icone pn-photo-retirer',
        title: 'Retirer le portrait',
        texte: '✕',
        onclick: (evenement) => {
          evenement.stopPropagation();
          enregistrerPhoto(null);
        },
      }),
    ]);
  }

  /** Une adresse, pas un fichier : rien n'est téléversé nulle part. */
  function demanderAdresse() {
    if (!brouillon) return;
    const saisie = prompt(
      'Adresse de l’image (https://…). Laisser vide pour retirer le portrait :',
      donnees.personne?.avatar || ''
    );
    if (saisie === null) return;
    const adresse = saisie.trim();
    if (adresse && !/^https?:\/\//i.test(adresse)) {
      definirEtat('Il faut une adresse commençant par http:// ou https://', 'erreur');
      return;
    }
    enregistrerPhoto(adresse || null);
  }

  /** `valeur` : adresse http(s), ou null pour retirer le portrait. */
  async function enregistrerPhoto(valeur) {
    if (!brouillon) return;
    definirEtat(valeur ? 'Enregistrement de la photo…' : 'Retrait de la photo…');
    try {
      const reponse = await Api.majPersonne(brouillon.id, { avatar: valeur });
      // On ne remplace que la photo : les autres champs peuvent être en cours
      // d'édition dans le brouillon, il serait brutal de les écraser.
      donnees.personne.avatar = reponse.personne.avatar;
      brouillon.avatar = reponse.personne.avatar;
      donnees.photo = reponse.photo;
      dessiner();
      definirEtat(
        valeur ? 'Portrait enregistré' : 'Portrait retiré',
        'ok'
      );
      rappels.surEnregistrement?.(reponse.personne);
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  function entete(personne, maison, couleurMaison) {
    const badges = [
      h('span', {
        class: `badge badge-${personne.statut}`,
        texte:
          personne.statut === 'mort'
            ? `† ${personne.deces || 'mort'}`
            : personne.statut === 'vivant'
            ? 'Vivant'
            : 'Statut inconnu',
      }),
      h('span', {
        class: 'badge badge-maison',
        style: { background: couleurMaison, borderColor: couleurMaison },
        texte: maison.label || 'Sans maison',
      }),
      ...(personne.titres || []).map((titre) => h('span', { class: 'badge', texte: titre })),
      ...(personne.tags || []).map((tag) => h('span', { class: 'badge', texte: `#${tag}` })),
    ];

    return h('div', { class: 'pn-entete' }, [
      h('div', { class: 'pn-entete-haut' }, [
        zonePhoto(couleurMaison),
        h('div', {}, [
          h('div', { class: 'pn-nom', texte: donnees.nom_complet }),
          personne.surnom && h('div', { class: 'pn-surnom', texte: `« ${personne.surnom} »` }),
        ]),
        h('button', {
          class: 'bouton bouton-icone pn-fermer',
          title: 'Fermer (Échap)',
          texte: '✕',
          onclick: () => {
            fermer();
            rappels.surFermeture?.();
          },
        }),
      ]),
      h('div', { class: 'pn-badges' }, badges),
      h('div', { class: 'pn-actions' }, [
        h('button', {
          class: 'bouton',
          texte: '⊙ Centrer',
          onclick: () => rappels.surCentrage?.(personne.id),
        }),
        h('button', {
          class: 'bouton',
          texte: '⇱ Vue générale',
          onclick: () => rappels.surVueGenerale?.(),
        }),
      ]),
    ]);
  }

  function champTexte(cle, libelle, { pleine = false, type = 'text' } = {}) {
    return h('div', { class: `champ-edit ${pleine ? 'pleine' : ''}` }, [
      h('label', { texte: libelle }),
      h('input', {
        type,
        value: brouillon[cle] ?? '',
        oninput: (evenement) => marquerModifie(cle, evenement.target.value),
      }),
    ]);
  }

  function champListe(cle, libelle) {
    return h('div', { class: 'champ-edit pleine' }, [
      h('label', { texte: `${libelle} (séparés par des virgules)` }),
      h('input', {
        type: 'text',
        value: (brouillon[cle] || []).join(', '),
        oninput: (evenement) =>
          marquerModifie(
            cle,
            evenement.target.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          ),
      }),
    ]);
  }

  /** Le lieu se complète tout seul, mais accepte n'importe quoi d'autre. */
  function champLieu() {
    const champ = champSuggere({
      valeur: brouillon.lieu ?? '',
      placeholder: 'Winterfell, Port-Réal…',
      suggestions: () => lieux || [],
      surChangement: (texte) => marquerModifie('lieu', texte),
    });
    // La liste arrive peut-être après l'affichage : elle sera lue au premier
    // caractère tapé, la fiche n'a pas à attendre.
    chargerLieux();
    return h('div', { class: 'champ-edit pleine' }, [h('label', { texte: 'Lieu' }), champ]);
  }

  function champSelection(cle, libelle, options) {
    const select = h('select', {
      onchange: (evenement) => marquerModifie(cle, evenement.target.value),
    });
    options.forEach((option) => {
      const noeud = h('option', { value: option.id, texte: option.label });
      if (String(brouillon[cle]) === String(option.id)) noeud.selected = true;
      select.append(noeud);
    });
    return h('div', { class: 'champ-edit' }, [h('label', { texte: libelle }), select]);
  }

  function sectionIdentite() {
    return h('div', { class: 'pn-section' }, [
      h('h3', { texte: 'Identité' }),
      h('div', { class: 'grille-champs' }, [
        champTexte('prenom', 'Prénom'),
        champTexte('nom', 'Nom'),
        champTexte('surnom', 'Surnom', { pleine: true }),
        champSelection(
          'maison',
          'Maison',
          (referentiels.maisons || []).map((m) => ({ id: m.id, label: m.label }))
        ),
        champSelection('statut', 'Statut', [
          { id: 'vivant', label: 'Vivant' },
          { id: 'mort', label: 'Mort' },
          { id: 'inconnu', label: 'Inconnu' },
        ]),
        champTexte('naissance', 'Naissance'),
        champTexte('deces', 'Décès'),
        // Tout ce qui sert d'axe de filtre doit s'éditer ici. La génération
        // est la seule qui se déduisait de l'arbre sans qu'on puisse la
        // contredire : vide, elle reste calculée ; remplie, elle gagne.
        champTexte('generation', 'Génération (vide = calculée)', { type: 'number' }),
        champLieu(),
        champSelection(
          'importance',
          'Importance (taille du nœud)',
          [1, 2, 3, 4, 5].map((n) => ({ id: n, label: `${n}` }))
        ),
        champListe('titres', 'Titres'),
        champListe('tags', 'Tags'),
      ]),
      h('p', {
        class: 'echelle-aide',
        texte: donnees.photo
          ? 'Portrait : cliquez la pastille pour changer l’adresse de l’image.'
          : 'Portrait : cliquez la pastille et indiquez l’adresse d’une image (https://…). Les images ne sont pas hébergées ici, seule leur adresse est gardée.',
      }),
    ]);
  }

  function sectionJoueurs(personne) {
    const joueurs = donnees.joueurs || referentiels.joueurs || [];
    if (!joueurs.length) return h('div');

    const changer = (joueurId, modification) => {
      const notes = { ...(brouillon.relations_joueurs || {}) };
      const precedent = notes[joueurId] || { note: null, commentaire: '' };
      notes[joueurId] = { ...precedent, ...modification };
      marquerModifie('relations_joueurs', notes);
    };

    const lignes = joueurs.map((joueur) => {
      const actuel = personne.relations_joueurs?.[joueur.id] || { note: null, commentaire: '' };

      return h('div', { class: 'joueur' }, [
        h('div', { class: 'joueur-entete' }, [
          h('span', {
            class: 'joueur-pastille',
            style: { background: joueur.couleur || '#7a7f87' },
          }),
          h('div', {}, [
            h('div', { class: 'joueur-nom', texte: joueur.nom }),
            joueur.personnage && h('div', { class: 'joueur-perso', texte: joueur.personnage }),
          ]),
        ]),
        curseurHumeur({
          valeur: actuel.note,
          effacable: true, // « pas encore rencontré » est un état légitime
          surChangement: (valeur) => changer(joueur.id, { note: valeur }),
        }),
        h('div', { class: 'joueur-commentaire' }, [
          h('input', {
            type: 'text',
            placeholder: 'Commentaire (dernière rencontre, service rendu…)',
            value: actuel.commentaire || '',
            oninput: (evenement) => changer(joueur.id, { commentaire: evenement.target.value }),
          }),
        ]),
      ]);
    });

    return h('div', { class: 'pn-section' }, [
      h('h3', { texte: 'Humeur envers les joueurs' }),
      h('p', {
        class: 'echelle-aide',
        texte: '1 affectueux · 4 indifférent · 7 malveillant — MD/MP à appliquer aux jets.',
      }),
      ...lignes,
    ]);
  }

  function sectionNotes() {
    return h('div', { class: 'pn-section' }, [
      h('h3', { texte: 'Notes' }),
      h('div', { class: 'champ-edit' }, [
        h('textarea', {
          rows: 6, // c'est le bloc qu'on relit en pleine partie : de la place
          placeholder: 'Secrets, objectifs, accroches de scénario…',
          oninput: (evenement) => marquerModifie('notes', evenement.target.value),
          texte: brouillon.notes || '',
        }),
      ]),
    ]);
  }

  function pied() {
    elementEtat = h('span', {
      class: 'etat-sauvegarde',
      texte: enAttente() ? 'Envoi…' : 'À jour',
    });
    return h('div', { class: 'pn-pied' }, [
      elementEtat,
      h('span', {
        class: 'pn-pied-aide',
        texte: 'Enregistré au fil de la frappe · écriture disque en haut',
      }),
    ]);
  }

  // ------------------------------------------------------------ sauvegarde
  //
  // Plus de bouton : chaque champ part vers le serveur peu après la dernière
  // frappe, et le serveur écrit en base dans la foulée. Il n'y a donc rien à
  // « enregistrer » ensuite, et rien à perdre en fermant l'onglet.

  /** Champs qui changent le dessin : les seuls à valoir un redessin du plan. */
  const CHAMPS_VISIBLES = new Set([
    'prenom', 'nom', 'surnom', 'maison', 'statut', 'importance', 'couleur',
    'tags', 'relations_joueurs', 'avatar',
  ]);

  const enAttente = () => Object.keys(aEnvoyer).length > 0;

  function planifierEnvoi() {
    clearTimeout(minuterie);
    minuterie = setTimeout(envoyer, DELAI_ENVOI);
  }

  async function envoyer() {
    clearTimeout(minuterie);
    if (!brouillon || !enAttente()) return;
    const patch = aEnvoyer;
    aEnvoyer = {};
    const id = brouillon.id;
    definirEtat('Envoi…');
    try {
      const reponse = await Api.majPersonne(id, patch);
      if (brouillon?.id === id) {
        donnees.personne = reponse.personne;
        donnees.photo = reponse.photo;
        // On ne recopie pas la réponse dans le brouillon : quelqu'un est
        // peut-être en train de taper dans un autre champ.
        definirEtat(enAttente() ? 'Envoi…' : 'Enregistré', 'ok');
      }
      if (Object.keys(patch).some((champ) => CHAMPS_VISIBLES.has(champ))) {
        rappels.surEnregistrement?.(reponse.personne);
      }
    } catch (erreur) {
      aEnvoyer = { ...patch, ...aEnvoyer }; // on ne perd pas la modification
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  return {
    afficher,
    fermer,
    estOuvert: () => !!brouillon,
    idCourant: () => brouillon?.id || null,
    definirReferentiels(nouveaux) {
      referentiels = nouveaux;
    },
  };
}
