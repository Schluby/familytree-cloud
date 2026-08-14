/* Point d'entrée : orchestre l'API, le moteur de rendu et les panneaux.
 *
 * Rien ici n'est spécifique au sociogramme : la liste des vues vient de
 * /api/vues, le module de rendu est chargé d'après `payload.rendu`, et les
 * contrôles du rail sont générés à partir des paramètres déclarés par la vue.
 */

import { Api, memoriserCompte } from './api.js';
import { obtenirRendu } from './registry.js';
import { creerPanneau } from './panel.js';
import { creerMenu } from './menu.js';
import { curseurHumeur, definirTable, tableHumeur } from './humeur.js';
import { ageAffiche, formaterAge } from './calendrier.js';
import { RANGS, basculerRang, porteLeRang } from './rangs.js';
import { surMenuContextuel, telecharger } from './dom.js';
import {
  creerEditeurAnnee,
  creerEditeurCategorie,
  creerEditeurJoueur,
  creerEditeurFiltre,
  creerEditeurLien,
  creerEditeurMaison,
  creerEditeurSauvegarde,
  creerEditeurType,
  creerFormulairePersonne,
} from './editeurs.js';
import { amenerLaFiche, installerTelephone, surTelephone } from './telephone.js';
import { lancerLeTutoriel, tutorielJamaisVu } from './tutoriel.js';

const elements = {
  univers: document.getElementById('univers'),
  filVue: document.getElementById('fil-vue'),
  filSeparateur: document.getElementById('fil-separateur'),
  filFocus: document.getElementById('fil-focus'),
  listeVues: document.getElementById('liste-vues'),
  listeSauvegardes: document.getElementById('liste-sauvegardes'),
  blocPartages: document.getElementById('bloc-partages'),
  listePartages: document.getElementById('liste-partages'),
  btnNouvelleSauvegarde: document.getElementById('btn-nouvelle-sauvegarde'),
  btnImporterSauvegarde: document.getElementById('btn-importer-sauvegarde'),
  blocLiens: document.getElementById('bloc-liens'),
  blocMaisons: document.getElementById('bloc-maisons'),
  btnNouveauType: document.getElementById('btn-nouveau-type'),
  btnTypeHistorique: document.getElementById('btn-type-historique'),
  basculeRevolus: document.getElementById('bascule-revolus'),
  btnNouvelleMaison: document.getElementById('btn-nouvelle-maison'),
  blocEdition: document.getElementById('bloc-edition'),
  groupeCadrage: document.getElementById('groupe-cadrage'),
  selecteurCouleur: document.getElementById('selecteur-couleur'),
  selecteurGroupe: document.getElementById('selecteur-groupe'),
  recherche: document.getElementById('recherche'),
  btnVueGenerale: document.getElementById('btn-vue-generale'),
  btnRail: document.getElementById('btn-rail'),
  rail: document.getElementById('rail'),
  scene: document.getElementById('scene'),
  message: document.getElementById('scene-message'),
  infobulle: document.getElementById('infobulle'),
  astuce: document.getElementById('astuce-scene'),
  legendeTypes: document.getElementById('legende-types'),
  legendeMaisons: document.getElementById('legende-maisons'),
  titreFiltre: document.getElementById('titre-filtre'),
  btnNouveauFiltre: document.getElementById('btn-nouveau-filtre'),
  axesFiltre: document.getElementById('axes-filtre'),
  aideFiltre: document.getElementById('aide-filtre'),
  optionsVue: document.getElementById('options-vue'),
  stats: document.getElementById('stats'),
  listePersonnes: document.getElementById('liste-personnes'),
  panneauListe: document.getElementById('panneau-liste'),
  panneauFiche: document.getElementById('panneau-fiche'),
  ongletFiche: document.getElementById('onglet-fiche'),
  btnNouveauProfil: document.getElementById('btn-nouveau-profil'),
  btnAjuster: document.getElementById('btn-ajuster'),
  btnFocus: document.getElementById('btn-focus'),
  btnTheme: document.getElementById('btn-theme'),
  zoomCurseur: document.getElementById('zoom-curseur'),
  zoomMoins: document.getElementById('zoom-moins'),
  zoomPlus: document.getElementById('zoom-plus'),
  lienDocument: document.getElementById('lien-document'),
  btnAnnee: document.getElementById('btn-annee'),
  blocJoueurs: document.getElementById('bloc-joueurs'),
  listeJoueurs: document.getElementById('liste-joueurs'),
  btnNouveauJoueur: document.getElementById('btn-nouveau-joueur'),
  btnTelecharger: document.getElementById('btn-telecharger'),
  btnInstantane: document.getElementById('btn-instantane'),
  etatEcriture: document.getElementById('etat-ecriture'),
  compte: document.getElementById('compte'),
  lienAdmin: document.getElementById('lien-admin'),
  btnDeconnexion: document.getElementById('btn-deconnexion'),
  btnPanneau: document.getElementById('btn-panneau'),
  btnFermerPanneau: document.getElementById('btn-fermer-panneau'),
  panneauVolet: document.getElementById('panneau'),
  aidePlafonds: document.getElementById('aide-plafonds'),
  bandeauProcuration: document.getElementById('bandeau-procuration'),
  groupeEssai: document.getElementById('groupe-essai'),
  bandeauEssai: document.getElementById('bandeau-essai'),
  bandeauEssaiTexte: document.getElementById('bandeau-essai-texte'),
  bandeauEssaiFermer: document.getElementById('bandeau-essai-fermer'),
  bandeauDemo: document.getElementById('bandeau-demo'),
  bandeauDemoTexte: document.getElementById('bandeau-demo-texte'),
  btnDemoGarder: document.getElementById('btn-demo-garder'),
  btnDemoTutoriel: document.getElementById('btn-demo-tutoriel'),
  blocDemonstration: document.getElementById('bloc-demonstration'),
  listeDemonstration: document.getElementById('liste-demonstration'),
  btnDemoCopier: document.getElementById('btn-demo-copier'),
  btnDemoReinitialiser: document.getElementById('btn-demo-reinitialiser'),
};

/**
 * On édite l'arbre de quelqu'un d'autre (lot 8.F) : `?arbre=<sauvegarde>`.
 *
 * L'application ne change pas de comportement — c'est tout l'intérêt du
 * montage côté serveur — mais elle doit le **dire**, et retirer ce qui n'a
 * plus de sens : la liste des sauvegardes est celle de l'administrateur, pas
 * celle du propriétaire, et un instantané irait dans le mauvais compte.
 */
const PROCURATION = Api.procuration;
/** Lot 11.B : on regarde l'arbre de quelqu'un, qui nous l'a ouvert. */
const PARTAGE = Api.partage;

// Même palette que le moteur de rendu pour les générations.
const COULEURS_GENERATION = ['#a8559f', '#8265c0', '#5b7fc4', '#2f97a8', '#2f9e78'];

const etat = {
  vues: [],
  vueCourante: null,
  sauvegardes: [],
  referentiels: { maisons: [], joueurs: [], types_relations: [] },
  parametres: {},
  payload: null,
  moteur: null,
  // `null` = « tout est coché ». Sinon, l'ensemble des seuls éléments visibles.
  typesVisibles: null,
  typesMasques: new Set(),
  // Un filtre par critère de couleur : `null` = tout est visible, sinon
  // l'ensemble des seules classes retenues. Changer de couleur ne perd donc
  // pas le filtre qu'on avait posé sur l'autre axe.
  filtres: {},
  noeudsMasques: new Set(),
  // Les liens révolus se voient par défaut, en pointillé serré : un ancien
  // vassal explique souvent le présent. L'interrupteur du rail ne garde que
  // ce qui tient encore.
  masquerRevolus: false,
  couleurPar: 'maison',
  groupePar: 'maison',
  recherche: '',
  selection: null,
  lienEnAttente: null,
  compte: null,
  plafonds: null,
  // Essai sans compte (lot 9.C) : le rôle vaut `invite`, et `essaiModifie`
  // passe à vrai à la première écriture — le moment où il y a quelque chose à
  // perdre, donc le moment où l'invitation cesse d'être discrète.
  invite: false,
  essaiModifie: false,
  // La démonstration (lot 14) : la fiche, si le compte en a une, et le fait
  // qu'on y ait écrit depuis l'ouverture de la page. Le second sert au même
  // usage qu'`essaiModifie` — dire les choses plus fort au moment où quelque
  // chose serait perdu, et pas avant.
  demo: null,
  demoModifiee: false,
  // Joueur en cours d'édition rapide : la liste de droite devient une
  // grille d'humeurs envers lui.
  joueurActif: null,
};

const modulesCharges = new Map();

const panneau = creerPanneau(elements.panneauFiche, {
  surNavigation: (id) => selectionner(id),
  surCentrage: (id) => etat.moteur?.focus(id),
  surVueGenerale: () => vueGenerale(),
  surFermeture: () => vueGenerale(),
  // Basculer l'onglet suffit sur écran large, où le volet est une colonne
  // toujours visible. Sur téléphone c'est un tiroir hors champ : sans
  // `amenerLaFiche`, la fiche se dessinait fidèlement **à côté de l'écran**.
  surOuverture: () => {
    basculerOnglet('fiche');
    amenerLaFiche();
  },
  surEnregistrement: () => rechargerVue({ conserverFocus: true }),
});

const menu = creerMenu();

const editeurLien = creerEditeurLien({
  types: () => etat.referentiels.types_relations || [],
  nomDe: (id) => trouverNoeud(id)?.label || id,
  surChangement: () => rechargerVue({ conserverFocus: true }),
});

const editeurFiltre = creerEditeurFiltre({
  surChangement: async (fiche, mode) => {
    // L'axe est relevé *avant* de recharger : en repeuplant le sélecteur,
    // `chargerUnivers` retombe déjà sur « maison » quand l'axe a disparu, et
    // on ne saurait plus qu'il faut redessiner.
    const axeAvant = etat.couleurPar;
    await chargerUnivers();
    if (mode === 'suppression') {
      // Le filtre n'existe plus : sa sélection de segments non plus.
      delete etat.filtres[`filtre:${fiche.supprime}`];
      if (axeAvant === `filtre:${fiche.supprime}`) await appliquerCouleurPar('maison');
      else remplirSelecteurCouleur();
      return;
    }
    await appliquerCouleurPar(`filtre:${fiche.id}`);
  },
});

const editeurSauvegarde = creerEditeurSauvegarde({
  // Renommer ne change que l'étiquette ; créer ou importer change de monde.
  surChangement: (fiche, mode) =>
    mode === 'renommage' ? chargerUnivers() : ouvrirSauvegarde(fiche.id),
  surErreur: (texte) => message(texte),
});

// Le catalogue a changé : couleurs, libellés, parfois l'appartenance des
// fiches. `rechargerVue` recharge aussi les référentiels, tout suit.
const surReferentielChange = () => rechargerVue({ conserverFocus: true });

const editeurMaison = creerEditeurMaison({
  maisons: () => etat.referentiels.maisons || [],
  categories: () => etat.referentiels.categories_maisons || [],
  // « ＋ Nouvelle catégorie… » depuis le formulaire d'une maison : on crée la
  // catégorie, on recharge le catalogue, et on rouvre la maison dessus.
  creerCategorie: (x, y, brouillonMaison) => {
    editeurCategorieRapide.ouvrirCreation(x, y);
    reprendreMaisonApresCategorie = brouillonMaison;
  },
  surChangement: surReferentielChange,
});

// Deux instances pour ne pas fermer le formulaire de maison en ouvrant celui
// de la catégorie : chacune a son socle flottant.
let reprendreMaisonApresCategorie = null;
const editeurCategorieRapide = creerEditeurCategorie({
  categories: () => etat.referentiels.categories_maisons || [],
  surChangement: async (fiche) => {
    await chargerUnivers();
    const maison = reprendreMaisonApresCategorie;
    reprendreMaisonApresCategorie = null;
    if (maison && fiche?.id) {
      editeurMaison.ouvrirModification({ ...maison, categorie: fiche.id }, 200, 160);
    }
    await rechargerVue({ conserverFocus: true });
  },
});

// Changer l'année recalcule tous les âges : la vue et la fiche ouverte
// repartent du serveur, sinon on lirait des âges d'avant la bascule.
const editeurAnnee = creerEditeurAnnee({
  annee: () => anneeCourante(),
  document: () => etat.referentiels.meta?.document || '',
  surChangement: async (meta) => {
    etat.referentiels = { ...etat.referentiels, meta };
    dessinerAnnee();
    await rechargerVue({ conserverFocus: true });
    if (etat.selection) await panneau.afficher(etat.selection, { secrets: !!etat.parametres.secrets });
    astuce(`Nous sommes en ${meta.annee_courante || '—'} : les âges ont suivi.`);
  },
});

const editeurType = creerEditeurType({
  types: () => etat.referentiels.types_relations || [],
  catalogues: () => etat.referentiels,
  surChangement: surReferentielChange,
});

const editeurCategorie = creerEditeurCategorie({
  categories: () => etat.referentiels.categories_maisons || [],
  surChangement: surReferentielChange,
});

const editeurJoueur = creerEditeurJoueur({
  joueurs: () => etat.referentiels.joueurs || [],
  personnes: () => (etat.payload?.noeuds || []).map((n) => ({ id: n.id, label: n.label })),
  surFiche: (id) => selectionner(id),
  surChangement: async (fiche, mode) => {
    if (mode === 'suppression' && etat.joueurActif === fiche.supprime) quitterJoueur();
    await chargerUnivers();
    await rechargerVue({ conserverFocus: true });
  },
});

