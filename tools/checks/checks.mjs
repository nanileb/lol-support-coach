// Garde-fous de logique : exécute le vrai code de l'app (app.js + analyse.js) sur 15 drafts réalistes et vérifie des règles de bon sens.
// Usage : node checks.mjs [chemin du repo]   (Data Dragon fr_FR téléchargé dans ./dd/ : champion, item, runesReforged, summoner)
import { run, els } from './harness.mjs';
import fs from 'fs';
const SC = JSON.parse(fs.readFileSync(new URL('./scen.json', import.meta.url), 'utf8'));
const fails = [], warns = []; const fail = (id, msg) => fails.push(`${id} : ${msg}`);
const it = id => run(`S.items[${JSON.stringify(String(id))}]`);
const ROLE_ITEMS = run(`0`); void ROLE_ITEMS;
// Tanks / mages AP qui doivent compter comme AP
for (const c of ['Galio', 'Maokai', 'Amumu', 'Zac', 'Malphite', 'Sejuani', 'Rell', 'Nautilus', 'Leona']) if (!run(`isAP(${JSON.stringify(c)})`)) fail('isAP', `${c} n'est pas compté comme dégâts magiques`);
for (const s of SC) {
  run(`S.settings.role=${JSON.stringify(s.role)}; S.settings.pools[${JSON.stringify(s.role)}]=${JSON.stringify(s.pool)}; S.match=defMatch(); Object.assign(S.match.ally, ${JSON.stringify(s.ally)}); Object.assign(S.match.enemy, ${JSON.stringify(s.enemy)}); S.match.me=null;`);
  const rank = run(`myPool().filter(id=>!takenChamps('me')[id]).map(scoreRole).sort((a,b)=>b.score-a.score)`);
  rank.forEach(r => { if (r.score > 62 || r.score < 38) fail(s.id, `score affiché irréaliste : ${r.id} ${r.score} %`); });
  if (Object.values(s.enemy).filter(Boolean).length >= 4 && rank.length >= 4) { const sp = rank[0].score - rank[rank.length - 1].score; if (sp < 3) fail(s.id, `classement plat : écart de ${sp} point(s) entre ${rank[0].id} et ${rank[rank.length - 1].id}`); }
  if (s.expect && !s.expect.includes(rank[0].id)) warns.push(`${s.id} : 1er choix ${rank[0].id} (${rank[0].score} %), l'audit attendait ${s.expect.join('/')}`);
  const me = rank[0].id;
  run(`S.match.me=${JSON.stringify(me)}; renderBuild(); renderBot();`);
  const seq = run(`(window._why||[]).map(x=>({id:String(x.id),why:x.why}))`);
  const start = run(`(((BUILD(S.match.me)||{}).start||[])[0]||[[]])[0]`);
  const A = run(`analyzeEnemies()`);
  const items = seq.map(x => x.id).filter(id => !(it(id) && (it(id).tags || []).includes('Boots')));
  const html = els['#buildOut'].innerHTML;
  // 1. Atlas au départ des supports
  if (s.role === 'support' && !/3865\.png/.test(html.split('Objet 1')[0])) fail(s.id, `${me} : pas d'Atlas (3865) au départ`);
  // 2. Pas d'objet « contre » l'adversaire direct pour ADC et jungle
  if ((s.role === 'adc' || s.role === 'jungle') && seq.some(x => /contre .*\(|objet de contre classique/.test(x.why) && /attaques de base|duel|classique/.test(x.why))) fail(s.id, `${me} : objet « contre l'adversaire direct » en ${s.role}`);
  if (s.role === 'adc' && items.slice(0, 2).includes('3026')) fail(s.id, `${me} : Ange gardien dans les 2 premiers objets`);
  // 3. Pas d'objet RM sans AP en face, pas d'objet armure pur sans AD (dans les 4 premiers objets hors bottes)
  const first4 = items.slice(0, 4);
  first4.forEach(id => { const x = it(id); if (!x) return;
    if (x.mr && !x.arm && A.ap === 0) fail(s.id, `${me} : ${x.name} (résistance magique) alors qu'il y a 0 AP en face`);
    if (x.arm && !x.mr && A.ad === 0) fail(s.id, `${me} : ${x.name} (armure) alors qu'il y a 0 AD en face`); });
  // 4. Contre une équipe très AD (≥4 AD), au moins une source d'armure dans les 4 premiers objets ou les bottes
  const boots = seq.map(x => x.id).find(id => it(id) && (it(id).tags || []).includes('Boots'));
  if (A.ad >= 4 && !first4.some(id => it(id) && it(id).arm) && !(boots && it(boots).arm) && !/3047\.png/.test(html)) fail(s.id, `${me} : aucune armure contre ${A.ad} AD`);
  if (A.ap >= 4 && !first4.some(id => it(id) && it(id).mr) && !/3111\.png/.test(html)) fail(s.id, `${me} : aucune résistance magique contre ${A.ap} AP`);
}
// 5. Counters : chaque poste, chaque champion avec des données → liste lisible et cohérente des deux côtés du duel
for (const role of ['top', 'jungle', 'mid', 'adc', 'support']) {
  const bad = run(`(() => { S.settings.role=${JSON.stringify(role)}; const out = [], P = POS[myRole()];
    const ids = new Set([...Object.keys((S.mu&&S.mu.m)||{}), ...Object.keys((S.builds&&S.builds.builds)||{})].filter(k => k.endsWith('|'+P)).map(k => k.split('|')[0]));
    for (const c of ids) { if (!champ(c)) continue; const h = countersHTML(c, myRole());
      if (/undefined|NaN|null/.test(h)) out.push(c + ' : texte cassé');
      const C = countersOf(c, myRole());
      C.beats.forEach(x => { if (x.wr <= 50) out.push(c + ' : ' + x.c + ' listé comme counter avec ' + x.wr + ' %'); const o = STAT(x.c, myRole()), y = o && (o.opp||[]).find(z => z[0] === c);
        if (y && C.src === 'big' && Math.abs(y[2] - x.wr) > 1) out.push(c + ' / ' + x.c + ' : ' + x.wr + ' % pour l\u2019un, ' + y[2] + ' % pour l\u2019autre'); });
      C.loses.forEach(x => { if (x.wr >= 50) out.push(c + ' : ' + x.c + ' listé comme battu avec ' + x.wr + ' %'); }); }
    return out.slice(0, 5); })()`);
  bad.forEach(b => fail('counters ' + role, b));
}
if (warns.length) console.log('À regarder (avis, pas une erreur) :\n- ' + warns.join('\n- '));
console.log(fails.length ? `${fails.length} problème(s) :\n- ` + fails.join('\n- ') : 'Tous les garde-fous passent.');
process.exitCode = fails.length ? 1 : 0;
