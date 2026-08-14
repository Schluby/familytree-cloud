# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Les sept lots du plan sont livrés, puis les lots 8, 9, 10 et 11** — des
tranches qui n'étaient pas au plan d'origine, demandées entre le 10 et le
13/08/2026. En ligne sur https://familytree.schlub-perso.workers.dev et sur
https://myschlub.com (**le même Worker**, pas un second déploiement).

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

## Pour repartir

```bash
cd "C:/Perso/Family Tree/FamilyTree_Cloud" && npm run dev
```

`npm run verif` avant tout push. Harnais complet :
`bash outils/essai.sh http://127.0.0.1:8787`. Comparaison avec la version
Python (qui doit tourner) :
`node outils/comparer.mjs http://127.0.0.1:8321 http://127.0.0.1:8787`.
`git push` = déploiement.
