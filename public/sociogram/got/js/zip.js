/* Lecture d'archives ZIP, dans le navigateur.
 *
 * Sert à réimporter le `.zip` produit par « Tout télécharger ». **Le dézippage
 * se fait ici, pas sur le serveur** : une archive peut contenir dix
 * sauvegardes de deux mégaoctets, et un Worker dispose d'une poignée de
 * millisecondes de calcul par requête. Le navigateur, lui, a tout son temps —
 * et `DecompressionStream` fait le travail sans une ligne de dépendance.
 *
 * Chaque fichier extrait repart ensuite par la route d'import normale, une
 * sauvegarde à la fois : les plafonds du compte sont vérifiés comme d'habitude,
 * et une archive trop grosse échoue proprement sur l'entrée fautive au lieu de
 * faire tomber une requête géante.
 */

const vueDe = (octets) => new DataView(octets.buffer, octets.byteOffset, octets.byteLength);

/** Localise la fin du répertoire central, en partant de la fin. */
function finRepertoire(octets) {
  const vue = vueDe(octets);
  // 22 octets sans commentaire ; on tolère un commentaire jusqu'à 64 Ko.
  const debut = Math.max(0, octets.length - 22 - 0xffff);
  for (let i = octets.length - 22; i >= debut; i -= 1) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      return {
        entrees: vue.getUint16(i + 10, true),
        decalage: vue.getUint32(i + 16, true),
      };
    }
  }
  return null;
}

async function regonfler(octets, methode) {
  if (methode === 0) return octets;
  if (methode !== 8) throw new Error(`méthode de compression non gérée (${methode})`);
  const flux = new Response(octets).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/**
 * Renvoie `[{ nom, texte }]` pour toutes les entrées de l'archive qui sont des
 * fichiers (les dossiers, repérés au `/` final, sont ignorés).
 */
export async function lireArchive(octets) {
  const fin = finRepertoire(octets);
  if (!fin) throw new Error("ce fichier n'est pas une archive ZIP lisible");

  const vue = vueDe(octets);
  const decodeur = new TextDecoder();
  const fichiers = [];
  let position = fin.decalage;

  for (let index = 0; index < fin.entrees; index += 1) {
    if (vue.getUint32(position, true) !== 0x02014b50) {
      throw new Error('répertoire central illisible');
    }
    const methode = vue.getUint16(position + 10, true);
    const compressee = vue.getUint32(position + 20, true);
    const tailleNom = vue.getUint16(position + 28, true);
    const tailleExtra = vue.getUint16(position + 30, true);
    const tailleCommentaire = vue.getUint16(position + 32, true);
    const debutLocal = vue.getUint32(position + 42, true);
    const nom = decodeur.decode(octets.subarray(position + 46, position + 46 + tailleNom));
    position += 46 + tailleNom + tailleExtra + tailleCommentaire;

    if (nom.endsWith('/')) continue;

    // L'en-tête local redit les longueurs du nom et de l'extra, qui peuvent
    // différer de celles du répertoire central : ce sont celles-là qui donnent
    // le début des données.
    const nomLocal = vue.getUint16(debutLocal + 26, true);
    const extraLocal = vue.getUint16(debutLocal + 28, true);
    const debutDonnees = debutLocal + 30 + nomLocal + extraLocal;
    const brutes = octets.subarray(debutDonnees, debutDonnees + compressee);

    fichiers.push({ nom, texte: decodeur.decode(await regonfler(brutes, methode)) });
  }

  return fichiers;
}

/** Un ZIP commence par « PK\x03\x04 » — ou par une fin de répertoire si vide. */
export function estArchive(octets) {
  return (
    octets.length >= 4 &&
    octets[0] === 0x50 &&
    octets[1] === 0x4b &&
    (octets[2] === 0x03 || octets[2] === 0x05) &&
    (octets[3] === 0x04 || octets[3] === 0x06)
  );
}
