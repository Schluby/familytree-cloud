/**
 * Le téléphone : ce que la barre du haut ne peut plus porter.
 *
 * **Le défaut qu'on répare.** Signalé le 13/08/2026 : « la partie vue de
 * l'arbre — les options d'ajouts, les catégories, maisons et liens — on ne les
 * voit pas sur téléphone ». Le rail existait pourtant, complet, et devenait
 * bien un tiroir sous 760 px. Mais la barre du haut réclamait **512 px de
 * commandes dans 375 px d'écran** : les quatre derniers boutons débordaient à
 * droite, et parmi eux le ☰ qui ouvre ce tiroir — 75 px hors de l'écran. Le
 * rail était donc là, entier, et rigoureusement inatteignable.
 *
 * **Le principe.** Sur téléphone, la barre du haut ne garde que ce qui sert à
 * *naviguer* : la marque, ☰ et 👤. Tout le reste — année, thème, couleur,
 * document, téléchargements, compte — **descend dans le rail**, en tête, dans
 * un bloc « Compte et réglages ». Ce sont des gestes rares ; le tiroir est
 * exactement l'endroit où ils doivent vivre.
 *
 * **Pourquoi du script et pas seulement du CSS.** Le CSS sait cacher, pas
 * déménager. Cacher aurait suffi à désencombrer la barre, mais aurait rendu ces
 * commandes introuvables — ce qui est le défaut qu'on répare, pas sa
 * correction. Dupliquer les boutons dans le rail aurait donné deux éléments
 * pour un même geste, deux identifiants, deux câblages à tenir d'accord. On
 * déplace donc les **mêmes** nœuds : les écouteurs les suivent, et il n'y a
 * jamais qu'une vérité par bouton.
 */

import { montrerBloc } from './rail.js';

const POINT_DE_RUPTURE = '(max-width: 760px)';

/** Sommes-nous sur un écran de téléphone, maintenant ? */
export function surTelephone() {
  return window.matchMedia(POINT_DE_RUPTURE).matches;
}

/**
 * Ce qui descend dans le rail, dans cet ordre.
 *
 * Ne descendent pas `#btn-rail`, `#btn-panneau` et `#btn-compte`, qui sont
 * justement ce qui ouvre les tiroirs.
 *
 * **`#groupe-essai` descend, depuis le 14/08/2026.** Il ne descendait pas :
 * « Créer un compte » est l'appel à l'action d'un visiteur, et l'enterrer sous
 * ☰ semblait le perdre. Mesuré sur 375 px, l'argument ne tenait pas — ses deux
 * boutons réclamaient **240 px des 375** de la barre, et la marque, comprimée,
 * tombait à **9 px** : plus d'épée, plus de nom d'univers. Trois boutons
 * disaient la même chose (celui du bandeau d'essai, plus ces deux-là) et
 * coûtaient à l'application son nom.
 *
 * L'invitation n'est pas perdue pour autant : le bandeau d'essai la dit en
 * toutes lettres, en permanence, et le 👤 de la barre ouvre le tiroir
 * exactement dessus. On la dit une fois en mots au lieu de trois fois en
 * boutons.
 *
 * **Ni « ⤓ Tout télécharger » ni « 📸 Instantané ».** Signalé le 13/08/2026 :
 * « retirer les choses inutiles type téléchargement sur téléphone ». Un `.zip`
 * de toutes ses sauvegardes sur un téléphone ne mène nulle part — et « Vos
 * données » (🛡), qui reste, est le vrai endroit pour sortir ses données. Ils ne
 * descendent donc pas : ils sont éteints par le CSS.
 */
/**
 * **Deux destinations depuis le 14/08/2026 (13.B).** Tout arrivait dans un seul
 * bloc « Compte et réglages » : l'adresse du compte y voisinait avec le choix
 * de couleur et l'année de campagne. Ce sont deux questions qu'on ne se pose
 * jamais en même temps — « qui suis-je, comment je sors » d'un côté, « comment
 * s'affiche l'arbre » de l'autre. Le 👤 de la barre ouvre le tiroir sur le
 * premier, et le second suit en dessous pour qui le cherche.
 */
