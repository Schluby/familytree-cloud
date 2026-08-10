# Reprise — état du chantier

Fichier de relais : à lire **en premier** pour reprendre le travail sans relire
tout le dépôt. Le plan d'ensemble reste [`PLAN.md`](PLAN.md) ; les raisons des
choix restent [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Où on en est

**Lots 0 à 5 livrés et en ligne** sur https://familytree.schlub-perso.workers.dev :
comptes, sauvegardes cloisonnées, domaine porté en TypeScript, interface, et
exports.

**Le portage de `backend/` est complet.** Plus un module ni une vue qui manque,
et `outils/comparer.mjs` ne tolère plus **aucune** divergence : `ATTENDUES` est
vide, le score est de 36/36 sur la vraie campagne.

## Le prochain : lot 6 — mise en ligne

La plus grande partie est déjà faite sans l'avoir cochée (déploiement branché
sur le dépôt, migrations en ligne, cron de purge des sessions, verrou optimiste
par `revision`). **Il reste trois choses :**

1. **Vérifier les en-têtes** : `Secure` sur le cookie, HSTS, pas de `Server`.
   Un simple `curl -I` en production, et une vérification de plus dans
   `outils/essai.sh`.
2. **Une page « Vos données »** : ce qui est stocké, le fait que les
   administrateurs peuvent consulter les arbres, tout télécharger (le bouton
   existe déjà), tout supprimer. C'est la seule vraie nouveauté du lot.
3. **Mesurer la consommation sur une semaine** et la noter dans `PLAN.md`.

Puis le **lot 7 — administration** : `exigerAdmin` dans son propre module,
`/api/admin/*` en lecture seule et journalisé, le premier admin promu **en
SQL**. La règle non négociable : les routes de membres ne reçoivent **aucune**
exception « ou si je suis admin ».

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
