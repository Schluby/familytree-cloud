/**
 * Les partages — `/api/partages/*`.
 *
 * **La question posée le 13/08/2026** : « le lien de campagne, est-ce que ça
 * crée une vue que l'administrateur configure, sur laquelle il fait des modifs,
 * et que les autres joueurs voient ? » Non — `meta.document` n'est qu'une
 * adresse http(s) vers un document hébergé ailleurs. Voici la vraie.
 *
 * **Un arbre, plusieurs lecteurs.** Le propriétaire désigne des comptes ; ils
 * voient *sa* sauvegarde — la vivante, pas une copie qui vieillirait dès qu'il
 * y touche — dans l'application entière, et ne peuvent rien y écrire.
 *
 * **Trois choses n'ont pas bougé, et ne bougeront pas.**
 *
 * - **Les routes de membres restent aveugles.** `src/intergiciels.ts` ne connaît
 *   toujours pas les partages, et `ficheDe` porte toujours `utilisateur_id`
 *   dans son `WHERE`. Passer par l'API ordinaire pour désigner l'arbre d'un
 *   autre répond toujours **404**, partagé ou non. Le partage vit **ici**, sur
 *   sa propre surface, exactement comme l'administration vit sur la sienne.
 * - **La lecture seule est posée sur le chemin, pas sur les routes.** Même
 *   doctrine que `lectureSeule` du lot 7 : ajouter demain une route d'écriture
 *   au domaine ne suffirait pas à ouvrir une brèche ici, parce que le verbe est
 *   refusé avant que la route ne soit choisie. Et le garde du verbe est posé
 *   **avant** la substitution du compte — l'ordre compte, il est vérifié.
 * - **La lecture reste la lecture.** `/:arbre/lecture/*` n'a pas changé d'un
 *   iota : le verbe y est refusé avant que la route ne soit choisie.
 *
 * **Ce qui a changé au lot 23.D : le partage en écriture existe.**
 *
 * Ce module disait « aucun partage en écriture », et la raison donnée était
 * juste : « deux personnes qui écrivent dans le même document sans rien pour
 * arbitrer entre elles ». C'est cette raison-là qui est tombée, pas la prudence
 * qui l'accompagnait. `ecrireDocument` porte désormais un **verrou de révision**
 * (lot 23.D) : une écriture fondée sur une lecture périmée est refusée — 409 —
 * au lieu d'écraser silencieusement le travail de l'autre.
 *
 * Deux conditions, sur une surface à part (`/:arbre/edition/*`) : le partage
 * porte `droit = 'ecriture'`, **et** l'amitié tient (lot 23.C). On ne donne pas
 * le droit de modifier son monde à quelqu'un qui n'a jamais dit oui.
 *
 * La procuration (8.F) reste autre chose : elle est le pouvoir d'un
 * administrateur sur l'arbre d'un membre, et elle est journalisée.
 *
 * Le mécanisme est celui de la procuration, à l'envers : on **substitue le
 * compte** du contexte par le propriétaire de l'arbre, et le domaine sert ses
 * lectures sans jamais savoir que c'est quelqu'un d'autre qui regarde.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import type { Compte } from '../auth/sessions';
import { routesDomaine } from '../domaine/routes';
import type { Objet } from '../domaine/models';
import { exigerSession, type Variables } from '../intergiciels';
import { CHAMPS_FICHE, ficheDe, maintenant, type Fiche } from '../sauvegardes/depot';
import { amisDe } from '../amis/routes';

type Contexte = { Bindings: Env; Variables: Variables };

export const routesPartages = new Hono<Contexte>();

routesPartages.use('*', exigerSession);

/** Combien de comptes peuvent lire un même arbre. */
export const MAX_LECTEURS = 100;

/* --------------------------------------------------------------------------
 * Ce qu'on m'a partagé
 * -------------------------------------------------------------------------- */

interface LignePartagee extends Fiche {
  proprietaire_id: string;
  proprietaire_email: string;
  proprietaire_nom: string;
}

/**
 * Les arbres qu'on m'a ouverts.
 *
 * Le rail les affiche sous mes sauvegardes, dans un bloc à part : ils ne sont
 * pas à moi, ils ne comptent pas dans mon plafond, et je ne peux pas les
 * renommer. Les confondre avec les miennes serait mentir sur ce que je peux en
 * faire.
 */
