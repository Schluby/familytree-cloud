/* Utilitaires DOM partagés : création d'éléments et panneaux flottants.
 *
 * `h` évite toute injection HTML (tout passe par textContent). `creerFlottant`
 * factorise le comportement commun aux menus contextuels et aux éditeurs :
 * un seul ouvert à la fois, fermeture au clic extérieur ou à Échap.
 */

/** Mini-helper de création DOM. */
export function h(balise, attributs = {}, enfants = []) {
  const element = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (cle === 'class') element.className = valeur;
    else if (cle === 'texte') element.textContent = valeur;
    else if (cle === 'style') Object.assign(element.style, valeur);
    else if (cle.startsWith('on')) element.addEventListener(cle.slice(2), valeur);
    else element.setAttribute(cle, valeur === true ? '' : valeur);
  }
  for (const enfant of [].concat(enfants)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    element.append(enfant.nodeType ? enfant : document.createTextNode(String(enfant)));
  }
  return element;
}

/** Déclenche un téléchargement (le serveur envoie le nom du fichier). */
export function telecharger(url) {
  const lien = h('a', { href: url, download: '', rel: 'noopener' });
  document.body.append(lien);
  lien.click();
  lien.remove();
}

/**
 * Ouvre le sélecteur de fichiers et rend `{nom, octets, texte}`. Les octets
 * d'abord : un `.zip` ne se lit pas en texte, et le décodage n'a lieu que si
 * quelqu'un demande `.texte`.
 */
export function choisirFichier(accept = '.json') {
  return new Promise((resoudre) => {
    const champ = h('input', {
      type: 'file',
      accept,
      style: { display: 'none' },
      onchange: async () => {
        const fichier = champ.files?.[0];
        champ.remove();
        if (!fichier) return resoudre(null);
        const octets = new Uint8Array(await fichier.arrayBuffer());
        resoudre({
          nom: fichier.name,
          octets,
          get texte() {
            return new TextDecoder().decode(octets);
          },
        });
      },
    });
    document.body.append(champ);
    champ.click();
  });
}

/* ---------------------------------------------------------- menu contextuel
 *
 * Tout ce qui s'ouvre au clic droit doit s'ouvrir à l'appui long : sans ça,
 * l'application est consultable au doigt mais pas modifiable. Le geste tactile
 * n'est pas laissé au navigateur — le plan est en `touch-action: none` pour
 * que le doigt déplace la vue, ce qui supprime aussi le menu système.
 */

const DUREE_APPUI = 480; // ms
const TOLERANCE_APPUI = 12; // px : au-delà, le doigt fait défiler, pas un menu

/**
 * Le doigt qui se lève après un appui long produit encore une salve
 * d'événements souris de compatibilité, à l'endroit exact où le menu vient de
 * s'ouvrir. Sans ce filtre, le menu se refermerait aussitôt (le `mousedown`
 * passe pour un clic extérieur) — ou pire, activerait l'entrée tombée sous le
 * doigt.
 */
export function etoufferSalveSouris() {
  const types = ['mousedown', 'mouseup', 'click'];
  const bloquer = (evenement) => {
    evenement.preventDefault();
    // `stopImmediatePropagation`, pas `stopPropagation` : la fermeture au clic
    // extérieur des panneaux flottants écoute **le même nœud** (`document`, en
    // capture), et seul l'arrêt immédiat la court-circuite. Avec l'autre, le
    // menu se refermait dans la milliseconde où le doigt se levait.
    evenement.stopImmediatePropagation();
    evenement.stopPropagation();
  };
  types.forEach((type) => document.addEventListener(type, bloquer, true));

  const rendreLaMain = () => {
    document.removeEventListener('pointerup', rendreLaMain, true);
    document.removeEventListener('pointercancel', rendreLaMain, true);
    // La salve suit le lever du doigt : on la laisse passer, puis on rouvre.
    setTimeout(() => types.forEach((t) => document.removeEventListener(t, bloquer, true)), 60);
  };
  document.addEventListener('pointerup', rendreLaMain, true);
  document.addEventListener('pointercancel', rendreLaMain, true);
  setTimeout(rendreLaMain, 4000); // filet : un doigt finit toujours par se lever
}

/**
 * Câble `action` sur le clic droit **et** sur l'appui long. `action` reçoit un
 * objet portant `clientX` / `clientY` : les deux gestes désignent un point, et
 * les menus ne demandent rien d'autre.
 *
 * Renvoie `sortDAppuiLong()`, vrai depuis le déclenchement d'un appui long
 * jusqu'au geste suivant : le clic qui vient est le lever du doigt, pas un
 * choix. On le borne au **geste**, jamais à une durée — sinon un enchaînement
 * rapide (appui long, « Relier à… », touche sur l'autre fiche) verrait sa
 * deuxième touche avalée par le minuteur.
 */
