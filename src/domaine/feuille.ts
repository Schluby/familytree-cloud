/**
 * La feuille de personnage du JDR *Le Trône de Fer* (lot 24).
 *
 * Portée du classeur `Perso copie.xlsx` fourni par la table : sa première page
 * pour la fiche, sa deuxième pour l'intrigue. La troisième (la maison) est
 * déjà couverte par la vue « Maisons » depuis le lot 8, et la quatrième (les
 * armées) prolonge les unités de guerre du lot 20.E — voir `referentiels.ts`.
 *
 * **Ce que ce module fait, et rien d'autre** : il déclare les listes fermées du
 * jeu, il normalise ce qui arrive du réseau, et il calcule les valeurs
 * dérivées. Il n'écrit jamais dans le document — ce sont les routes qui le
 * font — et il ne dessine rien.
 *
 * La règle de tout le projet vaut ici aussi : **rien n'est écrit tant que rien
 * n'est renseigné**. Une campagne qui ne joue pas les feuilles ne verra jamais
 * la clé `feuille` apparaître dans sa sauvegarde, et un monde exporté puis
 * réimporté ressort octet pour octet.
 */

import { versEntier } from './python';
import type { Objet } from './models';

/* --------------------------------------------------------------------------
 * Petits normaliseurs, copiés sur ceux de `referentiels.ts`
 *
 * Ils y sont privés au module. Les redéclarer ici coûte dix lignes et évite
 * d'ouvrir un fichier au reste du monde pour trois fonctions d'une ligne.
 * -------------------------------------------------------------------------- */

function texte(brut: unknown, maximum = 120): string {
  if (brut === null || brut === undefined) return '';
  return String(brut).trim().slice(0, maximum);
}

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** Un entier borné. Vide reste vide : « on ne l'a pas noté » n'est pas « zéro ». */
function borne(brut: unknown, mini: number, maxi: number): number | null {
  if (brut === null || brut === undefined || brut === '') return null;
  const entier = versEntier(brut);
  if (entier === null) return null;
  return Math.max(mini, Math.min(maxi, entier));
}

/** Le même, mais qui répond `0` plutôt que `null` : pour ce qui s'additionne. */
function chiffre(brut: unknown, mini: number, maxi: number): number {
  return borne(brut, mini, maxi) ?? 0;
}

/* --------------------------------------------------------------------------
 * Les dix-neuf compétences
 *
 * L'ordre est celui de la feuille — alphabétique en français — et le code de
 * trois lettres est celui qu'écrivent les tables d'intrigue. C'est **le code**
 * qui sert de clé partout : renommer un libellé n'a alors aucune conséquence,
 * là où renommer une clé ferait tomber toutes les fiches déjà remplies.
 * -------------------------------------------------------------------------- */

export const COMPETENCES = [
  { id: 'AGI', label: 'Agilité' },
  { id: 'ART', label: 'Art militaire' },
  { id: 'ATH', label: 'Athlétisme' },
  { id: 'CON', label: 'Connaissance' },
  { id: 'CAC', label: 'Corps à corps' },
  { id: 'DIS', label: 'Discrétion' },
  { id: 'DRE', label: 'Dressage' },
  { id: 'DUP', label: 'Duperie' },
  { id: 'END', label: 'Endurance' },
  { id: 'ING', label: 'Ingéniosité' },
  { id: 'LAN', label: 'Langue' },
  { id: 'LAR', label: 'Larcin' },
  { id: 'PER', label: 'Persuasion' },
  { id: 'SOI', label: 'Soins' },
  { id: 'STA', label: 'Statut' },
  { id: 'SUR', label: 'Survie' },
  { id: 'TIR', label: 'Tir' },
  { id: 'VIG', label: 'Vigilance' },
  { id: 'VOL', label: 'Volonté' },
] as const;

const CODES_COMPETENCES = new Set(COMPETENCES.map((c) => c.id) as string[]);

/** Le rang d'une compétence, ou zéro : une compétence non notée ne vaut rien. */
export function rangDe(feuille: Objet | null | undefined, code: string): number {
  if (!feuille) return 0;
  const competences = feuille.competences as Objet | undefined;
  const entree = competences?.[code] as Objet | undefined;
  return versEntier(entree?.rang) ?? 0;
}

/* --------------------------------------------------------------------------
 * Normalisation de la feuille
 * -------------------------------------------------------------------------- */

