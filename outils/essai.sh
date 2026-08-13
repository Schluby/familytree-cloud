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

entete() { # entete <bocal|-> <chemin> <nom> [methode] : un en-tete de reponse
  local bocal="$1" chemin="$2" nom="$3" methode="${4:-GET}"
  local args=(-s -o /dev/null -D "$DOSSIER/entetes.txt" -X "$methode")
  [ "$bocal" != "-" ] && args+=(-b "$bocal")
  curl "${args[@]}" "$BASE$chemin"
  grep -i "^$nom:" "$DOSSIER/entetes.txt" | head -1 | sed 's/^[^:]*: *//' | tr -d '\r'
}

porte() { # porte <valeur> <fragment> : le fragment est-il dans la valeur ?
  case "$1" in *"$2"*) echo oui ;; *) echo non ;; esac
}

contient() { # contient <texte> : le texte apparait-il dans la derniere reponse ?
  if grep -qF -- "$1" "$DOSSIER/corps.json" 2>/dev/null; then echo oui; else echo non; fi
}

journal_vise() { # journal_vise <id> : combien de lignes du journal VISENT ce compte
  # `contient` ne suffit pas ici : l'identifiant d'un administrateur apparait
  # aussi comme AUTEUR d'une ligne, et voir « le souverain a ouvert l'arbre de
  # mon joueur » est justement ce que le registre doit a un intendant. Ce qu'on
  # verifie, c'est qu'aucune ligne ne PORTE SUR un compte hors perimetre.
  node -e "
    const fs=require('fs');
    let d={};
    try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    process.stdout.write(String((d.journal||[]).filter(l=>l.cible_utilisateur==='$1').length));
  " 2>/dev/null
}

echo "Base : $BASE"
echo

echo "-- derivation des cles (600 000 tours, comme le navigateur)"
CLE_A="$(node outils/deriver.mjs "$EMAIL_A" "$MDP_A")"
CLE_B="$(node outils/deriver.mjs "$EMAIL_B" "$MDP_B")"
CLE_FAUSSE="$(node outils/deriver.mjs "$EMAIL_A" "mauvais-mot-de-passe")"

echo "-- inscription"
verifier "A s'inscrit" 201 "$(code "$BOCAL_A" POST /api/auth/inscription "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\"}")"
# Lot 9.D : l'inscription ne demande plus rien d'autre que l'adresse et le mot
# de passe, et ne jette plus un code de secours au visage de quelqu'un qui vient
# de choisir son mot de passe.
verifier "  aucun code de secours n'est impose" non "$(contient '"code_secours"')"
verifier "  et le compte part sans nom d'affichage" oui "$(contient '"nom_affiche":""')"
# Il reste disponible, mais on vient le chercher — c'est tout le changement.
verifier "un code de secours se demande" 200 "$(code "$BOCAL_A" POST /api/auth/code-secours)"
CODE_SECOURS_A="$(lire code_secours)"
verifier "  et il est bien renvoye" oui "$([ -n "$CODE_SECOURS_A" ] && echo oui || echo non)"
verifier "  pas sans session" 401 "$(code - POST /api/auth/code-secours)"
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
# Lot 9.B : un compte neuf n'ouvre plus sur une page blanche. Il recoit la
# sauvegarde de depart, active d'emblee — c'etait « 0 » jusqu'au lot 8.
verifier "  un compte neuf recoit un monde" 1 "$(lire sauvegardes.length)"
verifier "  et c'est Westeros" Westeros "$(lire sauvegardes.0.nom)"
verifier "  deja peuplee" 67 "$(lire sauvegardes.0.personnes)"
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
# B garde exactement ce qu'il avait : sa sauvegarde de depart, et rien de A.
verifier "la liste de B n'a pas grossi" 1 "$(lire sauvegardes.length)"
verifier "  et ne nomme pas celle de A" non "$(contient "$ID_IMPORT")"
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
verifier "B se cree un monde a lui" 201 "$(code "$BOCAL_B" POST /api/sauvegardes '{"nom":"Le monde de B"}')"
ID_MONDE_B="$(lire sauvegarde.id)"
verifier "  il l'active" 200 "$(code "$BOCAL_B" POST /api/sauvegardes/$ID_MONDE_B/activer)"
verifier "  et le domaine repond" 200 "$(code "$BOCAL_B" GET /api/personnes)"
# Une sauvegarde creee de zero reste vierge : la sauvegarde de depart est
# offerte a l'inscription, elle n'est pas recopiee dans chaque nouveau monde.
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
# Lot 6 : ce que le navigateur recoit avant meme de lire une ligne
#
# Les fichiers statiques ne passent PAS par le Worker (`run_worker_first` ne
# couvre que /api/*) : leurs en-tetes viennent de public/_headers, ceux des
# routes d'API de src/index.ts. Deux surfaces, donc deux verifications — c'est
# le prix de ne pas payer une invocation de Worker par fichier servi.
# ---------------------------------------------------------------------------

echo "-- en-tetes de securite (page HTML)"
verifier "politique de contenu" oui "$(porte "$(entete - / Content-Security-Policy)" "default-src 'self'")"
verifier "  scripts de la seule origine" oui "$(porte "$(entete - / Content-Security-Policy)" "script-src 'self'")"
verifier "  pas d'encadrement" DENY "$(entete - / X-Frame-Options)"
verifier "  pas de reniflage de type" nosniff "$(entete - / X-Content-Type-Options)"
verifier "  HTTPS impose" oui "$(porte "$(entete - / Strict-Transport-Security)" "max-age=")"

echo "-- en-tetes de securite (routes d'API)"
verifier "politique de contenu" oui "$(porte "$(entete - /api/sante Content-Security-Policy)" "default-src 'self'")"
verifier "  pas d'encadrement" DENY "$(entete - /api/sante X-Frame-Options)"
verifier "  HTTPS impose" oui "$(porte "$(entete - /api/sante Strict-Transport-Security)" "max-age=")"

echo "-- le temoin de session"
# `Secure` empecherait le temoin d'etre pose sur http:// : en local il doit
# donc etre absent, en ligne present. Les deux sont verifies, pas seulement
# celui qui arrange.
# La deconnexion pose un temoin vide, avec exactement les memes attributs que
# celui de la connexion : de quoi les verifier sans avoir a se reconnecter.
TEMOIN="$(entete - /api/auth/deconnexion Set-Cookie POST)"
case "$BASE" in
  https://*) verifier "Secure, puisqu'on est en HTTPS" oui "$(porte "$TEMOIN" Secure)" ;;
  *)         verifier "pas de Secure sur http local" non "$(porte "$TEMOIN" Secure)" ;;
esac
verifier "  inaccessible au JavaScript" oui "$(porte "$TEMOIN" HttpOnly)"
verifier "  non envoye depuis un autre site" oui "$(porte "$TEMOIN" SameSite)"

echo "-- la page « Vos donnees »"
verifier "la page est servie" 200 "$(code - GET /donnees)"
verifier "  elle annonce ce qui est stocke" oui "$(contient 'Ce qui est stocké')"
verifier "  et que les administrateurs peuvent consulter" oui "$(contient 'administrateurs de cette')"
verifier "le releve demande une session" 401 "$(code - GET /api/auth/donnees)"
verifier "le releve repond a A" 200 "$(code "$BOCAL_A" GET /api/auth/donnees)"
verifier "  il compte ses sauvegardes" "$PLAFOND" "$(lire contenu.sauvegardes)"
verifier "  et ses sessions ouvertes" oui "$([ "$(lire sessions_ouvertes)" -ge 1 ] && echo oui || echo non)"