export function surMenuContextuel(element, action) {
  let appui = null;
  let appuiLongDeclenche = false;

  element.addEventListener('contextmenu', (evenement) => {
    evenement.preventDefault();
    action(evenement);
  });

  const annuler = () => {
    if (!appui) return;
    clearTimeout(appui.minuterie);
    appui = null;
  };

  // La souris est exclue : elle a son clic droit, et un bouton maintenu une
  // demi-seconde est un glisser qui commence, pas une demande de menu.
  element.addEventListener('pointerdown', (evenement) => {
    annuler();
    appuiLongDeclenche = false; // un nouveau geste commence : la page est tournée
    if (evenement.pointerType === 'mouse') return;
    if (evenement.isPrimary === false) return; // second doigt : c'est un zoom
    const { clientX: x, clientY: y } = evenement;
    appui = {
      x,
      y,
      minuterie: setTimeout(() => {
        appui = null;
        appuiLongDeclenche = true;
        navigator.vibrate?.(18); // le geste est reçu, avant même de lever
        etoufferSalveSouris();
        action({ clientX: x, clientY: y, preventDefault() {} });
      }, DUREE_APPUI),
    };
  });

  element.addEventListener('pointermove', (evenement) => {
    if (!appui) return;
    if (Math.hypot(evenement.clientX - appui.x, evenement.clientY - appui.y) > TOLERANCE_APPUI) {
      annuler();
    }
  });
  element.addEventListener('pointerup', annuler);
  element.addEventListener('pointercancel', annuler);

  return () => appuiLongDeclenche;
}

/** Place un panneau près de (x, y) sans jamais le laisser sortir de l'écran. */
export function placer(element, x, y, { marge = 10, decalage = 2 } = {}) {
  element.style.left = '0px';
  element.style.top = '0px';
  const { width, height } = element.getBoundingClientRect();
  let gauche = x + decalage;
  let haut = y + decalage;
  if (gauche + width > window.innerWidth - marge) gauche = x - width - decalage;
  if (haut + height > window.innerHeight - marge) haut = window.innerHeight - height - marge;
  element.style.left = `${Math.max(marge, gauche)}px`;
  element.style.top = `${Math.max(marge, haut)}px`;
}

/** Pose un panneau à une position exacte, sans décalage, en le gardant à l'écran. */
export function poser(element, x, y, { marge = 8 } = {}) {
  element.style.left = '0px';
  element.style.top = '0px';
  const { width, height } = element.getBoundingClientRect();
  const gauche = Math.min(Math.max(marge, x), window.innerWidth - width - marge);
  const haut = Math.min(Math.max(marge, y), window.innerHeight - height - marge);
  element.style.left = `${Math.max(marge, gauche)}px`;
  element.style.top = `${Math.max(marge, haut)}px`;
}

/**
 * Socle d'un panneau flottant : le monte dans <body>, le positionne, et le
 * referme au clic extérieur ou sur Échap (en capture, pour passer avant les
 * raccourcis globaux de l'application).
 *
 * `persistant` : pour les vrais formulaires (réglage d'un filtre), où fermer
 * sur un clic extérieur ou une perte de focus est une catastrophe — la roue
 * des couleurs du système et les listes déroulantes natives font perdre le
 * focus à la fenêtre. On n'y sort que par ✕ ou Échap.
 */
export function creerFlottant({ surFermeture, persistant = false } = {}) {
  let element = null;

  function surClicExterieur(evenement) {
    if (element && !element.contains(evenement.target)) fermer();
  }

  function surTouche(evenement) {
    if (evenement.key === 'Escape' && element) {
      evenement.preventDefault();
      evenement.stopPropagation();
      fermer();
    }
  }

  function fermer() {
    if (!element) return;
    element.remove();
    element = null;
    document.removeEventListener('mousedown', surClicExterieur, true);
    document.removeEventListener('keydown', surTouche, true);
    window.removeEventListener('blur', fermer);
    surFermeture?.();
  }

  function monter(contenu, x, y, { exact = false } = {}) {
    fermer();
    element = contenu;
    document.body.append(element);
    if (exact) poser(element, x, y);
    else placer(element, x, y);
    if (!persistant) {
      document.addEventListener('mousedown', surClicExterieur, true);
      window.addEventListener('blur', fermer);
    }
    document.addEventListener('keydown', surTouche, true);
    return element;
  }

  return {
    monter,
    fermer,
    estOuvert: () => !!element,
    get element() {
      return element;
    },
  };
}
