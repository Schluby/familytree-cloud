# FamilyTree Cloud

La même application que `../FamilyTree_GOT`, mais **hébergée** : on s'y connecte
avec un compte, chacun y retrouve ses propres sauvegardes, et on peut tout
retélécharger sur sa machine quand on veut.

**État : squelette déployable.** Le Worker, la base et la chaîne de mise en
ligne existent et sont vérifiés ; l'application elle-même se construit aux lots
1 à 7.

| Fichier | Ce qu'on y trouve |
| --- | --- |
| [`DEPLOIEMENT.md`](DEPLOIEMENT.md) | **Ce qu'il faut créer chez Cloudflare, et dans quel ordre.** À lire pour mettre en ligne. |
| [`PLAN.md`](PLAN.md) | La feuille de route, lot par lot, avec des cases à cocher. **À ouvrir en premier pour coder.** |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Les choix techniques et *pourquoi* : Cloudflare, l'authentification, le stockage, ce qui change par rapport à la version locale. |
| [`migrations/`](migrations/) | Le schéma de la base D1. **Additif** : on ajoute un fichier, on n'en modifie jamais un déjà appliqué. |

## Démarrer

```bash
npm install
npm run base:local   # crée les tables dans une base D1 locale
npm run dev          # http://localhost:8787
```

`npm run verif` (typage + construction à blanc) avant de pousser.

## En deux lignes

Un **Worker Cloudflare** (gratuit) sert le front et l'API ; une base **D1**
(SQLite gérée par Cloudflare, gratuite) garde les comptes et les sauvegardes.
Aucune autre plateforme, aucune carte bancaire, aucun service payant.

## Ce qui ne change pas

Le contrat d'API reste **celui de l'application locale** (`/api/vue/…`,
`/api/personnes/…`, `/api/filtres/…`). C'est la décision qui tient tout le
reste : l'interface `web/` déjà écrite est reprise presque telle quelle, et les
deux versions restent compréhensibles ensemble.

## Ce qui change

- On se connecte. **Chacun son espace** : ses arbres, personne d'autre dedans.
  Un seul déploiement, un compte par personne — les quotas Cloudflare sont
  comptés par compte, pas par Worker, donc déployer une copie par joueur ne
  gagnerait rien. **L'inscription est ouverte** et **il n'y a rien à
  installer** : une adresse, un navigateur.
- Des comptes **administrateurs** peuvent consulter tous les arbres, en lecture
  seule et de façon journalisée. C'est écrit sur l'écran d'inscription : les
  utilisateurs doivent le savoir avant de créer un compte.
- **Pas de portraits hébergés.** C'est ce qui pesait le plus lourd pour le moins
  de valeur en ligne. Un `avatar` qui est une adresse `http(s)` reste accepté,
  il ne coûte rien : il s'affiche dans la fiche et dans la liste des personnes.
  Depuis le lot 20.C, la carte du plan, elle, n'en affiche plus — elle porte le
  nom en grand, la maison et le lieu du moment.
- Il n'y a plus de disque : le Worker ne garde rien entre deux requêtes, donc
  l'écriture différée en mémoire du serveur local disparaît (voir
  [`ARCHITECTURE.md`](ARCHITECTURE.md), section « Enregistrement »).
- « Enregistrer sous » devient **« Tout télécharger »** : un `.zip` de toutes
  ses sauvegardes, réimportable.

## Est-ce que ça tient dans le gratuit ?

Oui, très largement — chiffré sur la vraie campagne dans
[`ARCHITECTURE.md`](ARCHITECTURE.md), section « Faisabilité ». Une dizaine de
personnes occuperaient **moins de 5 %** du plus serré des paliers. Le coût du
projet est le portage du code, pas l'hébergement.
