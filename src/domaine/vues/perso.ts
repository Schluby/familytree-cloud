/**
 * Vue « Feuille de personnage » : un personnage à la fois (lot 24).
 *
 * Elle se place entre le sociogramme et les maisons, et c'est voulu : on y
 * descend depuis le plan pour regarder *une* fiche, avant de remonter d'un cran
 * vers sa maison. Elle ne dessine ni plan ni lien — c'est une feuille.
 *
 * Payload (rendu = « perso ») :
 *
 *     {
 *       "vue": "perso", "rendu": "perso",
 *       "personnages": [ {id, label, maison, maison_label, couleur, joueur,
 *                         genre, naissance, deces, role, ville, avatar,
 *                         feuille, derives} ],
 *       "competences": [ {id, label} ],
 *       "intrigue": { humeurs, intentions, techniques, actions },
 *       "noeuds": [ … ],   // contrat commun : la liste de droite marche encore
 *       "stats":  {…}
 *     }
 *
 * **Qui apparaît ici ?** Tout le monde, mais pas dans le même ordre : les
 * personnages de joueurs d'abord, puis ceux qui ont déjà une feuille, puis le
 * reste par ordre alphabétique. Restreindre la liste aux seuls joueurs aurait
 * été plus court à écrire et faux à l'usage — un maître de jeu tient aussi des
 * feuilles pour ses personnages importants, et le classeur d'origine ne dit
 * nulle part le contraire.
 */

import {
  ACTIONS_INTRIGUE,
  COMPETENCES,
  HUMEURS_INTRIGUE,
  INTENTIONS,
  TECHNIQUES,
  derives,
} from '../feuille';
import { Dataset, type Objet } from '../models';
import { arrondir } from '../python';
import { Vue, lireBool, noeudMinimal, type Parametres } from './base';

export class VuePerso extends Vue {
  readonly id = 'perso';
  readonly label = 'Feuille de personnage';
  readonly description =
    'La fiche de jeu d’un personnage : ses compétences, son équipement, ce ' +
    'qu’il vaut en combat comme en intrigue.';
  readonly icone = '📜';
  readonly rendu = 'perso';
  /** Ni légende ni zoom : comme la vue « Maisons », c'est une fiche. */
  readonly capacites: string[] = [];
  readonly parametres: Objet[] = [
    {
      id: 'joueurs',
      label: 'Seulement les personnages joués',
      type: 'bool',
      defaut: false,
    },
  ];

  construire(dataset: Dataset, parametres: Parametres): Objet {
    const seulementJoueurs = lireBool(parametres, 'joueurs', false);

    const noeuds = dataset.personnes.map((personne) => noeudMinimal(dataset, personne));
    const noeudParId = new Map(noeuds.map((noeud) => [noeud.id as string, noeud]));

    const personnages = dataset.personnes
      .filter((personne) => {
        if (!seulementJoueurs) return true;
        return Boolean(noeudParId.get(personne.id)?.joueur) || Boolean(personne.feuille);
      })
      .map((personne) => {
        const noeud = noeudParId.get(personne.id) as Objet;
        return {
          id: personne.id,
          label: noeud.label,
          maison: personne.maison,
          maison_label: noeud.maison_label,
          couleur: noeud.couleur,
          avatar: noeud.avatar,
          joueur: noeud.joueur,
          genre: personne.genre,
          naissance: personne.naissance,
          deces: personne.deces,
          statut: personne.statut,
          role: personne.role,
          ville: personne.ville,
          titres: personne.titres,
          // `null` tant que personne n'a rien rempli : c'est ce qui permet à la
          // liste de dire « feuille ouverte » ou « feuille vierge » sans avoir
          // à inspecter quinze champs.
          feuille: personne.feuille,
          // Les sommes de rangs, calculées ici. Elles ne sont jamais écrites
          // dans la sauvegarde — deux vérités qui divergent, c'est une de trop.
          derives: derives(personne.feuille),
        };
      })
      .sort((a, b) => {
        // Les personnages joués d'abord : à la table, ce sont les seules
        // feuilles qu'on ouvre dix fois par séance.
        const rangA = a.joueur ? 0 : a.feuille ? 1 : 2;
        const rangB = b.joueur ? 0 : b.feuille ? 1 : 2;
        return rangA - rangB || String(a.label).localeCompare(String(b.label), 'fr');
      });

    return this.enveloppe(
      {
        personnages,
        competences: COMPETENCES.map((c) => ({ ...c })),
        // Toutes les listes fermées de l'intrigue partent avec la vue : le
        // navigateur ne recopie aucun de ces mots, et corriger un libellé de
        // technique se fait d'un seul côté (`feuille.ts`).
        intrigue: {
          humeurs: HUMEURS_INTRIGUE.map((h) => ({ ...h })),
          intentions: INTENTIONS.map((i) => ({ ...i })),
          techniques: TECHNIQUES.map((t) => ({ ...t })),
          actions: ACTIONS_INTRIGUE.map((a) => ({ ...a })),
        },
        noeuds,
        stats: {
          personnages: personnages.length,
          feuilles: personnages.filter((p) => p.feuille).length,
          personnes: dataset.personnes.length,
          liens: dataset.relations.length,
          densite: arrondir(
            dataset.personnes.length ? dataset.relations.length / dataset.personnes.length : 0,
            2
          ),
        },
      },
      dataset,
      parametres
    );
  }
}
