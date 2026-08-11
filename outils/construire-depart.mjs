#!/usr/bin/env node
/**
 * Construit la sauvegarde de départ « Westeros » livrée à tout nouveau compte.
 *
 *   node outils/construire-depart.mjs
 *
 * Elle part du jeu de données de la version locale
 * (`../FamilyTree_GOT/data/sauvegardes/family-tree-got.json`), en retire ce qui
 * était du bricolage d'essai, puis l'enrichit pour que **chaque possibilité de
 * l'application se voie sans avoir à la chercher** : des âges qui vieillissent
 * avec la campagne, des rangs de maison, des liens révolus, des pastilles, des
 * événements passés, et des fiches de maison remplies.
 *
 * Le résultat est écrit dans `src/depart/westeros.json` et **versionné** : le
 * Worker l'importe directement, il ne va jamais lire le dépôt local. Ce script
 * n'existe que pour pouvoir refaire le travail si le jeu de données de départ
 * bouge — ce n'est pas une étape de compilation.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..');
const SOURCE = resolve(RACINE, '../FamilyTree_GOT/data/sauvegardes/family-tree-got.json');
const CIBLE = resolve(RACINE, 'src/depart/westeros.json');

/** L'année où se tient la campagne : c'est elle qui donne son âge à chacun. */
const ANNEE = '300 AC';

/* --------------------------------------------------------------------------
 * 1. Ce qui sort — les essais laissés dans le fichier local
 * -------------------------------------------------------------------------- */

const A_RETIRER = new Set(['test-prenom-test-nom', 'e', 'targ-test', 'j', 'max-s']);

/* --------------------------------------------------------------------------
 * 2. Naissances
 *
 * Sans année de naissance, une fiche n'a pas d'âge et la date de campagne ne
 * sert à rien. On complète les personnages dont l'âge est connu ou déductible ;
 * les autres restent vides — c'est un état légitime, et la fiche le dit.
 * -------------------------------------------------------------------------- */

const NAISSANCES = {
  'rickard-stark': '232 AC',
  'brandon-stark-aine': '262 AC',
  'lyanna-stark': '266 AC',
  'benjen-stark': '267 AC',
  'rickon-stark': '294 AC',
  'jon-snow': '283 AC',
  'hoster-tully': '236 AC',
  'edmure-tully': '267 AC',
  'brynden-tully': '238 AC',
  'lysa-arryn': '266 AC',
  'jon-arryn': '219 AC',
  'robin-arryn': '292 AC',
  'joanna-lannister': '245 AC',
  'kevan-lannister': '244 AC',
  'stannis-baratheon': '264 AC',
  'renly-baratheon': '277 AC',
  'joffrey-baratheon': '286 AC',
  'myrcella-baratheon': '290 AC',
  'tommen-baratheon': '291 AC',
  'shireen-baratheon': '289 AC',
  gendry: '285 AC',
  'davos-seaworth': '260 AC',
  'aerys-targaryen': '244 AC',
  'rhaegar-targaryen': '259 AC',
  'viserys-targaryen': '276 AC',
  drogo: '270 AC',
  'elia-martell': '257 AC',
  'oberyn-martell': '258 AC',
  'doran-martell': '250 AC',
  'olenna-tyrell': '228 AC',
  'mace-tyrell': '258 AC',
  'margaery-tyrell': '283 AC',
  'loras-tyrell': '282 AC',
  'balon-greyjoy': '253 AC',
  'theon-greyjoy': '282 AC',
  'yara-greyjoy': '277 AC',
  'euron-greyjoy': '256 AC',
  'roose-bolton': '258 AC',
  'ramsay-bolton': '281 AC',
  'walder-frey': '208 AC',
  'petyr-baelish': '268 AC',
  varys: '257 AC',
  melisandre: '250 AC',
  bronn: '270 AC',
  shae: '280 AC',
  'barristan-selmy': '237 AC',
  'sandor-clegane': '270 AC',
  'gregor-clegane': '264 AC',
  'jorah-mormont': '263 AC',
  'jeor-mormont': '235 AC',
  'brienne-tarth': '280 AC',
  'samwell-tarly': '283 AC',
  ygritte: '281 AC',
  'mance-rayder': '250 AC',
  tormund: '265 AC',
};

/** Rickon est marqué mort sans année : la campagne le situe en 300 AC. */
const DECES = { 'rickon-stark': '300 AC' };

/* --------------------------------------------------------------------------
 * 3. Rangs — les tags que l'application sait lire (lot 8.C)
 * -------------------------------------------------------------------------- */

