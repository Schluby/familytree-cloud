-- Migration 0003 — la sauvegarde active d'un compte.
--
-- L'application locale a une notion de « sauvegarde active » : le monde qu'on
-- est en train d'éditer. C'est ce qui permet à toutes les routes du domaine de
-- s'écrire `/api/personnes/<id>` et non `/api/sauvegardes/<x>/personnes/<id>`.
--
-- On garde exactement ce contrat, parce que c'est lui qui permettra de reprendre
-- `web/` sans le réécrire au lot 4. La différence : ici l'active est **par
-- compte**, pas globale. Elle vit donc sur la ligne de l'utilisateur.
--
-- `ON DELETE SET NULL` n'existe pas sur une colonne ajoutée après coup en
-- SQLite ; c'est le code qui repointe l'active quand la sauvegarde visée
-- disparaît, et une active qui ne résout plus est traitée comme absente.

ALTER TABLE utilisateurs ADD COLUMN sauvegarde_active TEXT;
