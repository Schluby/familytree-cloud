/**
 * Fabrique un arbre de N fiches, pour mesurer plutôt que supposer.
 *
 *   node outils/gros-arbre.mjs 500 > gros.json
 *
 * Le plan annonce un repli si `/api/vue/sociogramme` dépasse le budget de CPU
 * sur un gros arbre. Encore faut-il un gros arbre : la vraie campagne en fait
 * 72, et rien ne dit qu'elle grossira avant qu'on ait besoin de savoir.
 *
 * Ce que le générateur imite, parce que c'est ce qui coûte cher :
 * des générations profondes (le calcul des générations fait plusieurs passes),
 * des fratries nombreuses (elles sont déduites par paires, donc quadratiques
 * dans une fratrie), et des liens sociaux en travers.
 */

const COMBIEN = Number.parseInt(process.argv[2] ?? '500', 10);
const MAISONS = ['stark', 'lannister', 'targaryen', 'tyrell', 'martell', 'greyjoy', 'autre'];
const STATUTS = ['vivant', 'mort', 'inconnu'];

const personnes = [];
const relations = [];

let compteur = 0;
function ajouter(generation) {
  const id = `p${compteur}`;
  personnes.push({
    id,
    prenom: `Prenom${compteur}`,
    nom: `Nom${compteur % 40}`,
    surnom: compteur % 5 === 0 ? `le ${compteur}e` : '',
    maison: MAISONS[compteur % MAISONS.length],
    titres: compteur % 3 === 0 ? [`Titre ${compteur}`, 'Second titre'] : [],
    genre: compteur % 2 === 0 ? 'M' : 'F',
    statut: STATUTS[compteur % STATUTS.length],
    naissance: `${200 + generation * 20} AC`,
    deces: compteur % 4 === 0 ? `${260 + generation * 20} AC` : null,
    lieu: `Lieu ${compteur % 25}`,
    importance: (compteur % 5) + 1,
    avatar: null,
    couleur: null,
    notes: `Note de la fiche ${compteur}. `.repeat(3),
    tags: compteur % 2 === 0 ? ['tag-a', `tag-${compteur % 7}`] : [],
    relations_joueurs: {
      j1: { note: (compteur % 7) + 1, commentaire: '' },
      j2: { note: ((compteur * 3) % 7) + 1, commentaire: 'vu une fois' },
    },
    decalage: null,
    generation: null,
  });
  compteur += 1;
  return id;
}

// Huit générations, chacune trois fois plus peuplée que la précédente jusqu'à
// atteindre le compte demandé.
const parGeneration = [];
let restant = COMBIEN;
for (let generation = 0; generation < 8 && restant > 0; generation += 1) {
  const taille = Math.min(restant, Math.max(2, Math.round(COMBIEN / 8) + generation * 3));
  parGeneration.push(Array.from({ length: taille }, () => ajouter(generation)));
  restant -= taille;
}

// Filiations : chaque fiche d'une génération descend de deux fiches de la
// précédente, ce qui fabrique des fratries larges — le cas coûteux.
for (let g = 1; g < parGeneration.length; g += 1) {
  const parents = parGeneration[g - 1];
  const enfants = parGeneration[g];
  enfants.forEach((enfant, index) => {
    const pere = parents[index % parents.length];
    const mere = parents[(index + 1) % parents.length];
    relations.push(lien(`f${relations.length}`, pere, enfant, 'parent'));
    relations.push(lien(`f${relations.length}`, mere, enfant, 'parent'));
  });
}

// Unions et liens sociaux en travers des générations.
for (const groupe of parGeneration) {
  for (let i = 0; i + 1 < groupe.length; i += 4) {
    relations.push(lien(`u${relations.length}`, groupe[i], groupe[i + 1], 'conjoint'));
  }
}
for (let i = 0; i + 7 < personnes.length; i += 7) {
  relations.push(
    lien(`s${relations.length}`, personnes[i].id, personnes[i + 7].id, i % 2 ? 'ami' : 'nemesis')
  );
}

function lien(id, source, cible, type) {
  return {
    id,
    source,
    cible,
    type,
    humeur: (id.length + source.length) % 7 || 4,
    label: '',
    notes: '',
    secret: id.endsWith('3'),
    dirige: null,
    depuis: null,
    jusqu_a: null,
  };
}

const document = {
  meta: {
    titre: `Arbre de mesure (${personnes.length} fiches)`,
    description: 'Genere par outils/gros-arbre.mjs — sert a mesurer, pas a jouer.',
    version: 1,
    sauvegarde: `Mesure ${personnes.length}`,
    schema: 2,
  },
  types_relations: {
    parent: { label: 'Filiation', couleur: '#8a94a0', dirige: true, categorie: 'famille', style: 'solide', ordre: 1 },
    conjoint: { label: 'Union', couleur: '#b08968', dirige: false, categorie: 'famille', style: 'solide', ordre: 2 },
    fratrie: { label: 'Fratrie', couleur: '#a3b18a', dirige: false, categorie: 'famille', style: 'tirets', ordre: 3 },
    ami: { label: 'Amitié', couleur: '#5fa8d3', dirige: false, categorie: 'social', style: 'solide', ordre: 5 },
    nemesis: { label: 'Némésis', couleur: '#d64545', dirige: false, categorie: 'social', style: 'solide', ordre: 6 },
  },
  maisons: Object.fromEntries(
    MAISONS.map((cle, index) => [
      cle,
      { label: cle[0].toUpperCase() + cle.slice(1), couleur: '#7a7f87', devise: '', categorie: index < 3 ? 'grandes' : '' },
    ])
  ),
  categories: { grandes: { label: 'Grandes maisons', couleur: '#3f6f9f', ordre: 0 } },
  filtres: {},
  listes: {},
  joueurs: [
    { id: 'j1', nom: 'Joueur 1', personnage: '', couleur: '#d64545', personne_id: 'p0' },
    { id: 'j2', nom: 'Joueur 2', personnage: '', couleur: '#5fa8d3', personne_id: '' },
  ],
  personnes,
  relations,
};

process.stdout.write(JSON.stringify(document));
