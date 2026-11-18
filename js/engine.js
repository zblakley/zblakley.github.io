/* Kingmaker — rules engine. Pure game logic: no DOM. Runs in the browser and in node (tests). */
(function () {
  const KM = (globalThis.KM = globalThis.KM || {});
  const E = (KM.Engine = {});
  const MOVE = 5, SEA_RANGE = 2, FORT = { city: 1, town: 1, royal: 1, castle: 1 };

  // ---------- static lookups ----------
  E.init = function () {
    if (KM.A) return;
    KM.A = {}; KM.P = {}; KM.SEA = {};
    for (const a of KM.MAP.areas) KM.A[a.id] = a;
    for (const p of KM.MAP.places) KM.P[p.id] = p;
    for (const z of KM.MAP.seas) KM.SEA[z.id] = z;
    KM.CARD = {};
    const C = KM.CARDS;
    for (const k of ['nobles', 'titles', 'offices', 'bishops', 'mercs', 'ships', 'towns']) for (const c of C[k]) KM.CARD[c.id] = c;
    KM.HEIR = {}; for (const h of C.heirs) KM.HEIR[h.id] = h;
    KM.EVENT = {}; for (const e of C.events) KM.EVENT[e.id] = e;
    E._dist = {}; E._seaDist = {};
    for (const z of KM.MAP.seas) { const d = { [z.id]: 0 }; const q = [z.id]; while (q.length) { const u = q.shift(); for (const v of KM.SEA[u].adj) if (d[v] === undefined) { d[v] = d[u] + 1; q.push(v); } } E._seaDist[z.id] = d; }
  };
  // land distance in areas (ignores terrain); Infinity if not connected by land
  E.dist = function (a, b) {
    if (a === b) return 0;
    let d = E._dist[a];
    if (!d) { d = E._dist[a] = { [a]: 0 }; const q = [a]; while (q.length) { const u = q.shift(); for (const v of KM.A[u].adj) if (d[v] === undefined) { d[v] = d[u] + 1; q.push(v); } } }
    return d[b] === undefined ? Infinity : d[b];
  };
  E.areaName = function (id) {
    const a = KM.A[id]; if (a.name && a.special) return a.name;
    if (a.places.length) return KM.P[a.places[0]].name + (a.places.length > 1 ? ' & ' + a.places.slice(1).map(p => KM.P[p].name).join(' & ') : '');
    if (a.name) return a.name;
    let best = null, bd = Infinity; // describe by nearest place
    for (const p of KM.MAP.places) { const d = Math.hypot(p.x - a.c[0], p.y - a.c[1]); if (d < bd) { bd = d; best = p; } }
    const dx = a.c[0] - best.x, dy = a.c[1] - best.y; const dir = Math.abs(dx) > 2 * Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : Math.abs(dy) > 2 * Math.abs(dx) ? (dy > 0 ? 'south' : 'north') : (dy > 0 ? 'south' : 'north') + (dx > 0 ? '-east' : '-west');
    return 'the country ' + dir + ' of ' + best.name;
  };
  E.locName = (loc) => loc.inside ? KM.P[loc.inside].name : E.areaName(loc.area);

  // ---------- rng ----------
  function rnd(s) { s.rng = (s.rng + 0x6D2B79F5) | 0; let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function shuffle(s, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  E.random = rnd;
  function log(s, text, kind, extra) { s.log.push(Object.assign({ t: s.turn ? s.turn.n : 0, p: s.turn ? s.turn.player : null, text, kind: kind || 'info' }, extra || {})); if (s.log.length > 400) s.log.splice(0, s.log.length - 400); }
  E.log = log;
  const fail = (error) => ({ ok: false, error });

  // ---------- new game ----------
  E.newGame = function (cfg) {
    E.init();
    const C = KM.CARDS;
    const s = {
      v: 1, rng: (cfg.seed || Math.floor(Math.random() * 2 ** 31)) | 0, options: Object.assign({ parliamentVictory: false, crownToWin: true }, cfg.options || {}),
      players: cfg.players.map((p, i) => ({ id: i, name: p.name, color: p.color, ai: !!p.ai, hand: [], held: [], mustered: false })),
      nobles: {}, heirs: {}, ships: {}, captured: {}, heldBy: {},
      crownDeck: [], crownDiscard: [], chancery: [], eventDeck: [], eventDiscard: [],
      turn: { n: 0, player: 0, phase: 'muster', round: 1 }, pending: null, parl: null, lastParl: {}, log: [], winner: null, winText: null
    };
    for (const h of C.heirs) { const pl = KM.P[h.start]; s.heirs[h.id] = { id: h.id, alive: true, area: pl.area, inside: FORT[pl.type] ? pl.id : null, ctrl: null, crowned: !!h.crowned }; }
    s.crownDeck = shuffle(s, Object.keys(KM.CARD));
    s.eventDeck = shuffle(s, C.events.map(e => e.id));
    const n = s.players.length, per = (C.deal && C.deal[n]) || Math.floor(Math.min(12, 60 / n));
    for (let k = 0; k < per; k++) for (const p of s.players) p.hand.push(s.crownDeck.pop());
    // every faction needs at least one noble to begin
    for (const p of s.players) {
      let guard = 0;
      while (!p.hand.some(id => KM.CARD[id].kind === 'noble') && guard++ < 200) {
        const i = s.crownDeck.findIndex(id => KM.CARD[id].kind === 'noble'); if (i < 0) break;
        const swapOut = p.hand.pop(); p.hand.push(s.crownDeck.splice(i, 1)[0]); s.crownDeck.unshift(swapOut);
      }
    }
    shuffle(s, s.crownDeck);
    s.turn.player = Math.floor(rnd(s) * n); s.firstPlayer = s.turn.player;
    log(s, 'The realm is divided. Each faction musters its nobles.', 'phase');
    return s;
  };

  // ---------- queries ----------
  E.card = (id) => KM.CARD[id];
  E.playerNobles = (s, p) => Object.values(s.nobles).filter(n => n.owner === p);
  E.holder = (s, cardId) => { const id = s.heldBy[cardId]; return id ? s.nobles[id] : null; };
  E.sameLoc = (a, b) => a.area === b.area && (a.inside || null) === (b.inside || null);
  E.noblesAt = (s, loc, p) => Object.values(s.nobles).filter(n => E.sameLoc(n, loc) && (p === undefined || n.owner === p));
  E.noblesInArea = (s, area, p) => Object.values(s.nobles).filter(n => n.area === area && (p === undefined || n.owner === p));
  E.heirsAt = (s, loc) => Object.values(s.heirs).filter(h => h.alive && E.sameLoc(h, loc));
  E.isTitled = (s, n) => !!(KM.CARD[n.id].title || n.title);
  E.titleName = (s, n) => n.title ? KM.CARD[n.title].name : KM.CARD[n.id].title;
  E.attachments = (n) => [n.title, n.office].filter(Boolean).concat(n.bishops, n.mercs, n.towns, n.ships);
  E.transferable = (cardId) => ['merc', 'town', 'ship'].includes(KM.CARD[cardId].kind);

  // who controls each fortified place (card ownership, overridden by conquest)
  E.placeOwner = function (s, placeId) {
    if (s.captured[placeId] !== undefined) return s.captured[placeId];
    const src = E._placeSrc || (E._placeSrc = (() => { const m = {}; for (const c of Object.values(KM.CARD)) { for (const pl of (c.castles || [])) (m[pl] = m[pl] || []).push(c.id); for (const pl of (c.places || [])) (m[pl] = m[pl] || []).push(c.id); if (c.kind === 'town') (m[c.place] = m[c.place] || []).push(c.id); } return m; })());
    for (const cid of (src[placeId] || [])) { const c = KM.CARD[cid]; const n = c.kind === 'noble' ? s.nobles[cid] : E.holder(s, cid); if (n) return n.owner; }
    return null;
  };
  E.isFriendly = (s, placeId, p) => FORT[KM.P[placeId].type] ? E.placeOwner(s, placeId) === p : false;
  E.friendlyPlaces = (s, p) => KM.MAP.places.filter(pl => E.isFriendly(s, pl.id, p)).map(pl => pl.id);
  E.fortified = (placeId) => !!FORT[KM.P[placeId].type];

  function bonusApplies(b, area) {
    if (!b) return false;
    if (b.regions) return b.regions.includes(KM.A[area].region);
    if (b.near) return b.near.some(pl => E.dist(KM.P[pl].area, area) <= (b.within === undefined ? 3 : b.within));
    if (b.north) return KM.A[area].lat >= b.north;
    return false;
  }
  // breakdown: [{label, troops, on}]
  E.strengthParts = function (s, n, ctx) {
    ctx = ctx || {}; const area = ctx.area || n.area; const c = KM.CARD[n.id]; const out = [{ label: c.name + (c.title ? ', ' + c.title : ''), troops: c.troops, on: true }];
    if (n.title) out.push({ label: KM.CARD[n.title].name, troops: KM.CARD[n.title].troops, on: true });
    if (n.office) { const o = KM.CARD[n.office]; if (o.troops) out.push({ label: o.name, troops: o.troops, on: true }); if (o.bonus) out.push({ label: o.name + ' — ' + o.bonus.text, troops: o.bonus.troops, on: bonusApplies(o.bonus, area) }); }
    for (const b of n.bishops) { const o = KM.CARD[b]; if (o.troops) out.push({ label: o.name, troops: o.troops, on: true }); if (o.bonus) out.push({ label: o.name + ' — ' + o.bonus.text, troops: o.bonus.troops, on: bonusApplies(o.bonus, area) }); }
    for (const m of n.mercs) out.push({ label: KM.CARD[m].name, troops: KM.CARD[m].troops, on: true });
    return out;
  };
  E.strength = (s, n, ctx) => E.strengthParts(s, n, ctx).reduce((t, x) => t + (x.on ? x.troops : 0), 0);
  E.stackStrength = (s, nobles, ctx) => nobles.reduce((t, n) => t + E.strength(s, typeof n === 'string' ? s.nobles[n] : n, ctx), 0);
  E.factionStrength = (s, p) => E.stackStrength(s, E.playerNobles(s, p));

  E.seniorHeir = function (s, house) { const hs = KM.CARDS.heirs.filter(h => h.house === house && s.heirs[h.id].alive).sort((a, b) => a.rank - b.rank); return hs.length ? s.heirs[hs[0].id] : null; };
  E.kings = (s) => Object.values(s.heirs).filter(h => h.alive && h.crowned);
  E.soleKing = (s) => { const k = E.kings(s); return k.length === 1 ? k[0] : null; };
  E.aliveHeirs = (s) => Object.values(s.heirs).filter(h => h.alive);

  E.votes = function (s, p) {
    const d = { commons: 0, lords: 0, parts: [] }; const add = (house, label, v) => { if (!v) return; d[house] += v; d.parts.push({ house, label, v }); };
    const sk = E.soleKing(s);
    if (sk && sk.ctrl === p) add('commons', 'The King', 20);
    else if (!sk) { const ch = E.holder(s, 'o_chancellor'); if (ch && ch.owner === p) add('commons', 'Chancellor of England', 20); }
    for (const h of ['lancaster', 'york']) { const sh = E.seniorHeir(s, h); if (sh && sh.ctrl === p) add('lords', KM.HEIR[sh.id].name, 10); }
    for (const n of E.playerNobles(s, p)) {
      const c = KM.CARD[n.id]; add('commons', c.name, c.commons || 1);
      if (E.isTitled(s, n)) add('lords', c.name, c.lords || 1);
      if (n.office) add('lords', KM.CARD[n.office].name, KM.CARD[n.office].lords || 0);
      for (const b of n.bishops) add('lords', KM.CARD[b].name, KM.CARD[b].lords || 0);
    }
    for (const pl of KM.MAP.places) { if ((pl.type === 'city' || pl.type === 'town') && !pl.noVote && E.placeOwner(s, pl.id) === p) add('commons', pl.name, pl.type === 'city' ? 4 : 3); }
    return d;
  };

  // ---------- low-level mutations ----------
  function attach(s, n, cardId) {
    const c = KM.CARD[cardId]; s.heldBy[cardId] = n.id;
    if (c.kind === 'title') n.title = cardId; else if (c.kind === 'office') n.office = cardId; else if (c.kind === 'bishop') n.bishops.push(cardId); else if (c.kind === 'merc') n.mercs.push(cardId); else if (c.kind === 'town') n.towns.push(cardId); else if (c.kind === 'ship') n.ships.push(cardId);
    for (const pl of (c.places || [])) delete s.captured[pl];
    if (c.kind === 'town') delete s.captured[c.place];
    if (c.kind === 'ship' && !s.ships[cardId]) s.ships[cardId] = { key: cardId, name: c.name, cap: c.cap, port: bestPort(s, n, c.ports), used: false, src: cardId };
    if (c.kind === 'office') (c.ships || []).forEach((sh, i) => { const key = cardId + ':' + i; if (!s.ships[key]) s.ships[key] = { key, name: sh.name, cap: sh.cap, port: sh.port, used: false, src: cardId }; });
  }
  function bestPort(s, n, ports) { let best = ports[0], bd = Infinity; for (const p of ports) { const d = E.dist(KM.P[p].area, n.area); if (d < bd) { bd = d; best = p; } } return best; }
  function detach(s, n, cardId) {
    const c = KM.CARD[cardId]; delete s.heldBy[cardId];
    if (n.title === cardId) n.title = null; if (n.office === cardId) n.office = null;
    for (const k of ['bishops', 'mercs', 'towns', 'ships']) { const i = n[k].indexOf(cardId); if (i >= 0) n[k].splice(i, 1); }
    if (c.kind === 'office') (c.ships || []).forEach((sh, i) => { delete s.ships[cardId + ':' + i]; });
  }
  E.shipOwner = (s, ship) => { const n = E.holder(s, ship.src); return n ? n.owner : null; };
  E.playerShips = (s, p) => Object.values(s.ships).filter(sh => E.shipOwner(s, sh) === p);

  function leadNoble(s, p, loc) { const ns = (loc ? E.noblesInArea(s, loc.area, p) : E.playerNobles(s, p)); return ns.sort((a, b) => E.strength(s, b) - E.strength(s, a))[0] || null; }
  // heirs follow control: lose control when no escort remains; loose heirs fall to an acting faction sharing their location
  function refreshHeirs(s, actor) {
    // nobles cannot remain within walls that are no longer theirs
    for (const n of Object.values(s.nobles)) if (n.inside && !E.isFriendly(s, n.inside, n.owner)) {
      const pl = n.inside; n.inside = null;
      for (const h of E.aliveHeirs(s)) if (h.inside === pl && h.ctrl === n.owner) h.inside = null;
    }
    for (const h of E.aliveHeirs(s)) {
      if (h.ctrl !== null && !E.noblesAt(s, h, h.ctrl).length) { h.ctrl = null; }
      if (h.ctrl === null) {
        const here = [...new Set(E.noblesAt(s, h).map(n => n.owner))];
        const who = (actor !== undefined && actor !== null && here.includes(actor)) ? actor : here.length === 1 ? here[0] : null;
        if (who !== null) { h.ctrl = who; log(s, `${s.players[who].name} takes ${KM.HEIR[h.id].name} into their keeping at ${E.locName(h)}.`, 'heir', { heir: h.id }); }
      }
    }
  }
  E.killHeir = function (s, id, why) {
    const h = s.heirs[id]; if (!h.alive) return; h.alive = false; const was = h.crowned; h.crowned = false; h.ctrl = null;
    log(s, `${KM.HEIR[id].name}${was ? ', crowned monarch,' : ''} ${why}.`, 'death', { heir: id });
    E.checkVictory(s);
  };
  // captor: player id who receives mercenaries/towns/ships, or null
  E.killNoble = function (s, id, why, captor) {
    const n = s.nobles[id]; if (!n) return;
    const c = KM.CARD[id]; const recv = (captor !== null && captor !== undefined) ? leadNoble(s, captor, n) || leadNoble(s, captor) : null;
    for (const cid of E.attachments(n).slice()) {
      const k = KM.CARD[cid].kind; detach(s, n, cid);
      if (k === 'title' || k === 'office' || k === 'bishop') s.chancery.push(cid);
      else if (recv) attach(s, recv, cid);
      else { s.crownDiscard.push(cid); if (k === 'ship') delete s.ships[cid]; }
    }
    delete s.nobles[id]; s.crownDiscard.push(id);
    for (const pl of c.castles || []) delete s.captured[pl];
    log(s, `${c.name}${c.title ? ', ' + c.title + ',' : ''} ${why}.`, 'death', { noble: id });
    if (s.pending && s.pending.list) { s.pending.list = s.pending.list.filter(x => x !== id); if (!s.pending.list.length) s.pending = null; }
    refreshHeirs(s, captor);
  };
  function drawEventCard(s) { if (!s.eventDeck.length) { s.eventDeck = shuffle(s, s.eventDiscard); s.eventDiscard = []; } return s.eventDeck.pop(); }
  function drawCrownCard(s) { if (!s.crownDeck.length) { s.crownDeck = shuffle(s, s.crownDiscard); s.crownDiscard = []; } return s.crownDeck.length ? s.crownDeck.pop() : null; }

  // ---------- playing Crown cards ----------
  // returns the list of legal targets for a card in hand: noble ids, or place ids for a noble card
  E.cardTargets = function (s, p, cardId) {
    const c = KM.CARD[cardId]; const mine = E.playerNobles(s, p);
    if (c.kind === 'noble') {
      const free = c.castles.filter(pl => { const o = s.captured[pl]; return o === undefined || o === p; });
      if (free.length) return free;
      const fr = E.friendlyPlaces(s, p); if (fr.length) { fr.sort((a, b) => Math.hypot(KM.P[a].x - KM.P[c.castles[0]].x, KM.P[a].y - KM.P[c.castles[0]].y) - Math.hypot(KM.P[b].x - KM.P[c.castles[0]].x, KM.P[b].y - KM.P[c.castles[0]].y)); return fr.slice(0, 3); }
      return c.castles.slice(0, 1);
    }
    if (c.kind === 'title') return mine.filter(n => !E.isTitled(s, n)).map(n => n.id);
    if (c.kind === 'office') return mine.filter(n => E.isTitled(s, n) && !n.office).map(n => n.id);
    return mine.map(n => n.id);
  };
  E.playCard = function (s, p, cardId, target) {
    const pl = s.players[p]; const i = pl.hand.indexOf(cardId); if (i < 0) return fail('That card is not in your hand.');
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    const c = KM.CARD[cardId]; const targets = E.cardTargets(s, p, cardId);
    if (!targets.includes(target)) return fail(c.kind === 'title' ? 'A title can only go to an untitled noble.' : c.kind === 'office' ? 'An office needs a titled noble who holds no other office.' : 'Not a legal target.');
    pl.hand.splice(i, 1);
    if (c.kind === 'noble') {
      const place = KM.P[target]; const inside = E.fortified(target) && (s.captured[target] === undefined || s.captured[target] === p);
      s.nobles[cardId] = { id: cardId, owner: p, area: place.area, inside: inside ? target : null, title: null, office: null, bishops: [], mercs: [], towns: [], ships: [], moved: s.turn.phase !== 'muster', fought: false, held: false };
      for (const cs of c.castles) if (s.captured[cs] === p) delete s.captured[cs];
      log(s, `${pl.name} raises the banner of ${c.name}${c.title ? ', ' + c.title : ''} at ${place.name}.`, 'card', { noble: cardId });
      refreshHeirs(s, p);
    } else {
      const n = s.nobles[target]; attach(s, n, cardId); refreshHeirs(s, p);
      log(s, `${pl.name} grants ${c.kind === 'ship' ? 'the ship ' : ''}${c.name} to ${KM.CARD[n.id].name}.`, 'card', { noble: n.id });
    }
    return { ok: true };
  };
  E.transferTargets = function (s, p, cardId) {
    const from = E.holder(s, cardId); if (!from || from.owner !== p || !E.transferable(cardId)) return [];
    return E.noblesInArea(s, from.area, p).filter(n => n.id !== from.id).map(n => n.id);
  };
  E.transfer = function (s, p, cardId, toId) {
    if (!E.transferTargets(s, p, cardId).includes(toId)) return fail('Only mercenaries, towns and ships can change hands, and only between nobles in the same area.');
    const from = E.holder(s, cardId); detach(s, from, cardId); attach(s, s.nobles[toId], cardId);
    log(s, `${KM.CARD[cardId].name} passes from ${KM.CARD[from.id].name} to ${KM.CARD[toId].name}.`, 'card');
    return { ok: true };
  };
  E.giveCard = function (s, p, cardId, toPlayer) {
    const pl = s.players[p]; const i = pl.hand.indexOf(cardId); if (i < 0 || toPlayer === p || !s.players[toPlayer]) return fail('Cannot give that card.');
    if (KM.CARD[cardId].kind === 'noble') return fail('Noble cards cannot be traded.');
    pl.hand.splice(i, 1); s.players[toPlayer].hand.push(cardId); log(s, `${pl.name} hands a Crown card to ${s.players[toPlayer].name}.`, 'card'); return { ok: true };
  };

  // ---------- muster (setup) ----------
  E.finishMuster = function (s, p) {
    const pl = s.players[p]; if (s.turn.phase !== 'muster' || pl.mustered) return fail('Muster is over.');
    if (pl.hand.some(id => KM.CARD[id].kind === 'noble')) return fail('Place all your nobles first.');
    for (const id of pl.hand.slice()) { // auto-assign what can be assigned, rest to Chancery / discard
      const t = E.cardTargets(s, p, id); const k = KM.CARD[id].kind;
      if (t.length && k !== 'title' && k !== 'office' && k !== 'bishop') { const best = t.map(x => s.nobles[x]).sort((a, b) => E.strength(s, b) - E.strength(s, a))[0]; E.playCard(s, p, id, best.id); }
    }
    for (const id of pl.hand.slice()) { const k = KM.CARD[id].kind; if (k === 'title' || k === 'office' || k === 'bishop') { pl.hand.splice(pl.hand.indexOf(id), 1); s.chancery.push(id); log(s, `${KM.CARD[id].name} cannot be bestowed and goes to Chancery.`, 'card'); } }
    pl.mustered = true;
    if (s.players.every(x => x.mustered)) { s.turn = { n: 1, round: 1, player: s.firstPlayer, phase: 'event' }; startTurn(s); log(s, `The wars begin. ${s.players[s.turn.player].name} moves first.`, 'phase'); }
    return { ok: true };
  };
  function startTurn(s) {
    const p = s.turn.player;
    for (const n of E.playerNobles(s, p)) { n.moved = false; n.fought = false; }
    for (const sh of Object.values(s.ships)) if (E.shipOwner(s, sh) === p) sh.used = false;
    s.turn.phase = 'event'; s.turn.event = null; s.turn.parliament = false; s.turn.mustParl = false; s.turn.storm = false; s.turn.aiDone = null; s.turn.aiParl = false;
  }

  // ---------- event phase ----------
  function relocate(s, n, placeId, areaId) {
    const area = placeId ? KM.P[placeId].area : areaId; n.area = area; n.inside = placeId && E.isFriendly(s, placeId, n.owner) ? placeId : null;
  }
  function findCalled(s, call) {
    return call.kind === 'noble' ? (s.nobles[call.id] || null) : E.holder(s, call.id);
  }
  E.drawEvent = function (s) {
    if (s.turn.phase !== 'event') return fail('Not the event phase.');
    const p = s.turn.player; const id = drawEventCard(s); const ev = KM.EVENT[id]; const fx = [];
    s.turn.event = id; s.turn.phase = 'move';
    log(s, `Event — ${ev.title}`, 'event', { event: id });
    if (ev.type === 'plague') {
      let any = false;
      for (const pid of ev.places) {
        const pl = KM.P[pid]; const open = !E.fortified(pl.id);
        const dead = Object.values(s.nobles).filter(n => n.inside === pl.id || (open && n.area === pl.area));
        const deadH = E.aliveHeirs(s).filter(h => h.inside === pl.id || (open && h.area === pl.area));
        for (const n of dead) { any = true; fx.push({ t: 'death', noble: n.id, area: pl.area }); E.killNoble(s, n.id, `dies of the plague at ${pl.name}`, null); }
        for (const h of deadH) { any = true; fx.push({ t: 'death', heir: h.id, area: pl.area }); E.killHeir(s, h.id, `dies of the plague at ${pl.name}`); }
      }
      if (!any) log(s, 'The pestilence finds no great lord within the walls.', 'info');
      s.eventDiscard.push(id);
    } else if (ev.type === 'summons') {
      for (const call of ev.calls) {
        const n = findCalled(s, call); if (!n) continue;
        const from = { area: n.area, inside: n.inside }; const dest = call.to ? KM.P[call.to].area : (KM.MAP.areas.find(a => a.name === call.toArea) || {}).id; if (!dest) continue;
        const companions = E.noblesAt(s, from, n.owner).filter(x => x.id !== n.id);
        relocate(s, n, call.to, dest); n.held = true; n.moved = true;
        if (!companions.length) for (const h of E.heirsAt(s, from)) if (h.ctrl === n.owner) { h.area = n.area; h.inside = n.inside; }
        fx.push({ t: 'summon', noble: n.id, to: n.area });
        log(s, `${KM.CARD[n.id].name} is called away to ${call.to ? KM.P[call.to].name : call.toArea}.`, 'move', { noble: n.id });
      }
      if (!fx.length) log(s, 'No one in play is bound to answer.', 'info');
      refreshHeirs(s); s.eventDiscard.push(id);
    } else if (ev.type === 'embassy') {
      const ks = E.kings(s).filter(k => k.ctrl !== null);
      for (const k of ks) {
        const from = { area: k.area, inside: k.inside }; const pl = KM.P[ev.place];
        const escort = E.noblesAt(s, from, k.ctrl);
        for (const n of escort) { relocate(s, n, null, pl.area); n.moved = true; n.held = true; }
        for (const h of E.heirsAt(s, from)) if (h.ctrl === k.ctrl) { h.area = pl.area; h.inside = null; }
        fx.push({ t: 'embassy', heir: k.id, to: pl.area });
        log(s, `${KM.HEIR[k.id].name} and escort travel to ${pl.name} to receive the embassy.`, 'move');
      }
      if (!ks.length) log(s, 'There is no crowned monarch at liberty to receive it.', 'info');
      refreshHeirs(s); s.eventDiscard.push(id);
    } else if (ev.type === 'freeMove' || ev.type === 'writ') {
      s.players[p].held.push(id); fx.push({ t: 'held' });
      log(s, `${s.players[p].name} keeps the card for later use.`, 'info');
    } else if (ev.type === 'chParl') {
      const ch = E.holder(s, 'o_chancellor');
      if (ch) { s.players[ch.owner].held.push(id); log(s, `The card passes to ${s.players[ch.owner].name}, whose ${KM.CARD[ch.id].name} is Chancellor of England.`, 'info'); }
      else { s.eventDiscard.push(id); log(s, 'There is no Chancellor of England to receive it.', 'info'); }
    } else if (ev.type === 'mustParl') {
      s.turn.mustParl = true; s.eventDiscard.push(id);
    } else if (ev.type === 'storm') {
      for (const sh of Object.values(s.ships)) sh.used = true; s.turn.storm = true;
      log(s, 'Gales keep every ship in harbour this turn.', 'info'); s.eventDiscard.push(id);
    } else if (ev.type === 'desert') {
      let any = false;
      for (const n of Object.values(s.nobles)) for (const m of n.mercs.slice()) if (KM.CARD[m].name === ev.merc) { any = true; detach(s, n, m); s.crownDiscard.push(m); fx.push({ t: 'desert', noble: n.id }); log(s, `The ${ev.merc} abandon ${KM.CARD[n.id].name}.`, 'info'); }
      if (!any) log(s, 'They are in no one\u2019s pay.', 'info'); s.eventDiscard.push(id);
    } else { s.eventDiscard.push(id); }
    refreshHeirs(s);
    return { ok: true, event: ev, fx };
  };

  // ---------- movement ----------
  function checkGroup(s, p, ids) {
    if (!ids.length) return 'Choose at least one noble.';
    const ns = ids.map(id => s.nobles[id]);
    if (ns.some(n => !n || n.owner !== p)) return 'Those are not your nobles.';
    if (ns.some(n => !E.sameLoc(n, ns[0]))) return 'A force must start from the same place.';
    return null;
  }
  E.canMove = (s, n) => !n.moved && !n.held;
  function roadBlocked(s, p, area) { return KM.A[area].places.some(pl => E.fortified(pl) && E.placeOwner(s, pl) !== null && E.placeOwner(s, pl) !== p); }
  E.moveOptions = function (s, p, ids) {
    const res = { land: {}, road: {}, sea: [], enter: [], leave: false, error: null };
    const err = checkGroup(s, p, ids); if (err) { res.error = err; return res; }
    const ns = ids.map(id => s.nobles[id]); const start = ns[0].area;
    if (s.turn.phase !== 'move' || s.turn.player !== p) { res.error = 'Forces march in the movement phase.'; return res; }
    res.enter = KM.A[start].places.filter(pl => E.isFriendly(s, pl, p) && ns[0].inside !== pl);
    res.leave = !!ns[0].inside;
    if (ns.some(n => !E.canMove(s, n))) { res.error = ns.some(n => n.held) ? 'Called away by royal summons — cannot march this turn.' : 'Already marched this turn.'; return res; }
    const landLocked = ['wight', 'man', 'ireland', 'calais'].includes(start);
    if (!landLocked) {
      const seen = { [start]: { steps: 0, prev: null } }; let frontier = [start];
      for (let step = 1; step <= MOVE && frontier.length; step++) {
        const next = [];
        for (const u of frontier) for (const v of KM.A[u].adj) {
          if (seen[v]) continue; seen[v] = { steps: step, prev: u };
          const stop = (KM.A[v].terrain === 'forest' && KM.A[u].terrain !== 'forest') || KM.A[v].special;
          if (!stop) next.push(v);
        }
        frontier = next;
      }
      delete seen[start]; res.land = seen;
      if (KM.A[start].road.length) {
        const sr = { [start]: { steps: 0, prev: null } }; const q = [start];
        while (q.length) { const u = q.shift(); for (const v of KM.A[u].road) { if (sr[v]) continue; sr[v] = { steps: sr[u].steps + 1, prev: u }; if (!roadBlocked(s, p, v)) q.push(v); } }
        delete sr[start]; for (const k of Object.keys(sr)) if (!res.land[k] || true) res.road[k] = sr[k];
      }
    }
    const load = E.stackStrength(s, ns);
    for (const sh of E.playerShips(s, p)) {
      if (sh.used || KM.P[sh.port].area !== start) continue;
      const fromSea = KM.P[sh.port].port;
      for (const q of KM.MAP.places) {
        if (!q.port || q.id === sh.port) continue; if (E._seaDist[fromSea][q.port] > SEA_RANGE) continue;
        res.sea.push({ ship: sh.key, port: q.id, area: q.area, fits: load <= sh.cap, friendly: !E.fortified(q.id) || E.isFriendly(s, q.id, p) });
      }
    }
    return res;
  };
  function pathTo(map, dest) { const out = [dest]; let cur = map[dest]; while (cur && cur.prev) { out.unshift(cur.prev); cur = map[cur.prev]; } return out; }
  // dest: {area, via:'land'|'road'|'sea', ship, port, enter: placeId|null}
  E.move = function (s, p, ids, dest, heirIds) {
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    const opt = E.moveOptions(s, p, ids); if (opt.error) return fail(opt.error);
    const ns = ids.map(id => s.nobles[id]); const from = { area: ns[0].area, inside: ns[0].inside };
    let path = [from.area, dest.area];
    if (dest.via === 'sea') {
      const o = opt.sea.find(x => x.ship === dest.ship && x.port === dest.port); if (!o) return fail('That ship cannot reach that port this turn.');
      if (!o.fits) return fail(`The ${s.ships[dest.ship].name} cannot carry so many men (capacity ${s.ships[dest.ship].cap}).`);
      s.ships[dest.ship].port = dest.port; s.ships[dest.ship].used = true; dest = Object.assign({}, dest, { area: o.area });
    } else {
      const map = dest.via === 'road' ? opt.road : opt.land; if (!map[dest.area]) return fail('Too far to march this turn.');
      path = pathTo(map, dest.area);
    }
    let inside = null;
    if (dest.enter) { if (KM.P[dest.enter].area !== dest.area || !E.isFriendly(s, dest.enter, p)) return fail('You may only enter a friendly town or castle.'); inside = dest.enter; }
    // heirs: those chosen, plus any that would be left without an escort
    const staying = E.noblesAt(s, from, p).filter(n => !ids.includes(n.id));
    const heirs = E.heirsAt(s, from).filter(h => h.ctrl === p && (!staying.length || !heirIds || heirIds.includes(h.id)));
    for (const n of ns) { n.area = dest.area; n.inside = inside; n.moved = true; }
    for (const h of heirs) { h.area = dest.area; h.inside = inside; }
    const names = ns.map(n => KM.CARD[n.id].name).join(', ');
    log(s, `${names} ${dest.via === 'sea' ? 'sail' + (ns.length === 1 ? 's' : '') + ' aboard the ' + s.ships[dest.ship].name + ' to' : dest.via === 'road' ? 'ride' + (ns.length === 1 ? 's' : '') + ' the road to' : 'march' + (ns.length === 1 ? 'es' : '') + ' to'} ${E.locName({ area: dest.area, inside })}${heirs.length ? ' with ' + heirs.map(h => KM.HEIR[h.id].name).join(' and ') : ''}.`, 'move', { area: dest.area, path, from: from.area });
    refreshHeirs(s, p);
    return { ok: true, path };
  };
  E.sailEmpty = function (s, p, shipKey, portId) {
    const sh = s.ships[shipKey]; if (!sh || E.shipOwner(s, sh) !== p) return fail('Not your ship.');
    if (s.turn.phase !== 'move' || s.turn.player !== p) return fail('Ships sail in the movement phase.');
    if (sh.used) return fail('That ship has already sailed this turn.');
    const q = KM.P[portId]; if (!q || !q.port || E._seaDist[KM.P[sh.port].port][q.port] > SEA_RANGE) return fail('Too far to sail this turn.');
    sh.port = portId; sh.used = true; log(s, `The ${sh.name} sails to ${q.name}.`, 'move'); return { ok: true };
  };
  E.shipPorts = function (s, shipKey) { const sh = s.ships[shipKey]; const fromSea = KM.P[sh.port].port; return KM.MAP.places.filter(q => q.port && q.id !== sh.port && E._seaDist[fromSea][q.port] <= SEA_RANGE).map(q => q.id); };
  // step inside / outside a friendly place without marching
  E.shelter = function (s, p, ids, placeId) {
    const err = checkGroup(s, p, ids); if (err) return fail(err); if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (s.turn.player !== p || !['move', 'combat', 'court', 'muster'].includes(s.turn.phase)) return fail('Not now.');
    const ns = ids.map(id => s.nobles[id]); const from = { area: ns[0].area, inside: ns[0].inside };
    if (placeId && (KM.P[placeId].area !== from.area || !E.isFriendly(s, placeId, p))) return fail('You may only enter a friendly town or castle in the same area.');
    const staying = E.noblesAt(s, from, p).filter(n => !ids.includes(n.id));
    const heirs = staying.length ? [] : E.heirsAt(s, from).filter(h => h.ctrl === p);
    for (const n of ns) n.inside = placeId || null; for (const h of heirs) h.inside = placeId || null;
    refreshHeirs(s, p); return { ok: true };
  };
  E.useFreeMove = function (s, p, ids) {
    const pl = s.players[p]; const i = pl.held.findIndex(id => KM.EVENT[id].type === 'freeMove'); if (i < 0) return fail('You hold no Free Move card.');
    if (s.turn.player !== p || s.turn.phase !== 'move') return fail('Play a Free Move during your movement phase.');
    const err = checkGroup(s, p, ids); if (err) return fail(err);
    if (ids.some(id => s.nobles[id].held)) return fail('A noble answering a summons cannot use a Free Move.');
    s.eventDiscard.push(pl.held.splice(i, 1)[0]); for (const id of ids) s.nobles[id].moved = false;
    log(s, `${pl.name} plays a Free Move: ${ids.map(id => KM.CARD[id].name).join(', ')} may march again.`, 'card'); return { ok: true };
  };
  E.endMovement = function (s) { if (s.turn.phase !== 'move') return fail('Not the movement phase.'); s.turn.phase = 'combat'; return { ok: true }; };

  // ---------- combat ----------
  E.combatOptions = function (s, p) {
    const out = []; if (s.turn.player !== p || s.turn.phase !== 'combat' || s.pending) return out;
    const areas = [...new Set(E.playerNobles(s, p).filter(n => !n.fought).map(n => n.area))];
    for (const area of areas) {
      if (area === 'scotland') continue;
      const mine = E.noblesInArea(s, area, p).filter(n => !n.fought); const att = E.stackStrength(s, mine, { attacking: true });
      const foes = {}; for (const n of E.noblesInArea(s, area)) if (n.owner !== p && !n.inside) (foes[n.owner] = foes[n.owner] || []).push(n);
      for (const [fp, ns] of Object.entries(foes)) { const def = E.stackStrength(s, ns); out.push({ type: 'battle', area, foe: +fp, attackers: mine.map(n => n.id), defenders: ns.map(n => n.id), att, def, ok: att >= def && !ns.some(n => n.attackedOn === s.turn.n + ':' + p), heirs: E.heirsAt(s, { area, inside: null }).filter(h => h.ctrl === +fp).map(h => h.id) }); }
      for (const pid of KM.A[area].places) {
        if (!E.fortified(pid) || E.isFriendly(s, pid, p)) continue;
        const inside = Object.values(s.nobles).filter(n => n.inside === pid); const def = KM.P[pid].garrison + E.stackStrength(s, inside);
        out.push({ type: 'siege', area, place: pid, foe: E.placeOwner(s, pid), attackers: mine.map(n => n.id), defenders: inside.map(n => n.id), att, def, ok: att >= def, heirs: E.aliveHeirs(s).filter(h => h.inside === pid).map(h => h.id) });
      }
    }
    return out;
  };
  // o: {type, area, attackers:[ids], foe (battle) | place (siege)}
  E.attack = function (s, p, o) {
    if (s.turn.player !== p || s.turn.phase !== 'combat') return fail('Battles are fought in the combat phase.');
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    const att = o.attackers.map(id => s.nobles[id]);
    if (!att.length || att.some(n => !n || n.owner !== p || n.area !== o.area || n.fought)) return fail('Those nobles cannot attack.');
    let def, garrison = 0, place = null;
    if (o.type === 'battle') { def = E.noblesInArea(s, o.area, o.foe).filter(n => !n.inside); if (!def.length) return fail('No enemy stands in the open there.'); if (def.some(n => n.attackedOn === s.turn.n + ':' + p)) return fail('That force has already been attacked this turn.'); }
    else { place = KM.P[o.place]; if (!place || place.area !== o.area || !E.fortified(place.id) || E.isFriendly(s, place.id, p)) return fail('Not a place you can besiege.'); def = Object.values(s.nobles).filter(n => n.inside === place.id); garrison = place.garrison; }
    const A = E.stackStrength(s, att, { attacking: true }), D = garrison + E.stackStrength(s, def);
    if (A < D) return fail(o.type === 'siege' ? `You need at least ${D} men to besiege ${place.name}; you have ${A}.` : `The weaker force cannot give battle (${A} against ${D}).`);
    for (const n of att) { n.fought = true; n.inside = null; }
    for (const h of E.aliveHeirs(s)) if (h.ctrl === p && h.area === o.area && !E.noblesAt(s, h, p).length) h.inside = null;
    for (const n of def) n.attackedOn = s.turn.n + ':' + p;
    let cid = drawEventCard(s), guard = 0;
    while (!KM.EVENT[cid].battle && guard++ < 40) { s.players[p].held.push(cid); log(s, `${s.players[p].name} turns up a ${KM.EVENT[cid].title} card and keeps it.`, 'card'); cid = drawEventCard(s); }
    s.eventDiscard.push(cid); const b = KM.EVENT[cid].battle;
    const res = { ok: true, type: o.type, area: o.area, place: place ? place.id : null, foe: o.type === 'battle' ? o.foe : E.placeOwner(s, o.place), card: cid, att: A, def: D, attackers: att.map(n => n.id), defenders: def.map(n => n.id), killed: [], prisoners: [], heirs: [], outcome: null };
    const what = o.type === 'siege' ? `the siege of ${place.name}` : `battle near ${E.areaName(o.area)}`;
    if (b.weather) { res.outcome = 'weather'; log(s, `Bad weather delays ${what} (${A} against ${D}).`, 'battle', { area: o.area }); return res; }
    const involved = att.concat(def);
    for (const n of involved) if (b.killed.includes(n.id)) { res.killed.push(n.id); }
    const win = o.type === 'siege' ? true : (D === 0 || A * b.odds[1] >= D * b.odds[0]);
    res.outcome = win ? 'win' : 'indecisive'; res.need = b.odds;
    log(s, `${s.players[p].name} ${o.type === 'siege' ? 'besieges ' + place.name : 'gives battle near ' + E.areaName(o.area)} with ${A} men against ${D}. ${o.type === 'siege' ? 'The walls are carried.' : `The fates demand odds of ${b.odds[0]}–${b.odds[1]}: ` + (win ? 'a victory!' : 'the day is indecisive.')}`, 'battle', { area: o.area });
    for (const id of res.killed) E.killNoble(s, id, 'is slain in the fighting', null);
    if (win) {
      const survivors = def.filter(n => s.nobles[n.id]); const victors = att.filter(n => s.nobles[n.id]);
      const lead = victors.sort((a, b2) => E.strength(s, b2) - E.strength(s, a))[0] || leadNoble(s, p, { area: o.area });
      for (const n of survivors) { // strip transferable assets to the victor
        for (const cid2 of n.mercs.concat(n.towns, n.ships)) { detach(s, n, cid2); if (lead) attach(s, lead, cid2); else s.crownDiscard.push(cid2); }
        res.prisoners.push(n.id);
      }
      if (place) {
        if (lead) {
          s.captured[place.id] = p;
          const tc = Object.values(KM.CARD).find(c => c.kind === 'town' && c.place === place.id); if (tc) { const h = E.holder(s, tc.id); if (h && h.owner !== p) { detach(s, h, tc.id); attach(s, lead, tc.id); s.captured[place.id] = p; } }
          for (const n of victors) n.inside = place.id;
          for (const h of E.aliveHeirs(s)) if (h.ctrl === p && h.area === o.area && !h.inside) h.inside = place.id;
        }
        for (const h of E.aliveHeirs(s)) if (h.inside === place.id && h.ctrl !== p) { if (lead) { h.ctrl = p; res.heirs.push(h.id); log(s, `${KM.HEIR[h.id].name} falls into the hands of ${s.players[p].name}.`, 'heir'); } }
        for (const n of survivors) n.inside = null;
      } else {
        for (const h of E.heirsAt(s, { area: o.area, inside: null })) if (h.ctrl === o.foe && lead) { h.ctrl = p; res.heirs.push(h.id); log(s, `${KM.HEIR[h.id].name} is captured by ${s.players[p].name}.`, 'heir'); }
      }
      if (res.prisoners.length && lead) s.pending = { type: 'prisoners', victor: p, list: res.prisoners.slice(), area: o.area };
      else if (res.prisoners.length) res.prisoners = [];
    }
    refreshHeirs(s, p); E.checkVictory(s);
    return res;
  };
  E.resolvePrisoner = function (s, id, fate) {
    if (!s.pending || s.pending.type !== 'prisoners' || !s.pending.list.includes(id)) return fail('No such prisoner.');
    const victor = s.pending.victor;
    if (fate === 'execute') E.killNoble(s, id, `is executed by order of ${s.players[victor].name}`, victor);
    else { log(s, `${KM.CARD[id].name} is released by ${s.players[victor].name}.`, 'info'); s.pending.list = s.pending.list.filter(x => x !== id); if (!s.pending.list.length) s.pending = null; }
    refreshHeirs(s, victor);
    return { ok: true };
  };
  E.executeHeir = function (s, p, id) {
    const h = s.heirs[id]; if (!h || !h.alive || h.ctrl !== p) return fail('That heir is not in your keeping.');
    E.killHeir(s, id, `is put to death by ${s.players[p].name}`); return { ok: true };
  };
  // share of the 70 battle cards that give victory / leave the day undecided / bring bad weather
  E.chances = function (att, def, siege) {
    let win = 0, bad = 0, n = 0;
    for (const e of KM.CARDS.events) { if (!e.battle) continue; n++; if (e.battle.weather) bad++; else if (siege || att * e.battle.odds[1] >= def * e.battle.odds[0]) win++; }
    return { win: win / n, weather: bad / n, stall: (n - win - bad) / n };
  };
  E.endCombat = function (s) { if (s.turn.phase !== 'combat') return fail('Not the combat phase.'); if (s.pending) return fail('Decide the fate of your prisoners first.'); s.turn.phase = 'court'; return { ok: true }; };

  // ---------- coronation ----------
  E.coronationOptions = function (s, p) {
    const out = [];
    for (const house of ['lancaster', 'york']) {
      const h = E.seniorHeir(s, house); if (!h || h.crowned || h.ctrl !== p) continue;
      const cath = KM.A[h.area].places.filter(pl => KM.P[pl].cathedral);
      const here = E.noblesAt(s, h, p); const bishops = here.reduce((t, n) => t.concat(n.bishops), []);
      const canCrown = bishops.some(b => KM.CARD[b].arch) || bishops.length >= 2;
      const inCath = cath.find(pl => !E.fortified(pl) || h.inside === pl);
      out.push({ heir: h.id, ok: !!inCath && canCrown, place: inCath || cath[0] || null, why: !cath.length ? 'Must be in a cathedral city.' : !inCath ? `Must be inside ${KM.P[cath[0]].name} (take the city first).` : !canCrown ? 'Needs an escort holding an Archbishop, or two Bishops.' : null });
    }
    return out;
  };
  E.crown = function (s, p, heirId) {
    if (s.turn.player !== p || !['court', 'combat', 'move'].includes(s.turn.phase)) return fail('Not now.');
    const o = E.coronationOptions(s, p).find(x => x.heir === heirId); if (!o) return fail('Only the senior heir of a house in your keeping may be crowned.');
    if (!o.ok) return fail(o.why);
    s.heirs[heirId].crowned = true; log(s, `${KM.HEIR[heirId].name} is crowned at ${KM.P[o.place].name}. Long live the ${KM.HEIR[heirId].queen ? 'Queen' : 'King'}!`, 'crown', { heir: heirId });
    E.checkVictory(s); return { ok: true };
  };

  // ---------- parliament ----------
  E.canSummon = function (s, p) {
    if (s.turn.player !== p || s.turn.phase !== 'court') return { ok: false, why: 'Parliament meets after combat.' };
    if (s.turn.parliament) return { ok: false, why: 'Parliament has already sat this turn.' };
    if (!s.chancery.length) return { ok: false, why: 'Chancery holds nothing to bestow.' };
    if (!s.turn.mustParl && s.lastParl[p] !== undefined && s.turn.round - s.lastParl[p] < 3) return { ok: false, why: 'You may not summon Parliament again so soon.' };
    const sk = E.soleKing(s); let who = null, via = null, writ = -1;
    const townAt = (x) => x.area !== 'calais' && KM.A[x.area].places.find(pl => ['city', 'town', 'open'].includes(KM.P[pl].type));
    if (sk && sk.ctrl === p) { who = sk; via = 'king'; }
    else if (s.turn.mustParl) { who = E.playerNobles(s, p).find(townAt); via = 'card'; if (!who) return { ok: false, why: 'One of your nobles must stand at a town or city.' }; }
    else if (sk) return { ok: false, why: 'Only the faction holding the King may summon Parliament.' };
    else {
      let ch = E.holder(s, 'o_chancellor');
      if (!ch) { // no Chancellor in play: the keeper of the most senior heir stands in for him
        const sen = E.aliveHeirs(s).filter(h => h.ctrl !== null).sort((a, b) => KM.HEIR[a.id].rank - KM.HEIR[b.id].rank)[0];
        if (!sen || sen.ctrl !== p) return { ok: false, why: 'With no sole King and no Chancellor, only the keeper of the most senior heir may summon Parliament.' };
        ch = E.noblesAt(s, sen, p)[0];
      } else if (ch.owner !== p) return { ok: false, why: 'With no sole King, only the Chancellor of England may summon Parliament.' };
      writ = s.players[p].held.findIndex(id => ['writ', 'chParl'].includes(KM.EVENT[id].type)); if (writ < 0) return { ok: false, why: 'The Chancellor needs a Writ of Summons card.' };
      who = ch; via = 'chancellor';
    }
    const venue = townAt(who);
    if (!venue) return { ok: false, why: `${via === 'king' ? 'The King' : 'The Chancellor'} must be at a town or city.` };
    return { ok: true, via, venue, writ };
  };
  E.openParliament = function (s, p) {
    const c = E.canSummon(s, p); if (!c.ok) return fail(c.why);
    if (c.via === 'chancellor') s.eventDiscard.push(s.players[p].held.splice(c.writ, 1)[0]);
    s.turn.parliament = true; s.lastParl[p] = s.turn.round;
    const votes = s.players.map(pl => E.votes(s, pl.id));
    s.parl = { summoner: p, venue: c.venue, cards: s.chancery.slice(0, 8), votes: votes.map(v => ({ commons: v.commons, lords: v.lords })), favoured: {}, results: [] };
    log(s, `${s.players[p].name} summons Parliament to ${KM.P[c.venue].name}.`, 'parliament');
    if (s.options.parliamentVictory && c.via === 'king') {
      const tot = votes.reduce((t, v) => t + v.commons, 0); const mine = votes[p];
      if (mine.commons * 2 > tot && votes.every((v, i) => i === p || v.lords < mine.lords)) { s.parl = null; return win(s, p, `${s.players[p].name} commands both Houses of Parliament in the name of ${KM.HEIR[E.soleKing(s).id].name}.`); }
    }
    return { ok: true, parl: s.parl };
  };
  E.parlTargets = function (s, cardId) {
    const k = KM.CARD[cardId].kind; const all = Object.values(s.nobles);
    if (k === 'title') return all.filter(n => !E.isTitled(s, n)).map(n => n.id);
    if (k === 'office') return all.filter(n => E.isTitled(s, n) && !n.office).map(n => n.id);
    return all.map(n => n.id);
  };
  // ballots: {playerId: true|false} — the summoner always votes aye; missing ballots abstain
  E.propose = function (s, cardId, nobleId, ballots) {
    const P = s.parl; if (!P || !P.cards.includes(cardId)) return fail('Not before Parliament.');
    if (!E.parlTargets(s, cardId).includes(nobleId)) return fail('That noble is not eligible.');
    const n = s.nobles[nobleId]; const lordsOnly = KM.CARD[cardId].kind === 'bishop';
    let ayeC = 0, noC = 0, ayeL = 0, noL = 0;
    s.players.forEach((pl, i) => { const v = i === P.summoner ? true : ballots[i]; if (v === undefined) return; if (v) { ayeC += P.votes[i].commons; ayeL += P.votes[i].lords; } else { noC += P.votes[i].commons; noL += P.votes[i].lords; } });
    const pass = ayeL > noL && (lordsOnly || ayeC > noC);
    P.cards.splice(P.cards.indexOf(cardId), 1);
    const r = { card: cardId, noble: nobleId, pass, ayeC, noC, ayeL, noL, lordsOnly }; P.results.push(r);
    if (n.owner !== P.summoner) P.favoured[n.owner] = true;
    if (pass) { s.chancery.splice(s.chancery.indexOf(cardId), 1); attach(s, n, cardId); refreshHeirs(s); log(s, `Parliament grants ${KM.CARD[cardId].name} to ${KM.CARD[nobleId].name} (${s.players[n.owner].name}).`, 'parliament'); }
    else log(s, `Parliament refuses ${KM.CARD[cardId].name} to ${KM.CARD[nobleId].name}.`, 'parliament');
    return Object.assign({ ok: true }, r);
  };
  E.closeParliament = function (s) { if (!s.parl) return fail('Parliament is not sitting.'); s.parl = null; log(s, 'Parliament is dissolved.', 'parliament'); return { ok: true }; };

  // ---------- end of turn / victory ----------
  function win(s, p, text) { if (s.winner === null) { s.winner = p; s.winText = text; log(s, text, 'victory'); } return { ok: true, winner: p }; }
  E.checkVictory = function (s) {
    if (s.winner !== null) return true;
    const alive = E.aliveHeirs(s); const beau = s.nobles.beaufort;
    if (alive.length === 1) {
      const h = alive[0];
      if ((h.crowned || !s.options.crownToWin) && h.ctrl !== null && (KM.HEIR[h.id].house === 'lancaster' || !beau)) { win(s, h.ctrl, `${KM.HEIR[h.id].name} reigns unchallenged. ${s.players[h.ctrl].name} is the Kingmaker.`); return true; }
    } else if (alive.length === 0) {
      if (beau) { win(s, beau.owner, `Both royal houses are extinct but for Beaufort, last of the blood of Lancaster. ${s.players[beau.owner].name} is the Kingmaker.`); return true; }
      const best = s.players.slice().sort((a, b) => E.factionStrength(s, b.id) - E.factionStrength(s, a.id))[0];
      win(s, best.id, `The royal blood is spent. ${best.name}, strongest in the field, seizes the realm.`); return true;
    }
    return false;
  };
  E.endTurn = function (s) {
    if (s.winner !== null) return { ok: true };
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (s.parl) E.closeParliament(s);
    if (s.turn.phase === 'event') return fail('Draw your Event card first.');
    const p = s.turn.player; const pl = s.players[p];
    const drawn = drawCrownCard(s); if (drawn) { pl.hand.push(drawn); log(s, `${pl.name} draws a Crown card.`, 'draw', { priv: p, card: drawn }); }
    for (const n of Object.values(s.nobles)) n.held = false;
    refreshHeirs(s); if (E.checkVictory(s)) return { ok: true, drawn };
    const n = s.players.length; s.turn.player = (p + 1) % n; s.turn.n++; if (s.turn.player === s.firstPlayer) s.turn.round++;
    startTurn(s);
    return { ok: true, drawn };
  };
  E.refreshHeirs = refreshHeirs;
  E.serialize = (s) => JSON.stringify(s);
  E.deserialize = (txt) => { E.init(); return JSON.parse(txt); };
})();