/**
 * Combien de spécialités une compétence peut porter.
 *
 * Le classeur en pose trois — trois triplets de colonnes « Spécialité *n* /
 * Rang *n* / Exp *n* ». Ce n'est pas une règle du jeu, c'est la largeur d'une
 * page A4 ; l'écran n'a pas cette limite, et le lot 25 laisse ajouter des
 * colonnes. Huit est un garde-fou, pas un plafond de jeu : au-delà, ce n'est
 * plus une feuille mais un fichier qu'on remplit par accident.
 */
export const MAX_SPECIALITES = 8;

/** Une spécialité : un nom, un rang, de l'expérience. */
function specialites(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(estObjet)
    .slice(0, MAX_SPECIALITES)
    .map((entree) => ({
      // Long, et voulu : la colonne « Spécialité » sert aussi à dire *ce que
      // la spécialité fait*, ce que le classeur écrivait en marge.
      nom: texte(entree.nom, 600),
      rang: chiffre(entree.rang, 0, 20),
      exp: chiffre(entree.exp, 0, 999),
    }))
    .filter((_, index, liste) => {
      /*
       * On ne coupe **que la fin**.
       *
       * La règle du lot 24 écartait toute spécialité sans nom, ce qui tassait
       * la liste : une spécialité écrite dans la troisième colonne remontait
       * dans la première au rechargement, et la colonne qu'on avait ouverte
       * pour elle disparaissait. Depuis le lot 25 les colonnes sont une
       * grille, et une case laissée vide au milieu garde sa place — trente
       * octets, et seulement pour qui saute volontairement une colonne.
       *
       * Ce qui traîne après la dernière case remplie, en revanche, ne dit
       * rien : c'est une colonne ouverte puis abandonnée.
       */
      return liste.slice(index).some((entree) => entree.nom || entree.rang || entree.exp);
    });
}

function competences(brut: unknown): Objet {
  if (!estObjet(brut)) return {};
  const resultat: Objet = {};
  for (const [code, valeur] of Object.entries(brut)) {
    if (!CODES_COMPETENCES.has(code) || !estObjet(valeur)) continue;
    const rang = chiffre(valeur.rang, 0, 20);
    const listeSpe = specialites(valeur.specialites);
    // Rang zéro et aucune spécialité : la compétence n'a jamais été touchée,
    // et l'écrire ferait dix-neuf lignes de bruit dans chaque sauvegarde.
    if (!rang && !listeSpe.length) continue;
    resultat[code] = { rang, ...(listeSpe.length ? { specialites: listeSpe } : {}) };
  }
  return resultat;
}

function armes(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(estObjet)
    .slice(0, 30)
    .map((entree) => ({
      nom: texte(entree.nom, 120),
      poids: texte(entree.poids, 40),
      degats: texte(entree.degats, 60),
      effets: (Array.isArray(entree.effets) ? entree.effets : [])
        .slice(0, 3)
        .map((effet: unknown) => texte(effet, 120)),
    }))
    .filter((entree) => entree.nom || entree.degats);
}

function equipement(brut: unknown): Objet[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(estObjet)
    .slice(0, 60)
    .map((entree) => ({
      nom: texte(entree.nom, 120),
      poids: texte(entree.poids, 40),
      attributs: texte(entree.attributs, 200),
    }))
    .filter((entree) => entree.nom);
}

/**
 * L'intrigue en cours, telle que la popup la laisse.
 *
 * Elle vit dans la feuille et non en mémoire : une intrigue tient une séance
 * entière, et la perdre en rafraîchissant la page serait la rendre inutilisable
 * à la table. Vingt rounds, comme la feuille.
 */
function intrigue(brut: unknown): Objet | null {
  if (!estObjet(brut)) return null;
  const rounds = (Array.isArray(brut.rounds) ? brut.rounds : [])
    .filter(estObjet)
    .slice(0, 20)
    .map((entree: Objet) => ({
      action: IDS_ACTIONS.has(texte(entree.action, 40)) ? texte(entree.action, 40) : '',
      lance: borne(entree.lance, -99, 999),
      perte: borne(entree.perte, 0, 999),
      calmer: borne(entree.calmer, 0, 999),
      frustration: Boolean(entree.frustration),
      notes: texte(entree.notes, 400),
    }))
    // Un round où l'on n'a rien noté ne mérite pas d'être conservé.
    .filter(
      (r) => r.action || r.lance !== null || r.perte !== null || r.calmer !== null || r.frustration || r.notes
    );

  const humeur = texte(brut.humeur, 40);
  const intention = texte(brut.intention, 40);
  const technique = texte(brut.technique, 40);
  const resultat: Objet = {
    cible: texte(brut.cible, 120),
    humeur: IDS_HUMEURS.has(humeur) ? humeur : '',
    intention: IDS_INTENTIONS.has(intention) ? intention : '',
    technique: IDS_TECHNIQUES.has(technique) ? technique : '',
    ...(rounds.length ? { rounds } : {}),
  };
  // Une intrigue dont rien n'est rempli n'est pas une intrigue.
  const vide =
    !resultat.cible && !resultat.humeur && !resultat.intention && !resultat.technique && !rounds.length;
  return vide ? null : resultat;
}

