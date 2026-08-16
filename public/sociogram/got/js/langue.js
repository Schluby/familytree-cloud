/* Français / English (lot 16.G).
 *
 * **Pourquoi la traduction se fait à l'affichage, et non dans le code.**
 *
 * L'application compte quatorze mille lignes de JavaScript écrites en
 * français, sur quatre pages. La façon canonique — envelopper chaque chaîne
 * dans un `t('…')` — voulait dire toucher huit cents endroits, dans du code
 * qui marche, pour un bénéfice invisible tant que la seconde langue n'existe
 * pas. Un seul oubli et une phrase reste en français ; une seule faute de
 * frappe et elle disparaît.
 *
 * Ici, un dictionnaire est posé **devant le DOM** : on parcourt les nœuds de
 * texte et les attributs qui s'affichent, et on remplace ce qu'on reconnaît.
 * Trois conséquences, et elles décident du reste :
 *
 * - **ce qu'on ne reconnaît pas ne bouge pas.** Les noms des personnages, les
 *   maisons, les notes de la table — tout ce que l'utilisateur a écrit — n'est
 *   pas dans le dictionnaire, donc ne peut pas être traduit par accident.
 *   C'est la propriété qui rend l'approche sûre, et elle est passive : elle ne
 *   demande à personne de penser à marquer ses données ;
 * - **une phrase ajoutée demain reste en français** jusqu'à ce qu'on l'ajoute
 *   au dictionnaire. `node outils/relever-textes.mjs --manquants` en donne la
 *   liste à tout moment ;
 * - **changer de langue recharge la page.** Traduire vers l'anglais se fait
 *   sur place ; revenir au français demanderait de retraduire à l'envers, ce
 *   qui n'est pas une opération sûre. Un rechargement repart du français, qui
 *   est ce que le code produit.
 */

import { TRADUCTIONS } from './traductions.js';

const MEMOIRE = 'familytree-langue';
export const LANGUES = [
  { code: 'fr', nom: 'Français', drapeau: '🇫🇷' },
  { code: 'en', nom: 'English', drapeau: '🇬🇧' },
];

/**
 * Le français est le défaut, y compris pour un navigateur anglophone.
 *
 * Ce n'est pas un oubli : l'application est écrite en français, ses mondes de
 * départ le sont, et quelqu'un qui arrive sans avoir rien demandé doit voir ce
 * que l'auteur a écrit. L'anglais est un choix, et il se retient.
 */
export function langueActuelle() {
  const gardee = localStorage.getItem(MEMOIRE);
  return LANGUES.some((entree) => entree.code === gardee) ? gardee : 'fr';
}

export function definirLangue(code) {
  if (code === langueActuelle()) return;
  localStorage.setItem(MEMOIRE, code);
  window.location.reload();
}

/* --------------------------------------------------------------------------
 * Le dictionnaire
 * -------------------------------------------------------------------------- */

/** Chaînes exactes, prêtes à l'emploi. */
let exactes = new Map();
/** Motifs : `[regexp, remplacement]`, construits une fois au démarrage. */
let motifs = [];

