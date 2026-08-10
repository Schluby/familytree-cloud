#!/usr/bin/env bash
# Essai bout en bout : les comptes (lot 1) et les sauvegardes (lot 2).
#
#   bash outils/essai.sh                       # base locale (npm run dev)
#   bash outils/essai.sh https://familytree.schlub-perso.workers.dev
#
# Cree deux comptes jetables et verifie qu'aucun ne voit ce qui appartient a
# l'autre. Les adresses portent un horodatage, donc le script est rejouable.
#
# Ce fichier grossit a chaque lot : on l'ETEND, on ne le reecrit pas. Une
# verification qui a servi une fois protege pour toujours.
#
# ATTENTION : il cree 2 comptes, et la limite est de 3 inscriptions par heure et
# par IP. Deux passages d'affilee sur la meme base la declenchent (c'est le
# garde-fou qui fait son travail). Pour repartir a zero en ligne :
#   npx wrangler d1 execute familytree --remote --command "DELETE FROM tentatives"
#
# Pour effacer les comptes d'essai (leurs sauvegardes suivent, par cascade) :
#   npx wrangler d1 execute familytree --remote \
#     --command "DELETE FROM utilisateurs WHERE email_norm LIKE 'essai-%@exemple.test'"

set -u
BASE="${1:-http://127.0.0.1:8787}"
MARQUE="$(date +%s)"
EMAIL_A="essai-a-$MARQUE@exemple.test"
EMAIL_B="essai-b-$MARQUE@exemple.test"
MDP_A="mot-de-passe-A-2026"
MDP_B="mot-de-passe-B-2026"

# La vraie campagne, si elle est la : 72 fiches et 178 liens, c'est le seul
# document dont on sache qu'il ressemble a ce que les gens gardent vraiment.
CAMPAGNE="../FamilyTree_GOT/data/sauvegardes/family-tree-got.json"

# Volontairement dans le projet, en chemin relatif : sous Git Bash, `mktemp -d`
# rend un chemin POSIX (/tmp/...) que le node.exe de Windows ne sait pas ouvrir.
DOSSIER="./.essai-$MARQUE"
mkdir -p "$DOSSIER"
trap 'rm -rf "$DOSSIER"' EXIT
BOCAL_A="$DOSSIER/a.txt"
BOCAL_B="$DOSSIER/b.txt"

echecs=0
total=0
verifier() {
  local libelle="$1" attendu="$2" obtenu="$3"
  total=$((total + 1))
  if [ "$attendu" = "$obtenu" ]; then
    printf '  ok    %-52s %s\n' "$libelle" "$obtenu"
  else
    printf '  ECHEC %-52s attendu %s, obtenu %s\n' "$libelle" "$attendu" "$obtenu"
    echecs=$((echecs + 1))
  fi
}

code() { # code <bocal|-> <methode> <chemin> [corps]
  local bocal="$1" methode="$2" chemin="$3" corps="${4:-}"
  local args=(-s -o "$DOSSIER/corps.json" -w '%{http_code}' -X "$methode" -H 'Content-Type: application/json')
  [ "$bocal" != "-" ] && args+=(-b "$bocal" -c "$bocal")
  [ -n "$corps" ] && args+=(-d "$corps")
  curl "${args[@]}" "$BASE$chemin"
}

fichier() { # fichier <bocal|-> <methode> <chemin> <fichier.json>
  local bocal="$1" methode="$2" chemin="$3" source="$4"
  local args=(-s -o "$DOSSIER/corps.json" -w '%{http_code}' -X "$methode" -H 'Content-Type: application/json' --data-binary "@$source")
  [ "$bocal" != "-" ] && args+=(-b "$bocal" -c "$bocal")
  curl "${args[@]}" "$BASE$chemin"
}

lire() { # lire <chemin.pointe> : lit un champ de la derniere reponse
  node -e "
    const fs=require('fs');
    let d={};
    try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    const v='$1'.split('.').reduce((o,c)=>(o??{})[c], d);
    process.stdout.write(v===undefined||v===null?'':String(v));
  " 2>/dev/null
}

contient() { # contient <texte> : le texte apparait-il dans la derniere reponse ?
  if grep -qF -- "$1" "$DOSSIER/corps.json" 2>/dev/null; then echo oui; else echo non; fi
}

echo "Base : $BASE"
echo

