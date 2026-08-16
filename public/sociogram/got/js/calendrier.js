/* Les âges, dérivés de l'année courante de la campagne.
 *
 * Rien n'est stocké deux fois : la sauvegarde garde une **année de naissance**
 * (« 263 AC ») et une **année courante** (`meta.annee_courante`), et l'âge se
 * recalcule à chaque affichage. C'est ce qui fait que les âges avancent tout
 * seuls quand le MJ pousse la date : il n'y a aucun champ « âge » à
 * remettre à jour fiche par fiche, donc aucun moyen qu'ils se contredisent.
 *
 * Le calcul vit ici, dans le navigateur, et pas dans la vue du serveur : le
 * sociogramme envoie déjà la naissance et les référentiels déjà l'année, et
 * `outils/comparer.mjs` compare les réponses du serveur à celles de la version
 * Python **sans tolérance**. Un champ `age` de plus dans le payload aurait
 * cassé une comparaison qui n'a rien à voir avec cette fonctionnalité.
 *
 * Les années sont du texte libre, exprès : Westeros date en « AC » / « AL »,
 * une autre table daterait autrement. On n'exige qu'une chose — qu'un entier
 * s'y trouve.
 */

/** Le premier entier d'une année écrite : « 263 AC » → 263, « an -12 » → -12. */
export function anneeDe(texte) {
  if (texte === null || texte === undefined) return null;
  const trouve = String(texte).match(/-?\d+/);
  return trouve ? Number.parseInt(trouve[0], 10) : null;
}

/**
 * Ce qui entoure le nombre, pour le réécrire pareil : « 300 AC » donne
 * `{avant: '', apres: ' AC'}`. Sans ça, saisir un âge transformerait
 * « 283 AC » en « 283 », et la sauvegarde perdrait sa convention de datation.
 */
export function habillageDe(texte) {
  const source = String(texte ?? '');
  const trouve = source.match(/-?\d+/);
  if (!trouve) return { avant: '', apres: '' };
  return {
    avant: source.slice(0, trouve.index),
    apres: source.slice(trouve.index + trouve[0].length),
  };
}

/** L'âge d'une personne, ou `null` si l'une des deux années manque. */
export function ageDe(naissance, anneeCourante) {
  const nee = anneeDe(naissance);
  const maintenant = anneeDe(anneeCourante);
  if (nee === null || maintenant === null) return null;
  return maintenant - nee;
}

/**
 * L'âge au décès, quand on le connaît : pour un mort, « 41 ans » veut dire
 * l'âge qu'il avait, pas celui qu'il aurait. Un mort ne vieillit plus.
 */
export function ageAffiche(personne, anneeCourante) {
  const naissance = personne?.naissance;
  if (personne?.statut === 'mort' && anneeDe(personne?.deces) !== null) {
    return ageDe(naissance, personne.deces);
  }
  return ageDe(naissance, anneeCourante);
}

/**
 * Réécrit une année en gardant sa mise en forme : `reecrireAnnee('300 AC', 283)`
 * donne « 283 AC ». C'est ce qui empêche une saisie d'âge de faire perdre à la
 * sauvegarde sa convention de datation.
 */
export function reecrireAnnee(modele, annee) {
  if (!Number.isFinite(annee)) return null;
  const { avant, apres } = habillageDe(modele);
  return `${avant}${annee}${apres}`;
}

/** L'année de naissance qu'implique un âge : l'inverse exact de `ageDe`. */
export function naissanceDepuisAge(age, anneeCourante) {
  const maintenant = anneeDe(anneeCourante);
  if (maintenant === null || !Number.isFinite(age)) return null;
  return reecrireAnnee(anneeCourante, maintenant - age);
}

/** Avance (ou recule) une année de `pas` ans, mise en forme conservée. */
export function decalerAnnee(texte, pas) {
  const annee = anneeDe(texte);
  if (annee === null) return texte;
  return reecrireAnnee(texte, annee + pas);
}

/** « 37 ans », « 1 an », « — » : ce qui se lit sur une carte. */
export function formaterAge(age) {
  if (age === null || age === undefined) return '';
  if (age < 0) return 'à naître';
  return `${age} an${age > 1 ? 's' : ''}`;
}
