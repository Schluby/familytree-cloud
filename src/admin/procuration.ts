/**
 * La procuration : un administrateur qui édite l'arbre de quelqu'un d'autre.
 *
 * **C'est un revirement, pas un oubli.** Le lot 7 avait tranché « lecture
 * seule », et la décision a été retournée le 10/08/2026 : l'administrateur de
 * la table doit pouvoir ajouter une maison, un lien, corriger les
 * caractéristiques d'un personnage — pour tout le monde, y compris pour les
 * joueurs qui ne le feront jamais eux-mêmes. Un outil de campagne où le MJ ne
 * peut pas écrire dans les fiches n'est pas un outil de campagne.
 *
 * Ce qui **n'a pas** changé, et qui ne changera pas :
 *
 * - Les routes de membres ne connaissent toujours pas les rôles. Il n'y a
 *   toujours aucun « ou si je suis admin » dans `src/intergiciels.ts` ni dans
 *   `src/domaine/routes.ts`. Passer par l'API des membres pour désigner
 *   l'arbre d'un autre répond toujours **404**.
 * - Le pouvoir n'existe que sur `/api/admin/*`, et il est **journalisé**.
 *
 * Le mécanisme tient en une idée : plutôt que de réécrire trente routes qui
 * savent déjà éditer un monde, on **substitue le compte** sur le contexte. Le
 * domaine croit servir son propriétaire ; il ne saura jamais qu'un autre tient
 * la plume. C'est ce qui garantit qu'un administrateur ne peut rien faire de
 * plus que ce que le propriétaire pourrait faire lui-même : mêmes validations,
 * mêmes plafonds, même point d'écriture unique.
 */

import type { MiddlewareHandler } from 'hono';
import type { Compte } from '../auth/sessions';
import type { Variables } from '../intergiciels';
import { journaliser } from './journal';

type Contexte = { Bindings: Env; Variables: Variables };

interface LigneProprietaire {
  utilisateur_id: string;
  email: string;
  nom_affiche: string;
  role: string;
  plafond_octets: number;
  plafond_sauvegardes: number;
}

/**
 * Charge la sauvegarde nommée dans l'adresse, remplace le compte du contexte
 * par **son propriétaire**, et journalise ce qui n'est pas une lecture.
 *
 * `sauvegarde_active` est forcée sur la sauvegarde demandée : sans cela, le
 * domaine irait travailler sur celle que le propriétaire a ouverte de son
 * côté, et l'administrateur modifierait un autre arbre que celui qu'il
 * regarde. C'est le seul endroit où cette valeur est décidée ailleurs que par
 * son propriétaire, et elle ne touche pas la base — uniquement ce contexte-ci.
 */
export const parProcuration: MiddlewareHandler<Contexte> = async (c, next) => {
  const admin = c.get('compte'); // posé par `exigerAdmin`, en amont
  // `:arbre`, pas `:id` : le domaine a ses propres `:id` et deux paramètres du
  // même nom se recouvrent dans une adresse imbriquée. Voir `routes.ts`.
  const sauvegardeId = c.req.param('arbre');
  if (!sauvegardeId) return c.json({ erreur: 'sauvegarde non nommée' }, 400);

  const ligne = await c.env.DB.prepare(
    `SELECT s.utilisateur_id, u.email, u.nom_affiche, u.role,
            u.plafond_octets, u.plafond_sauvegardes
       FROM sauvegardes s
       JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.id = ?`
  )
    .bind(sauvegardeId)
    .first<LigneProprietaire>();

  if (!ligne) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  const proprietaire: Compte = {
    id: ligne.utilisateur_id,
    email: ligne.email,
    nom_affiche: ligne.nom_affiche,
    role: ligne.role,
    plafond_octets: ligne.plafond_octets,
    plafond_sauvegardes: ligne.plafond_sauvegardes,
    sauvegarde_active: sauvegardeId,
  };
  c.set('compte', proprietaire);

  await next();

  // Après coup, et seulement si l'écriture a réussi : une tentative refusée
  // par le domaine (400, 413) n'a rien changé, et l'inscrire au registre
  // rendrait celui-ci illisible. Le journal dit ce qui *a eu lieu*.
  const ecriture = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if (ecriture && c.res.status < 400 && admin.id !== ligne.utilisateur_id) {
    await journaliser(c.env.DB, admin.id, 'edition', ligne.utilisateur_id, sauvegardeId);
  }
};
