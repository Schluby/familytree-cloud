/* Les messages volants — un mot aux autres, qui ne se garde pas (lot 27.D).
 *
 * Demandé tel quel : « un truc qui permette d'envoyer des msg aux autres (pas
 * une messagerie), juste une petite popup temporaire qui permet d'envoyer des
 * msg et qui ne sont pas stockés ».
 *
 * ── Ce que ce module n'est pas ──────────────────────────────────────────────
 *
 * Pas de fil, pas d'historique, pas de non-lus, pas de notification. Un mot
 * vit trois minutes côté serveur (`migrations/0012_messages_volants.sql`) et
 * disparaît, qu'on l'ait lu ou non. Il n'y a donc rien à archiver ici, et
 * surtout rien à retrouver : c'est le mot qu'on se passe à la table, pas le
 * courrier.
 *
 * ── Pourquoi on interroge, plutôt qu'un canal ouvert ────────────────────────
 *
 * Un WebSocket demanderait un Durable Object : une liaison de plus dans
 * `wrangler.jsonc`, un coût de plus, une classe de pannes de plus. Pour un mot
 * qui peut arriver dix secondes plus tard sans que personne s'en aperçoive,
 * c'est cher payé. On redemande donc, et **seulement quand l'onglet est
 * regardé** : un onglet d'arrière-plan laissé ouvert la nuit ne doit pas
 * frapper à la porte trois mille fois.
 *
 * ── L'horloge est celle du serveur ──────────────────────────────────────────
 *
 * `depuis` reprend le `maintenant` du tour précédent, jamais `Date.now()`. Une
 * machine en avance de deux minutes ne verrait jamais rien arriver ; une
 * machine en retard relirait les mêmes mots à chaque tour.
 */

import { Api } from './api.js';
import { h, creerFlottant } from './dom.js';

/** Dix secondes : un mot en vit cent quatre-vingts, personne ne le rate. */
const PERIODE = 10000;
/** Ce que le serveur accepte — redit ici pour compter les signes en frappant. */
const TAILLE_MAX = 500;
/** Combien de temps un mot reçu reste affiché avant de s'effacer. */
const DUREE_AFFICHAGE = 24000;