routesPartages.get('/', async (c) => {
  const moi = c.get('compte');
  // Les colonnes sont écrites en toutes lettres. Les fabriquer depuis
  // `CHAMPS_FICHE` tiendrait sur une ligne et ferait perdre dix minutes au
  // premier lecteur qui cherchera pourquoi une colonne manque.
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.nom, s.schema_version, s.personnes, s.relations, s.taille,
            s.revision, s.cree_le, s.modifie_le,
            s.utilisateur_id AS proprietaire_id,
            u.email          AS proprietaire_email,
            u.nom_affiche    AS proprietaire_nom,
            -- Lot 23.D : le rail doit savoir s'il ouvre cet arbre pour le lire
            -- ou pour l'écrire ; les deux ne passent pas par la même surface.
            p.droit
       FROM partages p
       JOIN sauvegardes s  ON s.id = p.sauvegarde_id
       JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE p.utilisateur_id = ?
      ORDER BY u.email, s.modifie_le DESC`
  )
    .bind(moi.id)
    .all<LignePartagee>();

  return c.json({ partages: results });
});

/* --------------------------------------------------------------------------
 * Partager l'un des miens
 * -------------------------------------------------------------------------- */

/**
 * À qui cet arbre est ouvert. Le propriétaire seul, et `ficheDe` s'en assure :
 * un arbre qui n'est pas le mien n'existe pas, même si on me l'a partagé.
 */
routesPartages.get('/:arbre/lecteurs', async (c) => {
  const moi = c.get('compte');
  const fiche = await ficheDe(c.env.DB, moi.id, c.req.param('arbre'));
  if (!fiche) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT p.utilisateur_id AS id, p.droit, u.email, u.nom_affiche
       FROM partages p
       JOIN utilisateurs u ON u.id = p.utilisateur_id
      WHERE p.sauvegarde_id = ?
      ORDER BY u.email`
  )
    .bind(fiche.id)
    .all<Objet>();

  // Les amis sont renvoyés avec : c'est à eux, et à eux seuls, qu'on peut
  // confier l'écriture, et l'interface doit pouvoir le proposer sans un second
  // aller-retour.
  const amis = await amisDe(c.env.DB, moi.id);

  return c.json({
    sauvegarde: fiche,
    lecteurs: results,
    amis: [...amis],
  });
});

/**
 * Ouvrir l'arbre à des comptes — la liste **entière**, pas un ajout.
 *
 * Comme les tutelles du lot 11.A : ce qu'on envoie est ce qui sera, et retirer
 * quelqu'un se fait en le décochant. Une route d'ajout et une route de retrait
 * feraient deux façons de se tromper.
 *
 * On désigne les lecteurs **par leur adresse**, pas par un identifiant : on
 * partage à « jean@exemple.fr », on ne partage pas à un UUID qu'il faudrait
 * aller chercher ailleurs. Une adresse inconnue est **écartée et nommée** —
 * contrairement aux lots du 11.A, où le silence protégeait l'existence des
 * comptes : ici c'est *mon* arbre, et je dois savoir que Jean ne le verra pas.
 * Cela dit à qui demande si une adresse a un compte ; c'est le prix d'un
 * partage utilisable, et il se paie une adresse à la fois.
 */