echo "-- derivation des cles (600 000 tours, comme le navigateur)"
CLE_A="$(node outils/deriver.mjs "$EMAIL_A" "$MDP_A")"
CLE_B="$(node outils/deriver.mjs "$EMAIL_B" "$MDP_B")"
CLE_FAUSSE="$(node outils/deriver.mjs "$EMAIL_A" "mauvais-mot-de-passe")"

echo "-- inscription"
verifier "A s'inscrit" 201 "$(code "$BOCAL_A" POST /api/auth/inscription "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\",\"nom_affiche\":\"Compte A\"}")"
CODE_SECOURS_A="$(lire code_secours)"
verifier "un code de secours est renvoye" oui "$([ -n "$CODE_SECOURS_A" ] && echo oui || echo non)"
verifier "la meme adresse est refusee" 409 "$(code - POST /api/auth/inscription "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\"}")"
verifier "adresse invalide refusee" 400 "$(code - POST /api/auth/inscription "{\"email\":\"pas-une-adresse\",\"cle\":\"$CLE_A\"}")"
verifier "cle mal formee refusee" 400 "$(code - POST /api/auth/inscription "{\"email\":\"x-$MARQUE@exemple.test\",\"cle\":\"trop-court\"}")"

echo "-- session"
verifier "A est reconnu par son cookie" 200 "$(code "$BOCAL_A" GET /api/auth/moi)"
verifier "  et c'est bien son adresse" "$EMAIL_A" "$(lire compte.email)"
verifier "sans cookie, personne" 401 "$(code - GET /api/auth/moi)"

echo "-- connexion"
verifier "mauvais mot de passe rejete" 401 "$(code - POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_FAUSSE\"}")"
verifier "adresse inconnue rejetee pareil" 401 "$(code - POST /api/auth/connexion "{\"email\":\"fantome-$MARQUE@exemple.test\",\"cle\":\"$CLE_A\"}")"
verifier "bon mot de passe accepte" 200 "$(code "$BOCAL_A" POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\"}")"

echo "-- cloisonnement des comptes"
verifier "B s'inscrit" 201 "$(code "$BOCAL_B" POST /api/auth/inscription "{\"email\":\"$EMAIL_B\",\"cle\":\"$CLE_B\"}")"
code "$BOCAL_B" GET /api/auth/moi > /dev/null
verifier "le cookie de B donne B, pas A" "$EMAIL_B" "$(lire compte.email)"
code "$BOCAL_A" GET /api/auth/moi > /dev/null
verifier "le cookie de A donne toujours A" "$EMAIL_A" "$(lire compte.email)"

# ---------------------------------------------------------------------------
# Lot 2 — les sauvegardes
# ---------------------------------------------------------------------------

echo "-- sauvegardes : creer, lire, renommer"
verifier "A liste ses sauvegardes" 200 "$(code "$BOCAL_A" GET /api/sauvegardes)"
verifier "  un compte neuf n'en a aucune" 0 "$(lire sauvegardes.length)"
verifier "  le plafond est annonce" 10 "$(lire plafonds.sauvegardes)"
verifier "sans nom, refus" 400 "$(code "$BOCAL_A" POST /api/sauvegardes '{"nom":"   "}')"
verifier "A cree une sauvegarde vierge" 201 "$(code "$BOCAL_A" POST /api/sauvegardes '{"nom":"Essai"}')"
ID_VIERGE="$(lire sauvegarde.id)"
verifier "  aucune fiche dedans" 0 "$(lire sauvegarde.personnes)"
verifier "  revision 1" 1 "$(lire sauvegarde.revision)"
verifier "le contenu se lit" 200 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_VIERGE/contenu)"
verifier "  avec les types de liens du squelette" oui "$(contient '"nemesis"')"
verifier "A renomme" 200 "$(code "$BOCAL_A" PATCH /api/sauvegardes/$ID_VIERGE '{"nom":"Les Sept Couronnes"}')"
verifier "  le nom a change" "Les Sept Couronnes" "$(lire sauvegarde.nom)"
verifier "  la revision n'a pas bouge" 1 "$(lire sauvegarde.revision)"
verifier "identifiant inconnu" 404 "$(code "$BOCAL_A" GET /api/sauvegardes/pas-un-identifiant)"

