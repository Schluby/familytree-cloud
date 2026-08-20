/* Moteur de rendu « perso » : la feuille de personnage, une à la fois (lot 24).
 *
 * Portée du classeur de la table : sa première page ici, sa deuxième dans la
 * popup d'intrigue. À gauche l'identité et les dix-neuf compétences, à droite
 * ce qu'on relit en jeu — les valeurs dérivées, l'armure, les armes, l'état.
 *
 * Tout s'enregistre au fil de la frappe, comme dans la vue « Maisons ». Et
 * comme pour les unités de guerre, **chaque modification renvoie la feuille
 * entière** : elle n'a pas d'identifiant par ligne, donc rien ne permettrait au
 * serveur de savoir quelle arme on vient de changer.
 */

import { Api } from '../api.js';
import { h, creerFlottant } from '../dom.js';
import { enregistrerRendu } from '../registry.js';

const DELAI_ENVOI = 500;

/**
 * Les valeurs dérivées, calculées ici pour l'affichage immédiat.
 *
 * **Jumelle de `derives()` dans `src/domaine/feuille.ts`**, et c'est une dette
 * assumée : le serveur les descend déjà dans le payload, mais un rang qu'on
 * change doit voir la défense bouger sous les doigts, pas une demi-seconde plus
 * tard quand le patch revient. Six additions valent mieux qu'une latence.
 * Si l'une des deux change, l'autre doit suivre — le harnais compare les deux
 * sur une feuille connue, justement pour que l'écart se voie tout de suite.
 */
function calculerDerives(feuille) {
  const rang = (code) => Number(feuille?.competences?.[code]?.rang ?? 0) || 0;
  const armure = feuille?.armure || {};
  const bonus = Number(armure.bonus ?? 0) || 0;
  const malus = Number(armure.malus ?? 0) || 0;
  return {
    defense_intrigue: rang('VIG') + rang('ING') + rang('STA'),
    sang_froid: rang('VOL') * 3,
    // Le malus se retranche — voir le commentaire de `derives()`, qui explique
    // pourquoi nous nous écartons ici de la formule du classeur.
    defense_combat: rang('AGI') + rang('ATH') + rang('VIG') + bonus - malus,
    sante: rang('END') * 3,
    valeur_armure: Number(armure.valeur ?? 0) || 0,
    base_frustration: rang('VOL'),
  };
}

