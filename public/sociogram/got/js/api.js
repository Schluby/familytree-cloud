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
import { cle, lien } from './base.js';

const ARBRE_VISE = new URLSearchParams(location.search).get('arbre') || '';

/* ------------------------------------------------------- le partage (11.B)
 *
 * `?partage=<sauvegarde>` : on **regarde** l'arbre de quelqu'un d'autre, qui
 * nous l'a ouvert. Même mécanisme que la procuration, sans le pouvoir — le
 * serveur monte le domaine derrière `/api/partages/<id>/lecture` et refuse tout
 * verbe autre que GET **avant** de choisir la route (`src/partages/routes.ts`).
 *
 * Les deux ne se cumulent pas, et la procuration l'emporte : elle est le geste
 * d'un administrateur sur un arbre qu'il peut écrire, le partage celui d'un
 * lecteur qui ne le peut pas.
 */
const PARTAGE_VISE = ARBRE_VISE ? '' : new URLSearchParams(location.search).get('partage') || '';

/**
 * `&edition=1` : on ouvre un arbre partage **en ecriture** (lot 23.D).
 *
 * Le droit ne se devine pas ici — il vit dans la table `partages`, et le savoir
 * demanderait un aller-retour avant de pouvoir composer la moindre adresse.
 * C'est donc le rail qui l'ajoute a l'adresse, apres avoir lu la liste des
 * partages ou le droit figure. Le serveur ne s'en remet pas a ce drapeau : la
 * surface `/edition` verifie le droit **et** l'amitie a chaque requete.
 */
const EDITION_VISEE =
  !!PARTAGE_VISE && new URLSearchParams(location.search).get('edition') === '1';

const DOMAINE = ARBRE_VISE
  ? `/api/admin/arbres/${encodeURIComponent(ARBRE_VISE)}`
  : PARTAGE_VISE
    ? `/api/partages/${encodeURIComponent(PARTAGE_VISE)}/${EDITION_VISEE ? 'edition' : 'lecture'}`
    : '/api';

/** Redirige vers la connexion en gardant l'adresse demandée. */
function versConnexion() {
  if (location.pathname.startsWith(lien('/connexion'))) return;
  // `location.pathname` porte déjà le préfixe, donc le retour est complet et la
  // page de connexion peut le rejouer tel quel.
  const retour = location.pathname + location.search;
  location.replace(lien(`/connexion.html?retour=${encodeURIComponent(retour)}`));
}

/* --------------------------------------------------- l'essai sans compte
 *
 * Personne n'est renvoyé vers un formulaire pour *voir* l'outil : sans session,
 * on en ouvre une d'essai et la page continue comme si de rien n'était (lot
 * 9.C). Le serveur crée un compte de rôle `invite` avec la sauvegarde de
 * départ ; tout le reste du client l'ignore.
 *
 * Trois endroits n'y ont pas droit, et pour la même raison — ce sont des pages
 * *de compte*, où « vous n'êtes pas connecté » est la bonne réponse :
 * la connexion elle-même, « Vos données », l'administration. La procuration non
 * plus : elle n'a de sens que pour un administrateur déjà identifié.
 */
const PAGES_SANS_ESSAI = ['/connexion', '/donnees', '/admin'];

/**
 * Marqueur local : ce navigateur a déjà vu un vrai compte.
 *
 * Sans lui, la session expirée d'un membre le ferait retomber dans un essai
 * tout neuf — il croirait avoir perdu son travail alors qu'il lui suffit de se
 * reconnecter. Ce n'est pas une sécurité, c'est un aiguillage.
 */
const MEMOIRE_COMPTE = cle('familytree-compte-connu');

export function memoriserCompte(role) {
  if (role && role !== 'invite') localStorage.setItem(MEMOIRE_COMPTE, '1');
  else localStorage.removeItem(MEMOIRE_COMPTE);
}

function essaiPossible() {
  if (ARBRE_VISE) return false;
  // Un partage est adressé à **un compte nommé** (lot 11.B). Ouvrir un essai
  // tout neuf fabriquerait quelqu'un à qui l'arbre n'a jamais été partagé, et
  // le renverrait sur un 404 incompréhensible. Sans session, c'est la page de
  // connexion — comme pour les pages de compte.
  if (PARTAGE_VISE) return false;
  if (localStorage.getItem(MEMOIRE_COMPTE)) return false;
  return !PAGES_SANS_ESSAI.some((page) => location.pathname.startsWith(lien(page)));
}

// Une seule tentative en vol : au chargement, plusieurs appels partent
// ensemble et prendraient 401 en même temps. Sans ce verrou, la page créerait
// autant de comptes d'essai qu'elle a de requêtes.
let essaiEnCours = null;

