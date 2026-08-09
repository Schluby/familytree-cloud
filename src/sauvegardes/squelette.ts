/**
 * Le document d'une sauvegarde créée de zéro.
 *
 * Port fidèle de `SQUELETTE` (`backend/bibliotheque.py` de l'application
 * locale) : volontairement générique — aucune maison, aucun personnage — mais
 * avec de quoi tracer un lien dès le premier profil.
 *
 * Une seule différence assumée : `meta.schema` vaut d'emblée la version
 * courante. En local, un document sans `schema` est migré au chargement par
 * `migrations.py` ; ici il n'y a personne pour le faire au lot 2, donc on écrit
 * directement le format d'aujourd'hui.
 */

/** `meta.schema` de la version locale (`migrations.SCHEMA`). */
export const SCHEMA_COURANT = 2;

const MODELE = {
  meta: { titre: 'Nouvel univers', description: '', version: 1, schema: SCHEMA_COURANT },
  types_relations: {
    parent: {
      label: 'Filiation',
      label_sortant: 'Parent de',
      label_entrant: 'Enfant de',
      couleur: '#8a94a0',
      dirige: true,
      categorie: 'famille',
      style: 'solide',
      ordre: 1,
    },
    conjoint: {
      label: 'Union',
      couleur: '#b08968',
      dirige: false,
      categorie: 'famille',
      style: 'solide',
      ordre: 2,
    },
    fratrie: {
      label: 'Fratrie',
      couleur: '#a3b18a',
      dirige: false,
      categorie: 'famille',
      style: 'tirets',
      ordre: 3,
    },
    amant: {
      label: 'Liaison',
      couleur: '#cf7fa5',
      dirige: false,
      categorie: 'famille',
      style: 'pointille',
      ordre: 4,
    },
    ami: {
      label: 'Amitié',
      couleur: '#5fa8d3',
      dirige: false,
      categorie: 'social',
      style: 'solide',
      ordre: 5,
    },
    nemesis: {
      label: 'Némésis',
      couleur: '#d64545',
      dirige: false,
      categorie: 'social',
      style: 'solide',
      ordre: 6,
    },
    mentor: {
      label: 'Mentorat',
      label_sortant: 'Mentor de',
      label_entrant: 'Élève de',
      couleur: '#b58df1',
      dirige: true,
      categorie: 'social',
      style: 'solide',
      ordre: 7,
    },
    allie: {
      label: 'Alliance',
      couleur: '#52b788',
      dirige: false,
      categorie: 'politique',
      style: 'solide',
      ordre: 8,
    },
    autre: {
      label: 'Autre lien',
      couleur: '#8a8f98',
      dirige: false,
      categorie: 'autre',
      style: 'pointille',
      ordre: 9,
    },
  },
  maisons: { autre: { label: 'Sans maison', couleur: '#7a7f87', devise: '' } },
  joueurs: [] as unknown[],
  personnes: [] as unknown[],
  relations: [] as unknown[],
};

/** Une copie neuve à chaque appel : l'appelant a le droit de la modifier. */
export function squelette(): Record<string, unknown> {
  return structuredClone(MODELE) as unknown as Record<string, unknown>;
}
