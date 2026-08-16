/* Le plan collectif — piloter une table depuis son sociogramme.
 *
 * **Ce que cette page remplace.** L'administration disait déjà tout d'une table
 * en tableaux : combien de fiches, quelles maisons en commun, quels doublons.
 * Elle ne montrait jamais **la table**. Ici, les mondes des membres sont
 * superposés en un seul plan, et tout se fait dessus : un clic droit dans le
 * vide crée un profil chez tout le monde, un clic droit sur un lien le modifie
 * partout.
 *
 * **Le moteur de dessin n'a pas bougé d'une ligne.** C'est `views/cartes.js`,
 * celui de l'application, nourri d'un payload `{noeuds, aretes}` fabriqué par
 * `src/admin/collectif.ts`. Un nœud n'y est pas une fiche mais une **grappe** —
 * l'identité reconstituée d'une personne à travers les comptes.
 *
 * **Deux filtres, et il faut les distinguer.**
 *
 * - *Superposer* — quels comptes sont lus. Changer cela relit les arbres :
 *   c'est une requête, et le rapprochement se refait.
 * - *Montrer* — ce qu'on affiche parmi ce qui est déjà chargé. C'est
 *   instantané, et c'est ce qu'on manipule pendant qu'on regarde.
 *
 * Les confondre obligerait à relire six arbres pour masquer une couleur.
 *
 * **Rien ne s'écrit d'ici sans aperçu.** Tous les gestes passent par
 * `collectif-gestes.js`, donc par les lots, donc par « aperçu puis appliquer ».
 */

import { creerRenduCartes } from './views/cartes.js';
import { creerMenu } from './menu.js';
import { h } from './dom.js';
import { appeler } from './identite.js';
import { installerLangue } from './langue.js';
import { creerGestes } from './collectif-gestes.js';

installerLangue();

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------- état */

let contexte = { souverain: false, compte: null };
/** Tous les comptes du périmètre, tels que l'API les rend. */
let comptes = [];
/** Ceux qui sont superposés sur le plan — ceux qu'on lit. */
let superposes = new Set();
/** Ceux dont on montre l'apport. Sous-ensemble de `superposes`. */
let montres = new Set();
/**
 * Ce que chaque membre a comme arbres, et lequel le plan prendrait (lot 17.G).
 *
 * Le rail se construit **là-dessus** et non sur `plan.comptes` : un membre dont
 * aucun arbre n'a été travaillé n'entre pas dans le plan, et doit pourtant
 * rester visible — sans quoi il disparaîtrait de la table sans explication.
 */
let membres = [];
/** Le choix explicite, compte → sauvegarde. Vide = on suit le défaut. */
const arbres = new Map();
/** Qui était dans le plan au chargement précédent — voir `charger`. */
let presentsPrecedents = new Set();
/** Le dernier plan reçu. */
let plan = null;
let seuil = 0.82;
let couleurPar = 'presence';
let montrer = 'tout';
const typesMasques = new Set();
const maisonsMasquees = new Set();
/** La carte ouverte dans le panneau de droite, s'il y en a une. */
let choisi = null;

const moteur = creerRenduCartes($('scene'), {
  surSelection: (id) => ouvrirFiche(id),
  surFond: () => ouvrirResume(),
  surClicLien: (liens) => ouvrirLien(liens[0]),
  surMenuFond: (evenement) => menuFond(evenement),
  surMenuCarte: (id, evenement) => menuCarte(id, evenement),
  surMenuLien: (liens, evenement) => menuLien(liens[0], evenement),
  surLiaison: ({ source, cible }, evenement) => poserLien(source, cible, evenement),
});

const menu = creerMenu();
const gestes = creerGestes({ surFait: () => charger({ silencieux: true }) });

/* ------------------------------------------------------------- présence */

/**
 * La couleur d'une carte selon le nombre de membres qui l'ont.
 *
 * Vert quand tout le monde l'a, rouge quand une seule personne l'a écrite. Ce
 * n'est pas décoratif : c'est la seule information qu'un plan individuel ne
 * pouvait pas donner, et c'est celle qu'on vient chercher ici. On passe par
 * `couleurPar: 'filtre:…'`, le crochet que le moteur offre déjà aux filtres sur
 * mesure — aucun mode nouveau à lui apprendre.
 */
function couleurPresence(combien, total) {
  if (total <= 1) return '#4f9d69';
  const part = (combien - 1) / (total - 1);
  const de = [192, 86, 63];
  const vers = [79, 157, 105];
  const melange = de.map((valeur, rang) => Math.round(valeur + (vers[rang] - valeur) * part));
  return `rgb(${melange.join(',')})`;
}

/* ------------------------------------------------------------ chargement */

/** Ce que le serveur doit savoir de la sélection : qui, et quel arbre. */
function selection() {
  const choisis = {};
  for (const [compte, arbre] of arbres) {
    if (superposes.has(compte)) choisis[compte] = arbre;
  }
  return { comptes: [...superposes], arbres: choisis, seuil };
}

/** Quel arbre le plan prendra chez ce membre — choix explicite, ou défaut. */
function arbreDe(compteId) {
  const membre = membres.find((candidat) => candidat.compte_id === compteId);
  if (!membre) return null;
  const vise = arbres.get(compteId) ?? membre.retenu;
  return membre.arbres.find((arbre) => arbre.id === vise) ?? null;
}