echo "-- effacement du compte : les deux verrous"
verifier "sans mot de passe, refuse" 400 "$(code "$BOCAL_A" DELETE /api/auth/compte '{}')"
verifier "avec le mauvais, refuse" 401 "$(code "$BOCAL_A" DELETE /api/auth/compte "{\"cle\":\"$CLE_FAUSSE\"}")"
verifier "  et le compte est toujours la" 200 "$(code "$BOCAL_A" GET /api/auth/moi)"

# ---------------------------------------------------------------------------
# Lot 5 : sortir ses donnees
#
# Les exports ne rendent pas du JSON mais des fichiers, donc on verifie le code
# et l'en-tete, pas le corps. Le point qui compte vraiment est le dernier :
# **un compte ne peut pas exporter la sauvegarde d'un autre**, sinon le
# cloisonnement se contournerait par la porte de derriere.
# ---------------------------------------------------------------------------

echo "-- exports"
verifier "la vue tableaux est declaree" 200 "$(code "$BOCAL_A" GET /api/vues)"
verifier "  et elle est dans la liste" oui "$(contient '"id":"tableau"')"
verifier "la vue tableaux se construit" 200 "$(code "$BOCAL_A" GET /api/vue/tableau)"
verifier "  avec ses cinq tableaux" oui "$(contient '"titre":"Regard des joueurs"')"
verifier "export JSON de l'active" 200 "$(code "$BOCAL_A" GET /api/export/json)"
verifier "export CSV" 200 "$(code "$BOCAL_A" GET /api/export/csv?table=personnes)"
verifier "export classeur Excel" 200 "$(code "$BOCAL_A" GET /api/export/xlsx)"
verifier "archive complete du compte" 200 "$(code "$BOCAL_A" GET /api/export/zip)"
verifier "tableau inconnu refuse" 400 "$(code "$BOCAL_A" GET /api/export/csv?table=nawak)"
verifier "format inconnu refuse" 400 "$(code "$BOCAL_A" GET /api/export/nawak)"
verifier "export sans session refuse" 401 "$(code - GET /api/export/json)"

echo "-- exports : le cloisonnement tient aussi ici"
verifier "B n'exporte pas la sauvegarde de A" 404 "$(code "$BOCAL_B" GET /api/export/json?sauvegarde=$ID_REF)"
verifier "  ni son classeur" 404 "$(code "$BOCAL_B" GET /api/export/xlsx?sauvegarde=$ID_REF)"
verifier "  et son archive ne contient que les siennes" 200 "$(code "$BOCAL_B" GET /api/export/zip)"

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
# Lot 7 : l'administration
#
# Le role ne se donne pas par l'API — c'est une decision du plan, pas un oubli.
# Le harnais promeut donc A **en SQL**, exactement comme un vrai premier
# administrateur, puis le redescend a la fin. Si wrangler n'est pas disponible,
# ces verifications echouent bruyamment : c'est voulu, un « saute » silencieux
# laisserait croire que la surface est testee alors qu'elle ne l'est pas.
# ---------------------------------------------------------------------------

sql() { # sql <requete> : sur la base locale ou en ligne, selon $BASE
  local ou="--remote"
  case "$BASE" in http://127.0.0.1*|http://localhost*) ou="--local" ;; esac
  npx wrangler d1 execute familytree $ou --command "$1" > /dev/null 2>&1
}

echo "-- la surface d'administration est fermee par defaut"
verifier "sans session, refusee" 401 "$(code - GET /api/admin/utilisateurs)"
verifier "un membre est refuse" 403 "$(code "$BOCAL_B" GET /api/admin/utilisateurs)"
verifier "  y compris sur le journal" 403 "$(code "$BOCAL_B" GET /api/admin/journal)"
verifier "  et sur les arbres" 403 "$(code "$BOCAL_B" GET /api/admin/sauvegardes/$ID_REF)"

echo "-- A devient administrateur (en SQL, comme le premier de tous)"
sql "UPDATE utilisateurs SET role='admin' WHERE email_norm='$EMAIL_A'"
verifier "A voit la liste des comptes" 200 "$(code "$BOCAL_A" GET /api/admin/utilisateurs)"
verifier "  B y figure" oui "$(contient "$EMAIL_B")"
verifier "A lit le journal" 200 "$(code "$BOCAL_A" GET /api/admin/journal)"

code "$BOCAL_A" GET /api/auth/moi > /dev/null
ID_COMPTE_A="$(lire compte.id)"
code "$BOCAL_B" GET /api/sauvegardes > /dev/null
ID_SAUVEGARDE_B="$(lire sauvegardes.0.id)"
code "$BOCAL_A" GET /api/admin/utilisateurs > /dev/null
ID_COMPTE_B="$(node -e "
  const fs=require('fs');
  const d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8'));
  const b=(d.utilisateurs||[]).find(u=>u.email==='$EMAIL_B');
  process.stdout.write(b?b.id:'');
")"

echo "-- A consulte l'arbre de B"
verifier "les sauvegardes de B sont listees" 200 "$(code "$BOCAL_A" GET /api/admin/utilisateurs/$ID_COMPTE_B/sauvegardes)"
verifier "l'arbre de B s'ouvre" 200 "$(code "$BOCAL_A" GET /api/admin/sauvegardes/$ID_SAUVEGARDE_B)"
verifier "  avec ses cinq tableaux" oui "$(contient '"titre":"Regard des joueurs"')"
verifier "  et la fiche que B avait creee" oui "$(contient 'Chez B')"
verifier "l'export JSON marche" 200 "$(code "$BOCAL_A" GET /api/admin/sauvegardes/$ID_SAUVEGARDE_B/export)"
verifier "l'export Excel aussi" 200 "$(code "$BOCAL_A" GET /api/admin/sauvegardes/$ID_SAUVEGARDE_B/export?format=xlsx)"

echo "-- ce qu'un administrateur ne peut PAS faire"
# La garde est posee sur le chemin : elle vaut aussi pour les routes qui
# n'existent pas. C'est le coeur du lot.
verifier "ecrire dans l'arbre d'un autre" 403 "$(code "$BOCAL_A" PATCH /api/admin/sauvegardes/$ID_SAUVEGARDE_B '{"nom":"volee"}')"
verifier "  ni le supprimer par la" 403 "$(code "$BOCAL_A" DELETE /api/admin/sauvegardes/$ID_SAUVEGARDE_B)"
verifier "  ni y poster quoi que ce soit" 403 "$(code "$BOCAL_A" POST /api/admin/sauvegardes/$ID_SAUVEGARDE_B '{}')"
# Et l'API des membres ne connait toujours pas les roles : 404, pas 403.
verifier "passer par l'API des membres ne change rien" 404 "$(code "$BOCAL_A" PATCH /api/sauvegardes/$ID_SAUVEGARDE_B '{"nom":"volee"}')"
verifier "  ni pour lire" 404 "$(code "$BOCAL_A" GET /api/sauvegardes/$ID_SAUVEGARDE_B/contenu)"
verifier "s'effacer soi-meme par cette route" 400 "$(code "$BOCAL_A" DELETE /api/admin/utilisateurs/$ID_COMPTE_A)"

