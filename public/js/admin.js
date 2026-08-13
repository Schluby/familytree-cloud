/**
 * Page d'administration.
 *
 * Elle ne sait rien faire que l'API n'autorise pas : les arbres des autres
 * comptes n'y sont que des tableaux, sans le moindre champ modifiable. Ce n'est
 * pas ce fichier qui garantit la lecture seule — c'est `lectureSeule` côté
 * serveur — mais l'interface doit dire la même chose que l'API, sinon elle
 * ment.
 */

import { appeler, deriverCle } from './identite.js';

const $ = (id) => document.getElementById(id);

const dateLisible = (secondes) =>
  secondes ? new Date(secondes * 1000).toISOString().slice(0, 16).replace('T', ' à ') : '—';

const poids = (octets) =>
  octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(0, Math.round(octets / 1024))} Ko`;

function message(texte, genre = '') {
  $('message').textContent = texte;
  $('message').className = `message ${genre}`;
}

/** Crée un élément et le remplit — jamais d'innerHTML avec des données. */
function el(nom, texte, classe) {
  const noeud = document.createElement(nom);
  if (texte !== undefined && texte !== null) noeud.textContent = String(texte);
  if (classe) noeud.className = classe;
  return noeud;
}

/** Une ligne « il n'y a rien », qui occupe toute la largeur du tableau. */
function ligneVide(texte, colonnes) {
  const tr = el('tr');
  const td = el('td', texte);
  td.colSpan = colonnes;
  tr.append(td);
  return tr;
}

function bouton(libelle, surClic, classe = 'lien') {
  const b = el('button', libelle, classe);
  b.type = 'button';
  b.addEventListener('click', surClic);
  return b;
}

/* ---------------------------------------------------------------- comptes */

let comptes = [];

/** Les comptes cochés. Vit ici parce que tout le bas de la page en dépend. */
const selection = new Set();

const ROLES = {
  admin: 'administrateur',
  membre: 'membre',
  // Lot 9.C : un visiteur qui n'a pas encore créé de compte. Il en a pourtant
  // un vrai, avec ses sauvegardes — le dire autrement serait mentir.
  invite: 'essai',
};

async function chargerComptes() {
  const { ok, code, donnees } = await appeler('/api/admin/utilisateurs');
  if (!ok) {
    if (code === 401) return location.replace('/connexion.html?retour=%2Fadmin.html');
    if (code === 403) {
      document.querySelector('main').replaceChildren(
        el('h1', 'Réservé aux administrateurs'),
        el('p', "Ce compte n'a pas ce rôle. Il se donne en SQL, jamais depuis l'interface.")
      );
      return;
    }
    message(donnees?.erreur || `Erreur ${code}`, 'erreur');
    return;
  }

  comptes = donnees.utilisateurs;
  $('sousTitre').textContent =
    `${comptes.length} compte${comptes.length > 1 ? 's' : ''} sur cette instance.`;

  // Un compte disparu de la liste ne doit pas rester dans la sélection : il
  // serait invisible et pourtant compté dans le lot.
  for (const id of [...selection]) {
    if (!comptes.some((compte) => compte.id === id)) selection.delete(id);
  }

  dessinerComptes();
  await chargerJournal();
}

/** Redessine le tableau sans le recharger — cocher n'est pas un aller-retour. */
function dessinerComptes() {
  $('corpsComptes').replaceChildren(
    ...comptes.map((compte) => {
      const ligne = el('tr');

      const caseACocher = document.createElement('input');
      caseACocher.type = 'checkbox';
      caseACocher.checked = selection.has(compte.id);
      caseACocher.title = `Sélectionner ${compte.email || 'ce compte'}`;
      caseACocher.addEventListener('change', () => {
        if (caseACocher.checked) selection.add(compte.id);
        else selection.delete(compte.id);
        majSelection();
      });
      const celluleCoche = el('td', null, 'coche');
      celluleCoche.append(caseACocher);
      ligne.append(celluleCoche);

      ligne.append(
        el('td', compte.email || `essai ${compte.id.slice(0, 8)}`),
        el('td', ROLES[compte.role] || compte.role),
        el('td', compte.sauvegardes),
        el('td', `${compte.personnes} pers. · ${compte.relations} liens`),
        el('td', `${poids(compte.octets)} / ${poids(compte.plafond_octets)}`),
        el('td', dateLisible(compte.dernier_acces))
      );

      const actions = el('td', null, 'actions');
      actions.append(
        bouton('Arbres', () => chargerSauvegardes(compte)),
        bouton('Plafond…', () => changerPlafond(compte)),
        bouton('Mot de passe…', () => reinitialiser(compte)),
        bouton('Supprimer', () => supprimerCompte(compte), 'lien danger')
      );
      ligne.append(actions);
      return ligne;
    })
  );

  majSelection();
}

async function changerPlafond(compte) {
  const octets = prompt(
    `Plafond par sauvegarde pour ${compte.email}, en Ko (entre 64 et 65536) :`,
    String(Math.round(compte.plafond_octets / 1024))
  );
  if (octets === null) return;
  const nombre = prompt(
    `Nombre de sauvegardes autorisées (1 à 200) :`,
    String(compte.plafond_sauvegardes)
  );
  if (nombre === null) return;

  const { ok, donnees } = await appeler(`/api/admin/utilisateurs/${compte.id}/plafond`, {
    method: 'POST',
    body: JSON.stringify({ octets: Number(octets) * 1024, sauvegardes: Number(nombre) }),
  });
  message(ok ? `Plafonds de ${compte.email} mis à jour.` : donnees?.erreur, ok ? 'reussite' : 'erreur');
  if (ok) chargerComptes();
}

async function reinitialiser(compte) {
  const nouveau = prompt(
    `Nouveau mot de passe pour ${compte.email} (8 caractères au moins).\n` +
      `Toutes ses sessions seront fermées. Transmettez-le-lui par un autre canal.`
  );
  if (nouveau === null) return;
  if (nouveau.length < 8) {
    message('Huit caractères au moins.', 'erreur');
    return;
  }

  message('Dérivation en cours…');
  try {
    // Dérivée ici, avec le sel de l'adresse *du compte visé* : le mot de passe
    // ne circule pas plus pour une réinitialisation que pour une connexion.
    const cle = await deriverCle(compte.email, nouveau);
    const { ok, donnees } = await appeler(`/api/admin/utilisateurs/${compte.id}/mot-de-passe`, {
      method: 'POST',
      body: JSON.stringify({ cle }),
    });
    message(
      ok ? `Mot de passe de ${compte.email} remplacé, ses sessions sont fermées.` : donnees?.erreur,
      ok ? 'reussite' : 'erreur'
    );
    if (ok) chargerJournal();
  } catch (erreur) {
    message(erreur.message, 'erreur');
  }
}

async function supprimerCompte(compte) {
  if (!confirm(`Supprimer ${compte.email} et ses ${compte.sauvegardes} sauvegarde(s) ?\nC'est définitif.`)) {
    return;
  }
  const { ok, code, donnees } = await appeler(`/api/admin/utilisateurs/${compte.id}`, {
    method: 'DELETE',
  });
  if (code === 204) {
    message(`${compte.email} supprimé.`, 'reussite');
    $('carteSauvegardes').classList.add('cache');
    $('carteArbre').classList.add('cache');
    chargerComptes();
    return;
  }
  message(donnees?.erreur || `Erreur ${code}`, 'erreur');
}

