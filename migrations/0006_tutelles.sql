-- Lot 11.A : deux étages d'administration.
--
-- Jusqu'ici il n'y avait qu'un rôle au-dessus de `membre` : `admin`, qui
-- pouvait tout, sur tout le monde. Une table de jeu n'a pas besoin de ça — le
-- maître de jeu doit pouvoir suivre ses joueurs à lui sans hériter du pouvoir
-- d'effacer un compte ou d'en remplacer le mot de passe.
--
-- D'où un rôle intermédiaire, `intendant`, et une table qui dit **de qui** il
-- répond. Sans ligne dans `tutelles`, un intendant ne voit rien : le périmètre
-- vide est le point de départ, pas une exception.
--
-- Le rôle lui-même vit toujours dans `utilisateurs.role`, colonne TEXT sans
-- contrainte — on n'ajoute donc rien pour lui. `admin` reste ce qu'il était et
-- continue de se donner en SQL : aucune route ne l'accorde.

CREATE TABLE IF NOT EXISTS tutelles (
  intendant_id   TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  utilisateur_id TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le        INTEGER NOT NULL,
  -- Qui a confié ce compte. Le souverain peut disparaître sans emporter la
  -- tutelle avec lui : c'est une trace, pas une dépendance.
  pose_par       TEXT,
  PRIMARY KEY (intendant_id, utilisateur_id)
);

-- « De qui cet intendant répond-il » est la question de chaque requête ; « qui
-- veille sur ce compte » ne se pose qu'en affichage, mais sans cet index elle
-- balaierait la table.
CREATE INDEX IF NOT EXISTS idx_tutelles_utilisateur ON tutelles(utilisateur_id);