echo "-- les gestes d'administration sur un compte"
verifier "plafond hors bornes refuse" 400 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/plafond '{"octets":1,"sauvegardes":1}')"
verifier "plafond raisonnable accepte" 200 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/plafond '{"octets":4194304,"sauvegardes":20}')"
verifier "compte inconnu" 404 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/inexistant/plafond '{"octets":4194304,"sauvegardes":20}')"
verifier "cle invalide refusee" 400 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/mot-de-passe '{"cle":"pas-une-cle"}')"

echo "-- le journal a tout vu"
code "$BOCAL_A" GET /api/admin/journal > /dev/null
verifier "la consultation y est" oui "$(contient '"action":"consultation"')"
verifier "l'export aussi" oui "$(contient '"action":"export"')"
verifier "et le changement de plafond" oui "$(contient '"action":"plafond"')"
verifier "avec l'adresse de l'administrateur" oui "$(contient "$EMAIL_A")"

# ---------------------------------------------------------------------------
# Lot 8.F : l'ecriture par procuration
#
# Le revirement du 10/08/2026. A est encore administrateur ici : on verifie
# qu'il peut ecrire chez B **par cette porte-la et par aucune autre**, et que
# chaque ecriture reussie laisse une ligne au journal.
# ---------------------------------------------------------------------------

ARBRE_B="/api/admin/arbres/$ID_SAUVEGARDE_B"

echo "-- la porte d'edition est fermee aux membres"
verifier "sans session" 401 "$(code - GET $ARBRE_B/referentiels)"
verifier "un membre, meme pour lire" 403 "$(code "$BOCAL_B" GET $ARBRE_B/referentiels)"
verifier "  et meme sur un arbre qui n'existe pas" 403 "$(code "$BOCAL_B" GET /api/admin/arbres/inexistant/referentiels)"

echo "-- A ecrit chez B, par procuration"
verifier "il lit les referentiels de B" 200 "$(code "$BOCAL_A" GET $ARBRE_B/referentiels)"
verifier "un arbre inconnu reste introuvable" 404 "$(code "$BOCAL_A" GET /api/admin/arbres/inexistant/referentiels)"
verifier "il cree une maison chez B" 201 "$(code "$BOCAL_A" POST $ARBRE_B/maisons '{"label":"Maison posee par l administrateur"}')"
MAISON_ADMIN="$(lire maison.id)"
verifier "il regle ses caracteristiques" 200 "$(code "$BOCAL_A" PATCH $ARBRE_B/maisons/$MAISON_ADMIN '{"caracteristiques":{"defense":12,"richesse":400},"notes":"vue depuis l administration"}')"
verifier "  les bornes tiennent (400 -> 100)" oui "$(contient '"richesse":100')"
verifier "  et une caracteristique inventee est ignoree" 200 "$(code "$BOCAL_A" PATCH $ARBRE_B/maisons/$MAISON_ADMIN '{"caracteristiques":{"charisme":9}}')"
verifier "  elle n'est pas entree" non "$(contient '"charisme"')"
verifier "il pose l'annee de campagne de B" 200 "$(code "$BOCAL_A" PATCH $ARBRE_B/meta '{"annee_courante":"300 AC"}')"

code "$BOCAL_A" GET $ARBRE_B/personnes > /dev/null
ID_FICHE_B="$(lire personnes.0.id)"
verifier "il corrige une fiche de B" 200 "$(code "$BOCAL_A" PATCH $ARBRE_B/personnes/$ID_FICHE_B '{"notes":"corrige par le MJ","tags":["chef de maison"]}')"
verifier "  et la relit corrigee" oui "$(contient 'corrige par le MJ')"

echo "-- et B retrouve tout ca chez lui, sans rien avoir fait"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "la maison est bien dans SON arbre" oui "$(contient 'Maison posee par l administrateur')"
verifier "  avec l'annee de campagne" oui "$(contient '"annee_courante":"300 AC"')"

echo "-- le journal porte les ecritures, et rien d'autre"
code "$BOCAL_A" GET /api/admin/journal > /dev/null
verifier "l'edition y figure" oui "$(contient '"action":"edition"')"
# Une tentative refusee n'a rien change : elle n'a pas a encombrer le registre.
code "$BOCAL_A" PATCH $ARBRE_B/maisons/maison-fantome '{"label":"x"}' > /dev/null
code "$BOCAL_A" GET /api/admin/journal > /dev/null
verifier "  et la lecture seule tient toujours a cote" 403 "$(code "$BOCAL_A" PATCH /api/admin/sauvegardes/$ID_SAUVEGARDE_B '{"nom":"volee"}')"

sql "UPDATE utilisateurs SET role='membre' WHERE email_norm='$EMAIL_A'"
verifier "A redevient membre, et la porte se referme" 403 "$(code "$BOCAL_A" GET /api/admin/utilisateurs)"
verifier "  la porte d'edition aussi" 403 "$(code "$BOCAL_A" GET $ARBRE_B/referentiels)"

# ---------------------------------------------------------------------------
# Lot 8.B, 8.D, 8.E : ce que le domaine sait de plus depuis le lot 8
#
# B est redevenu seul maitre chez lui : ces verifications passent par l'API des
# membres, comme n'importe quel utilisateur.
# ---------------------------------------------------------------------------

echo "-- l'annee de campagne (8.B)"
verifier "un patch vide est refuse" 400 "$(code "$BOCAL_B" PATCH /api/meta '{}')"
verifier "une annee sans chiffre est refusee" 400 "$(code "$BOCAL_B" PATCH /api/meta '{"annee_courante":"bientot"}')"
verifier "une annee lisible passe" 200 "$(code "$BOCAL_B" PATCH /api/meta '{"annee_courante":"305 AC"}')"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  et se relit" oui "$(contient '"annee_courante":"305 AC"')"
verifier "on peut l'effacer" 200 "$(code "$BOCAL_B" PATCH /api/meta '{"annee_courante":null}')"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  elle a bien disparu" non "$(contient '"annee_courante"')"

echo "-- liens revolus et evenements (8.D)"
verifier "la categorie « historique » existe" oui "$(contient '"id":"historique"')"
verifier "B cree une deuxieme fiche" 201 "$(code "$BOCAL_B" POST /api/personnes '{"prenom":"Autre","nom":"Chez B"}')"
code "$BOCAL_B" GET /api/personnes > /dev/null
ID_P1="$(lire personnes.0.id)"
ID_P2="$(lire personnes.1.id)"
verifier "un lien se cree" 201 "$(code "$BOCAL_B" POST /api/relations "{\"source\":\"$ID_P1\",\"cible\":\"$ID_P2\",\"type\":\"parent\"}")"
ID_LIEN="$(lire relation.id)"
verifier "il devient revolu, date et situe" 200 "$(code "$BOCAL_B" PATCH /api/relations/$ID_LIEN '{"revolu":true,"depuis":"298 AC","jusqu_a":"301 AC","lieu":"les Jumeaux"}')"
verifier "  et le relit" oui "$(contient '"revolu":true')"
verifier "  avec son lieu" oui "$(contient '"lieu":"les Jumeaux"')"
code "$BOCAL_B" GET /api/export/csv?table=relations > /dev/null
verifier "l'export des liens porte la colonne Revolu" oui "$(contient 'Révolu')"

