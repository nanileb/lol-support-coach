/* Coach Support — analyse.js : analyse des parties passées (match-v5 + timeline via le relais).
   Utilise les globales d'app.js (S, RELAY, $, esc, cname, cimg, iimg, LS, fmt, toast). */
'use strict';

const AN = { busy: false, sums: LS.get('an_sums', {}), ids: LS.get('an_ids', []), updated: LS.get('an_updated', 0) };
const TARGET = { vspm: 2.2, wpm: 0.9, ctrl: 4, wkpm: 0.2, kp: 0.55, deaths: 5, early: 1, roam: 1.5, prep: 0.6 };
// Objectifs par poste (ordre de grandeur d'un bon joueur en haut elo)
const TARGETS = {
  support: TARGET,
  adc: { vspm: 0.9, ctrl: 2, kp: 0.5, deaths: 4.5, early: 1, cs10: 75, csm: 8, dmg: 0.27, gold14: 0 },
  mid: { vspm: 0.9, ctrl: 2, kp: 0.5, deaths: 4.5, early: 1, cs10: 72, csm: 7.8, dmg: 0.26, gold14: 0 },
  top: { vspm: 0.8, ctrl: 2, kp: 0.4, deaths: 4.5, early: 1, cs10: 68, csm: 7.3, dmg: 0.22, gold14: 0 },
  jungle: { vspm: 1.3, ctrl: 3, kp: 0.6, deaths: 5, early: 1, csm: 5.5, obj: 0.55, early3: 3, gold14: 0 }
};
// Références réelles : médianes des joueurs Challenger / GM à ce poste (builds.json), sinon valeurs par défaut
function targetsFor(role) {
  const base = Object.assign({}, TARGETS[role]), r = S.builds && S.builds.targets && S.builds.targets[POS[role]];
  if (r) ['csm', 'vspm', 'ctrl', 'wkpm', 'deaths', 'kp', 'dmg'].forEach(k => { if (r[k] != null && (k in base || k === 'wkpm')) base[k] = r[k]; });
  return base;
}
const POS_ROLE = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };
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
  const opp = P.find(p => p.teamId !== myT && p.teamPosition === (me.teamPosition || 'UTILITY'));
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
    // cause probable et ce qu'il fallait faire
    let fix = 'Regarde la minimap avant d\'avancer : sans vision sur leur jungler, reste derrière ta vague.';
    if (inv.length >= 3) fix = `À ${inv.length} contre toi : recule dès que plusieurs adversaires disparaissent de la carte.`;
    if (tags.some(x => x.startsWith('gank'))) fix = 'Gank : ward la rivière ou le tri-bush avant ses fenêtres de gank (onglet Timings) et garde ton Flash.';
    if (tags.some(x => x.startsWith('juste avant'))) fix = 'Avant un objectif, avance en groupe et pose la vision avec un allié, jamais seul dans le brouillard.';
    if (tags.includes('jungle/zone adverse')) fix = 'Isolé chez eux : n\'y va qu\'avec un allié et repars dès que la ward est posée.';
    return { t, tags, n: inv.length, fix };
  });
  const items = ev.filter(e => e.type === 'ITEM_PURCHASED' && e.participantId === pid);
  const firstBig = items.find(e => S.items && S.items[e.itemId] && S.items[e.itemId].gold >= 2000 && !(S.items[e.itemId].from || []).includes('1001'));
  const oracle = items.find(e => e.itemId === 3364);
  const ctrlPlaced = wardsBy(pid).filter(w => w.wardType === 'CONTROL_WARD').length;
  const stat = p => !p ? null : {
    champ: p.championName, vspm: p.visionScore / dur, wpm: p.wardsPlaced / dur, wkpm: p.wardsKilled / dur,
    ctrl: p.visionWardsBoughtInGame, kp: p.challenges.killParticipation != null ? p.challenges.killParticipation : null,
    deaths: p.deaths, kda: [p.kills, p.deaths, p.assists], lvl2: lvl2(p.participantId), gold14: goldAt(p.participantId, 14),
    prep: prepOf(p.participantId), heal: (p.totalHealsOnTeammates || 0) + (p.totalDamageShieldedOnTeammates || 0), cc: p.timeCCingOthers,
    cs10: (() => { const f = fr[10]; return f && f.p[p.participantId] ? (f.p[p.participantId].cs || 0) + (f.p[p.participantId].jg || 0) : null; })(),
    csm: ((p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0)) / dur, jgm: (p.neutralMinionsKilled || 0) / dur,
    dmg: p.challenges.teamDamagePercentage != null ? p.challenges.teamDamagePercentage : null,
    early3: p.challenges.takedownsFirstXMinutes != null ? p.challenges.takedownsFirstXMinutes : null
  };
  const teamObj = (() => { const o = ev.filter(e => e.type === 'ELITE_MONSTER_KILL' && ['DRAGON', 'HORDE', 'RIFTHERALD', 'BARON_NASHOR'].includes(e.monsterType)), wt = e => e.monsterType === 'HORDE' ? 1 / 3 : 1, tot = o.reduce((a, e) => a + wt(e), 0); return tot ? o.filter(e => e.killerTeamId === myT).reduce((a, e) => a + wt(e), 0) / tot : null; })();
  return {
    id: m.id, at: m.gameCreation, dur, win: me.win, pos: me.teamPosition, side: myT === 100 ? 'bleu' : 'rouge',
    me: stat(me), opp: stat(opp), adc: adc && adc.championName, eAdc: (P.find(p => p.teamId !== myT && p.teamPosition === 'BOTTOM') || {}).championName,
    eJg: eJg && eJg.championName, roam, l5, deaths, early: deaths.filter(d => d.t < 840).length,
    ctrlPlaced, firstItem: firstBig ? firstBig.t / 1000 : null, oracle: oracle ? oracle.t / 1000 : null,
    queue: m.queueId, teamObj, v: 3,
    bought: items.filter(e => S.items && S.items[e.itemId] && S.items[e.itemId].gold >= 2000).map(e => String(e.itemId)).filter((x, i, a) => a.indexOf(x) === i),
    foes: P.filter(p => p.teamId !== myT).map(p => p.championName)
  };
}

