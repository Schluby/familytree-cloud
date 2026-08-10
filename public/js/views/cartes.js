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

  // Gabarit invisible portant le contenu maximal d'une fiche. C'est lui qui
  // fixe la hauteur commune : mesurer les vraies fiches ferait dépendre la
  // mise en page de ce qu'elles affichent, et tout bougerait au moindre filtre.
  const gabarit = document.createElement('article');
  gabarit.className = 'carte gabarit';
  gabarit.style.width = `${GEO.largeurCarte}px`;
  gabarit.innerHTML = `
    <div class="carte-photo"><span>AA</span></div>
    <div class="carte-entete"><span class="carte-nom">Nom<br>Nom</span></div>
    <div class="carte-corps">
      <div class="carte-titre">Titre</div>
      <div class="carte-ligne"><span class="ic">✳</span><span class="lib">Naissance</span><span class="val">—</span></div>
      <div class="carte-lieu">Lieu</div>
      <div class="carte-ligne"><span class="ic">†</span><span class="lib">Décès</span><span class="val">—</span></div>
      <div class="carte-separateur"></div>
      <div class="carte-notes">Note<br>Note<br>Note</div>
    </div>`;
  coucheCartes.append(gabarit);

  monde.append(svg, coucheCartes);
  plan.append(monde);
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
    if (sortDAppuiLong()) return;
    const liens = liensSous(evenement);
    if (liens.length) {
      contexte.surClicLien?.(liens, evenement);
      return;
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

  // --------------------------------------------- déplacer une fiche (ctrl)
  let deport = null;
  let finDeplacement = 0;

  function demarrerDeplacement(id, evenement) {
    const boite = disposition?.boites.get(id);
    if (!boite) return;
    const curseur = pointMonde(evenement);
    deport = {
      id,
      boite,
      ecartX: boite.x - curseur.x,
      ecartY: boite.y - curseur.y,
      depart: { x: boite.x, y: boite.y },
    };
    coucheCartes.classList.add('sans-transition');
    cartes.get(id)?.classList.add('en-deport');
    plan.classList.add('en-deport');
    document.addEventListener('mousemove', surDeplacement, true);
    document.addEventListener('mouseup', surFinDeplacement, true);
  }

  function surDeplacement(evenement) {
    if (!deport) return;
    const curseur = pointMonde(evenement);
    deport.boite.x = curseur.x + deport.ecartX;
    deport.boite.y = curseur.y + deport.ecartY;
    const carte = cartes.get(deport.id);
    carte.style.left = `${deport.boite.x}px`;
    carte.style.top = `${deport.boite.y}px`;
    tracerLiens(); // les connecteurs suivent la fiche
  }

  function surFinDeplacement(evenement) {
    if (!deport) return;
    const { id, boite, depart } = deport;
    cartes.get(id)?.classList.remove('en-deport');
    plan.classList.remove('en-deport');
    coucheCartes.classList.remove('sans-transition');
    document.removeEventListener('mousemove', surDeplacement, true);
    document.removeEventListener('mouseup', surFinDeplacement, true);
    deport = null;
    finDeplacement = performance.now();
    evenement.preventDefault();
    evenement.stopPropagation();

    const dx = Math.round(boite.x - depart.x);
    const dy = Math.round(boite.y - depart.y);
    if (!dx && !dy) return; // simple ctrl-clic
    const noeud = indexNoeuds.get(id);
    const ancien = noeud?.decalage || [0, 0];
    const nouveau = [ancien[0] + dx, ancien[1] + dy];
    if (noeud) noeud.decalage = nouveau;
    // Rejoue la mise en page : la fiche lâchée reste où on l'a posée, et ses
    // voisines s'écartent si elle est venue leur marcher dessus.
    appliquer({ animer: true });
    contexte.surDeport?.(id, nouveau);
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
          if (evenement.ctrlKey || evenement.metaKey) return; // c'était un déport
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
    if (noeud.joueur) {
      carte.style.setProperty('--couleur-joueur', noeud.joueur.couleur);
      carte.title = `Joué par ${noeud.joueur.nom}`;
    } else {
      carte.style.removeProperty('--couleur-joueur');
    }
    carte.style.setProperty('--couleur-carte', couleur);
    carte.style.width = `${GEO.largeurCarte}px`;

    // Chef de maison et héritier : ce sont les fiches qu'on cherche des yeux
    // en premier sur un plan chargé. Elles portent un cadre plus appuyé et
    // une marque dans le coin, sans changer de taille — la mise en page ne
    // doit pas dépendre de qui règne.
    const rang = rangDe(noeud.tags);
    carte.classList.toggle('rang', !!rang);
    carte.classList.toggle('rang-chef', rang?.classe === 'chef');
    carte.classList.toggle('rang-heritier', rang?.classe === 'heritier');

    const lignes = [];
    if (noeud.titres?.length) {
      lignes.push(
        `<div class="carte-titre">${echapper(noeud.titres[0])}</div>`
      );
    }
    // L'âge plutôt que l'année de naissance : c'est ce qu'on relit en jeu.
    // L'année reste en infobulle, et pour un mort l'âge est celui qu'il avait.
    const age = ageAffiche(noeud, options.anneeCourante);
    if (age !== null) {
      lignes.push(ligneInfo('✳', 'Âge', formaterAge(age), noeud.lieu, noeud.naissance));
    } else if (noeud.naissance || noeud.lieu) {
      lignes.push(ligneInfo('✳', 'Naissance', noeud.naissance, noeud.lieu));
    }
    if (noeud.statut === 'mort') {
      lignes.push(ligneInfo('†', 'Décès', noeud.deces, ''));
    }

    // Sous le personnage : ses notes. Les liens, eux, se lisent sur les
    // flèches — les répéter ici prenait la place de ce qu'on relit vraiment.
    if (noeud.notes) {
      lignes.push('<div class="carte-separateur"></div>');
      lignes.push(`<div class="carte-notes">${echapper(noeud.notes)}</div>`);
    }

    // `avatar` est une URL servie par l'API, jamais l'image elle-même : le
    // navigateur la met en cache, et le payload de la vue reste léger.
    const portrait = noeud.avatar
      ? `<img src="${echapper(noeud.avatar)}" alt="" draggable="false"
              onerror="this.remove()">`
      : `<span>${echapper(noeud.initiales)}</span>`;

    carte.innerHTML = `
      <div class="carte-photo ${noeud.avatar ? 'avec-photo' : ''}">${portrait}</div>
      ${rang ? `<span class="carte-rang" title="${echapper(rang.label)}">${rang.icone}</span>` : ''}
      <div class="carte-entete">
        <span class="carte-nom">${echapper(noeud.label)}</span>
      </div>
      <div class="carte-corps">${lignes.join('')}</div>
      <button class="carte-poignee" type="button" tabindex="-1"
              title="Glisser vers une autre fiche pour créer un lien">+</button>`;

    carte.querySelector('.carte-poignee').addEventListener('mousedown', (evenement) => {
      if (evenement.button !== 0) return;
      evenement.preventDefault(); // coupe le pan d3 et la sélection de texte
      evenement.stopPropagation();
      demarrerLiaison(noeud.id, evenement);
    });
  }

  function ligneInfo(icone, libelle, valeur, lieu, infobulle = '') {
    if (!valeur && !lieu) return '';
    const titre = infobulle ? ` title="${echapper(`Né en ${infobulle}`)}"` : '';
    return `
      <div class="carte-ligne"${titre}>
        <span class="ic">${icone}</span>
        <span class="lib">${libelle}</span>
        <span class="val">${echapper(valeur || '—')}</span>
      </div>
      ${lieu ? `<div class="carte-lieu">${echapper(lieu)}</div>` : ''}`;
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
   * Toutes les fiches partagent une taille unique : sans ça, une fiche sans
   * date à côté d'une fiche à trois lignes donne des bandes en dents de scie
   * et des trous que la mise en page ne sait pas exploiter.
   */
  function mesurer() {
    const hauteur = Math.max(120, gabarit.offsetHeight);
    cartes.forEach((carte, id) => {
      carte.style.minHeight = `${hauteur}px`;
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
    if (mode === 'categorie') {
      return options.couleursCategories?.[noeud.categorie || ''] || '#8a8f98';
    }
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
      else if (arete.role === 'fratrie' && !arete.deduit) fratriesBrutes.push(arete);
    });

    const parentsDe = new Map();
    filiations.forEach((a) => {
      if (!parentsDe.has(a.cible)) parentsDe.set(a.cible, new Set());
      parentsDe.get(a.cible).add(a.source);
    });

    // Fratrie utile = frère/sœur dont on ne connaît pas le parent commun :
    // sans elle, un oncle sans ascendance connue finirait en satellite.
    const fratries = fratriesBrutes.filter((arete) => {
      const pa = parentsDe.get(arete.source) || new Set();
      const pb = parentsDe.get(arete.cible) || new Set();
      return ![...pa].some((parent) => pb.has(parent));
    });

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
    const fratriesAdjacentes = [];
    [...unions, ...fratries].forEach((a) => {
      if (generations.get(a.source) !== generations.get(a.cible)) return;
      pere.set(racine(a.source), racine(a.cible));
      voisinsUnion.get(a.source).push(a.cible);
      voisinsUnion.get(a.cible).push(a.source);
      if (a.role === 'fratrie') fratriesAdjacentes.push(a);
    });
    // Fratries entre générations différentes : tracées comme un lien souple.
    const fratriesEloignees = fratries.filter(
      (a) => generations.get(a.source) !== generations.get(a.cible)
    );

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

    // --- 11. déports manuels (ctrl + glisser) ------------------------------
    const places = new Set();
    boites.forEach((boite, id) => {
      const decalage = indexNoeuds.get(id)?.decalage;
      if (!decalage) return;
      boite.x += decalage[0];
      boite.y += decalage[1];
      places.add(id);
    });

    // --- 11bis. anti-chevauchement ----------------------------------------
    separerCartes(boites, places);

    // --- 12. normalisation ------------------------------------------------
    const finale = etendueDe(boites);
    const decalageX = GEO.marge - finale.x0;
    const decalageY = GEO.marge - finale.y0;
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
      largeur: finale.x1 - finale.x0 + GEO.marge * 2,
      hauteur: finale.y1 - finale.y0 + GEO.marge * 2,
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
      if (enfants.length > 1) {
        chemin.push(
          `M${centresEnfants[0]},${barreEnfants}H${centresEnfants[centresEnfants.length - 1]}`
        );
      }
      enfants.forEach((boite) => {
        chemin.push(`M${boite.x + boite.l / 2},${barreEnfants}V${boite.y}`);
      });

      morceaux.push(
        `<path class="lien-famille" d="${chemin.join(' ')}" stroke="${couleurFiliation}" />`
      );

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
        if (enfants.length > 1) {
          tronc.push(
            `M${centresEnfants[0]},${barreEnfants}H${centresEnfants[centresEnfants.length - 1]}`
          );
        }
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
      prise(union, chemin);
    });

    // --- liens sociaux ----------------------------------------------------
    const couleursFleches = new Set();
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

    coucheLiens.innerHTML = [...morceaux, ...prises].join('');

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

    detruire() {
      window.removeEventListener('resize', surRedimensionnement);
      plan.remove();
      cartes.clear();
    },
  };
}

enregistrerRendu('cartes', creerRenduCartes);
