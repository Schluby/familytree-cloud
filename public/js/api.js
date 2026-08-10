/* Client HTTP de l'API. Aucun état, uniquement des appels.
 *
 * **C'est ici que passe la couture de la fourche.** Le reste de `public/js/`
 * est la copie de l'interface locale ; tout ce que la version en ligne fait
 * autrement est absorbé dans ce fichier, pour que `main.js` et les éditeurs
 * n'aient pas à savoir qu'ils parlent à un Worker plutôt qu'à un dossier.
 *
 * Trois différences absorbées ici :
 *   - une session : 401 renvoie à la page de connexion ;
 *   - les sauvegardes sont des lignes cloisonnées par compte, avec une active
 *     portée par le compte — la liste est remise dans la forme que le rail
 *     attend (`actif` sur chaque fiche, `modifie` en texte) ;
 *   - plus d'écriture différée : chaque modification écrit en base, donc pas
 *     d'`/api/etat-sauvegarde`, pas d'`/api/enregistrer`, pas d'instantanés.
 */

/* ------------------------------------------------------- la procuration
 *
 * `?arbre=<sauvegarde>` : l'application entière travaille sur l'arbre de
 * quelqu'un d'autre, par la surface d'administration. Rien d'autre ne change —
 * mêmes écrans, mêmes gestes — parce que le serveur monte **le domaine
 * entier** derrière `/api/admin/arbres/<id>` (voir `src/admin/procuration.ts`).
 *
 * Le préfixe ne vaut que pour le domaine. Le compte, la session et les
 * sauvegardes restent ceux de la personne connectée : un administrateur qui
 * édite l'arbre d'un autre reste lui-même.
 */
const ARBRE_VISE = new URLSearchParams(location.search).get('arbre') || '';
const DOMAINE = ARBRE_VISE ? `/api/admin/arbres/${encodeURIComponent(ARBRE_VISE)}` : '/api';

/** Redirige vers la connexion en gardant l'adresse demandée. */
function versConnexion() {
  if (location.pathname.startsWith('/connexion')) return;
  const retour = location.pathname + location.search;
  location.replace(`/connexion.html?retour=${encodeURIComponent(retour)}`);
}

async function requete(chemin, options = {}) {
  const reponse = await fetch(chemin, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  // La session a expiré, ou l'onglet a été rouvert des jours plus tard : la
  // page ne peut rien afficher d'utile, on renvoie à la connexion.
  if (reponse.status === 401) {
    versConnexion();
    throw new Error('session expirée');
  }
  const type = reponse.headers.get('content-type') || '';
  const corps = type.includes('json') ? await reponse.json() : await reponse.text();
  if (!reponse.ok) {
    const message = (corps && corps.erreur) || `HTTP ${reponse.status}`;
    throw new Error(message);
  }
  return corps;
}

/** Construit une query string en supportant les valeurs multiples. */
function versQuery(parametres = {}) {
  const query = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur === undefined || valeur === null || valeur === '') continue;
    if (Array.isArray(valeur)) {
      if (!valeur.length) continue;
      valeur.forEach((element) => query.append(cle, element));
    } else if (typeof valeur === 'boolean') {
      query.append(cle, valeur ? '1' : '0');
    } else {
      query.append(cle, valeur);
    }
  }
  const texte = query.toString();
  return texte ? `?${texte}` : '';
}

/**
 * Remet une fiche de sauvegarde dans la forme de la version locale :
 * `actif` sur chaque fiche plutôt qu'à côté, et une date lisible.
 */
function ficheSauvegarde(fiche, actif) {
  return {
    ...fiche,
    actif: fiche.id === actif,
    // Le serveur compte en secondes depuis 1970 ; le rail affiche du texte.
    modifie: new Date((fiche.modifie_le || 0) * 1000).toISOString().slice(0, 19),
  };
}

async function listerSauvegardes() {
  const reponse = await requete('/api/sauvegardes');
  return {
    ...reponse,
    sauvegardes: (reponse.sauvegardes || []).map((f) => ficheSauvegarde(f, reponse.actif)),
  };
}