const CHEFS = [
  'sansa-stark',
  'edmure-tully',
  'robin-arryn',
  'cersei-lannister',
  'tommen-baratheon',
  'daenerys-targaryen',
  'mace-tyrell',
  'doran-martell',
  'euron-greyjoy',
  'ramsay-bolton',
  'walder-frey',
  'jeor-mormont',
];

const HERITIERS = [
  'bran-stark',
  'tyrion-lannister',
  'myrcella-baratheon',
  'margaery-tyrell',
  'yara-greyjoy',
  'jorah-mormont',
];

/* --------------------------------------------------------------------------
 * 4. Pastilles et liens révolus
 *
 * Volontairement **une poignée** et pas tout le catalogue : la pastille doit se
 * remarquer. Un plan où chaque trait porte un emoji ne dit plus rien.
 * -------------------------------------------------------------------------- */

/** `source|cible` → emoji. */
const PASTILLES = {
  'tyrion-lannister|bronn': '💰',
  'jaime-lannister|brienne-tarth': '💰',
  'tywin-lannister|olenna-tyrell': '🤝',
  'jon-snow|daenerys-targaryen': '🤝',
  'robb-stark|edmure-tully': '🤝',
  'yara-greyjoy|daenerys-targaryen': '🤝',
  'walder-frey|robb-stark': '💍',
  'sansa-stark|joffrey-baratheon': '💍',
  'doran-martell|myrcella-baratheon': '💍',
  'roose-bolton|robb-stark': '🩸',
  'walder-frey|robb-stark|trahison': '🩸',
  'theon-greyjoy|robb-stark': '🩸',
  'euron-greyjoy|balon-greyjoy': '🩸',
  'ramsay-bolton|roose-bolton': '🩸',
  'tyrion-lannister|tywin-lannister': '🩸',
  'jaime-lannister|aerys-targaryen': '🗡️',
  'petyr-baelish|lysa-arryn': '🗝️',
  'petyr-baelish|varys': '🗝️',
  'varys|jorah-mormont': '🗝️',
  'jon-arryn|cersei-lannister': '🗝️',
  'oberyn-martell|gregor-clegane': '⚔️',
  'robert-baratheon|rhaegar-targaryen': '⚔️',
  'stannis-baratheon|renly-baratheon': '⚔️',
  'arya-stark|walder-frey': '⚔️',
  'sandor-clegane|gregor-clegane': '⚔️',
  'jon-snow|tormund': '🕊️',
  'jaime-lannister|brienne-tarth|ami': '🕊️',
  'barristan-selmy|daenerys-targaryen': '👑',
  'tyrion-lannister|daenerys-targaryen': '👑',
  'jorah-mormont|daenerys-targaryen': '👑',
};

/**
 * Liens qui ont existé et n'existent plus. C'est le cœur du curseur « révolus »
 * du rail : les masquer laisse le présent, les montrer explique le passé.
 */
const REVOLUS = new Set([
  'walder-frey|robb-stark|allie',
  'sandor-clegane|joffrey-baratheon|vassal',
  'jaime-lannister|aerys-targaryen|vassal',
  'barristan-selmy|robert-baratheon|vassal',
  'brienne-tarth|renly-baratheon|vassal',
  'roose-bolton|eddard-stark|vassal',
  'robb-stark|theon-greyjoy|ami',
  'mance-rayder|ygritte|vassal',
  'brienne-tarth|catelyn-stark|vassal',
]);

/* --------------------------------------------------------------------------
 * 5. Événements passés — le type de lien « historique » du lot 8.D
 * -------------------------------------------------------------------------- */

const TYPE_HISTORIQUE = {
  label: 'Événement passé',
  couleur: '#9a8c78',
  dirige: false,
  categorie: 'historique',
  style: 'pointille',
  ordre: 13,
};

