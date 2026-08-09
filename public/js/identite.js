/**
 * Dérivation du mot de passe, côté navigateur.
 *
 * Le mot de passe ne quitte jamais cette page : ce qui part sur le réseau est
 * `cle`, une dérivation PBKDF2 de 600 000 tours dont on ne peut pas revenir en
 * arrière. Le serveur la redérive une seconde fois avant de la stocker.
 *
 * Pourquoi ici et pas seulement sur le serveur : Cloudflare plafonne PBKDF2 à
 * 100 000 tours (mesuré le 09/08/2026), en dessous des recommandations
 * actuelles. Le navigateur, lui, n'a pas cette limite — et il a du temps à
 * perdre, une fois, au moment de la connexion.
 *
 * Le sel est déterministe, dérivé de l'adresse : sinon il faudrait le demander
 * au serveur avant de pouvoir se connecter, ce qui révélerait quelles adresses
 * ont un compte.
 */

export const TOURS_NAVIGATEUR = 600_000;
const ETIQUETTE_SEL = 'familytree|v1|';

export function normaliserEmail(valeur) {
  return valeur.trim().toLowerCase();
}

export async function deriverCle(email, motDePasse) {
  if (!crypto?.subtle) {
    throw new Error(
      "Ce navigateur ne permet pas de chiffrer le mot de passe. Vérifiez que l'adresse commence par https://"
    );
  }

  const encodeur = new TextEncoder();
  const sel = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encodeur.encode(ETIQUETTE_SEL + normaliserEmail(email)))
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

  let binaire = '';
  for (const octet of new Uint8Array(bits)) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

/** Petit enrobage : renvoie toujours { ok, code, donnees }. */
export async function appeler(chemin, options = {}) {
  const reponse = await fetch(chemin, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });

  let donnees = null;
  if (reponse.status !== 204) {
    donnees = await reponse.json().catch(() => null);
  }
  return { ok: reponse.ok, code: reponse.status, donnees };
}

export async function compteConnecte() {
  const { ok, donnees } = await appeler('/api/auth/moi');
  return ok ? donnees.compte : null;
}
