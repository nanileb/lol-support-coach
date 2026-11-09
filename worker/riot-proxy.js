// Relais Riot pour Coach Support (Cloudflare Worker).
// Garde la clé Riot côté serveur (secret RIOT_KEY) et n'expose que 3 lectures :
//   /live?riotId=&platform=             partie en cours
//   /matches?riotId=&platform=&count=   dernières parties classées (ids)
//   /match?id=&platform=                une partie + sa chronologie, résumées pour l'analyse
//   /ladder?platform=&tier=             joueurs Challenger / Grandmaster / Master (puuid), pour calculer les builds
//   /ids?puuid=&platform=&count=&start= parties classées d'un joueur (ids)
// Variables : RIOT_KEY (secret, obligatoire), ALLOWED_ORIGIN (ex. https://nanileb.github.io, conseillé).

const REGION = { euw1: 'europe', eun1: 'europe', tr1: 'europe', me1: 'europe', ru: 'europe', na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'sea', kr: 'asia', jp1: 'asia' };
const ACCOUNT_REGION = { sea: 'americas' };

const CH_KEYS = ['killParticipation', 'visionScorePerMinute', 'controlWardTimeCoverageInRiverOrEnemyHalf', 'enemyChampionImmobilizations', 'effectiveHealAndShielding', 'wardTakedowns', 'wardTakedownsBefore20M', 'stealthWardsPlaced', 'completeSupportQuestInTime', 'laningPhaseGoldExpAdvantage', 'earlyLaningPhaseGoldExpAdvantage', 'maxLevelLeadLaneOpponent', 'takedownsFirstXMinutes', 'dragonTakedowns', 'riftHeraldTakedown', 'voidMonsterKill', 'saveAllyFromDeath', 'pickKillWithAlly', 'immobilizeAndKillWithAlly', 'visionScoreAdvantageLaneOpponent', 'survivedSingleDigitHpCount', 'teamDamagePercentage'];
const P_KEYS = ['puuid', 'participantId', 'championName', 'teamId', 'teamPosition', 'win', 'kills', 'deaths', 'assists', 'visionScore', 'wardsPlaced', 'wardsKilled', 'detectorWardsPlaced', 'visionWardsBoughtInGame', 'totalMinionsKilled', 'neutralMinionsKilled', 'goldEarned', 'champLevel', 'totalDamageDealtToChampions', 'totalHealsOnTeammates', 'totalDamageShieldedOnTeammates', 'timeCCingOthers', 'totalTimeSpentDead', 'item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'summoner1Id', 'summoner2Id', 'magicDamageDealtToChampions', 'physicalDamageDealtToChampions', 'trueDamageDealtToChampions', 'totalDamageTaken', 'totalHeal', 'damageSelfMitigated'];
const EVENTS = ['WARD_PLACED', 'WARD_KILL', 'CHAMPION_KILL', 'ELITE_MONSTER_KILL', 'BUILDING_KILL', 'ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO', 'LEVEL_UP', 'SKILL_LEVEL_UP'];
const E_KEYS = ['creatorId', 'killerId', 'victimId', 'assistingParticipantIds', 'position', 'wardType', 'monsterType', 'monsterSubType', 'killerTeamId', 'itemId', 'participantId', 'level', 'buildingType', 'laneType', 'teamId', 'skillSlot', 'beforeId', 'afterId'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allow = env.ALLOWED_ORIGIN || '*';
    const cors = { 'Access-Control-Allow-Origin': allow === '*' ? '*' : (origin === allow ? origin : allow), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, s = 200, cache = 'no-store') => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache } });
    if (allow !== '*' && origin && origin !== allow) return json({ error: 'origin_not_allowed' }, 403);
    if (!env.RIOT_KEY) return json({ error: 'missing_key' }, 500);

    const url = new URL(req.url);
    const platform = (url.searchParams.get('platform') || 'euw1').toLowerCase();
    const region = REGION[platform];
    if (!region) return json({ error: 'bad_request' }, 400);
    const riot = u => fetch(u, { headers: { 'X-Riot-Token': env.RIOT_KEY } });
    const fail = r => { const o = json({ error: 'riot_error', status: r.status }, r.status === 401 || r.status === 403 ? 403 : r.status === 429 ? 429 : 502); if (r.status === 429) o.headers.set('Retry-After', r.headers.get('Retry-After') || '10'); return o; };

    async function account() {
      const [name, tag] = (url.searchParams.get('riotId') || '').split('#');
      if (!name || !tag) return { err: json({ error: 'bad_request' }, 400) };
      const r = await riot(`https://${ACCOUNT_REGION[region] || region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
      if (r.status === 404) return { err: json({ error: 'account_not_found' }, 404) };
      if (!r.ok) return { err: fail(r) };
      return { puuid: (await r.json()).puuid };
    }

    if (url.pathname === '/live') {
      const a = await account(); if (a.err) return a.err;
      const live = await riot(`https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${a.puuid}`);
      if (live.status === 404) return json({ error: 'not_in_game', puuid: a.puuid }, 404);
      if (!live.ok) return fail(live);
      const g = await live.json();
      return json({
        puuid: a.puuid,
        game: {
          gameId: g.gameId, gameMode: g.gameMode, gameQueueConfigId: g.gameQueueConfigId, gameLength: g.gameLength, gameStartTime: g.gameStartTime,
          participants: g.participants.map(p => ({ puuid: p.puuid, championId: p.championId, teamId: p.teamId, spell1Id: p.spell1Id, spell2Id: p.spell2Id, riotId: p.riotId }))
        }
      });
    }

    if (url.pathname === '/matches') {
      const a = await account(); if (a.err) return a.err;
      const count = Math.min(30, Math.max(1, Number(url.searchParams.get('count')) || 15));
      const r = await riot(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${a.puuid}/ids?type=ranked&start=0&count=${count}`);
      if (!r.ok) return fail(r);
      return json({ puuid: a.puuid, ids: await r.json() });
    }

    if (url.pathname === '/ladder') {
      const tier = ({ challenger: 'challengerleagues', grandmaster: 'grandmasterleagues', master: 'masterleagues' })[url.searchParams.get('tier') || 'challenger'];
      if (!tier) return json({ error: 'bad_request' }, 400);
      const r = await riot(`https://${platform}.api.riotgames.com/lol/league/v4/${tier}/by-queue/RANKED_SOLO_5x5`);
      if (!r.ok) return fail(r);
      const l = await r.json();
      return json({ puuids: (l.entries || []).sort((a, b) => b.leaguePoints - a.leaguePoints).map(e => e.puuid).filter(Boolean) }, 200, 'public, max-age=3600');
    }

    if (url.pathname === '/ids') {
      const puuid = url.searchParams.get('puuid') || '';
      if (!/^[\w-]{40,90}$/.test(puuid)) return json({ error: 'bad_request' }, 400);
      const count = Math.min(50, Math.max(1, Number(url.searchParams.get('count')) || 20));
      const start = Number(url.searchParams.get('start')) || 0;
      const r = await riot(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${count}${start ? '&startTime=' + Math.floor(start) : ''}`);
      if (!r.ok) return fail(r);
      return json({ ids: await r.json() });
    }

    if (url.pathname === '/match') {
      const id = url.searchParams.get('id') || '';
      if (!/^[A-Z0-9]+_\d+$/.test(id)) return json({ error: 'bad_request' }, 400);
      const [m, t] = await Promise.all([
        riot(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}`),
        riot(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}/timeline`)
      ]);
      if (!m.ok) return fail(m);
      const info = (await m.json()).info;
      const out = {
        id, gameCreation: info.gameCreation, gameDuration: info.gameDuration, queueId: info.queueId, gameVersion: info.gameVersion,
        participants: info.participants.map(p => {
          const o = {}; P_KEYS.forEach(k => o[k] = p[k]);
          if (p.perks && p.perks.styles) o.perks = { s: p.perks.styles.map(st => ({ st: st.style, sel: st.selections.map(x => x.perk) })), sh: p.perks.statPerks };
          o.challenges = {}; CH_KEYS.forEach(k => { if (p.challenges && p.challenges[k] != null) o.challenges[k] = p.challenges[k]; });
          return o;
        }),
        teams: info.teams.map(t => ({ teamId: t.teamId, win: t.win, objectives: t.objectives })),
        frames: [], events: []
      };
      if (t.ok) {
        const td = await t.json();
        for (const f of td.info.frames) {
          const pf = {};
          for (const [pid, v] of Object.entries(f.participantFrames)) pf[pid] = { x: v.position && v.position.x, y: v.position && v.position.y, lvl: v.level, xp: v.xp, gold: v.totalGold, cs: v.minionsKilled, jg: v.jungleMinionsKilled };
          out.frames.push({ t: f.timestamp, p: pf });
          for (const e of f.events) if (EVENTS.includes(e.type)) {
            const o = { type: e.type, t: e.timestamp };
            E_KEYS.forEach(k => { if (e[k] != null) o[k] = e[k]; });
            out.events.push(o);
          }
        }
      }
      return json(out, 200, 'public, max-age=86400');
    }

    return json({ error: 'not_found' }, 404);
  }
};
