/**
 * Les portraits, version hébergée — l'équivalent de `backend/photos.py`, en
 * beaucoup plus court, et c'est le sujet.
 *
 * En local, une photo est rangée telle quelle dans `personne.avatar` sous forme
 * de `data:image/...;base64,…` : une sauvegarde reste *un* fichier, qui se
 * copie et s'envoie sans dossier d'images à côté.
 *
 * **En ligne, non** (décision du 06/08/2026, voir ARCHITECTURE.md). Une image
 * collée pèse à elle seule plus que tout le reste du document, pour la valeur
 * la plus faible. Le champ reste dans le format — un fichier fait l'aller-retour
 * entre les deux versions sans rien perdre d'autre — mais une image intégrée
 * est refusée à l'écriture, avec un message qui le dit, et retirée à l'import.
 *
 * Conséquence agréable : plus besoin de route `/api/personnes/<id>/photo`. Ce
 * qui est dans `avatar` est déjà une adresse que le navigateur sait charger.
 */

export class ErreurPortrait extends Error {}

export function estPhotoIntegree(valeur: unknown): boolean {
  return typeof valeur === 'string' && /^\s*data:/i.test(valeur);
}

/**
 * Valide ce que l'utilisateur envoie dans `avatar`.
 *
 * Accepte : rien (efface le portrait), ou une adresse. Lève `ErreurPortrait`
 * avec un message affichable pour tout le reste — l'API le rend en 400.
 */
export function normaliser(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur !== 'string') throw new ErreurPortrait('portrait attendu sous forme de texte');

  const propre = valeur.trim();
  if (!propre) return null;

  if (estPhotoIntegree(propre)) {
    throw new ErreurPortrait(
      "la version en ligne ne stocke pas les images collées : donnez plutôt l'adresse d'une image (http ou https)"
    );
  }

  if (/^https?:\/\//i.test(propre) || propre.startsWith('/')) return propre;

  throw new ErreurPortrait('portrait attendu : une adresse http(s)');
}

/** Ce que le front met dans `<img src>`. En ligne, c'est l'adresse elle-même. */
export function urlPhoto(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return estPhotoIntegree(avatar) ? null : avatar;
}
