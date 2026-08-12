-- Lot 10.C : la connexion Google.
--
-- Une seule colonne : l'identifiant stable que Google donne à un compte (son
-- `sub`). **On ne se lie pas par l'adresse seule** — une adresse peut être
-- libérée puis réattribuée, et un `sub` ne l'est jamais. L'adresse sert au
-- premier rapprochement (« ce Google-là est déjà inscrit chez nous »), le `sub`
-- à tous les suivants.
--
-- Elle est nullable et sans valeur par défaut : les comptes existants n'ont
-- rien à Google, et ne doivent rien y gagner. `UNIQUE` parce qu'un même compte
-- Google ne peut pas ouvrir deux comptes ici — sinon la deuxième connexion
-- choisirait au hasard.
--
-- SQLite n'accepte pas `ADD COLUMN ... UNIQUE` : l'unicité passe donc par un
-- index, ce qui revient exactement au même et se relit mieux.

ALTER TABLE utilisateurs ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisateurs_google
  ON utilisateurs(google_sub) WHERE google_sub IS NOT NULL;
