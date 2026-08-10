/**
 * L'accès aux sauvegardes, en un seul endroit.
 *
 * Deux invariants vivent ici, et nulle part ailleurs :
 *
 * 1. **Aucune lecture ni écriture ne désigne une sauvegarde par son seul
 *    identifiant** : `utilisateur_id` est dans tous les `WHERE`, et l'absence
 *    se dit 404, jamais 403.
 * 2. **Un seul point d'écriture du document.** Les routes de sauvegardes
 *    (lot 2) et celles du domaine (lot 3) passent toutes par `ecrireDocument`,
 *    qui recalcule les compteurs, retire les portraits `data:`, vérifie le
 *    plafond et fait avancer la révision. Une règle ajoutée là vaut pour tout.
 */

import { preparerDocument, type Document } from './document';

export interface Fiche {
  id: string;
  nom: string;
  schema_version: number;
  personnes: number;
  relations: number;
  taille: number;
  revision: number;
  cree_le: number;
  modifie_le: number;
}

export const CHAMPS_FICHE =
  'id, nom, schema_version, personnes, relations, taille, revision, cree_le, modifie_le';

export function maintenant(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * L'invariant du projet, en une fonction. Tout ce qui touche à une sauvegarde
 * commence ici — et si elle n'appartient pas au demandeur, elle n'existe pas.
 */
export async function ficheDe(
  base: D1Database,
  utilisateurId: string,
  id: string
): Promise<Fiche | null> {
  return base
    .prepare(`SELECT ${CHAMPS_FICHE} FROM sauvegardes WHERE id = ? AND utilisateur_id = ?`)
    .bind(id, utilisateurId)
    .first<Fiche>();
}

/** Le document brut, tel qu'il est stocké : compact, prêt à renvoyer. */
export async function lireTexte(
  base: D1Database,
  utilisateurId: string,
  id: string
): Promise<{ donnees: string; revision: number; nom: string } | null> {
  return base
    .prepare(
      `SELECT c.donnees, s.revision, s.nom
         FROM contenus c
         JOIN sauvegardes s ON s.id = c.sauvegarde_id
        WHERE c.sauvegarde_id = ? AND s.utilisateur_id = ?`
    )
    .bind(id, utilisateurId)
    .first<{ donnees: string; revision: number; nom: string }>();
}

export class ErreurPlafond extends Error {
  readonly octets: number;
  readonly plafond: number;

  constructor(octets: number, plafond: number) {
    super(
      `cette sauvegarde pèse ${Math.round(octets / 1024)} Ko, au-delà des ${Math.round(
        plafond / 1024
      )} Ko autorisés par compte`
    );
    this.octets = octets;
    this.plafond = plafond;
  }
}

export interface Ecriture {
  fiche: Fiche;
  portraitsRetires: number;
}

/**
 * Remplace le document d'une sauvegarde. **Le seul chemin d'écriture.**
 *
 * `fiche` doit venir de `ficheDe` : c'est elle qui prouve que la sauvegarde
 * appartient bien au demandeur.
 */
export async function ecrireDocument(
  base: D1Database,
  utilisateurId: string,
  fiche: Fiche,
  document: Document,
  plafondOctets: number
): Promise<Ecriture> {
  const prepare = preparerDocument(document);
  if (prepare.octets > plafondOctets) throw new ErreurPlafond(prepare.octets, plafondOctets);

  const le = maintenant();
  await base.batch([
    base
      .prepare(
        `UPDATE sauvegardes
            SET schema_version = ?, personnes = ?, relations = ?, taille = ?,
                revision = revision + 1, modifie_le = ?
          WHERE id = ? AND utilisateur_id = ?`
      )
      .bind(
        prepare.schemaVersion,
        prepare.personnes,
        prepare.relations,
        prepare.octets,
        le,
        fiche.id,
        utilisateurId
      ),
    // Upsert : la ligne existe par construction, mais si elle manquait, une mise
    // à jour muette perdrait le document sans rien dire.
    base
      .prepare(
        `INSERT INTO contenus (sauvegarde_id, donnees) VALUES (?, ?)
           ON CONFLICT(sauvegarde_id) DO UPDATE SET donnees = excluded.donnees`
      )
      .bind(fiche.id, prepare.texte),
  ]);

  return {
    fiche: {
      ...fiche,
      schema_version: prepare.schemaVersion,
      personnes: prepare.personnes,
      relations: prepare.relations,
      taille: prepare.octets,
      revision: fiche.revision + 1,
      modifie_le: le,
    },
    portraitsRetires: prepare.portraitsRetires,
  };
}

/* --------------------------------------------------------------------------
 * La sauvegarde active
 * -------------------------------------------------------------------------- */

/**
 * Celle que les routes du domaine éditent quand l'adresse n'en nomme aucune.
 *
 * Si l'active pointe vers une sauvegarde effacée — ou si le compte n'en a
 * jamais choisi — on retombe sur la plus récemment modifiée, et on l'inscrit.
 * Rien ne doit obliger l'utilisateur à « choisir un monde » avant de pouvoir
 * ouvrir le sien.
 */
export async function sauvegardeActive(
  base: D1Database,
  utilisateurId: string,
  active: string | null
): Promise<Fiche | null> {
  if (active) {
    const fiche = await ficheDe(base, utilisateurId, active);
    if (fiche) return fiche;
  }

  const repli = await base
    .prepare(
      `SELECT ${CHAMPS_FICHE} FROM sauvegardes
        WHERE utilisateur_id = ? ORDER BY modifie_le DESC LIMIT 1`
    )
    .bind(utilisateurId)
    .first<Fiche>();

  if (repli) await activer(base, utilisateurId, repli.id);
  return repli ?? null;
}

export async function activer(
  base: D1Database,
  utilisateurId: string,
  sauvegardeId: string | null
): Promise<void> {
  await base
    .prepare('UPDATE utilisateurs SET sauvegarde_active = ? WHERE id = ?')
    .bind(sauvegardeId, utilisateurId)
    .run();
}
