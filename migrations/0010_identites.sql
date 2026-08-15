-- Lot 17.A — Ce que l'intendant a tranché sur l'identité des fiches.
--
-- Le rapprochement automatique propose ; il ne conclut pas. Cette table garde
-- les deux verdicts que seul un humain peut rendre :
--
--   'meme'      — « ces deux fiches sont la même personne », même si rien dans
--                 leurs noms ne le disait.
--   'distincte' — « non, ce sont deux personnes », et le rapprochement ne doit
--                 plus jamais les réunir. C'est le verdict qui compte le plus :
--                 dans le monde livré, « Brandon Stark » désigne deux
--                 personnages, et aucun seuil de ressemblance ne le devinera.
--
-- La paire est rangée `gauche < droite` avant l'écriture, et l'unicité porte
-- sur la paire : une paire n'a qu'un verdict, et le changer le remplace.
--
-- Les références sont de la forme `<compte_id>/<personne_id>` et non
-- `<sauvegarde_id>/<personne_id>`. C'est un choix : le plan collectif ne
-- regarde qu'un monde par compte (le sien, celui qu'il a ouvert), et un
-- verdict posé sur une campagne reste vrai sur la suivante — les identifiants
-- viennent tous du même Westeros de départ. Clé par sauvegarde, il aurait fallu
-- retrancher la même chose après chaque « Enregistrer sous ».
--
-- Pas de colonne `intendant_id` : la question « ces deux fiches sont-elles la
-- même personne ? » a la même réponse pour tout le monde. Qui l'a tranchée est
-- gardé dans `pose_par`, pour qu'on puisse le demander.

CREATE TABLE IF NOT EXISTS identites (
  id       TEXT PRIMARY KEY,
  gauche   TEXT NOT NULL,
  droite   TEXT NOT NULL,
  verdict  TEXT NOT NULL,
  pose_par TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identites_paire ON identites(gauche, droite);
CREATE INDEX IF NOT EXISTS idx_identites_droite ON identites(droite);