/**
 * Deux requêtes, et il faut les deux.
 *
 * La liste des arbres est **bon marché** (pas de documents) et sert à dessiner
 * le rail — y compris pour les membres qui n'entreront pas dans le plan. Le
 * plan, lui, charge les documents des seuls arbres retenus.
 */
async function charger({ silencieux = false } = {}) {
  if (!superposes.size) {
    $('scene-message').hidden = false;
    $('scene-message').textContent = 'Aucun membre superposé. Choisissez qui regarder.';
    return;
  }
  if (!silencieux) {
    $('scene-message').hidden = false;
    $('scene-message').textContent = 'Lecture des arbres…';
  }
  $('fil-etat').textContent = 'Lecture…';

  const liste = await appeler('/api/admin/collectif/arbres', {
    method: 'POST',
    body: JSON.stringify({ comptes: [...superposes] }),
  });
  if (liste.ok) membres = liste.donnees.membres;

  const { ok, code, donnees } = await appeler('/api/admin/collectif/plan', {
    method: 'POST',
    body: JSON.stringify(selection()),
  });
  if (!ok) {
    if (code === 401) {
      location.replace('/connexion.html?retour=%2Fcollectif.html');
      return;
    }
    plan = null;
    // Le rail reste dessiné même sans plan : c'est de là qu'on choisit un
    // arbre, donc c'est de là qu'on se sort d'un « rien à superposer ».
    dessinerRail();
    $('scene-message').hidden = false;
    $('scene-message').textContent =
      (donnees?.erreur || `Erreur ${code}`) + (donnees?.indice ? ` ${donnees.indice}` : '');
    $('fil-etat').textContent = 'Erreur';
    return;
  }

  plan = donnees;
  // Trois règles, dans cet ordre : un membre qui n'est plus dans le plan sort de
  // « montrer » (sa case pointerait vers un apport qui n'existe pas) ; un membre
  // qui **vient d'y entrer** y entre coché — sinon lui choisir un arbre le
  // ferait apparaître sans rien montrer, ce qui ressemble à une panne ; et un
  // décochage délibéré est respecté.
  const presents = new Set(plan.comptes.map((compte) => compte.id));
  const nouveaux = [...presents].filter((id) => !presentsPrecedents.has(id));
  montres = new Set([...montres].filter((id) => presents.has(id)));
  for (const id of nouveaux) montres.add(id);
  if (!montres.size) montres = new Set(presents);
  presentsPrecedents = presents;

  $('scene-message').hidden = true;
  dessinerRail();
  rendre();
  ouvrirResume();
}

/** Au premier chargement, tout le monde est montré. */
function toutMontrer() {
  montres = new Set(plan ? plan.comptes.map((compte) => compte.id) : [...superposes]);
}

/* -------------------------------------------------------------- filtrage */

/**
 * Le payload réellement dessiné.
 *
 * On filtre **avant** le moteur plutôt que de lui apprendre à masquer par
 * membre : un lien n'appartient pas à un type qu'on éteint, il appartient à des
 * gens. Refiltrer le payload coûte une mise en page (quelques millisecondes sur
 * soixante-dix cartes) et ne touche pas au moteur.
 */
function payloadAffiche() {
  if (!plan) return { noeuds: [], aretes: [] };
  const total = plan.comptes.length;

  const visible = (porteurs) => porteurs.some((id) => montres.has(id));
  const retenu = (porteurs) => {
    if (!visible(porteurs)) return false;
    if (montrer === 'commun') return porteurs.length === total;
    if (montrer === 'divergent') return porteurs.length < total;
    return true;
  };

  let noeuds = plan.noeuds.filter((noeud) => retenu(noeud.comptes));

  // « Ce que la table a créé » : on retire le monde livré — soixante-sept
  // fiches que tout le monde a déjà et que personne n'a décidées — **mais on
  // garde celles auxquelles une fiche neuve est accrochée**. Sans ce halo,
  // « Alys Karstark, amie d'Eddard Stark » perdrait Eddard, donc son lien, donc
  // tout ce qu'elle avait d'intéressant.
  if (montrer === 'cree') {
    const neufs = new Set(noeuds.filter((noeud) => !noeud.du_depart).map((noeud) => noeud.id));
    const voisins = new Set(neufs);
    for (const arete of plan.aretes) {
      if (neufs.has(arete.source)) voisins.add(arete.cible);
      if (neufs.has(arete.cible)) voisins.add(arete.source);
    }
    noeuds = noeuds.filter((noeud) => voisins.has(noeud.id));
  }

  const gardes = new Set(noeuds.map((noeud) => noeud.id));
  const aretes = plan.aretes.filter(
    (arete) => retenu(arete.comptes) && gardes.has(arete.source) && gardes.has(arete.cible)
  );
  return { ...plan, noeuds, aretes };
}

function rendre() {
  if (!plan) return;
  const total = plan.comptes.length;
  const couleursNoeuds = {};
  for (const noeud of plan.noeuds) {
    couleursNoeuds[noeud.id] = couleurPresence(noeud.comptes.length, total);
  }

  moteur.rendre(payloadAffiche(), {
    couleurPar: couleurPar === 'presence' ? 'filtre:presence' : couleurPar,
    couleursNoeuds,
    typesMasques,
    maisonsMasquees,
  });
  marquerDivergences();
  majStats();
}