const EVENEMENTS = [
  {
    id: 'ev-harrenhal',
    source: 'rhaegar-targaryen',
    cible: 'lyanna-stark',
    label: 'Tournoi de Harrenhal',
    notes: "La couronne d'amour et de beauté posée sur les genoux de la mauvaise femme.",
    depuis: '281 AC',
    jusqu_a: '281 AC',
    lieu: 'Harrenhal',
    emoji: '👑',
    humeur: 3,
  },
  {
    id: 'ev-trident',
    source: 'robert-baratheon',
    cible: 'rhaegar-targaryen',
    label: 'Bataille du Trident',
    notes: 'Le marteau contre le rubis. Fin de la dynastie Targaryen.',
    depuis: '283 AC',
    jusqu_a: '283 AC',
    lieu: 'Le Trident',
    emoji: '⚔️',
    humeur: 7,
  },
  {
    id: 'ev-sac-port-real',
    source: 'gregor-clegane',
    cible: 'elia-martell',
    label: 'Sac de Port-Réal',
    notes: 'Ce que Dorne n’a jamais pardonné, et que Port-Réal préfère oublier.',
    depuis: '283 AC',
    jusqu_a: '283 AC',
    lieu: 'Port-Réal',
    emoji: '🩸',
    humeur: 7,
  },
  {
    id: 'ev-nera',
    source: 'stannis-baratheon',
    cible: 'tyrion-lannister',
    label: 'Bataille de la Néra',
    notes: 'Le feu grégeois, la chaîne, et une main qui n’a jamais été remerciée.',
    depuis: '299 AC',
    jusqu_a: '299 AC',
    lieu: 'La Néra',
    emoji: '⚔️',
    humeur: 6,
  },
  {
    id: 'ev-noces-pourpres',
    source: 'walder-frey',
    cible: 'robb-stark',
    label: 'Noces Pourpres',
    notes: 'Le droit d’hôte violé aux Jumeaux. Le Nord s’en souvient.',
    depuis: '299 AC',
    jusqu_a: '299 AC',
    lieu: 'Les Jumeaux',
    emoji: '🩸',
    humeur: 7,
  },
  {
    id: 'ev-rebellion-greyjoy',
    source: 'robert-baratheon',
    cible: 'balon-greyjoy',
    label: 'Rébellion Greyjoy',
    notes: 'Pyk tombe ; Theon part vers le nord comme otage sous le nom de pupille.',
    depuis: '289 AC',
    jusqu_a: '289 AC',
    lieu: 'Pyk',
    emoji: '🤝',
    humeur: 6,
  },
];

/* --------------------------------------------------------------------------
 * 6. Les fiches de maison (lot 8.E)
 *
 * Les sept caractéristiques sont celles du JDR *Le Trône de Fer* (Green Ronin).
 * Les valeurs sont un point de départ jouable, pas un calcul officiel : une
 * table les retire ou les réécrit en deux clics.
 * -------------------------------------------------------------------------- */

const car = (defense, influence, terres, loi, population, pouvoir, richesse) => ({
  defense,
  influence,
  terres,
  loi,
  population,
  pouvoir,
  richesse,
});

