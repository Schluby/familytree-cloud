/**
 * Empreintes : mots de passe et codes de secours.
 *
 * ── Pourquoi une dérivation en deux temps ────────────────────────────────────
 *
 * Mesuré en production le 09/08/2026 : Cloudflare **refuse** PBKDF2 au-delà de
 * 100 000 tours (« NotSupportedError: iteration counts above 100000 are not
 * supported »), et 100 000 tours coûtent déjà 19 ms de CPU, soit le double du
 * budget documenté du plan gratuit. Les 210 000 tours prévus au plan étaient
 * donc irréalisables, et s'en approcher serait parier sur une tolérance que
 * Cloudflare ne promet pas.
 *
 * D'où le partage du travail :
 *
 *   navigateur : cle = PBKDF2(mot de passe, sel_deterministe, 600 000 tours)
 *   serveur    : empreinte = PBKDF2(cle, sel_aleatoire, 25 000 tours)
 *
 * Ce que ça donne :
 *
 * - Pour retrouver un mot de passe à partir d'une base volée, il faut refaire
 *   les deux étages : 625 000 tours par essai, au-dessus des recommandations
 *   de 2026 pour PBKDF2-SHA256.
 * - Le serveur ne voit **jamais** le mot de passe, seulement une dérivation.
 *   Même une trace de requête mal configurée ne peut pas le divulguer.
 * - Le coût côté serveur retombe à ~4 ms de CPU : on reste dans le budget.
 *
 * Le prix : la page de connexion a besoin de JavaScript. L'application entière
 * en a besoin de toute façon.
 *
 * Le format stocké porte sa version — « v1$sel$empreinte » — pour qu'on puisse
 * un jour changer de paramètres sans invalider les comptes existants.
 */

const TOURS_SERVEUR = 25_000;
const VERSION = 'v1';
const OCTETS_SEL = 16;

/** Alphabet sans caractères qu'on confond en les recopiant (ni I, ni O, ni 0, ni 1). */
const ALPHABET_SECOURS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function versBase64(octets: Uint8Array): string {
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

export function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

async function deriver(matiere: Uint8Array, sel: Uint8Array, tours: number): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey('raw', matiere as BufferSource, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sel as BufferSource, iterations: tours, hash: 'SHA-256' },
    cle,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Comparaison à temps constant : on parcourt toujours toute la longueur, pour
 * qu'un attaquant ne puisse pas deviner l'empreinte octet par octet en
 * chronométrant les réponses.
 */
function memesOctets(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= (a[i] as number) ^ (b[i] as number);
  return ecart === 0;
}

/** `cleClient` est la dérivation faite par le navigateur, décodée. */
export async function empreinteMotDePasse(cleClient: Uint8Array): Promise<string> {
  const sel = crypto.getRandomValues(new Uint8Array(OCTETS_SEL));
  const empreinte = await deriver(cleClient, sel, TOURS_SERVEUR);
  return `${VERSION}$${versBase64(sel)}$${versBase64(empreinte)}`;
}

export async function verifierMotDePasse(cleClient: Uint8Array, stocke: string): Promise<boolean> {
  const morceaux = stocke.split('$');
  if (morceaux.length !== 3 || morceaux[0] !== VERSION) return false;
  const sel = depuisBase64(morceaux[1] as string);
  const attendue = depuisBase64(morceaux[2] as string);
  const obtenue = await deriver(cleClient, sel, TOURS_SERVEUR);
  return memesOctets(obtenue, attendue);
}

/**
 * Code de secours : 20 caractères tirés au hasard, soit ~100 bits d'entropie.
 * Un simple SHA-256 salé suffit ici — contrairement à un mot de passe choisi
 * par un humain, il n'y a rien à deviner, donc rien à ralentir. Ça évite
 * 4 ms de CPU de plus à chaque inscription.
 */
export function tirerCodeSecours(): string {
  const brut = crypto.getRandomValues(new Uint8Array(20));
  const lettres = Array.from(brut, (n) => ALPHABET_SECOURS[n % ALPHABET_SECOURS.length]);
  return [0, 5, 10, 15].map((d) => lettres.slice(d, d + 5).join('')).join('-');
}

export async function empreinteCodeSecours(code: string): Promise<string> {
  const sel = crypto.getRandomValues(new Uint8Array(OCTETS_SEL));
  const empreinte = await sha256(concat(sel, new TextEncoder().encode(normaliserCode(code))));
  return `${VERSION}$${versBase64(sel)}$${versBase64(empreinte)}`;
}

export async function verifierCodeSecours(code: string, stocke: string | null): Promise<boolean> {
  if (!stocke) return false;
  const morceaux = stocke.split('$');
  if (morceaux.length !== 3 || morceaux[0] !== VERSION) return false;
  const sel = depuisBase64(morceaux[1] as string);
  const attendue = depuisBase64(morceaux[2] as string);
  const obtenue = await sha256(concat(sel, new TextEncoder().encode(normaliserCode(code))));
  return memesOctets(obtenue, attendue);
}

/** On recopie un code à la main : les tirets et la casse ne doivent pas compter. */
function normaliserCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function sha256(octets: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', octets as BufferSource));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const sortie = new Uint8Array(a.length + b.length);
  sortie.set(a, 0);
  sortie.set(b, a.length);
  return sortie;
}