routesPartages.put('/:arbre/lecteurs', async (c) => {
  const moi = c.get('compte');
  const fiche = await ficheDe(c.env.DB, moi.id, c.req.param('arbre'));
  if (!fiche) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  // La démonstration ne se partage pas : elle repart à zéro à votre prochaine
  // connexion, et vos lecteurs verraient le monde se vider sous leurs yeux sans
  // comprendre pourquoi. Refus explicite plutôt que 404 — celle-ci existe bel
  // et bien, et l'indice dit quoi faire à la place.
  if (fiche.demo) {
    return c.json(
      {
        erreur: 'la démonstration ne se partage pas : rien n’y est conservé',
        indice:
          'dupliquez-la d’abord (clic droit sur la sauvegarde, « Dupliquer »), puis partagez la copie',
      },
      409
    );
  }

  const corps = await c.req.json<Objet>().catch(() => ({}) as Objet);
  const adresses = (valeur: unknown) =>
    Array.isArray(valeur)
      ? [...new Set(valeur.map((v: unknown) => String(v ?? '').trim().toLowerCase()).filter(Boolean))]
      : [];

  const voulusEnLecture = adresses(corps.lecteurs);
  // Lot 23.D : la même liste, en écriture. Un compte cité des deux côtés est
  // rédacteur — le droit le plus fort gagne, sinon l'ordre des listes déciderait.
  const voulusEnEcriture = adresses(corps.redacteurs);
  const demandes = [...new Set([...voulusEnLecture, ...voulusEnEcriture])];
  if (demandes.length > MAX_LECTEURS) {
    return c.json({ erreur: `au plus ${MAX_LECTEURS} lecteurs par arbre` }, 400);
  }

  // `id <> ?` : se partager son propre arbre n'a pas de sens, et laisserait
  // dans la table une ligne qui donnerait au propriétaire un accès en lecture
  // seule à ce qu'il écrit déjà.
  const trouves = demandes.length
    ? (
        await c.env.DB.prepare(
          `SELECT id, email, email_norm FROM utilisateurs
            WHERE email_norm IN (${demandes.map(() => '?').join(',')}) AND id <> ?`
        )
          .bind(...demandes, moi.id)
          .all<{ id: string; email: string; email_norm: string }>()
      ).results
    : [];

  const reconnus = new Set(trouves.map((ligne) => ligne.email_norm));
  const inconnus = demandes.filter((demande) => !reconnus.has(demande));

  /* ------------------------------------------------ l'écriture veut une amitié
   *
   * Donner le droit de modifier son monde à quelqu'un qui n'a jamais dit oui,
   * ce serait pouvoir faire écrire n'importe qui n'importe où — et, pour celui
   * qui reçoit, voir un arbre inconnu apparaître dans son rail avec le pouvoir
   * d'y toucher. Une adresse qui n'est pas celle d'un ami retombe donc en
   * **lecture**, et on le dit : rien n'est plus déroutant qu'un droit qu'on
   * croit avoir donné et qui n'existe pas.
   */
  const amis = await amisDe(c.env.DB, moi.id);
  const enEcriture = new Set(voulusEnEcriture);
  const refuses: string[] = [];
  const droitDe = (lecteur: { id: string; email_norm: string }) => {
    if (!enEcriture.has(lecteur.email_norm)) return 'lecture';
    if (amis.has(lecteur.id)) return 'ecriture';
    refuses.push(lecteur.email_norm);
    return 'lecture';
  };

  const instant = maintenant();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM partages WHERE sauvegarde_id = ?').bind(fiche.id),
    ...trouves.map((lecteur) =>
      c.env.DB
        .prepare(
          `INSERT INTO partages (sauvegarde_id, utilisateur_id, cree_le, pose_par, droit)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(fiche.id, lecteur.id, instant, moi.id, droitDe(lecteur))
    ),
  ]);

  return c.json({
    ok: true,
    lecteurs: trouves.map((lecteur) => ({
      id: lecteur.id,
      email: lecteur.email,
      droit: enEcriture.has(lecteur.email_norm) && amis.has(lecteur.id) ? 'ecriture' : 'lecture',
    })),
    inconnus,
    // Ceux à qui l'écriture a été refusée faute d'amitié, nommés.
    sans_amitie: refuses,
  });
});

/* --------------------------------------------------------------------------
 * Lire un arbre partagé — le domaine entier, en lecture seule
 * -------------------------------------------------------------------------- */

/**
 * Le verbe d'abord.
 *
 * Posé **avant** la substitution du compte, et sur le chemin plutôt que sur
 * chaque route. C'est ce qui rend la lecture seule vraie pour les routes qui
 * n'existent pas encore : un `PATCH` ajouté demain au domaine serait refusé ici
 * sans que personne n'ait à y penser. Et comme le compte n'a pas encore été
 * substitué à ce stade, un défaut dans l'ordre des intergiciels se traduirait
 * par un refus, jamais par une écriture au nom du propriétaire.
 */
const verbeDeLecture: MiddlewareHandler<Contexte> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json(
      {
        erreur: 'cet arbre vous est partagé en lecture seule',
        indice: "seul son propriétaire l'écrit ; demandez-lui une copie pour en faire le vôtre",
      },
      403
    );
  }
  await next();
};

interface LigneProprietaire {
  utilisateur_id: string;
  email: string;
  nom_affiche: string;
  role: string;
  plafond_octets: number;
  plafond_sauvegardes: number;
}

/**
 * Substitue le propriétaire, comme la procuration — mais sans le pouvoir.
 *
 * Le domaine croit servir le propriétaire, et lui sert ses lectures. Il ne
 * saura jamais qu'un autre regarde. `sauvegarde_active` est forcée sur l'arbre
 * demandé, faute de quoi on lirait celui que le propriétaire a ouvert de son
 * côté — et le lecteur verrait un arbre qu'on ne lui a pas partagé.
 */
const parPartage: MiddlewareHandler<Contexte> = async (c, next) => {
  const moi = c.get('compte');
  const arbre = c.req.param('arbre');
  if (!arbre) return c.json({ erreur: 'sauvegarde non nommée' }, 400);

  const ligne = await c.env.DB.prepare(
    `SELECT s.utilisateur_id, u.email, u.nom_affiche, u.role,
            u.plafond_octets, u.plafond_sauvegardes
       FROM sauvegardes s
       JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.id = ?
        AND (s.utilisateur_id = ?
             OR EXISTS (SELECT 1 FROM partages p
                         WHERE p.sauvegarde_id = s.id AND p.utilisateur_id = ?))`
  )
    .bind(arbre, moi.id, moi.id)
    .first<LigneProprietaire>();

  // Un arbre qu'on ne m'a pas partagé n'existe pas — le même 404, au mot près,
  // que s'il n'existait vraiment pas.
  if (!ligne) return c.json({ erreur: 'sauvegarde introuvable' }, 404);

  const proprietaire: Compte = {
    id: ligne.utilisateur_id,
    email: ligne.email,
    nom_affiche: ligne.nom_affiche,
    role: ligne.role,
    plafond_octets: ligne.plafond_octets,
    plafond_sauvegardes: ligne.plafond_sauvegardes,
    sauvegarde_active: arbre,
  };
  c.set('compte', proprietaire);

  await next();
};

routesPartages.use('/:arbre/lecture/*', verbeDeLecture);
routesPartages.use('/:arbre/lecture/*', parPartage);
routesPartages.route('/:arbre/lecture', routesDomaine);

/* --------------------------------------------------------------------------
 * Écrire un arbre partagé — le domaine entier, à deux (lot 23.D)
 * -------------------------------------------------------------------------- */

/**
 * Le droit d'abord, comme le verbe pour la lecture.
 *
 * Posé **avant** `parPartage`, donc avant que le compte ne soit substitué : un
 * défaut d'ordre se traduirait par un refus, jamais par une écriture au nom du
 * propriétaire. Et posé sur le chemin plutôt que sur chaque route, pour que le
 * jour où le domaine gagne une route d'écriture, elle soit protégée sans que
 * personne n'ait à y penser.
 *
 * La condition est double, et les deux comptent : le partage doit porter
 * `droit = 'ecriture'`, **et** l'amitié doit tenir encore. Retirer quelqu'un de
 * ses amis lui retire l'écriture le temps d'une requête, sans qu'il faille
 * penser à défaire les partages un par un — même si `DELETE /api/amis/:autre`
 * les efface aussi, pour ne pas laisser de lignes qui mentent.
 */
const droitDEcriture: MiddlewareHandler<Contexte> = async (c, next) => {
  const moi = c.get('compte');
  const arbre = c.req.param('arbre');
  if (!arbre) return c.json({ erreur: 'sauvegarde non nommée' }, 400);

  const ligne = await c.env.DB.prepare(
    `SELECT 1 AS ok
       FROM sauvegardes s
      WHERE s.id = ?1
        AND (
          -- Le propriétaire, d'abord : cette porte est aussi la sienne. Sans
          -- cette ligne, celui qui a partagé son arbre se ferait refuser sur
          -- l'adresse qu'il vient d'envoyer aux autres.
          s.utilisateur_id = ?2
          OR EXISTS (
            SELECT 1 FROM partages p
             WHERE p.sauvegarde_id = s.id
               AND p.utilisateur_id = ?2
               AND p.droit = 'ecriture'
               AND EXISTS (SELECT 1 FROM amities a
                            WHERE a.etat = 'acceptee'
                              AND ((a.demandeur_id = ?2 AND a.destinataire_id = s.utilisateur_id)
                                OR (a.demandeur_id = s.utilisateur_id AND a.destinataire_id = ?2)))
          )
        )`
  )
    .bind(arbre, moi.id)
    .first<{ ok: number }>();

  if (!ligne) {
    return c.json(
      {
        erreur: 'cet arbre ne vous est pas ouvert en écriture',
        indice:
          'son propriétaire doit vous compter parmi ses amis et vous donner le droit d’écrire',
      },
      403
    );
  }
  await next();
};

routesPartages.use('/:arbre/edition/*', droitDEcriture);
routesPartages.use('/:arbre/edition/*', parPartage);
routesPartages.route('/:arbre/edition', routesDomaine);
