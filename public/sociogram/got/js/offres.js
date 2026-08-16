/* Offrir une note, et répondre à celles qu'on nous offre (lot 16.E et 16.F).
 *
 * Deux panneaux, un seul fichier, parce que c'est un seul geste vu des deux
 * bouts : l'un pose la note en attente, l'autre décide de son sort.
 *
 * **Rien n'arrive sans un oui.** Une note offerte n'entre dans le carnet de
 * personne tant que son destinataire ne l'a pas acceptée. C'est la seule
 * différence qui compte entre partager et écrire chez les gens.
 */

import { Api } from './api.js';
import { creerFlottant, h } from './dom.js';

/** Ce qu'on montre d'une note qu'on n'a pas encore acceptée. */
const APERCU_MAX = 320;

export function creerOffres({ surAcceptation, surEtat } = {}) {
  const envoi = creerFlottant();
  const boite = creerFlottant();
  /** Ce que le serveur nous a dit attendre, pour ne pas le redemander. */
  let recus = [];

  /* ------------------------------------------------------------ envoyer */

  function proposerEnvoi(note, ancre) {
    const champ = h('textarea', {
      rows: 3,
      class: 'of-adresses',
      placeholder: 'jean@exemple.fr, marie@exemple.fr',
    });
    const etat = h('p', { class: 'fl-aide' });

    async function envoyerA() {
      const adresses = champ.value
        .split(/[\s,;]+/)
        .map((brut) => brut.trim())
        .filter(Boolean);
      if (!adresses.length) {
        etat.textContent = 'Indiquez au moins une adresse.';
        return;
      }
      etat.textContent = 'Envoi…';
      try {
        const reponse = await Api.envoyerNote(note.id, adresses);
        const dits = [];
        if (reponse.envoyes?.length) {
          dits.push(`Proposée à ${reponse.envoyes.join(', ')}.`);
        }
        // Une adresse sans compte est **nommée**, pas avalée en silence : sinon
        // on croit avoir partagé et personne n'a rien reçu.
        if (reponse.inconnus?.length) {
          dits.push(`Sans compte ici : ${reponse.inconnus.join(', ')}.`);
        }
        if (reponse.debordent?.length) {
          dits.push(`Boîte pleine : ${reponse.debordent.join(', ')}.`);
        }
        etat.textContent = dits.join(' ') || 'Personne à qui l’envoyer.';
        if (reponse.envoyes?.length) {
          surEtat?.(`Note proposée à ${reponse.envoyes.length} compte(s).`);
          setTimeout(() => envoi.fermer(), 1400);
        }
      } catch (erreur) {
        etat.textContent = `Échec : ${erreur.message}`;
      }
    }

    const panneau = h('div', { class: 'flottant flottant-envoi' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', { class: 'fl-nom', texte: 'Proposer cette note' }),
          h('div', { class: 'fl-aide', texte: note.titre || 'Note sans titre' }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Fermer',
          onclick: () => envoi.fermer(),
        }),
      ]),
      h('div', { class: 'fl-corps' }, [
        h('div', { class: 'champ-edit' }, [
          h('label', { texte: 'Adresses des comptes' }),
          champ,
        ]),
        h('p', {
          class: 'fl-aide',
          texte:
            'Ils recevront une proposition, à accepter ou à refuser. Les profils ' +
            'et maisons cités seront rattachés aux leurs quand ils s’y retrouvent.',
        }),
        etat,
      ]),
      h('div', { class: 'fl-pied' }, [
        h('button', {
          class: 'bouton bouton-primaire',
          type: 'button',
          texte: 'Envoyer',
          onclick: () => envoyerA(),
        }),
      ]),
    ]);

    const boiteAncre = ancre.getBoundingClientRect();
    envoi.monter(panneau, boiteAncre.left, boiteAncre.top);
    champ.focus();
  }

  /* ------------------------------------------------------------ recevoir */

  function apercu(texte) {
    const propre = String(texte ?? '').trim();
    return propre.length > APERCU_MAX ? `${propre.slice(0, APERCU_MAX)}…` : propre;
  }

  async function repondre(offre, oui) {
    try {
      if (oui) {
        const reponse = await Api.accepterRecu(offre.id);
        const bilan = reponse.rattachement || {};
        // Le bilan est dit, pas caché : une note dont la moitié des citations
        // n'a pas trouvé preneur est utilisable, mais il faut le savoir.
        surEtat?.(
          bilan.en_clair
            ? `Note ajoutée. ${bilan.rattachees} citation(s) rattachée(s), ` +
              `${bilan.en_clair} laissée(s) en clair.`
            : 'Note ajoutée à votre carnet.'
        );
        await surAcceptation?.(reponse.note);
      } else {
        await Api.refuserRecu(offre.id);
        surEtat?.('Note refusée.');
      }
      recus = recus.filter((entree) => entree.id !== offre.id);
      if (recus.length) dessinerBoite();
      else boite.fermer();
    } catch (erreur) {
      surEtat?.(`Échec : ${erreur.message}`);
    }
  }

  function carte(offre) {
    return h('div', { class: 'of-carte' }, [
      h('div', { class: 'of-de' }, [
        h('b', { texte: offre.de }),
        h('span', {
          class: 'of-origine',
          texte: offre.origine ? ` · ${offre.origine}` : '',
        }),
      ]),
      h('div', { class: 'of-titre', texte: offre.titre || 'Note sans titre' }),
      h('div', {
        class: 'of-meta',
        texte:
          `${offre.signes.toLocaleString('fr-FR')} signes` +
          (offre.cites ? ` · ${offre.cites} fiche(s) citée(s)` : '') +
          (offre.chapitre_titre ? ` · chapitre « ${offre.chapitre_titre} »` : ''),
      }),
      h('p', { class: 'of-apercu', texte: apercu(offre.corps) }),
      h('div', { class: 'of-actions' }, [
        h('button', {
          class: 'bouton bouton-primaire bouton-plat',
          type: 'button',
          texte: 'Accepter',
          onclick: () => repondre(offre, true),
        }),
        h('button', {
          class: 'bouton bouton-plat',
          type: 'button',
          texte: 'Refuser',
          onclick: () => repondre(offre, false),
        }),
      ]),
    ]);
  }

  function dessinerBoite() {
    const panneau = h('div', { class: 'flottant flottant-offres' }, [
      h('div', { class: 'fl-entete' }, [
        h('div', { class: 'fl-titre' }, [
          h('span', {
            class: 'fl-nom',
            texte:
              recus.length > 1
                ? `${recus.length} notes vous sont proposées`
                : 'Une note vous est proposée',
          }),
          h('div', {
            class: 'fl-aide',
            texte: 'Accepter l’ajoute au carnet du monde ouvert.',
          }),
        ]),
        h('button', {
          class: 'bouton bouton-icone fl-fermer',
          type: 'button',
          texte: '✕',
          title: 'Plus tard',
          onclick: () => boite.fermer(),
        }),
      ]),
      h('div', { class: 'fl-corps' }, recus.map(carte)),
    ]);
    // En bas à droite : `placer` la ramène dans l'écran, et c'est le coin où
    // l'on ne travaille pas — la proposition attend sans couvrir le plan.
    boite.monter(panneau, window.innerWidth, window.innerHeight);
  }

  /**
   * Va voir ce qui attend, et le montre s'il y a lieu.
   *
   * Silencieux en cas d'échec : un visiteur sans compte n'a pas de boîte, et
   * une erreur ici ne doit pas empêcher l'application de s'ouvrir.
   */
  async function verifier({ montrer = true } = {}) {
    try {
      recus = (await Api.recus()).recus || [];
    } catch (erreur) {
      recus = [];
    }
    if (montrer && recus.length) dessinerBoite();
    return recus.length;
  }

  return {
    proposerEnvoi,
    verifier,
    /** Rouvre la boîte sans redemander au serveur. */
    montrer: () => (recus.length ? dessinerBoite() : null),
    combien: () => recus.length,
    fermer: () => {
      envoi.fermer();
      boite.fermer();
    },
  };
}
