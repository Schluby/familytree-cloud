# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Les sept lots du plan sont livrés, puis les lots 8 à 22** — des tranches qui
n'étaient pas au plan d'origine, demandées entre le 10 et le 20/08/2026.

**L'application n'est plus à la racine du domaine** (lot 18, 16/08). Elle est
montée sous `/sociogram/got`, parce que `myschlub.com` porte désormais deux
sociogrammes : celui-ci, et la fourche « vraie vie » sous `/sociogram/irl`
(dépôt `Sociogram_IRL`, autre Worker, autre base). La racine sert une page de
choix entre les deux. Le préfixe est écrit à **trois endroits qui doivent
s'accorder** — `src/base.ts`, `assets.run_worker_first` dans `wrangler.jsonc`,
et l'arborescence de `public/` ; `npm run verif` les contrôle. En ligne sur
https://familytree.schlub-perso.workers.dev/sociogram/got et sur
https://myschlub.com/sociogram/got (**le même Worker**, pas un second
déploiement).

Le lot 20 (17/08) porte sur **ce qu'on voit du plan en jouant** : la carte
n'affiche plus qu'un nom en grand, sa maison et son lieu ; un profil peut porter
un contour de couleur ; on pose des rectangles, des cercles et des zones de
texte derrière les fiches ; et une maison compte ses unités de guerre. Voir
« Le plan repensé (lot 20) » plus bas — surtout les deux pièges, qui se
reproduiront à l'identique dans l'IRL.

Le lot 21 (18/08) range le rail en **deux onglets** (Plan / ⚙ Réglages) avec
trois blocs repliables, répare deux défauts du tracé des liens — **la flèche de
filiation ne s'affichait pas, et les fratries explicites entre deux enfants d'un
même parent non plus** —, lève l'interdiction de supprimer les quatre types
structurants, et porte la carte du plan à quatre cases (maison, rôle, région,
ville). Voir « Le rail et les liens (lot 21) » plus bas : la leçon transposable
est que *placer* et *dessiner* ne doivent pas partager une liste.

Le lot 22 (20/08) est le plus lourd des quatre derniers, parce qu'il change une
**nature** : la position d'une fiche n'est plus un écart à une mise en page
recalculée sans arrêt, c'est une coordonnée absolue que rien ne touche sauf une
main. Le plan se fige à la première ouverture, un profil naît là où l'on clique,
et on peut en prendre plusieurs au cadre. Le lot répare aussi les formes du
lot 20.D, **injouables depuis leur livraison** faute d'une classe CSS, leur
donne une portée (plan général / profils choisis), retire l'axe « Catégorie de
maison » et la fenêtre de l'année, et monte la typographie d'un cran. Voir
« Le plan qui obéit (lot 22) » plus bas.

Le lot 17 ouvre une **seconde page d'administration**, `/collectif.html` : les
mondes des membres superposés en un seul sociogramme, où l'on pilote par clic
droit au lieu de remplir des tableaux. Il apporte la migration `0010`
(`identites`) et une notion nouvelle, la **grappe**. Voir « Le plan collectif
(lot 17) » plus bas — surtout la partie sur ce que le rapprochement refuse de
deviner.

Le lot 15 ajoute le **carnet** : des notes en Markdown, rangées en chapitres,
qui citent les fiches du monde et savent dire à chaque fiche où l'on parle
d'elle. Il n'apporte **aucune migration** — tout vit dans le document de la
sauvegarde. Voir « Le carnet (lot 15) » plus bas pour les pièges.

Le lot 16 fait deux choses de fond : une note du carnet **s'offre à un autre
compte** (migration `0009`, la première depuis le lot 14), et l'interface
existe **en anglais**. Voir « Offrir une note (lot 16) » et « Les deux langues
(lot 16) » plus bas — la seconde explique pourquoi la traduction est posée
devant le DOM et non dans le code.

Le lot 9 change quelque chose de plus profond que les précédents : **le service
n'exige plus de compte pour être essayé.** Un visiteur arrive dans un monde déjà
peuplé, modifie ce qu'il veut, et ne s'inscrit que s'il souhaite le retrouver.
Trois conséquences à garder en tête :

- **Il existe des comptes sans adresse** (rôle `invite`). Tout le reste du
  serveur les traite comme des membres — c'est voulu : un second chemin de
  lecture et d'écriture aurait ses propres trous.
- **Un compte neuf n'est plus vide.** Il reçoit « Westeros ». Plusieurs
  vérifications du harnais qui disaient « zéro sauvegarde » ont été **réécrites,
  pas supprimées** : elles affirment maintenant le comportement voulu.
- **Le document de campagne n'est plus une constante du client.** Il vit dans
  `meta.document`, sauvegarde par sauvegarde.

Le lot 9, en une phrase par morceau :

- **9.A — pastilles.** Un lien porte un emoji libre (`💰` une dette, `⚔️` une
  rancune). Il se pose aux deux bouts du trait, et une troisième fois au milieu
  quand les fiches sont assez écartées.
- **9.B — la sauvegarde de départ.** « Westeros » : 67 fiches, 180 liens,
  19 maisons remplies, 40 pastilles, 15 liens révolus. Produite par
  `outils/construire-depart.mjs`, versionnée dans `src/depart/westeros.json`.
- **9.C — l'essai sans compte.** `POST /api/auth/invite` ouvre une session de
  rôle `invite`. S'inscrire ensuite **reprend le même compte** : même
  identifiant, mêmes sauvegardes, mêmes modifications.
- **9.D — l'inscription réduite.** Adresse et mot de passe, rien d'autre. Plus
  de nom d'affichage, plus de code de secours imposé — il se demande depuis
  « Vos données », quand on sait à quoi il sert.
- **9.E — connexion Google.** **Évaluée, pas faite** : bloquée sur un projet
  Google Cloud et des identifiants à créer. Voir « Et après ? ».

Le lot 10.A, ajouté le 12/08/2026, **fait passer la procuration à l'échelle** :
l'administrateur agit désormais sur une **sélection de comptes**, pas sur un
arbre à la fois. Quatre choses à retenir :

- **Deux adresses, une seule qui écrit.** `POST /api/admin/lots/apercu` ne sait
  pas écrire ; `POST /api/admin/lots/appliquer` est la seule de la famille qui
  touche aux données. Ce n'est **pas** un drapeau `simulation` qu'on pourrait
  oublier — c'est le chemin qui décide, comme pour `lectureSeule`.
- **Un lot est idempotent.** L'identifiant est calculé une fois pour tout le lot,
  à partir du nom : une clé déjà présente est mise à jour, pas dupliquée. On peut
  rejouer un lot sans fabriquer de `tully-2`.
- **Un refus n'arrête rien.** Chaque sauvegarde est traitée pour elle-même ; le
  rapport dit ligne par ligne qui est passé. Le plafond appliqué est **celui du
  propriétaire**, jamais celui de l'administrateur.
- **Une ligne de journal par sauvegarde écrite.** Un lot de trente arbres laisse
  trente traces, pas une.

Le lot 11.A, ajouté le 13/08/2026, **coupe l'administration en deux étages**.
Il n'y avait qu'un rôle au-dessus de `membre`, et il pouvait tout, sur tout le
monde ; il y en a deux :

- **`admin`, le souverain.** Périmètre `null` — tous les comptes. Lui seul nomme
  les intendants, leur confie des comptes, touche aux plafonds, aux mots de
  passe et à la suppression. Le rôle **continue de se donner en SQL** : aucune
  route ne l'accorde, et la route des rôles refuse même de toucher à celui d'un
  administrateur.
- **`intendant`, l'administrateur délégué.** Périmètre = les comptes qu'on lui a
  confiés (table `tutelles`), **plus le sien**. Il consulte, exporte, édite par
  procuration et applique des lots — sur eux seuls.

Trois choses à ne pas perdre de vue :

- **Le périmètre est posé sur le contexte, il ne s'applique pas tout seul.**
  Toute route neuve sous `/api/admin/*` qui reçoit un identifiant de compte doit
  appeler `dansLePerimetre`. Sans ça, elle est ouverte à tout intendant sur tout
  compte.
- **Hors périmètre, c'est 404, jamais 403** — la même règle que le cloisonnement
  des membres. La procuration répond le **même mot** qu'un arbre inexistant.
- **Une sélection de lot déborde en silence** : les comptes hors périmètre sont
  retranchés sans le dire. Le rapport nomme ensuite chaque sauvegarde touchée,
  donc rien ne se perd — mais un lot posé sur dix comptes peut n'en toucher que
  trois, et c'est normal.

Le lot 11.C, du même jour, **rend l'arbre utilisable au téléphone**. Le rail
n'était pas absent : la barre du haut réclamait 512 px de commandes dans 375 px
d'écran, et le ☰ qui l'ouvre se retrouvait 75 px hors de l'écran. Depuis, la
barre ne garde que de quoi naviguer et le reste **descend dans le rail** —
`public/js/telephone.js` déplace les nœuds, il ne les duplique pas. Deux choses
à savoir avant d'y toucher :

- **Ajouter un bouton à la barre du haut oblige à décider où il va sur
  téléphone.** Soit il entre dans `A_DESCENDRE` (`telephone.js`), soit il prend
  un `display: none` dans le bloc `@media (max-width: 760px)` — sinon il repousse
  ☰ et 👤 hors de l'écran, et le défaut recommence.
