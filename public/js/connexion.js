import { appeler, compteConnecte, deriverCle } from './identite.js';

const $ = (id) => document.getElementById(id);

let mode = 'connexion';

/**
 * Où repartir après la connexion. L'application renvoie ici avec `?retour=…`
 * quand la session a expiré ; on n'accepte qu'un chemin de ce site, sinon un
 * lien fabriqué pourrait faire rebondir un compte fraîchement connecté vers
 * l'extérieur.
 */
function destination() {
  const demande = new URLSearchParams(location.search).get('retour');
  return demande && demande.startsWith('/') && !demande.startsWith('//') ? demande : '/';
}

/* Déjà connecté ? Inutile de redemander. */
compteConnecte().then((compte) => {
  if (compte) window.location.replace(destination());
});

/* -------------------------------------------------------------------------- */

function basculer(nouveau) {
  mode = nouveau;
  const inscription = mode === 'inscription';

  $('ongletConnexion').setAttribute('aria-selected', String(!inscription));
  $('ongletInscription').setAttribute('aria-selected', String(inscription));
  $('ligneNom').classList.toggle('cache', !inscription);
  $('ligneConfirmation').classList.toggle('cache', !inscription);
  $('mention').classList.toggle('cache', !inscription);
  $('lienOubli').classList.toggle('cache', inscription);
  $('valider').textContent = inscription ? 'Créer mon compte' : 'Se connecter';
  $('motDePasse').autocomplete = inscription ? 'new-password' : 'current-password';
  dire('');
}

function dire(texte, genre = 'erreur') {
  const zone = $('message');
  zone.textContent = texte;
  zone.className = `message ${texte ? genre : ''}`;
}

/**
 * La dérivation prend une fraction de seconde : sans ce retour visuel, on
 * croit que le bouton n'a pas répondu et on clique trois fois.
 */
async function pendant(bouton, libelle, travail) {
  const avant = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = libelle;
  try {
    return await travail();
  } finally {
    bouton.disabled = false;
    bouton.textContent = avant;
  }
}

$('ongletConnexion').addEventListener('click', () => basculer('connexion'));
$('ongletInscription').addEventListener('click', () => basculer('inscription'));

/* -------------------------------------------------------------------------- */

$('formulaire').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  dire('');

  const email = $('email').value;
  const motDePasse = $('motDePasse').value;

  if (mode === 'inscription' && motDePasse !== $('confirmation').value) {
    dire('Les deux mots de passe ne sont pas identiques.');
    return;
  }
  if (motDePasse.length < 8) {
    dire('Le mot de passe doit faire au moins 8 caractères.');
    return;
  }

  await pendant($('valider'), 'Chiffrement en cours…', async () => {
    let cle;
    try {
      cle = await deriverCle(email, motDePasse);
    } catch (erreur) {
      dire(erreur.message);
      return;
    }

    const chemin = mode === 'inscription' ? '/api/auth/inscription' : '/api/auth/connexion';
    const corps =
      mode === 'inscription'
        ? { email, cle, nom_affiche: $('nom').value }
        : { email, cle };

    const { ok, donnees } = await appeler(chemin, {
      method: 'POST',
      body: JSON.stringify(corps),
    });

    if (!ok) {
      dire(donnees?.erreur ?? 'Quelque chose a échoué. Réessayez.');
      return;
    }

    if (mode === 'inscription') {
      $('codeAffiche').textContent = donnees.code_secours;
      document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
      $('carteCode').classList.remove('cache');
      return;
    }

    window.location.replace(destination());
  });
});

// Une seule écoute, dont la destination est portée par l'élément : deux
// `addEventListener` sur le même bouton finiraient par se déclencher tous les
// deux.
$('continuer').addEventListener('click', () => {
  window.location.replace($('continuer').dataset.vers ?? destination());
});

/* -------------------------------------------------------------------------- */

$('lienOubli').addEventListener('click', () => {
  document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
  $('carteRecuperation').classList.remove('cache');
  $('emailRecuperation').value = $('email').value;
});

$('lienRetour').addEventListener('click', () => window.location.reload());

$('formulaireRecuperation').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const zone = $('messageRecuperation');
  zone.textContent = '';

  await pendant($('validerRecuperation'), 'Chiffrement en cours…', async () => {
    const email = $('emailRecuperation').value;
    const nouvelleCle = await deriverCle(email, $('nouveauMotDePasse').value);

    const { ok, donnees } = await appeler('/api/auth/recuperation', {
      method: 'POST',
      body: JSON.stringify({
        email,
        code_secours: $('codeSecours').value,
        nouvelle_cle: nouvelleCle,
      }),
    });

    if (!ok) {
      zone.className = 'message erreur';
      zone.textContent = donnees?.erreur ?? 'Échec de la récupération.';
      return;
    }

    // Le code est à usage unique : on en donne un nouveau, à noter tout de suite.
    // Toutes les sessions ont été fermées côté serveur, il faut se reconnecter.
    document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
    $('codeAffiche').textContent = donnees.code_secours;
    $('carteCode').classList.remove('cache');
    $('continuer').textContent = "C'est noté, se connecter";
    $('continuer').dataset.vers = '/connexion';
  });
});
