/**
 * Le monde de démonstration, mesuré une fois pour toutes.
 *
 * Ce fichier ne connaît **ni la base ni les comptes** : il ne sait que lire le
 * JSON livré avec le Worker et le préparer. C'est ce qui lui permet d'être
 * importé aussi bien par `sauvegardes/depot.ts` (qui sert ce contenu quand la
 * démonstration n'a pas de ligne à elle) que par `depart/index.ts` (qui la pose
 * et la remet à zéro), sans que les deux se tournent autour en cercle.
 *
 * `westeros.json` est **produit** par `outils/construire-depart.mjs` à partir
 * du jeu de données de la version locale, puis versionné. Ne pas l'éditer à la
 * main : la prochaine construction écraserait la retouche.
 */

import westeros from './westeros.json';
import { preparerDocument, type Document } from '../sauvegardes/document';

/** Le nom que porte la démonstration dans le rail. */
export const NOM_DEPART = 'Westeros';

/** Ce qu'il faut savoir d'un document pour l'inscrire : déjà mesuré. */
export interface ContenuMesure {
  texte: string;
  octets: number;
  personnes: number;
  relations: number;
  schema: number;
}

/**
 * Le document mesuré une fois pour toutes.
 *
 * `preparerDocument` compte les fiches, retire les portraits collés et
 * sérialise — du travail identique à chaque appel, sur 90 Ko de JSON.
 * L'isolat du Worker le garde en mémoire entre deux requêtes, donc seule la
 * première le paie. Le résultat n'est que du texte et des nombres : rien qui
 * puisse être modifié par un compte et fuiter vers le suivant.
 */
let mesure: ContenuMesure | null = null;

export function contenuDepart(): ContenuMesure {
  if (mesure) return mesure;
  const prepare = preparerDocument(structuredClone(westeros) as unknown as Document);
  mesure = {
    texte: prepare.texte,
    octets: prepare.octets,
    personnes: prepare.personnes,
    relations: prepare.relations,
    schema: prepare.schemaVersion,
  };
  return mesure;
}

/** Le poids de la démonstration, pour dimensionner un plafond. */
export function octetsDepart(): number {
  return contenuDepart().octets;
}

/**
 * Les identifiants de fiche du monde livré — le décor, par opposition au travail.
 *
 * **À quoi ça sert (lot 17.G).** Tout le monde part du même Westeros : sur un
 * plan collectif, ses 67 fiches sont présentes chez chacun, identiques, et
 * occupent tout l'écran. Ce sont les seules dont on sait d'avance qu'elles ne
 * disent rien de la table — c'est un cadeau, pas une décision de joueur. Savoir
 * les nommer permet de les mettre de côté sans les supprimer.
 *
 * Mémoïsé comme `contenuDepart` : l'isolat garde le résultat entre deux
 * requêtes, et il n'y a rien là-dedans qu'un compte puisse modifier.
 */
let identifiants: ReadonlySet<string> | null = null;

export function identifiantsDepart(): ReadonlySet<string> {
  if (identifiants) return identifiants;
  const fiches = (westeros as { personnes?: { id?: unknown }[] }).personnes ?? [];
  identifiants = new Set(
    (Array.isArray(fiches) ? fiches : [])
      .map((personne) => String(personne?.id ?? ''))
      .filter(Boolean)
  );
  return identifiants;
}
