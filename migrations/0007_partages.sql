-- Lot 11.B : un arbre montré aux autres, en lecture seule.
--
-- **Ce que ça n'est pas.** `meta.document` — le « lien de campagne » du lot 9 —
-- est une simple adresse http(s) rangée dans une sauvegarde, qui met un bouton
-- 📜 dans la barre du haut. Elle ouvre un document hébergé ailleurs. Elle ne
-- partage rien, ne donne accès à rien, et l'arbre reste strictement privé.
--
-- **Ce que c'est.** Le maître de jeu tient un arbre de référence ; ses joueurs
-- doivent le **voir** — le vrai, celui qu'il modifie, pas une copie qui
-- vieillit dès qu'il y touche — sans pouvoir l'écrire. Une seule sauvegarde,
-- plusieurs lecteurs.
--
-- La table ne dit qu'une chose : « ce compte a le droit de lire cet arbre ».
-- Il n'y a pas de colonne « droit » et il n'y en aura pas : un partage en
-- écriture, ce serait deux personnes qui écrivent dans le même document sans
-- que rien n'arbitre entre elles, et le verrou de révision n'a jamais été
-- conçu pour ça. La procuration (lot 8.F) reste la seule écriture chez autrui,
-- et elle est journalisée.

CREATE TABLE IF NOT EXISTS partages (
  sauvegarde_id  TEXT    NOT NULL REFERENCES sauvegardes(id) ON DELETE CASCADE,
  utilisateur_id TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le        INTEGER NOT NULL,
  -- Qui a ouvert l'accès. En pratique le propriétaire ; gardé en trace, pas en
  -- dépendance, pour la même raison que `tutelles.pose_par`.
  pose_par       TEXT,
  PRIMARY KEY (sauvegarde_id, utilisateur_id)
);

-- « Qu'est-ce qu'on m'a partagé » est la question de chaque chargement de
-- l'application ; sans cet index elle balaierait la table.
CREATE INDEX IF NOT EXISTS idx_partages_utilisateur ON partages(utilisateur_id);
