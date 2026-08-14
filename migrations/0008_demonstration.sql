-- Lot 14 : le monde de départ devient une démonstration.
--
-- **Le constat qui a déclenché ce lot.** Au 14/08/2026, la base pesait
-- 3 133 838 octets, dont 2 937 472 en 32 copies **identiques et jamais
-- touchées** du même Westeros — 94 % de tout ce qui est stocké. Sur 45
-- comptes, 37 étaient des essais sans compte, chacun reparti avec ses 90 Ko.
-- Autrement dit : le service stockait presque exclusivement son propre cadeau,
-- et les chiffres d'administration (poids, fiches, liens, doublons) parlaient
-- de Westeros plutôt que du travail des gens.
--
-- D'où une colonne, et une seule : `demo`. Ce qui la porte n'est plus une
-- sauvegarde de quelqu'un mais un terrain d'essai commun — il ne compte ni
-- dans les plafonds, ni dans « Vos données », ni dans le panorama de
-- l'administration, et **son contenu n'est pas conservé** : il n'existe en
-- base que si l'on y a écrit, et il repart à zéro à l'ouverture de session
-- comme au ménage de la nuit (voir `src/depart/index.ts`).
--
-- Cette migration est **additive et non destructive**, comme toutes les
-- autres : elle ajoute la colonne et pose le drapeau. Elle n'efface aucun
-- contenu — c'est le chemin ordinaire de remise à zéro qui s'en chargera, et
-- lui seul, parce qu'un effacement doit passer par du code relu plutôt que par
-- un `DELETE` de migration qu'on ne rejoue jamais.

ALTER TABLE sauvegardes ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;

-- Le drapeau posé sur l'existant, avec **une garde qui ne se discute pas** :
-- `revision = 1`. La révision n'avance que dans `ecrireDocument`, l'unique
-- point d'écriture du document ; une sauvegarde restée à 1 n'a donc jamais été
-- modifiée depuis sa création. Elle est, mot pour mot, le cadeau de départ.
--
-- Les deux Westeros que quelqu'un a réellement travaillés (révisions 5 et 8 au
-- 14/08) gardent `demo = 0` : ce sont des mondes à eux, ils comptent, ils se
-- sauvegardent, et rien de ce lot ne les touche.
UPDATE sauvegardes SET demo = 1 WHERE nom = 'Westeros' AND revision = 1;
