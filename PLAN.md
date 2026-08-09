# FamilyTree Cloud — plan de route

Feuille de route de la version hébergée. Un lot = une séance de travail qui
tient debout toute seule : si ça s'arrête au milieu, on reprend au premier ☐
non coché. Les décisions techniques et leurs raisons sont dans
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Protocole de reprise

1. Lire ce fichier, puis `ARCHITECTURE.md` avant de toucher au code.
2. `npm run dev` (wrangler) monte le Worker et une D1 **locale** : on développe
   sans jamais toucher à la base en ligne.
3. Toute requête API doit être testée **avec deux comptes** : un compte ne doit
   jamais voir la sauvegarde d'un autre. C'est le test qu'on n'a pas le droit
   d'oublier.
4. À la fin d'un lot : cocher ici, écrire deux lignes dans le journal du bas.

## Où on en est

**Lot 0 fait, et en ligne (09/08/2026).**

- Adresse : **https://familytree.schlub-perso.workers.dev**
- Compte Cloudflare **`Schlub_perso`** (`1df084d9829788d12811b34411295ca9`),
  créé exprès pour ce projet : les quotas gratuits sont comptés par compte, et
  l'autre compte du même identifiant héberge le site de quelqu'un d'autre.
- Base D1 `familytree` (`790c7252-c1ec-44ed-8885-06c8f44be8c6`), région **WEUR**.
- Dépôt : https://github.com/Schluby/familytree-cloud

**La construction automatique est branchée et vérifiée** : un `git push` sur
`main` applique les migrations puis déploie, sans rien lancer à la main.
Éprouvé le 09/08/2026 à 15:56 (version `4e1ce727`, déclenchée par le dépôt et
non par un envoi manuel).

**Lot 1 livré le 09/08/2026** : on crée son compte et on se connecte, en ligne.
20/20 au harnais, en local **et** en production, plus un parcours complet à la
souris (inscription → code de secours → accueil). Les comptes d'essai ont été
effacés de la base.

**Lot 2 livré le 10/08/2026** : chacun a ses sauvegardes, et personne ne voit
celles des autres. Le harnais est passé à **81 vérifications** et s'appelle
désormais `outils/essai.sh` — il couvre les deux lots, et couvrira les suivants.
La page d'accueil montre un panneau provisoire (créer, importer, copier,
renommer, exporter, supprimer) en attendant l'interface du lot 4.

Le lot 3 n'a pas commencé.

L'application locale (`../FamilyTree_GOT`) reste la référence : c'est elle qui
définit le contrat d'API et le format des sauvegardes.

## Lot 0 — Le squelette  ☑

- ☑ Worker TypeScript + **Hono**, écrit à la main plutôt que par
  `npm create cloudflare@latest` : moins de fichiers, et rien qu'on ne
  comprenne pas.
- ☑ [`wrangler.jsonc`](wrangler.jsonc) (et non `.toml` : le format accepte les
  commentaires, et c'est celui que Wrangler écrit aujourd'hui) — binding D1,
  `public/` en Static Assets avec `run_worker_first: ["/api/*"]`, tâche cron.
- ☑ Le schéma devient [`migrations/0001_schema_initial.sql`](migrations/0001_schema_initial.sql) :
  c'est là que Wrangler le cherche, et il n'en existe donc **qu'une copie**.
  `schema.sql` n'est plus qu'un panneau indicateur.
- ☑ `/api/sante` compte les lignes et le prouve ; tout `/api/*` inconnu répond
  en JSON ; le reste sert un fichier de `public/`, sinon la page d'accueil.
- ☑ En-têtes de sécurité, et ménage nocturne des sessions expirées (cron).
- ☑ Vérifié : `tsc --noEmit` passe, `wrangler deploy --dry-run` construit,
  la migration applique **14 commandes** sur une D1 locale, et
  `curl /api/sante` renvoie `{"ok":true,"base":"joignable",…}`.

*Fini.* `npm run verif` avant chaque push ; `npm run dev` pour travailler.

## Lot 1 — Les comptes  ☑

