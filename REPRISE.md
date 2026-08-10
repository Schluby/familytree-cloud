# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Lots 0 à 4 livrés et en ligne** sur https://familytree.schlub-perso.workers.dev.
L'application complète tourne : comptes, sauvegardes cloisonnées, domaine porté
en TypeScript, et depuis le 10/08/2026 **l'interface**.

**Le prochain est le lot 5 — sortir ses données** : porter `exports.py`
(CSV, classeur Excel), déclarer `VueTableau` dans `src/domaine/registre.ts`, et
un `.zip` de tout le compte.

## À faire au moment d'attaquer le lot 5

1. Porter `exports.py` en TypeScript, à côté de `src/domaine/vues/`.
2. Enregistrer `VueTableau` dans `src/domaine/registre.ts` (le tableau était la
   seule vue non portée au lot 3).
3. **Retirer les deux entrées d'`ATTENDUES` dans `outils/comparer.mjs`** — sans
   ça le score reste artificiellement à 28/28 avec deux divergences tolérées.
4. Remettre l'export en classeur Excel dans le menu des sauvegardes de
   `public/js/main.js` (retiré au lot 4, faute de serveur pour le servir) et
   dans `Api.urlExport` (`public/js/api.js`), qui ne connaît que le JSON.

## Effets de bord à ne pas déclencher

**Côté serveur** — hérités des lots 2 et 3, toujours vrais :

- Toute écriture de document passe par `ecrireDocument` (`src/sauvegardes/depot.ts`).
  **Ne jamais ouvrir un second chemin d'écriture.**
- Ajouter une route de domaine oblige à ajouter son chemin au tableau `SURFACE`
  de `src/domaine/routes.ts`, sinon elle est **servie sans session**.
- `Dataset` garde un index en cache : appeler `oublierIndex()` après toute
  mutation de `personnes`.
- **Ne jamais modifier une migration déjà appliquée** ; en ajouter une (`0004_…`).

**Côté interface** — nouveaux, lot 4 :

- **`public/js/api.js` est la couture de la fourche.** `public/js/` est la copie
  de `../FamilyTree_GOT/web/js/` ; tout ce que la version en ligne fait
  autrement est absorbé dans `api.js`. Une divergence qui peut y tenir doit y
  tenir — sinon la copie du lot 4 se met à diverger partout.
- Les deux interfaces sont une **fourche assumée** : ne pas chercher à les
  resynchroniser fichier par fichier. L'invariant partagé est le contrat d'API.
- `📸` ne crée pas d'instantané mais **une sauvegarde de plus** (copie datée).
  La table `instantanes` existe depuis le lot 0 et **reste vide** ; aucun lot ne
  la programme.
- Pas de photos : la pastille de la fiche ne prend qu'une **adresse** `https://…`.
  Le serveur refuse les `data:` (`ErreurPortrait` → 400).
- Un compte neuf n'a **aucune** sauvegarde et le domaine répond **409** tant
  qu'il n'y en a pas : `demarrer()` dans `public/js/main.js` traite ce cas à
  part. Ne pas le supprimer en refactorant.

## Pièges de vérification, déjà payés

- Une route ou un fichier neuf répond 404 sur les points de présence encore à
  l'ancienne version : **attendre une minute après un push** avant de lancer le
  harnais.
- Lancer `essai.sh` (ou `mesurer.mjs`) plus de trois fois dans l'heure depuis la
  même adresse déclenche la limite d'inscriptions. Purge :
  `wrangler d1 execute familytree --local --command "DELETE FROM tentatives"`
  (ou `--remote`).
- `outils/essai.sh` s'**étend**, ne se réécrit pas (111 vérifications).
- `outils/comparer.mjs` doit rester à **28/28**.
- Dans le navigateur d'inspection, **les transitions CSS n'avancent pas** quand
  l'onglet ne compose pas d'images : un volet animé paraît immobile. Neutraliser
  la transition avant de mesurer une position, sinon on cherche un bug qui
  n'existe pas.
- Les comptes d'essai (`essai-%`, `mesure-%`, `comparaison-%` `@exemple.test`)
  se nettoient à la main, en local **et** en ligne.

## Pour repartir

```bash
cd "C:/Perso/Family Tree/FamilyTree_Cloud" && npm run dev
```

`npm run verif` avant tout push ; `bash outils/essai.sh http://127.0.0.1:8787`
pour le harnais complet. `git push` = déploiement.
