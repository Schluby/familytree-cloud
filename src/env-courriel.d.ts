/**
 * Les réglages d'envoi de courriel, ajoutés à `Env` par fusion d'interfaces.
 *
 * Ils ne sont pas dans `worker-configuration.d.ts` : ce fichier-là est
 * **régénéré** par `wrangler types`, et tout ce qu'on y écrirait à la main
 * disparaîtrait au premier appel. Une interface globale déclarée ici fusionne
 * avec celle de Wrangler sans lui appartenir.
 *
 * Les trois sont **facultatifs**, et c'est le cœur du dispositif : sans clé,
 * l'application marche exactement pareil, et le « mot de passe oublié »
 * bascule sur le code de secours. On n'exige pas d'un compte Cloudflare
 * gratuit qu'il ait un service d'envoi.
 *
 *   npx wrangler secret put RESEND_API_KEY
 *   npx wrangler secret put COURRIEL_EXPEDITEUR   # « FamilyTree <no-reply@…> »
 *   npx wrangler secret put ADRESSE_PUBLIQUE      # https://familytree.…workers.dev
 */
interface Env {
  /** Clé d'API du service d'envoi. Absente = pas d'envoi, et c'est dit. */
  RESEND_API_KEY?: string;
  /** L'expéditeur, sur un domaine vérifié chez le service d'envoi. */
  COURRIEL_EXPEDITEUR?: string;
  /** La racine des liens du courriel. Déduite de la requête si absente. */
  ADRESSE_PUBLIQUE?: string;
}
