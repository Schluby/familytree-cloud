/* Rendu Markdown, écrit ici et pas ailleurs.
 *
 * Trois raisons de ne pas prendre une bibliothèque :
 *
 * - la politique de sécurité de la page interdit tout script venu d'un autre
 *   hôte (`script-src 'self'`), donc pas de CDN ;
 * - embarquer un rendu complet, c'est cent kilo-octets pour douze règles ;
 * - un rendu maison **échappe d'abord et balise ensuite**, dans cet ordre, et
 *   c'est la seule propriété qui compte : le texte d'une note vient de
 *   quelqu'un, et il ne doit jamais pouvoir devenir du HTML.
 *
 * Ce qui est reconnu, et rien d'autre : titres `#` à `######`, gras, italique,
 * barré, code (en ligne et en bloc), citations `>`, listes à puces et
 * numérotées (deux niveaux), tableaux `|`, filets `---`, liens `[texte](url)`
 * en http(s) seulement, et les balises du carnet (`@p:`, `@m:`, `@j:`, `@l:`).
 *
 * **Pas d'images.** Ce n'est pas un oubli : la version en ligne n'héberge pas
 * d'images, et `![](data:…)` serait la porte par laquelle une note de séance
 * pèserait deux mégaoctets. Une adresse d'image reste un lien, cliquable.
 */