- **Toute cible tactile fait au moins 36 px de haut sous 760 px.** Les valeurs
  de départ (26 px pour « ＋ Nouvelle maison », 24 px pour une entrée de
  légende) étaient dessinées pour une souris.

Le lot 11.D, du même jour, reprend le téléphone une seconde fois — et corrige
le défaut que le 11.C n'avait pas vu :

- **Un volet qui s'ouvre doit être amené à l'écran.** `surOuverture` ne faisait
  que basculer l'onglet *dans* le volet ; sur téléphone la fiche se dessinait
  hors champ. `amenerLaFiche()` (`telephone.js`) répare, et **toute nouvelle
  ouverture de volet doit l'appeler** — sinon le défaut revient à l'identique.
- **Tout ce qui se saisit prend `font-size: 16px` sous 760 px.** En dessous, iOS
  zoome sur le champ au premier appui et laisse la page décadrée.
- **« Tout télécharger » et « Instantané » sont éteints au téléphone**, pas
  déplacés : ils ne sont pas dans `A_DESCENDRE`. 🛡 « Vos données » reste.
- **La colonne d'actions des tableaux d'administration est collée au bord
  droit** (`position: sticky`) : elle tombait hors de l'écran, et emportait avec
  elle « Arbres » et « Nommer intendant ». Au téléphone elle redevient
  ordinaire — elle fait 386 px, elle y recouvrirait tout.

Le lot 12, du 14/08/2026, reprend le téléphone une troisième fois. Ce qu'il
laisse derrière lui :

- **Un tiroir qu'on ouvre sur un bloc précis vise deux fois : tout de suite, et
  à l'image suivante.** Le second passage existe parce que les positions ne
  valent rien tant que le tiroir glisse ; le premier, parce que
  `requestAnimationFrame` **ne se déclenche pas dans un document caché** — le
  bloc visé restait alors à 3309 px du haut. `ouvrirLeRailSur` fait les deux, et
  toute ouverture nouvelle doit passer par elle.
- **Un pictogramme par sens, et deux qui se touchent doivent se distinguer sans
  infobulle** : 👥 pour la liste des personnes, 👤 pour le compte. Au doigt il
  n'y a pas de survol.
- **`.donnees.serree.cartes` n'est pas décoratif** : sous 760 px, la table cesse
  d'être une grille et chaque cellule affiche son intitulé, recopié par
  `etiqueter()`. **Un nouveau tableau d'action doit porter la classe et appeler
  `etiqueter()` après son dessin**, sinon ses cartes s'affichent sans étiquettes
  — des valeurs nues, sans rien pour dire ce qu'elles sont. Les tableaux de
  relevé (panorama, résultat de lot, arbre à plat) ne la portent pas, exprès :
  on les compare ligne à ligne, et leur défilement latéral est correct.
- **À 375 px, rien de ce qui se touche ne descend sous 40 px sur la page
  d'administration.** Les cases à cocher font 22 px, mais dans une bande de 40
  qui les commande — le clic est transmis depuis la cellule, avec un garde sur
  `target` pour ne pas défaire ce que la case vient de faire.

Le lot 13, du même jour, retire l'en-tête du tiroir et le ☰. Quatre choses à ne
pas défaire :

- **`[hidden] { display: none !important; }` reste, dans `app.css` comme dans
  `base.css`.** Le `display: none` d'un élément `hidden` est une règle d'agent
  utilisateur : **la moindre règle d'auteur qui donne un `display` la bat**.
  Cinq éléments l'ont payé, dont `#bandeau-procuration`, qui annonçait « vous
  écrivez chez les autres » à quelqu'un qui écrivait chez lui. Ne jamais retirer
  cette règle en la croyant redondante, et ne jamais cacher par une classe ce
  que `hidden` dit déjà.
- **Le tiroir de gauche n'a plus de croix : ses deux boutons sont des
  bascules.** ⛨ et 👤 referment ce qu'ils ouvrent, en comparant `dataset.sur`.
  **Toute nouvelle façon d'ouvrir ce tiroir doit passer par `ouvrirLeRailSur`**,
  sinon elle ouvre quelque chose qui ne se referme plus.
- **`.barre-basse` est à `z-index: 40`, au-dessus des tiroirs, exprès.** C'est
  ce qui garde « ⛨ Filtres » sous le doigt tiroir ouvert — donc ce qui fait de
  lui une sortie. La réserve de 72 px en bas du tiroir va avec : sans elle, son
  dernier bloc se termine sous la barre.
- **Ce qui décrit un nœud déménageable se pose sur le nœud, pas sur son
  parent.** `.groupe-compte .lib { display: none }` cessait de s'appliquer dès
  que `telephone.js` descendait le bouton dans le tiroir. La règle porte
  maintenant sur `#lien-admin`, `#lien-donnees`, `#btn-deconnexion`.

Et un défaut de rôle à ne pas refabriquer : **`#lien-admin` (⚙) doit apparaître
à `admin` *et* à `intendant`** — miroir de `exigerGestion`. La condition était
restée sur `admin` seul depuis le lot 7, quand ce rôle était le seul au-dessus
de `membre` : un intendant, à qui `/admin` répond pourtant 200, n'avait aucune
porte pour y aller. Toute condition d'affichage écrite sur un rôle doit être
relue quand un rôle est ajouté.

Le lot 11.B, du même jour, répond à la question « le lien de campagne, est-ce
que ça crée une vue partagée ? » — **non** : `meta.document` est une adresse
http(s) vers un document hébergé ailleurs, rien d'autre. Le partage, lui, ouvre
**une sauvegarde vivante à plusieurs lecteurs**, sur sa propre surface
`/api/partages/*`. Trois choses à ne pas défaire :

- **Il n'y a pas de partage en écriture, et il ne faut pas en ajouter un.** La
  table n'a pas de colonne « droit ». Deux personnes qui écrivent dans le même
  document sans arbitre, c'est le verrou de révision qui en rejette une au
  hasard. La procuration (8.F) reste la seule écriture chez autrui.
- **L'ordre des deux intergiciels du chemin de lecture est un invariant** :
  `verbeDeLecture` **puis** `parPartage`. Le verbe est refusé avant que le
  compte du propriétaire ne soit posé sur le contexte ; inverser les deux ferait
  d'un défaut d'ordre une écriture au nom de quelqu'un d'autre.
- **Les routes de membres restent aveugles.** `GET /api/sauvegardes/<arbre
  partagé>` répond **404** même à celui à qui on l'a ouvert, et il ne peut pas
  l'activer. Ne jamais « corriger » cela : c'est ce qui empêche le partage
  d'ouvrir une brèche dans le cloisonnement.

Le panorama (`POST /api/admin/lots/panorama`) répond à la question qui précède
tout lot de groupe : **qu'est-ce que ces comptes ont en commun ?** Ce qui est
partagé par tous supporte un lot ; ce qui n'est qu'à certains serait écrasé sans
le dire.

Le lot 10.B, du même jour, **sort le code de secours du chemin normal** :

- `POST /api/auth/mot-de-passe` envoie un lien à l'adresse d'un compte **déjà
  connecté**. Ni l'ancien mot de passe, ni le code de secours : la preuve de
  possession est faite deux fois, par la session puis par la boîte.
- L'émission du jeton est factorisée dans `emettreLien()`, partagée avec
  `/mot-de-passe-oublie`. Même jeton, même heure, même usage unique, même règle
  d'invalidation du précédent.
- **Sans clé d'envoi, cette porte refuse — et c'est la seule du service qui le
  fasse.** Ailleurs on bascule sur le code de secours ; pour quelqu'un de déjà
  connecté il n'y a pas de second chemin honnête. Le 409 porte un `indice` que
  la page affiche. **En production c'est le comportement actuel**, la clé Resend
  n'étant pas posée.
- Le formulaire de code de secours n'est pas supprimé : il recule derrière « Je
  n'ai plus accès à ma boîte de courriel », et **redevient visible d'emblée**
  quand l'envoi n'est pas configuré.

Le lot 10.C **fait la connexion Google**, que le 9.E avait seulement évaluée :

- **Flux « Authorization Code » côté serveur, pas le script de Google.** La CSP
  est `script-src 'self'` ; charger le SDK de Google obligerait à l'élargir pour
  tout le site. Le bouton est un `<a href>` vers `/api/auth/google/depart`.
- **La signature de l'`id_token` n'est pas revérifiée**, et c'est motivé : il
  arrive par une connexion TLS que le Worker ouvre lui-même vers Google, avec le
  secret client. OpenID Connect Core § 3.1.3.7 l'autorise explicitement. **Cela
  ne tient que parce qu'aucune route n'accepte un `id_token` en entrée** — ne
  jamais en ajouter une sans remettre la vérification JWKS.
- **Rattachement par `sub` d'abord, par adresse ensuite.** Une adresse se
  réattribue, un `sub` jamais.
- **Un compte Google n'a pas de mot de passe** : il porte le même marqueur non
  analysable qu'un invité.
- **Migration `0005_google.sql`** : une colonne `google_sub`, plus un index
  unique partiel (SQLite n'accepte pas `ADD COLUMN … UNIQUE`).
- **Sans identifiants, les deux routes répondent 404** et le bouton n'apparaît
  pas. C'est l'état de la production.

Le lot 8, en une phrase par morceau :

- **8.A — tactile.** L'appui long remplace le clic droit, partout (fiche, lien,
  fond, listes du rail). Un lien armé se termine d'un clic simple. « ＋ Profil »
  en bas, « Thème » remonté en haut.