function echapperRegexp(valeur) {
  return valeur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `« {} » — {} fois` devient `/^« (.*) » — (.*) fois$/`, et sa traduction
 * garde les morceaux dans l'ordre où elle les redemande.
 *
 * Ancré des deux côtés : un motif ne s'applique qu'à un texte **entier**.
 * Sans ça, « 3 membres » attraperait le milieu d'une phrase écrite par
 * quelqu'un, et on réécrirait ses notes.
 */
function compilerMotif(source, cible) {
  const morceaux = source.split('{}');
  const regexp = new RegExp(`^${morceaux.map(echapperRegexp).join('(.*)')}$`);
  return [regexp, cible];
}

/**
 * Un motif encadré de trous des deux côtés doit porter assez de texte.
 *
 * **Le défaut que ça répare, mesuré le 15/08/2026.** `{} lien{}` — venu de
 * « 3 lien(s) » — se compile en `/^(.*) lien(.*)$/`. Il reconnaît « 16 lien(s)
 * direct(s) », qu'il traduit à moitié (moche) ; mais il reconnaît aussi « il a
 * rompu le lien avec son père » **dans une note écrite par quelqu'un**, et là
 * il réécrit ses mots (grave).
 *
 * Ce qui distingue le sûr du dangereux n'est pas la longueur, c'est la
 * **forme**. Un motif qui commence ou finit par du texte — `Né en {}`,
 * `{} / {} notés` — est ancré : le nœud entier doit commencer ou finir comme
 * ça, et une phrase quelconque n'y répond pas. Un motif qui flotte entre deux
 * trous n'a que son milieu pour se distinguer, et il lui en faut beaucoup.
 *
 * Une entrée écartée n'est pas perdue : elle devient une correspondance
 * exacte, qui ne s'appliquera qu'à un texte valant exactement ça.
 */
const LITTERAL_FLOTTANT_MINIMUM = 12;

function preparer(code) {
  const table = TRADUCTIONS[code] ?? {};
  exactes = new Map();
  motifs = [];
  for (const [source, cible] of Object.entries(table)) {
    if (!source.includes('{}')) {
      exactes.set(source, cible);
      continue;
    }
    const flottant = source.startsWith('{}') && source.endsWith('{}');
    const litteral = source.split('{}').join('').trim();
    if (!flottant || litteral.length >= LITTERAL_FLOTTANT_MINIMUM) {
      motifs.push(compilerMotif(source, cible));
    } else {
      exactes.set(source, cible);
    }
  }
}

/**
 * Traduit un texte, ou le rend tel quel.
 *
 * Les espaces de bord sont conservés : dans le HTML, un nœud de texte porte
 * souvent l'espace qui le sépare de la balise voisine, et le manger collerait
 * les mots.
 */
export function traduire(brut) {
  const avant = brut.match(/^\s*/)[0];
  const apres = brut.match(/\s*$/)[0];
  // Les retours à la ligne d'un HTML indenté ne comptent pas comme du texte.
  const noyau = brut.trim().replace(/\s+/g, ' ');
  if (!noyau) return null;

  const exacte = exactes.get(noyau);
  if (exacte !== undefined) return avant + exacte + apres;

  for (const [regexp, cible] of motifs) {
    const trouve = noyau.match(regexp);
    if (!trouve) continue;
    let index = 0;
    // Ce qui remplit un trou passe **aussi** par le dictionnaire, en exact
    // seulement. Sans ça, « 12 liens · orienté · … » gardait son « orienté » :
    // le mot est interpolé dans la phrase, jamais affiché seul, et il ne
    // pouvait donc être atteint autrement. Un nom de personnage, lui, n'est
    // dans aucune table et ressort tel quel — la garantie ne change pas.
    const rendu = cible.replace(/\{\}/g, () => {
      const morceau = trouve[++index] ?? '';
      return exactes.get(morceau.trim()) ?? morceau;
    });
    return avant + rendu + apres;
  }
  return null;
}

/* --------------------------------------------------------------------------
 * La traversée
 * -------------------------------------------------------------------------- */

/** Ce qu'on ne visite pas : du code, du style, ou la saisie de quelqu'un. */
const IGNORES = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
/** Attributs qui finissent sous les yeux. */
const ATTRIBUTS = ['title', 'placeholder', 'aria-label', 'alt'];

/**
 * Ce qu'on a écrit soi-même, et qu'il ne faut pas relire.
 *
 * **Le défaut que ça répare, mesuré le 15/08/2026.** Le champ « Lieu » de la
 * fiche s'affichait « Space ». La chaîne était pourtant traduite juste :
 * `Lieu` → `Place`. Mais l'observateur voit la modification qu'on vient de
 * faire, relit « Place » — qui est *aussi* un mot français, traduit ailleurs
 * par `Space` — et traduit une seconde fois.
 *
 * Un drapeau posé le temps de la boucle n'y suffit pas : les mutations sont
 * livrées en **microtâche**, donc dans un appel *ultérieur*, quand le drapeau
 * est déjà retombé. Ce qu'il faut retenir, c'est la valeur écrite : si le
 * nœud la porte encore, elle vient de nous. Si l'application l'a réécrite
 * depuis, elle ne correspond plus, et on traduit de nouveau — ce qui est bien
 * ce qu'on veut.
 */
const ecritsParNous = new WeakMap();

function clefEcrite(cible, nom) {
  const table = ecritsParNous.get(cible);
  return table?.get(nom);
}

function noterEcriture(cible, nom, valeur) {
  let table = ecritsParNous.get(cible);
  if (!table) {
    table = new Map();
    ecritsParNous.set(cible, table);
  }
  table.set(nom, valeur);
}

function traduireElement(element) {
  for (const nom of ATTRIBUTS) {
    const valeur = element.getAttribute?.(nom);
    if (!valeur) continue;
    if (clefEcrite(element, nom) === valeur) continue;
    const rendu = traduire(valeur);
    if (rendu !== null && rendu !== valeur) {
      element.setAttribute(nom, rendu);
      noterEcriture(element, nom, rendu);
    }
  }
  // La valeur d'un bouton s'affiche ; celle d'un champ de saisie appartient à
  // qui l'a tapée, et n'est jamais touchée.
  if (element.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(element.type)) {
    if (clefEcrite(element, 'value') === element.value) return;
    const rendu = traduire(element.value);
    if (rendu !== null && rendu !== element.value) {
      element.value = rendu;
      noterEcriture(element, 'value', rendu);
    }
  }
}

function traduireTexte(noeud) {
  if (clefEcrite(noeud, 'texte') === noeud.nodeValue) return;
  const rendu = traduire(noeud.nodeValue);
  if (rendu !== null && rendu !== noeud.nodeValue) {
    noeud.nodeValue = rendu;
    noterEcriture(noeud, 'texte', rendu);
  }
}

function traduireSousArbre(racine) {
  if (racine.nodeType === Node.TEXT_NODE) {
    if (!IGNORES.has(racine.parentElement?.tagName)) traduireTexte(racine);
    return;
  }
  if (racine.nodeType !== Node.ELEMENT_NODE) return;
  if (IGNORES.has(racine.tagName)) return;

  traduireElement(racine);
  // `FILTER_REJECT` sur un élément écarte **son sous-arbre entier**, ce que
  // `FILTER_SKIP` ne ferait pas : le contenu d'un `<textarea>` appartient à qui
  // l'a tapé, et il ne doit pas être visité, même en descendant par un autre
  // chemin. C'est au filtre de le dire, pas à la boucle.
  const parcours = document.createTreeWalker(
    racine,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (noeud) =>
        noeud.nodeType === Node.ELEMENT_NODE && IGNORES.has(noeud.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    }
  );
  for (let noeud = parcours.nextNode(); noeud; noeud = parcours.nextNode()) {
    if (noeud.nodeType === Node.ELEMENT_NODE) traduireElement(noeud);
    else traduireTexte(noeud);
  }
}

/**
 * Installe la traduction, et la maintient.
 *
 * L'application redessine sans arrêt (le rail, la fiche, le plan) : traduire
 * une fois au chargement ne tiendrait pas trois clics. L'observateur reprend
 * donc ce qui apparaît — et se met en pause pendant qu'il écrit lui-même,
 * sinon ses propres remplacements le rappelleraient en boucle.
 */
export function installerLangue() {
  const code = langueActuelle();
  document.documentElement.lang = code;
  if (code === 'fr') return;

  preparer(code);
  traduireSousArbre(document.body);

  // Pas de drapeau « je suis en train d'écrire » : il ne protégerait de rien
  // (voir `ecritsParNous`). C'est la mémoire des valeurs écrites qui arrête la
  // boucle, nœud par nœud.
  const observateur = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') traduireTexte(mutation.target);
      else if (mutation.type === 'attributes') traduireElement(mutation.target);
      else for (const ajoute of mutation.addedNodes) traduireSousArbre(ajoute);
    }
  });
  observateur.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTS,
  });
}
