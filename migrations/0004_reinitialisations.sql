-- Lot 8.G : « mot de passe oublié ».
--
-- Un jeton à usage unique, daté, envoyé par courriel. On ne garde que son
-- **empreinte** : une base volée ne donne pas de quoi fabriquer un lien
-- valide, exactement comme pour les sessions et les codes de secours.
--
-- Le compte n'est pas touché tant que le jeton n'a pas servi : demander une
-- réinitialisation ne doit rien casser pour quelqu'un qui se souvient
-- finalement de son mot de passe. Et **les sauvegardes ne sont jamais
-- concernées** — elles pendent à `utilisateurs.id`, qui ne change pas.

CREATE TABLE IF NOT EXISTS reinitialisations (
  jeton_empreinte TEXT PRIMARY KEY,            -- SHA-256 du jeton, jamais le jeton
  utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le         INTEGER NOT NULL,
  expire_le       INTEGER NOT NULL,
  utilise_le      INTEGER                      -- non nul = déjà servi, refusé
);

-- Le ménage nocturne balaie par date ; la révocation d'un compte, par compte.
CREATE INDEX IF NOT EXISTS idx_reinit_expire ON reinitialisations(expire_le);
CREATE INDEX IF NOT EXISTS idx_reinit_utilisateur ON reinitialisations(utilisateur_id);