const MAISONS = {
  stark: {
    caracteristiques: car(58, 42, 87, 34, 46, 62, 28),
    notes:
      'Le Nord est immense, pauvre et fidèle. Winterfell tient sur des sources chaudes et sur la parole donnée — les deux ont été entamées.',
    evenements: [
      {
        annee: '282 AC',
        titre: 'Rickard et Brandon brûlés à Port-Réal',
        texte:
          'Convoqués par Aerys II pour répondre d’une accusation inventée, exécutés devant la cour. Le Nord entre en rébellion.',
        lieu: 'Port-Réal',
        personnes: ['rickard-stark', 'brandon-stark-aine', 'aerys-targaryen'],
      },
      {
        annee: '298 AC',
        titre: 'Eddard nommé Main du Roi',
        texte:
          'Accepte par devoir ce que sa femme lui déconseille. Il ne reverra pas Winterfell.',
        lieu: 'Winterfell',
        personnes: ['eddard-stark', 'robert-baratheon', 'catelyn-stark'],
      },
      {
        annee: '299 AC',
        titre: 'Noces Pourpres',
        texte:
          'Le Roi du Nord, sa mère et son ost meurent sous le toit d’un vassal. La maison cesse d’exister comme puissance militaire.',
        lieu: 'Les Jumeaux',
        personnes: ['robb-stark', 'catelyn-stark', 'walder-frey', 'roose-bolton'],
      },
      {
        annee: '300 AC',
        titre: 'Winterfell reprise',
        texte: 'Les Bolton chassés. Sansa tient la place, Bran est ailleurs, Arya n’est pas rentrée.',
        lieu: 'Winterfell',
        personnes: ['sansa-stark', 'jon-snow', 'ramsay-bolton'],
      },
    ],
    liens: [
      { maison: 'tully', type: 'allie', label: 'Mariage d’Eddard et Catelyn' },
      { maison: 'bolton', type: 'vassal', label: 'Vassal du Nord', revolu: true },
      { maison: 'greyjoy', type: 'nemesis', label: 'Rébellion et prise de Winterfell' },
      { maison: 'baratheon', type: 'allie', label: 'Frères d’armes de la rébellion', revolu: true },
      { maison: 'frey', type: 'nemesis', label: 'Le droit d’hôte violé' },
    ],
  },
  lannister: {
    caracteristiques: car(64, 88, 61, 52, 58, 71, 97),
    notes:
      'Casterly Rock a payé la couronne, l’armée et la dette. Le crédit est immense et la mine est vide — personne à la cour ne le sait encore.',
    evenements: [
      {
        annee: '283 AC',
        titre: 'Sac de Port-Réal',
        texte:
          'Tywin arrive en allié et entre en pillard. Jaime tue le roi qu’il a juré de garder.',
        lieu: 'Port-Réal',
        personnes: ['tywin-lannister', 'jaime-lannister', 'gregor-clegane', 'elia-martell'],
      },
      {
        annee: '298 AC',
        titre: 'La vérité de Jon Arryn',
        texte:
          'La Main découvre que les enfants du roi ne sont pas de lui. Il meurt d’un mal soudain.',
        lieu: 'Port-Réal',
        personnes: ['jon-arryn', 'cersei-lannister', 'jaime-lannister'],
      },
      {
        annee: '300 AC',
        titre: 'Tywin tué par son fils',
        texte: 'Une arbalète, des latrines, et la fin de l’autorité qui tenait la maison debout.',
        lieu: 'Port-Réal',
        personnes: ['tyrion-lannister', 'tywin-lannister'],
      },
    ],
    liens: [
      { maison: 'baratheon', type: 'allie', label: 'Le mariage de Cersei et Robert' },
      { maison: 'tyrell', type: 'allie', label: 'Alliance de guerre, fragile des deux côtés' },
      { maison: 'stark', type: 'nemesis', label: 'De la Main emprisonnée aux Noces Pourpres' },
      { maison: 'martell', type: 'nemesis', label: 'Elia et ses enfants, jamais soldés' },
      { maison: 'frey', type: 'allie', label: 'L’accord préalable aux Noces' },
    ],
  },
  targaryen: {
    caracteristiques: car(22, 46, 8, 12, 15, 55, 19),
    notes:
      'Plus de terres, plus de vassaux, plus de trésor : trois dragons et un nom que trois cents ans n’ont pas effacé.',
    evenements: [
      {
        annee: '283 AC',
        titre: 'Fin de la dynastie',
        texte:
          'Rhaegar tombe au Trident, Aerys meurt sous l’épée de son garde. Les enfants survivants passent la mer.',
        lieu: 'Port-Réal',
        personnes: ['rhaegar-targaryen', 'aerys-targaryen', 'jaime-lannister'],
      },
      {
        annee: '298 AC',
        titre: 'Le mariage dothraki',
        texte:
          'Viserys vend sa sœur contre une armée. Il n’obtiendra qu’une couronne d’or fondu.',
        lieu: 'Pentos',
        personnes: ['viserys-targaryen', 'daenerys-targaryen', 'drogo'],
      },
    ],
    liens: [
      { maison: 'stark', type: 'nemesis', label: 'Rickard, Brandon, et Lyanna', revolu: true },
      { maison: 'baratheon', type: 'nemesis', label: 'La rébellion qui a pris le trône' },
      { maison: 'dothraki', type: 'allie', label: 'Le khalasar de Drogo' },
      { maison: 'martell', type: 'allie', label: 'Le mariage de Rhaegar et Elia', revolu: true },
    ],
  },
  baratheon: {
    caracteristiques: car(71, 76, 68, 41, 62, 74, 31),
    notes:
      'La couronne est portée par un enfant, contestée par un frère et payée par une autre maison. Accalmie tient toujours ; le reste est en jeu.',
    evenements: [
      {
        annee: '283 AC',
        titre: 'Robert prend le trône',
        texte: 'Une rébellion partie d’un enlèvement, gagnée au marteau, conclue par un mariage.',
        lieu: 'Port-Réal',
        personnes: ['robert-baratheon', 'eddard-stark', 'cersei-lannister'],
      },
      {
        annee: '298 AC',
        titre: 'La chasse au sanglier',
        texte: 'Trop de vin, une bête trop grosse, et une reine qui savait ce qu’elle versait.',
        lieu: 'Bois-du-Roi',
        personnes: ['robert-baratheon', 'cersei-lannister'],
      },
      {
        annee: '299 AC',
        titre: 'Guerre des deux frères',
        texte:
          'Stannis revendique par le droit, Renly par le nombre. Une ombre tranche le débat.',
        lieu: 'Accalmie',
        personnes: ['stannis-baratheon', 'renly-baratheon', 'melisandre', 'brienne-tarth'],
      },
    ],
    liens: [
      { maison: 'lannister', type: 'allie', label: 'Le mariage qui a payé la couronne' },
      { maison: 'stark', type: 'allie', label: 'L’amitié de Robert et Eddard', revolu: true },
      { maison: 'targaryen', type: 'nemesis', label: 'La dynastie renversée' },
      { maison: 'tyrell', type: 'allie', label: 'Renly, puis Margaery' },
    ],
  },
  tully: {
    caracteristiques: car(63, 51, 66, 47, 55, 49, 44),
    notes:
      'Vivesaigues tient un gué, donc une guerre sur deux. « Famille, devoir, honneur » — dans cet ordre, et c’est ce qui lui coûte.',
    evenements: [
      {
        annee: '282 AC',
        titre: 'Les deux mariages de la rébellion',
        texte:
          'Hoster achète l’alliance du Nord et du Val en mariant ses filles. Lysa n’a jamais accepté la sienne.',
        lieu: 'Vivesaigues',
        personnes: ['hoster-tully', 'catelyn-stark', 'lysa-arryn', 'jon-arryn'],
      },
      {
        annee: '299 AC',
        titre: 'Le mariage d’Edmure aux Jumeaux',
        texte: 'Le prix à payer pour un serment rompu par son neveu. Le piège se referme pendant la noce.',
        lieu: 'Les Jumeaux',
        personnes: ['edmure-tully', 'walder-frey', 'robb-stark'],
      },
    ],
    liens: [
      { maison: 'stark', type: 'allie', label: 'Catelyn à Winterfell' },
      { maison: 'arryn', type: 'allie', label: 'Lysa aux Eyrié' },
      { maison: 'frey', type: 'vassal', label: 'Vassal réticent depuis toujours' },
    ],
  },
  arryn: {
    caracteristiques: car(94, 58, 59, 44, 42, 46, 57),
    notes:
      'Les Eyrié ne se prennent pas : la seule route passe sous trois châteaux. Le Val est resté neutre pendant toute la guerre, et intact.',
    evenements: [
      {
        annee: '298 AC',
        titre: 'Mort de Jon Arryn',
        texte: 'Empoisonné par sa propre femme, qui accuse ensuite les Lannister par lettre.',
        lieu: 'Port-Réal',
        personnes: ['jon-arryn', 'lysa-arryn', 'petyr-baelish'],
      },
      {
        annee: '300 AC',
        titre: 'La Porte de la Lune',
        texte: 'Lysa tombe. Littlefinger devient protecteur du Val et tuteur de l’héritier.',
        lieu: 'Les Eyrié',
        personnes: ['lysa-arryn', 'petyr-baelish', 'robin-arryn', 'sansa-stark'],
      },
    ],
    liens: [
      { maison: 'tully', type: 'allie', label: 'Le mariage de Lysa' },
      { maison: 'stark', type: 'allie', label: 'Jon Arryn a élevé Eddard et Robert' },
    ],
  },
  greyjoy: {
    caracteristiques: car(66, 34, 38, 22, 31, 68, 26),
    notes:
      '« Nous ne semons pas. » Une flotte sans terres, une succession réglée à la hache, et une île qui n’a jamais accepté d’être une province.',
    evenements: [
      {
        annee: '289 AC',
        titre: 'La rébellion écrasée',
        texte: 'Balon perd deux fils et une guerre. Theon part vers Winterfell comme garantie.',
        lieu: 'Pyk',
        personnes: ['balon-greyjoy', 'theon-greyjoy', 'robert-baratheon', 'eddard-stark'],
      },
      {
        annee: '299 AC',
        titre: 'Winterfell prise, puis perdue',
        texte: 'Theon choisit son père contre son frère de lait, et n’obtient ni l’un ni l’autre.',
        lieu: 'Winterfell',
        personnes: ['theon-greyjoy', 'robb-stark', 'ramsay-bolton'],
      },
      {
        annee: '300 AC',
        titre: 'Euron revient',
        texte: 'Un frère jeté d’un pont, une assemblée retournée, une flotte neuve.',
        lieu: 'Pyk',
        personnes: ['euron-greyjoy', 'balon-greyjoy', 'yara-greyjoy'],
      },
    ],
    liens: [
      { maison: 'stark', type: 'nemesis', label: 'Otage, puis incendiaire' },
      { maison: 'lannister', type: 'allie', label: 'L’offre d’Euron à Cersei' },
      { maison: 'targaryen', type: 'allie', label: 'La flotte de Yara contre l’indépendance' },
    ],
  },
  bolton: {
    caracteristiques: car(72, 38, 54, 18, 37, 57, 33),
    notes:
      'Fort-Terreur écorche encore, discrètement. La maison a gagné le Nord par une trahison et le perd faute de savoir le tenir.',
    evenements: [
      {
        annee: '299 AC',
        titre: 'Le Nord contre une trahison',
        texte: 'Roose vend son roi à Tywin et repart gardien du Nord.',
        lieu: 'Les Jumeaux',
        personnes: ['roose-bolton', 'robb-stark', 'tywin-lannister'],
      },
      {
        annee: '300 AC',
        titre: 'Ramsay tue son père',
        texte: 'Un héritier légitime venait de naître. Il n’a pas vécu la journée.',
        lieu: 'Fort-Terreur',
        personnes: ['ramsay-bolton', 'roose-bolton'],
      },
    ],
    liens: [
      { maison: 'stark', type: 'vassal', label: 'Serment tenu pendant mille ans, puis non', revolu: true },
      { maison: 'lannister', type: 'allie', label: 'Le prix du Nord' },
      { maison: 'frey', type: 'allie', label: 'Complices des Noces' },
    ],
  },
  frey: {
    caracteristiques: car(68, 29, 47, 31, 63, 52, 61),
    notes:
      'Le pont rapporte plus que les terres. Quatre-vingt-dix descendants, aucun allié : tout le monde a besoin du gué, personne n’invite un Frey.',
    evenements: [
      {
        annee: '298 AC',
        titre: 'Le pacte du passage',
        texte: 'Robb obtient le gué contre la promesse d’épouser une Frey.',
        lieu: 'Les Jumeaux',
        personnes: ['walder-frey', 'robb-stark', 'catelyn-stark'],
      },
      {
        annee: '299 AC',
        titre: 'Noces Pourpres',
        texte: 'Le droit d’hôte violé sous son propre toit — ce que même ses alliés ne lui pardonnent pas.',
        lieu: 'Les Jumeaux',
        personnes: ['walder-frey', 'robb-stark', 'roose-bolton', 'edmure-tully'],
      },
    ],
    liens: [
      { maison: 'tully', type: 'vassal', label: 'Suzerain qu’il n’a jamais aimé' },
      { maison: 'stark', type: 'nemesis', label: 'Serment rompu des deux côtés' },
      { maison: 'lannister', type: 'allie', label: 'L’accord qui a payé les Noces' },
    ],
  },
  tyrell: {
    caracteristiques: car(59, 82, 91, 56, 88, 66, 84),
    notes:
      'Le Bief nourrit le royaume : c’est une arme plus sûre qu’une armée. Olenna le sait, son fils ne s’en doute pas.',
    evenements: [
      {
        annee: '299 AC',
        titre: 'Le camp choisi à la Néra',
        texte: 'La cavalerie du Bief arrive au bon moment et fixe le prix : une reine.',
        lieu: 'Port-Réal',
        personnes: ['mace-tyrell', 'margaery-tyrell', 'tywin-lannister'],
      },
      {
        annee: '300 AC',
        titre: 'La mort de Joffrey',
        texte: 'Un poison au mariage, une grand-mère qui ne laisse pas sa petite-fille à ce garçon-là.',
        lieu: 'Port-Réal',
        personnes: ['olenna-tyrell', 'joffrey-baratheon', 'margaery-tyrell'],
      },
    ],
    liens: [
      { maison: 'baratheon', type: 'allie', label: 'Renly d’abord, la couronne ensuite' },
      { maison: 'lannister', type: 'allie', label: 'Alliance de guerre, méfiance de cour' },
    ],
  },
  martell: {
    caracteristiques: car(77, 54, 73, 49, 44, 51, 48),
    notes:
      'Dorne n’a jamais été conquise, elle a été épousée. Elle attend depuis dix-sept ans, et elle est la seule à ne pas être pressée.',
    evenements: [
      {
        annee: '283 AC',
        titre: 'Elia et ses enfants',
        texte: 'Tués pendant le sac. Doran a choisi la patience, Oberyn la vengeance.',
        lieu: 'Port-Réal',
        personnes: ['elia-martell', 'gregor-clegane', 'oberyn-martell', 'doran-martell'],
      },
      {
        annee: '300 AC',
        titre: 'Le duel judiciaire',
        texte: 'La Vipère Rouge gagne le combat et perd le duel en voulant un aveu.',
        lieu: 'Port-Réal',
        personnes: ['oberyn-martell', 'gregor-clegane', 'tyrion-lannister'],
      },
    ],
    liens: [
      { maison: 'lannister', type: 'nemesis', label: 'Une dette de sang jamais soldée' },
      { maison: 'targaryen', type: 'allie', label: 'Le mariage de Rhaegar et Elia', revolu: true },
      { maison: 'baratheon', type: 'autre', label: 'Myrcella en pupille, ou en otage' },
    ],
  },
  nuit: {
    caracteristiques: car(81, 12, 26, 38, 19, 34, 9),
    notes:
      'Dix-neuf forts, trois occupés. La Garde ne prend pas parti dans les guerres du sud — et le sud a cessé de l’approvisionner.',
    evenements: [
      {
        annee: '299 AC',
        titre: 'Mutinerie à Manoir Craster',
        texte: 'Le Lord Commandant tué par ses propres frères jurés.',
        lieu: 'Au-delà du Mur',
        personnes: ['jeor-mormont', 'jon-snow', 'samwell-tarly'],
      },
      {
        annee: '300 AC',
        titre: 'Le poignard des frères',
        texte: 'Élu, puis frappé pour avoir laissé passer le peuple libre. « Pour la Garde. »',
        lieu: 'Châteaunoir',
        personnes: ['jon-snow', 'melisandre'],
      },
    ],
    liens: [
      { maison: 'stark', type: 'allie', label: 'Le Nord a toujours fourni la Garde' },
      { maison: 'libres', type: 'nemesis', label: 'Huit mille ans, puis une alliance forcée' },
    ],
  },
  libres: {
    caracteristiques: car(31, 8, 62, 6, 71, 58, 4),
    notes:
      'Cent clans qui ne se reconnaissent aucun roi, réunis une fois par siècle par ce qui les pousse vers le sud.',
    evenements: [
      {
        annee: '300 AC',
        titre: 'Passage du Mur',
        texte: 'Ce qu’aucun Lord Commandant n’avait accepté : les faire passer plutôt que les laisser mourir.',
        lieu: 'Fort-Levant',
        personnes: ['tormund', 'jon-snow', 'mance-rayder'],
      },
    ],
    liens: [{ maison: 'nuit', type: 'allie', label: 'Alliance contre ce qui vient', revolu: false }],
  },
  mormont: {
    caracteristiques: car(54, 27, 41, 43, 24, 39, 17),
    notes: 'L’Île-aux-Ours donne des combattants et peu d’autre chose. La parole y vaut titre.',
    evenements: [],
    liens: [{ maison: 'stark', type: 'vassal', label: 'Vassal du Nord, jamais pris en défaut' }],
  },
  clegane: {
    caracteristiques: car(28, 19, 17, 11, 9, 44, 14),
    notes: 'Trois générations, deux frères, une réputation. Chiens de la maison Lannister.',
    evenements: [],
    liens: [{ maison: 'lannister', type: 'vassal', label: 'Le bras armé de Tywin' }],
  },
  tarth: {
    caracteristiques: car(49, 23, 36, 46, 21, 26, 33),
    notes: 'L’Île de Saphir, plus riche en nom qu’en revenus. Une héritière unique, et un serment à la fois.',
    evenements: [],
    liens: [{ maison: 'baratheon', type: 'vassal', label: 'Vassal d’Accalmie' }],
  },
  tarly: {
    caracteristiques: car(57, 44, 52, 51, 39, 55, 42),
    notes: 'Corcolline compte parmi les meilleures épées du Bief. L’héritier a préféré les livres.',
    evenements: [],
    liens: [{ maison: 'tyrell', type: 'vassal', label: 'Vassal du Bief' }],
  },
  dothraki: {
    caracteristiques: car(14, 21, 44, 4, 66, 79, 23),
    notes: 'Un khalasar n’est pas une maison : il vaut ce que vaut son khal, et pas un jour de plus.',
    evenements: [],
    liens: [{ maison: 'targaryen', type: 'allie', label: 'Le khalasar de Drogo, puis celui de Daenerys' }],
  },
  autre: {
    caracteristiques: {},
    notes:
      'Fourre-tout : ceux dont le pouvoir ne vient pas d’une maison — un maître des chuchoteurs, une prêtresse, une épée à louer.',
    evenements: [],
    liens: [],
  },
};

