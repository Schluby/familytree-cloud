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
import { envoiConfigure, envoyerLienReinitialisation, racinePublique } from './courriel';
import {
  depuisBase64,
  empreinteCodeSecours,
  empreinteMotDePasse,
  sha256,
  tirerCodeSecours,
  verifierCodeSecours,
  verifierMotDePasse,
  versBase64,
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
  type ComptePublic,
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
export function cleValide(valeur: unknown): Uint8Array | null {
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

function enPublic(compte: ComptePublic): ComptePublic {
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
    .first<ComptePublic & { mot_de_passe: string }>();

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

/* --------------------------------------------------------------------------
 * « Vos données » : ce qui est gardé, et comment tout reprendre ou tout
 * effacer.
 *
 * Rien ici n'est un privilège : c'est le pendant honnête d'un service qui
 * héberge le travail de quelqu'un d'autre. La page qui s'en sert est
 * `public/donnees.html`.
 * -------------------------------------------------------------------------- */

routesAuth.get('/donnees', async (c) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);

  const maintenant = Math.floor(Date.now() / 1000);
  const ligne = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM sauvegardes WHERE utilisateur_id = ?1)        AS sauvegardes,
       (SELECT COALESCE(SUM(taille), 0) FROM sauvegardes WHERE utilisateur_id = ?1) AS octets,
       (SELECT COALESCE(SUM(personnes), 0) FROM sauvegardes WHERE utilisateur_id = ?1) AS personnes,
       (SELECT COALESCE(SUM(relations), 0) FROM sauvegardes WHERE utilisateur_id = ?1) AS relations,
       (SELECT COUNT(*) FROM sessions WHERE utilisateur_id = ?1 AND expire_le > ?2) AS sessions,
       (SELECT cree_le FROM utilisateurs WHERE id = ?1)                    AS cree_le,
       (SELECT dernier_acces FROM utilisateurs WHERE id = ?1)              AS dernier_acces`
  )
    .bind(compte.id, maintenant)
    .first<{
      sauvegardes: number;
      octets: number;
      personnes: number;
      relations: number;
      sessions: number;
      cree_le: number;
      dernier_acces: number;
    }>();

  return c.json({
    compte: enPublic(compte),
    cree_le: ligne?.cree_le ?? null,
    dernier_acces: ligne?.dernier_acces ?? null,
    contenu: {
      sauvegardes: ligne?.sauvegardes ?? 0,
      personnes: ligne?.personnes ?? 0,
      relations: ligne?.relations ?? 0,
      octets: ligne?.octets ?? 0,
    },
    sessions_ouvertes: ligne?.sessions ?? 0,
    plafonds: {
      sauvegardes: compte.plafond_sauvegardes,
      octets: compte.plafond_octets,
    },
  });
});

/**
 * Effacement du compte, et de tout ce qui pend après lui.
 *
 * Gardé par le **mot de passe**, pas par la seule session : un onglet resté
 * ouvert sur un poste partagé ne doit pas suffire à effacer une campagne. La
 * clé arrive dérivée par le navigateur, comme à la connexion — le mot de passe
 * lui-même ne quitte jamais la page.
 *
 * Les suppressions en cascade du schéma emportent sauvegardes, contenus,
 * instantanés et sessions : une seule ligne à effacer, et il ne reste rien.
 */
routesAuth.delete('/compte', async (c) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);

  const corps = await c.req.json<CorpsIdentifiants>().catch(() => null);
  const cle = cleValide(corps?.cle);
  if (!cle) return c.json({ erreur: 'mot de passe requis' }, 400);

  const ligne = await c.env.DB.prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = ?')
    .bind(compte.id)
    .first<{ mot_de_passe: string }>();
  const bon = await verifierMotDePasse(cle, ligne?.mot_de_passe ?? EMPREINTE_LEURRE);
  if (!bon) return c.json({ erreur: 'mot de passe incorrect' }, 401);

  await c.env.DB.prepare('DELETE FROM utilisateurs WHERE id = ?').bind(compte.id).run();
  c.header('Set-Cookie', enteteCookie(c.req.url, '', 0));
  return c.body(null, 204);
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

/* --------------------------------------------------------------------------
 * Mot de passe oublié — le lien par courriel (lot 8.G)
 * -------------------------------------------------------------------------- */

/** Une heure : assez pour aller relever ses courriels, trop peu pour traîner. */
const DUREE_JETON = 3600;

/** Le jeton part dans un lien : base64url, sans caractère à échapper. */
function tirerJeton(): string {
  return versBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const empreinteJeton = async (jeton: string) =>
  versBase64(await sha256(new TextEncoder().encode(jeton)));

/**
 * De quoi dispose cette instance pour récupérer un compte.
 *
 * Une seule information, qui ne dépend que de la configuration du serveur :
 * y a-t-il un service d'envoi branché ? La page de connexion s'en sert pour
 * proposer le lien par courriel — ou, à défaut, pour ne rien promettre.
 */
routesAuth.get('/moyens', (c) => c.json({ courriel: envoiConfigure(c.env) }));

/**
 * « J'ai oublié mon mot de passe. »
 *
 * **La réponse est la même que l'adresse existe ou non.** Sans cela, cette
 * route deviendrait un moyen de savoir qui a un compte ici — et la seule chose
 * qu'on sache de nos utilisateurs, c'est justement leur adresse.
 *
 * `envoi_configure` dit si un service d'envoi est branché. Ce n'est pas une
 * fuite : la réponse ne dépend que de la configuration du serveur, jamais de
 * l'adresse saisie. C'est ce qui permet à la page de proposer le code de
 * secours quand il n'y a pas de courriel possible, plutôt que de laisser
 * quelqu'un attendre un message qui ne viendra jamais.
 */
routesAuth.post('/mot-de-passe-oublie', async (c) => {
  const corps = await c.req.json<CorpsIdentifiants>().catch(() => null);
  const email = typeof corps?.email === 'string' ? normaliserEmail(corps.email) : '';
  const configure = envoiConfigure(c.env);
  if (!emailValide(email)) return c.json({ erreur: 'adresse de courriel invalide' }, 400);

  // Le même compteur que les échecs de connexion : sans lui, cette route
  // servirait à faire envoyer des courriels en rafale à quelqu'un d'autre.
  const attente = await attenteAvantConnexion(c.env.DB, email);
  if (attente > 0) return c.json({ erreur: `trop d'essais, réessayez dans ${attente} s` }, 429);

  const reponse = { envoi_configure: configure };
  if (!configure) return c.json(reponse);

  const ligne = await c.env.DB.prepare('SELECT id, email FROM utilisateurs WHERE email_norm = ?')
    .bind(email)
    .first<{ id: string; email: string }>();

  if (ligne) {
    const jeton = tirerJeton();
    const maintenant = Math.floor(Date.now() / 1000);
    // Les demandes précédentes tombent : un seul lien vivant à la fois, sinon
    // un ancien courriel oublié dans une boîte reste une porte ouverte.
    await c.env.DB.prepare(
      'UPDATE reinitialisations SET utilise_le = ? WHERE utilisateur_id = ? AND utilise_le IS NULL'
    )
      .bind(maintenant, ligne.id)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO reinitialisations (jeton_empreinte, utilisateur_id, cree_le, expire_le)
       VALUES (?, ?, ?, ?)`
    )
      .bind(await empreinteJeton(jeton), ligne.id, maintenant, maintenant + DUREE_JETON)
      .run();

    const lien = `${racinePublique(c.env, c.req.raw)}/mot-de-passe-oublie.html?jeton=${jeton}`;
    const resultat = await envoyerLienReinitialisation(c.env, ligne.email, lien);
    // L'échec est journalisé côté serveur, jamais renvoyé : le dire
    // trahirait l'existence du compte.
    if (!resultat.envoye) console.error('courriel non envoyé :', resultat.raison);
  }

  await noterEchecConnexion(c.env.DB, email);
  return c.json(reponse);
});

/**
 * Le lien vient d'être ouvert : à qui appartient-il ?
 *
 * Ce n'est pas une fuite d'adresse : pour poser la question il faut déjà tenir
 * le jeton, et le jeton n'a été envoyé qu'à cette adresse-là. C'est en
 * revanche une nécessité — le navigateur dérive la clé **à partir de
 * l'adresse** (voir `empreintes.ts`), donc quelqu'un qui la retaperait de
 * travers se fabriquerait un mot de passe avec lequel il ne pourrait plus
 * entrer. Autant la lui donner.
 */
routesAuth.get('/reinitialisation', async (c) => {
  const jeton = c.req.query('jeton') ?? '';
  if (!jeton) return c.json({ erreur: 'jeton absent' }, 400);

  const ligne = await c.env.DB.prepare(
    `SELECT u.email, r.expire_le, r.utilise_le
       FROM reinitialisations r
       JOIN utilisateurs u ON u.id = r.utilisateur_id
      WHERE r.jeton_empreinte = ?`
  )
    .bind(await empreinteJeton(jeton))
    .first<{ email: string; expire_le: number; utilise_le: number | null }>();

  if (!ligne || ligne.utilise_le !== null || ligne.expire_le < Math.floor(Date.now() / 1000)) {
    return c.json({ erreur: 'ce lien n’est plus valable' }, 410);
  }
  return c.json({ email: ligne.email, expire_le: ligne.expire_le });
});

/**
 * Le lien a été suivi : on pose le nouveau mot de passe.
 *
 * **Les sauvegardes ne bougent pas** — elles pendent à `utilisateurs.id`, qui
 * ne change pas. Ce qui change : l'empreinte du mot de passe, le code de
 * secours (l'ancien a pu être vu par qui a demandé la réinitialisation), et
 * toutes les sessions ouvertes, qui se ferment.
 */
routesAuth.post('/nouveau-mot-de-passe', async (c) => {
  const corps = await c.req.json<CorpsIdentifiants & { jeton?: unknown }>().catch(() => null);
  const jeton = typeof corps?.jeton === 'string' ? corps.jeton : '';
  const nouvelle = cleValide(corps?.nouvelle_cle);
  if (!jeton || !nouvelle) return c.json({ erreur: 'requête incomplète' }, 400);

  const maintenant = Math.floor(Date.now() / 1000);
  const ligne = await c.env.DB.prepare(
    `SELECT utilisateur_id, expire_le, utilise_le
       FROM reinitialisations WHERE jeton_empreinte = ?`
  )
    .bind(await empreinteJeton(jeton))
    .first<{ utilisateur_id: string; expire_le: number; utilise_le: number | null }>();

  if (!ligne || ligne.utilise_le !== null || ligne.expire_le < maintenant) {
    return c.json(
      {
        erreur: 'ce lien n’est plus valable',
        indice: 'les liens durent une heure et ne servent qu’une fois — redemandez-en un',
      },
      410
    );
  }

  // Consommé d'abord : si l'écriture suivante échoue, le lien est quand même
  // brûlé. Mieux vaut redemander un courriel que laisser un jeton rejouable.
  await c.env.DB.prepare('UPDATE reinitialisations SET utilise_le = ? WHERE jeton_empreinte = ?')
    .bind(maintenant, await empreinteJeton(jeton))
    .run();

  const nouveauCode = tirerCodeSecours();
  await c.env.DB.prepare('UPDATE utilisateurs SET mot_de_passe = ?, code_secours = ? WHERE id = ?')
    .bind(
      await empreinteMotDePasse(nouvelle),
      await empreinteCodeSecours(nouveauCode),
      ligne.utilisateur_id
    )
    .run();
  await fermerToutesLesSessions(c.env.DB, ligne.utilisateur_id);

  return c.json({ code_secours: nouveauCode });
});
