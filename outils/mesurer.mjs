/**
 * Mesure le coût des routes lourdes sur un gros arbre.
 *
 *   node outils/mesurer.mjs 500 https://familytree.schlub-perso.workers.dev
 *
 * À lancer avec `npx wrangler tail familytree --format json` en parallèle :
 * **le temps de CPU ne se mesure pas depuis l'extérieur**. Ce que ce script
 * donne, c'est le temps de bout en bout ; ce que `tail` donne, c'est le
 * `cpuTime`, celui qui compte pour le palier gratuit. Les deux n'ont rien à
 * voir : une requête peut passer 200 ms à attendre D1 pour 3 ms de CPU.
 *
 * Le compte et les sauvegardes créés portent `mesure-…@exemple.test` et se
 * nettoient comme ceux du harnais.
 */

import { execFileSync } from 'node:child_process';

const FICHES = Number.parseInt(process.argv[2] ?? '500', 10);
const BASE = process.argv[3] || 'http://127.0.0.1:8787';
const PASSAGES = Number.parseInt(process.argv[4] ?? '3', 10);

const EMAIL = `mesure-${Date.now()}@exemple.test`;
let cookie = '';

async function appeler(chemin, options = {}) {
  const debut = Date.now();
  const reponse = await fetch(BASE + chemin, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const posee = reponse.headers.get('set-cookie');
  if (posee) cookie = posee.split(';')[0];
  const texte = await reponse.text();
  return { code: reponse.status, ms: Date.now() - debut, octets: texte.length, texte };
}

const arbre = execFileSync('node', ['outils/gros-arbre.mjs', String(FICHES)], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const document = JSON.parse(arbre);

console.log(`Base   : ${BASE}`);
console.log(
  `Arbre  : ${document.personnes.length} fiches, ${document.relations.length} liens, ` +
    `${Math.round(arbre.length / 1024)} Ko compacts`
);
console.log();

const cle = execFileSync('node', ['outils/deriver.mjs', EMAIL, 'mesure-2026'], {
  encoding: 'utf8',
}).trim();

const inscription = await appeler('/api/auth/inscription', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, cle, nom_affiche: 'Mesure' }),
});
if (inscription.code !== 201) {
  console.log(`inscription impossible (${inscription.code}) : ${inscription.texte.slice(0, 200)}`);
  process.exit(2);
}

const importe = await appeler('/api/sauvegardes/import', { method: 'POST', body: arbre });
if (importe.code !== 201) {
  console.log(`import impossible (${importe.code}) : ${importe.texte.slice(0, 200)}`);
  process.exit(2);
}
const sauvegarde = JSON.parse(importe.texte).sauvegarde;
await appeler(`/api/sauvegardes/${sauvegarde.id}/activer`, { method: 'POST' });
console.log(`Import : ${importe.ms} ms, ${Math.round(sauvegarde.taille / 1024)} Ko stockes`);
console.log();

const routes = [
  '/api/vue/sociogramme',
  '/api/vue/sociogramme?fratrie=0',
  '/api/vue/sociogramme?isoles=0&secrets=1',
  `/api/vue/sociogramme?focus=${document.personnes[0].id}&profondeur=3`,
  '/api/referentiels',
  '/api/personnes',
  '/api/relations',
  '/api/filtres/valeurs?variable=maison',
  '/api/sauvegardes',
  // Lot 5 : ce sont les routes qui fabriquent des fichiers, donc les plus
  // gourmandes. Le classeur Excel serialise cinq feuilles puis les degonfle.
  '/api/vue/tableau',
  '/api/export/csv?table=relations',
  '/api/export/xlsx',
  '/api/export/zip',
];

console.log('  ms     Ko    code   route   (ms = bout en bout, pas du CPU)');
for (const route of routes) {
  const passages = [];
  let derniere = null;
  for (let i = 0; i < PASSAGES; i += 1) {
    derniere = await appeler(route);
    passages.push(derniere.ms);
  }
  const meilleur = Math.min(...passages);
  console.log(
    `${String(meilleur).padStart(5)}  ${String(Math.round(derniere.octets / 1024)).padStart(5)}  ` +
      `${String(derniere.code).padStart(5)}   ${route}`
  );
}

console.log();
console.log(`Compte de mesure : ${EMAIL}`);
console.log('Nettoyage : DELETE FROM utilisateurs WHERE email_norm LIKE \'mesure-%@exemple.test\'');