/** Reprise de `carnet.ts` — la même grammaire des deux côtés du fil. */
export const BALISE = /@([pmjl]):([A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?)/g;

export const ICONE_GENRE = { p: '👤', m: '⛨', j: '🎲', l: '⇄' };

function echapper(texte) {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* --------------------------------------------------------------------- inline */

/**
 * Deux mises à l'écart avant de baliser quoi que ce soit.
 *
 * Le **code en ligne** part en premier : sans ça, les `**` d'un
 * `` `exemple **litteral**` `` deviendraient du gras. Les **balises** partent
 * ensuite : le HTML qu'elles produisent porte des `_` et des `*` dans les
 * identifiants et dans les noms, et les passes de gras et d'italique le
 * mordraient. Les deux reviennent à la fin, intacts.
 *
 * Le jeton de mise à l'écart s'écrit `<c0>`, `<b0>` — et il est sûr **parce
 * que l'échappement a déjà eu lieu** : à ce stade, le seul `<` que le texte
 * puisse contenir est un `<` qu'on vient d'écrire soi-même. Quelqu'un qui
 * taperait `<b0>` dans sa note l'a vu devenir `&lt;b0&gt;` une ligne plus tôt.
 */
function inline(source, contexte) {
  let texte = echapper(source);

  const codes = [];
  texte = texte.replace(/`([^`\n]+)`/g, (_tout, contenu) => {
    codes.push(contenu); // déjà échappé, comme tout le reste
    return `<c${codes.length - 1}>`;
  });

  const balises = [];
  texte = texte.replace(BALISE, (_tout, genre, id) => {
    balises.push(baliseHtml(genre, id, contexte));
    return `<b${balises.length - 1}>`;
  });

  texte = texte
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (tout, libelle, adresse) => {
      // Seul http(s) : `javascript:` n'a rien à faire dans une note de séance.
      if (!/^https?:\/\//i.test(adresse)) return tout;
      return `<a href="${adresse}" target="_blank" rel="noopener noreferrer">${libelle}</a>`;
    });

  return texte
    .replace(/<b(\d+)>/g, (_tout, rang) => balises[Number(rang)])
    .replace(/<c(\d+)>/g, (_tout, rang) => `<code>${codes[Number(rang)]}</code>`);
}

/**
 * Une balise devient une pastille cliquable.
 *
 * `data-rang` compte les apparitions **de cette cible-là** dans la note, à
 * partir de 1 : c'est exactement ce que numérote l'index inverse du serveur
 * (`carnet.ts`), et c'est donc l'ancre sur laquelle une citation vient
 * atterrir depuis la fiche d'un profil. Les deux comptes doivent rester
 * d'accord — s'ils se séparent, une citation ouvre la bonne note au mauvais
 * endroit.
 */
function baliseHtml(genre, id, contexte) {
  const libelle = contexte.libelle?.(genre, id) ?? null;
  const cle = `${genre}:${id}`;
  const rang = (contexte.rangs[cle] = (contexte.rangs[cle] ?? 0) + 1);
  const perdue = libelle === null;
  return (
    `<button type="button" class="balise balise-${genre}${perdue ? ' balise-perdue' : ''}"` +
    ` data-genre="${genre}" data-id="${echapper(id)}" data-rang="${rang}"` +
    ` title="${perdue ? 'Cette fiche n’existe plus' : echapper(libelle)}">` +
    `<span class="balise-ico">${ICONE_GENRE[genre] ?? '◆'}</span>` +
    `${echapper(libelle ?? id)}</button>`
  );
}

/* ---------------------------------------------------------------------- blocs */

const FILET = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TITRE = /^(#{1,6})\s+(.*)$/;
const PUCE = /^(\s*)[-*+]\s+(.*)$/;
const NUMERO = /^(\s*)\d+[.)]\s+(.*)$/;
const CITATION = /^\s*>\s?(.*)$/;
const LIGNE_TABLE = /^\s*\|(.+)\|\s*$/;
const SEPARATEUR_TABLE = /^\s*\|[\s:|-]+\|\s*$/;

function cellules(ligne) {
  return ligne
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cellule) => cellule.trim());
}

function alignements(ligne) {
  return cellules(ligne).map((marque) => {
    const gauche = marque.startsWith(':');
    const droite = marque.endsWith(':');
    if (gauche && droite) return ' style="text-align:center"';
    if (droite) return ' style="text-align:right"';
    return '';
  });
}

/** Le Markdown d'une note en HTML. Tout est échappé avant d'être balisé. */
export function versHtml(source, options = {}) {
  const contexte = { libelle: options.libelle, rangs: {} };
  const lignes = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const sortie = [];
  let index = 0;

  const paragraphe = [];
  const viderParagraphe = () => {
    if (!paragraphe.length) return;
    sortie.push(`<p>${paragraphe.map((l) => inline(l, contexte)).join('<br>')}</p>`);
    paragraphe.length = 0;
  };

  while (index < lignes.length) {
    const ligne = lignes[index];

    // bloc de code : rien n'y est interprété, pas même les balises
    if (/^\s*```/.test(ligne)) {
      viderParagraphe();
      const langue = ligne.replace(/^\s*```/, '').trim();
      const contenu = [];
      index += 1;
      while (index < lignes.length && !/^\s*```/.test(lignes[index])) {
        contenu.push(lignes[index]);
        index += 1;
      }
      index += 1; // la clôture
      sortie.push(
        `<pre class="md-code"${langue ? ` data-langue="${echapper(langue)}"` : ''}>` +
          `<code>${echapper(contenu.join('\n'))}</code></pre>`
      );
      continue;
    }

    if (!ligne.trim()) {
      viderParagraphe();
      index += 1;
      continue;
    }

    if (FILET.test(ligne)) {
      viderParagraphe();
      sortie.push('<hr>');
      index += 1;
      continue;
    }

    const titre = ligne.match(TITRE);
    if (titre) {
      viderParagraphe();
      const niveau = titre[1].length;
      sortie.push(`<h${niveau}>${inline(titre[2], contexte)}</h${niveau}>`);
      index += 1;
      continue;
    }

    // tableau : une ligne de cellules **suivie** d'une ligne de tirets. Sans le
    // séparateur, ce n'est qu'un paragraphe qui contient des barres verticales.
    if (LIGNE_TABLE.test(ligne) && SEPARATEUR_TABLE.test(lignes[index + 1] ?? '')) {
      viderParagraphe();
      const entetes = cellules(ligne);
      const styles = alignements(lignes[index + 1]);
      index += 2;
      const corps = [];
      while (index < lignes.length && LIGNE_TABLE.test(lignes[index])) {
        corps.push(cellules(lignes[index]));
        index += 1;
      }
      sortie.push(
        '<div class="md-table-boite"><table class="md-table"><thead><tr>' +
          entetes.map((c, n) => `<th${styles[n] ?? ''}>${inline(c, contexte)}</th>`).join('') +
          '</tr></thead><tbody>' +
          corps
            .map(
              (rangee) =>
                '<tr>' +
                entetes
                  .map((_e, n) => `<td${styles[n] ?? ''}>${inline(rangee[n] ?? '', contexte)}</td>`)
                  .join('') +
                '</tr>'
            )
            .join('') +
          '</tbody></table></div>'
      );
      continue;
    }

    if (CITATION.test(ligne)) {
      viderParagraphe();
      const contenu = [];
      while (index < lignes.length && CITATION.test(lignes[index])) {
        contenu.push(lignes[index].match(CITATION)[1]);
        index += 1;
      }
      sortie.push(
        `<blockquote>${contenu.map((l) => inline(l, contexte)).join('<br>')}</blockquote>`
      );
      continue;
    }

    if (PUCE.test(ligne) || NUMERO.test(ligne)) {
      viderParagraphe();
      const [html, suivant] = liste(lignes, index, contexte);
      sortie.push(html);
      index = suivant;
      continue;
    }

    paragraphe.push(ligne);
    index += 1;
  }

  viderParagraphe();
  return sortie.join('\n');
}