const formulairePersonne = creerFormulairePersonne({
  maisons: () => etat.referentiels.maisons || [],
  nomDe: (id) => trouverNoeud(id)?.label || id,
  // Créer quelqu'un ne doit pas faire quitter la vue en cours : on épingle le
  // nouveau venu pour qu'il apparaisse là où l'on travaille, et on ouvre sa
  // fiche sans toucher au cadrage.
  surCreation: async (personne, { lierA, x, y }) => {
    etat.moteur?.epingler(personne.id);
    await rechargerVue({ conserverFocus: true });
    if (lierA) {
      editeurLien.ouvrirCreation({ source: lierA, cible: personne.id }, x, y);
      return;
    }
    elements.ongletFiche.disabled = false;
    await panneau.afficher(personne.id, { secrets: !!etat.parametres.secrets });
  },
});

// --------------------------------------------------------------- amorçage

async function demarrer() {
  appliquerTheme(localStorage.getItem('familytree-theme') || 'clair');
  message('Chargement…');
  // Le compte d'abord : c'est lui qui dit si la session tient encore, et un
  // 401 renvoie à la connexion avant qu'on ait affiché un arbre vide.
  await dessinerCompte();
  // Un arbre qu'on nous a ouvert (11.B) : mêmes écrans, mêmes vues, aucune
  // écriture. Le chemin est celui de la procuration, sans le pouvoir.
  if (PARTAGE) {
    try {
      await preparerPartage();
    } catch (erreur) {
      message(`Arbre inaccessible : ${erreur.message}`);
      return;
    }
    try {
      etat.vues = (await Api.vues()).vues;
      dessinerListeVues();
      await chargerUnivers();
      await choisirVue(etat.vues[0]?.id);
    } catch (erreur) {
      message(`Impossible de contacter l'API : ${erreur.message}`);
    }
    return;
  }
  if (PROCURATION) {
    try {
      await preparerProcuration();
    } catch (erreur) {
      message(`Arbre inaccessible : ${erreur.message}`);
      return;
    }
    try {
      etat.vues = (await Api.vues()).vues;
      dessinerListeVues();
      await chargerUnivers();
      await choisirVue(etat.vues[0]?.id);
    } catch (erreur) {
      message(`Impossible de contacter l'API : ${erreur.message}`);
    }
    return;
  }
  try {
    etat.vues = (await Api.vues()).vues;
    dessinerListeVues();
    // Un compte neuf n'a aucune sauvegarde, et le domaine répond 409 tant
    // qu'il n'y en a pas une. On dessine quand même le rail : c'est là que se
    // trouvent « ＋ Nouvelle » et « ⤒ Importer ».
    await dessinerSauvegardes();
    if (!etat.sauvegardes.length) {
      elements.rail.classList.remove('replie');
      message(
        'Aucune sauvegarde pour l’instant. Dans le panneau de gauche : ' +
          '« ＋ Nouvelle » pour partir d’un monde vide, « ⤒ Importer » pour ' +
          'reprendre un fichier .json exporté.'
      );
      return;
    }
    await chargerUnivers();
    await choisirVue(etat.vues[0]?.id);
    proposerLeTutoriel();
  } catch (erreur) {
    message(`Impossible de contacter l'API : ${erreur.message}`);
  }
}

/**
 * La visite guidée, à la toute première ouverture — et pas une fois de plus.
 *
 * **Après** que l'arbre est dessiné, jamais avant : les étapes désignent des
 * boutons de la page, et une visite qui commence sur un écran vide montre des
 * halos autour de rien. Elle se **propose** (le premier écran offre « Plus
 * tard »), et n'apparaît que dans la démonstration : quelqu'un qui ouvre son
 * propre monde n'est pas en train de découvrir l'outil.
 */
function proposerLeTutoriel() {
  if (PROCURATION || PARTAGE) return;
  if (!tutorielJamaisVu() || !demonstrationOuverte()) return;
  lancerLeTutoriel();
}

/**
 * Le décor de la procuration : dire chez qui l'on écrit, et retirer ce qui
 * porterait à confusion.
 *
 * On demande à la surface d'administration le nom du propriétaire — c'est la
 * seule information qui manque, l'arbre lui-même arrivant par les routes
 * ordinaires. Si elle refuse (compte redevenu simple membre entre-temps), on
 * ne montre rien : mieux vaut un message qu'un arbre sans étiquette.
 */
async function preparerProcuration() {
  const reponse = await fetch(`/api/admin/sauvegardes/${PROCURATION}`);
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => null);
    throw new Error(corps?.erreur || `HTTP ${reponse.status}`);
  }
  // Cet appel-ci est aussi ce qui inscrit l'ouverture au journal, du côté
  // « consultation » : ouvrir l'arbre de quelqu'un reste un acte, même quand
  // on l'ouvre pour l'éditer.
  const { sauvegarde = {} } = await reponse.json();
  const proprietaire = sauvegarde.proprietaire_email || 'un autre compte';

  document.body.classList.add('en-procuration');
  elements.bandeauProcuration.hidden = false;
  elements.bandeauProcuration.replaceChildren(
    ...[
      ['b', '✎ Édition par procuration'],
      ['span', ` — vous écrivez dans « ${sauvegarde.nom || 'l’arbre'} », qui appartient à ${proprietaire}. Chaque modification est inscrite au journal.`],
    ].map(([balise, texte]) => {
      const element = document.createElement(balise);
      element.textContent = texte;
      return element;
    })
  );
  const retour = document.createElement('a');
  retour.className = 'bouton bouton-icone';
  retour.href = '/admin.html';
  retour.textContent = '↩ Administration';
  elements.bandeauProcuration.append(retour);

  // Ce bloc liste les sauvegardes de l'administrateur, pas celles du
  // propriétaire : l'afficher inviterait à changer d'arbre sans le savoir.
  elements.listeSauvegardes.closest('.rail-bloc').hidden = true;
  elements.univers.textContent = sauvegarde.nom || '';
}

/**
 * L'arbre qu'on nous a ouvert : de qui il est, et ce qu'on peut en faire.
 *
 * Le nom et le propriétaire viennent de la liste des partages — la seule
 * information qui manque, l'arbre lui-même arrivant par le domaine monté
 * derrière `/api/partages/<id>/lecture`. Si l'arbre n'y figure pas, c'est que
 * le partage a été retiré : on le dit, plutôt que d'afficher un écran vide.
 */
async function preparerPartage() {
  const { partages = [] } = await Api.partages();
  const fiche = partages.find((p) => p.id === PARTAGE);
  if (!fiche) {
    throw new Error("cet arbre ne vous est plus partagé, ou ne l'a jamais été");
  }

  document.body.classList.add('en-partage');
  elements.bandeauProcuration.hidden = false;
  elements.bandeauProcuration.replaceChildren(
    ...[
      ['b', '👁 Lecture seule'],
      [
        'span',
        ` — « ${fiche.nom} » appartient à ${fiche.proprietaire_email || 'un autre compte'}, qui vous l’a ouvert. Vous voyez ses modifications ; vous ne pouvez rien y écrire.`,
      ],
    ].map(([balise, texte]) => {
      const element = document.createElement(balise);
      element.textContent = texte;
      return element;
    })
  );
  const retour = document.createElement('a');
  retour.className = 'bouton bouton-icone';
  retour.href = '/';
  retour.textContent = '↩ Mes arbres';
  elements.bandeauProcuration.append(retour);

  // Comme sous procuration : cette liste serait la nôtre, pas celle de l'arbre
  // ouvert. La montrer inviterait à changer de monde sans s'en apercevoir.
  elements.listeSauvegardes.closest('.rail-bloc').hidden = true;
  elements.univers.textContent = fiche.nom || '';
}

/** Tout ce qui dépend de la sauvegarde active : maisons, types, joueurs… */
async function chargerUnivers() {
  const [referentiels] = await Promise.all([Api.referentiels(), dessinerSauvegardes()]);
  etat.referentiels = referentiels;
  definirTable(referentiels.humeurs);
  panneau.definirReferentiels(referentiels);
  // C'est la sauvegarde ouverte qui nomme l'en-tête : c'est elle qu'on
  // manipule. Le titre de l'univers reste en infobulle.
  const meta = referentiels.meta || {};
  elements.univers.textContent = meta.sauvegarde || meta.titre || '';
  elements.univers.title = meta.titre || '';
  // Le bouton n'existe que si *cette* sauvegarde nomme un document. Il pointait
  // autrefois vers une adresse en dur, ce qui n'avait de sens que tant que
  // l'application n'avait qu'un seul lecteur (lot 9.C).
  elements.lienDocument.href = meta.document || '#';
  elements.lienDocument.hidden = !meta.document;
  dessinerAnnee();
  remplirSelecteurCouleur();
}

/* ------------------------------------------------------- année de campagne
 *
 * Une seule date, gardée dans la sauvegarde, d'où se déduisent tous les âges.
 * L'avancer d'un an vieillit toute la campagne — c'est le geste que le MJ fait
 * entre deux séances, et il n'a qu'un champ à changer.
 */

const anneeCourante = () => etat.referentiels.meta?.annee_courante || '';

function dessinerAnnee() {
  const annee = anneeCourante();
  elements.btnAnnee.textContent = annee ? `📅 ${annee}` : '📅 Année…';
  elements.btnAnnee.title = annee
    ? `Année courante de la campagne : ${annee}. Les âges des fiches en découlent — cliquez pour l’avancer.`
    : 'Aucune année de campagne : les fiches n’affichent que leur année de naissance. Cliquez pour la régler.';
  elements.btnAnnee.classList.toggle('sans-annee', !annee);
}

function message(texte) {
  elements.message.hidden = !texte;
  elements.message.textContent = texte || '';
}

// ---------------------------------------------------------- sauvegardes

const pluriel = (nombre, mot) => `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;

const resumeContenu = (fiche) =>
  `${pluriel(fiche.personnes, 'personne')} · ${pluriel(fiche.relations, 'lien')}`;

const poids = (octets) => `${Math.max(1, Math.round((octets || 0) / 1024))} Ko`;

/**
 * Les plafonds sont ceux du compte : les afficher évite la mauvaise surprise.
 *
 * La démonstration en est exclue, comme elle l'est côté serveur : elle
 * n'occupe aucune des dix sauvegardes et ne pèse rien tant qu'on n'y a pas
 * écrit. L'annoncer ici en dirait le contraire de ce que fait `verifierNombre`.
 */
function dessinerPlafonds() {
  if (!elements.aidePlafonds) return;
  const plafonds = etat.plafonds;
  if (!plafonds) {
    elements.aidePlafonds.textContent = '';
    return;
  }
  const siennes = etat.sauvegardes.filter((fiche) => !fiche.demo);
  const total = siennes.reduce((somme, fiche) => somme + (fiche.taille || 0), 0);
  // `poids` arrondit à 1 Ko au minimum — juste pour une sauvegarde, qui n'est
  // jamais vide, faux pour un total à zéro : quelqu'un qui n'a encore que la
  // démonstration lisait « 1 Ko utilisés » sans rien avoir écrit.
  const utilises = total ? poids(total) : '0 Ko';
  elements.aidePlafonds.textContent =
    `${siennes.length} / ${plafonds.sauvegardes} sauvegardes · ` +
    `${utilises} utilisés, ${poids(plafonds.octets)} par sauvegarde.`;
}

/** Une entrée de la liste du rail. Les deux blocs se la partagent. */
function itemSauvegarde(fiche) {
  const li = document.createElement('li');
  li.className = `sauvegarde ${fiche.actif ? 'actif' : ''} ${fiche.demo ? 'demo' : ''}`;
  li.dataset.id = fiche.id;
  li.title = fiche.demo
    ? 'Monde de démonstration — rien de ce que vous y faites n’est conservé'
    : `${poids(fiche.taille)} — modifiée le ${(fiche.modifie || '').replace('T', ' à ')}`;

  const pastille = document.createElement('span');
  pastille.className = 'sv-pastille';

  const corps = document.createElement('div');
  corps.className = 'sv-corps';
  const nom = document.createElement('div');
  nom.className = 'sv-nom';
  nom.textContent = fiche.nom;
  const meta = document.createElement('div');
  meta.className = 'sv-meta';
  meta.textContent = fiche.demo ? `${resumeContenu(fiche)} · non conservé` : resumeContenu(fiche);
  corps.append(nom, meta);

  li.append(pastille, corps);
  li.addEventListener('click', () => {
    if (!fiche.actif) ouvrirSauvegarde(fiche.id);
  });
  // Pas de menu contextuel sur la démonstration : renommer ce qui repart à zéro
  // à la prochaine connexion, ou l'exporter comme si c'était son travail, sont
  // deux façons de croire qu'on la garde. Ses deux gestes ont leurs boutons.
  if (!fiche.demo) surMenuContextuel(li, (evenement) => menuSauvegarde(fiche, evenement));
  return li;
}

async function dessinerSauvegardes() {
  // Sous procuration, cette liste est celle de l'administrateur : la dessiner
  // inviterait à changer d'arbre sans s'en apercevoir. Le bloc est masqué.
  if (PROCURATION) return;
  let reponse;
  try {
    reponse = await Api.sauvegardes();
  } catch (erreur) {
    elements.listeSauvegardes.replaceChildren();
    return;
  }
  etat.sauvegardes = reponse.sauvegardes;
  etat.plafonds = reponse.plafonds || null;
  etat.demo = etat.sauvegardes.find((fiche) => fiche.demo) || null;
  dessinerPlafonds();

  elements.listeSauvegardes.replaceChildren(
    ...etat.sauvegardes.filter((fiche) => !fiche.demo).map(itemSauvegarde)
  );
  if (elements.blocDemonstration) {
    elements.blocDemonstration.hidden = !etat.demo;
    elements.listeDemonstration.replaceChildren(
      ...(etat.demo ? [itemSauvegarde(etat.demo)] : [])
    );
  }
  dessinerBandeauDemo();

  await dessinerPartages();
}

/**
 * Les arbres qu'on nous a ouverts (11.B).
 *
 * Un clic ouvre une page à part, `?partage=<id>` : ce n'est pas « activer une
 * sauvegarde » — elle n'est pas à nous, et la rendre active reviendrait à
 * écrire dans notre compte le nom d'un arbre qui appartient à quelqu'un
 * d'autre. On la regarde, puis on revient chez soi.
 */
async function dessinerPartages() {
  let partages = [];
  try {
    partages = (await Api.partages()).partages || [];
  } catch (erreur) {
    // Un partage qui ne répond pas ne doit pas emporter la liste des siennes.
    partages = [];
  }

  elements.blocPartages.hidden = partages.length === 0;
  elements.listePartages.replaceChildren(
    ...partages.map((fiche) => {
      const li = document.createElement('li');
      li.className = 'sauvegarde partage';
      li.title = `Appartient à ${fiche.proprietaire_email} — lecture seule`;

      const pastille = document.createElement('span');
      pastille.className = 'sv-pastille';

      const corps = document.createElement('div');
      corps.className = 'sv-corps';
      const nom = document.createElement('div');
      nom.className = 'sv-nom';
      nom.textContent = fiche.nom;
      const meta = document.createElement('div');
      meta.className = 'sv-meta';
      meta.textContent = `${fiche.proprietaire_email} · ${resumeContenu(fiche)}`;
      corps.append(nom, meta);

      li.append(pastille, corps);
      li.addEventListener('click', () => {
        location.href = `/?partage=${encodeURIComponent(fiche.id)}`;
      });
      return li;
    })
  );
}

/** Changer de sauvegarde = changer de monde : on repart de la vue générale. */
async function ouvrirSauvegarde(identifiant) {
  message('Ouverture de la sauvegarde…');
  try {
    await Api.activerSauvegarde(identifiant);
  } catch (erreur) {
    message(`Impossible d'ouvrir : ${erreur.message}`);
    return;
  }
  annulerLiaisonRapide();
  etat.selection = null;
  etat.typesVisibles = null;
  etat.filtres = {};
  etat.recherche = '';
  elements.recherche.value = '';
  elements.filSeparateur.hidden = true;
  elements.filFocus.textContent = '';
  panneau.fermer();
  elements.ongletFiche.disabled = true;
  basculerOnglet('liste');
  await chargerUnivers();
  await choisirVue(etat.vueCourante?.id || etat.vues[0]?.id);
}

