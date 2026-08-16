/* Panneau de détail d'une personne : lecture + édition + liens.
 * Générique : il se contente des données de /api/personnes/<id>. */

import { Api } from './api.js';
import { champSuggere } from './autocomplete.js';
import { anneeDe, ageDe, naissanceDepuisAge } from './calendrier.js';
import { h } from './dom.js';
import { curseurHumeur } from './humeur.js';
import { RANGS, basculerRang, porteLeRang, rangDuTag } from './rangs.js';
import { cle } from './base.js';

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
  /**
   * L'onglet « Cité dans le carnet » garde son état d'une fiche à l'autre :
   * quelqu'un qui vient de l'ouvrir est en train de dépouiller ses notes, et
   * le refermer à chaque profil lui ferait refaire le geste vingt fois.
   */
  let citationsOuvertes = false;
  /**
   * L'humeur envers les joueurs, elle, se retient **d'une session à l'autre** :
   * une table qui ne note pas les humeurs ne veut pas les replier à chaque
   * ouverture, et une table qui les note veut les avoir sous la main. Ouvert
   * par défaut — c'est ce que faisait la fiche avant qu'on puisse la replier.
   */
  const MEMOIRE_JOUEURS = cle('familytree-fiche-joueurs');
  let joueursOuverts = localStorage.getItem(MEMOIRE_JOUEURS) !== '0';

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
      sectionCitations(),
      sectionJoueurs(personne),
      sectionIdentite(personne),
      pied()
    );
  }

  /* ------------------------------------------------------ cité dans le carnet
   *
   * Replié par défaut, et il le reste d'une fiche à l'autre : c'est un
   * complément, pas le sujet. Mais **le nombre est dans le titre**, donc
   * visible sans rien déplier — sinon il faudrait ouvrir chaque fiche pour
   * savoir si elle a quelque chose à montrer.
   */

  function sectionCitations() {
    const citations = donnees.citations || { total: 0, par_note: [], par_chapitre: [] };
    const bloc = h('details', {
      class: 'pn-section pn-repliable pn-citations',
      open: citationsOuvertes,
      ontoggle: (evenement) => {
        citationsOuvertes = evenement.target.open;
      },
    });

    const resume = citations.total
      ? `${citations.total} apparition${citations.total > 1 ? 's' : ''} · ` +
        `${citations.par_note.length} note${citations.par_note.length > 1 ? 's' : ''}` +
        (citations.par_chapitre.length > 1 ? ` · ${citations.par_chapitre.length} chapitres` : '')
      : 'aucune';

    bloc.append(
      h('summary', {}, [
        h('span', { class: 'pn-repli-titre' }, [
          h('span', { texte: 'Cité dans le carnet' }),
          h('span', { class: 'pn-repli-nombre', texte: resume }),
        ]),
      ]),
      ...(citations.total ? corpsCitations(citations) : [aucuneCitation()])
    );
    return bloc;
  }

  function aucuneCitation() {
    return h('p', {
      class: 'echelle-aide',
      texte: 'Dans le carnet (✎), tapez « / » puis son nom pour la citer.',
    });
  }

  /** Groupé par chapitre, dans l'ordre du carnet : on relit une campagne dans l'ordre. */
  function corpsCitations(citations) {
    const notesParChapitre = new Map();
    for (const entree of citations.par_note) {
      const liste = notesParChapitre.get(entree.chapitre) ?? [];
      liste.push(entree);
      notesParChapitre.set(entree.chapitre, liste);
    }

    return citations.par_chapitre.map((chapitre) =>
      h('div', { class: 'pn-cit-groupe' }, [
        h('div', {
          class: 'pn-cit-chapitre',
          texte: `${chapitre.titre || 'Hors chapitre'} — ${chapitre.occurrences} fois`,
        }),
        ...(notesParChapitre.get(chapitre.id) || []).map(blocNote),
      ])
    );
  }

  function blocNote(entree) {
    return h('div', { class: 'pn-cit-note' }, [
      h('div', { class: 'pn-cit-note-titre' }, [
        h('span', { texte: entree.titre || 'Note sans titre' }),
        h('span', {
          class: 'pn-repli-nombre',
          texte: `${entree.occurrences}×`,
        }),
      ]),
      ...entree.extraits.map((extrait) =>
        h(
          'button',
          {
            class: 'pn-cit-extrait',
            type: 'button',
            title: 'Ouvrir le carnet à ce passage',
            onclick: () =>
              rappels.surCitation?.(entree.note, {
                genre: 'p',
                id: brouillon?.id,
                rang: extrait.rang,
              }),
          },
          [
            extrait.avant,
            h('b', { texte: extrait.libelle }),
            extrait.apres,
          ]
        )
      ),
    ]);
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
      // Un rang n'est pas un tag comme un autre : il se lit d'un coup d'œil.
      ...(personne.tags || []).map((tag) => {
        const rang = rangDuTag(tag);
        return rang
          ? h('span', {
              class: `badge badge-rang badge-rang-${rang.classe}`,
              texte: `${rang.icone} ${rang.label}`,
            })
          : h('span', { class: 'badge', texte: `#${tag}` });
      }),
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

  /**
   * L'âge et l'année de naissance : deux façons de saisir la même chose.
   *
   * Seule l'**année de naissance** est enregistrée. Taper un âge la calcule,
   * taper une année recalcule l'âge — et comme rien n'est stocké en double, les
   * âges de toute la campagne avancent d'un coup quand le MJ pousse la date.
   *
   * Pour un mort, l'âge se compte jusqu'à son décès, pas jusqu'à aujourd'hui :
   * c'est l'âge qu'il avait, et il n'en aura pas d'autre.
   */
  function champsAgeEtNaissance() {
    const anneeCourante = referentiels.meta?.annee_courante || '';
    // L'année de référence : celle de la mort pour un mort daté, sinon celle
    // de la campagne.
    const reference = () =>
      brouillon.statut === 'mort' && anneeDe(brouillon.deces) !== null
        ? brouillon.deces
        : anneeCourante;
    const utilisable = () => anneeDe(reference()) !== null;

    const champNaissance = h('input', {
      type: 'text',
      placeholder: '263 AC',
      value: brouillon.naissance ?? '',
      oninput: (evenement) => {
        marquerModifie('naissance', evenement.target.value);
        champAge.value = ageDe(evenement.target.value, reference()) ?? '';
      },
    });

    const champAge = h('input', {
      type: 'number',
      placeholder: utilisable() ? '17' : '—',
      // L'explication vit ici, sur le champ, plutôt qu'en paragraphe sous la
      // grille : elle ne se lit qu'au moment où on s'en sert.
      title: utilisable()
        ? `Calculé sur ${reference()}. Saisir l’un remplit l’autre, et avancer la date de campagne vieillit tout le monde d’un coup.`
        : 'Il faut une année de campagne pour calculer un âge.',
      value: ageDe(brouillon.naissance, reference()) ?? '',
      oninput: (evenement) => {
        const age = Number.parseInt(evenement.target.value, 10);
        const naissance = Number.isFinite(age) ? naissanceDepuisAge(age, reference()) : null;
        champNaissance.value = naissance ?? '';
        marquerModifie('naissance', naissance ?? '');
      },
    });
    if (!utilisable()) champAge.disabled = true;

    const libelleAge =
      brouillon.statut === 'mort' && anneeDe(brouillon.deces) !== null ? 'Âge à sa mort' : 'Âge';

    return [
      h('div', { class: 'champ-edit' }, [h('label', { texte: libelleAge }), champAge]),
      h('div', { class: 'champ-edit' }, [
        h('label', { texte: 'Naissance' }),
        champNaissance,
      ]),
    ];
  }

  /**
   * Chef de maison et héritier, en deux boutons.
   *
   * Ce sont des tags — ils restent modifiables à la main juste en dessous —
   * mais les taper exactement pour que la carte les reconnaisse serait un
   * piège. Les deux s'excluent : on n'est pas à la fois celui qui règne et
   * celui qui attend.
   */
  function champRang() {
    const boutons = RANGS.map((rang) => {
      const actif = porteLeRang(brouillon.tags, rang.id);
      return h('button', {
        type: 'button',
        class: `bouton puce-rang puce-rang-${rang.classe} ${actif ? 'actif' : ''}`,
        texte: `${rang.icone} ${rang.label}`,
        title: actif ? `Retirer « ${rang.label} »` : `Marquer comme ${rang.label.toLowerCase()}`,
        onclick: () => {
          marquerModifie('tags', basculerRang(brouillon.tags, rang.id));
          dessiner(); // les badges du haut et la carte suivent
        },
      });
    });
    return h('div', { class: 'champ-edit pleine' }, [
      h('label', { texte: 'Rang dans la maison' }),
      h('div', { class: 'rangs-puces' }, boutons),
    ]);
  }

  /**
   * Une seule chose mérite un paragraphe : le champ « Âge » est désactivé et
   * il faut dire pourquoi. Quand il marche, il se passe d'explication — son
   * infobulle dit sur quelle année il compte.
   */
  function aideAge() {
    const annee = referentiels.meta?.annee_courante;
    if (anneeDe(annee) !== null) return '';
    return 'Âge : réglez d’abord l’année de la campagne (📅 dans la barre du haut) — sans elle, seule l’année de naissance se saisit.';
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
        ...champsAgeEtNaissance(),
        champTexte('deces', 'Décès'),
        // Tout ce qui sert d'axe de filtre doit s'éditer ici. La génération
        // est la seule qui se déduisait de l'arbre sans qu'on puisse la
        // contredire : vide, elle reste calculée ; remplie, elle gagne.
        champTexte('generation', 'Génération (vide = calculée)', { type: 'number' }),
        champLieu(),
        champListe('titres', 'Titres'),
        champRang(),
        champListe('tags', 'Tags'),
      ]),
      // Ne reste que ce qui ne se devine pas : sans année de campagne, le champ
      // « Âge » ne peut rien calculer, et il faut le dire. Le reste — comment
      // marche un portrait, ce qu'est un âge déduit — se lit dans l'infobulle
      // du champ concerné, à l'endroit et au moment où on s'en sert.
      aideAge() && h('p', { class: 'echelle-aide', texte: aideAge() }),
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

      return h('div', { class: 'joueur-ligne' }, [
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

    // Quatre joueurs, c'est quatre curseurs et quatre commentaires : la moitié
    // de la fiche. Repliable, donc — et le résumé dit dans le titre s'il y a
    // quelque chose dessous, pour ne pas avoir à déplier pour le savoir.
    const notes = joueurs.filter(
      (joueur) => personne.relations_joueurs?.[joueur.id]?.note != null
    ).length;

    const bloc = h('details', {
      class: 'pn-section pn-repliable pn-joueurs',
      open: joueursOuverts,
      ontoggle: (evenement) => {
        joueursOuverts = evenement.target.open;
        localStorage.setItem(MEMOIRE_JOUEURS, joueursOuverts ? '1' : '0');
      },
    });

    bloc.append(
      h('summary', {}, [
        h('span', { class: 'pn-repli-titre' }, [
          h('span', { texte: 'Humeur envers les joueurs' }),
          h('span', {
            class: 'pn-repli-nombre',
            texte: notes ? `${notes} / ${joueurs.length} notés` : 'aucune',
          }),
        ]),
      ]),
      h('p', {
        class: 'echelle-aide',
        texte: '1 affectueux · 4 indifférent · 7 malveillant.',
      }),
      ...lignes
    );
    return bloc;
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

  /**
   * Champs qui changent le dessin : les seuls à valoir un redessin du plan.
   *
   * `naissance` et `deces` y sont depuis que les fiches affichent un **âge** :
   * sans eux, on tapait « 13 ans » et la carte continuait d'en afficher 11.
   * (`notes`, `titres` et `lieu` restent dehors : ils se voient aussi sur la
   * carte, mais on les saisit par paragraphes, et recharger la vue à chaque
   * pause de frappe coûterait un aller-retour pour rien.)
   */
  const CHAMPS_VISIBLES = new Set([
    'prenom', 'nom', 'surnom', 'maison', 'statut', 'couleur',
    'tags', 'relations_joueurs', 'avatar', 'naissance', 'deces',
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

  /**
   * Relit les citations de la fiche ouverte, sans toucher au reste.
   *
   * Appelé quand le carnet vient d'écrire : le nombre affiché doit suivre. On
   * ne redessine **que** cette section — repasser par `afficher` remonterait
   * le panneau en haut et écraserait les champs en cours de saisie.
   */
  async function majCitations() {
    if (!brouillon) return;
    const id = brouillon.id;
    try {
      const citations = await Api.citations('p', id);
      if (brouillon?.id !== id || !donnees) return;
      donnees.citations = citations;
      element.querySelector('.pn-citations')?.replaceWith(sectionCitations());
    } catch (erreur) {
      // Un compteur qui ne se met pas à jour n'est pas une raison de crier.
    }
  }

  return {
    afficher,
    fermer,
    majCitations,
    estOuvert: () => !!brouillon,
    idCourant: () => brouillon?.id || null,
    definirReferentiels(nouveaux) {
      referentiels = nouveaux;
    },
  };
}