/**
 * Une liste, et une seule imbrication.
 *
 * Deux niveaux suffisent à des notes de séance, et s'arrêter là évite un
 * analyseur récursif pour un cas qu'on écrit une fois sur cent.
 */
function liste(lignes, depart, contexte) {
  const premier = lignes[depart].match(NUMERO) ? 'ol' : 'ul';
  const morceaux = [];
  let index = depart;
  let imbrique = null; // le sous-niveau ouvert, s'il y en a un
  let ouvert = false; // un `<li>` du niveau courant attend sa fermeture

  const fermerImbrique = () => {
    if (!imbrique) return;
    morceaux.push(`</${imbrique}>`);
    imbrique = null;
  };
  const fermerElement = () => {
    if (!ouvert) return;
    fermerImbrique();
    morceaux.push('</li>');
    ouvert = false;
  };

  while (index < lignes.length) {
    const brut = lignes[index];
    const trouve = brut.match(PUCE) || brut.match(NUMERO);
    if (!trouve) break;

    const contenu = inline(trouve[2], contexte);

    if (trouve[1].length >= 2) {
      // Le sous-niveau vit **dans** l'élément qui le porte : un `<ul>` posé
      // entre deux `<li>` s'affiche pareil, mais ce n'est pas du HTML valide.
      if (!ouvert) {
        morceaux.push('<li>');
        ouvert = true;
      }
      if (!imbrique) {
        imbrique = brut.match(NUMERO) ? 'ol' : 'ul';
        morceaux.push(`<${imbrique}>`);
      }
      morceaux.push(`<li>${contenu}</li>`);
    } else {
      fermerElement();
      morceaux.push(`<li>${contenu}`);
      ouvert = true;
    }
    index += 1;
  }

  fermerElement();
  return [`<${premier}>${morceaux.join('')}</${premier}>`, index];
}

/* --------------------------------------------------------------------- montage */

/**
 * Écrit le rendu dans un conteneur et rend les balises cliquables.
 *
 * Les écouteurs sont posés après coup, sur les boutons produits : rien
 * n'arrive dans le HTML sous forme d'attribut `onclick` — la politique de
 * sécurité les refuserait de toute façon, et c'est très bien ainsi.
 */
export function rendre(conteneur, source, { libelle, surBalise } = {}) {
  conteneur.innerHTML = versHtml(source, { libelle });
  if (!surBalise) return conteneur;
  for (const bouton of conteneur.querySelectorAll('.balise')) {
    bouton.addEventListener('click', (evenement) => {
      evenement.preventDefault();
      evenement.stopPropagation();
      surBalise(bouton.dataset.genre, bouton.dataset.id, evenement);
    });
  }
  return conteneur;
}

/** Le texte seul, balises remplacées par les noms : pour un résumé, un titre. */
export function versTexte(source, libelle) {
  return String(source ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(BALISE, (_tout, genre, id) => libelle?.(genre, id) ?? id)
    .replace(/[#>*_~`|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
