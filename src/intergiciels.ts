/**
 * L'intergiciel qui garde les routes de membres.
 *
 * Il pose le compte connecté dans le contexte, et rien d'autre. C'est
 * volontaire : **aucune route ne doit pouvoir désigner la sauvegarde d'un
 * autre compte**, donc toutes les requêtes SQL des lots suivants partiront de
 * `c.get('compte').id`, jamais d'un identifiant reçu du client.
 *
 * Les administrateurs auront leur propre intergiciel, dans leur propre module
 * (lot 7). On n'ajoutera jamais ici un « ou si je suis admin » : c'est ainsi
 * qu'on fabrique une fuite.
 */

import type { MiddlewareHandler } from 'hono';
import { lireCookie, NOM_COOKIE, resoudreSession, type Compte } from './auth/sessions';

export type Variables = { compte: Compte };

export const exigerSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);
  c.set('compte', compte);
  await next();
};
