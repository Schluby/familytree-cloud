/**
 * Vue « tableaux » : la sauvegarde à plat, triable et exportable.
 *
 * Port de `backend/views/tableau.py`. Payload produit (rendu = « tableau ») :
 *
 *     {
 *       "vue": "tableau", "rendu": "tableau",
 *       "tables":  [ {id, titre, colonnes: [{id,label,type}], lignes: [[…]]} ],
 *       "exports": [ {format, table, label, url} ],
 *       "noeuds":  [ … ],   // contrat commun : la liste de droite marche encore
 *       "stats":   {…}
 *     }
 *
 * Les colonnes ne sont pas décrites ici mais dans `exports.ts` : la vue à
 * l'écran et les fichiers CSV / Excel montrent ainsi rigoureusement la même
 * chose.
 */

import * as exports from '../exports';
import { calculerGenerations } from '../genealogie';
import { Dataset, type Objet } from '../models';
import { arrondir } from '../python';
import { Vue, lireBool, noeudMinimal, type Parametres } from './base';

export class VueTableau extends Vue {
  readonly id = 'tableau';
  readonly label = 'Tableaux & exports';
  readonly description =
    'Les données de la sauvegarde courante, à plat : personnes, liens, ' +
    'maisons, types de liens et regard des joueurs. Exportable en CSV ou ' +
    'en classeur Excel.';
  readonly icone = '▦';
  readonly rendu = 'tableau';
  /** Ni légende, ni zoom, ni édition : c'est une grille. */
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
    const tables = exports.tables(dataset, secrets);

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

    // Les adresses d'export sont fabriquées côté serveur : le front n'a pas à
    // connaître le format des routes, il pose un lien de téléchargement.
    // Sans `?sauvegarde=`, la route exporte l'active — la vue reste ainsi une
    // fonction pure du dataset qu'on lui donne.
    const suffixe = `?secrets=${secrets ? '1' : '0'}`;
    const telechargements: Objet[] = [
      {
        format: 'xlsx',
        label: 'Classeur Excel (toutes les feuilles)',
        url: `/api/export/xlsx${suffixe}`,
      },
      {
        format: 'json',
        label: 'Sauvegarde JSON (fichier complet)',
        url: `/api/export/json${suffixe}`,
      },
      ...tables.map((table) => ({
        format: 'csv',
        table: table.id,
        label: `CSV — ${table.titre}`,
        url: `/api/export/csv${suffixe}&table=${table.id}`,
      })),
    ];

    return this.enveloppe(
      {
        tables: tables.map((table) => ({
          id: table.id,
          titre: table.titre,
          colonnes: table.colonnes.map((c) => ({ id: c.id, label: c.label, type: c.type })),
          lignes: table.lignes,
        })),
        exports: telechargements,
        noeuds,
        stats: {
          personnes: dataset.personnes.length,
          liens: relations.length,
          personnes_total: dataset.personnes.length,
          liens_total: dataset.relations.length,
          densite:
            dataset.personnes.length > 1
              ? arrondir(
                  (2 * relations.length) /
                    (dataset.personnes.length * (dataset.personnes.length - 1)),
                  4
                )
              : 0,
        },
      },
      dataset,
      parametres
    );
  }
}
