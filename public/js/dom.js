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
