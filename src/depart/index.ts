/**
 * La démonstration : un même monde pour tout le monde, que personne ne garde.
 *
 * **Ce qu'elle était, et pourquoi ça ne pouvait pas durer.** Depuis le lot 9,
 * chaque compte neuf — et chaque visiteur sans compte — recevait sa copie
 * personnelle de Westeros : 90 Ko, une vraie sauvegarde, comptée dans ses
 * plafonds, pesée dans « Vos données », relevée par l'administration. Au
 * 14/08/2026 la base tenait 3,13 Mo dont 2,94 en 32 exemplaires **identiques et
 * jamais touchés** du même document. Le service stockait son propre cadeau, et
 * le panorama d'un intendant parlait de Westeros au lieu de parler du travail
 * de ses joueurs — qui est la seule chose qu'il ait besoin de voir.
 *
 * **Ce qu'elle est maintenant.** Une fiche portant `demo = 1`, sans ligne de
 * contenu : `lireTexte` sert le document livré avec le Worker (voir
 * `sauvegardes/depot.ts`). Elle s'édite comme n'importe quel monde — c'est un
 * terrain d'essai, il doit répondre au doigt — mais rien de ce qu'on y fait
 * n'est conservé :
 *
 * - `semerDemonstration` la remet à zéro **à chaque ouverture de session**, et
 *   seulement si elle a bougé (`revision > 1`) : autrement, aucune écriture ;
 * - le ménage nocturne fait de même pour qui ne se déconnecte jamais ;
 * - `POST /api/sauvegardes/demonstration` le fait à la demande.
 *
 * « Remettre à zéro » n'est qu'un `DELETE` de la ligne de contenu : le
 * document d'origine, lui, n'a jamais quitté le Worker.
 *
 * **Une chose qu'elle ne fait pas** : revenir quand on l'a supprimée. Effacer
 * la démonstration est un choix légitime — on a son propre monde, on ne veut
 * plus de celui-là — et la réinstaller à chaque connexion serait le contraire
 * d'un service. Elle ne se repose d'elle-même que sur un compte qui n'a plus
 * rien du tout ; sinon, c'est le bouton qui la rappelle.
 */

import { contenuDepart, NOM_DEPART } from './contenu';
import { creerDocument, maintenant, CHAMPS_FICHE, type Fiche } from '../sauvegardes/depot';

export { NOM_DEPART, contenuDepart, octetsDepart } from './contenu';

/** La démonstration d'un compte, s'il en a une. */
export async function ficheDemonstration(
  base: D1Database,
  utilisateurId: string
): Promise<Fiche | null> {
  return base
    .prepare(
      `SELECT ${CHAMPS_FICHE} FROM sauvegardes WHERE utilisateur_id = ? AND demo = 1 LIMIT 1`
    )
    .bind(utilisateurId)
    .first<Fiche>();
}

/**
 * Efface ce qu'on a fait dans la démonstration, et la remet à ses compteurs.
 *
 * Le `DELETE` porte sur `contenus`, jamais sur `sauvegardes` : la fiche reste,
 * avec son identifiant. C'est elle que `sauvegarde_active` désigne, et la faire
 * disparaître pour la refabriquer déplacerait le monde ouvert sous les pieds de
 * quelqu'un qui a juste rechargé sa page.
 */
export async function remettreDemonstration(
  base: D1Database,
  utilisateurId: string,
  fiche: Fiche
): Promise<Fiche> {
  const contenu = contenuDepart();
  const le = maintenant();

  await base.batch([
    base.prepare('DELETE FROM contenus WHERE sauvegarde_id = ?').bind(fiche.id),
    base
      .prepare(
        `UPDATE sauvegardes
            SET schema_version = ?, personnes = ?, relations = ?, taille = ?,
                revision = 1, modifie_le = ?
          WHERE id = ? AND utilisateur_id = ? AND demo = 1`
      )
      .bind(
        contenu.schema,
        contenu.personnes,
        contenu.relations,
        contenu.octets,
        le,
        fiche.id,
        utilisateurId
      ),
  ]);

  return {
    ...fiche,
    schema_version: contenu.schema,
    personnes: contenu.personnes,
    relations: contenu.relations,
    taille: contenu.octets,
    revision: 1,
    modifie_le: le,
  };
}

/** Le nom que prend la démonstration quand elle devient le monde de quelqu'un. */
export const NOM_REPRIS = 'Mon Westeros';

/**
 * La démonstration devient un vrai monde — le seul cas où l'on garde ce qui y a
 * été fait, et il n'y en aura pas d'autre.
 *
 * **Pourquoi cette exception existe.** Un visiteur essaie l'outil sans compte,
 * joue dans la démonstration, s'attache à ce qu'il vient de construire, et
 * s'inscrit pour le garder. Si l'inscription remettait la démonstration à zéro,
 * elle détruirait le travail **au moment précis** où l'on décide de le
 * conserver. C'est le seul endroit du produit où « rien n'est conservé ici »
 * aurait été un piège plutôt qu'un avertissement.
 *
 * Rien n'est copié ni déplacé : la fiche perd son drapeau et prend un nom. Elle
 * a déjà sa ligne de contenu, puisqu'elle a été modifiée — c'est justement ce
 * qui la rend digne d'être gardée. Une démonstration jamais touchée
 * (`revision = 1`) ne vaut rien de plus que celle du voisin : on la laisse où
 * elle est.
 */
export async function promouvoirDemonstration(
  base: D1Database,
  utilisateurId: string
): Promise<Fiche | null> {
  const fiche = await ficheDemonstration(base, utilisateurId);
  if (!fiche || fiche.revision <= 1) return null;

  await base
    .prepare('UPDATE sauvegardes SET demo = 0, nom = ? WHERE id = ? AND utilisateur_id = ? AND demo = 1')
    .bind(NOM_REPRIS, fiche.id, utilisateurId)
    .run();

  return { ...fiche, nom: NOM_REPRIS, demo: 0 };
}

/**
 * Pose la démonstration, ou la rend à son état d'origine.
 *
 * Appelée à chaque ouverture de session — inscription, connexion, essai sans
 * compte, retour de Google. Le cas courant, de très loin, est celui où il n'y a
 * rien à faire : une lecture d'index, aucune écriture. C'est pour ça que la
 * remise à zéro est conditionnée à `revision > 1` plutôt que faite d'office.
 *
 * `forcer` sert le bouton « Remettre à zéro » et la reconstruit même sur un
 * compte qui l'avait supprimée : là, c'est demandé.
 */
export async function semerDemonstration(
  base: D1Database,
  utilisateurId: string,
  sauvegardeActive: string | null = null,
  forcer = false
): Promise<Fiche | null> {
  const fiche = await ficheDemonstration(base, utilisateurId);
  if (fiche) {
    if (fiche.revision > 1) return remettreDemonstration(base, utilisateurId, fiche);
    return fiche;
  }

  if (!forcer) {
    // Supprimée à dessein sur un compte qui a ses propres mondes : on n'insiste
    // pas. Sur un compte qui n'a plus rien, en revanche, la reposer est la
    // seule façon de ne pas ouvrir sur un écran vide.
    const aQuelqueChose = await base
      .prepare('SELECT 1 AS oui FROM sauvegardes WHERE utilisateur_id = ? LIMIT 1')
      .bind(utilisateurId)
      .first<{ oui: number }>();
    if (aQuelqueChose) return null;
  }

  return creerDocument(base, utilisateurId, sauvegardeActive, NOM_DEPART, contenuDepart(), true);
}
