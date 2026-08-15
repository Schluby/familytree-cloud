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

> **Cette section date des premiers jours et n'a pas été réécrite** — elle
> raconte l'ordre dans lequel les lots 0 à 5 sont tombés. L'état courant est
> dans [`REPRISE.md`](REPRISE.md) ; le détail de chaque lot, y compris les
> lots 8 à 11 ajoutés après coup, est dans les sections ci-dessous.

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

**Lot 3 livré le 10/08/2026** : le domaine tourne en TypeScript, et dit la même
chose que la version Python — 28/28 à `outils/comparer.mjs` sur la vraie
campagne. Le harnais est à **100 vérifications**. Prochain lot : l'interface
(lot 4), qui recopie `web/` sans le réécrire.

**Lot 2 livré le 10/08/2026** : chacun a ses sauvegardes, et personne ne voit
celles des autres. Le harnais est passé à **83 vérifications** et s'appelle
désormais `outils/essai.sh` — il couvre les deux lots, et couvrira les suivants.
La page d'accueil montre un panneau provisoire (créer, importer, copier,
renommer, exporter, supprimer) en attendant l'interface du lot 4.

**Lot 4 livré le 10/08/2026** : l'interface de l'application locale tourne en
ligne, sur les comptes et les sauvegardes du nuage. Le panneau provisoire du
lot 2 a disparu — la racine sert l'application.

**Lot 5 livré le 10/08/2026** : tout se récupère. Les cinq tableaux, le CSV, le
classeur Excel et un `.zip` de tout le compte. Le portage de `backend/` est
**complet** : plus une seule vue ni un seul module qui manque, et le
comparateur ne tolère plus aucune divergence (36/36).

Le lot 6 n'a pas commencé.

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

*Fini.* 83/83 au harnais en local **et** en ligne, dont l'import de la **vraie
campagne** (72 fiches, 178 liens) et un parcours à la souris jusqu'au
téléchargement du `.json`. Temps de CPU mesurés en production : **≤ 11 ms** pour
toutes les routes de sauvegardes, contre 14 ms pour l'inscription — le document
n'est pas ce qui coûte cher.

## Lot 3 — Le domaine, porté en TypeScript  ☑

Le gros morceau. Porté module par module, en gardant les mêmes noms qu'en
Python pour que les deux versions se relisent ensemble.

- ☑ `humeur.ts` (l'échelle 1-7, MD/MP, épaisseur) et `migrations.ts` (celles du
  **document**, à ne pas confondre avec `migrations/` qui fait bouger le schéma).
- ☑ `python.ts` : les deux comportements de Python qu'il fallait reproduire —
  `round()` envoie la moitié **au pair** (12.25 → 12.2), et `int()` tronque vers
  zéro et **refuse** « 4.5 ». Isolés là, avec leurs contre-exemples.
- ☑ `models.ts` (Personne, Relation, Dataset, normalisations, `extra` préservé).
- ☑ `referentiels.ts` (maisons, types, catégories, joueurs, couleurs auto) et
  `genealogie.ts` (générations, couples, fratries déduites, surcharges).
- ☑ `filtres.ts` (variables, segments, dégradé, tests, listes nommées).
- ☑ `vues/sociogramme.ts` + `vues/base.ts`.
- ☑ Les 35 routes qui vont avec, sur le contrat d'adresses de la version locale.
- ☑ **Migration `0003` : la sauvegarde active, par compte.** C'est elle qui
  permet à `/api/personnes/<id>` de ne pas nommer la sauvegarde — donc au
  lot 4 de reprendre `web/` sans le réécrire.
- ☑ **`outils/comparer.mjs`** : prend le document de la version Python,
  l'importe dans la version TypeScript, compare champ par champ. **28/28 sur
  la vraie campagne**, en local et en production.
- ☑ **Temps de CPU mesuré**, en production, sur des arbres fabriqués
  (`outils/gros-arbre.mjs`, `outils/mesurer.mjs`) — voir le journal.

**Deux choses volontairement laissées de côté**, pour ne pas livrer un onglet
qui plante :

- La vue **« tableaux & exports »** dépend de `exports.py` (CSV, classeur
  Excel) : elle arrive au **lot 5**, avec lui. C'est la seule divergence de la
  comparaison, et elle y est **déclarée nommément** — tout autre écart la fait
  échouer.
- Les **portraits** : `portraits.ts` refuse une image collée avec un message
  affichable, là où `photos.py` l'accepte. Décision du 06/08, pas un oubli.

*Fini.* 100/100 au harnais et 28/28 à la comparaison, en local **et** en ligne.

## Lot 4 — L'interface  ☑

- ☑ Copier `web/` depuis l'application locale dans `public/`. **Aucune
  réécriture** : c'est tout l'intérêt d'avoir gardé le contrat d'API. La copie
  est assumée comme une **fourche** : les deux interfaces vont diverger, et
  l'invariant partagé est le contrat d'API, pas les fichiers.
  → 12 fichiers repris (≈ 8 900 lignes), d3 compris.
- ☑ Barre du haut : le compte connecté, un bouton de déconnexion.
- ☑ Le bloc « Sauvegardes » du rail parle aux nouvelles routes (les siennes,
  pas un dossier), et affiche les plafonds du compte.
- ☑ Retirer ce qui n'a plus de sens : compteur de modifications en attente **et
  son sondage toutes les 15 s** (240 requêtes/heure et par onglet, pour rien),
  la zone photo de la fiche ; `📸` reste ; `Enregistrer sous…` devient « Tout
  télécharger ».
- ☑ Redirection vers la page de connexion sur 401.
- ☑ **Passe téléphone minimale**, pas une refonte : `<meta viewport>`, les deux
  volets deviennent des tiroirs plein écran, la barre du haut se replie. But
  affiché : **consulter** un arbre depuis un téléphone. Éditer reste une
  activité d'écran large, et c'est dit à l'utilisateur plutôt que subi.

*Fini.* Séance jouée dans le navigateur sans ouvrir un terminal ; un champ tapé
dans la fiche est en base 1,8 s plus tard, sans bouton ; les deux volets
s'ouvrent et se ferment sur 375 px de large, sans débordement horizontal.
`outils/essai.sh` est passé à **111 vérifications**.

**Trois décisions prises en chemin, à ne pas rejouer :**

- **`public/js/api.js` est la couture de la fourche.** Tout ce que la version
  en ligne fait autrement y est absorbé — la session, la forme de la liste des
  sauvegardes, l'absence d'écriture différée — pour que `main.js`, `panel.js`
  et les éditeurs restent la copie de la version locale. Une divergence qui
  peut tenir dans `api.js` doit y tenir.
- **Les instantanés n'ont pas de table.** En ligne, une copie datée *est* une
  sauvegarde de plus : `📸` appelle la route de copie existante, et
  « restaurer » se fait en ouvrant la copie, ce qui se voit dans le rail au
  lieu de se deviner. La table `instantanes` du lot 0 reste vide, et aucun lot
  ne la programme.
- **Les portraits sont des adresses, pas des fichiers.** La pastille de la
  fiche demande une adresse `https://…` ; le collage, le dépôt et le choix de
  fichier sont retirés, `photos.js` avec. Le serveur refusait déjà les `data:`
  (décision du 06/08) — l'interface le dit maintenant au lieu de le subir.

**Ce qui n'a pas suivi, et pourquoi :** l'export en classeur Excel a disparu du
menu des sauvegardes, faute d'existence côté serveur. Il revient au lot 5 avec
`exports.py` et la vue « Tableaux & exports ».

## Lot 5 — Sortir ses données  ☑

- ☑ `GET /api/export/zip` : un `.zip` de toutes ses sauvegardes + un
  `LISEZMOI.txt`. Écrit à la main, sans dépendance — `src/domaine/zip.ts`.
  Dégonflé plutôt que stocké : `CompressionStream` est fourni par la
  plateforme, et une campagne de 200 fiches tombe de 168 à 10 Ko.
- ☑ Bouton « Tout télécharger » dans la barre du haut.
- ☑ L'import accepte aussi un `.zip`.
- ☑ **Portage d'`exports.py`** (`src/domaine/exports.ts`) : les cinq tableaux,
  le CSV point-virgule à BOM, et le classeur Excel écrit à la main.
- ☑ **La vue « Tableaux & exports » est déclarée** dans le registre : c'était
  la seule vue non portée au lot 3, et la seule divergence tolérée du
  comparateur. `ATTENDUES` est désormais **vide**.

*Fini.* On télécharge le `.zip`, on le rouvre, on retrouve tout — 200 fiches et
428 liens intacts, dans 10 Ko.

**Deux décisions, à ne pas rejouer :**

- **Le dézippage se fait dans le navigateur, pas sur le serveur.** Le plan
  disait « `POST /api/sauvegardes/import` accepte aussi un `.zip` » ; une
  archive peut contenir dix sauvegardes de deux mégaoctets, et un Worker
  dispose d'une poignée de millisecondes de calcul par requête. `public/js/zip.js`
  ouvre l'archive et renvoie chaque sauvegarde par la route d'import normale,
  une à la fois : les plafonds sont vérifiés comme d'habitude, et une entrée
  fautive échoue toute seule au lieu de faire tomber une requête géante.
- **`src/domaine/zip.ts` est partagé** par le classeur Excel et l'archive du
  compte : un `.xlsx` *est* un ZIP d'XML. Un seul écrivain, testé deux fois.

**Ce que la vérification a gagné :** `outils/comparer.mjs` ne compare plus
seulement du JSON. Il télécharge les cinq CSV et le classeur Excel des deux
versions et compare **les octets** — et, pour le `.xlsx`, les parties XML à
l'intérieur de l'archive, parce que deux ZIP du même contenu ne sont pas
forcément identiques. Score : **36/36, zéro tolérance**.

> Le chantier « photos vers R2 » qui figurait ici est **annulé** : la version
> hébergée ne prend pas les portraits (décision du 06/08/2026). Un service de
> moins, une clé de moins, et le stockage devient un non-sujet.

## Lot 6 — Mise en ligne  ☑

- ☑ Suivre [`DEPLOIEMENT.md`](DEPLOIEMENT.md) : base D1 en `weur`, migrations
  en ligne, premier `wrangler deploy`, puis le dépôt branché sur Cloudflare.
  **Aucun secret à poser** — voir « Tranché ». *(fait au lot 1)*
- ☑ Vérifier les en-têtes : `Secure` sur le cookie, HSTS, pas de `Server`.
- ☑ Verrou optimiste : `revision` plutôt que `modifie_le`, dont la seconde a un
  angle mort. *(fait au lot 2)*
- ☑ Purge des sessions expirées (tâche `cron` du Worker, gratuite). *(lot 0)*
- ☑ Une page « Vos données » : ce qui est stocké, **que les administrateurs
  peuvent consulter les arbres**, tout télécharger, tout supprimer.
- ☐ Mesurer la consommation sur une semaine, la noter ici.
  → **Relevé de départ posé le 10/08/2026** : 2 comptes, 1 sauvegarde. À
  relire dans le tableau de bord Cloudflare **le 17/08/2026**.

*Fini quand :* l'adresse est partageable et qu'un joueur crée son compte tout
seul. **C'est le cas** — il ne reste que le relevé de consommation, qui demande
une semaine de calendrier, pas une heure de travail.

**Ce que la vérification des en-têtes a révélé.** Ils étaient posés par un
intergiciel du Worker… qui ne voyait **aucune page HTML**. Deux causes qui se
cumulaient :

1. `wrangler.jsonc` déclare `run_worker_first: ["/api/*"]` : tout le reste est
   servi directement par le serveur de fichiers de Cloudflare, sans que le
   Worker soit appelé.
2. Même quand il l'était, `c.header()` ne pouvait rien : une réponse issue d'un
   `fetch` a des en-têtes **immuables**, et les protections ne s'appliquaient
   donc qu'aux réponses JSON fabriquées à la main.