/**
 * La feuille complète.
 *
 * Chaque bloc n'est écrit que s'il porte quelque chose ; une feuille entièrement
 * vide vaut `null`, et le champ disparaît alors de la personne.
 */
export function normaliserFeuille(brut: unknown): Objet | null {
  if (!estObjet(brut)) return null;

  const listeArmes = armes(brut.armes);
  const listeEquipement = equipement(brut.equipement);
  const listeCompetences = competences(brut.competences);
  const enCours = intrigue(brut.intrigue);

  const bourse = estObjet(brut.bourse) ? brut.bourse : {};
  const armure = estObjet(brut.armure) ? brut.armure : {};

  const feuille: Objet = {
    age: borne(brut.age, 0, 300),
    roles: texte(brut.roles, 200),
    metier: texte(brut.metier, 200),
    bourse: {
      or: chiffre(bourse.or, 0, 999999),
      argent: chiffre(bourse.argent, 0, 999999),
      bronze: chiffre(bourse.bronze, 0, 999999),
    },
    armure: {
      // La valeur d'armure et le bonus s'ajoutent, le malus se retranche : voir
      // `derives()` plus bas, où le choix est expliqué.
      valeur: chiffre(armure.valeur, 0, 99),
      malus: chiffre(armure.malus, 0, 99),
      bonus: chiffre(armure.bonus, 0, 99),
    },
    attributs: texte(brut.attributs, 2000),
    vices: texte(brut.vices, 2000),
    vertus: texte(brut.vertus, 2000),
    allies: texte(brut.allies, 2000),
    ennemis: texte(brut.ennemis, 2000),
    experience: chiffre(brut.experience, 0, 99999),
    richesse: chiffre(brut.richesse, 0, 99999),
    degats: chiffre(brut.degats, 0, 999),
    destinee: chiffre(brut.destinee, 0, 99),
    blessures: texte(brut.blessures, 2000),
    lesions: texte(brut.lesions, 2000),
    notes: texte(brut.notes, 4000),
    ...(Object.keys(listeCompetences).length ? { competences: listeCompetences } : {}),
    ...(listeArmes.length ? { armes: listeArmes } : {}),
    ...(listeEquipement.length ? { equipement: listeEquipement } : {}),
    ...(enCours ? { intrigue: enCours } : {}),
  };

  // On retire ce qui ne dit rien, puis on regarde s'il reste quelque chose.
  for (const [cle, valeur] of Object.entries(feuille)) {
    if (valeur === null || valeur === '' || valeur === 0) delete feuille[cle];
    else if (estObjet(valeur) && Object.values(valeur).every((v) => !v)) delete feuille[cle];
  }
  return Object.keys(feuille).length ? feuille : null;
}

/* --------------------------------------------------------------------------
 * Les valeurs dérivées
 *
 * Elles ne sont **jamais** enregistrées : ce sont des sommes de rangs, et les
 * stocker créerait deux vérités qui divergeraient au premier rang modifié.
 * La vue les recalcule à chaque appel, ce qui coûte quelques additions.
 * -------------------------------------------------------------------------- */

