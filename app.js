/* Coach Support — app.js
   Données : Data Dragon (patch, champions, objets, en français) + meta.json (tiers, profils, duos, timers du patch).
   Partie en direct : relais Cloudflare (worker/riot-proxy.js) qui garde la clé Riot. */
'use strict';

const DD = 'https://ddragon.leagueoflegends.com';
const RELAY = 'https://lol-support-coach.62z7h87vzm.workers.dev';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fmt = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

const LS = {
  get(k, d) { try { const v = localStorage.getItem('cs_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cs_' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
};

const ROLES_ALLY = ['top', 'jungle', 'mid', 'adc'];
const ROLES_ENEMY = ['top', 'jungle', 'mid', 'adc', 'support'];
const ROLE_FR = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' };
const ARCH_FR = { engage: 'Engage', warden: 'Protecteur', enchanter: 'Enchanteur', mage: 'Mage / poke' };
const TIER_PTS = { 'S+': 6, S: 4, A: 2, B: 0, C: -3, D: -6 };
const STYLE = {
  engage:    { allin: 10, bully: 6, hyper: -2, poke: 0, utility: 4 },
  warden:    { allin: 5, bully: 5, hyper: 8, poke: 2, utility: 4 },
  enchanter: { allin: 3, bully: 4, hyper: 10, poke: 6, utility: 4 },
  mage:      { allin: 2, bully: 5, hyper: 0, poke: 8, utility: 8 }
};
const STYLE_FR = { allin: 'all-in', bully: 'lane agressive', hyper: 'hypercarry', poke: 'poke', utility: 'utilitaire' };
const NON_CRIT = ['Ezreal', 'Varus', 'Kaisa', 'Corki', 'Ziggs', 'Seraphine', 'Hwei', 'Karthus', 'Mel', 'Swain', 'KogMaw', 'Vayne', 'Kalista', 'Twitch', 'Zeri', 'Smolder'];

const defMatch = () => ({ ally: { top: null, jungle: null, mid: null, adc: null }, enemy: { top: null, jungle: null, mid: null, adc: null, support: null }, me: null, side: 'blue' });
const S = {
  settings: Object.assign({ pool: [], riotId: 'Nanileb#1996', platform: 'euw1', proxy: '', sound: true, vibrate: true, notif: false, lead: 15 }, LS.get('settings', {})),
  match: (() => { const m = Object.assign(defMatch(), LS.get('match', {})); const d = defMatch(); m.ally = Object.assign(d.ally, m.ally); m.enemy = Object.assign(d.enemy, m.enemy); return m; })(),
  timer: LS.get('timer', { start: null }),
  bought: LS.get('bought', { ids: [] }),
  kills: LS.get('kills', { drakes: [], soul: null }),
  meta: null, champs: {}, byKey: {}, version: null, items: null, fired: {}, view: 'draft'
};
const save = () => { LS.set('settings', S.settings); LS.set('match', S.match); LS.set('timer', S.timer); LS.set('kills', S.kills); };

/* ---------------- Chargement des données ---------------- */
async function getJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }

async function loadMeta(force) {
  try {
    S.meta = await getJSON('meta.json' + (force ? '?t=' + Date.now() : ''), { cache: force ? 'reload' : 'default' });
    LS.set('meta', S.meta);
  } catch (e) { S.meta = LS.get('meta', null); }
  if (!S.meta) S.meta = { patch: '?', tiers: {}, winrates: {}, supports: {}, adcs: {}, pairs: {}, counters: {}, engagers: [], frontline: [], healers: [], assassins: [], hookers: [], junglers: {}, timers: { dragon: 300, dragonRespawn: 300, grubs: 480, grubsDespawn: 885, herald: 900, baron: 1200, elderAfterSoul: 360, scuttle: 210, platesFall: 840 }, supportRules: [], items: { start: [], boots: {}, core: {}, situational: {}, upgrades: {}, names: {} }, keystones: {}, sources: [] };
}

async function loadDD(force) {
  try {
    const versions = await getJSON(DD + '/api/versions.json', { cache: 'no-cache' });
    S.version = versions[0];
    const cached = LS.get('dd3', null);
    if (!force && cached && cached.v === S.version) { S.champs = cached.champs; S.items = cached.items; }
    else {
      const [c, it] = await Promise.all([
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/champion.json`),
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/item.json`).catch(() => null)
      ]);
      S.champs = {};
      for (const [id, ch] of Object.entries(c.data)) S.champs[id] = { id, key: ch.key, name: ch.name, tags: ch.tags, info: ch.info, img: ch.image.full };
      S.items = null;
      if (it) { S.items = {}; for (const [iid, x] of Object.entries(it.data)) S.items[iid] = { name: x.name, gold: x.gold && x.gold.total, base: x.gold && x.gold.base, from: x.from || [] }; }
      LS.set('dd3', { v: S.version, champs: S.champs, items: S.items });
    }
  } catch (e) {
    const cached = LS.get('dd3', null);
    if (cached) { S.version = cached.v; S.champs = cached.champs; S.items = cached.items; }
  }
  S.byKey = {};
  for (const ch of Object.values(S.champs)) S.byKey[ch.key] = ch.id;
}

const gamePatch = v => { if (!v) return null; const [a, b] = v.split('.').map(Number); return (a >= 10 && a < 20 ? a + 10 : a) + '.' + b; };
const champ = id => S.champs[id];
const cname = id => (champ(id) ? champ(id).name : id) || '';
const cimg = id => champ(id) && S.version ? `${DD}/cdn/${S.version}/img/champion/${champ(id).img}` : '';
const iimg = id => S.version ? `${DD}/cdn/${S.version}/img/item/${id}.png` : '';
const iname = id => (S.items && S.items[id] && S.items[id].name) || S.meta.items.names[id] || ('Objet ' + id);
const itemExists = id => !S.items || !!S.items[id];
const tags = id => (champ(id) && champ(id).tags) || [];

/* ---------------- Profils ---------------- */
function supProfile(id) {
  const p = S.meta.supports[id];
  if (p) return p;
  const t = tags(id), info = (champ(id) && champ(id).info) || {};
  const ap = (info.magic || 0) > (info.attack || 0);
  if (t.includes('Tank')) return { arch: 'engage', early: 2, engage: 2, poke: 0, sustain: 0, peel: 2, scale: 2, dmg: 'tank' };
  if (t.includes('Support')) return { arch: ap ? 'enchanter' : 'engage', early: 2, engage: 1, poke: 1, sustain: 1, peel: 2, scale: 2, dmg: ap ? 'ap' : 'ad' };
  if (t.includes('Mage')) return { arch: 'mage', early: 2, engage: 0, poke: 2, sustain: 0, peel: 1, scale: 2, dmg: 'ap' };
  if (t.includes('Fighter') || t.includes('Assassin')) return { arch: 'engage', early: 2, engage: 2, poke: 0, sustain: 0, peel: 1, scale: 1, dmg: 'ad' };
  return { arch: 'mage', early: 2, engage: 1, poke: 2, sustain: 0, peel: 1, scale: 2, dmg: ap ? 'ap' : 'ad' };
}
function adcProfile(id) { return S.meta.adcs[id] || { style: 'utility', early: 2, allin: 2, scale: 2, range: 'mid' }; }
function isAP(id) {
  const p = S.meta.supports[id]; if (p && (p.dmg === 'ap')) return true; if (p && p.dmg !== 'ap') return false;
  const i = (champ(id) && champ(id).info) || {}; return (i.magic || 0) > (i.attack || 0);
}
const inList = (list, id) => (S.meta[list] || []).includes(id);
const isEngager = id => inList('engagers', id) || (S.meta.supports[id] && S.meta.supports[id].engage >= 3);
const isFront = id => inList('frontline', id) || tags(id).includes('Tank');
const allies = () => ROLES_ALLY.map(r => S.match.ally[r]).filter(Boolean);
const enemies = () => ROLES_ENEMY.map(r => S.match.enemy[r]).filter(Boolean);

/* ---------------- Synergie ---------------- */
function scoreSupport(sup) {
  const p = supProfile(sup), m = S.match, R = [];
  let s = 50;
  const add = (v, txt) => { if (!v) return; s += v; R.push((v > 0 ? '+' : '−') + Math.abs(Math.round(v)) + ' ' + txt); };
  const adc = m.ally.adc;
  if (adc) {
    const pb = ((S.meta.pairs[sup] || {})[adc]) || 0;
    if (pb) add(pb * 1.4, `duo reconnu avec ${cname(adc)}`);
    const a = adcProfile(adc);
    add((STYLE[p.arch] || {})[a.style] || 0, `${ARCH_FR[p.arch].toLowerCase()} avec un ADC ${STYLE_FR[a.style]}`);
  }
  const al = allies();
  if (al.length >= 2 || (al.length >= 1 && !adc)) {
    const eng = al.filter(isEngager).length, ap = al.filter(isAP).length, fr = al.filter(isFront).length;
    if (eng === 0) { if (p.engage >= 2) add(8, "ton équipe n'a pas d'engage"); else add(-3, "personne pour engager"); }
    else if (eng >= 2 && p.arch !== 'engage') add(4, "l'engage est déjà couvert");
    if (ap === 0 && p.dmg === 'ap') add(6, 'apporte des dégâts magiques (équipe full AD)');
    if (ap >= 3 && p.dmg === 'ap' && p.arch === 'mage') add(-4, 'équipe déjà très AP');
    if (fr === 0 && p.dmg === 'tank') add(6, "ton équipe n'a pas de frontline");
    const hyper = al.filter(id => (S.meta.adcs[id] || {}).style === 'hyper' || ['Kassadin', 'Kayle', 'Vayne', 'Jax', 'Veigar', 'Nasus', 'MasterYi'].includes(id)).length;
    if (hyper >= 2 && (p.arch === 'enchanter' || p.arch === 'warden')) add(4, 'plusieurs carrys à protéger');
  }
  const en = enemies();
  if (en.length) {
    const cs = S.meta.counters[sup] || [];
    en.filter(e => cs.includes(e)).slice(0, 2).forEach(e => add(7, `bon contre ${cname(e)}`));
    en.filter(e => (S.meta.counters[e] || []).includes(sup)).slice(0, 2).forEach(e => add(-7, `${cname(e)} le contre`));
    const ass = en.filter(e => inList('assassins', e)).length;
    if (ass >= 2 && p.peel >= 3) add(5, 'beaucoup de plongeurs en face : il faut du peel');
    const pokers = en.filter(e => (S.meta.supports[e] || {}).poke >= 3 || (S.meta.adcs[e] || {}).style === 'poke').length;
    if (pokers >= 2 && p.sustain >= 2) add(4, 'soins contre leur poke');
  }
  const t = S.meta.tiers[sup];
  if (t) add(TIER_PTS[t], `tier ${t} au patch ${S.meta.patch}`);
  return { id: sup, score: Math.max(5, Math.min(97, Math.round(s))), reasons: R, tier: t, arch: p.arch };
}

/* ---------------- Rôles (partie en direct) ---------------- */
function roleScore(id, spells, role) {
  const t = tags(id), smite = spells.includes(11);
  if (role === 'jungle') return (smite ? 100 : 0) + (S.meta.junglers[id] ? 6 : 0);
  let v = smite ? -60 : 0;
  if (role === 'support') v += (S.meta.supports[id] ? 10 : 0) + (t.includes('Support') ? 6 : 0) + (spells.includes(3) ? 3 : 0);
  if (role === 'adc') v += (S.meta.adcs[id] ? 10 : 0) + (t.includes('Marksman') ? 6 : 0) + (spells.includes(7) ? 4 : 0);
  if (role === 'mid') v += (t.includes('Mage') ? 6 : 0) + (t.includes('Assassin') ? 5 : 0);
  if (role === 'top') v += (t.includes('Fighter') ? 6 : 0) + (t.includes('Tank') ? 5 : 0) + (spells.includes(12) ? 3 : 0);
  return v;
}
function assignRoles(list, roles) {
  let best = null, bestV = -1e9;
  const perm = (arr, used, acc) => {
    if (acc.length === list.length) {
      const v = acc.reduce((s, r, i) => s + roleScore(list[i].id, list[i].spells, r), 0);
      if (v > bestV) { bestV = v; best = acc.slice(); } return;
    }
    roles.forEach((r, i) => { if (!used[i]) { used[i] = true; acc.push(r); perm(arr, used, acc); acc.pop(); used[i] = false; } });
  };
  perm(list, [], []);
  const out = {}; (best || []).forEach((r, i) => out[r] = list[i].id); return out;
}

/* ---------------- Rendu commun ---------------- */
function slotHTML(id, label, data, extra = '') {
  return `<button class="slot ${id ? 'filled' : ''} ${extra}" data-slot="${data}">
    <span class="ic">${id ? `<img src="${cimg(id)}" alt="" loading="lazy">` : '+'}</span>
    <span class="lbl">${esc(label)}</span><span class="nm">${id ? esc(cname(id)) : '&nbsp;'}</span></button>`;
}
function renderSlots() {
  const m = S.match;
  $('#allySlots').innerHTML = ROLES_ALLY.map(r => slotHTML(m.ally[r], ROLE_FR[r], 'ally.' + r)).join('') + slotHTML(m.me, 'Toi', 'me', 'me');
  const en = ROLES_ENEMY.map(r => slotHTML(m.enemy[r], ROLE_FR[r], 'enemy.' + r)).join('');
  $('#enemySlotsDraft').innerHTML = en; $('#enemySlotsGame').innerHTML = en;
  $('#botAlly').innerHTML = slotHTML(m.ally.adc, 'ADC', 'ally.adc') + slotHTML(m.me, 'Toi', 'me', 'me');
  $('#botEnemy').innerHTML = slotHTML(m.enemy.adc, 'ADC', 'enemy.adc') + slotHTML(m.enemy.support, 'Support', 'enemy.support');
}

function renderRanking() {
  const pool = S.settings.pool.filter(id => champ(id) || !Object.keys(S.champs).length);
  const box = $('#ranking');
  if (!pool.length) {
    box.innerHTML = `<div class="empty">Ton pool est vide. Choisis tes supports une fois, ils restent enregistrés.<br><br>
      <button class="btn primary" data-act="pool">Choisir mon pool</button></div>`;
    return;
  }
  const res = pool.map(scoreSupport).sort((a, b) => b.score - a.score);
  const hasInfo = allies().length || enemies().length;
  box.innerHTML = (hasInfo ? '' : `<p class="note">Ajoute au moins ton ADC pour un vrai classement. En attendant : tier du patch seul.</p>`) +
    res.map((r, i) => `<div class="ritem ${i === 0 && hasInfo ? 'top1' : ''}">
      ${cimg(r.id) ? `<img src="${cimg(r.id)}" alt="">` : '<span class="ph"></span>'}
      <div style="min-width:0"><div class="nm">${esc(cname(r.id))}${r.tier ? `<span class="tier">${r.tier}</span>` : ''}</div>
        <div class="why">${esc(ARCH_FR[r.arch])}${r.reasons[0] ? ' · ' + esc(r.reasons[0]) : ''}</div>
        <div class="bar"><i style="width:${r.score}%"></i></div>
        ${r.reasons.length > 1 ? `<details class="why-more"><summary>Détail du score</summary><ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div><div class="pct num">${r.score}%</div><button class="btn small" data-pickme="${r.id}" style="margin-top:6px">${S.match.me === r.id ? 'Choisi' : 'Jouer'}</button></div>
    </div>`).join('');
}

/* ---------------- Build ---------------- */
function analyzeEnemies() {
  const en = enemies();
  const ap = en.filter(isAP).length, ad = en.length - ap;
  const heal = en.filter(e => inList('healers', e));
  const ass = en.filter(e => inList('assassins', e));
  const eng = en.filter(isEngager);
  const front = en.filter(isFront);
  const eadc = S.match.enemy.adc;
  const crit = eadc && !NON_CRIT.includes(eadc) && tags(eadc).includes('Marksman');
  return { n: en.length, ap, ad, heal, ass, eng, front, crit };
}
function itemHTML(id, why) {
  if (!itemExists(id)) return '';
  return `<div class="item"><img src="${iimg(id)}" alt="" loading="lazy"><div>${esc(iname(id))}${why ? `<small>${esc(why)}</small>` : ''}</div></div>`;
}
function renderBuild() {
  const out = $('#buildOut'), me = S.match.me;
  const opgg = { euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', tr1: 'tr', br1: 'br', la1: 'lan', la2: 'las', jp1: 'jp', oc1: 'oce', me1: 'me' }[S.settings.platform] || 'euw';
  const rid = (S.settings.riotId || '').replace('#', '-');
  $('#opggLink').href = `https://op.gg/lol/summoners/${opgg}/${encodeURIComponent(rid)}/ingame`;
  $('#meRow').innerHTML = me
    ? `${slotHTML(me, 'Toi', 'me', 'me')}<div class="grow"><b>${esc(cname(me))}</b><div class="note">${esc(ARCH_FR[supProfile(me).arch])}</div></div>`
    : `<div class="empty grow">Choisis ton support (onglet Draft ou ici).</div>${slotHTML(null, 'Toi', 'me', 'me')}`;
  const A = analyzeEnemies();
  const chips = [];
  if (A.n) {
    chips.push(`<span class="chip ${A.ap >= 3 ? 'warn' : ''}">${A.ap} AP / ${A.ad} AD</span>`);
    if (A.heal.length >= 2) chips.push(`<span class="chip bad">Soins : ${A.heal.map(cname).join(', ')}</span>`);
    if (A.ass.length >= 2) chips.push(`<span class="chip bad">Plongeurs : ${A.ass.map(cname).join(', ')}</span>`);
    if (A.eng.length >= 3) chips.push(`<span class="chip warn">Beaucoup de CC / engage</span>`);
    if (A.front.length >= 3) chips.push(`<span class="chip warn">${A.front.length} tanks / frontline</span>`);
    if (A.crit) chips.push(`<span class="chip warn">ADC à crit</span>`);
  }
  $('#threats').innerHTML = chips.join('');
  if (!me) { out.innerHTML = '<p class="note">Le build apparaît dès que ton champion est choisi.</p>'; return; }
  const p = supProfile(me), arch = p.arch, I = S.meta.items;
  const B = I.boots || {};
  let boots = arch === 'mage' && p.dmg === 'ap' ? B.mage : B.default, bootsWhy = 'standard';
  if (A.n && (A.eng.length >= 3 || A.ap >= 4)) { boots = B.vsCC; bootsWhy = 'beaucoup de CC / AP en face'; }
  else if (A.n && A.ad >= 4) { boots = B.vsAD; bootsWhy = 'équipe adverse très AD'; }
  const sit = [];
  const pushS = (ids, why) => { for (const id of [].concat(ids)) if (id && itemExists(id) && !sit.find(x => x.id === id)) { sit.push({ id, why }); break; } };
  if (A.n) {
    if (A.heal.length >= 2) pushS((I.situational.antiheal || {})[arch], 'anti-soins contre ' + A.heal.slice(0, 3).map(cname).join(', '));
    if (A.ap >= 3) pushS(arch === 'enchanter' ? [3190, 3222] : arch === 'mage' ? [3157] : I.situational.vsAP, 'équipe adverse AP');
    if (A.ad >= 3 || A.crit) pushS(arch === 'enchanter' ? [3190, 3109] : arch === 'mage' ? [3157] : (A.crit ? I.situational.vsCrit : I.situational.vsAD), A.crit ? `contre ${cname(S.match.enemy.adc)} (crit)` : 'équipe adverse AD');
    if (A.eng.length >= 3) pushS(arch === 'enchanter' ? [3222] : [3111], 'beaucoup de contrôles');
    if (A.ass.length >= 2) pushS(arch === 'mage' ? [3157] : I.situational.vsDive, 'protéger ton carry des plongeurs');
    if (A.front.length >= 3 && (arch === 'mage' || p.dmg === 'ap')) pushS(I.situational.vsTanks, 'beaucoup de tanks');
  }
  const core = ((I.core || {})[arch] || []).filter(itemExists).filter(id => !sit.find(x => x.id === id));
  const upId = ['Senna', 'Ashe'].includes(me) ? I.upgrades.attack : I.upgrades[arch];
  const eadc = S.match.enemy.adc, aggro = eadc && ['hyper', 'allin'].includes(adcProfile(eadc).style);
  const sums = (A.ass.length >= 2 || aggro) ? 'Flash + Exhaust (leur menace : ' + (aggro ? cname(eadc) : A.ass.map(cname).join(', ')) + ')' : (p.early >= 3 ? 'Flash + Ignite (lane agressive)' : 'Flash + Exhaust');
  // Ordre d'achat : 1er objet, bottes, puis la suite
  const urgent = sit.filter(x => /anti-soins|plongeurs/.test(x.why));
  const rest = sit.filter(x => !urgent.includes(x));
  const seq = [];
  const addSeq = (id, why) => { if (id && itemExists(id) && !seq.find(x => x.id === id)) seq.push({ id, why }); };
  urgent.forEach(x => addSeq(x.id, x.why));
  addSeq(core[0], 'objet clé ' + ARCH_FR[arch].toLowerCase());
  addSeq(boots, 'bottes : ' + bootsWhy);
  rest.forEach(x => addSeq(x.id, x.why));
  core.slice(1).forEach(id => addSeq(id, 'objet de base'));
  const order = seq.filter(x => x.id !== boots).slice(0, 4).map(x => x.id);
  order.splice(1, 0, boots); // 1er objet, puis finir les bottes, puis la suite
  window._why = seq; const steps = planBuys(order.filter(Boolean));
  const groups = [];
  steps.forEach(st => { let g = groups.find(x => x.name === st.grp); if (!g) groups.push(g = { name: st.grp, items: [] }); g.items.push(st); });
  const tile = st => `<div class="tl-i ${st.kind === 'finish' ? 'fin' : ''}"><img src="${iimg(st.id)}" alt="${esc(iname(st.id))}" loading="lazy">${st.qty > 1 ? `<i class="qty">×${st.qty}</i>` : ''}<span class="num">${st.cost || ''}</span></div>`;
  const label = g => {
    const m = g.name.match(/^Objet (\d+) : (.*)$/);
    if (m) return `<b>Objet ${m[1]}</b><small>${esc(m[2])}</small>`;
    if (g.name === 'Finir les bottes') { const f = g.items[g.items.length - 1]; return `<b>Bottes</b><small>${esc(iname(f.id))}</small>`; }
    return `<b>${esc(g.name)}</b>`;
  };
  const vs = sit.length ? sit.slice(0, 3).map(x => `${esc(iname(x.id))} <span>(${esc(x.why)})</span>`).join(' · ') : '';
  const g0 = groups.find(g => g.name === 'Départ'), g1 = groups.find(g => g.name === '1er retour');
  const firstRow = g0 && g1 ? `<div class="bp-row"><div class="bp-l"><b>Départ</b><small>puis 1er retour</small></div><div class="bp-r">${g0.items.map(tile).join('')}<span class="vbar"></span>${g1.items.map(tile).join('')}</div></div>` : '';
  const restG = firstRow ? groups.filter(g => g !== g0 && g !== g1) : groups;
  out.innerHTML = `<div class="buildpath">${firstRow}
      ${restG.map(g => `<div class="bp-row"><div class="bp-l">${label(g)}</div><div class="bp-r">${g.items.map(tile).join('<span class="sep">›</span>')}</div></div>`).join('')}
    </div>
    <div class="bp-foot">
      <div><b>Chaque retour :</b> 1 pink${upId && itemExists(upId) ? ` · <b>Ward finale :</b> ${esc(iname(upId))}` : ''}</div>
      ${vs ? `<div class="bp-vs"><b>Contre eux :</b> ${vs}</div>` : ''}
      <div><b>Runes :</b> ${esc((S.meta.keystones || {})[arch] || '')} · ${esc(sums)}</div>
      ${A.n ? '' : '<div class="note">Ajoute l\'équipe adverse (plus bas) pour adapter les objets.</div>'}
    </div>`;
}
// Découpe le build en achats réels (composants puis assemblage), en réutilisant ce qui est déjà dans l'inventaire.
function planBuys(order) {
  const it = id => (S.items && S.items[String(id)]) || null;
  const from = id => ((it(id) && it(id).from) || []).map(String);
  const total = id => (it(id) && it(id).gold) || 0;
  const base = id => (it(id) && it(id).base) || 0;
  const steps = [], inv = [];
  const add = (grp, id, kind, why) => {
    const last = steps[steps.length - 1];
    if (last && last.grp === grp && last.id === String(id) && kind === 'buy' && last.kind === 'buy') { last.qty++; last.cost += total(id); return; }
    steps.push({ grp, id: String(id), kind, qty: 1, why, cost: kind === 'finish' ? base(id) : total(id) });
  };
  add('Départ', 3865, 'buy', 'objet de quête support');
  if (itemExists(2003)) { add('Départ', 2003, 'buy', 'potions'); add('Départ', 2003, 'buy'); }
  const pink = itemExists(2055) ? 2055 : null;
  const bootsId = order[1];
  const basic = from(bootsId).find(c => !from(c).length) || (itemExists(1001) ? '1001' : null);
  if (basic) { add('1er retour', basic, 'buy', 'vitesse pour roam et esquiver'); inv.push(basic); }
  if (pink) add('1er retour', pink, 'buy', 'vision de la rivière');
  const expand = (grp, id, why) => {
    const comps = from(id);
    if (!comps.length || !S.items) { add(grp, id, 'buy', why); return; }
    comps.forEach(c => { const k = inv.indexOf(c); if (k >= 0) inv.splice(k, 1); else expand(grp, c); });
    add(grp, id, 'finish', why);
  };
  const whyOf = id => ((window._why || []).find(x => String(x.id) === String(id)) || {}).why;
  order.forEach((id, n) => {
    const grp = id === bootsId ? 'Finir les bottes' : `Objet ${n === 0 ? 1 : n} : ${iname(id)}`;
    expand(grp, id, whyOf(id));
  });
  steps.forEach((st, i) => st.k = 's' + i + '_' + st.id);
  return steps;
}
function toggleBuy(id) {
  id = String(id); const ids = new Set(S.bought.ids || []);
  ids.has(id) ? ids.delete(id) : ids.add(id);
  S.bought.ids = [...ids]; LS.set('bought', S.bought); renderBuild();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'); if (b) { toggleBuy(b.dataset.buy); if (navigator.vibrate) navigator.vibrate(30); return; }
  if (e.target.id === 'resetBuy') { S.bought = { ids: [] }; LS.set('bought', S.bought); renderBuild(); }
});

/* ---------------- Botlane ---------------- */
function laneScores(sup, adc) {
  const sp = supProfile(sup), ap = adcProfile(adc);
  return { early: ap.early * 1.2 + sp.early + sp.poke * 0.4, allin: ap.allin + sp.engage * 1.2 + sp.early * 0.5, late: ap.scale * 1.2 + sp.scale + sp.peel * 0.3 };
}
const SPELLS = {}, spellLoading = {};
function loadSpells(id) {
  if (!id || SPELLS[id] || spellLoading[id] || !S.version) return;
  const ck = LS.get('sp_' + id, null);
  if (ck && ck.v === S.version) { SPELLS[id] = ck.d; return; }
  spellLoading[id] = true;
  getJSON(`${DD}/cdn/${S.version}/data/fr_FR/champion/${id}.json`).then(j => {
    const c = j.data[id], d = { Passif: { name: c.passive.name, img: `${DD}/cdn/${S.version}/img/passive/${c.passive.image.full}` } };
    ['Q', 'W', 'E', 'R'].forEach((k, i) => { const s = c.spells[i]; if (s) d[k] = { name: s.name, cd: s.cooldownBurn, img: `${DD}/cdn/${S.version}/img/spell/${s.image.full}` }; });
    SPELLS[id] = d; LS.set('sp_' + id, { v: S.version, d });
    if (S.view === 'bot' || S.view === 'game') renderBot();
  }).catch(() => { }).finally(() => { spellLoading[id] = false; });
}
function spellRow(champId, k, tip) {
  const sp = (SPELLS[champId] || {})[k];
  const cd = sp && sp.cd && sp.cd !== '0' ? `<span class="cd num">${esc(sp.cd.split('/').slice(0, 1)[0])} s${sp.cd.includes('/') ? ' → ' + esc(sp.cd.split('/').pop()) + ' s' : ''}</span>` : '';
  return `<div class="spell">${sp ? `<img src="${sp.img}" alt="">` : `<span class="sk">${esc(k)}</span>`}
    <div class="grow"><div class="sn"><b>${esc(cname(champId))} · ${esc(k)}</b>${sp ? ' ' + esc(sp.name) : ''} ${cd}</div><div class="st">${esc(tip)}</div></div></div>`;
}
const ARCH_DO = {
  engage: m => `Engage quand leur sort défensif ou leur Flash est tombé. ${adcProfile(m.ally.adc).style === 'hyper' ? cname(m.ally.adc) + ' scale mieux : ne force pas si ce n\'est pas propre.' : cname(m.ally.adc) + ' suit bien tes engages.'}`,
  enchanter: m => `Trade avec ${cname(m.ally.adc)} (auto + ton sort) puis recule. Garde bouclier/soin pour leur engage.`,
  warden: m => `Reste près de ${cname(m.ally.adc)}, intercepte les projectiles, punis leur engage.`,
  mage: m => `Poke dès qu'ils s'avancent pour un last-hit, garde ta portée.`
};
const ARCH_DONT = {
  engage: 'Engager seul quand ton ADC est loin ou en train de farmer',
  enchanter: 'Gaspiller ton bouclier/soin avant leur engage',
  warden: 'Partir en avant : ton rôle est de protéger',
  mage: 'Te placer devant tes sbires (tu es la cible facile)'
};
function renderBot() {
  const m = S.match, me = m.me, a = m.ally.adc, ea = m.enemy.adc, es = m.enemy.support, out = $('#botOut');
  if (!me || !ea || !es || !a) {
    out.innerHTML = `<div class="card"><p>Complète les 4 champions de la botlane (touche les cases au-dessus).</p>
      <p class="note">Manque : ${[!a && 'ton ADC', !me && 'ton support', !ea && 'leur ADC', !es && 'leur support'].filter(Boolean).join(', ')}</p></div>`;
    return;
  }
  [es, ea].forEach(loadSpells);
  const mine = laneScores(me, a), theirs = laneScores(es, ea);
  const cMe = S.meta.counters[me] || [], cThem = S.meta.counters[es] || [];
  if (cMe.includes(es) || cMe.includes(ea)) { mine.early += 1; mine.allin += 1; }
  if (cThem.includes(me) || cThem.includes(a)) { theirs.early += 1; theirs.allin += 1; }
  mine.allin += ((S.meta.pairs[me] || {})[a] || 0) / 10; theirs.allin += ((S.meta.pairs[es] || {})[ea] || 0) / 10;
  const ph = (k, label, sub) => { const d = mine[k] - theirs[k]; const c = d > 0.8 ? 'adv' : d < -0.8 ? 'dis' : 'even'; return { c, d, html: `<div class="phase ${c}"><small>${label}</small><b>${c === 'adv' ? 'Avantage' : c === 'dis' ? 'Désavant.' : 'Égal'}</b><small>${sub}</small></div>` }; };
  const P = [ph('early', 'Niv 1-2', 'trades'), ph('allin', 'Niv 3-6', 'all-in'), ph('late', 'Après 6', 'scaling')];
  const total = P.reduce((s, x) => s + x.d, 0);
  const verdict = total > 1.5 ? ['good', 'Vous avez l\'avantage'] : total < -1.5 ? ['bad', 'Lane difficile : sécurité d\'abord'] : ['warn', 'Lane équilibrée : tout se joue sur les sorts'];
  const sp = supProfile(me), esp = supProfile(es), eap = adcProfile(ea);
  const L = S.meta.lane || {}, Les = L[es] || {}, Lea = L[ea] || {};
  // Sorts à esquiver
  const genericS = (id, p) => p.arch === 'engage' ? [['E', 'Son engage principal : garde la distance quand il est prêt.']] : p.arch === 'mage' ? [['Q', 'Son sort principal : derrière tes sbires, bouge latéralement.']] : [];
  const spells = [...(Les.s || genericS(es, esp)).map(x => spellRow(es, x[0], x[1])), ...(Lea.s || []).map(x => spellRow(ea, x[0], x[1]))];
  // À faire
  const DO = [];
  if (P[0].c === 'adv') DO.push('Course au niveau 2 (1re vague + 3 sbires mêlée) puis engage tout de suite');
  else DO.push('Niveau 2 = 1re vague + 3 sbires mêlée : recule d\'un cran s\'ils l\'ont avant vous');
  (Les.do || []).forEach(x => DO.push(x)); (Lea.do || []).forEach(x => DO.push(x));
  DO.push(ARCH_DO[sp.arch](m));
  if (P[2].c === 'adv' && P[0].c !== 'adv') DO.push('Jouer safe jusqu\'au 6 et aux premiers objets : vous scalez mieux');
  if (P[2].c === 'dis' && P[0].c !== 'dis') DO.push('Convertir votre avance avant 14:00 (plaques, drake) : ils scalent mieux');
  DO.push(total > 1.5 ? 'Pousser et prendre les plaques, roam mid dès le niveau 5' : total < -1.5 ? 'Laisser la vague venir à votre tour, ward le tri-bush, demander un gank niveau 3-4' : 'Slow push avant chaque retour et avant le drake');
  if (cMe.includes(es)) DO.push(`${cname(me)} contre ${cname(es)} : sois agressif`);
  // À éviter
  const DONT = [];
  (Les.dont || []).forEach(x => DONT.push(x)); (Lea.dont || []).forEach(x => DONT.push(x));
  if (!Les.dont) DONT.push(esp.arch === 'engage' ? 'Te coller à ton ADC (double contrôle)' : esp.arch === 'enchanter' ? 'Trade quand son bouclier/soin est prêt' : 'Prendre du poke gratuit en avançant');
  if (!Lea.dont && ({ bully: 1, allin: 1 })[eap.style]) DONT.push(`Les échanges longs contre ${cname(ea)} au niveau 1-3`);
  DONT.push(ARCH_DONT[sp.arch]);
  if (cThem.includes(me)) DONT.push(`Jouer devant : ${cname(es)} contre ${cname(me)}`);
  const jg = m.enemy.jungle && S.meta.junglers[m.enemy.jungle];
  if (jg) DONT.push(`Avancer sans ward : ${cname(m.enemy.jungle)} ${jg.note}`);
  const uniq = a => [...new Set(a)];
  out.innerHTML = `<div class="card"><div class="row"><span class="chip ${verdict[0]}">${verdict[1]}</span></div><div class="phases">${P.map(x => x.html).join('')}</div></div>
    <div class="card"><h3>Sorts à surveiller</h3><div class="spells">${spells.join('') || '<p class="note">Pas de fiche pour ces champions.</p>'}</div>
      <p class="note">Recharges du patch en cours, du niveau 1 au rang max.</p></div>
    <div class="card dolist"><h3>Pour gagner la lane</h3><ul class="checks do">${uniq(DO).slice(0, 6).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="card dolist"><h3>À éviter</h3><ul class="checks dont">${uniq(DONT).slice(0, 5).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

/* ---------------- Chronologie ---------------- */
const SPOTS = {
  riverBot: [76, 77, 'Buisson rivière bot'], pit: [62, 71, 'Entrée du pit drake'],
  triBlue: [60, 88, 'Tri-bush bleu'], triRed: [88, 60, 'Tri-bush rouge'],
  deepRed: [76, 42, 'Jungle rouge côté bot'], deepBlue: [54, 74, 'Jungle bleue côté bot'],
  pitTop: [37, 28, 'Pit des larves / Baron'], riverTop: [22, 30, 'Rivière top'],
  midBlue: [57, 58, 'Rivière mid (sud)'], midRed: [43, 41, 'Rivière mid (nord)']
};
function wardSpots(key, side) {
  const enemyTri = side === 'blue' ? 'triRed' : 'triBlue', enemyDeep = side === 'blue' ? 'deepRed' : 'deepBlue';
  return ({ lvl1: ['riverBot'], gank: [enemyTri, 'riverBot'], drake: ['pit', 'riverBot'], grubs: ['riverTop', 'pitTop'], mid: ['midBlue', 'midRed'], deep: [enemyDeep, enemyTri], baron: ['pitTop', 'riverTop', 'midRed'] })[key] || [];
}
function mapSVG(keys) {
  const pts = keys.map(k => SPOTS[k]).filter(Boolean), me = S.match.side === 'red' ? [88, 12] : [12, 88];
  return `<svg viewBox="0 0 100 100" role="img" aria-label="Carte de la Faille avec emplacements de ward">
    <image href="map11.png" x="0" y="0" width="100" height="100"/>
    <circle cx="${me[0]}" cy="${me[1]}" r="8" fill="none" stroke="#c8aa6e" stroke-width="1" stroke-dasharray="2 1.5"/>
    <text x="${me[0]}" y="${me[1] + (me[1] > 50 ? -10 : 14)}" font-size="4.5" fill="#f0e6d2" text-anchor="middle" font-family="sans-serif" font-weight="700">TOI</text>
    ${pts.map((p, i) => `<g><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="#ffd34d" opacity=".25"><animate attributeName="r" values="4;7;4" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="#ffd34d" stroke="#010a13" stroke-width="1"/><text x="${p[0]}" y="${p[1] + 1.6}" font-size="4.6" font-weight="800" fill="#010a13" text-anchor="middle" font-family="sans-serif">${i + 1}</text></g>`).join('')}
  </svg>`;
}

function buildEvents() {
  const T = S.meta.timers, side = S.match.side, m = S.match, ev = [];
  const E = (t, kind, title, text, spots, id) => ev.push({ t, kind, title, text, spots, id: id || kind + t });
  const jg = m.enemy.jungle, jp = jg ? (S.meta.junglers[jg] || { type: 'mid', note: 'profil inconnu' }) : null;
  const myJg = m.ally.jungle;
  E(0, 'lane', 'Début de partie', "Atlas du monde + 2 potions. Aide ton jungler au leash seulement s'il le demande.");
  E(65, 'lane', 'Première vague', "Course au niveau 2 : 1re vague + 3 sbires mêlée de la 2e (~1:50). Prends les buissons de lane.");
  E(75, 'ward', 'Ward niveau 1', "Ward le buisson de rivière bot pour voir le jungler adverse arriver (et un éventuel crabe).", wardSpots('lvl1', side));
  E(108, 'lane', 'Niveau 2 imminent', 'Le 3e sbire mêlée de la 2e vague va tomber : prêt à engager / à reculer.');
  if (jp) {
    const g = jp.type === 'early' ? 165 : jp.type === 'mid' ? 200 : jp.type === 'farm' ? 285 : 390;
    const lvl = jp.type === 'early' ? 'niveau 3' : jp.type === 'mid' ? 'niveau 3-4' : jp.type === 'farm' ? 'après son full clear' : 'niveau 6';
    E(g - S.settings.lead, 'ward', `Ward anti-gank (${cname(jg)})`, `Ward le tri-bush adverse ou la rivière maintenant : ${cname(jg)} peut arriver ${lvl}.`, wardSpots('gank', side), 'wardgank');
    E(g, 'danger', `Gank possible : ${cname(jg)}`, `${jp.note}. Pas d'avance sans vision, surveille ta minimap.`, null, 'gank');
    if (jp.type === 'early') E(220, 'danger', 'Deuxième fenêtre de gank', `Si ${cname(jg)} n'est pas venu, il peut arriver après son full clear (~3:30-3:45).`, null, 'gank2');
    if (jp.type !== 'six') E(390, 'danger', `Niveau 6 du jungler`, `Vers 6:00-7:00, ${cname(jg)} et les laners adverses ont leur ultime : ward plus profond.`, null, 'six');
  } else {
    E(180 - S.settings.lead, 'ward', 'Ward anti-gank', 'Ward le tri-bush adverse ou la rivière : premier gank possible entre 2:45 et 3:30.', wardSpots('gank', side), 'wardgank');
    E(195, 'danger', 'Premier gank possible', "Ajoute le jungler adverse pour un timing précis.", null, 'gank');
  }
  E(T.scuttle, 'obj', 'Crabe de rivière', `Si vous avez la priorité, bouge vers le crabe côté bot avec ${myJg ? cname(myJg) : 'ton jungler'}.`);
  E(T.dragon - 30, 'ward', 'Prépare le drake', 'Pink dans le buisson de rivière bot, ward l\'entrée du pit. Poussez la vague avant.', wardSpots('drake', side), 'wdrake1');
  E(T.dragon, 'obj', 'Drake (5:00)', 'Premier drake. Joue-le seulement si vous avez la priorité bot.', null, 'drake1');
  E(390, 'lane', '≈ Niveau 5 : roams débloqués', 'Fin de la pénalité de roam (−33 % or/XP hors bot). Roam mid si ta vague est poussée.');
  E(T.grubs - 45, 'ward', 'Prépare les larves', 'Vague poussée → monte avec ton jungler. Ward la rivière top et le pit.', wardSpots('grubs', side), 'wgrubs');
  E(T.grubs, 'obj', 'Larves du Néant (8:00)', 'Un seul groupe, pas de réapparition.', null, 'grubs');
  E(600, 'ward', 'Renouvelle ta vision', "Pink rivière bot, ward la rivière mid si tu roam. Utilise tes charges de trinket.", wardSpots('mid', side), 'w10');
  E(720, 'lane', 'Reset et pinks', 'Pousse, rentre, achète 2 pinks (40 po avec la quête finie).');
  E(T.platesFall - 30, 'ward', 'Dernières plaques', 'Ward profond la jungle adverse côté bot pour prendre les plaques en sécurité.', wardSpots('deep', side), 'wplates');
  E(T.platesFall, 'obj', 'Fin des plaques (14:00)', "Fin de la phase de lane : passe à l'Oracle si ta quête est finie, regroupe mid.", null, 'plates');
  E(T.herald - 30, 'ward', 'Prépare le Héraut', 'Balaye et ward autour du pit top.', wardSpots('grubs', side), 'wherald');
  E(T.grubsDespawn, 'obj', 'Les larves disparaissent', 'Si elles sont encore là, c\'est la dernière chance.', null, 'grubsend');
  E(T.herald, 'obj', 'Héraut (15:00)', 'Une seule apparition dans le pit top.', null, 'herald');
  E(T.baron - 30, 'ward', 'Prépare le Baron', 'Oracle + pink : nettoie les entrées du Baron, ward la rivière mid.', wardSpots('baron', side), 'wbaron');
  E(T.baron, 'obj', 'Baron (20:00)', 'Ne le commence jamais sans vision de leur jungler.', null, 'baron');
  // drakes suivants
  const kills = S.kills.drakes || [];
  kills.forEach((k, i) => {
    const t = k + T.dragonRespawn;
    E(t - 30, 'ward', `Prépare le drake n°${i + 2}`, 'Pink dans la rivière bot, poussez bot et mid avant.', wardSpots('drake', side), 'wdrake' + (i + 2));
    E(t, 'obj', `Drake n°${i + 2}`, '5:00 après le précédent.', null, 'drake' + (i + 2));
  });
  if (S.kills.soul != null) { const t = S.kills.soul + T.elderAfterSoul; E(t - 45, 'ward', 'Prépare l\'Ancien', 'Vision complète autour du pit.', wardSpots('drake', side), 'welder'); E(t, 'obj', 'Dragon Ancien', '6:00 après l\'âme.', null, 'elder'); }
  return ev.sort((a, b) => a.t - b.t);
}
const now = () => S.timer.start ? (Date.now() - S.timer.start) / 1000 : null;

