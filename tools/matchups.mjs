// Counters et synergies : taux de victoire de chaque champion (par poste) contre son adversaire de lane,
// contre chaque adversaire et avec chaque allié, sur un grand nombre de parties classées Challenger / GM / Master (EUW + KR).
// Une seule requête Riot par partie (résumé léger), stock cumulé par patch dans data/lite.json.gz. Écrit matchups.json.
// Usage : node tools/matchups.mjs [maxNouvellesParties]   (variables RELAY, REGIONS, PLAYERS, MINUTES facultatives)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

const RELAY = (process.env.RELAY || 'https://lol-support-coach.62z7h87vzm.workers.dev').replace(/\/+$/, '');
const MAX = Number(process.argv[2] || process.env.MAX_MATCHES || 8000);
const REGIONS = (process.env.REGIONS || 'euw1,kr').split(',');
const PLAYERS = Number(process.env.PLAYERS || 600);
const MINUTES = Number(process.env.MINUTES || 230); // on s'arrête à temps pour écrire le résultat
const STORE = 'data/lite.json.gz';
const T0 = Date.now(), late = () => Date.now() - T0 > MINUTES * 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let last = 0;
async function relay(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = last + Number(process.env.PACE_MS || 1250) - Date.now(); if (wait > 0) await sleep(wait);
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
const verOf = v => (v || '').split('.').slice(0, 2).join('.');
const cmpVer = (a, b) => { const [x, y] = a.split('.').map(Number), [u, w] = b.split('.').map(Number); return x - u || y - w; };

/* Stock : { mid: [ver, [champion, poste, équipe, victoire] × 10] } */
const store = existsSync(STORE) ? JSON.parse(gunzipSync(readFileSync(STORE)).toString()) : { games: {} };
log('déjà en stock :', Object.keys(store.games).length, 'parties');

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

/* 2. Parties récentes pas encore en stock (DAYS derniers jours) */
const DAYS = Number(process.env.DAYS || 7), since = Math.floor(Date.now() / 1000) - DAYS * 86400;
const ids = new Map();
for (let i = 0; i < queue.length && ids.size < MAX * 1.3 && !late(); i++) {
  const { pf, p } = queue[(i * 7919) % queue.length];
  const r = await relay(`/ids?platform=${pf}&puuid=${p}&count=${DAYS > 7 ? 100 : 40}&start=${since}`);
  (r && r.ids || []).forEach(id => store.games[id] || ids.has(id) || ids.set(id, pf));
  if (i % 100 === 0) log('ids', i, '/', queue.length, '→', ids.size, 'nouvelles parties');
}

/* 3. Résumés légers */
let added = 0;
for (const [id, pf] of ids) {
  if (added >= MAX || late()) break;
  const m = await relay(`/match?id=${id}&platform=${pf}&lite=1`);
  if (!m || !Array.isArray(m.p)) continue;
  if (m.queueId !== 420 || m.gameDuration < 900 || m.p.length !== 10 || m.p.some(x => !x[1])) { store.games[id] = 0; continue; } // ignorée, mais on ne la relira pas
  store.games[id] = [verOf(m.gameVersion), m.p];
  added++;
  if (added % 250 === 0) log('parties', added);
}
log('nouvelles parties :', added);

/* 4. Les counters bougent peu d'un patch à l'autre (sauf refonte ou nouveau champion) : on garde les 6 derniers patchs (~3 mois) */
const KEEP = Number(process.env.KEEP_PATCHES || 6);
const vers = [...new Set(Object.values(store.games).filter(Boolean).map(g => g[0]))].sort(cmpVer).reverse();
for (const [id, g] of Object.entries(store.games)) if (g && !vers.slice(0, KEEP).includes(g[0])) delete store.games[id];
// les parties ignorées (0) sont oubliées quand elles sortent de la fenêtre des 7 jours : on les garde au plus 20 000
const zeros = Object.keys(store.games).filter(id => store.games[id] === 0); zeros.slice(0, Math.max(0, zeros.length - 20000)).forEach(id => delete store.games[id]);
mkdirSync('data', { recursive: true });
writeFileSync(STORE, gzipSync(JSON.stringify(store)));

/* 5. Agrégats sur tous les patchs gardés */
const used = Object.values(store.games).filter(Boolean);
log('patchs', vers.slice(0, KEEP).map(v => v + ':' + used.filter(g => g[0] === v).length).join(' '), '→ utilisées', used.length);
const POSS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const M = {};
const bump = (o, k, w) => { const x = o[k] = o[k] || [0, 0]; x[0]++; x[1] += w; };
for (const [, P] of used) {
  for (const [c, pos, team, win] of P) {
    if (!POSS.includes(pos)) continue;
    const e = M[c + '|' + pos] = M[c + '|' + pos] || { n: 0, w: 0, opp: {}, vs: {}, with: {} };
    e.n++; e.w += win;
    for (const [c2, pos2, team2] of P) {
      if (c2 === c && pos2 === pos) continue;
      if (team2 === team) bump(e.with, c2 + '|' + pos2, win);
      else { bump(e.vs, c2 + '|' + pos2, win); if (pos2 === pos) bump(e.opp, c2, win); }
    }
  }
}
// format compact : clé → [parties, victoires, {adversaire de lane: [n, v]}, {adversaire|poste: [n, v]}, {allié|poste: [n, v]}]
const keep = (o, min) => Object.fromEntries(Object.entries(o).filter(x => x[1][0] >= min));
const out = {};
for (const [k, e] of Object.entries(M)) if (e.n >= 15) out[k] = [e.n, e.w, keep(e.opp, 3), keep(e.vs, 5), keep(e.with, 5)];
const res = { patch: vers[0], patches: vers.slice(0, KEEP), generated: new Date().toISOString(), games: used.length, regions: REGIONS, m: out };
if (used.length < 500 && existsSync('matchups.json')) { console.error('Trop peu de parties, matchups.json conservé.'); process.exit(1); }
writeFileSync('matchups.json', JSON.stringify(res));
log('matchups.json :', Object.keys(out).length, 'champion/poste,', used.length, 'parties,', Math.round(JSON.stringify(res).length / 1024), 'Ko');