export function creerRenduPerso(conteneur, contexte = {}) {
  const racine = h('div', { class: 'vue-perso' });
  const onglets = h('div', { class: 'fp-onglets' });
  const colonnes = h('div', { class: 'fp-colonnes' });
  const gauche = h('div', { class: 'fp-colonne fp-competences' });
  const droite = h('div', { class: 'fp-colonne fp-fiche' });
  colonnes.append(gauche, droite);
  racine.append(onglets, colonnes);
  conteneur.append(racine);

  const flottantIntrigue = creerFlottant();

  let payload = null;
  let choisi = null; // id du personnage affiché
  const enAttente = new Map();
  const minuteries = new Map();

  const personnages = () => payload?.personnages || [];
  const courant = () => personnages().find((p) => p.id === choisi) || personnages()[0] || null;
  const competences = () => payload?.competences || [];
  const tables = () => payload?.intrigue || { humeurs: [], intentions: [], techniques: [], actions: [] };

  /**
   * La feuille du personnage affiché, créée à la volée si elle n'existe pas.
   *
   * Une personne sur laquelle personne n'a rien rempli porte `feuille: null` —
   * c'est le cas de la quasi-totalité d'un monde. On n'installe l'objet qu'au
   * moment où quelqu'un écrit dedans, et le serveur le renverra à `null` si
   * l'on efface tout : la sauvegarde retrouve alors sa taille d'avant.
   */
  function feuilleDe(personnage) {
    if (!personnage.feuille) personnage.feuille = {};
    return personnage.feuille;
  }

  // ------------------------------------------------------------ persistance

  function modifier(personneId, { immediat = false } = {}) {
    const personnage = personnages().find((p) => p.id === personneId);
    if (!personnage) return Promise.resolve();
    enAttente.set(personneId, { feuille: personnage.feuille || {} });
    clearTimeout(minuteries.get(personneId));
    if (immediat) return envoyer(personneId);
    minuteries.set(personneId, setTimeout(() => envoyer(personneId), DELAI_ENVOI));
    return Promise.resolve();
  }

  async function envoyer(personneId) {
    clearTimeout(minuteries.get(personneId));
    const patch = enAttente.get(personneId);
    if (!patch) return;
    enAttente.delete(personneId);
    definirEtat('Enregistrement…');
    try {
      await Api.majPersonne(personneId, patch);
      definirEtat('Enregistré');
    } catch (erreur) {
      // Rien n'est perdu : la feuille locale porte toujours la frappe, et la
      // suivante repostera l'ensemble. L'échec est dit, pas avalé.
      enAttente.set(personneId, patch);
      definirEtat(`Échec : ${erreur.message}`, 'erreur');
    }
  }

  let elementEtat = null;
  function definirEtat(texte, classe = '') {
    if (elementEtat) {
      elementEtat.textContent = texte;
      elementEtat.className = `fp-etat ${classe}`;
    }
  }

  /** Réécrit les valeurs dérivées sans redessiner la page : on tape dedans. */
  let rafraichirDerives = () => {};

  // ------------------------------------------------------- petits contrôles

  /** Un champ texte lié à une clé de la feuille. */
  function champTexte(personnage, cle, placeholder, { long = false, lignes = 4 } = {}) {
    const feuille = feuilleDe(personnage);
    const commun = {
      placeholder,
      oninput: (evenement) => {
        feuille[cle] = evenement.target.value;
        modifier(personnage.id);
      },
    };
    if (!long) return h('input', { type: 'text', value: feuille[cle] ?? '', ...commun });
    return h('textarea', { rows: lignes, texte: feuille[cle] ?? '', ...commun });
  }

  /** Un champ nombre lié à une clé de la feuille (ou d'un sous-objet). */
  function champNombre(personnage, chemin, { min = 0, max = 999 } = {}) {
    const feuille = feuilleDe(personnage);
    const cles = chemin.split('.');
    const derniere = cles.pop();
    const hote = cles.reduce((objet, cle) => (objet[cle] = objet[cle] || {}), feuille);
    return h('input', {
      type: 'number',
      min,
      max,
      value: hote[derniere] ?? '',
      placeholder: '—',
      oninput: (evenement) => {
        const brut = evenement.target.value;
        hote[derniere] = brut === '' ? null : Number(brut);
        modifier(personnage.id);
        rafraichirDerives();
      },
    });
  }

  function etiquete(libelle, controle, { pleine = false } = {}) {
    return h('label', { class: `fp-champ ${pleine ? 'pleine' : ''}`.trim() }, [
      h('span', { texte: libelle }),
      controle,
    ]);
  }

  // ------------------------------------------------------------------ rendu

  /**
   * Le filtre du bandeau d'onglets.
   *
   * Un monde de campagne compte soixante-dix fiches ; les afficher toutes en
   * onglets donne quatre lignes de noms où l'on ne trouve rien. Le champ ne
   * change pas ce que le serveur envoie — il n'y a rien à recharger — il ne
   * fait que réduire ce qu'on montre.
   */
  let recherche = '';

  function correspond(personnage) {
    if (!recherche) return true;
    const aiguille = recherche.toLowerCase();
    return (
      String(personnage.label).toLowerCase().includes(aiguille) ||
      String(personnage.maison_label || '').toLowerCase().includes(aiguille) ||
      String(personnage.joueur?.nom || '').toLowerCase().includes(aiguille)
    );
  }

  function dessinerOnglets() {
    const visibles = personnages().filter(correspond);
    const champ = h('input', {
      type: 'text',
      class: 'fp-recherche',
      value: recherche,
      placeholder: 'Filtrer par nom, maison ou joueur…',
      oninput: (evenement) => {
        recherche = evenement.target.value;
        // Seuls les onglets bougent : redessiner la feuille ferait perdre le
        // curseur du champ à chaque lettre.
        dessinerOnglets();
        onglets.querySelector('.fp-recherche')?.focus();
      },
    });

    const boutons = visibles.map((personnage) => {
      const bouton = h('button', {
        type: 'button',
        class: `fp-onglet ${personnage.id === courant()?.id ? 'actif' : ''}`,
        title: personnage.maison_label || personnage.label,
        onclick: () => {
          choisi = personnage.id;
          dessiner();
        },
      });
      bouton.style.setProperty('--couleur-fiche', personnage.couleur);
      // Les enfants passent par `h`, qui écarte les `null` — `append` les
      // convertirait en la chaîne « null », ce qu'il a fait une fois.
      bouton.append(
        h('span', { class: 'fp-onglet-pastille' }),
        h('span', { texte: personnage.label }),
        ...(personnage.joueur
          ? // Le nom du joueur derrière la fiche : c'est la seule chose qui
            // distingue une feuille jouée d'une feuille de personnage secondaire.
            [h('span', { class: 'fp-onglet-joueur', texte: personnage.joueur.nom })]
          : personnage.feuille
            ? [h('span', { class: 'nombre', texte: '✓' })]
            : [])
      );
      return bouton;
    });

    onglets.replaceChildren(
      champ,
      h(
        'div',
        { class: 'fp-onglets-liste' },
        boutons.length
          ? boutons
          : [h('p', { class: 'fp-aide', texte: 'Personne ne répond à ce filtre.' })]
      )
    );
  }

  function dessiner() {
    const personnage = courant();
    dessinerOnglets();
    if (!personnage) {
      gauche.replaceChildren(
        h('p', { class: 'vide', texte: 'Aucun personnage dans cette sauvegarde.' })
      );
      droite.replaceChildren();
      return;
    }
    choisi = personnage.id;
    dessinerCompetences(personnage);
    dessinerFiche(personnage);
  }

  /* ------------------------------------------------------- les compétences
   *
   * Dix-neuf lignes, et jusqu'à trois spécialités par ligne. Les spécialités
   * sont repliées tant qu'il n'y en a pas : dix-neuf blocs dépliés feraient
   * quatre écrans pour une feuille où l'on n'en remplit qu'une poignée.
   */

  function ligneSpecialite(personnage, code, index) {
    const feuille = feuilleDe(personnage);
    const entree = feuille.competences[code];
    const spe = entree.specialites[index];
    const majSpe = (cle) => (evenement) => {
      const brut = evenement.target.value;
      spe[cle] = cle === 'nom' ? brut : brut === '' ? null : Number(brut);
      modifier(personnage.id);
    };
    return h('div', { class: 'fp-specialite' }, [
      h('input', {
        type: 'text',
        class: 'fp-spe-nom',
        value: spe.nom ?? '',
        placeholder: 'Spécialité',
        oninput: majSpe('nom'),
      }),
      h('input', {
        type: 'number',
        class: 'fp-spe-rang',
        min: 0,
        max: 20,
        value: spe.rang ?? '',
        title: 'Rang',
        placeholder: '—',
        oninput: majSpe('rang'),
      }),
      h('input', {
        type: 'number',
        class: 'fp-spe-exp',
        min: 0,
        value: spe.exp ?? '',
        title: 'Expérience',
        placeholder: 'Exp',
        oninput: majSpe('exp'),
      }),
      h('button', {
        class: 'bouton bouton-icone',
        type: 'button',
        texte: '✕',
        title: 'Retirer cette spécialité',
        onclick: () => {
          entree.specialites.splice(index, 1);
          modifier(personnage.id, { immediat: true });
          dessiner();
        },
      }),
    ]);
  }

  function ligneCompetence(personnage, competence) {
    const feuille = feuilleDe(personnage);
    if (!feuille.competences) feuille.competences = {};
    if (!feuille.competences[competence.id]) feuille.competences[competence.id] = { rang: 0 };
    const entree = feuille.competences[competence.id];
    if (!Array.isArray(entree.specialites)) entree.specialites = [];

    const rang = h('input', {
      type: 'number',
      class: 'fp-rang',
      min: 0,
      max: 20,
      value: entree.rang || '',
      placeholder: '0',
      oninput: (evenement) => {
        entree.rang = evenement.target.value === '' ? 0 : Number(evenement.target.value);
        modifier(personnage.id);
        // Cinq des six valeurs dérivées sortent d'un rang : elles doivent
        // bouger avec lui, pas au rechargement suivant.
        rafraichirDerives();
      },
    });

    const ajouter = h('button', {
      class: 'bouton bouton-icone fp-ajout-spe',
      type: 'button',
      texte: '＋',
      title: `Ajouter une spécialité en ${competence.label}`,
      // Trois colonnes sur la feuille d'origine, trois ici.
      disabled: entree.specialites.length >= 3,
      onclick: () => {
        entree.specialites.push({ nom: '', rang: 0, exp: 0 });
        modifier(personnage.id);
        dessiner();
      },
    });

    return h('div', { class: 'fp-competence' }, [
      h('div', { class: 'fp-competence-haut' }, [
        h('span', { class: 'fp-code', texte: competence.id }),
        h('span', { class: 'fp-nom-competence', texte: competence.label }),
        rang,
        ajouter,
      ]),
      ...entree.specialites.map((_, index) => ligneSpecialite(personnage, competence.id, index)),
    ]);
  }

  function dessinerCompetences(personnage) {
    gauche.replaceChildren(
      blocIdentite(personnage),
      h('section', { class: 'fp-bloc' }, [
        h('h3', { texte: 'Compétences' }),
        h('p', {
          class: 'fp-aide',
          texte: 'Le rang, puis jusqu’à trois spécialités par compétence.',
        }),
        h(
          'div',
          { class: 'fp-liste-competences' },
          competences().map((competence) => ligneCompetence(personnage, competence))
        ),
      ])
    );
  }

  /* ------------------------------------------------------------- l'identité */

  function blocIdentite(personnage) {
    const naissance = personnage.naissance ? String(personnage.naissance) : '';
    return h('section', { class: 'fp-bloc fp-identite' }, [
      h('div', { class: 'fp-entete-fiche' }, [
        personnage.avatar
          ? h('img', { class: 'fp-portrait', src: personnage.avatar, alt: '' })
          : h('div', { class: 'fp-portrait fp-portrait-vide' }),
        h('div', { class: 'fp-titre-fiche' }, [
          h('h2', { texte: personnage.label }),
          h('p', {
            class: 'fp-sous-titre',
            texte: personnage.maison_label || 'Sans maison',
          }),
          personnage.joueur
            ? h('p', { class: 'fp-joueur', texte: `Joué par ${personnage.joueur.nom}` })
            : null,
        ]),
      ]),
      h('div', { class: 'fp-grille' }, [
        etiquete('Sexe', h('span', { class: 'fp-lecture', texte: personnage.genre || '—' })),
        etiquete('Naissance', h('span', { class: 'fp-lecture', texte: naissance || '—' })),
        etiquete('Âge', champNombre(personnage, 'age', { max: 300 })),
        etiquete('Rôles', champTexte(personnage, 'roles', 'Chevalier, héritier…'), { pleine: true }),
        etiquete('Métier', champTexte(personnage, 'metier', 'Mestre, capitaine, marchand…'), {
          pleine: true,
        }),
      ]),
    ]);
  }

  /* ---------------------------------------------------- la colonne de droite */

  /*
   * Les quatre valeurs dérivées passent par `caseCalcul`, comme celles de
   * l'intrigue — même dessin, même fonction.
   *
   * Ce n'est pas seulement de l'économie : un libellé écrit dans un tableau
   * n'est vu par aucun relevé de textes, et « Défense de combat » est resté en
   * français dans la version anglaise pendant tout un essai. Les trois autres
   * passaient, parce qu'ils existaient **ailleurs** sous un porteur reconnu —
   * une chance, pas une garantie. Un libellé doit toujours traverser une
   * fonction que `outils/relever-textes.mjs` connaît.
   */
  function blocDerives(personnage) {
    const valeurs = h('div', { class: 'fp-derives' });

    rafraichirDerives = () => {
      const calcul = calculerDerives(personnage.feuille);
      valeurs.replaceChildren(
        caseCalcul(
          'Défense d’intrigue',
          String(calcul.defense_intrigue),
          'Vigilance + Ingéniosité + Statut'
        ),
        caseCalcul('Sang-froid', String(calcul.sang_froid), 'Trois fois la Volonté'),
        caseCalcul(
          'Défense de combat',
          String(calcul.defense_combat),
          'Agilité + Athlétisme + Vigilance, bonus déduit du malus'
        ),
        caseCalcul('Santé', String(calcul.sante), 'Trois fois l’Endurance')
      );
    };
    rafraichirDerives();

    return h('section', { class: 'fp-bloc' }, [
      h('div', { class: 'fp-entete-bloc' }, [
        h('h3', { texte: 'Valeurs dérivées' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '⚔ Intrigue',
          title: 'Ouvrir la table d’intrigue de ce personnage',
          onclick: (evenement) => ouvrirIntrigue(personnage, evenement.currentTarget),
        }),
      ]),
      valeurs,
      h('p', {
        class: 'fp-aide',
        texte: 'Ces quatre nombres se recalculent : ils ne sont jamais saisis.',
      }),
    ]);
  }

  function blocArmure(personnage) {
    return h('section', { class: 'fp-bloc' }, [
      h('h3', { texte: 'Armure' }),
      h('div', { class: 'fp-grille' }, [
        etiquete('Valeur d’armure', champNombre(personnage, 'armure.valeur', { max: 99 })),
        etiquete('Bonus défensif', champNombre(personnage, 'armure.bonus', { max: 99 })),
        etiquete('Malus de défense', champNombre(personnage, 'armure.malus', { max: 99 })),
      ]),
      h('p', {
        class: 'fp-aide',
        texte: 'Le malus se retranche de la défense de combat : entrez-le en positif.',
      }),
    ]);
  }

  function ligneArme(personnage, arme, index) {
    const feuille = feuilleDe(personnage);
    const maj = (cle) => (evenement) => {
      arme[cle] = evenement.target.value;
      modifier(personnage.id);
    };
    const majEffet = (rang) => (evenement) => {
      if (!Array.isArray(arme.effets)) arme.effets = [];
      arme.effets[rang] = evenement.target.value;
      modifier(personnage.id);
    };
    const effets = Array.isArray(arme.effets) ? arme.effets : [];
    return h('div', { class: 'fp-ligne-objet' }, [
      h('div', { class: 'fp-ligne-haut' }, [
        h('input', { type: 'text', class: 'fp-large', value: arme.nom ?? '', placeholder: 'Nom de l’arme', oninput: maj('nom') }),
        h('input', { type: 'text', class: 'fp-court', value: arme.degats ?? '', placeholder: 'Dégâts', oninput: maj('degats') }),
        h('input', { type: 'text', class: 'fp-court', value: arme.poids ?? '', placeholder: 'Poids', oninput: maj('poids') }),
        h('button', {
          class: 'bouton bouton-icone',
          type: 'button',
          texte: '✕',
          title: `Retirer « ${arme.nom || 'cette arme'} »`,
          onclick: () => {
            feuille.armes.splice(index, 1);
            modifier(personnage.id, { immediat: true });
            dessiner();
          },
        }),
      ]),
      h(
        'div',
        { class: 'fp-effets' },
        [0, 1, 2].map((rang) =>
          h('input', {
            type: 'text',
            value: effets[rang] ?? '',
            placeholder: `Effet ${rang + 1}`,
            oninput: majEffet(rang),
          })
        )
      ),
    ]);
  }

  function blocArmes(personnage) {
    const feuille = feuilleDe(personnage);
    if (!Array.isArray(feuille.armes)) feuille.armes = [];
    return h('section', { class: 'fp-bloc' }, [
      h('div', { class: 'fp-entete-bloc' }, [
        h('h3', { texte: 'Armes' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '＋ Arme',
          onclick: () => {
            // Un nom par défaut, comme pour les unités de guerre : le serveur
            // écarte les armes sans nom ni dégâts, donc une ligne vraiment vide
            // disparaîtrait au rechargement.
            feuille.armes.push({ nom: 'Nouvelle arme', degats: '', poids: '', effets: [] });
            modifier(personnage.id, { immediat: true });
            dessiner();
            const champs = droite.querySelectorAll('.fp-ligne-objet .fp-large');
            champs[champs.length - 1]?.select();
          },
        }),
      ]),
      ...(feuille.armes.length
        ? feuille.armes.map((arme, index) => ligneArme(personnage, arme, index))
        : [h('p', { class: 'fp-aide', texte: 'Aucune arme.' })]),
    ]);
  }

  function blocEquipement(personnage) {
    const feuille = feuilleDe(personnage);
    if (!Array.isArray(feuille.equipement)) feuille.equipement = [];
    const ligne = (objet, index) => {
      const maj = (cle) => (evenement) => {
        objet[cle] = evenement.target.value;
        modifier(personnage.id);
      };
      return h('div', { class: 'fp-ligne-haut' }, [
        h('input', { type: 'text', class: 'fp-large', value: objet.nom ?? '', placeholder: 'Objet', oninput: maj('nom') }),
        h('input', { type: 'text', class: 'fp-court', value: objet.poids ?? '', placeholder: 'Poids', oninput: maj('poids') }),
        h('input', { type: 'text', value: objet.attributs ?? '', placeholder: 'Attributs', oninput: maj('attributs') }),
        h('button', {
          class: 'bouton bouton-icone',
          type: 'button',
          texte: '✕',
          title: `Retirer « ${objet.nom || 'cet objet'} »`,
          onclick: () => {
            feuille.equipement.splice(index, 1);
            modifier(personnage.id, { immediat: true });
            dessiner();
          },
        }),
      ]);
    };
    return h('section', { class: 'fp-bloc' }, [
      h('div', { class: 'fp-entete-bloc' }, [
        h('h3', { texte: 'Équipement' }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: '＋ Objet',
          onclick: () => {
            feuille.equipement.push({ nom: 'Nouvel objet', poids: '', attributs: '' });
            modifier(personnage.id, { immediat: true });
            dessiner();
          },
        }),
      ]),
      ...(feuille.equipement.length
        ? feuille.equipement.map(ligne)
        : [h('p', { class: 'fp-aide', texte: 'Aucun équipement.' })]),
    ]);
  }

  function blocBourse(personnage) {
    return h('section', { class: 'fp-bloc' }, [
      h('h3', { texte: 'Bourse' }),
      h('div', { class: 'fp-grille' }, [
        etiquete('Or', champNombre(personnage, 'bourse.or', { max: 999999 })),
        etiquete('Argent', champNombre(personnage, 'bourse.argent', { max: 999999 })),
        etiquete('Bronze', champNombre(personnage, 'bourse.bronze', { max: 999999 })),
        etiquete('Expérience', champNombre(personnage, 'experience', { max: 99999 })),
        etiquete('Richesse', champNombre(personnage, 'richesse', { max: 99999 })),
      ]),
    ]);
  }

  function blocEtat(personnage) {
    return h('section', { class: 'fp-bloc' }, [
      h('h3', { texte: 'État' }),
      h('div', { class: 'fp-grille' }, [
        etiquete('Dégâts subis', champNombre(personnage, 'degats')),
        etiquete('Destinée', champNombre(personnage, 'destinee', { max: 99 })),
      ]),
      etiquete('Blessures', champTexte(personnage, 'blessures', 'Ce qu’il a pris, et où', { long: true, lignes: 3 }), { pleine: true }),
      etiquete('Lésions', champTexte(personnage, 'lesions', 'Ce qui ne guérira pas', { long: true, lignes: 3 }), { pleine: true }),
    ]);
  }

  function blocTextes(personnage) {
    const zones = [
      ['Attributs', 'attributs', 'Ce qui le définit'],
      ['Vertus', 'vertus', 'Ce qui le porte'],
      ['Vices', 'vices', 'Ce qui le perdra'],
      ['Alliés', 'allies', 'Sur qui il peut compter'],
      ['Ennemis', 'ennemis', 'Qui lui veut du mal'],
      ['Notes', 'notes', 'Le reste'],
    ];
    return h(
      'section',
      { class: 'fp-bloc' },
      zones.map(([libelle, cle, placeholder]) =>
        etiquete(libelle, champTexte(personnage, cle, placeholder, { long: true, lignes: 3 }), {
          pleine: true,
        })
      )
    );
  }

  function dessinerFiche(personnage) {
    elementEtat = h('span', { class: 'fp-etat' });
    droite.replaceChildren(
      h('div', { class: 'fp-barre-etat' }, [elementEtat]),
      blocDerives(personnage),
      blocArmure(personnage),
      blocArmes(personnage),
      blocEquipement(personnage),
      blocBourse(personnage),
      blocEtat(personnage),
      blocTextes(personnage)
    );
  }

  /* =======================================================================
   *  L'intrigue — deuxième page du classeur
   *
   *  Un combat social : on annonce une intention et une technique, l'humeur
   *  de la cible donne un modificateur de dés, et l'on tient les rounds
   *  jusqu'à ce que le sang-froid ou la patience cède.
   *
   *  Tout est enregistré dans `feuille.intrigue` : une intrigue tient une
   *  séance entière, et la perdre en rafraîchissant la page la rendrait
   *  inutilisable à la table.
   * ======================================================================= */

  function intrigueDe(personnage) {
    const feuille = feuilleDe(personnage);
    if (!feuille.intrigue) feuille.intrigue = {};
    if (!Array.isArray(feuille.intrigue.rounds)) feuille.intrigue.rounds = [];
    return feuille.intrigue;
  }

  /** Le modificateur d'un test, dicté par la seule humeur de la cible. */
  function modificateurDuTest(humeur, codeTest) {
    if (!humeur) return 0;
    if (codeTest === 'PER') return humeur.persuasion;
    if (codeTest === 'DUP') return humeur.duperie;
    return 0;
  }

  function ouvrirIntrigue(personnage, ancre) {
    if (flottantIntrigue.estOuvert()) {
      flottantIntrigue.fermer();
      return;
    }
    const boite = ancre.getBoundingClientRect();
    flottantIntrigue.monter(panneauIntrigue(personnage), boite.left, boite.bottom + 6);
  }

  function panneauIntrigue(personnage) {
    const intrigue = intrigueDe(personnage);
    const { humeurs, intentions, techniques, actions } = tables();

    const corps = h('div', { class: 'fl-corps fp-intrigue' });

    /**
     * Redessine le panneau en entier.
     *
     * Réservé aux **choix** — humeur, intention, technique, action d'un round :
     * ce sont des menus, et perdre le focus d'un menu qu'on vient de refermer
     * ne coûte rien. Les champs de nombres, eux, ne redessinent jamais : ils
     * mettent à jour le total de leur ligne et le résumé, sans quoi la frappe
     * serait interrompue à chaque chiffre.
     */
    const redessiner = () => corps.replaceChildren(...contenuIntrigue());

    function menu(cle, options, placeholder) {
      const select = h('select', {
        onchange: (evenement) => {
          intrigue[cle] = evenement.target.value;
          modifier(personnage.id);
          redessiner();
        },
      });
      select.append(h('option', { value: '', texte: placeholder }));
      for (const option of options) {
        const noeud = h('option', { value: option.id, texte: option.label });
        if (intrigue[cle] === option.id) noeud.selected = true;
        select.append(noeud);
      }
      return select;
    }

    function contenuIntrigue() {
      const humeur = humeurs.find((x) => x.id === intrigue.humeur) || null;
      const intention = intentions.find((x) => x.id === intrigue.intention) || null;
      const technique = techniques.find((x) => x.id === intrigue.technique) || null;
      const calcul = calculerDerives(personnage.feuille);

      const test = intention?.test || '';
      const rang = test ? Number(personnage.feuille?.competences?.[test]?.rang ?? 0) || 0 : 0;
      const modificateur = modificateurDuTest(humeur, test);
      const parIntention = intention && technique ? technique[intention.id] : null;

      // Le résumé se recalcule sans redessiner : c'est lui qui bouge quand on
      // note une perte ou coche une frustration, et rien d'autre.
      const resume = h('div', { class: 'fp-intrigue-tableau' });
      const alertes = h('div');

      function remplirResume() {
        const pertes = intrigue.rounds.reduce((somme, r) => somme + (Number(r.perte) || 0), 0);
        const regains = intrigue.rounds.reduce((somme, r) => somme + (Number(r.calmer) || 0), 0);
        const frustration = intrigue.rounds.filter((r) => r.frustration).length;
        const restant = calcul.sang_froid - pertes + regains;
        const rompu = calcul.base_frustration > 0 && frustration >= calcul.base_frustration;

        resume.replaceChildren(
          caseCalcul('Test', test || '—', 'La compétence engagée, dictée par l’intention'),
          caseCalcul('Rang', String(rang), 'Votre rang dans cette compétence'),
          caseCalcul('Modificateur', signe(modificateur), 'Ce que l’humeur de la cible ajoute aux dés'),
          caseCalcul(
            'Défense d’intrigue',
            String(calcul.defense_intrigue),
            'Ce qu’il faut battre pour vous atteindre'
          ),
          caseCalcul('Sang-froid', `${restant} / ${calcul.sang_froid}`, 'Ce qu’il vous reste à encaisser'),
          caseCalcul(
            'Frustration',
            `${frustration} / ${calcul.base_frustration}`,
            'Au-delà, le personnage cède'
          )
        );

        alertes.replaceChildren(
          ...(rompu
            ? [h('p', { class: 'fp-alerte', texte: 'La patience a cédé : le personnage rompt l’échange.' })]
            : []),
          ...(restant <= 0 && calcul.sang_froid > 0
            ? [h('p', { class: 'fp-alerte', texte: 'Le sang-froid est épuisé.' })]
            : [])
        );
      }
      remplirResume();

      const effet = parIntention
        ? h('div', { class: 'fp-intrigue-effet' }, [
            h('p', {}, [h('strong', { texte: 'Objectif : ' }), h('span', { texte: parIntention.objectif })]),
            h('p', {}, [
              h('strong', { texte: 'Spécialité : ' }),
              h('span', { texte: parIntention.specialite }),
            ]),
            h('p', {}, [
              h('strong', { texte: 'La cible résiste en : ' }),
              h('span', { texte: technique.influence }),
            ]),
            h('p', { class: 'fp-aide', texte: technique.resultat }),
          ])
        : h('p', {
            class: 'fp-aide',
            texte: 'Choisissez une intention et une technique pour voir ce qu’elles produisent.',
          });

      return [
        h('div', { class: 'fp-intrigue-choix' }, [
          etiquete(
            'Cible',
            h('input', {
              type: 'text',
              value: intrigue.cible ?? '',
              placeholder: 'Contre qui',
              oninput: (evenement) => {
                intrigue.cible = evenement.target.value;
                modifier(personnage.id);
              },
            })
          ),
          etiquete('Humeur de la cible', menu('humeur', humeurs, 'À déterminer')),
          etiquete('Intention', menu('intention', intentions, 'À choisir')),
          etiquete('Technique', menu('technique', techniques, 'À choisir')),
        ]),
        resume,
        alertes,
        effet,
        h('h4', { texte: 'Les rounds' }),
        tableRounds(intention, humeur, remplirResume),
      ];
    }

    /**
     * Les rounds.
     *
     * On affiche ceux qui existent, plus **une ligne d'attente**. Cette ligne
     * n'est pas un round : son objet n'entre dans l'intrigue qu'au moment où
     * quelqu'un écrit dedans. La créer d'avance, comme le faisait la première
     * version, ajoutait un round vide à chaque redessin — trois choix de menu
     * suffisaient à faire apparaître quatre lignes.
     */
    function tableRounds(intention, humeur, remplirResume) {
      const table = h('table', { class: 'fp-rounds' });
      table.append(
        h('thead', {}, [
          h('tr', {}, [
            h('th', { texte: '#' }),
            h('th', { texte: 'Action' }),
            h('th', { texte: 'Lancé' }),
            h('th', { texte: 'Total' }),
            h('th', { texte: 'Perte' }),
            h('th', { texte: 'Calmer' }),
            h('th', { texte: 'Frustré' }),
          ]),
        ])
      );

      const corpsTable = h('tbody');
      // Vingt rounds comme la feuille, mais on n'affiche que ceux qui servent.
      const nombre = Math.min(20, intrigue.rounds.length + 1);

      for (let index = 0; index < nombre; index += 1) {
        const round =
          intrigue.rounds[index] || { action: '', lance: null, perte: null, calmer: null, frustration: false };

        const action = actions.find((a) => a.id === round.action) || null;
        // Le test d'un round est celui de son action ; « Influence » n'en a pas
        // et emprunte alors celui de l'intention. C'est le double renvoi de la
        // feuille, dit en clair.
        const bonus = () =>
          modificateurDuTest(
            humeur,
            actions.find((a) => a.id === round.action)
              ? actions.find((a) => a.id === round.action).test || intention?.test || ''
              : ''
          );

        const celluleTotal = h('td', { class: 'fp-total' });
        const majTotal = () => {
          const brut = round.lance;
          celluleTotal.textContent =
            brut === null || brut === '' ? '—' : String(Number(brut) + bonus());
        };
        majTotal();

        /** `redessine` pour les menus et les cases ; jamais pour les nombres. */
        const majRound = (cle, valeur, { redessine = false } = {}) => {
          round[cle] = valeur;
          if (!intrigue.rounds[index]) intrigue.rounds[index] = round;
          modifier(personnage.id);
          if (redessine) redessiner();
          else {
            majTotal();
            remplirResume();
          }
        };

        const nombreRound = (cle) =>
          h('input', {
            type: 'number',
            ...(cle === 'lance' ? {} : { min: 0 }),
            value: round[cle] ?? '',
            placeholder: '—',
            oninput: (evenement) =>
              majRound(cle, evenement.target.value === '' ? null : Number(evenement.target.value)),
          });

        const menuAction = h('select', {
          onchange: (evenement) => majRound('action', evenement.target.value, { redessine: true }),
          title: action?.resultat || '',
        });
        menuAction.append(h('option', { value: '', texte: '—' }));
        for (const option of actions) {
          const noeud = h('option', { value: option.id, texte: option.label });
          if (round.action === option.id) noeud.selected = true;
          menuAction.append(noeud);
        }

        corpsTable.append(
          h('tr', { class: intrigue.rounds[index] ? '' : 'fp-round-attente' }, [
            h('td', { texte: String(index + 1) }),
            h('td', {}, [menuAction]),
            h('td', {}, [nombreRound('lance')]),
            celluleTotal,
            h('td', {}, [nombreRound('perte')]),
            h('td', {}, [nombreRound('calmer')]),
            h('td', {}, [
              h('input', {
                type: 'checkbox',
                checked: Boolean(round.frustration),
                onchange: (evenement) =>
                  majRound('frustration', evenement.target.checked, { redessine: true }),
              }),
            ]),
          ])
        );
      }
      table.append(corpsTable);
      return table;
    }

    redessiner();

    return h('div', { class: 'flottant flottant-intrigue' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', { class: 'fl-nom', texte: 'Intrigue' }),
          h('span', { class: 'fl-sous', texte: personnage.label }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fp-vider',
          type: 'button',
          texte: '⟲',
          title: 'Effacer cette intrigue et repartir à zéro',
          onclick: () => {
            delete feuilleDe(personnage).intrigue;
            modifier(personnage.id, { immediat: true });
            flottantIntrigue.fermer();
          },
        }),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer',
          onclick: () => flottantIntrigue.fermer(),
        }),
      ]),
      corps,
    ]);
  }

  function caseCalcul(libelle, valeur, aide) {
    return h('div', { class: 'fp-case', title: aide }, [
      h('span', { class: 'fp-case-valeur', texte: valeur }),
      h('span', { class: 'fp-case-nom', texte: libelle }),
    ]);
  }

  /** `+3`, `-2`, `0` : le signe fait partie de la lecture d'un modificateur. */
  function signe(nombre) {
    return nombre > 0 ? `+${nombre}` : String(nombre);
  }

  // ------------------------------------------------------------- interface

  return {
    rendre(nouveau) {
      payload = nouveau;
      // On garde le personnage affiché d'un rechargement à l'autre : la vue se
      // recharge à chaque édition de référentiel, et retomber sur le premier
      // de la liste ferait perdre sa place à chaque fois.
      if (!personnages().some((p) => p.id === choisi)) choisi = null;
      dessiner();
    },
    majOptions() {},
    focus(id) {
      if (id && personnages().some((p) => p.id === id)) {
        choisi = id;
        dessiner();
      }
    },
    recentrer() {},
    detruire() {
      // Ce qui n'est pas encore parti part maintenant : quitter la vue ne doit
      // pas perdre la dernière frappe.
      for (const id of [...enAttente.keys()]) envoyer(id);
      flottantIntrigue.fermer();
      minuteries.forEach((minuterie) => clearTimeout(minuterie));
      minuteries.clear();
      racine.remove();
    },
  };
}

enregistrerRendu('perso', creerRenduPerso);
