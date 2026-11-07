/* Coach Support — analyse.js : analyse des parties passées (match-v5 + timeline via le relais).
   Utilise les globales d'app.js (S, RELAY, $, esc, cname, cimg, iimg, LS, fmt, toast). */
'use strict';

const AN = { busy: false, sums: LS.get('an_sums', {}), ids: LS.get('an_ids', []), updated: LS.get('an_updated', 0) };
const TARGET = { vspm: 2.2, wpm: 0.9, ctrl: 4, wkpm: 0.2, kp: 0.55, deaths: 5, early: 1, roam: 1.5, prep: 0.6 };
const champIdByName = n => (S.champs[n] ? n : (Object.values(S.champs).find(c => c.name === n) || {}).id || n);

/* ---------- géométrie de la Faille (0..14870, base bleue en bas à gauche) ---------- */
const inBase = p => (p.x < 2300 && p.y < 2300) || (p.x > 12500 && p.y > 12500);
const inBot = p => (p.x > 8800 && p.y < 6000) || (p.y < 2400 && p.x > 4200) || (p.x > 12500 && p.y < 10500);
const inRiver = p => Math.abs(p.x + p.y - 14900) < 1600;
const enemyHalf = (p, team) => team === 100 ? p.x + p.y > 16500 : p.x + p.y < 13300;
const zoneName = (p, team) => !p ? '' : inBase(p) ? 'base' : inRiver(p) ? (p.x > 7400 ? 'rivière bot' : 'rivière top') : enemyHalf(p, team) ? 'jungle/zone adverse' : inBot(p) ? 'bot lane' : 'ta jungle';

/* ---------- résumé d'une partie (stocké, petit) ---------- */
function summarize(m, puuid) {
  const P = m.participants, me = P.find(p => p.puuid === puuid);
  if (!me) return null;
  const dur = m.gameDuration / 60, myT = me.teamId, pid = me.participantId;
  const opp = P.find(p => p.teamId !== myT && p.teamPosition === 'UTILITY');
  const adc = P.find(p => p.teamId === myT && p.teamPosition === 'BOTTOM');
  const eJg = P.find(p => p.teamId !== myT && p.teamPosition === 'JUNGLE');
  const ev = m.events || [], fr = m.frames || [];
  const lvl2 = id => { const e = ev.find(e => e.type === 'LEVEL_UP' && e.participantId === id && e.level === 2); return e ? e.t / 1000 : null; };
  const lvlAt = (id, L) => { const e = ev.find(e => e.type === 'LEVEL_UP' && e.participantId === id && e.level === L); return e ? e.t / 1000 : null; };
  const goldAt = (id, min) => { const f = fr[Math.min(min, fr.length - 1)]; return f && f.p[id] ? f.p[id].gold : null; };
  const objs = ev.filter(e => e.type === 'ELITE_MONSTER_KILL' && e.t < 26 * 60000);
  const objName = e => ({ DRAGON: 'drake', HORDE: 'larves', RIFTHERALD: 'Héraut', BARON_NASHOR: 'Baron' })[e.monsterType] || e.monsterType;
  const wardsBy = id => ev.filter(e => e.type === 'WARD_PLACED' && e.creatorId === id && e.wardType !== 'UNDEFINED');
  const prepOf = id => { const w = wardsBy(id); const ok = objs.filter(o => w.some(x => x.t <= o.t && x.t >= o.t - 90000)); return { n: objs.length, ok: ok.length, missed: objs.filter(o => !ok.includes(o)).map(o => ({ t: o.t / 1000, what: objName(o), ours: o.killerTeamId === myT })) }; };
  const l5 = lvlAt(pid, 5) || 420;
  let roam = 0;
  for (let i = 2; i < fr.length && i <= 14 && i * 60 < l5; i++) { const q = fr[i].p[pid]; if (q && q.x != null && !inBot(q) && !inBase(q)) roam++; }
  const deaths = ev.filter(e => e.type === 'CHAMPION_KILL' && e.victimId === pid).map(e => {
    const t = e.t / 1000, tags = [];
    const inv = [e.killerId].concat(e.assistingParticipantIds || []);
    if (eJg && inv.includes(eJg.participantId) && t < 840) tags.push('gank ' + cname(champIdByName(eJg.championName)));
    const nextObj = objs.find(o => o.t / 1000 >= t && o.t / 1000 - t <= 75 && o.killerTeamId !== myT);
    if (nextObj) tags.push('juste avant leur ' + objName(nextObj));
    const z = zoneName(e.position, myT); if (z) tags.push(z);
    return { t, tags, n: inv.length };
  });
  const items = ev.filter(e => e.type === 'ITEM_PURCHASED' && e.participantId === pid);
  const firstBig = items.find(e => S.items && S.items[e.itemId] && S.items[e.itemId].gold >= 2000 && !(S.items[e.itemId].from || []).includes('1001'));
  const oracle = items.find(e => e.itemId === 3364);
  const ctrlPlaced = wardsBy(pid).filter(w => w.wardType === 'CONTROL_WARD').length;
  const stat = p => !p ? null : {
    champ: p.championName, vspm: p.visionScore / dur, wpm: p.wardsPlaced / dur, wkpm: p.wardsKilled / dur,
    ctrl: p.visionWardsBoughtInGame, kp: p.challenges.killParticipation != null ? p.challenges.killParticipation : null,
    deaths: p.deaths, kda: [p.kills, p.deaths, p.assists], lvl2: lvl2(p.participantId), gold14: goldAt(p.participantId, 14),
    prep: prepOf(p.participantId), heal: (p.totalHealsOnTeammates || 0) + (p.totalDamageShieldedOnTeammates || 0), cc: p.timeCCingOthers
  };
  return {
    id: m.id, at: m.gameCreation, dur, win: me.win, pos: me.teamPosition, side: myT === 100 ? 'bleu' : 'rouge',
    me: stat(me), opp: stat(opp), adc: adc && adc.championName, eAdc: (P.find(p => p.teamId !== myT && p.teamPosition === 'BOTTOM') || {}).championName,
    eJg: eJg && eJg.championName, roam, l5, deaths, early: deaths.filter(d => d.t < 840).length,
    ctrlPlaced, firstItem: firstBig ? firstBig.t / 1000 : null, oracle: oracle ? oracle.t / 1000 : null
  };
}

