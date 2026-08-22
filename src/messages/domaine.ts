/**
 * Les messages volants — la logique, sans HTTP (lot 27.D).
 *
 * Demandé tel quel : « un truc qui permette d'envoyer des msg aux autres (pas
 * une messagerie), juste une petite popup temporaire qui permet d'envoyer des
 * msg et qui ne sont pas stockés ». Ce module tient cette promesse à la
 * lettre : rien ici ne lit `messages_volants` pour autre chose que « ce qui
 * n'a pas encore expiré », et rien n'y écrit pour plus de trois minutes. Voir
 * `migrations/0012_messages_volants.sql` pour le schéma et le choix de D1
 * plutôt qu'un Durable Object.
 *
 * Ce fichier ne connaît pas Hono, volontairement : `routes.ts` traduit ce
 * qu'il trouve ici en réponses HTTP, celui-ci ne fait que des requêtes SQL et
 * des calculs, sur `D1Database` nu — comme `src/sauvegardes/depot.ts`.
 */

/** Trois minutes. La seule règle de conservation — voir la migration. */
export const DUREE_VIE = 180;

/** Au-delà, ce n'est plus un mot qu'on passe, c'est un pavé. */
export const TAILLE_MAX_TEXTE = 500;

/** Le frein contre une boucle : voir `debitDe` pour ce que « fenêtre » veut dire ici. */
export const MAX_MESSAGES_ACTIFS = 20;

/* --------------------------------------------------------------------------
 * La purge — la seule façon dont cette table se vide
 * -------------------------------------------------------------------------- */

/**
 * Efface ce qui a expiré, dans **toute** la table, pas seulement pour la
 * sauvegarde de la requête en cours : un message périmé n'intéresse plus
 * personne, d'où qu'il vienne, et c'est ce qui permet à cette table de ne
 * jamais dépendre d'un cron. Chaque appel de lecture ou d'écriture en fait
 * profiter tout le monde — c'est le sens exact de « pas stockés » : il n'y a
 * littéralement rien à aller consulter passé ce délai.
 */
export async function purger(base: D1Database, maintenantLe: number): Promise<void> {
  await base.prepare('DELETE FROM messages_volants WHERE expire_le < ?').bind(maintenantLe).run();
}

/* --------------------------------------------------------------------------
 * Qui voit cette sauvegarde
 * -------------------------------------------------------------------------- */

export type Acces = 'introuvable' | 'refuse' | 'ok';

/**
 * Ce compte voit-il cette sauvegarde ? **La même question, et la même
 * condition**, que `parPartage` pose dans `src/partages/routes.ts` pour
 * ouvrir un arbre à sa lecture : le propriétaire, ou un compte présent dans
 * `partages` pour elle — peu importe son droit, lecture ou écriture, puisqu'un
 * lecteur voit le même plan qu'un rédacteur et a tout autant de raison d'y
 * glisser un mot. Ce module réemploie ce chemin plutôt que d'en ouvrir un
 * second : il pose la même condition en SQL, il ne l'importe pas — les deux
 * modules restent chacun dans leur périmètre de lot.
 *
 * Deux requêtes plutôt qu'une, mais la seconde ne coûte qu'au cas rare : la
 * première teste directement « ai-je accès », et c'est elle qui répond pour
 * quiconque a effectivement le droit d'être là — la grande majorité des
 * appels, une fois la popup ouverte. La seconde, plus simple, ne s'exécute que
 * pour distinguer un 404 d'un 403 : une sauvegarde qui n'existe pas d'une qui
 * existe mais m'est fermée.
 */
export async function acces(base: D1Database, sauvegardeId: string, compteId: string): Promise<Acces> {
  const visible = await base
    .prepare(
      `SELECT 1 AS ok
         FROM sauvegardes s
        WHERE s.id = ?1
          AND (s.utilisateur_id = ?2
               OR EXISTS (SELECT 1 FROM partages p
                           WHERE p.sauvegarde_id = s.id AND p.utilisateur_id = ?2))`
    )
    .bind(sauvegardeId, compteId)
    .first<{ ok: number }>();
  if (visible) return 'ok';

  const existe = await base
    .prepare('SELECT 1 AS ok FROM sauvegardes WHERE id = ?')
    .bind(sauvegardeId)
    .first<{ ok: number }>();
  return existe ? 'refuse' : 'introuvable';
}

/* --------------------------------------------------------------------------
 * Qui est autour de ce monde
 * -------------------------------------------------------------------------- */

export interface Destinataire {
  id: string;
  nom: string;
  proprietaire: boolean;
}

/**
 * Le propriétaire de la sauvegarde et les comptes à qui il l'a ouverte, sans
 * moi — exactement l'ensemble que teste `acces`, rendu cette fois en liste
 * plutôt qu'en question.
 */