/* ----------------------------------------------------------- sauvegardes */

async function chargerSauvegardes(compte) {
  const { ok, donnees } = await appeler(`/api/admin/utilisateurs/${compte.id}/sauvegardes`);
  if (!ok) {
    message(donnees?.erreur || 'Erreur', 'erreur');
    return;
  }

  $('carteSauvegardes').classList.remove('cache');
  $('carteArbre').classList.add('cache');
  $('titreSauvegardes').textContent = `Sauvegardes de ${compte.email}`;

  $('corpsSauvegardes').replaceChildren(
    ...(donnees.sauvegardes.length
      ? donnees.sauvegardes.map((fiche) => {
          const ligne = el('tr');
          ligne.append(
            el('td', fiche.nom),
            el('td', fiche.personnes),
            el('td', fiche.relations),
            el('td', poids(fiche.taille)),
            el('td', dateLisible(fiche.modifie_le))
          );
          const actions = el('td', null, 'actions');
          const lienJson = el('a', '⤓ .json');
          lienJson.href = `/api/admin/sauvegardes/${fiche.id}/export`;
          const lienXlsx = el('a', '⤓ .xlsx');
          lienXlsx.href = `/api/admin/sauvegardes/${fiche.id}/export?format=xlsx`;
          // « Éditer » ouvre l'application entière sur cet arbre, par
          // procuration (lot 8.F). « Consulter » reste la lecture à plat, qui
          // ne peut rien écrire — les deux gestes ne se valent pas, et on doit
          // pouvoir choisir le moindre.
          const lienEdition = el('a', '✎ Éditer');
          lienEdition.href = `/?arbre=${encodeURIComponent(fiche.id)}`;
          lienEdition.title =
            `Ouvrir « ${fiche.nom} » dans l'application, avec droit d'écriture. ` +
            'Chaque modification est inscrite au journal.';
          actions.append(
            bouton('Consulter', () => consulter(fiche, compte)),
            lienEdition,
            lienJson,
            lienXlsx
          );
          ligne.append(actions);
          return ligne;
        })
      : [ligneVide('Aucune sauvegarde.', 6)])
  );

  $('carteSauvegardes').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ----------------------------------------------------------------- arbre */

let tables = [];

async function consulter(fiche, compte) {
  message('Ouverture…');
  const { ok, donnees } = await appeler(`/api/admin/sauvegardes/${fiche.id}`);
  if (!ok) {
    message(donnees?.erreur || 'Erreur', 'erreur');
    return;
  }
  message('');

  tables = donnees.tables;
  $('carteArbre').classList.remove('cache');
  $('quiArbre').textContent =
    `« ${fiche.nom} » — ${compte.email}. Cette ouverture est inscrite au journal.`;

  $('ongletsTables').replaceChildren(
    ...tables.map((table, index) => {
      const b = el('button', `${table.titre} ${table.lignes.length}`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        [...$('ongletsTables').children].forEach((autre) =>
          autre.setAttribute('aria-selected', 'false')
        );
        b.setAttribute('aria-selected', 'true');
        dessinerTable(table);
      });
      return b;
    })
  );

  dessinerTable(tables[0]);
  $('carteArbre').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const MAX_LIGNES = 300;

function dessinerTable(table) {
  if (!table) return;
  const entete = el('tr');
  table.colonnes.forEach((colonne) => entete.append(el('th', colonne.label)));
  $('enteteArbre').replaceChildren(entete);

  const visibles = table.lignes.slice(0, MAX_LIGNES);
  $('corpsArbre').replaceChildren(
    ...visibles.map((valeurs) => {
      const ligne = el('tr');
      valeurs.forEach((valeur) =>
        ligne.append(el('td', valeur === null || valeur === undefined ? '' : valeur))
      );
      return ligne;
    })
  );

  $('compteLignes').textContent =
    visibles.length < table.lignes.length
      ? `${visibles.length} lignes affichées sur ${table.lignes.length} — téléchargez le fichier pour tout voir.`
      : `${table.lignes.length} ligne${table.lignes.length > 1 ? 's' : ''}.`;
}

/* --------------------------------------------------------------- journal */

const LIBELLES = {
  consultation: 'a ouvert un arbre',
  export: 'a exporté un arbre',
  plafond: 'a changé un plafond',
  reinitialisation: 'a réinitialisé un mot de passe',
  suppression: 'a supprimé un compte',
  // Le geste qui laisse une trace *dans* les données de quelqu'un d'autre :
  // une édition par procuration (8.F) ou une sauvegarde touchée par un lot.
  edition: 'a modifié un arbre',
};

async function chargerJournal() {
  const { ok, donnees } = await appeler('/api/admin/journal');
  if (!ok) return;

  $('corpsJournal').replaceChildren(
    ...(donnees.journal.length
      ? donnees.journal.map((ligne) => {
          const tr = el('tr');
          tr.append(
            el('td', dateLisible(ligne.le)),
            el('td', ligne.admin_email || ligne.admin_id),
            el('td', LIBELLES[ligne.action] || ligne.action),
            el('td', ligne.cible_email || ligne.cible_utilisateur || '—')
          );
          return tr;
        })
      : [ligneVide('Rien pour l’instant.', 4)])
  );
}

/* ------------------------------------------------------------------- lots */

/**
 * Un lot, c'est le même geste posé sur les arbres de plusieurs comptes.
 *
 * Deux règles tiennent toute cette partie :
 *
 * 1. **Rien ne s'écrit sans un aperçu.** Le bouton « Appliquer » ne s'allume
 *    qu'après un aperçu, et se rééteint dès qu'un champ, la portée ou la
 *    sélection changent — sinon on appliquerait autre chose que ce qu'on a lu.
 * 2. **L'aperçu et l'application sont deux adresses distinctes.** Ce n'est pas
 *    un booléen qu'on pourrait oublier : `/lots/apercu` ne sait pas écrire.
 */

let catalogues = null;
/** Les champs affichés, avec de quoi les relire. Reconstruit à chaque choix. */
let champsCourants = [];
/** La signature du lot tel qu'il était au moment de l'aperçu. */
let apercuValide = null;
/** Où en est le lot : ce qu'il reste à faire avant de pouvoir écrire. */
let etape = 'a-faire';
/** La requête en cours, s'il y en a une : `'apercu'`, `'appliquer'`, ou `''`. */
let occupe = '';

/**
 * Pourquoi « Appliquer » est éteint — à dire *toujours*.
 *
 * Un bouton gris et muet se lit comme un bouton qui charge, surtout quand son
 * libellé se termine par des points de suspension. C'est ce qui s'est passé :
 * on attendait la fin d'un calcul qui n'avait jamais commencé.
 */
const RAISONS = {
  'a-faire': 'Faites d’abord un aperçu — « Appliquer » s’allumera ensuite.',
  pret: 'Aperçu relu : vous pouvez appliquer.',
  'sans-effet': 'Cet aperçu ne change rien — le lot est déjà en place partout.',
};

const STATUTS = ['vivant', 'mort', 'inconnu'];

function champsDe(operation) {
  const identifiant = (aide) => ({ nom: 'id', label: 'Identifiant (facultatif)', aide });

  switch (operation) {
    case 'meta':
      return [
        {
          nom: 'annee_courante',
          label: 'Date de campagne',
          bascule: 'Poser la date',
          aide: '« 300 AC », « 1482 »… Laissez vide pour l’effacer partout.',
        },
        {
          nom: 'document',
          label: 'Lien de campagne',
          bascule: 'Poser le lien de campagne',
          aide: 'Une adresse http(s) complète. Vide pour l’effacer partout.',
        },
      ];

    case 'maison':
      return [
        identifiant('Déduit du nom si vide. C’est lui qui rend le lot rejouable.'),
        { nom: 'label', label: 'Nom de la maison', requis: true },
        { nom: 'couleur', label: 'Couleur', type: 'couleur' },
        { nom: 'devise', label: 'Devise' },
        { nom: 'categorie', label: 'Catégorie (identifiant)' },
        { nom: 'notes', label: 'Notes', type: 'zone' },
        { nom: 'caracteristiques', type: 'caracteristiques' },
      ];

    case 'personne':
      return [
        identifiant('Déduit du prénom et du nom si vide.'),
        { nom: 'prenom', label: 'Prénom', requis: true },
        { nom: 'nom', label: 'Nom' },
        { nom: 'titre', label: 'Titre' },
        { nom: 'maison', label: 'Maison (identifiant)' },
        {
          nom: 'statut',
          label: 'Statut',
          type: 'liste',
          options: [{ id: '', label: '—' }, ...STATUTS.map((id) => ({ id, label: id }))],
        },
        { nom: 'notes', label: 'Notes', type: 'zone' },
      ];

    case 'relation':
      return [
        { nom: 'source', label: 'Fiche de départ (identifiant)', requis: true },
        { nom: 'cible', label: 'Fiche d’arrivée (identifiant)', requis: true },
        { nom: 'type_lien', label: 'Type de lien (identifiant)', requis: true },
        { nom: 'label', label: 'Libellé' },
        { nom: 'emoji', label: 'Pastille' },
        { nom: 'notes', label: 'Notes', type: 'zone' },
        { nom: 'revolu', label: 'Lien révolu', type: 'bool' },
        { nom: 'secret', label: 'Lien secret', type: 'bool' },
      ];

    case 'type-relation':
      return [
        identifiant('Déduit du nom si vide.'),
        { nom: 'label', label: 'Nom du type', requis: true },
        { nom: 'couleur', label: 'Couleur', type: 'couleur' },
        {
          nom: 'categorie',
          label: 'Catégorie',
          type: 'liste',
          options: catalogues ? catalogues.categories : [],
        },
        {
          nom: 'style',
          label: 'Style de trait',
          type: 'liste',
          options: catalogues ? catalogues.styles : [],
        },
        { nom: 'dirige', label: 'Lien orienté', type: 'bool' },
      ];

    case 'categorie':
      return [
        identifiant('Déduit du nom si vide.'),
        { nom: 'label', label: 'Nom de la catégorie', requis: true },
        { nom: 'couleur', label: 'Couleur', type: 'couleur' },
      ];

    default:
      return [];
  }
}

function construireFormulaire() {
  const champs = champsDe($('choixOperation').value);
  champsCourants = [];
  const grille = el('div', null, 'grille');

  for (const champ of champs) {
    if (champ.type === 'caracteristiques') continue;

    if (champ.type === 'bool') {
      const entree = document.createElement('input');
      entree.type = 'checkbox';
      const enveloppe = el('label', null, 'bascule');
      enveloppe.append(entree, el('span', champ.label));
      grille.append(enveloppe);
      champsCourants.push({ champ, entree });
      continue;
    }

    const etiquette = el('label', champ.label);
    let entree;
    if (champ.type === 'liste') {
      entree = document.createElement('select');
      for (const option of champ.options) {
        const noeud = el('option', option.label);
        noeud.value = option.id;
        entree.append(noeud);
      }
    } else if (champ.type === 'zone') {
      entree = document.createElement('textarea');
      entree.rows = 2;
    } else {
      entree = document.createElement('input');
      entree.type = 'text';
      if (champ.type === 'couleur') entree.placeholder = '#7a7f87';
    }

    let interrupteur = null;
    if (champ.bascule) {
      // Un champ à bascule reste éteint tant qu'on ne l'a pas armé : sans ça,
      // un lot « date » effacerait le lien de campagne de tout le monde au
      // passage, juste parce que la case d'à côté était vide.
      interrupteur = document.createElement('input');
      interrupteur.type = 'checkbox';
      const ligne = el('span', null, 'bascule');
      ligne.append(interrupteur, el('span', champ.bascule));
      etiquette.append(ligne);
      entree.disabled = true;
      interrupteur.addEventListener('change', () => {
        entree.disabled = !interrupteur.checked;
      });
    }

    etiquette.append(entree);
    if (champ.aide) etiquette.append(el('span', champ.aide, 'note'));
    grille.append(etiquette);
    champsCourants.push({ champ, entree, interrupteur });
  }

  const morceaux = [grille];

  // Les sept ressources d'une maison viennent du serveur : la page ne les
  // recopie pas, elle construit sa grille à partir de ce qu'il annonce.
  if (champs.some((champ) => champ.type === 'caracteristiques') && catalogues) {
    const scores = new Map();
    const bande = el('div', null, 'grille serree');
    for (const caracteristique of catalogues.caracteristiques_maison) {
      const etiquette = el('label', caracteristique.label);
      etiquette.title = caracteristique.aide;
      const entree = document.createElement('input');
      entree.type = 'number';
      entree.min = '0';
      entree.max = '100';
      etiquette.append(entree);
      bande.append(etiquette);
      scores.set(caracteristique.id, entree);
    }
    morceaux.push(el('p', 'Caractéristiques — laissez vide ce que vous ne posez pas', 'sous-titre'), bande);
    champsCourants.push({ champ: { type: 'caracteristiques' }, entree: scores });
  }

  $('formulaireLot').replaceChildren(...morceaux);
  perimerApercu();
}

/** Ce que le lot enverra. Les champs vides ne sont pas envoyés du tout. */
function operationCourante() {
  const operation = { type: $('choixOperation').value };

  for (const { champ, entree, interrupteur } of champsCourants) {
    if (champ.type === 'caracteristiques') {
      const scores = {};
      for (const [id, saisie] of entree) {
        if (saisie.value !== '') scores[id] = Number(saisie.value);
      }
      if (Object.keys(scores).length) operation.caracteristiques = scores;
      continue;
    }
    if (champ.type === 'bool') {
      operation[champ.nom] = entree.checked;
      continue;
    }
    // Un champ à bascule s'envoie dès qu'il est coché — vide compris, puisque
    // c'est ainsi qu'on efface.
    if (interrupteur) {
      if (interrupteur.checked) operation[champ.nom] = entree.value.trim();
      continue;
    }
    const valeur = entree.value.trim();
    if (valeur) operation[champ.nom] = valeur;
  }

  return operation;
}

function corpsDuLot() {
  return {
    comptes: [...selection],
    portee: $('choixPortee').value,
    operation: operationCourante(),
  };
}

/** Ce qui manque pour que le lot ait un sens, ou `''`. */
function cequiManque() {
  if (!selection.size) return 'Sélectionnez au moins un compte.';
  const operation = operationCourante();
  for (const { champ } of champsCourants) {
    if (champ.requis && !operation[champ.nom]) return `« ${champ.label} » est nécessaire.`;
  }
  if (operation.type === 'meta' && !Object.keys(operation).some((cle) => cle !== 'type')) {
    return 'Cochez au moins l’un des deux champs.';
  }
  return '';
}

/** Un aperçu ne vaut que pour le lot exact qu'on a lu. */
function perimerApercu() {
  apercuValide = null;
  etape = 'a-faire';
  majBoutons();
}

/**
 * L'état des deux boutons, dit d'un seul endroit.
 *
 * L'accent marque le geste suivant : « Aperçu » tant qu'on n'a rien relu, puis
 * « Appliquer ». Et le libellé change pendant la requête, pour qu'une vraie
 * attente ne ressemble pas à un bouton simplement éteint.
 */
function majBoutons() {
  const manque = cequiManque();
  const btnApercu = $('btnApercu');
  const btnAppliquer = $('btnAppliquer');

  btnApercu.disabled = Boolean(occupe) || Boolean(manque);
  btnAppliquer.disabled = Boolean(occupe) || etape !== 'pret';

  btnApercu.textContent = occupe === 'apercu' ? 'Aperçu en cours…' : 'Aperçu';
  btnAppliquer.textContent = occupe === 'appliquer' ? 'Écriture en cours…' : 'Appliquer';
  btnApercu.classList.toggle('occupe', occupe === 'apercu');
  btnAppliquer.classList.toggle('occupe', occupe === 'appliquer');

  btnApercu.classList.toggle('accent', etape !== 'pret');
  btnAppliquer.classList.toggle('accent', etape === 'pret');

  $('raisonLot').textContent = occupe ? '' : manque || RAISONS[etape];
}

function majSelection() {
  const choisis = comptes.filter((compte) => selection.has(compte.id));
  const sauvegardes = choisis.reduce(
    (total, compte) =>
      total + ($('choixPortee').value === 'active' ? Math.min(1, compte.sauvegardes) : compte.sauvegardes),
    0
  );

  $('carteLots').classList.toggle('cache', !choisis.length);
  $('cartePanorama').classList.toggle('cache', !choisis.length);
  $('portee').textContent = choisis.length
    ? `${choisis.length} compte${choisis.length > 1 ? 's' : ''} sélectionné${
        choisis.length > 1 ? 's' : ''
      } · ${sauvegardes} sauvegarde${sauvegardes > 1 ? 's' : ''} seraient touchée${
        sauvegardes > 1 ? 's' : ''
      }.`
    : 'Aucun compte sélectionné.';

  const toutes = comptes.length > 0 && choisis.length === comptes.length;
  $('toutCocher').checked = toutes;
  $('toutCocher').indeterminate = choisis.length > 0 && !toutes;
  perimerApercu();
}

async function lancerLot(chemin, quoi) {
  const manque = cequiManque();
  if (manque) {
    message(manque, 'erreur');
    return null;
  }

  occupe = quoi;
  majBoutons();
  message(quoi === 'apercu' ? 'Aperçu en cours…' : 'Écriture en cours…');
  try {
    const { ok, donnees } = await appeler(chemin, {
      method: 'POST',
      body: JSON.stringify(corpsDuLot()),
    });
    if (!ok) {
      message(donnees?.erreur || 'Erreur', 'erreur');
      return null;
    }
    dessinerResultat(donnees);
    return donnees;
  } catch (erreur) {
    // Sans ce filet, une coupure du réseau laissait « en cours… » à l'écran
    // pour toujours : la promesse était rejetée et personne ne le disait.
    message(`Le serveur n’a pas répondu — ${erreur.message}`, 'erreur');
    return null;
  } finally {
    occupe = '';
    majBoutons();
  }
}

async function apercu() {
  const resultat = await lancerLot('/api/admin/lots/apercu', 'apercu');
  if (!resultat) return;

  const sansEffet = resultat.resume.creees + resultat.resume.mises_a_jour === 0;
  apercuValide = sansEffet ? null : JSON.stringify(corpsDuLot());
  etape = sansEffet ? 'sans-effet' : 'pret';
  majBoutons();
  message(
    sansEffet
      ? 'Rien ne changerait : ce lot est déjà en place.'
      : 'Aperçu — rien n’a été écrit. Relisez, puis appliquez.',
    'reussite'
  );
}

async function appliquer() {
  // Le formulaire a pu bouger entre l'aperçu et le clic : dans ce cas on
  // n'applique pas ce que l'administrateur croit avoir relu.
  if (apercuValide !== JSON.stringify(corpsDuLot())) {
    perimerApercu();
    message('Le lot a changé depuis l’aperçu. Refaites un aperçu.', 'erreur');
    return;
  }

  const attendu = JSON.parse(apercuValide);
  if (
    !confirm(
      `Écrire dans les arbres de ${attendu.comptes.length} compte(s) ?\n` +
        'Chaque sauvegarde touchée sera inscrite au journal.\n' +
        'C’est immédiat, et il n’y a pas d’annulation.'
    )
  ) {
    return;
  }

  const resultat = await lancerLot('/api/admin/lots/appliquer', 'appliquer');
  if (!resultat) return;

  perimerApercu();
  message(
    `Appliqué : ${resultat.resume.creees} création(s), ${resultat.resume.mises_a_jour} mise(s) à jour, ` +
      `${resultat.resume.refusees} refus.`,
    resultat.resume.refusees ? 'erreur' : 'reussite'
  );
  chargerComptes();
}

const EFFETS = {
  cree: 'créé',
  mis_a_jour: 'mis à jour',
  inchange: 'déjà en place',
  refuse: 'refusé',
};

function dessinerResultat(resultat) {
  $('blocResultat').classList.remove('cache');
  const { resume } = resultat;
  $('resumeLot').textContent =
    `${resume.comptes} compte(s), ${resume.sauvegardes} sauvegarde(s) — ` +
    `${resume.creees} à créer, ${resume.mises_a_jour} à mettre à jour, ` +
    `${resume.inchangees} déjà en place, ${resume.refusees} refusée(s).` +
    (resultat.simulation ? ' Rien n’est écrit à ce stade.' : '');

  $('corpsResultat').replaceChildren(
    ...(resultat.details.length
      ? resultat.details.map((detail) => {
          const tr = el('tr');
          tr.append(
            el('td', detail.compte),
            el('td', detail.sauvegarde),
            el('td', EFFETS[detail.etat] || detail.etat, `etat-${detail.etat}`),
            el('td', detail.message || detail.quoi)
          );
          return tr;
        })
      : [ligneVide('Aucune sauvegarde touchée.', 4)])
  );
}

/* --------------------------------------------------------------- panorama */

const AXES = [
  ['maisons', 'Maisons'],
  ['categories', 'Catégories'],
  ['types', 'Types de liens'],
  ['filtres', 'Filtres'],
  ['listes', 'Listes'],
];

async function relever() {
  message('Relevé en cours…');
  const { ok, donnees } = await appeler('/api/admin/lots/panorama', {
    method: 'POST',
    body: JSON.stringify({ comptes: [...selection], portee: $('choixPortee').value }),
  });
  if (!ok) {
    message(donnees?.erreur || 'Erreur', 'erreur');
    return;
  }
  message('');

  $('blocPanorama').classList.remove('cache');
  $('corpsPanorama').replaceChildren(
    ...(donnees.comptes.length
      ? donnees.comptes.map((fiche) => {
          const tr = el('tr');
          tr.append(
            el('td', fiche.compte),
            el('td', fiche.sauvegardes),
            el('td', fiche.personnes),
            el('td', fiche.relations),
            el('td', fiche.annee || '—'),
            el('td', fiche.document ? 'oui' : '—'),
            el('td', fiche.maisons.length),
            el('td', fiche.categories.length),
            el('td', fiche.types.length),
            el('td', fiche.filtres.length)
          );
          return tr;
        })
      : [ligneVide('Aucun compte.', 10)])
  );

  // La liste n'est pas l'intérêt : c'est la séparation entre ce que tout le
  // monde a — sur quoi un lot de groupe a du sens — et ce qui n'est qu'à
  // certains, qu'un lot écraserait sans le dire.
  const blocs = [];
  for (const [axe, titre] of AXES) {
    const commun = donnees.commun[axe] || [];
    const divergent = donnees.divergent[axe] || [];
    if (!commun.length && !divergent.length) continue;

    blocs.push(el('p', `${titre} — ${commun.length} en commun, ${divergent.length} propres`, 'sous-titre'));
    const liste = el('ul', null, 'etiquettes');
    for (const entree of commun) liste.append(el('li', entree.label, 'partage'));
    for (const entree of divergent) {
      liste.append(el('li', `${entree.label} · ${entree.comptes}`));
    }
    blocs.push(liste);
  }
  $('communDivergent').replaceChildren(
    ...(blocs.length ? blocs : [el('p', 'Rien à comparer.', 'note')])
  );
}

/* ------------------------------------------------------------- câblage */

$('toutCocher').addEventListener('change', () => {
  selection.clear();
  if ($('toutCocher').checked) comptes.forEach((compte) => selection.add(compte.id));
  dessinerComptes();
});

$('choixOperation').addEventListener('change', construireFormulaire);
$('choixPortee').addEventListener('change', majSelection);
$('formulaireLot').addEventListener('input', perimerApercu);
$('formulaireLot').addEventListener('change', perimerApercu);
$('btnApercu').addEventListener('click', apercu);
$('btnAppliquer').addEventListener('click', appliquer);
$('btnPanorama').addEventListener('click', relever);

$('retour').addEventListener('click', () => {
  location.href = '/';
});

/** Les catalogues d'abord : le formulaire des types en dépend. */
async function demarrer() {
  const { ok, donnees } = await appeler('/api/admin/catalogues');
  if (ok) catalogues = donnees;
  construireFormulaire();
  await chargerComptes();
}

demarrer();
