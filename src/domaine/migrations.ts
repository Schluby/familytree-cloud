/**
 * Mises à niveau d'une sauvegarde à l'ouverture.
 *
 * Port de `backend/migrations.py`. À ne pas confondre avec `migrations/` à la
 * racine, qui fait évoluer le **schéma D1** : ici c'est le **document** d'une
 * sauvegarde qu'on met à niveau, et il appartient à son propriétaire.
 *
 * Une sauvegarde est un fichier que son propriétaire garde des mois : le format
 * bouge, pas le fichier. On applique donc les conversions au chargement, guidé
 * par `meta.schema`.
 *
 * Règles : jamais destructif (ce qu'on ne sait pas convertir reste écrit tel
 * quel), et idempotent — relancer une migration déjà faite ne doit rien changer.
 */

import { CONVERSION_NOTE_HERITEE, DEFAUT } from './humeur';
import { versEntier } from './python';

export const SCHEMA = 2;

type Objet = Record<string, unknown>;

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

export function schemaDe(meta: unknown): number {
  if (!estObjet(meta)) return 1;
  const brut = meta.schema;
  if (brut === null || brut === undefined || brut === '') return 1;
  return versEntier(brut) ?? 1;
}

/**
 * Migre le document *avant* qu'il ne devienne un `Dataset`.
 * Renvoie `true` si quelque chose a bougé (la sauvegarde mérite d'être réécrite).
 */
export function appliquer(donnees: Objet): boolean {
  if (!estObjet(donnees.meta)) donnees.meta = {};
  const meta = donnees.meta as Objet;

  if (schemaDe(meta) >= SCHEMA) return false;

  versHumeur(donnees);
  meta.schema = SCHEMA;
  return true;
}

/**
 * Schéma 1 → 2 : l'intensité des liens devient une humeur.
 *
 * Les liens repartent tous à « Indifférent » : l'ancienne intensité disait la
 * *force* du lien, pas la disposition, et rien ne permet de deviner si un lien
 * fort était de l'amour ou de la haine. La valeur d'origine reste dans le
 * document (elle atterrit dans `extra`), au cas où.
 *
 * Les notes envers les joueurs, elles, disaient bien une disposition : on les
 * convertit, en retournant le sens au passage.
 */
function versHumeur(donnees: Objet): void {
  const relations = donnees.relations;
  if (Array.isArray(relations)) {
    for (const relation of relations) {
      if (estObjet(relation) && !('humeur' in relation)) relation.humeur = DEFAUT;
    }
  }

  const personnes = donnees.personnes;
  if (!Array.isArray(personnes)) return;

  for (const personne of personnes) {
    if (!estObjet(personne)) continue;
    const notes = personne.relations_joueurs;
    if (!estObjet(notes)) continue;

    for (const [joueurId, brut] of Object.entries(notes)) {
      let valeur: Objet;
      let ancienne: unknown;

      if (estObjet(brut)) {
        valeur = brut;
        ancienne = brut.note;
      } else {
        ancienne = brut;
        valeur = { note: ancienne, commentaire: '' };
        notes[joueurId] = valeur;
      }

      const entier = versEntier(ancienne);
      if (entier === null) continue;
      valeur.note = CONVERSION_NOTE_HERITEE[entier] ?? DEFAUT;
    }
  }
}
