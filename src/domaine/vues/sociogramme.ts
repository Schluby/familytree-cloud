/**
 * Vue « sociogramme » — port de `backend/views/sociogramme.py`.
 *
 * Cartes des personnes reliées par génération. Payload produit (rendu =
 * « cartes ») :
 *
 *     {
 *       "vue": "sociogramme", "rendu": "cartes",
 *       "noeuds":  [ {id, label, generation, couleur, …} ],
 *       "aretes":  [ {id, source, cible, type, role, couleur, dirige, …} ],
 *       "legende": {"types": [...], "maisons": [...]},
 *       "formes":  [ {id, genre, x, y, l, h, trait, epaisseur, fond, texte, …} ],
 *       "stats":   {...}
 *     }
 *
 * Le champ `role` (filiation / union / fratrie / social) dit au moteur de rendu
 * comment tracer le lien : connecteur orthogonal de descendance, barre de
 * couple, ou trait pointillé de relation sociale.
 */

import * as formesDeFond from '../formes';
import * as humeur from '../humeur';
import {
  TYPES_UNION,
  appliquerSurcharges,
  calculerGenerations,
  clePaire,
} from '../genealogie';
import { Dataset, Relation, type Objet } from '../models';
import { arrondir } from '../python';
import {
  Vue,
  lireBool,
  lireEntier,
  lireListe,
  lireTexte,
  noeudMinimal,
  type Parametres,
} from './base';

function role(typeRelation: string): string {
  if (typeRelation === 'parent') return 'filiation';
  if ((TYPES_UNION as readonly string[]).includes(typeRelation)) return 'union';
  if (typeRelation === 'fratrie') return 'fratrie';
  return 'social';
}

/** Crée les liens de fratrie implicites (deux enfants d'un même parent). */
function fratrieDeduite(relations: Relation[]): Relation[] {
  const enfantsParParent = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.type !== 'parent') continue;
    const liste = enfantsParParent.get(rel.source);
    if (liste) liste.push(rel.cible);
    else enfantsParParent.set(rel.source, [rel.cible]);
  }

  const existantes = new Set(
    relations.filter((r) => r.type === 'fratrie').map((r) => clePaire(r.source, r.cible))
  );

  const deduites: Relation[] = [];
  const vues = new Set<string>();

  for (const enfants of enfantsParParent.values()) {
    const uniques = [...new Set(enfants)].sort();
    for (let i = 0; i < uniques.length; i += 1) {
      for (let j = i + 1; j < uniques.length; j += 1) {
        const a = uniques[i] as string;
        const b = uniques[j] as string;
        const paire = clePaire(a, b);
        if (existantes.has(paire) || vues.has(paire)) continue;
        vues.add(paire);

        const relation = new Relation();
        relation.id = `auto-fratrie-${a}-${b}`;
        relation.source = a;
        relation.cible = b;
        relation.type = 'fratrie';
        relation.label = '';
        relation.notes = "Lien déduit d'un parent commun.";
        relation.extra = { deduit: true };
        deduites.push(relation);
      }
    }
  }
  return deduites;
}

/** Humeur moyenne envers la table — 1 la meilleure, 7 la pire. */
function noteJoueursMoyenne(notes: Record<string, { note: number | null }>): number | null {
  const valeurs = Object.values(notes ?? {})
    .map((v) => v.note)
    .filter((v): v is number => v !== null && v !== undefined);
  if (!valeurs.length) return null;
  return arrondir(valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length, 2);
}

export class VueSociogramme extends Vue {
  readonly id = 'sociogramme';
  readonly label = 'Sociogramme';
  override readonly description =
    'Vue générale : toutes les personnes en cartes, empilées par génération, ' +
    'reliées par le sang et par leurs liens sociaux. Cliquer sur une carte ' +
    'isole le réseau direct de la personne.';
  override readonly icone = '◫';
  override readonly rendu = 'cartes';
  override readonly parametres: Objet[] = [
    { id: 'types', label: 'Types de liens', type: 'multi', referentiel: 'types_relations' },
    { id: 'maisons', label: 'Maisons', type: 'multi', referentiel: 'maisons' },
    {
      id: 'statuts',
      label: 'Statut',
      type: 'multi',
      options: [
        { id: 'vivant', label: 'Vivant' },
        { id: 'mort', label: 'Mort' },
        { id: 'inconnu', label: 'Inconnu' },
      ],
    },
    { id: 'secrets', label: 'Révéler les liens secrets', type: 'bool', defaut: false },
    { id: 'fratrie', label: 'Déduire les fratries', type: 'bool', defaut: true },
    { id: 'isoles', label: 'Garder les personnes sans lien', type: 'bool', defaut: true },
    { id: 'recherche', label: 'Recherche', type: 'texte' },
    { id: 'focus', label: 'Centrer sur', type: 'personne' },
    {
      id: 'profondeur',
      label: 'Profondeur du focus',
      type: 'entier',
      defaut: 1,
      min: 1,
      max: 3,
    },
  ];