/** Regroupements de maisons : un axe de couleur et de filtre de plus. */
const CATEGORIES = {
  grandes: { label: 'Grandes maisons', couleur: '#9c5c3c', ordre: 1 },
  vassales: { label: 'Maisons vassales', couleur: '#4a7d6a', ordre: 2 },
  ordres: { label: 'Ordres & peuples', couleur: '#5a6b8c', ordre: 3 },
};

const CATEGORIE_DE = {
  stark: 'grandes',
  lannister: 'grandes',
  baratheon: 'grandes',
  targaryen: 'grandes',
  tyrell: 'grandes',
  martell: 'grandes',
  arryn: 'grandes',
  tully: 'grandes',
  greyjoy: 'grandes',
  bolton: 'vassales',
  frey: 'vassales',
  mormont: 'vassales',
  clegane: 'vassales',
  tarth: 'vassales',
  tarly: 'vassales',
  nuit: 'ordres',
  libres: 'ordres',
  dothraki: 'ordres',
};

/* --------------------------------------------------------------------------
 * Construction
 * -------------------------------------------------------------------------- */

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));

// --- personnes -------------------------------------------------------------
const personnes = source.personnes.filter((p) => !A_RETIRER.has(p.id));

for (const personne of personnes) {
  if (!personne.naissance && NAISSANCES[personne.id]) personne.naissance = NAISSANCES[personne.id];
  if (!personne.deces && DECES[personne.id]) personne.deces = DECES[personne.id];

  const tags = Array.isArray(personne.tags) ? [...personne.tags] : [];
  if (CHEFS.includes(personne.id)) tags.push('chef de maison');
  if (HERITIERS.includes(personne.id)) tags.push('héritier');
  personne.tags = [...new Set(tags)];
}