/**
 * Les cartes que les membres n'écrivent pas pareil portent une marque.
 *
 * Le moteur ne connaît pas la notion : il pose seulement `data-id` sur chaque
 * carte, ce qui suffit à repasser derrière lui. C'est refait à chaque dessin,
 * parce que les cartes sont recyclées d'un rendu à l'autre.
 */
function marquerDivergences() {
  if (!plan) return;
  const parId = new Map(plan.noeuds.map((noeud) => [noeud.id, noeud]));
  for (const carte of $('scene').querySelectorAll('.carte[data-id]')) {
    const noeud = parId.get(carte.dataset.id);
    carte.classList.toggle('desaccord', Boolean(noeud && !noeud.accord));
    carte.classList.toggle(
      'partielle',
      Boolean(noeud && noeud.comptes.length < plan.comptes.length)
    );
  }
}

function majStats() {
  if (!plan) return;
  const affiche = payloadAffiche();
  $('releve-plan').textContent =
    `${affiche.noeuds.length} carte(s) sur ${plan.noeuds.length}, ` +
    `${affiche.aretes.length} lien(s) sur ${plan.aretes.length}. ` +
    `${plan.stats.partout} personne(s) chez tout le monde, ${plan.stats.divergentes} écrite(s) différemment.`;
  // « membre(s) » plutôt qu'un `s` conditionnel : le dictionnaire du lot 16.G
  // remplit les motifs par position, et un `s` qui va bien à « membre » va mal
  // à l'adjectif anglais — « overlaids » n'existe pas.
  $('fil-etat').textContent =
    `${plan.comptes.length} membre(s) superposé(s) · ` +
    `${plan.stats.ecritures} fiches ramenées à ${plan.noeuds.length}`;
  // Deux phrases entières, et non une phrase plus un suffixe : un motif est
  // ancré sur sa fin, et « … à trancher » ne reconnaît pas « … à trancher. ».
  $('resume-rapprochement').textContent = plan.rapprochement.releve.tronque
    ? `${plan.rapprochement.candidats.length} paire(s) à trancher — relevé tronqué, trop de noms à comparer.`
    : `${plan.rapprochement.candidats.length} paire(s) à trancher.`;
}

/* ------------------------------------------------------------------ rail */

/**
 * Le rail des membres, construit sur la **liste des arbres** et non sur le plan.
 *
 * Un membre dont aucun arbre n'a été travaillé n'entre pas dans le plan, et
 * doit pourtant figurer ici : c'est de cette ligne-là qu'on lui choisit un
 * arbre à la main. Le construire sur `plan.comptes` le ferait disparaître au
 * moment précis où l'on a besoin de lui.
 */
function dessinerRail() {
  const couleurs = new Map((plan?.comptes ?? []).map((compte) => [compte.id, compte.couleur]));

  $('liste-membres').replaceChildren(
    ...membres.map((membre) => {
      const dansLePlan = couleurs.has(membre.compte_id);
      const arbre = arbreDe(membre.compte_id);

      const case_ = h('input', {
        type: 'checkbox',
        checked: montres.has(membre.compte_id),
        disabled: !dansLePlan,
        title: `Montrer ce que ${membre.compte} a`,
        onchange: () => {
          if (case_.checked) montres.add(membre.compte_id);
          else montres.delete(membre.compte_id);
          rendre();
        },
      });

      // Les classes assemblées, sans ternaire : le releveur de textes lit les
      // branches d'un ternaire comme de l'affichable, et rapportait
      // « membre membre-absent » comme une chaîne à traduire.
      const classes = ['membre'];
      if (!dansLePlan) classes.push('membre-absent');

      return h('li', { class: classes.join(' ') }, [
        case_,
        h('span', {
          class: 'membre-pastille',
          style: { background: couleurs.get(membre.compte_id) || 'transparent' },
        }),
        h('div', { class: 'membre-qui' }, [
          h('button', {
            class: 'membre-nom',
            type: 'button',
            texte: membre.compte,
            title: `N’afficher que ce que ${membre.compte} a`,
            onclick: () => {
              if (!dansLePlan) return;
              montres = new Set([membre.compte_id]);
              dessinerRail();
              rendre();
            },
          }),
          // L'arbre regardé, toujours dit, et toujours changeable. Sans cette
          // ligne, un plan pourrait montrer une autre campagne que celle qu'on
          // croit lire, et un geste y écrirait.
          h('button', {
            class: 'membre-arbre',
            type: 'button',
            texte: arbre ? arbre.nom : 'aucun arbre travaillé',
            title: arbre
              ? `${arbre.personnes} fiches, ${arbre.relations} liens — changer d’arbre`
              : 'Ses mondes n’ont jamais été modifiés — en choisir un quand même',
            onclick: (evenement) => choisirArbre(membre, evenement),
          }),
        ]),
        h('span', {
          class: 'membre-compte',
          texte: arbre ? `${arbre.personnes}` : '—',
          title: arbre ? `${arbre.personnes} fiches, ${arbre.relations} liens` : '',
        }),
      ]);
    })
  );

  if (!plan) return;

  $('types-collectif').replaceChildren(
    ...plan.legende.types.map((type) =>
      h(
        'li',
        {
          class: typesMasques.has(type.id) ? 'eteint' : '',
          onclick: () => {
            if (typesMasques.has(type.id)) typesMasques.delete(type.id);
            else typesMasques.add(type.id);
            dessinerRail();
            rendre();
          },
        },
        [
          h('span', {
            class: 'legende-trait',
            style: { borderTopColor: type.couleur },
          }),
          h('span', { texte: type.label }),
          h('span', { class: 'nombre', texte: type.nombre }),
        ]
      )
    )
  );

  $('maisons-collectif').replaceChildren(
    ...plan.legende.maisons.map((maison) =>
      h(
        'li',
        {
          class: maisonsMasquees.has(maison.id) ? 'eteint' : '',
          onclick: () => {
            if (maisonsMasquees.has(maison.id)) maisonsMasquees.delete(maison.id);
            else maisonsMasquees.add(maison.id);
            dessinerRail();
            rendre();
          },
        },
        [
          h('span', { class: 'legende-pastille', style: { background: maison.couleur } }),
          h('span', { texte: maison.label }),
          h('span', { class: 'nombre', texte: maison.nombre }),
        ]
      )
    )
  );
}

