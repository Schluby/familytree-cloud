/**
 * Relève tout ce que l'application affiche en français (lot 16.G).
 *
 *   node outils/relever-textes.mjs            # la liste, une chaîne par ligne
 *   node outils/relever-textes.mjs --manquants # celles qui n'ont pas de traduction
 *
 * Ce n'est **pas** un extracteur de gettext : il n'insère aucun appel dans le
 * code. Il lit les sources et rend la liste des textes visibles, qui sert à
 * fabriquer `public/js/traductions.js`. La traduction, elle, se fait à
 * l'affichage, en parcourant le DOM — voir `public/js/langue.js` pour le
 * pourquoi de ce choix.
 *
 * Rejouable : relancé après un lot, il dit d'un `--manquants` ce qui a été
 * ajouté depuis et qui reste en français.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = 'public';

/**
 * Le serveur aussi envoie du texte qui s'affiche : le nom et la description de
 * chaque vue (le rail les montre en permanence), et les intitulés des tableaux
 * d'export. Ces chaînes-là sont écrites en TypeScript, souvent découpées sur
 * plusieurs lignes par des `+` — d'où une lecture à part.
 */
const COTE_SERVEUR = ['src/domaine/vues', 'src/domaine/exports.ts'];

/** `readonly description = 'a ' + 'b';` → `a b`. */
function textesDuServeur(source) {
  const trouves = new Set();
  const declarations =
    /\breadonly\s+(?:nom|description|titre|label)\s*=\s*((?:'(?:\\.|[^'])*'|"(?:\\.|[^"])*")(?:\s*\+\s*(?:'(?:\\.|[^'])*'|"(?:\\.|[^"])*"))*)/g;
  for (const m of source.matchAll(declarations)) {
    const morceaux = [...m[1].matchAll(/'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"/g)].map(
      (bout) => bout[1] ?? bout[2]
    );
    trouves.add(morceaux.join(''));
  }
  // Les entêtes de colonnes et de feuilles : `col('id', 'Libellé', …)`,
  // `{ id: 'personnes', titre: 'Personnes' }`.
  for (const m of source.matchAll(/\bcol\(\s*'[^']*'\s*,\s*'([^']+)'/g)) trouves.add(m[1]);
  for (const m of source.matchAll(/\btitre:\s*'([^']+)'/g)) trouves.add(m[1]);
  return trouves;
}

/** Ce qui n'est pas du texte d'interface, même quand ça y ressemble. */
function estDuTexte(valeur) {
  const propre = valeur.trim();
  if (propre.length < 2) return false;
  // Pas une lettre : des chiffres, des symboles, une icône seule.
  if (!/\p{L}{2}/u.test(propre)) return false;
  // Un identifiant, une classe, une adresse, un sélecteur.
  if (/^[a-z0-9_-]+$/.test(propre)) return false;
  if (/^(https?:|\/|#|\.|data:)/.test(propre)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(propre)) return false;
  // Du CSS pris dans un ternaire : une longueur, l'amorce d'une fonction de
  // couleur. Ça ressemble à du texte et n'en est pas.
  if (/^-?[\d.]+(em|rem|px|%|vh|vw|s|ms)$/.test(propre)) return false;
  if (/^[a-z]+\($/.test(propre)) return false;
  // Un gabarit de balisage ou un attribut fabriqué : `<div class="…">{}</div>`,
  // `marker-end="url(#…)"`, `{}px`. C'est du code qui passe par les mêmes
  // porteurs que du texte, et le traduire casserait le rendu.
  if (/<[a-z/]/i.test(propre) || /[a-z-]+="/.test(propre)) return false;
  if (/^\{\}[a-z%]+$/.test(propre)) return false;
  return true;
}

function fichiers(dossier) {
  const trouves = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiers(chemin));
    } else if (/\.(js|html)$/.test(nom) && nom !== 'traductions.js' && nom !== 'langue.js') {
      trouves.push(chemin);
    }
  }
  return trouves;
}

/**
 * Les chaînes d'un fichier, par l'endroit où elles servent.
 *
 * On vise les porteurs de texte visible plutôt que toutes les chaînes du
 * fichier : une clef d'objet, un nom de classe et un chemin d'API sont aussi
 * des chaînes, et les traduire casserait l'application.
 */
function textesDe(source, html) {
  const trouves = new Set();
  const ajouter = (valeur) => {
    if (!valeur) return;
    // Ce qui varie devient `{}` : à l'affichage, le DOM porte la valeur
    // interpolée, pas le gabarit. Une entrée `Humeur envers {}` se retrouve
    // donc par motif, et rend ce qui la remplit tel quel.
    const gabarit = valeur
      .replace(/\$\{[^}]*\}/g, '{}')
      .replace(/\s+/g, ' ')
      .trim();
    if (estDuTexte(gabarit)) trouves.add(gabarit);
  };

  if (html) {
    // Attributs qui s'affichent.
    for (const m of source.matchAll(/(?:title|placeholder|alt|aria-label)="([^"]+)"/g)) {
      ajouter(m[1]);
    }
    // Texte entre balises, balises internes retirées.
    for (const m of source.matchAll(/>([^<>{}]+)</g)) ajouter(m[1]);
    return trouves;
  }

  // Une chaîne d'affichage s'écrit souvent en plusieurs morceaux collés :
  //
  //     elements.aide.textContent =
  //       `${n} / ${max} sauvegardes · ` +
  //       `${poids} utilisés, ${plafond} par sauvegarde.`;
  //
  // À l'écran c'est **une** phrase. Ne relever que le premier morceau donnait
  // un motif qui ne s'appliquait jamais, et la seconde moitié restait en
  // français — trouvé le 15/08/2026 sur la ligne des plafonds.
  const LITTERAL = String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\`(?:\\.|[^\`\\])*\``;
  const CHAINE = `(?:${LITTERAL})(?:\\s*\\+\\s*(?:${LITTERAL}))*`;
  const nu = (litteral) => litteral.slice(1, -1);
  const joindre = (chaine) =>
    [...chaine.matchAll(new RegExp(LITTERAL, 'g'))].map((m) => nu(m[0])).join('');

  // `texte: '…'`, `title: '…'`, `placeholder: '…'`, `label: '…'`…
  const porteurs = new RegExp(
    String.raw`\b(?:texte|title|placeholder|label|libelle|alt|resume|message|indice|aide|detail)\s*:\s*(${CHAINE})`,
    'g'
  );
  for (const m of source.matchAll(porteurs)) ajouter(joindre(m[1]));

  // `x.textContent = '…'`, `.title = '…'`, `.placeholder = '…'`
  const affectations = new RegExp(
    String.raw`\.(?:textContent|title|placeholder|innerText)\s*=\s*(${CHAINE})`,
    'g'
  );
  for (const m of source.matchAll(affectations)) ajouter(joindre(m[1]));

  // Les appels qui parlent : astuce('…'), message('…'), definirEtat('…')…
  //
  // La liste est **nominative**, et c'est délibéré. On a essayé de prendre
  // tous les gabarits qui « ressemblent à une phrase » : la règle ramenait des
  // classes CSS (`bouton {}`), des chemins d'API et des fragments de code. Un
  // relevé qui rend du bruit ne se relit pas, donc ne sert pas.
  const appels =
    /\b(astuce|message|definirEtat|confirm|alert|prompt|surEtat|dire)\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
  for (const m of source.matchAll(appels)) ajouter(m[3]);

  // Les deux branches d'un ternaire : `dirige ? 'orienté' : 'réciproque'`, ou
  // `notes ? \`${n} / ${total} notés\` : 'aucune'`. Ces textes-là sont souvent
  // **interpolés** dans une phrase et ne s'affichent jamais seuls ; sans cette
  // règle ils n'entraient dans aucun relevé, et restaient en français au
  // milieu d'une phrase traduite. Les gabarits comptent autant que les
  // chaînes : c'est en oubliant les premiers qu'on a laissé passer
  // « 3 / 4 notés ».
  const litteral = "(['\"`])((?:\\\\.|(?!\\1)[^\\n])*?)\\1";
  const ternaires = new RegExp(`\\?\\s*${litteral}\\s*:\\s*${litteral.replace(/1/g, '3')}`, 'g');
  for (const m of source.matchAll(ternaires)) {
    ajouter(m[2]);
    ajouter(m[4]);
  }

  // Les libellés passés en **argument**, et non en propriété :
  // `champTexte('generation', 'Génération (vide = calculée)')`. Le second
  // argument de ces constructeurs est toujours ce qui s'affiche.
  const arguments_ = /\b(champTexte|champSelection|champListe|ligneInfo|ligne)\(\s*(['"])(?:\\.|(?!\2)[^\n])*\2\s*,\s*(['"])((?:\\.|(?!\3)[^\n])*?)\3/g;
  for (const m of source.matchAll(arguments_)) ajouter(m[4]);

  return trouves;
}

const toutes = new Set();
for (const chemin of fichiers(RACINE)) {
  const source = readFileSync(chemin, 'utf8');
  for (const texte of textesDe(source, chemin.endsWith('.html'))) toutes.add(texte);
}
for (const cible of COTE_SERVEUR) {
  const chemins = statSync(cible).isDirectory()
    ? readdirSync(cible).map((nom) => join(cible, nom))
    : [cible];
  for (const chemin of chemins.filter((c) => c.endsWith('.ts'))) {
    for (const texte of textesDuServeur(readFileSync(chemin, 'utf8'))) {
      if (estDuTexte(texte)) toutes.add(texte.replace(/\s+/g, ' ').trim());
    }
  }
}

const liste = [...toutes].sort((a, b) => a.localeCompare(b, 'fr'));

if (process.argv.includes('--manquants')) {
  const { TRADUCTIONS } = await import('../public/js/traductions.js');
  const connus = new Set(Object.keys(TRADUCTIONS.en ?? {}));
  const manquants = liste.filter((texte) => !connus.has(texte));
  for (const texte of manquants) console.log(texte);
  console.error(`${manquants.length} sans traduction sur ${liste.length} relevés.`);
} else {
  for (const texte of liste) console.log(texte);
  console.error(`${liste.length} textes relevés.`);
}