echo "-- la fiche des maisons (8.E)"
code "$BOCAL_B" GET /api/vues > /dev/null
verifier "la vue « Maisons » est au catalogue" oui "$(contient '"id":"maisons"')"
verifier "elle se construit" 200 "$(code "$BOCAL_B" GET /api/vue/maisons)"
verifier "  avec les sept caracteristiques" oui "$(contient '"id":"richesse"')"
verifier "  et la maison posee par l'administrateur" oui "$(contient 'Maison posee par l administrateur')"
verifier "une maison prend un evenement" 200 "$(code "$BOCAL_B" PATCH /api/maisons/$MAISON_ADMIN "{\"evenements\":[{\"annee\":\"299 AC\",\"titre\":\"Un siege\",\"personnes\":[\"$ID_P1\"]}]}")"
verifier "  un evenement sans titre ni texte est ecarte" 200 "$(code "$BOCAL_B" PATCH /api/maisons/$MAISON_ADMIN '{"evenements":[{"annee":"300 AC"}]}')"
verifier "  il n'en reste rien" non "$(contient '"annee":"300 AC"')"
verifier "un lien de maison a maison se pose" 200 "$(code "$BOCAL_B" PATCH /api/maisons/$MAISON_ADMIN '{"liens":[{"maison":"autre","type":"vassal","revolu":true}]}')"
verifier "  et il est revolu" oui "$(contient '"revolu":true')"
code "$BOCAL_B" GET /api/vue/maisons > /dev/null
verifier "la vue nomme la maison visee" oui "$(contient '"maison_label"')"

# ---------------------------------------------------------------------------
# Lot 8.G : mot de passe oublie
#
# L'envoi lui-meme demande un service exterieur, donc une cle : ce qui se
# verifie ici, c'est le reste — et surtout que la reponse ne trahit jamais
# l'existence d'une adresse.
# ---------------------------------------------------------------------------

echo "-- mot de passe oublie (8.G)"
verifier "l'instance dit ce qu'elle sait faire" 200 "$(code - GET /api/auth/moyens)"
verifier "  sans exiger de session" oui "$(contient '"courriel"')"
verifier "une adresse invalide est refusee" 400 "$(code - POST /api/auth/mot-de-passe-oublie '{"email":"pas-une-adresse"}')"
# La meme reponse pour une adresse connue et pour une inconnue : c'est tout
# l'interet de la route.
verifier "une adresse inconnue repond 200" 200 "$(code - POST /api/auth/mot-de-passe-oublie '{"email":"personne-ici@exemple.test"}')"
REPONSE_INCONNUE="$(cat "$DOSSIER/corps.json")"
verifier "une adresse connue repond 200" 200 "$(code - POST /api/auth/mot-de-passe-oublie "{\"email\":\"$EMAIL_B\"}")"
verifier "  et exactement la meme chose" "$REPONSE_INCONNUE" "$(cat "$DOSSIER/corps.json")"
verifier "un lien sans jeton" 400 "$(code - GET /api/auth/reinitialisation)"
verifier "un jeton invente" 410 "$(code - GET /api/auth/reinitialisation?jeton=jamais-emis)"
verifier "  et il ne change aucun mot de passe" 410 "$(code - POST /api/auth/nouveau-mot-de-passe "{\"jeton\":\"jamais-emis\",\"nouvelle_cle\":\"$CLE_B\"}")"
verifier "une demande incomplete" 400 "$(code - POST /api/auth/nouveau-mot-de-passe '{"jeton":"x"}')"

# ---------------------------------------------------------------------------
# Lot 9.A : la pastille d'un lien
#
# Un champ de plus sur une relation. Ce qui merite d'etre verifie, ce n'est pas
# qu'il se stocke — c'est qu'il ne se stocke QUE s'il porte quelque chose, sinon
# un document qui ne s'en sert pas grossirait a chaque aller-retour.
# ---------------------------------------------------------------------------

# Le signe dollar plutot qu'un emoji : le champ accepte n'importe quel texte
# court, et un litteral ASCII traverse les shells Windows sans se faire
# reencoder en chemin. Les vrais emojis sont verifies sur la sauvegarde de
# depart, plus bas, ou ils sont deja en base.
echo "-- pastilles de lien (9.A)"
verifier "un lien prend une pastille" 200 "$(code "$BOCAL_B" PATCH /api/relations/$ID_LIEN '{"emoji":"$"}')"
verifier "  et la rend" oui "$(contient '"emoji":"$"')"
verifier "une pastille trop longue est rognee" 200 "$(code "$BOCAL_B" PATCH /api/relations/$ID_LIEN '{"emoji":"123456789012345678901234567890"}')"
verifier "  a huit points de code" oui "$(contient '"emoji":"12345678"')"
code "$BOCAL_B" GET /api/vue/sociogramme > /dev/null
verifier "la vue la descend au moteur de rendu" oui "$(contient '"emoji":"12345678"')"
code "$BOCAL_B" GET /api/export/csv?table=relations > /dev/null
verifier "l'export la nomme" oui "$(contient 'Pastille')"
verifier "une pastille vide s'efface" 200 "$(code "$BOCAL_B" PATCH /api/relations/$ID_LIEN '{"emoji":""}')"
verifier "  et ne laisse pas de champ derriere" non "$(contient '"emoji"')"

# ---------------------------------------------------------------------------
# Lot 9.C : l'essai sans compte
#
# Un visiteur recoit un vrai compte, de role `invite`, avec la sauvegarde de
# depart. Les deux choses a prouver : il ne peut rien faire d'un administrateur,
# et son travail lui reste quand il s'inscrit.
# ---------------------------------------------------------------------------

echo "-- essai sans compte (9.C)"
BOCAL_I="$DOSSIER/invite.txt"
verifier "un visiteur ouvre un essai" 201 "$(code "$BOCAL_I" POST /api/auth/invite)"
verifier "  son role le dit" invite "$(lire compte.role)"
verifier "  et il n'a aucune adresse" "" "$(lire compte.email)"
verifier "le meme cookie ne refabrique rien" 200 "$(code "$BOCAL_I" POST /api/auth/invite)"
ID_INVITE="$(lire compte.id)"
code "$BOCAL_I" GET /api/sauvegardes > /dev/null
verifier "il arrive dans un monde deja peuple" 1 "$(lire sauvegardes.length)"
verifier "  et c'est Westeros" Westeros "$(lire sauvegardes.0.nom)"
SAUVEGARDE_INVITE="$(lire sauvegardes.0.id)"

# La sauvegarde de depart, c'est la demonstration : si elle perd ses maisons ou
# ses evenements, plus personne ne voit ce que l'outil sait faire.
code "$BOCAL_I" GET /api/referentiels > /dev/null
verifier "  avec l'annee de campagne" oui "$(contient '"annee_courante"')"
verifier "  et sans document de personne" non "$(contient 'docs.google.com')"
verifier "  le type « evenement passe » est la" oui "$(contient '"historique"')"
code "$BOCAL_I" GET /api/vue/maisons > /dev/null
verifier "  les maisons ont leurs caracteristiques" oui "$(contient '"richesse"')"
code "$BOCAL_I" GET /api/vue/sociogramme > /dev/null
verifier "  des liens portent une pastille" oui "$(contient '"emoji"')"
verifier "  et d'autres sont revolus" oui "$(contient '"revolu":true')"
verifier "  des rangs de maison sont poses" oui "$(contient 'chef de maison')"