/* --------------------------------------------------------------- panneau */

function ouvrirResume() {
  choisi = null;
  $('panneau-titre').textContent = 'Le plan collectif';
  if (!plan) {
    $('panneau-corps').replaceChildren();
    return;
  }

  // Des phrases entières, jamais coupées par du gras : le dictionnaire traduit
  // des nœuds de texte, et une phrase en trois morceaux ressort en trois
  // langues mélangées — vu à l'essai, « 459 profiles écrites par 12 membre(s) ».
  $('panneau-corps').replaceChildren(
    h('p', {
      class: 'pn-aide',
      texte:
        `${plan.stats.ecritures} fiches écrites par ${plan.comptes.length} membre(s) ` +
        `se ramènent à ${plan.noeuds.length} personne(s).`,
    }),
    h('p', {
      class: 'pn-aide',
      texte: `${plan.stats.partout} sont chez tout le monde.`,
    }),
    h('p', {
      class: 'pn-aide',
      texte: 'Cliquez une carte pour voir qui l’a, et poser un geste chez ceux qui ne l’ont pas.',
    }),
    ...(plan.rapprochement.candidats.length
      ? [
          h('h3', { class: 'pn-sous-titre', texte: 'À trancher' }),
          h('p', {
            class: 'pn-aide',
            texte:
              'Ces fiches se ressemblent sans avoir été réunies. Deux écritures d’une même ' +
              'personne, ou deux personnes qui portent le même nom : seul vous pouvez le dire.',
          }),
          ...plan.rapprochement.candidats.slice(0, 30).map(carteCandidat),
        ]
      : [])
  );
}

function carteCandidat(candidat) {
  return h('div', { class: 'pn-candidat' }, [
    h('div', { class: 'pn-candidat-noms' }, [
      h('span', { texte: candidat.gauche.label }),
      h('span', { class: 'pn-score', texte: score(candidat.score) }),
      h('span', { texte: candidat.droite.label }),
    ]),
    h('div', {
      class: 'pn-candidat-qui',
      texte: candidat.meme_compte
        ? `Deux fiches de ${candidat.gauche.compte} — elles ne se rejoindront pas d’elles-mêmes.`
        : `${candidat.gauche.compte} · ${candidat.droite.compte}`,
    }),
    candidat.verdict &&
      h('div', {
        class: 'pn-candidat-verdict',
        texte:
          candidat.verdict === 'distincte'
            ? 'Vous avez dit : ce ne sont pas les mêmes.'
            : 'Vous avez dit : c’est la même.',
      }),
    h('div', { class: 'pn-candidat-actions' }, [
      h('button', {
        class: 'bouton bouton-plat',
        type: 'button',
        texte: 'C’est la même',
        onclick: () => trancher(candidat, 'meme'),
      }),
      h('button', {
        class: 'bouton bouton-plat',
        type: 'button',
        texte: 'Ce sont deux personnes',
        onclick: () => trancher(candidat, 'distincte'),
      }),
      candidat.verdict &&
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: 'Oublier',
          title: 'Rendre cette paire au calcul automatique',
          onclick: () => trancher(candidat, 'oublier'),
        }),
    ]),
  ]);
}

const score = (valeur) => `${Math.round(valeur * 100)} %`;

/** Les identifiants distincts que porte une grappe. */
const identifiantsDe = (noeud) => [...new Set(noeud.ecritures.map((e) => e.personne_id))];

async function trancher(candidat, verdict) {
  const { ok, donnees } = await appeler('/api/admin/collectif/identites', {
    method: 'POST',
    body: JSON.stringify({
      gauche: `${candidat.gauche.compte_id}/${candidat.gauche.personne_id}`,
      droite: `${candidat.droite.compte_id}/${candidat.droite.personne_id}`,
      verdict,
    }),
  });
  if (!ok) {
    $('fil-etat').textContent = donnees?.erreur || 'Erreur';
    return;
  }
  // Un verdict change les grappes, donc le plan : on relit. C'est le seul geste
  // de cette page qui n'écrit rien chez personne et redessine quand même tout.
  await charger({ silencieux: true });
}

