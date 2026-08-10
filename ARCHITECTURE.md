# Architecture — FamilyTree Cloud

Ce document dit **quoi** et surtout **pourquoi**. Le chemin à suivre est dans
[`PLAN.md`](PLAN.md).

## La contrainte de départ

Tout doit être gratuit et, si possible, sur Cloudflare seul. C'est ce qui a
décidé de presque tout le reste.

| Brique | Choix | Ce que donne le plan gratuit |
| --- | --- | --- |
| Exécution | **Cloudflare Workers** | 100 000 requêtes/jour, 10 ms de CPU par requête |
| Base de données | **Cloudflare D1** (SQLite géré) | 5 Go, 5 M lignes lues et 100 k écrites par jour |
| Fichiers statiques | **Workers Static Assets** | servis sans compter dans les requêtes facturées |
| Mise en ligne | **construction Cloudflare** branchée sur le dépôt Git | 3 000 minutes/mois (notre build : ~1 min) |
| Outillage | **Wrangler** (CLI officielle) | — |

*(Chiffres revérifiés à la source le 08/08/2026. **R2 a disparu de ce tableau** :
sans portraits, il n'y a rien de lourd à stocker.)*

Écartés, et pourquoi :

- **Pages Functions** : c'est devenu Workers, autant y aller directement.
- **Supabase / Neon / Turso** : gratuits aussi, mais c'est une deuxième
  plateforme à gérer et à surveiller. D1 suffit largement à la taille des
  données ici.
- **Python Workers** : tentant pour réutiliser `backend/` tel quel, mais c'est
  encore en bêta, sans accès disque, et le code devrait de toute façon être
  réécrit pour parler à D1 au lieu d'un fichier JSON. On porte en TypeScript.

## Ce que le Worker doit faire

Un routeur léger — **Hono** — pour ne pas réécrire le découpage des routes. Le
reste est du code à nous : pas d'ORM, pas de framework front, comme dans la
version locale.

```
requête ──► Worker
              ├── /                    → fichiers statiques (le web/ existant)
              ├── /api/auth/*          → inscription, connexion, session
              └── /api/*               → même contrat que l'application locale
                                          (toutes les requêtes portent un utilisateur_id)
```

## Le principe qui tient tout : garder le contrat d'API

L'interface `web/` parle déjà à `/api/vue/sociogramme`, `/api/personnes/<id>`,
`/api/filtres/apercu`… Si le Worker répond la même chose, **l'interface est
reprise sans réécriture** : seuls le bloc « Sauvegardes » du rail et une barre
de connexion changent.

Le prix à payer est clair : la logique métier écrite en Python doit être portée
en TypeScript. Environ 1 500 lignes utiles, sans dépendances, faciles à tester :

| Module Python | Ce qu'il fait | Portage |
| --- | --- | --- |
| `models.py` | Personne, Relation, Dataset, validation | direct |
| `humeur.py` | l'échelle 1-7, MD/MP, épaisseurs | trivial |
| `genealogie.py` | générations, couples, fratries déduites | direct, algorithmique |
| `filtres.py` | variables, segments, dégradé, tests | direct |
| `migrations.py` | `meta.schema` | direct |
| `views/sociogramme.py` | le payload de la vue | direct |
| `exports.py` | mise à plat CSV / XLSX | à garder pour la fin |
| `store.py`, `bibliotheque.py`, `instantanes.py` | fichiers sur disque | **remplacés** par D1 |

## Les comptes

**Inscription ouverte à qui veut** (décidé le 06/08/2026) : pas de code
d'invitation. Et **rien à télécharger** pour l'utilisateur — une adresse, un
navigateur, c'est tout. Ces deux choix ont chacun des conséquences qu'il vaut
mieux traiter dès le départ ; elles sont plus bas (« Ce qu'impose
l'inscription ouverte »).

Pas de service tiers : tout tient dans D1 et dans `crypto.subtle`, disponible
dans les Workers.

- **Mot de passe** : dérivation **en deux temps**, décidée le 09/08/2026 après
  mesure (voir l'encadré ci-dessous). Le navigateur calcule
  `cle = PBKDF2(mot de passe, sel déterministe, 600 000 tours)` ; le serveur
  range `PBKDF2(cle, sel aléatoire de 16 octets, 25 000 tours)`, au format
  `v1$sel$empreinte`. Argon2 et scrypt ne sont pas disponibles nativement dans
  un Worker ; PBKDF2 correctement itéré est la recommandation de repli de
  l'OWASP.
- **Code de secours** : 20 caractères tirés au hasard (~100 bits), rangé en
  SHA-256 salé. Pas besoin de ralentir la vérification d'un secret qui n'est
  pas devinable — et ça épargne 4 ms de CPU à chaque inscription.
- **Session** : un jeton aléatoire de 32 octets, envoyé en cookie
  `HttpOnly; Secure; SameSite=Lax; Max-Age=30 jours`, et stocké **haché** en
  base — une fuite de la table ne donne aucune session utilisable.
- **Cloisonnement** : chaque requête résout le cookie en `utilisateur_id`, et
  **toute** requête SQL porte `WHERE utilisateur_id = ?`. C'est la seule règle
  de sécurité à ne jamais relâcher ; elle est vérifiée par un test dédié
  (« un compte ne voit pas la sauvegarde d'un autre »).
- **CSRF** : `SameSite=Lax` couvre les mutations, et l'API n'accepte que
  `Content-Type: application/json`, ce qui exclut les formulaires venus
  d'ailleurs.
- **Bourrinage** : un compteur d'échecs par e-mail et par IP dans D1, avec
  attente progressive au-delà de 5 essais.

> Option envisagée puis écartée : **Cloudflare Access** (gratuit jusqu'à
> 50 utilisateurs) supprimerait toute la gestion de mots de passe. Mais il
> impose de créer chaque compte dans le tableau de bord Cloudflare —
> incompatible avec une inscription ouverte.

#### Pourquoi deux étages de dérivation — mesuré, pas supposé

Le plan prévoyait 210 000 itérations sur le serveur. **C'est impossible**, et
on l'a su en mesurant en production le 09/08/2026 :

| Tours | Réponse | CPU |
| --- | --- | --- |
| 50 000 | 200 | 7 ms |
| 100 000 | 200 | 19 ms |
| 110 000 et au-delà | 500 | — |

Cloudflare **refuse** PBKDF2 au-delà de 100 000 tours :
`NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
supported`. Ce n'est pas une question de temps de calcul mais un plafond dur de
la plateforme. Et même le maximum autorisé coûte 19 ms de CPU, soit le double
du budget documenté du plan gratuit : bâtir dessus reviendrait à parier sur une
tolérance que Cloudflare ne promet pas.

D'où le partage : le navigateur fait les 600 000 tours (une fraction de seconde,
une fois, à la connexion — et il n'a aucun plafond), le serveur en refait
25 000 par-dessus pour ~4 ms de CPU. Trois effets :

1. **Le facteur de travail total dépasse 600 000**, au-dessus des
   recommandations 2026 — donc *plus* solide que ce qui était prévu.
2. **Le serveur ne voit jamais le mot de passe.** Même une trace de requête mal
   configurée, même un journal trop bavard, ne peuvent pas le divulguer.
3. Le sel du navigateur est déterministe (dérivé de l'adresse) : sinon il
   faudrait le demander au serveur *avant* de se connecter, ce qui révélerait
   quelles adresses ont un compte.

Le prix : la page de connexion exige JavaScript. L'application entière l'exige
de toute façon.

### Ce qu'impose l'inscription ouverte

Ouvrir l'inscription, c'est accepter que n'importe qui crée un compte. Trois
conséquences, chacune avec sa réponse.

**1. Mot de passe oublié = compte perdu.** Envoyer un courriel demande un
service tiers (et les solutions gratuites pour Workers ont changé plusieurs
fois). Deux filets, sans courriel :

- un **code de secours** affiché une seule fois à l'inscription (« notez-le »),
  dont seule l'empreinte est stockée : il permet de choisir un nouveau mot de
  passe ;
- à défaut, un **administrateur** peut réinitialiser un mot de passe.

**2. Quotas par compte.** Sans plafond, un seul compte peut remplir les 5 Go de
la base — et un script peut en créer cent. Donc :

| Garde-fou | Valeur de départ |
| --- | --- |
| Sauvegardes par compte | 10 |
| Octets par sauvegarde | 2 Mo |
| Inscriptions par adresse IP | 3 par heure |
| Connexions échouées | attente progressive au-delà de 5 (table `tentatives`) |

Ces valeurs vivent dans une constante, et un administrateur peut relever le
plafond d'un compte précis (`plafond_octets`). À dix personnes, on est à 2 % de
la base ; les plafonds servent contre l'accident et l'abus, pas contre l'usage.

**3. Dire ce qui est visible.** Voir la section suivante.

## Les administrateurs

Un compte peut porter le rôle **`admin`**, qui **voit tous les arbres de tous
les utilisateurs**. C'est demandé, c'est légitime pour qui exploite le service —
mais avec une inscription ouverte, les comptes appartiennent à des inconnus, et
cela se conçoit avec soin.

**Trois règles de construction :**

1. **L'API des membres ne change pas d'un iota.** Elle continue de résoudre le
   `utilisateur_id` depuis le cookie et de porter `WHERE utilisateur_id = ?`.
   On n'ajoute **aucune** condition « … OU si je suis admin » dans ces routes :
   c'est exactement comme ça qu'on fabrique une fuite.
2. **Les administrateurs ont leur propre surface, séparée** : `/api/admin/*`,
   dans son module, derrière un intergiciel qui exige le rôle. Aucun code
   partagé avec les routes de membres.
3. **En lecture seule.** Un administrateur consulte et exporte ; il ne modifie
   jamais l'arbre de quelqu'un d'autre. Ce n'est pas qu'une règle d'interface :
   les routes d'écriture n'ont, par construction, aucun moyen de désigner la
   sauvegarde d'un autre compte. Un bouton mal placé dans l'interface se
   heurterait à un 403.

**Ce qu'un administrateur peut faire :** lister les comptes et leurs arbres,
ouvrir un arbre en consultation, l'exporter, relever un plafond,
réinitialiser un mot de passe, supprimer un compte à la demande de son
propriétaire.

**Traçabilité.** Chaque consultation d'un arbre qui n'est pas le sien écrit une
ligne dans `journal_admin` (qui, quoi, quand). Cela protège l'utilisateur, et
l'administrateur aussi.

**Comment on devient administrateur.** Jamais depuis l'interface. Le premier se
promeut en une ligne de SQL :

```bash
wrangler d1 execute familytree --remote \
  --command "UPDATE utilisateurs SET role='admin' WHERE email_norm='...'"
```

Ensuite un administrateur peut en promouvoir d'autres. Pas de « le premier
inscrit devient administrateur » : avec une inscription ouverte, ce serait
offrir le service au premier passant.

> **À dire aux utilisateurs, noir sur blanc.** L'écran d'inscription et une page
> « Vos données » doivent énoncer : ce qui est stocké (une adresse de courriel,
> vos arbres), que **les administrateurs peuvent consulter les arbres**, et
> qu'on peut tout télécharger ou tout supprimer à tout moment. Ce n'est pas une
> formalité juridique : c'est la contrepartie de la confiance qu'on demande à
> des gens qu'on ne connaît pas. Le construire sans le dire serait de la
> surveillance déguisée.

## Le stockage

```
utilisateurs ──< sauvegardes ──1 contenus
                      └──< instantanes
```

Les **métadonnées** (nom, dates, taille) sont séparées du **contenu** (le
document JSON) : afficher la liste des sauvegardes ne doit pas lire 100 Ko par
ligne.

Le document est stocké **compact** (sans indentation) : sur la campagne réelle,
mesuré au lot 2, **115 069 octets tombent à 74 717**. L'export, lui, réindente —
un fichier qu'on ouvre à la main doit rester lisible.

Le schéma complet est dans [`schema.sql`](schema.sql).

### Le nom est dans la colonne, le document ne bouge pas pour si peu

En local, renommer une sauvegarde réécrit `meta.sauvegarde` dans le fichier.
Ici, ce serait relire, reparser et réécrire 75 Ko pour un libellé. Le nom de
référence est donc la colonne `sauvegardes.nom` ; les deux ne sont recollés
qu'à l'**export**, le seul moment où le fichier doit se suffire à lui-même.

Même logique pour la lecture : `GET /api/sauvegardes/<id>/contenu` rend le texte
stocké **tel quel**, sans le reparser. Ce qui est déjà compact n'a pas besoin
d'être relu pour être renvoyé, et le budget serré n'est pas la place, c'est le
temps de CPU.

### Un seul point d'écriture

Créer, importer et remplacer un contenu passent tous par la même fonction
(`preparerDocument`, dans `src/sauvegardes/document.ts`). C'est là que les
portraits `data:` disparaissent, que les compteurs sont recalculés et que la
taille réelle est mesurée. Une règle ajoutée là s'applique aux trois sans qu'on
ait à y penser — et c'est là que la normalisation du lot 3 se branchera.

### Pas de photos ici — décidé le 06/08/2026

L'application locale garde les portraits en `data:` dans le fichier de
sauvegarde. **La version hébergée ne les reprend pas** : c'est ce qui pesait le
plus lourd, pour le moins de valeur en ligne.

Ce que ça implique, précisément :

- Le champ `avatar` **reste dans le format** — un fichier passe de la version
  locale à la version en ligne et revient sans rien perdre d'autre.
- À l'import, une valeur `data:` est **retirée**, avec un message qui le dit.
  Une valeur `http(s)` est **conservée** : pointer l'image d'un wiki ne coûte
  rien en stockage, et le navigateur la charge tout seul.
- Les cartes affichent les initiales sur la couleur de la maison, comme
  aujourd'hui pour les fiches sans portrait.
- **R2 devient inutile** : plus de deuxième service, plus de clés à gérer. Tout
  tient dans D1.

## Faisabilité — les chiffres

Mesurés sur la vraie campagne (72 fiches, 178 liens) et sur l'application qui
tourne, pas estimés à vue de nez.

| Ce qu'on consomme | Mesure | Palier gratuit | Occupation |
| --- | --- | --- | --- |
| Poids d'une campagne | **73 Ko** compact (1 Ko/fiche) | 5 Go de base D1 | 10 personnes × 5 campagnes de 500 fiches ≈ **25 Mo**, soit 0,5 % |
| Requêtes API au chargement d'une page | **8** | 100 000/jour | 10 personnes × 10 chargements = 800/jour, soit 0,8 % |
| Lignes lues par requête | ~3 (session, métadonnées, document) | 5 000 000/jour | quelques dizaines de milliers, soit **moins de 1 %** |
| Lignes écrites par modification | **1** | 100 000/jour | une grosse séance = ~500 modifications ; 10 personnes = 5 000/jour, soit 5 % |

Autrement dit : **le palier gratuit n'est pas la contrainte**, et de loin. Ce
qui coûte, c'est le portage du code, pas l'hébergement.

Deux économies faciles à ne pas oublier :

- La version locale interroge `/api/etat-sauvegarde` **toutes les 15 secondes**
  pour son compteur de modifications en attente. En ligne, l'écriture est
  immédiate : ce sondage disparaît. Sinon il coûterait à lui seul 240 requêtes
  par heure et par onglet ouvert.
- Les fichiers statiques (13 requêtes par chargement) passent par Workers
  Static Assets et ne comptent pas comme des invocations de Worker.

> Les paliers ci-dessus sont ceux que je connais ; Cloudflare les fait bouger.
> À revérifier dans le tableau de bord au moment de créer le compte.

### Le temps de CPU, mesuré en production — 10/08/2026

Le seul palier qui pouvait mordre. Relevé par `wrangler tail` pendant le harnais
du lot 2, sur 50 requêtes réelles ; palier documenté : **10 ms par requête**.

| Route | Pire cas | Médiane |
| --- | --- | --- |
| `POST /api/auth/inscription` | **14 ms** | 6 ms |
| `POST /api/auth/connexion` | 12 ms | 11 ms |
| `PUT /api/sauvegardes/<id>/contenu` | 11 ms | 5 ms |
| `POST /api/sauvegardes/import` (campagne de 115 Ko) | 9 ms | 2 ms |
| `GET /api/sauvegardes/<id>/contenu` | 7 ms | **1 ms** |
| `GET /api/sauvegardes/<id>/export` (réindentation) | 5 ms | 5 ms |
| `GET /api/sauvegardes` (la liste) | 2 ms | 1 ms |

### Et sur un gros arbre — 10/08/2026, lot 3

Le domaine porté, mesuré sur `/api/vue/sociogramme` avec des arbres fabriqués
(`outils/gros-arbre.mjs`), en production :

| Fiches | CPU médian | CPU max |
| --- | --- | --- |
| **72** — la vraie campagne | **6 ms** | 6 ms |
| 200 | 18 ms | 30 ms |
| 500 | 27 ms | 35 ms |

Aucune requête n'a échoué sur les 91 relevées. Mais **le budget documenté est
franchi au-dessus d'une centaine de fiches**, et ce qui tient aujourd'hui tient
par la tolérance de Cloudflare, pas par contrat.

D'où un déclencheur écrit d'avance plutôt qu'une surprise : **au-delà de ~150
fiches sur un vrai arbre, on passe au premier repli — les générations calculées
côté navigateur.** C'est la seule partie super-linéaire du calcul (chaque passe
relit toutes les filiations), et le payload porte déjà tout ce qu'il faut pour
les recalculer là-bas. Le second repli, la normalisation des personnes et des
relations en lignes D1, reste en réserve.

Trois choses à retenir :

- **Ce qui coûte, c'est PBKDF2, pas le document.** Manipuler 75 Ko de JSON est
  moins cher que vérifier un mot de passe — et l'un arrive une fois par séance
  quand l'autre arrive à chaque écriture.
- **Aucune requête n'a échoué** (`outcome: ok` partout, zéro exception), y
  compris le refus d'un document de 2,4 Mo : parcourir un corps trop gros pour
  le rejeter ne fait pas sauter la requête.
- Le dépassement du palier documenté n'est donc pas fatal en pratique — mais on
  ne construit pas dessus. C'est la raison pour laquelle la lecture d'un
  document ne le reparse pas : 1 ms en médiane, c'est de la marge gardée pour
  le lot 3, qui calculera des générations et des filtres sur la même requête.

## Une instance par personne ?

« Chacun son instance » se lit de trois façons. La bonne, ici, est la deuxième.

| Montage | Ce que ça donne | Verdict |
| --- | --- | --- |
| Un déploiement par personne, sur **ton** compte Cloudflare | Les paliers gratuits sont comptés **par compte**, pas par Worker : on ne gagne rien, et il y a *n* déploiements à mettre à jour. Le plan gratuit limite en plus le nombre de bases D1. | **Non** |
| **Un déploiement, un compte par personne** | Chacun se connecte, ne voit que ses arbres, les modifie librement. Une seule base, cloisonnée par `utilisateur_id`. Une seule mise à jour pour tout le monde. | **Oui** |
| Chacun déploie sa propre copie sur **son** compte Cloudflare | Quotas séparés, indépendance totale, mais chacun doit savoir installer Wrangler. Réservé à quelqu'un qui veut vraiment son coin à lui. | Cas particulier |

« Sa propre instance » au sens de l'usage — son espace, ses arbres, personne
d'autre dedans — est donc obtenu par les comptes, pas par des déploiements
séparés.

## L'enregistrement — ce qui change vraiment

Dans la version locale, le serveur garde le monde en mémoire et écrit sur le
disque toutes les minutes. **Un Worker ne garde rien entre deux requêtes** :
ce modèle ne peut pas être transposé tel quel.

Décision : **chaque modification écrit en base**, comme le faisait déjà l'API
locale avant l'écriture différée. Le budget gratuit le permet largement
(100 000 écritures par jour, là où une séance en fait quelques centaines). Le
navigateur garde son antémémoire pour rester réactif, mais la vérité est en
base à chaque instant.

Conséquences sur l'interface :

- Le compteur « 3 modifications en attente » n'a plus d'objet. Le bouton
  `💾 Enregistrer` devient **« Tout télécharger »** — l'export local demandé.
- Un `PUT /api/sauvegardes/<id>/contenu` sert à l'import et à la restauration
  d'un instantané : un seul point d'écriture pour le document entier.
- Deux onglets ouverts sur la même sauvegarde : **un verrou optimiste**, posé
  dès le lot 2. Il ne s'appuie pas sur `modifie_le` comme prévu au départ —
  celui-ci est en secondes, et deux enregistrements dans la même seconde
  passeraient tous les deux sans que personne ne le voie. La migration `0002`
  ajoute une colonne `revision`, un compteur qui ne fait qu'augmenter : il se
  lit dans l'`ETag` de `GET .../contenu` et se renvoie dans le `PUT`. S'il a
  bougé, le serveur répond **409** avec la révision courante au lieu d'effacer
  le travail de l'autre onglet.

## L'export local

Le besoin : « récupérer un dossier », pas une ligne de commande.

- `GET /api/export/zip` construit un **.zip** contenant `sauvegardes/*.json` et
  un `LISEZMOI.txt` expliquant comment les réouvrir. Le Worker l'écrit à la
  main, en mode « stocké » (sans compression) : une soixantaine de lignes,
  aucune dépendance.
- `GET /api/sauvegardes/<id>/export` reste le téléchargement d'un seul fichier,
  identique à aujourd'hui.
- `POST /api/sauvegardes/import` accepte aussi bien un `.json` qu'un `.zip`.

Ainsi, quitter le service n'a aucun coût : on repart avec ses fichiers, et
l'application locale les ouvre sans rien changer.

## Déploiement

La marche à suivre, étape par étape, est dans
[`DEPLOIEMENT.md`](DEPLOIEMENT.md). Ici, seulement les décisions et leurs
raisons.

**Deux objets à créer chez Cloudflare, pas trois** : le Worker `familytree` et
la base D1 `familytree`. Le déclencheur cron vient avec le déploiement. Ni KV,
ni R2, ni Durable Objects, ni Queues, ni Pages — chacun est écarté pour une
raison précise, listée dans `DEPLOIEMENT.md`.

**Aucun secret.** Le `SESSION_SECRET` qui figurait ici est abandonné : les
jetons de session sont aléatoires et stockés hachés, il n'y a aucune signature
à vérifier. Un poivre de hachage aurait ajouté un point de défaillance — le
perdre rend **tous** les mots de passe invérifiables — pour une menace que le
sel par utilisateur et 210 000 itérations couvrent déjà. Conséquence
pratique : recréer le Worker de zéro ne demande rien à ressaisir.

**Le déploiement est un `git push`.** Le dépôt est branché sur la construction
Cloudflare, dont la commande de déploiement applique les migrations *puis*
déploie. D'où une règle qui tient tout : **les migrations sont additives**, on
n'édite jamais un fichier déjà appliqué en ligne. Wrangler n'est nécessaire que
pour la toute première mise en place.

**Côté utilisateur, il n'y a rien à installer** : une adresse, un navigateur, un
compte. Pas d'extension, pas d'exécutable, pas de Python. Le téléchargement du
`.zip` reste une **possibilité**, jamais un passage obligé.

> **Le téléphone — tranché le 08/08/2026.** « Rien à télécharger » finit
> toujours par vouloir dire « je l'ouvre sur mon portable ». L'interface est
> pensée pour un écran large : rail à gauche, panneau à droite, plan au milieu.
> Décision : **consulter oui, éditer non**. Une passe minimale au lot 4 (volets
> en tiroirs plein écran, barre du haut repliable), pas une refonte tactile —
> qui vaudrait un lot entier pour un usage qui, en séance, est de regarder
> l'arbre. Et on le dit à l'utilisateur au lieu de le lui laisser découvrir.

## Les risques, dits d'avance

| Risque | Ce qu'on fait |
| --- | --- |
| **Le temps de CPU par requête** (10 ms sur le plan gratuit, revérifié le 08/08/2026) — le seul palier qui peut réellement mordre | Chaque modification lit le document, le modifie, le réécrit : à 73 Ko c'est de l'ordre de 2 ms, à 500 fiches on s'approche de la limite. Quatre paliers de repli, dans cet ordre : (1) **mesurer** au lot 3 sur un arbre de 500 fiches ; (2) pour les modifications d'un seul champ, écrire avec les fonctions JSON de SQLite (`json_set`) plutôt que de relire le document — le travail se fait alors dans D1, et **l'attente d'une requête D1 ne compte pas comme du temps de CPU** ; (3) calculer les générations côté navigateur ; (4) **normaliser** personnes et relations en vraies lignes D1. Ne pas normaliser d'emblée : c'est plus de code pour un problème qu'on n'a peut-être pas. |
| **Latence de la base** | D1 vit dans une seule région. Créer la base avec une localisation **européenne** (`--location weur`), sinon chaque requête traverse l'Atlantique : 150 ms au lieu de 20. |
| **Perte de la base** | D1 sait revenir en arrière (Time Travel, 30 jours), mais on ne s'y fie pas : l'export `.zip` reste la vraie sauvegarde, et les fichiers restent du JSON ordinaire qu'on relit sans l'application. |
| **Deux onglets sur la même sauvegarde** | Dernière écriture gagne, jusqu'au verrou optimiste du lot 6. |
| **Le portage Python → TypeScript diverge de la version locale** | Les deux resteront synchronisées tant que le contrat d'API est identique ; toute évolution du domaine se fait des deux côtés, ou nulle part. |
