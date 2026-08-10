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

  $('corpsComptes').replaceChildren(
    ...comptes.map((compte) => {
      const ligne = el('tr');
      ligne.append(
        el('td', compte.email),
        el('td', compte.role === 'admin' ? 'administrateur' : 'membre'),
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

  await chargerJournal();
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

$('retour').addEventListener('click', () => {
  location.href = '/';
});

chargerComptes();
