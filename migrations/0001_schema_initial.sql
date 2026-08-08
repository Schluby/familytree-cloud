-- Migration 0001 — schéma initial de FamilyTree Cloud
--
-- Appliquée par :
--   npm run base:local   (base D1 locale, pour développer)
--   npm run base:ligne   (base en ligne — fait aussi automatiquement au déploiement)
--
-- Règle qui ne se relâche jamais : toute lecture de sauvegarde passe par
-- `utilisateur_id`. Les index sont posés pour que ce soit aussi le chemin le
-- plus rapide, pas seulement le plus sûr.
--
-- Les migrations sont **additives** : on ne modifie jamais ce fichier une fois
-- qu'il a tourné en ligne, on en ajoute un 0002. C'est ce qui permet de
-- déployer d'un simple « git push » sans jamais casser la base.
--
-- (Pas de « PRAGMA foreign_keys = ON » ici : D1 applique déjà les clés
-- étrangères, et les PRAGMA sont refusés dans une migration.)

-- --------------------------------------------------------------------------
-- Comptes
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS utilisateurs (
  id             TEXT PRIMARY KEY,            -- uuid v4
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL UNIQUE,        -- minuscules, sans espaces : la clé d'unicité
  mot_de_passe   TEXT NOT NULL,               -- pbkdf2 : "sel$empreinte", en base64
  nom_affiche    TEXT NOT NULL DEFAULT '',
  -- 'membre' ou 'admin'. Un admin voit tous les arbres, en lecture seule, par
  -- une surface d'API séparée (/api/admin/*). Le rôle ne se change pas depuis
  -- l'interface : le premier admin se promeut en SQL.
  role           TEXT NOT NULL DEFAULT 'membre',
  -- Empreinte du code de secours montré une fois à l'inscription : sans
  -- courriel, c'est la seule façon de récupérer un compte soi-même.
  code_secours   TEXT,
  -- Plafond de stockage, relevable au cas par cas par un admin (octets).
  plafond_octets INTEGER NOT NULL DEFAULT 2097152,
  plafond_sauvegardes INTEGER NOT NULL DEFAULT 10,
  cree_le        INTEGER NOT NULL,            -- epoch en secondes
  dernier_acces  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_utilisateurs_role ON utilisateurs(role);

-- Le jeton n'est jamais stocké en clair : une fuite de cette table ne donne
-- aucune session utilisable.
CREATE TABLE IF NOT EXISTS sessions (
  jeton_hache     TEXT PRIMARY KEY,           -- sha-256 du jeton du cookie
  utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le         INTEGER NOT NULL,
  expire_le       INTEGER NOT NULL,
  agent           TEXT DEFAULT ''             -- pour que l'utilisateur reconnaisse ses appareils
);

CREATE INDEX IF NOT EXISTS idx_sessions_utilisateur ON sessions(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expire      ON sessions(expire_le);

-- Freine le bourrinage et l'inscription en série : un compteur par e-mail et
-- par adresse. L'inscription étant ouverte, c'est le seul rempart contre la
-- création de comptes à la chaîne.
CREATE TABLE IF NOT EXISTS tentatives (
  cle          TEXT PRIMARY KEY,              -- "connexion:email:<...>", "inscription:ip:<...>"
  echecs       INTEGER NOT NULL DEFAULT 0,
  dernier_le   INTEGER NOT NULL
);

-- Toute consultation, par un admin, d'un arbre qui n'est pas le sien laisse
-- une trace. Protège l'utilisateur — et l'administrateur.
CREATE TABLE IF NOT EXISTS journal_admin (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id        TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,               -- 'consultation', 'export', 'reinitialisation'…
  cible_utilisateur TEXT,
  cible_sauvegarde  TEXT,
  le              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_admin_date ON journal_admin(le DESC);

-- --------------------------------------------------------------------------
-- Sauvegardes
-- --------------------------------------------------------------------------

-- Les métadonnées seules : lister ses mondes ne doit pas lire leur contenu.
CREATE TABLE IF NOT EXISTS sauvegardes (
  id              TEXT PRIMARY KEY,           -- uuid v4
  utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  nom             TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 2, -- meta.schema du document
  personnes       INTEGER NOT NULL DEFAULT 0, -- compteurs d'affichage, recalculés à l'écriture
  relations       INTEGER NOT NULL DEFAULT 0,
  taille          INTEGER NOT NULL DEFAULT 0, -- octets du JSON, pour le garde-fou
  cree_le         INTEGER NOT NULL,
  modifie_le      INTEGER NOT NULL            -- sert aussi de verrou optimiste
);

CREATE INDEX IF NOT EXISTS idx_sauvegardes_utilisateur
  ON sauvegardes(utilisateur_id, modifie_le DESC);

-- Le document lui-même, à part.
CREATE TABLE IF NOT EXISTS contenus (
  sauvegarde_id  TEXT PRIMARY KEY REFERENCES sauvegardes(id) ON DELETE CASCADE,
  donnees        TEXT NOT NULL                -- le JSON complet, tel que l'application locale l'écrit
);

-- Copies datées, comme les instantanés du bureau.
CREATE TABLE IF NOT EXISTS instantanes (
  id             TEXT PRIMARY KEY,
  sauvegarde_id  TEXT NOT NULL REFERENCES sauvegardes(id) ON DELETE CASCADE,
  libelle        TEXT NOT NULL DEFAULT '',
  cree_le        INTEGER NOT NULL,
  taille         INTEGER NOT NULL DEFAULT 0,
  donnees        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instantanes_sauvegarde
  ON instantanes(sauvegarde_id, cree_le DESC);

-- --------------------------------------------------------------------------
-- Pas de table de photos : la version hébergée ne prend pas les portraits
-- (décision du 06/08/2026). Le champ `avatar` du document reste accepté s'il
-- contient une adresse http(s) — le navigateur va la chercher, ça ne coûte
-- rien en stockage — et une valeur `data:` est retirée à l'import.
-- --------------------------------------------------------------------------
