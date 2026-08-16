#!/usr/bin/env node
/**
 * Le préfixe est écrit à trois endroits. Cet outil vérifie qu'ils s'accordent.
 *
 *   node outils/verifier-prefixe.mjs
 *
 * ── Pourquoi un outil pour ça ────────────────────────────────────────────────
 *
 * Les trois désaccords possibles échouent de trois façons différentes, et
 * aucune ne dit ce qui ne va pas :
 *
 *  - `src/base.ts` seul déplacé → les routes répondent à la nouvelle adresse,
 *    mais `run_worker_first` ne couvre plus `/api/*`. Cloudflare cherche alors
 *    un FICHIER pour chaque appel d'API, n'en trouve pas, retombe sur le
 *    Worker — ça marche, en apparence, et chaque requête d'API coûte une
 *    invocation de plus qu'elle ne devrait.
 *  - `wrangler.jsonc` seul déplacé → les appels d'API partent au Worker à une
 *    adresse qu'aucune route ne connaît : 404 « route inconnue » partout.
 *  - `public/` resté à plat → chaque fichier manque, retombe sur le Worker,
 *    et le repli SPA renvoie `index.html` À LA PLACE du script demandé. Le
 *    navigateur reçoit du HTML là où il attend du JavaScript, et l'application
 *    s'arrête sur une erreur de syntaxe qui ne désigne rien.
 *
 * Le troisième est le plus vicieux : la page se charge, puis rien ne marche.
 * D'où cette vérification, appelée par `npm run verif`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projet = join(dirname(fileURLToPath(import.meta.url)), '..');
const soucis = [];

/* ---------------------------------------------------------- 1. src/base.ts */

const source = readFileSync(join(projet, 'src/base.ts'), 'utf8');
const declaration = source.match(/export const BASE = '([^']*)';/);
if (!declaration) {
  console.error("src/base.ts : impossible de lire `export const BASE = '…';`");
  process.exit(1);
}
const base = declaration[1];

if (base && !/^(\/[a-z0-9-]+)+$/.test(base)) {
  soucis.push(
    `src/base.ts : préfixe « ${base} » mal formé — attendu vide, ou des segments ` +
      'en minuscules commençant par « / » et sans « / » final.'
  );
}

/* ------------------------------------------------------- 2. wrangler.jsonc */

const config = readFileSync(join(projet, 'wrangler.jsonc'), 'utf8');
const premier = config.match(/"run_worker_first"\s*:\s*\[([^\]]*)\]/);
const attendu = `${base}/api/*`;
if (!premier) {
  soucis.push('wrangler.jsonc : `run_worker_first` est introuvable.');
} else if (!premier[1].includes(`"${attendu}"`)) {
  soucis.push(
    `wrangler.jsonc : \`run_worker_first\` devrait contenir "${attendu}", ` +
      `il porte ${premier[1].trim()}.`
  );
}

/* ------------------------------------------------------------- 3. public/ */

// On sonde les pages, pas un dossier : un dossier peut exister et être vide.
const pages = ['index.html', 'connexion.html', 'admin.html', 'collectif.html', 'donnees.html'];
for (const page of pages) {
  const chemin = join(projet, 'public', base, page);
  if (!existsSync(chemin)) {
    soucis.push(`public${base}/${page} est absent — l'arborescence ne suit pas le préfixe.`);
  }
}

// Et l'inverse : un fichier resté à la racine serait servi à une adresse où il
// n'a plus rien à faire, en doublon silencieux de sa copie préfixée.
//
// Une seule exception, et elle est voulue : `public/index.html` est la **page
// de choix** du domaine, celle qui mène aux deux sociogrammes. Elle n'appartient
// à aucune des deux applications. On vérifie donc qu'elle existe — sans elle,
// la racine de myschlub.com ne répondrait plus rien — et surtout qu'elle n'est
// pas l'application restée là par accident.
if (base) {
  for (const page of pages) {
    if (page === 'index.html') continue;
    if (existsSync(join(projet, 'public', page))) {
      soucis.push(`public/${page} traîne à la racine alors que le préfixe est « ${base} ».`);
    }
  }

  const accueil = join(projet, 'public', 'index.html');
  const porteLaRacine = /export const SERT_LA_RACINE = true;/.test(source);

  if (porteLaRacine && !existsSync(accueil)) {
    soucis.push('public/index.html est absent : la racine du domaine ne répondrait rien.');
  } else if (porteLaRacine && readFileSync(accueil, 'utf8').includes('js/main.js')) {
    soucis.push(
      "public/index.html charge le module de l'application : c'est l'ancienne page " +
        'restée à la racine, pas la page de choix.'
    );
  } else if (!porteLaRacine && existsSync(accueil)) {
    soucis.push(
      "public/index.html existe alors que SERT_LA_RACINE est faux : ce projet ne reçoit " +
        'jamais la racine du domaine, cette page ne serait jamais servie.'
    );
  }
}

/* --------------------------------------- 4. aucune adresse absolue dans le HTML
 *
 * Les pages de l'application se lient entre elles en **relatif** (`css/app.css`,
 * `connexion.html`) : elles sont toutes au même niveau, et un chemin relatif
 * suit le préfixe sans rien savoir de lui. C'est ce qui permet à la fourche IRL
 * de ne pas toucher une seule ligne de HTML.
 *
 * Un `href="/…"` réintroduit discrètement la racine du DOMAINE — où se trouve
 * désormais la page de choix entre les deux sociogrammes, pas cette
 * application. La feuille de style ne serait pas trouvée, et la page
 * s'afficherait sans mise en forme sans qu'aucune erreur ne le dise.
 */
if (base) {
  for (const page of pages) {
    const chemin = join(projet, 'public', base, page);
    if (!existsSync(chemin)) continue;
    const html = readFileSync(chemin, 'utf8');
    const absolues = html.match(/(?:href|src|action)="\/[^"]*"/g) ?? [];
    for (const trouvaille of absolues) {
      soucis.push(`public${base}/${page} : ${trouvaille} — attendu un chemin relatif.`);
    }
  }
}

/* ------------------------------------------------------------------ verdict */

if (soucis.length) {
  console.error(`Préfixe « ${base || '(racine)'} » : ${soucis.length} désaccord(s).\n`);
  for (const souci of soucis) console.error(`  - ${souci}`);
  process.exit(1);
}

console.log(`Préfixe « ${base || '(racine)'} » : les trois endroits s'accordent.`);