verifier "un invite edite son monde" 200 "$(code "$BOCAL_I" PATCH /api/meta '{"annee_courante":"305 AC"}')"

# Le cas « plus aucune sauvegarde » n'arrive plus a l'inscription, mais il reste
# atteignable : il suffit de tout supprimer. L'interface a une branche pour lui
# (`demarrer()` dans public/js/main.js), donc il doit rester verifie — sur un
# essai jetable, pour ne rien casser des comptes suivants.
BOCAL_VIDE="$DOSSIER/vide.txt"
code "$BOCAL_VIDE" POST /api/auth/invite > /dev/null
code "$BOCAL_VIDE" GET /api/sauvegardes > /dev/null
verifier "un essai supprime sa seule sauvegarde" 204 "$(code "$BOCAL_VIDE" DELETE /api/sauvegardes/$(lire sauvegardes.0.id))"
verifier "  et le domaine dit qu'il n'y a plus de monde" 409 "$(code "$BOCAL_VIDE" GET /api/personnes)"
verifier "un invite n'est pas administrateur" 403 "$(code "$BOCAL_I" GET /api/admin/utilisateurs)"
verifier "  ni par la porte d'edition" 403 "$(code "$BOCAL_I" GET /api/admin/arbres/$SAUVEGARDE_INVITE/referentiels)"
verifier "il n'a pas de code de secours a demander" 409 "$(code "$BOCAL_I" POST /api/auth/code-secours)"

echo "-- l'essai devient un compte (9.C)"
EMAIL_I="essai-i-$MARQUE@exemple.test"
CLE_I="$(node outils/deriver.mjs "$EMAIL_I" "mot-de-passe-I-2026")"
verifier "il s'inscrit depuis son essai" 201 "$(code "$BOCAL_I" POST /api/auth/inscription "{\"email\":\"$EMAIL_I\",\"cle\":\"$CLE_I\"}")"
verifier "  c'est une reprise, pas un compte neuf" true "$(lire reprise)"
verifier "  le meme identifiant qu'avant" "$ID_INVITE" "$(lire compte.id)"
verifier "  et il n'est plus invite" membre "$(lire compte.role)"
code "$BOCAL_I" GET /api/sauvegardes > /dev/null
verifier "son monde l'a suivi" "$SAUVEGARDE_INVITE" "$(lire sauvegardes.0.id)"
code "$BOCAL_I" GET /api/referentiels > /dev/null
verifier "  avec ce qu'il y avait change" oui "$(contient '"annee_courante":"305 AC"')"
verifier "maintenant il peut demander un code" 200 "$(code "$BOCAL_I" POST /api/auth/code-secours)"

# ---------------------------------------------------------------------------
# Lot 9.C : le document de campagne appartient a la sauvegarde
#
# Il etait en dur dans le client. A partir du moment ou n'importe qui ouvre un
# monde, ce bouton ne doit renvoyer que vers ce que cette table y a mis — et
# surtout pas executer ce qu'on y aurait glisse.
# ---------------------------------------------------------------------------

echo "-- document de campagne (9.C)"
verifier "une adresse https est acceptee" 200 "$(code "$BOCAL_B" PATCH /api/meta '{"document":"https://exemple.test/campagne"}')"
verifier "  et relue" oui "$(contient 'https://exemple.test/campagne')"
verifier "un javascript: est refuse" 400 "$(code "$BOCAL_B" PATCH /api/meta '{"document":"javascript:alert(1)"}')"
verifier "  un data: aussi" 400 "$(code "$BOCAL_B" PATCH /api/meta '{"document":"data:text/html,<script>"}')"
verifier "  une adresse incomplete aussi" 400 "$(code "$BOCAL_B" PATCH /api/meta '{"document":"pas une adresse"}')"
verifier "un patch vide ne passe pas" 400 "$(code "$BOCAL_B" PATCH /api/meta '{"titre":"tentative"}')"
verifier "le document s'efface" 200 "$(code "$BOCAL_B" PATCH /api/meta '{"document":""}')"
verifier "  et ne laisse rien" non "$(contient '"document"')"

# ---------------------------------------------------------------------------
# Lot 10.A : les lots — le meme geste sur les arbres de plusieurs comptes
#
# A redevient administrateur pour cette section : il avait ete retrograde a la
# fin du 8.F, expres. Les cibles sont B et I, deux comptes qui n'ont rien en
# commun sinon d'exister — c'est justement ce qu'un lot doit savoir mener.
# ---------------------------------------------------------------------------

echo "-- les lots sont fermes comme le reste (10.A)"
verifier "sans session, l'apercu est refuse" 401 "$(code - POST /api/admin/lots/apercu '{}')"
verifier "un membre est refuse" 403 "$(code "$BOCAL_B" POST /api/admin/lots/apercu '{}')"
verifier "  sur l'application aussi" 403 "$(code "$BOCAL_B" POST /api/admin/lots/appliquer '{}')"
verifier "  et sur le panorama" 403 "$(code "$BOCAL_B" POST /api/admin/lots/panorama '{}')"

sql "UPDATE utilisateurs SET role='admin' WHERE email_norm='$EMAIL_A'"
verifier "A redevient administrateur" 200 "$(code "$BOCAL_A" GET /api/admin/utilisateurs)"
# Les formulaires de lot se construisent a partir des catalogues du domaine.
# Ils ne doivent PAS passer par /api/referentiels, qui exige une sauvegarde
# active : un administrateur sans monde a lui perdrait ses formulaires.
verifier "les catalogues repondent" 200 "$(code "$BOCAL_A" GET /api/admin/catalogues)"
verifier "  avec les sept caracteristiques" oui "$(contient 'caracteristiques_maison')"

echo "-- ce qu'un lot refuse d'emblee"
verifier "sans compte selectionne" 400 "$(code "$BOCAL_A" POST /api/admin/lots/apercu '{"comptes":[],"operation":{"type":"meta"}}')"
verifier "operation inconnue" 400 "$(code "$BOCAL_A" POST /api/admin/lots/apercu "{\"comptes\":[\"$ID_COMPTE_B\"],\"operation\":{\"type\":\"pillage\"}}")"
verifier "compte sans la moindre sauvegarde" 404 "$(code "$BOCAL_A" POST /api/admin/lots/apercu '{"comptes":["inexistant"],"operation":{"type":"meta","annee_courante":"1 AC"}}')"
TROP="$(node -e "process.stdout.write(JSON.stringify({comptes:Array.from({length:201},(_,i)=>'c'+i),operation:{type:'meta',annee_courante:'1 AC'}}))")"
verifier "selection trop large" 400 "$(code "$BOCAL_A" POST /api/admin/lots/apercu "$TROP")"

echo "-- l'apercu ne touche a rien"
CIBLES="\"$ID_COMPTE_B\",\"$ID_INVITE\""
LOT_MAISON="{\"comptes\":[$CIBLES],\"portee\":\"active\",\"operation\":{\"type\":\"maison\",\"label\":\"Maison du lot\",\"devise\":\"Posee par lot\",\"caracteristiques\":{\"richesse\":400,\"defense\":30}}}"
verifier "l'apercu repond" 200 "$(code "$BOCAL_A" POST /api/admin/lots/apercu "$LOT_MAISON")"
verifier "  il se dit simulation" oui "$(contient '"simulation":true')"
verifier "  et annonce deux creations" 2 "$(lire resume.creees)"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  mais rien n'est entre chez B" non "$(contient 'Maison du lot')"
code "$BOCAL_I" GET /api/referentiels > /dev/null
verifier "  ni chez I" non "$(contient 'Maison du lot')"