function renderTimeline() {
  const t = now(), ev = buildEvents();
  const nextIdx = t == null ? -1 : ev.findIndex(e => e.t >= t - 5);
  const nextWard = ev.find(e => e.kind === 'ward' && (t == null || e.t >= t - 20));
  $('#timeline').innerHTML = (nextWard ? `<div class="card" style="margin-bottom:14px"><h3>${t == null ? 'Première ward' : 'Prochaine ward'} · ${fmt(nextWard.t)}</h3>
      <div class="mapwrap">${mapSVG(nextWard.spots || [])}<div><b>${esc(nextWard.title)}</b><p class="note" style="margin-top:4px">${esc(nextWard.text)}</p>
      <ol class="tips" style="margin-top:6px;font-size:13px">${(nextWard.spots || []).map(k => `<li>${esc(SPOTS[k][2])}</li>`).join('')}</ol>
      <p class="note">Côté ${S.match.side === 'blue' ? 'bleu (base en bas à gauche)' : 'rouge (base en haut à droite)'}.</p></div></div></div>` : '') +
    (t != null && (t != null ? ev.filter((e, i) => e.t < t - 5 && i !== nextIdx).length : 0) ? `<button class="btn small ghost" id="togglePast" style="margin-bottom:12px">${S.showPast ? 'Masquer' : 'Voir'} les ${(t != null ? ev.filter((e, i) => e.t < t - 5 && i !== nextIdx).length : 0)} événements passés</button>` : '') +
    ev.map((e, i) => ({ e, i })).filter(({ e, i }) => t == null || S.showPast || e.t >= t - 5 || i === nextIdx).map(({ e, i }) => `<div class="ev ${e.kind} ${t != null && e.t < t - 5 && i !== nextIdx ? 'past' : ''} ${i === nextIdx ? 'now' : ''}">
      <div class="tm">${fmt(e.t)}</div><div class="dot"><i></i></div>
      <div class="body"><span class="kind">${{ ward: 'Ward', obj: 'Objectif', danger: 'Danger', lane: 'Lane' }[e.kind]}</span><b>${esc(e.title)}</b><p>${esc(e.text)}</p></div></div>`).join('');
  $('#rules').innerHTML = `<ul class="tips">${(S.meta.supportRules || []).map(r => `<li><b>${esc(r.title)}.</b> ${esc(r.text)}</li>`).join('')}</ul>`;
  $$('.seg [data-side]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === S.match.side)));
  const tp = $('#togglePast'); if (tp) tp.onclick = () => { S.showPast = !S.showPast; renderTimeline(); };
  tick(true);
}

let audioCtx = null, wakeLock = null;
function beep() {
  if (!S.settings.sound || !audioCtx) return;
  try {
    [0, 0.22].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'square'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.18); o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.2); });
  } catch (e) { }
}
function fireAlert(e) {
  const box = $('#alertBox');
  box.innerHTML = `<div class="alert ${e.kind === 'ward' ? 'ward' : e.kind === 'obj' ? 'obj' : ''}" role="alert"><div><b>${fmt(e.t)} · ${esc(e.title)}</b><p>${esc(e.text)}</p></div><button aria-label="Fermer">OK</button></div>`;
  $('button', box).onclick = () => box.innerHTML = '';
  setTimeout(() => { if (box.firstChild) box.innerHTML = ''; }, 9000);
  beep();
  if (S.settings.vibrate && navigator.vibrate) navigator.vibrate([220, 100, 220]);
  if (S.settings.notif && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    navigator.serviceWorker && navigator.serviceWorker.ready.then(r => r.showNotification(`${fmt(e.t)} · ${e.title}`, { body: e.text, tag: e.id, icon: 'icon-192.png' })).catch(() => { });
  }
}
let lastRenderedNext = null;
function tick(silent) {
  const t = now();
  $('#clockT').textContent = t == null ? '0:00' : fmt(t);
  const ev = buildEvents();
  if (t == null) { $('#clockNext').innerHTML = 'Lance le chrono au début de la partie (ou charge ta partie en direct pour le caler tout seul).'; return; }
  const nx = ev.find(e => e.t >= t);
  $('#clockNext').innerHTML = nx ? `Dans <b class="num">${fmt(nx.t - t)}</b> · ${esc(nx.title)}` : 'Fin de la chronologie.';
  if (!silent) {
    for (const e of ev) {
      const at = e.kind === 'ward' || e.kind === 'lane' ? e.t : e.t - S.settings.lead;
      if (t >= at && t < at + 6 && !S.fired[e.id]) { S.fired[e.id] = true; if (e.kind !== 'lane' || e.id === 'lane390') fireAlert(e); }
    }
    const key = nx && nx.id;
    if (key !== lastRenderedNext && S.view === 'time') { lastRenderedNext = key; renderTimeline(); }
  }
}
function markPastFired() { const t = now(); S.fired = {}; if (t == null) return; for (const e of buildEvents()) { const at = e.kind === 'ward' || e.kind === 'lane' ? e.t : e.t - S.settings.lead; if (at < t - 1) S.fired[e.id] = true; } }
async function startClock(offsetSec) {
  S.timer.start = Date.now() - (offsetSec || 0) * 1000; save(); markPastFired();
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume && audioCtx.resume(); } catch (e) { }
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
  if (S.settings.notif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
  renderTimeline();
}
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.timer.start && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } } });

