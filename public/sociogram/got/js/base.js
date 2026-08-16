/**
 * Où l'application est montée, vu du navigateur.
 *
 * `myschlub.com` porte deux sociogrammes : celui-ci sous `/sociogram/got`, la
 * version « vraie vie » sous `/sociogram/irl`. Même domaine, donc **même bocal
 * à cookies et même `localStorage`** — d'où ce fichier, qui sert à deux choses :
 * préfixer les adresses, et cloisonner ce qu'on range dans le navigateur.
 *
 * ── Pourquoi le préfixe se déduit au lieu de s'écrire ────────────────────────
 *
 * `import.meta.url` porte l'adresse de CE fichier. Tous les modules vivent dans
 * `<racine>/js/`, donc remonter d'un cran donne la racine, quelle qu'elle soit :
 *
 *   https://myschlub.com/sociogram/got/js/base.js  →  /sociogram/got
 *   http://127.0.0.1:8787/js/base.js               →  ''  (la racine)
 *
 * Rien à régler, rien à tenir à jour, et surtout : **la fourche IRL n'a pas une
 * ligne à changer ici**. Un préfixe écrit en dur serait un endroit de plus à
 * penser le jour où on copie le projet, et donc un endroit de plus à oublier.
 */

export const BASE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * `BASE + chemin` — pour les adresses fabriquées à la main.
 *
 * Les appels d'API n'en ont pas besoin : ils passent tous par `appeler()`
 * (`identite.js`) ou `requete()` (`api.js`), qui préfixent au point de passage.
 * Cette fonction sert aux **navigations** — `location.href`, un `href` calculé,
 * une comparaison de `location.pathname`.
 */
export function lien(chemin) {
  return `${BASE}${chemin}`;
}

/**
 * Une clé de `localStorage` propre à cette application.
 *
 * Sans ça, le thème choisi côté JDR s'appliquerait côté IRL, et le témoin
 * « ce navigateur a déjà vu un vrai compte » d'un projet ferait basculer
 * l'autre — les deux partagent l'origine, donc le même stockage.
 *
 * Monté à la racine, la clé ne change pas : c'est la forme d'avant le lot 18,
 * et le développement local n'a pas à repartir d'un thème neuf.
 */
export function cle(nom) {
  return BASE ? `${BASE}:${nom}` : nom;
}

/* ------------------------------------------- reprise des clés d'avant le lot 18
 *
 * Avant le déménagement, l'application vivait à la racine et rangeait ses clés
 * sans préfixe. Les renommer sans rien faire d'autre aurait un effet précis et
 * fâcheux, qu'il vaut mieux nommer :
 *
 * `familytree-compte-connu` dit « ce navigateur a déjà vu un vrai compte ».
 * C'est lui qui empêche un membre dont la session a expiré de retomber dans un
 * essai tout neuf — il verrait la démonstration à la place de son monde et
 * croirait avoir tout perdu, alors qu'il lui suffit de se reconnecter.
 *
 * Or le déménagement déconnecte tout le monde une fois : le cookie a changé de
 * nom ET de chemin. Le premier retour de chaque membre existant est donc
 * exactement la situation que ce témoin sert à éviter. On le reprend.
 *
 * Une seule fois : l'ancienne clé est effacée dans la foulée, et le jour où
 * plus aucun navigateur n'en portera, ce bloc pourra partir.
 */
if (BASE) {
  for (const nom of ['familytree-theme', 'familytree-compte-connu']) {
    const heritee = localStorage.getItem(nom);
    if (heritee !== null && localStorage.getItem(cle(nom)) === null) {
      localStorage.setItem(cle(nom), heritee);
    }
    localStorage.removeItem(nom);
  }
}
