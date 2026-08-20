/**
 * Vue « Maisons » : une maison à la fois, en écran partagé.
 *
 * À gauche son histoire — les événements datés qu'on lui a écrits, et les
 * liens d'événement que portent ses membres (une bataille est un lien entre
 * deux personnes, pas un texte à recopier). À droite ses caractéristiques, ses
 * notes, et ce qu'elle doit ou refuse aux autres maisons.
 *
 * Payload (rendu = « maisons ») :
 *
 *     {
 *       "vue": "maisons", "rendu": "maisons",
 *       "maisons": [ {id, label, couleur, devise, caracteristiques, unites,
 *                     notes, evenements, liens, membres, chefs, heritiers} ],
 *       "caracteristiques": [ {id, label, aide} ],
 *       "etats_unite": [ {id, label} ], "entrainements_unite": [ {id, label} ],
 *       "noeuds": [ … ],   // contrat commun : la liste de droite marche encore
 *       "stats":  {…}
 *     }
 *
 * Les événements sont **enrichis ici** : chaque id de personne cité repart
 * avec son nom et sa couleur, pour que le rendu n'ait aucune donnée à aller
 * rechercher. C'est ce qui rend les mentions cliquables sans second appel.
 */

import { COMPETENCES_ARMEE } from '../feuille';
import { calculerGenerations } from '../genealogie';
import { Dataset, type Objet } from '../models';
import { arrondir } from '../python';
import {
  CARACTERISTIQUES_MAISON,
  ENTRAINEMENTS_UNITE,
  ETATS_UNITE,
} from '../referentiels';
import { Vue, lireBool, noeudMinimal, type Parametres } from './base';

/** Les tags reconnus comme rangs, à l'identique de `public/js/rangs.js`. */
const ALIAS_CHEF = new Set(['chef', 'chef de maison', 'seigneur', 'lord', 'chefdemaison']);
const ALIAS_HERITIER = new Set([
  'heritier',
  'héritier',
  'heritiere',
  'héritière',
  'successeur',
]);

