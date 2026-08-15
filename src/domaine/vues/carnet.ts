/**
 * Vue « carnet » : les notes de la table, et ce qu'elles citent.
 *
 * Payload produit (rendu = « carnet ») :
 *
 *     {
 *       "vue": "carnet", "rendu": "carnet",
 *       "chapitres": [ {id, titre, resume} ],
 *       "notes":     [ {id, chapitre, titre, corps} ],
 *       "catalogue": [ {genre, id, libelle, detail, couleur} ],
 *       "noeuds":    [ … ],   // contrat commun : la liste de droite marche encore
 *       "stats":     {…}
 *     }
 *
 * C'est la seule vue dont le rendu **s'ouvre aussi ailleurs** : le même carnet
 * se monte en volet à côté du plan. Le moteur ne fait donc pas de différence
 * entre le payload d'une vue et la réponse de `GET /api/carnet` — les deux
 * portent les mêmes trois listes, exprès.
 */

import * as carnet from '../carnet';
import { Dataset, type Objet } from '../models';
import { Vue, noeudMinimal, type Parametres } from './base';

export class VueCarnet extends Vue {
  readonly id = 'carnet';
  readonly label = 'Carnet de notes';
  readonly description =
    'Les notes de la table, rangées en chapitres et écrites en Markdown. ' +
    'Un « / » cite un profil, une maison, un joueur ou un lien : la fiche ' +
    'citée sait ensuite où on parle d’elle.';
  readonly icone = '✎';
  readonly rendu = 'carnet';
  /** Ni légende, ni zoom, ni édition du plan : c'est du texte. */
  readonly capacites: string[] = [];

  construire(dataset: Dataset, parametres: Parametres): Objet {
    const contenu = carnet.lireCarnet(dataset);
    const citees = carnet.comptes(dataset, 'p');

    return this.enveloppe(
      {
        chapitres: contenu.chapitres.map((chapitre) => ({
          id: chapitre.id,
          titre: chapitre.titre,
          resume: chapitre.resume,
        })),
        notes: contenu.notes.map((note) => ({
          id: note.id,
          chapitre: note.chapitre,
          titre: note.titre,
          corps: note.corps,
        })),
        catalogue: carnet.catalogue(dataset),
        // Le contrat commun : sans `noeuds`, la liste des personnes et la
        // recherche du panneau de droite se videraient en ouvrant le carnet.
        noeuds: dataset.personnes.map((personne) => ({
          ...noeudMinimal(dataset, personne),
          citations: citees[personne.id] ?? 0,
        })),
        stats: {
          personnes: dataset.personnes.length,
          liens: dataset.relations.length,
          chapitres: contenu.chapitres.length,
          notes: contenu.notes.length,
          signes: contenu.notes.reduce((somme, note) => somme + note.corps.length, 0),
        },
      },
      dataset,
      parametres
    );
  }
}