echo "-- l'application, elle, ecrit"
verifier "le lot passe" 200 "$(code "$BOCAL_A" POST /api/admin/lots/appliquer "$LOT_MAISON")"
verifier "  deux sauvegardes servies" 2 "$(lire resume.creees)"
verifier "  et aucun refus" 0 "$(lire resume.refusees)"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "B a la maison sans avoir rien fait" oui "$(contient 'Maison du lot')"
verifier "  les bornes tiennent (400 -> 100)" oui "$(contient '"richesse":100')"
code "$BOCAL_I" GET /api/referentiels > /dev/null
verifier "I aussi" oui "$(contient 'Maison du lot')"

echo "-- rejouer un lot ne duplique rien"
verifier "le meme lot repasse" 200 "$(code "$BOCAL_A" POST /api/admin/lots/appliquer "$LOT_MAISON")"
verifier "  plus rien a creer" 0 "$(lire resume.creees)"
verifier "  tout est deja en place" 2 "$(lire resume.inchangees)"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  et aucun doublon n'est apparu" non "$(contient 'maison-du-lot-2')"

echo "-- les informations generales, en lot"
LOT_META="{\"comptes\":[$CIBLES],\"portee\":\"toutes\",\"operation\":{\"type\":\"meta\",\"annee_courante\":\"999 AC\",\"document\":\"https://exemple.test/lot\"}}"
verifier "la date et le lien partent ensemble" 200 "$(code "$BOCAL_A" POST /api/admin/lots/appliquer "$LOT_META")"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  B porte la nouvelle date" oui "$(contient '"annee_courante":"999 AC"')"
verifier "  et le lien de campagne" oui "$(contient 'https://exemple.test/lot')"
code "$BOCAL_I" GET /api/referentiels > /dev/null
verifier "  I aussi" oui "$(contient '"annee_courante":"999 AC"')"
# La validation est la meme des deux cotes : elle vit dans src/domaine/meta.ts,
# et le lot ne la contourne pas.
LOT_SALE="{\"comptes\":[$CIBLES],\"operation\":{\"type\":\"meta\",\"document\":\"javascript:alert(1)\"}}"
verifier "un javascript: est refuse en lot aussi" 200 "$(code "$BOCAL_A" POST /api/admin/lots/appliquer "$LOT_SALE")"
verifier "  ecrit nulle part" 0 "$(lire resume.mises_a_jour)"
code "$BOCAL_B" GET /api/referentiels > /dev/null
verifier "  et B garde son lien honnete" oui "$(contient 'https://exemple.test/lot')"

echo "-- un refus n'arrete pas le lot"
LOT_LIEN="{\"comptes\":[$CIBLES],\"portee\":\"active\",\"operation\":{\"type\":\"relation\",\"source\":\"fantome-absolu\",\"cible\":\"autre-fantome\",\"type_lien\":\"autre\"}}"
verifier "un lien vers des fiches absentes" 200 "$(code "$BOCAL_A" POST /api/admin/lots/appliquer "$LOT_LIEN")"
verifier "  chaque sauvegarde le dit" 2 "$(lire resume.refusees)"
verifier "  et rien n'a ete cree" 0 "$(lire resume.creees)"
verifier "  avec la raison en clair" oui "$(contient 'fantome-absolu')"

echo "-- le journal porte les ecritures du lot"
code "$BOCAL_A" GET /api/admin/journal > /dev/null
verifier "l'edition y figure" oui "$(contient '"action":"edition"')"
# I n'avait jamais ete touche par A avant ce lot : son adresse ne peut venir
# que de la.
verifier "  et le compte I y apparait" oui "$(contient "$EMAIL_I")"

echo "-- comment ils ont structure leurs vues"
verifier "le panorama repond" 200 "$(code "$BOCAL_A" POST /api/admin/lots/panorama "{\"comptes\":[$CIBLES]}")"
verifier "  un compte par ligne" 2 "$(lire comptes.length)"
verifier "  il separe le commun" oui "$(contient '"commun"')"
verifier "  et ce qui diverge" oui "$(contient '"divergent"')"
verifier "  la maison posee partout y figure" oui "$(contient 'Maison du lot')"

sql "UPDATE utilisateurs SET role='membre' WHERE email_norm='$EMAIL_A'"
verifier "A redevient membre, les lots se referment" 403 "$(code "$BOCAL_A" POST /api/admin/lots/apercu "$LOT_MAISON")"
verifier "  et le panorama aussi" 403 "$(code "$BOCAL_A" POST /api/admin/lots/panorama "{\"comptes\":[$CIBLES]}")"

# ---------------------------------------------------------------------------
# Lot 10.B : changer son mot de passe sans code de secours
#
# Le code de secours sert a reprendre un compte dont on a PERDU la cle. S'en
# servir pour un changement volontaire faisait payer un geste courant au prix
# d'un geste de detresse. Depuis ce lot, un compte ouvert demande un lien.
#
# La branche depend de l'instance : en local, `.dev.vars` porte une cle d'envoi
# factice, donc le service se dit configure ; en ligne, la cle n'est pas posee.
# On interroge /moyens et on verifie le comportement ATTENDU dans chaque cas,
# plutot que de sauter la section.
# ---------------------------------------------------------------------------

echo "-- changer son mot de passe une fois connecte (10.B)"
verifier "sans session, refuse" 401 "$(code - POST /api/auth/mot-de-passe)"
verifier "un essai n'a pas d'adresse ou envoyer" 409 "$(code "$BOCAL_VIDE" POST /api/auth/mot-de-passe)"

code - GET /api/auth/moyens > /dev/null
COURRIEL="$(lire courriel)"
if [ "$COURRIEL" = "true" ]; then
  verifier "un membre demande son lien" 200 "$(code "$BOCAL_B" POST /api/auth/mot-de-passe)"
  verifier "  et on lui dit ou il part" oui "$(contient "$EMAIL_B")"
  # Un second lien invalide le premier : un vieux courriel dans une boite ne
  # doit pas rester une porte ouverte. On ne peut pas le prouver d'ici (le
  # jeton ne vit que dans le message), mais la demande reste acceptee.
  verifier "  en redemander un reste possible" 200 "$(code "$BOCAL_B" POST /api/auth/mot-de-passe)"
else
  verifier "sans service d'envoi, refus explicite" 409 "$(code "$BOCAL_B" POST /api/auth/mot-de-passe)"
  verifier "  et il dit quoi faire a la place" oui "$(contient 'code de secours')"
fi

echo "-- les deux pages disent la meme chose que l'API"
code - GET /donnees > /dev/null
verifier "« Vos donnees » porte le bouton" oui "$(contient 'envoyerLienMdp')"
verifier "  et annonce qu'aucun code n'est demande" oui "$(contient 'ni le code de secours')"
code - GET /connexion > /dev/null
verifier "la connexion range le code derriere un bouton" oui "$(contient 'lienSecours')"
verifier "  sans le supprimer pour autant" oui "$(contient 'formulaireRecuperation')"
# Signale le 12/08 : deja connecte, la page se refermait sans un mot, et
# changer de compte devenait impossible. Elle propose maintenant le choix.
verifier "  et propose de changer de compte" oui "$(contient 'changerDeCompte')"
verifier "  en disant qui est connecte" oui "$(contient 'compteEnCours')"

