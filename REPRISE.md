# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Les sept lots du plan sont livrés, et le lot 8 par-dessus** — la première
tranche qui n'était pas au plan d'origine, demandée le 10/08/2026. En ligne sur
https://familytree.schlub-perso.workers.dev.

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

### Deux actions qui vous reviennent

**1. Aucun compte n'est administrateur en production.** Le rôle se donne en
SQL, volontairement — voir `DEPLOIEMENT.md`, « Se donner le rôle
d'administrateur » :

```bash
npx wrangler d1 execute familytree --remote --command "UPDATE utilisateurs SET role='admin' WHERE email_norm='VOTRE-ADRESSE'"
```

Rien du lot 8.F ne sert tant que ce n'est pas fait.

**2. L'envoi de courriel n'est pas branché.** Le lot 8.G marche de bout en bout
*sauf* l'envoi lui-même, qui demande un compte chez un service tiers et une
clé — c'est à vous : `DEPLOIEMENT.md`, « Brancher l'envoi de courriel ». Sans
clé, l'application ne promet rien et propose le code de secours.

### Ce qui attend le calendrier

**Relever la consommation d'une semaine** dans le tableau de bord Cloudflare —
requêtes du Worker, lectures et écritures D1 — et la noter dans `PLAN.md`
(lot 6, dernière case). Relevé de départ posé le **10/08/2026** : 2 comptes,
1 sauvegarde. **À faire le 17/08/2026.**

## Et après ?

Ce qui reste « à trancher » et n'a jamais été programmé :

- **Le partage entre membres** (un arbre en lecture seule pour quelqu'un
  d'autre) — ce serait un lot 9, avec une table `partages`. À noter : le lot
  8.F a posé le mécanisme qui le rendrait facile (voir la procuration).
- **La vérification d'adresse à l'inscription** — possible maintenant que
  `src/auth/courriel.ts` existe, mais pas faite : personne ne l'a demandée.
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
- `outils/essai.sh` s'**étend**, ne se réécrit pas. **225 vérifications.**
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
  `mathias%` `@exemple.test`) se nettoient à la main, en local **et** en ligne.

## Pour repartir

```bash
cd "C:/Perso/Family Tree/FamilyTree_Cloud" && npm run dev
```

`npm run verif` avant tout push. Harnais complet :
`bash outils/essai.sh http://127.0.0.1:8787`. Comparaison avec la version
Python (qui doit tourner) :
`node outils/comparer.mjs http://127.0.0.1:8321 http://127.0.0.1:8787`.
`git push` = déploiement.
