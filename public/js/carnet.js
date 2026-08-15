/* Le carnet : écrire pendant la partie, relire après.
 *
 * Un seul exemplaire vit dans la page, et il se **déplace** : tantôt en volet
 * à côté du plan, tantôt en pleine scène comme n'importe quelle vue. C'est
 * pour ça que ce module n'est pas un moteur de rendu — `views/carnet.js` n'est
 * qu'un adaptateur qui vient chercher l'exemplaire existant. Ouvrir deux
 * carnets sur le même monde, ce serait deux brouillons qui s'écrasent.
 *
 * Ce qui est enregistré, c'est le **Markdown tapé**, rien d'autre : voir
 * `markdown.js` pour le rendu et `src/domaine/carnet.ts` pour le format. Le
 * texte part au serveur peu après la dernière frappe, comme la fiche d'une
 * personne — il n'y a pas de bouton « enregistrer », et rien à perdre en
 * fermant l'onglet.
 */

import { Api } from './api.js';
import { aplatir } from './autocomplete.js';
import { h } from './dom.js';
import { BALISE, ICONE_GENRE, rendre as rendreMarkdown, versTexte } from './markdown.js';

const DELAI_ENVOI = 700;
const SUGGESTIONS_MAX = 8;
/** Au-delà, ce n'est plus un nom qu'on cherche : le « / » était de la ponctuation. */
const REQUETE_MAX = 32;

const GENRE_LABEL = { p: 'Profil', m: 'Maison', j: 'Joueur', l: 'Lien' };
/** Les profils d'abord : c'est ce qu'on cite vingt fois par séance. */
const ORDRE_GENRE = { p: 0, m: 1, j: 2, l: 3 };

/**
 * Combien de propositions au maximum, par genre.
 *
 * Sans ce garde-fou, les **liens** noient tout : leur nom est fabriqué à partir
 * de celui de leurs deux extrémités, donc taper « /ed » remontait Eddard Stark,
 * puis les cinq « Eddard Stark → … ». Mesuré à la première frappe : six liens
 * sur huit propositions, et la maison Stark hors de la liste. Les quotas ne
 * cachent rien — ce qui déborde reprend les places libres si les autres genres
 * n'ont rien à proposer.
 */
const QUOTA_GENRE = { p: 5, m: 3, j: 3, l: 2 };

const MODELE_TABLEAU = '| Colonne | Colonne |\n| --- | --- |\n|  |  |\n';

/**
 * `replaceChildren` avec les absents filtrés.
 *
 * `h()` sait ignorer un enfant `null` ou `false` ; `replaceChildren`, lui, les
 * convertit en **texte** — un « null » ou un « false » s'affiche alors au
 * milieu du sommaire. Constaté à la première ouverture du volet.
 */
function poser(hote, ...enfants) {
  hote.replaceChildren(...enfants.filter(Boolean));
}

/* --------------------------------------------------------------------------
 * L'exemplaire unique
 *
 * `main.js` fabrique le carnet une fois et le pose ici ; `views/carnet.js` vient
 * le chercher quand la vue s'ouvre, au lieu d'en fabriquer un second. C'est ce
 * qui fait que « déplacer » déplace, et n'ouvre jamais un deuxième brouillon
 * sur le même texte.
 * -------------------------------------------------------------------------- */

let partage = null;

export function definirCarnetPartage(instance) {
  partage = instance;
  return instance;
}

export function carnetPartage() {
  return partage;
}

