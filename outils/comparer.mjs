/**
 * Compare la version hébergée à l'application locale, champ par champ.
 *
 *   node outils/comparer.mjs [urlPython] [urlCloud]
 *   node outils/comparer.mjs http://127.0.0.1:8000 http://127.0.0.1:8787
 *
 * C'est le critère « fini » du lot 3 : pour **la même sauvegarde**, les deux
 * versions doivent répondre la même chose. Le script ne suppose pas que les
 * deux bases contiennent le même monde — il prend le document de la version
 * Python (`/api/dataset`), l'importe dans la version TypeScript, l'active, et
 * compare seulement ensuite.
 *
 * Ce qu'on compare, et ce qu'on ne compare pas :
 *
 * - On compare le JSON **après analyse**, pas octet par octet. Python écrit
 *   `4.0` là où JavaScript écrit `4` : les deux disent le même nombre, et le
 *   consommateur est un navigateur, qui ne sait pas les distinguer. Exiger
 *   l'identité des octets reviendrait à exiger que JavaScript imite le
 *   formateur de flottants de Python, sans que personne n'y gagne.
 * - `/api/sante` diverge par construction (la version en ligne y ajoute l'état
 *   de l'infrastructure) : on n'en compare que les champs communs.
 */

import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const PYTHON = process.argv[2] || 'http://127.0.0.1:8000';
const CLOUD = process.argv[3] || 'http://127.0.0.1:8787';

const MARQUE = Date.now();
const EMAIL = `comparaison-${MARQUE}@exemple.test`;
const MOT_DE_PASSE = 'comparaison-2026';

let cookie = '';