export const Api = {
  /** L'arbre d'un autre qu'on édite, ou `''` : c'est le sien. */
  procuration: ARBRE_VISE,
  sante: () => requete('/api/sante'),
  referentiels: () => requete(`${DOMAINE}/referentiels`),

  vues: () => requete(`${DOMAINE}/vues`),
  vue: (id, parametres) => requete(`${DOMAINE}/vue/${id}${versQuery(parametres)}`),

  /** L'année courante de la campagne : la seule clé de `meta` qui s'écrit. */
  majAnnee: (annee) =>
    requete(`${DOMAINE}/meta`, {
      method: 'PATCH',
      body: JSON.stringify({ annee_courante: annee }),
    }),

  // ------------------------------------------------------------- le compte
  moi: () => requete('/api/auth/moi'),
  deconnexion: () => requete('/api/auth/deconnexion', { method: 'POST' }),

  // -------------------------------------------------------- les sauvegardes
  sauvegardes: listerSauvegardes,

  /**
   * Trois usages, comme en local : créer (vierge ou copie), et importer un
   * fichier lu par le navigateur. L'import a sa propre route en ligne, parce
   * qu'il faut valider un document venu de l'extérieur.
   */
  creerSauvegarde: async (donnees = {}) => {
    if (donnees.donnees) {
      const reponse = await requete('/api/sauvegardes/import', {
        method: 'POST',
        body: JSON.stringify({ nom: donnees.nom, document: donnees.donnees }),
      });
      if (donnees.activer && reponse.sauvegarde) {
        await requete(`/api/sauvegardes/${reponse.sauvegarde.id}/activer`, { method: 'POST' });
      }
      return reponse;
    }
    return requete('/api/sauvegardes', {
      method: 'POST',
      body: JSON.stringify({
        nom: donnees.nom,
        depuis: donnees.depuis || '',
        contenu: donnees.contenu,
      }),
    });
  },

  renommerSauvegarde: (id, nom) =>
    requete(`/api/sauvegardes/${id}`, { method: 'PATCH', body: JSON.stringify({ nom }) }),

  /**
   * Le serveur répond 204 et repointe l'active tout seul ; le rail, lui,
   * veut savoir sur quoi retomber — d'où la relecture.
   */
  supprimerSauvegarde: async (id) => {
    await requete(`/api/sauvegardes/${id}`, { method: 'DELETE' });
    const reponse = await listerSauvegardes();
    return { actif: reponse.actif };
  },

  activerSauvegarde: (id) => requete(`/api/sauvegardes/${id}/activer`, { method: 'POST' }),

  /**
   * Lien de téléchargement — le serveur renvoie le fichier en pièce jointe.
   * Mêmes formats qu'en local (`json`, `xlsx`, `csv`), plus `zip` : tout le
   * compte d'un coup, ce qui n'a de sens que là où les sauvegardes ne sont
   * pas déjà des fichiers sur un disque.
   */
  urlExport: (format, parametres) => `${DOMAINE}/export/${format}${versQuery(parametres)}`,

  maisons: () => requete(`${DOMAINE}/maisons`),
  creerMaison: (donnees) =>
    requete(`${DOMAINE}/maisons`, { method: 'POST', body: JSON.stringify(donnees) }),
  majMaison: (id, patch) =>
    requete(`${DOMAINE}/maisons/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Sans remplacement, le serveur choisit une maison de repli. */
  supprimerMaison: (id, remplacement) =>
    requete(`${DOMAINE}/maisons/${id}${versQuery({ remplacement })}`, { method: 'DELETE' }),

  categories: () => requete(`${DOMAINE}/categories`),
  creerCategorie: (donnees) =>
    requete(`${DOMAINE}/categories`, { method: 'POST', body: JSON.stringify(donnees) }),
  majCategorie: (id, patch) =>
    requete(`${DOMAINE}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Les maisons rangées là restent, simplement sans catégorie. */
  supprimerCategorie: (id) => requete(`${DOMAINE}/categories/${id}`, { method: 'DELETE' }),

  /** Référence figée (régions et châteaux) : lecture seule. */
  filtres: () => requete(`${DOMAINE}/filtres`),
  creerFiltre: (donnees) =>
    requete(`${DOMAINE}/filtres`, { method: 'POST', body: JSON.stringify(donnees) }),
  majFiltre: (id, patch) =>
    requete(`${DOMAINE}/filtres/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  supprimerFiltre: (id) => requete(`${DOMAINE}/filtres/${id}`, { method: 'DELETE' }),
  apercuFiltre: (donnees) =>
    requete(`${DOMAINE}/filtres/apercu`, { method: 'POST', body: JSON.stringify(donnees) }),
  applicationFiltre: (id) => requete(`${DOMAINE}/filtres/${id}/application`),
  valeursVariable: (variable) =>
    requete(`${DOMAINE}/filtres/valeurs${versQuery({ variable })}`),

  listes: () => requete(`${DOMAINE}/listes`),
  creerListe: (donnees) =>
    requete(`${DOMAINE}/listes`, { method: 'POST', body: JSON.stringify(donnees) }),
  majListe: (id, patch) =>
    requete(`${DOMAINE}/listes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  supprimerListe: (id) => requete(`${DOMAINE}/listes/${id}`, { method: 'DELETE' }),

  lieux: () => requete(`${DOMAINE}/lieux`),

  joueurs: () => requete(`${DOMAINE}/joueurs`),
  creerJoueur: (donnees) =>
    requete(`${DOMAINE}/joueurs`, { method: 'POST', body: JSON.stringify(donnees) }),
  majJoueur: (id, patch) =>
    requete(`${DOMAINE}/joueurs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Retirer un joueur efface aussi les humeurs qu'on lui portait. */
  supprimerJoueur: (id) => requete(`${DOMAINE}/joueurs/${id}`, { method: 'DELETE' }),

  typesRelations: () => requete(`${DOMAINE}/types-relations`),
  creerType: (donnees) =>
    requete(`${DOMAINE}/types-relations`, { method: 'POST', body: JSON.stringify(donnees) }),
  majType: (id, patch) =>
    requete(`${DOMAINE}/types-relations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Sans remplacement, les liens de ce type sont supprimés avec lui. */
  supprimerType: (id, remplacement) =>
    requete(`${DOMAINE}/types-relations/${id}${versQuery({ remplacement })}`, { method: 'DELETE' }),

  personnes: () => requete(`${DOMAINE}/personnes`),
  personne: (id, parametres) => requete(`${DOMAINE}/personnes/${id}${versQuery(parametres)}`),
  majPersonne: (id, patch) =>
    requete(`${DOMAINE}/personnes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  creerPersonne: (donnees) =>
    requete(`${DOMAINE}/personnes`, { method: 'POST', body: JSON.stringify(donnees) }),
  supprimerPersonne: (id) => requete(`${DOMAINE}/personnes/${id}`, { method: 'DELETE' }),

  relations: () => requete(`${DOMAINE}/relations`),
  majRelation: (id, patch) =>
    requete(`${DOMAINE}/relations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  creerRelation: (donnees) =>
    requete(`${DOMAINE}/relations`, { method: 'POST', body: JSON.stringify(donnees) }),
  supprimerRelation: (id) => requete(`${DOMAINE}/relations/${id}`, { method: 'DELETE' }),
};

export { versQuery };