echo "-- import d'un fichier"
verifier "A importe l'exemple" 201 "$(fichier "$BOCAL_A" POST /api/sauvegardes/import outils/exemple-sauvegarde.json)"
ID_IMPORT="$(lire sauvegarde.id)"
verifier "  3 fiches" 3 "$(lire sauvegarde.personnes)"
verifier "  2 liens" 2 "$(lire sauvegarde.relations)"
verifier "  1 portrait colle retire" 1 "$(lire portraits_retires)"
verifier "  le nom vient de meta.sauvegarde" "Univers d'essai" "$(lire sauvegarde.nom)"
# Le code est verifie, pas jete : sans lui, une reponse 404 ferait passer les
# controles d'absence qui suivent et echouer les autres, sans dire pourquoi.
verifier "  on relit le document" 200 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_IMPORT/contenu)"
verifier "  le portrait data: a disparu" non "$(contient 'data:image')"
verifier "  le portrait https a survecu" oui "$(contient 'exemple.test/portraits')"
verifier "un fichier qui n'est pas une sauvegarde" 400 "$(code "$BOCAL_A" POST /api/sauvegardes/import '{"bonjour":"non"}')"

if [ -f "$CAMPAGNE" ]; then
  echo "-- import de la vraie campagne"
  verifier "elle passe" 201 "$(fichier "$BOCAL_A" POST /api/sauvegardes/import "$CAMPAGNE")"
  verifier "  72 fiches" 72 "$(lire sauvegarde.personnes)"
  verifier "  178 liens" 178 "$(lire sauvegarde.relations)"
  TAILLE_CAMPAGNE="$(lire sauvegarde.taille)"
  echo "        (stockee compacte : $TAILLE_CAMPAGNE octets, contre $(wc -c < "$CAMPAGNE") sur le disque)"
else
  echo "-- import de la vraie campagne : ignore (fichier absent)"
fi

echo "-- export"
verifier "l'export repond" 200 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_IMPORT/export)"
verifier "  il est reindente" oui "$(contient '  "meta"')"
verifier "  meta.sauvegarde porte le nom" "Univers d'essai" "$(lire meta.sauvegarde)"

echo "-- copie et reprise des referentiels"
verifier "A copie une sauvegarde" 201 "$(code "$BOCAL_A" POST /api/sauvegardes "{\"nom\":\"Copie\",\"depuis\":\"$ID_IMPORT\"}")"
verifier "  la copie a les memes fiches" 3 "$(lire sauvegarde.personnes)"
verifier "A repart des referentiels" 201 "$(code "$BOCAL_A" POST /api/sauvegardes "{\"nom\":\"Autre campagne\",\"depuis\":\"$ID_IMPORT\",\"contenu\":\"referentiels\"}")"
ID_REF="$(lire sauvegarde.id)"
verifier "  sans aucune fiche" 0 "$(lire sauvegarde.personnes)"
verifier "  son document se relit" 200 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_REF/contenu)"
verifier "  mais les maisons restent" oui "$(contient 'Ombreval')"
verifier "copier une sauvegarde inconnue" 404 "$(code "$BOCAL_A" POST /api/sauvegardes '{"nom":"x","depuis":"inconnue"}')"

echo "-- ecriture du document et verrou de revision"
code "$BOCAL_A" GET /api/sauvegardes/$ID_IMPORT > /dev/null
REVISION="$(lire sauvegarde.revision)"
verifier "revision de depart" 1 "$REVISION"
verifier "A remplace le contenu" 200 "$(code "$BOCAL_A" PUT /api/sauvegardes/$ID_IMPORT/contenu "{\"revision\":$REVISION,\"document\":{\"meta\":{\"schema\":2},\"personnes\":[{\"id\":\"seul\"}],\"relations\":[]}}")"
verifier "  la revision avance" 2 "$(lire sauvegarde.revision)"
verifier "  les compteurs suivent" 1 "$(lire sauvegarde.personnes)"
verifier "revision perimee refusee" 409 "$(code "$BOCAL_A" PUT /api/sauvegardes/$ID_IMPORT/contenu "{\"revision\":$REVISION,\"document\":{\"personnes\":[]}}")"
verifier "  et elle dit laquelle est bonne" 2 "$(lire revision)"
verifier "document sans personnes refuse" 400 "$(code "$BOCAL_A" PUT /api/sauvegardes/$ID_IMPORT/contenu '{"document":{"meta":{}}}')"
verifier "corps illisible refuse" 400 "$(code "$BOCAL_A" PUT /api/sauvegardes/$ID_IMPORT/contenu 'pas du json')"

