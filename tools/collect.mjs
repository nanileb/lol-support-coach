// Calcule les builds par champion et par poste à partir des parties classées des meilleurs joueurs
// (Challenger / Grandmaster, EUW + KR), via le relais Riot de l'app. Écrit builds.json.
// Usage : node tools/collect.mjs [maxMatches]   (variable RELAY facultative)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

const RELAY = (process.env.RELAY || 'https://lol-support-coach.62z7h87vzm.workers.dev').replace(/\/+$/, '');
const MAX = Number(process.argv[2] || process.env.MAX_MATCHES || 2500);
const REGIONS = (process.env.REGIONS || 'euw1,kr').split(',');
const PLAYERS = Number(process.env.PLAYERS || 500);
const STORE = 'data/samples.json.gz'; // parties déjà analysées sur ce patch, cumulées d'une collecte à l'autre
const DD = 'https://ddragon.leagueoflegends.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ~100 appels Riot / 2 min avec une clé personnelle : on espace les requêtes.
let last = 0;
async function relay(path, cost = 1) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = last + Number(process.env.PACE_MS || 1250) * cost - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    let r;
    try { r = await fetch(RELAY + path); } catch (e) { await sleep(5000); continue; }
    if (r.status === 429) { const s = Number(r.headers.get('Retry-After')) || 20; log('429, pause', s, 's'); await sleep(s * 1000 + 500); continue; }
    if (r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}

const versions = await (await fetch(`${DD}/api/versions.json`)).json();
const V = versions[0];
const items = (await (await fetch(`${DD}/cdn/${V}/data/en_US/item.json`)).json()).data;
const champs = (await (await fetch(`${DD}/cdn/${V}/data/en_US/champion.json`)).json()).data;
const isBoots = id => { const d = items[id]; return d && (d.tags || []).includes('Boots') && id !== '1001' && d.gold.total >= 900; };
const isLegendary = id => {
  const d = items[id]; if (!d || !d.gold || !d.gold.purchasable || !(d.maps || {})['11']) return false;
  if ((d.into || []).length || (d.tags || []).includes('Consumable') || isBoots(id)) return false;
  return d.gold.total >= 2000;
};
const ASSASSIN = new Set(Object.values(champs).filter(c => c.tags.includes('Assassin')).map(c => c.id));

/* 1. Joueurs */
const queue = [];
for (const pf of REGIONS) {
  const seen = new Set();
  for (const tier of ['challenger', 'grandmaster', 'master']) {
    const l = await relay(`/ladder?platform=${pf}&tier=${tier}`);
    (l && l.puuids || []).forEach(p => seen.add(p));
    if (seen.size >= PLAYERS) break;
  }
  [...seen].slice(0, PLAYERS).forEach(p => queue.push({ pf, p }));
  log(pf, Math.min(seen.size, PLAYERS), 'joueurs');
}
if (!queue.length) { console.error('Aucun joueur : relais pas à jour ou clé refusée.'); process.exit(1); }

/* 2. Parties (10 derniers jours) */
const since = Math.floor(Date.now() / 1000) - 10 * 86400;
const ids = new Map();
for (let i = 0; i < queue.length && ids.size < MAX * 1.6; i++) {
  const { pf, p } = queue[(i * 7919) % queue.length]; // ordre mélangé, régions alternées
  const r = await relay(`/ids?platform=${pf}&puuid=${p}&count=20&start=${since}`);
  (r && r.ids || []).forEach(id => ids.has(id) || ids.set(id, pf));
  if (i % 50 === 0) log('ids', i, '/', queue.length, '→', ids.size, 'parties');
}

/* 3. Détail des parties (on saute celles déjà analysées lors d'une collecte précédente du même patch) */
const prev = existsSync(STORE) ? JSON.parse(gunzipSync(readFileSync(STORE)).toString()) : { patch: null, samples: [] };
const prevMids = new Set(prev.samples.map(s => s.mid));
log('déjà en stock :', prevMids.size, 'parties du patch', prev.patch);
const games = [];
let newest = null;
// On compte seulement les parties du patch le plus récent : on continue tant qu'on n'en a pas MAX (dans la limite de 1,6 × MAX lues).
const onNewest = () => games.filter(g => g.ver === newest).length;
let read = 0;
for (const [id, pf] of ids) {
  if (onNewest() >= MAX || read >= MAX * 1.6) break;
  if (prevMids.has(id)) continue;
  read++;
  const m = await relay(`/match?id=${id}&platform=${pf}`, 2);
  if (!m || m.queueId !== 420 || m.gameDuration < 900 || !m.events) continue;
  const ver = (m.gameVersion || '').split('.').slice(0, 2).join('.');
  if (!newest || ver > newest) newest = ver;
  games.push({ ...m, ver, id: m.id || id });
  if (games.length % 100 === 0) log('parties', games.length, '· patch récent', onNewest());
}
// garder le patch le plus récent, compléter avec le précédent si trop peu de parties
const byVer = {}; games.forEach(g => (byVer[g.ver] = byVer[g.ver] || []).push(g));
const vers = Object.keys(byVer).sort().reverse();
let used = byVer[vers[0]] || [];
if (used.length < 1500 && vers[1]) used = used.concat(byVer[vers[1]]);
log('patchs', vers.slice(0, 3).map(v => v + ':' + byVer[v].length).join(' '), '→ utilisées', used.length);

