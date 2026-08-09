# Déploiement — ce qu'il faut créer, et dans quel ordre

Objectif : après cette page, **un `git push` suffit** pour mettre à jour le site.
Tout est gratuit, aucune carte bancaire n'est demandée.

> ## C'est fait — 09/08/2026
>
> | | |
> | --- | --- |
> | Adresse | **https://familytree.schlub-perso.workers.dev** |
> | Compte Cloudflare | `Schlub_perso` — `1df084d9829788d12811b34411295ca9` |
> | Base D1 | `familytree` — `790c7252-c1ec-44ed-8885-06c8f44be8c6`, région **WEUR** |
> | Dépôt | https://github.com/Schluby/familytree-cloud, branche `main` |
>
> **Pourquoi un compte à part** : le même identifiant Cloudflare porte un autre
> compte, qui héberge le site de quelqu'un d'autre. Les quotas gratuits étant
> comptés **par compte**, une pointe de trafic sur FamilyTree — dont
> l'inscription est ouverte à tous — aurait pu couper ce site-là jusqu'à
> minuit UTC. Le risque n'était pas le nôtre à prendre.
>
> La suite de cette page reste la marche à suivre de référence, pour refaire
> l'installation ailleurs ou comprendre un réglage.

## Trois pièges rencontrés, pour ne pas les réapprendre

1. **`wrangler login` ne couvre que les comptes qui existent au moment de
   l'autorisation.** Le compte créé après coup donne une « Authentication
   error [code: 10000] » à la première commande. Créer le compte **d'abord**,
   autoriser ensuite.
2. **Le tableau de bord propose deux chemins qui se ressemblent.** « Set up your
   application » *crée* un Worker nommé d'après le dépôt (`familytree-cloud`),
   ce qui échoue puisque la configuration dit `familytree` : Cloudflare exige
   que les deux noms soient identiques. Le bon chemin est le Worker existant →
   *Settings → Builds → Connect*.
3. **Dans les secondes qui suivent un déploiement**, les fichiers statiques
   mettent un instant à se propager : `/` peut répondre 404 puis « error code
   1042 ». Ce n'est pas un bug. Réessayer.

## La réponse courte

| À créer chez Cloudflare | Combien | Nom | À quoi ça sert |
| --- | --- | --- | --- |
| **Worker** | 1 | `familytree` | Sert l'interface **et** l'API. C'est le site. |
| **Base D1** | 1 | `familytree` | Comptes, sauvegardes, instantanés. |
| **Déclencheur cron** | 1 | — | Ménage nocturne. Créé tout seul par le déploiement. |

**Et c'est tout.** Pas de deuxième Worker, pas de service séparé pour le front,
pas de secret à saisir.

## Faut-il une base de données ? Oui, une seule.

Un Worker ne garde **rien** entre deux requêtes : pas de disque, pas de mémoire
qui survit. Sans base, il n'y aurait ni comptes ni sauvegardes. C'est **D1**,
le SQLite géré de Cloudflare : 5 Go, 5 millions de lignes lues et 100 000
écrites par jour, gratuit.

Pour dix personnes, la vraie campagne pèse 73 Ko et une modification écrit une
ligne : on est **sous 1 % du stockage et autour de 5 % des écritures** —
détail chiffré dans [`ARCHITECTURE.md`](ARCHITECTURE.md), section « Faisabilité ».

**Une seule base pour tout le monde**, pas une par utilisateur : le
cloisonnement se fait par le `WHERE utilisateur_id = ?` de chaque requête, pas
par des bases séparées. Une base par personne multiplierait les objets à gérer
sans rien ajouter à la sécurité.

## Ce qu'on ne crée pas, et pourquoi

| Brique | Décision | Raison |
| --- | --- | --- |
| **R2** (fichiers) | non | Pas de portraits en ligne. Sans photos, il n'y a rien de lourd à stocker. |
| **KV** | non | Ne servirait qu'à mettre les sessions en cache. KV est *à cohérence différée* : une déconnexion mettrait jusqu'à une minute à prendre effet ailleurs. Inacceptable pour une session. |
| **Durable Objects** | non | Utile pour de l'édition simultanée en temps réel. Ici, deux onglets se règlent avec un verrou optimiste (lot 6), pour zéro brique en plus. |
| **Queues** | non | Rien d'asynchrone : toute écriture est immédiate. |
| **Cloudflare Pages** | non | Pages et Workers ont fusionné. Un seul Worker sert les fichiers **et** l'API : même domaine, donc pas de CORS et un cookie de session qui marche sans contorsion. |
| **Un secret** (`wrangler secret put`) | **non, décision révisée** | Le plan prévoyait un `SESSION_SECRET`. Il ne sert à rien : les jetons de session sont **aléatoires** et stockés hachés, il n'y a aucune signature à vérifier. Un poivre de hachage n'aurait apporté qu'un risque — le perdre rendrait **tous** les mots de passe invérifiables. Zéro secret, donc rien à ressaisir le jour où le Worker est recréé. |

## La marche à suivre

### 1. S'authentifier

```bash
npx wrangler login
```

Une page s'ouvre, on autorise, c'est fini. (Compte Cloudflare gratuit requis.)

### 2. Créer la base — **la région se choisit ici et jamais plus**

```bash
npx wrangler d1 create familytree --location weur
```

