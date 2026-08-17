/* Les formes de fond du plan (lot 20.D).
 *
 * Des rectangles, des ellipses et des zones de texte posés **derrière** les
 * fiches : de quoi entourer un groupe et le nommer, comme au tableau blanc.
 * Voir `src/domaine/formes.ts` pour ce qu'elles sont côté serveur — et surtout
 * pour ce qu'elles ne sont pas : elles ne contiennent personne.
 *
 * ── Pourquoi un interrupteur, et non des formes toujours cliquables ──────────
 *
 * Une forme couvre de la surface, souvent beaucoup. Si elle attrape les clics
 * en permanence, un rectangle tracé autour du Nord empêche de faire glisser le
 * plan dans tout le Nord — on ne peut plus déplacer la vue là où il y a
 * justement quelque chose à regarder.
 *
 * Alors : **au repos, une forme est inerte** (`pointer-events: none`), c'est un
 * décor. Le bouton « ▭ Formes » de la barre du bas ouvre le mode dessin ; là,
 * et seulement là, on peut les choisir, les déplacer, les redimensionner et les
 * modifier. Ressortir du mode leur rend leur transparence.
 *
 * ── Ce que ce module ne fait pas ─────────────────────────────────────────────
 *
 * Il n'appelle pas l'API. Comme le moteur de rendu qui l'accueille, il prévient
 * par des rappels et laisse `main.js` décider quoi en faire — c'est ce qui
 * permet de le relire sans savoir à quoi ressemble une requête.
 */

import { h, creerFlottant } from './dom.js';
import { grillePalette } from './palette.js';

/** Ce qu'on obtient d'un simple clic, sans rien étirer. */
const TAILLE_DEFAUT = { rectangle: [280, 190], ellipse: [240, 240], texte: [220, 60] };
/** En deçà, on considère que c'était un clic et non un tracé. */
const TRACE_MINIMAL = 12;

export const OUTILS = [
  { genre: 'rectangle', icone: '▭', label: 'Rectangle' },
  { genre: 'ellipse', icone: '◯', label: 'Cercle' },
  { genre: 'texte', icone: 'T', label: 'Zone de texte' },
];