/* 4. Échantillons : un par joueur et par partie */
const samples = [];
for (const g of used) {
  const P = g.participants, dur = g.gameDuration / 60;
  for (const me of P) {
    const pos = me.teamPosition; if (!pos) continue;
    const foes = P.filter(p => p.teamId !== me.teamId), mates = P.filter(p => p.teamId === me.teamId && p !== me);
    const dmg = k => foes.reduce((a, p) => a + (p[k] || 0), 0);
    const tot = dmg('magicDamageDealtToChampions') + dmg('physicalDamageDealtToChampions') + dmg('trueDamageDealtToChampions') || 1;
    const f = {
      ap: dmg('magicDamageDealtToChampions') / tot,
      ad: dmg('physicalDamageDealtToChampions') / tot,
      heal: foes.reduce((a, p) => a + (p.totalHeal || 0) + (p.totalHealsOnTeammates || 0), 0) / dur,
      tank: foes.reduce((a, p) => a + (p.damageSelfMitigated || 0), 0) / dur,
      cc: foes.reduce((a, p) => a + (p.timeCCingOthers || 0), 0) / dur,
      assassin: foes.filter(p => ASSASSIN.has(p.championName)).length
    };
    // achats dans l'ordre (annulations retirées)
    const buys = [];
    for (const e of g.events) {
      if (e.participantId !== me.participantId) continue;
      if (e.type === 'ITEM_PURCHASED') buys.push({ id: String(e.itemId), t: e.t });
      else if (e.type === 'ITEM_UNDO' && e.beforeId) { for (let k = buys.length - 1; k >= 0; k--) if (buys[k].id === String(e.beforeId)) { buys.splice(k, 1); break; } }
    }
    const start = buys.filter(b => b.t < 70000).map(b => b.id).sort();
    const legs = []; buys.forEach(b => { if (isLegendary(b.id) && !legs.includes(b.id)) legs.push(b.id); });
    const fin = [0, 1, 2, 3, 4, 5].map(k => String(me['item' + k])).filter(id => id !== '0');
    const boots = fin.find(isBoots) || buys.map(b => b.id).filter(isBoots).pop() || null;
    // ordre des compétences
    const lv = { 1: 0, 2: 0, 3: 0 }, maxed = [], first3 = [];
    g.events.filter(e => e.type === 'SKILL_LEVEL_UP' && e.participantId === me.participantId).forEach(e => {
      const s = e.skillSlot; if (s >= 1 && s <= 3) { lv[s]++; if (first3.length < 3) first3.push(s); if (lv[s] === 5) maxed.push(s); }
    });
    [1, 2, 3].sort((a, b) => lv[b] - lv[a]).forEach(s => maxed.includes(s) || maxed.push(s));
    const opp = foes.find(p => p.teamPosition === pos);
    const duo = pos === 'BOTTOM' ? mates.find(p => p.teamPosition === 'UTILITY') : pos === 'UTILITY' ? mates.find(p => p.teamPosition === 'BOTTOM') : null;
    const rp = me.perks && me.perks.s ? `${me.perks.s[0].st}:${me.perks.s[0].sel.join(',')}|${me.perks.s[1].st}:${me.perks.s[1].sel.join(',')}|${[me.perks.sh.offense, me.perks.sh.flex, me.perks.sh.defense].join(',')}` : null;
    samples.push({
      key: me.championName + '|' + pos, win: me.win, f, start: start.join(','), legs, items: [...new Set([...legs, ...fin.filter(isLegendary)])], boots,
      spells: [me.summoner1Id, me.summoner2Id].sort((a, b) => a - b).join(','), runes: rp, ks: me.perks && me.perks.s ? me.perks.s[0].sel[0] : null,
      skills: maxed.slice(0, 3).map(s => 'QWE'[s - 1]).join(''), early: first3.map(s => 'QWE'[s - 1]).join(''),
      opp: opp && opp.championName, duo: duo && duo.championName,
      mates: mates.map(p => p.championName), foes: foes.map(p => p.championName), mid: g.id || g.matchId, ver: g.ver,
      st: (() => { const tk = [me, ...mates].reduce((a, x) => a + (x.kills || 0), 0) || 1, td = [me, ...mates].reduce((a, x) => a + (x.totalDamageDealtToChampions || 0), 0) || 1, r = x => Math.round(x * 1000) / 1000;
        return { csm: r(((me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0)) / dur), vspm: r((me.visionScore || 0) / dur), ctrl: me.visionWardsBoughtInGame, wkpm: r((me.wardsKilled || 0) / dur), deaths: me.deaths, kp: r(((me.kills || 0) + (me.assists || 0)) / tk), dmg: r((me.totalDamageDealtToChampions || 0) / td) }; })()
    });
  }
}