async function appelerCloud(chemin, options = {}) {
  const reponse = await fetch(CLOUD + chemin, {
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
  let donnees = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    donnees = { erreur: texte.slice(0, 200) };
  }
  return { code: reponse.status, donnees };
}

async function appelerPython(chemin) {
  const reponse = await fetch(PYTHON + chemin);
  const texte = await reponse.text();
  try {
    return { code: reponse.status, donnees: texte ? JSON.parse(texte) : null };
  } catch {
    return { code: reponse.status, donnees: { erreur: texte.slice(0, 200) } };
  }
}

/* -------------------------------------------------------------------------- */

/** Différences entre deux valeurs, avec le chemin de chacune. */
function differences(attendu, obtenu, chemin = '', trouvees = []) {
  if (trouvees.length >= 25) return trouvees;

  if (attendu === obtenu) return trouvees;

  const genre = (v) => (v === null ? 'null' : Array.isArray(v) ? 'liste' : typeof v);
  if (genre(attendu) !== genre(obtenu)) {
    trouvees.push({ chemin, python: apercu(attendu), cloud: apercu(obtenu) });
    return trouvees;
  }

  if (Array.isArray(attendu)) {
    if (attendu.length !== obtenu.length) {
      trouvees.push({
        chemin: `${chemin}.length`,
        python: attendu.length,
        cloud: obtenu.length,
      });
      return trouvees;
    }
    for (let i = 0; i < attendu.length; i += 1) {
      differences(attendu[i], obtenu[i], `${chemin}[${i}]`, trouvees);
      if (trouvees.length >= 25) break;
    }
    return trouvees;
  }

  if (attendu !== null && typeof attendu === 'object') {
    const cles = new Set([...Object.keys(attendu), ...Object.keys(obtenu)]);
    for (const cle of cles) {
      if (!(cle in attendu)) {
        trouvees.push({ chemin: `${chemin}.${cle}`, python: '(absent)', cloud: apercu(obtenu[cle]) });
      } else if (!(cle in obtenu)) {
        trouvees.push({ chemin: `${chemin}.${cle}`, python: apercu(attendu[cle]), cloud: '(absent)' });
      } else {
        differences(attendu[cle], obtenu[cle], `${chemin}.${cle}`, trouvees);
      }
      if (trouvees.length >= 25) break;
    }
    return trouvees;
  }

  trouvees.push({ chemin, python: apercu(attendu), cloud: apercu(obtenu) });
  return trouvees;
}

function apercu(valeur) {
  const texte = JSON.stringify(valeur);
  if (texte === undefined) return String(valeur);
  return texte.length > 80 ? texte.slice(0, 77) + '…' : texte;
}

/** Ne garde que les clés présentes des deux côtés (pour `/api/sante`). */
function communes(a, b) {
  const gauche = {};
  const droite = {};
  for (const cle of Object.keys(a)) {
    if (cle in b) {
      gauche[cle] = a[cle];
      droite[cle] = b[cle];
    }
  }
  return [gauche, droite];
}

/* --------------------------------------------------------------------------
 * Les fichiers (CSV, classeur Excel)
 *
 * Les routes JSON ne disent rien de ce qui sort en piece jointe. Ces deux
 * fonctions comparent les octets eux-memes ; pour le .xlsx, elles ouvrent
 * l'archive et comparent les parties XML, parce que deux zips du meme contenu
 * ne sont pas forcement identiques (dates, niveau de compression, ordre).
 * -------------------------------------------------------------------------- */

async function octetsCloud(chemin) {
  const reponse = await fetch(CLOUD + chemin, { headers: cookie ? { Cookie: cookie } : {} });
  return { code: reponse.status, octets: Buffer.from(await reponse.arrayBuffer()) };
}

async function octetsPython(chemin) {
  const reponse = await fetch(PYTHON + chemin);
  return { code: reponse.status, octets: Buffer.from(await reponse.arrayBuffer()) };
}

async function comparerOctets(chemin) {
  comparees += 1;
  const [python, nuage] = await Promise.all([octetsPython(chemin), octetsCloud(chemin)]);
  if (python.code !== nuage.code) {
    echecs += 1;
    console.log(`  ECHEC ${chemin}  codes ${python.code} vs ${nuage.code}`);
    return;
  }
  if (python.octets.equals(nuage.octets)) {
    console.log(`  ok    ${chemin}  (${python.octets.length} octets identiques)`);
    return;
  }
  echecs += 1;
  // Premiere ligne qui differe : c'est ce qu'on veut voir, pas un dump.
  const gauche = python.octets.toString('utf8').split('\r\n');
  const droite = nuage.octets.toString('utf8').split('\r\n');
  const i = gauche.findIndex((ligne, index) => ligne !== droite[index]);
  console.log(`  ECHEC ${chemin}  ${python.octets.length} vs ${nuage.octets.length} octets`);
  console.log(`        ligne ${i + 1} python : ${apercu(gauche[i])}`);
  console.log(`        ligne ${i + 1} nuage  : ${apercu(droite[i])}`);
}

/** Ouvre un .xlsx et rend {chemin: contenu} pour chaque partie. */
function ouvrirClasseur(octets) {
  const parties = {};
  // On lit les en-tetes locaux dans l'ordre : suffisant pour une archive
  // qu'on a soi-meme ecrite, et ca evite de parcourir le repertoire central.
  let position = 0;
  while (position + 4 <= octets.length && octets.readUInt32LE(position) === 0x04034b50) {
    const methode = octets.readUInt16LE(position + 8);
    const compressee = octets.readUInt32LE(position + 18);
    const tailleNom = octets.readUInt16LE(position + 26);
    const tailleExtra = octets.readUInt16LE(position + 28);
    const nom = octets.toString('utf8', position + 30, position + 30 + tailleNom);
    const debut = position + 30 + tailleNom + tailleExtra;
    const brutes = octets.subarray(debut, debut + compressee);
    parties[nom] = methode === 8 ? zlib.inflateRawSync(brutes).toString('utf8') : brutes.toString('utf8');
    position = debut + compressee;
  }
  return parties;
}

async function comparerClasseur(chemin) {
  comparees += 1;
  const [python, nuage] = await Promise.all([octetsPython(chemin), octetsCloud(chemin)]);
  if (python.code !== nuage.code) {
    echecs += 1;
    console.log(`  ECHEC ${chemin}  codes ${python.code} vs ${nuage.code}`);
    return;
  }
  const gauche = ouvrirClasseur(python.octets);
  const droite = ouvrirClasseur(nuage.octets);
  const noms = [...new Set([...Object.keys(gauche), ...Object.keys(droite)])].sort();
  const differentes = noms.filter((nom) => gauche[nom] !== droite[nom]);
  if (!differentes.length) {
    console.log(`  ok    ${chemin}  (${noms.length} parties XML identiques)`);
    return;
  }
  echecs += 1;
  console.log(`  ECHEC ${chemin}  parties differentes : ${differentes.join(', ')}`);
  for (const nom of differentes.slice(0, 2)) {
    const a = gauche[nom] ?? '';
    const b = droite[nom] ?? '';
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    console.log(`        ${nom} diverge au caractere ${i}`);
    console.log(`        python : ${apercu(a.slice(Math.max(0, i - 40), i + 60))}`);
    console.log(`        nuage  : ${apercu(b.slice(Math.max(0, i - 40), i + 60))}`);
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Les divergences qu'on assume, nommées une par une.
 *
 * Une liste, pas un filtre silencieux : ce qui est ici est connu et justifié,
 * et **tout le reste échoue**. Elle est vide depuis le lot 5, qui a porté
 * `exports.py` et la vue « tableaux » — les deux entrées qui y figuraient
 * n'avaient plus de raison d'être.
 *
 * Y ajouter une ligne doit rester un acte réfléchi, jamais une façon de faire
 * taire un écart qu'on ne comprend pas.
 */
const ATTENDUES = [];

function attendue(chemin, ecarts) {
  const regle = ATTENDUES.find((r) => r.chemin === chemin);
  if (!regle) return null;
  const dehors = ecarts.filter((e) => !regle.prefixes.some((p) => e.chemin.startsWith(p)));
  return dehors.length ? null : regle;
}

let echecs = 0;
let comparees = 0;
let tolerees = 0;

async function comparer(chemin, options = {}) {
  comparees += 1;
  const [python, nuage] = await Promise.all([appelerPython(chemin), appelerCloud(chemin)]);

  if (python.code !== nuage.code) {
    echecs += 1;
    console.log(`  ECHEC ${chemin}`);
    console.log(`        codes differents : python ${python.code}, cloud ${nuage.code}`);
    console.log(`        cloud : ${apercu(nuage.donnees)}`);
    return;
  }

  let [attendu, obtenu] = [python.donnees, nuage.donnees];
  if (options.communes) [attendu, obtenu] = communes(attendu, obtenu);

  const ecarts = differences(attendu, obtenu);
  if (!ecarts.length) {
    console.log(`  ok    ${chemin}`);
    return;
  }

  const connue = attendue(chemin, ecarts);
  if (connue) {
    tolerees += 1;
    console.log(`  connu ${chemin} — ${connue.raison}`);
    return;
  }

  echecs += 1;
  console.log(`  ECHEC ${chemin} — ${ecarts.length} ecart(s)`);
  for (const ecart of ecarts.slice(0, 8)) {
    console.log(`        ${ecart.chemin || '(racine)'}`);
    console.log(`          python : ${ecart.python}`);
    console.log(`          cloud  : ${ecart.cloud}`);
  }
}

/* -------------------------------------------------------------------------- */

async function principal() {
  console.log(`Python : ${PYTHON}`);
  console.log(`Cloud  : ${CLOUD}`);
  console.log();

  console.log('-- preparation');
  const dataset = await appelerPython('/api/dataset');
  if (dataset.code !== 200) {
    console.log(`  la version Python ne repond pas (${dataset.code}). Lancez-la d'abord.`);
    process.exit(2);
  }
  console.log(
    `  document Python : ${dataset.donnees.personnes.length} fiches, ` +
      `${dataset.donnees.relations.length} liens`
  );

  const cle = execFileSync('node', ['outils/deriver.mjs', EMAIL, MOT_DE_PASSE], {
    encoding: 'utf8',
  }).trim();

  const inscription = await appelerCloud('/api/auth/inscription', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, cle, nom_affiche: 'Comparaison' }),
  });
  if (inscription.code !== 201) {
    console.log(`  inscription impossible (${inscription.code}) : ${apercu(inscription.donnees)}`);
    process.exit(2);
  }

  const importe = await appelerCloud('/api/sauvegardes/import', {
    method: 'POST',
    body: JSON.stringify(dataset.donnees),
  });
  if (importe.code !== 201) {
    console.log(`  import impossible (${importe.code}) : ${apercu(importe.donnees)}`);
    process.exit(2);
  }
  await appelerCloud(`/api/sauvegardes/${importe.donnees.sauvegarde.id}/activer`, {
    method: 'POST',
  });
  console.log(
    `  document importe : ${importe.donnees.sauvegarde.personnes} fiches, ` +
      `${importe.donnees.sauvegarde.relations} liens`
  );

  // Une personne et une maison reelles, pour les routes qui en demandent une.
  const unePersonne = dataset.donnees.personnes[0]?.id;
  const unFiltre = Object.keys(dataset.donnees.filtres ?? {})[0];

  console.log();
  console.log('-- catalogues');
  await comparer('/api/sante', { communes: true });
  await comparer('/api/referentiels');
  await comparer('/api/vues');
  await comparer('/api/maisons');
  await comparer('/api/categories');
  await comparer('/api/types-relations');
  await comparer('/api/joueurs');
  await comparer('/api/listes');
  await comparer('/api/filtres');
  await comparer('/api/filtres/valeurs?variable=maison');
  await comparer('/api/filtres/valeurs?variable=generation');
  await comparer('/api/filtres/valeurs?variable=humeur');
  await comparer('/api/lieux');

  console.log();
  console.log('-- donnees');
  await comparer('/api/personnes');
  await comparer('/api/relations');
  await comparer('/api/dataset');
  if (unePersonne) {
    await comparer(`/api/personnes/${unePersonne}`);
    await comparer(`/api/personnes/${unePersonne}?secrets=1&fratrie=0`);
  }
  if (unFiltre) await comparer(`/api/filtres/${unFiltre}/application`);

  console.log();
  console.log('-- la vue sociogramme, sous tous ses reglages');
  await comparer('/api/vue/sociogramme');
  await comparer('/api/vue/sociogramme?secrets=1');
  await comparer('/api/vue/sociogramme?fratrie=0');
  await comparer('/api/vue/sociogramme?isoles=0');
  await comparer('/api/vue/sociogramme?recherche=stark');
  await comparer('/api/vue/sociogramme?statuts=mort');
  await comparer('/api/vue/sociogramme?types=parent&types=conjoint');
  if (unePersonne) {
    await comparer(`/api/vue/sociogramme?focus=${unePersonne}&profondeur=2`);
    await comparer(`/api/vue/sociogramme?focus=${unePersonne}&profondeur=3&secrets=1`);
  }

  console.log();
  console.log('-- la vue tableaux, et les colonnes qu’elle partage avec les exports');
  // Le payload contient les cinq tableaux, colonnes et lignes comprises : si
  // une seule cellule differe entre les deux portages, ca se voit ici.
  await comparer('/api/vue/tableau');
  await comparer('/api/vue/tableau?secrets=1');


  console.log();
  console.log('-- les fichiers exportes, octet par octet');
  // Les routes JSON ne disent rien du CSV ni du classeur Excel : ce sont des
  // octets, pas des objets. On les compare donc directement — et pour le
  // .xlsx, on compare les parties XML **a l'interieur** de l'archive, parce
  // que deux zips du meme contenu ne sont pas forcement identiques (dates,
  // niveau de compression, ordre).
  for (const table of ['personnes', 'relations', 'maisons', 'types', 'joueurs']) {
    await comparerOctets(`/api/export/csv?table=${table}&secrets=1`);
  }
  await comparerClasseur('/api/export/xlsx?secrets=1');

  console.log();
  if (echecs === 0) {
    const suffixe = tolerees ? ` (dont ${tolerees} divergence(s) connue(s) et assumee(s))` : '';
    console.log(`Les deux versions disent la meme chose : ${comparees}/${comparees}${suffixe}.`);
  } else {
    console.log(`${echecs} route(s) divergente(s) sur ${comparees}.`);
  }
  process.exit(echecs === 0 ? 0 : 1);
}

await principal();