- **8.B — âges.** `meta.annee_courante` porte l'année de la campagne ; les âges
  s'en déduisent et ne sont **stockés nulle part**. Avancer la date vieillit
  tout le monde d'un coup.
- **8.C — rangs.** « Chef de maison » et « héritier » sont des **tags** que
  l'application sait lire, avec cadre appuyé sur le plan.
- **8.D — le passé.** Un lien peut être `revolu` ; nouveaux champs facultatifs
  (depuis, jusqu'à, lieu) ; catégorie « Événements passés ».
- **8.E — les maisons.** Une vue à part, en écran partagé : histoire à gauche,
  caractéristiques / notes / liens de maison à maison à droite.
- **8.F — écriture par procuration.** Un administrateur édite l'arbre d'un
  autre. **C'est un revirement assumé du lot 7**, pas un oubli.
- **8.G — mot de passe oublié.** Jeton par courriel, à usage unique, une heure.
  Sans clé d'envoi, l'option ne s'affiche pas et le code de secours reste.

### Ce qu'il faut poser en ligne avant que le lot 11 ne serve

**Deux migrations à appliquer** — `npm run deploy` les passe seul, mais il faut
qu'il tourne : `0006_tutelles.sql` (les intendants) et `0007_partages.sql` (les
arbres partagés). Sans elles, les routes de ces deux lots échouent sur une
table absente.

### Ce qui vous revient

**Le rôle d'administrateur est posé.** `maxschlub@gmail.com` est admin depuis le
11/08/2026. Pour en promouvoir un autre, c'est toujours du SQL — volontairement,
voir `DEPLOIEMENT.md`, « Se donner le rôle d'administrateur » :

```bash
npx wrangler d1 execute familytree --remote --command "UPDATE utilisateurs SET role='admin' WHERE email_norm='VOTRE-ADRESSE'"
```

**L'envoi de courriel n'est pas branché.** Le lot 8.G marche de bout en bout
*sauf* l'envoi lui-même, qui demande un compte chez un service tiers et une
clé — c'est à vous : `DEPLOIEMENT.md`, « Brancher l'envoi de courriel ». Sans
clé, l'application ne promet rien et propose le code de secours.

**C'est devenu plus important qu'au lot 8.** L'inscription ne montre plus de
code de secours d'office : quelqu'un qui n'en demande pas un depuis « Vos
données » et qui oublie son mot de passe n'a plus que vous pour le récupérer.
Et depuis le lot 10.B, « Changer votre mot de passe » **refuse** franchement
tant qu'il n'y a pas de clé.

