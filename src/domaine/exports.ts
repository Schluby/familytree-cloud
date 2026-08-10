/**
 * Mise à plat du jeu de données en tableaux, puis en CSV / XLSX.
 *
 * Port de `backend/exports.py`. Un seul endroit décrit les colonnes
 * (`tables()`), et tout le reste s'en sert : la vue « tableau » côté web,
 * l'export CSV, l'export Excel. Ajouter une colonne se fait donc une fois,
 * pas quatre.
 *
 * L'écriture du `.xlsx` est faite à la main (ZIP + XML) : un classeur Excel
 * est un simple conteneur OPC, et le projet tient à ne dépendre de rien.
 */

import * as humeur from './humeur';
import { appliquerSurcharges, calculerGenerations } from './genealogie';
import { Dataset, Objet, Personne } from './models';
import { archiver } from './zip';

export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MIME_CSV = 'text/csv; charset=utf-8';

export interface Colonne {
  id: string;
  label: string;
  type: 'texte' | 'nombre' | 'bool';
}

export interface Table {
  id: string;
  titre: string;
  colonnes: Colonne[];
  lignes: unknown[][];
}

const col = (id: string, label: string, type: Colonne['type'] = 'texte'): Colonne => ({
  id,
  label,
  type,
});

/**
 * Le rendu texte d'une valeur, tel que la version Python le produit.
 * `null` disparaît, un booléen devient un mot, une liste se joint au point
 * médian — c'est ce qu'on lit dans une cellule, pas du JSON.
 */
function texte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (Array.isArray(valeur)) return valeur.map((v) => String(v)).join(' · ');
  return String(valeur);
}

/* --------------------------------------------------------------------------
 * Les tableaux
 * -------------------------------------------------------------------------- */

