/**
 * Le document d'une sauvegarde : tout ce qui décide de ce qui entre en base.
 *
 * Un seul endroit, exprès. Créer, importer et remplacer un contenu passent
 * tous par `preparerDocument` — donc une règle ajoutée ici (retirer un champ,
 * normaliser une valeur) s'applique aux trois sans qu'on ait à y penser.
 *
 * Ce que le lot 2 fait **et ne fait pas** : il valide la forme générale et
 * retire les portraits `data:`, mais il ne normalise pas encore les personnes
 * et les relations — c'est `models.ts`, au lot 3. Le document est donc stocké
 * tel qu'il arrive, comme le fait le fichier local. Quand `models.ts` existera,
 * il se branchera **ici**, en une ligne.
 */

export type Document = Record<string, unknown>;

export const ERREUR_FORME =
  "ce fichier n'est pas une sauvegarde : il lui manque une liste « personnes »";

/**
 * Même critère que l'application locale (`bibliotheque.importer`) : un objet
 * qui porte une liste `personnes`. Volontairement large — refuser un document
 * un peu exotique serait pire que l'accepter, puisqu'il n'y a pas de perte.
 */
export function estDocument(valeur: unknown): valeur is Document {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return false;
  return Array.isArray((valeur as Document).personnes);
}

export interface DocumentPrepare {
  /** Le JSON **compact** : c'est lui qui part en base. */
  texte: string;
  /** Sa taille réelle en octets UTF-8 — la seule qui compte pour le plafond. */
  octets: number;
  personnes: number;
  relations: number;
  schemaVersion: number;
  /** Nombre de portraits `data:` retirés, à annoncer à l'utilisateur. */
  portraitsRetires: number;
  /** `meta.sauvegarde` ou `meta.titre`, s'ils existent : sert de nom par défaut. */
  nomInterne: string;
}

const encodeur = new TextEncoder();

export function preparerDocument(document: Document): DocumentPrepare {
  const portraitsRetires = retirerPortraits(document);
  const texte = JSON.stringify(document);

  return {
    texte,
    octets: encodeur.encode(texte).length,
    personnes: Array.isArray(document.personnes) ? document.personnes.length : 0,
    relations: Array.isArray(document.relations) ? document.relations.length : 0,
    schemaVersion: lireSchema(document),
    portraitsRetires,
    nomInterne: lireNomInterne(document),
  };
}

/**
 * La version hébergée ne stocke pas les portraits (décision du 06/08/2026, voir
 * ARCHITECTURE.md) : une image collée dans une fiche pèse à elle seule plus que
 * tout le reste du document. Un `avatar` qui pointe vers une adresse http(s)
 * est gardé — c'est le navigateur qui va la chercher, ça ne coûte rien ici.
 *
 * On ne supprime pas la fiche, on ne refuse pas l'import : on vide le champ et
 * on dit combien de portraits sont partis.
 */
function retirerPortraits(document: Document): number {
  const personnes = document.personnes;
  if (!Array.isArray(personnes)) return 0;

  let retires = 0;
  for (const personne of personnes) {
    if (typeof personne !== 'object' || personne === null) continue;
    const fiche = personne as Record<string, unknown>;
    const avatar = fiche.avatar;
    if (typeof avatar === 'string' && /^\s*data:/i.test(avatar)) {
      fiche.avatar = '';
      retires += 1;
    }
  }
  return retires;
}

function lireSchema(document: Document): number {
  const meta = document.meta;
  if (typeof meta !== 'object' || meta === null) return 1;
  const brut = (meta as Record<string, unknown>).schema;
  const valeur = typeof brut === 'number' ? brut : Number.parseInt(String(brut ?? ''), 10);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 1;
}

function lireNomInterne(document: Document): string {
  const meta = document.meta;
  if (typeof meta !== 'object' || meta === null) return '';
  const champs = meta as Record<string, unknown>;
  for (const cle of ['sauvegarde', 'titre']) {
    const valeur = champs[cle];
    if (typeof valeur === 'string' && valeur.trim()) return valeur.trim();
  }
  return '';
}

/**
 * L'export : le document réindenté, avec le nom du moment.
 *
 * Le nom de référence est la colonne `sauvegardes.nom`, pas `meta.sauvegarde` —
 * sinon renommer imposerait de relire, reparser et réécrire tout le document
 * pour un simple libellé. On ne recolle les deux qu'ici, au moment où le
 * fichier quitte le service et doit se suffire à lui-même.
 *
 * Deux espaces d'indentation et un saut de ligne final : les mêmes que
 * `ecrire_json` en local, pour que les fichiers se comparent sans bruit.
 */
export function reindenter(texteCompact: string, nom: string): string {
  const document = JSON.parse(texteCompact) as Document;
  if (typeof document.meta !== 'object' || document.meta === null) document.meta = {};
  (document.meta as Record<string, unknown>).sauvegarde = nom;
  return JSON.stringify(document, null, 2) + '\n';
}

/** Nom de fichier lisible : « Les Sept Couronnes » → « les-sept-couronnes ». */
export function slugifier(texte: string, defaut = 'sauvegarde'): string {
  const propre = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // les accents décomposés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return propre || defaut;
}