function ouvrirEssai() {
  if (!essaiEnCours) {
    essaiEnCours = fetch(lien('/api/auth/invite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((reponse) => (reponse.ok ? reponse.json() : null))
      .catch(() => null);
  }
  return essaiEnCours;
}

/**
 * **C'est ici que le préfixe est ajouté** pour tout le domaine : les chemins de
 * `Api` ci-dessous restent écrits `/api/…`, comme si l'application vivait à la
 * racine. Un seul endroit à tenir, et la fourche IRL n'en change aucun.
 */
async function requete(chemin, options = {}, reessai = true) {
  const reponse = await fetch(lien(chemin), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (reponse.status === 401) {
    // Pas de session, et rien qui dise que ce navigateur en a déjà eu une :
    // on en ouvre une d'essai et on rejoue l'appel une fois.
    if (reessai && essaiPossible()) {
      const ouvert = await ouvrirEssai();
      if (ouvert) return requete(chemin, options, false);
    }
    // La session a expiré, ou l'onglet a été rouvert des jours plus tard : la
    // page ne peut rien afficher d'utile, on renvoie à la connexion.
    versConnexion();
    throw new Error('session expirée');
  }
  const type = reponse.headers.get('content-type') || '';
  const corps = type.includes('json') ? await reponse.json() : await reponse.text();
  if (!reponse.ok) {
    const message = (corps && corps.erreur) || `HTTP ${reponse.status}`;
    throw new Error(message);
  }
  // Une écriture vient de réussir. C'est le seul endroit du client par lequel
  // elles passent toutes — d'où le crochet ici plutôt que sur chaque geste.
  if (options.method && options.method !== 'GET') Api.surEcriture?.();
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
  /** L'arbre d'un autre qu'on **regarde**, ou `''`. Lecture seule (11.B). */
  partage: PARTAGE_VISE,
  /** Un arbre partagé qu'on ouvre pour l'écrire : ce n'est pas une lecture seule. */
  editionPartagee: EDITION_VISEE,

  // ------------------------------------------------------------------ les amis
  amis: () => requete('/api/amis'),
  demanderAmi: (email) =>
    requete('/api/amis', { method: 'POST', body: JSON.stringify({ email }) }),
  accepterAmi: (id) => requete(`/api/amis/${id}/accepter`, { method: 'POST' }),
  retirerAmi: (id) => requete(`/api/amis/${id}`, { method: 'DELETE' }),

  // ------------------------------------------------------------ les partages
  /** Les arbres qu'on m'a ouverts. */
  partages: () => requete('/api/partages'),
  /** À qui l'un des miens est ouvert. */
  lecteurs: (id) => requete(`/api/partages/${id}/lecteurs`),
  /**
   * La liste **entière** des lecteurs, par adresse. Elle remplace.
   *
   * `redacteurs` (lot 23.D) : ceux-là écrivent — mais seulement s'ils sont
   * amis, et c'est le serveur qui tranche. Une adresse qui n'est pas celle d'un
   * ami retombe en lecture, et la réponse la nomme dans `sans_amitie`.
   */
  poserLecteurs: (id, lecteurs, redacteurs = []) =>
    requete(`/api/partages/${id}/lecteurs`, {
      method: 'PUT',
      body: JSON.stringify({ lecteurs, redacteurs }),
    }),
  /**
   * Appelé après **toute** écriture réussie. `main.js` s'en sert pour savoir
   * qu'un visiteur sans compte a maintenant quelque chose à perdre.
   */
  surEcriture: null,
  sante: () => requete('/api/sante'),
  referentiels: () => requete(`${DOMAINE}/referentiels`),

  vues: () => requete(`${DOMAINE}/vues`),
  vue: (id, parametres) => requete(`${DOMAINE}/vue/${id}${versQuery(parametres)}`),

  /** Les deux clés de `meta` qui s'écrivent : `annee_courante` et `document`. */
  majMeta: (patch) =>
    requete(`${DOMAINE}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // ------------------------------------------------------------- le compte
  moi: () => requete('/api/auth/moi'),
  deconnexion: () => requete('/api/auth/deconnexion', { method: 'POST' }),
  /** Fabrique un nouveau code de secours et l'affiche une seule fois. */
  codeSecours: () => requete('/api/auth/code-secours', { method: 'POST' }),

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
   * La démonstration (lot 14), rendue à son état d'origine et rouverte.
   *
   * Même route pour « effacer ce que j'ai bricolé là-dedans » et pour « la
   * remettre » quand on l'avait supprimée : le serveur la recrée si elle
   * manque. Elle n'occupe aucun plafond, donc rien à vérifier avant.
   */
  reinitialiserDemonstration: () =>
    requete('/api/sauvegardes/demonstration', { method: 'POST' }),

  /**
   * Lien de téléchargement — le serveur renvoie le fichier en pièce jointe.
   * Mêmes formats qu'en local (`json`, `xlsx`, `csv`), plus `zip` : tout le
   * compte d'un coup, ce qui n'a de sens que là où les sauvegardes ne sont
   * pas déjà des fichiers sur un disque.
   */
  // `lien()` et non `requete()` : cette adresse ne part pas en `fetch`, elle
  // devient le `href` d'un lien de téléchargement. Rien ne la préfixerait.
  urlExport: (format, parametres) => lien(`${DOMAINE}/export/${format}${versQuery(parametres)}`),

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

  /* Formes de fond du plan (lot 20.D). Pas de `formes()` en lecture : elles
     arrivent avec le payload de la vue « sociogramme », qui est le seul endroit
     où on les dessine. */
  creerForme: (donnees) =>
    requete(`${DOMAINE}/formes`, { method: 'POST', body: JSON.stringify(donnees) }),
  majForme: (id, patch) =>
    requete(`${DOMAINE}/formes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  supprimerForme: (id) => requete(`${DOMAINE}/formes/${id}`, { method: 'DELETE' }),

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
  /** `{ id: [x, y] | null, … }` — ranger plusieurs fiches en une écriture. */
  majPositions: (positions) =>
    requete(`${DOMAINE}/personnes/positions`, {
      method: 'PATCH',
      body: JSON.stringify(positions),
    }),

  /* Copier / coller (lot 23.B) : un extrait est du texte, le serveur n'en
     garde aucune trace entre les deux. */
  extrait: (ids) => requete(`${DOMAINE}/extrait${versQuery({ ids: ids.join(',') })}`),
  coller: (extrait, point, { rappels = true } = {}) =>
    requete(`${DOMAINE}/coller`, {
      method: 'POST',
      body: JSON.stringify({
        extrait,
        rappels,
        ...(point ? { x: Math.round(point.x), y: Math.round(point.y) } : {}),
      }),
    }),
  creerPersonne: (donnees) =>
    requete(`${DOMAINE}/personnes`, { method: 'POST', body: JSON.stringify(donnees) }),
  supprimerPersonne: (id) => requete(`${DOMAINE}/personnes/${id}`, { method: 'DELETE' }),

  relations: () => requete(`${DOMAINE}/relations`),
  majRelation: (id, patch) =>
    requete(`${DOMAINE}/relations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  creerRelation: (donnees) =>
    requete(`${DOMAINE}/relations`, { method: 'POST', body: JSON.stringify(donnees) }),
  supprimerRelation: (id) => requete(`${DOMAINE}/relations/${id}`, { method: 'DELETE' }),

  // ------------------------------------------------------------- le carnet
  //
  // Une seule lecture pour tout ouvrir : chapitres, notes **et** catalogue des
  // cibles citables. Le « / » de l'éditeur puise dans ce catalogue, et un
  // carnet qui s'ouvrirait sans lui ne proposerait rien à sa première frappe.
  carnet: () => requete(`${DOMAINE}/carnet`),
  creerChapitre: (donnees) =>
    requete(`${DOMAINE}/carnet/chapitres`, { method: 'POST', body: JSON.stringify(donnees) }),
  majChapitre: (id, patch) =>
    requete(`${DOMAINE}/carnet/chapitres/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  /** Le chapitre s'en va, ses notes restent — elles passent hors chapitre. */
  supprimerChapitre: (id) => requete(`${DOMAINE}/carnet/chapitres/${id}`, { method: 'DELETE' }),
  creerNote: (donnees) =>
    requete(`${DOMAINE}/carnet/notes`, { method: 'POST', body: JSON.stringify(donnees) }),
  majNote: (id, patch) =>
    requete(`${DOMAINE}/carnet/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  supprimerNote: (id) => requete(`${DOMAINE}/carnet/notes/${id}`, { method: 'DELETE' }),
  /** Qui parle de cette cible, où, et combien de fois. */
  citations: (genre, id) => requete(`${DOMAINE}/carnet/citations${versQuery({ genre, id })}`),

  // ------------------------------------------- offrir une note (lot 16.E)
  //
  // Envoyer n'écrit rien chez personne : la note attend que le destinataire
  // dise oui. Accepter l'écrit dans **la sauvegarde qu'il a ouverte à ce
  // moment-là**, avec ses balises réécrites pour son monde.
  envoyerNote: (id, destinataires) =>
    requete(`${DOMAINE}/carnet/notes/${id}/envoyer`, {
      method: 'POST',
      body: JSON.stringify({ destinataires }),
    }),
  recus: () => requete(`${DOMAINE}/carnet/recus`),
  accepterRecu: (id) => requete(`${DOMAINE}/carnet/recus/${id}/accepter`, { method: 'POST' }),
  refuserRecu: (id) => requete(`${DOMAINE}/carnet/recus/${id}`, { method: 'DELETE' }),
};

export { versQuery };