// --- relations -------------------------------------------------------------
const relations = source.relations.filter(
  (r) => !A_RETIRER.has(r.source) && !A_RETIRER.has(r.cible)
);

for (const relation of relations) {
  const paire = `${relation.source}|${relation.cible}`;
  const precis = `${paire}|${relation.type}`;
  const emoji = PASTILLES[precis] ?? PASTILLES[paire];
  if (emoji) relation.emoji = emoji;
  if (REVOLUS.has(precis)) relation.revolu = true;
}

for (const evenement of EVENEMENTS) {
  relations.push({
    id: evenement.id,
    source: evenement.source,
    cible: evenement.cible,
    type: 'historique',
    humeur: evenement.humeur,
    label: evenement.label,
    notes: evenement.notes,
    secret: false,
    dirige: false,
    depuis: evenement.depuis,
    jusqu_a: evenement.jusqu_a,
    revolu: true,
    lieu: evenement.lieu,
    emoji: evenement.emoji,
  });
}

// --- maisons ---------------------------------------------------------------
const maisons = {};
for (const [id, fiche] of Object.entries(source.maisons)) {
  const enrichie = { ...fiche };
  const ajout = MAISONS[id];
  if (ajout) {
    if (Object.keys(ajout.caracteristiques).length) enrichie.caracteristiques = ajout.caracteristiques;
    if (ajout.notes) enrichie.notes = ajout.notes;
    if (ajout.evenements?.length) enrichie.evenements = ajout.evenements;
    if (ajout.liens?.length) enrichie.liens = ajout.liens;
  }
  if (CATEGORIE_DE[id]) enrichie.categorie = CATEGORIE_DE[id];
  maisons[id] = enrichie;
}