function menuSauvegarde(fiche, evenement) {
  const exporter = (format, parametres = {}) =>
    telecharger(Api.urlExport(format, { sauvegarde: fiche.id, ...parametres }));
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: fiche.nom },
    { texte: `${resumeContenu(fiche)} · ${poids(fiche.taille)}` },
    !fiche.actif && {
      label: 'Ouvrir cette sauvegarde',
      icone: '▸',
      onclick: () => ouvrirSauvegarde(fiche.id),
    },
    {
      label: 'Renommer…',
      icone: '✎',
      onclick: () =>
        editeurSauvegarde.ouvrirRenommage(fiche, evenement.clientX, evenement.clientY),
    },
    {
      label: 'Dupliquer…',
      icone: '⧉',
      detail: 'avant de tout casser',
      onclick: () =>
        editeurSauvegarde.ouvrirCreation(evenement.clientX, evenement.clientY, {
          depuis: fiche.id,
          nomSource: fiche.nom,
        }),
    },
    {
      label: 'Partager en lecture…',
      icone: '👁',
      detail: 'montrer cet arbre à d’autres comptes',
      onclick: () => menuPartage(fiche, evenement),
    },
    { separateur: true },
    {
      label: 'Exporter en classeur Excel',
      icone: '⤓',
      detail: '.xlsx',
      onclick: () => exporter('xlsx'),
    },
    {
      label: 'Exporter le fichier de sauvegarde',
      icone: '⤓',
      detail: '.json',
      onclick: () => exporter('json'),
    },
    { texte: 'Les exports CSV sont dans la vue « Tableaux & exports ».' },
    { separateur: true },
    {
      label: 'Supprimer la sauvegarde',
      icone: '🗑',
      danger: true,
      disabled: etat.sauvegardes.length <= 1,
      onclick: () => confirmerSuppressionSauvegarde(fiche, evenement),
    },
  ]);
}

/**
 * À qui cet arbre est ouvert, et comment changer la liste.
 *
 * On désigne les lecteurs **par leur adresse**, jamais par un identifiant : on
 * partage à « jean@exemple.fr ». La liste envoyée **remplace** la précédente —
 * une route d'ajout et une route de retrait feraient deux façons de se tromper,
 * et c'est la même règle que les tutelles du lot 11.A.
 */
async function menuPartage(fiche, evenement) {
  let lecteurs = [];
  try {
    lecteurs = (await Api.lecteurs(fiche.id)).lecteurs || [];
  } catch (erreur) {
    message(`Impossible de lire les partages : ${erreur.message}`);
    return;
  }

  const adresses = lecteurs.map((lecteur) => lecteur.email);
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `Partager « ${fiche.nom} »` },
    {
      texte: adresses.length
        ? `Ouvert à ${pluriel(adresses.length, 'compte')} : ${adresses.join(', ')}`
        : 'Cet arbre n’est ouvert à personne.',
    },
    {
      texte:
        'Ceux à qui vous l’ouvrez le voient tel que vous le modifiez, et ne peuvent rien y écrire.',
    },
    { separateur: true },
    {
      label: adresses.length ? 'Modifier la liste…' : 'Ouvrir à des comptes…',
      icone: '👁',
      onclick: () => changerLecteurs(fiche, adresses),
    },
    adresses.length && {
      label: 'Ne plus le partager',
      icone: '🚫',
      danger: true,
      onclick: () => enregistrerLecteurs(fiche, []),
    },
  ]);
}

function changerLecteurs(fiche, adresses) {
  const saisie = prompt(
    `Les adresses des comptes à qui « ${fiche.nom} » est ouvert, séparées par des virgules.\n` +
      'Cette liste remplace la précédente : effacer une adresse retire l’accès.',
    adresses.join(', ')
  );
  if (saisie === null) return;
  enregistrerLecteurs(
    fiche,
    saisie
      .split(/[,;\s]+/)
      .map((mot) => mot.trim())
      .filter(Boolean)
  );
}

async function enregistrerLecteurs(fiche, adresses) {
  try {
    const reponse = await Api.poserLecteurs(fiche.id, adresses);
    // Les adresses sans compte sont nommées : les taire ferait croire que Jean
    // voit l'arbre alors qu'il ne le verra jamais.
    const perdues = reponse.inconnus?.length
      ? ` Sans compte ici, donc ignorée(s) : ${reponse.inconnus.join(', ')}.`
      : '';
    message(
      reponse.lecteurs.length
        ? `« ${fiche.nom} » est ouvert à ${pluriel(reponse.lecteurs.length, 'compte')}.${perdues}`
        : `« ${fiche.nom} » n’est plus partagé.${perdues}`
    );
  } catch (erreur) {
    message(`Partage impossible : ${erreur.message}`);
  }
}

function confirmerSuppressionSauvegarde(fiche, evenement) {
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `Supprimer « ${fiche.nom} » ?` },
    {
      texte: `${pluriel(fiche.personnes, 'personne')} et ${pluriel(
        fiche.relations,
        'lien'
      )} seront perdus. La suppression est définitive : rien n’est mis à la corbeille.`,
    },
    { separateur: true },
    { label: 'Annuler', icone: '↩', onclick: () => {} },
    {
      label: 'Télécharger d’abord',
      icone: '⤓',
      onclick: () => telecharger(Api.urlExport('json', { sauvegarde: fiche.id })),
    },
    {
      label: 'Supprimer définitivement',
      icone: '🗑',
      danger: true,
      onclick: async () => {
        try {
          const reponse = await Api.supprimerSauvegarde(fiche.id);
          if (fiche.actif) await ouvrirSauvegarde(reponse.actif);
          else await dessinerSauvegardes();
        } catch (erreur) {
          message(`Suppression impossible : ${erreur.message}`);
        }
      },
    },
  ]);
}

// ------------------------------------------------------------------ vues

function dessinerListeVues() {
  elements.listeVues.replaceChildren(
    ...etat.vues.map((vue) => {
      const li = document.createElement('li');
      li.title = vue.description;
      li.dataset.vue = vue.id;
      const icone = document.createElement('span');
      icone.className = 'vue-icone';
      icone.textContent = vue.icone;
      const libelle = document.createElement('span');
      libelle.textContent = vue.label;
      li.append(icone, libelle);
      li.addEventListener('click', () => choisirVue(vue.id));
      return li;
    })
  );
}

/**
 * Les axes disponibles, dans l'ordre. Une seule source pour le sélecteur du
 * haut et les pastilles du rail : un filtre créé apparaît des deux côtés.
 */
function listeAxes() {
  return [
    { id: 'maison', label: 'Maison', court: 'Maison' },
    { id: 'categorie', label: 'Catégorie de maison', court: 'Catégorie' },
    { id: 'generation', label: 'Génération', court: 'Génération' },
    { id: 'statut', label: 'Statut (vivant / mort)', court: 'Statut' },
    { id: 'joueurs', label: 'Humeur envers les joueurs (moyenne)', court: 'Humeur' },
    ...(etat.referentiels.joueurs || []).map((joueur) => ({
      id: `joueur:${joueur.id}`,
      label: `Humeur envers ${joueur.nom}`,
      court: joueur.nom,
      couleur: joueur.couleur,
    })),
    // Les filtres sur mesure sont des axes comme les autres : une fois créés,
    // ils vivent dans la même liste.
    ...(etat.referentiels.filtres || []).map((filtre) => ({
      id: `filtre:${filtre.id}`,
      label: `⚙ ${filtre.label}`,
      court: filtre.label,
      fiche: filtre,
    })),
  ];
}

function remplirSelecteurCouleur() {
  const options = listeAxes();
  elements.selecteurCouleur.replaceChildren(
    ...options.map((option) => {
      const noeud = document.createElement('option');
      noeud.value = option.id;
      noeud.textContent = option.label;
      return noeud;
    })
  );
  // La liste est reconstruite à chaque changement de sauvegarde (les joueurs
  // changent) : l'écouteur, lui, est posé une seule fois plus bas.
  elements.selecteurCouleur.value = etat.couleurPar;
  if (elements.selecteurCouleur.selectedIndex < 0) {
    elements.selecteurCouleur.selectedIndex = 0;
    etat.couleurPar = elements.selecteurCouleur.value;
  }
}

async function choisirVue(vueId) {
  const vue = etat.vues.find((v) => v.id === vueId);
  if (!vue) return;
  etat.vueCourante = vue;
  etat.parametres = {};
  (vue.parametres || []).forEach((parametre) => {
    if (parametre.defaut !== undefined) etat.parametres[parametre.id] = parametre.defaut;
  });
  elements.filVue.textContent = vue.label;
  [...elements.listeVues.children].forEach((li) =>
    li.classList.toggle('actif', li.dataset.vue === vueId)
  );
  dessinerOptions(vue);
  majCapacites(vue);
  etat.moteur?.detruire();
  etat.moteur = null;
  await rechargerVue();
}

async function rechargerVue({ conserverFocus = false } = {}) {
  if (!etat.vueCourante) return;
  message('Chargement de la vue…');
  let payload;
  try {
    // Les référentiels repartent avec la vue : leurs compteurs (membres d'une
    // maison, liens d'un type) bougent à chaque édition, et c'est sur eux que
    // s'appuient le rail et les confirmations de suppression.
    const [vue, referentiels] = await Promise.all([
      Api.vue(etat.vueCourante.id, etat.parametres),
      Api.referentiels(),
    ]);
    payload = vue;
    etat.referentiels = referentiels;
    definirTable(referentiels.humeurs);
    panneau.definirReferentiels(referentiels);
  } catch (erreur) {
    message(`Erreur : ${erreur.message}`);
    return;
  }
  message('');
  etat.payload = payload;
  // Un filtre sur mesure se recalcule sur les données : elles viennent de
  // changer, ses segments aussi.
  if (etat.couleurPar.startsWith('filtre:')) {
    await chargerApplicationFiltre(etat.couleurPar.slice(7));
  }
  majMasques();

  const fabrique = await chargerMoteur(payload);
  if (!fabrique) {
    message(`Aucun moteur de rendu pour « ${payload.rendu} ».`);
    return;
  }

  if (!etat.moteur) {
    etat.moteur = adapterMoteur(fabrique(elements.scene, {
      // Un lien armé se termine au clic simple : au doigt, il n'y a ni Maj ni
      // glisser, et l'appui long a déjà servi à choisir « Relier à… ».
      surSelection: (id, noeud, evenement) => {
        if (etat.lienEnAttente) {
          liaisonRapide(id, evenement);
          return;
        }
        selectionner(id);
      },
      surFond: () => annulerLiaisonRapide(),
      surSurvolLien: (arete, evenement) => infobulleLien(arete, evenement),
      surFinSurvol: () => masquerInfobulle(),
      surZoom: (k) => {
        elements.zoomCurseur.value = Math.round(k * 100);
      },
      surDisposition: (info) => majStats(info),
      surMenuCarte: (id, evenement) => menuCarte(id, evenement),
      surMenuFond: (evenement) => menuFond(evenement),
      surMenuLien: (aretes, evenement) => menuLien(aretes, evenement),
      surClicLien: (aretes, evenement) => modifierLien(aretes, evenement),
      surLiaison: ({ source, cible }, evenement) => {
        masquerInfobulle();
        if (cible) editeurLien.ouvrirCreation({ source, cible }, evenement.clientX, evenement.clientY);
        else
          formulairePersonne.ouvrir(evenement.clientX, evenement.clientY, { lierA: source });
      },
      surLiaisonRapide: (id, evenement) => liaisonRapide(id, evenement),
      surDeport: (id, decalage) => enregistrerDeport(id, decalage),
      // La vue « Maisons » édite le catalogue en place : elle prévient quand
      // un nom change (le rail l'affiche) et quand sa propre structure bouge.
      surReferentielChange: () => chargerUnivers(),
      surRechargement: () => rechargerVue({ conserverFocus: true }),
    }));
  }

  etat.moteur.rendre(payload, {
    couleurPar: etat.couleurPar,
    couleursCategories: couleursCategories(),
    couleursNoeuds: couleursNoeuds(),
    recherche: etat.recherche,
    typesMasques: etat.typesMasques,
    noeudsMasques: etat.noeudsMasques,
    masquerRevolus: etat.masquerRevolus,
    // Le moteur ne lit pas l'API : l'année de la campagne lui est descendue,
    // et c'est elle qui transforme les naissances en âges sur les fiches.
    anneeCourante: anneeCourante(),
    // La vue « Maisons » réutilise le catalogue des types pour les liens de
    // maison à maison : un « vassal de » veut dire la même chose des deux côtés.
    typesRelations: etat.referentiels.types_relations || [],
  });

  dessinerLegendes();
  dessinerJoueurs();
  dessinerListePersonnes();
  majStats();
  // Les compteurs du rail suivent ce que contient réellement la sauvegarde.
  dessinerSauvegardes();

  if (conserverFocus && etat.selection) etat.moteur.focus(etat.selection, { animer: false });
}

