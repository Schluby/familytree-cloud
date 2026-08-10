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
import { routesAdmin } from './admin/routes';
import { routesDomaine, santeDuMonde } from './domaine/routes';
import { lireCookie, NOM_COOKIE, resoudreSession } from './auth/sessions';
import type { Variables } from './intergiciels';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/* --------------------------------------------------------------------------
 * En-têtes de sécurité, posés une fois pour toutes.
 * -------------------------------------------------------------------------- */

/**
 * L'application ne charge rien d'ailleurs : d3 est servi depuis `public/`, il
 * n'y a aucun script en ligne, et le seul appel réseau va à sa propre origine.
 * La politique peut donc être stricte sans rien casser.
 *
 * Deux ouvertures, chacune pour une raison précise :
 * - `img-src … https:` — les portraits sont des **adresses** d'images hébergées
 *   ailleurs (décision du 06/08 : rien n'est stocké ici) ; `data:` couvre la
 *   favicon, un SVG en ligne.
 * - `style-src 'unsafe-inline'` — d3 pose des styles par `setAttribute`, ce que
 *   la politique bloquerait. `script-src` reste strict, et c'est lui qui compte
 *   contre l'injection.
 */
const POLITIQUE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();

  // Une réponse issue d'un `fetch` — c'est le cas de tous les fichiers de
  // `public/` — a des en-têtes **immuables** : `c.header()` n'y peut rien, et
  // les protections ne s'appliquaient qu'aux réponses JSON. Autrement dit :
  // pas à la page HTML, celle qui en a le plus besoin. On recopie donc la
  // réponse pour pouvoir l'habiller.
  const entetes = new Headers(c.res.headers);
  entetes.set('X-Content-Type-Options', 'nosniff');
  entetes.set('Referrer-Policy', 'same-origin');
  entetes.set('X-Frame-Options', 'DENY');
  entetes.set('Content-Security-Policy', POLITIQUE);
  // 180 jours. Cloudflare sert déjà tout en HTTPS ; ceci empêche le tout
  // premier aller-retour en clair.
  entetes.set('Strict-Transport-Security', 'max-age=15552000');

  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: entetes,
  });
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
 * L'administration : une surface **séparée**, montée avant `/api` pour que
 * `/api/admin/*` ne tombe jamais dans les routes du domaine. Elle a son propre
 * intergiciel (`src/admin/intergiciel.ts`) ; les routes de membres, elles,
 * ignorent qu'un rôle existe.
 * -------------------------------------------------------------------------- */

app.route('/api/admin', routesAdmin);

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
 * Ménage nocturne (cron). Que des suppressions de choses périmées : une
 * session expirée ne sert à rien, un compteur de tentatives non plus, et un
 * lien de réinitialisation qui n'est plus valable encore moins.
 * -------------------------------------------------------------------------- */

async function menage(env: Env): Promise<void> {
  const maintenant = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expire_le < ?').bind(maintenant),
    env.DB.prepare('DELETE FROM tentatives WHERE dernier_le < ?').bind(maintenant - 86400),
    // Un jour de marge : de quoi expliquer un « ce lien n'est plus valable »
    // à quelqu'un qui écrit le lendemain.
    env.DB.prepare('DELETE FROM reinitialisations WHERE expire_le < ?').bind(maintenant - 86400),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_evenement: ScheduledController, env: Env): Promise<void> {
    await menage(env);
  },
} satisfies ExportedHandler<Env>;
