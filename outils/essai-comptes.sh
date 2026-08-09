#!/usr/bin/env bash
# Essai bout en bout des comptes (lot 1).
#
#   bash outils/essai-comptes.sh                       # base locale (npm run dev)
#   bash outils/essai-comptes.sh https://familytree.schlub-perso.workers.dev
#
# Cree deux comptes jetables et verifie qu'aucun ne voit l'autre. Les adresses
# portent un horodatage, donc le script est rejouable sans nettoyage.

set -u
BASE="${1:-http://127.0.0.1:8787}"
MARQUE="$(date +%s)"
EMAIL_A="essai-a-$MARQUE@exemple.test"
EMAIL_B="essai-b-$MARQUE@exemple.test"
MDP_A="mot-de-passe-A-2026"
MDP_B="mot-de-passe-B-2026"

# Volontairement dans le projet, en chemin relatif : sous Git Bash, `mktemp -d`
# rend un chemin POSIX (/tmp/...) que le node.exe de Windows ne sait pas ouvrir.
DOSSIER="./.essai-$MARQUE"
mkdir -p "$DOSSIER"
trap 'rm -rf "$DOSSIER"' EXIT
BOCAL_A="$DOSSIER/a.txt"
BOCAL_B="$DOSSIER/b.txt"

echecs=0
verifier() {
  local libelle="$1" attendu="$2" obtenu="$3"
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

lire() { # lire <chemin.pointe> : lit un champ de la derniere reponse
  node -e "
    const fs=require('fs');
    let d={};
    try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    const v='$1'.split('.').reduce((o,c)=>(o??{})[c], d);
    process.stdout.write(v===undefined||v===null?'':String(v));
  " 2>/dev/null
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

echo "-- cloisonnement"
verifier "B s'inscrit" 201 "$(code "$BOCAL_B" POST /api/auth/inscription "{\"email\":\"$EMAIL_B\",\"cle\":\"$CLE_B\"}")"
code "$BOCAL_B" GET /api/auth/moi > /dev/null
verifier "le cookie de B donne B, pas A" "$EMAIL_B" "$(lire compte.email)"
code "$BOCAL_A" GET /api/auth/moi > /dev/null
verifier "le cookie de A donne toujours A" "$EMAIL_A" "$(lire compte.email)"

echo "-- deconnexion"
verifier "A se deconnecte" 204 "$(code "$BOCAL_A" POST /api/auth/deconnexion)"
verifier "son cookie ne vaut plus rien" 401 "$(code "$BOCAL_A" GET /api/auth/moi)"

echo "-- recuperation par code de secours"
CLE_A2="$(node outils/deriver.mjs "$EMAIL_A" "nouveau-mot-de-passe-2026")"
verifier "mauvais code refuse" 401 "$(code - POST /api/auth/recuperation "{\"email\":\"$EMAIL_A\",\"code_secours\":\"AAAAA-BBBBB-CCCCC-DDDDD\",\"nouvelle_cle\":\"$CLE_A2\"}")"
verifier "bon code accepte" 200 "$(code - POST /api/auth/recuperation "{\"email\":\"$EMAIL_A\",\"code_secours\":\"$CODE_SECOURS_A\",\"nouvelle_cle\":\"$CLE_A2\"}")"
verifier "l'ancien mot de passe ne marche plus" 401 "$(code - POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A\"}")"
verifier "le nouveau marche" 200 "$(code "$BOCAL_A" POST /api/auth/connexion "{\"email\":\"$EMAIL_A\",\"cle\":\"$CLE_A2\"}")"

echo
if [ "$echecs" -eq 0 ]; then
  echo "Tout est passe."
else
  echo "$echecs verification(s) en echec."
fi
exit "$echecs"
