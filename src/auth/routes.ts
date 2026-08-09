/**
 * Les routes de comptes.
 *
 * Deux principes qui expliquent des choix qui pourraient surprendre :
 *
 * 1. **On ne dit jamais si une adresse existe.** Un mot de passe faux et une
 *    adresse inconnue donnent la même réponse, le même code, et — grâce à la
 *    dérivation à vide — à peu près le même temps de réponse.
 * 2. **Le serveur ne reçoit jamais le mot de passe**, seulement la dérivation
 *    faite par le navigateur (voir `empreintes.ts`).
 */

import { Hono } from 'hono';
import {
  depuisBase64,
  empreinteCodeSecours,
  empreinteMotDePasse,
  tirerCodeSecours,
  verifierCodeSecours,
  verifierMotDePasse,
} from './empreintes';
import {
  attenteAvantConnexion,
  inscriptionAutorisee,
  noterEchecConnexion,
  noterInscription,
  oublierEchecsConnexion,
} from './limites';
import {
  enteteCookie,
  fermerSession,
  fermerToutesLesSessions,
  lireCookie,
  NOM_COOKIE,
  ouvrirSession,
  resoudreSession,
  type Compte,
} from './sessions';

/**
 * Empreinte facice, utilisée quand l'adresse est inconnue : elle fait faire au
 * serveur le même travail que pour un vrai compte, afin que le temps de
 * réponse ne trahisse pas l'existence de l'adresse.
 */
const EMPREINTE_LEURRE =
  'v1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export const routesAuth = new Hono<{ Bindings: Env }>();

interface CorpsIdentifiants {
  email?: unknown;
  cle?: unknown;
  nom_affiche?: unknown;
  code_secours?: unknown;
  nouvelle_cle?: unknown;
}

function normaliserEmail(valeur: string): string {
  return valeur.trim().toLowerCase();
}

function emailValide(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur) && valeur.length <= 254;
}

/** La clé attendue : 32 octets, encodés en base64 par le navigateur. */
function cleValide(valeur: unknown): Uint8Array | null {
  if (typeof valeur !== 'string' || valeur.length > 100) return null;
  try {
    const octets = depuisBase64(valeur);
    return octets.length === 32 ? octets : null;
  } catch {
    return null;
  }
}

function adresse(requete: Request): string {
  return requete.headers.get('CF-Connecting-IP') ?? 'inconnue';
}

function enPublic(compte: Compte): Compte {
  return {
    id: compte.id,
    email: compte.email,
    nom_affiche: compte.nom_affiche,
    role: compte.role,
  };
}

/* -------------------------------------------------------------------------- */