echo "-- cloisonnement des sauvegardes (B ne doit rien pouvoir)"
verifier "B ne voit pas la fiche de A" 404 "$(code "$BOCAL_B" GET /api/sauvegardes/$ID_IMPORT)"
verifier "B ne lit pas le contenu de A" 404 "$(code "$BOCAL_B" GET /api/sauvegardes/$ID_IMPORT/contenu)"
verifier "B n'exporte pas la sauvegarde de A" 404 "$(code "$BOCAL_B" GET /api/sauvegardes/$ID_IMPORT/export)"
verifier "B n'ecrit pas dans la sauvegarde de A" 404 "$(code "$BOCAL_B" PUT /api/sauvegardes/$ID_IMPORT/contenu '{"document":{"personnes":[]}}')"
verifier "B ne renomme pas la sauvegarde de A" 404 "$(code "$BOCAL_B" PATCH /api/sauvegardes/$ID_IMPORT '{"nom":"volee"}')"
verifier "B ne copie pas la sauvegarde de A" 404 "$(code "$BOCAL_B" POST /api/sauvegardes "{\"nom\":\"vol\",\"depuis\":\"$ID_IMPORT\"}")"
verifier "B ne supprime pas la sauvegarde de A" 404 "$(code "$BOCAL_B" DELETE /api/sauvegardes/$ID_IMPORT)"
code "$BOCAL_B" GET /api/sauvegardes > /dev/null
verifier "la liste de B reste vide" 0 "$(lire sauvegardes.length)"
verifier "sans cookie, pas de liste" 401 "$(code - GET /api/sauvegardes)"
code "$BOCAL_A" GET /api/sauvegardes/$ID_IMPORT > /dev/null
verifier "et A n'a rien perdu au passage" 2 "$(lire sauvegarde.revision)"

echo "-- le domaine porte sur la sauvegarde active, et sur elle seule"
verifier "A active sa sauvegarde importee" 200 "$(code "$BOCAL_A" POST /api/sauvegardes/$ID_IMPORT/activer)"
verifier "A voit ses fiches" 200 "$(code "$BOCAL_A" GET /api/personnes)"
verifier "  et elles sont bien les siennes" 1 "$(lire personnes.length)"
verifier "la vue sociogramme se construit" 200 "$(code "$BOCAL_A" GET /api/vue/sociogramme)"
verifier "  et c'est bien elle" oui "$(contient '"vue":"sociogramme"')"
verifier "  avec ses aretes et sa legende" oui "$(contient '"legende"')"
verifier "les referentiels repondent" 200 "$(code "$BOCAL_A" GET /api/referentiels)"
verifier "une vue inconnue" 404 "$(code "$BOCAL_A" GET /api/vue/inexistante)"
verifier "une personne inconnue" 404 "$(code "$BOCAL_A" GET /api/personnes/fantome)"
verifier "sans cookie, pas de domaine" 401 "$(code - GET /api/personnes)"
verifier "B n'active pas la sauvegarde de A" 404 "$(code "$BOCAL_B" POST /api/sauvegardes/$ID_IMPORT/activer)"
verifier "B sans sauvegarde n'a pas de monde" 409 "$(code "$BOCAL_B" GET /api/personnes)"
verifier "B se cree un monde a lui" 201 "$(code "$BOCAL_B" POST /api/sauvegardes '{"nom":"Le monde de B"}')"
verifier "  qui est vide, pas celui de A" 200 "$(code "$BOCAL_B" GET /api/personnes)"
verifier "  aucune fiche heritee" 0 "$(lire personnes.length)"
verifier "B cree une fiche chez lui" 201 "$(code "$BOCAL_B" POST /api/personnes '{"prenom":"Test","nom":"Chez B"}')"
code "$BOCAL_A" GET /api/personnes > /dev/null
verifier "et A n'en voit rien" 1 "$(lire personnes.length)"

echo "-- plafonds"
code "$BOCAL_A" GET /api/sauvegardes > /dev/null
PLAFOND="$(lire plafonds.sauvegardes)"
DEJA="$(lire sauvegardes.length)"
DERNIERE=201
i="$DEJA"
while [ "$i" -lt "$PLAFOND" ]; do
  DERNIERE="$(code "$BOCAL_A" POST /api/sauvegardes "{\"nom\":\"Remplissage $i\"}")"
  i=$((i + 1))
done
verifier "on remplit jusqu'au plafond ($PLAFOND)" 201 "$DERNIERE"
verifier "la suivante est refusee" 409 "$(code "$BOCAL_A" POST /api/sauvegardes '{"nom":"Celle de trop"}')"
verifier "  avec le plafond dans la reponse" "$PLAFOND" "$(lire plafond_sauvegardes)"