// Atlas : objet de départ des supports, absent de la timeline Riot (500 po de départ = Atlas 400 + 2 potions)
samples.forEach(s => { if (s.key.endsWith('|UTILITY') && !s.start.split(',').includes('3865')) s.start = ['3865', ...s.start.split(',').filter(Boolean)].sort().join(','); });
// Cumul avec les collectes précédentes du même patch
if (prev.patch === vers[0]) { const have = new Set(samples.map(s => s.mid)); prev.samples.forEach(s => { if (!have.has(s.mid)) samples.push(s); }); }
const totalGames = new Set(samples.map(s => s.mid)).size;
log('échantillons :', samples.length, '·', totalGames, 'parties au total');
mkdirSync('data', { recursive: true });
writeFileSync(STORE, gzipSync(JSON.stringify({ patch: vers[0], samples: samples.filter(s => s.ver === vers[0]) })));

/* 5. Seuils « beaucoup de X » : quartile haut sur l'ensemble des parties */
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const TH = { ap: q(samples.map(s => s.f.ap), 0.75), ad: q(samples.map(s => s.f.ad), 0.75), heal: q(samples.map(s => s.f.heal), 0.75), tank: q(samples.map(s => s.f.tank), 0.75), cc: q(samples.map(s => s.f.cc), 0.75) };
const flags = s => ({ ap: s.f.ap >= TH.ap, ad: s.f.ad >= TH.ad, heal: s.f.heal >= TH.heal, tank: s.f.tank >= TH.tank, cc: s.f.cc >= TH.cc, assassin: s.f.assassin >= 2 });

