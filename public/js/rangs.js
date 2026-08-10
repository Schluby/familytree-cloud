/* Chef de maison et héritier : deux tags que l'application sait lire.
 *
 * Ce ne sont **pas** de nouveaux champs. Ce sont des entrées de `tags`, la
 * liste libre que porte déjà chaque fiche : rien à migrer, rien à perdre, et
 * quelqu'un qui avait déjà tapé « chef de maison » à la main se retrouve
 * reconnu sans avoir rien à refaire — c'est à ça que servent les alias.
 *
 * L'application ne fait respecter aucune règle de succession : deux chefs dans
 * la même maison sont possibles, parce qu'une campagne passe son temps dans
 * des situations que les règles n'ont pas prévues (deux prétendants, une
 * régence, une maison scindée). La fiche de maison les affiche tous les deux
 * plutôt que d'en choisir un.
 */

/** Compare deux tags sans se soucier de la casse ni des accents. */
function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

export const RANGS = [
  {
    id: 'chef de maison',
    classe: 'chef',
    label: 'Chef de maison',
    icone: '♔',
    alias: ['chef', 'chef de maison', 'seigneur', 'lord', 'chefdemaison'],
  },
  {
    id: 'héritier',
    classe: 'heritier',
    label: 'Héritier',
    icone: '✦',
    alias: ['heritier', 'héritier', 'heritiere', 'héritière', 'successeur'],
  },
];

const PAR_ALIAS = new Map();
for (const rang of RANGS) {
  for (const alias of rang.alias) PAR_ALIAS.set(normaliser(alias), rang);
}

/** Le rang que porte un tag, ou `null` si c'en est un comme les autres. */
export function rangDuTag(tag) {
  return PAR_ALIAS.get(normaliser(tag)) || null;
}

/** Le premier rang trouvé dans une liste de tags. */
export function rangDe(tags) {
  for (const tag of tags || []) {
    const rang = rangDuTag(tag);
    if (rang) return rang;
  }
  return null;
}

export const porteLeRang = (tags, rangId) =>
  (tags || []).some((tag) => rangDuTag(tag)?.id === rangId);

/**
 * Pose ou retire un rang. Les deux s'excluent — on n'est pas à la fois le chef
 * et celui qui attend de l'être — et les alias déjà tapés à la main sont
 * remplacés par la forme canonique, pour qu'il n'en reste qu'une.
 */
export function basculerRang(tags, rangId) {
  const avait = porteLeRang(tags, rangId);
  const autres = (tags || []).filter((tag) => !rangDuTag(tag));
  return avait ? autres : [...autres, rangId];
}
