/**
 * Le rail de gauche : deux onglets, trois blocs qui se replient (lot 21.A).
 *
 * ── Pourquoi deux onglets ────────────────────────────────────────────────────
 *
 * Le rail portait neuf blocs à la file. Neuf blocs, c'est trois écrans de
 * défilement pour atteindre les options d'affichage, et ce n'est pas un
 * problème de longueur mais de mélange : « quelle sauvegarde est ouverte » et
 * « quelles maisons j'affiche » ne se demandent jamais dans la même minute. On
 * les sépare donc en deux pages — **Plan** (vues, joueurs, liens, filtre), qu'on
 * touche sans arrêt, et **Réglages** (démonstration, sauvegardes, partages,
 * options), qu'on ouvre deux fois par séance.
 *
 * ── Pourquoi un module et pas trois lignes dans `main.js` ────────────────────
 *
 * Parce que trois autres endroits ont besoin d'**amener un bloc sous les yeux**
 * sans savoir dans quel onglet il vit : le ⛨ du téléphone, la visite guidée, et
 * le rail lui-même quand on rouvre l'application. `montrerBloc()` est cette
 * réponse unique — elle bascule l'onglet, déplie le bloc, et rend le nœud. Sans
 * elle, chaque appelant devrait connaître la carte du rail, et se tromperait le
 * jour où un bloc change de page.
 *
 * L'état — onglet actif, blocs repliés — est retenu par `localStorage`, sous
 * `cle()` : les deux sociogrammes partagent l'origine, et le rail de l'un n'a
 * pas à replier celui de l'autre.
 */

import { cle } from './base.js';

const CLE_ONGLET = 'familytree-rail-onglet';
const CLE_PLIES = 'familytree-rail-plies';

/** Lecture tolérante : un stockage illisible ne doit pas casser le rail. */
function lireJson(nom, defaut) {
  try {
    const brut = localStorage.getItem(cle(nom));
    return brut ? JSON.parse(brut) : defaut;
  } catch {
    return defaut;
  }
}

function ecrire(nom, valeur) {
  try {
    localStorage.setItem(cle(nom), JSON.stringify(valeur));
  } catch {
    // Navigation privée, quota plein : le rail marche quand même, il oublie.
  }
}

/* --------------------------------------------------------------------- onglets */

function pages() {
  return [...document.querySelectorAll('.rail-page')];
}

function onglets() {
  return [...document.querySelectorAll('.rail-onglet')];
}

/** Affiche la page demandée. Une page inconnue retombe sur « plan ». */
export function ouvrirOnglet(nom, retenir = true) {
  const voulu = pages().some((page) => page.dataset.page === nom) ? nom : 'plan';
  for (const page of pages()) page.hidden = page.dataset.page !== voulu;
  for (const onglet of onglets()) {
    const actif = onglet.dataset.page === voulu;
    onglet.classList.toggle('actif', actif);
    onglet.setAttribute('aria-selected', actif ? 'true' : 'false');
  }
  if (retenir) ecrire(CLE_ONGLET, voulu);
  return voulu;
}

/* ---------------------------------------------------------------------- replis */

function plies() {
  const liste = lireJson(CLE_PLIES, []);
  return new Set(Array.isArray(liste) ? liste.map(String) : []);
}

function appliquerRepli(bloc, plie) {
  bloc.classList.toggle('plie', plie);
  const bouton = bloc.querySelector('.rail-plier');
  if (bouton) {
    bouton.setAttribute('aria-expanded', plie ? 'false' : 'true');
    // La flèche pointe vers ce qui arrivera : vers le bas pour refermer, vers
    // la droite pour rouvrir. C'est la convention de tous les dépliants, et
    // c'est la seule chose qui distingue les deux états d'un coup d'œil.
    bouton.textContent = plie ? '▸' : '▾';
  }
}

/** Replie ou déplie un bloc, et retient la décision. */
export function basculerRepli(bloc) {
  const ferme = !bloc.classList.contains('plie');
  appliquerRepli(bloc, ferme);
  const memoire = plies();
  if (ferme) memoire.add(bloc.id);
  else memoire.delete(bloc.id);
  ecrire(CLE_PLIES, [...memoire]);
}

/* ------------------------------------------------------------------ ouverture */

/**
 * Amène un bloc du rail sous les yeux : bon onglet, bloc déplié.
 *
 * Ne fait **pas** défiler — c'est l'affaire de qui appelle, et le téléphone n'a
 * pas la même idée du bon moment (le tiroir glisse encore). Rend le nœud, ou
 * `null` si ce bloc n'existe pas dans cette page.
 */
export function montrerBloc(idBloc) {
  const bloc = document.getElementById(idBloc);
  if (!bloc) return null;
  const page = bloc.closest('.rail-page');
  if (page) ouvrirOnglet(page.dataset.page);
  const pliable = bloc.closest('.rail-pliable');
  if (pliable?.classList.contains('plie')) basculerRepli(pliable);
  return bloc;
}

export function installerRail() {
  for (const onglet of onglets()) {
    onglet.addEventListener('click', () => ouvrirOnglet(onglet.dataset.page));
  }
  ouvrirOnglet(lireJson(CLE_ONGLET, 'plan'), false);

  const replies = plies();
  for (const bloc of document.querySelectorAll('.rail-pliable')) {
    appliquerRepli(bloc, replies.has(bloc.id));
    const entete = bloc.querySelector('.rail-bloc-entete');
    if (!entete) continue;
    // Tout l'en-tête est cliquable, pas seulement le chevron : c'est une cible
    // de 300 px de large au lieu de 30, et personne ne vise un chevron. Les
    // autres boutons de l'en-tête — le ＋ des filtres — gardent leur clic.
    entete.addEventListener('click', (evenement) => {
      if (evenement.target.closest('button')?.classList.contains('btn-entete')) return;
      basculerRepli(bloc);
    });
  }
}