/* ---------- diagnostic ---------- */
function diagnose(g) {
  const role = POS_ROLE[g.pos] || 'support';
  if (role !== 'support') return groupCauses(diagnoseRole(g, role), g, role);
  const bad = [], good = [], me = g.me, op = g.opp, TARGET = targetsFor('support');
  const vsOpp = (k, f = 1) => op && op[k] != null ? ` (${cname(champIdByName(op.champ))} : ${(op[k] * f).toFixed(k === 'kp' ? 0 : 1)}${k === 'kp' ? ' %' : ''})` : '';
  if (me.vspm < TARGET.vspm * 0.85) bad.push({ w: 3, k: 'vspm', t: `Vision sous la médiane Challenger (${TARGET.vspm.toFixed(1)}/min) : ${me.vspm.toFixed(1)}/min${vsOpp('vspm')}`, a: 'Utilise ton trinket dès qu\'il a 2 charges et pose tes wards de quête à chaque sortie de base.' });
  else good.push(`Bonne vision : ${me.vspm.toFixed(1)}/min${vsOpp('vspm')}`);
  if (me.ctrl < Math.min(TARGET.ctrl, Math.round(g.dur / 7))) bad.push({ w: 2, k: 'ctrl', t: `Seulement ${me.ctrl} pink${me.ctrl > 1 ? 's' : ''} achetée${me.ctrl > 1 ? 's' : ''}`, a: '1 pink à chaque retour, toujours. Avec la quête finie, elle coûte 40 po.' });
  if (me.wkpm < TARGET.wkpm * 0.7) bad.push({ w: 1, k: 'wkpm', t: `Peu de wards adverses détruites (${Math.round(me.wkpm * g.dur)})`, a: 'Passe à l\'Oracle après la phase de lane et nettoie avant chaque objectif.' });
  if (!g.oracle || g.oracle > 1200) bad.push({ w: 1, t: g.oracle ? `Oracle pris tard (${fmt(g.oracle)})` : 'Jamais passé à l\'Oracle (balayeur)', a: 'Échange ton trinket vers 14:00, à la fin de la phase de lane.' });
  if (me.kp != null && me.kp < TARGET.kp) bad.push({ w: 2, k: 'kp', t: `Participation aux kills : ${Math.round(me.kp * 100)} %${vsOpp('kp', 100)}`, a: 'Après 14:00, colle ton jungler/mid et sois là pour chaque objectif.' });
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
  // soins / boucliers pour les enchanteurs, contrôles pour les engages
  const arch = supProfile(champIdByName(me.champ)).arch, permin = v => v / g.dur;
  if (arch === 'enchanter' && me.heal != null) { const v = permin(me.heal), o = op && op.heal != null ? permin(op.heal) : null; if (o != null && v < o * 0.7) bad.push({ w: 1, t: `Soins et boucliers : ${Math.round(v)}/min (${cname(champIdByName(op.champ))} : ${Math.round(o)})`, a: 'Garde tes soins et boucliers pour les trades de ton ADC, pas pour toi.' }); else if (v) good.push(`Soins et boucliers : ${Math.round(v)}/min`); }
  if (arch === 'engage' && me.cc != null) { const v = permin(me.cc), o = op && op.cc != null ? permin(op.cc) : null; if (o != null && v < o * 0.7) bad.push({ w: 1, t: `Temps de contrôle : ${v.toFixed(1)} s/min (${cname(champIdByName(op.champ))} : ${o.toFixed(1)})`, a: 'Engage plus souvent quand leur sort défensif est tombé : ton rôle est de créer les combats.' }); else if (v) good.push(`Temps de contrôle : ${v.toFixed(1)} s/min`); }
  return groupCauses({ bad: bad.sort((a, b) => b.w - a.w), good }, g, role);
}