/* ---------------- Partie en direct ---------------- */
async function loadLive() {
  const st = $('#liveStatus'), proxy = (S.settings.proxy || RELAY).replace(/\/+$/, '');
  if (!proxy) { st.className = 'status err'; st.innerHTML = "Pas encore de relais Riot configuré (onglet Réglages). En attendant : ouvre OP.GG et saisis l'équipe adverse ci-dessous."; return; }
  if (!/.+#.+/.test(S.settings.riotId || '')) { st.className = 'status err'; st.textContent = 'Renseigne ton Riot ID (Pseudo#TAG) dans les Réglages.'; return; }
  st.className = 'status'; st.textContent = 'Recherche de ta partie…';
  try {
    const r = await fetch(`${proxy}/live?riotId=${encodeURIComponent(S.settings.riotId)}&platform=${S.settings.platform}`);
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) { st.className = 'status err'; st.textContent = j.error === 'account_not_found' ? 'Compte introuvable : vérifie le Riot ID et le serveur.' : "Pas de partie en cours pour l'instant. Réessaie une fois le chargement terminé."; return; }
    if (!r.ok) { st.className = 'status err'; st.textContent = r.status === 401 || r.status === 403 ? 'Clé Riot refusée ou expirée : mets à jour la clé dans le relais Cloudflare.' : 'Erreur du relais (' + r.status + ').'; return; }
    const g = j.game, puuid = j.puuid;
    const P = g.participants.map(p => ({ id: S.byKey[String(p.championId)], team: p.teamId, spells: [p.spell1Id, p.spell2Id], puuid: p.puuid }));
    const meP = P.find(p => p.puuid === puuid) || P[0];
    const mine = P.filter(p => p.team === meP.team && p !== meP), theirs = P.filter(p => p.team !== meP.team);
    S.match.me = meP.id; S.match.side = meP.team === 100 ? 'blue' : 'red';
    const aR = assignRoles(mine.filter(p => p.id), ROLES_ALLY), eR = assignRoles(theirs.filter(p => p.id), ROLES_ENEMY);
    S.match.ally = Object.assign({ top: null, jungle: null, mid: null, adc: null }, aR);
    S.match.enemy = Object.assign({ top: null, jungle: null, mid: null, adc: null, support: null }, eR);
    if (!S.settings.pool.includes(meP.id) && S.meta.supports[meP.id] == null) { /* champion hors pool, ok */ }
    S.bought = { ids: [] }; LS.set('bought', S.bought);
    const len = Number(g.gameLength) || 0;
    if (len > 0) { await startClock(len); }
    save(); renderAll();
    st.className = 'status ok'; st.textContent = `✓ ${cname(meP.id)} · côté ${S.match.side === 'blue' ? 'bleu' : 'rouge'}${len > 0 ? ' · chrono ' + fmt(len) : ''}`;
  } catch (e) { st.className = 'status err'; st.textContent = 'Relais injoignable : vérifie son adresse dans les Réglages.'; }
}

