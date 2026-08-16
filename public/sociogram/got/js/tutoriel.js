/**
 * La visite guidée — six écrans, deux minutes, sortable à tout moment.
 *
 * **Ce qu'elle doit faire.** Montrer en quelques gestes ce que l'outil sait
 * faire — créer une fiche, la relier, ranger par maison, changer d'axe — et
 * dire, dès le premier écran, que la démonstration ne se conserve pas. Les deux
 * vont ensemble : c'est justement parce que rien n'y est gardé qu'on peut
 * inviter quelqu'un à tout essayer sans prendre de précaution.
 *
 * **Trois choix qui expliquent le reste.**
 *
 * - **Elle se propose, elle ne s'impose pas.** Le premier écran offre
 *   « Commencer » ou « Plus tard », et les deux referment. On ne prend pas
 *   quelqu'un en otage pour lui expliquer un outil qu'il a peut-être déjà
 *   compris.
 * - **Elle montre, elle ne fait pas faire.** Aucune étape n'attend un geste
 *   précis pour continuer. Une visite qui bloque tant qu'on n'a pas cliqué au
 *   bon endroit est une visite dont on ne sort pas — et elle se casse à la
 *   première interface qui a bougé.
 * - **Elle vise des nœuds existants, et se rabat quand ils manquent.** Chaque
 *   étape nomme un élément de la page ; s'il est absent ou invisible (le rail
 *   replié, un bouton retiré depuis), la carte se centre et se passe de halo
 *   plutôt que d'éclairer un carré vide.
 *
 * Le halo est un `box-shadow` de 9999 px : un seul élément assombrit toute la
 * page et découpe le trou. Pas de calque à quatre morceaux à tenir d'accord
 * avec la position de la cible.
 */

import { surTelephone, derouler } from './telephone.js';

const DEJA_VU = 'familytree-tutoriel-vu';

/**
 * Ouvre le tiroir sur le bloc où vit la cible, quand l'écran est étroit.
 *
 * `derouler` et non `ouvrirLesFiltres` : celui-ci est une bascule, et trois
 * étapes d'affilée dans le tiroir se refermaient l'une l'autre.
 */
const dansLeTiroir = (idBloc) => () => {
  if (surTelephone()) derouler(idBloc);
};

/**
 * Une carte de personne posée sur le plan, et **visible**.
 *
 * Le plan est cadré et déplaçable : la première fiche du document peut être
 * hors de l'écran, où un halo ne montrerait rien. On prend donc la première qui
 * tombe dans la fenêtre, et à défaut la scène entière.
 */
function uneFicheVisible() {
  const fiches = document.querySelectorAll('#scene [data-id]');
  for (const fiche of fiches) {
    const cadre = fiche.getBoundingClientRect();
    if (!cadre.width || !cadre.height) continue;
    if (cadre.top >= 0 && cadre.left >= 0 && cadre.bottom <= window.innerHeight && cadre.right <= window.innerWidth) {
      return fiche;
    }
  }
  return document.getElementById('scene');
}

/**
 * Les étapes. Volontairement courtes : un titre, deux phrases, une cible.
 *
 * L'ordre suit celui d'une vraie première séance — on crée quelqu'un, on le
 * relie, puis seulement on s'occupe de ranger et de colorier. Le dernier écran
 * est le seul qui compte vraiment, et c'est pour ça qu'il est à la fin :
 * « ce que vous voulez garder ne se construit pas ici ».
 */
const ETAPES = [
  {
    titre: 'Bienvenue — vous êtes dans la démonstration',
    texte:
      'Ce monde est un exemple, le même pour tout le monde : soixante-sept personnages du Trône de Fer, leurs familles et leurs alliances. Vous pouvez tout y modifier, tout y casser — <b>rien de ce que vous y faites n’est conservé</b>. C’est fait pour ça.',
    cible: null,
  },
  {
    titre: 'Créer un profil',
    texte:
      'Ce bouton pose une fiche sur le plan, sans quitter la vue. Un clic droit dans le vide — ou un appui long au doigt — fait la même chose à l’endroit visé.',
    cible: '#btn-nouveau-profil',
  },
  {
    titre: 'Relier deux personnes',
    texte:
      'Clic droit sur une fiche (appui long au doigt) : <b>« Relier à… »</b>, puis un clic sur l’autre. À la souris, <b>Maj + clic</b> sur deux fiches va aussi vite. Chaque lien a un type, une couleur et une humeur — et peut être <i>révolu</i>, pour ce qui a compté puis cessé.',
    // Une fiche réellement à l'écran, pas `#scene` : le halo d'une cible qui
    // couvre tout l'écran n'assombrit plus rien et ne montre plus rien.
    cible: uneFicheVisible,
  },
  {
    titre: 'Ranger par maison',
    texte:
      'Le panneau de gauche liste les maisons : un clic en isole une, un clic droit la modifie. <b>＋ Nouvelle maison</b> en crée une — nom, couleur, devise.',
    cible: '#legende-maisons',
    avant: dansLeTiroir('bloc-maisons'),
  },
  {
    titre: 'Changer ce que la couleur raconte',
    texte:
      'Maison, catégorie, génération, humeur, ou un filtre à vous : ce sélecteur change l’axe de lecture de tout l’arbre. Choisissez <b>« Catégorie de maison »</b> et le même ＋ crée alors une catégorie — de quoi regrouper les maisons du Nord, les maisons vassales, ce que vous voulez.',
    // Au téléphone, ce sélecteur a déménagé dans « Réglages de l'affichage » :
    // c'est ce bloc-là qu'il faut dérouler, pas celui des filtres.
    cible: '#selecteur-couleur',
    avant: dansLeTiroir('bloc-telephone'),
  },
  {
    titre: 'Votre monde à vous',
    texte:
      'La démonstration repart à zéro à votre prochaine connexion. Ce que vous voulez garder se construit dans une sauvegarde à vous : <b>＋ Nouvelle</b> pour partir d’une page blanche, ou <b>⎘ En faire mon monde</b> pour emporter la démonstration telle qu’elle est.',
    cible: '#btn-nouvelle-sauvegarde',
    avant: dansLeTiroir('bloc-demonstration'),
  },
];

