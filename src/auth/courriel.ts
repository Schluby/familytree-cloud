/**
 * L'envoi de courriel — un seul message, celui du mot de passe oublié.
 *
 * ── Pourquoi un service extérieur ────────────────────────────────────────────
 *
 * Un Worker ne sait pas parler SMTP : il n'a pas de sockets sortantes
 * arbitraires. Le seul moyen d'envoyer un courriel est d'appeler l'API HTTP de
 * quelqu'un qui, lui, sait le faire. (MailChannels, qui rendait ce service
 * gratuitement aux Workers, l'a fermé en 2024.)
 *
 * D'où la forme de ce module : **une fonction, une clé, et un échec propre**.
 * Sans `RESEND_API_KEY`, rien n'est envoyé et on le dit — l'appelant bascule
 * alors sur le code de secours. L'application ne dépend pas du courriel ; elle
 * s'en sert quand il est là.
 *
 * Le corps est délibérément en texte brut. Un message de sécurité doit se lire
 * partout, et une jolie mise en page HTML est surtout un bon moyen de finir
 * dans les indésirables.
 */

export interface Resultat {
  envoye: boolean;
  /** Pourquoi ça n'est pas parti — journalisé, jamais renvoyé au navigateur. */
  raison?: string;
}

const NON_CONFIGURE = "aucune clé d'envoi : RESEND_API_KEY n'est pas défini";

export function envoiConfigure(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.COURRIEL_EXPEDITEUR);
}

/**
 * La racine des liens. `ADRESSE_PUBLIQUE` si elle est posée, sinon l'origine
 * de la requête en cours — ce qui marche en développement comme en ligne, sans
 * réglage. On ne prend jamais l'origine d'un en-tête que le client contrôle
 * (`Origin`, `Referer`) : ce serait laisser fabriquer le lien du courriel.
 */
export function racinePublique(env: Env, requete: Request): string {
  if (env.ADRESSE_PUBLIQUE) return env.ADRESSE_PUBLIQUE.replace(/\/+$/, '');
  const url = new URL(requete.url);
  return `${url.protocol}//${url.host}`;
}

export async function envoyerLienReinitialisation(
  env: Env,
  destinataire: string,
  lien: string
): Promise<Resultat> {
  if (!envoiConfigure(env)) return { envoye: false, raison: NON_CONFIGURE };

  const texte = [
    'Vous avez demandé à changer le mot de passe de votre compte FamilyTree.',
    '',
    'Ouvrez ce lien dans l’heure qui vient :',
    lien,
    '',
    'Il ne sert qu’une fois. Vos arbres et vos sauvegardes ne sont pas touchés :',
    'seul le mot de passe change, et les autres appareils connectés seront',
    'déconnectés.',
    '',
    'Si vous n’avez rien demandé, ignorez ce message — rien n’a changé, et ce',
    'lien expirera tout seul.',
  ].join('\n');

  try {
    const reponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.COURRIEL_EXPEDITEUR,
        to: [destinataire],
        subject: 'FamilyTree — changer votre mot de passe',
        text: texte,
      }),
    });

    if (!reponse.ok) {
      const corps = await reponse.text().catch(() => '');
      return { envoye: false, raison: `HTTP ${reponse.status} ${corps.slice(0, 200)}` };
    }
    return { envoye: true };
  } catch (erreur) {
    return { envoye: false, raison: String(erreur) };
  }
}
