/**
 * Sessions.
 *
 * Le cookie porte 32 octets tirés au hasard ; la base n'en garde que le
 * SHA-256. Une fuite de la table `sessions` ne donne donc **aucune session
 * utilisable** — c'est la même logique que pour les mots de passe.
 *
 * Pas de jeton signé, pas de secret d'application : il n'y a rien à vérifier
 * cryptographiquement, seulement une ligne à retrouver. C'est aussi pour ça que
 * le projet n'a aucun secret à déployer.
 */

import { sha256, versBase64 } from './empreintes';

export const NOM_COOKIE = 'ft_session';

/** 30 jours. Assez long pour ne pas être déconnecté entre deux séances. */
const DUREE_SECONDES = 30 * 24 * 3600;

export interface Compte {
  id: string;
  email: string;
  nom_affiche: string;
  role: string;
  /**
   * Les plafonds voyagent avec la session, et pas dans une requête à part :
   * toute écriture de sauvegarde en a besoin, et une jointure déjà faite coûte
   * moins cher qu'un aller-retour de plus vers la base.
   */
  plafond_octets: number;
  plafond_sauvegardes: number;
  /**
   * La sauvegarde que les routes du domaine éditent quand l'adresse n'en nomme
   * aucune. Elle voyage aussi avec la session : sinon chaque `/api/personnes/…`
   * paierait une requête juste pour savoir de quel monde on parle.
   */
  sauvegarde_active: string | null;
}

/** Ce qu'on montre au navigateur : ni les plafonds internes, ni rien d'autre. */
export type ComptePublic = Pick<Compte, 'id' | 'email' | 'nom_affiche' | 'role'>;

function versBase64Url(octets: Uint8Array): string {
  return versBase64(octets).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function empreinteJeton(jeton: string): Promise<string> {
  return versBase64(await sha256(new TextEncoder().encode(jeton)));
}

export async function ouvrirSession(
  base: D1Database,
  utilisateurId: string,
  agent: string
): Promise<{ jeton: string; expireLe: number }> {
  const jeton = versBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const maintenant = Math.floor(Date.now() / 1000);
  const expireLe = maintenant + DUREE_SECONDES;

  await base
    .prepare(
      `INSERT INTO sessions (jeton_hache, utilisateur_id, cree_le, expire_le, agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(await empreinteJeton(jeton), utilisateurId, maintenant, expireLe, agent.slice(0, 200))
    .run();

  return { jeton, expireLe };
}

export async function resoudreSession(base: D1Database, jeton: string): Promise<Compte | null> {
  const maintenant = Math.floor(Date.now() / 1000);
  const ligne = await base
    .prepare(
      `SELECT u.id, u.email, u.nom_affiche, u.role,
              u.plafond_octets, u.plafond_sauvegardes, u.sauvegarde_active
         FROM sessions s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.jeton_hache = ? AND s.expire_le > ?`
    )
    .bind(await empreinteJeton(jeton), maintenant)
    .first<Compte>();

  return ligne ?? null;
}

export async function fermerSession(base: D1Database, jeton: string): Promise<void> {
  await base
    .prepare('DELETE FROM sessions WHERE jeton_hache = ?')
    .bind(await empreinteJeton(jeton))
    .run();
}

/** Ferme toutes les sessions d'un compte : après un changement de mot de passe. */
export async function fermerToutesLesSessions(base: D1Database, utilisateurId: string): Promise<void> {
  await base.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').bind(utilisateurId).run();
}

/**
 * `Secure` est posé sauf en http://localhost, où le navigateur refuserait le
 * cookie et rendrait le développement local impossible.
 */
export function enteteCookie(url: string, jeton: string, dureeSecondes: number): string {
  const surHttps = new URL(url).protocol === 'https:';
  const morceaux = [
    `${NOM_COOKIE}=${jeton}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${dureeSecondes}`,
  ];
  if (surHttps) morceaux.push('Secure');
  return morceaux.join('; ');
}

export function lireCookie(entete: string | undefined, nom: string): string | null {
  if (!entete) return null;
  for (const morceau of entete.split(';')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;
    if (morceau.slice(0, separateur).trim() === nom) return morceau.slice(separateur + 1).trim();
  }
  return null;
}
