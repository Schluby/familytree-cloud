-- Lot 27.D : un mot aux autres, qui ne se garde pas.
--
-- Demandé tel quel : « un truc qui permette d'envoyer des msg aux autres (pas
-- une messagerie), juste une petite popup temporaire qui permet d'envoyer des
-- msg et qui ne sont pas stockés ». Les derniers mots sont la spécification
-- entière : ce que cette table contient à un instant donné n'a jamais plus de
-- trois minutes, et il n'existe **aucun** endroit où consulter ce qui a expiré.
--
-- ── Pourquoi pas un Durable Object, pas un WebSocket ────────────────────────
--
-- Le besoin tient en une phrase — se faire signe entre deux personnes qui
-- regardent le même arbre, le temps d'une poignée de minutes. Un canal
-- persistant demanderait une nouvelle liaison dans `wrangler.jsonc`, une
-- nouvelle classe de pannes (une connexion qui tombe, un objet qui ne répond
-- plus) et un coût qui n'existe pas aujourd'hui — pour un besoin que
-- l'interrogation périodique, déjà partout ailleurs dans ce projet, couvre
-- très bien. On reste sur D1.
--
-- ── La péremption est la seule règle de conservation ────────────────────────
--
-- Pas de colonne d'état, pas de corbeille, pas de tâche de purge différée : un
-- message porte sa propre date de péremption (`expire_le`, trois minutes
-- après sa création), et une ligne devenue périmée est effacée par la
-- **prochaine** lecture ou écriture de n'importe qui sur cette table — pas
-- seulement sur la sauvegarde de la requête en cours, puisqu'un message
-- périmé n'intéresse plus personne, d'où qu'il vienne. Il n'y a donc jamais de
-- tâche de fond à programmer, et rien à consulter plus tard : c'est le sens
-- exact de « pas stockés ». Voir `src/messages/domaine.ts` (`purger`) pour le
-- déclenchement.
--
-- ── Qui peut écrire à qui ────────────────────────────────────────────────────
--
-- « Les autres », c'est qui voit le même monde : le propriétaire de la
-- sauvegarde, et les comptes de `partages` (migration 0007, droit étendu en
-- 0011) pour cette sauvegarde — lecteur ou rédacteur, peu importe, un lecteur
-- voit le même plan qu'un rédacteur et a tout autant de raison d'y glisser un
-- mot. C'est la question que `src/partages/routes.ts` (`parPartage`) pose déjà
-- pour ouvrir un arbre à sa lecture ; `src/messages/domaine.ts` (`acces`) pose
-- la même condition en SQL — elle ne l'importe pas, chaque lot restant dans
-- son périmètre de fichiers, mais elle n'en invente pas une seconde non plus.

CREATE TABLE messages_volants (
  id              TEXT    PRIMARY KEY,
  sauvegarde_id   TEXT    NOT NULL REFERENCES sauvegardes(id) ON DELETE CASCADE,
  auteur_id       TEXT    NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  -- NULL = à tout le monde autour de cette sauvegarde. Une valeur précise
  -- désigne un seul destinataire, vérifié côté serveur à l'envoi (il doit lui
  -- aussi voir cette sauvegarde) et à la lecture (on ne rend que ce qui
  -- m'est destiné, jamais ce que j'ai écrit moi-même).
  destinataire_id TEXT    REFERENCES utilisateurs(id) ON DELETE CASCADE,
  texte           TEXT    NOT NULL,
  cree_le         INTEGER NOT NULL,
  expire_le       INTEGER NOT NULL
);

-- Sert la seule requête de lecture qui compte : « qu'est-ce qui m'attend sur
-- cette sauvegarde, et qui n'a pas encore expiré » — égalité sur
-- `sauvegarde_id`, intervalle sur `expire_le`. La purge, elle, balaie toute la
-- table sans filtrer par sauvegarde (voir plus haut) : elle n'a pas besoin de
-- cet index, et il n'y en a pas d'autre à ajouter pour elle — cette table ne
-- contient jamais plus de quelques minutes d'activité de tout le service.
CREATE INDEX idx_messages_volants_sauvegarde ON messages_volants(sauvegarde_id, expire_le);