Les deux sont corrigés — [`public/_headers`](public/_headers) pour les fichiers
statiques, une recopie de la réponse dans `src/index.ts` pour l'API — et
**vérifiés séparément** par le harnais, parce que ce sont deux surfaces
distinctes. Faire passer tous les fichiers par le Worker aurait tout unifié,
au prix d'une invocation par fichier servi : une quinzaine par chargement de
page, sur un quota de 100 000 par jour. Le prix de l'élégance était trop élevé.

**Ajouté au passage :** une politique de contenu (`Content-Security-Policy`)
stricte sur les scripts. L'application ne charge rien d'ailleurs — d3 est servi
localement, il n'y a aucun script en ligne — donc `script-src 'self'` ne coûte
rien et ferme la porte à l'injection.

**Non faisable, et il faut le dire :** `Server: cloudflare` **ne peut pas être
retiré**. C'est le bord du réseau qui l'ajoute, après le Worker. Aucun code ne
peut l'enlever ; il faudrait ne pas être chez Cloudflare.

## Lot 7 — Administration  ☑

Un compte `admin` voit **tous** les arbres, en lecture seule. Les colonnes
nécessaires étaient déjà dans le schéma : rien à migrer.

- ☑ Promouvoir le premier administrateur **en SQL**
  (`UPDATE utilisateurs SET role='admin' WHERE email_norm='…'`) — jamais depuis
  l'interface, et surtout pas de « le premier inscrit devient admin ». La marche
  à suivre est dans [`DEPLOIEMENT.md`](DEPLOIEMENT.md).
- ☑ Intergiciel `exigerAdmin`, dans **son propre module**
  ([`src/admin/intergiciel.ts`](src/admin/intergiciel.ts)). Les routes de
  membres ne reçoivent aucune exception : `src/intergiciels.ts` n'apprend
  toujours pas qu'un rôle existe.
- ☑ `GET /api/admin/utilisateurs`, `…/<id>/sauvegardes`,
  `GET /api/admin/sauvegardes/<id>`, `…/<id>/export` (JSON et `?format=xlsx`).
- ☑ `POST …/<id>/plafond`, `POST …/<id>/mot-de-passe`,
  `DELETE /api/admin/utilisateurs/<id>`.
- ☑ **Aucune écriture sur l'arbre d'autrui.**
- ☑ Chaque consultation, export, changement de plafond, réinitialisation et
  suppression écrit une ligne dans `journal_admin`. **Aucune route ne l'efface.**
- ☑ Interface : [`public/admin.html`](public/admin.html) — comptes, arbres,
  consultation avec bandeau **« consultation — lecture seule »**, et le journal.
  Le lien ⚙ n'apparaît que pour un administrateur.

*Fini.* Un admin ouvre l'arbre d'un autre compte, le lit (les cinq tableaux),
l'exporte, ne peut rien y modifier, et le journal en porte la trace.
`outils/essai.sh` est passé à **174 vérifications** — il promeut un compte
d'essai **en SQL**, comme un vrai premier administrateur, puis le redescend.

**Deux décisions, dont une qui contredit ce plan :**

- **La garde de lecture seule est posée sur le chemin, pas sur les routes.**
  `routesAdmin.use('/sauvegardes/*', lectureSeule)` refuse tout verbe autre que
  GET. C'est ce qui la rend vraie pour les routes **qui n'existent pas encore** :
  ajouter demain un `PATCH` par distraction ne suffirait pas à ouvrir une
  brèche.
- **Le 403 demandé plus haut est un 404, et c'est mieux ainsi.** Ce plan
  demandait qu'« un admin qui tente un `PATCH` sur la sauvegarde d'un autre
  reçoive un 403 ». L'obtenir aurait demandé d'apprendre le rôle aux routes de
  membres — c'est-à-dire exactement le « ou si je suis admin » que le point
  précédent interdit. Les routes de membres restent donc aveugles : elles
  répondent **404** à tout le monde, admin compris. Le **403** existe, mais là
  où il a un sens : sur la surface d'administration, où l'existence de la
  sauvegarde n'est pas un secret. **Les deux sont vérifiés séparément.**

**Consulter, c'est lire des tableaux, pas le document brut.**
`GET /api/admin/sauvegardes/<id>` renvoie les cinq tableaux d'`exports.ts`. Même
contenu, mais il n'existe aucun chemin, depuis cette réponse, qui ramène vers
l'écriture — et la page n'a pas un seul champ modifiable.

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

Tranché le **10/08/2026**, au lot 3 :

- **« Le même JSON » se juge après analyse, pas octet par octet.** Python écrit
  `4.0` là où JavaScript écrit `4` : les deux disent le même nombre, et le
  consommateur est un navigateur, qui ne sait pas les distinguer. Exiger
  l'identité des octets reviendrait à demander à JavaScript d'imiter le
  formateur de flottants de Python, sans que personne n'y gagne.
- **La sauvegarde active est par compte**, portée par la session. C'est ce qui
  permet aux adresses de ne pas la nommer — et donc à `web/` d'être recopié tel
  quel au lot 4.
- **L'intergiciel de session est posé route par route**, jamais sur `*` : monté
  sur `/api`, un `*` exigerait une session pour s'inscrire. La liste des
  chemins protégés sert aussi d'inventaire de la surface du domaine.

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
- **Les instantanés.** La table `instantanes` existe depuis le lot 0, et
  l'application locale sait en faire — mais **aucun lot ne les programme**.
  Constaté au lot 2, laissé ouvert exprès : tant que l'interface n'est pas là
  (lot 4), on ne sait pas si l'utile est « une copie datée à la demande » ou
  « les cinq derniers états, automatiques ». Le point d'écriture est déjà prêt
  (`PUT .../contenu` restaure un document entier) ; il ne manquerait que les
  routes.
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
- **10/08/2026** — **lot 2 : les sauvegardes**, en ligne. Chacun a les siennes,
  et sept routes essayées par un second compte répondent **404, jamais 403**.
  Le harnais passe à 83 vérifications, en local **et** en production, dont
  l'import de la vraie campagne : **74 717 octets compacts contre 115 069** sur
  le disque, ce qui confirme le chiffre du 06/08 sans l'avoir supposé.
  **Temps de CPU mesurés en production** (`wrangler tail`, 50 requêtes) :
  inscription 14 ms, connexion 12 ms, `PUT .../contenu` 11 ms, import de la
  campagne 9 ms, export 5 ms, lecture d'un document 7 ms au pire et 1 ms en
  médiane, liste 1 à 2 ms. **Aucune exception, aucun `outcome` autre que `ok`**,
  y compris sur le refus d'un document de 2,4 Mo. Le portage du lot 3 a donc de
  la marge : ce qui coûte, c'est PBKDF2, pas le document.
  Deux corrections de conception faites en chemin, l'une et l'autre pour éviter
  une perte silencieuse : `modifie_le` **ne pouvait pas** servir de verrou
  optimiste (secondes → deux onglets de la même seconde passent tous les deux),
  d'où la migration `0002` et sa colonne `revision` ; et l'upsert du contenu
  plutôt qu'un `UPDATE`, qui ne dirait rien si la ligne manquait.
  **La chaîne des migrations additives est éprouvée pour de vrai** : `0002` a
  été appliquée en ligne **par le déploiement**, sans commande à la main.
  Un piège de plus, consigné dans `DEPLOIEMENT.md` : juste après un push, les
  routes neuves répondent 404 sur les points de présence encore à l'ancienne
  version — une vérification a échoué pour ça, et repassait deux minutes plus
  tard. Attendre une minute avant de lancer le harnais.
- **10/08/2026** — **lot 3 : le domaine, en TypeScript**, en ligne. Les deux
  versions répondent **la même chose, champ par champ** : 28/28 sur la vraie
  campagne (72 fiches, 178 liens), dont `/api/dataset` — l'aller-retour complet
  par les modèles — et les neuf réglages du sociogramme. Le comparateur
  n'espère pas que les deux bases se ressemblent : il prend le document de
  Python, l'importe dans le nuage, puis compare.
  **Le temps de CPU, mesuré en production** (`wrangler tail`, arbres fabriqués
  par `outils/gros-arbre.mjs`), sur `/api/vue/sociogramme` :

  | Fiches | CPU médian | CPU max | Verdict |
  | --- | --- | --- | --- |
  | 72 (vraie campagne) | **6 ms** | 6 ms | dans le budget documenté (10 ms) |
  | 200 | 18 ms | 30 ms | au-delà, mais sert |
  | 500 | 27 ms | 35 ms | au-delà, et sert encore |

  **Aucune requête n'a échoué** sur les 91 relevées. Conclusion honnête : la
  campagne réelle est confortable, et le budget documenté est franchi quelque
  part **au-dessus d'une centaine de fiches**. Ça marche aujourd'hui parce que
  Cloudflare tolère les dépassements, pas parce qu'on est dans les clous — donc
  **le déclencheur du premier repli est posé : au-delà de ~150 fiches sur un
  vrai arbre, calculer les générations côté navigateur.** C'est la seule partie
  super-linéaire du calcul, et c'est bien elle que le plan visait en premier.
  Deux corrections de conception en chemin : `Dataset` garde son index de
  personnes (il était reconstruit à chaque appel de `personne()`, ce qui est
  quadratique sur une vue), et l'intergiciel de session est posé **route par
  route** au lieu d'un `use('*')` — monté sur `/api`, un `*` aurait exigé une
  session pour s'inscrire.

---

# Lot 8 — ce que la table a demandé après coup (10/08/2026)

Le plan d'origine s'arrêtait au lot 7. Ce qui suit vient de l'usage : la
campagne tourne, et il manquait des choses qu'on ne voit qu'en jouant.

| # | Ce qui a été fait | Où ça vit |
| --- | --- | --- |
| 8.A | L'appui long remplace le clic droit, partout. « ＋ Profil » en bas, « Thème » en haut. | `js/dom.js`, `js/views/cartes.js` |
| 8.B | Âges déduits d'une année de campagne, éditable. | `js/calendrier.js`, `PATCH /api/meta` |
| 8.C | Tags « chef de maison » / « héritier », cadre appuyé. | `js/rangs.js` |
| 8.D | Liens révolus, catégorie « Événements passés », détails facultatifs. | `models.ts`, `js/editeurs.js` |
| 8.E | Vue « Maisons » en écran partagé. | `vues/maisons.ts`, `js/views/maisons.js` |
| 8.F | Écriture par procuration pour l'administrateur. | `src/admin/procuration.ts` |
| 8.G | Mot de passe oublié par courriel. | `src/auth/courriel.ts`, migration `0004` |

## Les trois décisions qui méritent d'être relues

**8.F renverse le lot 7.** « Comptes administrateurs voyant tous les arbres, en
lecture seule » était tranché depuis le 06/08. La demande du 10/08 le défait :
un outil de campagne où le MJ ne peut pas corriger une fiche n'est pas un outil
de campagne. Ce qui n'a pas bougé : les routes de membres ignorent toujours les
rôles, le pouvoir n'existe que sur `/api/admin/*`, et il est journalisé. Le
mécanisme — substituer le compte sur le contexte plutôt que réécrire trente
routes — garantit qu'un administrateur ne peut rien faire de plus que ce que le
propriétaire pourrait faire lui-même.

**Les caractéristiques de maison sont celles du manuel, pas du document de la
table.** Le document de règles indiqué est un Google Docs qui demande une
autorisation : il n'a pas pu être lu. Ce sont donc les sept ressources standard
du JDR *Le Trône de Fer* (Défense, Influence, Terres, Loi, Population, Pouvoir,
Richesse). Elles sont déclarées **en un seul endroit**
(`CARACTERISTIQUES_MAISON`, dans `referentiels.ts`) et descendues au front :
en changer la liste est une ligne, si la table joue autrement.

**8.G est complet sauf l'envoi.** Le jeton, l'expiration, l'usage unique, la
page, la conservation des sauvegardes : tout est là et vérifié. Envoyer un
courriel depuis un Worker demande un service tiers, donc un compte et une clé —
ce qui revient au propriétaire de l'instance. Sans clé, l'option n'apparaît pas
et le code de secours reste la voie de récupération.

## Vérification