**La connexion Google attend deux identifiants.** Le code du lot 10.C est écrit
et vérifié partout où il peut l'être sans compte Google ; il reste inerte —
routes en 404, bouton masqué — jusqu'à ce que vous créiez un projet Google Cloud
et posiez `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. La marche à suivre est
dans `DEPLOIEMENT.md`, « Brancher la connexion Google ». Bonne nouvelle : les
portées demandées (`openid`, `email`) sont « non sensibles » et **ne demandent
aucune vérification** de la part de Google.

### Ce qui attend le calendrier

**Relever la consommation d'une semaine** dans le tableau de bord Cloudflare —
requêtes du Worker, lectures et écritures D1 — et la noter dans `PLAN.md`
(lot 6, dernière case). Relevé de départ posé le **10/08/2026** : 2 comptes,
1 sauvegarde. **À faire le 17/08/2026.**

⚠ **Le lot 9 rend ce relevé beaucoup plus intéressant, et le point de départ
caduc.** Chaque visiteur qui ouvre la page consomme désormais une ligne et
~90 Ko, sans rien taper. Les garde-fous sont posés (8 essais par heure et par
adresse IP, ménage des invités inactifs depuis 14 jours), mais ils n'ont jamais
tourné en vrai. **C'est le chiffre à regarder en premier le 17/08.**

## Et après ?

Ce qui reste « à trancher » et n'a jamais été programmé :

- **Le partage entre membres** (un arbre en lecture seule pour quelqu'un
  d'autre) — il faudrait une table `partages`. À noter : le lot 8.F a posé le
  mécanisme qui le rendrait facile (voir la procuration).
- **La vérification d'adresse à l'inscription** — possible maintenant que
  `src/auth/courriel.ts` existe, mais pas faite : personne ne l'a demandée.
  Elle prendrait un sens nouveau depuis le lot 9, l'inscription étant devenue
  la seule chose qui distingue un compte d'un passant.
- **La table `instantanes`**, créée au lot 0 et **volontairement laissée vide**
  depuis le lot 4 : `📸` crée une sauvegarde de plus. Elle peut être retirée par
  une migration le jour où ça gêne.

## Effets de bord à ne pas déclencher

**Côté serveur :**

- Toute écriture de document passe par `ecrireDocument` (`src/sauvegardes/depot.ts`).
  **Ne jamais ouvrir un second chemin d'écriture.**
- Ajouter une route de domaine oblige à ajouter son chemin au tableau `SURFACE`
  de `src/domaine/routes.ts`, sinon elle est **servie sans session**. C'est ce
  tableau qui a fait que `/export/*` et `/meta` sont protégés.
- `Dataset` garde un index en cache : appeler `oublierIndex()` après toute
  mutation de `personnes`.
- **Ne jamais modifier une migration déjà appliquée** ; en ajouter une. La
  dernière est `0007_partages.sql`.
- **Toute route neuve sous `/api/admin/*` qui reçoit un identifiant de compte
  doit passer par `dansLePerimetre`** (`src/admin/intergiciel.ts`). Sans ce
  passage, elle est ouverte à tout intendant sur tout compte : le périmètre est
  posé sur le contexte, il ne s'applique pas de lui-même. Et le refus est un
  **404**, jamais un 403 — la même règle que le cloisonnement des membres.
- **Un geste qui touche au compte lui-même** — plafond, mot de passe,
  suppression, rôle, tutelle — **prend `exigerSouverain` en plus.** La garde est
  écrite sur chaque route parce que ces adresses sont mêlées à celles que
  l'intendant peut prendre ; un préfixe commun n'existerait qu'au prix d'un
  renommage qui séparerait mal.
- **Un `INSERT` mal compté ne se voit pas au typage.** L'insertion du compte
  Google est partie avec sept marqueurs et six valeurs liées ; `tsc` compile
  sans rien dire, et D1 n'aurait refusé qu'à la première connexion réelle.
  Recompter marqueurs et `bind` fait partie de la relecture d'un SQL neuf.
- `src/domaine/zip.ts` sert **deux** consommateurs (le classeur Excel et
  l'archive du compte) : le casser casse les deux.
- **Les champs ajoutés au lot 8 ne s'écrivent que s'ils portent quelque chose**
  (`revolu`, `lieu` sur un lien ; `caracteristiques`, `notes`, `evenements`,
  `liens` sur une maison). Ce n'est pas de la coquetterie : un document qui ne
  s'en sert pas doit ressortir **octet pour octet** comme il est entré, sinon
  il grossit à chaque aller-retour avec la version locale.
- **`/api/admin/arbres/:arbre` monte le domaine entier** derrière
  `parProcuration`. Le paramètre s'appelle `:arbre` et **pas** `:id` : deux
  paramètres du même nom dans une adresse imbriquée se recouvrent, et
  `PATCH …/maisons/stark` allait chercher une maison nommée d'après
  l'identifiant de la sauvegarde.
- `exigerSession` laisse passer un compte **déjà posé sur le contexte**. C'est
  ce qui fait marcher la procuration. Ce n'est pas une exception de rôle — ce
  module ignore toujours ce qu'est un administrateur — mais toucher à cette
  ligne casse l'édition par procuration ou ouvre une porte, selon le sens.
- **Il y a deux points de création de document, et deux seulement** :
  `creerDocument` (une sauvegarde neuve) et `ecrireDocument` (on remplace le
  contenu d'une existante). Ils vivent l'un sous l'autre dans
  `src/sauvegardes/depot.ts`. `creerSauvegarde` des routes et `semerDepart` du
  lot 9 passent tous deux par le premier.
- **Un invité est un compte comme un autre**, sauf sur trois points : son
  `email_norm` vaut `invite:<uuid>` (jamais saisissable — `emailValide` exige
  une arobase et un point), son `mot_de_passe` n'a pas la forme
  `v1$sel$empreinte` donc aucune clé ne l'ouvre, et le ménage nocturne l'efface
  après 14 jours sans visite. **Ne jamais faire de `role = 'invite'` une
  condition dans le domaine** : c'est ce qui garde une seule surface à tester.
- **`semerDepart` ne vérifie aucun plafond**, exprès : c'est nous qui offrons la
  sauvegarde, pas l'utilisateur qui l'importe. Un compte au plafond plus petit
  que le cadeau serait bloqué avant d'avoir rien fait.
- **`meta.document` finit dans un `href`.** La validation n'accepte que `http:`
  et `https:` — sans ce filtre, un `javascript:` rangé dans une sauvegarde
  s'exécuterait au clic, y compris chez l'administrateur qui ouvre l'arbre par
  procuration. Depuis le lot 10.A elle vit dans **`src/domaine/meta.ts`**, parce
  qu'elle sert des deux côtés : le `PATCH /meta` d'un propriétaire et les lots
  d'administration. **Ne pas la recopier** dans un troisième appelant : une
  validation dupliquée est une validation qui divergera.
- **Un lot est une suite d'écritures ordinaires, pas un raccourci.** Chaque
  sauvegarde touchée passe par `ecrireDocument`, avec le plafond de **son**
  propriétaire, et laisse sa propre ligne de journal. Ne jamais céder à la
  tentation d'un `UPDATE` en masse : il court-circuiterait les compteurs, le
  retrait des portraits `data:` et le plafond d'un coup.
- **L'identifiant d'un lot se calcule une fois, avant la boucle**
  (`identifiantDuLot`). Le réflexe naturel — appeler `idsLibres()` par
  sauvegarde, comme le font les routes du domaine — fabriquerait `tully` chez
  les uns et `tully-2` chez les autres, et rendrait le lot non rejouable.
- **`rapprochement` (12.C) rapproche par le nom, et un nom n'identifie
  personne.** Sur le monde livré, « Brandon Stark » désigne deux personnages :
  `brandon-stark-aine`, le frère d'Eddard, et `bran-stark`, son fils. Aucune
  normalisation ne les distinguera. Toute formulation qui conclut — « doublons »,
  « à fusionner », un bouton qui agirait sans aperçu — ment sur un cas du
  produit. **On signale, l'humain tranche.** Et surtout : ne jamais élargir la
  clé à de l'approximatif (préfixes, distance d'édition). Un rapprochement trop
  large réunit deux personnages différents, et ce qu'on gagne se paie d'une
  fiche écrasée dans l'arbre de quelqu'un.
- **Le rapprochement voyage dans la réponse du panorama**, il n'a pas de route à
  lui. C'est voulu : les sauvegardes sont déjà lues et analysées, une seconde
  route les relirait toutes. Une route neuve ici serait aussi une garde de
  périmètre de plus à ne pas oublier.

**Ce que l'administration ne doit jamais devenir :**

- **Elle ne déborde pas sur les routes de membres.** Toujours pas de « ou si je
  suis admin » dans `src/intergiciels.ts` ni dans `src/domaine/routes.ts` :
  passer par l'API des membres pour désigner l'arbre d'un autre répond **404**,
  admin compris. Le harnais le vérifie.
- **Deux chemins, deux pouvoirs.** `/api/admin/sauvegardes/*` est en lecture
  seule (garde `lectureSeule` posée **sur le chemin**, donc vraie pour les
  routes qui n'existent pas encore) ; `/api/admin/arbres/*` écrit. Ne pas les
  fusionner : un seul chemin dont le sens dépendrait du verbe est exactement ce
  qu'on a évité.
- **`journal_admin` ne s'efface pas.** Aucune route ne le supprime, et il ne
  faut pas en ajouter une. L'action `edition` est inscrite **après** coup et
  seulement si l'écriture a réussi — une tentative refusée n'a rien changé.
- **Trois chemins pour les lots, un seul qui écrit** : `/lots/panorama` et
  `/lots/apercu` lisent, `/lots/appliquer` écrit. Ne jamais les réunir derrière
  un booléen de corps de requête : c'est précisément le genre de drapeau qu'on
  oublie, et l'oublier écrit chez des dizaines de personnes.
- **L'aperçu emprunte exactement le même code que l'application**
  (`appliquerLot(..., simulation)`), auquel on retire l'écriture et le journal.
  Un aperçu qui prendrait un raccourci ne prédirait pas ce que fait l'autre
  bouton, et ne vaudrait donc rien comme garde-fou.
- **`/api/admin/catalogues` existe pour ne pas dépendre d'une sauvegarde
  active.** `GET /api/referentiels` dit la même chose mais répond 409 à un
  administrateur qui n'a pas de monde à lui — ses formulaires de lot
  disparaîtraient. Le harnais vérifie ce cas.

**Côté interface :**

- **`public/js/api.js` est la couture de la fourche.** `public/js/` est la copie
  de `../FamilyTree_GOT/web/js/` ; tout ce que la version en ligne fait
  autrement y est absorbé. C'est aussi là que vit le préfixe `DOMAINE` de la
  procuration : **le domaine seul est préfixé**, jamais le compte, la session
  ni les sauvegardes.
- **La page de connexion ne renvoie automatiquement que sur `?retour=`.**
  Signalé le 12/08 : déjà connecté, elle se refermait aussitôt, sans un mot, et
  **changer de compte devenait impossible** — il fallait deviner le bouton de
  déconnexion sur la page précédente. Le renvoi ne vaut plus que quand c'est
  l'application qui envoie ici après un 401 (elle pose `?retour=`) ; une
  navigation délibérée propose désormais « continuer » ou « changer de compte ».
- **C'est `api.js` qui ouvre un essai, sur un 401.** Trois pages en sont
  exclues (`/connexion`, `/donnees`, `/admin`) parce que « vous n'êtes pas
  connecté » y est la bonne réponse, et la procuration aussi. Le marqueur
  `familytree-compte-connu` dans le `localStorage` évite le pire des cas : la
  session expirée d'un membre qui le ferait retomber dans un essai vierge — il
  croirait avoir tout perdu. Un seul essai est ouvert à la fois (`essaiEnCours`),
  sinon les dix requêtes du chargement créeraient dix comptes.
- **`Api.surEcriture` est appelé après toute écriture réussie**, depuis l'unique
  fonction `requete()`. C'est ce qui permet à `main.js` de savoir qu'un visiteur
  a maintenant quelque chose à perdre, sans câbler un crochet sur chaque geste.
- **Les pastilles sont dessinées entre les traits et les prises de clic**, et
  portent `pointer-events: none`. Autrement elles perceraient un trou dans la
  zone de survol du lien qu'elles décorent.
- **Le dézippage est côté navigateur** (`public/js/zip.js`), volontairement :
  un Worker n'a pas le temps de calcul pour ouvrir une archive de dix
  sauvegardes.
- **Les en-têtes de sécurité vivent à deux endroits**, et c'est voulu :
  [`public/_headers`](public/_headers) pour les fichiers statiques (qui ne
  passent pas par le Worker) et `src/index.ts` pour les réponses d'API.
  **Modifier l'un sans l'autre laisse une moitié du site sans protection.** Et
  dans le Worker, il faut **recopier** la réponse : celles qui viennent d'un
  `fetch` ont des en-têtes immuables.
- La politique de contenu interdit les scripts en ligne. Un `<script>` écrit
  dans une page HTML **ne s'exécutera pas** : passer par `public/js/`.
- **`surMenuContextuel` (js/dom.js) est le seul chemin vers un menu.** Il câble
  le clic droit *et* l'appui long. Ne pas remettre de `addEventListener
  ('contextmenu')` en direct : le geste tactile serait perdu.
- **`etoufferSalveSouris` utilise `stopImmediatePropagation`**, pas
  `stopPropagation`. La fermeture au clic extérieur des panneaux flottants
  écoute **le même nœud** (`document`, en capture) ; avec l'autre, le menu se
  refermait dans la milliseconde où le doigt se levait.
- **Le plan est en `touch-action: none`.** C'est ce qui fait que le doigt
  déplace la vue — et ce qui supprime le menu long-press du navigateur, d'où
  `surMenuContextuel`.
- `📸` ne crée pas d'instantané mais **une sauvegarde de plus** (copie datée).
- Pas de photos : la pastille de la fiche ne prend qu'une **adresse** `https://…`.
- Un compte neuf n'a **aucune** sauvegarde et le domaine répond **409** tant
  qu'il n'y en a pas : `demarrer()` dans `public/js/main.js` traite ce cas à
  part. Ne pas le supprimer en refactorant.

## Pièges de vérification, déjà payés

- Une route ou un fichier neuf répond 404 sur les points de présence encore à
  l'ancienne version : **attendre une minute après un push** avant de lancer le
  harnais.
- Lancer `essai.sh` (ou `mesurer.mjs`, ou `comparer.mjs`) plus de trois fois
  dans l'heure depuis la même adresse déclenche la limite d'inscriptions. Purge :
  `wrangler d1 execute familytree --local --command "DELETE FROM tentatives"`
  (ou `--remote`).
- `outils/essai.sh` s'**étend**, ne se réécrit pas. **464 vérifications en
  local** (13/08/2026) ; le total en ligne est plus bas de quelques unités. Deux sections
  branchent sur la configuration de l'instance (courriel, Google) et vérifient
  le comportement attendu de chaque côté : l'écart entre les deux nombres est
  normal. Un écart *ailleurs* ne l'est pas.
- **Ne pas modifier `essai.sh` pendant qu'il tourne.** Bash relit le fichier au
  fil de l'exécution, depuis la position où il en est : une insertion décale
  tout et il reprend au milieu d'un mot. Le symptôme — « syntax error near
  unexpected token » sur une ligne parfaitement valable — se lit comme un bogue
  qu'on vient d'écrire. `bash -n` sur le fichier au repos le dément.
- **En local, `essai.sh` peut faire tomber `wrangler dev`.** Son aide `sql()`
  lance `wrangler d1 execute --local` pendant que `wrangler dev` tient le même
  fichier SQLite ; la contention est intermittente et tue le serveur en pleine
  course. Le symptôme ne trompe pas : des codes **`000`** en cascade à partir
  d'un point, puis un `ENOENT … corps.json` (curl n'a rien reçu, donc rien
  écrit). Ce n'est pas une régression du code — relancer le serveur et
  reprendre.
- **Une vérification de page doit viser l'adresse que le site sert vraiment.**
  `GET /admin.html` répond **307** (Cloudflare enlève l'extension) : le corps
  est vide, et deux vérifications écrites contre lui sont passées sans rien
  lire. C'est `/admin`, `/connexion`, `/donnees`. Une vérification à vide est
  pire qu'une vérification en échec.
- **Ne pas affirmer d'un journal filtré qu'il « ne contient pas » un
  identifiant.** L'identifiant d'un administrateur y figure aussi comme
  **auteur** d'une ligne, et voir « le souverain a ouvert l'arbre de mon
  joueur » est justement ce que le registre doit à un intendant. Ce qui se
  vérifie, c'est la colonne `cible_utilisateur` — d'où `journal_vise` dans le
  harnais, plutôt qu'un `contient`.
- **Le harnais ne possède pas l'instance.** Une assertion du type « il ne reste
  plus aucun intendant » suppose qu'aucun autre compte n'existe : vraie en
  local sur une base propre, fausse en ligne. Viser l'adresse d'essai, jamais le
  total.
- **Le navigateur de ces sessions n'affiche pas la page** (`document.hidden`).
  Conséquences, toutes rencontrées : les captures d'écran échouent, les
  transitions CSS sont **gelées** — un tiroir mesuré en plein glissement paraît
  fermé —, et `resize` comme le `change` de `matchMedia` **ne se déclenchent
  pas**. Pour mesurer une mise en page, neutraliser les transitions
  (`* { transition: none !important }`) et **recharger** à chaque largeur plutôt
  que de compter sur le redimensionnement.
- **La section 10.B branche sur `/api/auth/moyens`.** En local `.dev.vars` porte
  une clé d'envoi factice, donc l'instance se dit configurée ; en ligne elle ne
  l'est pas. Le harnais vérifie le comportement **attendu dans chaque cas**
  plutôt que de se sauter lui-même — un « saute » silencieux laisserait croire
  que la surface est testée.
- **Attention aux guillemets dans `contient`.** L'argument est entre guillemets
  simples : y écrire `\"` cherche un antislash littéral et l'assertion échoue
  toujours. Sept vérifications du lot 10.A sont tombées pour cette seule raison.
- **Le lot 9 a réécrit quatre assertions du harnais**, ce qui n'était jamais
  arrivé. Elles disaient « un compte neuf n'a aucune sauvegarde » ; c'est
  devenu faux exprès. Le cas « plus aucun monde » (409) reste vérifié, sur un
  essai jetable qui supprime la sienne — l'interface a toujours une branche
  pour lui.
- **Le harnais crée maintenant 3 comptes** (A, B, et l'essai qui s'inscrit),
  soit exactement la limite horaire par adresse IP. Un quatrième échouerait.
- Les emojis ne se tapent pas dans le harnais : sous Git Bash, un littéral non
  ASCII passé en argument se fait réencoder. Le va-et-vient se teste au signe
  dollar — c'est d'ailleurs l'exemple d'origine — et les vrais emojis se
  vérifient sur la sauvegarde de départ, où ils sont déjà en base.
- **`outils/comparer.mjs` n'est plus à zéro tolérance, et c'est un changement de
  statut.** Du lot 5 au lot 7, `ATTENDUES` était vide : l'outil prouvait que le
  portage de `backend/` était fidèle. Depuis le lot 8, la version en ligne
  *avance* — elle connaît des liens révolus et des événements datés que la
  version Python ignore. L'outil prouve maintenant « la seule chose qui diffère
  est ce qu'on a ajouté exprès ». Chaque entrée porte sa raison ; y en ajouter
  une reste un acte réfléchi.
- Les chaînes cherchées par `contient` doivent être en **JSON compact**
  (`"id":"tableau"`, sans espace) : le serveur ne formate pas ses réponses.
- Dans le navigateur d'inspection, **les transitions CSS n'avancent pas** quand
  l'onglet ne compose pas d'images, et les captures d'écran échouent tant que le
  panneau n'est pas affiché. Tout se vérifie très bien par `javascript_tool`.
- **Le tactile se simule** : `PointerEvent` avec `pointerType: 'touch'`, une
  attente de plus de 480 ms, puis la salve `mousedown`/`mouseup`/`click` que le
  navigateur produit au lever du doigt. Sans cette salve, on ne teste pas le
  bug qui compte.
- `.dev.vars` (non versionné) porte une **clé d'envoi factice** et des
  **identifiants Google factices** : de quoi vérifier les branches « service
  configuré » — jeton créé, réponse identique, échec d'envoi journalisé ; aller
  chez Google, témoin `state`/`nonce`, tous les refus du retour — sans compte
  chez personne. Seul l'échange du code Google reste hors de portée.
- Les comptes d'essai (`essai-%`, `mesure-%`, `comparaison-%`, `atelier%`,
  `mathias%`, `navigateur%`, `repris%`, `patron%` `@exemple.test`) se nettoient à la main,
  en local **et** en ligne. Les invités laissés par les essais s'effacent avec
  `DELETE FROM utilisateurs WHERE role = 'invite'`.
- **`outils/construire-depart.mjs` n'est pas une étape de compilation.** Il lit
  le dépôt local (`../FamilyTree_GOT/`) et produit `src/depart/westeros.json`,
  qui est versionné. On ne le relance que si le jeu de données de départ change
  — et on ne retouche jamais le JSON à la main, la prochaine construction
  l'écraserait.

## La démonstration (lot 14)

- **Une sauvegarde `demo = 1` par compte, dont la ligne de contenu n'existe pas
  tant que personne n'y a écrit.** `lireTexte` sert alors le document livré
  avec le Worker, et la première écriture matérialise la ligne toute seule —
  `ecrireDocument` faisait déjà un `INSERT … ON CONFLICT`. C'est la seule
  entorse à « une sauvegarde, une ligne de contenu », et elle vaut 94 % de la
  base : au 14/08/2026, 2,94 Mo sur 3,13 étaient 32 copies identiques et
  jamais touchées du même Westeros.
- **Trois lectures passent par `lireTexte`** — `GET /:id/contenu`,
  `GET /:id/export` et la copie de `POST /` — et non par leur propre jointure.
  Chacune serait un endroit de plus où oublier ce repli, et la copie est
  justement le geste d'« en faire mon monde ».
- **`demo = 0` dans tout ce qui compte quelque chose** : plafonds, « Vos
  données », archive ZIP, `resoudreCibles`, `/api/sante`, listes de
  l'administration. Dans la liste des comptes, le filtre est **dans le `ON`**
  de la jointure externe : sinon un compte qui n'a encore que la démonstration
  disparaîtrait de la liste, alors que c'est justement l'information utile.
- **Rien n'y est conservé, et trois chemins le garantissent** : la remise à
  zéro à l'ouverture de session (seulement si `revision > 1`), le ménage
  nocturne, et `POST /api/sauvegardes/demonstration`. Tous font la même chose —
  effacer la ligne de contenu et rendre ses compteurs à la fiche, **sans
  changer son identifiant** : c'est lui que `sauvegarde_active` désigne.
- **Une exception, et une seule** : à l'inscription, une démonstration modifiée
  est **promue** en monde à part entière (`demo = 0`, nom « Mon Westeros »).
  Détruire ce travail au moment précis où l'on crée un compte pour le garder
  serait le seul endroit où l'avertissement deviendrait un piège.
- **Elle ne se réinstalle pas d'elle-même quand on l'a supprimée**, sauf sur un
  compte qui n'a plus rien. C'est un choix légitime ; le bouton la rappelle.
- Dans le harnais, « ses sauvegardes » se compte avec **`siennes`**, jamais avec
  `sauvegardes.length` : la liste porte la démonstration, qui n'appartient à
  aucun plafond. `sienne` donne l'id du premier monde qui ne soit pas elle —
  utile après une inscription, où la démonstration neuve passe en tête.
- La visite guidée (`public/js/tutoriel.js`) **vise des nœuds existants et se
  rabat quand ils manquent**. Deux pièges déjà rencontrés : `ouvrirLesFiltres`
  est une **bascule** et refermait le tiroir d'une étape à l'autre (d'où
  `derouler`), et un halo plus grand que l'écran n'assombrit ni ne désigne
  plus rien (d'où le rognage sur la fenêtre, et le repli sur un calque uni).

## Le carnet (lot 15)

- **`carnet` est une clef du document, pas une table.** Elle passe par `monde()`
  et `ecrireDocument` comme tout le reste, ce qui lui donne gratuitement les
  plafonds, les exports, l'archive et **la procuration** :
  `routesAdmin.route('/arbres/:arbre', routesDomaine)` monte aussi `/carnet/*`,
  donc l'administrateur et l'intendant y arrivent sans une ligne de plus.
- **Elle disparaît quand le carnet est vide.** `ecrireCarnet` pose `null` sur un
  carnet sans chapitre ni note, et `versDict` ne l'écrit que si elle porte
  quelque chose. C'est ce qui garde `outils/comparer.mjs` muet sur les mondes
  d'avant le lot — et il faut le savoir : **la version Python locale ne connaît
  pas cette clef**, un document qui ferait l'aller-retour par elle la perdrait.
- **La grammaire des balises est écrite deux fois** — `src/domaine/carnet.ts` et
  `public/js/markdown.js` — et les deux doivent rester d'accord. Surtout sur un
  point : `data-rang` compte les apparitions **de cette cible-là** dans la note,
  exactement comme l'index inverse. S'ils se séparent, une citation ouvre la
  bonne note au mauvais endroit, et rien ne le signale.
- **Un seul carnet dans la page, et il n'y a pas de `views/carnet.js`.**
  `main.js` fabrique l'objet **et enregistre son rendu dans la foulée**
  (`enregistrerRendu('carnet', …)`), sur le même objet, dans le même fichier.
  C'est la seule vue montée ainsi, et c'est ce qui la met à l'abri d'un
  désaccord de versions : un fichier de vue séparé allait chercher l'exemplaire
  par un accesseur partagé, et **un déploiement pendant qu'un onglet est ouvert
  suffisait à casser la vue** — l'onglet gardait l'ancien `main.js`, qui ne
  posait rien, l'import dynamique ramenait le fichier de vue neuf, et la vue
  répondait « Le carnet n'est pas disponible ». Signalé en production le
  15/08/2026, corrigé le jour même ; deux assertions du harnais tiennent la
  porte fermée. **Ne pas recréer ce fichier.**
- `etat.carnetPlace` dit où il se trouve (`null`, `'volet'`, `'vue'`) ; on le
  **déplace**, on n'en crée jamais un second — ce serait deux brouillons qui
  s'écrasent.
- **On n'écrase jamais un texte en cours de frappe.** Le carnet se recharge à
  chaque rechargement de vue (les noms affichés viennent des fiches) ; si cela
  tombe pendant qu'on tape, seul le catalogue est repris — voir
  `enCoursDeFrappe` dans `appliquer`.
- **`replaceChildren` n'est pas `h()`** : il convertit un enfant `null` ou
  `false` en **texte**. D'où `poser()` dans `carnet.js` — le sommaire affichait
  « null » à la première ouverture du volet.
- **Toute erreur du domaine doit passer par `enErreur`**, sinon elle ressort en
  500. `ErreurCarnet` y a été ajoutée après coup ; c'est le genre d'oubli que
  seul le harnais attrape.
- Le rendu Markdown **échappe d'abord et balise ensuite**, et ses jetons de mise
  à l'écart (`<c0>`, `<b0>`) ne sont sûrs **que parce que** l'échappement a déjà
  eu lieu : à ce stade, le seul `<` que le texte puisse porter est un `<` qu'on
  vient d'écrire soi-même. Ne pas déplacer l'ordre de ces trois lignes.

## Offrir une note (lot 16)

Une note s'envoie à d'autres comptes, **par adresse**, et n'entre chez eux
qu'après un oui. Le socle est `migrations/0009_notes_offertes.sql` et
`src/domaine/envois.ts` ; les routes sont dans la section « Carnet » de
`src/domaine/routes.ts`, l'interface dans `public/js/offres.js`.

- **Une offre est une copie datée, pas un lien.** Corriger sa note après coup
  ne change pas ce que l'autre a reçu, et l'effacer ne lui retire rien. Pointer
  vers la note d'origine aurait fait le contraire des deux.
- **Pas de colonne d'état.** La table *est* la boîte de réception : accepter ou
  refuser supprime la ligne. Ce qu'elle contient est exactement ce qui attend
  une réponse.
- **L'ordre compte à l'acceptation** : on écrit la note dans le monde d'abord,
  on supprime l'offre **ensuite**. Si l'écriture échoue (plafond, note trop
  longue), l'offre attend toujours.
- **Les balises sont réécrites pour le monde d'accueil** (`rattacher`), en
  trois passes : même identifiant, puis même nom aplati, puis nom assez
  ressemblant (Jaccard sur les mots de plus de deux lettres, seuil 0,5). À
  défaut, `@p:eddard-stark` devient `@Eddard Stark` — du texte, plus une
  citation. **Jamais une citation qui pointe à côté** : c'est la règle qui a
  décidé du reste.
- La réécriture se fait **de la fin vers le début, sur les positions relevées
  par `balisesDe`**, et non par un `replace` global : `balisesDe` ignore le
  code, et une balise montrée dans un bloc de code doit rester mot pour mot.
- Accepter écrit dans **la sauvegarde ouverte à ce moment-là**. Ni en
  procuration ni sur un arbre partagé (`proposerLesNotesRecues` s'en abstient) :
  on y regarde le monde de quelqu'un d'autre.

## Les deux langues (lot 16)

`public/js/langue.js` pose un dictionnaire **devant le DOM** : il parcourt les
nœuds de texte et les attributs qui s'affichent, et remplace ce qu'il
reconnaît. Le pourquoi est en tête du fichier ; ce qu'il faut retenir pour ne
pas se tromper en le modifiant :

- **Ce qui n'est pas au dictionnaire ne bouge pas.** Les noms de personnages,
  de maisons, les notes de la table ne peuvent donc pas être traduits par
  accident. C'est une propriété **passive** — personne n'a à penser à marquer
  ses données, et c'est ce qui rend l'approche tenable.
- **Les motifs sont ancrés des deux côtés**, et un motif **qui flotte entre
  deux trous** (`{} lien{}`) est refusé s'il porte moins de douze signes de
  littéral — il redevient une correspondance exacte. Mesuré : `{} lien{}` se
  compile en `/^(.*) lien(.*)$/`, qui reconnaît « 16 lien(s) direct(s) » (à
  moitié traduit, moche) **et** « il a rompu le lien avec son père » dans une
  note écrite par quelqu'un (réécrit, grave). Un motif ancré par du texte à
  l'une de ses extrémités (`Né en {}`, `{} / {} notés`) reste sûr et passe.
- **Ne jamais relire ce qu'on vient d'écrire.** `Lieu` → `Place`, puis
  l'observateur relit « Place » — mot français lui aussi — et le retraduit en
  « Space ». Un drapeau posé le temps de la boucle **n'y suffit pas** : les
  mutations arrivent en microtâche, donc dans un appel ultérieur, quand le
  drapeau est retombé. C'est `ecritsParNous` (un `WeakMap` de la valeur écrite,
  par nœud) qui arrête la boucle, et qui laisse quand même retraduire si
  l'application réécrit le nœud pour de bon.
- **Le relevé est une aide, pas une preuve.**
  `node outils/relever-textes.mjs --manquants` lit les sources et connaît les
  formes usuelles (porteurs, affectations, appels nommés, ternaires, arguments
  de champs, chaînes collées). Il ne voit **pas** un gabarit passé en argument
  libre (`dits.push(\`Sans compte ici : ${…}.\`)`) ni un texte construit dans
  un `innerHTML`. Un « 0 sans traduction » ne veut donc pas dire « tout est
  traduit » : **la vérification qui compte est de regarder l'application en
  anglais.** C'est comme ça qu'on a trouvé « Space », « 16 link(s) direct(s) »
  et « Sans compte ici ». Le fichier `traductions.js` porte des sections
  commentées pour les entrées posées à la main.
- On a essayé d'élargir le relevé à « tout gabarit qui ressemble à une
  phrase » : il ramenait des classes CSS (`bouton {}`), des chemins d'API et
  des bouts de code. Un relevé qui rend du bruit ne se relit pas, donc ne sert
  pas — la liste des appels reconnus est restée **nominative**.
- **Une phrase ajoutée demain reste en français** jusqu'à ce qu'on l'ajoute au
  dictionnaire, et rien ne le signalera si le relevé ne la voit pas.
- **Changer de langue recharge la page.** Traduire vers l'anglais se fait sur
  place ; revenir au français demanderait de retraduire à l'envers, ce qui
  n'est pas sûr. Le rechargement repart de ce que le code produit.
- L'observateur **se met en pause pendant qu'il écrit** (`enCours`), sinon ses
  propres remplacements le rappelleraient en boucle.

## Le budget de peinture du plan (lot 16.I)

Le plan est **une seule couche transformée de 21 mégapixels** (5041 × 4216 sur
Westeros). Ce qui s'y trouve est re-tramé à chaque changement d'échelle : c'est
la peinture qui coûte, pas le JavaScript (0,02 ms par cran de zoom) ni la mise
en page (1,63 ms pour déplacer 67 cartes).

- **Ne pas ajouter d'ombre par élément de carte.** Elles se comptent par le
  nombre de cartes multiplié par le nombre d'éléments qui en portent. Une
  déclaration à deux couches en fait deux fois plus. Le budget actuel : **309
  couches floues** au lieu de 665.
- **Ne pas utiliser `filter` sur les cartes.** Chaque filtre ouvre une surface
  de rendu à part. Il en reste zéro, sauf sur un vrai portrait — où un voile
  plat salirait la photographie au lieu de la désaturer.
- **`.plan.loin` doit retirer, pas pâlir.** Une opacité peint quand même, et
  ouvre une couche de composition en prime. On cache les **enfants** du corps,
  **jamais le corps** : `display: none` dessus ferait rétrécir la carte, et les
  traits de liaison — tracés d'après les boîtes calculées en JavaScript — se
  mettraient à finir dans le vide.
- **`will-change: transform` sur `.monde`** rend le panoramique gratuit. Le zoom
  reste un vrai retraçage : c'est le niveau de détail qui compte pour lui.
- Deux hypothèses vérifiées et **abandonnées**, à ne pas rejouer : `left/top` ne
  coûte pas plus que `transform` à cette taille, et `contain: layout style`
  n'améliore pas le recalcul de style.
- **Le volet de vérification ne compose pas d'images** : on ne peut y mesurer ni
  la peinture ni le nombre d'images par seconde. On mesure des compteurs
  (ombres, filtres, nœuds rendus) et des durées de style ou de mise en page ; le
  reste se raisonne, et se confirme sur une vraie machine.

## Le plan collectif (lot 17)

Une **seconde page d'administration**, `/collectif.html`, où les mondes des
membres sont superposés en un seul sociogramme. Elle sert le maître de jeu, pas
l'administrateur d'instance : `/admin.html` reste ce qu'il est, avec ses
tableaux, parce qu'administrer des comptes est un autre métier.

### Ce qu'il faut savoir avant d'y toucher

- **Le moteur de dessin n'a pas été touché.** `views/cartes.js` reçoit un
  payload `{noeuds, aretes}` comme d'habitude ; c'est `src/admin/collectif.ts`
  qui le fabrique. **Si vous ajoutez un champ au moteur, il vaut pour les deux
  pages** — vérifiez le plan collectif aussi.
- **Un nœud est une grappe, pas une fiche.** Son `id` est l'identifiant que le
  plus de comptes portent ; il existe donc vraiment chez au moins l'un d'eux, et
  c'est ce qui permet à un lot de le viser.
- **La place des `notes` de la carte est empruntée** pour dire l'état collectif.
  Ne cherchez pas les notes du personnage sur ce plan : elles diffèrent d'un
  compte à l'autre, et en montrer une seule mentirait sur les autres.
- **`/api/admin/collectif/*` est de la surface d'administration.** Mêmes gardes,
  même périmètre, même 404 pour ce qui n'est pas à soi. Une route ajoutée là
  doit appeler `dansLePerimetre` — le périmètre ne s'applique pas tout seul.

### Ce que le rapprochement refuse de deviner, et pourquoi

Trois règles ont été écrites **après** avoir vu la première version se tromper,
et il ne faut pas les défaire sans mesurer :

1. **La ressemblance se mesure mot à mot, et c'est le pire appariement qui
   décide.** Comparer les noms entiers laisse le nom de famille écraser le
   prénom : la première version réunissait Aerys, Daenerys et Viserys Targaryen
   en une seule personne, et Tywin avec Tyrion.
2. **Le dénominateur d'une comparaison de mots a un plancher à six lettres.**
   Sinon une faute de frappe coûte deux fois plus cher sur un prénom court que
   sur un long, ce qui n'a aucun sens.
3. **Deux fiches d'un même compte ne se rejoignent jamais automatiquement.** Un
   compte est l'autorité sur son propre monde. C'est cette règle — et non le
   seuil — qui règle le cas des deux « Brandon Stark » du monde livré.

Les **verdicts manuels** (`identites`) l'emportent sur les trois, dans les deux
sens. Ils survivent au curseur de seuil : c'est tout leur intérêt.

### Viser une grappe dans un lot

`{ "source": "grappe:eddard-stark" }` — chaque sauvegarde résout la clé vers
**son** identifiant local. Trois choses à retenir :

- La table de correspondance est **recalculée côté serveur**, jamais reçue du
  navigateur : elle décide de ce qui sera écrit et chez qui.
- Elle est indexée **par sauvegarde**, pas par compte : un compte peut en avoir
  plusieurs, et un lot de portée « toutes » les vise toutes.
- L'identifiant du lot cesse d'être calculé une seule fois : avec des grappes il
  dépend forcément de la sauvegarde. `nommeUneGrappe(operation)` fait
  l'aiguillage dans `appliquerLot`.

### Deux pièges de l'interface

- **Les identifiants des blocs du rail ne sont pas ceux de l'application.**
  `#bloc-maisons` et `#bloc-liens` portent un `order` dans la feuille de style
  sous 760 px, qui remonterait ces deux blocs en tête du tiroir — le bon ordre
  pour l'arbre d'une personne, le mauvais pour un plan collectif. D'où
  `#bloc-maisons-collectif`, `#bloc-types-collectif`, `#releve-plan`.
- **Cette page ne charge pas `telephone.js`.** Ses deux tiroirs s'ouvrent depuis
  la barre du haut, à toutes les largeurs, par `#btn-rail` et `#btn-panneau` ;
  `body.collectif` sert d'ancre aux trois règles qui l'autorisent. Sans elles,
  sous 760 px, le rail était hors de l'écran **sans plus rien pour l'y ramener**
  — exactement le défaut que le lot 11.C avait réparé dans l'application.

### Quel arbre le plan regarde (lot 17.G)

**Un arbre par membre, et il se choisit.** Le rail dit sous chaque nom lequel,
et un clic ouvre la liste. Trois choses à ne pas défaire :

- **`revision <= 1` veut dire « jamais réécrite depuis sa création »** —
  `creerDocument` la pose à 1, `ecrireDocument` l'incrémente. C'est le seul
  signal lisible sans ouvrir le document, et c'est celui qui écarte les mondes
  de départ intacts.
- **Un membre dont tout est intact reste au rail**, grisé, sans entrer dans le
  plan. Le faire entrer d'office remplirait le plan de décor ; le faire
  disparaître cacherait quelqu'un de la table.
- **Un geste écrit dans l'arbre affiché.** La page envoie la même table `arbres`
  au plan et aux lots. `preparerLot` la prend quand elle est là, et retombe sur
  `portee` sinon. **Toute route qui écrit depuis le plan doit la transmettre** —
  sans quoi le geste ira dans la sauvegarde que le membre a ouverte de son côté,
  et rien ne le dira.

Un choix qui ne désigne pas un arbre **de ce membre-là** est ignoré et remplacé
par le défaut : il vient d'un plan devenu vieux. C'est aussi ce qui empêche de
prêter à quelqu'un l'arbre d'un autre en trafiquant la requête.

**« Ce que la table a créé »** retire les fiches du monde livré
(`identifiantsDepart()`), mais **garde celles auxquelles une fiche neuve est
accrochée** — sans ce halo, un personnage inventé perdrait tous ses liens vers
le décor, donc tout son intérêt.

**Piège d'essai payé le 16/08/2026** : la base locale garde son journal d'une
exécution à l'autre, et une vérification du lot 11.A passait **grâce à ces
restes**. Pour éprouver quoi que ce soit sur le registre ou les grappes,
partir d'une base vidée :

    npx wrangler d1 execute familytree --local --command "DELETE FROM utilisateurs"
    npx wrangler d1 execute familytree --local --command "DELETE FROM journal_admin"

### Pour regarder le plan avec de vraies divergences

    bash outils/table-essai.sh

Monte dans la base **locale** un maître de jeu et trois joueurs partis du même
Westeros, puis fait diverger leurs mondes : un renommage, un doublon avec faute
de frappe, une suppression et un lien en plus. Quatre mondes identiques ne
montrent rien de ce que cette page sert à voir.

## Le plan repensé (lot 20)

**`bordure` n'est pas `couleur`.** Une personne a deux champs de couleur, et
les confondre est le piège d'entrée. `couleur` **remplace** celle de sa maison :
c'est une valeur *sur l'axe courant*, donc elle disparaît dès qu'on bascule
« Couleur & filtre » sur l'humeur ou sur un filtre. `bordure` (lot 20.B) est un
contour qui ne dépend d'aucun axe — il marque une fiche pour soi et tient quoi
qu'on affiche. Rendu par un `outline` CSS, jamais une `border` : une bordure
décalerait la fiche de trois pixels alors que les traits de liaison sont tracés
d'après les boîtes calculées en JavaScript, qui, elles, ne bougeraient pas.

**Les deux pièges qui se reproduiront dans l'IRL :**

- **`flex-grow` ne fait pas des moitiés.** La carte partage 1/2 + 1/4 + 1/4. La
  première version donnait `flex: 2` au bandeau et `flex: 2` au corps : le
  résultat mesurait 52 / 80 au lieu de 66 / 66, parce que la taille minimale
  automatique d'un élément flex est celle de son contenu. Il faut une hauteur
  **ferme** sur `.carte` (`height: var(--carte-hauteur)`) et des parts
  **déclarées** (`flex: 0 0 50%`), plus `min-height: 0` sur le corps.
- **d3-zoom mange les `mousemove`.** La surface de tracé des formes est un
  enfant du plan, où d3 écoute. Sans `stopPropagation` sur le `mousedown`, d3
  ouvre un geste de panoramique et pose ses écouteurs sur la fenêtre **en phase
  de capture**, où il appelle `stopImmediatePropagation` : les `mousemove` ne
  parviennent jamais au tracé, et le rectangle reste à zéro pixel. Le symptôme
  — « on trace et rien n'apparaît » — ne désigne pas sa cause.

**Une forme de fond ne contient personne** (`src/domaine/formes.ts`). Aucune
fiche n'y est rattachée, rien n'est recalculé quand on la déplace. Conséquence
assumée : elle ne suit pas les fiches, et un filtre qui redessine le plan la
laisse où elle est. Elle est **inerte au repos** (`pointer-events: none`) —
sinon un rectangle tracé autour du Nord empêcherait de faire glisser le plan
dans tout le Nord ; le bouton « ▭ Formes » ouvre le mode dessin.

**Trois champs nouveaux ne s'écrivent que s'ils portent quelque chose** :
`bordure` sur une personne, `formes` sur le document, `unites` sur une maison.
Deux de plus au lot 21.D — `role` et `ville`. C'est la règle de tout ce dépôt —
un monde qui ne s'en sert pas doit ressortir octet pour octet comme il est
entré — et le harnais la vérifie dans les deux sens.

## Le plan qui obéit (lot 22)

Quatre morceaux, mais un seul qui change la façon de penser le plan.

### `position` a remplacé `decalage`, et ce n'est pas un renommage

`decalage` valait `[dx, dy]` **relatifs** à la position calculée. `position` vaut
`[x, y]` **absolus**. Trois conséquences à garder en tête avant de toucher à
`views/cartes.js` :

1. **L'étape 11 remplace, elle n'ajoute plus.** `boite.x = noeud.position[0]`.
   Un `decalage` encore présent (monde d'avant le lot 22) s'ajoute une dernière
   fois, puis `figerLesPositions()` le replie dans la position et le met à
   `null`.
2. **L'étape 12 ne translate plus dès qu'une fiche est ancrée** (`ancrage`). Si
   vous la réactivez, toutes les positions enregistrées deviennent fausses d'un
   même vecteur, à chaque ouverture, sans erreur nulle part. C'est le piège de
   ce lot.
3. **Le monde part de zéro**, donc les glissers sont bornés à `Math.max(0, …)`.
   Une fiche en coordonnée négative serait rognée par le cadre.

`figerLesPositions()` (`main.js`) écrit ce que le calcul vient de trouver, une
fois par monde, via `PATCH /personnes/positions` — **une** requête pour
soixante-sept fiches. Elle ne s'exécute jamais sur une vue partagée (`PARTAGE`)
ni hors du rendu `cartes`. Si vous ajoutez un rendu qui place des fiches, pensez
à ce garde-fou.

`normaliserPosition` **n'est pas** `normaliserDecalage` : pour la première,
`[0, 0]` est une position valable (le coin du plan) ; pour la seconde, `[0, 0]`
voulait dire « aucun » et devenait `null`. Les deux fonctions se ressemblent
beaucoup et disent le contraire sur ce cas précis.

### Les formes : la classe qui manquait, et la leçon

Le panneau de réglage d'une forme existait depuis le lot 20.D, avec ses huit
contrôles et sa corbeille. Il n'a **jamais pu s'afficher** : `ouvrirEditeur`
construisait `<div class="forme-editeur">` sans `flottant`, la classe qui porte
`position: fixed` et le `z-index`. Monté dans `<body>`, en flux normal, sous une
application en `height: 100vh; overflow: hidden` — hors écran, sans une erreur.

**La leçon vaut au-delà de ce bogue** : dans ce projet, tout panneau flottant
porte `flottant` *plus* une classe à lui, et la largeur se redit sur
`.flottant.<la-vôtre>` — sinon les 322 px de `.flottant`, déclarés plus bas dans
la feuille, l'emportent. Les neuf autres panneaux le faisaient ; celui-là non.

Deux choses à savoir en y retouchant :

- **Une forme hors de sa vue est retirée du DOM**, pas masquée. `visible(forme)`
  filtre dans `dessiner()`, et `definirVue(focusId)` est appelé depuis
  `appliquer()` — pas depuis `rendre()` — parce qu'on centre et décentre sans
  recharger la vue.
- **`profils` est un tableau**, donc `appliquer()` (côté serveur) compare avec
  `identique()` et non `!==` : sans ça, déplacer une forme annoncerait un
  changement de portée à chaque fois et réécrirait la sauvegarde.

### Ce qui a été retiré, et ce que ça a emporté

L'axe `categorie` remplissait **deux** surfaces : l'entrée « Catégorie de
maison » du sélecteur du haut, et le bloc « Catégories » du rail. Le retirer une
fois les retire toutes les deux. Il emporte `menuCategorie`, `menuCategories` et
l'instance `editeurCategorie` — ils n'avaient pas d'autre porte d'entrée.
`editeurCategorieRapide` reste : c'est celui qu'ouvre la fiche d'une maison.

La fenêtre de l'année (`creerEditeurAnnee`, 131 lignes) est supprimée ;
l'année s'écrit dans la barre du haut (`enregistrerAnnee` dans `main.js`).
`Api.majMeta` n'a plus qu'un appelant et n'envoie plus que `annee_courante` —
`meta.document` existe toujours côté serveur mais ne se règle plus que par les
lots d'administration.

### La typographie, et pourquoi la barre du haut ne l'a pas suivie

Les 223 `font-size` de `app.css` ont monté d'un cran (plancher à 10 px). Deux
effets à ne pas défaire :

- `--carte-hauteur` est passée de 132 à **144 px**. `mesurer()` relit cette
  hauteur sur une fiche réelle, donc la géométrie des connecteurs suit seule —
  mais si vous la rebaissez, les deux quarts du bas de la carte débordent.
- **`.barre-haut` garde délibérément l'ancienne taille** (`.barre-haut .bouton`,
  `.barre-haut .champ`). Grossie comme le reste, elle sortait de l'écran sur
  1280 px, et `html` étant en `overflow: hidden`, ce qui dépasse est perdu, pas
  défilable. Elle passe aussi à la ligne (`flex-wrap`) comme filet.

### Entrée enregistre, une fois pour toutes

`creerFlottant` (`dom.js`) installe désormais un `keydown` qui, sur Entrée, clique
le premier `.bouton-primaire` du panneau. Six éditeurs le faisaient chacun dans
leur coin, deux ne le faisaient pas. Dans une zone de texte, Entrée reste un
retour à la ligne ; Ctrl/⌘ + Entrée enregistre. **Un nouvel éditeur n'a donc plus
rien à écrire pour ça** — il lui suffit d'avoir un bouton `.bouton-primaire`.

## Le rail et les liens (lot 21)

**Placer et dessiner sont deux listes, pas une.** C'était le défaut de 21.B, et
c'est la chose à ne pas refaire. `calculerMiseEnPage` (`js/views/cartes.js`)
tient maintenant deux listes de fratries : `fratries` **place** les fiches (donc
seulement celles dont on ne connaît pas le parent commun — sans elles, un oncle
sans ascendance finirait en satellite), `fratriesTracees` **dessine** (donc
toutes les explicites, plus les déduites dont aucun parent commun n'est
visible). Confondre les deux faisait disparaître, sans un mot, les fratries
créées à la main entre deux enfants d'un même parent.

**Un `marker-end` ne marque que le dernier point d'un chemin.** Le connecteur de
descendance est un seul `<path>` à plusieurs `M` : pattes des parents, barre,
tige, barre des enfants. Y poser une flèche n'en dessinait qu'une, sur le
dernier enfant. Les pattes d'enfant sont donc tracées **une par une**. Même
piège partout ailleurs où un chemin porte plusieurs sous-tracés.

**Les fratries déduites sont cliquables mais pas éditables.** Elles n'existent
pas dans la sauvegarde — elles se recalculent à chaque plan depuis le parent
commun, avec un id `auto-fratrie-…`. Depuis qu'on les dessine, `modifierLien`
(`js/main.js`) les refuse explicitement ; sans ce garde, on ouvrirait l'éditeur
sur un lien que le serveur ne connaît pas.

**Les types structurants se suppriment** (lot 21.C). `TYPES_STRUCTURANTS` ne
bloque plus, il prévient : `EFFETS_STRUCTURANTS` (`src/domaine/referentiels.ts`)
dit ce que le plan perd, et descend au front comme les autres catalogues. Ce qui
rend la chose sûre : **recréer le type avec le même id lui rend son rôle**, la
mise en page ne connaissant que la chaîne (`role()` dans `vues/sociogramme.ts`,
`type === 'parent'` dans `genealogie.ts`).

**`montrerBloc()` est la seule carte du rail** (`js/rail.js`). Le rail a deux
onglets depuis 21.A, et trois blocs qui se replient. Trois appelants doivent
amener un bloc sous les yeux sans savoir où il vit : le ⛨ du téléphone
(`telephone.js`), la visite guidée (`tutoriel.js`), et le rail au démarrage.
Tout ce qui vise un bloc du rail passe par là — sinon chaque appelant porterait
sa propre carte, et se tromperait au premier déménagement.

**Les blocs `#bloc-compte` et `#bloc-telephone` restent hors des onglets.**
`telephone.js` y déménage la barre du haut sous 760 px. Les ranger dans un
onglet voudrait dire qu'un bouton de la barre peut devenir invisible selon
l'onglet actif — la panne réparée au lot 12.A.

## Pour repartir

```bash
cd "C:/Perso/Family Tree/FamilyTree_Cloud" && npm run dev
```

`npm run verif` avant tout push. Harnais complet :
`bash outils/essai.sh http://127.0.0.1:8787`. Comparaison avec la version
Python (qui doit tourner) :
`node outils/comparer.mjs http://127.0.0.1:8321 http://127.0.0.1:8787`.
`git push` = déploiement.
