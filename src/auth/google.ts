/**
 * La connexion Google — le protocole, sans les routes.
 *
 * ── Pourquoi une redirection, et pas le bouton de Google ─────────────────────
 *
 * Google propose un script (« Google Identity Services ») qui dessine son
 * bouton et fait tout dans la page. On ne s'en sert pas : la politique de
 * contenu de ce service est `script-src 'self'`, et charger un script d'un
 * tiers obligerait à l'élargir **pour tout le site**. Affaiblir la protection
 * de toutes les pages pour un bouton de connexion serait un mauvais échange.
 *
 * On fait donc le flux « Authorization Code » classique, entièrement côté
 * serveur : on renvoie le navigateur chez Google, Google le renvoie ici avec un
 * code, et le Worker échange ce code contre un jeton **en parlant directement à
 * Google**. Rien de tout cela n'a besoin de JavaScript.
 *
 * ── Ce qui est vérifié, et ce qui ne l'est pas ───────────────────────────────
 *
 * L'`id_token` arrive par une connexion TLS que le Worker a lui-même ouverte
 * vers `oauth2.googleapis.com`, en s'authentifiant avec le secret client.
 * OpenID Connect (Core 1.0, § 3.1.3.7) dit explicitement que dans ce cas la
 * validation TLS du serveur **tient lieu** de vérification de signature. On ne
 * refait donc pas la vérification RSA contre le JWKS : ce serait du code
 * cryptographique de plus, avec ses propres façons d'être faux, pour un gain
 * nul tant qu'on n'accepte jamais un `id_token` venu d'ailleurs.
 *
 * **Et on n'en accepte jamais d'ailleurs** : il n'existe aucune route qui
 * prenne un `id_token` en entrée. C'est ce qui rend le raccourci légitime, et
 * c'est la propriété à ne pas casser.
 *
 * En revanche les *revendications* sont vérifiées, toutes : émetteur,
 * destinataire, expiration, `nonce`, et adresse confirmée.
 */

const AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const JETON = 'https://oauth2.googleapis.com/token';

/** Les deux valeurs que Google se permet d'émettre comme `iss`. */
const EMETTEURS = ['https://accounts.google.com', 'accounts.google.com'];

/** Le chemin de retour, en dur : il doit correspondre à la console Google. */
export const CHEMIN_RETOUR = '/api/auth/google/retour';

/** Dix minutes : le temps d'un écran de consentement, pas plus. */
export const DUREE_ALLER = 600;

export function googleConfigure(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** L'identité que Google nous rend, une fois tout vérifié. */
export interface Identite {
  /** L'identifiant stable du compte Google. Ne change jamais, ne se réattribue pas. */
  sub: string;
  email: string;
}

export class ErreurGoogle extends Error {}

/* --------------------------------------------------------------------------
 * L'aller
 * -------------------------------------------------------------------------- */

/**
 * L'adresse chez Google, avec le `state` et le `nonce` déjà dedans.
 *
 * `state` protège du CSRF : c'est lui qu'on retrouvera dans un cookie au
 * retour. `nonce` protège du rejeu d'un `id_token` : Google le recopie dans le
 * jeton, et on vérifie qu'il correspond.
 *
 * `prompt=select_account` parce que quelqu'un qui a plusieurs comptes Google
 * doit pouvoir choisir : sans ça, Google réutilise silencieusement le dernier,
 * et on se retrouve connecté sous une identité qu'on n'a pas voulue.
 */
export function adresseDAutorisation(
  env: Env,
  racine: string,
  state: string,
  nonce: string
): string {
  const parametres = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID),
    redirect_uri: `${racine}${CHEMIN_RETOUR}`,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `${AUTORISATION}?${parametres}`;
}

/* --------------------------------------------------------------------------
 * Le retour
 * -------------------------------------------------------------------------- */

/**
 * Échange le code contre un `id_token`, puis en vérifie les revendications.
 *
 * Lève `ErreurGoogle` avec un message court : il finira dans une adresse de
 * redirection, donc il ne doit rien porter de sensible ni de trop long.
 */
export async function identiteDepuisCode(
  env: Env,
  racine: string,
  code: string,
  nonceAttendu: string
): Promise<Identite> {
  const reponse = await fetch(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: String(env.GOOGLE_CLIENT_ID),
      client_secret: String(env.GOOGLE_CLIENT_SECRET),
      redirect_uri: `${racine}${CHEMIN_RETOUR}`,
      grant_type: 'authorization_code',
    }),
  });

  if (!reponse.ok) {
    // Le corps de Google peut contenir des détails de configuration : on le
    // journalise, on ne le renvoie pas.
    console.error('google : échange du code refusé', reponse.status, await reponse.text());
    throw new ErreurGoogle('Google a refusé la connexion');
  }

  const corps = (await reponse.json()) as { id_token?: unknown };
  if (typeof corps.id_token !== 'string') throw new ErreurGoogle('réponse de Google inattendue');

  return verifierRevendications(env, corps.id_token, nonceAttendu);
}

interface Revendications {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  sub?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/**
 * Les revendications du jeton, une par une. Aucune n'est facultative.
 *
 * `email_verified` compte autant que le reste : une adresse non confirmée
 * permettrait de se faire passer pour le titulaire d'un compte existant chez
 * nous, puisque c'est l'adresse qui sert au premier rapprochement.
 */
function verifierRevendications(env: Env, idToken: string, nonceAttendu: string): Identite {
  const morceaux = idToken.split('.');
  if (morceaux.length !== 3) throw new ErreurGoogle('jeton illisible');

  let revendications: Revendications;
  try {
    revendications = JSON.parse(new TextDecoder().decode(depuisBase64Url(morceaux[1] as string)));
  } catch {
    throw new ErreurGoogle('jeton illisible');
  }

  if (!EMETTEURS.includes(String(revendications.iss))) {
    throw new ErreurGoogle('émetteur inattendu');
  }
  if (String(revendications.aud) !== String(env.GOOGLE_CLIENT_ID)) {
    throw new ErreurGoogle('jeton émis pour une autre application');
  }
  const expiration = Number(revendications.exp);
  if (!Number.isFinite(expiration) || expiration < Math.floor(Date.now() / 1000)) {
    throw new ErreurGoogle('jeton expiré');
  }
  // Comparaison stricte, et le nonce attendu ne peut pas être vide : sans ça,
  // un jeton sans `nonce` passerait en comparant '' à ''.
  if (!nonceAttendu || String(revendications.nonce) !== nonceAttendu) {
    throw new ErreurGoogle('jeton rejoué');
  }
  if (revendications.email_verified !== true) {
    throw new ErreurGoogle('adresse Google non confirmée');
  }

  const sub = String(revendications.sub ?? '');
  const email = String(revendications.email ?? '');
  if (!sub || !email) throw new ErreurGoogle('jeton incomplet');

  return { sub, email };
}

function depuisBase64Url(texte: string): Uint8Array {
  const base64 = texte.replace(/-/g, '+').replace(/_/g, '/');
  const binaire = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
}