**225/225** au harnais (`outils/essai.sh`), contre 174 à la fin du lot 7. Les
51 vérifications neuves couvrent notamment : un membre refusé sur toute la
porte d'édition avant même de savoir si l'arbre existe, une caractéristique
inventée ignorée, une année sans chiffre refusée, et — pour le mot de passe
oublié — la preuve que la réponse est **exactement la même** pour une adresse
connue et pour une inconnue.

---

# Lot 9 — ouvrir la porte (11/08/2026)

Le lot 8 avait amélioré l'outil pour ceux qui s'en servaient déjà. Celui-ci
change **à qui il s'adresse** : on peut l'essayer sans compte, et l'inscription
ne demande plus que ce dont elle a besoin.

| # | Ce qui a été fait | Où ça vit |
| --- | --- | --- |
| 9.A | Pastille (emoji) sur un lien, aux deux bouts et au milieu si le trait est long. | `models.ts`, `js/editeurs.js`, `js/views/cartes.js` |
| 9.B | Sauvegarde de départ « Westeros », offerte à tout compte neuf. | `outils/construire-depart.mjs`, `src/depart/` |
| 9.C | Essai sans compte, repris tel quel à l'inscription. | `POST /api/auth/invite`, `js/api.js` |
| 9.D | Inscription réduite au courriel et au mot de passe. | `src/auth/routes.ts`, `connexion.html` |
| 9.E | Connexion Google. **Évaluée, pas faite.** | — |

## Les trois décisions qui méritent d'être relues

**Un visiteur reçoit un vrai compte, pas un état de session.** L'autre voie
était de garder son travail dans le navigateur sans rien créer côté serveur.
Écartée : tout le domaine vit dans le Worker, et le porter en double dans le
navigateur aurait doublé la surface à tenir juste. Le prix est assumé et
borné — une ligne et ~90 Ko par visiteur, 8 essais par heure et par adresse IP,
un ménage nocturne qui efface les invités inactifs depuis 14 jours. **C'est la
ligne à regarder au relevé de consommation du 17/08.**

**L'inscription reprend le compte d'essai au lieu d'en créer un neuf.** Même
identifiant, mêmes sauvegardes. C'est ce qui rend la proposition honnête : sans
cela, « créez un compte pour garder votre travail » serait un mensonge, puisqu'il
faudrait tout refaire.

**Le code de secours n'est plus imposé, et ce n'est pas gratuit.** Le montrer à
quelqu'un qui vient de choisir un mot de passe ne servait personne — personne ne
le notait. Il se demande maintenant depuis « Vos données ». Mais tant que l'envoi
de courriel n'est pas branché, **un compte qui n'en a jamais demandé et qui perd
son mot de passe n'a plus que l'administrateur pour le récupérer.** Une raison de
plus de brancher la clé.

## Deux corrections au passage

`donnees.html` affirmait que les administrateurs « ne peuvent pas modifier » les
arbres. Vrai au lot 7, faux depuis le 8.F — et c'est la page qui parle de vie
privée, donc la seule où une phrase périmée n'est pas un détail. Corrigée, avec
la mention de la trace horodatée.

Le bouton « 📜 Document » pointait vers une adresse en dur : le document de
campagne de Maxime. Tant que l'application n'avait qu'un lecteur, c'était un
raccourci commode ; à partir du moment où des inconnus ouvrent un monde, c'en
était un vers les notes de quelqu'un d'autre. Le document vit désormais dans
`meta.document`, sauvegarde par sauvegarde, et le bouton disparaît quand il n'y
en a pas.

## Vérification

**274/274** au harnais, contre 225 à la fin du lot 8. Les 49 vérifications
neuves couvrent notamment : la pastille rognée à huit points de code, le
va-et-vient qui ne laisse **aucun champ** derrière lui quand elle est vide, un
invité refusé sur les deux portes d'administration, la reprise d'un essai qui
garde l'identifiant **et** ce qui avait été modifié avant l'inscription, et un
`javascript:` refusé comme document de campagne.

**Quatre assertions ont été réécrites** — les premières depuis le début du
projet. Elles disaient qu'un compte neuf n'a aucune sauvegarde ; c'est devenu
faux exprès. Le cas « plus aucun monde » (409) reste vérifié, sur un essai
jetable qui supprime la sienne.

---

# Lot 10.A — les lots d'administration (12/08/2026)

Le lot 8.F a donné à l'administrateur le droit d'écrire dans l'arbre de
quelqu'un d'autre — **un** arbre, à la main. Depuis le lot 9, tout le monde part
du même monde : une table qui joue à six a six arbres qui se ressemblent, et le
meneur de jeu doit pouvoir y poser la même maison, la même date, le même lien
sans les rouvrir un par un. Ce lot fait passer la procuration à l'échelle.

| # | Ce qui a été fait | Où ça vit |
| --- | --- | --- |
| 10.A.1 | Sélection multiple de comptes, résolue en sauvegardes (`toutes` ou l'active). | `src/admin/lots.ts` |
| 10.A.2 | Sept opérations posables en lot, toutes idempotentes. | `src/admin/lots.ts` |
| 10.A.3 | Panorama : ce que les comptes ont en commun, ce qui diverge. | `panorama()`, `POST /lots/panorama` |
| 10.A.4 | Cases à cocher, formulaires, aperçu obligatoire, application. | `admin.html`, `js/admin.js` |
| 10.A.5 | Validation de `meta` factorisée, partagée par le domaine et les lots. | `src/domaine/meta.ts` |

**Aucune migration.** Rien de neuf en base : un lot n'est qu'une suite
d'écritures ordinaires.

## Les quatre décisions qui méritent d'être relues

**L'aperçu et l'application sont deux adresses, pas un booléen.**
`POST /api/admin/lots/apercu` ne sait pas écrire ; `POST .../appliquer` est la
seule route de la famille qui touche aux données. Un client qui oublie un drapeau
`simulation: true` écrirait chez cinquante personnes en croyant regarder ; un
client qui se trompe de chemin lit. C'est la même logique que `lectureSeule`,
posée sur le chemin plutôt que sur chaque route.

**L'identifiant est calculé une fois pour tout le lot.** Les routes du domaine
appellent `idsLibres()`, qui suffixe en cas de collision — parfait pour une
création à l'unité, désastreux pour un lot : « Tully » posée deux fois donnerait
`tully` chez les uns et `tully-2` chez les autres. Ici l'identifiant vient du nom,
une seule fois, et une clé déjà présente est **mise à jour**. C'est ce qui rend un
lot rejouable, donc rattrapable.

**Un refus n'arrête pas le lot.** Un compte au plafond, une fiche absente, une
couleur illisible : on note et on continue. Le rapport dit ensuite, ligne par
ligne, qui est passé et qui ne l'est pas. Un lot tout-ou-rien aurait obligé à
retirer les comptes gênants un par un pour servir les autres.

**Le plafond appliqué est celui du propriétaire.** Comme dans la procuration :
un administrateur ne peut rien faire qu'un utilisateur ne pourrait faire
lui-même. Un compte serré refuse le lot, les autres passent.

## Ce qui manque, et c'est dit

L'opération `filtre` existe côté serveur (elle sert au panorama et à l'API) mais
**n'a pas de formulaire** : construire un filtre demande une variable, des
segments, un dégradé et des tests — c'est un second constructeur de filtres, pas
un champ de plus. Les six autres opérations ont leur formulaire.

## Une correction au passage

Le bandeau d'`admin.html` annonçait encore « **Lecture seule** […] vous ne pouvez
pas les modifier — l'API le refuse ». Faux depuis le 8.F. La page `donnees.html`
avait été corrigée au lot 9 ; celle-ci était restée. Et le journal affichait
`edition` en brut, faute d'un libellé.

## Vérification

**320/320** au harnais, contre 274 à la fin du lot 9. Les 46 vérifications
neuves couvrent : les trois routes fermées aux membres et sans session,
l'aperçu qui **n'écrit rien** (relu chez les deux comptes après coup), le même
lot rejoué qui ne crée aucun doublon, un `javascript:` refusé en lot comme à
l'unité, deux refus qui n'empêchent pas le reste, une ligne de journal par
sauvegarde touchée, et le panorama qui sépare le commun du divergent.

Vérifié aussi dans le navigateur, sur la vraie page : sélection de deux comptes
(3 sauvegardes), aperçu, modification d'un champ qui **rééteint** « Appliquer »,
nouvel aperçu, application. Les trois sauvegardes portent la maison avec sa
devise, sa couleur et ses caractéristiques ; le journal porte exactement trois
lignes `edition`, deux pour le compte à deux arbres et une pour l'autre.

---

# Lot 10.B — changer son mot de passe sans code de secours (12/08/2026)

Le lot 8.G avait posé le lien par courriel pour les **oublis**. Il manquait le
geste courant : changer son mot de passe quand on l'a encore. Il n'existait
aucune route pour ça — il fallait se déconnecter et faire semblant d'avoir
oublié, ou ressortir un code de secours que presque personne n'a demandé.

| # | Ce qui a été fait | Où ça vit |
| --- | --- | --- |
| 10.B.1 | `POST /api/auth/mot-de-passe` : un compte ouvert demande son lien. | `src/auth/routes.ts` |
| 10.B.2 | L'émission du jeton factorisée, partagée par les deux portes. | `emettreLien()` |
| 10.B.3 | Carte « Changer votre mot de passe » dans « Vos données ». | `donnees.html`, `js/donnees.js` |
| 10.B.4 | Le code de secours recule derrière un bouton sur la connexion. | `connexion.html`, `js/connexion.js` |

**Aucune migration.** La table `reinitialisations` du lot 8.G suffit : c'est le
même jeton, la même heure, le même usage unique.

## Les deux décisions qui méritent d'être relues

**Ni l'ancien mot de passe, ni le code de secours.** Le code de secours sert à
reprendre un compte dont on a *perdu* la clé ; l'exiger pour un changement
volontaire faisait payer un geste courant au prix d'un geste de détresse. Quant
à redemander l'ancien mot de passe, ça n'ajoute rien ici : la preuve de
possession est déjà faite deux fois — par la session, puis par le lien envoyé à
l'adresse du compte.

**Sans clé d'envoi, cette porte se ferme, et on le dit.** C'est le seul endroit
du service où l'absence de configuration refuse au lieu de proposer autre chose.
Ailleurs on peut basculer sur le code de secours ; pour quelqu'un de déjà
connecté, il n'y a pas de second chemin honnête. Le refus est un 409 qui porte
un `indice` renvoyant vers le code de secours, affiché tel quel par la page.
**En production, c'est aujourd'hui le comportement réel** : `/api/auth/moyens`
répond `{"courriel":false}`. Une raison de plus de poser la clé Resend.

## Ce qui n'a pas été supprimé

`POST /api/auth/recuperation` (par code de secours) **reste**, et son formulaire
aussi. Il recule seulement : quand le lien par courriel est disponible, il
attend derrière « Je n'ai plus accès à ma boîte de courriel ». Sans service
d'envoi, il redevient visible d'emblée — c'est alors le seul chemin. Le
supprimer aurait laissé sans recours quelqu'un qui perd l'accès à sa boîte.

## Vérification

**329/329**, contre 320 à la fin du lot 10.A. La section est écrite pour être
vraie **des deux côtés** : elle interroge `/api/auth/moyens` et vérifie le
comportement attendu selon que l'envoi est configuré ou non, plutôt que de se
sauter elle-même. En local, `.dev.vars` porte une clé factice, donc c'est la
branche « configuré » qui tourne ; en ligne, c'est celle du refus.

Vérifié dans le navigateur : la carte apparaît entre « Tout reprendre » et
« Code de secours », le bouton envoie, le message nomme l'adresse — et la ligne
correspondante existe bien dans `reinitialisations`, avec 3 600 secondes de
durée et `utilise_le` à `NULL`. Sur la connexion, « Mot de passe oublié ? »
n'ouvre plus que le bloc courriel, et le formulaire de code de secours attend
derrière son bouton.

---

# Lot 10.C — la connexion Google (12/08/2026)

Le lot 9.E l'avait **évaluée sans la faire**. Elle est faite.