/**
 * Un moteur n'implémente que ce qui a du sens pour lui : une grille ne zoome
 * pas, un rendu 3D n'épinglera peut-être rien. On complète le contrat avec
 * des fonctions vides pour que l'orchestrateur puisse appeler sans se méfier.
 */
const MOTEUR_MUET = {
  rendre() {},
  majOptions() {},
  focus() {},
  recentrer() {},
  detruire() {},
  zoomer() {},
  definirZoom() {},
  marquerEnAttente() {},
  epingler() {},
  recolorer() {},
};

function adapterMoteur(moteur) {
  return { ...MOTEUR_MUET, ...moteur };
}

/** N'affiche que les contrôles que la vue courante sait honorer. */
function majCapacites(vue) {
  const capacites = new Set(vue?.capacites || []);
  elements.blocLiens.hidden = !capacites.has('legende');
  elements.blocMaisons.hidden = !capacites.has('legende');
  elements.blocEdition.hidden = !capacites.has('edition');
  elements.groupeCadrage.hidden = !capacites.has('zoom');
}

async function chargerMoteur(payload) {
  const dejaLa = obtenirRendu(payload);
  if (dejaLa) return dejaLa;
  const nom = payload.rendu;
  if (modulesCharges.has(nom)) return obtenirRendu(payload);
  try {
    await import(`./views/${nom}.js`);
    modulesCharges.set(nom, true);
  } catch (erreur) {
    console.error(`Module de rendu « ${nom} » introuvable`, erreur);
    return null;
  }
  return obtenirRendu(payload);
}

// -------------------------------------------------------------- sélection

async function selectionner(id) {
  etat.selection = id;
  const noeud = trouverNoeud(id);
  elements.filSeparateur.hidden = false;
  elements.filFocus.textContent = noeud?.label || id;
  elements.ongletFiche.disabled = false;
  etat.moteur?.epingler(null); // nouvelle vue : plus rien d'épinglé
  etat.moteur?.focus(id);
  masquerInfobulle();
  majListeActive();
  majStats();
  await panneau.afficher(id, { secrets: !!etat.parametres.secrets });
}

function vueGenerale() {
  annulerLiaisonRapide();
  etat.selection = null;
  elements.filSeparateur.hidden = true;
  elements.filFocus.textContent = '';
  panneau.fermer();
  elements.ongletFiche.disabled = true;
  basculerOnglet('liste');
  etat.moteur?.recentrer();
  majListeActive();
  majStats();
}

// ------------------------------------------------------------- liaison rapide

function astuce(texte) {
  elements.astuce.hidden = !texte;
  elements.astuce.textContent = texte || '';
}

/**
 * On arme une fiche, la suivante crée le lien. Trois chemins y mènent :
 * Maj + clic, « Relier à… » du menu contextuel, et l'appui long au doigt. Une
 * fois armé, un **clic simple** suffit à désigner l'autre bout — sans quoi le
 * geste serait impossible sur un téléphone, qui n'a ni Maj ni glisser.
 */
function liaisonRapide(id, evenement) {
  if (!etat.lienEnAttente) {
    etat.lienEnAttente = id;
    etat.moteur?.marquerEnAttente(id);
    astuce(
      `Départ : ${trouverNoeud(id)?.label || id} — touchez (ou cliquez) une autre fiche pour créer le lien. Échap ou « Vue générale » pour annuler.`
    );
    return;
  }
  if (etat.lienEnAttente === id) {
    annulerLiaisonRapide();
    return;
  }
  const source = etat.lienEnAttente;
  annulerLiaisonRapide();
  masquerInfobulle();
  // Sans événement (menu, appui long), l'éditeur se pose sur la fiche visée.
  const point = pointDe(evenement, id);
  editeurLien.ouvrirCreation({ source, cible: id }, point.x, point.y);
}

/** Le point d'ancrage d'un panneau : celui du geste, sinon celui de la fiche. */
function pointDe(evenement, id) {
  if (evenement && Number.isFinite(evenement.clientX)) {
    return { x: evenement.clientX, y: evenement.clientY };
  }
  const position = etat.moteur?.positionDe?.(id);
  const scene = elements.scene.getBoundingClientRect();
  if (position) return { x: scene.left + position.x, y: scene.top + position.y };
  return { x: scene.left + scene.width / 2, y: scene.top + scene.height / 3 };
}

function annulerLiaisonRapide() {
  if (!etat.lienEnAttente) return;
  etat.lienEnAttente = null;
  etat.moteur?.marquerEnAttente(null);
  astuce('');
}

/** Ctrl + glisser : on mémorise l'écart à la position calculée. */
async function enregistrerDeport(id, decalage) {
  try {
    await Api.majPersonne(id, { decalage });
    const noeud = trouverNoeud(id);
    if (noeud) noeud.decalage = decalage;
  } catch (erreur) {
    message(`Position non enregistrée : ${erreur.message}`);
  }
}

async function reinitialiserDeport(id) {
  const noeud = trouverNoeud(id);
  if (noeud) noeud.decalage = null;
  try {
    await Api.majPersonne(id, { decalage: null });
  } catch (erreur) {
    message(`Échec : ${erreur.message}`);
  }
  await rechargerVue({ conserverFocus: true });
}

// ------------------------------------------------------------- édition rapide

/** Liens réels (les fratries déduites n'existent pas dans le jeu de données). */
function liensReelsDe(id) {
  return (etat.payload?.aretes || []).filter(
    (arete) => !arete.deduit && (arete.source === id || arete.cible === id)
  );
}

function libelleLien(arete) {
  const source = trouverNoeud(arete.source)?.label || arete.source;
  const cible = trouverNoeud(arete.cible)?.label || arete.cible;
  return `${source} ${arete.dirige ? '→' : '↔'} ${cible}`;
}

function menuCarte(id, evenement) {
  const noeud = trouverNoeud(id);
  const liens = liensReelsDe(id).length;
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: noeud?.label || id, couleur: noeud?.couleur },
    { label: 'Ouvrir la fiche', icone: '▤', onclick: () => selectionner(id) },
    { label: 'Centrer sur cette personne', icone: '◎', onclick: () => etat.moteur?.focus(id) },
    { separateur: true },
    {
      label: etat.lienEnAttente === id ? 'Annuler le départ du lien' : 'Relier à…',
      icone: '⤳',
      detail: 'Maj + clic',
      onclick: () => liaisonRapide(id, evenement),
    },
    {
      label: 'Nouveau profil relié…',
      icone: '＋',
      onclick: () =>
        formulairePersonne.ouvrir(evenement.clientX, evenement.clientY, { lierA: id }),
    },
    { separateur: true },
    // Nommer un chef ou un héritier depuis le plan : c'est là qu'on regarde
    // une maison, pas dans la fiche.
    ...RANGS.map((rang) => {
      const porte = porteLeRang(noeud?.tags, rang.id);
      return {
        label: porte ? `Ne plus être ${rang.label.toLowerCase()}` : `Marquer ${rang.label.toLowerCase()}`,
        icone: rang.icone,
        detail: porte ? 'posé' : '',
        onclick: () => definirRang(id, rang.id),
      };
    }),
    noeud?.decalage && {
      label: 'Replacer automatiquement',
      icone: '⌖',
      detail: 'Ctrl + glisser',
      onclick: () => reinitialiserDeport(id),
    },
    { separateur: true },
    {
      label: 'Supprimer le profil',
      icone: '🗑',
      detail: liens ? `${liens} lien${liens > 1 ? 's' : ''}` : '',
      danger: true,
      onclick: () => confirmerSuppressionPersonne(id, evenement),
    },
  ]);
}

/** Pose ou retire un rang depuis le plan, sans passer par la fiche. */
async function definirRang(id, rangId) {
  const noeud = trouverNoeud(id);
  const tags = basculerRang(noeud?.tags, rangId);
  try {
    await Api.majPersonne(id, { tags });
    if (noeud) noeud.tags = tags;
    await rechargerVue({ conserverFocus: true });
    if (panneau.idCourant() === id) {
      await panneau.afficher(id, { secrets: !!etat.parametres.secrets });
    }
  } catch (erreur) {
    message(`Échec : ${erreur.message}`);
  }
}

function confirmerSuppressionPersonne(id, evenement) {
  const noeud = trouverNoeud(id);
  const liens = liensReelsDe(id).length;
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `Supprimer ${noeud?.label || id} ?` },
    {
      texte: liens
        ? `${liens} lien${liens > 1 ? 's seront supprimés' : ' sera supprimé'} avec le profil. Action définitive.`
        : 'Action définitive.',
    },
    { separateur: true },
    { label: 'Annuler', icone: '↩', onclick: () => {} },
    {
      label: 'Supprimer définitivement',
      icone: '🗑',
      danger: true,
      onclick: async () => {
        try {
          await Api.supprimerPersonne(id);
        } catch (erreur) {
          message(`Suppression impossible : ${erreur.message}`);
          return;
        }
        if (etat.selection === id) vueGenerale();
        await rechargerVue({ conserverFocus: true });
      },
    },
  ]);
}

function menuFond(evenement) {
  const deplacees = (etat.payload?.noeuds || []).filter((noeud) => noeud.decalage);
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: etat.referentiels.meta?.sauvegarde || etat.referentiels.meta?.titre || 'Plan' },
    {
      label: 'Nouveau profil…',
      icone: '＋',
      onclick: () => formulairePersonne.ouvrir(evenement.clientX, evenement.clientY, {}),
    },
    deplacees.length && {
      label: 'Replacer toutes les fiches',
      icone: '⌖',
      detail: `${deplacees.length} déplacée${deplacees.length > 1 ? 's' : ''}`,
      onclick: async () => {
        await Promise.all(
          deplacees.map((noeud) => {
            noeud.decalage = null;
            return Api.majPersonne(noeud.id, { decalage: null });
          })
        );
        await rechargerVue({ conserverFocus: true });
      },
    },
    { separateur: true },
    { label: 'Vue générale', icone: '⇱', onclick: () => vueGenerale() },
    { label: 'Ajuster à l’écran', icone: '⤢', onclick: () => etat.moteur?.recentrer() },
  ]);
}

function menuLien(aretes, evenement) {
  if (aretes.length > 1) return choisirLien(aretes, evenement, menuLien);
  const arete = aretes[0];
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: libelleLien(arete), couleur: arete.couleur },
    {
      label: 'Modifier le lien…',
      icone: '✎',
      detail: arete.type_label,
      onclick: () =>
        editeurLien.ouvrirModification(arete, evenement.clientX, evenement.clientY),
    },
    { separateur: true },
    {
      label: 'Supprimer le lien',
      icone: '🗑',
      danger: true,
      onclick: async () => {
        try {
          await Api.supprimerRelation(arete.id);
          await rechargerVue({ conserverFocus: true });
        } catch (erreur) {
          message(`Suppression impossible : ${erreur.message}`);
        }
      },
    },
  ]);
}

function modifierLien(aretes, evenement) {
  if (aretes.length > 1) return choisirLien(aretes, evenement, modifierLien);
  masquerInfobulle();
  editeurLien.ouvrirModification(aretes[0], evenement.clientX, evenement.clientY);
}

/** Les connecteurs se superposent : on demande lequel avant d'éditer. */
function choisirLien(aretes, evenement, suite) {
  menu.ouvrir(evenement.clientX, evenement.clientY, [
    { titre: `${aretes.length} liens à cet endroit` },
    ...aretes.map((arete) => ({
      label: libelleLien(arete),
      icone: '—',
      detail: arete.type_label,
      onclick: () => suite([arete], evenement),
    })),
  ]);
}

// ---------------------------------------------------------------- onglets

function basculerOnglet(nom) {
  document.querySelectorAll('.pn-onglets .onglet').forEach((bouton) =>
    bouton.classList.toggle('actif', bouton.dataset.onglet === nom)
  );
  elements.panneauListe.hidden = nom !== 'liste';
  elements.panneauFiche.hidden = nom !== 'fiche';
}

document.querySelectorAll('.pn-onglets .onglet').forEach((bouton) => {
  bouton.addEventListener('click', () => {
    if (bouton.disabled) return;
    basculerOnglet(bouton.dataset.onglet);
  });
});

// ------------------------------------------------------- liste des personnes

const GROUPES = {
  maison: {
    cle: (noeud) => noeud.maison,
    label: (noeud) => noeud.maison_label || 'Sans maison',
    couleur: (noeud) => noeud.couleur,
  },
  generation: {
    cle: (noeud) => String(noeud.generation ?? 0),
    label: (noeud) => `Génération ${(noeud.generation ?? 0) + 1}`,
    couleur: () => null,
  },
  statut: {
    cle: (noeud) => noeud.statut,
    label: (noeud) =>
      ({ vivant: 'Vivants', mort: 'Morts', inconnu: 'Statut inconnu' }[noeud.statut]),
    couleur: () => null,
  },
  aucun: { cle: () => '', label: () => '', couleur: () => null },
};