export function tables(dataset: Dataset, secrets = true): Table[] {
  const relations = secrets ? [...dataset.relations] : dataset.relations.filter((r) => !r.secret);

  const generations = appliquerSurcharges(
    calculerGenerations(
      dataset.personnes.map((p) => p.id),
      relations
    ),
    dataset.personnes
  );

  const degres = new Map<string, number>(dataset.personnes.map((p) => [p.id, 0]));
  for (const relation of relations) {
    for (const extremite of [relation.source, relation.cible]) {
      if (degres.has(extremite)) degres.set(extremite, (degres.get(extremite) ?? 0) + 1);
    }
  }

  const noms = new Map<string, string>(dataset.personnes.map((p) => [p.id, p.nomComplet]));

  const compteTypes = new Map<string, number>();
  for (const relation of relations) {
    compteTypes.set(relation.type, (compteTypes.get(relation.type) ?? 0) + 1);
  }
  const compteMaisons = new Map<string, number>();
  for (const personne of dataset.personnes) {
    compteMaisons.set(personne.maison, (compteMaisons.get(personne.maison) ?? 0) + 1);
  }

  const personnes: Table = {
    id: 'personnes',
    titre: 'Personnes',
    colonnes: [
      col('id', 'Identifiant'),
      col('prenom', 'Prénom'),
      col('nom', 'Nom'),
      col('surnom', 'Surnom'),
      col('maison', 'Maison'),
      col('genre', 'Genre'),
      col('statut', 'Statut'),
      col('naissance', 'Naissance'),
      col('deces', 'Décès'),
      col('lieu', 'Lieu'),
      col('importance', 'Importance', 'nombre'),
      col('generation', 'Génération', 'nombre'),
      col('degre', 'Liens', 'nombre'),
      col('titres', 'Titres'),
      col('tags', 'Étiquettes'),
      col('notes', 'Notes'),
    ],
    lignes: dataset.personnes.map((personne) => [
      personne.id,
      personne.prenom,
      personne.nom,
      personne.surnom,
      dataset.maison(personne.maison).label ?? personne.maison,
      personne.genre,
      personne.statut,
      personne.naissance,
      personne.deces,
      personne.lieu,
      personne.importance,
      (generations.get(personne.id) ?? 0) + 1,
      degres.get(personne.id) ?? 0,
      texte(personne.titres),
      texte(personne.tags),
      personne.notes,
    ]),
  };

  const liens: Table = {
    id: 'relations',
    titre: 'Liens',
    colonnes: [
      col('id', 'Identifiant'),
      col('source_label', 'De'),
      col('cible_label', 'Vers'),
      col('type_label', 'Type'),
      col('categorie', 'Catégorie'),
      col('humeur', 'Humeur', 'nombre'),
      col('humeur_label', 'Humeur (mot)'),
      col('md', 'MD', 'nombre'),
      col('mp', 'MP', 'nombre'),
      col('dirige', 'Orienté', 'bool'),
      col('secret', 'Secret', 'bool'),
      col('label', 'Libellé'),
      col('notes', 'Notes'),
      col('depuis', 'Depuis'),
      col('jusqu_a', "Jusqu'à"),
      col('source', 'Id de départ'),
      col('cible', "Id d'arrivée"),
    ],
    lignes: relations.map((relation) => [
      relation.id,
      noms.get(relation.source) ?? relation.source,
      noms.get(relation.cible) ?? relation.cible,
      dataset.typeRelation(relation.type).label ?? relation.type,
      dataset.typeRelation(relation.type).categorie ?? 'autre',
      relation.humeur,
      humeur.label(relation.humeur),
      humeur.cran(relation.humeur).md,
      humeur.cran(relation.humeur).mp,
      dataset.estDirigee(relation),
      relation.secret,
      relation.label,
      relation.notes,
      relation.depuis,
      relation.jusqu_a,
      relation.source,
      relation.cible,
    ]),
  };

  const maisons: Table = {
    id: 'maisons',
    titre: 'Maisons',
    colonnes: [
      col('id', 'Identifiant'),
      col('label', 'Maison'),
      col('devise', 'Devise'),
      col('couleur', 'Couleur'),
      col('personnes', 'Personnes', 'nombre'),
    ],
    lignes: Object.entries(dataset.maisons).map(([maisonId, valeur]) => [
      maisonId,
      (valeur as Objet).label ?? maisonId,
      (valeur as Objet).devise ?? '',
      (valeur as Objet).couleur ?? '',
      compteMaisons.get(maisonId) ?? 0,
    ]),
  };

  const types: Table = {
    id: 'types',
    titre: 'Types de liens',
    colonnes: [
      col('id', 'Identifiant'),
      col('label', 'Type'),
      col('categorie', 'Catégorie'),
      col('dirige', 'Orienté', 'bool'),
      col('style', 'Style'),
      col('couleur', 'Couleur'),
      col('liens', 'Liens', 'nombre'),
    ],
    lignes: Object.entries(dataset.types_relations).map(([typeId, valeur]) => [
      typeId,
      (valeur as Objet).label ?? typeId,
      (valeur as Objet).categorie ?? 'autre',
      Boolean((valeur as Objet).dirige ?? false),
      (valeur as Objet).style ?? 'solide',
      (valeur as Objet).couleur ?? '',
      compteTypes.get(typeId) ?? 0,
    ]),
  };

  const regards: Table = {
    id: 'joueurs',
    titre: 'Regard des joueurs',
    colonnes: [
      col('personne', 'Personne'),
      col('joueur', 'Joueur'),
      col('personnage', 'Personnage joué'),
      col('note', 'Humeur', 'nombre'),
      col('note_label', 'Humeur (mot)'),
      col('md', 'MD', 'nombre'),
      col('mp', 'MP', 'nombre'),
      col('commentaire', 'Commentaire'),
    ],
    lignes: [],
  };

  const joueurs = new Map<string, Objet>(
    dataset.joueurs.map((j) => [String((j as Objet).id ?? ''), j as Objet])
  );
  for (const personne of dataset.personnes as Personne[]) {
    for (const [joueurId, avis] of Object.entries(personne.relations_joueurs || {})) {
      // Un avis vide n'est pas un avis : ni note, ni commentaire, ni ligne.
      if ((avis.note === null || avis.note === undefined) && !avis.commentaire) continue;
      const joueur = joueurs.get(joueurId) ?? {};
      regards.lignes.push([
        personne.nomComplet,
        joueur.nom ?? joueurId,
        joueur.personnage ?? '',
        avis.note ?? null,
        avis.note ? humeur.label(avis.note) : '',
        avis.note ? humeur.cran(avis.note).md : null,
        avis.note ? humeur.cran(avis.note).mp : null,
        avis.commentaire ?? '',
      ]);
    }
  }

  return [personnes, liens, maisons, types, regards];
}