| # | Ce qui a été fait | Où ça vit |
| --- | --- | --- |
| 10.C.1 | Le protocole : aller, retour, vérification des revendications. | `src/auth/google.ts` |
| 10.C.2 | Les deux routes, et le rattachement des comptes. | `src/auth/routes.ts` |
| 10.C.3 | `google_sub`, colonne additive et unique. | `migrations/0005_google.sql` |
| 10.C.4 | Le bouton, et l'erreur de retour affichée sur la page. | `connexion.html`, `js/connexion.js` |

## Les quatre décisions qui méritent d'être relues

**Redirection côté serveur, pas le script de Google.** Google fournit un
« Google Identity Services » qui dessine son bouton dans la page. S'en servir
obligerait à élargir `script-src 'self'` **pour tout le site**. Affaiblir la
protection de toutes les pages pour un bouton de connexion serait un mauvais
échange. Le flux « Authorization Code » classique ne demande aucun JavaScript :
le bouton est un `<a href>`.

**On ne revérifie pas la signature du jeton, et c'est motivé.** L'`id_token`
arrive par une connexion TLS que le Worker ouvre lui-même vers
`oauth2.googleapis.com`, en s'authentifiant avec le secret client. OpenID
Connect Core 1.0 § 3.1.3.7 dit que dans ce cas la validation TLS **tient lieu**
de vérification de signature. Refaire une vérification RSA contre le JWKS
serait du code cryptographique de plus, avec ses propres façons d'être faux,
pour un gain nul — **tant qu'on n'accepte jamais un `id_token` venu d'ailleurs**.
Et on n'en accepte jamais : il n'existe aucune route qui en prenne un en entrée.
**C'est la propriété à ne pas casser.** Les revendications, elles, sont toutes
vérifiées : émetteur, destinataire, expiration, `nonce`, `email_verified`.

**Le rattachement se fait par `sub` d'abord, par adresse ensuite.** Une adresse
peut être libérée puis réattribuée ; un `sub` ne l'est jamais. L'adresse ne sert
qu'au premier rapprochement, et seulement parce que Google certifie
`email_verified` — ce qui vaut exactement la preuve que donne notre propre lien
par courriel. Refuser ce rapprochement obligerait les gens à se créer un doublon.

**Un compte Google reprend l'essai en cours**, comme le fait l'inscription
(lot 9.C). Sans ça, « connectez-vous pour garder votre travail » serait un
mensonge pour la moitié des visiteurs.

## Ce qui n'a pas pu être vérifié, et pourquoi

**L'échange du code contre le jeton.** Il demande un projet Google Cloud et un
secret client, qui n'existent pas encore — c'est au propriétaire de les créer
(`DEPLOIEMENT.md`, « Brancher la connexion Google »). Tout ce qui l'entoure est
vérifié, en posant des identifiants factices dans `.dev.vars` : la redirection
et ses paramètres, le témoin `state`/`nonce` et ses attributs, et **tous** les
refus du retour — sans témoin, témoin qui ne correspond pas, refus chez Google,
retour vide.

En production, les routes répondent **404** tant que les secrets ne sont pas
posés, et le bouton n'apparaît pas. Rien de ce lot n'est donc actif en ligne
avant une décision du propriétaire.

## Vérification

**344/344**, contre 329 à la fin du lot 10.B. La section branche sur
`/api/auth/moyens`, comme celle du courriel : en local les identifiants factices
font tourner la branche « configuré », en ligne celle du 404.

La vérification qui compte le plus est celle du `SameSite=Lax` sur le témoin :
en `Strict`, le navigateur ne le renverrait pas au retour de chez Google et
**toute** connexion échouerait sur « demande expirée ». Vient ensuite le refus
d'un `state` qui ne correspond pas — c'est lui qui empêche un tiers de faire
aboutir chez vous une connexion qu'il a lancée lui-même.

## Un défaut trouvé en relisant, que le typage ne voyait pas

L'`INSERT` du compte Google avait **sept marqueurs et six valeurs liées** :
l'identifiant manquait. TypeScript compile sans rien dire — D1 aurait refusé la
requête à la première connexion Google réelle, c'est-à-dire au seul moment où
personne n'aurait été là pour la voir. Trouvé en relisant le SQL à voix haute,
pas par un outil.

---

# Lot 11.A — Deux étages d'administration  ☑

*Demandé le 13/08/2026 : « je voudrais être l'administrateur suprême qui va
pouvoir donner des permissions d'administrateur à d'autres profils (mais qui
n'auront pas cette vue que j'ai) et aussi attitrer des profils qui seront sous
la gestion de l'administrateur intermédiaire ».*

Il n'y avait qu'un rôle au-dessus de `membre`, et il pouvait tout, sur tout le
monde. Une table de jeu n'a pas besoin de ça : le maître de jeu doit pouvoir
suivre **ses** joueurs sans hériter du pouvoir d'effacer un compte ou d'en
remplacer le mot de passe.

- ☑ Migration `0006_tutelles.sql` — table `tutelles(intendant_id,
  utilisateur_id, cree_le, pose_par)`. Le rôle continue de vivre dans
  `utilisateurs.role`, colonne TEXT sans contrainte : rien à migrer pour lui.
- ☑ Rôle **`intendant`** — administrateur délégué. Périmètre = les comptes
  qu'on lui a confiés, **plus le sien**.
- ☑ `exigerGestion` pose le périmètre sur le contexte ; `exigerSouverain` le
  double sur les routes qui n'appartiennent qu'à l'`admin`.
- ☑ Toute route qui reçoit un identifiant de compte passe par
  `dansLePerimetre` : `/utilisateurs`, `…/:id/sauvegardes`,
  `/sauvegardes/:id`, `…/export`, la procuration `/arbres/:arbre/*`, les lots,
  le panorama, le journal.
- ☑ `POST /api/admin/utilisateurs/:id/role`, `GET /api/admin/intendants`,
  `PUT /api/admin/intendants/:id/charges`.
- ☑ `GET /api/admin/contexte` — la page sait qui elle sert avant de se
  dessiner.
- ☑ Journal : deux actions de plus, `role` et `tutelle`.
- ☑ Interface : bloc « Intendants » visible du seul souverain, actions du
  compte masquées pour un intendant, bandeau qui dit le périmètre.

## Les quatre décisions qui méritent d'être relues

**`admin` ne s'accorde pas par l'API, et ne s'accordera pas.** La route des
rôles ne connaît que `membre` et `intendant`. Une route qui sacre un pair
transformerait le premier compte compromis en trousseau de toute l'instance ;
il n'y a aucun confort qui vaille ça. Le premier administrateur s'est donné en
SQL, ses successeurs feront de même. La route refuse aussi de **toucher** au
rôle d'un `admin` — sinon on contournerait la règle par l'autre bout.

**Hors périmètre, c'est 404, jamais 403.** La même règle que le cloisonnement
des membres. Dire « interdit » à un intendant lui apprendrait que le compte
existe, et le nombre de comptes d'une instance n'est pas une information qu'on
lui doit. La procuration répond le **même mot** (« sauvegarde introuvable »)
qu'un arbre qui n'existe pas.

**Une sélection de lot hors périmètre est retranchée en silence.** Refuser
nommément apprendrait l'existence des comptes écartés. Rien ne se perd : le
rapport du lot nomme chaque sauvegarde touchée, et la page ne propose que les
comptes en charge. Une sélection entièrement hors périmètre tombe sur le 404
« aucune sauvegarde à toucher », le même que pour des comptes qui n'en ont
aucune.

**Un intendant voit, dans le registre, ce qui a été fait à ses joueurs — même
par le souverain.** C'est justement ce que le registre lui doit. Ce qu'il ne
voit pas, ce sont les lignes qui **portent sur** un compte hors de son
périmètre. La distinction est dans la colonne (`cible_utilisateur`), pas dans
la présence d'un identifiant quelque part dans la réponse — et c'est ce que le
harnais vérifie, avec `journal_vise` plutôt qu'un `contient`.

**Démettre reprend les tutelles dans le même geste.** Les laisser derrière
ferait d'une remise en fonction plus tard une restitution silencieuse de
pouvoirs qu'on croyait repris. Vérifié : renommé, un ancien intendant repart
sans personne.

## Vérification

**408/408**, contre 351 à la fin du correctif du 13/08. La section reprend
**deux fois** chaque route qui reçoit un identifiant de compte : dans le
périmètre, hors du périmètre. Elle vérifie aussi qu'un lot posé par l'intendant
sur une sélection débordante ne touche **qu'**une sauvegarde, et que le compte
hors périmètre n'a rien reçu.

Deux échecs pendant l'écriture, tous deux dans le harnais et non dans le code :
un `contient 'confies'` qui cherchait un mot accentué, et une assertion qui
affirmait que le registre du souverain portait des lignes **visant** le compte
A — alors qu'il en est l'auteur, jamais la cible. La seconde a été remplacée
par ce qui prouve vraiment le filtre : le souverain voit **plus** de lignes que
l'intendant.

---

# Lot 11.C — L'arbre au téléphone  ☑

*Signalé le 13/08/2026 : « toute la partie vue de l'arbre, au niveau surtout
des options d'ajouts, des catégories, maisons et liens — on ne les voit pas sur
téléphone ».*

**Le rail n'était pas absent : il était inatteignable.** Mesuré sur 375 px, la
barre du haut réclamait **512 px de commandes**. Les quatre derniers boutons
débordaient à droite, et parmi eux le **☰ qui ouvre le rail**, à 75 px hors de
l'écran ; le 👤 du volet de droite à 155 px. Le rail existait, complet —
sauvegardes, vues, joueurs, liens, filtre/maisons, options, édition — et
strictement aucun geste ne permettait de l'ouvrir.

- ☑ Sur téléphone, la barre du haut ne garde que de quoi **naviguer** : la
  marque, ☰, 👤, et « Créer un compte » pour un visiteur d'essai.
- ☑ Tout le reste **descend dans le rail**, en tête, dans un bloc « Compte et
  réglages » : année, thème, couleur & filtre, document, tout télécharger,
  instantané, vue générale, compte, ⚙, 🛡, ⏻.
  ([`public/js/telephone.js`](public/js/telephone.js))
- ☑ Le tiroir de gauche a **une sortie** — il n'en avait pas, contrairement au
  volet de droite. ✕ dans son en-tête, et un appui sur la scène referme.
- ☑ Cibles tactiles : plus rien sous **36 px** dans le rail, le volet et les
  deux barres.

## La décision qui porte le lot

**On déplace les nœuds, on ne les duplique pas.** Le CSS sait cacher, pas
déménager — et cacher aurait désencombré la barre en rendant ces commandes
introuvables, c'est-à-dire en reproduisant le défaut qu'on répare. Dupliquer
les boutons dans le rail aurait donné deux éléments pour un même geste, deux
identifiants, deux câblages à tenir d'accord. Les **mêmes** nœuds descendent et
remontent : les écouteurs les suivent, et il n'y a jamais qu'une vérité par
bouton. Les règles CSS `display: none` restent en ceinture, pour la fraction de
seconde où le script n'a pas encore tourné.

## Ce que les mesures ont trouvé, et que l'œil n'aurait pas vu

En balayant les 76 cibles du tiroir ouvert, une par une :

| élément | avant | après |
|---|---|---|
| ＋ Nouvelle maison / Nouveau type / Nouveau joueur | 26 px | 44 px |
| entrée de légende (une maison, un type de lien) | 24 px | 40 px |
| poignée ＋ des filtres | 28 × 19 | 40 × 40 |
| puce d'axe de filtre | 52 × 21 | 65 × 36 |
| case « masquer les liens révolus » | 13 × 13 | 20 × 20, cible de 40 |
| ✎ d'un joueur | 24 px | 40 px |
| curseur de zoom | 16 px | 34 px |

Les « options d'ajouts » nommées dans le signalement étaient donc bien là — à
26 px de haut, sous un bouton d'ouverture hors de l'écran.

## Ce qui n'a pas pu être vérifié ici, et pourquoi