function dessinerListePersonnes() {
  const noeuds = [...(etat.payload?.noeuds || [])];
  const requete = etat.recherche.trim().toLowerCase();
  const filtres = requete
    ? noeuds.filter((noeud) =>
        [noeud.label, noeud.surnom, noeud.maison_label, (noeud.tags || []).join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(requete)
      )
    : noeuds;

  const groupeur = GROUPES[etat.groupePar] || GROUPES.maison;
  const groupes = new Map();
  filtres
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((noeud) => {
      const cle = groupeur.cle(noeud);
      if (!groupes.has(cle)) {
        groupes.set(cle, { label: groupeur.label(noeud), couleur: groupeur.couleur(noeud), noeuds: [] });
      }
      groupes.get(cle).noeuds.push(noeud);
    });

  const fragment = document.createDocumentFragment();
  if (!filtres.length) {
    const vide = document.createElement('p');
    vide.className = 'vide';
    vide.style.padding = '14px';
    vide.textContent = 'Aucune personne ne correspond.';
    fragment.append(vide);
  }

  [...groupes.entries()]
    .sort((a, b) => b[1].noeuds.length - a[1].noeuds.length)
    .forEach(([, groupe]) => {
      if (groupe.label) {
        const titre = document.createElement('div');
        titre.className = 'groupe-titre';
        if (groupe.couleur) {
          const barre = document.createElement('span');
          barre.className = 'barre-couleur';
          barre.style.background = groupe.couleur;
          titre.append(barre);
        }
        const texte = document.createElement('span');
        texte.textContent = groupe.label;
        const nombre = document.createElement('span');
        nombre.className = 'nombre';
        nombre.textContent = groupe.noeuds.length;
        titre.append(texte, nombre);
        fragment.append(titre);
      }
      groupe.noeuds.forEach((noeud) => fragment.append(itemPersonne(noeud)));
    });

  elements.listePersonnes.replaceChildren(fragment);
  majListeActive();
}

function itemPersonne(noeud) {
  const ligne = document.createElement('div');
  ligne.className = `item-personne ${noeud.statut === 'mort' ? 'mort' : ''}`;
  ligne.dataset.id = noeud.id;

  const avatar = document.createElement('span');
  avatar.className = `item-avatar ${noeud.avatar ? 'avec-photo' : ''}`;
  avatar.style.background = noeud.couleur;
  if (noeud.avatar) {
    const image = document.createElement('img');
    image.src = noeud.avatar;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.remove();
      avatar.textContent = noeud.initiales;
    });
    avatar.append(image);
  } else {
    avatar.textContent = noeud.initiales;
  }

  const corps = document.createElement('div');
  corps.className = 'item-corps';
  const nom = document.createElement('div');
  nom.className = 'item-nom';
  nom.textContent = noeud.label;
  const meta = document.createElement('div');
  meta.className = 'item-meta';
  // L'âge d'abord — c'est ce qu'on cherche en pleine partie ; l'année de
  // naissance reste en infobulle sur la ligne.
  const age = ageAffiche(noeud, anneeCourante());
  meta.textContent =
    [
      age !== null ? formaterAge(age) : noeud.naissance || '',
      noeud.statut === 'mort' && noeud.deces ? `† ${noeud.deces}` : '',
    ]
      .filter(Boolean)
      .join('  ·  ') ||
    [noeud.maison_label, noeud.statut === 'mort' ? '†' : ''].filter(Boolean).join('  ·  ');
  if (noeud.naissance) ligne.title = `Né en ${noeud.naissance}`;
  corps.append(nom, meta);

  ligne.append(avatar, corps);

  if (etat.joueurActif) {
    // En mode « regard d'un joueur », la ligne porte un curseur d'humeur :
    // le clic sur le nom ouvre encore la fiche, le reste note.
    ligne.classList.add('avec-humeur');
    corps.addEventListener('click', () => selectionner(noeud.id));
    avatar.addEventListener('click', () => selectionner(noeud.id));
    ligne.append(
      curseurHumeur({
        valeur: noeud.notes_joueurs?.[etat.joueurActif]?.note ?? null,
        effacable: true,
        surChangement: (valeur) => noterHumeur(noeud.id, valeur),
      })
    );
  } else {
    ligne.addEventListener('click', () => selectionner(noeud.id));
  }
  return ligne;
}

function majListeActive() {
  elements.listePersonnes.querySelectorAll('.item-personne').forEach((ligne) =>
    ligne.classList.toggle('actif', ligne.dataset.id === etat.selection)
  );
}

// ----------------------------------------------------------------- joueurs
//
// Le rail liste la table. Cliquer un joueur bascule l'application dans son
// regard : les cartes prennent la couleur de l'humeur qu'on lui porte, et la
// liste de droite devient une grille où l'on note d'un clic, sans ouvrir
// chaque fiche. Cliquer le nom d'un personnage ouvre quand même sa fiche.

function dessinerJoueurs() {
  const joueurs = etat.referentiels.joueurs || [];
  elements.listeJoueurs.replaceChildren(
    ...joueurs.map((joueur) => {
      const li = document.createElement('li');
      li.className = `joueur-rail ${etat.joueurActif === joueur.id ? 'actif' : ''}`;
      li.title = [
        joueur.personnage ? `${joueur.nom} — ${joueur.personnage}` : joueur.nom,
        'Clic : ouvre sa fiche et note les humeurs envers lui. Clic droit : menu.',
      ].join(' · ');

      const pastille = document.createElement('span');
      pastille.className = 'legende-pastille';
      pastille.style.background = joueur.couleur || '#7a7f87';

      const corps = document.createElement('div');
      corps.className = 'joueur-rail-corps';
      const nom = document.createElement('div');
      nom.className = 'joueur-rail-nom';
      nom.textContent = joueur.nom;
      corps.append(nom);
      if (joueur.personnage) {
        const perso = document.createElement('div');
        perso.className = 'joueur-rail-perso';
        perso.textContent = joueur.personnage;
        corps.append(perso);
      }

      // Le raccourci vers son personnage : la fiche s'ouvre et le plan se
      // resserre sur son réseau — sa fiche *et* ses liens, d'un seul geste.
      const versFiche = document.createElement('button');
      versFiche.className = 'bouton bouton-icone joueur-rail-fiche';
      versFiche.type = 'button';
      versFiche.textContent = joueur.personne_id ? '⌖' : '⌖?';
      versFiche.title = joueur.personne_id
        ? `Ouvrir ${joueur.personnage || 'son personnage'} et son réseau`
        : 'Aucune fiche liée — cliquer pour en choisir une';
      versFiche.addEventListener('click', (evenement) => {
        evenement.stopPropagation();
        if (joueur.personne_id) {
          selectionner(joueur.personne_id);
          return;
        }
        const boite = li.getBoundingClientRect();
        editeurJoueur.ouvrirModification(joueur, boite.right + 8, boite.top);
      });

      li.append(pastille, corps, versFiche);
      // Un clic fait les deux : la liste de droite passe dans son regard (pour
      // noter vite) et sa fiche s'ouvre sous la main, sans passer par un menu.
      li.addEventListener('click', () => {
        if (etat.joueurActif === joueur.id) {
          quitterJoueur();
          return;
        }
        basculerJoueur(joueur.id);
        const boite = li.getBoundingClientRect();
        editeurJoueur.ouvrirModification(joueur, boite.right + 8, boite.top);
      });
      surMenuContextuel(li, (evenement) => menuJoueur(joueur, evenement));
      return li;
    })
  );
  if (!joueurs.length) {
    const vide = document.createElement('li');
    vide.className = 'vide';
    vide.textContent = 'Personne autour de la table.';
    elements.listeJoueurs.append(vide);
  }
}

function basculerJoueur(id) {
  if (etat.joueurActif === id) {
    quitterJoueur();
    return;
  }
  etat.joueurActif = id;
  appliquerCouleurPar(`joueur:${id}`);
}

function quitterJoueur() {
  etat.joueurActif = null;
  appliquerCouleurPar('maison');
}

/** id de catégorie -> couleur, pour que le moteur n'ait pas à lire l'API. */
function couleursCategories() {
  const table = {};
  (etat.referentiels.categories_maisons || []).forEach((categorie) => {
    table[categorie.id] = categorie.couleur;
  });
  return table;
}

/**
 * id de personne -> couleur de son segment, pour l'axe « filtre sur mesure ».
 * Le moteur ne saura jamais ce qu'est un segment : il reçoit des couleurs.
 */
function couleursNoeuds() {
  const application = etat.applicationFiltre;
  if (!application) return {};
  const parSegment = {};
  application.segments.forEach((segment) => {
    parSegment[segment.id] = segment.couleur;
  });
  const table = {};
  Object.entries(application.noeuds || {}).forEach(([id, segment]) => {
    table[id] = parSegment[segment] || '#8a8f98';
  });
  return table;
}

/**
 * Charge l'application d'un filtre sur mesure (segments, appartenance,
 * exclus). Le calcul vit côté serveur : c'est lui qui sait lire une personne.
 */
async function chargerApplicationFiltre(id) {
  if (!id) {
    etat.applicationFiltre = null;
    return;
  }
  try {
    etat.applicationFiltre = await Api.applicationFiltre(id);
  } catch (erreur) {
    etat.applicationFiltre = null;
    message(`Filtre « ${id} » illisible : ${erreur.message}`);
  }
}

async function appliquerCouleurPar(mode) {
  etat.couleurPar = mode;
  elements.selecteurCouleur.value = mode;
  // Un filtre sur mesure a besoin de son calcul avant de pouvoir colorer.
  await chargerApplicationFiltre(mode.startsWith('filtre:') ? mode.slice(7) : null);
  // Chaque axe garde son propre filtre : on recalcule les masques du nouveau.
  majMasques();
  etat.moteur?.majOptions({
    couleurPar: mode,
    couleursCategories: couleursCategories(),
    couleursNoeuds: couleursNoeuds(),
    noeudsMasques: etat.noeudsMasques,
  });
  dessinerJoueurs();
  dessinerFiltre();
  dessinerListePersonnes();
}

function menuJoueur(joueur, evenement) {
  const { clientX: x, clientY: y } = evenement;
  menu.ouvrir(x, y, [
    { titre: joueur.nom, couleur: joueur.couleur },
    { texte: joueur.personnage ? `joue ${joueur.personnage}` : 'aucun personnage renseigné' },
    {
      label: 'Modifier ce joueur…',
      icone: '✎',
      detail: 'nom, personnage, couleur',
      onclick: () => editeurJoueur.ouvrirModification(joueur, x, y),
    },
    { label: 'Nouveau joueur…', icone: '＋', onclick: () => editeurJoueur.ouvrirCreation(x, y) },
    { separateur: true },
    {
      label: 'Retirer ce joueur…',
      icone: '🗑',
      danger: true,
      detail: 'efface les humeurs qui le visent',
      onclick: () => editeurJoueur.ouvrirSuppression(joueur, x, y),
    },
  ]);
}

/** Note l'humeur d'un personnage envers le joueur actif, sans ouvrir sa fiche. */
async function noterHumeur(personneId, valeur) {
  const noeud = trouverNoeud(personneId);
  const notes = { ...(noeud?.notes_joueurs || {}) };
  const precedent = notes[etat.joueurActif] || { note: null, commentaire: '' };
  notes[etat.joueurActif] = { ...precedent, note: valeur };
  try {
    await Api.majPersonne(personneId, { relations_joueurs: notes });
    if (noeud) noeud.notes_joueurs = notes;
    etat.moteur?.recolorer();
  } catch (erreur) {
    message(`Erreur : ${erreur.message}`);
  }
}

// ---------------------------------------------------------------- légendes

function dessinerLegendes() {
  dessinerLegendeTypes();
  dessinerFiltre();
}

/**
 * Un clic isole, les suivants élargissent, et tout décocher revient à tout
 * afficher. `null` signifie « aucun filtre » — c'est l'état de départ.
 */
function basculerFiltre(visibles, id) {
  if (!visibles) return new Set([id]);
  const suivant = new Set(visibles);
  if (suivant.has(id)) suivant.delete(id);
  else suivant.add(id);
  return suivant.size ? suivant : null;
}

/**
 * Le rail liste TOUT le catalogue, pas seulement ce que la vue affiche : une
 * maison qu'on vient de créer doit apparaître avant d'avoir son premier
 * membre. Les comptes, eux, viennent bien de ce qui est affiché.
 */
function catalogue(cle, clePayload) {
  const affiches = new Map(
    (etat.payload?.legende?.[clePayload] || []).map((entree) => [entree.id, entree.nombre])
  );
  return (etat.referentiels[cle] || [])
    .map((fiche) => ({ ...fiche, nombre: affiches.get(fiche.id) || 0 }))
    .sort((a, b) => b.nombre - a.nombre || a.label.localeCompare(b.label));
}

const catalogueTypes = () => catalogue('types_relations', 'types');
const catalogueMaisons = () => catalogue('maisons', 'maisons');

/**
 * Le critère décrit l'axe de couleur courant : comment ranger un nœud, quelles
 * classes lister dans le rail, et ce que le clic droit propose. Ajouter un axe
 * (couleur + filtre + légende) tient donc en une entrée de cette fonction.
 */