export function creerCoucheFormes({ monde, plan, pointMonde, rappels = {} }) {
  const couche = h('div', { class: 'formes' });
  // Devant tout le reste pendant un tracé : c'est elle qui reçoit le glisser,
  // pour que ni les fiches ni le déplacement du plan ne s'en mêlent.
  const capture = h('div', { class: 'formes-capture', hidden: true });
  const apercu = h('div', { class: 'forme-apercu', hidden: true });
  capture.append(apercu);

  let formes = [];
  let modeDessin = false;
  let outil = null;
  let choisie = null;
  let trace = null;
  let geste = null;
  // Un glisser se termine par un `click` : sans cette marque, lâcher une forme
  // qu'on vient de déplacer rouvrirait l'éditeur par-dessus. Même procédé que
  // `finDeplacement` dans `views/cartes.js`.
  let finGeste = 0;
  const elements = new Map(); // id -> élément

  const socle = creerFlottant();

  /* ------------------------------------------------------------------ rendu */

  function styleDe(forme, element) {
    element.style.left = `${forme.x}px`;
    element.style.top = `${forme.y}px`;
    element.style.width = `${forme.l}px`;
    element.style.height = `${forme.h}px`;
    element.style.background = forme.fond || 'transparent';
    // Une épaisseur de 0 vaut « pas de contour » : c'est l'état par défaut
    // d'une zone de texte, qui ne doit être qu'un mot posé sur le plan.
    element.style.borderWidth = `${forme.epaisseur}px`;
    element.style.borderColor = forme.trait || 'transparent';
    element.style.borderStyle = forme.epaisseur ? 'solid' : 'none';
    element.style.borderRadius = forme.genre === 'ellipse' ? '50%' : '10px';
  }

  function dessinerUne(forme) {
    const texte = h('div', {
      class: 'forme-texte',
      texte: forme.texte || '',
      style: {
        fontSize: `${forme.taille}px`,
        fontWeight: forme.gras ? '700' : '400',
        fontStyle: forme.italique ? 'italic' : 'normal',
        color: forme.couleur_texte || 'inherit',
      },
    });

    const element = h('div', { class: `forme forme-${forme.genre}`, 'data-forme': forme.id }, [
      texte,
      h('span', { class: 'forme-poignee', title: 'Redimensionner' }),
    ]);
    styleDe(forme, element);

    element.addEventListener('mousedown', (evenement) => {
      if (!modeDessin || evenement.button !== 0) return;
      // Sans ça, d3 prendrait le glisser pour un déplacement du plan.
      evenement.preventDefault();
      evenement.stopPropagation();
      const redimensionne = evenement.target.classList.contains('forme-poignee');
      demarrerGeste(forme, evenement, redimensionne ? 'taille' : 'position');
    });

    element.addEventListener('click', (evenement) => {
      if (!modeDessin) return;
      evenement.stopPropagation();
      if (performance.now() - finGeste < 250) return;
      choisir(forme.id);
      ouvrirEditeur(forme, evenement.clientX, evenement.clientY);
    });

    elements.set(forme.id, element);
    return element;
  }

  function dessiner() {
    elements.clear();
    couche.replaceChildren(...formes.map(dessinerUne));
    marquerChoisie();
  }

  function marquerChoisie() {
    for (const [id, element] of elements) element.classList.toggle('choisie', id === choisie);
  }

  function choisir(id) {
    choisie = id;
    marquerChoisie();
  }

  /* --------------------------------------------------- déplacer, agrandir */

  function demarrerGeste(forme, evenement, quoi) {
    const curseur = pointMonde(evenement);
    geste = {
      forme,
      quoi,
      aBouge: false,
      depart: { x: forme.x, y: forme.y, l: forme.l, h: forme.h },
      ecartX: forme.x - curseur.x,
      ecartY: forme.y - curseur.y,
      curseur,
    };
    document.addEventListener('mousemove', surGeste, true);
    document.addEventListener('mouseup', surFinGeste, true);
  }

  function surGeste(evenement) {
    if (!geste) return;
    const curseur = pointMonde(evenement);
    const { forme, quoi } = geste;
    if (quoi === 'position') {
      forme.x = Math.round(curseur.x + geste.ecartX);
      forme.y = Math.round(curseur.y + geste.ecartY);
    } else {
      forme.l = Math.max(8, Math.round(geste.depart.l + (curseur.x - geste.curseur.x)));
      forme.h = Math.max(8, Math.round(geste.depart.h + (curseur.y - geste.curseur.y)));
    }
    geste.aBouge = true;
    styleDe(forme, elements.get(forme.id));
  }

  function surFinGeste() {
    if (!geste) return;
    const { forme, quoi, depart, aBouge } = geste;
    document.removeEventListener('mousemove', surGeste, true);
    document.removeEventListener('mouseup', surFinGeste, true);
    geste = null;
    if (!aBouge) return;
    finGeste = performance.now();

    // On n'envoie que ce qui a bougé : déplacer une forme est le geste le plus
    // fréquent, et il n'a pas à renvoyer sa couleur et son texte.
    const patch =
      quoi === 'position' ? { x: forme.x, y: forme.y } : { l: forme.l, h: forme.h };
    const inchange =
      quoi === 'position'
        ? forme.x === depart.x && forme.y === depart.y
        : forme.l === depart.l && forme.h === depart.h;
    if (!inchange) rappels.surModification?.(forme.id, patch);
  }

  /* ------------------------------------------------------------- tracer */

  capture.addEventListener('mousedown', (evenement) => {
    if (!outil || evenement.button !== 0) return;
    evenement.preventDefault();
    // `stopPropagation` est indispensable, et pas seulement poli : la surface
    // de tracé est un enfant du plan, où d3-zoom écoute. Laissé passer, d3
    // ouvrirait un geste de panoramique et poserait ses propres écouteurs sur
    // la fenêtre **en phase de capture**, où il appelle `stopImmediatePropagation`
    // — nos `mousemove` ne nous parviendraient jamais, et le rectangle resterait
    // à zéro pixel.
    evenement.stopPropagation();
    const depart = pointMonde(evenement);
    trace = { depart, ecran: { x: evenement.clientX, y: evenement.clientY } };
    apercu.hidden = false;
    apercu.classList.toggle('rond', outil === 'ellipse');
    majApercu(evenement);
  });

  capture.addEventListener('mousemove', (evenement) => {
    if (trace) majApercu(evenement);
  });

  function majApercu(evenement) {
    const cadre = plan.getBoundingClientRect();
    const x0 = trace.ecran.x - cadre.left;
    const y0 = trace.ecran.y - cadre.top;
    const x1 = evenement.clientX - cadre.left;
    const y1 = evenement.clientY - cadre.top;
    apercu.style.left = `${Math.min(x0, x1)}px`;
    apercu.style.top = `${Math.min(y0, y1)}px`;
    apercu.style.width = `${Math.abs(x1 - x0)}px`;
    apercu.style.height = `${Math.abs(y1 - y0)}px`;
  }

  capture.addEventListener('mouseup', (evenement) => {
    if (!trace || !outil) return;
    const fin = pointMonde(evenement);
    const { depart } = trace;
    trace = null;
    apercu.hidden = true;

    let l = Math.abs(fin.x - depart.x);
    let h = Math.abs(fin.y - depart.y);
    let x = Math.min(depart.x, fin.x);
    let y = Math.min(depart.y, fin.y);
    // Un simple clic vaut « pose-m'en une de taille normale ici » : personne ne
    // veut d'un rectangle de trois pixels parce que la souris a tremblé.
    if (l < TRACE_MINIMAL || h < TRACE_MINIMAL) {
      [l, h] = TAILLE_DEFAUT[outil];
      x = depart.x - l / 2;
      y = depart.y - h / 2;
    }

    rappels.surCreation?.({
      genre: outil,
      x: Math.round(x),
      y: Math.round(y),
      l: Math.round(l),
      h: Math.round(h),
      // Une zone de texte n'a ni contour ni fond : c'est un mot posé sur le
      // plan, pas une boîte. Les deux autres arrivent avec un trait visible.
      epaisseur: outil === 'texte' ? 0 : 2,
      texte: outil === 'texte' ? 'Texte' : '',
    });
    armer(null);
  });

  /* ------------------------------------------------------------ l'éditeur */

  function ligne(libelle, controle) {
    return h('div', { class: 'fe-ligne' }, [h('span', { class: 'fe-lib', texte: libelle }), controle]);
  }

  function ouvrirEditeur(forme, x, y) {
    const majEtRendre = (patch) => {
      Object.assign(forme, patch);
      const element = elements.get(forme.id);
      if (element) {
        styleDe(forme, element);
        const texte = element.querySelector('.forme-texte');
        texte.textContent = forme.texte || '';
        texte.style.fontSize = `${forme.taille}px`;
        texte.style.fontWeight = forme.gras ? '700' : '400';
        texte.style.fontStyle = forme.italique ? 'italic' : 'normal';
        texte.style.color = forme.couleur_texte || 'inherit';
      }
      rappels.surModification?.(forme.id, patch);
    };

    const bascule = (cle, etiquette, titre, classe) =>
      h('button', {
        type: 'button',
        class: `bouton fe-bascule ${classe} ${forme[cle] ? 'actif' : ''}`,
        texte: etiquette,
        title: titre,
        onclick: (evenement) => {
          majEtRendre({ [cle]: !forme[cle] });
          evenement.currentTarget.classList.toggle('actif', forme[cle]);
        },
      });

    const contenu = h('div', { class: 'forme-editeur' }, [
      h('div', { class: 'fe-entete' }, [
        h('strong', {
          texte: OUTILS.find((o) => o.genre === forme.genre)?.label || 'Forme',
        }),
        h('button', {
          class: 'bouton bouton-icone danger',
          type: 'button',
          texte: '🗑',
          title: 'Supprimer cette forme',
          onclick: () => {
            socle.fermer();
            rappels.surSuppression?.(forme.id);
          },
        }),
      ]),

      ligne(
        'Texte',
        h('textarea', {
          rows: 2,
          placeholder: 'Le Nord, la cour, ceux qui savent…',
          texte: forme.texte || '',
          oninput: (evenement) => majEtRendre({ texte: evenement.target.value }),
        })
      ),

      h('div', { class: 'fe-ligne' }, [
        h('span', { class: 'fe-lib', texte: 'Style' }),
        h('div', { class: 'fe-styles' }, [
          bascule('gras', 'G', 'Gras', 'fe-gras'),
          bascule('italique', 'I', 'Italique', 'fe-italique'),
          h('input', {
            type: 'number',
            class: 'fe-taille',
            min: 8,
            max: 96,
            value: forme.taille,
            title: 'Taille du texte',
            oninput: (evenement) => {
              const taille = Number(evenement.target.value);
              if (taille >= 8 && taille <= 96) majEtRendre({ taille });
            },
          }),
        ]),
      ]),

      ligne(
        'Couleur du texte',
        grillePalette(forme.couleur_texte, (valeur) => majEtRendre({ couleur_texte: valeur }))
      ),
      ligne(
        'Contour',
        grillePalette(forme.trait, (valeur) => majEtRendre({ trait: valeur }))
      ),
      ligne(
        'Épaisseur',
        h('input', {
          type: 'range',
          min: 0,
          max: 12,
          value: forme.epaisseur,
          title: '0 = aucun contour',
          oninput: (evenement) => majEtRendre({ epaisseur: Number(evenement.target.value) }),
        })
      ),
      ligne(
        'Remplissage',
        grillePalette(forme.fond, (valeur) => majEtRendre({ fond: valeur }))
      ),
      h('p', {
        class: 'fe-aide',
        texte:
          'Glisser pour déplacer, le coin en bas à droite pour redimensionner. Une forme ne contient personne : elle ne change rien aux données.',
      }),
    ]);

    socle.monter(contenu, x, y);
  }

  /* -------------------------------------------------------------- pilotage */

  function armer(genre) {
    outil = genre;
    capture.hidden = !genre;
    plan.classList.toggle('en-trace', !!genre);
    rappels.surOutil?.(genre);
  }

  return {
    couche,
    capture,

    definir(liste) {
      formes = Array.isArray(liste) ? liste.map((f) => ({ ...f })) : [];
      if (!formes.some((f) => f.id === choisie)) choisie = null;
      dessiner();
    },

    /** Le mode dessin : hors de lui, les formes sont un décor inerte. */
    basculerMode(actif) {
      modeDessin = actif;
      couche.classList.toggle('actives', actif);
      if (!actif) {
        armer(null);
        choisie = null;
        marquerChoisie();
        socle.fermer();
      }
      return modeDessin;
    },

    modeActif: () => modeDessin,
    armer,
    outilArme: () => outil,
    nombre: () => formes.length,
  };
}
