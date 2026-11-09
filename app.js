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

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
const ROLES_ENEMY = ROLES;
const ROLE_FR = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' };
const ROLE_LONG = { top: 'toplaner', jungle: 'jungler', mid: 'midlaner', adc: 'ADC', support: 'support' };
const POS = { top: 'TOP', jungle: 'JUNGLE', mid: 'MIDDLE', adc: 'BOTTOM', support: 'UTILITY' };
const LANE_TAB = { top: 'Lane', jungle: 'Jungle', mid: 'Lane', adc: 'Botlane', support: 'Botlane' };
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

const defMatch = () => ({ ally: { top: null, jungle: null, mid: null, adc: null, support: null }, enemy: { top: null, jungle: null, mid: null, adc: null, support: null }, me: null, side: 'blue' });
const S = {
  settings: Object.assign({ role: null, pools: {}, pool: [], riotId: 'Nanileb#1996', platform: 'euw1', proxy: '', sound: true, vibrate: true, notif: false, lead: 15 }, LS.get('settings', {})),
  match: (() => { const m = Object.assign(defMatch(), LS.get('match', {})); const d = defMatch(); m.ally = Object.assign(d.ally, m.ally); m.enemy = Object.assign(d.enemy, m.enemy); return m; })(),
  timer: LS.get('timer', { start: null }),
  bought: LS.get('bought', { ids: [] }),
  kills: LS.get('kills', { drakes: [], soul: null }),
  meta: null, champs: {}, byKey: {}, version: null, items: null, fired: {}, view: 'draft'
};
if (S.settings.pool && S.settings.pool.length && !(S.settings.pools || {}).support) S.settings.pools = Object.assign({}, S.settings.pools, { support: S.settings.pool });
S.settings.pools = S.settings.pools || {};
const myRole = () => S.settings.role || 'support';
const allyRoles = () => ROLES.filter(r => r !== myRole());
const myPool = () => S.settings.pools[myRole()] || [];
const save = () => { LS.set('settings', S.settings); LS.set('match', S.match); LS.set('timer', S.timer); LS.set('kills', S.kills); };

/* ---------------- Chargement des données ---------------- */
async function getJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }

async function loadMeta(force) {
  try {
    S.meta = await getJSON('meta.json' + (force ? '?t=' + Date.now() : ''), { cache: force ? 'reload' : 'default' });
    LS.set('meta', S.meta);
  } catch (e) { S.meta = LS.get('meta', null); }
  if (!S.meta) S.meta = { patch: '?', tiers: {}, winrates: {}, supports: {}, adcs: {}, pairs: {}, counters: {}, engagers: [], frontline: [], healers: [], assassins: [], hookers: [], junglers: {}, timers: { dragon: 300, dragonRespawn: 300, platesDecay: 660, laneEnd: 840, grubs: 480, grubsDespawn: 885, herald: 900, baron: 1200, elderAfterSoul: 360, scuttle: 175 }, supportRules: [], items: { start: [], boots: {}, core: {}, situational: {}, upgrades: {}, names: {} }, keystones: {}, sources: [] };
}

