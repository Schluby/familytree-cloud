/* Moteur de rendu « cartes » : mise en page généalogique.
 *
 * Les personnes sont des fiches HTML empilées par génération ; le sang est
 * tracé en connecteurs orthogonaux (barre de couple -> descente -> barre de
 * fratrie), les liens sociaux en traits pointillés vers des cartes satellites.
 *
 * Le moteur ne connaît pas le domaine : il consomme {noeuds, aretes} avec le
 * champ `role` (filiation / union / fratrie / social) et `generation`.
 */

import { enregistrerRendu } from '../registry.js';
import { creerCoucheFormes } from '../formes.js';
import { couleurHumeur, ecartHumeur } from '../humeur.js';
import { surMenuContextuel } from '../dom.js';
import { ageAffiche, formaterAge } from '../calendrier.js';
import { rangDe } from '../rangs.js';

const GEO = {
  largeurCarte: 186, // toutes les fiches ont la même taille : voir mesurer()
  espaceCouple: 12,
  espaceUnite: 26,
  espaceBande: 72,
  espaceSatellite: 70,
  espaceTranche: 110, // entre deux tranches repliées
  marge: 70,
  deportBarre: 20,
  echelleFocusMin: 0.62,
  margeSeparation: 8, // en deçà, deux fiches se repoussent
  // Au-delà de cette longueur, la pastille d'un lien se répète au milieu :
  // deux fiches assez écartées ne tiennent plus ensemble dans le regard.
  pastilleMilieu: 260,
  retraitPastille: 24,
};

const COULEURS_STATUT = { vivant: '#3fa877', mort: '#9a6a6a', inconnu: '#8a8f98' };
const COULEURS_GENERATION = ['#a8559f', '#8265c0', '#5b7fc4', '#2f97a8', '#2f9e78'];

