-- Lot 23.C/D : se connaître entre comptes, et écrire à plusieurs sur un arbre.
--
-- ── Pourquoi des amitiés, et pas seulement une liste d'adresses ─────────────
--
-- Le partage en lecture (lot 11.B) désigne des comptes par leur adresse, sans
-- rien leur demander : on ne peut que *leur montrer* quelque chose, et le pire
-- qui puisse arriver est qu'ils voient un arbre qui ne les intéresse pas.
--
-- L'écriture est d'une autre nature. Donner à quelqu'un le droit de modifier
-- son monde sans qu'il ait jamais dit oui, c'est pouvoir faire écrire n'importe
-- qui n'importe où — et, pour celui qui reçoit, voir apparaître dans son rail
-- des arbres qu'il n'a pas demandés. D'où une relation **réciproque**, qui se
-- demande et s'accepte, et sans laquelle aucun droit d'écriture ne se pose.
--
-- Une seule ligne par paire, orientée : `demandeur_id` a écrit à
-- `destinataire_id`. On la lit dans les deux sens (`WHERE demandeur = ? OR
-- destinataire = ?`) — deux index plutôt qu'une ligne en double, qu'il faudrait
-- garder cohérente à chaque changement d'état.
--
-- Refuser **supprime** la ligne au lieu de la marquer : sans quoi un refus
-- interdirait pour toujours de se redemander, ce qui est un blocage, et le
-- blocage n'a pas été demandé. Redemander à quelqu'un qui a refusé reste
-- possible ; c'est le même geste que la première fois.

CREATE TABLE IF NOT EXISTS amities (
  demandeur_id    TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  destinataire_id TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  -- 'en_attente' | 'acceptee'. Un refus efface la ligne (voir ci-dessus).
  etat            TEXT    NOT NULL DEFAULT 'en_attente',
  cree_le         INTEGER NOT NULL,
  repondu_le      INTEGER,
  PRIMARY KEY (demandeur_id, destinataire_id)
);

-- « Qui m'a demandé » et « à qui ai-je demandé » sont les deux questions de
-- chaque ouverture du rail ; sans ces index elles balaieraient la table.
CREATE INDEX IF NOT EXISTS idx_amities_destinataire ON amities(destinataire_id);
CREATE INDEX IF NOT EXISTS idx_amities_demandeur ON amities(demandeur_id);

-- ── Le droit sur un partage ─────────────────────────────────────────────────
--
-- La migration 0007 disait : « Il n'y a pas de colonne "droit" et il n'y en
-- aura pas ». La raison donnée était juste — « deux personnes qui écrivent dans
-- le même document sans que rien n'arbitre entre elles » — et c'est cette
-- raison-là qui a été levée, pas la prudence qui l'accompagnait : depuis le lot
-- 23.D, `ecrireDocument` porte un verrou de révision, et refuse une écriture
-- fondée sur une lecture périmée au lieu d'écraser celle de l'autre.
--
-- `'lecture'` par défaut : toutes les lignes existantes gardent exactement le
-- droit qu'elles avaient, et un partage créé sans rien préciser reste ce qu'il
-- a toujours été.

ALTER TABLE partages ADD COLUMN droit TEXT NOT NULL DEFAULT 'lecture';