// --- types de liens --------------------------------------------------------
const types = { ...source.types_relations, historique: TYPE_HISTORIQUE };

// --- joueurs ---------------------------------------------------------------
// Les quatre joueurs restent : leurs notes sur cinquante fiches sont la seule
// démonstration vivante du système d'humeur par joueur. Seuls les noms de la
// table de Maxime s'en vont, avec le renvoi vers une fiche qui n'existe plus.
const joueurs = source.joueurs.map((joueur, index) => ({
  id: joueur.id,
  nom: `Joueur ${index + 1}`,
  personnage: joueur.personnage,
  couleur: joueur.couleur,
}));

// --- document --------------------------------------------------------------
const document = {
  meta: {
    titre: 'Westeros — sociogramme de départ',
    description:
      'Le Trône de Fer en soixante-sept fiches : filiations, alliances, trahisons, et ce que chaque maison possède. Modifiez tout — c’est votre copie.',
    univers: 'Le Trône de Fer',
    version: 1,
    sauvegarde: 'Westeros',
    schema: 2,
    // La date de la campagne : c'est elle qui donne son âge à chaque fiche.
    annee_courante: ANNEE,
    // Volontairement vide : cette sauvegarde part chez des inconnus, elle ne
    // renvoie vers le document de campagne de personne.
    document: '',
  },
  types_relations: types,
  maisons,
  categories: CATEGORIES,
  filtres: source.filtres,
  joueurs,
  personnes,
  relations,
};

mkdirSync(dirname(CIBLE), { recursive: true });
writeFileSync(CIBLE, `${JSON.stringify(document, null, 1)}\n`, 'utf8');

const octets = Buffer.byteLength(JSON.stringify(document));
const avecEmoji = relations.filter((r) => r.emoji).length;
const revolus = relations.filter((r) => r.revolu).length;

console.log(`écrit  : ${CIBLE}`);
console.log(`taille : ${(octets / 1024).toFixed(1)} Ko (compact)`);
console.log(`fiches : ${personnes.length}   liens : ${relations.length}`);
console.log(`maisons: ${Object.keys(maisons).length}   types : ${Object.keys(types).length}`);
console.log(`pastilles : ${avecEmoji}   liens révolus : ${revolus}`);
console.log(
  `rangs  : ${personnes.filter((p) => p.tags.includes('chef de maison')).length} chefs, ` +
    `${personnes.filter((p) => p.tags.includes('héritier')).length} héritiers`
);
