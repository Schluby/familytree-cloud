/**
 * FamilyTree Cloud — point d'entrée du Worker.
 *
 * Ce fichier est volontairement mince : il pose le routeur, les en-têtes de
 * sécurité et le ménage nocturne. La logique métier arrive aux lots 1 à 3
 * (voir PLAN.md) et se branche ici en une ligne par domaine.
 *
 * Règle qui ne se relâche jamais : toute requête qui lit ou écrit une
 * sauvegarde porte un `utilisateur_id` dans son WHERE. Aucune exception,
 * pas même pour un administrateur — les admins ont leur propre surface
 * (/api/admin/*), séparée.
 */

import { Hono } from 'hono';
import { routesAuth } from './auth/routes';
import { routesSauvegardes } from './sauvegardes/routes';
import { routesDomaine, santeDuMonde } from './domaine/routes';
import { lireCookie, NOM_COOKIE, resoudreSession } from './auth/sessions';
import type { Variables } from './intergiciels';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/* --------------------------------------------------------------------------
 * En-têtes de sécurité, posés une fois pour toutes.
 * -------------------------------------------------------------------------- */

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  // 180 jours. Cloudflare sert déjà tout en HTTPS ; ceci empêche le tout
  // premier aller-retour en clair.
  c.header('Strict-Transport-Security', 'max-age=15552000');
});

/* --------------------------------------------------------------------------
 * Santé — la seule route du lot 0. Elle prouve trois choses d'un coup :
 * le Worker tourne, la base répond, et le schéma est appliqué.
 * -------------------------------------------------------------------------- */

app.get('/api/sante', async (c) => {
  const debut = Date.now();
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM utilisateurs) AS utilisateurs,
         (SELECT COUNT(*) FROM sauvegardes)  AS sauvegardes`
    ).all<{ utilisateurs: number; sauvegardes: number }>();

    const ligne = results[0] ?? { utilisateurs: 0, sauvegardes: 0 };

    // Connecté, on ajoute ce que la version locale met dans sa propre santé :
    // l'univers ouvert, ses effectifs et ses incohérences. Les deux contrats
    // tiennent dans une seule réponse, sans qu'aucun des deux ne bouge.
    const jeton = lireCookie(c.req.header('Cookie'), NOM_COOKIE);
    const compte = jeton ? await resoudreSession(c.env.DB, jeton) : null;
    const monde = compte
      ? await santeDuMonde(c.env.DB, compte.id, compte.sauvegarde_active)
      : null;

    return c.json({
      ok: true,
      base: 'joignable',
      utilisateurs: ligne.utilisateurs,
      sauvegardes: ligne.sauvegardes,
      ...(monde ?? {}),
      ms: Date.now() - debut,
    });
  } catch (erreur) {
    // Le cas le plus fréquent : les migrations n'ont pas été appliquées.
    return c.json(
      {
        ok: false,
        base: 'injoignable',
        detail: erreur instanceof Error ? erreur.message : String(erreur),
        indice: 'npm run base:local (ou base:ligne) applique les migrations',
      },
      500
    );
  }
});

/* --------------------------------------------------------------------------
 * Les comptes.
 * -------------------------------------------------------------------------- */

app.route('/api/auth', routesAuth);

/* --------------------------------------------------------------------------
 * Les sauvegardes. Tout ce qui est monté ici exige une session, et ne voit
 * jamais que les sauvegardes du compte connecté.
 * -------------------------------------------------------------------------- */

app.route('/api/sauvegardes', routesSauvegardes);

/* --------------------------------------------------------------------------
 * Le domaine : l'arbre lui-même, sur le contrat d'adresses de la version
 * locale (`/api/vue/…`, `/api/personnes/…`). Ces routes portent sur la
 * **sauvegarde active du compte** — c'est ce qui permettra de reprendre `web/`
 * sans le réécrire, au lot 4.
 * -------------------------------------------------------------------------- */

app.route('/api', routesDomaine);

/* --------------------------------------------------------------------------
 * Tout /api/ inconnu répond en JSON, jamais en HTML : le front sait alors
 * distinguer « route absente » de « page de connexion ».
 * -------------------------------------------------------------------------- */

app.all('/api/*', (c) => c.json({ erreur: 'route inconnue' }, 404));

/* --------------------------------------------------------------------------
 * Le reste : un fichier de public/, sinon la page d'accueil (le routage des
 * écrans se fait dans le navigateur).
 * -------------------------------------------------------------------------- */

app.all('*', async (c) => {
  const reponse = await c.env.ASSETS.fetch(c.req.raw);
  if (reponse.status !== 404) return reponse;
  const accueil = new URL('/index.html', c.req.url);
  return c.env.ASSETS.fetch(new Request(accueil, { headers: c.req.raw.headers }));
});

/* --------------------------------------------------------------------------
 * Ménage nocturne (cron). Deux suppressions, pas plus : une session périmée
 * ne sert à rien, un compteur de tentatives non plus.
 * -------------------------------------------------------------------------- */

async function menage(env: Env): Promise<void> {
  const maintenant = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expire_le < ?').bind(maintenant),
    env.DB.prepare('DELETE FROM tentatives WHERE dernier_le < ?').bind(maintenant - 86400),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_evenement: ScheduledController, env: Env): Promise<void> {
    await menage(env);
  },
} satisfies ExportedHandler<Env>;
