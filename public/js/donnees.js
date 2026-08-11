/**
 * Page « Vos données ».
 *
 * Deux gestes seulement : tout reprendre, et tout effacer. Le premier est un
 * simple lien ; le second demande le mot de passe **et** un mot tapé à la main,
 * parce qu'un onglet resté ouvert sur un poste partagé ne doit pas suffire à
 * effacer une campagne.
 */

import { appeler, deriverCle } from './identite.js';

const $ = (id) => document.getElementById(id);

const dateLisible = (secondes) =>
  secondes ? new Date(secondes * 1000).toISOString().slice(0, 16).replace('T', ' à ') : '—';

const poids = (octets) =>
  octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`;

const pluriel = (nombre, mot) => `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;

/** Un groupe nominal s'accorde en entier : « 2 appareils connectés ». */
const plurielGroupe = (nombre, mots) =>
  `${nombre} ${mots.map((mot) => mot + (nombre > 1 ? 's' : '')).join(' ')}`;

async function remplir() {
  const { ok, donnees } = await appeler('/api/auth/donnees');
  if (!ok) {
    location.replace('/connexion.html?retour=%2Fdonnees.html');
    return;
  }

  const { compte, contenu, plafonds } = donnees;
  // Un essai sans compte n'a pas d'adresse : le dire plutôt que d'afficher un
  // blanc qui ressemblerait à une donnée manquante.
  const invite = compte.role === 'invite';
  $('email').textContent = invite
    ? '— essai sans compte, rien qui vous identifie'
    : compte.email + (compte.role === 'admin' ? ' · compte administrateur' : '');
  $('creeLe').textContent = dateLisible(donnees.cree_le);
  $('dernierAcces').textContent = dateLisible(donnees.dernier_acces);
  $('sauvegardes').textContent =
    `${contenu.sauvegardes} sur ${plafonds.sauvegardes} autorisées`;
  $('contenu').textContent =
    `${pluriel(contenu.personnes, 'personne')}, ${pluriel(contenu.relations, 'lien')}`;
  $('octets').textContent =
    `${poids(contenu.octets)} — le plafond est de ${poids(plafonds.octets)} par sauvegarde`;
  $('sessions').textContent = plurielGroupe(donnees.sessions_ouvertes, ['appareil', 'connecté']);

  // Rien à récupérer tant qu'il n'y a pas de compte à qui rendre la main.
  $('carteSecours').hidden = invite;
}

/* -------------------------------------------------------------------------- */

$('genererSecours').addEventListener('click', async () => {
  const bouton = $('genererSecours');
  bouton.disabled = true;
  const { ok, donnees } = await appeler('/api/auth/code-secours', { method: 'POST' });
  if (!ok) {
    bouton.disabled = false;
    $('messageSecours').textContent = donnees?.erreur ?? 'Échec. Réessayez.';
    $('messageSecours').className = 'message erreur';
    return;
  }
  $('codeSecoursAffiche').textContent = donnees.code_secours;
  $('codeSecoursAffiche').hidden = false;
  $('messageSecours').textContent =
    'Notez-le maintenant : il ne sera plus réaffiché. Le code précédent, s’il y en avait un, ne fonctionne plus.';
  $('messageSecours').className = 'message';
  bouton.textContent = 'Obtenir un nouveau code';
  bouton.disabled = false;
});

function message(texte, genre = '') {
  $('message').textContent = texte;
  $('message').className = `message ${genre}`;
}

$('formulaireSuppression').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();

  if ($('confirmation').value.trim() !== 'SUPPRIMER') {
    message('Tapez SUPPRIMER en majuscules pour confirmer.', 'erreur');
    return;
  }

  const { donnees } = await appeler('/api/auth/donnees');
  if (!donnees?.compte?.email) {
    message('Session expirée. Reconnectez-vous.', 'erreur');
    return;
  }

  $('supprimer').disabled = true;
  message('Vérification du mot de passe…');
  try {
    // Même dérivation qu'à la connexion : le mot de passe ne part pas.
    const cle = await deriverCle(donnees.compte.email, $('motDePasse').value);
    const reponse = await appeler('/api/auth/compte', {
      method: 'DELETE',
      body: JSON.stringify({ cle }),
    });
    if (reponse.code === 204) {
      document.body.innerHTML =
        '<main><h1>C’est effacé.</h1><p>Votre compte, vos sauvegardes et vos ' +
        'sessions n’existent plus. Merci d’être passé.</p>' +
        '<p><a class="lien" href="/connexion.html">Créer un nouveau compte</a></p></main>';
      return;
    }
    message(reponse.donnees?.erreur || `Échec (HTTP ${reponse.code}).`, 'erreur');
  } catch (erreur) {
    message(erreur.message, 'erreur');
  } finally {
    $('supprimer').disabled = false;
  }
});

$('retour').addEventListener('click', () => {
  location.href = '/';
});

remplir();