/* ---------- diagnostic ---------- */
function diagnose(g) {
  const bad = [], good = [], me = g.me, op = g.opp;
  const vsOpp = (k, f = 1) => op && op[k] != null ? ` (${cname(champIdByName(op.champ))} : ${(op[k] * f).toFixed(k === 'kp' ? 0 : 1)}${k === 'kp' ? ' %' : ''})` : '';
  if (me.vspm < TARGET.vspm * 0.85) bad.push({ w: 3, t: `Vision faible : ${me.vspm.toFixed(1)}/min${vsOpp('vspm')}`, a: 'Utilise ton trinket dès qu\'il a 2 charges et pose tes wards de quête à chaque sortie de base.' });
  else good.push(`Bonne vision : ${me.vspm.toFixed(1)}/min${vsOpp('vspm')}`);
  if (me.ctrl < Math.min(TARGET.ctrl, Math.round(g.dur / 7))) bad.push({ w: 2, t: `Seulement ${me.ctrl} pink${me.ctrl > 1 ? 's' : ''} achetée${me.ctrl > 1 ? 's' : ''}`, a: '1 pink à chaque retour, toujours. Avec la quête finie, elle coûte 40 po.' });
  if (me.wkpm < TARGET.wkpm * 0.7) bad.push({ w: 1, t: `Peu de wards adverses détruites (${Math.round(me.wkpm * g.dur)})`, a: 'Passe à l\'Oracle après la phase de lane et nettoie avant chaque objectif.' });
  if (!g.oracle || g.oracle > 1200) bad.push({ w: 1, t: g.oracle ? `Oracle pris tard (${fmt(g.oracle)})` : 'Jamais passé à l\'Oracle (balayeur)', a: 'Échange ton trinket vers 14:00, quand les plaques tombent.' });
  if (me.kp != null && me.kp < TARGET.kp) bad.push({ w: 2, t: `Participation aux kills : ${Math.round(me.kp * 100)} %${vsOpp('kp', 100)}`, a: 'Après 14:00, colle ton jungler/mid et sois là pour chaque objectif.' });
  else if (me.kp != null) good.push(`Participation aux kills : ${Math.round(me.kp * 100)} %`);
  if (g.early > TARGET.early) bad.push({ w: 3, t: `${g.early} morts avant 14:00`, a: 'Avant chaque avancée, regarde la minimap : où est leur jungler ? Pas de vision = pas d\'engage.' });
  const ganks = g.deaths.filter(d => d.tags.some(x => x.startsWith('gank'))).length;
  if (ganks >= 2) bad.push({ w: 2, t: `${ganks} morts sur des ganks de ${cname(champIdByName(g.eJg))}`, a: 'Ward le tri-bush/la rivière 15 s avant ses fenêtres de gank (onglet Timings).' });
  const preObj = g.deaths.filter(d => d.tags.some(x => x.startsWith('juste avant'))).length;
  if (preObj) bad.push({ w: 2, t: `${preObj} mort${preObj > 1 ? 's' : ''} juste avant un objectif adverse`, a: 'Avant drake/larves/Baron : ward en groupe, jamais seul dans le brouillard.' });
  const river = g.deaths.filter(d => d.tags.some(x => x.includes('rivière') || x.includes('adverse'))).length;
  if (river >= 2) bad.push({ w: 2, t: `${river} morts en rivière ou chez eux`, a: 'Ward avec un allié ou depuis une zone sûre, et repars dès que la ward est posée.' });
  if (g.roam > TARGET.roam) bad.push({ w: 2, t: `Tu décales trop tôt : ${g.roam} min hors de la bot avant le niveau 5`, a: 'Avant le niv 5, chaque sbire tué hors bot rapporte 33 % d\'or et d\'XP en moins. Reste avec ton ADC jusque-là.' });
  else good.push('Bonne présence en lane avant le niveau 5');
  if (me.lvl2 && op && op.lvl2) { if (me.lvl2 > op.lvl2 + 3) bad.push({ w: 1, t: `Niveau 2 après eux (${fmt(me.lvl2)} contre ${fmt(op.lvl2)})`, a: 'Aide à pousser la 1re vague et prends le niveau 2 en premier pour engager.' }); else if (me.lvl2 + 3 < op.lvl2) good.push(`Niveau 2 avant eux (${fmt(me.lvl2)})`); }
  if (me.prep.n >= 2 && me.prep.ok / me.prep.n < TARGET.prep) bad.push({ w: 2, t: `Pas de ward avant ${me.prep.n - me.prep.ok} objectif${me.prep.n - me.prep.ok > 1 ? 's' : ''} sur ${me.prep.n}`, a: 'Pose ta vision 60-90 s avant chaque drake/larves/Héraut (les alertes Timings te préviennent).' });
  else if (me.prep.n >= 2) good.push(`Vision posée avant ${me.prep.ok}/${me.prep.n} objectifs`);
  if (op && me.gold14 != null && op.gold14 != null && op.gold14 - me.gold14 > 400) bad.push({ w: 1, t: `${op.gold14 - me.gold14} po de retard sur le support adverse à 14:00`, a: 'Termine ta quête plus vite : reste sur les sbires de ta lane et évite les morts.' });
  if (g.firstItem && g.firstItem > 14 * 60) bad.push({ w: 1, t: `1er objet complété tard (${fmt(g.firstItem)})`, a: 'Rentre avec assez d\'or pour finir ton 1er objet, ne garde pas l\'or sur toi.' });
  return { bad: bad.sort((a, b) => b.w - a.w), good };
}

