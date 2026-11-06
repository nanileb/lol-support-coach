// Relais Riot pour Coach Support (Cloudflare Worker).
// Garde la clé Riot côté serveur (secret RIOT_KEY) et n'expose que la recherche de partie en cours.
// Variables : RIOT_KEY (secret, obligatoire), ALLOWED_ORIGIN (ex. https://nanileb.github.io, conseillé).

const REGION = { euw1: 'europe', eun1: 'europe', tr1: 'europe', me1: 'europe', ru: 'europe', na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas', kr: 'asia', jp1: 'asia' };

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allow = env.ALLOWED_ORIGIN || '*';
    const cors = { 'Access-Control-Allow-Origin': allow === '*' ? '*' : (origin === allow ? origin : allow), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (allow !== '*' && origin && origin !== allow) return json({ error: 'origin_not_allowed' }, 403);
    if (!env.RIOT_KEY) return json({ error: 'missing_key' }, 500);

    const url = new URL(req.url);
    if (url.pathname !== '/live') return json({ error: 'not_found' }, 404);
    const riotId = url.searchParams.get('riotId') || '';
    const platform = (url.searchParams.get('platform') || 'euw1').toLowerCase();
    const region = REGION[platform];
    const [name, tag] = riotId.split('#');
    if (!region || !name || !tag) return json({ error: 'bad_request' }, 400);

    const riot = u => fetch(u, { headers: { 'X-Riot-Token': env.RIOT_KEY } });
    const acc = await riot(`https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    if (acc.status === 404) return json({ error: 'account_not_found' }, 404);
    if (!acc.ok) return json({ error: 'riot_error', status: acc.status }, acc.status === 401 || acc.status === 403 ? 403 : 502);
    const { puuid } = await acc.json();

    const live = await riot(`https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`);
    if (live.status === 404) return json({ error: 'not_in_game', puuid }, 404);
    if (!live.ok) return json({ error: 'riot_error', status: live.status }, live.status === 401 || live.status === 403 ? 403 : 502);
    const g = await live.json();
    return json({
      puuid,
      game: {
        gameId: g.gameId, gameMode: g.gameMode, gameQueueConfigId: g.gameQueueConfigId, gameLength: g.gameLength, gameStartTime: g.gameStartTime,
        participants: g.participants.map(p => ({ puuid: p.puuid, championId: p.championId, teamId: p.teamId, spell1Id: p.spell1Id, spell2Id: p.spell2Id, riotId: p.riotId }))
      }
    });
  }
};