/* 6. Agrégats par champion + poste */
const mode = (arr, min = 1) => { const c = {}; arr.filter(Boolean).forEach(x => c[x] = (c[x] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1]).filter(x => x[1] >= min); };
const pct = (a, n) => Math.round(a / n * 100);
const out = {};
const groups = {}; samples.forEach(s => (groups[s.key] = groups[s.key] || []).push(s));
for (const [key, S] of Object.entries(groups)) {
  const n = S.length; if (n < 8) continue;
  const wins = S.filter(s => s.win).length;
  const itemRate = {}; S.forEach(s => s.items.forEach(id => itemRate[id] = (itemRate[id] || 0) + 1));
  const pool = Object.entries(itemRate).map(([id, c]) => [id, c / n]).filter(x => x[1] >= 0.04).sort((a, b) => b[1] - a[1]);
  const vs = {};
  for (const fl of ['ap', 'ad', 'heal', 'tank', 'cc', 'assassin']) {
    const A = S.filter(s => flags(s)[fl]), B = S.filter(s => !flags(s)[fl]);
    if (A.length < 6) continue;
    const res = [];
    for (const [id] of pool) {
      const ra = A.filter(s => s.items.includes(id)).length / A.length, rb = B.length ? B.filter(s => s.items.includes(id)).length / B.length : 0;
      if (ra >= 0.12 && ra / Math.max(rb, 0.03) >= 1.35) res.push([id, pct(ra * 100, 100), Math.round(ra / Math.max(rb, 0.03) * 10) / 10]);
    }
    if (res.length) vs[fl] = res.sort((a, b) => b[2] - a[2]).slice(0, 4);
  }
  const core3 = mode(S.filter(s => s.legs.length >= 3).map(s => s.legs.slice(0, 3).join(',')), 2);
  const vsOpp = {}; S.forEach(s => { if (s.opp) { const o = vsOpp[s.opp] = vsOpp[s.opp] || [0, 0]; o[0]++; if (s.win) o[1]++; } });
  const duo = {}; S.forEach(s => { if (s.duo) { const o = duo[s.duo] = duo[s.duo] || [0, 0]; o[0]++; if (s.win) o[1]++; } });
  // objets ajoutés contre un adversaire direct précis (ex. Zhonya contre Zed)
  const lane = {};
  for (const [o, [k]] of Object.entries(vsOpp)) {
    if (k < 6) continue;
    const A = S.filter(s => s.opp === o), B = S.filter(s => s.opp !== o), res = [];
    for (const [id] of pool) {
      const ra = A.filter(s => s.items.includes(id)).length / A.length, rb = B.length ? B.filter(s => s.items.includes(id)).length / B.length : 0;
      if (ra >= 0.25 && ra / Math.max(rb, 0.03) >= 1.4) res.push([id, Math.round(ra * 100), Math.round(ra / Math.max(rb, 0.03) * 10) / 10, k]);
    }
    if (res.length) lane[o] = res.sort((a, b) => b[2] - a[2]).slice(0, 2);
  }
  // taux de victoire avec chaque allié et contre chaque adversaire (toute l'équipe)
  const tally = f => { const m = {}; S.forEach(s => f(s).forEach(c => { const o = m[c] = m[c] || [0, 0]; o[0]++; if (s.win) o[1]++; })); return Object.entries(m).filter(x => x[1][0] >= 4).map(([c, [k, w]]) => [c, k, pct(w, k)]).sort((a, b) => b[1] - a[1]).slice(0, 60); };
  const withA = tally(s => s.mates || []), vsA = tally(s => s.foes || []);
  const ks = mode(S.map(s => s.ks))[0];
  out[key] = {
    n, wr: pct(wins, n),
    start: mode(S.map(s => s.start)).slice(0, 2).map(([k, c]) => [k.split(',').filter(Boolean), pct(c, n)]),
    first: mode(S.map(s => s.legs[0])).slice(0, 3).map(([k, c]) => [k, pct(c, n)]),
    boots: mode(S.map(s => s.boots)).slice(0, 3).map(([k, c]) => [k, pct(c, n)]),
    core: core3.slice(0, 2).map(([k, c]) => [k.split(','), pct(c, n)]),
    pool: pool.slice(0, 14).map(([id, r]) => [id, Math.round(r * 100)]),
    vs, lane, with: withA, vsAll: vsA,
    spells: (mode(S.map(s => s.spells))[0] || [''])[0].split(',').filter(Boolean).map(Number),
    runes: ks ? (mode(S.filter(s => String(s.ks) === ks[0]).map(s => s.runes))[0] || [null])[0] : null,
    skills: (mode(S.map(s => s.skills))[0] || [''])[0], early: (mode(S.map(s => s.early))[0] || [''])[0],
    opp: Object.entries(vsOpp).filter(x => x[1][0] >= 5).map(([c, [k, w]]) => [c, k, pct(w, k)]).sort((a, b) => b[1] - a[1]).slice(0, 20),
    duo: Object.entries(duo).filter(x => x[1][0] >= 4).map(([c, [k, w]]) => [c, k, pct(w, k)]).sort((a, b) => b[1] - a[1]).slice(0, 15)
  };
}

/* 7. Références par poste (médianes des meilleurs joueurs) pour l'onglet Analyse */
const med = arr => { const v = arr.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const targets = {};
for (const pos of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']) {
  const rows = samples.filter(x => x.key.endsWith('|' + pos) && x.st).map(x => x.st);
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  targets[pos] = Object.fromEntries(['csm', 'vspm', 'ctrl', 'wkpm', 'deaths', 'kp', 'dmg'].map(k => [k, r2(med(rows.map(r => r[k])))]));
  targets[pos].n = rows.length;
}
log('références', JSON.stringify(targets));
const res = { patch: vers[0], dd: V, generated: new Date().toISOString(), games: totalGames, regions: REGIONS, players: 'Challenger + Grandmaster + Master', thresholds: TH, targets, builds: out };
if (Object.keys(out).length < 40 && existsSync('builds.json')) { console.error('Trop peu de données, builds.json conservé.'); process.exit(1); }
writeFileSync('builds.json', JSON.stringify(res));
log('builds.json :', Object.keys(out).length, 'champion/poste,', totalGames, 'parties');
void readFileSync;
