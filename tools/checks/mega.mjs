// Méga recette : chaque champion à son poste (builds.json), 9 autres tirés au hasard à leur poste, position de pick aléatoire.
import { run, els } from './harness.mjs';
import fs from 'fs';
let seed = Number(process.env.SEED || 2611);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const strip = h => String(h).replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, ' [$1] ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const B = run('S.builds.builds');
const ITEMS = run('S.items');
const DDI = JSON.parse(fs.readFileSync(process.env.DD_DIR + '/item.json', 'utf8')).data;
const CH = JSON.parse(fs.readFileSync(process.env.DD_DIR + '/champion.json', 'utf8')).data;
const POS = { top: 'TOP', jungle: 'JUNGLE', mid: 'MIDDLE', adc: 'BOTTOM', support: 'UTILITY' }, ROLES = Object.keys(POS);
const byRole = {}; ROLES.forEach(r => byRole[r] = Object.entries(B).filter(([k]) => k.endsWith('|' + POS[r])).map(([k, v]) => [k.split('|')[0], v.n]));
const pickW = (list, excl) => { const L = list.filter(([c]) => !excl.has(c)); const tot = L.reduce((a, x) => a + Math.sqrt(x[1]), 0); let x = rnd() * tot; for (const [c, n] of L) { x -= Math.sqrt(n); if (x <= 0) return c; } return L[L.length - 1][0]; };
// type de dégâts réel d'après les objets achetés (pool)
const dmgOf = (b) => { let ap = 0, ad = 0, tank = 0; (b.pool || []).forEach(([id, p]) => { const t = (DDI[id] || {}).tags || [], st = (DDI[id] || {}).stats || {};
  if (t.includes('SpellDamage')) ap += p; else if (t.includes('Damage') || t.includes('CriticalStrike') || t.includes('AttackSpeed')) ad += p;
  if ((t.includes('Health') && (t.includes('Armor') || t.includes('SpellBlock'))) && !t.includes('SpellDamage') && !t.includes('Damage')) tank += p; });
  const s = ap + ad + tank || 1; return { ap: ap / s, ad: ad / s, tank: tank / s }; };