`weur` = Europe de l'Ouest. **Ce choix est définitif** : une base créée aux
États-Unis ajoute ~130 ms à chaque requête, pour toujours.

La commande affiche un `database_id`. **Le coller dans
[`wrangler.jsonc`](wrangler.jsonc)** à la place de
`A_REMPLACER_APRES_wrangler_d1_create`. Ce n'est pas un secret : c'est un
identifiant, il a sa place dans le dépôt.

### 3. Créer les tables

```bash
npm run base:ligne
```

### 4. Premier déploiement, depuis la machine

```bash
npx wrangler deploy
```

Le Worker existe désormais, à l'adresse
`https://familytree.<votre-compte>.workers.dev`. On fait ce premier envoi à la
main pour une raison précise : **le nom du Worker dans le tableau de bord doit
être exactement celui de `wrangler.jsonc`** (`familytree`), sinon la
construction automatique échouera. En déployant d'abord, le nom est bon par
construction.

### 5. Pousser sur GitHub

Dépôt **privé ou public, peu importe** : il ne contient aucun secret.

```bash
git remote add origin git@github.com:<vous>/familytree-cloud.git
git push -u origin main
```

### 6. Brancher GitHub sur Cloudflare

Tableau de bord Cloudflare → **Workers & Pages** → le Worker `familytree` →
**Settings → Builds → Connect**.

| Champ | Valeur |
| --- | --- |
| Dépôt | `familytree-cloud` |
| Branche de production | `main` |
| Build command | `npm ci` |
| Deploy command | `npm run deploy` |
| Root directory | *(vide)* |

`npm run deploy` applique les migrations **puis** déploie — c'est ce qui rend le
« je pousse et c'est en ligne » vrai même quand le schéma change.

### 7. Le piège : la permission D1 du jeton de construction

En branchant le dépôt, Cloudflare fabrique un jeton d'API dont les permissions
par défaut couvrent **Workers Scripts, KV, R2 et les routes** — mais **pas D1**.
Tel quel, `npm run deploy` échouera sur la migration.

Deux issues :

- **Recommandé** — *Mon profil → Jetons d'API* → le jeton « Workers Builds » →
  **Modifier** → ajouter la permission **Account · D1 · Edit**. Le déploiement
  redevient un simple `git push`.
- **Si on préfère ne pas élargir le jeton** — laisser `npx wrangler deploy`
  comme *deploy command*, et lancer `npm run base:ligne` depuis sa machine les
  rares fois où on ajoute une migration.

Le compromis, dit franchement : un jeton qui peut modifier D1 peut aussi effacer
la base. C'est le même compte et la même personne, D1 garde 30 jours d'historique
(Time Travel), et la vraie sauvegarde reste le `.zip`. J'assume, mais c'est un
choix, pas une évidence.

## Ce qui se passe ensuite, à chaque push

1. `git push` sur `main` → Cloudflare construit et déploie. Compter une minute.
2. Un push sur une **autre branche** ne met rien en ligne : Cloudflare crée une
   *version de prévisualisation*, à sa propre adresse. Pratique — mais il faut
   le savoir, sinon on cherche longtemps pourquoi « ça n'a pas changé ».
3. Le plan gratuit donne **3 000 minutes de construction par mois**, une
   construction à la fois. Notre build dure ~1 minute : c'est un non-sujet.

## Vérifier que ça marche

```bash
curl https://familytree.<votre-compte>.workers.dev/api/sante
```

Réponse attendue :

```json
{"ok":true,"base":"joignable","utilisateurs":0,"sauvegardes":0,"ms":12}
```

Si `"ok": false` avec `"base":"injoignable"` : les migrations n'ont pas été
appliquées en ligne (étape 3, ou la permission D1 de l'étape 7).

## Développer en local

```bash
npm install
npm run base:local     # crée les tables dans une base D1 locale
npm run dev            # http://localhost:8787
```

La base locale est un fichier dans `.wrangler/` : **on ne touche jamais à la
base en ligne pendant le développement**. `npm run verif` (typage + construction
à blanc) avant de pousser évite les allers-retours.

## Le domaine

On démarre sur `familytree.<compte>.workers.dev` : gratuit, HTTPS d'office, et
`workers.dev` figure sur la *Public Suffix List*, donc aucun autre site en
`.workers.dev` ne peut lire notre cookie de session.

Un domaine à soi se branche plus tard en trois clics (*Settings → Domains &
Routes*). Seule conséquence : le cookie étant lié au domaine, tout le monde
devra se reconnecter une fois. Ça ne justifie pas d'acheter un domaine
maintenant.

## Variante : déployer depuis GitHub Actions

Si la construction Cloudflare venait à gêner, le même déploiement tient en un
fichier d'Action — voir
[`.github/workflows/deploiement.yml.exemple`](.github/workflows/deploiement.yml.exemple).
Il faut alors créer un jeton d'API à la main et le poser dans les secrets du
dépôt GitHub. **Ne pas activer les deux** : on déploierait deux fois à chaque
push.

---

Sources vérifiées le 08/08/2026 :
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) ·
[configuration des constructions](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) ·
[limites de construction](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) ·
[limites des Workers](https://developers.cloudflare.com/workers/platform/limits/) ·
[tarifs D1](https://developers.cloudflare.com/d1/platform/pricing/)
