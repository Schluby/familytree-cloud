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
  | 'edition'
  /**
   * Lot 11.A : le souverain distribue le pouvoir. `role` quand il nomme ou
   * démet un intendant, `tutelle` quand il lui confie ou lui retire des
   * comptes. Ce sont les deux gestes qui décident **qui peut regarder quoi** ;
   * les laisser hors du registre les rendrait invisibles.
   */
  | 'role'
  | 'tutelle'
  /**
   * Lot 17.A : l'intendant tranche que deux fiches de deux comptes sont — ou ne
   * sont pas — la même personne. Le verdict ne touche à aucune donnée, mais il
   * décide de ce que les lots suivants écriront et chez qui : le laisser hors
   * du registre rendrait inexplicable une écriture faite « chez tout le monde ».
   */
  | 'identite';

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

/**
 * Les dernières lignes, avec les adresses plutôt que des identifiants nus.
 *
 * `perimetre` borne la lecture pour un intendant (lot 11.A) : il voit **ses
 * propres gestes** et **ce qui a été fait aux comptes qu'on lui a confiés** —
 * y compris par le souverain, car c'est justement ce que le registre lui doit.
 * Le reste de l'instance ne le regarde pas, et les adresses des autres comptes
 * n'ont pas à transiter par sa page. Un périmètre `null` ne filtre rien.
 */
export async function dernieres(
  base: D1Database,
  combien = 200,
  perimetre: ReadonlySet<string> | null = null,
  lecteurId: string | null = null
): Promise<LigneJournal[]> {
  const limite = Math.min(1000, Math.max(1, combien));

  const colonnes = `j.id, j.admin_id, j.action, j.cible_utilisateur, j.cible_sauvegarde, j.le,
                    a.email AS admin_email,
                    c.email AS cible_email`;
  const jointures = `FROM journal_admin j
                     LEFT JOIN utilisateurs a ON a.id = j.admin_id
                     LEFT JOIN utilisateurs c ON c.id = j.cible_utilisateur`;
  const fin = 'ORDER BY j.le DESC, j.id DESC LIMIT ?';

  if (perimetre === null) {
    const { results } = await base
      .prepare(`SELECT ${colonnes} ${jointures} ${fin}`)
      .bind(limite)
      .all<LigneJournal>();
    return results;
  }

  const charges = [...perimetre];
  const trous = charges.length ? charges.map(() => '?').join(',') : "''";
  const { results } = await base
    .prepare(
      `SELECT ${colonnes} ${jointures}
        WHERE j.admin_id = ? OR j.cible_utilisateur IN (${trous})
        ${fin}`
    )
    .bind(lecteurId ?? '', ...charges, limite)
    .all<LigneJournal>();
  return results;
}
