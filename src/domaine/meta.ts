/**
 * Les deux champs de `meta` qui s'éditent depuis l'application.
 *
 * **Isolés ici parce qu'ils s'écrivent désormais de deux endroits** : le
 * `PATCH /meta` d'un propriétaire (lots 8.B et 9.C) et les lots
 * d'administration (lot 10.A), qui posent la même valeur sur les sauvegardes de
 * plusieurs comptes d'un coup. Une validation recopiée est une validation qui
 * divergera — et celle du document n'est pas une politesse de saisie, c'est un
 * garde-fou : la valeur finit dans le `href` d'un lien.
 *
 * Le reste de `meta` (titre, univers, schéma…) vient du fichier de sauvegarde
 * et ne s'édite pas ici : ce n'est pas un oubli.
 */

import type { Objet } from './models';
import { ErreurReferentiel } from './referentiels';

/** Les seules clés qu'un patch de `meta` a le droit de nommer. */
export const CHAMPS_META = ['annee_courante', 'document'] as const;

/**
 * Applique un patch sur `meta`, en place, et renvoie les clés réellement
 * touchées — tableau vide si le patch ne nommait rien de connu, ce que
 * l'appelant traduit en refus.
 *
 * `null` et `''` effacent : c'est ainsi qu'on retire une année ou un lien sans
 * inventer une route de suppression pour deux champs.
 */
export function appliquerMeta(meta: Objet, patch: Objet): string[] {
  const touchees: string[] = [];

  if (Object.hasOwn(patch, 'annee_courante')) {
    const brut = patch.annee_courante;
    if (brut === null || brut === '') {
      delete meta.annee_courante;
    } else {
      const texte = String(brut).trim().slice(0, 40);
      if (!/-?\d/.test(texte)) {
        throw new ErreurReferentiel("l'année doit contenir un nombre (« 300 AC », « 1482 »…)");
      }
      meta.annee_courante = texte;
    }
    touchees.push('annee_courante');
  }

  if (Object.hasOwn(patch, 'document')) {
    const brut = patch.document;
    if (brut === null || brut === '') {
      delete meta.document;
    } else {
      meta.document = adresseSure(brut);
    }
    touchees.push('document');
  }

  return touchees;
}

/**
 * Une adresse destinée à un `href`.
 *
 * Sans ce filtre, un `javascript:…` rangé dans une sauvegarde s'exécuterait au
 * clic — chez son auteur, mais aussi chez l'administrateur qui ouvre l'arbre
 * par procuration, et chez tous les comptes d'un lot. Seuls `http` et `https`
 * passent.
 */
export function adresseSure(brut: unknown): string {
  const texte = String(brut).trim().slice(0, 2000);

  let adresse: URL;
  try {
    adresse = new URL(texte);
  } catch {
    throw new ErreurReferentiel('adresse illisible : il faut une URL complète');
  }
  if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
    throw new ErreurReferentiel('seules les adresses http(s) sont acceptées');
  }
  return texte;
}