**Le franchissement du point de rupture à chaud** — faire pivoter le téléphone
de portrait à paysage. Dans le navigateur de cette session, l'onglet n'est pas
rendu (`document.hidden`), et Chrome y supprime `resize` **et** l'événement
`change` de `matchMedia` ; les transitions CSS y sont également gelées, ce qui
a d'abord fait croire que le tiroir ne s'ouvrait pas. Ce qui est vérifié, c'est
l'état après **chargement** à chaque largeur — le cas réel d'un téléphone.

C'est en cherchant à vérifier ce franchissement qu'un vrai défaut est apparu :
la première version n'écoutait que `change`, les commandes descendaient dans le
rail et **n'en remontaient jamais** sur écran large. `resize` a été ajouté à
côté, avec un garde d'état pour que la double écoute ne travaille pas deux
fois.

## Vérification

**416/416.** Les huit vérifications nouvelles constatent que les pièces sont
servies (le bloc d'accueil, la sortie du tiroir, le module, les règles
tactiles) ; les mesures, elles, sont dans le tableau ci-dessus.

---

# Lot 11.B — Un arbre montré aux autres, en lecture seule  ☑

*Question posée le 13/08/2026 : « elle sert à quoi la partie adresse de lien ?
Est-ce que ça permet de créer une nouvelle vue que l'administrateur va pouvoir
configurer (mettre les gens en mode read only), sur laquelle il va pouvoir
faire des modifs, et que les autres joueurs voient ? Je veux ça si c'est pas
ça. »*

**Ce n'était pas ça.** Le « lien de campagne » (`meta.document`, lot 9) est une
adresse http(s) rangée dans une sauvegarde. Elle met un bouton 📜 dans la barre
du haut, qui ouvre un document hébergé ailleurs — un Google Doc, une page de
notes. Elle ne partage rien, ne donne accès à rien, et l'arbre reste
strictement privé. Le champ du même nom dans les lots la pose chez plusieurs
comptes d'un coup, rien de plus.

**Voici ce qui a été demandé.** Le propriétaire désigne des comptes ; ils voient
*sa* sauvegarde — la vivante, pas une copie qui vieillirait dès qu'il y touche —
dans l'application entière, et ne peuvent rien y écrire.

- ☑ Migration `0007_partages.sql` — `partages(sauvegarde_id, utilisateur_id)`.
- ☑ Surface séparée `/api/partages/*` ([`src/partages/routes.ts`](src/partages/routes.ts)).
- ☑ `GET /` (ce qu'on m'a ouvert), `GET /:arbre/lecteurs`,
  `PUT /:arbre/lecteurs` (la liste entière, par **adresse**).
- ☑ `/:arbre/lecture/*` monte **le domaine entier**, derrière deux gardes.
- ☑ Interface : bloc « Partagés avec moi » dans le rail, « Partager en
  lecture… » dans le menu d'une sauvegarde, bandeau 👁 et extinction de ce qui
  écrit en mode lecture.

## Les quatre décisions qui méritent d'être relues

**Aucun partage en écriture, et il n'y en aura pas.** Deux personnes qui
écrivent dans le même document sans rien pour arbitrer entre elles, c'est un
verrou de révision qui rejette l'une des deux au hasard. La procuration
(lot 8.F) reste la seule écriture chez autrui — et elle est journalisée. D'où
une table sans colonne « droit » : elle ne dit qu'une chose, et ne peut pas en
dire une autre par accident.

**La garde du verbe est posée avant la substitution du compte.** Deux
intergiciels sur le chemin, dans cet ordre : `verbeDeLecture` refuse tout ce qui
n'est pas GET, *puis* `parPartage` substitue le propriétaire. Si l'ordre venait
à être inversé par distraction, la conséquence serait un refus — jamais une
écriture au nom du propriétaire. Et parce que la garde est sur le chemin et non
sur les routes, une route d'écriture ajoutée demain au domaine y serait refusée
sans que personne n'ait à y penser.

**Les routes de membres restent aveugles.** `src/intergiciels.ts` ne connaît
toujours pas les partages, `ficheDe` porte toujours `utilisateur_id` dans son
`WHERE`. `GET /api/sauvegardes/<arbre partagé>` répond **404** à celui à qui on
l'a pourtant ouvert, et il ne peut pas l'activer. Le partage vit sur sa propre
surface, exactement comme l'administration sur la sienne. C'est vérifié
séparément, et c'est ce qui empêche le lot d'ouvrir une brèche ailleurs.

**Une adresse inconnue est nommée, pas tue.** C'est l'inverse des lots du
11.A, où le silence protégeait l'existence des comptes. Ici c'est *mon* arbre,
et si Jean n'a pas de compte je dois le savoir — sans quoi je crois l'avoir
invité. Cela apprend à qui demande si une adresse a un compte ici ; c'est le
prix d'un partage utilisable, et il se paie une adresse à la fois.

## Ce qui a été écarté

**Rendre une sauvegarde partagée « active ».** Elle n'est pas à nous : écrire
son identifiant dans `utilisateurs.sauvegarde_active` reviendrait à ranger chez
soi le nom d'un arbre qui appartient à quelqu'un d'autre — et à faire dépendre
notre écran de ce que ce quelqu'un décide d'en faire. On l'ouvre dans une page
à part, `?partage=<id>`, et on revient chez soi.

**Empêcher un lecteur d'exporter.** `/export/*` est une lecture, elle passe
donc, et c'est dit plutôt que passé sous silence : **partager un arbre, c'est
accepter qu'on puisse en faire une copie.** Le refuser ne protégerait rien — qui voit toutes
les fiches et tous les liens peut les recopier à la main — et coûterait à un
joueur le droit de sortir en `.xlsx` la table qu'on vient de lui montrer.

## Vérification

**453/453**, contre 416 à la fin du lot 11.C. La section reprend chaque verbe (POST, PATCH, DELETE) sur la
surface de lecture, vérifie qu'un arbre non partagé répond le **même** 404
qu'un arbre inexistant, et — c'est celle qui compte le plus — que l'API
ordinaire continue de répondre 404 sur un arbre pourtant partagé.

---

# Lot 11.D — Le téléphone repris en main  ☑

*Signalé le 13/08/2026, après le 11.C : « la fiche s'affiche en dehors de
l'écran, on ne la voit pas », « retirer les choses inutiles type téléchargement
sur téléphone », « pouvoir visualiser directement les maisons et les liens pour
les filtrer, et ouvrir la fiche, le tout en format téléphone vertical ». Et,
sur la page d'administration : « je ne vois pas comment faire passer une
personne intendant, ni comment accéder aux arbres des différents comptes ».*

## Le défaut central : la fiche se dessinait à côté de l'écran

Ouvrir une fiche appelait `surOuverture`, qui ne faisait qu'une chose —
`basculerOnglet('fiche')`, c'est-à-dire basculer l'onglet **à l'intérieur** du
volet. Sur écran large ça suffit : le volet est une colonne toujours visible.
Sur téléphone il est un tiroir posé à `translateX(100%)`, et la fiche s'y
dessinait, fidèlement, **hors champ**. Rien ne manquait au rendu ; il manquait
un geste.

- ☑ `amenerLaFiche()` — le volet vient à l'écran dès qu'une fiche s'ouvre, par
  la liste comme par le plan.
- ☑ Cibles tactiles de la fiche : les champs de saisie faisaient **21 à 29 px**,
  les puces de rang 26, le ✕ 30. Tout est passé à 36–40, et tout ce qui se
  saisit à `font-size: 16px` — en dessous, iOS zoome sur le champ et laisse la
  page décadrée, impossible à récupérer d'une main.

## Voir les maisons et les liens sans les chercher

- ☑ Bouton **« ⛨ Filtres »** dans la barre du bas : il ouvre le rail **déjà
  déroulé sur les maisons**.
- ☑ L'ordre du tiroir est refait pour un pouce : maisons, liens, vues, options,
  joueurs, sauvegardes, partages, édition, sélection, réglages. On l'ouvre pour
  filtrer — ce qu'on filtre passe en tête. L'ordre du HTML ne bouge pas : c'est
  celui d'un écran large, où tout est visible d'un coup.

## Ce qui a été retiré, et pourquoi

**« ⤓ Tout télécharger » et « 📸 Instantané » ne descendent plus dans le
rail : ils sont éteints.** Un `.zip` de toutes ses sauvegardes sur un téléphone
ne mène nulle part. « Vos données » (🛡) reste, et c'est le vrai endroit pour
sortir ses données.

## La colonne d'actions de l'administration tombait hors de l'écran

Mesuré : sur 1280 px, le tableau des comptes fait **1087 px dans une boîte de
1042**. La colonne d'actions — celle qui porte **« Arbres »** *et* **« Nommer
intendant »** — finissait à droite du bord visible, derrière un défilement
horizontal que rien n'annonçait. Les deux gestes que l'on cherchait étaient
dans la même colonne invisible.

- ☑ Elle est **collée au bord droit** (`position: sticky`) et ne bouge plus,
  quel que soit le défilement. Un voile porté à sa gauche dit qu'il y a du
  contenu dessous.
- ☑ Au téléphone, elle **redevient une colonne ordinaire** : elle fait 386 px,
  soit plus que l'écran — la coller y recouvrirait tout le tableau.
- ☑ La page le dit désormais : ce que fait la colonne de droite, et où trouver
  « Nommer intendant » (avec le rappel que le rôle d'**administrateur**, lui, ne
  s'accorde qu'en SQL).

## Vérification

**464/464.** Les mesures, elles, ne sont pas dans le harnais : fiche ouverte sur
375 px, plus aucune cible sous 28 px, aucun élément qui déborde à
l'horizontale ; barre du bas à sept commandes de 40 px dans 332 px de large ;
« ⛨ Filtres » amène le bloc des maisons à 226 px du haut d'un écran de 812, et
toucher une maison en éteint 18 sur 19.

# Lot 12 — Le téléphone d'un visiteur, l'administration au doigt, et les fiches écrites deux fois  ☑

*Demandé le 14/08/2026 : « dès qu'on utilise le tél, il y a 3 boutons qui
prennent toute la place et inutile (Connexion et inscrivez-vous ×2), à retirer
pour ne laisser qu'un pictogramme de tête à cliquer » ; puis « design et teste
la partie administrateur intermédiaire, réfléchis à un usage réel — checker les
vues de ses joueurs, ajouter des trucs, checker différentes versions de profils
similaires, les regrouper si ce sont les mêmes, et push les modifs ».*

## 12.A — Trois boutons pour une idée, et la marque n'avait plus de place

Mesuré sur 375 px, en essai sans compte :

