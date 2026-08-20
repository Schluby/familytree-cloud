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
 *
 * Depuis le lot 14, une fiche peut porter `demo = 1` : c'est la démonstration,
 * le même monde pour tout le monde. Elle suit les deux invariants ci-dessus
 * sans exception, avec une seule particularité, tenue ici : **sa ligne de
 * contenu n'existe pas tant que personne n'y a écrit**, et sa lecture retombe
 * alors sur le document livré avec le Worker. Trente-deux copies identiques du
 * même Westeros pesaient 94 % de la base ; il n'y en a plus aucune.
 */

import { contenuDepart } from '../depart/contenu';
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
  /** 1 : la démonstration. Elle ne compte nulle part et ne se conserve pas. */
  demo: number;
}

export const CHAMPS_FICHE =
  'id, nom, schema_version, personnes, relations, taille, revision, cree_le, modifie_le, demo';

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

/**
 * Le document brut, tel qu'il est stocké : compact, prêt à renvoyer.
 *
 * Le `LEFT JOIN` et non un `JOIN` : la démonstration n'a de ligne de contenu
 * que si quelqu'un y a écrit, et sans lui elle répondrait « introuvable » alors
 * qu'elle existe. C'est le seul cas où `donnees` est absent, et le seul où l'on
 * a le droit de le remplacer — par le document livré avec le Worker, qui est
 * précisément ce qu'elle vaut tant qu'on n'y a pas touché.
 */
export async function lireTexte(
  base: D1Database,
  utilisateurId: string,
  id: string
): Promise<{ donnees: string; revision: number; nom: string } | null> {
  const ligne = await base
    .prepare(
      `SELECT c.donnees, s.revision, s.nom, s.demo
         FROM sauvegardes s
         LEFT JOIN contenus c ON c.sauvegarde_id = s.id
        WHERE s.id = ? AND s.utilisateur_id = ?`
    )
    .bind(id, utilisateurId)
    .first<{ donnees: string | null; revision: number; nom: string; demo: number }>();

  if (!ligne) return null;
  if (ligne.donnees !== null) return ligne as { donnees: string; revision: number; nom: string };
  if (!ligne.demo) return null;
  return { donnees: contenuDepart().texte, revision: ligne.revision, nom: ligne.nom };
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

/**
 * Quelqu'un a écrit dans cette sauvegarde entre notre lecture et notre écriture.
 *
 * Refus, et non écrasement : c'est la seule réponse honnête quand deux
 * personnes tiennent le même document. Le travail de l'autre est intact ; le
 * nôtre est à refaire, et on le sait.
 */
export class ErreurConflit extends Error {
  constructor() {
    super(
      'cette sauvegarde a été modifiée pendant que vous travailliez — rechargez, puis refaites ce geste'
    );
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
  /* --------------------------------------------------- le verrou de révision
   *
   * Lot 23.D. Chaque modification relit le document entier, le change en
   * mémoire et le réécrit en bloc. À deux — deux onglets du même compte, ou
   * depuis ce lot deux personnes sur un arbre partagé en écriture — celui qui
   * enregistrait en second n'écrasait pas un champ : il écrasait **tout le
   * travail de l'autre**, sans un mot.
   *
   * La révision lue au chargement sert donc de jeton. Elle est portée par les
   * deux instructions, et le contenu s'écrit **avant** que le compteur ne bouge :
   * dans l'ordre inverse, la première ferait avancer la révision et la seconde
   * ne reconnaîtrait plus la sienne — plus aucune écriture ne passerait.
   */
  const attendue = fiche.revision;
  const resultats = await base.batch([
    // Upsert : la ligne existe par construction, mais si elle manquait, une mise
    // à jour muette perdrait le document sans rien dire.
    base
      .prepare(
        `INSERT INTO contenus (sauvegarde_id, donnees)
              SELECT ?1, ?2
               WHERE EXISTS (SELECT 1 FROM sauvegardes WHERE id = ?1 AND revision = ?3)
           ON CONFLICT(sauvegarde_id) DO UPDATE SET donnees = excluded.donnees`
      )
      .bind(fiche.id, prepare.texte, attendue),
    base
      .prepare(
        `UPDATE sauvegardes
            SET schema_version = ?, personnes = ?, relations = ?, taille = ?,
                revision = revision + 1, modifie_le = ?
          WHERE id = ? AND utilisateur_id = ? AND revision = ?`
      )
      .bind(
        prepare.schemaVersion,
        prepare.personnes,
        prepare.relations,
        prepare.octets,
        le,
        fiche.id,
        utilisateurId,
        attendue
      ),
  ]);

  // Aucune ligne touchée : quelqu'un a écrit entre notre lecture et la nôtre.
  // Les deux instructions portant la même condition, rien n'a bougé — le
  // document de l'autre est intact, et c'est le nôtre qui est à rejouer.
  if (!resultats[1]?.meta?.changes) throw new ErreurConflit();

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

/** Ce qu'il faut savoir d'un document pour l'insérer, déjà mesuré. */
export interface Contenu {
  texte: string;
  octets: number;
  personnes: number;
  relations: number;
  schema: number;
}

/**
 * Crée une sauvegarde et son contenu. **Le seul chemin de création.**
 *
 * `ecrireDocument` remplace un document existant ; celle-ci en pose un premier.
 * Les deux vivent ici pour la même raison : le jour où une règle s'ajoute (un
 * quota, une trace, un champ), il n'y a que deux endroits à toucher, et ils
 * sont l'un sous l'autre.
 *
 * `demo` ne crée **pas** la ligne de contenu, et c'est tout ce qu'il change.
 * Les compteurs sont ceux du document livré — la fiche dit la vérité sur ce
 * qu'elle vaut — mais les 90 Ko ne sont écrits nulle part : ils sont déjà dans
 * le Worker, identiques pour tout le monde. `lireTexte` va les y chercher, et
 * la première écriture matérialise la ligne par l'`ON CONFLICT` d'au-dessus,
 * sans que personne ait à s'en occuper.
 */
export async function creerDocument(
  base: D1Database,
  utilisateurId: string,
  sauvegardeActiveCourante: string | null,
  nom: string,
  contenu: Contenu,
  demo = false
): Promise<Fiche> {
  const id = crypto.randomUUID();
  const le = maintenant();

  const instructions = [
    base
      .prepare(
        `INSERT INTO sauvegardes
           (id, utilisateur_id, nom, schema_version, personnes, relations, taille, revision, cree_le, modifie_le, demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        id,
        utilisateurId,
        nom,
        contenu.schema,
        contenu.personnes,
        contenu.relations,
        contenu.octets,
        le,
        le,
        demo ? 1 : 0
      ),
  ];
  if (!demo) {
    instructions.push(
      base
        .prepare('INSERT INTO contenus (sauvegarde_id, donnees) VALUES (?, ?)')
        .bind(id, contenu.texte)
    );
  }
  await base.batch(instructions);

  // Première sauvegarde du compte : elle devient l'active, sinon les routes du
  // domaine répondraient « aucune sauvegarde active » juste après une création.
  if (!sauvegardeActiveCourante) await activer(base, utilisateurId, id);

  return {
    id,
    nom,
    schema_version: contenu.schema,
    personnes: contenu.personnes,
    relations: contenu.relations,
    taille: contenu.octets,
    revision: 1,
    cree_le: le,
    modifie_le: le,
    demo: demo ? 1 : 0,
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
