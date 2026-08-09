/**
 * Le panneau des sauvegardes — provisoire, et assumé comme tel.
 *
 * L'interface des arbres arrive au lot 4, copiée depuis la version locale. En
 * attendant, cette page fait tout ce que le lot 2 sait faire : créer, importer,
 * copier, renommer, exporter, supprimer. Elle sert autant à l'utilisateur qu'à
 * la vérification — ce qui marche ici a été exercé de bout en bout, cookie
 * compris, et pas seulement en `curl`.
 */

import { appeler } from '/js/identite.js';

const liste = document.getElementById('liste');
const message = document.getElementById('message');
const champNom = document.getElementById('nom');
const boutonCreer = document.getElementById('creer');
const boutonImporter = document.getElementById('importer');
const fichier = document.getElementById('fichier');

let plafonds = { sauvegardes: 10, octets: 2097152 };

/* -------------------------------------------------------------------------- */

function dire(texte, genre = '') {
  message.textContent = texte ?? '';
  message.className = `message ${genre}`;
}

function enKo(octets) {
  return octets < 1024 ? `${octets} o` : `${Math.round(octets / 1024)} Ko`;
}

function enDate(secondes) {
  return new Date(secondes * 1000).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** Le message d'erreur du serveur, qui est toujours plus précis que le nôtre. */
function pourquoi(donnees, secours) {
  if (!donnees) return secours;
  return [donnees.erreur, donnees.indice].filter(Boolean).join(' — ') || secours;
}

/* -------------------------------------------------------------------------- */

async function rafraichir() {
  const { ok, donnees } = await appeler('/api/sauvegardes');
  if (!ok) {
    dire(pourquoi(donnees, 'impossible de lire vos sauvegardes'), 'erreur');
    return;
  }

  plafonds = donnees.plafonds;
  liste.replaceChildren();

  if (!donnees.sauvegardes.length) {
    const vide = document.createElement('p');
    vide.className = 'vide';
    vide.textContent =
      'Aucune sauvegarde pour l’instant. Créez-en une, ou importez un fichier venu de la version locale.';
    liste.append(vide);
    return;
  }

  for (const sauvegarde of donnees.sauvegardes) liste.append(carte(sauvegarde));

  const restant = plafonds.sauvegardes - donnees.sauvegardes.length;
  dire(
    `${donnees.sauvegardes.length} sauvegarde(s) — ${restant} place(s) libre(s) sur ${plafonds.sauvegardes}.`
  );
}

function carte(sauvegarde) {
  const element = document.createElement('li');

  const titre = document.createElement('div');
  titre.className = 'titre';
  titre.textContent = sauvegarde.nom;

  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent =
    `${sauvegarde.personnes} fiche(s) · ${sauvegarde.relations} lien(s) · ` +
    `${enKo(sauvegarde.taille)} · modifiée le ${enDate(sauvegarde.modifie_le)}`;

  const actions = document.createElement('div');
  actions.className = 'actions';

  // L'export est une vraie navigation : c'est l'en-tête `Content-Disposition`
  // du serveur qui déclenche le téléchargement, sans une ligne de JavaScript.
  const exporter = document.createElement('a');
  exporter.className = 'bouton';
  exporter.href = `/api/sauvegardes/${sauvegarde.id}/export`;
  exporter.textContent = 'Exporter';
  exporter.setAttribute('download', '');

  actions.append(
    exporter,
    bouton('Renommer', () => renommer(sauvegarde)),
    bouton('Copier', () => copier(sauvegarde)),
    bouton('Supprimer', () => supprimer(sauvegarde), 'danger')
  );

  element.append(titre, detail, actions);
  return element;
}

function bouton(libelle, action, genre = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `bouton ${genre}`;
  element.textContent = libelle;
  element.addEventListener('click', action);
  return element;
}

/* -------------------------------------------------------------------------- */

async function creer() {
  const nom = champNom.value.trim();
  if (!nom) {
    dire('Il faut un nom.', 'erreur');
    champNom.focus();
    return;
  }

  boutonCreer.disabled = true;
  const { ok, donnees } = await appeler('/api/sauvegardes', {
    method: 'POST',
    body: JSON.stringify({ nom }),
  });
  boutonCreer.disabled = false;

  if (!ok) {
    dire(pourquoi(donnees, 'création impossible'), 'erreur');
    return;
  }
  champNom.value = '';
  await rafraichir();
  dire(`« ${donnees.sauvegarde.nom } » est créée.`, 'reussite');
}

async function renommer(sauvegarde) {
  const nom = window.prompt('Nouveau nom', sauvegarde.nom);
  if (nom === null) return;

  const { ok, donnees } = await appeler(`/api/sauvegardes/${sauvegarde.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ nom }),
  });
  if (!ok) {
    dire(pourquoi(donnees, 'renommage impossible'), 'erreur');
    return;
  }
  await rafraichir();
}

async function copier(sauvegarde) {
  const { ok, donnees } = await appeler('/api/sauvegardes', {
    method: 'POST',
    body: JSON.stringify({ nom: `${sauvegarde.nom} (copie)`, depuis: sauvegarde.id }),
  });
  if (!ok) {
    dire(pourquoi(donnees, 'copie impossible'), 'erreur');
    return;
  }
  await rafraichir();
  dire(`« ${donnees.sauvegarde.nom} » est créée.`, 'reussite');
}

async function supprimer(sauvegarde) {
  const sur = window.confirm(
    `Supprimer « ${sauvegarde.nom} » ?\n\n` +
      'Cette action est définitive. Exportez-la d’abord si vous voulez la garder.'
  );
  if (!sur) return;

  const { ok, donnees } = await appeler(`/api/sauvegardes/${sauvegarde.id}`, { method: 'DELETE' });
  if (!ok) {
    dire(pourquoi(donnees, 'suppression impossible'), 'erreur');
    return;
  }
  await rafraichir();
  dire(`« ${sauvegarde.nom} » est supprimée.`, 'reussite');
}

/**
 * L'import envoie le fichier **tel quel**, sans le reparser ici : c'est le
 * serveur qui juge, et lui seul, sinon on aurait deux avis sur ce qu'est une
 * sauvegarde valable.
 */
async function importer(choisi) {
  if (!choisi) return;

  if (choisi.size > plafonds.octets) {
    dire(
      `Ce fichier pèse ${enKo(choisi.size)}, au-delà des ${enKo(plafonds.octets)} autorisés. ` +
        'Les portraits collés en sont presque toujours la cause.',
      'erreur'
    );
    return;
  }

  boutonImporter.disabled = true;
  dire('Import en cours…');

  const reponse = await fetch('/api/sauvegardes/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await choisi.text(),
  });
  const donnees = await reponse.json().catch(() => null);
  boutonImporter.disabled = false;
  fichier.value = '';

  if (!reponse.ok) {
    dire(pourquoi(donnees, 'import impossible'), 'erreur');
    return;
  }

  await rafraichir();
  dire(
    `« ${donnees.sauvegarde.nom} » est importée : ${donnees.sauvegarde.personnes} fiche(s), ` +
      `${donnees.sauvegarde.relations} lien(s).` +
      (donnees.message ? ` ${donnees.message}` : ''),
    'reussite'
  );
}

/* -------------------------------------------------------------------------- */

boutonCreer.addEventListener('click', creer);
champNom.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Enter') creer();
});
boutonImporter.addEventListener('click', () => fichier.click());
fichier.addEventListener('change', () => importer(fichier.files[0]));

await rafraichir();
