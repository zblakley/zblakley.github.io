/* Kingmaker — computer-controlled factions. Acts only through the public engine API, one action per step. */
(function () {
  const KM = (globalThis.KM = globalThis.KM || {});
  const AI = (KM.AI = {});
  const E = () => KM.Engine;
  const SEA_ONLY = new Proxy({}, { get: (t, area) => !!(KM.A[area] && (KM.A[area].flags || []).includes('island')) });

  function groups(s, p) { // forces by exact location
    const m = {};
    for (const n of E().playerNobles(s, p)) { const k = n.area + '|' + (n.inside || ''); (m[k] = m[k] || { area: n.area, inside: n.inside, nobles: [] }).nobles.push(n); }
    return Object.values(m).map(g => Object.assign(g, { str: E().stackStrength(s, g.nobles) })).sort((a, b) => b.str - a.str);
  }
  function areaForces(s, p) { const m = {}; for (const n of E().playerNobles(s, p)) (m[n.area] = m[n.area] || []).push(n); return m; }
  function lead(s, p) { const g = groups(s, p)[0]; return g ? g.nobles.slice().sort((a, b) => E().strength(s, b) - E().strength(s, a))[0] : null; }
  const canCrownFaction = (s, p) => { const bs = E().playerNobles(s, p).reduce((t, n) => t.concat(n.bishops), []); return bs.some(b => KM.CARD[b].arch) || bs.length >= 2; };
  function myHouse(s, p) {
    const mine = E().aliveHeirs(s).filter(h => h.ctrl === p); if (!mine.length) return null;
    const score = house => { const hs = mine.filter(h => KM.HEIR[h.id].house === house); if (!hs.length) return -1; const sen = E().seniorHeir(s, house); return hs.length + (sen && sen.ctrl === p ? 3 : 0) + (hs.some(h => h.crowned) ? 4 : 0); };
    return score('lancaster') >= score('york') ? (score('lancaster') >= 0 ? 'lancaster' : 'york') : 'york';
  }

  // ----- setup -----
  AI.muster = function (s, p) {
    const pl = s.players[p]; let guard = 0;
    while (guard++ < 60) { if (!AI.playOne(s, p, true)) break; }
    return E().finishMuster(s, p);
  };
  // play one card from hand; returns description or null
  AI.playOne = function (s, p, setup) {
    const pl = s.players[p]; const order = { noble: 0, title: 1, office: 2, bishop: 3, merc: 4, town: 5, ship: 6 };
    const hand = pl.hand.slice().sort((a, b) => order[KM.CARD[a].kind] - order[KM.CARD[b].kind]);
    for (const id of hand) {
      const c = KM.CARD[id]; const t = E().cardTargets(s, p, id); if (!t.length) continue;
      let target;
      if (c.kind === 'noble') {
        const mine = E().playerNobles(s, p);
        const ref = mine.length ? groups(s, p)[0].area : KM.P.coventry.area;
        target = t.slice().sort((a, b) => dland(KM.P[a].area, ref) - dland(KM.P[b].area, ref))[0];
      } else {
        const ns = t.map(x => s.nobles[x]);
        if (c.kind === 'title' || c.kind === 'office') target = ns.sort((a, b) => KM.CARD[b.id].troops - KM.CARD[a.id].troops)[0].id;
        else { const L = lead(s, p); target = L && t.includes(L.id) ? L.id : ns.sort((a, b) => E().strength(s, b) - E().strength(s, a))[0].id; }
      }
      const r = E().playCard(s, p, id, target);
      if (r.ok) return { kind: 'card', card: id, target };
    }
    return null;
  };
  function dland(a, b) { const d = E().dist(a, b); return d === Infinity ? 60 : d; }

  // ----- objectives -----
  function shipCap(s, p) { return E().playerShips(s, p).reduce((m, sh) => m + sh.cap, 0); }
  AI.objective = function (s, p) {
    const total = E().factionStrength(s, p); const gs = groups(s, p); if (!gs.length) return null;
    const home = gs[0].area; const cap = shipCap(s, p); const out = [];
    const reach = (area, need) => { if (SEA_ONLY[area] || SEA_ONLY[home]) { if (SEA_ONLY[area] && area === home) return 0; return cap >= Math.max(need, 1) && cap >= Math.min(total, cap) ? 12 : Infinity; } return dland(home, area); };
    const house = myHouse(s, p);
    for (const h of E().aliveHeirs(s)) {
      if (h.ctrl === p) continue;
      let need, kind;
      if (h.inside) { need = KM.P[h.inside].garrison + E().stackStrength(s, Object.values(s.nobles).filter(n => n.inside === h.inside)); kind = 'siege'; }
      else if (h.ctrl === null) { need = 1; kind = 'pickup'; }
      else { need = Math.ceil(E().stackStrength(s, E().noblesAt(s, h, h.ctrl)) * 1.5); kind = 'battle'; }
      const d = reach(h.area, need); if (d === Infinity || total < need) continue;
      if (SEA_ONLY[h.area] && cap < need) continue;
      out.push({ area: h.area, place: h.inside, kind, need, value: 100 - d * 3 + (h.crowned ? 25 : 0) + (KM.HEIR[h.id].rank === 1 ? 10 : 0) - need / 20 });
    }
    // crown my senior heir
    if (house) {
      const sen = E().seniorHeir(s, house);
      if (sen && sen.ctrl === p && !sen.crowned && canCrownFaction(s, p)) {
        for (const pl of KM.MAP.places) { if (!pl.cathedral) continue; const fr = E().isFriendly(s, pl.id, p); const need = fr ? 0 : pl.garrison + E().stackStrength(s, Object.values(s.nobles).filter(n => n.inside === pl.id)); const d = reach(pl.area, need); if (d === Infinity || total < need) continue; out.push({ area: pl.area, place: pl.id, kind: fr ? 'enter' : 'siege', need, value: 95 - d * 3 - need / 20, crown: true }); }
      }
    }
    // to crown my claimant I need an Archbishop or two Bishops: take them from whoever holds them
    const needBishops = house && !canCrownFaction(s, p);
    // weak enemies in the open
    for (const q of s.players) {
      if (q.id === p) continue;
      for (const g of groups(s, q.id)) { if (g.inside || SEA_ONLY[g.area] || g.area === 'scotland') continue; const need = Math.ceil(g.str * 2); if (total < need) continue; const d = reach(g.area, need); if (d === Infinity) continue; const bish = g.nobles.reduce((t, n) => t + n.bishops.length, 0); out.push({ area: g.area, kind: 'battle', foe: q.id, need, value: 45 - d * 3 + g.nobles.length * 4 + (needBishops && bish ? 50 : 0) }); }
    }
    // take a useful walled place when idle and very strong
    for (const pl of KM.MAP.places) { if (!['town', 'city'].includes(pl.type) || E().isFriendly(s, pl.id, p) || SEA_ONLY[pl.area]) continue; const need = pl.garrison + E().stackStrength(s, Object.values(s.nobles).filter(n => n.inside === pl.id)); if (total < need * 1.2) continue; const d = dland(home, pl.area); out.push({ area: pl.area, place: pl.id, kind: 'siege', need, value: 22 - d * 3 + (pl.cathedral ? 5 : 0) }); }
    out.sort((a, b) => b.value - a.value);
    return out[0] || null;
  };

  // choose where a force should go this turn to get nearer `target`; returns a dest for Engine.move or null
  function stepToward(s, p, ids, target) {
    const opt = E().moveOptions(s, p, ids); if (opt.error) return null;
    const here = s.nobles[ids[0]].area; if (here === target) return null;
    const land = E().dist(here, target);
    if (land !== Infinity && !SEA_ONLY[target]) {
      let best = null, bd = land, bs = 99;
      for (const via of ['land', 'road']) for (const [a, o] of Object.entries(opt[via])) { if (a === 'scotland' && target !== 'scotland') continue; const d = E().dist(a, target); if (d < bd || (d === bd && best && o.steps < bs)) { bd = d; bs = o.steps; best = { area: a, via }; } }
      return best;
    }
    // need the sea
    const tgtPorts = KM.A[target].places.filter(pl => KM.P[pl].port);
    const sea = opt.sea.filter(o => o.fits && o.canLand);
    if (sea.length && tgtPorts.length) {
      const direct = sea.find(o => o.area === target); if (direct) return { area: target, via: 'sea', ship: direct.ship, port: direct.port };
      const dT = E().seaDistances(tgtPorts[0], 40); let best = null, bd = Infinity;
      for (const o of sea) { if (SEA_ONLY[o.area]) continue; const d = dT[o.port] === undefined ? 99 : dT[o.port]; if (d < bd) { bd = d; best = o; } }
      const cur = dT[s.ships[sea[0].ship].loc]; if (best && bd < (cur === undefined ? 99 : cur)) return { area: best.area, via: 'sea', ship: best.ship, port: best.port };
      return null;
    }
    // walk to my nearest ship that can carry us
    const load = E().stackStrength(s, ids);
    let bestA = null, bd = Infinity;
    for (const sh of E().playerShips(s, p)) { if (sh.cap < load || E().shipAtSea(sh)) continue; const a = KM.P[sh.loc].area; const d = E().dist(here, a); if (d < bd) { bd = d; bestA = a; } }
    if (bestA && bestA !== here && bd !== Infinity) return stepToward(s, p, ids, bestA);
    return null;
  }

  // ----- one action -----
  AI.step = function (s) {
    const p = s.turn.player; const En = E();
    if (s.winner !== null) return null;
    if (s.pending && s.pending.type === 'prisoners') { const id = s.pending.list[0]; En.resolvePrisoner(s, id, 'execute'); return { kind: 'prisoner', noble: id }; }
    if (s.turn.phase === 'event') { const r = En.drawEvent(s); return Object.assign({ kind: 'event' }, r); }
    const heirAct = heirPolicy(s, p); if (heirAct) return heirAct;
    if (s.turn.phase === 'move') {
      const c = AI.playOne(s, p); if (c) return c;
      s.turn.aiDone = s.turn.aiDone || {};
      const obj = AI.objective(s, p); const gs = groups(s, p).filter(g => g.nobles.some(n => !s.turn.aiDone[n.id]));
      const all = groups(s, p); const main = all[0];
      for (const g of gs) {
        const ids = g.nobles.map(n => n.id); ids.forEach(id => { s.turn.aiDone[id] = true; });
        if (g.nobles.some(n => !En.canMove(s, n))) continue;
        let target = null;
        if (obj) { const mainReady = main.str >= obj.need; target = (g === main || (g.area === main.area)) ? (mainReady || all.length === 1 ? obj.area : null) : (mainReady ? obj.area : main.area); }
        else if (g !== main) target = main.area;
        if (target === null || target === g.area) { const sh = shelterIfIdle(s, p, g, obj); if (sh) return sh; continue; }
        const dest = stepToward(s, p, ids, target);
        if (!dest) { const sh = shelterIfIdle(s, p, g, obj); if (sh) return sh; continue; }
        const wantOpen = obj && dest.area === obj.area && obj.kind !== 'enter';
        if (!wantOpen || (obj && obj.kind === 'enter')) { const fr = KM.A[dest.area].places.filter(pl => En.isFriendly(s, pl, p)); const pick = (obj && obj.crown && fr.includes(obj.place)) ? obj.place : fr[0]; if (pick) dest.enter = pick; }
        const r = En.move(s, p, ids, dest);
        if (r.ok) return { kind: 'move', nobles: ids, dest, path: r.path };
      }
      const fetch = fetchShip(s, p); if (fetch) return fetch;
      En.endMovement(s); return { kind: 'endMove' };
    }
    if (s.turn.phase === 'combat') {
      const opts = En.combatOptions(s, p).filter(o => o.ok);
      const obj = AI.objective(s, p);
      let best = null, bv = 0;
      for (const o of opts) {
        let v = 0;
        if (o.type === 'siege') { const foreign = o.heirs.filter(h => s.heirs[h].ctrl !== p); v = foreign.length * 60 + o.defenders.length * 25 + (obj && obj.place === o.place ? 40 : 0); if (v && o.att < o.def) v = 0; }
        else { const ratio = o.def ? o.att / o.def : 9; if (ratio >= 1.5 || (o.heirs.length && ratio >= 1.25)) v = 30 + o.heirs.length * 50 + o.defenders.length * 10 + ratio * 5; }
        if (v > bv) { bv = v; best = o; }
      }
      if (best) { const r = En.attack(s, p, best); if (r.ok) return Object.assign({ kind: 'attack' }, r); }
      En.endCombat(s); return { kind: 'endCombat' };
    }
    if (s.turn.phase === 'court') {
      for (const o of En.coronationOptions(s, p)) if (o.ok && (o.heir === 'beaufort' || KM.HEIR[o.heir].house === myHouse(s, p))) { const r = En.crown(s, p, o.heir); if (r.ok) return { kind: 'crown', heir: o.heir }; }
      if (!s.turn.aiParl && En.canSummon(s, p).ok) { s.turn.aiParl = true; const cs = En.canSummon(s, p); const tg = En.summonable(s, p).map(id => s.nobles[id]).sort((a, b) => En.strength(s, a) - En.strength(s, b)).slice(0, cs.writs).map(n => n.id); const r = En.openParliament(s, p, { writs: tg }); if (r.ok && s.winner === null) return { kind: 'parliament' }; if (s.winner !== null) return { kind: 'victory' }; }
      // tuck forces into friendly walls before ending
      for (const g of groups(s, p)) { if (g.inside) continue; const fr = KM.A[g.area].places.find(pl => En.isFriendly(s, pl, p)); if (fr) { const r = En.shelter(s, p, g.nobles.map(n => n.id), fr); if (r.ok) return { kind: 'shelter', area: g.area }; } }
      const r = En.endTurn(s); return Object.assign({ kind: 'endTurn' }, r);
    }
    return null;
  };
  // send an empty ship toward a force stranded on an island or at Calais
  function fetchShip(s, p) {
    const En = E();
    const stranded = groups(s, p).filter(g => SEA_ONLY[g.area] && !En.playerShips(s, p).some(sh => !En.shipAtSea(sh) && KM.P[sh.loc].area === g.area && sh.cap >= g.str));
    for (const g of stranded) {
      const port = KM.A[g.area].places.find(pl => KM.P[pl].port); if (!port) continue;
      const toPort = En.seaDistances(port, 60);
      const ships = En.playerShips(s, p).filter(sh => !sh.used && !En.shipCargo(s, sh.key).length && sh.cap >= Math.min(g.str, sh.cap) && toPort[sh.loc] !== undefined && !(KM.P[sh.loc] && KM.P[sh.loc].area === g.area));
      ships.sort((a, b) => toPort[a.loc] - toPort[b.loc]);
      for (const sh of ships) {
        const reach = En.shipReach(s, sh.key); let best = null, bd = toPort[sh.loc];
        for (const k of Object.keys(reach)) { if (KM.P[k] && k !== port) continue; const d = toPort[k]; if (d !== undefined && d < bd) { bd = d; best = k; } }
        if (best) { const r = En.sail(s, p, sh.key, { to: best }); if (r.ok) return { kind: 'move', nobles: [], dest: { area: En.shipArea(sh) }, path: r.path }; }
      }
    }
    return null;
  }
  function shelterIfIdle(s, p, g, obj) {
    if (g.inside || (obj && obj.area === g.area && obj.kind !== 'enter')) return null;
    const fr = KM.A[g.area].places.filter(pl => E().isFriendly(s, pl, p)); if (!fr.length) return null;
    const pick = obj && obj.crown && fr.includes(obj.place) ? obj.place : fr[0];
    const r = E().shelter(s, p, g.nobles.map(n => n.id), pick); return r.ok ? { kind: 'shelter', area: g.area } : null;
  }
  function heirPolicy(s, p) {
    const mine = E().aliveHeirs(s).filter(h => h.ctrl === p); if (!mine.length) return null;
    const house = myHouse(s, p);
    for (const h of mine) if (KM.HEIR[h.id].house !== house) { E().executeHeir(s, p, h.id); return { kind: 'heir', heir: h.id }; }
    const loose = E().aliveHeirs(s).filter(h => h.ctrl !== p);
    if (!loose.length && mine.length > 1) { const sen = E().seniorHeir(s, house); const victim = mine.filter(h => h.id !== sen.id).sort((a, b) => KM.HEIR[b.id].rank - KM.HEIR[a.id].rank)[0]; E().executeHeir(s, p, victim.id); return { kind: 'heir', heir: victim.id }; }
    return null;
  }

  // ----- parliament -----
  AI.proposals = function (s, p) {
    const out = []; const used = {};
    for (const cid of s.parl.cards) {
      const t = E().parlTargets(s, cid).map(id => s.nobles[id]).filter(n => !used[n.id + KM.CARD[cid].kind] || KM.CARD[cid].kind === 'bishop');
      const mine = t.filter(n => n.owner === p).sort((a, b) => E().strength(s, b) - E().strength(s, a));
      const pick = mine[0] || t.sort((a, b) => E().factionStrength(s, a.owner) - E().factionStrength(s, b.owner))[0];
      if (!pick) continue; used[pick.id + KM.CARD[cid].kind] = true; out.push({ card: cid, noble: pick.id });
    }
    return out;
  };
  // how an AI faction votes on a proposal
  AI.ballot = function (s, voter, cardId, nobleId) {
    const owner = s.nobles[nobleId].owner; if (owner === voter) return true;
    if (s.parl.favoured[voter]) return true;
    const sum = s.parl.summoner; // oppose the strongest faction; tolerate the weak
    const strongest = s.players.slice().sort((a, b) => E().factionStrength(s, b.id) - E().factionStrength(s, a.id))[0].id;
    return owner !== strongest && owner !== sum ? true : false;
  };
  // run a whole AI-summoned parliament when every voter is an AI (headless / all-AI tables)
  AI.runParliament = function (s, humanBallot) {
    const p = s.parl.summoner; const res = [];
    for (const pr of AI.proposals(s, p)) {
      if (!s.parl.cards.includes(pr.card) || !E().parlTargets(s, pr.card).includes(pr.noble)) continue;
      const ballots = {}; for (const q of s.players) if (q.id !== p) ballots[q.id] = q.ai || !humanBallot ? AI.ballot(s, q.id, pr.card, pr.noble) : humanBallot(q.id, pr);
      res.push(E().propose(s, pr.card, pr.noble, ballots));
    }
    E().closeParliament(s); return res;
  };
})();