function critereCourant() {
  const mode = etat.couleurPar;

  // Filtre sur mesure : tout vient du serveur (segments, appartenance,
  // exclusions). Le rail les liste comme n'importe quel autre axe.
  if (mode.startsWith('filtre:')) {
    const id = mode.slice(7);
    const fiche = (etat.referentiels.filtres || []).find((f) => f.id === id);
    const application = etat.applicationFiltre;
    const parNoeud = application?.noeuds || {};
    return {
      cle: mode,
      titre: fiche?.label || 'Filtre sur mesure',
      aide: application
        ? `${application.variable?.label || ''} — un clic isole un segment. Clic droit : régler.`
        : 'Calcul en cours…',
      classeDe: (noeud) => parNoeud[noeud.id] ?? '—',
      // Ce qui échoue aux tests n'est pas un segment : c'est hors sujet, et
      // ça reste masqué quels que soient les segments cochés.
      exclus: application?.exclus || [],
      entrees: (application?.segments || []).map((segment) => ({
        id: segment.id,
        label: segment.label,
        couleur: segment.couleur,
      })),
      menu: (entree, evenement) => menuFiltrePersonnalise(fiche, evenement),
      creer: (evenement) => editeurFiltre.ouvrirCreation(evenement.clientX, evenement.clientY),
      libelleCreer: '＋ Nouveau filtre',
    };
  }

  if (mode === 'generation') {
    const maximum = Math.max(0, ...(etat.payload?.noeuds || []).map((n) => n.generation || 0));
    return {
      cle: 'generation',
      titre: 'Générations',
      aide: 'Un clic isole une génération, les suivants l’élargissent.',
      classeDe: (noeud) => String(noeud.generation || 0),
      entrees: Array.from({ length: maximum + 1 }, (_, index) => ({
        id: String(index),
        label: `Génération ${index + 1}`,
        couleur: COULEURS_GENERATION[index % COULEURS_GENERATION.length],
      })),
    };
  }

  if (mode === 'statut') {
    return {
      cle: 'statut',
      titre: 'Statut',
      aide: 'Un clic ne garde que les vivants — ou que les morts.',
      classeDe: (noeud) => noeud.statut || 'inconnu',
      entrees: [
        { id: 'vivant', label: 'Vivant', couleur: '#3fa877' },
        { id: 'mort', label: 'Mort', couleur: '#9a6a6a' },
        { id: 'inconnu', label: 'Statut inconnu', couleur: '#8a8f98' },
      ],
    };
  }

  if (mode === 'joueurs' || mode.startsWith('joueur:')) {
    const joueur = mode.startsWith('joueur:') ? mode.slice(7) : null;
    const humeurDe = (noeud) =>
      joueur
        ? noeud.notes_joueurs?.[joueur]?.note ?? null
        : noeud.note_joueurs_moyenne
        ? Math.round(noeud.note_joueurs_moyenne)
        : null;
    return {
      cle: mode,
      titre: joueur ? 'Humeur envers ce joueur' : 'Humeur moyenne',
      aide: 'Un clic ne garde que ceux qui éprouvent cela.',
      classeDe: (noeud) => String(humeurDe(noeud) ?? 'aucune'),
      entrees: [
        ...tableHumeur().map((cran) => ({
          id: String(cran.valeur),
          label: `${cran.valeur} — ${cran.label.toLowerCase()}`,
          couleur: cran.couleur,
        })),
        { id: 'aucune', label: 'Pas encore rencontré', couleur: '#9aa3ae' },
      ],
    };
  }

  if (mode === 'categorie') {
    return {
      cle: 'categorie',
      titre: 'Catégories',
      aide: 'Regroupements de maisons. Clic droit : renommer, recolorer.',
      classeDe: (noeud) => noeud.categorie || '',
      entrees: [
        ...(etat.referentiels.categories_maisons || []).map((categorie) => ({
          id: categorie.id,
          label: categorie.label,
          couleur: categorie.couleur,
          fiche: categorie,
        })),
        { id: '', label: 'Sans catégorie', couleur: '#8a8f98' },
      ],
      menu: (entree, evenement) =>
        entree.fiche ? menuCategorie(entree.fiche, evenement) : menuCategories(evenement),
      creer: (evenement) => editeurCategorie.ouvrirCreation(evenement.clientX, evenement.clientY),
      libelleCreer: '＋ Nouvelle catégorie',
    };
  }

  return {
    cle: 'maison',
    titre: 'Maisons',
    aide: 'Un clic isole une maison, un clic droit la modifie.',
    classeDe: (noeud) => noeud.maison,
    entrees: catalogueMaisons().map((maison) => ({
      id: maison.id,
      label: maison.label,
      couleur: maison.couleur,
      fiche: maison,
    })),
    menu: (entree, evenement) => menuMaison(entree.fiche, evenement),
    creer: (evenement) => editeurMaison.ouvrirCreation(evenement.clientX, evenement.clientY),
    libelleCreer: '＋ Nouvelle maison',
  };
}

/**
 * Le moteur ne connaît que des ensembles masqués : on les dérive ici. Les
 * types se masquent par type ; les personnes, elles, se masquent par id —
 * c'est ce qui permet de filtrer sur n'importe quel critère sans que le
 * moteur ait à savoir ce qu'est une génération ou une humeur.
 */
function majMasques() {
  etat.typesMasques = etat.typesVisibles
    ? new Set(catalogueTypes().map((t) => t.id).filter((id) => !etat.typesVisibles.has(id)))
    : new Set();

  const critere = critereCourant();
  const visibles = etat.filtres[critere.cle] || null;
  etat.noeudsMasques = visibles
    ? new Set(
        (etat.payload?.noeuds || [])
          .filter((noeud) => !visibles.has(critere.classeDe(noeud)))
          .map((noeud) => noeud.id)
      )
    : new Set();
  // Les tests d'un filtre sur mesure passent avant les segments : ce qui ne
  // les passe pas n'a rien à faire sur le plan.
  (critere.exclus || []).forEach((id) => etat.noeudsMasques.add(id));
}

/**
 * Le type « Événement historique » — une bataille, un siège, un serment rompu.
 *
 * Il n'est pas installé d'office dans les sauvegardes existantes : ce serait
 * ajouter une entrée au catalogue de quelqu'un sans le lui demander. Le bouton
 * ne se montre que tant qu'aucun type n'est rangé dans cette catégorie, et il
 * disparaît dès qu'il y en a un — y compris un que l'on aurait nommé soi-même.
 */
function manqueTypeHistorique() {
  return !(etat.referentiels.types_relations || []).some(
    (type) => type.categorie === 'historique'
  );
}

async function creerTypeHistorique() {
  try {
    await Api.creerType({
      label: 'Événement historique',
      couleur: '#8a7f6a',
      categorie: 'historique',
      style: 'pointille',
      dirige: false,
    });
  } catch (erreur) {
    message(`Création impossible : ${erreur.message}`);
    return;
  }
  await chargerUnivers();
  await rechargerVue({ conserverFocus: true });
  astuce(
    'Type « Événement historique » créé : posez-le sur un lien pour raconter une bataille, avec sa date et son lieu.'
  );
}

function dessinerLegendeTypes() {
  elements.btnTypeHistorique.hidden = !manqueTypeHistorique();
  elements.legendeTypes.replaceChildren(
    ...catalogueTypes().map((type) => {
      const li = document.createElement('li');
      li.className = `${etat.typesMasques.has(type.id) ? 'eteint' : ''} ${
        type.nombre ? '' : 'inutilise'
      }`;
      li.title = type.nombre
        ? `${type.label} — ${type.nombre} lien(s) affiché(s). Clic droit pour le modifier.`
        : `${type.label} — aucun lien affiché. Clic droit pour le modifier.`;

      const trait = document.createElement('span');
      trait.className = 'legende-trait';
      trait.style.borderTopColor = type.couleur;
      trait.style.borderTopStyle =
        type.style === 'tirets' ? 'dashed' : type.style === 'pointille' ? 'dotted' : 'solid';

      const libelle = document.createElement('span');
      libelle.textContent = type.label;

      const nombre = document.createElement('span');
      nombre.className = 'nombre';
      nombre.textContent = type.nombre;

      li.append(trait, libelle);
      if (type.dirige) {
        const fleche = document.createElement('span');
        fleche.className = 'fleche';
        fleche.textContent = '→';
        li.append(fleche);
      }
      li.append(nombre);

      li.addEventListener('click', () => {
        if (!type.nombre) return; // isoler un type absent ne montrerait rien
        etat.typesVisibles = basculerFiltre(etat.typesVisibles, type.id);
        majMasques();
        dessinerLegendeTypes();
        etat.moteur?.majOptions({ typesMasques: etat.typesMasques });
        majStats();
      });
      surMenuContextuel(li, (evenement) => menuType(type, evenement));
      return li;
    })
  );
}

function menuType(type, evenement) {
  const { clientX: x, clientY: y } = evenement;
  const structurant = (etat.referentiels.types_structurants || []).includes(type.id);
  menu.ouvrir(x, y, [
    { titre: type.label, couleur: type.couleur },
    {
      texte: `${type.liens ?? 0} lien(s) dans la sauvegarde · ${
        type.dirige ? 'orienté' : 'réciproque'
      } · ${type.style}`,
    },
    {
      label: 'Modifier ce type…',
      icone: '✎',
      detail: 'nom, couleur, trait',
      onclick: () => editeurType.ouvrirModification(type, x, y),
    },
    { label: 'Nouveau type de lien…', icone: '＋', onclick: () => editeurType.ouvrirCreation(x, y) },
    { separateur: true },
    {
      label: 'Supprimer ce type…',
      icone: '🗑',
      danger: true,
      disabled: structurant,
      detail: structurant ? 'structure l’arbre' : '',
      onclick: () => editeurType.ouvrirSuppression(type, x, y),
    },
  ]);
}

function menuMaison(maison, evenement) {
  const { clientX: x, clientY: y } = evenement;
  menu.ouvrir(x, y, [
    { titre: maison.label, couleur: maison.couleur },
    {
      texte: maison.devise
        ? `« ${maison.devise} » · ${maison.personnes ?? 0} personne(s)`
        : `${maison.personnes ?? 0} personne(s) dans la sauvegarde`,
    },
    {
      label: 'Modifier cette maison…',
      icone: '✎',
      detail: 'nom, couleur, devise',
      onclick: () => editeurMaison.ouvrirModification(maison, x, y),
    },
    { label: 'Nouvelle maison…', icone: '＋', onclick: () => editeurMaison.ouvrirCreation(x, y) },
    { separateur: true },
    {
      label: 'Supprimer cette maison…',
      icone: '🗑',
      danger: true,
      disabled: (etat.referentiels.maisons || []).length <= 1,
      onclick: () => editeurMaison.ouvrirSuppression(maison, x, y),
    },
  ]);
}

/**
 * Le bloc « Filtre » du rail suit l'axe de couleur choisi en haut à droite :
 * maisons, générations, statut, humeur envers un joueur, catégories. Il liste
 * tout le catalogue (une classe vide reste visible, en grisé) et chaque entrée
 * filtre le plan.
 */
/**
 * Les axes en pastilles, dans le bloc lui-même : un filtre qu'on vient de
 * créer se rappelle d'un clic, sans repasser par la liste du haut.
 */
function dessinerAxes() {
  elements.axesFiltre.replaceChildren(
    ...listeAxes().map((axe) => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = `axe-puce ${etat.couleurPar === axe.id ? 'actif' : ''} ${
        axe.fiche ? 'sur-mesure' : ''
      }`;
      bouton.textContent = axe.court;
      bouton.title = axe.fiche
        ? `${axe.label} — filtre sur mesure. Clic droit : régler, supprimer.`
        : axe.label;
      if (axe.couleur) bouton.style.setProperty('--couleur-axe', axe.couleur);
      bouton.addEventListener('click', () => {
        etat.joueurActif = axe.id.startsWith('joueur:') ? axe.id.slice(7) : null;
        appliquerCouleurPar(axe.id);
      });
      if (axe.fiche) {
        surMenuContextuel(bouton, (evenement) => menuFiltrePersonnalise(axe.fiche, evenement));
      }
      return bouton;
    })
  );
}

function dessinerFiltre() {
  const critere = critereCourant();
  const visibles = etat.filtres[critere.cle] || null;

  const effectifs = new Map();
  (etat.payload?.noeuds || []).forEach((noeud) => {
    const classe = critere.classeDe(noeud);
    effectifs.set(classe, (effectifs.get(classe) || 0) + 1);
  });

  dessinerAxes();
  // Le titre du bloc ne bouge pas : c'est « Filtre » qui reste, l'axe qui
  // défile. Sinon on cherche « le filtre » et on ne trouve que « Maisons ».
  elements.titreFiltre.textContent = 'Filtre';
  elements.aideFiltre.textContent = `${critere.titre} — ${critere.aide
    .charAt(0)
    .toLowerCase()}${critere.aide.slice(1)}`;
  elements.btnNouvelleMaison.hidden = !critere.creer;
  if (critere.creer) elements.btnNouvelleMaison.textContent = critere.libelleCreer;

  elements.legendeMaisons.replaceChildren(
    ...critere.entrees.map((entree) => {
      const nombre = effectifs.get(entree.id) || 0;
      const li = document.createElement('li');
      const eteint = visibles && !visibles.has(entree.id);
      li.className = `${eteint ? 'eteint' : ''} ${nombre ? '' : 'inutilise'}`;
      li.title = nombre
        ? `${entree.label} — ${pluriel(nombre, 'fiche')} affichée${nombre > 1 ? 's' : ''}.`
        : `${entree.label} — personne pour l’instant.`;

      const pastille = document.createElement('span');
      pastille.className = 'legende-pastille';
      pastille.style.background = entree.couleur;

      const libelle = document.createElement('span');
      libelle.textContent = entree.label;

      const compte = document.createElement('span');
      compte.className = 'nombre';
      compte.textContent = nombre;

      li.append(pastille, libelle, compte);
      li.addEventListener('click', () => {
        if (!nombre && !visibles) return; // isoler une classe vide ne montrerait rien
        etat.filtres[critere.cle] = basculerFiltre(visibles, entree.id);
        majMasques();
        dessinerFiltre();
        // Pas de majStats() ici : le moteur rappelle `surDisposition` avec le
        // compte réellement affiché, et c'est lui qui a raison.
        etat.moteur?.majOptions({ noeudsMasques: etat.noeudsMasques });
      });
      if (critere.menu) {
        surMenuContextuel(li, (evenement) => critere.menu(entree, evenement));
      }
      return li;
    })
  );
}

// Compatibilité : plusieurs endroits appelaient encore l'ancien nom.
const dessinerLegendeMaisons = dessinerFiltre;

