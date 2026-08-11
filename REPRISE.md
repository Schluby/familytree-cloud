# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Les sept lots du plan sont livrés, puis les lots 8 et 9** — deux tranches qui
n'étaient pas au plan d'origine, demandées les 10 et 11/08/2026. En ligne sur
https://familytree.schlub-perso.workers.dev.

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

- **La connexion Google (lot 9.E).** Évaluée le 11/08/2026, pas faite. Le code
  serait contenu : redirection vers Google, échange du code côté serveur,
  vérification du JWT contre son JWKS, liaison par adresse. Un compte Google n'a
  pas de mot de passe chez nous — il se range exactement comme un invité, avec
  le même marqueur non déchiffrable dans `mot_de_passe`. **Ce qui bloque n'est
  pas le code** : il faut un projet Google Cloud, un écran de consentement (donc
  une politique de confidentialité publiée, et une vérification pour sortir du
  mode test), un identifiant et un secret à poser en secrets Worker. Même
  dépendance que la clé d'envoi de courriel.
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
  dernière est `0004_reinitialisations.sql`.
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
- **`meta.document` finit dans un `href`.** La route `/meta` n'accepte que
  `http:` et `https:` — sans ce filtre, un `javascript:` rangé dans une
  sauvegarde s'exécuterait au clic, y compris chez l'administrateur qui ouvre
  l'arbre par procuration.

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

**Côté interface :**

- **`public/js/api.js` est la couture de la fourche.** `public/js/` est la copie
  de `../FamilyTree_GOT/web/js/` ; tout ce que la version en ligne fait
  autrement y est absorbé. C'est aussi là que vit le préfixe `DOMAINE` de la
  procuration : **le domaine seul est préfixé**, jamais le compte, la session
  ni les sauvegardes.
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
- `outils/essai.sh` s'**étend**, ne se réécrit pas. **274 vérifications.**
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
- `.dev.vars` (non versionné) porte une **clé d'envoi factice** : de quoi
  vérifier la branche « service configuré » — jeton créé, réponse identique,
  échec d'envoi journalisé — sans compte chez personne.
- Les comptes d'essai (`essai-%`, `mesure-%`, `comparaison-%`, `atelier%`,
  `mathias%`, `navigateur%`, `repris%` `@exemple.test`) se nettoient à la main,
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