export function creerRenduCartes(conteneur, contexte = {}) {
  // ------------------------------------------------------------------ DOM
  const plan = document.createElement('div');
  plan.className = 'plan';

  const monde = document.createElement('div');
  monde.className = 'monde';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'liens');
  const defs = document.createElementNS(SVG_NS, 'defs');
  const coucheLiens = document.createElementNS(SVG_NS, 'g');

  // Élastique affiché pendant un glisser depuis la poignée « ＋ » d'une fiche.
  const coucheGuide = document.createElementNS(SVG_NS, 'g');
  coucheGuide.setAttribute('class', 'couche-guide');
  const guideTrait = document.createElementNS(SVG_NS, 'path');
  guideTrait.setAttribute('class', 'guide-trait');
  const guidePoint = document.createElementNS(SVG_NS, 'circle');
  guidePoint.setAttribute('class', 'guide-point');
  guidePoint.setAttribute('r', '5');
  coucheGuide.append(guideTrait, guidePoint);

  svg.append(defs, coucheLiens, coucheGuide);

  const coucheCartes = document.createElement('div');
  coucheCartes.className = 'cartes';

  // Il n'y a plus de gabarit invisible ici.
  //
  // Il existait parce que les fiches n'affichaient pas toutes la même chose —
  // une sans date à côté d'une à trois lignes donnait des bandes en dents de
  // scie — et il portait donc le contenu *maximal*, pour en tirer une hauteur
  // commune. Depuis le lot 20.C, toute fiche a exactement la même structure :
  // un nom, une maison, un lieu. La hauteur est déclarée une fois dans la
  // feuille de style (`--carte-hauteur`), et `mesurer()` la relit sur une
  // fiche réelle — ce qui reste juste si le thème change la taille du texte.

  // Les formes de fond (lot 20.D) sont montées **en premier** dans le monde :
  // elles passent donc derrière les traits de liaison et derrière les fiches,
  // ce qui est tout leur propos. Elles subissent le même `transform` que le
  // reste, donc elles zooment et se déplacent avec le plan.
  const formes = creerCoucheFormes({
    monde,
    plan,
    pointMonde,
    rappels: {
      surCreation: (donnees, point) => contexte.surFormeCreee?.(donnees, point),
      surModification: (id, patch) => contexte.surFormeModifiee?.(id, patch),
      surSuppression: (id) => contexte.surFormeSupprimee?.(id),
      surOutil: (genre) => contexte.surOutilForme?.(genre),
      // Une forme prise ou rendue change ce qu'emporterait un Ctrl+C : le même
      // écriteau que les fiches doit le dire (lot 26.B).
      surPrises: () => marquerSelection(),
      // Pour nommer les profils auxquels une forme est rattachée. Le moteur les
      // a déjà sous la main : inutile de les redemander à `main.js`.
      profils: () =>
        (payload?.noeuds || [])
          .map((noeud) => ({ id: noeud.id, nom: noeud.label || noeud.id }))
          .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    },
  });

  monde.append(formes.couche, svg, coucheCartes);
  plan.append(monde);
  // La surface de tracé est posée sur le plan, et non dans le monde : elle doit
  // couvrir l'écran sans subir le zoom, sinon un tracé au loin manquerait les
  // bords. C'est `pointMonde` qui rend au tracé ses coordonnées de monde.
  plan.append(formes.capture);
  conteneur.append(plan);

  // ---------------------------------------------------------------- état
  let payload = null;
  let options = { couleurPar: 'maison' };
  let indexNoeuds = new Map();
  let aretesVisibles = []; // ce qu'on dessine (après filtre de type)
  let aretesStructure = []; // ce qui porte la mise en page (jamais filtré)
  let filtreLiens = false;
  const epingles = new Set(); // fiches à garder visibles malgré le focus
  const cartes = new Map(); // id -> élément
  const mesures = new Map(); // id -> {l, h}
  let disposition = null;
  let focusId = null;
  let ensembleFocus = null;
  let transformCourante = d3.zoomIdentity;
  let premierRendu = true;

  const zoom = d3
    .zoom()
    .scaleExtent([0.08, 2.2])
    .filter((evenement) => {
      // On laisse cliquer les cartes ; le glisser sur une carte déplace la vue.
      if (evenement.type === 'wheel') return true;
      // Ctrl appartient à la sélection, pas au panoramique — et il faut le dire
      // **ici**, pas seulement plus bas : dès qu'il accepte un `mousedown`,
      // d3-zoom appelle `stopImmediatePropagation`, ce qui tue net les
      // écouteurs posés après lui sur le même élément. Tant que ce filtre
      // acceptait Ctrl, le cadre de sélection ne pouvait pas exister. Le filtre
      // d'origine de d3 écarte Ctrl pour cette raison ; en le remplaçant, nous
      // avions laissé tomber la clause.
      if (evenement.ctrlKey || evenement.metaKey) return false;
      return !evenement.button;
    })
    .on('zoom', (evenement) => {
      transformCourante = evenement.transform;
      monde.style.transform = `translate(${transformCourante.x}px, ${transformCourante.y}px) scale(${transformCourante.k})`;
      plan.classList.toggle('loin', transformCourante.k < 0.42);
      contexte.surZoom?.(transformCourante.k);
    });

  d3.select(plan).call(zoom).on('dblclick.zoom', null);

  const largeurPlan = () => plan.clientWidth || 900;
  const hauteurPlan = () => plan.clientHeight || 600;

  // =====================================================================
  //  Interactions : clic sur un lien, menu contextuel, création de lien
  // =====================================================================

  const areteParId = (id) => aretesVisibles.find((arete) => arete.id === id) || null;

  /** Convertit un événement souris en coordonnées du monde (avant zoom/pan). */
  function pointMonde(evenement) {
    const cadre = plan.getBoundingClientRect();
    const [x, y] = transformCourante.invert([
      evenement.clientX - cadre.left,
      evenement.clientY - cadre.top,
    ]);
    return { x, y };
  }

  /** Tous les liens sous le curseur : un connecteur en croise souvent d'autres. */
  function liensSous(evenement) {
    const identifiants = new Set();
    document
      .elementsFromPoint(evenement.clientX, evenement.clientY)
      .forEach((element) => {
        const brut = element.dataset?.relation || element.dataset?.relations;
        if (brut) brut.split(',').forEach((id) => identifiants.add(id));
      });
    return [...identifiants].map(areteParId).filter(Boolean);
  }

  plan.addEventListener('click', (evenement) => {
    // Le clic qui suit un lâcher de liaison ne doit rien déclencher d'autre.
    if (performance.now() - finLiaison < 250) return;
    // Ni celui qui suit un cadre de sélection : il défairait ce qu'on vient
    // de prendre.
    if (performance.now() - finBande < 250) return;
    if (sortDAppuiLong()) return;
    const liens = liensSous(evenement);
    if (liens.length) {
      contexte.surClicLien?.(liens, evenement);
      return;
    }
    // Un clic simple dans le vide repose la main : sans ça, une sélection
    // oubliée emporterait tout un groupe au prochain glisser.
    if (
      !evenement.ctrlKey &&
      !evenement.metaKey &&
      (evenement.target === plan || evenement.target === monde)
    ) {
      viderSelection();
    }
    // Cliquer dans le vide ne quitte plus le focus : on ne perd pas sa vue
    // resserrée d'un clic malheureux. Échap et « Vue générale » restent là.
    if (evenement.target === plan || evenement.target === monde) contexte.surFond?.();
  });

  /**
   * Le routage du menu contextuel, à un point de l'écran. Partagé par le clic
   * droit et l'appui long : les deux gestes ouvrent exactement le même menu,
   * il n'y a donc pas un jeu de commandes pour la souris et un pour le doigt.
   */
  function ouvrirMenuAu(x, y) {
    const evenementLocal = { clientX: x, clientY: y };
    const carte = document.elementFromPoint(x, y)?.closest?.('.carte');
    if (carte) {
      contexte.surMenuCarte?.(carte.dataset.id, evenementLocal);
      return;
    }
    const liens = liensSous(evenementLocal);
    if (liens.length) {
      contexte.surMenuLien?.(liens, evenementLocal);
      return;
    }
    contexte.surMenuFond?.(evenementLocal, pointMonde(evenementLocal));
  }

  // Clic droit à la souris, appui long au doigt : le même menu, le même code.
  // `sortDAppuiLong()` sert à ignorer le clic produit par le lever du doigt.
  const sortDAppuiLong = surMenuContextuel(plan, (evenement) =>
    ouvrirMenuAu(evenement.clientX, evenement.clientY)
  );

  // ------------------------------------ déplacer une fiche, ou toute une main
  //
  // Lot 22.D : ce qu'on lâche est enregistré comme une **position absolue**, et
  // plusieurs fiches peuvent partir ensemble — voir `selection`.
  let deport = null;
  let finDeplacement = 0;
  /** Le dernier geste a-t-il vraiment bougé une fiche ? Sinon c'était un clic. */
  let bougeAuDernierDeplacement = false;
  /** Les fiches choisies, qui se déplacent d'un bloc. */
  const selection = new Set();

  function marquerSelection() {
    cartes.forEach((carte, id) => carte.classList.toggle('selectionnee', selection.has(id)));
    contexte.surSelectionMultiple?.(selection.size, formes.prises().length);
  }

  function viderSelection() {
    if (!selection.size && !formes.prises().length) return;
    selection.clear();
    // Les formes se prennent dans le même geste : elles se reposent avec lui.
    formes.viderPrises();
    marquerSelection();
  }

  function basculerSelection(id) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    marquerSelection();
  }

  function demarrerDeplacement(id, evenement) {
    const boite = disposition?.boites.get(id);
    if (!boite) return;
    const curseur = pointMonde(evenement);
    // Prendre une fiche hors sélection, c'est ne déplacer qu'elle : sinon on
    // emporterait sans le vouloir un groupe choisi il y a dix minutes. Mais
    // sans **défaire** la sélection au passage : Ctrl sert aussi à la composer,
    // et un second Ctrl + clic doit ajouter une fiche, pas remplacer les autres.
    const groupe = selection.has(id) ? [...selection] : [id];
    deport = {
      id,
      quoi: groupe
        .map((autre) => {
          const cible = disposition?.boites.get(autre);
          return cible && { id: autre, boite: cible, ecartX: cible.x - curseur.x, ecartY: cible.y - curseur.y, depart: { x: cible.x, y: cible.y } };
        })
        .filter(Boolean),
    };
    coucheCartes.classList.add('sans-transition');
    deport.quoi.forEach((part) => cartes.get(part.id)?.classList.add('en-deport'));
    plan.classList.add('en-deport');
    document.addEventListener('mousemove', surDeplacement, true);
    document.addEventListener('mouseup', surFinDeplacement, true);
  }

  function surDeplacement(evenement) {
    if (!deport) return;
    const curseur = pointMonde(evenement);
    deport.quoi.forEach(({ id, boite, ecartX, ecartY }) => {
      // Jamais au-delà du coin : le monde commence à zéro, et une fiche posée
      // en négatif serait rognée par le cadre.
      boite.x = Math.max(0, curseur.x + ecartX);
      boite.y = Math.max(0, curseur.y + ecartY);
      const carte = cartes.get(id);
      carte.style.left = `${boite.x}px`;
      carte.style.top = `${boite.y}px`;
    });
    tracerLiens(); // les connecteurs suivent les fiches
  }

  function surFinDeplacement(evenement) {
    if (!deport) return;
    const { quoi } = deport;
    quoi.forEach((part) => cartes.get(part.id)?.classList.remove('en-deport'));
    plan.classList.remove('en-deport');
    coucheCartes.classList.remove('sans-transition');
    document.removeEventListener('mousemove', surDeplacement, true);
    document.removeEventListener('mouseup', surFinDeplacement, true);
    deport = null;
    finDeplacement = performance.now();
    evenement.preventDefault();
    evenement.stopPropagation();

    const bouges = quoi.filter(
      ({ boite, depart }) => Math.round(boite.x - depart.x) || Math.round(boite.y - depart.y)
    );
    bougeAuDernierDeplacement = bouges.length > 0;
    if (!bouges.length) return; // simple ctrl-clic

    const positions = {};
    bouges.forEach(({ id, boite }) => {
      const position = [Math.round(boite.x), Math.round(boite.y)];
      const noeud = indexNoeuds.get(id);
      if (noeud) {
        noeud.position = position;
        // Le déport relatif d'avant a fini son office : le garder ferait
        // s'ajouter deux fois le même déplacement au prochain calcul.
        noeud.decalage = null;
      }
      positions[id] = position;
    });
    // Rejoue la mise en page : les fiches lâchées restent où on les a posées,
    // et leurs voisines s'écartent si elles sont venues leur marcher dessus.
    appliquer({ animer: true });
    contexte.surPositions?.(positions);
  }

  // ------------------------------------------ choisir plusieurs fiches (Ctrl)
  //
  // Ctrl + glisser dans le vide trace un cadre et prend tout ce qu'il touche.
  // Ctrl et non Maj : c'est le geste du bureau, et Maj reste au lien rapide.
  // Le filtre de `zoom` plus haut doit écarter Ctrl, sans quoi d3 avale le
  // `mousedown` avant nous — voir le commentaire qui s'y trouve.
  const bandeSelection = document.createElement('div');
  bandeSelection.className = 'bande-selection';
  bandeSelection.hidden = true;
  plan.append(bandeSelection);

  let bande = null;
  let finBande = 0;

  plan.addEventListener('mousedown', (evenement) => {
    // Ctrl (ou ⌘) + glisser dans le vide (lot 23.G — c'était Maj auparavant).
    // Ctrl devient ainsi la touche de la sélection d'un bout à l'autre : sur une
    // fiche elle la prend et la déplace, dans le vide elle encadre. Maj reste au
    // lien rapide, qui est un tout autre geste.
    if (evenement.button !== 0 || !(evenement.ctrlKey || evenement.metaKey)) return;
    if (evenement.target.closest('.carte, .forme')) return;
    evenement.preventDefault();
    // Indispensable, et pas seulement poli : d3-zoom écoute ici et poserait ses
    // écouteurs sur la fenêtre en phase de capture, où il appelle
    // `stopImmediatePropagation`. Nos `mousemove` ne nous parviendraient jamais.
    evenement.stopPropagation();
    const cadre = plan.getBoundingClientRect();
    bande = {
      x0: evenement.clientX - cadre.left,
      y0: evenement.clientY - cadre.top,
      cadre,
      // Un nouveau cadre **ajoute** à ce qui est déjà pris : on compose une main
      // en plusieurs passes plutôt que de tout reprendre à chaque fois.
      avant: new Set(selection),
      avantFormes: formes.prises(),
      // Reste faux tant que rien n'a été tracé : c'est ce qui distingue le
      // cadre du simple Ctrl + clic, traité au lâcher.
      aTrace: false,
    };
    bandeSelection.hidden = false;
    majBande(evenement);
    document.addEventListener('mousemove', majBande, true);
    document.addEventListener('mouseup', finirBande, true);
  });

  function majBande(evenement) {
    if (!bande) return;
    const x1 = evenement.clientX - bande.cadre.left;
    const y1 = evenement.clientY - bande.cadre.top;
    const gauche = Math.min(bande.x0, x1);
    const haut = Math.min(bande.y0, y1);
    if (Math.abs(x1 - bande.x0) > 3 || Math.abs(y1 - bande.y0) > 3) bande.aTrace = true;
    bandeSelection.style.left = `${gauche}px`;
    bandeSelection.style.top = `${haut}px`;
    bandeSelection.style.width = `${Math.abs(x1 - bande.x0)}px`;
    bandeSelection.style.height = `${Math.abs(y1 - bande.y0)}px`;

    // Le cadre est à l'écran, les fiches sont dans le monde : on ramène le
    // cadre au monde plutôt que les soixante fiches à l'écran.
    const [mx0, my0] = transformCourante.invert([gauche, haut]);
    const [mx1, my1] = transformCourante.invert([gauche + Math.abs(x1 - bande.x0), haut + Math.abs(y1 - bande.y0)]);
    selection.clear();
    bande.avant.forEach((id) => selection.add(id));
    disposition?.boites.forEach((boite, id) => {
      if (!cartes.get(id) || cartes.get(id).classList.contains('masquee')) return;
      const touche = boite.x < mx1 && boite.x + boite.l > mx0 && boite.y < my1 && boite.y + boite.h > my0;
      if (touche) selection.add(id);
    });
    // Les formes de fond entrent dans le même cadre (lot 26.B). Elles vivent
    // déjà en coordonnées de monde — les mêmes que ces boîtes — donc il n'y a
    // rien de plus à convertir, et surtout rien à rendre cliquable.
    const formesPrises = new Set(bande.avantFormes);
    formes.boites().forEach((boite) => {
      const touche =
        boite.x < mx1 && boite.x + boite.l > mx0 && boite.y < my1 && boite.y + boite.h > my0;
      if (touche) formesPrises.add(boite.id);
    });
    formes.definirPrises([...formesPrises]);
    marquerSelection();
  }

  function finirBande(evenement) {
    if (!bande) return;
    const { aTrace, avantFormes } = bande;
    bande = null;
    bandeSelection.hidden = true;
    document.removeEventListener('mousemove', majBande, true);
    document.removeEventListener('mouseup', finirBande, true);
    finBande = performance.now();
    evenement.preventDefault();
    evenement.stopPropagation();

    // Ctrl + clic sans rien tracer : s'il y a une forme dessous, on la prend ou
    // on la rend. C'est le pendant exact du Ctrl + clic sur une fiche, en
    // passant par la géométrie puisqu'une forme au repos n'attrape pas les
    // clics — voir l'entête de `js/formes.js`.
    if (aTrace) return;
    // On repart de l'état d'avant le clic, et c'est indispensable : un cadre de
    // zéro pixel **recoupe** la forme sous le curseur, donc `majBande` l'a déjà
    // prise. Basculer par-dessus la rendait aussitôt, et le clic ne faisait
    // rien du tout — deux gestes qui s'annulent, invisibles à la lecture.
    formes.definirPrises(avantFormes);
    const point = pointMonde(evenement);
    const id = formes.sousLePoint(point.x, point.y);
    if (id) formes.basculerPrise(id);
  }

  // ------------------------------------------------------- glisser un lien
  let liaison = null;
  let finLiaison = 0;

  function demarrerLiaison(sourceId, evenement) {
    const boite = disposition?.boites.get(sourceId);
    if (!boite) return;
    liaison = {
      source: sourceId,
      depart: { x: boite.x + boite.l / 2, y: boite.y + boite.h },
      cible: null,
      surSource: true,
    };
    cartes.get(sourceId)?.classList.add('source-liaison');
    plan.classList.add('en-liaison');
    coucheGuide.classList.add('visible');
    document.addEventListener('mousemove', surDeplacementLiaison, true);
    document.addEventListener('mouseup', surFinLiaison, true);
    surDeplacementLiaison(evenement);
  }

  function surDeplacementLiaison(evenement) {
    if (!liaison) return;
    const point = pointMonde(evenement);
    guideTrait.setAttribute('d', `M${liaison.depart.x},${liaison.depart.y}L${point.x},${point.y}`);
    guidePoint.setAttribute('cx', point.x);
    guidePoint.setAttribute('cy', point.y);

    const survolee = document
      .elementFromPoint(evenement.clientX, evenement.clientY)
      ?.closest?.('.carte');
    liaison.surSource = survolee?.dataset.id === liaison.source;
    const cible = survolee && !liaison.surSource ? survolee.dataset.id : null;
    if (cible === liaison.cible) return;
    if (liaison.cible) cartes.get(liaison.cible)?.classList.remove('cible-liaison');
    liaison.cible = cible;
    if (cible) cartes.get(cible)?.classList.add('cible-liaison');
  }

  function surFinLiaison(evenement) {
    if (!liaison) return;
    const { source, cible, surSource } = liaison;
    cartes.get(source)?.classList.remove('source-liaison');
    if (cible) cartes.get(cible)?.classList.remove('cible-liaison');
    coucheGuide.classList.remove('visible');
    guideTrait.removeAttribute('d');
    plan.classList.remove('en-liaison');
    document.removeEventListener('mousemove', surDeplacementLiaison, true);
    document.removeEventListener('mouseup', surFinLiaison, true);
    liaison = null;
    finLiaison = performance.now();
    evenement.preventDefault();
    evenement.stopPropagation();
    // Relâché sur la fiche de départ : simple annulation.
    if (surSource) return;
    contexte.surLiaison?.({ source, cible }, evenement);
  }

  // =====================================================================
  //  Construction des cartes
  // =====================================================================

  function construireCartes() {
    const vus = new Set();

    (payload.noeuds || []).forEach((noeud) => {
      vus.add(noeud.id);
      let carte = cartes.get(noeud.id);
      if (!carte) {
        carte = document.createElement('article');
        carte.className = 'carte';
        carte.dataset.id = noeud.id;
        carte.addEventListener('mousedown', (evenement) => {
          if (evenement.button !== 0) return;
          if (evenement.ctrlKey || evenement.metaKey) {
            evenement.preventDefault(); // coupe le pan d3
            evenement.stopPropagation();
            demarrerDeplacement(noeud.id, evenement);
          } else if (evenement.shiftKey) {
            evenement.preventDefault(); // coupe la sélection de texte
            evenement.stopPropagation();
          }
        });
        carte.addEventListener('click', (evenement) => {
          if (evenement.target.closest('.carte-poignee')) return;
          evenement.stopPropagation();
          if (evenement.ctrlKey || evenement.metaKey) {
            // Ctrl + glisser déplace ; Ctrl + clic sans glisser ajoute ou
            // retire la fiche de la main qu'on est en train de composer. On lit
            // `bougeAuDernierDeplacement` et non `deport`, qui est déjà remis à
            // zéro quand ce clic nous parvient : après un vrai déplacement, la
            // fiche entrait dans la sélection sans qu'on l'ait demandé.
            if (performance.now() - finDeplacement < 250 && !bougeAuDernierDeplacement)
              basculerSelection(noeud.id);
            return;
          }
          if (performance.now() - finDeplacement < 250) return;
          if (sortDAppuiLong()) return; // le menu long-press vient de s'ouvrir
          if (evenement.shiftKey) {
            contexte.surLiaisonRapide?.(noeud.id, evenement);
            return;
          }
          // L'événement part avec : quand un lien est armé, c'est lui qui dit
          // où poser l'éditeur, et le doigt n'a ni Maj ni glisser à offrir.
          contexte.surSelection?.(noeud.id, noeud, evenement);
        });
        coucheCartes.append(carte);
        cartes.set(noeud.id, carte);
      }
      remplirCarte(carte, noeud);
    });

    // suppression des cartes disparues du jeu de données
    [...cartes.keys()].forEach((id) => {
      if (!vus.has(id)) {
        cartes.get(id).remove();
        cartes.delete(id);
        mesures.delete(id);
      }
    });
  }

  function remplirCarte(carte, noeud) {
    const satellite = !!noeud.satellite;
    const couleur = couleurCarte(noeud);
    carte.classList.toggle('satellite', satellite);
    carte.classList.toggle('morte', noeud.statut === 'mort');
    // Un personnage joué n'est pas un PNJ : sa carte porte un liseré à la
    // couleur de son joueur, pour le repérer d'un coup d'œil sur le plan.
    carte.classList.toggle('joueur', !!noeud.joueur);
    if (noeud.joueur) carte.style.setProperty('--couleur-joueur', noeud.joueur.couleur);
    else carte.style.removeProperty('--couleur-joueur');
    carte.style.setProperty('--couleur-carte', couleur);
    // Le liseré choisi dans la fiche (lot 20.B). Il ne dépend pas de l'axe de
    // couleur : c'est justement ce qui le rend utile — on marque « à revoir ce
    // soir » et la marque tient qu'on regarde les maisons ou les humeurs.
    carte.classList.toggle('bordee', !!noeud.bordure);
    if (noeud.bordure) carte.style.setProperty('--couleur-bordure', noeud.bordure);
    else carte.style.removeProperty('--couleur-bordure');
    carte.style.width = `${GEO.largeurCarte}px`;

    // Chef de maison et héritier : ce sont les fiches qu'on cherche des yeux
    // en premier sur un plan chargé. Elles portent un cadre plus appuyé et
    // une marque dans le coin, sans changer de taille — la mise en page ne
    // doit pas dépendre de qui règne.
    const rang = rangDe(noeud.tags);
    carte.classList.toggle('rang', !!rang);
    carte.classList.toggle('rang-chef', rang?.classe === 'chef');
    carte.classList.toggle('rang-heritier', rang?.classe === 'heritier');

    // ---------------------------------------------------------------- le fond
    //
    // Lot 20.C : la carte tient en trois quarts. Le nom prend la moitié du
    // haut, la maison le troisième quart, le lieu du moment le dernier. C'est
    // ce qu'on cherche des yeux sur un plan de soixante fiches — « qui »,
    // « avec qui », « où » — et le reste encombrait plus qu'il ne servait.
    //
    // Ce qui a quitté la carte n'est pas perdu : l'âge, la naissance, le décès
    // et le titre principal passent en infobulle (ci-dessous), et les notes se
    // lisent dans la fiche, à droite, où on les écrit de toute façon.
    carte.title = infobulle(noeud);

    carte.innerHTML = `
      ${rang ? `<span class="carte-rang" title="${echapper(rang.label)}">${rang.icone}</span>` : ''}
      <div class="carte-entete">
        <span class="carte-nom">${echapper(noeud.label)}</span>
      </div>
      <div class="carte-corps">
        <div class="carte-rangee">
          ${fait('Maison', noeud.maison_label)}
          ${fait('Rôle', noeud.role)}
        </div>
        <div class="carte-rangee">
          ${fait('Région', noeud.lieu)}
          ${fait('Ville', noeud.ville)}
        </div>
      </div>
      <button class="carte-poignee" type="button" tabindex="-1"
              title="Glisser vers une autre fiche pour créer un lien">+</button>`;

    carte.querySelector('.carte-poignee').addEventListener('mousedown', (evenement) => {
      if (evenement.button !== 0) return;
      evenement.preventDefault(); // coupe le pan d3 et la sélection de texte
      evenement.stopPropagation();
      demarrerLiaison(noeud.id, evenement);
    });
  }

  /**
   * Une des quatre cases du bas : un intitulé discret, une valeur lisible.
   *
   * La case est rendue **même vide** — un tiret. Sans elle la carte perdrait sa
   * grille, et deux fiches côte à côte ne s'aligneraient plus : « Ville » de
   * l'une se retrouverait à la hauteur de « Région » de l'autre.
   */
  function fait(libelle, valeur) {
    return `
      <div class="carte-fait">
        <span class="carte-fait-lib">${echapper(libelle)}</span>
        <span class="carte-fait-val">${echapper(valeur || '—')}</span>
      </div>`;
  }

  /**
   * Tout ce que la carte ne montre plus, au survol.
   *
   * L'infobulle native (`title`) et non une bulle dessinée : elle ne coûte rien
   * à l'affichage, et il y a jusqu'à trois cents fiches sur le plan. Elle porte
   * aussi « Joué par … », qui vivait ici avant le lot 20.C.
   */
  function infobulle(noeud) {
    const morceaux = [];
    if (noeud.titres?.length) morceaux.push(String(noeud.titres[0]));

    const age = ageAffiche(noeud, options.anneeCourante);
    if (age !== null) {
      const libelle = noeud.statut === 'mort' ? 'Âge à sa mort' : 'Âge';
      morceaux.push(`${libelle} : ${formaterAge(age)}`);
    }
    if (noeud.naissance) morceaux.push(`Né en ${noeud.naissance}`);
    if (noeud.statut === 'mort' && noeud.deces) morceaux.push(`Mort en ${noeud.deces}`);
    if (noeud.joueur) morceaux.push(`Joué par ${noeud.joueur.nom}`);
    if (noeud.notes) morceaux.push(noeud.notes);

    return morceaux.join('\n');
  }

  function echapper(texte) {
    return String(texte ?? '').replace(
      /[&<>"']/g,
      (caractere) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
          caractere
        ])
    );
  }

  /**
   * La taille commune des fiches, telle qu'elle est vraiment rendue.
   *
   * Elle vient de la feuille de style (`--carte-hauteur`) : on ne la fixe pas
   * ici, on la **relit** sur une fiche existante. C'est ce qui garde les traits
   * de liaison d'accord avec le dessin — ils sont tracés d'après ces mesures,
   * et une hauteur recopiée en JavaScript se serait un jour désaccordée de la
   * feuille sans que rien ne le dise.
   */
  function mesurer() {
    const premiere = cartes.values().next().value;
    const hauteur = premiere?.offsetHeight || 132;
    cartes.forEach((_carte, id) => {
      mesures.set(id, { l: GEO.largeurCarte, h: hauteur });
    });
  }

  // =====================================================================
  //  Couleurs
  // =====================================================================

  function couleurCarte(noeud) {
    const mode = options.couleurPar || 'maison';
    if (mode === 'statut') return COULEURS_STATUT[noeud.statut] || '#8a8f98';
    // La catégorie d'une maison : sa couleur vient du référentiel, injectée
    // dans les options par l'orchestrateur (le moteur ne lit pas l'API).
    if (mode === 'generation') {
      return COULEURS_GENERATION[(noeud.generation || 0) % COULEURS_GENERATION.length];
    }
    // Filtre sur mesure : la couleur du segment est calculée par le serveur et
    // descendue toute prête — le moteur n'a pas à savoir ce qu'on segmente.
    if (mode.startsWith('filtre:')) {
      return options.couleursNoeuds?.[noeud.id] || '#8a8f98';
    }
    // Humeur : 1 est le meilleur cran, 7 le pire — la couleur vient de la
    // table du serveur, pas d'une échelle recopiée ici.
    if (mode === 'joueurs') return couleurHumeur(noeud.note_joueurs_moyenne);
    if (mode.startsWith('joueur:')) {
      return couleurHumeur(noeud.notes_joueurs?.[mode.slice(7)]?.note);
    }
    return noeud.couleur;
  }

  // =====================================================================
  //  Mise en page
  // =====================================================================

  function calculerMiseEnPage(ids) {
    const visible = new Set(ids);
    const taille = (id) =>
      mesures.get(id) || { l: GEO.largeurCarte, h: 150 };

    // --- 1. tri des liens ------------------------------------------------
    // La charpente se calcule sur *tous* les liens : filtrer par type ne doit
    // pas faire sauter les fiches de place, seulement changer ce qu'on dessine.
    const filiations = [];
    const unions = [];
    const sociaux = [];
    const fratriesBrutes = [];
    aretesStructure.forEach((arete) => {
      if (!visible.has(arete.source) || !visible.has(arete.cible)) return;
      if (arete.role === 'filiation') filiations.push(arete);
      else if (arete.role === 'union') unions.push(arete);
      else if (arete.role === 'social') sociaux.push(arete);
      else if (arete.role === 'fratrie') fratriesBrutes.push(arete);
    });

    const parentsDe = new Map();
    filiations.forEach((a) => {
      if (!parentsDe.has(a.cible)) parentsDe.set(a.cible, new Set());
      parentsDe.get(a.cible).add(a.source);
    });

    /** Aucun parent **visible** ne leur est commun sur ce plan-ci. */
    const sansParentCommun = (arete) => {
      const pa = parentsDe.get(arete.source) || new Set();
      const pb = parentsDe.get(arete.cible) || new Set();
      return ![...pa].some((parent) => pb.has(parent));
    };

    // Fratrie utile = frère/sœur dont on ne connaît pas le parent commun :
    // sans elle, un oncle sans ascendance connue finirait en satellite. C'est
    // la seule qui **place** les fiches ; on n'en déduit rien de plus.
    const fratries = fratriesBrutes.filter((a) => !a.deduit && sansParentCommun(a));

    // Ce qu'on **dessine** n'est pas ce qui **place**, et les deux listes
    // divergent depuis le lot 21.B :
    //
    // — une fratrie explicite se voit toujours. Même entre deux enfants d'un
    //   même parent, où elle ne déplace rien : quelqu'un l'a créée à la main,
    //   et jusqu'ici elle disparaissait sans un mot ;
    // — une fratrie déduite ne se voit que si aucun parent commun n'est
    //   visible — filtré par maison, par statut, ou simplement absent. Les
    //   dessiner toutes couvrirait le plan de n² accolades qui ne répètent
    //   que ce que le connecteur de famille dit déjà.
    const fratriesTracees = fratriesBrutes.filter((a) => !a.deduit || sansParentCommun(a));

    // --- 2. arbre / satellites -------------------------------------------
    const dansArbre = new Set();
    [...filiations, ...unions, ...fratries].forEach((a) => {
      dansArbre.add(a.source);
      dansArbre.add(a.cible);
    });
    const satellites = ids.filter((id) => !dansArbre.has(id));

    // --- 3. générations ---------------------------------------------------
    const generations = new Map();
    dansArbre.forEach((id) => generations.set(id, indexNoeuds.get(id)?.generation ?? 0));
    const minimum = generations.size ? Math.min(...generations.values()) : 0;
    generations.forEach((valeur, id) => generations.set(id, valeur - minimum));

    // --- 4. unités (couples) ---------------------------------------------
    const pere = new Map([...dansArbre].map((id) => [id, id]));
    const racine = (x) => {
      while (pere.get(x) !== x) {
        pere.set(x, pere.get(pere.get(x)));
        x = pere.get(x);
      }
      return x;
    };
    // Couples et fratries sans parents connus forment un même bloc : on veut
    // les voir côte à côte, avec leur barre de liaison.
    const voisinsUnion = new Map([...dansArbre].map((id) => [id, []]));
    [...unions, ...fratries].forEach((a) => {
      if (generations.get(a.source) !== generations.get(a.cible)) return;
      pere.set(racine(a.source), racine(a.cible));
      voisinsUnion.get(a.source).push(a.cible);
      voisinsUnion.get(a.cible).push(a.source);
    });

    // Sur un même rang, la fratrie se dessine en accolade au-dessus des deux
    // fiches ; d'un rang à l'autre, en trait souple comme un lien social. Un
    // satellite n'a pas de génération : deux satellites sont donc du même rang
    // (`undefined === undefined`), ce qui est exactement ce qu'on veut d'eux.
    const memeRang = (a) => generations.get(a.source) === generations.get(a.cible);
    const fratriesAdjacentes = fratriesTracees.filter(memeRang);
    const fratriesEloignees = fratriesTracees.filter((a) => !memeRang(a));

    const unites = new Map(); // id d'unité -> unité
    const uniteDe = new Map(); // personne -> unité
    [...dansArbre].forEach((id) => {
      const cle = racine(id);
      if (!unites.has(cle)) {
        unites.set(cle, { id: cle, membres: [], gen: generations.get(id) || 0 });
      }
      unites.get(cle).membres.push(id);
    });

    unites.forEach((unite) => {
      unite.membres = ordonnerMembres(unite.membres, voisinsUnion);
      unite.gen = Math.max(...unite.membres.map((id) => generations.get(id) || 0));
      unite.membres.forEach((id) => uniteDe.set(id, unite));
      unite.largeur =
        unite.membres.reduce((somme, id) => somme + taille(id).l, 0) +
        GEO.espaceCouple * (unite.membres.length - 1);
      unite.hauteur = Math.max(...unite.membres.map((id) => taille(id).h));
    });

    // --- 5. familles (groupes d'enfants partageant les mêmes parents) -----
    const familles = new Map();
    const cleFamille = (enfant) => [...(parentsDe.get(enfant) || [])].sort().join('|');
    parentsDe.forEach((parents, enfant) => {
      const cle = cleFamille(enfant);
      if (!familles.has(cle)) {
        familles.set(cle, { parents: [...parents], enfants: [], liens: [] });
      }
      familles.get(cle).enfants.push(enfant);
    });
    // Chaque filiation garde son lien d'origine : c'est lui qu'on éditera au
    // clic, alors que le connecteur dessiné est mutualisé par toute la fratrie.
    filiations.forEach((arete) => {
      familles.get(cleFamille(arete.cible))?.liens.push(arete);
    });

    const parentsUnite = new Map(); // unité -> Set(unités parentes)
    const enfantsUnite = new Map();
    unites.forEach((unite) => {
      parentsUnite.set(unite.id, new Set());
      enfantsUnite.set(unite.id, new Set());
    });
    familles.forEach((famille) => {
      const unitesParents = new Set(
        famille.parents.map((id) => uniteDe.get(id)).filter(Boolean)
      );
      const unitesEnfants = new Set(
        famille.enfants.map((id) => uniteDe.get(id)).filter(Boolean)
      );
      unitesEnfants.forEach((enfant) => {
        unitesParents.forEach((parent) => {
          if (parent === enfant) return;
          parentsUnite.get(enfant.id).add(parent);
          enfantsUnite.get(parent.id).add(enfant);
        });
      });
    });

    // --- 6. couches et ordre initial (parcours en profondeur) -------------
    const couches = [];
    unites.forEach((unite) => {
      (couches[unite.gen] = couches[unite.gen] || []).push(unite);
    });
    for (let g = 0; g < couches.length; g += 1) couches[g] = couches[g] || [];

    const rang = new Map();
    let compteur = 0;
    const visiter = (unite) => {
      if (rang.has(unite.id)) return;
      rang.set(unite.id, compteur++);
      [...enfantsUnite.get(unite.id)]
        .sort((a, b) => etiquette(a).localeCompare(etiquette(b)))
        .forEach(visiter);
    };
    [...unites.values()]
      .filter((unite) => parentsUnite.get(unite.id).size === 0)
      .sort((a, b) => a.gen - b.gen || etiquette(a).localeCompare(etiquette(b)))
      .forEach(visiter);
    [...unites.values()].forEach(visiter);
    couches.forEach((couche) =>
      couche.sort((a, b) => rang.get(a.id) - rang.get(b.id))
    );

    function etiquette(unite) {
      return indexNoeuds.get(unite.membres[0])?.label || unite.id;
    }

    // --- 7. réduction des croisements (heuristique de la médiane) --------
    const position = new Map();
    const majPositions = () =>
      couches.forEach((couche) =>
        couche.forEach((unite, index) => position.set(unite.id, index))
      );
    majPositions();

    for (let passe = 0; passe < 8; passe += 1) {
      const versLeBas = passe % 2 === 0;
      const indices = versLeBas
        ? couches.map((_, i) => i)
        : couches.map((_, i) => couches.length - 1 - i);
      indices.forEach((g) => {
        const couche = couches[g];
        const cles = new Map();
        couche.forEach((unite, index) => {
          const liees = [
            ...(versLeBas ? parentsUnite.get(unite.id) : enfantsUnite.get(unite.id)),
          ]
            .map((autre) => position.get(autre.id))
            .filter((v) => v !== undefined)
            .sort((a, b) => a - b);
          cles.set(unite.id, liees.length ? mediane(liees) : index);
        });
        couche.sort(
          (a, b) => cles.get(a.id) - cles.get(b.id) || rang.get(a.id) - rang.get(b.id)
        );
        majPositions();
      });
    }

    // --- 8. abscisses ----------------------------------------------------
    couches.forEach((couche) => {
      let curseur = 0;
      couche.forEach((unite) => {
        unite.x = curseur;
        curseur += unite.largeur + GEO.espaceUnite;
      });
    });

    const centre = (unite) => unite.x + unite.largeur / 2;
    for (let passe = 0; passe < 16; passe += 1) {
      const versLeBas = passe % 2 === 0;
      const indices = versLeBas
        ? couches.map((_, i) => i)
        : couches.map((_, i) => couches.length - 1 - i);
      indices.forEach((g) => {
        const couche = couches[g];
        couche.forEach((unite) => {
          const liees = [
            ...(versLeBas ? parentsUnite.get(unite.id) : enfantsUnite.get(unite.id)),
          ];
          if (!liees.length) return;
          const cible = moyenne(liees.map(centre));
          unite.x += (cible - centre(unite)) * 0.6;
        });
        tasser(couche);
      });
    }

    // --- 9. ordonnées ----------------------------------------------------
    const hauteurBande = couches.map((couche) =>
      couche.length ? Math.max(...couche.map((unite) => unite.hauteur)) : 0
    );
    const bandeY = [];
    let curseurY = 0;
    hauteurBande.forEach((hauteur, g) => {
      bandeY[g] = curseurY;
      curseurY += hauteur + GEO.espaceBande;
    });

    const boites = new Map();
    couches.forEach((couche, g) => {
      couche.forEach((unite) => {
        let x = unite.x;
        unite.membres.forEach((id) => {
          const { l, h } = taille(id);
          boites.set(id, { x, y: bandeY[g], l, h, gen: g });
          x += l + GEO.espaceCouple;
        });
      });
    });

    // --- 9bis. repli en tranches ------------------------------------------
    curseurY = replierEnTranches(boites, curseurY, familles, unions);

    // --- 10. satellites ---------------------------------------------------
    const etendue = etendueDe(boites);
    const centreMonde = (etendue.x0 + etendue.x1) / 2;
    const compteurAncre = new Map();

    satellites
      .map((id) => ({ id, lien: meilleurLien(id, sociaux, boites) }))
      .sort((a, b) => (a.lien ? 0 : 1) - (b.lien ? 0 : 1))
      .forEach(({ id, lien }) => {
        const { l, h } = taille(id);
        if (!lien) {
          // Personne isolée : rangée du bas.
          const rang = compteurAncre.get('__isole') || 0;
          compteurAncre.set('__isole', rang + 1);
          boites.set(id, {
            x: etendue.x0 + rang * (l + 24),
            y: curseurY + 40,
            l,
            h,
            satellite: true,
          });
          return;
        }
        const ancre = boites.get(lien.ancre);
        const gauche = ancre.x + ancre.l / 2 < centreMonde;
        const place = placerSatellite(ancre, l, h, gauche, boites);
        boites.set(id, { ...place, l, h, satellite: true, ancre: lien.ancre });
      });

    // --- 11. positions posées à la main (lot 22.D) -------------------------
    //
    // Une `position` **remplace** ce que le calcul avait trouvé ; un `decalage`
    // s'y ajoute encore, mais seulement pour les mondes d'avant le lot 22 :
    // `figerLaMiseEnPage()` les convertit en positions au premier passage, et
    // ils ne repassent jamais par ici.
    const places = new Set();
    let ancrage = false;
    boites.forEach((boite, id) => {
      const noeud = indexNoeuds.get(id);
      if (noeud?.position) {
        boite.x = noeud.position[0];
        boite.y = noeud.position[1];
        places.add(id);
        ancrage = true;
        return;
      }
      if (!noeud?.decalage) return;
      boite.x += noeud.decalage[0];
      boite.y += noeud.decalage[1];
      places.add(id);
    });

    // --- 11bis. anti-chevauchement ----------------------------------------
    separerCartes(boites, places);

    // --- 12. normalisation ------------------------------------------------
    //
    // Dès qu'une fiche porte une coordonnée absolue, le plan a une origine, et
    // la recaler ferait mentir toutes les positions enregistrées : la fiche
    // qu'on a posée à (400, 200) s'y retrouverait à chaque ouverture, mais
    // ailleurs à l'écran. On ne translate donc que tant que rien n'est ancré.
    const finale = etendueDe(boites);
    const decalageX = ancrage ? 0 : GEO.marge - finale.x0;
    const decalageY = ancrage ? 0 : GEO.marge - finale.y0;
    boites.forEach((boite) => {
      boite.x += decalageX;
      boite.y += decalageY;
    });

    return {
      boites,
      familles: [...familles.values()],
      fratries: fratriesAdjacentes,
      unions: unions.filter((union) => {
        // Les couples avec enfants sont déjà dessinés par le connecteur famille.
        return ![...familles.values()].some(
          (famille) =>
            famille.parents.includes(union.source) &&
            famille.parents.includes(union.cible)
        );
      }),
      sociaux: [...sociaux, ...fratriesEloignees].filter(lienVisible),
      // Ancré, le monde part de zéro et non du coin de la boîte englobante :
      // c'est la même origine que les positions enregistrées.
      largeur: ancrage ? finale.x1 + GEO.marge : finale.x1 - finale.x0 + GEO.marge * 2,
      hauteur: ancrage ? finale.y1 + GEO.marge : finale.y1 - finale.y0 + GEO.marge * 2,
    };
  }

  function ordonnerMembres(membres, voisinsUnion) {
    if (membres.length < 3) return membres;
    const restants = new Set(membres);
    const depart =
      membres.find((id) => (voisinsUnion.get(id) || []).length === 1) || membres[0];
    const ordre = [];
    const pile = [depart];
    while (pile.length) {
      const courant = pile.pop();
      if (!restants.has(courant)) continue;
      restants.delete(courant);
      ordre.push(courant);
      (voisinsUnion.get(courant) || []).forEach((voisin) => {
        if (restants.has(voisin)) pile.push(voisin);
      });
    }
    return [...ordre, ...restants];
  }

  const typeVisible = (type) => !options.typesMasques?.has(type);

  /**
   * Un lien révolu reste dans la charpente — un mariage rompu a quand même
   * placé les enfants — mais on peut cesser de le dessiner. C'est le seul
   * filtre qui porte sur le lien lui-même et non sur son type.
   */
  const lienVisible = (arete) =>
    typeVisible(arete.type) && !(options.masquerRevolus && arete.revolu);

  /**
   * Replie le ruban généalogique en tranches empilées.
   *
   * Une génération peuplée produit une bande de plusieurs milliers de pixels :
   * illisible sur un écran 16/9, où l'on passe son temps à faire défiler. On
   * coupe donc le plan dans des **couloirs verticaux libres** — jamais au
   * milieu d'une fiche, et de préférence là où le moins de liens du sang
   * passent — puis on empile les morceaux. Chaque tranche garde ses bandes de
   * génération alignées ; seuls les liens d'une tranche à l'autre s'allongent.
   */
  function replierEnTranches(boites, hauteurRuban, familles, unions) {
    const membres = [...boites.values()];
    if (membres.length < 3) return hauteurRuban;

    const x0 = Math.min(...membres.map((b) => b.x));
    const x1 = Math.max(...membres.map((b) => b.x + b.l));
    const longueur = x1 - x0;
    const pas = hauteurRuban + GEO.espaceTranche;
    // On vise la forme d'un plan de travail sur écran PC, jamais moins large
    // que 3/2 : c'est ce qui met le plus de fiches lisibles à l'écran.
    const forme = Math.min(2.4, Math.max(1.5, largeurPlan() / hauteurPlan()));
    let voulu = 1;
    let meilleure = Infinity;
    for (let n = 1; n <= 8; n += 1) {
      const obtenu = longueur / n / (hauteurRuban + (n - 1) * pas);
      const ecart = Math.abs(Math.log(obtenu / forme));
      if (ecart < meilleure) {
        meilleure = ecart;
        voulu = n;
      }
    }
    if (voulu < 2) return hauteurRuban;
    const cible = longueur / voulu;

    // couloirs : abscisses qu'aucune fiche ne traverse
    const intervalles = membres
      .map((b) => [b.x, b.x + b.l])
      .sort((a, b) => a[0] - b[0]);
    const couloirs = [];
    let bord = intervalles[0][1];
    intervalles.forEach(([debut, fin]) => {
      if (debut > bord + 2) couloirs.push((bord + debut) / 2);
      bord = Math.max(bord, fin);
    });
    if (!couloirs.length) return hauteurRuban;

    // portée horizontale des liens du sang : les couper coûte cher
    const portees = [];
    familles.forEach((famille) => {
      const abscisses = [...famille.parents, ...famille.enfants]
        .map((id) => boites.get(id))
        .filter(Boolean)
        .map((b) => b.x + b.l / 2);
      if (abscisses.length > 1) {
        portees.push([Math.min(...abscisses), Math.max(...abscisses)]);
      }
    });
    unions.forEach((union) => {
      const a = boites.get(union.source);
      const b = boites.get(union.cible);
      if (!a || !b) return;
      const ca = a.x + a.l / 2;
      const cb = b.x + b.l / 2;
      portees.push([Math.min(ca, cb), Math.max(ca, cb)]);
    });
    const cout = (x) => portees.filter(([a, b]) => a < x && x < b).length;

    const coupes = [];
    let depart = x0;
    for (let k = 1; k < voulu; k += 1) {
      const vise = x0 + cible * k;
      const possibles = couloirs.filter((x) => x > depart + cible * 0.4);
      if (!possibles.length) break;
      const meilleur = possibles.reduce(
        (retenu, x) => {
          const note = cout(x) * 500 + Math.abs(x - vise);
          return note < retenu.note ? { x, note } : retenu;
        },
        { x: null, note: Infinity }
      );
      if (meilleur.x === null) break;
      coupes.push(meilleur.x);
      depart = meilleur.x;
    }
    if (!coupes.length) return hauteurRuban;

    const bornes = [-Infinity, ...coupes, Infinity];
    const origines = [];
    boites.forEach((boite) => {
      const centre = boite.x + boite.l / 2;
      let tranche = 0;
      while (tranche < bornes.length - 2 && centre >= bornes[tranche + 1]) tranche += 1;
      boite.tranche = tranche;
      origines[tranche] = Math.min(origines[tranche] ?? Infinity, boite.x);
    });
    boites.forEach((boite) => {
      boite.x -= origines[boite.tranche] - x0;
      boite.y += boite.tranche * pas;
      delete boite.tranche;
    });
    return hauteurRuban + coupes.length * pas;
  }

  /**
   * Repousse les fiches qui se chevauchent, selon l'axe où elles se mordent le
   * moins (les rangées restent donc des rangées). Une fiche posée à la main
   * ne bouge pas : sa position est un choix explicite, ce sont les autres qui
   * s'écartent.
   */
  function separerCartes(boites, placees, passes = 10) {
    const liste = [...boites.entries()];
    const marge = GEO.margeSeparation;
    for (let passe = 0; passe < passes; passe += 1) {
      let bouge = false;
      for (let i = 0; i < liste.length; i += 1) {
        for (let j = i + 1; j < liste.length; j += 1) {
          const [idA, a] = liste[i];
          const [idB, b] = liste[j];
          const ecartX = a.x + a.l / 2 - (b.x + b.l / 2);
          const ecartY = a.y + a.h / 2 - (b.y + b.h / 2);
          const mordX = (a.l + b.l) / 2 + marge - Math.abs(ecartX);
          const mordY = (a.h + b.h) / 2 + marge - Math.abs(ecartY);
          if (mordX <= 0 || mordY <= 0) continue;
          const fixeA = placees.has(idA);
          const fixeB = placees.has(idB);
          if (fixeA && fixeB) continue;
          bouge = true;
          let dx = 0;
          let dy = 0;
          if (mordX < mordY) dx = ((ecartX >= 0 ? 1 : -1) * mordX) / 2;
          else dy = ((ecartY >= 0 ? 1 : -1) * mordY) / 2;
          const partA = fixeB ? 2 : fixeA ? 0 : 1;
          const partB = fixeA ? 2 : fixeB ? 0 : 1;
          a.x += dx * partA;
          a.y += dy * partA;
          b.x -= dx * partB;
          b.y -= dy * partB;
        }
      }
      if (!bouge) break;
    }
  }

  /** Cherche la première place libre en colonnes, de part et d'autre de l'ancre. */
  function placerSatellite(ancre, l, h, gauche, boites) {
    const pas = h + 16;
    for (let colonne = 0; colonne < 8; colonne += 1) {
      const x = gauche
        ? ancre.x - (GEO.espaceSatellite + l) - colonne * (l + 26)
        : ancre.x + ancre.l + GEO.espaceSatellite + colonne * (l + 26);
      for (let ligne = 0; ligne < 14; ligne += 1) {
        const decalage = (ligne % 2 ? 1 : -1) * Math.ceil(ligne / 2) * pas;
        const y = ancre.y + decalage;
        if (!chevauche({ x, y, l, h }, boites)) return { x, y };
      }
    }
    return {
      x: gauche ? ancre.x - l - GEO.espaceSatellite : ancre.x + ancre.l + GEO.espaceSatellite,
      y: ancre.y,
    };
  }

  function meilleurLien(id, sociaux, boites) {
    const candidats = sociaux
      .filter((a) => a.source === id || a.cible === id)
      .map((a) => ({ ancre: a.source === id ? a.cible : a.source, poids: ecartHumeur(a.humeur) }))
      .filter((c) => boites.has(c.ancre))
      .sort((a, b) => b.poids - a.poids);
    return candidats[0] || null;
  }

  function chevauche(boite, boites) {
    const marge = 16;
    for (const autre of boites.values()) {
      if (
        boite.x < autre.x + autre.l + marge &&
        boite.x + boite.l + marge > autre.x &&
        boite.y < autre.y + autre.h + marge &&
        boite.y + boite.h + marge > autre.y
      ) {
        return true;
      }
    }
    return false;
  }

  function etendueDe(boites) {
    if (!boites.size) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    boites.forEach((boite) => {
      x0 = Math.min(x0, boite.x);
      y0 = Math.min(y0, boite.y);
      x1 = Math.max(x1, boite.x + boite.l);
      y1 = Math.max(y1, boite.y + boite.h);
    });
    return { x0, y0, x1, y1 };
  }

  function tasser(couche) {
    couche.sort((a, b) => a.x - b.x);
    for (let i = 1; i < couche.length; i += 1) {
      const precedent = couche[i - 1];
      const minimum = precedent.x + precedent.largeur + GEO.espaceUnite;
      if (couche[i].x < minimum) couche[i].x = minimum;
    }
  }

  const mediane = (liste) =>
    liste.length % 2
      ? liste[(liste.length - 1) / 2]
      : (liste[liste.length / 2 - 1] + liste[liste.length / 2]) / 2;
  const moyenne = (liste) => liste.reduce((s, v) => s + v, 0) / liste.length;

  // =====================================================================
  //  Peinture
  // =====================================================================

  function positionner(animer) {
    coucheCartes.classList.toggle('sans-transition', !animer);
    cartes.forEach((carte, id) => {
      const boite = disposition.boites.get(id);
      if (!boite) {
        carte.classList.add('masquee');
        return;
      }
      carte.classList.remove('masquee');
      carte.style.left = `${boite.x}px`;
      carte.style.top = `${boite.y}px`;
    });
    monde.style.width = `${disposition.largeur}px`;
    monde.style.height = `${disposition.hauteur}px`;
    svg.setAttribute('width', disposition.largeur);
    svg.setAttribute('height', disposition.hauteur);
    svg.setAttribute('viewBox', `0 0 ${disposition.largeur} ${disposition.hauteur}`);
    if (!animer) {
      // force un reflow pour que la classe soit prise en compte immédiatement
      void coucheCartes.offsetWidth;
      coucheCartes.classList.remove('sans-transition');
    }
  }

  function tracerLiens() {
    const { boites } = disposition;
    const morceaux = [];
    // Tracés invisibles et épais, empilés au-dessus du dessin : ce sont eux qui
    // reçoivent le survol et le clic, un connecteur fin étant impossible à viser.
    const prises = [];
    const prise = (arete, chemin) =>
      prises.push(`<path class="lien-prise" data-relation="${arete.id}" d="${chemin}" />`);
    const couleurFiliation = couleurType('parent', '#8a94a0');
    const couleurUnion = couleurType('conjoint', '#b9836f');
    // Les couleurs qui auront besoin d'une pointe de flèche. Déclaré ici et non
    // près des liens sociaux : depuis le lot 21.B, la descendance en pose une
    // aussi, et elle se dessine bien avant eux.
    const couleursFleches = new Set();
    const filiationDirigee = typeDirige('parent');
    if (filiationDirigee) couleursFleches.add(couleurFiliation);

    // Pastilles : dessinées après les traits pour passer par-dessus, mais avant
    // les prises, qui doivent rester le dernier mot pour le survol et le clic.
    const pastilles = [];

    /**
     * Pose l'emoji d'un lien près de chacune de ses deux extrémités, et une
     * troisième fois au milieu quand le trait est long.
     *
     * Aux extrémités parce que c'est là qu'on regarde : en partant d'une fiche,
     * on veut savoir ce que ce trait-là raconte sans le suivre des yeux. Au
     * milieu en plus dès que les fiches s'écartent, sinon les deux pastilles
     * sortent du champ de vision en même temps que les fiches.
     */
    const poserPastilles = (arete, debut, fin, milieu, longueur, attenue, ecart = null) => {
      if (!arete.emoji) return;
      const candidats = [debut, fin];
      if (longueur > GEO.pastilleMilieu && milieu) candidats.push(milieu);

      // Deux fiches côte à côte — un couple, une fratrie serrée — ramènent les
      // deux extrémités au même endroit. Empiler deux fois le même emoji ne
      // dit rien de plus et l'assombrit : on n'en garde qu'un.
      const points = [];
      for (const brut of candidats) {
        if (!Number.isFinite(brut.x) || !Number.isFinite(brut.y)) continue;
        // Deux personnes peuvent être liées deux fois — alliées *et* trahies.
        // Les traits se confondent ; les pastilles, elles, doivent rester
        // lisibles, d'où l'écart perpendiculaire par rang de parallèle.
        const point = ecart ? { x: brut.x + ecart.x, y: brut.y + ecart.y } : brut;
        const colle = points.some(
          (deja) => Math.hypot(deja.x - point.x, deja.y - point.y) < GEO.retraitPastille
        );
        if (!colle) points.push(point);
      }

      const classes = `lien-pastille${attenue ? ' attenue' : ''}${
        arete.revolu ? ' revolu' : ''
      }`;
      const texte = echapper(arete.emoji);
      points.forEach((point) => {
        pastilles.push(
          `<circle class="lien-pastille-fond${attenue ? ' attenue' : ''}"
                   cx="${point.x}" cy="${point.y}" r="9" />` +
            `<text class="${classes}" x="${point.x}" y="${point.y}"
                   text-anchor="middle" dominant-baseline="central">${texte}</text>`
        );
      });
    };

    /**
     * Écart perpendiculaire d'un lien parmi ses parallèles.
     *
     * Le serveur numérote les liens qui relient la même paire
     * (`parallele_rang` / `parallele_total`). Les traits, eux, se superposent —
     * c'est ainsi depuis toujours et ça se lit très bien. Les pastilles, non :
     * trois emojis au même pixel n'en montrent qu'un. On les range donc de part
     * et d'autre du trait, centrés sur lui.
     */
    const ecartParallele = (arete, depart, arrivee) => {
      const total = arete.parallele_total || 1;
      if (total < 2) return null;
      const rang = arete.parallele_rang || 0;
      const pas = (rang - (total - 1) / 2) * 16;
      const dx = arrivee.x - depart.x;
      const dy = arrivee.y - depart.y;
      const longueur = Math.hypot(dx, dy) || 1;
      // Normale unitaire au segment.
      return { x: (-dy / longueur) * pas, y: (dx / longueur) * pas };
    };

    /** Retrait le long d'un segment : la pastille se pose près du bout, pas dessus. */
    const versLInterieur = (de, vers, distance) => {
      const dx = vers.x - de.x;
      const dy = vers.y - de.y;
      const longueur = Math.hypot(dx, dy) || 1;
      const pas = Math.min(distance, longueur / 3);
      return { x: de.x + (dx / longueur) * pas, y: de.y + (dy / longueur) * pas };
    };

    // --- descendance ------------------------------------------------------
    disposition.familles.forEach((famille) => {
      if (!typeVisible('parent')) return;
      const parents = famille.parents.map((id) => boites.get(id)).filter(Boolean);
      const enfants = famille.enfants.map((id) => boites.get(id)).filter(Boolean);
      if (!parents.length || !enfants.length) return;

      const basParents = Math.max(...parents.map((b) => b.y + b.h));
      const hautEnfants = Math.min(...enfants.map((b) => b.y));
      let barreParents = basParents + GEO.deportBarre;
      let barreEnfants = hautEnfants - GEO.deportBarre;
      if (barreEnfants <= barreParents) {
        barreParents = basParents + Math.max(8, (hautEnfants - basParents) / 3);
        barreEnfants = hautEnfants - Math.max(8, (hautEnfants - basParents) / 3);
      }

      const centresParents = parents.map((b) => b.x + b.l / 2).sort((a, b) => a - b);
      const centresEnfants = enfants.map((b) => b.x + b.l / 2).sort((a, b) => a - b);
      const tige = moyenne([
        centresParents[0],
        centresParents[centresParents.length - 1],
      ]);

      /* La barre des enfants doit passer **sous la tige** (lot 23.G).
       *
       * Elle ne courait qu'entre le premier et le dernier enfant, et seulement
       * s'il y en avait plusieurs. Tant que la mise en page posait les enfants
       * sous leurs parents, la tige tombait dedans et personne ne voyait le
       * problème. Depuis que les fiches ont une position à elles (lot 22.D),
       * elles vont où on les met : la tige descendait alors à mille pixels de
       * la barre, et le connecteur s'arrêtait net dans le vide — mesuré à
       * quatre familles sur quinze rien que sur la démonstration.
       *
       * On étend donc la barre jusqu'à la tige. Un enfant unique posé de
       * travers gagne au passage son coude, là où il n'avait aucun trait.
       */
      const gaucheEnfants = Math.min(tige, centresEnfants[0]);
      const droiteEnfants = Math.max(tige, centresEnfants[centresEnfants.length - 1]);
      const barreDesEnfants =
        droiteEnfants - gaucheEnfants > 0.5
          ? `M${gaucheEnfants},${barreEnfants}H${droiteEnfants}`
          : '';

      const chemin = [];
      parents.forEach((boite) => {
        chemin.push(`M${boite.x + boite.l / 2},${boite.y + boite.h}V${barreParents}`);
      });
      if (parents.length > 1) {
        chemin.push(
          `M${centresParents[0]},${barreParents}H${centresParents[centresParents.length - 1]}`
        );
      }
      chemin.push(`M${tige},${barreParents}V${barreEnfants}`);
      if (barreDesEnfants) chemin.push(barreDesEnfants);
      morceaux.push(
        `<path class="lien-famille" d="${chemin.join(' ')}" stroke="${couleurFiliation}" />`
      );

      // Les pattes qui descendent vers les enfants sont tracées **une par une**,
      // et non ajoutées au tronc : c'est là que se pose la flèche, et un
      // `marker-end` sur un chemin à plusieurs `M` ne marquerait que son tout
      // dernier point — un seul enfant fléché sur toute une fratrie.
      const pointe = filiationDirigee
        ? ` marker-end="url(#fl-${couleurFiliation.replace('#', '')})"`
        : '';
      enfants.forEach((boite) => {
        morceaux.push(
          `<path class="lien-famille" d="M${boite.x + boite.l / 2},${barreEnfants}V${boite.y}"
                 stroke="${couleurFiliation}"${pointe} />`
        );
      });

      // Le tronc (barres + tige) appartient à toute la fratrie : impossible d'y
      // lire une filiation précise, il porte donc la liste complète.
      const liens = famille.liens || [];
      if (liens.length) {
        const tronc = [];
        if (parents.length > 1) {
          tronc.push(
            `M${centresParents[0]},${barreParents}H${centresParents[centresParents.length - 1]}`
          );
        }
        tronc.push(`M${tige},${barreParents}V${barreEnfants}`);
        // La même barre que ce qui est dessiné : une prise de clic qui ne suit
        // pas le trait laisse un connecteur visible et pourtant insaisissable.
        if (barreDesEnfants) tronc.push(barreDesEnfants);
        prises.push(
          `<path class="lien-prise" data-relations="${liens.map((a) => a.id).join(',')}"
                 d="${tronc.join(' ')}" />`
        );
      }

      // Les pattes, elles, désignent quelqu'un : celle du parent ne concerne
      // que ses enfants, celle de l'enfant que ses deux parents.
      liens.forEach((arete) => {
        const parent = boites.get(arete.source);
        const enfant = boites.get(arete.cible);
        if (!parent || !enfant) return;
        prise(
          arete,
          `M${parent.x + parent.l / 2},${parent.y + parent.h}V${barreParents} ` +
            `M${enfant.x + enfant.l / 2},${barreEnfants}V${enfant.y}`
        );
        // Une filiation se dessine en tronc partagé : la seule géométrie qui
        // appartienne vraiment à ce lien-là, ce sont ses deux pattes.
        poserPastilles(
          arete,
          { x: parent.x + parent.l / 2, y: (parent.y + parent.h + barreParents) / 2 },
          { x: enfant.x + enfant.l / 2, y: (barreEnfants + enfant.y) / 2 },
          null,
          0,
          false
        );
      });
    });

    // --- fratries sans parents connus (accolade au-dessus) ---------------
    const couleurFratrie = couleurType('fratrie', '#a3b18a');
    (disposition.fratries || []).forEach((arete) => {
      if (!lienVisible(arete)) return;
      const a = boites.get(arete.source);
      const b = boites.get(arete.cible);
      if (!a || !b) return;
      const barre = Math.min(a.y, b.y) - 12;
      const ca = a.x + a.l / 2;
      const cb = b.x + b.l / 2;
      const chemin = `M${ca},${a.y}V${barre}H${cb}V${b.y}`;
      morceaux.push(
        `<path class="lien-fratrie" d="${chemin}" stroke="${couleurFratrie}" />`
      );
      poserPastilles(
        arete,
        { x: ca, y: (a.y + barre) / 2 },
        { x: cb, y: (b.y + barre) / 2 },
        { x: (ca + cb) / 2, y: barre },
        Math.abs(cb - ca),
        false
      );
      prise(arete, chemin);
    });

    // --- unions sans descendance -----------------------------------------
    disposition.unions.forEach((union) => {
      if (!lienVisible(union)) return;
      const a = boites.get(union.source);
      const b = boites.get(union.cible);
      if (!a || !b) return;
      const [gauche, droite] = a.x <= b.x ? [a, b] : [b, a];
      const y1 = gauche.y + Math.min(gauche.h, 64) / 2 + 18;
      const y2 = droite.y + Math.min(droite.h, 64) / 2 + 18;
      const xm = (gauche.x + gauche.l + droite.x) / 2;
      const chemin = `M${gauche.x + gauche.l},${y1}H${xm}V${y2}H${droite.x}`;
      morceaux.push(`<path class="lien-union" d="${chemin}" stroke="${couleurUnion}" />`);
      poserPastilles(
        union,
        { x: Math.min(gauche.x + gauche.l + GEO.retraitPastille, xm), y: y1 },
        { x: Math.max(droite.x - GEO.retraitPastille, xm), y: y2 },
        { x: xm, y: (y1 + y2) / 2 },
        droite.x - (gauche.x + gauche.l),
        false
      );
      prise(union, chemin);
    });

    // --- liens sociaux ----------------------------------------------------
    disposition.sociaux.forEach((arete) => {
      const a = boites.get(arete.source);
      const b = boites.get(arete.cible);
      if (!a || !b) return;
      const depart = bordure(a, b);
      const arrivee = bordure(b, a);
      const attenue =
        focusId && !(ensembleFocus?.has(arete.source) && ensembleFocus?.has(arete.cible));
      if (arete.dirige) couleursFleches.add(arete.couleur);
      const chemin = `M${depart.x},${depart.y}L${arrivee.x},${arrivee.y}`;
      morceaux.push(
        `<path class="lien-social${attenue ? ' attenue' : ''}${arete.revolu ? ' revolu' : ''}"
               data-lien="${arete.id}"
               d="${chemin}"
               stroke="${arete.couleur}"
               stroke-dasharray="${arete.revolu ? '1 6' : arete.style === 'pointille' ? '2 5' : '7 5'}"
               ${arete.dirige && !arete.revolu ? `marker-end="url(#fl-${arete.couleur.replace('#', '')})"` : ''} />`
      );
      poserPastilles(
        arete,
        versLInterieur(depart, arrivee, GEO.retraitPastille),
        versLInterieur(arrivee, depart, GEO.retraitPastille),
        { x: (depart.x + arrivee.x) / 2, y: (depart.y + arrivee.y) / 2 },
        Math.hypot(arrivee.x - depart.x, arrivee.y - depart.y),
        attenue,
        ecartParallele(arete, depart, arrivee)
      );
      prise(arete, chemin);
    });

    defs.innerHTML = [...couleursFleches]
      .map(
        (couleur) => `
      <marker id="fl-${couleur.replace('#', '')}" viewBox="0 -5 10 10" refX="9" refY="0"
              markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,-4L9,0L0,4Z" fill="${couleur}"></path>
      </marker>`
      )
      .join('');

    coucheLiens.innerHTML = [...morceaux, ...pastilles, ...prises].join('');

    coucheLiens.querySelectorAll('.lien-prise[data-relation]').forEach((element) => {
      const id = element.dataset.relation;
      const arete = areteParId(id);
      const dessin = coucheLiens.querySelector(`[data-lien="${CSS.escape(id)}"]`);
      element.addEventListener('mouseenter', (evenement) => {
        dessin?.classList.add('survol');
        contexte.surSurvolLien?.(arete, evenement);
      });
      element.addEventListener('mousemove', (evenement) =>
        contexte.surSurvolLien?.(arete, evenement)
      );
      element.addEventListener('mouseleave', () => {
        dessin?.classList.remove('survol');
        contexte.surFinSurvol?.();
      });
    });
  }

  function couleurType(type, defaut) {
    const entree = (payload?.legende?.types || []).find((t) => t.id === type);
    return entree ? entree.couleur : defaut;
  }

  /**
   * Ce type est-il orienté ? La légende porte le drapeau du référentiel, donc
   * décocher « Lien orienté » sur la filiation retire ses flèches — comme sur
   * n'importe quel autre type, et sans rien de câblé ici.
   */
  function typeDirige(type) {
    return Boolean((payload?.legende?.types || []).find((t) => t.id === type)?.dirige);
  }

  /** Point de sortie du segment a→b sur la bordure de la boîte a. */
  function bordure(a, b) {
    const cxa = a.x + a.l / 2;
    const cya = a.y + a.h / 2;
    const cxb = b.x + b.l / 2;
    const cyb = b.y + b.h / 2;
    const dx = cxb - cxa;
    const dy = cyb - cya;
    if (!dx && !dy) return { x: cxa, y: cya };
    const echelleX = dx ? a.l / 2 / Math.abs(dx) : Infinity;
    const echelleY = dy ? a.h / 2 / Math.abs(dy) : Infinity;
    const echelle = Math.min(echelleX, echelleY);
    return { x: cxa + dx * echelle, y: cya + dy * echelle };
  }

  // =====================================================================
  //  Cycle de vie
  // =====================================================================

  function idsAffiches() {
    // Le filtre du rail est calcule en amont : l'orchestrateur sait quel
    // critere est actif (maison, generation, statut, humeur...), le moteur ne
    // recoit qu'une liste d'ids a cacher. Il n'a pas a connaitre le domaine.
    const noeudsMasques = options.noeudsMasques || new Set();
    const maisonsMasquees = options.maisonsMasquees || new Set();
    const base = (payload.noeuds || [])
      .filter((noeud) => !noeudsMasques.has(noeud.id) && !maisonsMasquees.has(noeud.maison))
      .map((noeud) => noeud.id);
    if (!focusId) return base;
    const ensemble = new Set([focusId, ...epingles]);
    aretesStructure.forEach((arete) => {
      if (arete.source === focusId) ensemble.add(arete.cible);
      if (arete.cible === focusId) ensemble.add(arete.source);
    });
    return base.filter((id) => ensemble.has(id));
  }

  function appliquer({ animer = true, cadrer = false } = {}) {
    const typesMasques = options.typesMasques || new Set();
    aretesStructure = payload.aretes || [];
    aretesVisibles = aretesStructure.filter(lienVisible);
    filtreLiens = typesMasques.size > 0;
    plan.classList.toggle('filtre-liens', filtreLiens);

    const ids = idsAffiches();
    ensembleFocus = focusId ? new Set(ids) : null;

    // les cartes portent leurs relations : on les régénère avant de mesurer
    const ensemble = new Set(ids);
    (payload.noeuds || []).forEach((noeud) => {
      noeud.satellite = false;
    });
    marquerSatellites(ensemble);

    // Filtre par type de lien : seules les personnes qui portent un des liens
    // retenus restent nettes, les autres s'effacent sans changer de place.
    const concernes = new Set();
    if (filtreLiens) {
      aretesVisibles.forEach((arete) => {
        if (!ensemble.has(arete.source) || !ensemble.has(arete.cible)) return;
        concernes.add(arete.source);
        concernes.add(arete.cible);
      });
    }

    cartes.forEach((carte, id) => {
      const noeud = indexNoeuds.get(id);
      if (noeud && ensemble.has(id)) remplirCarte(carte, noeud);
      carte.classList.toggle('masquee', !ensemble.has(id));
      carte.classList.toggle('focus', id === focusId);
      carte.classList.toggle('hors-filtre', filtreLiens && !concernes.has(id));
      carte.classList.toggle(
        'voisine',
        !!focusId && id !== focusId && ensemble.has(id)
      );
    });

    // Les formes ne dépendent d'aucun filtre, mais elles dépendent de la vue :
    // celles d'un profil ne paraissent qu'en centrant sur lui (lot 22.C).
    formes.definirVue(focusId);

    mesurer();
    disposition = calculerMiseEnPage(ids);
    positionner(animer);
    tracerLiens();
    if (cadrer) {
      cadrerSur(
        ids,
        animer,
        focusId ? { echelleMin: GEO.echelleFocusMin, centreSur: focusId } : {}
      );
    }
    contexte.surDisposition?.({
      personnes: ids.length,
      liens: disposition.sociaux.length + disposition.familles.length,
    });
  }

  /** Une personne sans lien du sang visible est dessinée en satellite. */
  function marquerSatellites(ensemble) {
    const familial = new Set();
    (payload.aretes || []).forEach((arete) => {
      if (!ensemble.has(arete.source) || !ensemble.has(arete.cible)) return;
      if (estLienFamilial(arete)) {
        familial.add(arete.source);
        familial.add(arete.cible);
      }
    });
    (payload.noeuds || []).forEach((noeud) => {
      noeud.satellite = ensemble.has(noeud.id) && !familial.has(noeud.id);
    });
  }

  function estLienFamilial(arete) {
    return (
      arete.role === 'filiation' ||
      arete.role === 'union' ||
      (arete.role === 'fratrie' && !arete.deduit)
    );
  }

  function cadrerSur(ids, animer = true, { echelleMin = 0, centreSur = null } = {}) {
    if (!disposition) return;
    const boites = ids
      .map((id) => disposition.boites.get(id))
      .filter(Boolean);
    if (!boites.length) return;
    const marge = 50;
    const x0 = Math.min(...boites.map((b) => b.x)) - marge;
    const y0 = Math.min(...boites.map((b) => b.y)) - marge;
    const x1 = Math.max(...boites.map((b) => b.x + b.l)) + marge;
    const y1 = Math.max(...boites.map((b) => b.y + b.h)) + marge;
    const ajustee = Math.min(largeurPlan() / (x1 - x0), hauteurPlan() / (y1 - y0));
    const echelle = Math.min(1.15, Math.max(0.06, ajustee, echelleMin));

    // Si tout ne tient pas à une taille lisible, on centre sur la personne
    // plutôt que sur l'ensemble : mieux vaut naviguer que plisser les yeux.
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    const ancre = centreSur && ajustee < echelleMin ? disposition.boites.get(centreSur) : null;
    if (ancre) {
      cx = ancre.x + ancre.l / 2;
      cy = ancre.y + ancre.h / 2;
    }

    const cible = d3.zoomIdentity
      .translate(largeurPlan() / 2, hauteurPlan() / 2)
      .scale(echelle)
      .translate(-cx, -cy);
    const selection = d3.select(plan);
    // En onglet masqué, requestAnimationFrame est suspendu : une transition
    // ne s'appliquerait jamais. On saute droit à la position finale.
    if (animer && !document.hidden) {
      selection.transition().duration(680).ease(d3.easeCubicInOut).call(zoom.transform, cible);
    } else {
      selection.call(zoom.transform, cible);
    }
  }

  const surRedimensionnement = () => {
    if (disposition && !focusId) cadrerSur([...disposition.boites.keys()], false);
  };
  window.addEventListener('resize', surRedimensionnement);

  return {
    rendre(nouveauPayload, nouvellesOptions = {}) {
      payload = nouveauPayload;
      options = { ...options, ...nouvellesOptions };
      indexNoeuds = new Map((payload.noeuds || []).map((noeud) => [noeud.id, noeud]));
      aretesVisibles = payload.aretes || [];
      // Les formes ne dépendent d'aucun filtre : elles viennent avec le payload
      // et se redessinent telles quelles, y compris quand le plan se resserre
      // sur une maison. Un rectangle tracé autour du Nord doit rester là.
      formes.definir(payload.formes);
      construireCartes();
      appliquer({ animer: !premierRendu, cadrer: premierRendu });
      premierRendu = false;
    },

    majOptions(nouvellesOptions) {
      const avant = options.couleurPar;
      options = { ...options, ...nouvellesOptions };
      if (nouvellesOptions.recherche !== undefined) {
        const requete = (nouvellesOptions.recherche || '').trim().toLowerCase();
        cartes.forEach((carte, id) => {
          const noeud = indexNoeuds.get(id);
          const correspond =
            !requete ||
            [noeud.label, noeud.surnom, noeud.maison_label, (noeud.tags || []).join(' ')]
              .join(' ')
              .toLowerCase()
              .includes(requete);
          carte.classList.toggle('hors-recherche', !correspond);
        });
      }
      if (
        nouvellesOptions.typesMasques ||
        nouvellesOptions.maisonsMasquees ||
        nouvellesOptions.noeudsMasques ||
        nouvellesOptions.masquerRevolus !== undefined ||
        (nouvellesOptions.couleurPar && nouvellesOptions.couleurPar !== avant)
      ) {
        if (payload) appliquer({ animer: true });
      }
    },

    focus(id, { animer = true } = {}) {
      focusId = id || null;
      appliquer({ animer, cadrer: true });
    },

    /**
     * Repeint les fiches sans toucher à la mise en page : ce qui a changé,
     * c'est la donnée derrière la couleur (une humeur notée depuis la liste),
     * pas la structure du plan. Refaire toute la mise en page ferait sauter
     * les cartes sous le curseur pour rien.
     */
    recolorer() {
      cartes.forEach((carte, id) => {
        const noeud = indexNoeuds.get(id);
        if (noeud) carte.style.setProperty('--couleur-carte', couleurCarte(noeud));
      });
    },

    /** Fiche « armée » comme départ d'un lien (Maj + clic). */
    marquerEnAttente(id) {
      cartes.forEach((carte, cle) => carte.classList.toggle('en-attente', cle === id));
    },

    /**
     * Garde une fiche visible même si le focus l'exclut. Sert au profil qu'on
     * vient de créer : on reste sur la vue en cours, et il y apparaît.
     */
    epingler(id) {
      if (id === null) {
        if (!epingles.size) return;
        epingles.clear();
      } else {
        if (epingles.has(id)) return;
        epingles.add(id);
      }
      if (payload) appliquer({ animer: true });
    },

    recentrer({ animer = true } = {}) {
      focusId = null;
      epingles.clear();
      appliquer({ animer, cadrer: true });
    },

    zoomer(facteur) {
      d3.select(plan).transition().duration(220).call(zoom.scaleBy, facteur);
    },

    definirZoom(k) {
      const t = transformCourante;
      const centreX = largeurPlan() / 2;
      const centreY = hauteurPlan() / 2;
      const monde = [(centreX - t.x) / t.k, (centreY - t.y) / t.k];
      d3.select(plan).call(
        zoom.transform,
        d3.zoomIdentity.translate(centreX, centreY).scale(k).translate(-monde[0], -monde[1])
      );
    },

    positionDe(id) {
      const boite = disposition?.boites.get(id);
      if (!boite) return null;
      const [x, y] = transformCourante.apply([boite.x + boite.l / 2, boite.y]);
      return { x, y };
    },

    /* Les formes de fond (lot 20.D). Le moteur ne fait que passer les
       commandes : c'est `js/formes.js` qui les dessine, et `main.js` qui décide
       ce qu'on en enregistre. */
    formes: {
      basculerMode: (actif) => formes.basculerMode(actif),
      modeActif: () => formes.modeActif(),
      armer: (genre) => formes.armer(genre),
      outilArme: () => formes.outilArme(),
      // Juste après en avoir tracé une : elle s'ouvre, curseur dans le texte.
      ouvrirPour: (id, x, y) => formes.ouvrirPour(id, x, y),
    },

    /* ------------------------------------------------ le plan qu'on fige
     *
     * Lot 22.D. Tant qu'une fiche n'a pas de position à elle, c'est le calcul
     * qui la place — et le calcul change dès qu'on ajoute un lien ou quelqu'un.
     * On le fait donc **une fois**, à la première ouverture, puis plus jamais :
     * à partir de là, seule une main déplace une fiche.
     */
    positionsAFiger() {
      if (!disposition) return null;
      const manquantes = {};
      let combien = 0;
      disposition.boites.forEach((boite, id) => {
        if (indexNoeuds.get(id)?.position) return;
        manquantes[id] = [Math.round(boite.x), Math.round(boite.y)];
        combien += 1;
      });
      return combien ? manquantes : null;
    },

    /** Le serveur a pris les positions : on les inscrit sur les nœuds. */
    confirmerPositions(positions) {
      Object.entries(positions).forEach(([id, position]) => {
        const noeud = indexNoeuds.get(id);
        if (!noeud) return;
        noeud.position = position;
        noeud.decalage = null; // replié dans la position, il a fini son office
      });
    },

    /**
     * Ce que le plan garde en file avant de l'envoyer (lot 26.A).
     *
     * Seul le texte écrit dans une forme est différé ici : une fiche qu'on
     * déplace part au lâcher, un lien à la validation.
     */
    viderEnvois: () => formes.viderEnvois(),

    /** Ce qui est pris en ce moment — pour l'écriteau du plan. */
    selection: () => [...selection],
    /** Et les formes de fond prises avec (lot 26.B) : le copier-coller les lit. */
    selectionFormes: () => formes.prises(),
    viderSelection,

    /** Un événement souris → les coordonnées du plan, pour y poser une fiche. */
    pointDuPlan: (evenement) => pointMonde(evenement),

    /**
     * Le milieu de ce qu'on regarde, en coordonnées du plan.
     *
     * C'est le repli quand personne n'a cliqué nulle part — le bouton « ＋ » de
     * la barre, par exemple. Mieux vaut le centre de l'écran que la rangée du
     * bas, qui peut être à deux mille pixels de là.
     */
    centreVisible() {
      const [x, y] = transformCourante.invert([largeurPlan() / 2, hauteurPlan() / 2]);
      return { x, y };
    },

    detruire() {
      window.removeEventListener('resize', surRedimensionnement);
      plan.remove();
      cartes.clear();
    },
  };
}

enregistrerRendu('cartes', creerRenduCartes);
