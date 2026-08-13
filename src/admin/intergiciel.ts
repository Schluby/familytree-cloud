/**
 * Les gardes de la surface d'administration.
 *
 * **Module séparé, volontairement.** `src/intergiciels.ts` ne connaît pas le
 * rôle et n'apprendra jamais à le connaître : c'est en ajoutant un « ou si je
 * suis admin » aux routes de membres qu'on fabrique une fuite. Ici, la question
 * est l'inverse — on part du principe que rien n'est permis, et on ouvre une
 * porte étroite.
 *
 * **Deux étages depuis le lot 11.A.** Il n'y avait qu'un rôle au-dessus de
 * `membre`, et il pouvait tout, sur tout le monde. Une table de jeu n'a pas
 * besoin de ça : le maître de jeu doit pouvoir suivre *ses* joueurs sans
 * hériter du pouvoir d'effacer un compte ou d'en remplacer le mot de passe.
 *
 * - **`admin`** — le souverain. Périmètre `null` : tous les comptes. Lui seul
 *   nomme les intendants, leur confie des comptes, touche aux plafonds, aux
 *   mots de passe et à la suppression. Le rôle continue de se donner en SQL :
 *   **aucune route ne l'accorde**, pas même à un autre admin.
 * - **`intendant`** — l'administrateur délégué. Périmètre = les comptes qu'on
 *   lui a confiés, plus le sien. Il consulte, exporte, édite par procuration et
 *   applique des lots — **sur eux seuls**.
 *
 * Trois gardes, donc :
 *
 * 1. `exigerGestion` — une session, et l'un des deux rôles. Pose le périmètre.
 * 2. `exigerSouverain` — par-dessus, `admin` et lui seul.
 * 3. `lectureSeule` — sur la surface des arbres à plat, **seule la lecture
 *    existe**. Ce n'est pas une politesse : c'est ce qui rend l'écriture
 *    impossible même si quelqu'un ajoutait une route d'écriture par
 *    distraction. La garde est posée sur le chemin, pas sur chaque route.
 *
 * **Un compte hors périmètre répond 404, jamais 403.** La même règle que le
 * cloisonnement des membres : dire « interdit » à un intendant lui apprendrait
 * que le compte existe, et le nombre de comptes d'une instance n'est pas une
 * information qu'on lui doit.
 */

import type { MiddlewareHandler } from 'hono';
import { lireCookie, NOM_COOKIE, resoudreSession } from '../auth/sessions';
import type { Variables } from '../intergiciels';

/**
 * Sur qui porte le pouvoir de celui qui regarde.
 *
 * `null` n'est pas « aucun » mais « tous » — c'est le souverain. Le distinguer
 * d'un ensemble vide compte : un intendant sans tutelle a un périmètre vide et
 * ne voit rien, ce qui est le bon point de départ.
 */
export type Perimetre = ReadonlySet<string> | null;

export type VariablesAdmin = Variables & { perimetre: Perimetre };
export type ContexteAdmin = { Bindings: Env; Variables: VariablesAdmin };

/** Les comptes confiés à un intendant. */
export async function chargesDe(base: D1Database, intendantId: string): Promise<Set<string>> {
  const { results } = await base
    .prepare('SELECT utilisateur_id FROM tutelles WHERE intendant_id = ?')
    .bind(intendantId)
    .all<{ utilisateur_id: string }>();
  return new Set(results.map((ligne) => ligne.utilisateur_id));
}

export const exigerGestion: MiddlewareHandler<ContexteAdmin> = async (c, next) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);

  if (compte.role === 'admin') {
    c.set('compte', compte);
    c.set('perimetre', null);
    return next();
  }

  if (compte.role === 'intendant') {
    const charges = await chargesDe(c.env.DB, compte.id);
    // Son propre compte fait partie de son périmètre : il y a déjà tout pouvoir
    // par l'application ordinaire, et l'en exclure ici forcerait à sortir de la
    // page pour poser sur son arbre de référence ce qu'on pose chez les autres.
    charges.add(compte.id);
    c.set('compte', compte);
    c.set('perimetre', charges);
    return next();
  }

  // 403 et non 404 : à ce stade la personne est identifiée, et lui cacher que
  // la surface existe ne protège rien — elle est décrite dans le dépôt.
  return c.json({ erreur: 'réservé aux administrateurs' }, 403);
};

/** Ce que seul le souverain peut faire. À poser après `exigerGestion`. */
export const exigerSouverain: MiddlewareHandler<ContexteAdmin> = async (c, next) => {
  if (c.get('compte').role !== 'admin') {
    return c.json(
      {
        erreur: "réservé à l'administrateur de l'instance",
        indice:
          'un intendant consulte et édite les comptes qui lui sont confiés ; il ne touche ni aux rôles, ni aux mots de passe, ni aux plafonds, ni à la suppression',
      },
      403
    );
  }
  return next();
};

/**
 * Ce compte est-il dans le périmètre de qui regarde ?
 *
 * Une seule fonction, appelée partout où une route reçoit un identifiant de
 * compte : c'est plus facile à relire qu'un `if` recopié dix fois, et surtout
 * plus facile à retrouver le jour où l'on ajoute une route.
 */
export function dansLePerimetre(perimetre: Perimetre, utilisateurId: string): boolean {
  return perimetre === null || perimetre.has(utilisateurId);
}

/**
 * Un administrateur **lit** les arbres des autres. Il ne les modifie jamais.
 *
 * Le refus est un 403 explicite plutôt qu'un 404 : ici, contrairement aux
 * routes de membres, l'existence de la sauvegarde n'est pas un secret — un
 * admin la voit dans la liste. Ce qu'on refuse, c'est le geste, et le dire
 * clairement vaut mieux que de faire semblant que la route n'existe pas.
 */
export const lectureSeule: MiddlewareHandler<ContexteAdmin> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json(
      {
        erreur: 'les arbres des autres comptes sont en lecture seule',
        indice: "un administrateur consulte et exporte ; il ne modifie pas",
      },
      403
    );
  }
  await next();
};
