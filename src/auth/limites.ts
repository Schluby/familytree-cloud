/**
 * Freins contre le bourrinage et l'inscription en série.
 *
 * L'inscription étant ouverte à qui veut, c'est le seul rempart contre la
 * création de comptes à la chaîne : sans lui, un script peut remplir la base.
 *
 * Le compteur vit dans la table `tentatives`, une ligne par clé
 * (« connexion:email:… », « inscription:ip:… »). Le ménage nocturne efface ce
 * qui a plus d'un jour.
 */

const SEUIL_CONNEXION = 5;
const ATTENTE_MAXIMALE = 300; // 5 minutes
const INSCRIPTIONS_PAR_HEURE = 3;

interface Tentative {
  echecs: number;
  dernier_le: number;
}

async function lire(base: D1Database, cle: string): Promise<Tentative | null> {
  return base
    .prepare('SELECT echecs, dernier_le FROM tentatives WHERE cle = ?')
    .bind(cle)
    .first<Tentative>();
}

/**
 * Renvoie le nombre de secondes à attendre, 0 si la voie est libre.
 *
 * L'attente double à chaque échec au-delà du seuil : imperceptible pour
 * quelqu'un qui se trompe une fois, décourageant pour une machine.
 */
export async function attenteAvantConnexion(base: D1Database, email: string): Promise<number> {
  const tentative = await lire(base, `connexion:email:${email}`);
  if (!tentative || tentative.echecs < SEUIL_CONNEXION) return 0;

  const attendu = Math.min(2 ** (tentative.echecs - SEUIL_CONNEXION + 1), ATTENTE_MAXIMALE);
  const ecoule = Math.floor(Date.now() / 1000) - tentative.dernier_le;
  return ecoule >= attendu ? 0 : attendu - ecoule;
}

export async function noterEchecConnexion(base: D1Database, email: string): Promise<void> {
  const maintenant = Math.floor(Date.now() / 1000);
  await base
    .prepare(
      `INSERT INTO tentatives (cle, echecs, dernier_le) VALUES (?, 1, ?)
       ON CONFLICT(cle) DO UPDATE SET echecs = echecs + 1, dernier_le = excluded.dernier_le`
    )
    .bind(`connexion:email:${email}`, maintenant)
    .run();
}

export async function oublierEchecsConnexion(base: D1Database, email: string): Promise<void> {
  await base.prepare('DELETE FROM tentatives WHERE cle = ?').bind(`connexion:email:${email}`).run();
}

/** Vrai si l'adresse a encore droit à une inscription dans l'heure. */
export async function inscriptionAutorisee(base: D1Database, ip: string): Promise<boolean> {
  const tentative = await lire(base, `inscription:ip:${ip}`);
  if (!tentative) return true;
  const ecoule = Math.floor(Date.now() / 1000) - tentative.dernier_le;
  if (ecoule >= 3600) return true;
  return tentative.echecs < INSCRIPTIONS_PAR_HEURE;
}

export async function noterInscription(base: D1Database, ip: string): Promise<void> {
  const maintenant = Math.floor(Date.now() / 1000);
  const cle = `inscription:ip:${ip}`;
  const tentative = await lire(base, cle);
  const repart = !tentative || maintenant - tentative.dernier_le >= 3600;

  await base
    .prepare(
      repart
        ? `INSERT INTO tentatives (cle, echecs, dernier_le) VALUES (?, 1, ?)
           ON CONFLICT(cle) DO UPDATE SET echecs = 1, dernier_le = excluded.dernier_le`
        : `INSERT INTO tentatives (cle, echecs, dernier_le) VALUES (?, 1, ?)
           ON CONFLICT(cle) DO UPDATE SET echecs = echecs + 1, dernier_le = excluded.dernier_le`
    )
    .bind(cle, maintenant)
    .run();
}