/* ---------- chargement ---------- */
async function loadAnalyse(force) {
  if (AN.busy) return;
  const st = $('#anStatus');
  if (!/.+#.+/.test(S.settings.riotId || '')) { st.textContent = 'Renseigne ton Riot ID dans les Réglages.'; return; }
  AN.busy = true; st.className = 'status'; st.textContent = 'Récupération de tes parties…';
  const base = (S.settings.proxy || RELAY).replace(/\/+$/, ''), q = `riotId=${encodeURIComponent(S.settings.riotId)}&platform=${S.settings.platform}`;
  try {
    const r = await fetch(`${base}/matches?${q}&count=15`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 404 && j.error === 'not_found' ? 'old_relay' : r.status === 403 ? 'key' : r.status === 429 ? 'rate' : 'err');
    AN.puuid = j.puuid; AN.ids = j.ids; LS.set('an_ids', AN.ids);
    let n = 0;
    for (const id of AN.ids) {
      if (AN.sums[id] && !force) continue;
      st.textContent = `Analyse des parties… ${++n}`;
      const mr = await fetch(`${base}/match?id=${id}&platform=${S.settings.platform}`);
      if (mr.status === 429) { await new Promise(res => setTimeout(res, 3000)); continue; }
      if (!mr.ok) continue;
      const s = summarize(await mr.json(), AN.puuid); if (s) AN.sums[id] = s;
      LS.set('an_sums', pruneSums()); renderAnalyse();
    }
    AN.updated = Date.now(); LS.set('an_updated', AN.updated);
    st.className = 'status ok'; st.textContent = `${AN.ids.filter(id => AN.sums[id]).length} parties classées analysées.`;
  } catch (e) {
    st.className = 'status err';
    st.textContent = e.message === 'old_relay' ? 'Le relais doit être mis à jour (Cloudflare redéploie depuis GitHub, patiente quelques minutes).' : e.message === 'key' ? 'Clé Riot refusée par le relais.' : e.message === 'rate' ? 'Trop de requêtes, réessaie dans 2 minutes.' : 'Impossible de joindre le relais.';
  }
  AN.busy = false; renderAnalyse();
}
function pruneSums() { const keep = {}; (AN.ids || []).forEach(id => { if (AN.sums[id]) keep[id] = AN.sums[id]; }); AN.sums = keep; return keep; }

/* ---------- affichage ---------- */
const pct = v => Math.round(v * 100) + ' %';
function avg(arr, f) { const v = arr.map(f).filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function renderAnalyse() {
  const out = $('#anOut'); if (!out) return;
  const games = (AN.ids || []).map(id => AN.sums[id]).filter(Boolean);
  if (!games.length) { out.innerHTML = `<div class="card"><p>Aucune partie analysée pour l'instant.</p><p class="note">Appuie sur « Analyser mes parties » : l'app lit tes 15 dernières parties classées.</p></div>`; return; }
  const last = games[0], d = diagnose(last), meC = champIdByName(last.me.champ), opC = last.opp && champIdByName(last.opp.champ);
  const ago = h => { const m = Math.round((Date.now() - h) / 60000); return m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
  // tendances
  const sup = games.filter(g => g.pos === 'UTILITY');
  const G = sup.length ? sup : games;
  const axes = [
    { k: 'vspm', l: 'Vision / min', f: g => g.me.vspm, o: g => g.opp && g.opp.vspm, t: TARGET.vspm, fmt: v => v.toFixed(1), a: 'Trinket dès 2 charges, wards de quête à chaque sortie de base.' },
    { k: 'ctrl', l: 'Pinks / partie', f: g => g.me.ctrl, o: g => g.opp && g.opp.ctrl, t: TARGET.ctrl, fmt: v => v.toFixed(1), a: '1 pink à chaque retour, sans exception.' },
    { k: 'wkpm', l: 'Wards détruites / min', f: g => g.me.wkpm, o: g => g.opp && g.opp.wkpm, t: TARGET.wkpm, fmt: v => v.toFixed(2), a: 'Oracle vers 14:00 et pink dans les zones des objectifs.' },
    { k: 'kp', l: 'Participation kills', f: g => g.me.kp, o: g => g.opp && g.opp.kp, t: TARGET.kp, fmt: pct, a: 'Après la lane, reste groupé avec jungle/mid et arrive tôt aux objectifs.' },
    { k: 'deaths', l: 'Morts / partie', f: g => g.me.deaths, o: g => g.opp && g.opp.deaths, t: TARGET.deaths, fmt: v => v.toFixed(1), inv: 1, a: 'Pas de ward seul dans le brouillard, regarde la minimap avant d\'avancer.' },
    { k: 'early', l: 'Morts avant 14:00', f: g => g.early, o: () => null, t: TARGET.early, fmt: v => v.toFixed(1), inv: 1, a: 'Respecte les fenêtres de gank et ward 15 s avant.' },
    { k: 'roam', l: 'Min hors bot avant niv 5', f: g => g.roam, o: () => null, t: TARGET.roam, fmt: v => v.toFixed(1), inv: 1, a: 'Reste en lane jusqu\'au niveau 5 (pénalité de −33 % sinon).' },
    { k: 'prep', l: 'Objectifs préparés', f: g => g.me.prep.n ? g.me.prep.ok / g.me.prep.n : null, o: g => g.opp && g.opp.prep.n ? g.opp.prep.ok / g.opp.prep.n : null, t: TARGET.prep, fmt: pct, a: 'Vision 60-90 s avant chaque drake/larves/Héraut.' }
  ].map(x => { const v = avg(G, x.f), o = avg(G, x.o); const score = v == null ? 1 : x.inv ? (v <= x.t ? 1 : x.t / Math.max(v, 0.01)) : Math.min(1.2, v / x.t); return { ...x, v, o, score }; });
  const prio = axes.filter(x => x.v != null && x.score < 0.9).sort((a, b) => a.score - b.score).slice(0, 3);
  // champions & ADC
  const by = (f) => { const m = {}; G.forEach(g => { const k = f(g); if (!k) return; (m[k] = m[k] || { n: 0, w: 0 }); m[k].n++; if (g.win) m[k].w++; }); return Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 6); };
  const champs = by(g => g.me.champ), adcs = by(g => g.adc);
  const wins = G.filter(g => g.win).length;
  out.innerHTML = `
  <div class="card lastgame">
    <div class="row"><h3 class="grow">Dernière partie · ${ago(last.at)}</h3><span class="chip ${last.win ? 'good' : 'bad'}">${last.win ? 'Victoire' : 'Défaite'}</span></div>
    <div class="lg-head">${cimg(meC) ? `<img src="${cimg(meC)}" alt="">` : ''}<div class="grow"><b>${esc(cname(meC))}</b> <span class="num">${last.me.kda.join(' / ')}</span>
      <div class="note">${Math.round(last.dur)} min · côté ${last.side}${last.adc ? ' · avec ' + esc(cname(champIdByName(last.adc))) : ''}${opC ? ' · contre ' + esc(cname(opC)) + (last.eAdc ? ' + ' + esc(cname(champIdByName(last.eAdc))) : '') : ''}</div></div></div>
    ${last.pos !== 'UTILITY' ? '<p class="note">Tu n\'étais pas support dans cette partie : l\'analyse est moins précise.</p>' : ''}
    <div class="lbl-s">Ce que tu as raté</div>
    ${d.bad.length ? `<ul class="checks dont">${d.bad.slice(0, 5).map(x => `<li><b>${esc(x.t)}</b><br><span class="adv">${esc(x.a)}</span></li>`).join('')}</ul>` : '<p class="note">Rien de marquant, belle partie.</p>'}
    ${d.good.length ? `<div class="lbl-s">Bien joué</div><ul class="checks do">${d.good.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${last.deaths.length ? `<div class="lbl-s">Tes morts</div><div class="deaths">${last.deaths.map(x => `<div class="death"><b class="num">${fmt(x.t)}</b><span>${esc(x.tags.join(' · ') || 'en lane')}</span></div>`).join('')}</div>` : ''}
  </div>
  ${prio.length ? `<div class="card"><h3>Tes 3 priorités (${G.length} parties)</h3><ol class="prio">${prio.map(x => `<li><b>${esc(x.l)} : ${x.fmt(x.v)}</b> <span class="note">objectif ${x.fmt(x.t)}</span><br>${esc(x.a)}</li>`).join('')}</ol></div>` : ''}
  <div class="card"><h3>Toi vs supports adverses</h3>
    <div class="cmp"><div class="cmp-h"><span></span><span>Toi</span><span>Eux</span><span>Cible</span></div>
    ${axes.map(x => `<div class="cmp-r ${x.score < 0.9 ? 'low' : 'ok'}"><span>${esc(x.l)}</span><b class="num">${x.v == null ? '–' : x.fmt(x.v)}</b><span class="num">${x.o == null ? '–' : x.fmt(x.o)}</span><span class="num">${x.fmt(x.t)}</span></div>`).join('')}</div>
    <p class="note">Rouge = sous l'objectif. « Eux » = moyenne des supports que tu as affrontés.</p></div>
  <div class="card"><h3>Tes supports · ${wins}V ${G.length - wins}D</h3>
    <div class="wr">${champs.map(([c, s]) => wrRow(c, s)).join('')}</div>
    ${adcs.length ? `<h3 style="margin-top:6px">Avec tes ADC</h3><div class="wr">${adcs.map(([c, s]) => wrRow(c, s)).join('')}</div>` : ''}</div>`;
}
function wrRow(c, s) { const id = champIdByName(c), w = Math.round(s.w / s.n * 100); return `<div class="wr-r">${cimg(id) ? `<img src="${cimg(id)}" alt="">` : ''}<span class="grow">${esc(cname(id))}</span><span class="num note">${s.n} p.</span><b class="num ${w >= 50 ? 'pos' : 'neg'}">${w} %</b></div>`; }