export function creerCarnet(contexte = {}) {
  let donnees = { chapitres: [], notes: [], catalogue: [] };
  let libelles = new Map();
  let noteCourante = null;
  let mode = 'lecture';
  let sommaireOuvert = false;
  let chargement = null;
  let aEnvoyer = null;
  let minuterie = null;
  let ancreEnAttente = null;
  /** Les deux nœuds que le reste du module va chercher : ils changent à chaque dessin. */
  const refs = { source: null, rendu: null };

  const lectureSeule = () => !!contexte.lectureSeule?.();

  /* ------------------------------------------------------------- squelette */

  const sommaire = h('nav', { class: 'cn-sommaire' });
  const zoneNote = h('section', { class: 'cn-note' });
  const suggestions = h('ul', { class: 'cn-suggestions', hidden: true });
  const fil = h('div', { class: 'cn-fil' });
  const etat = h('span', { class: 'cn-etat' });

  const btnSommaire = h('button', {
    class: 'bouton bouton-icone cn-btn-sommaire',
    type: 'button',
    texte: '☰',
    title: 'Sommaire : chapitres et notes',
    onclick: () => {
      sommaireOuvert = !sommaireOuvert;
      dessiner();
    },
  });

  const btnMode = h('button', {
    class: 'bouton cn-btn-mode',
    type: 'button',
    onclick: () => basculerMode(),
  });

  const btnDeplacer = h('button', {
    class: 'bouton bouton-icone',
    type: 'button',
    texte: '⇄',
    onclick: () => contexte.surDeplacement?.(),
  });

  const btnFermer = h('button', {
    class: 'bouton bouton-icone',
    type: 'button',
    texte: '✕',
    title: 'Fermer le carnet',
    onclick: () => contexte.surFermeture?.(),
  });

  const barre = h('header', { class: 'cn-barre' }, [
    btnSommaire,
    fil,
    etat,
    btnMode,
    btnDeplacer,
    btnFermer,
  ]);

  /**
   * L'avertissement de la démonstration.
   *
   * C'est le seul endroit de l'application où quelqu'un écrit **longuement** de
   * ses propres mots. Le bandeau du haut dit déjà que rien n'est conservé dans
   * la démonstration ; le redire ici n'est pas une redite, c'est le dire à
   * l'endroit où l'on perdrait le plus.
   */
  const avertissement = h('p', { class: 'cn-avertissement', hidden: true });

  const racine = h('div', { class: 'carnet' }, [
    barre,
    avertissement,
    h('div', { class: 'cn-corps' }, [sommaire, zoneNote]),
    suggestions,
  ]);

  /* ------------------------------------------------------------- chargement */

  function indexer() {
    libelles = new Map(
      (donnees.catalogue || []).map((entree) => [`${entree.genre}:${entree.id}`, entree])
    );
  }

  const libelleDe = (genre, id) => libelles.get(`${genre}:${id}`)?.libelle ?? null;

  /**
   * Adopte des données déjà lues — le payload de la vue les porte déjà.
   *
   * **On n'écrase jamais un texte en cours de frappe.** Le carnet se recharge
   * chaque fois que la vue se recharge (un profil renommé change tous les noms
   * affichés) : si ça tombait pendant qu'on tape, la réponse du serveur —
   * vieille de la dernière écriture — remplacerait les mots qui viennent d'être
   * saisis. Dans ce cas seul le catalogue des noms est repris.
   */
  function appliquer(payload) {
    donnees.catalogue = payload.catalogue || [];
    indexer();

    const enCoursDeFrappe = !!aEnvoyer || document.activeElement === refs.source;
    if (enCoursDeFrappe) {
      dessinerBarre();
      return;
    }

    donnees.chapitres = payload.chapitres || [];
    donnees.notes = payload.notes || [];
    if (!donnees.notes.some((note) => note.id === noteCourante)) {
      noteCourante = donnees.notes[0]?.id ?? null;
    }
    dessiner();
    honorerAncre();
  }

  async function charger() {
    if (chargement) return chargement;
    chargement = Api.carnet()
      .then((reponse) => appliquer(reponse))
      .catch((erreur) => definirEtat(`Erreur : ${erreur.message}`, 'erreur'))
      .finally(() => {
        chargement = null;
      });
    return chargement;
  }

  const note = () => donnees.notes.find((entree) => entree.id === noteCourante) ?? null;

  /* ------------------------------------------------------------- écriture */

  function definirEtat(texte, classe = '') {
    etat.textContent = texte;
    etat.className = `cn-etat ${classe}`;
  }

  function marquerModifie(patch) {
    if (!noteCourante) return;
    aEnvoyer = { ...(aEnvoyer ?? {}), ...patch, __note: noteCourante };
    definirEtat('Modification…', 'modifie');
    clearTimeout(minuterie);
    minuterie = setTimeout(envoyer, DELAI_ENVOI);
  }

  async function envoyer() {
    clearTimeout(minuterie);
    if (!aEnvoyer) return;
    const patch = aEnvoyer;
    const cible = patch.__note;
    delete patch.__note;
    aEnvoyer = null;

    definirEtat('Envoi…');
    try {
      const reponse = await Api.majNote(cible, patch);
      const locale = donnees.notes.find((entree) => entree.id === cible);
      // On ne recopie pas le corps : quelqu'un tape peut-être encore dedans.
      if (locale) locale.titre = reponse.note.titre;
      definirEtat(aEnvoyer ? 'Envoi…' : 'Enregistré', 'ok');
      dessinerSommaire();
      contexte.surEcriture?.();
    } catch (erreur) {
      // Ce qui n'est pas parti reste à envoyer : une coupure ne perd rien.
      aEnvoyer = { ...patch, ...(aEnvoyer ?? {}), __note: cible };
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  /* ---------------------------------------------------------------- rendu */

  function dessiner() {
    racine.classList.toggle('cn-sommaire-ouvert', sommaireOuvert);
    racine.classList.toggle('cn-lecture-seule', lectureSeule());
    const mise_en_garde = contexte.avertissement?.() || '';
    avertissement.textContent = mise_en_garde;
    avertissement.hidden = !mise_en_garde;
    dessinerBarre();
    dessinerSommaire();
    dessinerNote();
  }

  function dessinerBarre() {
    const courante = note();
    const chapitre = donnees.chapitres.find((c) => c.id === courante?.chapitre);
    poser(
      fil,
      chapitre && h('span', { class: 'cn-fil-chapitre', texte: chapitre.titre || 'Chapitre' }),
      chapitre && h('span', { class: 'cn-fil-sep', texte: '›' }),
      h('span', { class: 'cn-fil-note', texte: courante ? titreDe(courante) : 'Carnet' })
    );

    btnMode.textContent = mode === 'lecture' ? '✎ Écrire' : '👁 Lire';
    btnMode.title =
      mode === 'lecture' ? 'Passer en écriture (Markdown)' : 'Revenir à la lecture';
    btnMode.hidden = !courante || lectureSeule();
    btnDeplacer.title =
      contexte.placeActuelle?.() === 'vue'
        ? 'Ramener le carnet à côté du plan'
        : 'Ouvrir le carnet en pleine page';
    btnFermer.hidden = contexte.placeActuelle?.() === 'vue';
  }

  const titreDe = (entree) =>
    entree.titre || versTexte(entree.corps, libelleDe).slice(0, 40) || 'Note sans titre';

  function dessinerSommaire() {
    const parChapitre = new Map(donnees.chapitres.map((c) => [c.id, []]));
    const orphelines = [];
    for (const entree of donnees.notes) {
      const liste = parChapitre.get(entree.chapitre);
      if (liste) liste.push(entree);
      else orphelines.push(entree);
    }

    poser(
      sommaire,
      h('div', { class: 'cn-sommaire-entete' }, [
        h('h3', { texte: 'Sommaire' }),
        !lectureSeule() &&
          h('button', {
            class: 'bouton bouton-icone',
            type: 'button',
            texte: '＋',
            title: 'Nouveau chapitre',
            onclick: () => creerChapitre(),
          }),
      ]),
      orphelines.length
        ? h('div', { class: 'cn-groupe' }, [
            h('div', { class: 'cn-groupe-titre cn-hors-chapitre' }, [
              h('span', { texte: 'Hors chapitre' }),
              h('span', { class: 'nombre', texte: orphelines.length }),
            ]),
            ...orphelines.map(ligneNote),
          ])
        : null,
      ...donnees.chapitres.map((chapitre) => groupeChapitre(chapitre, parChapitre.get(chapitre.id))),
      !lectureSeule() &&
        h('button', {
          class: 'bouton cn-nouvelle-note',
          type: 'button',
          texte: '＋ Nouvelle note',
          onclick: () => creerNote(''),
        })
    );
  }

  function groupeChapitre(chapitre, notes) {
    const titre = h('input', {
      class: 'cn-chap-titre',
      value: chapitre.titre,
      placeholder: 'Titre du chapitre',
      readonly: lectureSeule(),
      onchange: async (evenement) => {
        const valeur = evenement.target.value;
        chapitre.titre = valeur;
        try {
          await Api.majChapitre(chapitre.id, { titre: valeur });
          contexte.surEcriture?.();
          dessinerBarre();
        } catch (erreur) {
          definirEtat(`Échec : ${erreur.message}`, 'erreur');
        }
      },
    });

    return h('div', { class: 'cn-groupe' }, [
      h('div', { class: 'cn-groupe-titre' }, [
        titre,
        h('span', { class: 'nombre', texte: notes.length }),
        !lectureSeule() &&
          h('button', {
            class: 'bouton bouton-icone',
            type: 'button',
            texte: '＋',
            title: `Nouvelle note dans « ${chapitre.titre || 'ce chapitre'} »`,
            onclick: () => creerNote(chapitre.id),
          }),
        !lectureSeule() &&
          h('button', {
            class: 'bouton bouton-icone cn-danger',
            type: 'button',
            texte: '✕',
            title: 'Retirer le chapitre (ses notes sont conservées)',
            onclick: () => supprimerChapitre(chapitre, notes.length),
          }),
      ]),
      ...notes.map(ligneNote),
    ]);
  }

  function ligneNote(entree) {
    const cites = new Set(
      [...String(entree.corps ?? '').matchAll(BALISE)].map((trouve) => trouve[0])
    ).size;

    return h(
      'button',
      {
        class: `cn-ligne ${entree.id === noteCourante ? 'actif' : ''}`,
        type: 'button',
        onclick: () => choisirNote(entree.id),
      },
      [
        h('span', { class: 'cn-ligne-titre', texte: titreDe(entree) }),
        cites ? h('span', { class: 'cn-ligne-cites', texte: `${cites} cité${cites > 1 ? 's' : ''}` }) : null,
      ]
    );
  }

  function dessinerNote() {
    const courante = note();
    if (!courante) {
      zoneNote.replaceChildren(vide());
      return;
    }

    const titre = h('input', {
      class: 'cn-titre',
      value: courante.titre,
      placeholder: 'Titre de la note (séance du…, un lieu, une intrigue)',
      readonly: lectureSeule(),
      oninput: (evenement) => {
        courante.titre = evenement.target.value;
        marquerModifie({ titre: evenement.target.value });
      },
    });

    const rendu = h('div', {
      class: 'cn-rendu',
      ondblclick: (evenement) => {
        if (lectureSeule()) return;
        if (evenement.target.closest('.balise, a')) return;
        basculerMode('ecriture');
      },
    });

    const source = h('textarea', {
      class: 'cn-source',
      spellcheck: 'true',
      placeholder:
        'Écrivez ici. « / » cite un profil, une maison, un joueur ou un lien.\n' +
        'Les boutons du dessus posent des titres, des listes, des tableaux.',
      oninput: (evenement) => {
        courante.corps = evenement.target.value;
        marquerModifie({ corps: evenement.target.value });
        examinerDeclencheur();
      },
      onkeydown: (evenement) => surToucheSource(evenement),
      onclick: () => fermerSuggestions(),
      onblur: () => setTimeout(fermerSuggestions, 150),
      onscroll: () => fermerSuggestions(),
    });
    source.value = courante.corps ?? '';
    refs.source = source;

    poser(
      zoneNote,
      titre,
      !lectureSeule() && barreOutils(),
      mode === 'ecriture' && !lectureSeule() ? source : rendu,
      pied(courante)
    );

    if (mode === 'lecture' || lectureSeule()) {
      rendreMarkdown(rendu, courante.corps, {
        libelle: libelleDe,
        surBalise: (genre, id, evenement) => contexte.surBalise?.(genre, id, evenement),
      });
      if (!String(courante.corps ?? '').trim()) {
        rendu.replaceChildren(
          h('p', {
            class: 'vide',
            texte: lectureSeule()
              ? 'Cette note est vide.'
              : 'Cette note est vide — cliquez « ✎ Écrire » pour commencer.',
          })
        );
      }
    }
    refs.rendu = rendu;
  }

  function pied(courante) {
    const signes = String(courante.corps ?? '').length;
    return h('div', { class: 'cn-pied' }, [
      h('span', {
        class: 'cn-pied-aide',
        texte: `${signes.toLocaleString('fr-FR')} signes · enregistré au fil de la frappe`,
      }),
      h('select', {
        class: 'cn-chapitre-choix',
        disabled: lectureSeule(),
        onchange: (evenement) => {
          courante.chapitre = evenement.target.value;
          marquerModifie({ chapitre: evenement.target.value });
          dessinerSommaire();
          dessinerBarre();
        },
      }, [
        optionChapitre('', 'Hors chapitre', courante.chapitre),
        ...donnees.chapitres.map((chapitre) =>
          optionChapitre(chapitre.id, chapitre.titre || chapitre.id, courante.chapitre)
        ),
      ]),
      !lectureSeule() &&
        h('button', {
          class: 'bouton bouton-icone cn-danger',
          type: 'button',
          texte: '🗑',
          title: 'Supprimer cette note',
          onclick: () => supprimerNote(courante),
        }),
    ]);
  }

  function optionChapitre(valeur, libelle, courant) {
    const option = h('option', { value: valeur, texte: libelle });
    if (valeur === courant) option.selected = true;
    return option;
  }

  function vide() {
    return h('div', { class: 'cn-vide' }, [
      h('p', { class: 'cn-vide-titre', texte: 'Le carnet est vide.' }),
      h('p', {
        texte:
          'Les notes de la table vivent ici : une note par séance, rangées en ' +
          'chapitres. Tapez « / » dans le texte pour citer un profil, une ' +
          'maison, un joueur ou un lien — la fiche citée saura ensuite où on ' +
          'parle d’elle.',
      }),
      !lectureSeule() &&
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: '＋ Commencer une note',
          onclick: () => creerNote(''),
        }),
    ]);
  }

  /* ------------------------------------------------------------ barre d'outils */

  /**
   * Les boutons de mise en forme.
   *
   * Ils **écrivent du Markdown dans le texte** — ce n'est pas un traitement de
   * texte déguisé. Le fichier reste lisible tel quel, et c'est ce qui permet
   * d'en garder mille dans une sauvegarde de deux mégaoctets.
   */
  function barreOutils() {
    const outil = (texte, title, action, classe = '') =>
      h('button', {
        class: `bouton bouton-icone cn-outil ${classe}`,
        type: 'button',
        texte,
        title,
        // `mousedown` plutôt que `click` : sans ça le champ perd le focus et la
        // sélection avant l'action, et le gras s'appliquerait à rien.
        onmousedown: (evenement) => {
          evenement.preventDefault();
          if (mode !== 'ecriture') basculerMode('ecriture');
          action();
        },
      });

    return h('div', { class: 'cn-outils' }, [
      outil('H1', 'Titre de niveau 1', () => prefixer('# ')),
      outil('H2', 'Titre de niveau 2', () => prefixer('## ')),
      outil('H3', 'Titre de niveau 3', () => prefixer('### ')),
      h('span', { class: 'cn-outils-sep' }),
      outil('G', 'Gras', () => entourer('**', '**'), 'cn-outil-gras'),
      outil('I', 'Italique', () => entourer('*', '*'), 'cn-outil-italique'),
      outil('S', 'Barré', () => entourer('~~', '~~'), 'cn-outil-barre'),
      outil('‹›', 'Code', () => entourer('`', '`')),
      h('span', { class: 'cn-outils-sep' }),
      outil('•', 'Liste à puces', () => prefixer('- ')),
      outil('1.', 'Liste numérotée', () => prefixer('1. ')),
      outil('❞', 'Citation', () => prefixer('> ')),
      outil('⊞', 'Tableau', () => insererBloc(MODELE_TABLEAU)),
      outil('—', 'Filet de séparation', () => insererBloc('\n---\n')),
      outil('🔗', 'Lien', () => entourer('[', '](https://)')),
      h('span', { class: 'cn-outils-sep' }),
      outil('/', 'Citer un profil, une maison, un joueur, un lien', () => ouvrirParBouton(), 'cn-outil-balise'),
    ]);
  }

  function zone() {
    return refs.source;
  }

  function remplacerSelection(nouveau, { selectionner = null } = {}) {
    const champ = zone();
    if (!champ) return;
    const debut = champ.selectionStart;
    const fin = champ.selectionEnd;
    champ.setRangeText(nouveau, debut, fin, 'end');
    if (selectionner) champ.setSelectionRange(selectionner.debut, selectionner.fin);
    champ.focus();
    const courante = note();
    if (courante) {
      courante.corps = champ.value;
      marquerModifie({ corps: champ.value });
    }
  }

  function entourer(avant, apres) {
    const champ = zone();
    if (!champ) return;
    const debut = champ.selectionStart;
    const fin = champ.selectionEnd;
    const selection = champ.value.slice(debut, fin);
    remplacerSelection(`${avant}${selection}${apres}`, {
      // Sans sélection, on pose le curseur **entre** les deux marques : la
      // frappe suivante est déjà en gras.
      selectionner: selection
        ? { debut: debut + avant.length, fin: debut + avant.length + selection.length }
        : { debut: debut + avant.length, fin: debut + avant.length },
    });
  }

  /** Pose (ou retire) un préfixe sur chaque ligne touchée par la sélection. */
  function prefixer(prefixe) {
    const champ = zone();
    if (!champ) return;
    const valeur = champ.value;
    const debut = valeur.lastIndexOf('\n', Math.max(0, champ.selectionStart - 1)) + 1;
    const finBrute = valeur.indexOf('\n', champ.selectionEnd);
    const fin = finBrute === -1 ? valeur.length : finBrute;

    const lignes = valeur.slice(debut, fin).split('\n');
    const deja = lignes.every((ligne) => ligne.startsWith(prefixe));
    const refaites = lignes.map((ligne) =>
      deja ? ligne.slice(prefixe.length) : `${prefixe}${ligne.replace(/^(#{1,6} |[-*+] |\d+[.)] |> )/, '')}`
    );

    champ.setRangeText(refaites.join('\n'), debut, fin, 'end');
    champ.focus();
    const courante = note();
    if (courante) {
      courante.corps = champ.value;
      marquerModifie({ corps: champ.value });
    }
  }

  function insererBloc(bloc) {
    const champ = zone();
    if (!champ) return;
    const avant = champ.value.slice(0, champ.selectionStart);
    const prefixe = avant && !avant.endsWith('\n') ? '\n' : '';
    remplacerSelection(`${prefixe}${bloc}`);
  }

  /* ------------------------------------------------------ complétion « / » */

  let completion = null; // { debut, requete, choix, survol }

  /**
   * Le bouton « / » de la barre d'outils tape le « / » à la place de
   * l'utilisateur — et l'espace qui doit le précéder, sinon `examinerDeclencheur`
   * le prendrait pour la barre d'un « et/ou » et ne proposerait rien.
   */
  function ouvrirParBouton() {
    const champ = zone();
    if (!champ) return;
    const precedent = champ.value[champ.selectionStart - 1];
    remplacerSelection(`${precedent && !/\s/.test(precedent) ? ' ' : ''}/`);
    examinerDeclencheur();
  }

  /**
   * Y a-t-il un « / » ouvert juste avant le curseur ?
   *
   * On remonte depuis le curseur tant qu'on croise des caractères de nom
   * (lettres, chiffres, espaces, apostrophes, tirets). Le « / » ne compte que
   * s'il est en début de ligne ou précédé d'une espace : sans ça, « et/ou » et
   * « 12/03 » ouvriraient une liste à chaque frappe.
   */
  function examinerDeclencheur() {
    const champ = zone();
    if (!champ || lectureSeule()) return fermerSuggestions();

    const curseur = champ.selectionStart;
    const valeur = champ.value;
    let index = curseur - 1;
    while (index >= 0 && curseur - index <= REQUETE_MAX + 1) {
      const caractere = valeur[index];
      if (caractere === '/') break;
      if (caractere === '\n' || !/[\p{L}\p{N} '’-]/u.test(caractere)) return fermerSuggestions();
      index -= 1;
    }
    if (index < 0 || valeur[index] !== '/') return fermerSuggestions();
    const precedent = index === 0 ? '\n' : valeur[index - 1];
    if (!/[\s(«"']/.test(precedent)) return fermerSuggestions();

    const requete = valeur.slice(index + 1, curseur);
    const choix = proposer(requete);
    // Rien ne correspond : la liste se ferme au lieu de suivre une phrase qui
    // n'avait rien à voir. Elle revient dès qu'une lettre la fait correspondre.
    if (!choix.length) return fermerSuggestions();

    completion = { debut: index, requete, choix, survol: 0 };
    dessinerSuggestions();
  }

  function proposer(requete) {
    const propre = aplatir(requete);
    const candidats = donnees.catalogue || [];
    // « / » seul : on montre un échantillon des quatre genres plutôt que les
    // huit premiers profils — c'est la liste qui apprend ce qu'on peut citer.
    if (!propre) {
      return sousQuota([...candidats].sort((a, b) => ORDRE_GENRE[a.genre] - ORDRE_GENRE[b.genre]));
    }

    const notes = [];
    for (const entree of candidats) {
      const nom = aplatir(entree.libelle);
      const surnom = aplatir(entree.surnom || '');
      let score;
      if (nom.startsWith(propre)) score = 0;
      else if (surnom.startsWith(propre)) score = 1;
      else if (nom.split(' ').some((mot) => mot.startsWith(propre))) score = 2;
      else if (nom.includes(propre) || surnom.includes(propre)) score = 3;
      else if (aplatir(entree.detail || '').startsWith(propre)) score = 4;
      else continue;
      notes.push({ entree, score });
    }

    const classes = notes
      .sort(
        (a, b) =>
          a.score - b.score ||
          ORDRE_GENRE[a.entree.genre] - ORDRE_GENRE[b.entree.genre] ||
          a.entree.libelle.localeCompare(b.entree.libelle, 'fr')
      )
      .map((candidat) => candidat.entree);

    return sousQuota(classes);
  }

  /**
   * Applique les quotas — et **ne remplit pas** les places restées libres.
   *
   * Une liste de quatre propositions justes vaut mieux qu'une liste de huit
   * dont quatre sont du remplissage : c'est exactement ce qui se passait avec
   * « /ed », complété par cinq liens portant tous le même nom.
   *
   * L'exception est la recherche qui ne trouve **que** dans un genre — chercher
   * un lien précis, par exemple. En dessous de trois résultats, les recalés
   * reprennent les places : mieux vaut une liste longue que pas de liste.
   */
  function sousQuota(classes) {
    const pris = [];
    const recales = [];
    const comptes = {};
    for (const entree of classes) {
      comptes[entree.genre] = (comptes[entree.genre] ?? 0) + 1;
      if (comptes[entree.genre] <= (QUOTA_GENRE[entree.genre] ?? SUGGESTIONS_MAX)) pris.push(entree);
      else recales.push(entree);
      if (pris.length >= SUGGESTIONS_MAX) break;
    }
    if (pris.length >= 3) return pris;
    return [...pris, ...recales].slice(0, SUGGESTIONS_MAX);
  }

  function dessinerSuggestions() {
    if (!completion) return fermerSuggestions();
    suggestions.replaceChildren(
      ...completion.choix.map((entree, index) =>
        h(
          'li',
          {
            class: index === completion.survol ? 'survol' : '',
            onmousedown: (evenement) => {
              evenement.preventDefault();
              insererBalise(entree);
            },
          },
          [
            h('span', { class: 'cn-sug-ico', texte: ICONE_GENRE[entree.genre] ?? '◆' }),
            h('span', { class: 'cn-sug-nom', texte: entree.libelle }),
            h('span', {
              class: 'cn-sug-detail',
              texte: entree.detail || GENRE_LABEL[entree.genre] || '',
            }),
          ]
        )
      )
    );
    suggestions.hidden = false;
    placerSuggestions();
  }

  function fermerSuggestions() {
    completion = null;
    suggestions.hidden = true;
  }

  function insererBalise(entree) {
    const champ = zone();
    if (!champ || !completion) return;
    const fin = champ.selectionStart;
    champ.setRangeText(`@${entree.genre}:${entree.id} `, completion.debut, fin, 'end');
    fermerSuggestions();
    champ.focus();
    const courante = note();
    if (courante) {
      courante.corps = champ.value;
      marquerModifie({ corps: champ.value });
    }
  }

  function surToucheSource(evenement) {
    if (!completion || suggestions.hidden) {
      // Échap en écriture repasse en lecture : c'est le geste de fin de saisie.
      if (evenement.key === 'Escape') basculerMode('lecture');
      return;
    }
    if (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp') {
      evenement.preventDefault();
      const pas = evenement.key === 'ArrowDown' ? 1 : -1;
      completion.survol =
        (completion.survol + pas + completion.choix.length) % completion.choix.length;
      dessinerSuggestions();
    } else if (evenement.key === 'Enter' || evenement.key === 'Tab') {
      evenement.preventDefault();
      insererBalise(completion.choix[completion.survol]);
    } else if (evenement.key === 'Escape') {
      evenement.preventDefault();
      fermerSuggestions();
    }
  }

  /**
   * La liste se pose sous le curseur, pas au bas du champ.
   *
   * Un `<textarea>` ne dit pas où est son curseur : on recopie ses styles dans
   * un calque invisible, on y met le texte jusqu'au curseur, et on mesure où
   * atterrit un repère. C'est la seule méthode qui marche, et elle est bornée
   * — si la mesure sort du cadre, on retombe en bas à gauche du champ plutôt
   * que d'afficher une liste hors de l'écran.
   */
  const STYLES_MIROIR = [
    'boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  ];

  function placerSuggestions() {
    const champ = zone();
    if (!champ || !completion) return;

    const boiteChamp = champ.getBoundingClientRect();
    const boiteRacine = racine.getBoundingClientRect();
    const style = getComputedStyle(champ);
    const hauteurLigne = Number.parseFloat(style.lineHeight) || 18;

    let point = null;
    try {
      const miroir = document.createElement('div');
      for (const propriete of STYLES_MIROIR) miroir.style[propriete] = style[propriete];
      Object.assign(miroir.style, {
        position: 'absolute',
        visibility: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        top: '0',
        left: '-9999px',
      });
      miroir.textContent = champ.value.slice(0, completion.debut);
      const repere = document.createElement('span');
      repere.textContent = '​';
      miroir.append(repere);
      document.body.append(miroir);
      point = { x: repere.offsetLeft, y: repere.offsetTop };
      miroir.remove();
    } catch (erreur) {
      point = null;
    }

    const decalX = boiteChamp.left - boiteRacine.left;
    const decalY = boiteChamp.top - boiteRacine.top;
    let gauche = decalX + 8;
    let haut = decalY + boiteChamp.height - 8;

    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      const x = decalX + point.x - champ.scrollLeft;
      const y = decalY + point.y - champ.scrollTop + hauteurLigne + 4;
      // Hors du champ (défilement, mesure aberrante) : on ne suit pas.
      if (y > decalY - hauteurLigne && y < decalY + boiteChamp.height + hauteurLigne) {
        gauche = x;
        haut = y;
      }
    }

    suggestions.style.left = '0px';
    suggestions.style.top = '0px';
    const boiteListe = suggestions.getBoundingClientRect();
    const largeurMax = boiteRacine.width - boiteListe.width - 8;
    const hauteurMax = boiteRacine.height - boiteListe.height - 8;
    suggestions.style.left = `${Math.max(8, Math.min(gauche, largeurMax))}px`;
    suggestions.style.top = `${Math.max(8, Math.min(haut, hauteurMax))}px`;
  }

  /* --------------------------------------------------------------- actions */

  function basculerMode(force = null) {
    const courante = note();
    if (!courante) return;
    mode = force ?? (mode === 'lecture' ? 'ecriture' : 'lecture');
    if (lectureSeule()) mode = 'lecture';
    fermerSuggestions();
    dessinerBarre();
    dessinerNote();
    if (mode === 'ecriture') refs.source?.focus();
  }

  async function choisirNote(id) {
    await envoyer(); // ce qui traîne appartient à la note qu'on quitte
    noteCourante = id;
    mode = 'lecture';
    fermerSuggestions();
    dessiner();
  }

  async function creerChapitre() {
    try {
      const reponse = await Api.creerChapitre({ titre: 'Nouveau chapitre' });
      donnees.chapitres.push(reponse.chapitre);
      dessinerSommaire();
      contexte.surEcriture?.();
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function creerNote(chapitre) {
    await envoyer();
    try {
      const reponse = await Api.creerNote({ titre: 'Nouvelle note', chapitre });
      donnees.notes.push(reponse.note);
      noteCourante = reponse.note.id;
      mode = 'ecriture';
      dessiner();
      refs.source?.focus();
      contexte.surEcriture?.();
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimerChapitre(chapitre, combien) {
    const message = combien
      ? `Retirer « ${chapitre.titre || chapitre.id} » ? Ses ${combien} note${
          combien > 1 ? 's' : ''
        } ne sont pas supprimées : elles passent hors chapitre.`
      : `Retirer « ${chapitre.titre || chapitre.id} » ?`;
    if (!confirm(message)) return;
    try {
      await Api.supprimerChapitre(chapitre.id);
      donnees.chapitres = donnees.chapitres.filter((entree) => entree.id !== chapitre.id);
      for (const entree of donnees.notes) {
        if (entree.chapitre === chapitre.id) entree.chapitre = '';
      }
      dessiner();
      contexte.surEcriture?.();
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  async function supprimerNote(courante) {
    if (!confirm(`Supprimer « ${titreDe(courante)} » ? Le texte est perdu.`)) return;
    clearTimeout(minuterie);
    aEnvoyer = null;
    try {
      await Api.supprimerNote(courante.id);
      donnees.notes = donnees.notes.filter((entree) => entree.id !== courante.id);
      noteCourante = donnees.notes[0]?.id ?? null;
      dessiner();
      contexte.surEcriture?.();
    } catch (erreur) {
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  /* ----------------------------------------------------------------- ancre */

  /**
   * Ouvre le carnet **à l'endroit exact** où une fiche est citée.
   *
   * `rang` est le numéro de l'apparition dans la note, tel que l'index inverse
   * du serveur le compte ; `markdown.js` numérote pareil sur les pastilles.
   * Si le carnet n'a pas encore ses données, la demande attend le chargement
   * plutôt que d'être perdue.
   */
  function ouvrirSur(noteId, { genre = 'p', id = '', rang = 1 } = {}) {
    ancreEnAttente = { noteId, genre, id, rang };
    if (!donnees.notes.length) {
      charger();
      return;
    }
    honorerAncre();
  }

  function honorerAncre() {
    if (!ancreEnAttente) return;
    const { noteId, genre, id, rang } = ancreEnAttente;
    if (!donnees.notes.some((entree) => entree.id === noteId)) {
      ancreEnAttente = null;
      return;
    }
    ancreEnAttente = null;

    noteCourante = noteId;
    mode = 'lecture'; // une citation se lit ; on ne jette pas quelqu'un dans la source
    dessiner();

    const cible = refs.rendu?.querySelector(
      `.balise[data-genre="${genre}"][data-id="${CSS.escape(id)}"][data-rang="${rang}"]`
    );
    if (!cible) return;
    cible.scrollIntoView({ block: 'center', behavior: 'smooth' });
    cible.classList.add('balise-visee');
    setTimeout(() => cible.classList.remove('balise-visee'), 2200);
  }

  /* ---------------------------------------------------------------- montage */

  return {
    element: racine,
    charger,
    appliquer,
    ouvrirSur,
    noteCourante: () => noteCourante,
    /** Le carnet change de place : on redessine, l'en-tête n'a plus les mêmes boutons. */
    replacer(large) {
      racine.classList.toggle('carnet-large', !!large);
      // En grand, le sommaire est une colonne permanente : le repli du volet
      // n'a plus de sens et ne doit pas rester coincé sur son dernier état.
      if (large) sommaireOuvert = false;
      dessiner();
    },
    async detruire() {
      await envoyer();
      clearTimeout(minuterie);
      racine.remove();
    },
    /** Pousse tout de suite ce qui attend (changement de sauvegarde, fermeture). */
    vider: () => envoyer(),
  };
}