export function derives(feuille: Objet | null | undefined): Objet {
  const rang = (code: string) => rangDe(feuille, code);
  const armure = (feuille?.armure ?? {}) as Objet;
  const valeurArmure = versEntier(armure.valeur) ?? 0;
  const malus = versEntier(armure.malus) ?? 0;
  const bonus = versEntier(armure.bonus) ?? 0;

  return {
    // Feuille, ligne 31 : VIG + ING + STA.
    defense_intrigue: rang('VIG') + rang('ING') + rang('STA'),
    // Ligne 34 : trois fois la Volonté.
    sang_froid: rang('VOL') * 3,
    /*
     * Ligne 31, colonne E : AGI + ATH + VIG, plus le bonus défensif, moins le
     * malus de l'armure.
     *
     * **Un écart assumé avec le classeur**, le seul de ce module : la formule
     * d'origine *additionne* la case « Malus de défense », en comptant sur
     * celui qui la remplit pour y écrire un nombre négatif. Un champ nommé
     * « malus » qui augmente la défense quand on y tape 2 est un piège ; ici il
     * se retranche, et le champ n'accepte que des nombres positifs.
     */
    defense_combat: rang('AGI') + rang('ATH') + rang('VIG') + bonus - malus,
    // Ligne 34, colonne E : trois fois l'Endurance.
    sante: rang('END') * 3,
    // Ligne 30, colonne H : ce que l'armure arrête.
    valeur_armure: valeurArmure,
    // La frustration se compte contre le rang de Volonté (page « Intrigue »).
    base_frustration: rang('VOL'),
  };
}

/* --------------------------------------------------------------------------
 * L'intrigue — deuxième page du classeur
 *
 * Une intrigue est un combat social : on choisit une intention et une
 * technique, l'humeur de la cible donne un modificateur, et l'on tient les
 * rounds jusqu'à ce que le sang-froid ou la patience cède.
 * -------------------------------------------------------------------------- */

/**
 * L'humeur de la cible envers le personnage.
 *
 * `persuasion` et `duperie` sont les deux modificateurs de dés : un adversaire
 * affectueux se laisse convaincre (+5) mais voit venir le mensonge (−2), un
 * malicieux fait l'inverse. C'est ce contraste qui fait tout le sel du choix
 * d'intention.
 */
export const HUMEURS_INTRIGUE = [
  { id: 'affectueux', label: 'Affectueux', valeur: 1, persuasion: 5, duperie: -2 },
  { id: 'amical', label: 'Amical', valeur: 2, persuasion: 3, duperie: -1 },
  { id: 'aimable', label: 'Aimable', valeur: 3, persuasion: 1, duperie: 0 },
  { id: 'indifferent', label: 'Indifférent', valeur: 4, persuasion: 0, duperie: 0 },
  { id: 'antipathique', label: 'Antipathique', valeur: 5, persuasion: -2, duperie: 1 },
  { id: 'inamical', label: 'Inamical', valeur: 6, persuasion: -4, duperie: 2 },
  { id: 'malicieux', label: 'Malicieux', valeur: 7, persuasion: -6, duperie: 3 },
] as const;

/** Bonne foi ou mauvaise : c'est ce qui décide du test, et donc de tout. */
export const INTENTIONS = [
  { id: 'bonne', label: 'Bonne', test: 'PER' },
  { id: 'mauvaise', label: 'Mauvaise', test: 'DUP' },
] as const;

/**
 * Les sept techniques d'influence.
 *
 * `influence` est la compétence qui *résiste* à la technique. `objectif` et
 * `specialite` changent avec l'intention — séduire de bonne foi relève de la
 * séduction, séduire en mentant relève du bluff — d'où les deux sous-objets.
 */
