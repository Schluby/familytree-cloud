-- Migration 0002 — un compteur de révision par sauvegarde.
--
-- Pourquoi une colonne de plus alors que `modifie_le` était prévu comme verrou
-- optimiste : `modifie_le` est en **secondes**. Deux onglets qui enregistrent
-- dans la même seconde verraient la même valeur et s'écraseraient l'un l'autre
-- sans que personne ne s'en aperçoive. Un compteur qui ne fait qu'augmenter n'a
-- pas cette zone aveugle.
--
-- Le client relit la révision dans l'en-tête `ETag` de `GET .../contenu` et la
-- renvoie dans `PUT .../contenu`. Si elle a bougé entre-temps, le serveur
-- répond 409 au lieu d'écraser le travail de l'autre onglet.
--
-- Migration **additive** : elle ne touche à aucune donnée existante, et les
-- lignes déjà en base démarrent à 1.

ALTER TABLE sauvegardes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
