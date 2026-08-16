/**
 * Où l'application est montée.
 *
 * `myschlub.com` porte deux sociogrammes : celui-ci, celui du JDR, sous
 * `/sociogram/got` — et la version « vraie vie » sous `/sociogram/irl`, qui est
 * un autre Worker, une autre base, un autre dépôt. Le préfixe est donc une
 * propriété du **projet**, pas un réglage : il est lu au chargement du module,
 * avant qu'aucune requête n'arrive, parce que `app.basePath()` enregistre les
 * routes une fois pour toutes.
 *
 * TROIS ENDROITS DOIVENT DIRE LA MÊME CHOSE. `outils/verifier-prefixe.mjs` le
 * contrôle, et `npm run verif` l'appelle :
 *
 *   1. cette constante ;
 *   2. `assets.run_worker_first` dans `wrangler.jsonc` ;
 *   3. l'arborescence de `public/` — les fichiers vivent **sous le préfixe**.
 *
 * Le troisième n'est pas une coquetterie, c'est le cœur de l'affaire. Le
 * serveur de fichiers de Cloudflare cherche le fichier au chemin demandé et le
 * sert **sans appeler le Worker** : c'est ce qui permet à la quinzaine de
 * fichiers d'une page de ne rien coûter sur les 100 000 requêtes quotidiennes
 * du palier gratuit. Un `public/` resté plat ferait manquer chaque fichier,
 * retomber sur le Worker, et multiplierait par six la consommation.
 *
 * La chaîne vide monte l'application à la racine : c'est la forme d'avant le
 * lot 18, et elle reste valable — `basePath('')` n'est simplement pas appelé.
 */
export const BASE = '/sociogram/got';

/**
 * Le nom du cookie de session.
 *
 * Il porte le projet parce que **deux applications partagent un domaine**.
 * Les chemins de cookie ne se recouvrent pas (`/sociogram/got` et
 * `/sociogram/irl` sont disjoints), donc deux cookies homonymes tiendraient ;
 * mais deux noms distincts évitent d'avoir à s'en remettre à cette subtilité,
 * et rendent lisible ce qu'on voit dans l'inspecteur du navigateur.
 */
export const NOM_COOKIE = 'ft_got_session';

/**
 * Ce projet sert-il la racine du domaine ?
 *
 * `myschlub.com` tout court doit répondre quelque chose — c'est là que mènent
 * tous les liens d'avant le déménagement. La page de choix (`public/index.html`)
 * s'en charge, mais elle n'appartient à aucune des deux applications : **un seul
 * des deux dépôts la porte**, et c'est celui-ci, parce que le Custom Domain
 * `myschlub.com` est posé sur son Worker.
 *
 * L'IRL, lui, ne reçoit que `/sociogram/irl/*` par une route : sa racine ne
 * serait jamais servie, et y laisser une copie de la page de choix ferait deux
 * versions à tenir dont une morte.
 *
 * `outils/verifier-prefixe.mjs` lit cette constante pour savoir s'il doit
 * exiger la page ou en refuser une.
 */
export const SERT_LA_RACINE = true;