/**
 * Sur écran étroit, le panneau est un tiroir fermé : cliquer une carte pour
 * savoir qui l'a n'afficherait rien. On l'ouvre, puisque c'est ce qu'on demande.
 */
function montrerLePanneau() {
  if (window.matchMedia('(max-width: 860px)').matches) $('panneau').classList.add('ouvert');
}

function ouvrirFiche(id) {
  const noeud = plan?.noeuds.find((candidat) => candidat.id === id);
  if (!noeud) return;
  choisi = noeud;
  montrerLePanneau();
  $('panneau-titre').textContent = noeud.label;

  const absents = plan.comptes.filter((compte) => noeud.absents.includes(compte.id));
  $('panneau-corps').replaceChildren(
    h('p', {
      class: 'pn-aide',
      texte: `${noeud.comptes.length} membre(s) sur ${plan.comptes.length} ont cette personne.`,
    }),
    h(
      'ul',
      { class: 'pn-porteurs' },
      noeud.ecritures.map((ecriture) =>
        h('li', {}, [
          h('span', { class: 'pn-porteur-qui', texte: ecriture.compte }),
          h('code', { texte: ecriture.personne_id }),
          ecriture.label !== noeud.label && h('span', { class: 'pn-autre', texte: ecriture.label }),
        ])
      )
    ),
    absents.length &&
      h('p', { class: 'pn-aide' }, [
        'Absente chez : ',
        h('b', { texte: absents.map((compte) => compte.compte).join(', ') }),
      ]),
    h('div', { class: 'pn-actions' }, [
      absents.length &&
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: `＋ Créer chez les ${absents.length} qui ne l’ont pas`,
          onclick: (evenement) => gesteProfil(noeud, absents.map((c) => c.id), evenement),
        }),
      h('button', {
        class: 'bouton',
        type: 'button',
        texte: '✎ Modifier chez tous',
        onclick: (evenement) => gesteProfil(noeud, [...montres], evenement),
      }),
      h('button', {
        class: 'bouton',
        type: 'button',
        texte: '⚯ Poser un lien depuis cette fiche',
        onclick: (evenement) => gesteLien(noeud.id, '', evenement),
      }),
      // Séparer n'a de sens que si la grappe tient **plusieurs identifiants** :
      // quatre membres qui ont tous `eddard-stark` ont la même fiche, et
      // « ce ne sont pas les mêmes » n'aurait rien à trancher.
      identifiantsDe(noeud).length > 1 &&
        h('button', {
          class: 'bouton',
          type: 'button',
          texte: '⚖ Séparer deux écritures…',
          title: 'Dire que deux de ces fiches ne sont pas la même personne',
          onclick: () => separer(noeud),
        }),
    ])
  );
}

function ouvrirLien(arete) {
  if (!arete) return;
  choisi = null;
  montrerLePanneau();
  const source = plan.noeuds.find((noeud) => noeud.id === arete.source);
  const cible = plan.noeuds.find((noeud) => noeud.id === arete.cible);
  $('panneau-titre').textContent = `${source?.label ?? arete.source} — ${cible?.label ?? arete.cible}`;

  const absents = plan.comptes.filter((compte) => arete.absents.includes(compte.id));
  $('panneau-corps').replaceChildren(
    h('p', { class: 'pn-aide' }, [h('b', { texte: arete.type_label })]),
    h('p', {
      class: 'pn-aide',
      texte: `Chez ${arete.comptes.length} membre(s) sur ${plan.comptes.length}.`,
    }),
    h(
      'ul',
      { class: 'pn-porteurs' },
      arete.ecritures.map((ecriture) => {
        const compte = plan.comptes.find((candidat) => candidat.id === ecriture.compte_id);
        return h('li', {}, [
          h('span', { class: 'pn-porteur-qui', texte: compte?.compte ?? ecriture.compte_id }),
          ecriture.label && h('span', { class: 'pn-autre', texte: ecriture.label }),
          ecriture.revolu && h('span', { class: 'pn-autre', texte: 'révolu' }),
        ]);
      })
    ),
    absents.length &&
      h('p', { class: 'pn-aide' }, [
        'Ce lien manque chez : ',
        h('b', { texte: absents.map((compte) => compte.compte).join(', ') }),
      ]),
    h('div', { class: 'pn-actions' }, [
      absents.length &&
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: `⚯ Poser chez les ${absents.length} qui ne l’ont pas`,
          onclick: (evenement) =>
            gesteLien(arete.source, arete.cible, evenement, {
              type: arete.type,
              comptes: absents.map((compte) => compte.id),
            }),
        }),
      h('button', {
        class: 'bouton',
        type: 'button',
        texte: '✎ Modifier ce lien chez tous',
        onclick: (evenement) =>
          gesteLien(arete.source, arete.cible, evenement, { type: arete.type, arete }),
      }),
    ])
  );
}

/* ---------------------------------------------------------------- gestes */

const REFERENCE = (cle) => `grappe:${cle}`;

/** Les membres qu'un geste touche par défaut : ceux qu'on regarde. */
const visesParDefaut = () => [...montres];