# Signale le 13/08 : « Appliquer… », gris et coiffe d'un curseur d'attente, se
# lisait comme un bouton en train de charger. Un bouton eteint doit dire
# pourquoi il l'est, et n'emprunter aucun signe a ceux qui travaillent.
# `/admin.html` redirige (307) : le corps serait vide et les deux verifications
# passeraient sans rien lire. On demande l'adresse que le site sert vraiment.
code - GET /admin > /dev/null
verifier "la page d'administration repond" oui "$(contient 'btnAppliquer')"
verifier "« Appliquer » ne promet plus une suite" non "$(contient 'Appliquer…')"
verifier "  et dit pourquoi il est eteint" oui "$(contient 'raisonLot')"
code - GET /css/base.css > /dev/null
verifier "un bouton eteint n'affiche plus l'attente" oui "$(contient 'cursor: not-allowed')"
verifier "  le curseur d'attente est reserve a « occupe »" oui "$(contient '.bouton.occupe')"

# ---------------------------------------------------------------------------
# Lot 11.A : deux etages d'administration
#
# Le souverain (`admin`) peut tout, sur tout le monde. L'intendant ne peut que
# consulter et editer les comptes qu'on lui a CONFIES — et pour tout le reste
# de l'instance, ces comptes-la n'existent pas : 404, jamais 403.
#
# C'est la section la plus importante du fichier apres le cloisonnement des
# membres. Chaque route qui recoit un identifiant de compte y est reprise deux
# fois : dans le perimetre, hors du perimetre.
# ---------------------------------------------------------------------------

echo "-- 11.A le souverain nomme un intendant"
sql "UPDATE utilisateurs SET role='admin' WHERE email_norm='$EMAIL_A'"
code "$BOCAL_VIDE" GET /api/auth/moi > /dev/null
ID_ESSAI="$(lire compte.id)"

verifier "un membre n'est pas encore intendant" 403 "$(code "$BOCAL_B" GET /api/admin/contexte)"
verifier "A se sait souverain" 200 "$(code "$BOCAL_A" GET /api/admin/contexte)"
verifier "  et sans perimetre" true "$(lire souverain)"
verifier "le role « admin » ne s'accorde pas par l'API" 400 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/role '{"role":"admin"}')"
verifier "  et il dit ou il se donne" oui "$(contient 'SQL')"
verifier "un essai ne peut pas devenir intendant" 400 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_ESSAI/role '{"role":"intendant"}')"
verifier "le role d'un admin ne se touche pas" 400 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_A/role '{"role":"membre"}')"
verifier "compte inconnu" 404 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/fantome/role '{"role":"intendant"}')"
verifier "B est nomme intendant" 200 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/role '{"role":"intendant"}')"

echo "-- un intendant sans tutelle ne voit que lui-meme"
verifier "il entre" 200 "$(code "$BOCAL_B" GET /api/admin/contexte)"
verifier "  mais il n'est pas souverain" false "$(lire souverain)"
verifier "  et son perimetre se compte" 1 "$(lire comptes_en_charge)"
verifier "la liste des comptes lui repond" 200 "$(code "$BOCAL_B" GET /api/admin/utilisateurs)"
verifier "  et A n'y est pas" non "$(contient "$EMAIL_A")"
verifier "  lui, si" oui "$(contient "$EMAIL_B")"

echo "-- ce qu'un intendant ne peut PAS faire"
verifier "changer un plafond" 403 "$(code "$BOCAL_B" POST /api/admin/utilisateurs/$ID_INVITE/plafond '{"octets":131072,"sauvegardes":5}')"
verifier "  remplacer un mot de passe" 403 "$(code "$BOCAL_B" POST /api/admin/utilisateurs/$ID_INVITE/mot-de-passe '{"cle":"x"}')"
verifier "  supprimer un compte" 403 "$(code "$BOCAL_B" DELETE /api/admin/utilisateurs/$ID_INVITE)"
verifier "  nommer un intendant" 403 "$(code "$BOCAL_B" POST /api/admin/utilisateurs/$ID_INVITE/role '{"role":"intendant"}')"
verifier "  lire la liste des intendants" 403 "$(code "$BOCAL_B" GET /api/admin/intendants)"
verifier "  se confier des comptes" 403 "$(code "$BOCAL_B" PUT /api/admin/intendants/$ID_COMPTE_B/charges "{\"comptes\":[\"$ID_COMPTE_A\"]}")"
verifier "  et le refus dit ce qu'il peut" oui "$(contient 'intendant consulte')"

echo "-- hors perimetre, les comptes n'existent pas"
verifier "l'arbre de A est introuvable" 404 "$(code "$BOCAL_B" GET /api/admin/sauvegardes/$ID_REF)"
verifier "  son export aussi" 404 "$(code "$BOCAL_B" GET /api/admin/sauvegardes/$ID_REF/export)"
verifier "  ses sauvegardes aussi" 404 "$(code "$BOCAL_B" GET /api/admin/utilisateurs/$ID_COMPTE_A/sauvegardes)"
verifier "  et la porte d'edition dit le meme mot" 404 "$(code "$BOCAL_B" GET /api/admin/arbres/$ID_REF/referentiels)"
verifier "  au mot pres" oui "$(contient 'introuvable')"
verifier "un lot vise A : aucune sauvegarde a toucher" 404 "$(code "$BOCAL_B" POST /api/admin/lots/apercu "{\"comptes\":[\"$ID_COMPTE_A\"],\"operation\":{\"type\":\"meta\",\"annee_courante\":\"9 AC\"}}")"
verifier "le panorama de A ne rend rien" 0 "$(code "$BOCAL_B" POST /api/admin/lots/panorama "{\"comptes\":[\"$ID_COMPTE_A\"]}" > /dev/null; lire comptes.length)"

echo "-- le souverain lui confie un compte"
verifier "on ne confie pas a un simple membre" 400 "$(code "$BOCAL_A" PUT /api/admin/intendants/$ID_INVITE/charges "{\"comptes\":[\"$ID_COMPTE_A\"]}")"
verifier "la tutelle se pose" 200 "$(code "$BOCAL_A" PUT /api/admin/intendants/$ID_COMPTE_B/charges "{\"comptes\":[\"$ID_INVITE\",\"$ID_COMPTE_A\"]}")"
verifier "  l'invite est retenu" 1 "$(lire comptes.length)"
verifier "  et le souverain ecarte : la tutelle ne remonte pas" 1 "$(lire ecartes.length)"
verifier "la liste des intendants le montre" 200 "$(code "$BOCAL_A" GET /api/admin/intendants)"
verifier "  avec son compte en charge" 1 "$(lire intendants.0.charges)"