  construire(dataset: Dataset, parametres: Parametres): Objet {
    const secrets = lireBool(parametres, 'secrets', false);
    const avecFratrie = lireBool(parametres, 'fratrie', true);
    const garderIsoles = lireBool(parametres, 'isoles', true);
    const typesGardes = new Set(lireListe(parametres, 'types'));
    const maisonsGardees = new Set(lireListe(parametres, 'maisons'));
    const statutsGardes = new Set(lireListe(parametres, 'statuts'));
    const recherche = lireTexte(parametres, 'recherche').trim().toLowerCase();
    const focus = lireTexte(parametres, 'focus').trim();
    const profondeur = lireEntier(parametres, 'profondeur', 1, 1, 4);

    // 1. relations candidates ------------------------------------------------
    let relations = [...dataset.relations];
    if (avecFratrie) relations = relations.concat(fratrieDeduite(relations));
    if (!secrets) relations = relations.filter((r) => !r.secret);
    if (typesGardes.size) relations = relations.filter((r) => typesGardes.has(r.type));

    // 2. personnes candidates ------------------------------------------------
    let personnes = [...dataset.personnes];
    if (maisonsGardees.size) personnes = personnes.filter((p) => maisonsGardees.has(p.maison));
    if (statutsGardes.size) personnes = personnes.filter((p) => statutsGardes.has(p.statut));

    let idsGardes = new Set(personnes.map((p) => p.id));
    relations = relations.filter((r) => idsGardes.has(r.source) && idsGardes.has(r.cible));

    // 3. focus (ego-network) -------------------------------------------------
    const focusValide = idsGardes.has(focus) ? focus : '';
    if (focusValide) {
      const atteints = new Set<string>([focusValide]);
      let frontiere = new Set<string>([focusValide]);

      for (let pas = 0; pas < profondeur; pas += 1) {
        const suivants = new Set<string>();
        for (const rel of relations) {
          if (frontiere.has(rel.source)) suivants.add(rel.cible);
          if (frontiere.has(rel.cible)) suivants.add(rel.source);
        }
        for (const deja of atteints) suivants.delete(deja);
        if (!suivants.size) break;
        for (const nouveau of suivants) atteints.add(nouveau);
        frontiere = suivants;
      }

      idsGardes = atteints;
      personnes = personnes.filter((p) => idsGardes.has(p.id));
      relations = relations.filter((r) => idsGardes.has(r.source) && idsGardes.has(r.cible));
    }

    // 4. degrés et générations -----------------------------------------------
    const generations = appliquerSurcharges(
      calculerGenerations(
        personnes.map((p) => p.id),
        relations
      ),
      personnes
    );

    const degres = new Map<string, number>(personnes.map((p) => [p.id, 0]));
    for (const rel of relations) {
      degres.set(rel.source, (degres.get(rel.source) ?? 0) + 1);
      degres.set(rel.cible, (degres.get(rel.cible) ?? 0) + 1);
    }

    if (!garderIsoles && !focusValide) {
      personnes = personnes.filter((p) => (degres.get(p.id) ?? 0) > 0);
      idsGardes = new Set(personnes.map((p) => p.id));
    }

    // 5. nœuds ---------------------------------------------------------------
    const noeuds: Objet[] = [];
    for (const personne of personnes) {
      const maison = dataset.maison(personne.maison);
      const degre = degres.get(personne.id) ?? 0;
      const titrePrincipal = personne.titres.length ? String(personne.titres[0]) : '';

      let correspond = true;
      if (recherche) {
        const meule = [
          personne.nomComplet,
          personne.surnom || '',
          String(maison.label ?? ''),
          personne.titres.map((t) => String(t)).join(' '),
          personne.tags.map((t) => String(t)).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        correspond = meule.includes(recherche);
      }

      noeuds.push({
        ...noeudMinimal(dataset, personne, generations.get(personne.id) ?? 0, degre),
        sous_titre: titrePrincipal || (maison.label ?? ''),
        genre: personne.genre,
        importance: personne.importance,
        decalage: personne.decalage,
        titres: personne.titres,
        lieu: personne.lieu,
        notes: personne.notes,
        notes_joueurs: personne.relations_joueurs,
        note_joueurs_moyenne: noteJoueursMoyenne(personne.relations_joueurs),
        correspond_recherche: correspond,
      });
    }

    // 6. arêtes (+ index des liens parallèles pour la courbure) --------------
    const compteurPaires = new Map<string, number>();
    for (const rel of relations) {
      const paire = clePaire(rel.source, rel.cible);
      compteurPaires.set(paire, (compteurPaires.get(paire) ?? 0) + 1);
    }

    const rangPaires = new Map<string, number>();
    const aretes: Objet[] = [];
    for (const rel of relations) {
      const paire = clePaire(rel.source, rel.cible);
      const rang = rangPaires.get(paire) ?? 0;
      rangPaires.set(paire, rang + 1);

      const typeRel = dataset.typeRelation(rel.type);
      const cran = humeur.cran(rel.humeur);

      aretes.push({
        id: rel.id,
        source: rel.source,
        cible: rel.cible,
        type: rel.type,
        type_label: typeRel.label ?? rel.type,
        role: role(rel.type),
        couleur: typeRel.couleur ?? '#8a8f98',
        style: typeRel.style ?? 'solide',
        categorie: typeRel.categorie ?? 'autre',
        dirige: dataset.estDirigee(rel),
        humeur: rel.humeur,
        humeur_label: cran.label,
        humeur_couleur: cran.couleur,
        md: cran.md,
        mp: cran.mp,
        // L'épaisseur dit l'écart à l'indifférence, pas le rang : un amour et
        // une haine se voient, un « m'est égal » s'efface.
        epaisseur: humeur.epaisseur(rel.humeur),
        label: rel.label,
        notes: rel.notes,
        secret: rel.secret,
        // Un lien révolu reste dessiné : c'est le rail qui décide de le montrer
        // ou non, et un ancien vassal explique souvent le présent.
        revolu: rel.revolu,
        depuis: rel.depuis,
        jusqu_a: rel.jusqu_a,
        lieu: rel.lieu,
        emoji: rel.emoji,
        deduit: Boolean(rel.extra.deduit),
        parallele_rang: rang,
        parallele_total: compteurPaires.get(paire) as number,
      });
    }

    // 7. légende (uniquement ce qui est réellement affiché) ------------------
    const compteTypes = new Map<string, number>();
    for (const arete of aretes) {
      const type = String(arete.type);
      compteTypes.set(type, (compteTypes.get(type) ?? 0) + 1);
    }
    const compteMaisons = new Map<string, number>();
    for (const noeud of noeuds) {
      const maisonId = String(noeud.maison);
      compteMaisons.set(maisonId, (compteMaisons.get(maisonId) ?? 0) + 1);
    }

    const legende = {
      types: [...compteTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([typeId, nombre]) => {
          const fiche = dataset.typeRelation(typeId);
          return {
            id: typeId,
            label: fiche.label ?? typeId,
            couleur: fiche.couleur ?? '#8a8f98',
            style: fiche.style ?? 'solide',
            dirige: fiche.dirige ?? false,
            categorie: fiche.categorie ?? 'autre',
            nombre,
          };
        }),
      maisons: [...compteMaisons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([maisonId, nombre]) => {
          const fiche = dataset.maison(maisonId);
          return {
            id: maisonId,
            label: fiche.label ?? maisonId,
            couleur: fiche.couleur ?? '#7a7f87',
            devise: fiche.devise ?? '',
            nombre,
          };
        }),
    };

    return this.enveloppe(
      {
        noeuds,
        aretes,
        legende,
        joueurs: dataset.joueurs,
        // Les formes de fond (lot 20.D) voyagent avec le plan, et non par un
        // appel à part : elles sont derrière les fiches, donc les recevoir plus
        // tard voudrait dire les voir apparaître après coup sur un plan déjà
        // dessiné. Elles ne dépendent d'aucun filtre — un rectangle tracé
        // autour du Nord reste là quand on n'affiche que les Lannister.
        formes: formesDeFond.liste(dataset.formes),
        focus: focusValide || null,
        stats: {
          personnes: noeuds.length,
          liens: aretes.length,
          personnes_total: dataset.personnes.length,
          liens_total: dataset.relations.length,
          densite:
            noeuds.length > 1
              ? arrondir((2 * aretes.length) / (noeuds.length * (noeuds.length - 1)), 4)
              : 0,
        },
      },
      dataset,
      parametres
    );
  }
}