let socle = null;
let halo = null;
let carte = null;
let index = 0;
let surSortie = null;

/**
 * Le nœud d'une étape, s'il est bien là et bien visible.
 *
 * `cible` est un sélecteur ou une fonction — les fiches du plan n'ont pas
 * d'identifiant fixe, il faut aller les chercher. Le nœud est **amené à
 * l'écran** avant d'être mesuré : les blocs du rail vivent à plus de mille
 * pixels du haut, et une carte posée sous une cible qu'on ne voit pas se
 * retrouve hors de la fenêtre. C'était le cas de l'étape « Ranger par maison »,
 * à 1308 px du haut d'un écran qui en fait 800.
 */
function cibleDe(etape) {
  if (!etape.cible) return null;
  const noeud =
    typeof etape.cible === 'function' ? etape.cible() : document.querySelector(etape.cible);
  if (!noeud) return null;
  const cadre = noeud.getBoundingClientRect();
  if (!cadre.width || !cadre.height) return null;
  if (cadre.top < 0 || cadre.bottom > window.innerHeight) {
    noeud.scrollIntoView({ block: 'center' });
  }
  return noeud;
}

function construire() {
  socle = document.createElement('div');
  socle.className = 'tuto';

  halo = document.createElement('div');
  halo.className = 'tuto-halo';

  carte = document.createElement('div');
  carte.className = 'tuto-carte';

  socle.append(halo, carte);
  document.body.append(socle);

  // Échap sort : c'est le geste que tout le monde tente en premier devant un
  // calque qui recouvre la page.
  socle.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Escape') fermer();
  });
  // Un clic à côté sort aussi. Sur la carte, non — sinon chaque bouton
  // refermerait la visite avant d'avoir agi.
  socle.addEventListener('click', (evenement) => {
    if (evenement.target === socle || evenement.target === halo) fermer();
  });
}

function bouton(libelle, classe, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `bouton ${classe}`;
  element.textContent = libelle;
  element.addEventListener('click', action);
  return element;
}

function dessiner() {
  const etape = ETAPES[index];
  etape.avant?.();

  const noeud = cibleDe(etape);
  placerLeHalo(noeud);

  carte.replaceChildren();

  const compteur = document.createElement('div');
  compteur.className = 'tuto-compteur';
  compteur.textContent = `${index + 1} / ${ETAPES.length}`;

  const titre = document.createElement('h3');
  titre.className = 'tuto-titre';
  titre.textContent = etape.titre;

  const texte = document.createElement('p');
  texte.className = 'tuto-texte';
  // Le seul innerHTML du fichier, sur des chaînes écrites juste au-dessus :
  // aucune donnée d'utilisateur ne passe par là. Les `<b>` servent à ce que
  // l'œil trouve le mot qui compte sans lire les deux phrases.
  texte.innerHTML = etape.texte;

  const actions = document.createElement('div');
  actions.className = 'tuto-actions';
  const dernier = index === ETAPES.length - 1;
  const premier = index === 0;

  actions.append(
    bouton(premier ? 'Plus tard' : 'Fermer', 'bouton-plat tuto-passer', fermer)
  );
  if (!premier) actions.append(bouton('← Précédent', 'bouton-plat', () => aller(index - 1)));
  actions.append(
    bouton(
      premier ? 'Commencer' : dernier ? 'C’est parti' : 'Suivant →',
      'bouton-primaire',
      () => (dernier ? fermer() : aller(index + 1))
    )
  );

  carte.append(compteur, titre, texte, actions);
  placerLaCarte(noeud);
  carte.querySelector('.bouton-primaire')?.focus();
}