| | avant | après |
|---|---|---|
| `#groupe-essai` dans la barre du haut | **240 px des 375** | descendu dans le tiroir |
| `.marque` (⚔ + nom de l'univers) | **9 px** — écrasée à rien | **77 px**, « ⚔ Westeros » lisible |
| `#bandeau-essai` (+ sa 3ᵉ « Créer un compte ») | **103 px de haut** | **49 px** |
| premier pixel d'arbre | 158 px | **118 px** |

- ☑ `#groupe-essai` **descend dans le tiroir** avec le reste des réglages. Il
  n'y descendait pas, au motif que « Créer un compte » est l'appel à l'action
  d'un visiteur ; la mesure a tranché contre l'argument.
- ☑ Un **👤** dans la barre ouvre le tiroir **déroulé sur le bloc du compte** —
  « Créer un compte » et « Se connecter » y sont, pleine largeur, à 44 px.
  Le 👤 de la liste des personnes devient **👥** : les deux boutons se touchent,
  il faut pouvoir les distinguer sans infobulle.
- ☑ Le bandeau d'essai **garde son texte et perd son bouton** tant qu'il est
  calme ; il le retrouve dès qu'on a modifié quelque chose et qu'il y a du
  travail à perdre. C'est la distinction sur laquelle ce bandeau était déjà
  construit, pas une exception de plus.
- ☑ Le texte du bandeau a **deux longueurs**, choisies sur la largeur.

**Un défaut trouvé en passant, et corrigé.** `ouvrirLesFiltres` visait son bloc
dans un `requestAnimationFrame`. Dans un document caché, l'image suivante
n'arrive jamais : le bloc visé restait à **3309 px** du haut du tiroir et le
geste ne montrait rien. Le défilement se fait maintenant tout de suite **et** à
l'image suivante — un défilement de trop ne se voit pas, un défilement manquant
si.

## 12.B — L'administration au doigt

Mesuré sur 375 px :

| | avant | après |
|---|---|---|
| tableau des comptes | **715 px dans une boîte de 281** | **320 dans 320**, zéro défilement |
| case à cocher (lots, panorama, tutelles) | **13 × 13 px** | 22 px dans une **bande tactile de 40** |
| « ← Revenir à mes arbres » | 23 px de haut | 40 px |
| marge de `body` | 1,5 rem, soit 13 % de la largeur | 0,8 rem |

Un tableau de sept colonnes ne rentre pas dans 375 px et n'y rentrera jamais.
Sous 760 px il **cesse d'être un tableau** : chaque ligne devient une carte,
chaque cellule porte l'intitulé de sa colonne à gauche. Le CSS seul n'y suffit
pas — une règle ne sait pas lire le `<th>` d'une colonne depuis une cellule ;
`etiqueter()` le recopie une fois par dessin.

- ☑ Comptes, intendants, sauvegardes et journal portent la classe `cartes`.
- ☑ Le panorama, le résultat d'un lot et l'arbre à plat **ne l'ont pas** : ce
  sont des relevés qu'on parcourt et qu'on compare ligne à ligne, pas des objets
  sur lesquels on agit. Leur défilement latéral est le bon comportement, et le
  panorama en garde 301 px — dans sa propre boîte, jamais la page.
- ☑ À cette largeur, **rien de ce qui se touche ne descend sous 40 px**. Les
  seules exceptions mesurées sont des cases à cocher de 22 px posées dans une
  bande de 40 qui les commande.

## 12.C — Les mêmes fiches, écrites plusieurs fois

Le panorama comparait les **catalogues** — maisons, catégories, types de liens,
filtres, listes. Il compare maintenant aussi les **fiches**, et c'est un autre
problème : six joueurs qui saisissent le même personnage produisent six fiches,
et il suffit d'un titre accolé au nom pour que deux d'entre elles cessent de se
reconnaître. Le maître de jeu voit alors une divergence là où il n'y a qu'une
orthographe.

- ☑ **Même nom, identifiants différents.** Le cas qu'on vient chercher.
- ☑ **Même identifiant, noms différents.** Personne n'est en double : quelqu'un
  a renommé sa fiche, et c'est peut-être voulu. On le montre, on ne propose
  rien.
- ☑ **« Aligner tout le monde sur celle-ci »** remplit le formulaire de lot avec
  la fiche choisie — identifiant compris, puisque c'est lui qui décide si le lot
  met à jour ou fabrique une fiche de plus. Le lot garde sa règle : rien ne
  s'écrit sans un aperçu relu.
- ☑ Un seul relevé, deux lectures : le rapprochement voyage dans la réponse du
  panorama, dont les sauvegardes sont déjà lues et analysées.
- ☑ Borné au périmètre de l'intendant comme le reste de la route.

**Ce que le rapprochement ne fait pas, et pourquoi c'est écrit dans la page.**
Il rapproche **par le nom**, et deux personnes peuvent porter le même. Constaté
sur le monde livré avec l'application : « Brandon Stark » y désigne deux
personnages — `brandon-stark-aine`, le frère d'Eddard, et `bran-stark`, son
fils. Le premier intitulé disait « à unifier » ; il mentait sur un cas du
produit. Il dit maintenant « même nom, identifiants différents », et la page
donne cet exemple-là. **On signale, on ne conclut pas.**

Il ne **fusionne** rien non plus : poser une fiche de référence ajoute ou met à
jour, mais ne supprime pas l'autre dans l'arbre où elle vit et ne rebranche pas
ses liens. Ce serait une opération destructive à travers plusieurs comptes ;
elle mérite son propre lot, avec son propre aperçu. **Non fait, à décider.**

## Vérification

**489/489.** Les mesures ne sont pas dans le harnais : elles sont dans les deux
tableaux ci-dessus, prises au navigateur à 375 × 812 avec les transitions
neutralisées, et confirmées à 1280 px (l'écran large est inchangé : le tableau
reste un tableau, l'en-tête reste visible, la colonne d'actions reste collante).

# Lot 13 — Le tiroir sans sa barre, et « hidden » qui cache enfin  ☑

*Demandé le 14/08/2026, après le lot 12 : « retire le kebab menu, qui prend les
mêmes options que la petite icône de tête » ; « retirer la grosse barre qui nous
suit (“Menu” puis plus loin une croix), totalement useless sur téléphone » ;
« laisse l'option de créer un compte ou se connecter seulement si l'utilisateur
n'est pas connecté — s'il est connecté, une vue de son profil, pour voir les
détails de son compte et se déconnecter ».*

## 13.A — Trois boutons pour un tiroir, sur l'écran où la place manque

☰ ouvrait le même tiroir que 👤 et que « ⛨ Filtres ». Il s'en va au téléphone ;
restent les deux qui disent **où** ils mènent.

L'en-tête du tiroir mesurait **341 × 61 px, collants**, sur une hauteur utile de
**694 px** — 9 % dépensés en permanence pour le mot « Menu » et une croix. Il
disparaît, balisage compris.

Mais la croix, elle, servait : c'était **la seule sortie**, le tiroir couvrant
tout l'écran. Deux mesures l'ont remplacée :

- ☑ **Le bouton qui ouvre referme.** ⛨ et 👤 sont des bascules, et elles
  comparent le bloc visé — passer des filtres au compte n'oblige donc pas à
  fermer d'abord.
- ☑ **La barre du bas passe au-dessus du tiroir** (`z-index: 40`). Mesuré :
  tiroir ouvert, `elementFromPoint` sur « ⛨ Filtres » ne rendait plus le bouton
  mais le tiroir posé par-dessus. Une sortie recouverte n'est pas une sortie.
  Le tiroir gagne 72 px de réserve en bas pour que son dernier bloc se lise.

## 13.B — « hidden » ne cachait pas

`#groupe-essai` portait bien `hidden` quand le compte était réel. Il s'affichait
quand même : le `display: none` d'un élément `hidden` est une règle **d'agent
utilisateur**, et la moindre règle d'auteur qui donne un `display` la bat.
`.groupe-essai { display: flex }` suffisait.

Mesuré sur un compte d'intendant, **cinq éléments** étaient dans ce cas :

| élément | ce qu'il affirmait à tort |
|---|---|
| `#bandeau-procuration` | « vous écrivez chez les autres » — alors qu'on écrivait chez soi |
| `#bandeau-essai` | l'invitation à créer un compte, sur un compte existant |
| `#groupe-essai` | « Créer un compte » et « Se connecter » à quelqu'un de connecté |
| `#lien-document` | « 📜 Document » sans document où aller |
| `#scene-message` | un message de scène vide |

- ☑ Une règle, `[hidden] { display: none !important; }`, dans `app.css` **et**
  dans `base.css`. Le `!important` est à sa place : il n'existe pas de cas où
  l'on veuille afficher un `hidden`.

## 13.B (suite) — Le compte a sa vue

Le bloc du tiroir s'appelait « Compte et réglages » et mêlait l'adresse du
compte au choix de couleur. Ce sont deux questions qu'on ne se pose jamais en
même temps.

- ☑ **« Votre compte »** — l'adresse et le rôle en toutes lettres, puis
  **« ⚙ Administration »**, **« 🛡 Vos données »**, **« ⏻ Se déconnecter »**,
  chacun 46 px et **avec son libellé** : au doigt il n'y a pas d'infobulle à
  survoler. Pour un visiteur sans compte, ce bloc ne porte que « Créer un
  compte » et « Se connecter » — et ni ⚙ ni ⏻, qui ne voudraient rien dire.
- ☑ **« Réglages de l'affichage »** en dessous : vue générale, couleur,
  document, année, thème.
- ☑ 👤 ouvre le tiroir sur le premier.

**Un défaut trouvé en chemin.** `#lien-admin` (⚙) n'apparaissait qu'au rôle
`admin` — la condition était restée telle qu'écrite au lot 7, quand ce rôle
était le seul au-dessus de `membre`. **Un intendant, à qui la page répond
pourtant, n'avait aucune porte pour y aller.** La condition suit maintenant
`exigerGestion` : `admin` ou `intendant`.

## Mesures

| sur 375 px | avant | après |
|---|---|---|
| en-tête du tiroir | 341 × 61 px collants | supprimé |
| boutons ouvrant le tiroir | 3 (☰, ⛨, 👤) | 2 (⛨, 👤), tous deux bascules |
| « ⛨ Filtres » tiroir ouvert | recouvert par le tiroir | sous le doigt |
| premier pixel d'arbre, compte réel | 118 px | **55 px** |
| éléments `hidden` pourtant affichés | 5 | **0** |

## Vérification

**502/502.** Une assertion du lot 11.C a dû être réécrite, et non supprimée :
« le tiroir de gauche a une sortie » cherchait `btn-fermer-rail`. Ce qu'elle
protège n'a pas changé — sur un tiroir qui couvre tout l'écran, ne pas pouvoir
sortir revient à ne pas pouvoir entrer — mais elle vise maintenant la bascule.

---

# Lot 14 — La démonstration, et la visite guidée  ☑

**Le constat, mesuré le 14/08/2026 en production.**

| | |
|---|---|
| comptes | 45, dont **37 essais sans compte** |
| sauvegardes | 38 |
| octets stockés | 3 133 838 |
| dont Westeros vierge, en 32 exemplaires | **2 937 472 — soit 94 %** |

Autrement dit : le service stockait presque exclusivement son propre cadeau.
Chaque visiteur repartait avec sa copie personnelle de 90 Ko d'un document
identique au voisin, et les chiffres d'administration — poids, fiches, liens,
doublons — parlaient de Westeros plutôt que du travail des gens. Le
rapprochement du lot 12.C annonçait sereinement que tout le monde avait les
mêmes fiches : exact, et parfaitement inutile.

Demande du 15/08 : « faire passer l'arbre de base comme non comptabilisé dans
les stats, non sauvegardé aussi… ça sert juste comme tuto ; ce qui sera
vraiment pertinent, ce sera de voir ce que les joueurs feront d'eux-mêmes ».

## 14.A — Une fiche qui ne coûte rien et ne compte nulle part

- ☑ Migration `0008` : une colonne `demo`, **additive et non destructive**. Le
  drapeau se pose sur l'existant avec une garde qui ne se discute pas —
  `revision = 1`, la révision n'avançant que dans `ecrireDocument`. Les deux
  Westeros réellement travaillés (révisions 5 et 8) restent des mondes à leurs
  propriétaires et ne sont pas touchés.
- ☑ **Sa ligne de contenu n'existe pas tant que personne n'y a écrit.**
  `lireTexte` sert alors le document livré avec le Worker ; la première
  écriture matérialise la ligne par l'`ON CONFLICT` déjà présent. Un visiteur
  coûte désormais **deux lignes de quelques octets**, contre 90 Ko.
- ☑ Écartée des plafonds (`verifierNombre`), de « Vos données », de l'archive
  « Tout télécharger », du panorama et des lots de l'administration
  (`resoudreCibles`), et du compteur de `/api/sante`.
- ☑ **Remise à zéro à chaque ouverture de session** — et seulement si elle a
  bougé : le cas courant ne coûte qu'une lecture d'index. Le ménage nocturne
  fait de même pour qui ne se déconnecte jamais, et c'est lui qui rendra les
  2,9 Mo dormants.
- ☑ `POST /api/sauvegardes/demonstration` : à la demande, et reconstruit la
  fiche si on l'avait supprimée. **Elle ne revient pas d'elle-même** : effacer
  la démonstration est un choix légitime, et la réinstaller à chaque connexion
  serait le contraire d'un service.
- ☑ Elle ne se partage pas (409, avec l'indice « dupliquez-la d'abord »).

**La seule exception à « rien n'est conservé », et pourquoi elle existe.** Un
visiteur qui a construit dans la démonstration puis s'inscrit **garde son
travail** : la fiche perd son drapeau et prend le nom « Mon Westeros », rien
n'est recopié. Remettre la démonstration à zéro au moment précis où quelqu'un
crée un compte pour garder son travail aurait été le seul endroit du produit
où l'avertissement se serait retourné en piège.

## 14.B — Le dire, et sans qu'on puisse le faire taire

- ☑ Un bandeau `#bandeau-demo` **sans bouton de fermeture**, présent tant que
  la démonstration est le monde ouvert et disparaissant dans le sien.
- ☑ Il change de ton à la première écriture — comme le bandeau d'essai, et pour
  la même raison : c'est là qu'il y a quelque chose à perdre.
- ☑ Le bouton dit quoi faire **selon qui regarde** : « Créer un compte » pour un
  visiteur, « ⎘ En faire mon monde » pour un membre.
- ☑ Un bloc « Démonstration » à part dans le rail, comme « Partagés avec moi » :
  cet arbre n'est pas à vous, ne compte pas dans votre plafond, ne se conserve
  pas. Pas de menu contextuel dessus — renommer ou exporter ce qui repart à
  zéro sont deux façons de croire qu'on le garde.
- ☑ **Un seul bandeau à la fois** : dans la démonstration, celui d'essai se
  tait. Deux barres empilées, c'est 130 px des 812 d'un téléphone pour deux
  fois le même conseil.

## 14.C — La visite guidée

Six écrans, sortable à tout moment, relançable par un « ? » discret — dans la
barre du haut, et dans le tiroir au téléphone.

1. Bienvenue — **rien n'est conservé ici**, dit d'emblée ;
2. créer un profil ; 3. relier deux fiches ; 4. ranger par maison ;
5. changer ce que la couleur raconte (et créer une catégorie) ;
6. **votre monde à vous**, qui se garde, lui.

Trois règles : elle **se propose** (« Plus tard » sur le premier écran), elle
**montre sans faire faire** (aucune étape n'attend un geste, on n'y reste pas
coincé), et elle **se rabat quand une cible manque** — carte centrée plutôt que
halo autour de rien.

## Mesures

| | avant | après |
|---|---|---|
| coût d'un visiteur en base | 90 Ko | **~200 octets** |
| octets stockés qui sont du Westeros vierge | 2 937 472 (94 %) | **0** après le premier ménage |
| bandeau de démonstration, 375 px, au repos | — | **29 px** (85 px avant la passe téléphone) |
| bandeau après une écriture | — | 49 px, avec l'appel à l'action |
| premier pixel d'arbre, 375 px | 55 px | 83 px (l'avertissement coûte 28 px) |
| étapes du tutoriel hors écran, 375 px | — | **0 sur 6** |

