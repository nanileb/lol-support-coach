// Construit counters.json à partir des tableaux de counters relevés sur Lolalytics (data/counters-raw/*.txt).
// Format d'un fichier : "## <slug>|<lane>|<patch>|<rang>" puis "<Adversaire>;<WR du champion de la page>;<parties>".
// Base fixe : à refaire seulement lors d'une refonte, d'un nouveau champion ou d'un gros patch.
// Usage : node tools/counters-build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const champs = (await (await fetch('https://ddragon.leagueoflegends.com/cdn/16.22.1/data/en_US/champion.json')).json()).data;
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
const byKey = {};
for (const c of Object.values(champs)) { byKey[norm(c.id)] = c.id; byKey[norm(c.name)] = c.id; }
Object.assign(byKey, { wukong: 'MonkeyKing', nunuwillump: 'Nunu', nunu: 'Nunu', renataglasc: 'Renata', renata: 'Renata' });
const idOf = s => byKey[norm(s)] || null;
const lanes = {}, unknown = new Set(); let patch = null, rank = null, pages = 0;
for (const f of readdirSync('data/counters-raw').filter(f => f.endsWith('.txt')).sort()) {
  let cur = null;
  for (const raw of readFileSync('data/counters-raw/' + f, 'utf8').split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('##')) {
      const [slug, lane, p, r] = line.slice(2).trim().split('|').map(x => x && x.trim());
      cur = null; if (!p || p === 'FAIL') continue;
      const id = idOf(slug); if (!id) { unknown.add(slug); continue; }
      patch = patch || p; rank = rank || r; pages++;
      cur = ((lanes[lane] = lanes[lane] || {})[id] = { vs: {} });
      continue;
    }
    if (!cur) continue;
    const [name, wr, n] = line.split(';'); const o = idOf(name || ''); const w = parseFloat(wr), g = parseInt(String(n).replace(/\D/g, ''), 10);
    if (!o) { unknown.add(name); continue; }
    if (isFinite(w) && g > 0) cur.vs[o] = [Math.round(w * 100) / 100, g];
  }
}
for (const L of Object.values(lanes)) for (const e of Object.values(L)) {
  const rows = Object.values(e.vs), n = rows.reduce((a, x) => a + x[1], 0);
  e.n = n; e.avg = n ? Math.round(rows.reduce((a, x) => a + x[0] * x[1], 0) / n * 100) / 100 : 50;
}
const out = { source: 'Lolalytics', rank: (rank || '').replace('EMERALD+', 'Émeraude+'), patch, generated: new Date().toISOString().slice(0, 10), lanes };
writeFileSync('counters.json', JSON.stringify(out));
console.log(pages, 'pages ·', Object.entries(lanes).map(([l, M]) => l + ':' + Object.keys(M).length).join(' '), '· inconnus :', [...unknown].join(', ') || 'aucun');