function gesteProfil(noeud, cibles, evenement) {
  const creation = !noeud;
  gestes.ouvrir(
    {
      titre: creation ? 'Nouveau profil' : `Modifier « ${noeud.label} »`,
      aide: creation
        ? 'La fiche sera créée dans l’arbre de chaque membre visé. Un membre qui l’a déjà la verra mise à jour, pas dupliquée.'
        : 'Les champs laissés vides ne sont pas envoyés : ils restent tels quels chez chacun.',
      comptes: cibles,
      arbres: selection().arbres,
      seuil,
      verbe: creation ? '＋ Créer' : 'Enregistrer',
      champs: [
        { nom: 'prenom', label: 'Prénom', requis: creation, valeur: premierMot(noeud?.label) },
        { nom: 'nom', label: 'Nom', valeur: resteDuNom(noeud?.label) },
        { nom: 'titre', label: 'Titre' },
        {
          nom: 'maison',
          label: 'Maison',
          type: 'liste',
          valeur: noeud?.maison ?? '',
          options: [{ id: '', label: '—' }, ...(plan.catalogues.maisons || [])],
        },
        {
          nom: 'statut',
          label: 'Statut',
          type: 'liste',
          valeur: noeud?.statut ?? '',
          options: [
            { id: '', label: '—' },
            { id: 'vivant', label: 'Vivant' },
            { id: 'mort', label: 'Mort' },
            { id: 'inconnu', label: 'Inconnu' },
          ],
        },
        { nom: 'notes', label: 'Notes', type: 'zone' },
      ],
      operation: (valeurs) => {
        const operation = { type: 'personne' };
        // Modifier : on vise la **grappe**, pour que chacun retrouve sa propre
        // fiche même s'il l'a nommée autrement. Créer : pas de grappe encore, le
        // serveur déduira l'identifiant du prénom et du nom, le même partout.
        if (noeud) operation.id = REFERENCE(noeud.id);
        for (const [cle, valeur] of Object.entries(valeurs)) {
          if (String(valeur).trim()) operation[cle] = String(valeur).trim();
        }
        return operation;
      },
    },
    evenement?.clientX ?? 240,
    evenement?.clientY ?? 160
  );
}

function gesteLien(sourceCle, cibleCle, evenement, { type = '', comptes = null, arete = null } = {}) {
  const nom = (cle) => plan.noeuds.find((noeud) => noeud.id === cle)?.label ?? cle;
  gestes.ouvrir(
    {
      titre: cibleCle ? `Lien ${nom(sourceCle)} → ${nom(cibleCle)}` : `Lien depuis ${nom(sourceCle)}`,
      aide:
        'Les deux fiches sont désignées par leur grappe : chaque arbre y retrouve la sienne, ' +
        'même si le joueur l’a renommée.',
      comptes: comptes ?? visesParDefaut(),
      arbres: selection().arbres,
      seuil,
      verbe: arete ? 'Enregistrer' : '⚯ Poser le lien',
      champs: [
        {
          nom: 'cible',
          label: 'Fiche d’arrivée',
          type: 'liste',
          requis: true,
          valeur: cibleCle,
          options: [
            { id: '', label: '—' },
            ...plan.noeuds
              .filter((noeud) => noeud.id !== sourceCle)
              .map((noeud) => ({ id: noeud.id, label: noeud.label }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          ],
        },
        {
          nom: 'type_lien',
          label: 'Type de lien',
          type: 'liste',
          requis: true,
          valeur: type,
          options: [{ id: '', label: '—' }, ...(plan.catalogues.types || [])],
        },
        { nom: 'label', label: 'Libellé', valeur: arete?.label ?? '' },
        { nom: 'emoji', label: 'Pastille', valeur: arete?.emoji ?? '' },
        { nom: 'notes', label: 'Notes', type: 'zone' },
        { nom: 'revolu', label: 'Lien révolu', type: 'bool', valeur: Boolean(arete?.revolu) },
      ],
      operation: (valeurs) => {
        const operation = {
          type: 'relation',
          source: REFERENCE(sourceCle),
          cible: REFERENCE(valeurs.cible),
          type_lien: valeurs.type_lien,
          revolu: Boolean(valeurs.revolu),
        };
        for (const cle of ['label', 'emoji', 'notes']) {
          if (String(valeurs[cle] ?? '').trim()) operation[cle] = String(valeurs[cle]).trim();
        }
        return operation;
      },
    },
    evenement?.clientX ?? 240,
    evenement?.clientY ?? 160
  );
}

function poserLien(sourceCle, cibleCle, evenement) {
  gesteLien(sourceCle, cibleCle, evenement);
}

const premierMot = (label) => (label ? String(label).split(' ')[0] : '');
const resteDuNom = (label) => (label ? String(label).split(' ').slice(1).join(' ') : '');

/**
 * Séparer deux écritures d'une grappe.
 *
 * C'est le geste inverse du rapprochement, et il n'écrit rien chez personne :
 * il dit seulement « ces deux fiches ne sont pas la même personne ». Sans lui,
 * un seuil bas réunirait pour toujours le Brandon Stark frère d'Eddard et son
 * petit-fils Bran, et aucun réglage ne les séparerait — ils portent le même nom.
 */
function separer(noeud) {
  const lignes = noeud.ecritures;
  const choix = prompt(
    `« ${noeud.label} » réunit ${lignes.length} écritures :\n\n` +
      lignes.map((ligne, rang) => `  ${rang + 1}. ${ligne.compte} — ${ligne.personne_id}`).join('\n') +
      '\n\nDeux numéros à séparer, par exemple « 1 2 » :'
  );
  if (!choix) return;
  const [a, b] = String(choix)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((valeur) => lignes[Number(valeur) - 1]);
  if (!a || !b || a === b) {
    $('fil-etat').textContent = 'Deux numéros différents sont attendus.';
    return;
  }
  trancher(
    {
      gauche: { compte_id: a.compte_id, personne_id: a.personne_id },
      droite: { compte_id: b.compte_id, personne_id: b.personne_id },
    },
    'distincte'
  );
}

/* --------------------------------------------------------- menus du plan */

function menuFond(evenement) {
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `Chez ${montres.size} membre(s) montré(s)` },
    {
      icone: '＋',
      label: 'Nouveau profil…',
      detail: 'chez tous',
      onclick: () => gesteProfil(null, visesParDefaut(), evenement),
    },
    { separateur: true },
    { icone: '⤢', label: 'Vue générale', onclick: () => moteur.recentrer() },
  ]);
}