const A_DESCENDRE = [
  {
    vers: 'accueil-compte',
    // « Créer un compte » et « Se connecter » en tête : pour un visiteur, c'est
    // la seule chose de ce bloc qui existe.
    quoi: ['#groupe-essai', '#compte', '#lien-admin', '#lien-donnees', '#btn-deconnexion'],
  },
  {
    vers: 'accueil-telephone',
    // `#btn-tutoriel` en dernier (lot 14.C) : une visite guidée ne se relance
    // pas dix fois par jour, et elle a un second accès — le bandeau de la
    // démonstration, qui est justement là où l'on est quand on en a besoin.
    quoi: [
      '#btn-vue-generale',
      '#selecteur-couleur',
      '#lien-document',
      '#lien-regles',
      '#btn-annee',
      '#btn-theme',
      '#btn-langue',
      // `#btn-raccourcis` descend comme le reste, mais il parle surtout d'un
      // clavier : au doigt, il ne reste que le clic droit et l'appui long. Il
      // vient donc en fin de bloc, avec la visite guidée.
      '#btn-raccourcis',
      '#btn-tutoriel',
    ],
  },
];

/** Tous les sélecteurs, dans l'ordre où ils descendent. */
const TOUT = A_DESCENDRE.flatMap((groupe) => groupe.quoi);

/** D'où chaque nœud vient, pour savoir le remettre. */
const places = new Map();

/**
 * Le nœud à déplacer : l'étiquette qui l'enveloppe, s'il y en a une.
 *
 * `#selecteur-couleur` vit dans un `<label class="champ champ-couleur">` qui
 * porte son intitulé. Déplacer le `select` seul laisserait « Couleur & filtre »
 * en haut et la liste en bas.
 */
function bloc(selecteur) {
  const noeud = document.querySelector(selecteur);
  return noeud?.closest('.champ') ?? noeud;
}

function descendre() {
  for (const groupe of A_DESCENDRE) {
    const accueil = document.getElementById(groupe.vers);
    for (const selecteur of groupe.quoi) {
      const noeud = bloc(selecteur);
      if (!noeud || noeud.parentNode === accueil) continue;
      if (!places.has(noeud)) {
        places.set(noeud, { parent: noeud.parentNode, suivant: noeud.nextSibling });
      }
      accueil.append(noeud);
    }
  }
  document.getElementById('bloc-compte').hidden = false;
  document.getElementById('bloc-telephone').hidden = false;
}

function remonter() {
  // À rebours : chaque nœud se repose devant celui qui le suivait, et ce
  // suivant doit donc être déjà revenu. Dans l'ordre direct, on insérerait
  // devant un nœud encore exilé — c'est-à-dire nulle part.
  for (const selecteur of [...TOUT].reverse()) {
    const noeud = bloc(selecteur);
    const place = noeud && places.get(noeud);
    if (!place) continue;
    place.parent.insertBefore(noeud, place.suivant);
  }
  document.getElementById('bloc-compte').hidden = true;
  document.getElementById('bloc-telephone').hidden = true;
}

/** Les deux tiroirs, retenus pour que les ouvertures d'ailleurs y accèdent. */
let volets = null;

/**
 * Amène le volet de droite, celui de la fiche.
 *
 * **Le défaut qu'on répare.** Signalé le 13/08/2026 : « la fiche s'affiche en
 * dehors de l'écran, on ne la voit pas ». Ouvrir une fiche ne faisait que
 * basculer l'onglet *à l'intérieur* du volet — ce qui suffit sur écran large,
 * où le volet est une colonne toujours visible. Sur téléphone, il est un tiroir
 * posé à `translateX(100%)` : la fiche s'y dessinait, fidèlement, à côté de
 * l'écran.
 */
export function amenerLaFiche() {
  if (!surTelephone() || !volets) return;
  volets.panneauVolet.classList.add('ouvert');
  volets.rail.classList.remove('ouvert');
}

/**
 * Ouvre le tiroir de gauche **déroulé sur un bloc précis** — ou le referme.
 *
 * **Bascule depuis le 14/08/2026 (13.A).** Le tiroir avait une barre collante
 * portant « Menu » et une croix : 341 × 61 px, sur 694 px de hauteur utile.
 * Signalée comme inutile, et elle l'était pour neuf dixièmes — mais la croix
 * était **la seule sortie**, le tiroir couvrant tout l'écran. On la remplace
 * par la règle qu'on essaie d'instinct : le bouton qui ouvre referme. Il en
 * reste deux, ⛨ et 👤, et tous deux restent sous le doigt tiroir ouvert (la
 * barre du haut n'est pas recouverte, la barre du bas est passée au-dessus).
 *
 * Le défilement se fait deux fois : tout de suite, et à l'image suivante. Ce
 * n'est pas une précaution superstitieuse. Le second passage existe parce que
 * les positions ne valent rien tant que le tiroir glisse encore ; le premier
 * existe parce que `requestAnimationFrame` **ne se déclenche pas dans un
 * document caché** — onglet en arrière-plan, écran éteint, application
 * revenue au premier plan. Constaté le 14/08/2026 : le bloc visé restait à
 * 3309 px du haut du tiroir, et le geste ne montrait rien.
 *
 * Un défilement de trop ne se voit pas. Un défilement manquant, si.
 */