function normaliserTag(brut: unknown): string {
  return String(brut ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

export class VueMaisons extends Vue {
  readonly id = 'maisons';
  readonly label = 'Maisons';
  readonly description =
    'Une maison à la fois : son histoire d’un côté, ses caractéristiques, ses ' +
    'notes et ses liens avec les autres maisons de l’autre.';
  readonly icone = '⛨';
  readonly rendu = 'maisons';
  /** Ni légende de liens ni zoom : c'est une fiche, pas un plan. */
  readonly capacites: string[] = [];
  readonly parametres: Objet[] = [
    {
      id: 'secrets',
      label: 'Inclure les liens secrets',
      type: 'bool',
      defaut: false,
    },
  ];

  construire(dataset: Dataset, parametres: Parametres): Objet {
    const secrets = lireBool(parametres, 'secrets', false);
    const relations = dataset.relations.filter((r) => secrets || !r.secret);

    const generations = calculerGenerations(
      dataset.personnes.map((p) => p.id),
      relations
    );
    const degres = new Map<string, number>(dataset.personnes.map((p) => [p.id, 0]));
    for (const relation of relations) {
      for (const extremite of [relation.source, relation.cible]) {
        if (degres.has(extremite)) degres.set(extremite, (degres.get(extremite) ?? 0) + 1);
      }
    }

    const noeuds = dataset.personnes.map((personne) =>
      noeudMinimal(
        dataset,
        personne,
        generations.get(personne.id) ?? 0,
        degres.get(personne.id) ?? 0
      )
    );
    const noeudParId = new Map(noeuds.map((noeud) => [noeud.id as string, noeud]));

    /** Le minimum pour afficher et cliquer quelqu'un depuis une maison. */
    const mention = (id: string): Objet | null => {
      const noeud = noeudParId.get(id);
      if (!noeud) return null;
      return {
        id,
        label: noeud.label,
        couleur: noeud.couleur,
        statut: noeud.statut,
        maison: noeud.maison,
      };
    };

    // Les liens d'événement, rangés par maison des personnes qu'ils touchent.
    // Une bataille entre un Stark et un Lannister apparaît dans les deux
    // histoires : elle appartient autant à l'une qu'à l'autre.
    const evenementsLies = new Map<string, Objet[]>();
    for (const relation of relations) {
      const typeRel = dataset.typeRelation(relation.type);
      if ((typeRel.categorie ?? 'autre') !== 'historique') continue;
      const source = dataset.personne(relation.source);
      const cible = dataset.personne(relation.cible);
      if (!source || !cible) continue;

      const fiche: Objet = {
        id: relation.id,
        type: relation.type,
        type_label: typeRel.label ?? relation.type,
        couleur: typeRel.couleur ?? '#8a8f98',
        label: relation.label,
        notes: relation.notes,
        annee: relation.depuis ?? '',
        jusqu_a: relation.jusqu_a ?? '',
        lieu: relation.lieu,
        revolu: relation.revolu,
        personnes: [mention(source.id), mention(cible.id)].filter(Boolean),
      };
      for (const maison of new Set([source.maison, cible.maison])) {
        if (!evenementsLies.has(maison)) evenementsLies.set(maison, []);
        (evenementsLies.get(maison) as Objet[]).push(fiche);
      }
    }

    const membresParMaison = new Map<string, Objet[]>();
    const chefsParMaison = new Map<string, Objet[]>();
    const heritiersParMaison = new Map<string, Objet[]>();
    for (const personne of dataset.personnes) {
      const fiche = mention(personne.id);
      if (!fiche) continue;
      const maison = personne.maison || 'autre';
      if (!membresParMaison.has(maison)) membresParMaison.set(maison, []);
      (membresParMaison.get(maison) as Objet[]).push(fiche);

      for (const tag of personne.tags) {
        const normalise = normaliserTag(tag);
        if (ALIAS_CHEF.has(normalise)) {
          if (!chefsParMaison.has(maison)) chefsParMaison.set(maison, []);
          (chefsParMaison.get(maison) as Objet[]).push(fiche);
        } else if (ALIAS_HERITIER.has(normalise)) {
          if (!heritiersParMaison.has(maison)) heritiersParMaison.set(maison, []);
          (heritiersParMaison.get(maison) as Objet[]).push(fiche);
        }
      }
    }

    const maisons = Object.entries(dataset.maisons)
      .map(([id, fiche]) => {
        const evenementsEcrits = (Array.isArray(fiche.evenements) ? fiche.evenements : []).map(
          (brut) => {
            const entree = brut as Objet;
            return {
              ...entree,
              // Les mentions repartent avec un nom : le rendu n'a rien à aller
              // rechercher pour les rendre cliquables. Une personne effacée
              // depuis disparaît d'elle-même de la liste.
              personnes: (Array.isArray(entree.personnes) ? entree.personnes : [])
                .map((identifiant) => mention(String(identifiant)))
                .filter(Boolean),
            };
          }
        );

        const liens = (Array.isArray(fiche.liens) ? fiche.liens : []).map((brut) => {
          const entree = brut as Objet;
          const cibleId = String(entree.maison ?? '');
          const cible = dataset.maisons[cibleId] as Objet | undefined;
          const typeRel = dataset.typeRelation(String(entree.type ?? 'autre'));
          return {
            ...entree,
            // Une maison supprimée laisse un lien orphelin : on le montre tel
            // quel plutôt que de l'effacer en douce.
            maison_label: (cible?.label as string) ?? cibleId,
            maison_couleur: (cible?.couleur as string) ?? '#7a7f87',
            maison_existe: !!cible,
            type_label: typeRel.label ?? entree.type,
            type_couleur: typeRel.couleur ?? '#8a8f98',
            dirige: Boolean(typeRel.dirige),
          };
        });

        const categorie = String(fiche.categorie || '');
        return {
          id,
          label: fiche.label ?? id,
          couleur: fiche.couleur ?? '#7a7f87',
          devise: fiche.devise ?? '',
          categorie,
          categorie_label: categorie ? (dataset.categorie(categorie).label ?? '') : '',
          caracteristiques: (fiche.caracteristiques as Objet) ?? {},
          // Lot 20.E, tel quel : contrairement aux événements, une unité ne
          // cite personne — il n'y a rien à aller enrichir ailleurs.
          unites: (fiche.unites as Objet[]) ?? [],
          // Lot 24 : les compétences de sa troupe, sur le même principe.
          competences_armee: (fiche.competences_armee as Objet) ?? {},
          notes: fiche.notes ?? '',
          evenements: evenementsEcrits,
          evenements_lies: evenementsLies.get(id) ?? [],
          liens,
          membres: membresParMaison.get(id) ?? [],
          chefs: chefsParMaison.get(id) ?? [],
          heritiers: heritiersParMaison.get(id) ?? [],
          ordre: fiche.ordre ?? 0,
        };
      })
      // Les maisons peuplées d'abord : c'est là que se joue la campagne.
      .sort(
        (a, b) =>
          (a.ordre as number) - (b.ordre as number) ||
          (b.membres as Objet[]).length - (a.membres as Objet[]).length ||
          String(a.label).localeCompare(String(b.label))
      );

    return this.enveloppe(
      {
        maisons,
        caracteristiques: CARACTERISTIQUES_MAISON.map((c) => ({ ...c })),
        // Les deux listes fermées d'une unité, descendues avec le reste : le
        // navigateur ne recopie aucun de ces mots, et en ajouter un se fait
        // d'un seul côté (`referentiels.ts`).
        etats_unite: ETATS_UNITE.map((e) => ({ ...e })),
        entrainements_unite: ENTRAINEMENTS_UNITE.map((e) => ({ ...e })),
        // Les onze compétences d’une armée (lot 24), descendues de même.
        competences_armee_liste: COMPETENCES_ARMEE.map((c) => ({ ...c })),
        annee_courante: dataset.meta.annee_courante ?? '',
        noeuds,
        stats: {
          maisons: maisons.length,
          personnes: dataset.personnes.length,
          liens: relations.length,
          densite: arrondir(
            dataset.personnes.length ? relations.length / dataset.personnes.length : 0,
            2
          ),
        },
      },
      dataset,
      parametres
    );
  }
}
