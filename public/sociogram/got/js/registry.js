/* Registre des moteurs de rendu — pendant côté web de backend/registry.py.
 *
 * Une vue backend annonce un `rendu` (ex. "graphe"). On cherche d'abord un
 * moteur enregistré sous l'id exact de la vue (rendu sur-mesure), puis un
 * moteur générique pour ce type de rendu.
 *
 * Contrat d'un moteur :
 *   fabrique(conteneur, contexte) -> {
 *     rendre(payload, options),   // (re)dessine
 *     majOptions(options),        // options d'affichage (couleurs, filtres…)
 *     focus(id | null),           // met en avant le réseau direct
 *     recentrer(),                // remet la vue générale
 *     detruire()                  // nettoie le DOM et les listeners
 *   }
 *
 * `contexte` fournit les callbacks : { surSelection, surFond, surSurvol }.
 */

const moteurs = new Map();

export function enregistrerRendu(cle, fabrique) {
  moteurs.set(cle, fabrique);
}

export function obtenirRendu(payload) {
  return moteurs.get(payload.vue) || moteurs.get(payload.rendu) || null;
}

export function rendusDisponibles() {
  return [...moteurs.keys()];
}