const ORDER = [['b', 0], ['r', 0], ['r', 1], ['b', 1], ['b', 2], ['r', 2], ['r', 3], ['b', 3], ['b', 4], ['r', 4]]; // ordre de draft classé
const SETS = { lifeline: ['3156', '3053', '6673'], hydra: ['3074', '3748', '6698', '3077'], spellblade: ['3078', '3100', '3508', '6662', '3057', '3025'], immolate: ['3068', '6664'], mana: ['3004', '3003', '3119', '3040', '3042', '3121'], support: ['3865', '3866', '3867', '3869', '3870', '3871', '3876', '3877'], lastwhisper: ['3036', '3033', '6694', '3035'], gw: ['3123', '3033', '3916', '3165', '3011', '3076', '3075', '6609'] };
const out = [], F = {}; const flag = (k, c, msg) => { (F[k] = F[k] || []).push(`${c} : ${msg}`); };
const keys = Object.keys(B).filter(k => !process.env.ONLY || k.startsWith(process.env.ONLY));
for (const key of keys) {
  const [me, P] = key.split('|'), role = ROLES.find(r => POS[r] === P), b = B[key];
  // position de pick aléatoire, rôles des picks aléatoires
  const slot = Math.floor(rnd() * 10), mySide = ORDER[slot][0];
  const used = new Set([me]), match = { ally: {}, enemy: {} };
  const allyRoles = ROLES.filter(r => r !== role).sort(() => rnd() - 0.5), enemyRoles = ROLES.slice().sort(() => rnd() - 0.5);
  const knownA = ORDER.slice(0, slot).filter(o => o[0] === mySide).length, knownE = ORDER.slice(0, slot).filter(o => o[0] !== mySide).length;
  allyRoles.slice(0, knownA).forEach(r => { const c = pickW(byRole[r], used); used.add(c); match.ally[r] = c; });
  enemyRoles.slice(0, knownE).forEach(r => { const c = pickW(byRole[r], used); used.add(c); match.enemy[r] = c; });
  const pool = [me]; while (pool.length < 5 && pool.length < byRole[role].length) { const c = pickW(byRole[role], new Set([...used, ...pool])); pool.push(c); }
  const side = rnd() < 0.5 ? 'blue' : 'red';
  run(`S.settings.role=${JSON.stringify(role)}; S.settings.pools[${JSON.stringify(role)}]=${JSON.stringify(pool)}; S.match=defMatch(); S.match.side=${JSON.stringify(side)}; Object.assign(S.match.ally, ${JSON.stringify(match.ally)}); Object.assign(S.match.enemy, ${JSON.stringify(match.enemy)}); S.match.me=null;`);
  const rank = run(`myPool().filter(id=>!takenChamps('me')[id]).map(scoreRole).sort((a,b)=>(b.raw??b.score)-(a.raw??a.score)).map(r=>({id:r.id,score:r.score,raw:r.raw,reasons:r.reasons}))`);
  const mine = rank.find(r => r.id === me);
  run(`S.match.me=${JSON.stringify(me)}; renderBuild(); renderBot();`);
  const buildHTML = els['#buildOut'].innerHTML, laneHTML = els['#botOut'].innerHTML;
  const seq = run(`(window._why||[]).map(x=>({id:String(x.id),why:x.why}))`);
  const A = run('analyzeEnemies()');
  const ev = run('buildEvents()');
  const rec = { key, me, role, slot: slot + 1, side, ally: match.ally, enemy: match.enemy, pool, rank, seq, A, build: strip(buildHTML), lane: strip(laneHTML), ev: ev.map(e => [e.t, e.kind, e.title, e.text, (e.spots || []).join(',')]) };
  out.push(rec);
  // ---------- détecteurs ----------
  const d = dmgOf(b), apApp = run(`isAP(${JSON.stringify(me)})`), frontApp = run(`isFront(${JSON.stringify(me)})`);
  if (d.ap > 0.6 && !apApp) flag('dmgType', key, `achète surtout AP (${Math.round(d.ap * 100)} %) mais l'app le compte AD`);
  if (d.ad > 0.6 && apApp) flag('dmgType', key, `achète surtout AD (${Math.round(d.ad * 100)} %) mais l'app le compte AP`);
  if (d.tank > 0.45 && !frontApp) flag('front', key, `build tank (${Math.round(d.tank * 100)} %) mais pas compté frontline`);
  if (d.tank < 0.1 && frontApp && (d.ap > 0.6 || d.ad > 0.6)) flag('front', key, `compté frontline mais build sans objets tanky`);
  // build : départ, sorts
  const start = ((b.start || [])[0] || [[]])[0].map(String), hasStart = id => new RegExp(`/item/${id}\\.png`).test(buildHTML.split('Objet 1')[0]);
  const pet = ['1101', '1102', '1103'].some(hasStart);
  if (role === 'jungle' && !pet) flag('start', key, 'pas de familier de jungle au départ');
  if (role !== 'jungle' && pet) flag('start', key, 'familier de jungle au départ hors jungle');
  if (role === 'support' && !hasStart('3865')) flag('start', key, "pas d'Atlas");
  if (role !== 'support' && hasStart('3865')) flag('start', key, 'Atlas hors support');
  const sp = b.spells || [];
  if (role === 'jungle' && !sp.includes(11)) flag('spells', key, `pas de Châtiment (${sp})`);
  if (role !== 'jungle' && sp.includes(11)) flag('spells', key, `Châtiment hors jungle`);
  if (!sp.includes(4) && !['Ezreal', 'Kassadin', 'Shaco', 'LeBlanc'].includes(me)) flag('spells', key, `sans Flash (${sp})`);
  // objets conseillés
  const ids = seq.map(x => x.id), legend = ids.filter(id => !(DDI[id] && (DDI[id].tags || []).includes('Boots')));
  ids.forEach(id => { const x = DDI[id]; if (!x) flag('items', key, `objet ${id} absent de Data Dragon`); else if (x.gold && x.gold.purchasable === false && !SETS.support.includes(id)) flag('items', key, `${x.name} non achetable`); });
  Object.entries(SETS).forEach(([s, L]) => { const hit = ids.filter(i => L.includes(i)); if (hit.length > 1 && s !== 'support') flag('unique', key, `${s} en double : ${hit.map(i => DDI[i].name).join(' + ')}`); });
  if (me === 'Cassiopeia' && /Bottes|Chaussures|Sandales|Coques|Jambières/.test(rec.build)) flag('items', key, 'Cassiopeia ne peut pas acheter de bottes');
  const bootsN = (rec.build.match(/Bottes \S/g) || []).length;
  legend.slice(0, 4).forEach(id => { const x = DDI[id]; if (!x) return; const t = x.tags || [];
    if (d.ap > 0.7 && t.includes('Damage') && !t.includes('SpellDamage') && !t.includes('Armor')) flag('itemType', key, `${x.name} (AD) conseillé sur un champion AP`);
    if (d.ad > 0.7 && t.includes('SpellDamage') && !t.includes('Damage') && !['3157', '3102', '3115', '4645'].includes(id) && role !== 'support') flag('itemType', key, `${x.name} (AP) conseillé sur un champion AD`);
    const st = x.stats || {};
    if (st.FlatSpellBlockMod > 0 && !(st.FlatArmorMod > 0) && A.n >= 3 && A.ap === 0) flag('defense', key, `${x.name} (RM) contre 0 AP`);
    if (st.FlatArmorMod > 0 && !(st.FlatSpellBlockMod > 0) && A.n >= 3 && A.ad === 0) flag('defense', key, `${x.name} (armure) contre 0 AD`);
  });
  seq.filter(x => /contre /.test(x.why)).forEach(x => { const m = x.why.match(/\((\d+) parties\)/); if (m && +m[1] < 20) flag('counterItem', key, `${DDI[x.id] && DDI[x.id].name} « ${x.why} »`); });
  if (/anti-soins/i.test(seq.map(x => x.why).join(' ')) && !A.heal.length) flag('situ', key, 'anti-soins sans soigneur en face');
  // classement
  if (!mine) flag('rank', key, 'absent du classement'); else {
    if (mine.score > 62 || mine.score < 38) flag('rankExtreme', key, `${mine.score} % : ${mine.reasons.slice(0, 4).join(' ; ')}`);
    const txt = mine.reasons.join(' | ');
    if (/apporte des dégâts magiques/.test(txt) && d.ad > 0.6) flag('rankLogic', key, 'bonus « dégâts magiques » à un champion AD');
    if (/apporte des dégâts physiques/.test(txt) && d.ap > 0.6) flag('rankLogic', key, 'bonus « dégâts physiques » à un champion AP');
    if (/frontline/.test(txt) && /\+/.test(txt.match(/[+−][\d.]+ pt · ton équipe n'a pas de frontline/)?.[0] || '') && d.tank < 0.15) flag('rankLogic', key, 'bonus frontline sans build tank');
    if (/contre-pick/.test(txt) && match.enemy[role]) flag('rankLogic', key, 'risque de contre-pick alors que le vis-à-vis est connu');
    if (/estimation, duel absent/.test(txt)) flag('estimate', key, `duel contre ${match.enemy[role]} estimé`);
    if (match.enemy[role] && !/\(duel\)|estimation/.test(txt)) flag('noDuel', key, `aucune ligne de duel contre ${match.enemy[role]}`);
  }
  // lane
  const PUSHY = /pousse|pression|prends l'avantage|agressi|engage tout de suite|prendre les plaques/i, SAFE = /survis|farm près|laisse la vague|farm prudemment|sécurité|jouer safe/i;
  const doPart = (rec.lane.split(/Pour gagner/)[1] || '').split(/À éviter/)[0];
  if (PUSHY.test(doPart) && SAFE.test(doPart)) flag('laneMix', key, doPart.slice(0, 260));
  if (/Téléportation/.test(rec.lane) && !sp.includes(12)) flag('laneTP', key, `conseil Téléportation sans TP (sorts ${sp})`);
  if ((role === 'top' || role === 'mid') && /tri-bush/i.test(doPart) && role === 'mid') flag('laneText', key, 'tri-bush en mid');
  if (/Duel favorable/.test(rec.lane) && /Duel difficile/.test(rec.lane)) flag('laneMix', key, 'favorable et difficile à la fois');
  // chronologie
  const tl = rec.ev; for (let i = 1; i < tl.length; i++) if (tl[i][0] < tl[i - 1][0]) flag('timeline', key, 'événements non triés');
  tl.forEach(e => { if (e[1] === 'ward' && !e[4]) flag('timelineWard', key, `ward sans emplacement : ${e[2]} (${e[0]})`); if (e[0] < 0) flag('timeline', key, 'temps négatif'); });
  tl.forEach(e => { const m = e[2].match(/^Prépare (le |la |les |l')?(.+)$/); if (!m) return; const obj = tl.find(x => x[1] === 'obj' && x[0] > e[0] && x[2].toLowerCase().includes(m[2].split(' ')[0].toLowerCase().replace(/n°.*/, '')));
    if (!obj) flag('timeline', key, `« ${e[2]} » sans objectif ensuite`); else if (obj[0] - e[0] > 120) flag('timeline', key, `« ${e[2]} » ${obj[0] - e[0]} s avant`); });
  const allTxt = tl.map(e => e[2] + ' ' + e[3]).join(' | ');
  if (role !== 'support' && /quête|Atlas|pink à 40/i.test(allTxt)) flag('timelineRole', key, 'mention de la quête support hors support');
  if (role !== 'support' && role !== 'adc' && /ton ADC|ton support/i.test(allTxt)) flag('timelineRole', key, 'mention ADC/support hors botlane');
  if (/Téléportation/.test(allTxt) && !sp.includes(12)) flag('timelineTP', key, 'Téléportation dans la chronologie sans TP');
  if (role === 'jungle' && !/crabe|Crabe/.test(allTxt)) flag('timelineRole', key, 'pas de crabe pour le jungler');
}
fs.writeFileSync('mega-out.json', JSON.stringify(out));
fs.writeFileSync('mega-flags.json', JSON.stringify(F, null, 1));
console.log(out.length, 'cas'); Object.entries(F).forEach(([k, v]) => console.log(k.padEnd(14), v.length));
