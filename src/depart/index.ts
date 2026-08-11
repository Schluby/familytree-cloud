/**
 * La sauvegarde de départ, livrée à quiconque ouvre l'application.
 *
 * Un compte neuf — et un visiteur qui n'en a pas encore — arrive dans un monde
 * déjà peuplé plutôt que devant une page blanche. C'est aussi la seule
 * démonstration honnête de ce que l'outil sait faire : des âges qui suivent la
 * date de campagne, des rangs de maison, des liens révolus, des pastilles, des
 * événements passés et des fiches de maison remplies.
 *
 * `westeros.json` est **produit** par `outils/construire-depart.mjs` à partir du
 * jeu de données de la version locale, puis versionné. Ne pas l'éditer à la
 * main : la prochaine construction écraserait la retouche.
 */

import westeros from './westeros.json';
import { preparerDocument, type Document } from '../sauvegardes/document';
import { creerDocument, type Contenu, type Fiche } from '../sauvegardes/depot';

/** Le nom que porte la sauvegarde dans la liste du rail. */
export const NOM_DEPART = 'Westeros';

/**
 * Le document mesuré une fois pour toutes.
 *
 * `preparerDocument` compte les fiches, retire les portraits collés et sérialise
 * — du travail identique à chaque inscription, sur 90 Ko de JSON. L'isolat du
 * Worker le garde en mémoire entre deux requêtes, donc seule la première le
 * paie. Le résultat n'est que du texte et des nombres : rien qui puisse être
 * modifié par un compte et fuiter vers le suivant.
 */
let mesure: Contenu | null = null;

function contenuDepart(): Contenu {
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

/** Le poids de la sauvegarde de départ, pour dimensionner un plafond. */
export function octetsDepart(): number {
  return contenuDepart().octets;
}

/**
 * Pose la sauvegarde de départ dans un compte tout neuf.
 *
 * Volontairement **sans vérification de plafond** : c'est nous qui l'offrons,
 * pas l'utilisateur qui l'importe. Un compte dont le plafond serait plus petit
 * que le cadeau se retrouverait bloqué avant d'avoir rien fait.
 */
export async function semerDepart(base: D1Database, utilisateurId: string): Promise<Fiche> {
  return creerDocument(base, utilisateurId, null, NOM_DEPART, contenuDepart());
}
