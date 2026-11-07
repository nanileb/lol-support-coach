# Coach Support

App mobile (PWA) pour progresser en support sur League of Legends : choix du support dans ton pool selon la synergie, build adapté à l'équipe adverse, analyse de la botlane et chronologie des wards / objectifs avec alertes.

**Ouvrir l'app :** https://nanileb.github.io/lol-support-coach/
Sur iPhone : Safari > Partager > « Sur l'écran d'accueil ». Sur Android : Chrome > menu > « Installer l'application ».

## Données et mises à jour de patch

- **Patch, champions, objets** : lus en direct sur Data Dragon (Riot), en français. Un nouveau champion ou un objet retiré est pris en compte tout seul.
- **Méta** (`meta.json`) : tiers et taux de victoire des supports, profils des champions, duos connus, counters, profils des junglers, timers des objectifs, règles du support (quête de rôle, pénalité de roam). À mettre à jour à chaque patch ; l'app signale quand le patch en jeu est plus récent que ces données.

## Partie en direct (clé Riot)

Riot interdit les appels directs depuis un navigateur, donc l'app passe par un petit relais Cloudflare qui garde la clé secrète.

1. Crée un compte gratuit sur https://dash.cloudflare.com, puis **Workers & Pages > Create > Worker**. Nomme-le `lol-relais`, déploie, puis **Edit code** : colle le contenu de `worker/riot-proxy.js` et **Deploy**.
2. Dans le Worker : **Settings > Variables and Secrets** :
   - `RIOT_KEY` : ta clé Riot (Personal API Key). **Type Secret obligatoire** : une variable de type Text est effacée à chaque déploiement depuis GitHub.
   - `ALLOWED_ORIGIN` (texte) : `https://nanileb.github.io`
3. Copie l'adresse du Worker (ex. `https://lol-relais.ton-nom.workers.dev`) dans l'app : **Réglages > Adresse du relais Riot**.

Le relais n'expose qu'une seule route : `/live?riotId=Pseudo%23TAG&platform=euw1` (compte via account-v1, puis partie en cours via spectator-v5).

Sans relais, le bouton **OP.GG** ouvre ta partie en cours et tu saisis les champions adverses à la main.

## Carte

`map-sr.jpg` : minimap officielle de la Faille (texture `2dlevelminimap_base_baron1`, Riot Games, via CommunityDragon) avec les buissons tirés de la grille de navigation du client (`aipath_srx`, extraite par le projet iamywl/Web_game). Positions des tours et inhibiteurs : `Base_SRX` du client.
