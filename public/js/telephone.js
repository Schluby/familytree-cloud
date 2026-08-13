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

const POINT_DE_RUPTURE = '(max-width: 760px)';

/** Sommes-nous sur un écran de téléphone, maintenant ? */
export function surTelephone() {
  return window.matchMedia(POINT_DE_RUPTURE).matches;
}

/**
 * Ce qui descend dans le rail, dans cet ordre.
 *
 * Ne descendent pas : `#groupe-essai` (« Créer un compte » est l'appel à
 * l'action d'un visiteur — l'enterrer sous ☰ le perdrait), `#btn-rail` et
 * `#btn-panneau`, qui sont justement ce qui ouvre les tiroirs.
 *
 * **Ni « ⤓ Tout télécharger » ni « 📸 Instantané ».** Signalé le 13/08/2026 :
 * « retirer les choses inutiles type téléchargement sur téléphone ». Un `.zip`
 * de toutes ses sauvegardes sur un téléphone ne mène nulle part — et « Vos
 * données » (🛡), qui reste, est le vrai endroit pour sortir ses données. Ils ne
 * descendent donc pas : ils sont éteints par le CSS.
 */
const A_DESCENDRE = [
  '#btn-vue-generale',
  '#selecteur-couleur',
  '#lien-document',
  '#btn-annee',
  '#btn-theme',
  '#compte',
  '#lien-admin',
  '#lien-donnees',
  '#btn-deconnexion',
];

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
  const accueil = document.getElementById('accueil-telephone');
  for (const selecteur of A_DESCENDRE) {
    const noeud = bloc(selecteur);
    if (!noeud || noeud.parentNode === accueil) continue;
    if (!places.has(noeud)) {
      places.set(noeud, { parent: noeud.parentNode, suivant: noeud.nextSibling });
    }
    accueil.append(noeud);
  }
  document.getElementById('bloc-telephone').hidden = false;
}

function remonter() {
  // À rebours : chaque nœud se repose devant celui qui le suivait, et ce
  // suivant doit donc être déjà revenu. Dans l'ordre direct, on insérerait
  // devant un nœud encore exilé — c'est-à-dire nulle part.
  for (const selecteur of [...A_DESCENDRE].reverse()) {
    const noeud = bloc(selecteur);
    const place = noeud && places.get(noeud);
    if (!place) continue;
    place.parent.insertBefore(noeud, place.suivant);
  }
  document.getElementById('bloc-telephone').hidden = true;
}

/**
 * Câble la bascule, et les deux sorties du tiroir de gauche.
 *
 * Le volet de droite avait son ✕ depuis le lot 8 ; le rail n'en avait pas. Sur
 * un tiroir qui couvre tout l'écran, ne pas pouvoir sortir revient à ne pas
 * pouvoir entrer.
 */
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
 * Ouvre le rail **déroulé sur les filtres**.
 *
 * Les maisons et les types de liens sont ce qu'on vient régler le plus souvent,
 * et ils vivaient à six blocs du haut du tiroir. Le bouton « ⛨ Filtres » de la
 * barre du bas y mène directement.
 */
export function ouvrirLesFiltres() {
  if (!volets) return;
  volets.rail.classList.add('ouvert');
  volets.rail.classList.remove('replie');
  volets.panneauVolet.classList.remove('ouvert');
  // Après le rendu : tant que le tiroir glisse, ses positions ne valent rien.
  requestAnimationFrame(() => {
    document.getElementById('bloc-maisons')?.scrollIntoView({ block: 'start' });
  });
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
    elements.panneauVolet.classList.remove('ouvert');
  };

  document.getElementById('btn-fermer-rail').addEventListener('click', fermerLesTiroirs);
  document.getElementById('btn-filtres').addEventListener('click', ouvrirLesFiltres);

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