echo "-- dans son perimetre, l'intendant travaille"
verifier "son perimetre a grandi" 2 "$(code "$BOCAL_B" GET /api/admin/contexte > /dev/null; lire comptes_en_charge)"
verifier "il voit le compte confie" oui "$(code "$BOCAL_B" GET /api/admin/utilisateurs > /dev/null; contient "$ID_INVITE")"
verifier "  toujours pas A" non "$(contient "$EMAIL_A")"
verifier "il liste ses sauvegardes" 200 "$(code "$BOCAL_B" GET /api/admin/utilisateurs/$ID_INVITE/sauvegardes)"
verifier "il consulte son arbre" 200 "$(code "$BOCAL_B" GET /api/admin/sauvegardes/$SAUVEGARDE_INVITE)"
verifier "il l'edite par procuration" 200 "$(code "$BOCAL_B" PATCH /api/admin/arbres/$SAUVEGARDE_INVITE/meta '{"annee_courante":"305 AC"}')"
verifier "  et l'invite le retrouve chez lui" oui "$(code "$BOCAL_I" GET /api/referentiels > /dev/null; contient '305 AC')"
verifier "un lot passe sur son perimetre" 200 "$(code "$BOCAL_B" POST /api/admin/lots/appliquer "{\"comptes\":[\"$ID_INVITE\",\"$ID_COMPTE_A\"],\"portee\":\"active\",\"operation\":{\"type\":\"maison\",\"label\":\"Maison de l intendant\"}}")"
verifier "  une seule sauvegarde touchee" 1 "$(lire resume.sauvegardes)"
verifier "  celle de l'invite" oui "$(contient "$ID_INVITE")"
verifier "  et A n'a rien recu" non "$(code "$BOCAL_A" GET /api/referentiels > /dev/null; contient 'Maison de l intendant')"

echo "-- le registre suit, et ne deborde pas"
verifier "l'intendant lit un journal" 200 "$(code "$BOCAL_B" GET /api/admin/journal)"
LIGNES_INTENDANT="$(lire journal.length)"
verifier "  ses ecritures sur son joueur y sont" oui "$([ "$(journal_vise "$ID_INVITE")" -gt 0 ] && echo oui || echo non)"
# La borne du registre. Une ligne qui PORTE SUR un compte hors perimetre n'a
# rien a faire la ; une ligne qu'un administrateur a POSEE sur l'un de ses
# joueurs, si — c'est ce que le registre lui doit. Les deux se distinguent par
# la colonne, pas par la presence de l'identifiant dans le corps.
verifier "  aucune ligne ne porte sur A" 0 "$(journal_vise "$ID_COMPTE_A")"
verifier "le souverain, lui, voit la nomination" oui "$(code "$BOCAL_A" GET /api/admin/journal > /dev/null; contient '"role"')"
verifier "  et la tutelle" oui "$(contient '"tutelle"')"
# La preuve que le filtre retranche vraiment : le souverain voit tout le
# registre, l'intendant n'en voit qu'une part.
verifier "  et il en voit plus que l'intendant" oui "$([ "$(lire journal.length)" -gt "$LIGNES_INTENDANT" ] && echo oui || echo non)"

echo "-- demettre reprend tout, tutelles comprises"
verifier "B redevient membre" 200 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/role '{"role":"membre"}')"
verifier "  la porte se referme" 403 "$(code "$BOCAL_B" GET /api/admin/contexte)"
# Sur son adresse a lui, pas sur le total : le harnais tourne aussi en ligne,
# ou d'autres intendants peuvent tres bien exister sans le regarder.
verifier "  et il quitte la liste des intendants" non "$(code "$BOCAL_A" GET /api/admin/intendants > /dev/null; contient "$EMAIL_B")"
# Le remettre en fonction ne doit pas lui rendre ses anciennes tutelles : un
# pouvoir repris qui revient tout seul n'a jamais ete repris.
verifier "on le renomme" 200 "$(code "$BOCAL_A" POST /api/admin/utilisateurs/$ID_COMPTE_B/role '{"role":"intendant"}')"
verifier "  il repart sans personne" 1 "$(code "$BOCAL_B" GET /api/admin/contexte > /dev/null; lire comptes_en_charge)"
sql "UPDATE utilisateurs SET role='membre' WHERE email_norm='$EMAIL_B'"
sql "UPDATE utilisateurs SET role='membre' WHERE email_norm='$EMAIL_A'"

# ---------------------------------------------------------------------------
# Lot 10.C : la connexion Google
#
# Le flux « Authorization Code », entierement cote serveur : pas de script
# Google dans la page, parce que la CSP est `script-src 'self'` et que
# l'elargir pour un bouton affaiblirait tout le site.
#
# Ce qui se verifie sans compte Google : l'aller (redirection, parametres,
# temoin state/nonce) et TOUS les refus du retour. Seul l'echange du code
# demande un vrai projet Google Cloud — en local, `.dev.vars` porte des
# identifiants factices pour que la branche « configure » tourne quand meme.
# ---------------------------------------------------------------------------

echo "-- la connexion Google (10.C)"
code - GET /api/auth/moyens > /dev/null
verifier "l'instance dit si Google est branche" oui "$(contient '"google"')"
GOOGLE="$(lire google)"
code - GET /connexion > /dev/null
verifier "la page porte le bloc, masque par defaut" oui "$(contient 'blocGoogle')"
verifier "  et aucun script de Google" non "$(contient 'accounts.google.com/gsi')"

if [ "$GOOGLE" = "true" ]; then
  DEPART="$(entete - /api/auth/google/depart location)"
  verifier "l'aller renvoie chez Google" oui "$(porte "$DEPART" 'accounts.google.com/o/oauth2/v2/auth')"
  verifier "  avec le bon type de reponse" oui "$(porte "$DEPART" 'response_type=code')"
  verifier "  la portee minimale" oui "$(porte "$DEPART" 'scope=openid+email')"
  verifier "  un state" oui "$(porte "$DEPART" 'state=')"
  verifier "  et un nonce" oui "$(porte "$DEPART" 'nonce=')"
  TEMOIN="$(entete - /api/auth/google/depart set-cookie)"
  verifier "il pose un temoin de demande" oui "$(porte "$TEMOIN" 'ft_google=')"
  # SameSite=Strict ferait perdre le temoin au retour de chez Google, et TOUTE
  # connexion echouerait sur « demande expiree ». C'est la verification qui
  # protege le mieux cette famille de routes.
  verifier "  en SameSite=Lax, sinon rien ne revient" oui "$(porte "$TEMOIN" 'SameSite=Lax')"
  verifier "  et cantonne a sa famille de routes" oui "$(porte "$TEMOIN" 'Path=/api/auth/google')"

  RETOUR="$(entete - '/api/auth/google/retour?code=x&state=y' location)"
  verifier "un retour sans temoin est refuse" oui "$(porte "$RETOUR" 'erreur=')"
  # Le coeur de la protection CSRF : sans ce test, un tiers pourrait faire
  # aboutir chez vous une connexion qu'il a lancee lui-meme.
  BOCAL_G="$DOSSIER/google.txt"
  code "$BOCAL_G" GET /api/auth/google/depart > /dev/null
  MAUVAIS="$(entete "$BOCAL_G" '/api/auth/google/retour?code=x&state=pas-le-bon' location)"
  verifier "  un state qui ne correspond pas est refuse" oui "$(porte "$MAUVAIS" 'invalide')"
  ANNULE="$(entete - '/api/auth/google/retour?error=access_denied' location)"
  verifier "  un refus chez Google se dit simplement" oui "$(porte "$ANNULE" 'annul')"
  NU="$(entete - /api/auth/google/retour location)"
  verifier "  un retour vide aussi" oui "$(porte "$NU" 'erreur=')"
else
  verifier "sans identifiants, l'aller n'existe pas" 404 "$(code - GET /api/auth/google/depart)"
  verifier "  ni le retour" 404 "$(code - GET /api/auth/google/retour)"
fi

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
