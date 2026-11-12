// Vérification quotidienne du patch (workflow builds.yml) : compare le patch Data Dragon du moment à celui de builds.json.
// Écrit dans $GITHUB_OUTPUT : patch (ex. 16.23), builds (patch de builds.json), changed (true si builds.json est en retard),
// counters_late / meta_late (true si counters.json ou meta.json ne sont pas au patch du moment : à revoir à la main).
// meta.json numérote les patchs à la façon Riot (26.22 = Data Dragon 16.22) : on compare le numéro après le point.
// Usage : node tools/patch-check.mjs
import { readFileSync, appendFileSync } from 'node:fs';
const dd = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
const patch = dd.split('.').slice(0, 2).join('.');
const read = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return {}; } };
const builds = read('builds.json'), counters = read('counters.json'), meta = read('meta.json');
const minor = p => String(p || '').split('.')[1];
const out = {
  patch,
  builds: builds.patch || 'aucun',
  changed: builds.patch !== patch,
  counters_late: counters.patch !== patch,
  meta_late: minor(meta.patch) !== minor(patch),
};
console.log(`Patch Data Dragon ${dd} · builds.json ${out.builds} · counters.json ${counters.patch} · meta.json ${meta.patch}`);
console.log(out.changed ? 'Nouveau patch : collecte des builds.' : 'builds.json est déjà au patch du moment.');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
