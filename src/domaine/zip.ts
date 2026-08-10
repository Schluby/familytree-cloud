/**
 * Écriture d'archives ZIP, à la main.
 *
 * Deux consommateurs : le classeur Excel (un `.xlsx` **est** un ZIP d'XML) et
 * le téléchargement complet d'un compte. La version locale s'appuyait sur le
 * module `zipfile` de Python ; il n'y a pas d'équivalent dans un Worker, et
 * ajouter une dépendance pour ça serait payer cher un format tenant en 150
 * lignes.
 *
 * Ce qui est écrit ici est volontairement le sous-ensemble le plus banal du
 * format : pas de ZIP64, pas de chiffrement, pas de descripteur de données.
 * Deux méthodes de stockage seulement — `0` (tel quel) et `8` (dégonflé) —
 * parce que ce sont les deux que tout lecteur comprend depuis trente ans.
 */

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i += 1) {
    c = (TABLE_CRC[(c ^ octets[i]!) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Deflate brut (sans en-tête zlib) : exactement ce que la méthode 8 attend. */
async function degonfler(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Response(octets).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

export interface Entree {
  /** Chemin dans l'archive, séparé par des `/`. */
  nom: string;
  contenu: string | Uint8Array;
}

interface Preparee {
  nom: Uint8Array;
  donnees: Uint8Array;
  brutes: number;
  crc: number;
  methode: number;
  decalage: number;
}

const encodeur = new TextEncoder();

function ecrire32(vue: DataView, position: number, valeur: number): void {
  vue.setUint32(position, valeur >>> 0, true);
}

/**
 * `compresser` à `false` écrit une archive « stockée » : plus volumineuse,
 * mais produite sans le moindre calcul — le bon choix quand le contenu est
 * déjà du JSON qu'on veut surtout pouvoir relire.
 */
export async function archiver(entrees: Entree[], compresser = true): Promise<Uint8Array> {
  const preparees: Preparee[] = [];
  let decalage = 0;
  const morceaux: Uint8Array[] = [];

  for (const entree of entrees) {
    const brutes =
      typeof entree.contenu === 'string' ? encodeur.encode(entree.contenu) : entree.contenu;
    const nom = encodeur.encode(entree.nom);
    // Un contenu vide ne gagne rien à être dégonflé, et certains lecteurs
    // n'aiment pas un bloc dégonflé de longueur nulle.
    const degonfle = compresser && brutes.length > 0 ? await degonfler(brutes) : null;
    // Si le dégonflage fait grossir — cas des tout petits fichiers — on garde
    // l'original : un ZIP n'est pas obligé de compresser.
    const utiliser = degonfle && degonfle.length < brutes.length ? degonfle : brutes;
    const methode = utiliser === degonfle ? 8 : 0;

    const entete = new Uint8Array(30 + nom.length);
    const vue = new DataView(entete.buffer);
    ecrire32(vue, 0, 0x04034b50);
    vue.setUint16(4, 20, true); // version minimale : 2.0
    vue.setUint16(6, 0x0800, true); // les noms sont en UTF-8
    vue.setUint16(8, methode, true);
    vue.setUint16(10, 0, true); // heure — laissée à zéro, voir plus bas
    vue.setUint16(12, 0x0021, true); // date : 1980-01-01, la plus ancienne écrivable
    ecrire32(vue, 14, crc32(brutes));
    ecrire32(vue, 18, utiliser.length);
    ecrire32(vue, 22, brutes.length);
    vue.setUint16(26, nom.length, true);
    vue.setUint16(28, 0, true); // pas de champ « extra »
    entete.set(nom, 30);

    morceaux.push(entete, utiliser);
    preparees.push({
      nom,
      donnees: utiliser,
      brutes: brutes.length,
      crc: crc32(brutes),
      methode,
      decalage,
    });
    decalage += entete.length + utiliser.length;
  }

  const debutCentral = decalage;
  for (const fiche of preparees) {
    const entree = new Uint8Array(46 + fiche.nom.length);
    const vue = new DataView(entree.buffer);
    ecrire32(vue, 0, 0x02014b50);
    vue.setUint16(4, 20, true); // version d'écriture
    vue.setUint16(6, 20, true); // version minimale de lecture
    vue.setUint16(8, 0x0800, true);
    vue.setUint16(10, fiche.methode, true);
    vue.setUint16(12, 0, true);
    vue.setUint16(14, 0x0021, true);
    ecrire32(vue, 16, fiche.crc);
    ecrire32(vue, 20, fiche.donnees.length);
    ecrire32(vue, 24, fiche.brutes);
    vue.setUint16(28, fiche.nom.length, true);
    vue.setUint16(30, 0, true);
    vue.setUint16(32, 0, true);
    vue.setUint16(34, 0, true);
    vue.setUint16(36, 0, true);
    ecrire32(vue, 38, 0);
    ecrire32(vue, 42, fiche.decalage);
    entree.set(fiche.nom, 46);
    morceaux.push(entree);
    decalage += entree.length;
  }

  const fin = new Uint8Array(22);
  const vueFin = new DataView(fin.buffer);
  ecrire32(vueFin, 0, 0x06054b50);
  vueFin.setUint16(8, preparees.length, true);
  vueFin.setUint16(10, preparees.length, true);
  ecrire32(vueFin, 12, decalage - debutCentral);
  ecrire32(vueFin, 16, debutCentral);
  vueFin.setUint16(20, 0, true); // pas de commentaire
  morceaux.push(fin);

  const total = morceaux.reduce((somme, m) => somme + m.length, 0);
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    sortie.set(morceau, position);
    position += morceau.length;
  }
  return sortie;
}