export const TECHNIQUES = [
  {
    id: 'charmer',
    label: 'Charmer',
    influence: 'PER',
    bonne: { objectif: 'Amitié', specialite: 'Charmer' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Comédie' },
    resultat: 'Humeur de l’adversaire + 1, et + 1D aux tests de Persuasion et de Duperie',
  },
  {
    id: 'convaincre',
    label: 'Convaincre',
    influence: 'VOL',
    bonne: { objectif: 'Service ou renseignement', specialite: 'Convaincre' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Comédie' },
    resultat: 'Fait prendre son point de vue à la personne',
  },
  {
    id: 'inciter',
    label: 'Inciter',
    influence: 'ING',
    bonne: { objectif: 'Amitié', specialite: 'Inciter' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Bluff' },
    resultat:
      'Diminue d’autant que le rang de Persuasion l’humeur de l’adversaire envers un tiers',
  },
  {
    id: 'intimider',
    label: 'Intimider',
    influence: 'VOL',
    bonne: { objectif: 'Service ou renseignement', specialite: 'Intimider' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Bluff ou comédie' },
    resultat:
      'Fait fuir la cible ; si c’est impossible, son humeur passe à aimable, et si elle l’était déjà, humeur + 1',
  },
  {
    id: 'marchander',
    label: 'Marchander',
    influence: 'ING',
    bonne: { objectif: 'Service', specialite: 'Marchander' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Bluff' },
    resultat: 'Le résultat varie avec l’humeur',
  },
  {
    id: 'persifler',
    label: 'Persifler',
    influence: 'VIG',
    bonne: { objectif: 'Service ou renseignement', specialite: 'Persifler' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Bluff' },
    resultat: 'Dégrade l’humeur de l’adversaire en échange d’un service',
  },
  {
    id: 'seduire',
    label: 'Séduire',
    influence: 'PER',
    bonne: { objectif: 'Amitié', specialite: 'Séduire' },
    mauvaise: { objectif: 'Tromperie', specialite: 'Bluff' },
    resultat:
      'Augmente l’humeur du rang de Persuasion, plus le sexe ; l’humeur pourra être fixée par un « charmer » ultérieur',
  },
] as const;

/**
 * Les actions d'un round.
 *
 * `test` vide sur « Influence » n'est pas un oubli : cette action se joue avec
 * le test de la technique retenue, donc PER ou DUP selon l'intention. C'est le
 * `XLOOKUP` de la feuille, dit en clair.
 */
export const ACTIONS_INTRIGUE = [
  { id: 'assister', label: 'Assister', test: 'PER', contre: '', resultat: 'Plus 0,5 × le modificateur de Persuasion' },
  { id: 'reflechir', label: 'Réfléchir', test: '', contre: '', resultat: 'Plus 2 dés bonus pour l’échange suivant' },
  { id: 'embobiner', label: 'Embobiner', test: 'PER', contre: 'VOL', resultat: 'Perte de défense d’intrigue' },
  { id: 'manipuler', label: 'Manipuler', test: 'PER', contre: 'VOL', resultat: 'Choisit la technique d’influence de l’adversaire' },
  { id: 'calmer', label: 'Calmer', test: 'PER', contre: '', resultat: 'Regain de sang-froid égal au rang de Persuasion, + 1 par degré de réussite' },
  { id: 'comprendre', label: 'Comprendre', test: 'VIG', contre: 'DUP', resultat: 'Découvre l’humeur et la technique, et + 1D en Persuasion ou Duperie pour le reste de l’intrigue' },
  { id: 'rempart', label: 'Rempart', test: 'STA', contre: 'VOL', resultat: 'Humeur de l’adversaire + 1' },
  /*
   * « Se replier », et non « Replier » : le dictionnaire de traduction est une
   * table de correspondances exactes, et « Replier » y désigne déjà le bouton
   * qui referme le rail. L'action d'intrigue s'affichait donc « Collapse » au
   * milieu d'une liste française — une traduction fausse, ce qui est pire que
   * pas de traduction du tout. Deux sens, deux libellés ; l'identifiant, lui,
   * ne bouge pas, donc rien de ce qui est déjà noté ne se perd.
   */
  { id: 'replier', label: 'Se replier', test: 'VOL', contre: 'VOL', resultat: 'Le résultat du test devient la défense d’intrigue' },
  { id: 'influence', label: 'Influence', test: '', contre: 'VIG + ING + STA', resultat: 'Le test est celui de la technique retenue' },
  { id: 'bienseance', label: 'Bienséance (+dB)', test: 'STA', contre: 'VIG + ING + STA', resultat: 'Un dé bonus à placer dans l’intrigue, au début seulement' },
] as const;

const IDS_HUMEURS = new Set(HUMEURS_INTRIGUE.map((h) => h.id) as string[]);
const IDS_INTENTIONS = new Set(INTENTIONS.map((i) => i.id) as string[]);
const IDS_TECHNIQUES = new Set(TECHNIQUES.map((t) => t.id) as string[]);
const IDS_ACTIONS = new Set(ACTIONS_INTRIGUE.map((a) => a.id) as string[]);

/**
 * Ce que l'intrigue vaut, une fois la feuille et les choix réunis.
 *
 * Tout ce qui suit est calculé ; rien n'est demandé deux fois. Le modificateur
 * ne dépend que du couple (intention, humeur), donc du test : c'est très
 * exactement le double `XLOOKUP` de la colonne « Résultat » de la feuille, où
 * l'action ne sert qu'à retrouver son propre test.
 */
export function calculerIntrigue(feuille: Objet | null | undefined, choix: Objet): Objet {
  const humeur = HUMEURS_INTRIGUE.find((h) => h.id === choix.humeur) ?? null;
  const intention = INTENTIONS.find((i) => i.id === choix.intention) ?? null;
  const technique = TECHNIQUES.find((t) => t.id === choix.technique) ?? null;
  const chiffres = derives(feuille);

  const test = intention?.test ?? '';
  const modificateur = humeur ? (test === 'DUP' ? humeur.duperie : test === 'PER' ? humeur.persuasion : 0) : 0;

  const enCours = estObjet(choix.intrigue) ? choix.intrigue : {};
  const rounds = (Array.isArray(enCours.rounds) ? enCours.rounds : []).filter(estObjet);

  // Le modificateur d'un round suit le test de son action, pas celui de
  // l'intention : « Comprendre » se joue en Vigilance et ne gagne donc rien de
  // l'humeur, tandis qu'« Embobiner » profite du même bonus que l'intention.
  const modificateurDe = (idAction: string): number => {
    const action = ACTIONS_INTRIGUE.find((a) => a.id === idAction);
    if (!action || !humeur) return 0;
    const codeTest = action.test || test;
    if (codeTest === 'PER') return humeur.persuasion;
    if (codeTest === 'DUP') return humeur.duperie;
    return 0;
  };

  let pertes = 0;
  let regains = 0;
  let frustration = 0;
  const detail = rounds.map((round, index) => {
    pertes += versEntier(round.perte) ?? 0;
    regains += versEntier(round.calmer) ?? 0;
    if (round.frustration) frustration += 1;
    const lance = versEntier(round.lance);
    const bonus = modificateurDe(String(round.action ?? ''));
    return {
      round: index + 1,
      action: String(round.action ?? ''),
      modificateur: bonus,
      // Le total du round : le dé, plus ce que l'humeur en fait.
      resultat: lance === null ? null : lance + bonus,
    };
  });

  const parIntention =
    intention && technique
      ? (technique[intention.id] as { objectif: string; specialite: string })
      : null;

  return {
    test,
    rang: test ? rangDe(feuille, test) : 0,
    modificateur,
    objectif: parIntention?.objectif ?? '',
    specialite: parIntention?.specialite ?? '',
    // La compétence avec laquelle la cible résiste à la technique retenue.
    influence: technique?.influence ?? '',
    resultat_technique: technique?.resultat ?? '',
    defense: chiffres.defense_intrigue,
    // Le sang-froid est le point de départ ; ce qui reste tient compte des
    // coups encaissés et de ce qu'on a repris en se calmant.
    sang_froid: chiffres.sang_froid,
    sang_froid_restant: (chiffres.sang_froid as number) - pertes + regains,
    frustration,
    base_frustration: chiffres.base_frustration,
    // Passé ce seuil, le personnage cède : la feuille compte les rounds
    // frustrants contre le rang de Volonté.
    rompu: (chiffres.base_frustration as number) > 0 && frustration >= (chiffres.base_frustration as number),
    rounds: detail,
  };
}

/* --------------------------------------------------------------------------
 * Feuille d'armée — quatrième page du classeur
 *
 * Les compétences d'une armée : onze des dix-neuf, celles qui ont un sens pour
 * une troupe.
 *
 * Elles se posaient sur la **maison** au lot 24 — une seule ligne de rangs
 * pour toute la bannière. C'était une lecture trop rapide du classeur : une
 * maison n'a pas *une* armée mais des unités, et des piquiers levés à la
 * hâte n'ont ni le Tir des archers ni la Discipline des gardes. Depuis le lot
 * 25 les rangs vivent sur **l'unité**, avec le reste de sa ligne de bataille.
 * -------------------------------------------------------------------------- */

export const COMPETENCES_ARMEE = [
  'AGI',
  'ATH',
  'CAC',
  'DIS',
  'DRE',
  'END',
  'SOI',
  'SUR',
  'TIR',
  'VIG',
  'VOL',
].map((code) => ({
  id: code,
  label: COMPETENCES.find((c) => c.id === code)?.label ?? code,
}));

const CODES_ARMEE = new Set(COMPETENCES_ARMEE.map((c) => c.id));

/** `{ AGI: 3, ATH: 2 }` — les rangs à zéro ne sont pas écrits. */
export function normaliserCompetencesArmee(brut: unknown): Objet {
  if (!estObjet(brut)) return {};
  const resultat: Objet = {};
  for (const [code, valeur] of Object.entries(brut)) {
    if (!CODES_ARMEE.has(code)) continue;
    const rang = chiffre(valeur, 0, 20);
    if (rang) resultat[code] = rang;
  }
  return resultat;
}