/**
 * `bascule` : le geste d'un bouton, qui referme s'il rouvre le même bloc.
 *
 * La visite guidée (14.C) appelle la même fonction avec `false`, et pour une
 * raison qu'on a mesurée : ses étapes 4 à 6 vivent toutes dans le tiroir, et en
 * bascule l'étape 5 refermait ce que l'étape 4 venait d'ouvrir — le halo se
 * posait alors sur un bloc sorti de l'écran.
 */
function ouvrirLeRailSur(idBloc, bascule = true) {
  if (!volets) return;
  // Le rail a deux onglets depuis le lot 21.A, et trois blocs qui se replient :
  // ouvrir le tiroir sur un bloc rangé dans l'autre onglet, ou replié, ne
  // montrerait rien. `montrerBloc` remet tout d'aplomb avant qu'on défile.
  montrerBloc(idBloc);
  // Déjà ouvert **sur ce bloc-là** : le même geste referme. On compare le bloc
  // visé, pour que passer des filtres au compte n'exige pas de fermer d'abord.
  if (bascule && surTelephone() && volets.rail.classList.contains('ouvert') && volets.rail.dataset.sur === idBloc) {
    volets.rail.classList.remove('ouvert');
    delete volets.rail.dataset.sur;
    return;
  }
  volets.rail.classList.add('ouvert');
  volets.rail.classList.remove('replie');
  volets.rail.dataset.sur = idBloc;
  volets.panneauVolet.classList.remove('ouvert');
  const viser = () => document.getElementById(idBloc)?.scrollIntoView({ block: 'start' });
  viser();
  requestAnimationFrame(viser);
}

export function ouvrirLesFiltres() {
  ouvrirLeRailSur('bloc-maisons');
}

/** Ouvre le tiroir sur un bloc **sans jamais le refermer** (voir `bascule`). */
export function derouler(idBloc) {
  ouvrirLeRailSur(idBloc, false);
}

/**
 * Ouvre le rail **déroulé sur le compte** — ce que fait le 👤 de la barre.
 *
 * C'est la contrepartie de la disparition de « Créer un compte » et « Se
 * connecter » : le geste reste à un doigt de distance, il ne coûte simplement
 * plus la barre entière. Pour un visiteur d'essai, le bloc s'ouvre sur ces deux
 * boutons mêmes ; pour un compte, sur son adresse, ⚙, 🛡 et ⏻.
 */
export function ouvrirLeCompte() {
  ouvrirLeRailSur('bloc-compte');
}

export function installerTelephone(elements) {
  volets = elements;
  const requete = window.matchMedia(POINT_DE_RUPTURE);
  let etat = null;

  const appliquer = () => {
    const voulu = requete.matches ? 'telephone' : 'large';
    if (voulu === etat) return;
    etat = voulu;
    if (voulu === 'telephone') descendre();
    else remonter();
  };

  appliquer();
  // Deux sources pour un même signal, et ce n'est pas de la ceinture-bretelles.
  // Constaté le 13/08/2026 : le passage de 375 à 1280 px a bien rebasculé les
  // règles CSS, sans que `change` ne se déclenche — les commandes descendaient
  // dans le rail et n'en remontaient jamais. `resize` rattrape ; le garde sur
  // `etat` fait que la double écoute ne travaille jamais deux fois.
  requete.addEventListener('change', appliquer);
  window.addEventListener('resize', appliquer);

  const fermerLesTiroirs = () => {
    elements.rail.classList.remove('ouvert');
    delete elements.rail.dataset.sur;
    elements.panneauVolet.classList.remove('ouvert');
  };

  document.getElementById('btn-filtres').addEventListener('click', ouvrirLesFiltres);
  document.getElementById('btn-compte').addEventListener('click', ouvrirLeCompte);

  // Toucher la scène referme : c'est le geste qu'on tente d'instinct devant un
  // panneau qui recouvre ce qu'on voulait regarder. `capture` parce que la vue
  // arrête les événements de pointeur pour son propre compte, et qu'on veut
  // fermer le tiroir avant qu'elle ne s'en saisisse.
  elements.scene.addEventListener(
    'pointerdown',
    () => {
      if (!requete.matches) return;
      if (elements.rail.classList.contains('ouvert') || elements.panneauVolet.classList.contains('ouvert')) {
        fermerLesTiroirs();
      }
    },
    { capture: true }
  );
}
