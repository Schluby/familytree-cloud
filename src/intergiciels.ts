/**
 * L'intergiciel qui garde les routes de membres.
 *
 * Il pose le compte connecté dans le contexte, et rien d'autre. C'est
 * volontaire : **aucune route ne doit pouvoir désigner la sauvegarde d'un
 * autre compte**, donc toutes les requêtes SQL des lots suivants partiront de
 * `c.get('compte').id`, jamais d'un identifiant reçu du client.
 *
 * Les administrateurs ont leur propre intergiciel, dans leur propre module
 * (`src/admin/`). On n'ajoutera jamais ici un « ou si je suis admin » : c'est
 * ainsi qu'on fabrique une fuite. Ce module ne connaît pas les rôles, et il
 * n'a pas à les connaître.
 */

import type { MiddlewareHandler } from 'hono';
import { lireCookie, NOM_COOKIE, resoudreSession, type Compte } from './auth/sessions';

export type Variables = { compte: Compte };

export const exigerSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  // Un compte déjà posé sur le contexte l'a été par un intergiciel authentifié
  // en amont — en pratique `src/admin/procuration.ts`, qui substitue le
  // propriétaire d'un arbre pour qu'un administrateur puisse y écrire. Le
  // relire depuis le cookie ramènerait l'administrateur sur son propre arbre.
  //
  // Ce n'est pas une exception de rôle : ce module ignore toujours ce qu'est un
  // administrateur. C'est la règle « le contexte fait foi », et le seul moyen
  // de la déclencher est de passer par un intergiciel qui a déjà authentifié
  // quelqu'un.
  if (c.get('compte')) return next();

  const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
  const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
  if (!compte) return c.json({ erreur: 'non connecté' }, 401);
  c.set('compte', compte);
  await next();
};