export function creerMessages({ bouton, sauvegardeId, astuce, message }) {
  const socle = creerFlottant({ persistant: true, deplacable: '.fe-entete' });
  const pile = h('div', { class: 'msg-pile' });
  document.body.append(pile);

  let destinataires = [];
  let depuis = 0;
  let minuteur = null;
  let enCours = false;
  /** L'identifiant choisi dans la liste, ou `''` pour tout le monde. */
  let vise = '';

  /* --------------------------------------------------------- ce qui arrive */

  /**
   * Un mot reçu se pose en bas à droite et s'efface tout seul.
   *
   * Pas dans le panneau d'envoi : celui-ci est souvent fermé, et un mot qui
   * n'apparaîtrait qu'en l'ouvrant serait un mot manqué. C'est le seul endroit
   * de l'application où quelque chose s'affiche sans qu'on l'ait demandé, d'où
   * la retenue — une carte, en bas, qui s'en va.
   */
  function poser(mot) {
    const carte = h('div', { class: 'msg-recu' }, [
      h('div', { class: 'msg-recu-qui' }, [
        h('span', { class: 'msg-recu-nom', texte: mot.auteur || '—' }),
        ...(mot.destinataire ? [h('span', { class: 'msg-recu-prive', texte: 'à vous seul' })] : []),
      ]),
      h('p', { class: 'msg-recu-texte', texte: mot.texte }),
    ]);
    carte.addEventListener('click', () => carte.remove());
    pile.append(carte);
    setTimeout(() => {
      carte.classList.add('part');
      setTimeout(() => carte.remove(), 400);
    }, DUREE_AFFICHAGE);
  }

  async function releve() {
    if (enCours || !sauvegardeId) return;
    enCours = true;
    try {
      const reponse = await Api.messages(sauvegardeId, depuis);
      depuis = reponse.maintenant ?? depuis;
      (reponse.messages || []).forEach(poser);
    } catch {
      // Un tour manqué n'est pas un incident : le suivant rattrapera, et un
      // bandeau d'erreur pour un réseau qui hoquette serait pire que le mal.
    } finally {
      enCours = false;
    }
  }

  function battre() {
    clearTimeout(minuteur);
    minuteur = setTimeout(async () => {
      if (document.visibilityState === 'visible') await releve();
      battre();
    }, PERIODE);
  }

  /**
   * Revenir à l'onglet relit tout de suite.
   *
   * Sans ça, on retrouve un écran muet pendant dix secondes au retour — et sur
   * un mot qui n'en vit que cent quatre-vingts, dix secondes d'attente sont
   * une part sérieuse de sa vie. C'est aussi le moment où l'on a le plus de
   * chances d'avoir quelque chose à lire, puisque personne ne regardait.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') releve();
  });

  /* ---------------------------------------------------------- ce qu'on écrit */

  function ouvrir(x, y) {
    const champ = h('textarea', {
      class: 'msg-champ',
      rows: 3,
      maxlength: TAILLE_MAX,
      placeholder: 'Deux mots, et ils disparaissent…',
      oninput: (evenement) => {
        compte.textContent = String(TAILLE_MAX - evenement.target.value.length);
      },
    });
    // Le nombre et le mot vivent dans deux nœuds distincts, et ce n'est pas
    // une coquetterie : le dictionnaire compare le texte **entier** d'un nœud,
    // donc « 480 signes » assemblé ne se traduirait jamais. Le mot seul, si.
    const compte = h('b', { class: 'msg-compte', texte: String(TAILLE_MAX) });
    const reste = h('span', { class: 'msg-reste' }, [compte, h('span', { texte: 'signes' })]);

    const choix = h(
      'select',
      {
        class: 'msg-a-qui',
        onchange: (evenement) => {
          vise = evenement.target.value;
        },
      },
      [
        h('option', { value: '', texte: 'À tout le monde' }),
        ...destinataires.map((qui) =>
          h('option', { value: qui.id, texte: qui.nom || '—', selected: qui.id === vise })
        ),
      ]
    );

    const envoyer = h('button', {
      class: 'bouton bouton-primaire',
      type: 'button',
      texte: 'Envoyer',
      onclick: async () => {
        const texte = champ.value.trim();
        if (!texte) return;
        envoyer.disabled = true;
        try {
          await Api.envoyerMessage(sauvegardeId, texte, vise || null);
          socle.fermer();
          astuce('Mot envoyé — il s’effacera dans trois minutes.');
        } catch (erreur) {
          message(`Envoi impossible : ${erreur.message}`);
          envoyer.disabled = false;
        }
      },
    });

    const contenu = h('div', { class: 'flottant msg-editeur' }, [
      h('div', { class: 'fe-entete' }, [
        h('strong', { texte: 'Un mot à la table' }),
        h('div', { class: 'fe-actions' }, [
          h('button', {
            class: 'bouton bouton-icone',
            type: 'button',
            texte: '✕',
            title: 'Fermer (Échap)',
            onclick: () => socle.fermer(),
          }),
        ]),
      ]),
      h('div', { class: 'msg-ligne' }, [h('span', { class: 'msg-lib', texte: 'À' }), choix]),
      champ,
      h('div', { class: 'msg-pied' }, [
        reste,
        envoyer,
      ]),
      h('p', {
        class: 'fe-aide',
        texte:
          'Rien n’est conservé : un mot vit trois minutes, puis disparaît pour tout le monde. Ce n’est pas une messagerie, et il n’y a pas d’historique à relire.',
      }),
    ]);

    socle.monter(contenu, x, y);
    champ.focus();
  }

  /* ------------------------------------------------------------- la mise en route */

  return {
    /**
     * Qui est autour de ce monde ? S'il n'y a personne, le bouton reste caché.
     *
     * Un bouton qui n'ouvre qu'une liste vide est pire qu'un bouton absent :
     * il promet quelque chose. La grande majorité des tables jouent seules.
     */
    async installer() {
      if (!sauvegardeId) return;
      try {
        const reponse = await Api.destinatairesMessages(sauvegardeId);
        destinataires = reponse.destinataires || [];
      } catch {
        destinataires = [];
      }
      if (!destinataires.length) return;
      bouton.hidden = false;
      bouton.addEventListener('click', (evenement) => {
        const cadre = evenement.currentTarget.getBoundingClientRect();
        ouvrir(cadre.left, cadre.top - 10);
      });
      await releve();
      battre();
    },

    /** Pour le bouton ⟳ : relire tout de suite, sans attendre le tour. */
    relever: () => releve(),
  };
}