## Vérification

**545/545 en local.** Trois assertions plus anciennes ont dû être réécrites, et
non supprimées : elles comptaient « ses sauvegardes » avec la démonstration
dedans, ce qui remplissait une place de trop dans le test des plafonds et
faisait passer la démonstration neuve en tête de liste après une inscription.
D'où trois aides — `siennes`, `sienne`, `demo_id` — qui disent en un mot ce que
« ses sauvegardes » veut maintenant dire.

---

# Lot 15 — Le carnet  ☑

*Demandé le 15/08/2026.* « Une nouvelle vue qui va permettre aux joueurs de
prendre des notes, avec une mise en page économe donc probablement en .md, et
qui leur permettra de baliser leurs notes avec des profils : en cliquant sur un
profil, ils voient quelles notes y font référence. »

## Ce que le carnet est

Des **notes en Markdown**, rangées en **chapitres**, qui **citent** les fiches du
monde. Trois mots, et chacun porte une décision.

**Markdown**, parce que c'est ce que « économe » veut dire ici. Mesuré sur une
note de séance de 2 945 signes et quinze citations :

| | octets |
|---|---|
| la note, telle qu'elle est stockée | **3 061** |
| la même note rendue en HTML | 11 965 |

Un modèle de document riche coûterait **quatre fois** le texte, pour un texte
qu'on relit et qu'on ne remet presque jamais en forme. Ce qui est enregistré est
donc exactement ce qui a été tapé — 1,04 octet par signe, dont 116 de garniture
pour la note entière. Le plafond de 2 Mo d'une sauvegarde tient environ **680**
notes de cette taille.

**Chapitres**, parce que c'est la division qui a été demandée, et la seule : les
séances, les joueurs impliqués, les lieux ne sont pas quatre classements
parallèles à tenir à jour, ce sont des **citations** dans le texte.

**Citations**, sous la forme `@p:jon-snow` — un genre (`p` profil, `m` maison,
`j` joueur, `l` lien) et un identifiant :

- **elle survit à un renommage.** Ce qui est écrit est l'identifiant ; le nom
  est lu dans la fiche à l'affichage. Renommer « Jon Snow » change toutes les
  notes d'un coup, sans en réécrire une seule ;
- **elle ne se répète pas.** Un nom recopié dans chaque citation, c'est le nom
  payé autant de fois qu'il est cité ;
- **elle se relit.** L'identifiant est le nom aplati, donc la source reste
  lisible pendant qu'on tape.

## 15.A — Le carnet dans le document

`carnet` est une clef de plus dans le document de la sauvegarde — pas une table,
pas un service. Elle passe donc par `monde()` et `ecrireDocument`, hérite des
plafonds, des exports, de l'archive, et **de la procuration** : l'administrateur
et l'intendant atteignent les notes par le même chemin que le reste.

- ☑ **La clef n'existe pas quand le carnet est vide** — supprimer la dernière
  note l'efface du document. Un monde qui ne s'en sert pas ressort octet pour
  octet comme il est entré, et `outils/comparer.mjs` reste muet.
- ☑ **Une balise dans un bloc de code ne cite personne** : le code est neutralisé
  par des espaces, ce qui laisse les positions intactes pour découper les
  extraits. L'index et l'affichage disent ainsi la même chose.
- ☑ **Retirer un chapitre ne perd pas ses notes** : elles passent hors chapitre.
- ☑ **Supprimer un profil ne réécrit pas les notes**. Elles gardent ce qu'elles
  disaient ; la pastille devient barrée et ne mène plus nulle part.
- ☑ 200 000 signes par note, refusés en français au-delà.

## 15.B — L'éditeur

Une barre d'outils qui **écrit du Markdown dans le texte** — titres, gras,
italique, barré, code, listes, citation, tableau, filet, lien. Pas un traitement
de texte déguisé : le fichier reste lisible tel quel, et c'est ce qui permet d'en
garder mille.

Le rendu (`public/js/markdown.js`) est écrit ici, et pas emprunté : la politique
de sécurité de la page interdit tout script venu d'un autre hôte, et un rendu
maison **échappe d'abord et balise ensuite**. Pas d'images — `![](data:…)` serait
la porte par laquelle une note de séance pèserait deux mégaoctets.

**Le « / »** propose profils, maisons, joueurs et liens, sous le curseur. Deux
choses réglées à la mesure :

- le « / » ne déclenche que s'il est en début de ligne ou précédé d'une espace,
  sinon « et/ou » et « 12/03 » ouvraient une liste à chaque frappe ;
- les propositions sont **bornées par genre**. Le nom d'un lien est fabriqué à
  partir de ses deux extrémités : sans quota, taper « /ed » remontait Eddard
  Stark puis cinq « Eddard Stark → … », six liens sur huit propositions. Les
  places restées libres **ne sont pas remplies** — une liste de quatre
  propositions justes vaut mieux qu'une de huit dont la moitié est du
  remplissage.

## 15.C — Les deux places, un seul carnet

Le carnet s'ouvre **en volet à côté du plan** (bouton « ✎ » de la barre basse) ou
**en pleine scène** comme n'importe quelle vue. Le « ⇄ » de son en-tête le
**déplace** : il n'y en a jamais deux dans la page — ce serait deux brouillons
sur le même texte. C'est aussi ce qui rend l'ancre honnête : une citation ouverte
depuis une fiche atterrit dans le carnet qu'on est en train d'écrire, pas dans
une copie de son dernier état enregistré.

Au téléphone, le volet devient une feuille plein écran, et le sommaire un calque
qu'on appelle du « ☰ ».

## 15.D — Les deux sens de lecture

- **De la fiche vers la note** : un onglet dépliable « Cité dans le carnet »,
  replié par défaut mais **avec le nombre dans son titre** — sinon il faudrait
  l'ouvrir sur chaque profil pour savoir s'il a quelque chose à montrer.
  Groupé par chapitre, dans l'ordre du carnet, avec les extraits cliquables.
  Cliquer descend jusqu'au passage exact, **sans fermer la vue en cours**.
- **De la note vers la fiche** : une pastille ouvre le profil dans le panneau de
  droite, ou l'éditeur de la maison, du joueur, du lien — **sans quitter les
  notes**.

L'ancre tient à une convention à respecter des deux côtés : `data-rang` compte
les apparitions **de cette cible-là** dans la note, exactement comme l'index
inverse du serveur. Si les deux comptes se séparent, une citation ouvre la bonne
note au mauvais endroit.

## Mesures

| | |
|---|---|
| note de séance, 2 945 signes | **3 061 octets** stockés |
| la même en HTML | 11 965 octets (**×4,1**) |
| notes de cette taille sous le plafond de 2 Mo | ~680 |
| barre basse à 375 px, avant | 402 px pour 354 disponibles (**48 de trop**) |
| après (« ✎ » en pastille, curseur de zoom 68 → 60 px) | **354 / 354** |
| propositions pour « /ed », avant / après quota | 8 dont 6 liens / **4** |

## Vérification

**598/598 en local** (550 avant le lot). Deux défauts trouvés par le harnais et
non par la lecture : `ErreurCarnet` n'était pas traduite par `enErreur` et
sortait en 500 au lieu de 400, et le sommaire affichait « null » — `h()` ignore
un enfant absent, `replaceChildren` le convertit en texte.

## Trouvé en production, le jour même

**« Le carnet n'est pas disponible. »** Signalé par Maxime une heure après le
déploiement, sur la vue plein écran, quel que soit le monde ouvert.

Rien n'était cassé : son onglet était **ouvert depuis avant le déploiement**. Il
gardait donc en mémoire l'ancien `main.js`, celui d'avant le lot — tandis que
l'import dynamique de la vue, lui, allait chercher le fichier neuf sur le
serveur. Le fichier neuf demandait à `main.js` l'exemplaire du carnet ; l'ancien
`main.js` n'en avait jamais posé. Deux fichiers de deux versions, et un
message de repli à la place de la vue.

Le correctif n'est pas de remettre l'accesseur au bon moment, c'est de
**supprimer la poignée de main** : `public/js/views/carnet.js` est retiré, et
`main.js` enregistre le rendu **sur l'objet qu'il vient de créer**. Un seul
fichier, donc une seule version, donc plus de désaccord possible. Le harnais
vérifie les deux moitiés : `enregistrerRendu('carnet'` est bien dans `main.js`,
et qu'il n'y a plus de **module** à `/js/views/carnet.js`. Pas un 404 : les
fichiers statiques sont servis en monopage, un chemin inconnu retombe sur
`index.html` avec un 200. C'est donc le corps qu'on regarde, pas le code.

Ce que ça n'enlève pas : un onglet resté ouvert pendant un déploiement gardera
toujours l'ancien code. Ce lot-ci ne peut plus tomber dessus ; la leçon
générale, elle, est qu'un rendu chargé à la demande ne doit jamais **dépendre**
de ce qu'un autre fichier a fait avant lui.

## Le rond des initiales qui tombait sur le nom (15/08/2026)

**Signalé par Maxime :** attribuer un joueur à une fiche faisait descendre la
pastille de ses initiales sur son nom, sur la carte du plan.