function menuCategories(evenement) {
  const { clientX: x, clientY: y } = evenement;
  menu.ouvrir(x, y, [
    { titre: 'Sans catégorie' },
    { texte: 'Les maisons qu’on n’a pas encore rangées.' },
    {
      label: 'Nouvelle catégorie…',
      icone: '＋',
      onclick: () => editeurCategorie.ouvrirCreation(x, y),
    },
  ]);
}

function menuFiltrePersonnalise(fiche, evenement) {
  const { clientX: x, clientY: y } = evenement;
  const application = etat.applicationFiltre;
  menu.ouvrir(x, y, [
    { titre: fiche?.label || 'Filtre sur mesure' },
    {
      texte: application
        ? `${application.variable?.label} · ${pluriel(
            application.segments?.length || 0,
            'segment'
          )} · ${pluriel(application.retenus || 0, 'personne')} retenue${
            (application.retenus || 0) > 1 ? 's' : ''
          }`
        : '—',
    },
    {
      label: 'Régler ce filtre…',
      icone: '⚙',
      detail: 'variable, segments, dégradé, tests',
      onclick: () => editeurFiltre.ouvrirModification(fiche, x, y),
    },
    { label: 'Nouveau filtre…', icone: '＋', onclick: () => editeurFiltre.ouvrirCreation(x, y) },
    { separateur: true },
    {
      label: 'Supprimer ce filtre…',
      icone: '🗑',
      danger: true,
      detail: 'aucune donnée n’est touchée',
      onclick: () => editeurFiltre.ouvrirSuppression(fiche, x, y),
    },
  ]);
}

function menuCategorie(categorie, evenement) {
  const { clientX: x, clientY: y } = evenement;
  menu.ouvrir(x, y, [
    { titre: categorie.label, couleur: categorie.couleur },
    {
      texte: `${pluriel(categorie.maisons ?? 0, 'maison')} · ${pluriel(
        categorie.personnes ?? 0,
        'personne'
      )}`,
    },
    {
      label: 'Modifier cette catégorie…',
      icone: '✎',
      detail: 'nom, couleur',
      onclick: () => editeurCategorie.ouvrirModification(categorie, x, y),
    },
    {
      label: 'Nouvelle catégorie…',
      icone: '＋',
      onclick: () => editeurCategorie.ouvrirCreation(x, y),
    },
    { separateur: true },
    {
      label: 'Supprimer cette catégorie…',
      icone: '🗑',
      danger: true,
      detail: 'les maisons restent, sans catégorie',
      onclick: () => editeurCategorie.ouvrirSuppression(categorie, x, y),
    },
  ]);
}

/**
 * Les options du rail sont générées à partir des paramètres déclarés par la
 * vue : une vue qui ajoute une case n'a rien à toucher ici. Les paramètres
 * `multi` (types, maisons, statuts) ne sont pas repris — ce sont les légendes
 * et le bloc « Filtre » qui les pilotent ; `recherche`, `focus` et
 * `profondeur` ont déjà leurs commandes ailleurs.
 */
function dessinerOptions(vue) {
  const parametres = (vue.parametres || []).filter((parametre) =>
    ['bool', 'entier'].includes(parametre.type)
  );

  elements.optionsVue.replaceChildren(
    ...parametres.map((parametre) => {
      if (parametre.type === 'entier') {
        const champ = document.createElement('input');
        champ.type = 'number';
        champ.min = parametre.min ?? 0;
        champ.max = parametre.max ?? 99;
        champ.value = etat.parametres[parametre.id] ?? parametre.defaut ?? 0;
        champ.addEventListener('change', () => {
          etat.parametres[parametre.id] = Number(champ.value);
          rechargerVue({ conserverFocus: true });
        });
        const ligne = document.createElement('label');
        ligne.className = 'option';
        const texte = document.createElement('span');
        texte.textContent = parametre.label;
        ligne.append(texte, champ);
        return ligne;
      }

      const case_ = document.createElement('input');
      case_.type = 'checkbox';
      case_.checked = !!(etat.parametres[parametre.id] ?? parametre.defaut);
      case_.addEventListener('change', () => {
        etat.parametres[parametre.id] = case_.checked;
        rechargerVue({ conserverFocus: true });
      });
      const ligne = document.createElement('label');
      ligne.className = 'option';
      const texte = document.createElement('span');
      texte.textContent = parametre.label;
      ligne.append(case_, texte);
      return ligne;
    })
  );
}

function majStats(info) {
  const stats = etat.payload?.stats;
  if (!stats) return;
  const noeud = etat.selection ? trouverNoeud(etat.selection) : null;
  if (noeud) {
    elements.stats.innerHTML = `
      <b>${echapper(noeud.label)}</b><br>
      ${noeud.degre} lien(s) direct(s)<br>
      <span style="color:var(--texte-faible)">${echapper(noeud.maison_label)} · génération ${
      (noeud.generation ?? 0) + 1
    }</span>`;
    return;
  }
  const masquees = [
    etat.typesMasques.size ? pluriel(etat.typesMasques.size, 'type') : '',
    etat.noeudsMasques.size ? pluriel(etat.noeudsMasques.size, 'fiche') : '',
  ].filter(Boolean);
  const masques = masquees.length
    ? `<br><span style="color:var(--texte-faible)">${masquees.join(
        ' et '
      )} hors du filtre</span>`
    : '';
  elements.stats.innerHTML = `<b>${info?.personnes ?? stats.personnes}</b> personnes affichées<br><b>${
    stats.liens
  }</b> liens · densité ${stats.densite}${masques}`;
}

function echapper(texte) {
  return String(texte ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// -------------------------------------------------------------- infobulle

function infobulleLien(arete, evenement) {
  if (!arete) return;
  const source = trouverNoeud(arete.source);
  const cible = trouverNoeud(arete.cible);
  elements.infobulle.replaceChildren();

  const titre = document.createElement('div');
  titre.className = 'ib-titre';
  titre.textContent = arete.emoji ? `${arete.emoji} ${arete.type_label}` : arete.type_label;
  titre.style.color = arete.couleur;

  const sous = document.createElement('div');
  sous.className = 'ib-sous';
  sous.textContent = `${source?.label || '?'} ${arete.dirige ? '→' : '↔'} ${cible?.label || '?'}`;

  elements.infobulle.append(titre, sous);
  const periode = [arete.depuis && `depuis ${arete.depuis}`, arete.jusqu_a && `jusqu’à ${arete.jusqu_a}`]
    .filter(Boolean)
    .join(', ');
  [
    arete.revolu ? '⧗ lien révolu' : null,
    periode || null,
    arete.lieu ? `⌖ ${arete.lieu}` : null,
    arete.label,
    arete.notes,
    arete.secret ? '⚑ lien secret' : null,
  ]
    .filter(Boolean)
    .forEach((texte) => {
      const ligne = document.createElement('div');
      ligne.className = 'ib-ligne';
      ligne.textContent = texte;
      elements.infobulle.append(ligne);
    });

  elements.infobulle.hidden = false;
  const scene = elements.scene.getBoundingClientRect();
  const boite = elements.infobulle.getBoundingClientRect();
  let x = evenement.clientX - scene.left + 16;
  let y = evenement.clientY - scene.top + 16;
  if (x + boite.width > scene.width) x = scene.width - boite.width - 12;
  if (y + boite.height > scene.height) y = evenement.clientY - scene.top - boite.height - 14;
  elements.infobulle.style.left = `${Math.max(6, x)}px`;
  elements.infobulle.style.top = `${Math.max(6, y)}px`;
}

function masquerInfobulle() {
  elements.infobulle.hidden = true;
}

function trouverNoeud(id) {
  return (etat.payload?.noeuds || []).find((noeud) => noeud.id === id);
}

// ------------------------------------------------------------------ thème

function appliquerTheme(nom) {
  document.body.classList.toggle('sombre', nom === 'sombre');
  localStorage.setItem('familytree-theme', nom);
}

// ---------------------------------------------------------------- événements

elements.recherche.addEventListener('input', (evenement) => {
  etat.recherche = evenement.target.value;
  etat.moteur?.majOptions({ recherche: etat.recherche });
  dessinerListePersonnes();
});
elements.recherche.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Enter') {
    const premier = elements.listePersonnes.querySelector('.item-personne');
    if (premier) selectionner(premier.dataset.id);
  }
  if (evenement.key === 'Escape') {
    elements.recherche.value = '';
    etat.recherche = '';
    etat.moteur?.majOptions({ recherche: '' });
    dessinerListePersonnes();
  }
});

elements.selecteurGroupe.addEventListener('change', (evenement) => {
  etat.groupePar = evenement.target.value;
  dessinerListePersonnes();
});

elements.selecteurCouleur.addEventListener('change', (evenement) => {
  const mode = evenement.target.value;
  // Choisir « Humeur envers X » à la main revient au même que cliquer le
  // joueur dans le rail : les deux commandes doivent rester d'accord.
  etat.joueurActif = mode.startsWith('joueur:') ? mode.slice(7) : null;
  appliquerCouleurPar(mode);
});

elements.btnNouvelleSauvegarde.addEventListener('click', (evenement) =>
  editeurSauvegarde.ouvrirCreation(evenement.clientX, evenement.clientY, {})
);
elements.btnImporterSauvegarde.addEventListener('click', () => editeurSauvegarde.importer());

elements.btnNouveauType.addEventListener('click', (evenement) =>
  editeurType.ouvrirCreation(evenement.clientX, evenement.clientY)
);
elements.basculeRevolus.addEventListener('change', (evenement) => {
  etat.masquerRevolus = evenement.target.checked;
  etat.moteur?.majOptions({ masquerRevolus: etat.masquerRevolus });
  dessinerLegendeTypes();
});
elements.btnTypeHistorique.addEventListener('click', () => creerTypeHistorique());
elements.btnNouveauJoueur.addEventListener('click', (evenement) =>
  editeurJoueur.ouvrirCreation(evenement.clientX, evenement.clientY)
);
// Le bouton du bloc « Filtre » crée ce que l'axe courant sait créer.
elements.btnNouvelleMaison.addEventListener('click', (evenement) =>
  critereCourant().creer?.(evenement)
);

// Le ＋ du titre ne dépend pas de l'axe courant : sans lui, on ne pourrait
// créer son premier filtre qu'en étant déjà sur un filtre.
elements.btnNouveauFiltre.addEventListener('click', (evenement) =>
  editeurFiltre.ouvrirCreation(evenement.clientX, evenement.clientY)
);

elements.btnAnnee.addEventListener('click', (evenement) => {
  const boite = evenement.currentTarget.getBoundingClientRect();
  editeurAnnee.ouvrir(boite.left, boite.bottom + 6);
});
elements.btnVueGenerale.addEventListener('click', () => vueGenerale());
// Sur écran large, ☰ replie le rail. Sur téléphone, les deux volets sont des
// tiroirs qui couvrent la scène : ouvrir l'un ferme l'autre, sinon on empile
// deux panneaux plein écran sans savoir lequel on regarde.
elements.btnRail.addEventListener('click', () => {
  elements.rail.classList.toggle('replie');
  elements.rail.classList.toggle('ouvert');
  elements.panneauVolet.classList.remove('ouvert');
});
elements.btnPanneau.addEventListener('click', () => {
  elements.panneauVolet.classList.toggle('ouvert');
  elements.rail.classList.remove('ouvert');
});
elements.btnFermerPanneau.addEventListener('click', () =>
  elements.panneauVolet.classList.remove('ouvert')
);
// Sous 760 px, la barre du haut ne garde que de quoi naviguer et le reste
// descend dans le rail. Voir `telephone.js` : sans ça, ☰ lui-même était hors
// de l'écran, et le rail devenait inatteignable.
installerTelephone(elements);
// Créer quelqu'un sans viser : le clic droit dans le vide reste, mais il n'est
// pas un geste qu'on trouve tout seul — et au doigt, il n'existait pas.
elements.btnNouveauProfil.addEventListener('click', (evenement) => {
  const boite = evenement.currentTarget.getBoundingClientRect();
  formulairePersonne.ouvrir(boite.left, boite.top - 12, {});
});
elements.btnAjuster.addEventListener('click', () => etat.moteur?.recentrer());
elements.btnFocus.addEventListener('click', () => {
  if (etat.selection) etat.moteur?.focus(etat.selection);
});
elements.btnTheme.addEventListener('click', () =>
  appliquerTheme(document.body.classList.contains('sombre') ? 'clair' : 'sombre')
);
elements.zoomMoins.addEventListener('click', () => etat.moteur?.zoomer(0.75));
elements.zoomPlus.addEventListener('click', () => etat.moteur?.zoomer(1.35));
elements.zoomCurseur.addEventListener('input', (evenement) =>
  etat.moteur?.definirZoom(Number(evenement.target.value) / 100)
);

// ------------------------------------------------ le compte et les données
//
// En ligne, il n'y a rien à enregistrer : chaque modification est écrite en
// base tout de suite. Ce qui reste de l'ancien groupe « Enregistrer », c'est
// savoir qui l'on est, sortir ses données, et pouvoir mettre une copie de
// côté avant de tout casser.

/** Le compte connecté, dans la barre du haut. */
async function dessinerCompte() {
  try {
    const reponse = await Api.moi();
    etat.compte = reponse.compte || reponse;
  } catch (erreur) {
    return; // 401 : `Api` a déjà renvoyé vers la page de connexion.
  }
  const compte = etat.compte || {};
  memoriserCompte(compte.role);

  // Un visiteur sans compte : pas d'adresse à afficher, et se « déconnecter »
  // ne voudrait rien dire — il n'y a rien où revenir.
  etat.invite = compte.role === 'invite';
  if (elements.groupeEssai) elements.groupeEssai.hidden = !etat.invite;
  elements.compte.hidden = etat.invite;
  elements.btnDeconnexion.hidden = etat.invite;
  document.body.classList.toggle('en-essai', etat.invite);
  if (etat.invite) dessinerBandeauEssai();

  elements.compte.textContent = compte.nom_affiche || compte.email || '';
  elements.compte.title = `${compte.email || ''}${ROLES[compte.role] ? ` · ${ROLES[compte.role]}` : ''}`;
  // Le lien n'apparaît qu'à qui la page répondra. Ce n'est pas ce qui la
  // protège — c'est `exigerGestion`, côté serveur — mais un bouton qui mène à
  // un 403 ne sert personne, et un bouton absent pour qui y a droit non plus :
  // **un intendant l'a**. Il ne l'avait pas jusqu'au 14/08/2026, la condition
  // étant restée sur `admin` seul depuis le lot 7, quand ce rôle était le seul.
  if (elements.lienAdmin) elements.lienAdmin.hidden = !PEUVENT_ADMINISTRER.has(compte.role);

  dessinerAideCompte(compte);
}

