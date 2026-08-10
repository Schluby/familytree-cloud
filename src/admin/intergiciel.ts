/**
 * Les gardes de la surface d'administration.
 *
 * **Module séparé, volontairement.** `src/intergiciels.ts` ne connaît pas le
 * rôle et n'apprendra jamais à le connaître : c'est en ajoutant un « ou si je
 * suis admin » aux routes de membres qu'on fabrique une fuite. Ici, la question
 * est l'inverse — on part du principe que rien n'est permis, et on ouvre une
 * porte étroite.
 *
 * Deux gardes, pas un :
 *
 * 1. `exigerAdmin` — il faut une session, et le rôle `admin`.
 * 2. `lectureSeule` — sur la surface des arbres, **seule la lecture existe**.
 *    Ce n'est pas une politesse : c'est ce qui rend l'écriture impossible même
 *    si quelqu'un ajoutait une route d'écriture par distraction. La garde est
 *    posée sur le chemin, pas sur chaque route.
 */

import type { MiddlewareHandler } from 'hono';
import { lireCookie, NOM_COOKIE, resoudreSession } from '../auth/sessions';
import type { Variables } from '../intergiciels';

type Contexte = { Bindings: Env; Variables: Variables };

export const exigerAdmin: MiddlewareHandler<Contexte> = async (c, next) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);

  // 403 et non 404 : à ce stade la personne est identifiée, et lui cacher que
  // la surface existe ne protège rien — elle est décrite dans le dépôt.
  if (compte.role !== 'admin') {
    return c.json({ erreur: 'réservé aux administrateurs' }, 403);
  }

  c.set('compte', compte);
  await next();
};

/**
 * Un administrateur **lit** les arbres des autres. Il ne les modifie jamais.
 *
 * Le refus est un 403 explicite plutôt qu'un 404 : ici, contrairement aux
 * routes de membres, l'existence de la sauvegarde n'est pas un secret — un
 * admin la voit dans la liste. Ce qu'on refuse, c'est le geste, et le dire
 * clairement vaut mieux que de faire semblant que la route n'existe pas.
 */
export const lectureSeule: MiddlewareHandler<Contexte> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json(
      {
        erreur: "les arbres des autres comptes sont en lecture seule",
        indice: "un administrateur consulte et exporte ; il ne modifie pas",
      },
      403
    );
  }
  await next();
};
