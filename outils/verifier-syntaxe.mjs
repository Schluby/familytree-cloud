/**
 * Les modules du navigateur se lisent-ils ? (lot 23.D)
 *
 * ── Pourquoi cet outil existe ────────────────────────────────────────────────
 *
 * `tsc --noEmit` couvre `src/` — du TypeScript. Mais l'interface, elle, est du
 * JavaScript ordinaire servi tel quel : **rien ne la compilait**. Le jour où une
 * édition maladroite a mangé les apostrophes de `js/api.js`, le fichier est
 * devenu impossible à analyser, l'application n'a plus démarré du tout… et le
 * harnais a répondu « 939/939 ». Il ne pouvait pas faire autrement : il
 * interroge le serveur et cherche des chaînes dans ce qui est servi, or un
 * fichier cassé est servi tout aussi bien qu'un autre.
 *
 * Ce contrôle-ci ne remplace pas le harnais : il attrape la seule chose que le
 * harnais ne peut pas voir — un module qui ne se lit plus.
 *
 *   node outils/verifier-syntaxe.mjs
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const RACINE = 'public';

/** Tous les `.js` servis, quel que soit le préfixe de montage. */
function modules(dossier) {
  const trouves = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) trouves.push(...modules(chemin));
    else if (nom.endsWith('.js')) trouves.push(chemin);
  }
  return trouves;
}

const fichiers = modules(RACINE);
const casses = [];

for (const chemin of fichiers) {
  try {
    // `--check` analyse sans exécuter : ni requête réseau, ni effet de bord.
    execFileSync(process.execPath, ['--check', chemin], { stdio: 'pipe' });
  } catch (erreur) {
    const detail = String(erreur.stderr || erreur.message)
      .split('\n')
      .slice(0, 4)
      .join('\n');
    casses.push(`${chemin}\n${detail}`);
  }
}

if (casses.length) {
  console.error(`\n${casses.length} module(s) illisible(s) :\n`);
  for (const casse of casses) console.error(casse + '\n');
  process.exit(1);
}

console.log(`Syntaxe : ${fichiers.length} modules du navigateur se lisent.`);
