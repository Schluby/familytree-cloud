-- Lot 16 : une note du carnet s'envoie à un autre compte.
--
-- **Pourquoi une table, alors que le carnet vit dans le document.** Une note
-- offerte n'appartient encore à personne : ni à celui qui l'envoie — il garde
-- la sienne, intacte — ni à celui qui la reçoit, qui n'a rien accepté. La
-- ranger dans l'un des deux documents serait décider à sa place. Elle attend
-- donc ici, entre les deux, et n'entre dans un monde qu'au moment du oui.
--
-- **Pourquoi le texte est recopié.** Pointer vers la note d'origine ferait
-- d'une offre un lien vivant : l'expéditeur corrigerait sa note et changerait
-- ce que l'autre a accepté, ou l'effacerait et laisserait un trou. Une offre
-- est une **copie datée** — ce qui a été proposé est ce qui sera reçu.
--
-- **`glossaire`.** Les balises d'une note (`@p:eddard-stark`) désignent des
-- fiches du monde de l'expéditeur, et le destinataire a les siennes, avec
-- d'autres identifiants. Le glossaire dit, pour chaque balise, le nom que
-- l'expéditeur lui donnait — c'est avec ça que l'acceptation retrouve la fiche
-- correspondante chez le destinataire, et à défaut écrit le nom en clair.
-- JSON dans une colonne : cette liste n'est jamais interrogée, seulement lue
-- en entier au moment d'accepter.
--
-- Pas de colonne d'état. Une offre acceptée ou refusée disparaît : la table
-- **est** la boîte de réception, et ce qu'elle contient est exactement ce qui
-- attend une réponse.

CREATE TABLE notes_offertes (
  id             TEXT PRIMARY KEY,
  -- Qui envoie, qui reçoit. `ON DELETE CASCADE` des deux côtés : un compte
  -- supprimé n'a plus rien à proposer, et plus personne à qui proposer.
  de_id          TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  vers_id        TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  -- Le monde d'où elle vient, pour le dire au destinataire. Pas de clef
  -- étrangère : la sauvegarde peut disparaître sans que l'offre perde son sens.
  origine_nom    TEXT NOT NULL DEFAULT '',
  titre          TEXT NOT NULL DEFAULT '',
  corps          TEXT NOT NULL DEFAULT '',
  -- Le titre du chapitre chez l'expéditeur, pas son identifiant : chez le
  -- destinataire, ce chapitre n'existe pas, et c'est un nom qu'on lui montre.
  chapitre_titre TEXT NOT NULL DEFAULT '',
  glossaire      TEXT NOT NULL DEFAULT '[]',
  cree_le        INTEGER NOT NULL
);

-- La boîte de réception, c'est cette requête-là : ce qui m'attend, du plus
-- récent au plus ancien.
CREATE INDEX idx_notes_offertes_vers ON notes_offertes(vers_id, cree_le DESC);
-- Et pour savoir ce que j'ai proposé qui n'a pas encore eu de réponse.
CREATE INDEX idx_notes_offertes_de ON notes_offertes(de_id);
