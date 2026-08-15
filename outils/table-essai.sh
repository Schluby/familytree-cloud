#!/usr/bin/env bash
# Monte une table de jeu jetable dans la base LOCALE, pour regarder le plan
# collectif avec de vraies divergences plutôt qu'avec six mondes identiques.
#
#   bash outils/table-essai.sh
#
# Un maître de jeu (intendant, puis admin) et trois joueurs, chacun partant du
# même Westeros. Puis on fait diverger leurs mondes exprès :
#
#   - le joueur 1 renomme « Eddard Stark » en « Ned Stark » (même identifiant) ;
#   - le joueur 2 recrée la fiche sous un autre identifiant, avec une faute ;
#   - le joueur 3 supprime quelqu'un et pose un lien que personne n'a.
#
# C'est exactement ce qu'une table produit en trois séances, et c'est ce que le
# rapprochement doit savoir démêler. Le script imprime à la fin de quoi se
# connecter.
#
# N'EXISTE QUE POUR LA BASE LOCALE. Il écrit en SQL dans `.wrangler/state`.

set -u
BASE="${1:-http://127.0.0.1:8787}"
MARQUE="$(date +%s)"
MDP="table-2026-essai"

DOSSIER="./.table-$MARQUE"
mkdir -p "$DOSSIER"
trap 'rm -rf "$DOSSIER"' EXIT

sql() {
  npx wrangler d1 execute familytree --local --command "$1" > /dev/null 2>&1
}

appel() { # appel <bocal> <methode> <chemin> [corps]
  local bocal="$1" methode="$2" chemin="$3" corps="${4:-}"
  local args=(-s -o "$DOSSIER/corps.json" -w '%{http_code}' -X "$methode" -H 'Content-Type: application/json' -b "$bocal" -c "$bocal")
  [ -n "$corps" ] && args+=(-d "$corps")
  curl "${args[@]}" "$BASE$chemin"
}

lire() {
  node -e "
    const fs=require('fs');
    let d={}; try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    const v='$1'.split('.').reduce((o,c)=>(o??{})[c], d);
    process.stdout.write(v===undefined||v===null?'':String(v));
  " 2>/dev/null
}

sienne() {
  node -e "
    const fs=require('fs');
    let d={}; try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    const l=(d.sauvegardes||[]).filter(s=>!s.demo);
    process.stdout.write(String((l[0]||{}).id||''));
  " 2>/dev/null
}

demo_id() {
  node -e "
    const fs=require('fs');
    let d={}; try { d=JSON.parse(fs.readFileSync('$DOSSIER/corps.json','utf8')); } catch {}
    const l=(d.sauvegardes||[]).filter(s=>s.demo);
    process.stdout.write(String((l[0]||{}).id||''));
  " 2>/dev/null
}

creer() { # creer <role> <numero> -> imprime "email;bocal;sauvegarde"
  local email="table-$2-$MARQUE@exemple.test"
  local bocal="$DOSSIER/$2.txt"
  # Le garde-fou est de trois inscriptions par heure et par IP : on le remet à
  # zéro entre chaque compte, sinon le quatrième est refusé.
  sql "DELETE FROM tentatives"
  local cle
  cle="$(node outils/deriver.mjs "$email" "$MDP")"
  appel "$bocal" POST /api/auth/inscription "{\"email\":\"$email\",\"cle\":\"$cle\"}" > /dev/null

  # Depuis le lot 14, un compte neuf n'a que la **démonstration**, qui ne se
  # conserve pas et que le plan collectif écarte exprès. On refait donc le geste
  # que fait un vrai joueur : « en faire mon monde », puis l'ouvrir.
  appel "$bocal" GET /api/sauvegardes > /dev/null
  local demo
  demo="$(demo_id)"
  appel "$bocal" POST /api/sauvegardes \
    "{\"nom\":\"Westeros\",\"depuis\":\"$demo\",\"contenu\":\"copie\"}" > /dev/null
  local arbre
  arbre="$(lire sauvegarde.id)"
  appel "$bocal" POST "/api/sauvegardes/$arbre/activer" > /dev/null
  printf '%s;%s;%s' "$email" "$bocal" "$arbre"
}

echo "-- montage d'une table jetable"
MJ="$(creer mj mj)"
J1="$(creer joueur j1)"
J2="$(creer joueur j2)"
J3="$(creer joueur j3)"

champ() { printf '%s' "$1" | cut -d';' -f"$2"; }

EMAIL_MJ="$(champ "$MJ" 1)"
for entree in "$J1" "$J2" "$J3"; do
  echo "   joueur : $(champ "$entree" 1) — arbre $(champ "$entree" 3)"
done

# Le maître de jeu devient administrateur. Le rôle se donne en SQL, jamais par
# l'interface : c'est la règle du projet, et ce script ne fait pas exception.
sql "UPDATE utilisateurs SET role = 'admin' WHERE email_norm = '$EMAIL_MJ'"
echo "   maître de jeu : $EMAIL_MJ (admin)"

echo "-- on fait diverger les mondes"

# J1 : même identifiant, autre nom. Le rapprochement doit les réunir par l'id.
appel "$(champ "$J1" 2)" PATCH /api/personnes/eddard-stark '{"prenom":"Ned","nom":"Stark"}' > /dev/null
echo "   J1 : eddard-stark renommé « Ned Stark »"

# J2 : une seconde fiche pour la même personne, avec une faute de frappe. Rien
# ne les relie qu'une ressemblance de nom — c'est le cas que le seuil sert à
# rattraper.
appel "$(champ "$J2" 2)" POST /api/personnes '{"prenom":"Edard","nom":"Starkk","maison":"stark"}' > /dev/null
echo "   J2 : « Edard Starkk » créé à côté"

# J3 : une fiche en moins, et un lien que personne d'autre n'a.
appel "$(champ "$J3" 2)" DELETE /api/personnes/bran-stark > /dev/null
appel "$(champ "$J3" 2)" POST /api/relations \
  '{"source":"eddard-stark","cible":"jon-snow","type":"ami","label":"secret de Winterfell"}' > /dev/null
echo "   J3 : bran-stark supprimé, un lien « ami » ajouté"

echo
echo "Connectez-vous en tant que $EMAIL_MJ"
echo "  mot de passe : $MDP"
echo "  puis ouvrez  : $BASE/collectif.html"
