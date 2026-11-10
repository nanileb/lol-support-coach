// Garde-fous de logique : exécute le vrai code de l'app (app.js + analyse.js) sur 15 drafts réalistes et vérifie des règles de bon sens.
// Usage : node checks.mjs [chemin du repo]   (Data Dragon fr_FR téléchargé dans ./dd/ : champion, item, runesReforged, summoner)
import { run, els } from './harness.mjs';
import fs from 'fs';
import path from 'path';
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
  // R1. Une paire qui se croise peu (poids < 1) ne déplace jamais le score de plus de 2 points
  rank.forEach(r => (r.parts || []).forEach(([v, txt, w]) => { if (w != null && w < 1 && Math.abs(v) > 2) fail(s.id, `${r.id} : ${v.toFixed(1)} pt pour une paire de poids ${w} (${txt})`); }));
  if (s.expect && !s.expect.includes(rank[0].id)) warns.push(`${s.id} : 1er choix ${rank[0].id} (${rank[0].score} %), l'audit attendait ${s.expect.join('/')}`);
  const me = rank[0].id;
  run(`S.match.me=${JSON.stringify(me)}; renderBuild(); renderBot();`);
  const seq = run(`(window._why||[]).map(x=>({id:String(x.id),why:x.why}))`);
  const start = run(`(((BUILD(S.match.me)||{}).start||[])[0]||[[]])[0]`);
  const A = run(`analyzeEnemies()`);
  const items = seq.map(x => x.id).filter(id => !(it(id) && (it(id).tags || []).includes('Boots')));
  // R3. Objet « contre ton adversaire » : jamais sur moins de 20 parties
  seq.forEach(x => { const m = /le prennent contre .*\((\d+) parties\)/.exec(x.why || ''); if (m && Number(m[1]) < 20) fail(s.id, `${me} : ${x.why}`); });
  // Bottes de niveau 3 : jamais conseillées à l'achat (récompense de la quête du mid)
  seq.forEach(x => { const d = it(x.id); if (d && (d.tags || []).includes('Boots') && !d.base && (d.from || []).length === 1) fail(s.id, `${me} : bottes de niveau 3 (${d.name}) dans les achats`); });
  // R2 / R4. Verdict de duel et plan de lane cohérents
  for (const role of [s.role]) {
    const opp = s.enemy[role]; if (!opp) continue;
    const bot = els['#botOut'].innerHTML, doL = ((/<ul class="checks do">([\s\S]*?)<\/ul>/.exec(bot) || [])[1] || '').split('</li>').map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const push = doL.filter(t => /pousse|pression|prends l'avantage|agressi|prendre les plaques/i.test(t) && !/survis|sécurité|farm près|laisse la vague/i.test(t));
    const safe = doL.filter(t => /survis|sécurité|farm près|laisse la vague|jouer safe/i.test(t) && !/pousse|pression|prends l'avantage|agressi/i.test(t));
    if (push.length && safe.length) fail(s.id, `${me} : conseils contradictoires « ${push[0]} » et « ${safe[0]} »`);
    if (['top', 'mid', 'jungle'].includes(role)) {
      const d = run(`duelResult(${JSON.stringify(me)}, ${JSON.stringify(opp)}, ${JSON.stringify(role)})`);
      if (d.wr != null && /Pas assez de parties/.test(bot)) fail(s.id, `${me} contre ${opp} : ${d.n} parties mais verdict « pas assez de parties »`);
      if (d.wr == null && doL.some(t => /pression dès|Duel favorable/i.test(t))) fail(s.id, `${me} contre ${opp} : conseil agressif sur un duel de ${d.n} parties`);
    }
  }
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
// 5. Base de counters : noms reconnus, taux plausibles (les deux pages d'un duel peuvent différer : échantillons différents)
{ const r = run(`(() => { const out = [], L = (S.cnt && S.cnt.lanes) || {};
    for (const [lane, M] of Object.entries(L)) for (const [c, e] of Object.entries(M)) {
      if (!champ(c)) out.push(lane + ' : champion inconnu ' + c);
      for (const [o, [wr, n]] of Object.entries(e.vs)) { if (!champ(o)) out.push(lane + ' : adversaire inconnu ' + o + ' (' + c + ')'); if (!(wr > 20 && wr < 80) || !(n >= 1)) out.push(lane + ' : ' + c + ' contre ' + o + ' = ' + wr + ' % / ' + n); } }
    return { out: out.slice(0, 8), has: !!S.cnt }; })()`);
  if (!r.has) warns.push('counters.json absent : duels estimés par profils');
  r.out.forEach(x => fail('counters', x)); }
// 6. Méga recette (C1 à C11) : chaque couple champion / poste de builds.json, contre une équipe 100 % AD puis 100 % AP
{ const DDC = JSON.parse(fs.readFileSync(path.join(process.env.DD_DIR || new URL('./dd', import.meta.url).pathname, 'champion.json'), 'utf8')).data;
  const RAW = JSON.parse(fs.readFileSync(path.join(process.env.REPO || new URL('../..', import.meta.url).pathname, 'builds.json'), 'utf8')).builds;
  // C2. Chaque clé de builds.json et de counters.json est un id Data Dragon
  Object.keys(RAW).forEach(k => { if (!DDC[k.split('|')[0]]) fail('C2', `builds.json : ${k} n'est pas un id Data Dragon`); });
  const POSR = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };
  const keys = Object.keys(RAW);
  const r = run(`(() => { const out = [], B = S.builds.builds, keys = ${JSON.stringify(keys)}, POSR = ${JSON.stringify(POSR)};
    const top = (role, ap) => keys.filter(k => POSR[k.split('|')[1]] === role).map(k => k.split('|')[0]).filter(c => isAP(c, role) === ap && !MAGIC_TANKS.includes(c) && !PHYS_TANKS.includes(c)).sort((a, b) => B[b + '|' + POS[role]].n - B[a + '|' + POS[role]].n);
    const pickTeam = (ap, me) => { const t = {}; ROLES.forEach(rl => { t[rl] = top(rl, ap).find(c => c !== me) || null; }); return t; };
    let noCnt = 0, big = 0;
    for (const k of keys) { const [me, P] = k.split('|'), role = POSR[P], b = B[k];
      // C1. Type de dégâts : un pool à plus de 60 % d'un type n'est jamais classé dans l'autre
      const d = dmgShare(me, role);
      if (d && !MAGIC_TANKS.includes(me) && !PHYS_TANKS.includes(me)) { if (d.ap > 0.6 && !isAP(me, role)) out.push(['C1', k + ' : achats ' + Math.round(d.ap * 100) + ' % AP mais compté AD']); if (d.ad > 0.6 && isAP(me, role)) out.push(['C1', k + ' : achats ' + Math.round(d.ad * 100) + ' % AD mais compté AP']); }
      // C11. Couverture des counters
      if (b.n >= 50) { big++; if (!(S.cnt.lanes[CLANE[role]] || {})[me]) noCnt++; }
      // C5. 1er pick : un champion contrable affiche toujours le risque de contre-pick
      S.settings.role = role; S.settings.pools[role] = [me]; S.match = defMatch(); S.match.me = null;
      if (blindKind(me, role) === 'counter' && !scoreRole(me).reasons.some(x => /contre-pick/.test(x))) out.push(['C5', k + ' : contrable mais pas de risque de contre-pick en 1er pick']);
      for (const ap of [false, true]) {
        S.match = defMatch(); Object.assign(S.match.enemy, pickTeam(ap, me)); S.match.me = me;
        renderBuild(); renderBot(); const ev = buildEvents(), A = analyzeEnemies();
        const seq = (window._why || []).map(x => String(x.id)), sp = (b.spells || []);
        const txt = document.querySelector('#botOut').innerHTML + ' ' + ev.map(e => e.title + ' ' + e.text).join(' ');
        // C3. Aucun texte de Téléportation sans TP dans les sorts du build
        if (/Téléportation/.test(txt) && !sp.includes(12)) out.push(['C3', k + ' : conseil Téléportation sans TP (sorts ' + sp + ')']);
        // C4. Un seul objet par passif unique
        const g = {}; seq.forEach(id => { const x = itemGroup(id); if (x) (g[x] = g[x] || []).push(iname(id)); }); Object.entries(g).forEach(([x, l]) => { if (l.length > 1) out.push(['C4', k + ' : ' + x + ' en double (' + l.join(' + ') + ')']); });
        // C6. Pas de « pression dès le niveau 1 » quand l'adversaire gagne les premiers niveaux
        const opp = S.match.enemy[role], eo = opp && earlyOf(opp), em = earlyOf(me);
        if (/pression dès le niveau 1/.test(txt) && eo != null && em != null && eo > em) out.push(['C6', k + ' : pression niveau 1 contre ' + opp]);
        // C7. Bottes : jamais la résistance inutile contre ≥ 3 adversaires du même type
        if (A.n >= 3 && A.ap === 0 && seq.includes('3111')) out.push(['C7', k + ' : Sandales de Mercure contre ' + A.ad + ' AD / 0 AP']);
        if (A.n >= 3 && A.ad === 0 && seq.includes('3047')) out.push(['C7', k + ' : Coques en acier contre ' + A.ap + ' AP / 0 AD']);
        // C8. Jamais un objet offensif AP et un objet offensif AD dans les 4 premiers objets (hors hybrides assumés)
        if (!HYBRID_OK.includes(me)) { const off = seq.filter(id => !(S.items[id].tags || []).includes('Boots')).slice(0, 4).map(id => { const t = S.items[id].tags || [], sp2 = t.includes('SpellDamage'), ph = t.includes('Damage') || t.includes('CriticalStrike'); return t.includes('Armor') || t.includes('SpellBlock') ? null : sp2 && !ph ? 'ap' : ph && !sp2 ? 'ad' : null; }).filter(Boolean);
          if (off.includes('ap') && off.includes('ad') && !(me === 'Varus' && role === 'top')) out.push(['C8', k + ' : objets offensifs AP et AD mélangés (' + seq.slice(0, 4).map(iname).join(', ') + ')']); }
        // C10. Pas de Héraut à préparer pour l'ADC
        if (role === 'adc' && ev.some(e => /^Prépare le Héraut/.test(e.title))) out.push(['C10', k + ' : « Prépare le Héraut » dans la chronologie ADC']);
      }
    }
    if (noCnt > big * 0.1) out.push(['C11', noCnt + ' couples sur ' + big + ' (≥ 50 parties) sans counters']);
    return { out, noCnt, big }; })()`);
  r.out.forEach(([c, m]) => fail(c, m));
  if (r.noCnt) warns.push(`${r.noCnt} couples champion / poste (≥ 50 parties) sur ${r.big} sans counters Lolalytics`);
}
if (warns.length) console.log('À regarder (avis, pas une erreur) :\n- ' + warns.join('\n- '));
console.log(fails.length ? `${fails.length} problème(s) :\n- ` + fails.join('\n- ') : 'Tous les garde-fous passent.');
process.exitCode = fails.length ? 1 : 0;