export function table(dataset: Dataset, tableId: string, secrets = true): Table | null {
  return tables(dataset, secrets).find((candidate) => candidate.id === tableId) ?? null;
}

/* --------------------------------------------------------------------------
 * CSV
 * -------------------------------------------------------------------------- */

/** CSV point-virgule + BOM : ce qu'Excel francophone ouvre sans broncher. */
export function versCsv(table: Table): Uint8Array {
  const champ = (valeur: unknown): string => {
    const brut = texte(valeur);
    // Règle de `csv.writer` : on ne cite que si c'est nécessaire, et un
    // guillemet interne se double.
    return /[";\r\n]/.test(brut) ? `"${brut.replace(/"/g, '""')}"` : brut;
  };

  const lignes = [table.colonnes.map((colonne) => champ(colonne.label)).join(';')];
  for (const ligne of table.lignes) lignes.push(ligne.map(champ).join(';'));

  const corps = lignes.join('\r\n') + '\r\n';
  const octets = new TextEncoder().encode(corps);
  // Le BOM : sans lui, Excel lit l'UTF-8 comme du latin-1 et massacre les
  // accents dès la première colonne.
  const sortie = new Uint8Array(octets.length + 3);
  sortie.set([0xef, 0xbb, 0xbf], 0);
  sortie.set(octets, 3);
  return sortie;
}

/* --------------------------------------------------------------------------
 * XLSX (conteneur OPC écrit à la main)
 * -------------------------------------------------------------------------- */

const NS_TABLEUR = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_RELATIONS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function echapper(brut: unknown): string {
  const sortie = String(brut)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Excel refuse les caractères de contrôle ; on les remplace par un espace.
  return [...sortie]
    .map((c) => (c >= ' ' || c === '\t' || c === '\n' ? c : ' '))
    .join('');
}

/** 0 → A, 25 → Z, 26 → AA. */
function colonneExcel(index: number): string {
  let lettres = '';
  let n = index + 1;
  while (n) {
    const reste = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    lettres = String.fromCharCode(65 + reste) + lettres;
  }
  return lettres;
}

/** 31 caractères maximum, sans les caractères interdits par Excel. */
function nomFeuille(titre: string, pris: string[]): string {
  const nettoye = [...titre].map((c) => ('[]:*?/\\'.includes(c) ? ' ' : c)).join('');
  let nom = nettoye.slice(0, 31).trim() || 'Feuille';
  const base = nom;
  let compteur = 2;
  while (pris.includes(nom)) {
    const suffixe = ` ${compteur}`;
    nom = base.slice(0, 31 - suffixe.length) + suffixe;
    compteur += 1;
  }
  return nom;
}

function cellule(reference: string, valeur: unknown, colonne: Colonne, style = 0): string {
  const attributStyle = style ? ` s="${style}"` : '';
  if (colonne.type === 'nombre' && typeof valeur === 'number' && Number.isFinite(valeur)) {
    return `<c r="${reference}"${attributStyle}><v>${valeur}</v></c>`;
  }
  const contenu = texte(valeur);
  if (!contenu) return `<c r="${reference}"${attributStyle}/>`;
  return (
    `<c r="${reference}"${attributStyle} t="inlineStr">` +
    `<is><t xml:space="preserve">${echapper(contenu)}</t></is></c>`
  );
}

function feuille(table: Table): string {
  const largeurs = table.colonnes.map((colonne, index) => {
    // 400 lignes suffisent à deviner une largeur ; au-delà on paierait un
    // parcours complet du tableau pour un ajustement que personne ne voit.
    const tailles = [colonne.label.length, ...table.lignes.slice(0, 400).map((l) => texte(l[index]).length)];
    const largeur = Math.min(52, Math.max(9, Math.max(...tailles) + 2));
    return `<col min="${index + 1}" max="${index + 1}" width="${largeur}" customWidth="1"/>`;
  });

  const lignes = [
    '<row r="1">' +
      table.colonnes
        .map((c, i) => cellule(`${colonneExcel(i)}1`, c.label, { ...c, type: 'texte' }, 1))
        .join('') +
      '</row>',
  ];
  table.lignes.forEach((ligne, index) => {
    const numero = index + 2;
    const cellules = ligne
      .map((valeur, i) => cellule(`${colonneExcel(i)}${numero}`, valeur, table.colonnes[i]!))
      .join('');
    lignes.push(`<row r="${numero}">${cellules}</row>`);
  });

  const derniere = colonneExcel(Math.max(0, table.colonnes.length - 1));
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="${NS_TABLEUR}">` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<cols>${largeurs.join('')}</cols>` +
    `<sheetData>${lignes.join('')}</sheetData>` +
    `<autoFilter ref="A1:${derniere}${table.lignes.length + 1}"/>` +
    '</worksheet>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<styleSheet xmlns="${NS_TABLEUR}">` +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF1F2430"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE9E4DA"/>' +
  '<bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" ' +
  'applyFont="1" applyFill="1"/>' +
  '</cellXfs>' +
  '</styleSheet>';

/** Un classeur, une feuille par tableau. Sans dépendance externe. */
export async function versXlsx(tablesAEcrire: Table[]): Promise<Uint8Array> {
  const pris: string[] = [];
  const feuilles = tablesAEcrire.map((table, position) => {
    const nom = nomFeuille(table.titre, pris);
    pris.push(nom);
    return { nom, index: position + 1, table };
  });

  const types = feuilles
    .map(
      (f) =>
        `<Override PartName="/xl/worksheets/sheet${f.index}.xml" ` +
        'ContentType="application/vnd.openxmlformats-officedocument.' +
        'spreadsheetml.worksheet+xml"/>'
    )
    .join('');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-' +
    'package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.' +
    'openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.' +
    'openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    `${types}</Types>`;

  const racineRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${NS_RELATIONS}/officeDocument" ` +
    'Target="xl/workbook.xml"/></Relationships>';

  const onglets = feuilles
    .map((f) => `<sheet name="${echapper(f.nom)}" sheetId="${f.index}" r:id="rId${f.index}"/>`)
    .join('');
  const classeur =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<workbook xmlns="${NS_TABLEUR}" xmlns:r="${NS_RELATIONS}">` +
    `<sheets>${onglets}</sheets></workbook>`;

  const liens = feuilles
    .map(
      (f) =>
        `<Relationship Id="rId${f.index}" Type="${NS_RELATIONS}/worksheet" ` +
        `Target="worksheets/sheet${f.index}.xml"/>`
    )
    .join('');
  const classeurRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    liens +
    `<Relationship Id="rId${feuilles.length + 1}" Type="${NS_RELATIONS}/styles" ` +
    'Target="styles.xml"/></Relationships>';

  return archiver([
    { nom: '[Content_Types].xml', contenu: contentTypes },
    { nom: '_rels/.rels', contenu: racineRels },
    { nom: 'xl/workbook.xml', contenu: classeur },
    { nom: 'xl/_rels/workbook.xml.rels', contenu: classeurRels },
    { nom: 'xl/styles.xml', contenu: STYLES },
    ...feuilles.map((f) => ({
      nom: `xl/worksheets/sheet${f.index}.xml`,
      contenu: feuille(f.table),
    })),
  ]);
}
