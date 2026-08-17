/**
 * Contrat commun à toutes les vues — port de `backend/views/base.py`.
 *
 * Une vue = une fonction pure `(dataset, parametres) -> payload`. Elle ne
 * dessine rien : elle produit une structure normalisée que le moteur de rendu
 * correspondant (`web/js/views/<rendu>.js`) sait afficher.
 *
 * Les paramètres arrivent sous la forme rendue par `parse_qs` en Python :
 * **un tableau de chaînes par clé**, même quand il n'y en a qu'une. Ce n'est
 * pas un détail — l'enveloppe les recopie telles quelles dans le payload, donc
 * la forme fait partie du contrat.
 */

import { Dataset, Personne, type Objet } from '../models';
import { urlPhoto } from '../portraits';
import { versEntier } from '../python';

export type Parametres = Record<string, string[]>;

/** `parse_qs(url.query, keep_blank_values=True)`, à l'identique. */
export function lireParametres(url: URL): Parametres {
  const parametres: Parametres = {};
  for (const [cle, valeur] of url.searchParams) {
    const liste = parametres[cle];
    if (liste) liste.push(valeur);
    else parametres[cle] = [valeur];
  }
  return parametres;
}

/* --------------------------------------------------------------------------
 * Le minimum qu'une vue doit dire d'une personne
 * -------------------------------------------------------------------------- */

/**
 * Champs attendus par le front pour toute vue, quel que soit le rendu.
 *
 * Le panneau de droite, la recherche et les regroupements s'appuient là-dessus :
 * une vue qui renvoie des `noeuds` construits ainsi hérite gratuitement de la
 * liste des personnes et de la fiche. Libre à elle d'ajouter les siens par-dessus.
 */
export function noeudMinimal(
  dataset: Dataset,
  personne: Personne,
  generation = 0,
  degre = 0
): Objet {
  const maison = dataset.maison(personne.maison);
  const categorie = String(maison.categorie || '');

  return {
    id: personne.id,
    label: personne.nomComplet,
    surnom: personne.surnom,
    maison: personne.maison,
    maison_label: maison.label ?? '',
    // La catégorie de sa maison : un axe de couleur et de filtre de plus.
    categorie,
    categorie_label: categorie ? (dataset.categorie(categorie).label ?? '') : '',
    couleur: personne.couleur || (maison.couleur ?? '#7a7f87'),
    // Le liseré (lot 20.B) : `null` la plupart du temps, et c'est bien ainsi —
    // il n'entoure que les fiches qu'on a voulu marquer. Il ne se mélange pas
    // à `couleur` ci-dessus, qui suit l'axe courant.
    bordure: personne.bordure,
    initiales: personne.initiales,
    // Une adresse, jamais l'image : en ligne, il n'y a de toute façon pas
    // d'image intégrée à sortir.
    avatar: urlPhoto(personne.avatar),
    statut: personne.statut,
    naissance: personne.naissance,
    deces: personne.deces,
    tags: personne.tags,
    generation,
    degre,
    // Le personnage d'un joueur porte un cadre à part sur le plan : c'est la
    // seule fiche de l'arbre qui a quelqu'un derrière elle.
    joueur: joueurDe(dataset, personne.id),
  };
}

function joueurDe(dataset: Dataset, personneId: string): Objet | null {
  for (const joueur of dataset.joueurs) {
    if (joueur.personne_id === personneId) {
      return {
        id: joueur.id,
        nom: joueur.nom ?? '',
        couleur: joueur.couleur ?? '#7a7f87',
      };
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Lecture de paramètres
 * -------------------------------------------------------------------------- */

function premier(valeur: string[] | undefined): string | null {
  if (!valeur) return null;
  return valeur.length ? (valeur[0] as string) : null;
}

export function lireTexte(params: Parametres, cle: string, defaut = ''): string {
  const valeur = premier(params[cle]);
  return valeur === null ? defaut : String(valeur);
}

export function lireBool(params: Parametres, cle: string, defaut = false): boolean {
  const valeur = premier(params[cle]);
  if (valeur === null || valeur === '') return defaut;
  return ['1', 'true', 'vrai', 'oui', 'on', 'yes'].includes(valeur.trim().toLowerCase());
}

export function lireEntier(
  params: Parametres,
  cle: string,
  defaut: number,
  mini?: number,
  maxi?: number
): number {
  let resultat = versEntier(premier(params[cle])) ?? defaut;
  if (mini !== undefined) resultat = Math.max(mini, resultat);
  if (maxi !== undefined) resultat = Math.min(maxi, resultat);
  return resultat;
}

/** Accepte `?types=ami&types=nemesis` ou `?types=ami,nemesis`. */
export function lireListe(params: Parametres, cle: string): string[] {
  const brut = params[cle];
  if (brut === undefined) return [];

  const valeurs: string[] = [];
  for (const element of brut) {
    for (const morceau of String(element).split(',')) {
      const propre = morceau.trim();
      if (propre) valeurs.push(propre);
    }
  }
  return valeurs;
}

/* --------------------------------------------------------------------------
 * Classe de base
 * -------------------------------------------------------------------------- */

/** Une vue exposée par l'API. */
export abstract class Vue {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly description: string = '';
  readonly icone: string = '◆';
  /** Identifiant du moteur de rendu côté web. */
  readonly rendu: string = 'graphe';
  /** Descripteurs déclaratifs : le front peut générer ses contrôles seul. */
  readonly parametres: Objet[] = [];
  /**
   * Ce que la vue sait faire, pour que le front n'affiche que les contrôles
   * utiles : « legende » (filtres liens/maisons), « zoom » (cadrage, molette),
   * « edition » (menus contextuels, création de liens).
   */
  readonly capacites: string[] = ['legende', 'zoom', 'edition'];

  abstract construire(dataset: Dataset, parametres: Parametres): Objet;

  decrire(): Objet {
    return {
      id: this.id,
      label: this.label,
      description: this.description,
      icone: this.icone,
      rendu: this.rendu,
      parametres: [...this.parametres],
      capacites: [...this.capacites],
    };
  }

  /** Ajoute l'entête standard commune à tous les payloads de vue. */
  enveloppe(contenu: Objet, dataset: Dataset, parametres: Parametres = {}): Objet {
    return {
      vue: this.id,
      rendu: this.rendu,
      label: this.label,
      univers: dataset.meta.titre ?? '',
      parametres: { ...parametres },
      ...contenu,
    };
  }
}