// Regroupe les reproches par cause racine (morts / farm / vision / build) : un seul point par cause, le plus grave en premier.
function groupCauses(d, g, role) {
  // build réel : anti-soins oubliés contre des soigneurs
  if (g.bought && g.foes) {
    const healers = g.foes.map(champIdByName).filter(c => inList('healers', c));
    const gw = g.bought.some(id => S.items && S.items[id] && S.items[id].gw);
    if (healers.length >= 2 && !gw) d.bad.push({ w: 2, t: `Pas d'anti-soins contre ${healers.map(cname).join(', ')}`, a: 'Achète le composant anti-soins (800 po) dès le 2e retour contre 2 soigneurs ou plus.', c: 'build' });
  }
  // Un axe sous la médiane Challenger mais où tu fais mieux que ton adversaire direct n'est jamais prioritaire
  const op = g.opp, me = g.me;
  d.bad.forEach(x => {
    if (!x.k || !op || op[x.k] == null || me[x.k] == null || me[x.k] < op[x.k]) return;
    x.w = Math.min(x.w, 1); x.beat = true; x.t += ` · mieux que ${cname(champIdByName(op.champ))}`;
  });
  const cause = x => x.c || (/mort/i.test(x.t) ? 'morts' : /sbires|po de retard|objet complété/i.test(x.t) ? 'farm' : /vision|ward|pink|oracle/i.test(x.t) ? 'vision' : x.t);
  const groups = {};
  d.bad.forEach(x => { const k = cause(x); (groups[k] = groups[k] || []).push(x); });
  d.bad = Object.values(groups).map(l => { l.sort((a, b) => b.w - a.w); const top = l[0]; return l.length === 1 ? top : { w: top.w + 0.5 * (l.length - 1), t: top.t, a: top.a + ' Lié : ' + l.slice(1).map(x => x.t.charAt(0).toLowerCase() + x.t.slice(1)).join(' · ') + '.', beat: l.every(x => x.beat) }; }).sort((a, b) => (a.beat ? 1 : 0) - (b.beat ? 1 : 0) || b.w - a.w);
  return d;
}
function diagnoseRole(g, role) {
  const bad = [], good = [], me = g.me, op = g.opp, T = targetsFor(role), on = op ? cname(champIdByName(op.champ)) : 'ton adversaire';
  const lane = role !== 'jungle';
  if (lane && me.cs10 != null) {
    if (me.cs10 < T.cs10 * 0.85) bad.push({ w: 3, k: 'cs10', t: `${me.cs10} sbires à 10:00${op && op.cs10 != null ? ` (${on} : ${op.cs10})` : ''}`, a: `Objectif ≈ ${T.cs10}. Last-hit avant de trade, et rentre quand ta vague arrive à ta tour plutôt qu'au milieu.` });
    else good.push(`Bon farm en lane : ${me.cs10} sbires à 10:00`);
  }
  if (me.csm < T.csm * 0.85) bad.push({ w: 2, k: 'csm', t: `${me.csm.toFixed(1)} sbires / min sur la partie`, a: lane ? 'Après 14:00, prends les vagues de côté entre deux objectifs au lieu d\'attendre au milieu.' : 'Enchaîne tes camps entre les ganks : un jungler qui ne farm pas prend du retard sur tout le monde.' });
  if (op && me.gold14 != null && op.gold14 != null) {
    const d = me.gold14 - op.gold14;
    if (d < -500) bad.push({ w: 3, t: `${-d} po de retard sur ${on} à 14:00`, a: lane ? 'Morts, sbires ratés ou plaques perdues : regarde laquelle de ces raisons revient le plus.' : 'Il a plus farmé ou plus participé : compare vos chemins de jungle.' });
    else if (d > 500) good.push(`${d} po d'avance sur ${on} à 14:00`);
  }
  if (lane && me.dmg != null) {
    if (me.dmg < T.dmg * 0.8) bad.push({ w: 2, k: 'dmg', t: `${Math.round(me.dmg * 100)} % des dégâts de ton équipe`, a: role === 'adc' ? 'En combat, place-toi pour taper sans arrêt la cible la plus proche plutôt que de chercher le carry.' : 'Participe aux combats avec tes sorts principaux, pas seulement en fin de combat.' });
    else good.push(`${Math.round(me.dmg * 100)} % des dégâts de ton équipe`);
  }
  if (role === 'jungle') {
    if (g.teamObj != null) { if (g.teamObj < T.obj * 0.8) bad.push({ w: 3, t: `Ton équipe a pris ${Math.round(g.teamObj * 100)} % des objectifs`, a: 'Prépare chaque drake et les larves 1 minute avant, avec la priorité de tes lanes.' }); else good.push(`${Math.round(g.teamObj * 100)} % des objectifs pour ton équipe`); }
    if (me.early3 != null && me.early3 < 2) bad.push({ w: 2, t: `${me.early3} kill${me.early3 > 1 ? 's' : ''} ou assist en début de partie`, a: 'Cherche un gank après ton premier tour de jungle, sur la lane la plus prête.' });
  }
  if (me.kp != null && me.kp < T.kp) bad.push({ w: 2, k: 'kp', t: `Participation aux kills : ${Math.round(me.kp * 100)} %`, a: role === 'top' ? 'Garde ta Téléportation pour les combats de drake et de larves.' : 'Après 14:00, reste groupé et sois là pour chaque objectif.' });
  else if (me.kp != null) good.push(`Participation aux kills : ${Math.round(me.kp * 100)} %`);
  if (g.early > T.early) bad.push({ w: 3, t: `${g.early} morts avant 14:00`, a: 'Regarde la minimap avant chaque avancée : sans vision sur leur jungler, tu ne pousses pas.' });
  const ganks = g.deaths.filter(d => d.tags.some(x => x.startsWith('gank'))).length;
  if (lane && ganks >= 2) bad.push({ w: 2, t: `${ganks} morts sur des ganks de ${cname(champIdByName(g.eJg))}`, a: 'Pose ton trinket avant ses fenêtres de gank (onglet Timings).' });
  const preObj = g.deaths.filter(d => d.tags.some(x => x.startsWith('juste avant'))).length;
  if (preObj) bad.push({ w: 2, t: `${preObj} mort${preObj > 1 ? 's' : ''} juste avant un objectif adverse`, a: 'Avant un objectif, avance en groupe et jamais seul dans le brouillard.' });
  if (me.vspm < T.vspm * 0.75) bad.push({ w: 1, k: 'vspm', t: `Vision sous la médiane Challenger (${T.vspm.toFixed(1)}/min) : ${me.vspm.toFixed(1)}/min`, a: 'Utilise ton trinket dès qu\'il est prêt et achète une pink à chaque retour.' });
  if (me.ctrl < Math.min(T.ctrl, Math.round(g.dur / 10))) bad.push({ w: 1, k: 'ctrl', t: `${me.ctrl} pink${me.ctrl > 1 ? 's' : ''} achetée${me.ctrl > 1 ? 's' : ''}`, a: 'Une pink à chaque retour, dans un buisson près de ta lane ou d\'un objectif.' });
  if (g.firstItem && g.firstItem > ({ adc: 810, mid: 900, top: 870, jungle: 870 }[role] || 840)) bad.push({ w: 1, t: `1er objet complété tard (${fmt(g.firstItem)})`, a: 'Rentre quand tu as l\'or d\'un composant important, ne garde pas l\'or sur toi.' });
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
    const r = await fetch(`${base}/matches?${q}&count=60`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 404 && j.error === 'not_found' ? 'old_relay' : r.status === 403 ? 'key' : r.status === 429 ? 'rate' : 'err');
    AN.puuid = j.puuid; AN.ids = j.ids; LS.set('an_ids', AN.ids);
    // On ne garde que les parties jouées au poste choisi : on parcourt l'historique jusqu'à en trouver 15.
    const RP = POS[myRole()], WANT = 15, MAXNEW = 40;
    let n = 0, found = 0;
    for (const id of AN.ids) {
      if (found >= WANT) break;
      const c = AN.sums[id];
      if (c && c.v === 3 && !force) { if (c.pos === RP) found++; continue; }
      if (n >= MAXNEW) break;
      st.textContent = `Recherche de tes parties en ${ROLE_FR[myRole()]}… ${found}/${WANT}`; n++;
      const mr = await fetch(`${base}/match?id=${id}&platform=${S.settings.platform}`);
      if (mr.status === 429) { await new Promise(res => setTimeout(res, 3000)); continue; }
      if (!mr.ok) continue;
      const s = summarize(await mr.json(), AN.puuid); if (s) { AN.sums[id] = s; if (s.pos === RP) found++; }
      LS.set('an_sums', pruneSums()); renderAnalyse();
    }
    AN.updated = Date.now(); LS.set('an_updated', AN.updated); AN.role = myRole();
    st.className = 'status ok'; st.textContent = found ? `${found} partie${found > 1 ? 's' : ''} classée${found > 1 ? 's' : ''} en ${ROLE_FR[myRole()]} analysée${found > 1 ? 's' : ''}.` : `Aucune partie classée en ${ROLE_FR[myRole()]} dans tes ${AN.ids.length} dernières parties.`;
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
  const all = (AN.ids || []).map(id => AN.sums[id]).filter(Boolean);
  const games = all.filter(g => g.pos === POS[myRole()]).slice(0, 15);
  if (!games.length) { out.innerHTML = `<div class="card"><p>${all.length ? `Aucune partie en ${ROLE_FR[myRole()]} parmi tes parties analysées.` : 'Aucune partie analysée pour l\'instant.'}</p><p class="note">Appuie sur « Analyser mes parties » : l'app cherche tes 15 dernières parties classées (solo et flex) jouées en ${ROLE_FR[myRole()]}. Les parties à d'autres postes sont ignorées.</p></div>`; return; }
  const last = games[0], d = diagnose(last), meC = champIdByName(last.me.champ), opC = last.opp && champIdByName(last.opp.champ);
  const ago = h => { const m = Math.round((Date.now() - h) / 60000); return m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
  // tendances
  const role = myRole(), RP = POS[role], T = targetsFor(role);
  const mine = games, G = games;
  const R = x => (x.roles || ['support']).includes(role);
  const axes = [
    { k: 'cs10', roles: ['adc', 'mid', 'top'], l: 'Sbires à 10:00', f: g => g.me.cs10, o: g => g.opp && g.opp.cs10, t: T.cs10, fmt: v => v.toFixed(0), a: 'Last-hit avant de trade, et entraîne-toi en partie personnalisée.' },
    { k: 'csm', roles: ['adc', 'mid', 'top', 'jungle'], l: 'Sbires / min', f: g => g.me.csm, o: g => g.opp && g.opp.csm, t: T.csm, fmt: v => v.toFixed(1), a: 'Prends les vagues de côté entre deux objectifs.' },
    { k: 'gold14', roles: ['adc', 'mid', 'top', 'jungle'], l: 'Écart d\'or à 14:00', f: g => g.me.gold14 != null && g.opp && g.opp.gold14 != null ? g.me.gold14 - g.opp.gold14 : null, o: () => null, t: 0, fmt: v => (v > 0 ? '+' : '') + Math.round(v), diff: 1, a: 'Moins de morts en lane et plus de sbires.' },
    { k: 'dmg', roles: ['adc', 'mid', 'top'], l: 'Part des dégâts', f: g => g.me.dmg, o: g => g.opp && g.opp.dmg, t: T.dmg, fmt: pct, a: 'Reste dans le combat du début à la fin, à bonne distance.' },
    { k: 'obj', roles: ['jungle'], l: 'Objectifs pris', f: g => g.teamObj, o: () => null, t: T.obj, fmt: pct, a: 'Prépare chaque objectif 1 minute avant.' },
    { k: 'vspm', roles: ['support', 'adc', 'mid', 'top', 'jungle'], l: 'Vision / min', f: g => g.me.vspm, o: g => g.opp && g.opp.vspm, t: T.vspm, fmt: v => v.toFixed(1), a: role === 'support' ? 'Trinket dès 2 charges, wards de quête à chaque sortie de base.' : 'Trinket dès qu\'il est prêt, pink à chaque retour.' },
    { k: 'ctrl', roles: ['support', 'adc', 'mid', 'top', 'jungle'], l: 'Pinks / partie', f: g => g.me.ctrl, o: g => g.opp && g.opp.ctrl, t: T.ctrl, fmt: v => v.toFixed(1), a: '1 pink à chaque retour.' },
    { k: 'wkpm', l: 'Wards détruites / min', f: g => g.me.wkpm, o: g => g.opp && g.opp.wkpm, t: T.wkpm || TARGET.wkpm, fmt: v => v.toFixed(2), a: 'Oracle vers 14:00 et pink dans les zones des objectifs.' },
    { k: 'kp', roles: ['support', 'adc', 'mid', 'top', 'jungle'], l: 'Participation kills', f: g => g.me.kp, o: g => g.opp && g.opp.kp, t: T.kp, fmt: pct, a: 'Après la lane, reste groupé et arrive tôt aux objectifs.' },
    { k: 'deaths', roles: ['support', 'adc', 'mid', 'top', 'jungle'], l: 'Morts / partie', f: g => g.me.deaths, o: g => g.opp && g.opp.deaths, t: T.deaths, fmt: v => v.toFixed(1), inv: 1, a: 'Pas d\'avancée sans vision, regarde la minimap.' },
    { k: 'early', roles: ['support', 'adc', 'mid', 'top', 'jungle'], l: 'Morts avant 14:00', f: g => g.early, o: () => null, t: T.early, fmt: v => v.toFixed(1), inv: 1, a: 'Respecte les fenêtres de gank (onglet Timings).' },
    { k: 'roam', l: 'Min hors bot avant niv 5', f: g => g.roam, o: () => null, t: TARGET.roam, fmt: v => v.toFixed(1), inv: 1, a: 'Reste en lane jusqu\'au niveau 5 (pénalité de −33 % sinon).' },
    { k: 'prep', l: 'Objectifs préparés', f: g => g.me.prep.n ? g.me.prep.ok / g.me.prep.n : null, o: g => g.opp && g.opp.prep.n ? g.opp.prep.ok / g.opp.prep.n : null, t: TARGET.prep, fmt: pct, a: 'Vision 60-90 s avant chaque drake/larves/Héraut.' }
  ].filter(R).map(x => { const v = avg(G, x.f), o = avg(G, x.o); const score = v == null ? 1 : x.diff ? (v >= -150 ? 1 : Math.max(0.3, 1 + v / 1500)) : x.inv ? (v <= x.t ? 1 : x.t / Math.max(v, 0.01)) : Math.min(1.2, v / x.t); return { ...x, v, o, score }; });
  // un axe où tu fais mieux que tes adversaires directs passe après les autres (même sous la médiane Challenger)
  const beats = x => x.o != null && (x.inv ? x.v <= x.o : x.v >= x.o);
  const prio = axes.filter(x => x.v != null && x.score < 0.9).sort((a, b) => (beats(a) ? 1 : 0) - (beats(b) ? 1 : 0) || a.score - b.score).slice(0, 3);
  // champions & ADC
  const by = (f) => { const m = {}; G.forEach(g => { const k = f(g); if (!k) return; (m[k] = m[k] || { n: 0, w: 0 }); m[k].n++; if (g.win) m[k].w++; }); return Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 6); };
  const champs = by(g => g.me.champ), adcs = role === 'support' ? by(g => g.adc) : [];
  const wins = G.filter(g => g.win).length;
  out.innerHTML = `
  <div class="card lastgame">
    <div class="row"><h3 class="grow">Dernière partie · ${ago(last.at)}</h3><span class="chip ${last.win ? 'good' : 'bad'}">${last.win ? 'Victoire' : 'Défaite'}</span></div>
    <div class="lg-head">${cimg(meC) ? `<img src="${cimg(meC)}" alt="">` : ''}<div class="grow"><b>${esc(cname(meC))}</b> <span class="num">${last.me.kda.join(' / ')}</span>
      <div class="note">${Math.round(last.dur)} min · côté ${last.side}${last.adc ? ' · avec ' + esc(cname(champIdByName(last.adc))) : ''}${opC ? ' · contre ' + esc(cname(opC)) + (last.eAdc ? ' + ' + esc(cname(champIdByName(last.eAdc))) : '') : ''}</div></div></div>
    <div class="lbl-s">Ce que tu as raté</div>
    ${d.bad.length ? `<ul class="checks dont">${d.bad.slice(0, 5).map(x => `<li><b>${esc(x.t)}</b><br><span class="adv">${esc(x.a)}</span></li>`).join('')}</ul>` : '<p class="note">Rien de marquant, belle partie.</p>'}
    ${d.good.length ? `<div class="lbl-s">Bien joué</div><ul class="checks do">${d.good.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${last.deaths.length ? `<div class="lbl-s">Tes morts</div><div class="deaths">${last.deaths.map(x => `<div class="death"><b class="num">${fmt(x.t)}</b><span>${esc(x.tags.join(' · ') || 'en lane')}${x.fix ? `<br><small class="note">${esc(x.fix)}</small>` : ''}</span></div>`).join('')}</div>` : ''}
  </div>
  ${prio.length ? `<div class="card"><h3>Tes 3 priorités (${G.length} parties)</h3><ol class="prio">${prio.map(x => `<li><b>${esc(x.l)} : ${x.fmt(x.v)}</b> <span class="note">objectif ${x.fmt(x.t)}</span><br>${esc(x.a)}</li>`).join('')}</ol></div>` : ''}
  <div class="card"><h3>Toi vs ${role === 'jungle' ? 'junglers' : ROLE_FR[role] + 's'} adverses</h3>
    <div class="cmp"><div class="cmp-h"><span></span><span>Toi</span><span>Eux</span><span>Cible</span></div>
    ${axes.map(x => `<div class="cmp-r ${x.score < 0.9 ? 'low' : 'ok'}"><span>${esc(x.l)}</span><b class="num">${x.v == null ? '–' : x.fmt(x.v)}</b><span class="num">${x.o == null ? '–' : x.fmt(x.o)}</span><span class="num">${x.fmt(x.t)}</span></div>`).join('')}</div>
    <p class="note">Rouge = sous l'objectif. « Eux » = moyenne de tes adversaires directs. ${S.builds && S.builds.targets ? '« Cible » = médiane des joueurs Challenger / GM à ce poste.' : ''} Uniquement tes ${mine.length} dernières parties en ${ROLE_FR[role]}.</p></div>
  <div class="card"><h3>Tes champions ${ROLE_FR[role]} · ${wins}V ${G.length - wins}D</h3>
    <div class="wr">${champs.map(([c, s]) => wrRow(c, s)).join('')}</div>
    ${adcs.length ? `<h3 style="margin-top:6px">Avec tes ADC</h3><div class="wr">${adcs.map(([c, s]) => wrRow(c, s)).join('')}</div>` : ''}</div>`;
}
function wrRow(c, s) { const id = champIdByName(c), w = Math.round(s.w / s.n * 100); return `<div class="wr-r">${cimg(id) ? `<img src="${cimg(id)}" alt="">` : ''}<span class="grow">${esc(cname(id))}</span><span class="num note">${s.n} p.</span><b class="num ${w >= 50 ? 'pos' : 'neg'}">${w} %</b></div>`; }