async function loadDD(force) {
  try {
    const versions = await getJSON(DD + '/api/versions.json', { cache: 'no-cache' });
    S.version = versions[0];
    const cached = LS.get('dd6', null);
    if (!force && cached && cached.v === S.version) { S.champs = cached.champs; S.items = cached.items; S.runes = cached.runes || {}; S.sums = cached.sums || {}; }
    else {
      const [c, it, ru, su] = await Promise.all([
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/champion.json`),
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/item.json`).catch(() => null),
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/runesReforged.json`).catch(() => []),
        getJSON(`${DD}/cdn/${S.version}/data/fr_FR/summoner.json`).catch(() => ({ data: {} }))
      ]);
      S.runes = {}; (ru || []).forEach(st => { S.runes[st.id] = { name: st.name, icon: st.icon }; st.slots.forEach(sl => sl.runes.forEach(r => S.runes[r.id] = { name: r.name, icon: r.icon })); });
      S.sums = {}; Object.values(su.data || {}).forEach(x => S.sums[x.key] = { name: x.name, img: x.image.full });
      S.champs = {};
      for (const [id, ch] of Object.entries(c.data)) S.champs[id] = { id, key: ch.key, name: ch.name, tags: ch.tags, info: ch.info, img: ch.image.full, range: (ch.stats || {}).attackrange || 0 };
      S.items = null;
      if (it) { S.items = {}; for (const [iid, x] of Object.entries(it.data)) { const st = x.stats || {}, d = x.description || '';
        S.items[iid] = { name: x.name, gold: x.gold && x.gold.total, base: x.gold && x.gold.base, from: x.from || [], tags: x.tags || [],
          arm: st.FlatArmorMod > 0 ? 1 : 0, mr: st.FlatSpellBlockMod > 0 ? 1 : 0, gw: /Hémorragie/.test(d) ? 1 : 0, pen: /pénétration (d'armure|magique)|PV max/i.test(d) ? 1 : 0, ten: /ténacité/i.test(d) ? 1 : 0 }; } }
      LS.set('dd6', { v: S.version, champs: S.champs, items: S.items, runes: S.runes, sums: S.sums });
    }
  } catch (e) {
    const cached = LS.get('dd6', null);
    if (cached) { S.version = cached.v; S.champs = cached.champs; S.items = cached.items; S.runes = cached.runes || {}; S.sums = cached.sums || {}; }
  }
  S.byKey = {};
  for (const ch of Object.values(S.champs)) S.byKey[ch.key] = ch.id;
}

async function loadBuilds() {
  try { S.builds = await getJSON('builds.json', { cache: 'no-cache' }); LS.set('builds', S.builds); }
  catch (e) { S.builds = LS.get('builds', null); }
}
const BUILD = (id, role) => (S.builds && S.builds.builds && S.builds.builds[id + '|' + POS[role || myRole()]]) || null;
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
// Type de dégâts réel (pour l'AP/AD de la compo). Les tanks qui frappent en magique comptent AP.
const MAGIC_TANKS = ['Galio', 'Maokai', 'Amumu', 'Zac', 'Malphite', 'Sejuani', 'Rell', 'Nautilus', 'Leona', 'Alistar', 'Rammus', 'Nunu', 'Gragas', 'Chogath', 'Braum', 'Taric', 'Poppy', 'Ornn', 'TahmKench', 'Skarner', 'Zyra'];
const PHYS_TANKS = ['Sion', 'KSante', 'Thresh', 'Blitzcrank', 'Pyke'];
function isAP(id) {
  if (MAGIC_TANKS.includes(id)) return true; if (PHYS_TANKS.includes(id)) return false;
  const p = S.meta.supports[id]; if (p && p.dmg === 'ap') return true; if (p && p.dmg === 'ad') return false;
  const i = (champ(id) && champ(id).info) || {}; return (i.magic || 0) > (i.attack || 0);
}
const inList = (list, id) => (S.meta[list] || []).includes(id);
const isEngager = id => inList('engagers', id) || (S.meta.supports[id] && S.meta.supports[id].engage >= 3);
const isFront = id => inList('frontline', id) || tags(id).includes('Tank');
// Champions déjà pris dans la partie (sauf la case qu'on modifie), avec le camp qui l'a pris
function takenChamps(exceptPath) {
  const m = S.match, T = {};
  if (m.me && exceptPath !== 'me') T[m.me] = 'toi';
  ROLES.forEach(r => { const a = m.ally[r], e = m.enemy[r];
    if (a && exceptPath !== 'ally.' + r) T[a] = T[a] || 'allié';
    if (e && exceptPath !== 'enemy.' + r) T[e] = 'adversaire'; });
  return T;
}
const allies = () => allyRoles().map(r => S.match.ally[r]).filter(Boolean);
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
  const m = S.match, role = myRole();
  $('#allySlots').innerHTML = allyRoles().map(r => slotHTML(m.ally[r], ROLE_FR[r], 'ally.' + r)).join('') + slotHTML(m.me, 'Toi', 'me', 'me');
  const en = ROLES_ENEMY.map(r => slotHTML(m.enemy[r], ROLE_FR[r], 'enemy.' + r)).join('');
  $('#enemySlotsDraft').innerHTML = en; $('#enemySlotsGame').innerHTML = en;
  const me = slotHTML(m.me, 'Toi', 'me', 'me');
  if (role === 'support') { $('#botAlly').innerHTML = slotHTML(m.ally.adc, 'ADC', 'ally.adc') + me; $('#botEnemy').innerHTML = slotHTML(m.enemy.adc, 'ADC', 'enemy.adc') + slotHTML(m.enemy.support, 'Support', 'enemy.support'); }
  else if (role === 'adc') { $('#botAlly').innerHTML = me + slotHTML(m.ally.support, 'Support', 'ally.support'); $('#botEnemy').innerHTML = slotHTML(m.enemy.adc, 'ADC', 'enemy.adc') + slotHTML(m.enemy.support, 'Support', 'enemy.support'); }
  else { $('#botAlly').innerHTML = me; $('#botEnemy').innerHTML = slotHTML(m.enemy[role], ROLE_FR[role], 'enemy.' + role); }
}

// Classement d'un champion pour un poste autre que support : données haut niveau + compo.
// Taux de victoire ramené vers 50 % quand il y a peu de parties (évite qu'un 39 % sur 50 parties pèse trop)
const shrink = (wr, n, k, prior = 50) => Math.round(((wr * n) + prior * k) / (n + k) * 10) / 10;
// Classement par taux de victoire estimé : WR du champion chez les Challenger / GM, corrigé avec chaque allié et chaque adversaire.
// Chaque écart est ramené vers le WR du champion quand il y a peu de parties (k), et plafonné.
const ARMOR_TANKS = ['Malphite', 'Rammus', 'KSante', 'Ornn', 'Leona', 'Sion', 'Poppy', 'Shen', 'Braum', 'Nautilus', 'Alistar', 'Sejuani', 'Zac', 'Galio'];
const BLIND_SAFE = { top: ['KSante', 'Gnar', 'Malphite', 'Ornn', 'Jax', 'Sion'], jungle: ['JarvanIV', 'Vi', 'Sejuani', 'Maokai'], mid: ['Orianna', 'Ahri', 'Galio', 'Taliyah', 'Syndra'], adc: ['Ezreal', 'Jhin', 'Caitlyn', 'Varus'], support: ['Nautilus', 'Rakan', 'Karma', 'Braum', 'Bard'] };
const COUNTERABLE = { top: ['Olaf', 'Renekton', 'Darius', 'Garen', 'Teemo', 'Vayne', 'Nasus'], jungle: ['Nidalee', 'Evelynn', 'Shaco'], mid: ['Kassadin', 'Veigar', 'Lux', 'Xerath', 'Zed'], adc: ['Draven', 'Samira', 'Twitch', 'Nilah'], support: ['Yuumi', 'Sona', 'Soraka', 'Pyke'] };
function scoreRole(id) {
  const role = myRole(), m = S.match, R = [], b = BUILD(id);
  const t = tags(id).map(x => ({ Fighter: 'Combattant', Tank: 'Tank', Mage: 'Mage', Assassin: 'Assassin', Marksman: 'Tireur', Support: 'Support' })[x] || x).slice(0, 2).join(' / ');
  if (!b) return role === 'support' ? scoreSupport(id) : { id, score: 50, reasons: ['pas assez de parties Challenger sur ce champion à ce poste'], tier: null, label: t, n: 0, est: false };
  const base = shrink(b.wr, b.n, 300);
  let s = base; const parts = [];
  const add = (v, txt) => { v = Math.max(-4, Math.min(4, v)); if (Math.abs(v) < 0.5) return; s += v; parts.push([v, txt]); };
  const find = (list, c) => (list || []).find(x => x[0] === c && x[1] >= 20);
  const pairDelta = (e, prior) => shrink(e[2], e[1], 100, prior) - prior; // écart par rapport au WR habituel
  // alliés
  ROLES.filter(r => r !== role).forEach(r => {
    const a = m.ally[r]; if (!a) return;
    const e = ((role === 'adc' && r === 'support') || (role === 'support' && r === 'adc')) ? (find(b.duo, a) || find(b.with, a)) : find(b.with, a);
    if (e) add(pairDelta(e, b.wr), `${e[2]} % avec ${cname(a)} au lieu de ${b.wr} % (${e[1]} parties)`);
    else { const ab = BUILD(a, r), e2 = ab && find(ab.with, id); if (e2) add(pairDelta(e2, ab.wr), `${e2[2]} % quand ${cname(a)} joue avec lui (${e2[1]} parties)`); }
  });
  // adversaires : duel direct d'abord, puis le reste de l'équipe
  ROLES.forEach(r => {
    const e = m.enemy[r]; if (!e) return;
    const direct = r === role, x = (direct && find(b.opp, e)) || find(b.vsAll, e);
    if (x) add(pairDelta(x, b.wr) * (direct ? 1.3 : 1), `${x[2]} % contre ${cname(e)}${direct ? ' (duel)' : ''} au lieu de ${b.wr} % (${x[1]} parties)`);
    else { const eb = BUILD(e, r), y = eb && (find(direct ? eb.opp : null, id) || find(eb.vsAll, id)); if (y) add((eb.wr - shrink(y[2], y[1], 100, eb.wr)) * (direct ? 1.3 : 1), `${100 - y[2]} % contre ${cname(e)}${direct ? ' (duel)' : ''} (${y[1]} parties)`); }
  });
  // besoins de compo : ce qui manque à ton équipe et ce qui répond à la leur
  const need = (v, txt) => { s += v; parts.push([v, txt]); };
  const al = allies(), en = enemies(), T = tags(id), tanky = T.includes('Tank') || isFront(id);
  if (al.length >= 2) {
    const ap = al.filter(isAP).length;
    if (ap === 0 && isAP(id)) need(4, 'apporte des dégâts magiques (équipe full AD)');
    if (ap >= 3 && !isAP(id)) need(4, 'apporte des dégâts physiques (équipe très AP)');
    if (!al.some(isFront) && tanky) need(T[0] === 'Tank' ? 4 : 2, "ton équipe n'a pas de frontline");
    if (!al.some(isEngager) && isEngager(id)) need(3, "ton équipe n'a pas d'engage");
  }
  if (en.length >= 3) {
    const ead = en.filter(e => !isAP(e)).length, eap = en.length - ead;
    if (ead >= 4 && ARMOR_TANKS.includes(id)) need(3, `résiste bien à leur équipe très AD (${ead} AD)`);
    if (eap >= 4 && ['Galio', 'Kassadin', 'Mordekaiser', 'Gragas', 'Maokai', 'Braum'].includes(id)) need(3, `résiste bien à leur équipe très AP (${eap} AP)`);
    if (en.filter(e => inList('assassins', e)).length >= 2 && (isEngager(id) || (S.meta.supports[id] || {}).peel >= 3)) need(2, 'plusieurs plongeurs en face : il faut du contrôle / du peel');
  }
  // pick à l'aveugle : ton adversaire direct n'est pas encore choisi
  const directOpen = role === 'adc' || role === 'support' ? !m.enemy.adc && !m.enemy.support : !m.enemy[role];
  if (directOpen && (en.length || al.length)) {
    if ((BLIND_SAFE[role] || []).includes(id)) need(2, 'pick sûr à l\'aveugle (ton adversaire n\'est pas encore choisi)');
    if ((COUNTERABLE[role] || []).includes(id)) { need(-3, 'risque de contre-pick : ton adversaire choisit après toi'); R.blind = true; }
  }
  parts.sort((a, b2) => Math.abs(b2[0]) - Math.abs(a[0]));
  R.push(`${b.wr} % de victoires en Challenger (${b.n} parties)`);
  parts.forEach(([v, txt]) => R.push(`${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pt · ${txt}`));
  return { id, score: Math.round(50 + 8 * Math.tanh((s - 50) / 8)), reasons: R, tier: null, label: t, n: b.n, est: true, blind: !!R.blind };
}

function renderRanking() {
  const role = myRole(), pool = myPool().filter(id => champ(id) || !Object.keys(S.champs).length);
  const box = $('#ranking');
  $('#draftTitle').textContent = `Quel ${ROLE_LONG[role]} jouer\u00a0?`;
  { const n = $('#scoreNote'); if (n) n.textContent = '% = taux de victoire estimé : celui du champion chez les Challenger / GM de ce patch, corrigé avec chacun de tes alliés et contre chaque adversaire (le duel direct compte plus). Peu de parties = correction plus faible. Les champions déjà pris sont grisés.'; }
  if (!pool.length) {
    box.innerHTML = `<div class="empty">Ton pool ${ROLE_FR[role]} est vide. Choisis tes champions une fois, ils restent enregistrés.<br><br>
      <button class="btn primary" data-act="pool">Choisir mon pool</button></div>`;
    return;
  }
  const T = takenChamps('me');
  const res = pool.filter(id => !T[id]).map(scoreRole).sort((a, b) => b.score - a.score);
  const gone = pool.filter(id => T[id]);
  const hasInfo = allies().length || enemies().length;
  const noData = role !== 'support' && !(S.builds && S.builds.builds);
  box.innerHTML = (noData ? `<p class="note">Les résultats des meilleurs joueurs ne sont pas encore arrivés : le classement ne tient compte pour l'instant que de ta compo. Il se met à jour tout seul dès qu'ils sont prêts.</p>` : hasInfo ? '' : `<p class="note">Ajoute tes alliés et ton adversaire direct pour un vrai classement. En attendant : résultats des meilleurs joueurs seuls.</p>`) +
    res.map((r, i) => `<div class="ritem ${i === 0 && hasInfo ? 'top1' : ''}">
      ${cimg(r.id) ? `<img src="${cimg(r.id)}" alt="">` : '<span class="ph"></span>'}
      <div style="min-width:0"><div class="nm">${esc(cname(r.id))}${r.tier ? `<span class="tier">${r.tier}</span>` : ''}${r.blind ? '<em class="vs-tag">risque de contre-pick</em>' : ''}</div>
        <div class="why">${esc(r.arch ? ARCH_FR[r.arch] : r.label)}${(r.est ? r.reasons[1] || r.reasons[0] : r.reasons[0]) ? ' · ' + esc(r.est ? r.reasons[1] || r.reasons[0] : r.reasons[0]) : ''}</div>
        <div class="bar"><i style="width:${r.est ? Math.max(4, (r.score - 42) * 6) : r.score}%"></i></div>
        ${r.reasons.length > 1 ? `<details class="why-more"><summary>Détail du score</summary><ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div><div class="pct num">${r.score}%</div>${r.est ? '<div class="note" style="font-size:11px;text-align:center">victoire estimée</div>' : ''}<button class="btn small" data-pickme="${r.id}" style="margin-top:6px">${S.match.me === r.id ? 'Choisi' : 'Jouer'}</button></div>
    </div>`).join('') +
    gone.map(id => `<div class="ritem taken">${cimg(id) ? `<img src="${cimg(id)}" alt="">` : '<span class="ph"></span>'}<div style="min-width:0"><div class="nm">${esc(cname(id))}</div><div class="why">Déjà pris par ${T[id] === 'adversaire' ? 'l\'adversaire' : 'un allié'}</div></div><div></div></div>`).join('');
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
function renderBuildSupportLegacy() {
  const out = $('#buildOut'), me = S.match.me;
  const opgg = { euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', tr1: 'tr', br1: 'br', la1: 'lan', la2: 'las', jp1: 'jp', oc1: 'oce', me1: 'me' }[S.settings.platform] || 'euw';
  const rid = (S.settings.riotId || '').replace('#', '-');
  $('#opggLink').href = `https://op.gg/lol/summoners/${opgg}/${encodeURIComponent(rid)}/ingame`;
  const A = analyzeEnemies();
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
  window._why = seq; const steps = planBuys(order.filter(Boolean), { start: [3865, 2003, 2003], boots: boots, support: true });
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
      <div class="note">Pas encore assez de parties Challenger sur ${esc(cname(me))} support : build par profil de champion.</div>
      <div><b>Chaque retour :</b> 1 pink${upId && itemExists(upId) ? ` · <b>Ward finale :</b> ${esc(iname(upId))}` : ''}</div>
      ${vs ? `<div class="bp-vs"><b>Contre eux :</b> ${vs}</div>` : ''}
      <div><b>Runes :</b> ${esc((S.meta.keystones || {})[arch] || '')} · ${esc(sums)}</div>
      ${A.n ? '' : '<div class="note">Ajoute l\'équipe adverse (plus bas) pour adapter les objets.</div>'}
    </div>`;
}
const FLAG_FR = { ap: 'équipe AP', ad: 'équipe très AD', heal: 'beaucoup de soins', tank: 'beaucoup de tanks', cc: 'beaucoup de contrôles', assassin: 'assassins / plongeurs' };
// Objets « contre eux » de secours, retenus seulement s'ils se jouent sur le champion
const FALLBACK = { ap: [3102, 3156, 4401, 8020, 2504, 6665, 3157], ad: [3157, 6333, 6673, 3143, 3075, 3110, 3047], heal: [3123, 3033, 6609, 3916, 3165, 3076, 3011], tank: [3036, 3135, 8010, 6653, 3153, 3071, 6694], cc: [3111, 3139, 3222, 2504, 3102], assassin: [3157, 6333, 6673, 3156, 3102, 3190] };
// Un objet n'est conseillé « contre » une menace que s'il la contre vraiment (stats / effets officiels de l'objet)
const FIT_EXTRA = { tank: ['3071', '3153', '6653', '3302'], ad: ['6673', '3814'], ap: ['3157', '3814'], assassin: ['3157', '6673', '3814'], cc: ['3139', '3222', '3140'] };
function fitsFlag(id, fl) {
  id = String(id); const it = S.items && S.items[id]; if (!it) return false;
  const k = { apBurst: 'assassin', adBurst: 'assassin', autos: 'ad' }[fl] || fl;
  if (k !== 'assassin' && (FIT_EXTRA[k] || []).includes(id)) return true;
  if (it.arm == null) return true; // ancien cache sans ces infos
  if (k === 'heal') return !!it.gw;
  if (k === 'tank') return !!it.pen;
  if (k === 'ad') return !!it.arm;
  if (k === 'ap') return !!it.mr;
  if (k === 'assassin') return fl === 'adBurst' ? !!it.arm || ['3157', '6673', '3814'].includes(id) : fl === 'apBurst' ? !!it.mr || ['3157', '3814'].includes(id) : !!(it.arm || it.mr);
  if (k === 'cc') return !!it.ten;
  return false;
}
const ROLE_START = { support: ['3865'] };
function enemyFlags(A) { return A.n ? { ap: A.ap >= 3, ad: A.ad >= 4, heal: A.heal.length >= 2, tank: A.front.length >= 3, cc: A.eng.length >= 3, assassin: A.ass.length >= 2 } : {}; }
// Objets qui contrent ton adversaire direct : d'abord ce que les meilleurs joueurs achètent contre lui sur ton champion,
// sinon l'objet de contre classique de sa catégorie, seulement s'il se joue sur ton champion.
const LANE_ITEMS = {
  apBurst: [3157, 3102, 3156, 4401, 2504, 3111], adBurst: [3157, 6333, 6673, 3143, 3047, 3110],
  heal: [3123, 3033, 3916, 3165, 6609, 3076, 3075], tank: [3036, 3135, 6653, 3153, 3071, 6694, 3181],
  ap: [3102, 3156, 4401, 8020, 3111], autos: [3143, 3110, 3075, 3047, 6333]
};
const THREAT_FR = { apBurst: 'assassin AP', adBurst: 'assassin AD', heal: 'beaucoup de soins', tank: 'tank', ap: 'dégâts magiques', autos: 'attaques de base' };
const ITEM_TIP = {
  3157: 'Actif : 2,5 s d\'invulnérabilité. Garde-le pour son engage ou son ultime, pas pour un simple trade.',
  3102: 'Son bouclier bloque un sort : fais-le sauter avant de trade, ou garde-le pour son engage.',
  3026: 'Te ressuscite une fois : il rate souvent son kill et toi tu restes dans le combat.',
  6333: 'Étale les dégâts physiques reçus : son burst ne te tue plus d\'un coup.',
  6673: 'Bouclier automatique quand tu passes en PV bas : il casse son burst.',
  3156: 'Bouclier contre les dégâts magiques quand tu passes en PV bas.',
  3123: 'Anti-soins : prends le composant tôt (800 PO), finis l\'objet plus tard.',
  3916: 'Anti-soins : prends le composant tôt (800 PO), finis l\'objet plus tard.',
  3076: 'Anti-soins quand il te frappe : prends-la tôt.',
  3143: 'Réduit les dégâts des coups critiques et ralentit les attaquants.',
  3110: 'Ralentit sa vitesse d\'attaque autour de toi.',
  3075: 'Renvoie des dégâts et applique l\'anti-soins quand il te frappe.'
};
const CHAMP_TIP = {
  Zed: { 3157: 'Contre Zed : active Zhonya juste avant que sa marque (R) explose, environ 3 s après qu\'il l\'a posée. Les dégâts de la marque sont annulés.' },
  Karthus: { 3157: 'Contre Karthus : active Zhonya à la fin de la canalisation de son ultime (3 s) pour l\'esquiver.' }
};
function laneThreats(opp) {
  const T = [], t = tags(opp), ass = inList('assassins', opp) || t.includes('Assassin'), ap = isAP(opp);
  if (ass) T.push(ap ? 'apBurst' : 'adBurst');
  if (inList('healers', opp)) T.push('heal');
  if (isFront(opp)) T.push('tank');
  if (!ass && ap) T.push('ap');
  if (!ass && !ap && (t.includes('Marksman') || t.includes('Fighter'))) T.push('autos');
  return T;
}
function laneCounter(b, opp, skip) {
  // seulement en vrai duel : top, mid, support (en ADC / jungle le pic de dégâts passe d'abord)
  if (!b || !opp || !['top', 'mid', 'support'].includes(myRole())) return [];
  const isB = id => S.items && S.items[id] && (S.items[id].tags || []).includes('Boots');
  const inPool = id => (b.pool || []).some(x => x[0] === String(id));
  const res = [], ok = id => itemExists(id) && !isB(id) && !(skip || []).includes(id) && !res.find(x => x.id === id);
  const tip = id => (CHAMP_TIP[opp] || {})[id] || ITEM_TIP[id] || '';
  const TH = laneThreats(opp);
  ((b.lane || {})[opp] || []).forEach(x => { if (ok(x[0]) && TH.some(t => fitsFlag(x[0], t))) res.push({ id: x[0], data: 1, why: `${x[1]} % des meilleurs joueurs le prennent contre ${cname(opp)} (${x[3]} parties)`, tip: tip(x[0]) }); });
  if (!res.length) for (const th of laneThreats(opp)) {
    const id = LANE_ITEMS[th].map(String).find(i => ok(i) && inPool(i));
    if (id && fitsFlag(id, th)) { res.push({ id, data: 0, why: `${THREAT_FR[th]} : objet de contre classique, joué sur ${cname(S.match.me)} par les meilleurs joueurs`, tip: tip(id) }); break; }
  }
  return res.slice(0, 2);
}
function renderBuild() {
  const out = $('#buildOut'), me = S.match.me, role = myRole();
  const opgg = { euw1: 'euw', eun1: 'eune', na1: 'na', kr: 'kr', tr1: 'tr', br1: 'br', la1: 'lan', la2: 'las', jp1: 'jp', oc1: 'oce', me1: 'me' }[S.settings.platform] || 'euw';
  const rid = (S.settings.riotId || '').replace('#', '-');
  $('#opggLink').href = `https://op.gg/lol/summoners/${opgg}/${encodeURIComponent(rid)}/ingame`;
  const b = me && BUILD(me);
  $('#meRow').innerHTML = me
    ? `${slotHTML(me, 'Toi', 'me', 'me')}<div class="grow"><b>${esc(cname(me))}</b><div class="note">${esc(ROLE_FR[role])}${b ? ` · ${b.wr} % de victoires en Challenger` : ''}</div></div>`
    : `<div class="empty grow">Choisis ton champion (onglet Draft ou ici).</div>${slotHTML(null, 'Toi', 'me', 'me')}`;
  const A = analyzeEnemies(), F = enemyFlags(A);
  const chips = [];
  if (A.n) {
    chips.push(`<span class="chip ${A.ap >= 3 ? 'warn' : ''}">${A.ap} AP / ${A.ad} AD</span>`);
    if (F.heal) chips.push(`<span class="chip bad">Soins : ${A.heal.map(cname).join(', ')}</span>`);
    if (F.assassin) chips.push(`<span class="chip bad">Plongeurs : ${A.ass.map(cname).join(', ')}</span>`);
    if (F.cc) chips.push(`<span class="chip warn">Beaucoup de CC / engage</span>`);
    if (F.tank) chips.push(`<span class="chip warn">${A.front.length} tanks / frontline</span>`);
    if (A.crit) chips.push(`<span class="chip warn">ADC à crit</span>`);
  }
  $('#threats').innerHTML = chips.join('');
  if (!me) { out.innerHTML = '<p class="note">Le build apparaît dès que ton champion est choisi.</p>'; return; }
  if (!b) {
    if (role === 'support') return renderBuildSupportLegacy();
    out.innerHTML = `<p class="note">${S.builds ? `Pas assez de parties Challenger sur ${esc(cname(me))} en ${ROLE_FR[role]} cette semaine pour un build fiable.` : 'Les builds des meilleurs joueurs sont en cours de calcul, reviens dans un moment.'}</p>`;
    return;
  }
  const isB = id => S.items && S.items[id] && (S.items[id].tags || []).includes('Boots') && id !== '1001';
  const inPool = id => (b.pool || []).some(x => x[0] === String(id));
  // bottes : celles des meilleurs joueurs, adaptées à la compo si ils les achètent aussi sur ce champion
  const bl = (b.boots || []).filter(x => itemExists(x[0]));
  let boots = bl[0] && bl[0][1] >= 15 ? bl[0][0] : null, bootsWhy = boots ? `${bl[0][1]} % des meilleurs joueurs` : '';
  const has = id => bl.some(x => x[0] === String(id) && x[1] >= 5);
  if (boots && F.ad && has(3047) && boots !== '3047') { boots = '3047'; bootsWhy = 'équipe très AD'; }
  else if (boots && (F.cc || F.ap) && has(3111) && boots !== '3111') { boots = '3111'; bootsWhy = F.cc ? 'beaucoup de contrôles' : 'équipe AP'; }
  // objets de base : l'enchaînement le plus joué. Un objet « de situation » (présent dans b.vs) n'entre pas dans la base,
  // et un objet qui contredit la compo (RM sans AP en face, armure sans AD, anti-soins sans soins…) est écarté.
  const it = id => (S.items && S.items[id]) || {};
  const fixed = new Set([...(((b.core[0] || [])[0]) || []), ...((b.first || []).slice(0, 1).map(x => x[0]))].map(String));
  const situational = id => !fixed.has(id) && Object.values(b.vs || {}).some(l => l.some(x => x[0] === id));
  const contradicts = id => {
    if (!A.n) return false; const x = it(id);
    if (x.mr && !x.arm && A.ap < 2) return true;
    if (x.arm && !x.mr && A.ad < 2) return true;
    if (x.gw && !A.heal.length) return true;
    if (id === '3222' && A.eng.length < 3) return true;
    return false;
  };
  const core = [];
  const addC = (id, strict) => { id = String(id); if (id && itemExists(id) && !isB(id) && !core.includes(id) && !(strict && (situational(id) || contradicts(id))) && !(core.length && contradicts(id))) core.push(id); };
  ((b.core[0] || [])[0] || []).forEach(id => addC(id)); (b.first || []).slice(0, 1).forEach(x => addC(x[0])); (b.pool || []).forEach(x => addC(x[0], true));
  // contre eux : objets que les meilleurs joueurs ajoutent face à cette compo
  const sit = [];
  const opp = S.match.enemy[role];
  const assKind = A.ass.length ? (A.ass.filter(isAP).length * 2 > A.ass.length ? 'apBurst' : A.ass.filter(isAP).length * 2 < A.ass.length ? 'adBurst' : 'assassin') : 'assassin';
  const fitF = (id, fl) => fitsFlag(id, fl === 'assassin' ? assKind : fl) && !contradicts(String(id));
  laneCounter(b, opp, core.slice(0, 1)).filter(x => !contradicts(x.id)).forEach(x => sit.push({ id: x.id, fl: 'lane', why: x.why, tag: 'contre ' + cname(opp) }));
  for (const fl of ['heal', 'assassin', 'ap', 'ad', 'tank', 'cc']) {
    if (!F[fl] || sit.length >= 3) continue;
    const data = ((b.vs || {})[fl] || []).filter(x => itemExists(x[0]) && !isB(x[0]) && fitF(x[0], fl) && !sit.find(y => y.id === x[0]));
    if (data.length) { sit.push({ id: data[0][0], fl, why: `${FLAG_FR[fl]} : ${data[0][1]} % des meilleurs joueurs le prennent dans ce cas` }); continue; }
    const fb = FALLBACK[fl].map(String).find(id => itemExists(id) && inPool(id) && fitF(id, fl) && !core.slice(0, 1).includes(id) && !sit.find(y => y.id === id));
    if (fb) sit.push({ id: fb, fl, why: FLAG_FR[fl] });
  }
  const seq = [];
  const addS = (id, why) => { id = String(id); if (id && !seq.find(x => x.id === id)) seq.push({ id, why }); };
  const early = x => x.fl === 'lane' || x.fl === 'heal' || x.fl === 'assassin';
  addS(core[0], `1er objet de ${b.first && b.first[0] && b.first[0][0] === core[0] ? b.first[0][1] + ' % des' : 'nombreux'} meilleurs joueurs`);
  if (role === 'adc') core.slice(1, 2).forEach(id => addS(id, 'objet de base')); // en ADC, le pic de dégâts passe avant la défense
  sit.filter(early).forEach(x => addS(x.id, x.why));
  core.slice(1, 2).forEach(id => addS(id, 'objet de base'));
  sit.filter(x => !early(x)).forEach(x => addS(x.id, x.why));
  core.slice(2).forEach(id => addS(id, 'objet de base'));
  // défense garantie contre une équipe très AD ou très AP : sinon l'objet défensif classique de la catégorie du champion
  const cls = role === 'support' ? ({ enchanter: 'enchanter', mage: 'mage' }[supProfile(me).arch] || 'tank') : tags(me).includes('Tank') ? 'tank' : tags(me).includes('Marksman') ? 'marksman' : tags(me).includes('Mage') ? 'mage' : 'fighter';
  const DEF = {
    ad: { tank: [3110, 3075, 3143], enchanter: [3190, 3110], mage: [3157], marksman: [6673, 6333], fighter: [6333, 3143] },
    ap: { tank: [8020, 2504, 4401], enchanter: [3222, 3190], mage: [3102, 3157], marksman: [3156, 6673], fighter: [3156, 4401] }
  };
  const bootsArm = boots && it(boots).arm, bootsMr = boots && it(boots).mr;
  [['ad', 'arm', 'équipe très AD : il te faut de l\'armure', bootsArm], ['ap', 'mr', 'équipe très AP : il te faut de la résistance magique', bootsMr]].forEach(([k, stat, why, viaBoots]) => {
    if ((k === 'ad' ? A.ad : A.ap) < 4 || viaBoots || seq.slice(0, 4).some(x => it(x.id)[stat])) return;
    const cand = DEF[k][cls].map(String).filter(itemExists);
    const pick = cand.find(inPool) || cand[0];
    if (!pick) return;
    const at = role === 'adc' ? 2 : 1; seq.splice(Math.min(at, seq.length), 0, { id: pick, why });
    sit.push({ id: pick, fl: k, why, tag: 'contre eux' });
  });
  const order = seq.slice(0, 4).map(x => x.id);
  if (boots) order.splice(1, 0, boots);
  window._why = seq.concat(boots ? [{ id: boots, why: 'bottes : ' + bootsWhy }] : []);
  // objets de poste obligatoires mais absents de la timeline Riot (l'Atlas des supports)
  const start = ((b.start || [])[0] || [[]])[0].filter(itemExists);
  (ROLE_START[role] || []).forEach(id => { if (itemExists(id) && !start.includes(id)) start.unshift(id); });
  const steps = planBuys(order, { start, boots, support: role === 'support' });
  const groups = [];
  steps.forEach(st => { let g = groups.find(x => x.name === st.grp); if (!g) groups.push(g = { name: st.grp, items: [] }); g.items.push(st); });
  const tile = st => `<div class="tl-i ${st.kind === 'finish' ? 'fin' : ''}"><img src="${iimg(st.id)}" alt="${esc(iname(st.id))}" loading="lazy">${st.qty > 1 ? `<i class="qty">×${st.qty}</i>` : ''}<span class="num">${st.cost || ''}</span></div>`;
  const label = g => {
    const mm = g.name.match(/^Objet (\d+) : (.*)$/);
    if (mm) { const w = (seq.find(x => iname(x.id) === mm[2]) || {}).why; return `<b>Objet ${mm[1]}</b><small>${esc(mm[2])}</small>${(() => { const x = w && sit.find(y => y.why === w); return x ? `<em class="vs-tag">${esc(x.tag || 'contre eux')}</em>` : ''; })()}`; }
    if (g.name === 'Finir les bottes') { const f = g.items[g.items.length - 1]; return `<b>Bottes</b><small>${esc(iname(f.id))}</small>`; }
    return `<b>${esc(g.name)}</b>`;
  };
  const g0 = groups.find(g => g.name === 'Départ'), g1 = groups.find(g => g.name === '1er retour');
  const firstRow = g0 && g1 ? `<div class="bp-row"><div class="bp-l"><b>Départ</b><small>puis 1er retour</small></div><div class="bp-r">${g0.items.map(tile).join('')}<span class="vbar"></span>${g1.items.map(tile).join('')}</div></div>` : '';
  const restG = firstRow ? groups.filter(g => g !== g0 && g !== g1) : groups;
  const rn = id => S.runes && S.runes[id];
  const rimg = id => rn(id) ? `<img class="rune" src="${DD}/cdn/img/${rn(id).icon}" alt="${esc(rn(id).name)}" title="${esc(rn(id).name)}">` : '';
  let runes = '';
  if (b.runes) {
    const [pri, sec] = b.runes.split('|'), [ps, psel] = pri.split(':'), [ss, ssel] = sec.split(':');
    const ks = psel.split(',')[0];
    runes = `<div class="runes">${rimg(ks)}<span class="grow"><b>${esc((rn(ks) || {}).name || '')}</b><small>${psel.split(',').slice(1).map(rimg).join('')}<span class="vbar"></span>${ssel.split(',').map(rimg).join('')}</small></span></div>`;
    void ps; void ss;
  }
  const sums = (b.spells || []).map(k => S.sums && S.sums[k] ? `<img class="sum" src="${DD}/cdn/${S.version}/img/spell/${S.sums[k].img}" alt="" title="${esc(S.sums[k].name)}">` : '').join('');
  const sk = b.skills ? b.skills.split('').join(' › ') : '';
  const vs = sit.length ? sit.map(x => `${esc(iname(x.id))} <span>(${esc(x.why)})</span>`).join(' · ') : '';
  const upId = role === 'support' ? (['Senna', 'Ashe'].includes(me) ? S.meta.items.upgrades.attack : S.meta.items.upgrades[supProfile(me).arch]) : null;
  out.innerHTML = `<div class="buildpath">${firstRow}
      ${restG.map(g => `<div class="bp-row"><div class="bp-l">${label(g)}</div><div class="bp-r">${g.items.map(tile).join('<span class="sep">›</span>')}</div></div>`).join('')}
    </div>
    <div class="bp-foot">
      ${role === 'support' ? `<div><b>Chaque retour :</b> 1 pink${upId && itemExists(upId) ? ` · <b>Ward finale :</b> ${esc(iname(upId))}` : ''}</div>` : ''}
      ${vs ? `<div class="bp-vs"><b>Contre eux :</b> ${vs}</div>` : ''}
      <div class="bp-rs">${runes}<div class="bp-sk">${sums}${sk ? `<span><b>Sorts :</b> ${esc(sk)}${b.early ? ` <small>(début ${esc(b.early.split('').join(' '))})</small>` : ''}</span>` : ''}</div></div>
      <div class="note">${b.n} parties Challenger / Grandmaster (EUW + Corée), patch ${esc(gamePatch(S.builds.dd) || S.builds.patch)}.${A.n ? '' : ' Ajoute l\'équipe adverse (plus bas) pour adapter les objets.'}</div>
    </div>`;
}
// Découpe le build en achats réels (composants puis assemblage), en réutilisant ce qui est déjà dans l'inventaire.
function planBuys(order, opt) {
  opt = opt || {};
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
  (opt.start || []).map(String).sort((a, b) => total(b) - total(a)).forEach(id => { add('Départ', id, 'buy'); inv.push(id); });
  const bootsId = opt.boots ? String(opt.boots) : null;
  if (opt.support) {
    const pink = itemExists(2055) ? 2055 : null;
    const basic = bootsId ? (from(bootsId).find(c => !from(c).length) || (itemExists(1001) ? '1001' : null)) : null;
    if (basic) { add('1er retour', basic, 'buy', 'vitesse pour roam et esquiver'); inv.push(basic); }
    if (pink) add('1er retour', pink, 'buy', 'vision de la rivière');
  }
  // Un seul niveau de composants (ex. Lame de B.F. plutôt que ses morceaux) pour tenir sur une ligne de téléphone
  const expand = (grp, id, why, depth = 0) => {
    const comps = from(id);
    if (!comps.length || !S.items || depth >= 1) { add(grp, id, 'buy', why); return; }
    comps.forEach(c => { const k = inv.indexOf(c); if (k >= 0) inv.splice(k, 1); else expand(grp, c, undefined, depth + 1); });
    add(grp, id, 'finish', why);
  };
  const whyOf = id => ((window._why || []).find(x => String(x.id) === String(id)) || {}).why;
  let n = 0;
  order.map(String).forEach(id => {
    const grp = id === bootsId ? 'Finir les bottes' : `Objet ${++n} : ${iname(id)}`;
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
  const ck = LS.get('sp2_' + id, null);
  if (ck && ck.v === S.version) { SPELLS[id] = ck.d; return; }
  spellLoading[id] = true;
  getJSON(`${DD}/cdn/${S.version}/data/fr_FR/champion/${id}.json`).then(j => {
    const c = j.data[id], d = { Passif: { name: c.passive.name, img: `${DD}/cdn/${S.version}/img/passive/${c.passive.image.full}` } };
    ['Q', 'W', 'E', 'R'].forEach((k, i) => { const s = c.spells[i]; if (s) d[k] = { name: s.name, desc: ((s.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().match(/^.*?[.!?](\s|$)/) || [''])[0].trim(), cd: s.cooldownBurn, img: `${DD}/cdn/${S.version}/img/spell/${s.image.full}` }; });
    SPELLS[id] = d; LS.set('sp2_' + id, { v: S.version, d });
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
const ADC_DO = {
  engage: sup => `Suis les engages de ${cname(sup)} : sois à portée d'attaque quand il part.`,
  enchanter: sup => `Trade quand ${cname(sup)} peut te protéger, puis recule.`,
  warden: sup => `Joue derrière ${cname(sup)} et punis leur engage.`,
  mage: sup => `Profite du poke de ${cname(sup)} pour gagner la vague et les plaques.`
};
function renderBot() {
  renderBotInner();
  const role = myRole(), opp = S.match.enemy[role], me = S.match.me, lc = laneCounter(me && BUILD(me), opp), out = $('#botOut');
  if (lc.length && out) out.insertAdjacentHTML('afterbegin', `<div class="card"><h3>Objet clé contre ${esc(cname(opp))}</h3>${lc.map(x => `<div class="item"><img src="${iimg(x.id)}" alt="" loading="lazy"><div><b>${esc(iname(x.id))}</b><small>${esc(x.why)}</small>${x.tip ? `<small class="tip">${esc(x.tip)}</small>` : ''}</div></div>`).join('')}<p class="note">Déjà placé dans ton build (onglet Build).</p></div>`);
}
function renderBotInner() {
  const role = myRole();
  $('#laneTitle').textContent = LANE_TAB[role];
  $('#laneTab').textContent = LANE_TAB[role];
  if (role !== 'support' && role !== 'adc') return renderDuel();
  const m = S.match, isAdc = role === 'adc', me = isAdc ? m.ally.support : m.me, a = isAdc ? m.me : m.ally.adc, ea = m.enemy.adc, es = m.enemy.support, out = $('#botOut');
  if (!me || !ea || !es || !a) {
    out.innerHTML = `<div class="card"><p>Complète les 4 champions de la botlane (touche les cases au-dessus).</p>
      <p class="note">Manque : ${[!a && (isAdc ? 'toi (ADC)' : 'ton ADC'), !me && (isAdc ? 'ton support' : 'toi (support)'), !ea && 'leur ADC', !es && 'leur support'].filter(Boolean).join(', ')}</p></div>`;
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
  // Verdict : résultat réel des Challenger / GM s'il existe (≥ 20 parties), sinon les profils de champions
  const myC = m.me, mb = BUILD(myC), dOpp = isAdc ? ea : es, oOpp = isAdc ? es : ea;
  const fd = (l, c) => (l || []).find(x => x[0] === c && x[1] >= 20);
  const xd = mb && fd(mb.opp, dOpp), xo = mb && fd(mb.vsAll, oOpp);
  let verdict, verdictSrc;
  if (xd || xo) {
    let w = mb.wr; const src = [];
    if (xd) { w += shrink(xd[2], xd[1], 100, mb.wr) - mb.wr; src.push(`${xd[2]} % contre ${cname(dOpp)} (${xd[1]} parties)`); }
    if (xo) { w += shrink(xo[2], xo[1], 100, mb.wr) - mb.wr; src.push(`${xo[2]} % contre ${cname(oOpp)} (${xo[1]} parties)`); }
    w = Math.round(w);
    verdict = w >= 53 ? ['good', `Lane favorable : ${w} % estimés`] : w <= 47 ? ['bad', `Lane difficile : ${w} % estimés, sécurité d'abord`] : ['warn', `Lane équilibrée : ${w} % estimés`];
    verdictSrc = `Résultats Challenger / GM de ${cname(myC)} : ${src.join(', ')}. Les phases ci-dessous viennent des profils des champions.`;
  } else {
    verdict = total > 1.5 ? ['good', 'Vous avez l\'avantage'] : total < -1.5 ? ['bad', 'Lane difficile : sécurité d\'abord'] : ['warn', 'Lane équilibrée : tout se joue sur les sorts'];
    verdictSrc = 'Pas assez de parties Challenger sur ce duel : verdict estimé à partir des profils des champions.';
  }
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
  DO.push(isAdc ? ADC_DO[sp.arch](me) : ARCH_DO[sp.arch](m));
  if (isAdc) DO.push('Last-hit d\'abord : chaque vague perdue coûte plus qu\'un trade gagné');
  if (P[2].c === 'adv' && P[0].c !== 'adv') DO.push('Jouer safe jusqu\'au 6 et aux premiers objets : vous scalez mieux');
  if (P[2].c === 'dis' && P[0].c !== 'dis') DO.push('Convertir votre avance avant 11:00 (plaques à 120 po, drake) : ils scalent mieux');
  DO.push(total > 1.5 ? 'Pousser et prendre les plaques, roam mid dès le niveau 5' : total < -1.5 ? 'Laisser la vague venir à votre tour, ward le tri-bush, demander un gank niveau 3-4' : 'Slow push avant chaque retour et avant le drake');
  if (cMe.includes(es)) DO.push(`${cname(me)} contre ${cname(es)} : sois agressif`);
  // À éviter
  const DONT = [];
  (Les.dont || []).forEach(x => DONT.push(x)); (Lea.dont || []).forEach(x => DONT.push(x));
  if (!Les.dont) DONT.push(esp.arch === 'engage' ? 'Te coller à ton ADC (double contrôle)' : esp.arch === 'enchanter' ? 'Trade quand son bouclier/soin est prêt' : 'Prendre du poke gratuit en avançant');
  if (!Lea.dont && ({ bully: 1, allin: 1 })[eap.style]) DONT.push(`Les échanges longs contre ${cname(ea)} au niveau 1-3`);
  DONT.push(isAdc ? `Avancer sans ${cname(me)} ou sans ward dans la rivière` : ARCH_DONT[sp.arch]);
  if (cThem.includes(me)) DONT.push(`Jouer devant : ${cname(es)} contre ${cname(me)}`);
  const jg = m.enemy.jungle && S.meta.junglers[m.enemy.jungle];
  if (jg) DONT.push(`Avancer sans ward : ${cname(m.enemy.jungle)} ${jg.note}`);
  const uniq = a => [...new Set(a)];
  out.innerHTML = `<div class="card"><div class="row"><span class="chip ${verdict[0]}">${verdict[1]}</span></div><p class="note" style="margin-top:6px">${esc(verdictSrc)}</p><div class="phases">${P.map(x => x.html).join('')}</div></div>
    <div class="card"><h3>Sorts à surveiller</h3><div class="spells">${spells.join('') || '<p class="note">Pas de fiche pour ces champions.</p>'}</div>
      <p class="note">Recharges du patch en cours, du niveau 1 au rang max.</p></div>
    <div class="card dolist"><h3>Pour gagner la lane</h3><ul class="checks do">${uniq(DO).slice(0, 6).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="card dolist"><h3>À éviter</h3><ul class="checks dont">${uniq(DONT).slice(0, 5).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}
// Top, mid, jungle : ton champion contre ton adversaire direct
function renderDuel() {
  const role = myRole(), m = S.match, me = m.me, opp = m.enemy[role], out = $('#botOut');
  if (!me || !opp) { out.innerHTML = `<div class="card"><p>Ajoute ${!me ? 'ton champion' : ''}${!me && !opp ? ' et ' : ''}${!opp ? (role === 'jungle' ? 'le jungler adverse' : 'ton adversaire direct') : ''} (cases au-dessus).</p></div>`; return; }
  loadSpells(opp);
  const b = BUILD(me), ob = BUILD(opp), o = b && (b.opp || []).find(x => x[0] === opp), r2 = ob && (ob.opp || []).find(x => x[0] === me);
  const raw = o && o[1] >= 10 ? o[2] : r2 && r2[1] >= 10 ? 100 - r2[2] : null, n = o ? o[1] : r2 ? r2[1] : 0;
  const wr = raw == null ? null : Math.round(shrink(raw, n, 30)); // ramené vers 50 % sur peu de parties
  const verdict = wr == null ? ['warn', 'Pas assez de parties sur ce duel'] : wr >= 53 ? ['good', `Duel favorable : ${wr} % (${n} parties)`] : wr <= 47 ? ['bad', `Duel difficile : ${wr} % (${n} parties)`] : ['warn', `Duel équilibré : ${wr} % (${n} parties)`];
  // fiches de sorts : seulement celles écrites pour ce poste (les fiches botlane ne servent pas en top / mid)
  const L = S.meta.lane[opp + '|' + POS[role]] || {};
  const rows = L.s ? L.s.map(x => spellRow(opp, x[0], x[1])) : ['Q', 'W', 'E', 'R'].map(k => spellRow(opp, k, ((SPELLS[opp] || {})[k] || {}).desc || (k === 'R' ? 'Ultime : joue prudemment quand il est disponible.' : 'Punis-le quand ce sort est en recharge.')));
  const ejg = m.enemy.jungle, jp = ejg && S.meta.junglers[ejg];
  const engAllies = allies().filter(isEngager);
  const DO = [], DONT = [];
  if (role === 'top') {
    DO.push(wr != null && wr <= 47 ? 'Laisse la vague venir à ta tour et farm en sécurité jusqu\'à ton premier objet' : 'Prends l\'avantage aux niveaux 1-3 et pousse pour les plaques avant 11:00');
    DO.push('Ward la rivière top ou le tri-bush avant 3:00 (premier gank possible)');
    DO.push('Pousse ta vague avant 8:00 pour aider ton jungler sur les larves');
    DONT.push('Pousser sans vision quand le jungler adverse n\'est pas visible');
    DONT.push('Utiliser ta Téléportation sans raison : garde-la pour un drake ou un gank');
  } else if (role === 'mid') {
    DO.push('Pousse ta vague puis roam (rivière, bot ou top) aux niveaux 3 et 6');
    DO.push(`Ping « disparu » dès que ${cname(opp)} quitte la lane`);
    DO.push('Bouge vers le drake ou les larves avec ton jungler quand ta vague est poussée');
    DONT.push('Roam quand ta vague arrive à ta tour : tu perds trop d\'or');
  } else {
    DO.push(engAllies.length ? `Ganke en priorité les lanes avec du contrôle : ${engAllies.map(cname).join(', ')}` : 'Ganke la lane où l\'adversaire est poussé et sans Flash');
    DO.push('Commence du côté où tes lanes ont la priorité, prends le crabe à 2:55 si ta bot ou ta mid peut suivre');
    DO.push('Larves à 8:00, drake à 5:00 : prépare la vision 1 minute avant');
    DONT.push('Faire un gank sans que ta lane soit prête (vague mal placée, sans sorts)');
    if (jp) DONT.push(`Ignorer ${cname(opp)} : ${jp.note}`);
  }
  // conseils selon le type de duel (portée, classe) et le résultat réel des Challenger
  if (role !== 'jungle') {
    const rng = c => ((champ(c) || {}).range || 0) >= 300, tm = tags(me), to = tags(opp), on = cname(opp);
    if (rng(me) && !rng(opp)) { DO.unshift(`Tu as la portée : touche ${on} à chaque fois qu'il vient last-hit, recule dès qu'il avance`); DONT.push(`Laisser ${on} te coller sans sort de fuite ou de contrôle prêt`); }
    else if (!rng(me) && rng(opp)) { DO.unshift(`${on} a la portée : farm prudemment et engage seulement quand il a gaspillé un sort`); DONT.push('Échanger à distance : tu perds chaque trade de poke'); }
    else if (!rng(me)) DO.unshift('Duel au corps à corps : trades courts, un combo puis recule avant qu\'il réponde');
    else DO.unshift('Duel à distance : esquive latéralement et garde tes sbires entre vous');
    if (to.includes('Assassin') && (tm.includes('Mage') || tm.includes('Marksman'))) { DO.push(`Garde un sort de contrôle ou ton Flash pour l'engage de ${on}`); DONT.push(`Rester seul en vague sans vision après son niveau 6`); }
    if (to[0] === 'Tank') DO.push(`${on} est un tank : prends l'avantage tôt et ses plaques avant 11:00, il devient fort en fin de partie`);
    if (tm[0] === 'Tank' && (to.includes('Fighter') || to.includes('Assassin'))) DO.push('Tu es solide : survis à la lane et sois prêt pour le premier combat d\'équipe');
    if (wr != null && wr <= 47) DO.unshift('Duel difficile chez les Challenger : farm près de ta tour et appelle ton jungler');
    if (wr != null && wr >= 53) DO.unshift('Duel favorable chez les Challenger : mets la pression dès le niveau 1');
  }
  if (L.do) L.do.forEach(x => DO.push(x)); if (L.dont) L.dont.forEach(x => DONT.push(x));
  if (role !== 'jungle' && jp) DONT.push(`Avancer sans ward : ${cname(ejg)} ${jp.note}`);
  out.innerHTML = `<div class="card"><div class="row"><span class="chip ${verdict[0]}">${verdict[1]}</span></div><p class="note" style="margin-top:6px">Résultat des parties Challenger / Grandmaster où ${esc(cname(me))} affronte ${esc(cname(opp))}.</p></div>
    <div class="card"><h3>Sorts de ${esc(cname(opp))}</h3><div class="spells">${rows.join('')}</div><p class="note">Recharges du patch en cours, du niveau 1 au rang max.</p></div>
    <div class="card dolist"><h3>Pour gagner</h3><ul class="checks do">${[...new Set(DO)].slice(0, 6).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="card dolist"><h3>À éviter</h3><ul class="checks dont">${[...new Set(DONT)].slice(0, 5).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

/* ---------------- Chronologie ---------------- */
// Positions en % de la minimap (0,0 = haut gauche), tirées de la grille de navigation et des placements du client (Base_SRX).
const SPOTS = {
  riverBot: [77.8, 73.8, 'Buisson de rivière bot'], pit: [68.6, 66.2, 'Entrée du pit drake'],
  triBlue: [69.9, 79.5, 'Tri-bush bleu (bot)'], triRed: [81.4, 68.2, 'Tri-bush rouge (bot)'],
  deepRed: [68.6, 59.4, 'Buisson d\'entrée jungle rouge (côté bot)'], deepBlue: [57.7, 68.3, 'Buisson d\'entrée jungle bleue (côté bot)'],
  pitTop: [31.4, 33.2, 'Entrée du pit Baron / larves'], riverTop: [22.6, 23.6, 'Buisson de rivière top'],
  midBlue: [58.4, 56.9, 'Buisson rivière mid (sud)'], midRed: [42.2, 43.8, 'Buisson rivière mid (nord)']
};
// Tours (t) et inhibiteurs (i) : [équipe, type, x %, y %]
const STRUCTS = [["b","t",11.8,84.7],["b","t",14.7,87.8],["r","t",87.9,15.1],["r","t",84.9,11.9],["b","t",28.8,91.6],["b","t",24.6,75.1],["b","t",7.9,71.1],["b","i",21.6,78.3],["b","i",23.4,91.7],["b","i",7.9,75.9],["r","i",75.9,8.0],["b","t",46.6,90.0],["r","t",53.5,9.7],["b","t",70.7,93.1],["b","t",34.0,67.6],["r","t",70.6,8.1],["r","t",29.1,6.6],["b","t",39.4,56.9],["b","t",6.6,29.7],["b","t",10.2,54.9],["r","t",65.8,31.9],["r","t",75.0,24.5],["r","i",78.1,21.4],["r","t",60.3,42.7],["r","t",93.4,69.7],["r","i",91.6,23.8],["r","t",91.7,28.8],["r","t",89.7,44.6]];
function wardSpots(key, side) {
  const enemyTri = side === 'blue' ? 'triRed' : 'triBlue', enemyDeep = side === 'blue' ? 'deepRed' : 'deepBlue';
  return ({ lvl1: ['riverBot'], gank: [enemyTri, 'riverBot'], drake: ['pit', 'riverBot'], grubs: ['riverTop', 'pitTop'], mid: ['midBlue', 'midRed'], deep: [enemyDeep, enemyTri], baron: ['pitTop', 'riverTop', 'midRed'] })[key] || [];
}
function mapSVG(keys) {
  const pts = keys.map(k => SPOTS[k]).filter(Boolean), me = S.match.side === 'red' ? [88, 12] : [12, 88];
  const st = x => { const c = x[0] === 'b' ? '#3a8fe0' : '#e0463a'; return x[1] === 't' ? `<rect x="${x[2] - 1.4}" y="${x[3] - 1.4}" width="2.8" height="2.8" rx=".4" fill="${c}" stroke="#010a13" stroke-width=".5"/>` : `<circle cx="${x[2]}" cy="${x[3]}" r="1.5" fill="none" stroke="${c}" stroke-width=".8"/>`; };
  return `<svg viewBox="0 0 100 100" role="img" aria-label="Carte de la Faille avec tours, buissons et emplacements de ward">
    <image href="map-sr.jpg?v=15" x="0" y="0" width="100" height="100"/>
    ${STRUCTS.map(st).join('')}
    <text x="66.2" y="77" font-size="3" fill="#f0e6d2" text-anchor="middle" font-family="sans-serif" font-weight="700">DRAKE</text>
    <text x="42" y="30.5" font-size="3" fill="#f0e6d2" text-anchor="middle" font-family="sans-serif" font-weight="700">BARON</text>
    <circle cx="${me[0]}" cy="${me[1]}" r="8" fill="none" stroke="#c8aa6e" stroke-width="1" stroke-dasharray="2 1.5"/>
    <text x="${me[0]}" y="${me[1] + (me[1] > 50 ? -10 : 14)}" font-size="4.5" fill="#f0e6d2" text-anchor="middle" font-family="sans-serif" font-weight="700">TOI</text>
    ${pts.map((p, i) => `<g><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="#ffd34d" opacity=".25"><animate attributeName="r" values="3;5.5;3" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="${p[0]}" cy="${p[1]}" r="2.3" fill="#ffd34d" stroke="#010a13" stroke-width=".6"/><text x="${p[0]}" y="${p[1] + 1.1}" font-size="3.1" font-weight="800" fill="#010a13" text-anchor="middle" font-family="sans-serif">${i + 1}</text></g>`).join('')}
  </svg>`;
}

function buildEvents() {
  const T = S.meta.timers, side = S.match.side, m = S.match, ev = [];
  const E = (t, kind, title, text, spots, id) => ev.push({ t, kind, title, text, spots, id: id || kind + t });
  const jg = m.enemy.jungle, jp = jg ? (S.meta.junglers[jg] || { type: 'mid', note: 'profil inconnu' }) : null;
  const myJg = m.ally.jungle, role = myRole();
  if (role !== 'support') return buildEventsRole(role, E, ev, T, side, jg, jp);
  E(0, 'lane', 'Début de partie', "Atlas + 2 potions. Aide ton jungler au leash seulement s'il le demande.");
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
  E((T.platesDecay || 660) - 60, 'ward', 'Plaques à prendre avant 11:00', 'Ward profond la jungle adverse côté bot et pousse : les plaques valent 120 po jusqu\'à 11:00.', wardSpots('deep', side), 'wplates');
  E(T.platesDecay || 660, 'obj', 'Plaques : valeur en baisse (11:00)', 'Les plaques ne tombent plus, mais perdent 10 po par minute jusqu\'à 15:00 (80 po ensuite) et la tour externe s\'affaiblit. Bonne fenêtre pour la tour elle-même.', null, 'plates');
  E(T.laneEnd || 840, 'lane', 'Fin de la phase de lane (14:00)', "Vagues toutes les 25 s, retour en base plus rapide. Passe à l'Oracle si ta quête est finie et regroupe mid.", null, 'laneend');
  E(T.herald - 30, 'ward', 'Prépare le Héraut', 'Balaye et ward autour du pit top.', wardSpots('grubs', side), 'wherald');
  E(T.grubsDespawn, 'obj', 'Les larves disparaissent', 'Si elles sont encore là, c\'est la dernière chance.', null, 'grubsend');
  E(T.herald, 'obj', 'Héraut (15:00)', 'Une seule apparition dans le pit top.', null, 'herald');
  E(T.baron - 30, 'ward', 'Prépare le Baron', 'Oracle + pink : nettoie les entrées du Baron, ward la rivière mid.', wardSpots('baron', side), 'wbaron');
  E(T.baron, 'obj', 'Baron (20:00)', 'Ne le commence jamais sans vision de leur jungler.', null, 'baron');
  laterDrakes(E, T, side);
  return ev.sort((a, b) => a.t - b.t);
}
function laterDrakes(E, T, side) {
  (S.kills.drakes || []).forEach((k, i) => {
    const t = k + T.dragonRespawn;
    E(t - 30, 'ward', `Prépare le drake n°${i + 2}`, 'Vision dans la rivière bot, poussez bot et mid avant.', wardSpots('drake', side), 'wdrake' + (i + 2));
    E(t, 'obj', `Drake n°${i + 2}`, '5:00 après le précédent.', null, 'drake' + (i + 2));
  });
  if (S.kills.soul != null) { const t = S.kills.soul + T.elderAfterSoul; E(t - 45, 'ward', 'Prépare l\'Ancien', 'Vision complète autour du pit.', wardSpots('drake', side), 'welder'); E(t, 'obj', 'Dragon Ancien', '6:00 après l\'âme.', null, 'elder'); }
}
// Chronologie pour top, jungle, mid, ADC
function buildEventsRole(role, E, ev, T, side, jg, jp) {
  const m = S.match, myJg = m.ally.jungle;
  const g = jp ? (jp.type === 'early' ? 165 : jp.type === 'mid' ? 200 : jp.type === 'farm' ? 285 : 390) : 195;
  const lane = { top: 'top', mid: 'mid', adc: 'bot' }[role];
  // Jungle : lane à ganker en premier (allié avec le plus de contrôle) et chemin de départ du côté opposé
  let jgStart = '';
  if (role === 'jungle') {
    const L3 = [['top', [m.ally.top]], ['mid', [m.ally.mid]], ['bot', [m.ally.adc, m.ally.support]]];
    const cc = l => l[1].filter(Boolean).filter(isEngager).length * 2 + l[1].filter(Boolean).filter(isFront).length;
    const tgt = L3.slice().sort((a, b) => cc(b) - cc(a))[0];
    const tgtName = tgt[0], topside = tgtName === 'bot'; // pour finir près de la bot, on commence côté top
    const buff = (side === 'blue') === topside ? 'buff bleu' : 'buff rouge';
    jgStart = cc(tgt) ? `Lane à ganker en premier : ${tgtName} (${tgt[1].filter(Boolean).map(cname).join(' + ')}, le plus de contrôle). Commence côté ${topside ? 'top' : 'bot'} (${buff}) pour finir ton tour près de la ${tgtName} vers 3:00-3:15.` : 'Ajoute tes alliés pour savoir quelle lane ganker en premier. Commence du côté opposé à cette lane pour finir ton tour à côté d\'elle.';
    if (jp && (jp.type === 'early' || /invad/i.test(jp.note || ''))) E(45, 'danger', `Invasion possible : ${cname(jg)}`, `${cname(jg)} aime envahir tôt : ward l'entrée de ton premier buff et reste près de tes laners avant l'apparition des camps.`, null, 'invade');
  }
  E(0, 'lane', 'Début de partie', role === 'jungle' ? jgStart : role === 'adc' ? 'Objet de départ + potion. Laisse ton support prendre les buissons, toi la vague.' : 'Objet de départ + potion. Les 3 premiers niveaux décident souvent du duel.');
  if (role === 'adc') {
    E(65, 'lane', 'Course au niveau 2', '1re vague + 3 sbires mêlée de la 2e (~1:50). Last-hit en priorité.');
    E(108, 'lane', 'Niveau 2 imminent', 'Prêt à suivre l\'engage de ton support, ou à reculer s\'ils l\'ont avant vous.');
  }
  if (role === 'top') E(150, 'ward', 'Ward avant le 1er gank', 'Trinket dans la rivière top ou le tri-bush : premier gank possible vers 3:00.', ['riverTop'], 'wgank');
  if (role === 'mid') E(150, 'ward', 'Ward avant le 1er gank', 'Trinket dans un buisson de rivière mid, du côté de leur jungler.', side === 'blue' ? ['midRed'] : ['midBlue'], 'wgank');
  if (role !== 'jungle') {
    E(g, 'danger', jg ? `Gank possible : ${cname(jg)}` : 'Premier gank possible', jp ? `${jp.note}. Ne pousse pas sans vision.` : 'Ajoute le jungler adverse pour un timing précis.', null, 'gank');
  } else {
    E(190, 'lane', 'Fin du premier tour de jungle (3:00-3:20)', 'Gank si une lane est prête (adversaire poussé, sans Flash), sinon enchaîne sur le crabe.');
    if (jg) E(g, 'danger', `${cname(jg)} peut ganker`, `${jp ? jp.note + '. ' : ''}S'il a été vu d'un côté au début, son 1er gank viendra souvent de l'autre côté : sois proche de cette lane pour contre-ganker.`, null, 'gank');
    E(400, 'obj', 'Tes buffs réapparaissent', 'Les buffs reviennent 5:00 après avoir été tués : prends-les vers 6:30-7:00 avant le prochain objectif.', null, 'buffs');
  }
  E(T.scuttle, 'obj', 'Crabes (2:55)', role === 'jungle' ? 'Prends le crabe du côté où tes lanes peuvent bouger.' : `Si ta lane a la priorité, aide ${myJg ? cname(myJg) : 'ton jungler'} sur le crabe.`);
  if (role === 'mid') E(200, 'lane', 'Niveau 3 : fenêtre de roam', 'Si ta vague est poussée, va vers la rivière ou une lane adjacente.');
  E(T.dragon - 45, role === 'jungle' ? 'ward' : 'lane', 'Prépare le drake', role === 'adc' ? 'Pousse ta vague avant le drake avec ton support.' : role === 'jungle' ? 'Vision dans la rivière bot, demande la priorité bot et mid.' : role === 'mid' ? 'Pousse ta vague pour pouvoir bouger au drake.' : 'Pousse ta vague ou garde ta Téléportation pour le drake.', role === 'jungle' ? wardSpots('drake', side) : null, 'wdrake1');
  E(T.dragon, 'obj', 'Drake (5:00)', 'Premier drake : seulement avec la priorité bot et mid.', null, 'drake1');
  if (role === 'mid') E(390, 'lane', 'Niveau 6', 'Ultime disponible : roam vers une lane poussée ou un objectif.');
  if (role === 'adc') E(390, 'lane', 'Niveau 6', 'Le support et le jungler adverses ont leur ultime : attention aux all-ins.');
  E(T.grubs - 45, role === 'jungle' || role === 'top' ? 'ward' : 'lane', 'Prépare les larves', role === 'top' ? 'Pousse ta vague et aide ton jungler sur les larves.' : role === 'jungle' ? 'Vision autour du pit top, demande la priorité top et mid.' : 'Pousse ta vague si tu peux aider sur les larves.', role === 'jungle' || role === 'top' ? wardSpots('grubs', side) : null, 'wgrubs');
  E(T.grubs, 'obj', 'Larves du Néant (8:00)', 'Un seul groupe, pas de réapparition.', null, 'grubs');
  E(600, 'lane', 'Reset', role === 'jungle' ? 'Retour en base avec assez d\'or pour un composant, puis prépare le drake suivant.' : 'Pousse et rentre avec assez d\'or pour avancer ton 1er objet.');
  E((T.platesDecay || 660) - 60, 'lane', 'Plaques à prendre avant 11:00', 'Les plaques valent 120 po jusqu\'à 11:00 : pousse si tu as l\'avantage.', null, 'wplates');
  E(T.platesDecay || 660, 'obj', 'Plaques : valeur en baisse (11:00)', 'Les plaques perdent 10 po par minute jusqu\'à 15:00 et la tour externe s\'affaiblit.', null, 'plates');
  E(T.laneEnd || 840, 'lane', 'Fin de la phase de lane (14:00)', role === 'adc' ? 'Vagues toutes les 25 s : rejoins mid avec ton support, reste avec le groupe.' : 'Vagues toutes les 25 s, retour en base plus rapide. Regroupe-toi pour les objectifs.', null, 'laneend');
  E(T.grubsDespawn, 'obj', 'Les larves disparaissent', 'Dernière chance si elles sont encore là.', null, 'grubsend');
  E(T.herald - 30, role === 'jungle' ? 'ward' : 'lane', 'Prépare le Héraut', 'Vision autour du pit top, priorité top et mid.', role === 'jungle' ? wardSpots('grubs', side) : null, 'wherald');
  E(T.herald, 'obj', 'Héraut (15:00)', 'Une seule apparition dans le pit top.', null, 'herald');
  E(T.baron - 30, 'ward', 'Prépare le Baron', 'Vision et balayage autour du Baron avant de le commencer.', wardSpots('baron', side), 'wbaron');
  E(T.baron, 'obj', 'Baron (20:00)', 'Jamais sans savoir où est leur jungler.', null, 'baron');
  laterDrakes(E, T, side);
  void lane;
  return ev.sort((a, b) => a.t - b.t);
}
const now = () => S.timer.start ? (Date.now() - S.timer.start) / 1000 : null;

function renderTimeline() {
  const t = now(), ev = buildEvents();
  const nextIdx = t == null ? -1 : ev.findIndex(e => e.t >= t - 5);
  const nextWard = ev.find(e => e.kind === 'ward' && e.spots && e.spots.length && (t == null || e.t >= t - 20));
  $('#timeline').innerHTML = (nextWard ? `<div class="card" style="margin-bottom:14px"><h3>${t == null ? 'Première ward' : 'Prochaine ward'} · ${fmt(nextWard.t)}</h3>
      <div class="mapwrap">${mapSVG(nextWard.spots || [])}<div><b>${esc(nextWard.title)}</b><p class="note" style="margin-top:4px">${esc(nextWard.text)}</p>
      <ol class="tips" style="margin-top:6px;font-size:13px">${(nextWard.spots || []).map(k => `<li>${esc(SPOTS[k][2])}</li>`).join('')}</ol>
      <p class="note">Côté ${S.match.side === 'blue' ? 'bleu (base en bas à gauche)' : 'rouge (base en haut à droite)'}.</p></div></div></div>` : '') +
    (t != null && (t != null ? ev.filter((e, i) => e.t < t - 5 && i !== nextIdx).length : 0) ? `<button class="btn small ghost" id="togglePast" style="margin-bottom:12px">${S.showPast ? 'Masquer' : 'Voir'} les ${(t != null ? ev.filter((e, i) => e.t < t - 5 && i !== nextIdx).length : 0)} événements passés</button>` : '') +
    ev.map((e, i) => ({ e, i })).filter(({ e, i }) => t == null || S.showPast || e.t >= t - 5 || i === nextIdx).map(({ e, i }) => `<div class="ev ${e.kind} ${t != null && e.t < t - 5 && i !== nextIdx ? 'past' : ''} ${i === nextIdx ? 'now' : ''}">
      <div class="tm">${fmt(e.t)}</div><div class="dot"><i></i></div>
      <div class="body"><span class="kind">${{ ward: 'Ward', obj: 'Objectif', danger: 'Danger', lane: 'Lane' }[e.kind]}</span><b>${esc(e.title)}</b><p>${esc(e.text)}</p></div></div>`).join('');
  { const h = $('#rulesTitle'); if (h) h.textContent = 'Règles du patch' + (myRole() === 'support' ? ' pour le support' : ''); }
  const fixTxt = t => myRole() === 'support' ? t : t.replace(/ Passe à l'Oracle et regroupe-toi avec ton jungler et ton mid\./, ' Regroupe-toi avec ton équipe pour les objectifs.');
  $('#rules').innerHTML = `<ul class="tips">${(S.meta.supportRules || []).filter(r => myRole() === 'support' || !/quête|roam/i.test(r.title)).map(r => `<li><b>${esc(r.title)}.</b> ${esc(fixTxt(r.text))}</li>`).join('')}</ul>`;
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
  box.innerHTML = `<div class="alert ${e.kind === 'ward' ? 'ward' : e.kind === 'obj' ? 'obj' : ''}" role="alert"${S.view !== 'time' ? ' style="top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 84px)"' : ''}><div><b>${fmt(e.t)} · ${esc(e.title)}</b><p>${esc(e.text)}</p></div><button aria-label="Fermer">OK</button></div>`;
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
    const aR = assignRoles(mine.filter(p => p.id), allyRoles()), eR = assignRoles(theirs.filter(p => p.id), ROLES_ENEMY);
    S.match.ally = Object.assign(defMatch().ally, aR);
    S.match.enemy = Object.assign({ top: null, jungle: null, mid: null, adc: null, support: null }, eR);
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
  PK = Object.assign({ multi: false, selected: [], prefer: null, path: null }, opts);
  PK.taken = PK.multi ? {} : takenChamps(PK.path);
  $('#pickTitle').textContent = PK.title; $('#pickSearch').value = ''; $('#pickNone').hidden = PK.multi;
  $('#picker').hidden = false; renderPicker();
  setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) $('#pickSearch').focus(); }, 50);
}
function renderPicker() {
  const q = norm($('#pickSearch').value);
  let list = Object.values(S.champs);
  if (!list.length) { $('#pickGrid').innerHTML = '<p class="empty">Liste des champions indisponible (pas de connexion ?).</p>'; return; }
  const pref = PK.prefer;
  const played = c => !!(S.builds && S.builds.builds && S.builds.builds[c.id + '|' + POS[pref]]);
  const rank = c => pref === 'support' ? (S.meta.supports[c.id] ? 0 : c.tags.includes('Support') ? 1 : 2) : pref === 'adc' ? (S.meta.adcs[c.id] || played(c) ? 0 : 1) : POS[pref] ? (played(c) ? 0 : 1) : 0;
  const tk = c => PK.taken[c.id] ? 1 : 0;
  list = list.filter(c => !q || norm(c.name).includes(q) || norm(c.id).includes(q)).sort((a, b) => tk(a) - tk(b) || rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
  $('#pickGrid').innerHTML = list.map(c => (PK.taken[c.id] ? `<button class="pick taken" disabled aria-disabled="true"><img src="${cimg(c.id)}" alt="" loading="lazy"><span>${esc(c.name)}</span><em>${PK.taken[c.id] === 'adversaire' ? 'Pris en face' : 'Déjà pris'}</em></button>` : `<button class="pick ${PK.selected.includes(c.id) ? 'on' : ''}" data-id="${c.id}"><img src="${cimg(c.id)}" alt="" loading="lazy"><span>${esc(c.name)}</span></button>`)).join('');
}
$('#pickGrid').addEventListener('click', e => {
  const b = e.target.closest('.pick'); if (!b) return; const id = b.dataset.id;
  if (PK.multi) { const i = PK.selected.indexOf(id); i >= 0 ? PK.selected.splice(i, 1) : PK.selected.push(id); b.classList.toggle('on'); PK.onPick(PK.selected.slice()); }
  else { PK.onPick(id); closePicker(); }
});
$('#pickSearch').addEventListener('input', renderPicker);
// Suit la zone visible (clavier ouvert) pour garder le sélecteur entier à l'écran
if (window.visualViewport) { const vv = window.visualViewport, fit = () => { document.documentElement.style.setProperty('--vvh', vv.height + 'px'); document.documentElement.style.setProperty('--vvt', vv.offsetTop + 'px'); }; vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
$('#pickSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('#pickGrid .pick:not(.taken)'); if (f) f.click(); } });
$('#pickClose').onclick = () => closePicker();
$('#pickNone').onclick = () => { PK.onPick(null); closePicker(); };
$('#picker').addEventListener('click', e => { if (e.target.id === 'picker') closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#picker').hidden) closePicker(); });
function closePicker() { $('#picker').hidden = true; PK = null; save(); renderAll(); }

function editSlot(path) {
  if (path === 'me') {
    return openPicker({ title: 'Ton champion · ' + ROLE_FR[myRole()], prefer: myRole(), path: 'me', selected: [S.match.me].filter(Boolean), onPick: id => { S.match.me = id; } });
  }
  const [side, role] = path.split('.');
  openPicker({ title: `${side === 'ally' ? 'Allié' : 'Adversaire'} · ${ROLE_FR[role]}`, prefer: role, path: side + '.' + role, selected: [S.match[side][role]].filter(Boolean), onPick: id => { S.match[side][role] = id; } });
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-slot]'); if (s) return editSlot(s.dataset.slot);
  const pm = e.target.closest('[data-pickme]'); if (pm) { S.match.me = pm.dataset.pickme; save(); renderAll(); toast(`${cname(S.match.me)} choisi`); return; }
  const a = e.target.closest('[data-act="pool"]'); if (a) return editPool();
});
function editPool() { const r = myRole(); openPicker({ title: `Mon pool ${ROLE_FR[r]} (touche pour ajouter / retirer)`, multi: true, prefer: r, selected: myPool().slice(), onPick: sel => { S.settings.pools[r] = sel; save(); } }); }
function setRole(r, stay) {
  if (!ROLES.includes(r)) return;
  if (S.settings.role !== r) { const keep = S.match.side; S.match = defMatch(); S.match.side = keep; }
  S.settings.role = r; save(); renderAll(); if (!stay) show('home'); toast('Poste : ' + ROLE_FR[r]);
}
document.addEventListener('click', e => { const r = e.target.closest('[data-role]'); if (r) setRole(r.dataset.role, !!r.closest('#roleSeg')); });

/* ---------------- Réglages ---------------- */
function renderSettings() {
  $$('#roleSeg [data-role]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.role === myRole())));
  $('#poolTitle').textContent = 'Mon pool ' + ROLE_FR[myRole()];
  $('#poolView').innerHTML = myPool().length ? myPool().map(id => `<div class="pick on" style="cursor:default">${cimg(id) ? `<img src="${cimg(id)}" alt="">` : ''}<span>${esc(cname(id))}</span></div>`).join('') : '<p class="note">Aucun champion pour l\'instant.</p>';
  $('#riotId').value = S.settings.riotId || ''; $('#platform').value = S.settings.platform;
  $('#optSound').checked = S.settings.sound; $('#optVibrate').checked = S.settings.vibrate; $('#optNotif').checked = S.settings.notif; $('#optLead').value = String(S.settings.lead);
  const live = gamePatch(S.version);
  $('#metaInfo').innerHTML = `Patch en jeu : <b>${esc(live || 'inconnu')}</b> (Data Dragon ${esc(S.version || '?')}). Données méta : patch <b>${esc(S.meta.patch)}</b>, mises à jour le ${esc(S.meta.updated || '?')}.` + (live && live !== S.meta.patch ? `<br><span style="color:var(--warn)">Nouveau patch détecté : les champions et objets sont déjà à jour, les tiers et timings le seront à la prochaine mise à jour des données.</span>` : '');
  $('#buildsInfo').innerHTML = S.builds ? `Builds : ${S.builds.games} parties Challenger / Grandmaster (EUW + Corée), calculés le ${esc(new Date(S.builds.generated).toLocaleDateString('fr-FR'))}, mis à jour chaque semaine.` : 'Builds des meilleurs joueurs : en cours de calcul.';
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
  $('#btnHome').hidden = v === 'home' || v === 'role';
  document.body.classList.toggle('in-game', GAME_TABS.includes(v));
  if (v === 'time') renderTimeline();
  { const h = $('#hdrRole'); if (h) h.textContent = S.settings.role ? ROLE_FR[myRole()] : 'LoL'; }
  if (v === 'home') { const a = $('#homeAcc'); if (a) a.textContent = S.settings.riotId ? 'Compte : ' + S.settings.riotId : 'Ajoute ton Riot ID dans les Réglages.'; $('#homeRole').textContent = ROLE_FR[myRole()]; $('#homeGameSub').textContent = `Draft · Build · ${LANE_TAB[myRole()]} · Timings`; }
  if (v === 'analyse' && typeof renderAnalyse === 'function') { renderAnalyse(); if (Date.now() - AN.updated > 10 * 60000 || AN.role !== myRole()) loadAnalyse(false); }
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
  if (S.view === 'home') show('home');
  if (S.view === 'time') renderTimeline();
}

(async function init() {
  await loadMeta(false);
  S.builds = LS.get('builds', null);
  renderAll();
  show(S.settings.role ? 'home' : 'role');
  await Promise.all([loadDD(false), loadBuilds()]);
  renderAll();
  if (S.timer.start) markPastFired();
  setInterval(() => tick(false), 500);
  if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { }); let rl = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!rl && navigator.serviceWorker.controller) { rl = true; location.reload(); } }); }
})();