function menuCarte(id, evenement) {
  const noeud = plan?.noeuds.find((candidat) => candidat.id === id);
  if (!noeud) return;
  const absents = noeud.absents.filter((compte) => montres.has(compte));

  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: noeud.label, couleur: noeud.couleur },
    {
      texte: `Chez ${noeud.comptes.length} membre(s) sur ${plan.comptes.length}${
        noeud.accord ? '' : ' — écritures différentes'
      }`,
    },
    {
      icone: '✎',
      label: 'Modifier chez tous…',
      onclick: () => gesteProfil(noeud, visesParDefaut(), evenement),
    },
    absents.length && {
      icone: '＋',
      label: `Créer chez les ${absents.length} qui ne l’ont pas…`,
      onclick: () => gesteProfil(noeud, absents, evenement),
    },
    {
      icone: '⚯',
      label: 'Poser un lien depuis ici…',
      onclick: () => gesteLien(noeud.id, '', evenement),
    },
    { separateur: true },
    { icone: '⊙', label: 'Isoler son réseau', onclick: () => moteur.focus(noeud.id) },
    { icone: '☰', label: 'Qui l’a, qui ne l’a pas', onclick: () => ouvrirFiche(noeud.id) },
  ].filter(Boolean));
}

function menuLien(arete, evenement) {
  if (!arete) return;
  const absents = arete.absents.filter((compte) => montres.has(compte));
  const nom = (cle) => plan.noeuds.find((noeud) => noeud.id === cle)?.label ?? cle;

  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `${nom(arete.source)} → ${nom(arete.cible)}`, couleur: arete.couleur },
    // « Type « … » — chez … » et non « … — chez … » : un motif de traduction qui
    // commence ET finit par une valeur ne s'ancre sur rien, et le dictionnaire
    // du lot 16.G le laisse alors en français. Le mot « Type » suffit à l'ancrer.
    { texte: `Type « ${arete.type_label} » — chez ${arete.comptes.length} sur ${plan.comptes.length}` },
    {
      icone: '✎',
      label: 'Modifier chez tous…',
      onclick: () => gesteLien(arete.source, arete.cible, evenement, { type: arete.type, arete }),
    },
    absents.length && {
      icone: '⚯',
      label: `Poser chez les ${absents.length} qui ne l’ont pas…`,
      onclick: () =>
        gesteLien(arete.source, arete.cible, evenement, { type: arete.type, comptes: absents }),
    },
    { separateur: true },
    { icone: '☰', label: 'Qui l’a, qui ne l’a pas', onclick: () => ouvrirLien(arete) },
  ].filter(Boolean));
}

/* ------------------------------------------------- choisir les superposés */

const DATE_COURTE = (secondes) =>
  secondes ? new Date(secondes * 1000).toISOString().slice(0, 10) : '—';

/**
 * Ce qu'on dit d'un arbre pour aider à choisir.
 *
 * L'ordre des cas est l'ordre d'importance : **« jamais modifié » l'emporte**,
 * parce que c'est la seule mention qui explique pourquoi le défaut l'écarte.
 * Un monde intact et ouvert reste avant tout un monde intact.
 */
function detailDArbre(arbre) {
  if (arbre.intacte) return `${arbre.personnes} fiches · jamais modifié`;
  if (arbre.active) return `${arbre.personnes} fiches · ouvert par son propriétaire`;
  return `${arbre.personnes} fiches · modifié le ${DATE_COURTE(arbre.modifie_le)}`;
}

/**
 * Quel arbre de ce membre le plan regarde.
 *
 * On montre **tous** ses arbres, y compris les mondes intacts, avec de quoi
 * juger : la taille, la date, et la mention « jamais modifié » qui explique
 * pourquoi le défaut les écarte. Les cacher reviendrait à décider à sa place ;
 * les proposer sans le dire reviendrait à remplir le plan de décor.
 */