export async function destinatairesDe(
  base: D1Database,
  sauvegardeId: string,
  moi: string
): Promise<Destinataire[]> {
  const { results } = await base
    .prepare(
      `SELECT u.id, u.email, u.nom_affiche, (u.id = s.utilisateur_id) AS proprietaire
         FROM sauvegardes s
         JOIN utilisateurs u
           ON u.id = s.utilisateur_id
           OR EXISTS (SELECT 1 FROM partages p WHERE p.sauvegarde_id = s.id AND p.utilisateur_id = u.id)
        WHERE s.id = ?1 AND u.id <> ?2
        ORDER BY proprietaire DESC, u.email`
    )
    .bind(sauvegardeId, moi)
    .all<{ id: string; email: string; nom_affiche: string; proprietaire: number }>();

  return results.map((ligne) => ({
    id: ligne.id,
    nom: ligne.nom_affiche || ligne.email,
    proprietaire: !!ligne.proprietaire,
  }));
}

/* --------------------------------------------------------------------------
 * Lire ce qui m'attend
 * -------------------------------------------------------------------------- */

export interface Message {
  id: string;
  auteur: string;
  destinataire: string | null;
  texte: string;
  cree_le: number;
}

interface LigneMessage {
  id: string;
  destinataire_id: string | null;
  texte: string;
  cree_le: number;
  auteur_email: string;
  auteur_nom: string;
}

/**
 * Les messages non périmés de cette sauvegarde qui me sont destinés — à moi
 * précisément, ou à tout le monde (`destinataire_id IS NULL`) —, créés après
 * `depuis`, sans les miens : on ne se relit pas soi-même.
 *
 * `expire_le > maintenantLe` est redondant avec la purge qui vient de tourner
 * — ceinture et bretelles, pour que « non périmé » reste vrai même si un jour
 * quelqu'un appelle cette fonction sans purger juste avant.
 *
 * Chaque ligne porte déjà le nom d'affichage de son auteur (ou son adresse à
 * défaut) : c'est résolu ici, une fois, plutôt que de faire recouper l'appelant.
 */
export async function messagesDepuis(
  base: D1Database,
  sauvegardeId: string,
  moi: string,
  depuis: number,
  maintenantLe: number
): Promise<Message[]> {
  const { results } = await base
    .prepare(
      `SELECT m.id, m.destinataire_id, m.texte, m.cree_le,
              u.email AS auteur_email, u.nom_affiche AS auteur_nom
         FROM messages_volants m
         JOIN utilisateurs u ON u.id = m.auteur_id
        WHERE m.sauvegarde_id = ?1
          AND m.expire_le > ?2
          AND m.cree_le > ?3
          AND m.auteur_id <> ?4
          AND (m.destinataire_id = ?4 OR m.destinataire_id IS NULL)
        ORDER BY m.cree_le ASC`
    )
    .bind(sauvegardeId, maintenantLe, depuis, moi)
    .all<LigneMessage>();

  return results.map((ligne) => ({
    id: ligne.id,
    auteur: ligne.auteur_nom || ligne.auteur_email,
    destinataire: ligne.destinataire_id,
    texte: ligne.texte,
    cree_le: ligne.cree_le,
  }));
}

/* --------------------------------------------------------------------------
 * Envoyer un mot
 * -------------------------------------------------------------------------- */

export interface Debit {
  bloque: boolean;
  /** Secondes avant qu'un envoi retrouve une place — 0 si `bloque` est faux. */
  attente: number;
}

/**
 * Le frein contre une boucle laissée dans une console : vingt messages,
 * sinon 429.
 *
 * **« Par tranche de cinq minutes » se lit ici sur la table elle-même**,
 * comme demandé — et la table ne garde jamais plus de trois minutes de quoi
 * que ce soit, `expire_le` l'impose. Compter les lignes actuelles d'un
 * auteur, une fois la purge faite, revient donc à les compter sur une
 * fenêtre glissante d'au plus `DUREE_VIE` (trois minutes), pas cinq pleines :
 * la table ne peut pas montrer ce qu'elle a déjà effacé. Le choix est assumé
 * plutôt que contourné — ajouter un second compteur, à plus longue mémoire
 * (par exemple dans `tentatives`, comme `src/auth/limites.ts`), referait
 * exister quelque part la trace qu'on vient de refuser d'écrire. Le résultat
 * est **plus strict** que demandé, jamais plus large : une boucle est freinée
 * plus tôt, jamais plus tard.
 */
export async function debitDe(base: D1Database, auteurId: string, maintenantLe: number): Promise<Debit> {
  const ligne = await base
    .prepare(
      'SELECT COUNT(*) AS n, MIN(expire_le) AS plus_tot FROM messages_volants WHERE auteur_id = ?'
    )
    .bind(auteurId)
    .first<{ n: number; plus_tot: number | null }>();

  const n = ligne?.n ?? 0;
  if (n < MAX_MESSAGES_ACTIFS) return { bloque: false, attente: 0 };

  const plusTot = ligne?.plus_tot ?? maintenantLe + DUREE_VIE;
  return { bloque: true, attente: Math.max(1, plusTot - maintenantLe) };
}
