# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Lots 0 à 6 livrés et en ligne** sur https://familytree.schlub-perso.workers.dev :
comptes, sauvegardes cloisonnées, domaine porté en TypeScript, interface,
exports, en-têtes de sécurité et page « Vos données ».

**Le portage de `backend/` est complet.** Plus un module ni une vue qui manque,
et `outils/comparer.mjs` ne tolère plus **aucune** divergence : `ATTENDUES` est
vide, le score est de 36/36 sur la vraie campagne.

### Une seule chose en attente, et elle attend le calendrier

**Relever la consommation d'une semaine** dans le tableau de bord Cloudflare —
requêtes du Worker, lectures et écritures D1 — et la noter dans `PLAN.md`
(lot 6, dernière case). Relevé de départ posé le **10/08/2026** : 2 comptes,
1 sauvegarde. **À faire le 17/08/2026.**

## Le prochain : lot 7 — administration

Un compte `admin` voit **tous** les arbres, en lecture seule. Les colonnes sont
déjà dans le schéma : rien à migrer.

1. Promouvoir le premier administrateur **en SQL** — jamais depuis l'interface,
   et surtout pas de « le premier inscrit devient admin ».
2. `exigerAdmin` dans **son propre module**, et `/api/admin/*` comme surface
   séparée, en lecture seule, journalisée dans la table `journal_admin`.
3. La règle non négociable : **les routes de membres ne reçoivent aucune
   exception.** On n'y ajoute jamais un « ou si je suis admin » — c'est
   exactement ce que le tableau `SURFACE` et le `WHERE utilisateur_id = ?`
   protègent depuis le lot 2.

## Effets de bord à ne pas déclencher

**Côté serveur :**

- Toute écriture de document passe par `ecrireDocument` (`src/sauvegardes/depot.ts`).
  **Ne jamais ouvrir un second chemin d'écriture.**
- Ajouter une route de domaine oblige à ajouter son chemin au tableau `SURFACE`
  de `src/domaine/routes.ts`, sinon elle est **servie sans session**. C'est ce
  tableau qui a fait que `/export/*` est protégé.
- `Dataset` garde un index en cache : appeler `oublierIndex()` après toute
  mutation de `personnes`.
- **Ne jamais modifier une migration déjà appliquée** ; en ajouter une (`0004_…`).
- `src/domaine/zip.ts` sert **deux** consommateurs (le classeur Excel et
  l'archive du compte) : le casser casse les deux.

**Côté interface :**

- **`public/js/api.js` est la couture de la fourche.** `public/js/` est la copie
  de `../FamilyTree_GOT/web/js/` ; tout ce que la version en ligne fait
  autrement est absorbé dans `api.js`. Une divergence qui peut y tenir doit y
  tenir. Les deux interfaces sont une **fourche assumée** : ne pas chercher à
  les resynchroniser fichier par fichier.
- **Le dézippage est côté navigateur** (`public/js/zip.js`), volontairement :
  un Worker n'a pas le temps de calcul pour ouvrir une archive de dix
  sauvegardes. Ne pas « simplifier » en déplaçant ça sur le serveur.
- **Les en-têtes de sécurité vivent à deux endroits**, et c'est voulu :
  [`public/_headers`](public/_headers) pour les fichiers statiques (qui ne
  passent pas par le Worker, `run_worker_first` ne couvrant que `/api/*`) et
  `src/index.ts` pour les réponses d'API. **Modifier l'un sans l'autre laisse
  une moitié du site sans protection** — le harnais vérifie les deux surfaces
  séparément. Et dans le Worker, il faut **recopier** la réponse : celles qui
  viennent d'un `fetch` ont des en-têtes immuables, `c.header()` n'y peut rien.
- La politique de contenu interdit les scripts en ligne. Un `<script>` écrit
  directement dans une page HTML **ne s'exécutera pas** : passer par un fichier
  de `public/js/`.
- `📸` ne crée pas d'instantané mais **une sauvegarde de plus** (copie datée).
  La table `instantanes` existe depuis le lot 0 et **reste vide**.
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
- `outils/essai.sh` s'**étend**, ne se réécrit pas (125 vérifications).
- `outils/comparer.mjs` doit rester à **36/36 sans tolérance**. Ajouter une
  entrée à `ATTENDUES` doit être un acte réfléchi, jamais un moyen de faire
  taire un écart qu'on ne comprend pas.
- Les chaînes cherchées par `contient` doivent être en **JSON compact**
  (`"id":"tableau"`, sans espace) : le serveur ne formate pas ses réponses.
- Dans le navigateur d'inspection, **les transitions CSS n'avancent pas** quand
  l'onglet ne compose pas d'images : un volet animé paraît immobile. Neutraliser
  la transition avant de mesurer une position.
- Les comptes d'essai (`essai-%`, `mesure-%`, `comparaison-%` `@exemple.test`)
  se nettoient à la main, en local **et** en ligne.

## Pour repartir

```bash
cd "C:/Perso/Family Tree/FamilyTree_Cloud" && npm run dev
```

`npm run verif` avant tout push. Harnais complet :
`bash outils/essai.sh http://127.0.0.1:8787`. Comparaison avec la version
Python (qui doit tourner) :
`node outils/comparer.mjs http://127.0.0.1:8321 http://127.0.0.1:8787`.
`git push` = déploiement.