function choisirArbre(membre, evenement) {
  const courant = arbreDe(membre.compte_id);
  const entrees = [
    { titre: membre.compte },
    { texte: 'Un seul arbre par membre sur le plan. Les gestes écriront dans celui-ci.' },
    ...membre.arbres.map((arbre) => ({
      icone: courant && arbre.id === courant.id ? '●' : '○',
      label: arbre.nom,
      // Une phrase entière par cas plutôt qu'une concaténation de morceaux :
      // « · jamais modifié » collé au bout d'un compte ne se traduit dans
      // aucune langue, et l'état est ce qui décide, pas la date.
      detail: detailDArbre(arbre),
      onclick: () => {
        arbres.set(membre.compte_id, arbre.id);
        charger();
      },
    })),
    membre.arbres.length > 1 &&
      arbres.has(membre.compte_id) && {
        separateur: true,
      },
    membre.arbres.length > 1 &&
      arbres.has(membre.compte_id) && {
        icone: '↺',
        label: 'Revenir au choix automatique',
        onclick: () => {
          arbres.delete(membre.compte_id);
          charger();
        },
      },
  ].filter(Boolean);

  menu.ouvrir(evenement.clientX, evenement.clientY, entrees);
}

function choisirMembres(evenement) {
  const entrees = [
    { titre: 'Superposer sur le plan' },
    { texte: 'Cocher relit les arbres. Douze comptes au plus.' },
    ...comptes.map((compte) => ({
      icone: superposes.has(compte.id) ? '☑' : '☐',
      label: compte.email || `essai ${compte.id.slice(0, 8)}`,
      detail: `${compte.personnes} fiches`,
      onclick: () => {
        if (superposes.has(compte.id)) superposes.delete(compte.id);
        else superposes.add(compte.id);
        toutMontrer();
        charger();
      },
    })),
  ];
  menu.ouvrir(evenement.clientX, evenement.clientY, entrees);
}

/* ------------------------------------------------------------- démarrage */

async function demarrer() {
  const { ok: connu, donnees: qui } = await appeler('/api/admin/contexte');
  if (!connu) {
    location.replace('/connexion.html?retour=%2Fcollectif.html');
    return;
  }
  contexte = qui;
  $('compte').textContent = contexte.compte?.email ?? '';
  // Deux phrases entières, et non une phrase coupée par du gras : le
  // dictionnaire traduit des nœuds de texte, et un fragment de phrase ne se
  // recolle bien dans aucune autre langue.
  $('bandeau').replaceChildren(
    h('b', { texte: contexte.souverain ? 'Vous écrivez chez les autres.' : 'Vous êtes intendant.' }),
    ' Chaque geste posé ici touche plusieurs arbres à la fois, après un aperçu, ' +
      'et chaque écriture est inscrite au journal.'
  );

  const { ok, donnees } = await appeler('/api/admin/utilisateurs');
  if (!ok) {
    $('scene-message').textContent = donnees?.erreur || 'Impossible de lire les comptes.';
    return;
  }
  comptes = donnees.utilisateurs.filter((compte) => compte.sauvegardes > 0);
  $('univers').textContent = `${comptes.length} à portée`;

  // Par défaut : tout le monde, dans la limite de ce qu'un plan sait montrer.
  superposes = new Set(comptes.slice(0, 12).map((compte) => compte.id));
  toutMontrer();
  await charger();
}

/* --------------------------------------------------------------- câblage */

$('selecteur-couleur').addEventListener('change', (evenement) => {
  couleurPar = evenement.target.value;
  rendre();
});
$('selecteur-montrer').addEventListener('change', (evenement) => {
  montrer = evenement.target.value;
  rendre();
});
$('btn-recharger').addEventListener('click', () => charger());
$('btn-vue-generale').addEventListener('click', () => moteur.recentrer());
// Les deux classes d'un coup : `replie` est ce qui range le rail sur écran
// large, `ouvert` ce qui le fait glisser sous 760 px. Les poser ensemble évite
// de savoir de quel côté de la charnière on se trouve — et sous 760, `replie`
// est justement neutralisé par la feuille.
$('btn-rail').addEventListener('click', () => {
  $('rail').classList.toggle('replie');
  $('rail').classList.toggle('ouvert');
});
$('btn-panneau').addEventListener('click', () => $('panneau').classList.toggle('ouvert'));
$('btn-tout-montrer').addEventListener('click', () => {
  toutMontrer();
  dessinerRail();
  rendre();
});
$('btn-choisir-membres').addEventListener('click', (evenement) => choisirMembres(evenement));
$('btn-candidats').addEventListener('click', () => ouvrirResume());

$('seuil').addEventListener('input', (evenement) => {
  seuil = Number(evenement.target.value) / 100;
  $('seuil-valeur').textContent = seuil.toFixed(2).replace('.', ',');
});
// Au relâchement seulement : chaque cran relirait six arbres.
$('seuil').addEventListener('change', () => charger({ silencieux: true }));

$('btn-theme').addEventListener('click', () => {
  const sombre = document.body.classList.toggle('sombre');
  try {
    localStorage.setItem('familytree-theme', sombre ? 'sombre' : 'clair');
  } catch {
    /* navigation privée : le thème ne survivra pas, ce n'est pas grave */
  }
});
try {
  if (localStorage.getItem('familytree-theme') === 'sombre') document.body.classList.add('sombre');
} catch {
  /* idem */
}

document.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Escape' && !gestes.estOuvert() && !menu.estOuvert()) {
    moteur.recentrer();
    ouvrirResume();
  }
});

demarrer();