/* ---------------- Sélecteur de champion ---------------- */
let PK = null;
function openPicker(opts) {
  PK = Object.assign({ multi: false, selected: [], prefer: null }, opts);
  $('#pickTitle').textContent = PK.title; $('#pickSearch').value = ''; $('#pickNone').hidden = PK.multi;
  $('#picker').hidden = false; renderPicker();
  setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) $('#pickSearch').focus(); }, 50);
}
function renderPicker() {
  const q = norm($('#pickSearch').value);
  let list = Object.values(S.champs);
  if (!list.length) { $('#pickGrid').innerHTML = '<p class="empty">Liste des champions indisponible (pas de connexion ?).</p>'; return; }
  const pref = PK.prefer;
  const rank = c => pref === 'support' ? (S.meta.supports[c.id] ? 0 : c.tags.includes('Support') ? 1 : 2) : pref === 'adc' ? (S.meta.adcs[c.id] ? 0 : 1) : pref === 'jungle' ? (S.meta.junglers[c.id] ? 0 : 1) : 0;
  list = list.filter(c => !q || norm(c.name).includes(q) || norm(c.id).includes(q)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
  $('#pickGrid').innerHTML = list.map(c => `<button class="pick ${PK.selected.includes(c.id) ? 'on' : ''}" data-id="${c.id}"><img src="${cimg(c.id)}" alt="" loading="lazy"><span>${esc(c.name)}</span></button>`).join('');
}
$('#pickGrid').addEventListener('click', e => {
  const b = e.target.closest('.pick'); if (!b) return; const id = b.dataset.id;
  if (PK.multi) { const i = PK.selected.indexOf(id); i >= 0 ? PK.selected.splice(i, 1) : PK.selected.push(id); b.classList.toggle('on'); PK.onPick(PK.selected.slice()); }
  else { PK.onPick(id); closePicker(); }
});
$('#pickSearch').addEventListener('input', renderPicker);
$('#pickSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('#pickGrid .pick'); if (f) f.click(); } });
$('#pickClose').onclick = () => closePicker();
$('#pickNone').onclick = () => { PK.onPick(null); closePicker(); };
$('#picker').addEventListener('click', e => { if (e.target.id === 'picker') closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#picker').hidden) closePicker(); });
function closePicker() { $('#picker').hidden = true; PK = null; save(); renderAll(); }

function editSlot(path) {
  if (path === 'me') {
    return openPicker({ title: 'Ton support', prefer: 'support', selected: [S.match.me].filter(Boolean), onPick: id => { S.match.me = id; } });
  }
  const [side, role] = path.split('.');
  openPicker({ title: `${side === 'ally' ? 'Allié' : 'Adversaire'} · ${ROLE_FR[role]}`, prefer: role, selected: [S.match[side][role]].filter(Boolean), onPick: id => { S.match[side][role] = id; } });
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-slot]'); if (s) return editSlot(s.dataset.slot);
  const pm = e.target.closest('[data-pickme]'); if (pm) { S.match.me = pm.dataset.pickme; save(); renderAll(); toast(`${cname(S.match.me)} choisi`); return; }
  const a = e.target.closest('[data-act="pool"]'); if (a) return editPool();
});
function editPool() { openPicker({ title: 'Mon pool (touche pour ajouter / retirer)', multi: true, prefer: 'support', selected: S.settings.pool.slice(), onPick: sel => { S.settings.pool = sel; save(); } }); }

/* ---------------- Réglages ---------------- */
function renderSettings() {
  $('#poolView').innerHTML = S.settings.pool.length ? S.settings.pool.map(id => `<div class="pick on" style="cursor:default">${cimg(id) ? `<img src="${cimg(id)}" alt="">` : ''}<span>${esc(cname(id))}</span></div>`).join('') : '<p class="note">Aucun champion pour l\'instant.</p>';
  $('#riotId').value = S.settings.riotId || ''; $('#platform').value = S.settings.platform;
  $('#optSound').checked = S.settings.sound; $('#optVibrate').checked = S.settings.vibrate; $('#optNotif').checked = S.settings.notif; $('#optLead').value = String(S.settings.lead);
  const live = gamePatch(S.version);
  $('#metaInfo').innerHTML = `Patch en jeu : <b>${esc(live || 'inconnu')}</b> (Data Dragon ${esc(S.version || '?')}). Données méta : patch <b>${esc(S.meta.patch)}</b>, mises à jour le ${esc(S.meta.updated || '?')}.` + (live && live !== S.meta.patch ? `<br><span style="color:var(--warn)">Nouveau patch détecté : les champions et objets sont déjà à jour, les tiers et timings le seront à la prochaine mise à jour des données.</span>` : '');
  $('#metaSources').innerHTML = 'Sources : ' + (S.meta.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ');
}
$('#editPool').onclick = editPool;
$('#riotId').addEventListener('change', e => { S.settings.riotId = e.target.value.trim(); save(); renderBuild(); });
$('#platform').addEventListener('change', e => { S.settings.platform = e.target.value; save(); renderBuild(); });
$('#optSound').addEventListener('change', e => { S.settings.sound = e.target.checked; save(); });
$('#optVibrate').addEventListener('change', e => { S.settings.vibrate = e.target.checked; save(); });
$('#optNotif').addEventListener('change', e => { S.settings.notif = e.target.checked; save(); if (e.target.checked && 'Notification' in window) Notification.requestPermission().catch(() => { }); });
$('#optLead').addEventListener('change', e => { S.settings.lead = Number(e.target.value); save(); renderTimeline(); });
$('#refreshMeta').onclick = async () => { toast('Rechargement…'); await loadMeta(true); await loadDD(true); renderAll(); toast('Données à jour'); };

/* ---------------- Navigation et actions ---------------- */
const GAME_TABS = ['draft', 'game', 'bot', 'time'];
function show(v) {
  S.view = v; if (GAME_TABS.includes(v)) LS.set('view', v);
  $$('section.view[id^="v-"]').forEach(s => s.hidden = s.id !== 'v-' + v);
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === v)));
  $('nav.tabs').hidden = !GAME_TABS.includes(v);
  $('#btnHome').hidden = v === 'home';
  document.body.classList.toggle('in-game', GAME_TABS.includes(v));
  if (v === 'time') renderTimeline();
  if (v === 'home') { const a = $('#homeAcc'); if (a) a.textContent = S.settings.riotId ? 'Compte : ' + S.settings.riotId : 'Ajoute ton Riot ID dans les Réglages.'; }
  if (v === 'analyse' && typeof renderAnalyse === 'function') { renderAnalyse(); if (Date.now() - AN.updated > 10 * 60000) loadAnalyse(false); }
  window.scrollTo(0, 0);
}
$$('nav.tabs button').forEach(b => b.onclick = () => show(b.dataset.v));
$$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
$('#btnHome').onclick = () => show('home');
$('#btnAnalyse').onclick = () => loadAnalyse(false);
$('#btnLive').onclick = loadLive;
$('#clearDraft').onclick = () => { const me = S.match.me, side = S.match.side; S.match = defMatch(); S.match.me = me; S.match.side = side; S.kills = { drakes: [], soul: null }; S.bought = { ids: [] }; LS.set('bought', S.bought); save(); renderAll(); };
$('#btnStart').onclick = () => { S.kills = { drakes: [], soul: null }; startClock(0); toast('Chrono lancé, garde l\'app ouverte'); };
$('#btnPlus').onclick = () => { if (S.timer.start) { S.timer.start -= 10000; save(); markPastFired(); renderTimeline(); } };
$('#btnMinus').onclick = () => { if (S.timer.start) { S.timer.start += 10000; save(); markPastFired(); renderTimeline(); } };
$('#btnStop').onclick = () => { S.timer.start = null; save(); try { wakeLock && wakeLock.release(); } catch (e) { } renderTimeline(); };
$('#btnDrake').onclick = () => { const t = now(); if (t == null) return toast('Lance d\'abord le chrono'); S.kills.drakes.push(Math.round(t)); save(); renderTimeline(); toast('Prochain drake à ' + fmt(t + S.meta.timers.dragonRespawn)); };
$('#btnSoul').onclick = () => { const t = now(); if (t == null) return toast('Lance d\'abord le chrono'); S.kills.soul = Math.round(t); save(); renderTimeline(); toast('Ancien à ' + fmt(t + S.meta.timers.elderAfterSoul)); };
$$('.seg [data-side]').forEach(b => b.onclick = () => { S.match.side = b.dataset.side; save(); renderTimeline(); });
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }

function renderAll() {
  const live = gamePatch(S.version), b = $('#patchBadge');
  b.textContent = 'Patch ' + (live || S.meta.patch); b.classList.toggle('stale', !!(live && live !== S.meta.patch));
  b.title = live && live !== S.meta.patch ? `Données méta du patch ${S.meta.patch}` : 'Données à jour';
  renderSlots(); renderRanking(); renderBuild(); renderBot(); renderSettings();
  if (S.view === 'time') renderTimeline();
}

(async function init() {
  await loadMeta(false);
  renderAll();
  show('home');
  await loadDD(false);
  renderAll();
  if (S.timer.start) markPastFired();
  setInterval(() => tick(false), 500);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
