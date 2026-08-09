/**
 * Reproduit la dérivation du navigateur, pour pouvoir essayer l'API au clavier.
 *
 *   node outils/deriver.mjs vous@exemple.fr "mon mot de passe"
 *
 * Doit rester rigoureusement identique à `public/js/identite.js` : si les deux
 * divergent, les essais en ligne de commande mentiront.
 */

const TOURS_NAVIGATEUR = 600_000;
const ETIQUETTE_SEL = 'familytree|v1|';

const [, , email, motDePasse] = process.argv;
if (!email || !motDePasse) {
  console.error('usage : node outils/deriver.mjs <email> <mot de passe>');
  process.exit(1);
}

const encodeur = new TextEncoder();
const sel = new Uint8Array(
  await crypto.subtle.digest(
    'SHA-256',
    encodeur.encode(ETIQUETTE_SEL + email.trim().toLowerCase())
  )
);

const matiere = await crypto.subtle.importKey(
  'raw',
  encodeur.encode(motDePasse),
  'PBKDF2',
  false,
  ['deriveBits']
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: sel, iterations: TOURS_NAVIGATEUR, hash: 'SHA-256' },
  matiere,
  256
);

process.stdout.write(Buffer.from(bits).toString('base64'));
