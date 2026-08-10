/**
 * Le journal des administrateurs.
 *
 * Toute consultation ou tout export d'un arbre qui n'est pas le sien laisse une
 * trace. Ce n'est pas une formalité : **c'est la contrepartie du pouvoir de
 * regarder**. Elle protège l'utilisateur, qui peut demander qui a ouvert son
 * arbre, et elle protège l'administrateur, dont les gestes sont datés.
 *
 * D'où deux choix :
 *
 * - **Le journal ne s'efface pas.** Aucune route ne le supprime, pas même pour
 *   un admin. Un registre qu'on peut nettoyer ne prouve rien.
 * - **L'écriture ne bloque pas la lecture.** Si l'insertion échoue, la réponse
 *   part quand même : refuser de montrer un arbre parce qu'une ligne de journal
 *   n'a pas pu s'écrire punirait la mauvaise personne. L'échec est visible dans
 *   les journaux du Worker.
 */

export type Action =
  | 'consultation'
  | 'export'
  | 'plafond'
  | 'reinitialisation'
  | 'suppression'
  /**
   * Lot 8.F : l'administrateur écrit dans l'arbre d'un autre. C'est le geste
   * qui compte le plus dans ce registre — le seul qui laisse une trace *dans*
   * les données de quelqu'un d'autre.
   */
  | 'edition';

export async function journaliser(
  base: D1Database,
  adminId: string,
  action: Action,
  cibleUtilisateur: string | null = null,
  cibleSauvegarde: string | null = null
): Promise<void> {
  try {
    await base
      .prepare(
        `INSERT INTO journal_admin (admin_id, action, cible_utilisateur, cible_sauvegarde, le)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(adminId, action, cibleUtilisateur, cibleSauvegarde, Math.floor(Date.now() / 1000))
      .run();
  } catch (erreur) {
    console.error('journal_admin : écriture impossible', erreur);
  }
}

export interface LigneJournal {
  id: number;
  admin_id: string;
  admin_email: string;
  action: string;
  cible_utilisateur: string | null;
  cible_email: string | null;
  cible_sauvegarde: string | null;
  le: number;
}

/** Les dernières lignes, avec les adresses plutôt que des identifiants nus. */
export async function dernieres(base: D1Database, combien = 200): Promise<LigneJournal[]> {
  const { results } = await base
    .prepare(
      `SELECT j.id, j.admin_id, j.action, j.cible_utilisateur, j.cible_sauvegarde, j.le,
              a.email AS admin_email,
              c.email AS cible_email
         FROM journal_admin j
         LEFT JOIN utilisateurs a ON a.id = j.admin_id
         LEFT JOIN utilisateurs c ON c.id = j.cible_utilisateur
        ORDER BY j.le DESC, j.id DESC
        LIMIT ?`
    )
    .bind(Math.min(1000, Math.max(1, combien)))
    .all<LigneJournal>();
  return results;
}