/** Ce que les rôles se disent en français, dans l'application. */
const ROLES = {
  admin: 'administrateur',
  intendant: 'intendant',
  membre: 'membre',
  invite: 'essai sans compte',
};

/** Les rôles auxquels `/admin` répond. Miroir de `exigerGestion`. */
const PEUVENT_ADMINISTRER = new Set(['admin', 'intendant']);

/**
 * La ligne d'état du bloc « Votre compte », au téléphone (13.B).
 *
 * Le bloc ne montrait que des boutons ; qui l'ouvre veut d'abord savoir **sous
 * quel compte il travaille**. L'adresse seule ne suffit pas : le rôle décide de
 * ce que la page d'administration lui montrera, et c'est justement ce qu'on
 * vient vérifier quand on l'ouvre.
 */
function dessinerAideCompte(compte) {
  const aide = document.getElementById('aide-compte');
  if (!aide) return;
  if (compte.role === 'invite') {
    aide.textContent =
      'Vous travaillez sans compte : ce monde est rattaché à ce navigateur seulement.';
    return;
  }
  const role = ROLES[compte.role] || compte.role || '';
  aide.textContent = `${compte.email || 'compte sans adresse'}${role ? ` — ${role}` : ''}.`;
}

/* ------------------------------------------------------- l'essai sans compte
 *
 * Le visiteur travaille dans un vrai monde, écrit en base comme tout le monde.
 * Ce qui lui manque, c'est une adresse pour le retrouver — et c'est ce que le
 * bandeau dit, une fois posément et une fois qu'il y a de quoi.
 */

const ESSAI_MASQUE = 'familytree-essai-masque';

function dessinerBandeauEssai() {
  if (!elements.bandeauEssai) return;
  // Un seul bandeau à la fois. Dans la démonstration, celui de la démonstration
  // dit déjà « créez un compte » — et deux barres empilées, c'est 130 px des
  // 812 d'un téléphone pour deux fois le même conseil (voir le lot 13, où l'on
  // s'est battu pour ces pixels-là).
  if (demonstrationOuverte()) {
    elements.bandeauEssai.hidden = true;
    return;
  }
  if (localStorage.getItem(ESSAI_MASQUE) && !etat.essaiModifie) {
    elements.bandeauEssai.hidden = true;
    return;
  }
  elements.bandeauEssai.hidden = false;
  elements.bandeauEssai.classList.toggle('presse', etat.essaiModifie);
  // Deux longueurs pour un même propos. Sur 375 px, la phrase longue tenait sur
  // trois lignes et le bandeau faisait 103 px de haut — 13 % de l'écran pour un
  // rappel. Ce n'est pas un texte au rabais : c'est le même, dit dans la place
  // dont on dispose, et il renvoie au 👤 qui a remplacé les boutons.
  const court = surTelephone();
  elements.bandeauEssaiTexte.textContent = etat.essaiModifie
    ? court
      ? 'Ce travail tient à ce navigateur seul. Un compte suffit à le garder.'
      : 'Vos modifications sont enregistrées, mais rattachées à ce navigateur seulement. Un compte suffit à les garder — adresse et mot de passe, rien d’autre.'
    : court
      ? 'Essai sans compte : modifiez tout. 👤 en haut pour en créer un.'
      : 'Essai sans compte : vous pouvez tout modifier. Créez un compte quand vous voudrez retrouver ce travail ailleurs.';
}

// Le texte dépend de la largeur : il doit donc se refaire quand elle change.
// Sans ça, ouvrir en grand puis réduire laisse la phrase longue sur 375 px.
window.addEventListener('resize', () => {
  if (etat.invite) dessinerBandeauEssai();
});

/**
 * Première écriture d'un visiteur : là, il a quelque chose à perdre.
 *
 * On ne l'interrompt pas — pas de fenêtre à fermer au milieu d'un geste — mais
 * le bandeau change de ton, et réapparaît même s'il l'avait masqué.
 */
function marquerEssaiModifie() {
  if (!etat.invite || etat.essaiModifie) return;
  etat.essaiModifie = true;
  dessinerBandeauEssai();
}

/* ---------------------------------------------------------- la démonstration
 *
 * Le seul monde de l'application où **ce qu'on fait ne sera pas gardé** : il
 * repart à zéro à la prochaine connexion, et au ménage de la nuit. Tout le
 * reste du client l'ignore — c'est une sauvegarde comme les autres, éditable
 * comme les autres — et c'est voulu : le terrain d'essai doit se comporter
 * exactement comme le vrai, sans quoi il n'apprend rien.
 *
 * Ce qui suit ne fait donc qu'une chose : **le dire**, au bon moment et sans
 * qu'on puisse le faire taire.
 */

const demonstrationOuverte = () => !!etat.demo?.actif && !PROCURATION && !PARTAGE;

function dessinerBandeauDemo() {
  if (!elements.bandeauDemo) return;
  if (!demonstrationOuverte()) {
    elements.bandeauDemo.hidden = true;
    if (etat.invite) dessinerBandeauEssai();
    return;
  }

  elements.bandeauDemo.hidden = false;
  elements.bandeauDemo.classList.toggle('presse', etat.demoModifiee);
  // `dessinerCompte` a pu montrer le bandeau d'essai avant que la liste des
  // sauvegardes ne dise qu'on est dans la démonstration : il faut le refaire
  // ici, sinon les deux barres cohabitent. C'était le cas au premier essai.
  if (etat.invite) dessinerBandeauEssai();
  // Deux longueurs pour un même propos, comme au lot 12 : sur 375 px, la phrase
  // longue prenait trois lignes. Ce n'est pas un texte au rabais, c'est le même
  // dit dans la place dont on dispose — et le mot qui compte y est toujours.
  const court = surTelephone();
  elements.bandeauDemoTexte.textContent = etat.demoModifiee
    ? court
      ? '⚗ Démonstration : ceci ne sera pas conservé.'
      : '⚗ Vous venez de modifier la démonstration. Rien n’y est conservé — elle repartira à zéro à votre prochaine connexion.'
    : court
      ? '⚗ Démonstration — rien n’y est conservé.'
      : '⚗ Démonstration — un monde d’exemple, le même pour tout le monde. Essayez tout ; rien de ce que vous y ferez n’est conservé.';

  // Le bouton dit ce qu'il faut faire **pour ne pas perdre ce qu'on vient de
  // faire**, et cela dépend de qui regarde : un visiteur n'a pas encore de
  // compte où le ranger, un membre en a un.
  elements.btnDemoGarder.textContent = etat.invite
    ? 'Créer un compte'
    : '⎘ En faire mon monde';
  elements.btnDemoGarder.title = etat.invite
    ? 'Votre adresse et un mot de passe : ce que vous avez construit ici devient votre premier monde'
    : 'Copier la démonstration dans une sauvegarde à vous — celle-là, vous la gardez';
}

// Comme le bandeau d'essai : le texte dépend de la largeur, donc il se refait
// quand elle change. Sans ça, ouvrir en grand puis réduire laisse la phrase
// longue sur 375 px.
window.addEventListener('resize', () => {
  if (demonstrationOuverte()) dessinerBandeauDemo();
});

/** Première écriture dans la démonstration : le ton change, rien ne bloque. */
function marquerDemoModifiee() {
  if (!demonstrationOuverte() || etat.demoModifiee) return;
  etat.demoModifiee = true;
  dessinerBandeauDemo();
}

/** « En faire mon monde » : une copie, avec son nom, qui se garde, elle. */
function garderLaDemonstration(evenement) {
  if (etat.invite) {
    location.href = '/connexion.html?creer=1';
    return;
  }
  if (!etat.demo) return;
  const point = pointDuGeste(evenement);
  editeurSauvegarde.ouvrirCreation(point.x, point.y, {
    depuis: etat.demo.id,
    nomSource: etat.demo.nom,
    nom: 'Mon Westeros',
  });
}

/** Le coin d'où ouvrir un éditeur ancré sur un bouton plutôt que sur un clic. */
function pointDuGeste(evenement) {
  const cible = evenement?.currentTarget;
  if (cible && typeof cible.getBoundingClientRect === 'function') {
    const cadre = cible.getBoundingClientRect();
    return { x: cadre.left, y: cadre.bottom + 6 };
  }
  return { x: evenement?.clientX ?? 120, y: evenement?.clientY ?? 120 };
}

async function reinitialiserDemonstration() {
  message('Remise à zéro de la démonstration…');
  try {
    await Api.reinitialiserDemonstration();
  } catch (erreur) {
    message(`Impossible de remettre à zéro : ${erreur.message}`);
    return;
  }
  etat.demoModifiee = false;
  // La route rend la démonstration active : on recharge le monde comme après
  // n'importe quel changement de sauvegarde, sinon l'écran garderait à l'image
  // les fiches qu'on vient d'effacer.
  await chargerUnivers();
  await choisirVue(etat.vueCourante?.id || etat.vues[0]?.id);
  message('');
}

elements.btnDemoGarder?.addEventListener('click', garderLaDemonstration);
elements.btnDemoCopier?.addEventListener('click', garderLaDemonstration);
elements.btnDemoReinitialiser?.addEventListener('click', reinitialiserDemonstration);

// Deux portes vers la visite guidée : le « ? » de la barre, discret et
// toujours là, et le bandeau de la démonstration — c'est-à-dire exactement
// l'écran où l'on se trouve quand on a besoin qu'on nous explique.
const relancerLeTutoriel = () => lancerLeTutoriel();
document.getElementById('btn-tutoriel')?.addEventListener('click', relancerLeTutoriel);
elements.btnDemoTutoriel?.addEventListener('click', relancerLeTutoriel);

Api.surEcriture = () => {
  marquerEssaiModifie();
  marquerDemoModifiee();
};

elements.bandeauEssaiFermer?.addEventListener('click', () => {
  localStorage.setItem(ESSAI_MASQUE, '1');
  etat.essaiModifie = false;
  elements.bandeauEssai.hidden = true;
});

async function seDeconnecter() {
  try {
    await Api.deconnexion();
  } catch (erreur) {
    // Peu importe : la session est de toute façon inutilisable ici.
  }
  location.href = '/connexion.html';
}

const sauvegardeActive = () => etat.sauvegardes.find((fiche) => fiche.actif) || null;

/**
 * « Tout télécharger » : **toutes** les sauvegardes du compte, dans un `.zip`,
 * avec un LISEZMOI qui dit quoi en faire. C'est le remplaçant en ligne du
 * dossier `data/sauvegardes/` de la version locale — de quoi partir d'ici sans
 * rien laisser derrière.
 */
function toutTelecharger() {
  if (!etat.sauvegardes.length) {
    message('Aucune sauvegarde à télécharger.');
    return;
  }
  telecharger(Api.urlExport('zip'));
  astuce(`Téléchargement de ${pluriel(etat.sauvegardes.length, 'sauvegarde')}…`);
}

/**
 * Instantané : en ligne, une copie datée *est* une sauvegarde de plus. Pas de
 * table à part, pas de route à écrire, et la restauration se fait en ouvrant
 * la copie — ce qui se voit dans le rail au lieu de se deviner.
 */
async function prendreInstantane() {
  const fiche = sauvegardeActive();
  if (!fiche) {
    message('Aucune sauvegarde ouverte.');
    return;
  }
  const horodatage = new Date().toISOString().slice(0, 16).replace('T', ' à ');
  const nom = `${fiche.nom} — ${horodatage}`;
  elements.etatEcriture.textContent = 'Copie en cours…';
  try {
    await Api.creerSauvegarde({ nom, depuis: fiche.id, contenu: 'copie' });
    await dessinerSauvegardes();
    elements.etatEcriture.textContent = '';
    astuce(`Copie datée rangée dans les sauvegardes : « ${nom} ».`);
  } catch (erreur) {
    elements.etatEcriture.textContent = '';
    message(`Copie impossible : ${erreur.message}`);
  }
}

elements.btnTelecharger.addEventListener('click', () => toutTelecharger());
elements.btnInstantane.addEventListener('click', () => prendreInstantane());
elements.btnDeconnexion.addEventListener('click', () => seDeconnecter());

document.addEventListener('keydown', (evenement) => {
  const saisie = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  // Ctrl+S est un réflexe, et il ne disparaît pas parce que le serveur a
  // changé. Plutôt que de laisser le navigateur proposer d'enregistrer la
  // page, on répond à la question que le geste pose vraiment.
  if ((evenement.ctrlKey || evenement.metaKey) && evenement.key.toLowerCase() === 's') {
    evenement.preventDefault();
    astuce('Déjà enregistré — en ligne, chaque modification part tout de suite.');
    return;
  }
  if (evenement.key === 'Escape' && !saisie) {
    // Une liaison en attente s'annule seule, sans quitter la vue en cours.
    if (etat.lienEnAttente) annulerLiaisonRapide();
    else vueGenerale();
  }
  if (evenement.key === '/' && !saisie) {
    evenement.preventDefault();
    elements.recherche.focus();
  }
});

// Poignée de mise au point : `familyTree.etat`, `familyTree.moteur.focus('id')`…
window.familyTree = {
  etat,
  get moteur() {
    return etat.moteur;
  },
  selectionner,
  vueGenerale,
  rechargerVue,
};

demarrer();
