import { appeler, compteConnecte, deriverCle } from './identite.js';
import { installerLangue } from './langue.js';

installerLangue();

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

/** Le jeton du courriel, s'il y en a un : il change tout ce qui suit. */
const jetonRecu = new URLSearchParams(location.search).get('jeton');

/* Déjà connecté ? Ça dépend de **qui a demandé cette page**.

   Quand l'application nous envoie ici parce qu'elle a pris un 401, elle pose
   `?retour=`. Si la session s'avère finalement valable, renvoyer d'où l'on
   vient est la bonne réponse : personne n'a rien demandé.

   Mais quand on tape l'adresse ou qu'on clique « Se connecter », **c'est un
   geste délibéré** — et le renvoi silencieux d'avant rendait le changement de
   compte impossible : la page se refermait aussitôt, sans un mot, et le seul
   moyen d'en sortir était de trouver le bouton de déconnexion sur la page
   précédente. On propose donc le choix, au lieu de le prendre.

   Deux exceptions gardent leur comportement : un lien de réinitialisation
   (`?jeton=`) doit s'ouvrir même sur un appareil resté connecté, et un essai
   sans compte est justement venu ici pour en sortir. */
const envoyeParLApplication = new URLSearchParams(location.search).has('retour');

if (!jetonRecu) {
  compteConnecte().then((compte) => {
    if (!compte || compte.role === 'invite') return;
    if (envoyeParLApplication) {
      window.location.replace(destination());
      return;
    }
    proposerLeChoix(compte);
  });
}

/** « Vous êtes déjà connecté » — avec de quoi continuer ou en changer. */
function proposerLeChoix(compte) {
  document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
  $('carteDejaConnecte').classList.remove('cache');
  $('compteEnCours').textContent =
    compte.email + (compte.role === 'admin' ? ' · administrateur' : '');

  $('continuerAinsi').addEventListener('click', () => {
    window.location.replace(destination());
  });

  $('changerDeCompte').addEventListener('click', async () => {
    await appeler('/api/auth/deconnexion', { method: 'POST' });
    // Sans ça, le marqueur ferait rouvrir un essai au prochain 401 alors qu'on
    // vient justement de se déconnecter pour saisir une autre adresse.
    localStorage.removeItem('familytree-compte-connu');
    location.replace('/connexion.html');
  });
}

/* Arrivée depuis « Créer un compte » : on ouvre sur le bon onglet plutôt que
   d'obliger à le chercher. */
if (new URLSearchParams(location.search).get('creer')) {
  addEventListener('DOMContentLoaded', () => basculer('inscription'));
}

/* Ce que cette instance sait faire. Demandé une seule fois, au chargement :
   deux blocs en dépendent (Google ici, le lien par courriel plus bas). */
let moyens = null;
const moyensCharges = appeler('/api/auth/moyens').then(({ donnees }) => {
  moyens = donnees ?? {};
  // Sans identifiants Google posés, la route répond 404 : mieux vaut ne pas
  // montrer un bouton qui mène à une porte fermée.
  if (moyens.google) $('blocGoogle').classList.remove('cache');
  return moyens;
});

/* Le retour de Google échoue en revenant ici avec ?erreur=… — ce n'est pas
   une page d'erreur séparée : la personne doit se retrouver devant le
   formulaire, avec la raison sous les yeux. */
const erreurRecue = new URLSearchParams(location.search).get('erreur');
if (erreurRecue) {
  addEventListener('DOMContentLoaded', () => dire(erreurRecue));
}

/* -------------------------------------------------------------------------- */