Inscription **ouverte à qui veut** : personne n'a besoin d'un code, ni de rien
installer.

- ☑ `POST /api/auth/inscription`. **Dérivation en deux temps** au lieu des
  210 000 itérations prévues : Cloudflare plafonne PBKDF2 à 100 000 tours
  (mesuré, voir `ARCHITECTURE.md`). Le navigateur en fait 600 000, le serveur
  25 000 par-dessus — plus solide que le plan d'origine, et le mot de passe ne
  quitte jamais la page.
- ☑ **Code de secours** tiré à l'inscription, affiché une seule fois, stocké
  haché. `POST /api/auth/recuperation` le consomme, en délivre un nouveau et
  ferme toutes les sessions ouvertes.
- ☑ `POST /api/auth/connexion` → cookie `HttpOnly; SameSite=Lax; Max-Age=30 j`,
  `Secure` sauf sur `http://localhost` ; jeton stocké **haché**.
- ☑ `POST /api/auth/deconnexion`, `GET /api/auth/moi` (renvoie aussi le rôle).
- ☑ `exigerSession` dans `src/intergiciels.ts` : c'est lui qui portera le
  cloisonnement des lots suivants.
- ☑ Limites : attente doublante au-delà de 5 échecs, **3 inscriptions par heure
  et par IP**.
- ☑ Page de connexion / inscription / récupération, et la phrase de
  transparence sur l'écran d'inscription.
- ☑ `outils/essai.sh` : 20 vérifications, **deux comptes**, rejouable en local
  comme en ligne. C'est le harnais que les lots suivants étendent. (Il
  s'appelait `essai-comptes.sh` jusqu'au lot 2, qui l'a élargi.)

*Fini.* 20/20 en local et en ligne, dont : un compte ne voit pas l'autre, une
adresse inconnue et un mot de passe faux donnent la même réponse, et le code de
secours change bien le mot de passe.

## Lot 2 — Les sauvegardes, par utilisateur  ☑

- ☑ `GET /api/sauvegardes` (les siennes), `POST` (créer : vierge, copie, ou
  `referentiels` — le même univers sans les fiches), `PATCH` (renommer),
  `DELETE`. Plus `GET /api/sauvegardes/<id>` pour une fiche seule.
- ☑ `GET /api/sauvegardes/<id>/export` (un `.json` réindenté, avec
  `Content-Disposition` : le téléchargement se fait sans une ligne de
  JavaScript), `POST /api/sauvegardes/import`.
- ☑ L'import accepte le **document brut** autant que `{nom, document}` : on
  réimporte un fichier de la version locale par
  `curl --data-binary @sauvegarde.json`, sans rien réemballer.
- ☑ `PUT /api/sauvegardes/<id>/contenu` : le document entier, un seul point
  d'écriture. `GET .../contenu` rend le texte stocké **tel quel**, sans le
  reparser — il est déjà compact, et le budget est le CPU.
- ☑ Le document est stocké **compact** : mesuré sur la vraie campagne,
  **74 717 octets contre 115 069** sur le disque. L'export réindente (deux
  espaces et un saut de ligne final, comme `ecrire_json` en local).
- ☑ **Portraits `data:` retirés** à toute écriture, avec le compte exact rendu
  dans la réponse (`portraits_retires`) ; les `avatar` en `http(s)` survivent.
- ☑ **Plafonds par compte** : 10 sauvegardes (409), 2 Mo chacune (413), avec un
  message qui dit quoi faire. Les plafonds voyagent dans la session, donc les
  vérifier ne coûte aucune requête de plus.
- ☑ **Verrou optimiste** : migration `0002` ajoute `revision`. `modifie_le` ne
  pouvait pas servir — il est en secondes, et deux onglets qui enregistrent
  dans la même seconde s'écraseraient sans bruit. La révision se lit dans
  l'`ETag` de `GET .../contenu` et se renvoie dans le `PUT` ; si elle a bougé,
  409 au lieu d'un écrasement.
- ☑ **Test de cloisonnement** : sept routes essayées par le compte B sur une
  sauvegarde de A (fiche, contenu, export, écriture, renommage, copie,
  suppression) → **404 partout**, jamais 403.