/**
 * Le halo, ou rien.
 *
 * Le trou est fait par une ombre immense : l'élément couvre la cible, et son
 * `box-shadow` assombrit tout le reste de l'écran. Sans cible, on retire
 * l'ombre du halo et on assombrit le socle — même effet, sans trou.
 */
function placerLeHalo(noeud) {
  const cadre = noeud?.getBoundingClientRect();
  // Un halo plus grand que l'écran n'assombrit plus rien et ne désigne plus
  // rien : mieux vaut le calque uni. Mesuré au téléphone sur le bloc des
  // maisons — 353 × 1020 dans une fenêtre de 375 × 812.
  const inutile =
    !cadre ||
    (cadre.width >= window.innerWidth * 0.92 && cadre.height >= window.innerHeight * 0.92);

  if (inutile) {
    halo.hidden = true;
    socle.classList.add('tuto-sans-cible');
    return;
  }
  socle.classList.remove('tuto-sans-cible');
  halo.hidden = false;
  const marge = 6;
  // Rogné sur la fenêtre : une cible plus haute que l'écran garde un halo qui
  // s'arrête au bord plutôt que de déborder de mille pixels.
  const haut = Math.max(0, cadre.top - marge);
  const gauche = Math.max(0, cadre.left - marge);
  halo.style.left = `${gauche}px`;
  halo.style.top = `${haut}px`;
  halo.style.width = `${Math.min(cadre.width + marge * 2, window.innerWidth - gauche)}px`;
  halo.style.height = `${Math.min(cadre.height + marge * 2, window.innerHeight - haut)}px`;
}

/**
 * La carte, à côté de la cible et jamais hors de l'écran.
 *
 * Sous la cible si la place le permet, au-dessus sinon, centrée en dernier
 * recours. Le calcul se refait à chaque étape parce que le rail peut s'être
 * ouvert entre-temps — c'est même le cas au téléphone, aux étapes 4 à 6.
 */
function placerLaCarte(noeud) {
  const large = carte.offsetWidth || 320;
  const haute = carte.offsetHeight || 200;
  const marge = 12;

  if (!noeud || surTelephone()) {
    // Au téléphone, la carte prend le bas de l'écran : elle y est stable d'une
    // étape à l'autre, et la cible reste visible au-dessus.
    carte.style.left = `${Math.max(marge, (window.innerWidth - large) / 2)}px`;
    carte.style.top = noeud
      ? `${window.innerHeight - haute - marge}px`
      : `${Math.max(marge, (window.innerHeight - haute) / 2)}px`;
    return;
  }

  const cadre = noeud.getBoundingClientRect();
  let haut = cadre.bottom + marge;
  // Sous la cible si ça tient, au-dessus sinon. Puis un rabotage **dans les
  // deux sens** : sans lui, une cible basse renvoyait la carte au-dessus, donc
  // encore plus loin, et personne ne la voyait.
  if (haut + haute > window.innerHeight - marge) haut = cadre.top - haute - marge;
  haut = Math.min(Math.max(marge, haut), Math.max(marge, window.innerHeight - haute - marge));
  const gauche = Math.min(
    Math.max(marge, cadre.left),
    Math.max(marge, window.innerWidth - large - marge)
  );

  carte.style.left = `${gauche}px`;
  carte.style.top = `${haut}px`;
}

function aller(vers) {
  index = Math.min(Math.max(0, vers), ETAPES.length - 1);
  dessiner();
}

function fermer() {
  // Vue une fois, proposée plus jamais : le `?` de la barre du haut reste, et
  // c'est à lui de la rappeler. Marqué même sur « Plus tard » — quelqu'un qui
  // décline ne veut pas qu'on lui redemande à chaque page.
  localStorage.setItem(DEJA_VU, '1');
  socle?.remove();
  socle = null;
  halo = null;
  carte = null;
  surSortie?.();
}

/**
 * Lance la visite depuis le début. Rejouable autant de fois qu'on veut.
 *
 * `isConnected` et non `socle` seul : un calque retiré du document sans passer
 * par `fermer` laisserait la variable pleine et la visite définitivement
 * inatteignable — c'est arrivé en vérification, et le bouton ne répondait plus.
 * Ce qui compte n'est pas d'avoir fabriqué un calque, c'est qu'il soit encore
 * dans la page.
 */
export function lancerLeTutoriel({ apres } = {}) {
  if (socle?.isConnected) return;
  socle?.remove();
  surSortie = apres || null;
  construire();
  index = 0;
  dessiner();
}

/** Vraie une seule fois par navigateur : à la toute première ouverture. */
export function tutorielJamaisVu() {
  return !localStorage.getItem(DEJA_VU);
}

// Le calque suit la page : sans ça, tourner le téléphone laisse le halo sur
// l'ancienne position de la cible — c'est-à-dire à côté.
window.addEventListener('resize', () => {
  if (socle) dessiner();
});