Une collision de noms de classes, et rien d'autre. Une carte jouée porte l'état
`.joueur` — comme elle porte `.morte`, `.satellite` ou `.rang`. Or les lignes de
la section « Humeur envers les joueurs » de la fiche s'appelaient `.joueur` tout
court. La règle de la fiche rattrapait donc **les cartes du plan**, et comme
elle vient plus bas dans la feuille à spécificité égale, son `padding: 8px 0`
écrasait le `padding-top: 34px` que `.carte` réserve au portrait. Le portrait
est en `position: absolute` : il ne bougeait pas, c'est le bandeau du nom qui
remontait de 26 px sous lui. Mesuré sur la carte de Rickard Stark : le rond
recouvrait le nom de **27 px** au lieu de l'effleurer d'**1 px**. Au passage,
chaque carte jouée héritait aussi d'un trait pointillé en bas.

Les lignes de la fiche s'appellent maintenant `.joueur-ligne`. Le harnais
vérifie qu'aucune règle ne s'appelle `.joueur` tout court, que `.joueur-ligne`
existe, et que `panel.js` pose bien cette classe-là.

La leçon est la même que d'habitude sous une autre forme : **un état porté en
classe nue partage l'espace de noms de toute l'application.** Les états des
cartes (`morte`, `satellite`, `rang`, `focus`…) sont des mots courants ; aucun
composant ne doit prendre l'un d'eux comme nom propre.

# Lot 16 — la fiche allégée, les notes qui circulent, et l'anglais

Sept demandes du 15/08/2026, dans le même message.

## 16.A — « Importance » quitte la fiche

Le champ promettait de piloter la taille des nœuds. Il ne pilotait plus rien :
depuis que les cartes partagent un gabarit commun, `views/cartes.js` ne lit
jamais `importance`. Un réglage qui ne fait rien est pire qu'un réglage absent.

La **donnée**, elle, reste : elle est dans les documents existants, dans les
exports, et dans le catalogue des variables filtrables. Ce qui disparaît est le
seul endroit d'où on pouvait la changer — conséquence à assumer, dite ici pour
qu'on ne la redécouvre pas : **`importance` garde désormais la valeur qu'elle
avait**, et un filtre bâti dessus ne verra plus jamais rien bouger.

## 16.B — L'humeur envers les joueurs se replie

Quatre joueurs, c'est quatre curseurs et quatre commentaires : cinq cent
quarante pixels, la moitié de la fiche, pour une section qu'on ne remplit pas à
chaque profil. Elle devient un `<details>`, et le motif est **généralisé** :
`.pn-repliable` sert aux citations du carnet comme à l'humeur, plutôt que d'être
recopié. Le résumé du titre dit ce qu'il y a dessous (« 3 / 4 notés »), pour ne
pas avoir à déplier pour le savoir.

Ouvert par défaut — c'est ce que faisait la fiche avant — et le choix se retient
**d'une session à l'autre** : c'est une préférence de lecture, pas un état de
navigation.

## 16.C — Ce qui ne s'apprend pas ne se lit pas

Élagage des paragraphes permanents. La règle appliquée : **on garde ce qui
annonce une conséquence, on retire ce qui décrit ce qu'on voit.**

Partis : « Les sept ressources du JDR Le Trône de Fer… » (l'exemple donné),
le laïus de la démonstration recopié sous le bandeau qui le dit déjà, « Tout ce
que vous modifiez est écrit tout de suite » (l'indicateur d'écriture le dit),
l'explication du portrait (l'infobulle de la pastille la dit), le mode d'emploi
du rang sous la liste des membres, et le bloc « Édition » du rail — parti dans
le dépliant ⌨.

Restés : les comptes (« 3 personnes dans cette maison »), les conséquences
d'une suppression, et l'aide de l'âge **quand elle est actionnable** — c'est-à-
dire uniquement quand l'année de campagne manque et que le champ est désactivé.
Le reste est passé en infobulle, sur le champ concerné.

## 16.D — Les raccourcis dans la barre du haut

Un dépliant ⌨, trois groupes : partout, sur le plan, dans le carnet.
`public/js/raccourcis.js` **ne définit aucun raccourci** — il ne fait que dire
ceux que `main.js` et `views/cartes.js` câblent. C'est écrit en tête du fichier :
si l'un change, cette liste ment jusqu'à ce qu'on la corrige.

## 16.E et 16.F — Une note s'offre à un autre compte

Voir `REPRISE.md`, section « Offrir une note (lot 16) », pour les invariants.
Ce qui a décidé de la forme :

- **Rien n'arrive sans un oui.** Poser du texte dans le carnet de quelqu'un
  sans qu'il l'ait accepté, ce n'est plus partager. D'où une table d'attente
  (`0009`), et non une écriture directe.
- **Une offre est une copie datée.** L'expéditeur garde sa note et peut la
  corriger sans changer ce que l'autre a reçu.
- **Les balises doivent survivre au voyage.** `@p:eddard-stark` ne veut rien
  dire chez quelqu'un d'autre : la note part avec un **glossaire** — le nom que
  l'expéditeur donnait à chaque cible — et l'acceptation retrouve les fiches du
  destinataire par identifiant, puis par nom aplati, puis par ressemblance
  (Jaccard sur les mots, seuil 0,5). Ce qui ne se retrouve pas devient
  `@Eddard Stark` : du texte lisible, plutôt qu'une citation qui pointe à côté.

Mesuré par le harnais sur un cas réel : une note citant deux fiches, envoyée
d'un monde à l'autre, ressort avec **2 citations rattachées** — dont une par le
nom, l'identifiant étant différent des deux côtés — et **1 laissée en clair**.

## 16.G — Français / English

L'application compte quatorze mille lignes de JavaScript écrites en français.
La façon canonique — un `t('…')` autour de chaque chaîne — voulait dire toucher
huit cents endroits dans du code qui marche, pour un bénéfice nul tant que la
seconde langue n'existe pas, et un oubli laisse une phrase en français sans que
rien ne le signale.

Le choix retenu : **un dictionnaire posé devant le DOM**. On parcourt les nœuds
de texte et les attributs qui s'affichent, et on remplace ce qu'on reconnaît.
Le raisonnement complet est en tête de `public/js/langue.js` ; la propriété qui
a emporté la décision est que **ce qui n'est pas au dictionnaire ne bouge
pas** — donc les noms de personnages, les maisons et les notes de la table ne
peuvent pas être traduits par accident, sans que personne ait à penser à les
marquer.

Le relevé est outillé : `node outils/relever-textes.mjs` rend les chaînes
visibles, `--manquants` celles qui n'ont pas encore de traduction. La
traduction elle-même a été produite par un sous-agent (Sonnet 5), avec le
glossaire du projet — carnet, fiche, maison, humeur, lien.

**Le relevé s'est étoffé en marchant, et chaque élargissement a été payé par un
défaut trouvé à l'écran.** 643 chaînes au premier passage ; 847 à l'arrivée. Ce
qui manquait :

- les deux branches d'un **ternaire** (`dirige ? 'orienté' : 'réciproque'`) —
  des mots interpolés au milieu d'une phrase, qui ne s'affichent jamais seuls ;
- les libellés passés en **argument** et non en propriété
  (`champTexte('generation', 'Génération (vide = calculée)')`) ;
- les phrases écrites en **plusieurs morceaux collés** par des `+`, qui n'en
  font qu'une à l'écran — d'où une ligne de plafonds à moitié traduite ;
- ce que le **serveur** envoie : nom et description des vues, intitulés des
  tableaux.

Trois défauts trouvés en regardant l'application, et non en lisant le code :

1. **« Space » pour « Lieu ».** `Lieu` → `Place`, puis l'observateur relit ce
   qu'il vient d'écrire : « Place » est *aussi* un mot français, traduit
   ailleurs par « Space ». Un drapeau posé le temps de la boucle n'y suffit
   pas — les mutations arrivent en microtâche. Réparé par une mémoire, nœud par
   nœud, de la valeur écrite.
2. **« 16 link(s) direct(s) ».** Le motif `{} lien{}` se compile en
   `/^(.*) lien(.*)$/`. Il traduisait à moitié cette ligne-là — et il aurait
   réécrit « il a rompu le lien avec son père » **dans une note de la table**.
   Un motif qui flotte entre deux trous exige maintenant douze signes de
   littéral ; un motif ancré par du texte reste permis.
3. **« Sans compte ici : … »** en français au milieu d'un panneau anglais : un
   gabarit passé en argument libre, hors de portée du relevé.

D'où la mise en garde, écrite dans `REPRISE.md` : **`0 sans traduction` ne veut
pas dire « tout est traduit »**. Le relevé connaît les formes usuelles, pas
toutes. La vérification qui compte est de regarder l'application en anglais.

Ce que ça ne fait pas, et il faut le savoir : **une phrase ajoutée demain reste
en français** jusqu'à ce qu'on l'ajoute au dictionnaire, et le changement de
langue **recharge la page** (retraduire de l'anglais vers le français ne serait
pas une opération sûre).

## 16.I — « La vue de Westeros lag un peu »

Signalé le 15/08/2026. **Mesuré avant de toucher à quoi que ce soit**, sur 67
fiches et 180 liens dans une fenêtre de 760 × 707 :

| Ce qu'on soupçonnait | Ce que ça coûte |
| --- | --- |
| Le gestionnaire de zoom | **0,02 ms** par cran |
| Déplacer les 67 cartes en `left/top` | **1,63 ms** — et 1,76 en `transform` |
| La bascule « loin » quand rien ne change | **0,001 ms** |

Rien de tout ça. **Deux hypothèses vérifiées et abandonnées** : `left/top` ne
coûte pas plus que `transform` à cette taille, et `classList.toggle(nom, force)`
n'invalide rien quand la valeur ne change pas.

Ce qui coûte, c'est **la peinture** : le monde mesure **5041 × 4216 px** — 21
mégapixels dans **une seule couche** — et porte **665 couches d'ombre floue**
(289 déclarations, `--carte-ombre` en empilait deux dont une à 10 px de flou) et
**47 surfaces de filtre**. Chaque cran de zoom change l'échelle et force à
re-tramer le tout.

Quatre décisions, et le compte après :

1. **Une seule couche d'ombre** au lieu de deux. On avait d'abord voulu poser
   une ombre unique sur `.carte` : c'est faux, `.carte` réserve 34 px
   transparents pour le portrait et l'ombre aurait cerné cette bande vide.
2. **La poignée ＋ perd la sienne** : transparente au repos, elle traînait 67
   halos flous sous un bouton qu'on ne voit pas.
3. **Les morts sont ternis par un voile**, pas par `filter` — un filtre ouvre
   une surface de rendu à part. Un vrai portrait garde son filtre : un voile
   plat ne désature pas une photographie, il la salit.
4. **De loin, le corps de fiche ne se dessine plus.** `opacity: .18` le
   pâlissait *et le peignait quand même*. On cache ses **enfants**, pas la
   boîte : `display: none` sur le corps ferait rétrécir la carte alors que les
   traits de liaison visent des boîtes calculées en JavaScript — les liens
   finiraient dans le vide.

**Mesuré après** : 665 → **309** couches floues (−54 %), 47 → **0** filtres, et
de loin **628 nœuds rendus en moins sur 1536** (−41 %), la carte gardant
exactement sa hauteur.

**Une réserve à ne pas oublier** : le volet de vérification ne compose pas
d'images, donc **la peinture elle-même n'a pas pu être chronométrée**. Les
chiffres ci-dessus sont des compteurs et des durées de style ou de mise en
page ; le diagnostic « c'est la peinture » vient du raisonnement sur ces
compteurs, pas d'un profil. `contain: layout style` a d'ailleurs été essayé et
**écarté** : il n'améliore pas le recalcul de style (5,34 → 5,75 ms).

**Ce qui reste à faire quand un monde dépassera ~300 fiches** : ne construire
que les cartes qui touchent l'écran. Attention au piège : à « tout afficher »,
**tout** est à l'écran — le fenêtrage ne sert que zoomé, et c'est le niveau de
détail ci-dessus qui couvre l'autre régime. Les deux se complètent, aucun ne
remplace l'autre. **Canvas ou WebGL est écarté** : on perdrait le texte
sélectionnable, l'accessibilité, les infobulles et le menu contextuel, pour un
gain qui ne devient décisif qu'à plusieurs milliers de nœuds.