node -e "
  const bourrage='x'.repeat(1000);
  const personnes=[];
  for (let i = 0; i < 2300; i++) personnes.push({ id: 'p' + i, prenom: 'P' + i, notes: bourrage });
  process.stdout.write(JSON.stringify({ meta: { schema: 2 }, personnes, relations: [] }));
" > "$DOSSIER/gros.json"
verifier "document au-dela du plafond de taille" 413 "$(fichier "$BOCAL_A" PUT /api/sauvegardes/$ID_IMPORT/contenu "$DOSSIER/gros.json")"

echo "-- suppression"
verifier "A supprime" 204 "$(code "$BOCAL_A" DELETE /api/sauvegardes/$ID_IMPORT)"
verifier "  elle n'existe plus" 404 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_IMPORT)"
verifier "  la supprimer deux fois ne casse rien" 404 "$(code "$BOCAL_A" DELETE /api/sauvegardes/$ID_IMPORT)"
verifier "  une place s'est liberee" 201 "$(code "$BOCAL_A" POST /api/sauvegardes '{"nom":"Apres le menage"}')"

# ---------------------------------------------------------------------------
# Lot 4 : l'interface est servie, et c'est bien celle du nuage
#
# Rien ici ne demande de session : ces fichiers doivent arriver a un visiteur
# deconnecte, sinon personne ne peut atteindre la page de connexion. Ce que ces
# verifications attrapent, c'est un deploiement ampute — un dossier public/
# incomplet passe autrement inapercu jusqu'a ce qu'on ouvre le site.
# ---------------------------------------------------------------------------

echo "-- l'interface"
verifier "la racine sert l'application" 200 "$(code - GET /)"
verifier "  et non le panneau provisoire" oui "$(contient 'id="liste-sauvegardes"')"
verifier "  elle charge le module principal" oui "$(contient '/js/main.js')"
verifier "la page de connexion est servie" 200 "$(code - GET /connexion)"
verifier "le client d'API est servi" 200 "$(code - GET /js/api.js)"
verifier "  il renvoie les 401 vers la connexion" oui "$(contient '/connexion.html?retour=')"
verifier "  et ne sonde plus l'ecriture differee" non "$(contient 'etatSauvegarde')"
verifier "le moteur de rendu est servi" 200 "$(code - GET /js/views/cartes.js)"
verifier "d3 est servi" 200 "$(code - GET /vendor/d3.v7.min.js)"
verifier "la feuille de style est servie" 200 "$(code - GET /css/app.css)"
verifier "  avec la passe telephone" oui "$(contient 'max-width: 760px')"

# ---------------------------------------------------------------------------
# Retour aux comptes : ce qui doit rester vrai quoi qu'on ait fait entre-temps
# ---------------------------------------------------------------------------

echo "-- deconnexion"
verifier "A se deconnecte" 204 "$(code "$BOCAL_A" POST /api/auth/deconnexion)"
verifier "son cookie ne vaut plus rien" 401 "$(code "$BOCAL_A" GET /api/auth/moi)"
verifier "et ne donne plus ses sauvegardes" 401 "$(code "$BOCAL_A" GET /api/sauvegardes)"

echo "-- recuperation par code de secours"
CLE_A2="$(node outils/deriver.mjs "$EMAIL_A" "nouveau-mot-de-passe-2026")"
verifier "mauvais code refuse" 401 "$(code - POST /api/auth/recuperation "{\"email\":\"$EMAIL_A\",\"code_secours\":\"AAAAA-BBBBB-CCCCC-DDDDD\",\"nouvelle_cle\":\"$CLE_A2\"}")"
verifier "bon code accepte" 200 "$(code - POST /api/auth/recuperation "{\"email\":\"$EMAIL_A\",\"code_secours\":\"$CODE_SECOURS_A\",\"nouvelle_cle\":\"$CLE_A2\"}")"
verifier "l'ancien mot de passe ne marche plus" 401 "$(code - POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\"}")"
verifier "le nouveau marche" 200 "$(code "$BOCAL_A" POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A2\"}")"
code "$BOCAL_A" GET /api/sauvegardes > /dev/null
verifier "et les sauvegardes sont toujours la" "$PLAFOND" "$(lire sauvegardes.length)"

echo
if [ "$echecs" -eq 0 ]; then
  echo "Tout est passe : $total/$total."
else
  echo "$echecs verification(s) en echec sur $total."
fi
exit "$echecs"