- ☑ Panneau provisoire sur la page d'accueil, en attendant le lot 4.

*Fini.* 81/81 au harnais en local et en ligne, dont l'import de la **vraie
campagne** (72 fiches, 178 liens) et un parcours à la souris jusqu'au
téléchargement du `.json`.

## Lot 3 — Le domaine, porté en TypeScript  ☐

Le gros morceau. On porte, module par module, en gardant les mêmes noms qu'en
Python pour que les deux versions se relisent ensemble.

- ☐ `humeur.ts` (l'échelle 1-7, MD/MP, épaisseur) — le plus simple, à faire en
  premier pour caler la façon de tester.
- ☐ `models.ts` (Personne, Relation, Dataset, normalisations, `migrations`).
- ☐ `genealogie.ts` (générations, couples, fratries déduites, surcharges).
- ☐ `filtres.ts` (variables, segments, dégradé, tests, listes nommées).
- ☐ `vues/sociogramme.ts` : le payload, à l'octet près.
- ☐ Les routes qui vont avec : `/api/vue/<id>`, `/api/personnes/*`,
  `/api/relations/*`, `/api/maisons/*`, `/api/types-relations/*`,
  `/api/categories/*`, `/api/joueurs/*`, `/api/filtres/*`, `/api/listes/*`,
  `/api/referentiels`, `/api/lieux`.
- ☐ **Mesurer le temps CPU** sur un arbre de 500 fiches (le plan gratuit donne
  10 ms par requête) et **noter le chiffre dans le journal**. C'est le seul
  palier qui peut mordre. Replis, dans l'ordre : générations calculées côté
  navigateur, puis normalisation des personnes et relations en lignes D1.

*Fini quand :* pour une même sauvegarde, `/api/vue/sociogramme` renvoie le même
JSON que la version Python (comparaison automatisée, champ par champ).

## Lot 4 — L'interface  ☐

- ☐ Copier `web/` depuis l'application locale dans `public/`. **Aucune
  réécriture** : c'est tout l'intérêt d'avoir gardé le contrat d'API. La copie
  est assumée comme une **fourche** : les deux interfaces vont diverger, et
  l'invariant partagé est le contrat d'API, pas les fichiers.
- ☐ Barre du haut : le compte connecté, un bouton de déconnexion.
- ☐ Le bloc « Sauvegardes » du rail parle aux nouvelles routes (les siennes,
  pas un dossier).
- ☐ Retirer ce qui n'a plus de sens : compteur de modifications en attente **et
  son sondage toutes les 15 s** (240 requêtes/heure et par onglet, pour rien),
  la zone photo de la fiche ; `📸` reste ; `Enregistrer sous…` devient « Tout
  télécharger ».
- ☐ Redirection vers la page de connexion sur 401.
- ☐ **Passe téléphone minimale**, pas une refonte : `<meta viewport>`, les deux
  volets deviennent des tiroirs plein écran, la barre du haut se replie. But
  affiché : **consulter** un arbre depuis un téléphone. Éditer reste une
  activité d'écran large, et c'est dit à l'utilisateur plutôt que subi.

*Fini quand :* on joue une séance complète dans le navigateur, sans jamais
ouvrir un terminal, et qu'un arbre se lit sur un téléphone.

## Lot 5 — Sortir ses données  ☐

- ☐ `GET /api/export/zip` : un `.zip` de toutes ses sauvegardes + un
  `LISEZMOI.txt`. Écrit à la main, en mode « stocké », sans dépendance.
- ☐ Bouton « Tout télécharger » dans la barre du haut.
- ☐ `POST /api/sauvegardes/import` accepte aussi un `.zip`.

*Fini quand :* on télécharge le `.zip`, on l'ouvre dans l'application locale,
et on retrouve tout.

> Le chantier « photos vers R2 » qui figurait ici est **annulé** : la version
> hébergée ne prend pas les portraits (décision du 06/08/2026). Un service de
> moins, une clé de moins, et le stockage devient un non-sujet.

## Lot 6 — Mise en ligne  ☐

- ☐ Suivre [`DEPLOIEMENT.md`](DEPLOIEMENT.md) : base D1 en `weur`, migrations
  en ligne, premier `wrangler deploy`, puis le dépôt branché sur Cloudflare.
  **Aucun secret à poser** — voir « Tranché ».
- ☐ Vérifier les en-têtes : `Secure` sur le cookie, HSTS, pas de `Server`.
- ☐ Verrou optimiste (`modifie_le`) : deux onglets ne s'écrasent plus en
  silence.
- ☐ Purge des sessions expirées (tâche `cron` du Worker, gratuite).
- ☐ Une page « Vos données » : ce qui est stocké, **que les administrateurs
  peuvent consulter les arbres**, tout télécharger, tout supprimer.
- ☐ Mesurer la consommation sur une semaine, la noter ici.

*Fini quand :* l'adresse est partageable et qu'un joueur crée son compte tout
seul.

## Lot 7 — Administration  ☐

Un compte `admin` voit **tous** les arbres, en lecture seule. Les colonnes
nécessaires sont déjà dans [`schema.sql`](schema.sql) : rien à migrer.

- ☐ Promouvoir le premier administrateur **en SQL**
  (`UPDATE utilisateurs SET role='admin' WHERE email_norm='…'`) — jamais depuis
  l'interface, et surtout pas de « le premier inscrit devient admin ».
- ☐ Intergiciel `exigerAdmin`, dans **son propre module**. Les routes de membres
  ne reçoivent aucune exception : on n'y ajoute jamais un « ou si je suis
  admin ».
- ☐ `GET /api/admin/utilisateurs` (comptes, nombre d'arbres, octets, dernier
  accès), `GET /api/admin/utilisateurs/<id>/sauvegardes`,
  `GET /api/admin/sauvegardes/<id>` (le document, en lecture),
  `GET /api/admin/sauvegardes/<id>/export`.
- ☐ `POST /api/admin/utilisateurs/<id>/plafond`,
  `POST /api/admin/utilisateurs/<id>/mot-de-passe` (réinitialisation),
  `DELETE /api/admin/utilisateurs/<id>`.
- ☐ **Aucune écriture sur l'arbre d'autrui** : les routes de modification ne
  savent désigner que la sauvegarde de la session. Vérifié par un test : un
  admin qui tente un `PATCH` sur la sauvegarde d'un autre reçoit un 403.
- ☐ Chaque consultation et chaque export écrivent une ligne dans
  `journal_admin`.
- ☐ Interface : une vue « Administration » (liste des comptes, leurs arbres),
  et un bandeau **« consultation — lecture seule »** quand on ouvre l'arbre de
  quelqu'un d'autre.

*Fini quand :* un admin ouvre l'arbre d'un autre compte, le lit, l'exporte, ne
peut rien y modifier, et que le journal en porte la trace.

## Tranché

- **Inscription ouverte à qui veut**, sans code d'invitation (06/08/2026). D'où
  le code de secours, les plafonds par compte et la limite d'inscriptions par
  IP au lot 1.
- **Rien à installer côté utilisateur** : une adresse, un navigateur, un compte.
  L'export `.zip` reste une possibilité, jamais un passage obligé.
- **Comptes administrateurs** voyant tous les arbres, en **lecture seule**, par
  une surface d'API séparée et journalisée (lot 7).
- **Pas de photos en ligne**, donc pas de R2.

Tranché le **08/08/2026**, pour que « pousser suffise » :

- **Une seule brique en plus du Worker : la base D1.** Ni KV (cohérence
  différée : une déconnexion mettrait une minute à prendre effet), ni Durable
  Objects (il n'y a pas d'édition simultanée en temps réel), ni Queues (rien
  d'asynchrone), ni Pages (fusionné dans Workers ; un seul domaine évite CORS
  et fait marcher le cookie sans contorsion).
- **Aucun secret.** Le `SESSION_SECRET` du lot 6 est **abandonné** : les jetons
  de session sont aléatoires et stockés hachés, il n'y a rien à signer. Un
  poivre de hachage n'aurait ajouté qu'un risque — le perdre rendrait tous les
  mots de passe invérifiables. Un déploiement propre ne demande donc rien à
  ressaisir.
- **Déploiement par la construction Cloudflare** branchée sur le dépôt Git,
  *deploy command* = `npm run deploy` (migrations **puis** déploiement).
  GitHub Actions reste en réserve, en fichier `.exemple` non actif.
- **Les migrations sont additives.** On ne modifie jamais un fichier déjà
  appliqué en ligne : on ajoute `0002_…`. C'est la condition pour qu'un push
  ne puisse pas casser la base.
- **Un seul environnement**, la production. Pas de préproduction : ce serait un
  deuxième Worker et une deuxième base à tenir à jour. Le banc d'essai, c'est
  `npm run dev` sur une D1 **locale**. (Cloudflare crée tout de même une
  version de prévisualisation pour les pushes hors `main` : c'est gratuit et
  ça ne coûte aucune maintenance.)
- **Adresse : `workers.dev`** pour l'instant. HTTPS d'office, isolation des
  cookies garantie (`workers.dev` est sur la *Public Suffix List*). Un domaine
  à soi se branche en trois clics le jour où on en veut un ; le seul coût est
  une reconnexion pour tout le monde.
- **Téléphone : consulter oui, éditer non.** Une passe minimale au lot 4
  (volets en tiroirs, barre repliable) au lieu d'une refonte. C'est un choix
  d'effort : rendre l'édition confortable au doigt vaut un lot entier, et
  l'usage réel est un arbre qu'on regarde en séance.
- **Dépôt Git séparé de l'application locale.** Deux projets, deux dépôts :
  sinon chaque retouche du Python déclencherait une construction Cloudflare.

Tranché le **10/08/2026**, au lot 2 :

- **Le nom d'une sauvegarde vit dans sa colonne, pas dans son document.** En
  local, renommer réécrit `meta.sauvegarde` dans le fichier ; ici ce serait
  relire, reparser et réécrire 75 Ko pour un libellé. Les deux ne sont recollés
  qu'à l'**export**, seul moment où le fichier doit se suffire à lui-même.
- **`revision`, et pas `modifie_le`, pour le verrou optimiste.** Les secondes
  ont une zone aveugle : deux enregistrements dans la même seconde passeraient
  tous les deux. Un compteur qui ne fait qu'augmenter n'en a pas.
- **Le lot 2 ne normalise pas le document**, il le stocke tel qu'il arrive
  (moins les portraits `data:`), exactement comme le fichier local. La
  normalisation, c'est `models.ts` au lot 3 : elle se branchera dans
  `preparerDocument`, qui est déjà le passage obligé des trois écritures.
- **404 et jamais 403** sur une sauvegarde qui n'est pas la sienne — un 403
  confirmerait que l'identifiant existe.

## À trancher

- **Le partage entre membres** : montrer un arbre en lecture seule à ses propres
  joueurs, sans en faire des administrateurs ? Ce serait un lot 8 et une table
  `partages`. **Repoussé volontairement** : tant qu'il n'y a pas d'utilisateurs,
  on ne sait pas si le besoin est « montrer » ou « co-éditer », et les deux
  n'ont pas la même réponse.
- **Vérification de l'adresse de courriel** : impossible sans service d'envoi.
  Conséquence acceptée : une adresse peut être fausse, et c'est le code de
  secours qui sert de filet. À revoir si un jour on a un service d'envoi
  gratuit fiable.

## Journal

- **06/08/2026** — dossier créé, architecture arrêtée : Workers + D1 + Static
  Assets, comptes maison (PBKDF2 + cookie de session), contrat d'API identique
  à la version locale pour réutiliser `web/` sans le réécrire, export `.zip`
  pour que partir ne coûte rien. Aucun code encore.
- **06/08/2026** — **inscription ouverte, rien à installer, comptes
  administrateurs**. L'inscription ouverte amène trois choses au lot 1 : code de
  secours (pas de courriel, donc pas de « mot de passe oublié » classique),
  plafonds par compte (10 sauvegardes de 2 Mo — sinon un compte peut remplir la
  base), limite d'inscriptions par IP. Les administrateurs deviennent le lot 7 :
  **surface d'API séparée, lecture seule, journalisée**, et l'API des membres
  garde son `WHERE utilisateur_id = ?` intact — aucune exception « ou si je suis
  admin » nulle part. Les colonnes (`role`, `code_secours`, `plafond_*`) et la
  table `journal_admin` sont dans le schéma dès maintenant : rien à migrer.
- **08/08/2026** — **lot 0 écrit et vérifié**, et la chaîne de déploiement
  arrêtée pour que « pousser » suffise : Worker `familytree` + base D1
  `familytree` (`weur`), **rien d'autre**, **aucun secret**, construction
  Cloudflare branchée sur le dépôt avec `npm run deploy` en commande de
  déploiement. Marche à suivre complète dans `DEPLOIEMENT.md`. Chiffres
  Cloudflare **revérifiés à la source** ce jour : 10 ms de CPU par requête,
  100 000 requêtes/jour, 5 Go et 100 000 lignes écrites/jour pour D1, 3 000
  minutes de construction par mois. **Piège trouvé** : le jeton créé
  automatiquement par la construction Cloudflare couvre Workers/KV/R2 mais
  **pas D1** — il faut lui ajouter `D1:Edit`, sinon la migration échoue au
  déploiement. Décisions annexes tranchées : `workers.dev` pour l'adresse,
  téléphone en consultation seulement (passe minimale au lot 4), partage entre
  membres repoussé, un seul environnement, migrations additives.
- **06/08/2026** — **pas de photos en ligne** (décision de Maxime), donc R2
  abandonné et lot 5 réduit à l'export. Faisabilité chiffrée sur la vraie
  campagne : 73 Ko compact pour 72 fiches, 8 requêtes par chargement de page,
  1 ligne écrite par modification → **moins de 5 % du palier gratuit** pour une
  dizaine de personnes. Le seul point serré reste le temps de CPU par requête,
  avec deux replis prévus. « Une instance par personne » se fait par les
  **comptes**, pas par des déploiements séparés (les quotas sont par compte
  Cloudflare, pas par Worker).
- **09/08/2026** — **en ligne**, sur https://familytree.schlub-perso.workers.dev.
  Compte `Schlub_perso` créé exprès : les quotas gratuits sont comptés **par
  compte**, et l'autre compte du même identifiant héberge le site d'un tiers —
  une pointe de trafic sur une inscription ouverte aurait pu le couper jusqu'à
  minuit UTC. Base D1 en WEUR, migrations appliquées, Worker déployé à la main,
  **puis** la construction Cloudflare branchée sur le dépôt et **éprouvée par un
  vrai push** (version `4e1ce727`, déclenchée par le dépôt et non par un envoi
  manuel). Le déploiement automatique applique les migrations *avant* de
  déployer : son existence prouve donc que la permission `D1:Edit` du jeton de
  construction est bien posée. Trois pièges rencontrés, consignés en tête de
  `DEPLOIEMENT.md` — dont le plus coûteux : `wrangler login` ne couvre que les
  comptes existant **au moment de l'autorisation**.
- **09/08/2026** — **lot 1 : les comptes**, en ligne. La conception a changé
  sur mesure, pas sur intuition : Cloudflare **plafonne PBKDF2 à 100 000
  tours**, donc les 210 000 prévus étaient impossibles, et même le maximum
  coûte 19 ms de CPU pour un budget documenté de 10. D'où une **dérivation en
  deux temps** — 600 000 tours dans le navigateur, 25 000 sur le serveur : plus
  solide que le plan d'origine, et le mot de passe ne quitte jamais la page.
  Détail et chiffres dans `ARCHITECTURE.md`. Vérifié par `outils/essai.sh`
  (20 contrôles, deux comptes) en local et en ligne, puis par un parcours à la
  souris. La limite de 3 inscriptions/heure/IP s'est déclenchée toute seule
  pendant les essais : elle marche.