function basculer(nouveau) {
  mode = nouveau;
  const inscription = mode === 'inscription';

  $('ongletConnexion').setAttribute('aria-selected', String(!inscription));
  $('ongletInscription').setAttribute('aria-selected', String(inscription));
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

    const { ok, donnees } = await appeler(chemin, {
      method: 'POST',
      body: JSON.stringify({ email, cle }),
    });

    if (!ok) {
      dire(donnees?.erreur ?? 'Quelque chose a échoué. Réessayez.');
      return;
    }

    // Plus de code de secours jeté au visage de quelqu'un qui vient de choisir
    // un mot de passe (lot 9.D) : on entre dans l'application. Le code se
    // demande depuis « Vos données », quand on sait à quoi il sert.
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

$('lienOubli').addEventListener('click', async () => {
  document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
  $('carteRecuperation').classList.remove('cache');
  $('emailRecuperation').value = $('email').value;
  $('emailOubli').value = $('email').value;

  // Le bloc « lien par courriel » n'apparaît que si le serveur sait envoyer :
  // promettre un message qui n'arrivera jamais est pire que ne rien proposer.
  //
  // Et quand il est là, le code de secours **recule derrière un bouton**. Ce
  // n'est pas de la mise en page : deux formulaires côte à côte laissent croire
  // qu'il faut choisir, alors que l'un demande un code que presque personne n'a
  // demandé. Sans service d'envoi, il reste le seul chemin et reste donc visible.
  const donnees = await moyensCharges;
  if (donnees?.courriel) {
    $('blocCourriel').classList.remove('cache');
    $('blocSecours').classList.add('cache');
    $('lienSecours').classList.remove('cache');
  }
});

$('lienSecours').addEventListener('click', () => {
  $('blocSecours').classList.remove('cache');
  $('lienSecours').classList.add('cache');
  $('emailRecuperation').focus();
});

/* ----------------------------------------------- mot de passe oublié (8.G) */

$('formulaireOubli').addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const zone = $('messageOubli');
  zone.textContent = '';

  await pendant($('validerOubli'), 'Envoi…', async () => {
    const { ok, donnees } = await appeler('/api/auth/mot-de-passe-oublie', {
      method: 'POST',
      body: JSON.stringify({ email: $('emailOubli').value }),
    });
    zone.className = `message ${ok ? 'reussite' : 'erreur'}`;
    // Le même message que l'adresse existe ou non : cette page ne doit pas
    // servir à savoir qui a un compte ici.
    zone.textContent = ok
      ? 'Si un compte existe pour cette adresse, un lien vient de partir. Il dure une heure. Pensez aux indésirables.'
      : donnees?.erreur ?? 'Envoi impossible.';
  });
});

/**
 * Arrivée par le lien du courriel. On demande d'abord à qui il appartient :
 * l'adresse sert de sel à la dérivation, la retaper de travers fabriquerait un
 * mot de passe inutilisable.
 */
async function ouvrirNouveauMotDePasse(jeton) {
  document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
  $('carteNouveau').classList.remove('cache');
  const zone = $('messageNouveau');

  const { ok, donnees } = await appeler(
    `/api/auth/reinitialisation?jeton=${encodeURIComponent(jeton)}`
  );
  if (!ok) {
    $('formulaireNouveau').classList.add('cache');
    zone.className = 'message erreur';
    zone.textContent = `${donnees?.erreur ?? 'Lien invalide'} — redemandez-en un depuis « Mot de passe oublié ? ».`;
    return;
  }
  $('emailNouveau').value = donnees.email;
  $('emailNouveau').readOnly = true;
  $('nouveauMdp').focus();

  $('formulaireNouveau').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    zone.textContent = '';
    if ($('nouveauMdp').value !== $('confirmationNouveau').value) {
      zone.className = 'message erreur';
      zone.textContent = 'Les deux mots de passe ne sont pas identiques.';
      return;
    }

    await pendant($('validerNouveau'), 'Chiffrement en cours…', async () => {
      const nouvelleCle = await deriverCle(donnees.email, $('nouveauMdp').value);
      const reponse = await appeler('/api/auth/nouveau-mot-de-passe', {
        method: 'POST',
        body: JSON.stringify({ jeton, nouvelle_cle: nouvelleCle }),
      });
      if (!reponse.ok) {
        zone.className = 'message erreur';
        zone.textContent = reponse.donnees?.erreur ?? 'Échec du changement.';
        return;
      }
      // Le code de secours change aussi : celui d'avant a pu être vu par qui
      // a demandé la réinitialisation.
      document.querySelectorAll('.carte').forEach((c) => c.classList.add('cache'));
      $('codeAffiche').textContent = reponse.donnees.code_secours;
      $('carteCode').classList.remove('cache');
      $('continuer').textContent = "C'est noté, se connecter";
      $('continuer').dataset.vers = '/connexion';
    });
  });
}

if (jetonRecu) ouvrirNouveauMotDePasse(jetonRecu);

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