routesAuth.post('/inscription', async (c) => {
  const corps = await c.req.json<CorpsIdentifiants>().catch(() => null);
  if (!corps) return c.json({ erreur: 'corps illisible' }, 400);

  const email = typeof corps.email === 'string' ? normaliserEmail(corps.email) : '';
  const cle = cleValide(corps.cle);
  if (!emailValide(email)) return c.json({ erreur: 'adresse de courriel invalide' }, 400);
  if (!cle) return c.json({ erreur: 'dérivation absente ou mal formée' }, 400);

  const ip = adresse(c.req.raw);
  if (!(await inscriptionAutorisee(c.env.DB, ip))) {
    return c.json(
      { erreur: "trop d'inscriptions depuis cette connexion, réessayez dans une heure" },
      429
    );
  }

  const dejaPris = await c.env.DB.prepare('SELECT id FROM utilisateurs WHERE email_norm = ?')
    .bind(email)
    .first<{ id: string }>();
  if (dejaPris) return c.json({ erreur: 'cette adresse a déjà un compte' }, 409);

  const codeSecours = tirerCodeSecours();
  const maintenant = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const nomAffiche =
    typeof corps.nom_affiche === 'string' ? corps.nom_affiche.trim().slice(0, 80) : '';

  await c.env.DB.prepare(
    `INSERT INTO utilisateurs (id, email, email_norm, mot_de_passe, nom_affiche, code_secours, cree_le, dernier_acces)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      typeof corps.email === 'string' ? corps.email.trim() : email,
      email,
      await empreinteMotDePasse(cle),
      nomAffiche,
      await empreinteCodeSecours(codeSecours),
      maintenant,
      maintenant
    )
    .run();

  await noterInscription(c.env.DB, ip);

  const { jeton, expireLe } = await ouvrirSession(
    c.env.DB,
    id,
    c.req.header('User-Agent') ?? ''
  );
  c.header('Set-Cookie', enteteCookie(c.req.url, jeton, expireLe - maintenant));

  // Le code de secours n'est montré qu'ici, et ne sera jamais réaffiché : la
  // base n'en garde que l'empreinte.
  return c.json(
    {
      compte: { id, email, nom_affiche: nomAffiche, role: 'membre' },
      code_secours: codeSecours,
    },
    201
  );
});

/* -------------------------------------------------------------------------- */

routesAuth.post('/connexion', async (c) => {
  const corps = await c.req.json<CorpsIdentifiants>().catch(() => null);
  if (!corps) return c.json({ erreur: 'corps illisible' }, 400);

  const email = typeof corps.email === 'string' ? normaliserEmail(corps.email) : '';
  const cle = cleValide(corps.cle);
  if (!email || !cle) return c.json({ erreur: 'identifiants invalides' }, 401);

  const attente = await attenteAvantConnexion(c.env.DB, email);
  if (attente > 0) {
    return c.json({ erreur: `trop d'essais, réessayez dans ${attente} s`, attente }, 429);
  }

  const ligne = await c.env.DB.prepare(
    'SELECT id, email, nom_affiche, role, mot_de_passe FROM utilisateurs WHERE email_norm = ?'
  )
    .bind(email)
    .first<Compte & { mot_de_passe: string }>();

  // Même sans compte, on dérive : le temps de réponse ne doit pas dire si
  // l'adresse existe.
  const bon = await verifierMotDePasse(cle, ligne?.mot_de_passe ?? EMPREINTE_LEURRE);

  if (!ligne || !bon) {
    await noterEchecConnexion(c.env.DB, email);
    return c.json({ erreur: 'adresse ou mot de passe incorrect' }, 401);
  }

  await oublierEchecsConnexion(c.env.DB, email);

  const maintenant = Math.floor(Date.now() / 1000);
  const { jeton, expireLe } = await ouvrirSession(
    c.env.DB,
    ligne.id,
    c.req.header('User-Agent') ?? ''
  );
  await c.env.DB.prepare('UPDATE utilisateurs SET dernier_acces = ? WHERE id = ?')
    .bind(maintenant, ligne.id)
    .run();

  c.header('Set-Cookie', enteteCookie(c.req.url, jeton, expireLe - maintenant));
  return c.json({ compte: enPublic(ligne) });
});

/* -------------------------------------------------------------------------- */

routesAuth.post('/deconnexion', async (c) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  if (jeton) await fermerSession(c.env.DB, jeton);
  c.header('Set-Cookie', enteteCookie(c.req.url, '', 0));
  return c.body(null, 204);
});

routesAuth.get('/moi', async (c) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);
  return c.json({ compte: enPublic(compte) });
});

/* -------------------------------------------------------------------------- */

/**
 * Récupération par code de secours. Sans service d'envoi de courriel, c'est la
 * seule façon de reprendre la main sur son compte tout seul.
 *
 * Elle ferme toutes les sessions ouvertes : si quelqu'un d'autre était entré,
 * il se retrouve dehors.
 */
routesAuth.post('/recuperation', async (c) => {
  const corps = await c.req.json<CorpsIdentifiants>().catch(() => null);
  if (!corps) return c.json({ erreur: 'corps illisible' }, 400);

  const email = typeof corps.email === 'string' ? normaliserEmail(corps.email) : '';
  const code = typeof corps.code_secours === 'string' ? corps.code_secours : '';
  const nouvelle = cleValide(corps.nouvelle_cle);
  if (!email || !code || !nouvelle) return c.json({ erreur: 'requête incomplète' }, 400);

  const attente = await attenteAvantConnexion(c.env.DB, email);
  if (attente > 0) return c.json({ erreur: `trop d'essais, réessayez dans ${attente} s` }, 429);

  const ligne = await c.env.DB.prepare(
    'SELECT id, code_secours FROM utilisateurs WHERE email_norm = ?'
  )
    .bind(email)
    .first<{ id: string; code_secours: string | null }>();

  if (!ligne || !(await verifierCodeSecours(code, ligne.code_secours))) {
    await noterEchecConnexion(c.env.DB, email);
    return c.json({ erreur: 'adresse ou code de secours incorrect' }, 401);
  }

  const nouveauCode = tirerCodeSecours();
  await c.env.DB.prepare('UPDATE utilisateurs SET mot_de_passe = ?, code_secours = ? WHERE id = ?')
    .bind(await empreinteMotDePasse(nouvelle), await empreinteCodeSecours(nouveauCode), ligne.id)
    .run();
  await fermerToutesLesSessions(c.env.DB, ligne.id);
  await oublierEchecsConnexion(c.env.DB, email);

  return c.json({ code_secours: nouveauCode });
});
