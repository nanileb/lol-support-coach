#!/usr/bin/env bash
# Télécharge Data Dragon fr_FR (dernière version) dans tools/checks/dd/ pour les garde-fous.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dd
V=$(curl -fsS https://ddragon.leagueoflegends.com/api/versions.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0]))')
for f in champion item runesReforged summoner; do curl -fsS -o dd/$f.json "https://ddragon.leagueoflegends.com/cdn/$V/data/fr_FR/$f.json"; done
echo "Data Dragon $V"
