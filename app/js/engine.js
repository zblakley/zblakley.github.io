/* Kingmaker v2 — rules engine following the Avalon Hill rulebook (Basic game with the optional
   Parliament, Bishop and Victory rules as options). Pure logic, no DOM; runs in node for tests. */
(function () {
  const KM = (globalThis.KM = globalThis.KM || {});
  const E = (KM.Engine = {});
  const MOVE = 5, SHIP_MOVE = 5;
  const GARRISON = { city: 300, town: 200, royal: 200, castle: 100 };
  const CAPACITY = { city: Infinity, town: 400, royal: 300, castle: 300 };
  const FORT = { city: 1, town: 1, royal: 1, castle: 1 };

  // ---------- static lookups ----------
  E.init = function () {
    if (KM.A) return;
    KM.A = {}; KM.P = {}; KM.SEA = {};
    for (const a of KM.MAP.areas) KM.A[a.id] = a;
    for (const p of KM.MAP.places) { KM.P[p.id] = p; p.garrison = GARRISON[p.type] || 0; }
    for (const z of KM.MAP.seas) { KM.SEA[z.id] = z; KM.A[z.id] = { id: z.id, sea: true, c: z.c, d: z.d, adj: [], road: [], places: [], flags: [], region: 'sea' }; }
    KM.CARD = {};
    const C = KM.CARDS;
    for (const k of ['nobles', 'titles', 'offices', 'bishops', 'mercs', 'ships', 'towns']) for (const c of C[k]) KM.CARD[c.id] = c;
    KM.HEIR = {}; for (const h of C.heirs) KM.HEIR[h.id] = h;
    KM.EVENT = {}; for (const e of C.events) KM.EVENT[e.id] = e;
    // places that sit on a road and can block road movement
    KM.ROADPLACE = {};
    const byName = {}; for (const p of KM.MAP.places) byName[p.name] = p.id;
    for (const r of KM.MAP.roads || []) for (const pt of r.pts) { const id = typeof pt === 'string' ? byName[pt] : null; if (id) KM.ROADPLACE[id] = true; }
    for (const r of KM.MAP.roads || []) r.pts = r.pts.map(pt => typeof pt === 'string' ? [KM.P[byName[pt]].x, KM.P[byName[pt]].y] : pt);
    E._dist = {};
  };
  E.dist = function (a, b) {
    if (a === b) return 0;
    let d = E._dist[a];
    if (!d) { d = E._dist[a] = { [a]: 0 }; const q = [a]; while (q.length) { const u = q.shift(); for (const v of KM.A[u].adj) if (d[v] === undefined) { d[v] = d[u] + 1; q.push(v); } } }
    return d[b] === undefined ? Infinity : d[b];
  };
  E.isSea = id => !!(KM.A[id] && KM.A[id].sea);
  E.areaName = function (id) {
    const a = KM.A[id]; if (!a) return '?';
    if (a.sea) return 'the open sea';
    if (a.name) return a.name;
    if (a.places.length) return a.places.map(p => KM.P[p].name).join(' & ');
    let best = null, bd = Infinity;
    for (const p of KM.MAP.places) { const d = Math.hypot(p.x - a.c[0], p.y - a.c[1]); if (d < bd) { bd = d; best = p; } }
    const dx = a.c[0] - best.x, dy = a.c[1] - best.y;
    const dir = Math.abs(dx) > 2 * Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : Math.abs(dy) > 2 * Math.abs(dx) ? (dy > 0 ? 'south' : 'north') : (dy > 0 ? 'south' : 'north') + (dx > 0 ? '-east' : '-west');
    return 'the country ' + dir + ' of ' + best.name;
  };
  E.locName = (loc) => loc.ship ? 'aboard ship' : loc.inside ? KM.P[loc.inside].name : E.areaName(loc.area);

  // ---------- rng / log ----------
  function rnd(s) { s.rng = (s.rng + 0x6D2B79F5) | 0; let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function shuffle(s, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  E.random = rnd;
  function log(s, text, kind, extra) { s.log.push(Object.assign({ t: s.turn ? s.turn.n : 0, p: s.turn ? s.turn.player : null, text, kind: kind || 'info' }, extra || {})); if (s.log.length > 500) s.log.splice(0, s.log.length - 500); }
  E.log = log;
  const fail = (error) => ({ ok: false, error });

  // ---------- new game ----------
  E.newGame = function (cfg) {
    E.init();
    const C = KM.CARDS;
    const s = {
      v: 2, rng: (cfg.seed || Math.floor(Math.random() * 2 ** 31)) | 0,
      options: Object.assign({ votes: true, bishopsToChancery: false, parliamentVictory: false, crownToWin: true }, cfg.options || {}),
      players: cfg.players.map((p, i) => ({ id: i, name: p.name, color: p.color, ai: !!p.ai, hand: [], held: [], mustered: false })),
      nobles: {}, heirs: {}, ships: {}, captured: {}, heldBy: {}, sieges: {}, beaufortKing: false, peace: null, bothSince: {},
      crownDeck: [], chancery: [], eventDeck: [], eventDiscard: [],
      turn: { n: 0, player: 0, phase: 'muster', round: 1 }, pending: null, parl: null, log: [], winner: null, winText: null
    };
    for (const h of C.heirs) { const pl = KM.P[h.start]; s.heirs[h.id] = { id: h.id, alive: true, area: pl.area, inside: FORT[pl.type] ? pl.id : null, ctrl: null, crowned: !!h.crowned }; }
    s.crownDeck = shuffle(s, Object.keys(KM.CARD));
    s.eventDeck = shuffle(s, C.events.map(e => e.id));
    const n = s.players.length, per = Math.floor((C.deal || 36) / n);
    for (let k = 0; k < per; k++) for (const p of s.players) p.hand.push(s.crownDeck.pop());
    // a faction dealt no Noble draws until one appears; the others go back and the deck is reshuffled
    for (const p of s.players) {
      if (p.hand.some(id => KM.CARD[id].kind === 'noble')) continue;
      const i = s.crownDeck.findIndex(id => KM.CARD[id].kind === 'noble'); if (i >= 0) p.hand.push(s.crownDeck.splice(i, 1)[0]);
    }
    shuffle(s, s.crownDeck);
    log(s, `The realm is divided. ${per} Crown cards are dealt to each faction.`, 'phase');
    return s;
  };

  // ---------- queries ----------
  E.card = (id) => KM.CARD[id];
  E.playerNobles = (s, p) => Object.values(s.nobles).filter(n => n.owner === p);
  E.holder = (s, cardId) => { const id = s.heldBy[cardId]; return id ? s.nobles[id] : null; };
  E.sameLoc = (a, b) => a.area === b.area && (a.inside || null) === (b.inside || null) && (a.ship || null) === (b.ship || null);
  E.noblesAt = (s, loc, p) => Object.values(s.nobles).filter(n => E.sameLoc(n, loc) && (p === undefined || n.owner === p));
  E.noblesInArea = (s, area, p) => Object.values(s.nobles).filter(n => n.area === area && !n.ship && (p === undefined || n.owner === p));
  E.heirsAt = (s, loc) => Object.values(s.heirs).filter(h => h.alive && E.sameLoc(h, loc));
  E.isTitled = (s, n) => !!(KM.CARD[n.id].title || n.title);
  E.titleName = (s, n) => n.title ? KM.CARD[n.title].name : KM.CARD[n.id].title;
  E.attachments = (n) => [n.title, n.office].filter(Boolean).concat(n.bishops, n.mercs, n.towns, n.ships);
  E.transferable = (cardId) => ['merc', 'town', 'ship', 'bishop'].includes(KM.CARD[cardId].kind);
  E.fortified = (placeId) => !!FORT[KM.P[placeId].type];
  E.capacity = (placeId) => CAPACITY[KM.P[placeId].type] || 0;
  E.atSea = (n) => !!n.ship;
  E.onIsland = (x) => !x.ship && KM.A[x.area] && (KM.A[x.area].flags || []).includes('island');

  // who controls each fortified place: capture overrides; else the noble holding the card that names it
  E.placeSources = function () {
    if (E._src) return E._src; const m = {};
    for (const c of Object.values(KM.CARD)) {
      for (const pl of (c.castles || [])) (m[pl] = m[pl] || []).push(c.id);
      for (const pl of (c.places || [])) (m[pl] = m[pl] || []).push(c.id);
      if (c.kind === 'town') (m[c.place] = m[c.place] || []).push(c.id);
      if (c.kind === 'bishop') (m[c.see] = m[c.see] || []).push(c.id);
    }
    return (E._src = m);
  };
  E.placeOwner = function (s, placeId) {
    if (!FORT[KM.P[placeId].type]) return null;
    if (s.captured[placeId] !== undefined) return s.captured[placeId];
    for (const cid of (E.placeSources()[placeId] || [])) { const c = KM.CARD[cid]; const n = c.kind === 'noble' ? s.nobles[cid] : E.holder(s, cid); if (n) return n.owner; }
    return null;
  };
  E.isFriendly = (s, placeId, p) => FORT[KM.P[placeId].type] ? E.placeOwner(s, placeId) === p : false;
  E.friendlyPlaces = (s, p) => KM.MAP.places.filter(pl => E.isFriendly(s, pl.id, p)).map(pl => pl.id);
  E.troopsInside = (s, placeId, except) => Object.values(s.nobles).filter(n => n.inside === placeId && !(except || []).includes(n.id)).reduce((t, n) => t + E.strength(s, n), 0);
  E.roomFor = (s, placeId, troops, except) => E.troopsInside(s, placeId, except) + troops <= E.capacity(placeId);

  function bonusApplies(b, area) {
    if (!b || !area || E.isSea(area)) return false;
    const A = KM.A[area];
    if (b.region) return A.region === b.region || (b.region === 'wales' && A.places.includes('beaumaris'));
    if (b.flag) return (A.flags || []).includes(b.flag);
    if (b.near) { const pa = KM.P[b.near].area; return E.dist(pa, area) <= b.within || (b.near === 'conway' && A.places.includes('beaumaris')); }
    return false;
  }
  E.strengthParts = function (s, n, ctx) {
    ctx = ctx || {}; const area = n.ship ? null : (ctx.area || n.area); const c = KM.CARD[n.id];
    const out = [{ label: c.name + (c.title ? ', ' + c.title : ''), troops: c.troops, on: true }];
    if (n.title) out.push({ label: KM.CARD[n.title].name, troops: KM.CARD[n.title].troops, on: true });
    if (n.office) { const o = KM.CARD[n.office]; out.push({ label: o.name, troops: o.troops, on: true }); if (o.bonus) out.push({ label: o.name + ': +' + o.bonus.troops + ' ' + o.bonus.text, troops: o.bonus.troops, on: bonusApplies(o.bonus, area) }); }
    for (const b of n.bishops) { const o = KM.CARD[b]; if (o.bonus) out.push({ label: o.name + ': ' + o.bonus.text, troops: o.bonus.troops, on: bonusApplies(o.bonus, area) }); }
    for (const m of n.mercs) out.push({ label: KM.CARD[m].name, troops: KM.CARD[m].troops, on: true });
    return out;
  };
  E.strength = (s, n, ctx) => E.strengthParts(s, n, ctx).reduce((t, x) => t + (x.on ? x.troops : 0), 0);
  E.stackStrength = (s, nobles, ctx) => nobles.reduce((t, n) => t + E.strength(s, typeof n === 'string' ? s.nobles[n] : n, ctx), 0);
  E.factionStrength = (s, p) => E.stackStrength(s, E.playerNobles(s, p));

  // ---------- royal line ----------
  E.aliveHeirs = (s) => Object.values(s.heirs).filter(h => h.alive);
  E.seniorHeir = function (s, house) { const hs = KM.CARDS.heirs.filter(h => h.house === house && s.heirs[h.id].alive).sort((a, b) => a.rank - b.rank); return hs.length ? s.heirs[hs[0].id] : null; };
  E.kings = (s) => E.aliveHeirs(s).filter(h => h.crowned);
  E.soleKing = (s) => { const k = E.kings(s); const b = s.beaufortKing && s.nobles.beaufort; const n = k.length + (b ? 1 : 0); return n === 1 ? (k[0] || null) : null; };
  E.lancasterExtinct = (s) => !E.seniorHeir(s, 'lancaster');

  E.votes = function (s, p) {
    const d = { commons: 0, lords: 0, parts: [] }; const add = (house, label, v) => { if (!v) return; d[house] += v; d.parts.push({ house, label, v }); };
    const sk = E.soleKing(s);
    if (sk && sk.ctrl === p) add('commons', 'The King', 20);
    else if (!sk) { const ch = E.holder(s, 'o_chancellor'); if (ch && ch.owner === p) add('commons', 'Chancellor of England', 20); }
    for (const h of ['lancaster', 'york']) { const sh = E.seniorHeir(s, h); if (sh && sh.ctrl === p) { add('commons', 'Senior ' + (h === 'york' ? 'Yorkist' : 'Lancastrian'), 10); add('lords', 'Senior ' + (h === 'york' ? 'Yorkist' : 'Lancastrian'), 10); } }
    for (const n of E.playerNobles(s, p)) {
      const c = KM.CARD[n.id]; add('commons', c.name, c.commons || 0); add('lords', c.name, c.lords || 1);
      if (n.title) add('commons', KM.CARD[n.title].name, KM.CARD[n.title].commons || 1);
      if (n.office) add('commons', KM.CARD[n.office].name, KM.CARD[n.office].commons || 0);
      for (const b of n.bishops) add('lords', KM.CARD[b].name, KM.CARD[b].lords || 0);
    }
    for (const pl of KM.MAP.places) {
      if (!(pl.type === 'city' || pl.type === 'town') || pl.id === 'calais' || pl.id === 'swansea') continue;
      if (E.placeOwner(s, pl.id) === p) add('commons', pl.name, pl.type === 'city' ? 4 : 3);
    }
    return d;
  };

  // ---------- card attachment ----------
  function attach(s, n, cardId) {
    const c = KM.CARD[cardId]; s.heldBy[cardId] = n.id;
    if (c.kind === 'title') n.title = cardId; else if (c.kind === 'office') n.office = cardId; else if (c.kind === 'bishop') n.bishops.push(cardId); else if (c.kind === 'merc') n.mercs.push(cardId); else if (c.kind === 'town') n.towns.push(cardId); else if (c.kind === 'ship') n.ships.push(cardId);
    for (const pl of (c.places || [])) delete s.captured[pl];
    if (c.kind === 'town') delete s.captured[c.place];
    if (c.kind === 'bishop') delete s.captured[c.see];
    if (c.kind === 'ship' && !s.ships[cardId]) s.ships[cardId] = { key: cardId, name: c.name, cap: c.cap, loc: c.ports[0], used: false, src: cardId };
    if (c.kind === 'office') (c.ships || []).forEach((sh, i) => { const key = cardId + ':' + i; if (!s.ships[key]) s.ships[key] = { key, name: sh.name, cap: sh.cap, loc: sh.port, used: false, src: cardId }; });
  }
  function detach(s, n, cardId) {
    delete s.heldBy[cardId];
    if (n.title === cardId) n.title = null; if (n.office === cardId) n.office = null;
    for (const k of ['bishops', 'mercs', 'towns', 'ships']) { const i = n[k].indexOf(cardId); if (i >= 0) n[k].splice(i, 1); }
  }
  // a ship whose card leaves play: passengers aboard are put ashore at the nearest port
  function dropShip(s, key) {
    const sh = s.ships[key]; if (!sh) return;
    const aboard = Object.values(s.nobles).filter(n => n.ship === key);
    if (aboard.length) { const port = KM.P[sh.loc] ? sh.loc : nearestPort(s, sh.loc); landAt(s, aboard, port, key); }
    delete s.ships[key];
  }
  function returnToDeck(s, cid) { const i = Math.floor(rnd(s) * (s.crownDeck.length + 1)); s.crownDeck.splice(i, 0, cid); }
  E.shipOwner = (s, ship) => { const n = E.holder(s, ship.src); return n ? n.owner : null; };
  E.playerShips = (s, p) => Object.values(s.ships).filter(sh => E.shipOwner(s, sh) === p);
  E.shipAtSea = (sh) => !KM.P[sh.loc];
  E.shipArea = (sh) => KM.P[sh.loc] ? KM.P[sh.loc].area : sh.loc;

  function leadNoble(s, p, loc) { const ns = (loc ? E.noblesInArea(s, loc.area, p) : E.playerNobles(s, p)); return ns.sort((a, b) => E.strength(s, b) - E.strength(s, a))[0] || null; }

  // keep derived state consistent: walls, heirs, sieges
  function refresh(s, actor) {
    for (const n of Object.values(s.nobles)) if (n.inside && !E.isFriendly(s, n.inside, n.owner)) {
      const pl = n.inside; n.inside = null; log(s, `${KM.CARD[n.id].name} is turned out of ${KM.P[pl].name}.`, 'info');
      for (const h of E.aliveHeirs(s)) if (h.inside === pl && h.ctrl === n.owner) h.inside = null;
    }
    for (const [pl, sg] of Object.entries(s.sieges)) {
      const need = KM.P[pl].garrison + E.stackStrength(s, Object.values(s.nobles).filter(n => n.inside === pl));
      if (E.placeOwner(s, pl) === sg.by || E.stackStrength(s, E.noblesInArea(s, KM.P[pl].area, sg.by)) < need) { delete s.sieges[pl]; log(s, `The siege of ${KM.P[pl].name} is lifted.`, 'info'); }
    }
    for (const h of E.aliveHeirs(s)) {
      if (h.ctrl !== null && !E.noblesAt(s, h, h.ctrl).length) h.ctrl = null;
      if (h.ctrl === null) {
        const here = [...new Set(E.noblesAt(s, h).map(n => n.owner))];
        const who = (actor !== undefined && actor !== null && here.includes(actor)) ? actor : here.length === 1 ? here[0] : null;
        if (who !== null) { h.ctrl = who; log(s, `${s.players[who].name} takes ${KM.HEIR[h.id].name} into their keeping at ${E.locName(h)}.`, 'heir', { heir: h.id }); }
      }
    }
    if (s.beaufortKing && !s.nobles.beaufort) s.beaufortKing = false;
  }
  E.refreshHeirs = refresh;

  E.killHeir = function (s, id, why) {
    const h = s.heirs[id]; if (!h.alive) return; h.alive = false; const was = h.crowned; h.crowned = false; h.ctrl = null;
    log(s, `${KM.HEIR[id].name}${was ? ', crowned monarch,' : ''} ${why}.`, 'death', { heir: id });
    E.checkVictory(s);
  };
  // captor: faction that took the noble (receives his transferable cards), or null
  E.killNoble = function (s, id, why, captor) {
    const n = s.nobles[id]; if (!n) return;
    const c = KM.CARD[id];
    for (const cid of E.attachments(n).slice()) {
      const k = KM.CARD[cid].kind; detach(s, n, cid);
      if (k === 'title' || k === 'office') { s.chancery.push(cid); if (k === 'office') (KM.CARD[cid].ships || []).forEach((x, i) => dropShip(s, cid + ':' + i)); }
      else if (k === 'bishop' && s.options.bishopsToChancery) s.chancery.push(cid);
      else { if (k === 'ship') dropShip(s, cid); returnToDeck(s, cid); }
    }
    // places he alone held become neutral; anyone inside is expelled
    delete s.nobles[id]; returnToDeck(s, id);
    for (const pl of c.castles || []) delete s.captured[pl];
    if (id === 'beaufort') s.beaufortKing = false;
    log(s, `${c.name}${c.title ? ', ' + c.title + ',' : ''} ${why}.`, 'death', { noble: id });
    if (s.pending && s.pending.list) { s.pending.list = s.pending.list.filter(x => x !== id); if (!s.pending.list.length) s.pending = null; }
    refresh(s, captor);
    E.checkVictory(s);
  };
  function drawEventCard(s) { if (!s.eventDeck.length) { s.eventDeck = shuffle(s, s.eventDiscard); s.eventDiscard = []; log(s, 'The Event deck is reshuffled.', 'info'); } return s.eventDeck.pop(); }
  function drawCrownCard(s) { return s.crownDeck.length ? s.crownDeck.pop() : null; }

  // ---------- playing Crown cards ----------
  const troopCard = (cid) => { const c = KM.CARD[cid]; return (c.troops || 0) > 0 || !!c.bonus; };
  E.underSiege = (s, n) => !!(n.inside && s.sieges[n.inside]);
  E.cardTargets = function (s, p, cardId) {
    const c = KM.CARD[cardId]; let mine = E.playerNobles(s, p);
    if (c.kind === 'noble') {
      const free = c.castles.filter(pl => { const o = E.placeOwner(s, pl); return (o === null && s.captured[pl] === undefined) || o === p; });
      if (free.length) return free;
      const fr = E.friendlyPlaces(s, p); const home = KM.P[c.castles[0]];
      if (fr.length) return fr.sort((a, b) => Math.hypot(KM.P[a].x - home.x, KM.P[a].y - home.y) - Math.hypot(KM.P[b].x - home.x, KM.P[b].y - home.y)).slice(0, 1);
      return [];
    }
    if (troopCard(cardId)) mine = mine.filter(n => !n.ship && !E.underSiege(s, n));
    if (c.kind === 'title') return mine.filter(n => !E.isTitled(s, n)).map(n => n.id);
    if (c.kind === 'office') return mine.filter(n => E.isTitled(s, n) && !n.office).map(n => n.id);
    return mine.map(n => n.id);
  };
  const canPlayNow = (s, p) => s.turn.phase === 'muster' ? !s.players[p].mustered : (s.turn.player === p && s.winner === null);
  E.playCard = function (s, p, cardId, target) {
    const pl = s.players[p]; const i = pl.hand.indexOf(cardId); if (i < 0) return fail('That card is not in your hand.');
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (!canPlayNow(s, p)) return fail('Crown cards are played in your own turn.');
    const c = KM.CARD[cardId]; const targets = E.cardTargets(s, p, cardId);
    if (!targets.includes(target)) return fail(c.kind === 'noble' ? 'He can only be raised at one of his castles, or the nearest friendly place if they are lost.' : c.kind === 'title' ? 'A title can only go to an untitled noble.' : c.kind === 'office' ? 'An office needs a titled noble who holds no other office.' : 'Not a legal recipient (nobles at sea or under siege cannot gain troops).');
    pl.hand.splice(i, 1);
    if (c.kind === 'noble') {
      const place = KM.P[target]; const inside = E.fortified(target) && E.placeOwner(s, target) === null || E.isFriendly(s, target, p);
      s.nobles[cardId] = { id: cardId, owner: p, area: place.area, inside: inside && E.fortified(target) ? target : null, ship: null, title: null, office: null, bishops: [], mercs: [], towns: [], ships: [], moved: s.turn.phase !== 'muster', fought: false, free: false };
      log(s, `${pl.name} raises the banner of ${c.name}${c.title ? ', ' + c.title : ''} at ${place.name}.`, 'card', { noble: cardId });
      refresh(s, p);
    } else {
      const n = s.nobles[target]; attach(s, n, cardId);
      log(s, `${pl.name} grants ${c.name} to ${KM.CARD[n.id].name}.`, 'card', { noble: n.id });
      refresh(s, p);
    }
    return { ok: true };
  };
  // transferables pass to any other noble in the same square, of any faction
  E.transferTargets = function (s, p, cardId) {
    const from = E.holder(s, cardId); if (!from || from.owner !== p || !E.transferable(cardId) || from.ship) return [];
    return E.noblesInArea(s, from.area).filter(n => n.id !== from.id).map(n => n.id);
  };
  E.transfer = function (s, p, cardId, toId) {
    if (s.turn.player !== p && s.turn.phase !== 'muster') return fail('Transfers are made in your own turn.');
    if (!E.transferTargets(s, p, cardId).includes(toId)) return fail('Bishoprics, mercenaries, towns and ships pass only to another noble in the same square.');
    const from = E.holder(s, cardId); const to = s.nobles[toId];
    if (troopCard(cardId) && E.underSiege(s, to)) return fail('A noble under siege cannot receive troops.');
    detach(s, from, cardId); attach(s, to, cardId);
    log(s, `${KM.CARD[cardId].name} passes from ${KM.CARD[from.id].name} to ${KM.CARD[toId].name}${to.owner !== p ? ' of ' + s.players[to.owner].name : ''}.`, 'card');
    refresh(s, p); return { ok: true };
  };
  E.giveCard = function (s, p, cardId, toPlayer) {
    const pl = s.players[p]; if (toPlayer === p || !s.players[toPlayer]) return fail('Cannot give that card.');
    let i = pl.hand.indexOf(cardId);
    if (i >= 0) { if (!['ship', 'bishop', 'town', 'merc'].includes(KM.CARD[cardId].kind)) return fail('Only ships, bishoprics, towns and mercenaries in hand may be traded.'); pl.hand.splice(i, 1); s.players[toPlayer].hand.push(cardId); }
    else { i = pl.held.indexOf(cardId); if (i < 0 || KM.EVENT[cardId].type !== 'writ') return fail('Only Writs may be given away.'); pl.held.splice(i, 1); s.players[toPlayer].held.push(cardId); }
    log(s, `${pl.name} hands a card to ${s.players[toPlayer].name}.`, 'card'); return { ok: true };
  };

  // ---------- muster ----------
  E.finishMuster = function (s, p) {
    const pl = s.players[p]; if (s.turn.phase !== 'muster' || pl.mustered) return fail('Muster is over.');
    if (pl.hand.some(id => KM.CARD[id].kind === 'noble' && E.cardTargets(s, p, id).length)) return fail('Place all your nobles first.');
    for (const id of pl.hand.slice()) {
      const k = KM.CARD[id].kind; const t = E.cardTargets(s, p, id);
      if (t.length && k !== 'title' && k !== 'office') { const best = t.map(x => s.nobles[x]).sort((a, b) => E.strength(s, b) - E.strength(s, a))[0]; E.playCard(s, p, id, best.id); }
    }
    for (const id of pl.hand.slice()) {
      const k = KM.CARD[id].kind; pl.hand.splice(pl.hand.indexOf(id), 1);
      if (k === 'title' || k === 'office') { s.chancery.push(id); log(s, `${KM.CARD[id].name} cannot be bestowed and goes to Chancery.`, 'card'); } else returnToDeck(s, id);
    }
    pl.mustered = true;
    if (s.players.every(x => x.mustered)) {
      // first player: Chancellor, else the senior bishop, else the most troops
      let first = null; const ch = E.holder(s, 'o_chancellor'); if (ch) first = ch.owner;
      if (first === null) for (const b of ['b_canterbury', 'b_york', 'b_durham', 'b_carlisle', 'b_lincoln', 'b_norwich']) { const h = E.holder(s, b); if (h) { first = h.owner; break; } }
      if (first === null) first = s.players.slice().sort((a, b) => E.factionStrength(s, b.id) - E.factionStrength(s, a.id))[0].id;
      s.firstPlayer = first; s.turn = { n: 1, round: 1, player: first, phase: 'event' }; startTurn(s);
      log(s, `The wars begin. ${s.players[first].name} moves first${ch ? ', holding the Chancellor of England' : ''}.`, 'phase');
    }
    return { ok: true };
  };
  function startTurn(s) {
    const p = s.turn.player;
    for (const n of E.playerNobles(s, p)) { n.moved = false; n.fought = false; n.free = false; }
    for (const sh of Object.values(s.ships)) if (E.shipOwner(s, sh) === p) { sh.used = false; sh.free = false; }
    if (s.peace && s.peace.until === s.turn.n) s.peace = null;
    Object.assign(s.turn, { phase: 'event', event: null, parliament: false, attended: null, aiDone: null, aiParl: false });
  }

  // ---------- events ----------
  function relocate(s, n, placeId, areaId) {
    const area = placeId ? KM.P[placeId].area : areaId; const from = { area: n.area, inside: n.inside, ship: null };
    const alone = !E.noblesAt(s, from, n.owner).some(x => x.id !== n.id);
    n.area = area; n.inside = placeId && E.isFriendly(s, placeId, n.owner) && E.roomFor(s, placeId, E.strength(s, n), [n.id]) ? placeId : null;
    if (alone) for (const h of E.heirsAt(s, from)) if (h.ctrl === n.owner) { h.area = n.area; h.inside = n.inside; }
  }
  function findCalled(s, call) { return call.kind === 'noble' ? (s.nobles[call.id] || null) : E.holder(s, call.id); }
  E.cannotRespond = (s, x) => !!(x.ship || E.onIsland(x) || (x.inside && s.sieges[x.inside]) || x.area === KM.P.calais.area);
  function nearestPort(s, seaOrArea) {
    const d = seaDistances(seaOrArea, Infinity); let best = null, bd = Infinity;
    for (const [k, v] of Object.entries(d)) if (KM.P[k] && v < bd) { bd = v; best = k; }
    return best;
  }
  E.drawEvent = function (s) {
    if (s.turn.phase !== 'event') return fail('Not the event phase.');
    const p = s.turn.player; const id = drawEventCard(s); const ev = KM.EVENT[id]; const fx = [];
    s.turn.event = id; s.turn.phase = 'move';
    log(s, `Event: ${ev.title}`, 'event', { event: id });
    if (ev.type === 'plague') {
      let any = false;
      for (const pid of ev.places) {
        const pl = KM.P[pid];
        for (const n of Object.values(s.nobles).filter(n => n.inside === pid || (!E.fortified(pid) && n.area === pl.area && !n.ship))) { any = true; fx.push({ t: 'death', noble: n.id, area: pl.area }); E.killNoble(s, n.id, `dies of the plague at ${pl.name}`, null); }
        for (const h of E.aliveHeirs(s).filter(h => h.inside === pid)) { any = true; fx.push({ t: 'death', heir: h.id, area: pl.area }); E.killHeir(s, h.id, `dies of the plague at ${pl.name}`); }
      }
      if (!any) log(s, 'The pestilence finds no great lord within the walls.', 'info');
      s.eventDiscard.push(id);
    } else if (ev.type === 'summons') {
      const done = {};
      for (const call of ev.calls) {
        const n = findCalled(s, call);
        if (n && !done[n.id]) {
          if (E.cannotRespond(s, n)) log(s, `${KM.CARD[n.id].name} cannot answer the call from ${E.locName(n)}.`, 'info');
          else {
            const dest = call.to ? null : (KM.MAP.areas.find(a => a.name === 'The Cheviots') || {}).id;
            relocate(s, n, call.to || null, dest); done[n.id] = true;
            fx.push({ t: 'summon', noble: n.id, to: n.area });
            log(s, `${KM.CARD[n.id].name} is called to ${call.to ? KM.P[call.to].name : 'the Cheviots'}.`, 'move', { noble: n.id });
          }
        }
        if (call.ships && call.kind === 'card') { // the office's ships must always respond
          const office = KM.CARD[call.id]; (office.ships || []).slice(0, call.ships).forEach((x, i) => {
            const sh = s.ships[call.id + ':' + i]; if (!sh) return;
            const aboard = Object.values(s.nobles).filter(m => m.ship === sh.key);
            sh.loc = call.to; if (aboard.length) landAt(s, aboard, call.to, sh.key);
            fx.push({ t: 'ship', ship: sh.key, to: KM.P[call.to].area }); log(s, `The ${sh.name} puts in at ${KM.P[call.to].name}.`, 'move');
          });
        }
      }
      if (!fx.length) log(s, 'No one in play is bound to answer.', 'info');
      refresh(s); s.eventDiscard.push(id);
    } else if (ev.type === 'embassy') {
      const k = E.soleKing(s);
      if (!k) log(s, 'With no sole King, the embassy is received by no one.', 'info');
      else if (E.cannotRespond(s, k)) log(s, `The King cannot travel from ${E.locName(k)}.`, 'info');
      else {
        const from = { area: k.area, inside: k.inside, ship: null }; const pl = KM.P[ev.place];
        const escort = k.ctrl !== null ? E.noblesAt(s, from, k.ctrl) : [];
        for (const n of escort) { n.area = pl.area; n.inside = null; }
        for (const h of E.heirsAt(s, from)) if (h.ctrl === k.ctrl) { h.area = pl.area; h.inside = null; }
        fx.push({ t: 'embassy', heir: k.id, to: pl.area });
        log(s, `${KM.HEIR[k.id].name}${escort.length ? ' and escort' : ''} travel to ${pl.name} to receive the embassy.`, 'move');
      }
      refresh(s); s.eventDiscard.push(id);
    } else if (ev.type === 'writ' || ev.type === 'freeMove') {
      s.players[p].held.push(id); fx.push({ t: 'held' }); log(s, `${s.players[p].name} keeps the ${ev.title} card.`, 'info');
    } else if (ev.type === 'parl') {
      const ch = E.holder(s, 'o_chancellor');
      if (ch && ch.owner === p) { s.players[p].held.push(id); log(s, `${s.players[p].name} holds the Chancellor and keeps the card.`, 'info'); }
      else { s.eventDiscard.push(id); log(s, 'Only the Chancellor’s faction may keep it; it is discarded.', 'info'); }
    } else if (ev.type === 'storm') {
      let any = false;
      for (const sh of Object.values(s.ships)) if (E.shipAtSea(sh)) {
        any = true; const port = nearestPort(s, sh.loc); const aboard = Object.values(s.nobles).filter(n => n.ship === sh.key);
        sh.loc = port; if (aboard.length) landAt(s, aboard, port, sh.key);
        fx.push({ t: 'ship', ship: sh.key, to: KM.P[port].area }); log(s, `Storms drive the ${sh.name} into ${KM.P[port].name}.`, 'move');
      }
      if (!any) log(s, 'No ship is at sea.', 'info');
      refresh(s); s.eventDiscard.push(id);
    } else s.eventDiscard.push(id);
    refresh(s);
    return { ok: true, event: ev, fx };
  };

  // ---------- land movement ----------
  function checkGroup(s, p, ids) {
    if (!ids.length) return 'Choose at least one noble.';
    const ns = ids.map(id => s.nobles[id]);
    if (ns.some(n => !n || n.owner !== p)) return 'Those are not your nobles.';
    if (ns.some(n => !E.sameLoc(n, ns[0]))) return 'A force must start from the same place.';
    return null;
  }
  E.canMove = (s, n) => (!n.moved || n.free) && !n.ship;
  function roadStop(s, p, area) { return KM.A[area].places.some(pl => KM.ROADPLACE[pl] && E.fortified(pl) && E.placeOwner(s, pl) !== p); }
  E.moveOptions = function (s, p, ids) {
    const res = { land: {}, road: {}, sea: [], enter: [], leave: false, error: null };
    const err = checkGroup(s, p, ids); if (err) { res.error = err; return res; }
    const ns = ids.map(id => s.nobles[id]); const start = ns[0].area;
    if (s.turn.phase !== 'move' || s.turn.player !== p) { res.error = 'Forces march in the movement phase.'; return res; }
    if (ns[0].ship) { res.error = 'At sea: move the ship instead.'; return res; }
    const str = E.stackStrength(s, ns);
    res.enter = KM.A[start].places.filter(pl => E.isFriendly(s, pl, p) && ns[0].inside !== pl && E.roomFor(s, pl, str, ids));
    res.leave = !!ns[0].inside && !E.underSiege(s, ns[0]);
    if (ns.some(n => !E.canMove(s, n))) { res.error = 'Already moved this turn.'; return res; }
    if (E.underSiege(s, ns[0])) { res.error = 'Besieged: these nobles cannot leave until the siege is lifted.'; return res; }
    // on foot: five squares; entering a forest ends the move
    const seen = { [start]: { steps: 0, prev: null } }; let frontier = [start];
    for (let step = 1; step <= MOVE && frontier.length; step++) {
      const next = [];
      for (const u of frontier) for (const v of KM.A[u].adj) {
        if (seen[v]) continue; seen[v] = { steps: step, prev: u };
        if (KM.A[v].terrain !== 'forest') next.push(v);
      }
      frontier = next;
    }
    delete seen[start]; res.land = seen;
    // by road: unlimited, but a town or castle on the road not held by you ends the ride
    if (KM.A[start].road.length) {
      const sr = { [start]: { steps: 0, prev: null } }; const q = [start];
      while (q.length) { const u = q.shift(); for (const v of KM.A[u].road) { if (sr[v]) continue; sr[v] = { steps: sr[u].steps + 1, prev: u }; if (!roadStop(s, p, v)) q.push(v); } }
      delete sr[start]; res.road = sr;
    }
    // by ship from this square's ports, straight to another port in one voyage
    // ships lying in the same port may sail together as a fleet, splitting the troops between them
    const fleets = {};
    for (const sh of E.playerShips(s, p)) if (!sh.used && !E.shipAtSea(sh) && KM.P[sh.loc].area === start && !E.shipCargo(s, sh.key).length) (fleets[sh.loc] = fleets[sh.loc] || []).push(sh);
    for (const [loc, fl] of Object.entries(fleets)) {
      if (E.fortified(loc) && !E.isFriendly(s, loc, p)) continue;
      fl.sort((a, b) => b.cap - a.cap); const cap = fl.reduce((t, x) => t + x.cap, 0);
      const keys = []; let acc = 0; for (const x of fl) { if (acc >= str && keys.length) break; keys.push(x.key); acc += x.cap; }
      const reach = E.shipReach(s, fl[0].key);
      for (const [k, steps] of Object.entries(reach)) if (KM.P[k] && k !== loc) {
        const q = KM.P[k]; const friendly = !E.fortified(k) || E.isFriendly(s, k, p);
        const need = friendly ? 0 : q.garrison + E.troopsInside(s, k);
        res.sea.push({ ship: fl[0].key, fleet: keys, cap, port: k, area: q.area, steps, fits: str <= cap, friendly, canLand: friendly || str >= need });
      }
    }
    return res;
  };
  function pathTo(map, dest) { const out = [dest]; let cur = map[dest]; while (cur && cur.prev) { out.unshift(cur.prev); cur = map[cur.prev]; } return out; }
  function moveHeirsWith(s, p, from, ids, dest, heirIds) {
    const staying = E.noblesAt(s, from, p).filter(n => !ids.includes(n.id));
    const heirs = E.heirsAt(s, from).filter(h => h.ctrl === p && (!staying.length || !heirIds || heirIds.includes(h.id)));
    for (const h of heirs) Object.assign(h, dest); return heirs;
  }
  // dest: {area, via:'land'|'road'|'sea', ship, port, enter}
  E.move = function (s, p, ids, dest, heirIds) {
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    const opt = E.moveOptions(s, p, ids); if (opt.error) return fail(opt.error);
    const ns = ids.map(id => s.nobles[id]); const from = { area: ns[0].area, inside: ns[0].inside, ship: null };
    if (dest.via === 'sea') {
      const o = opt.sea.find(x => x.ship === dest.ship && x.port === dest.port); if (!o) return fail('That ship cannot reach that port this turn.');
      if (!o.fits) return fail(`The ships in port carry only ${o.cap} men together.`);
      if (!o.canLand) return fail(`To land at hostile ${KM.P[dest.port].name} the force must be strong enough to besiege it.`);
      return E.sail(s, p, dest.ship, { to: dest.port, embark: ids, heirs: heirIds, enter: dest.enter, fleet: o.fleet });
    }
    const map = dest.via === 'road' ? opt.road : opt.land; if (!map[dest.area]) return fail('Too far to march this turn.');
    const path = pathTo(map, dest.area);
    let inside = null; const str = E.stackStrength(s, ns);
    if (dest.enter) {
      if (KM.P[dest.enter].area !== dest.area || !E.isFriendly(s, dest.enter, p)) return fail('You may only enter a friendly town, city or castle.');
      if (!E.roomFor(s, dest.enter, str, ids)) return fail(`${KM.P[dest.enter].name} cannot hold so many men.`);
      inside = dest.enter;
    }
    for (const n of ns) { n.area = dest.area; n.inside = inside; n.moved = true; n.free = false; }
    const heirs = moveHeirsWith(s, p, from, ids, { area: dest.area, inside, ship: null }, heirIds);
    const names = ns.map(n => KM.CARD[n.id].name).join(', ');
    log(s, `${names} ${dest.via === 'road' ? 'ride' + (ns.length === 1 ? 's' : '') + ' the road to' : 'march' + (ns.length === 1 ? 'es' : '') + ' to'} ${E.locName({ area: dest.area, inside })}${heirs.length ? ' with ' + heirs.map(h => KM.HEIR[h.id].name).join(' and ') : ''}.`, 'move', { area: dest.area, path, from: from.area });
    refresh(s, p);
    return { ok: true, path };
  };
  E.shelter = function (s, p, ids, placeId) {
    const err = checkGroup(s, p, ids); if (err) return fail(err); if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (s.turn.player !== p || !['move', 'combat', 'court', 'muster'].includes(s.turn.phase)) return fail('Not now.');
    const ns = ids.map(id => s.nobles[id]); const from = { area: ns[0].area, inside: ns[0].inside, ship: null };
    if (ns[0].ship) return fail('At sea.');
    if (!placeId && E.underSiege(s, ns[0])) return fail('Besieged: they cannot come out.');
    if (placeId) {
      if (KM.P[placeId].area !== from.area || !E.isFriendly(s, placeId, p)) return fail('You may only enter a friendly town, city or castle in the same square.');
      if (!E.roomFor(s, placeId, E.stackStrength(s, ns), ids)) return fail(`${KM.P[placeId].name} cannot hold so many men (room for ${E.capacity(placeId)}).`);
    }
    const staying = E.noblesAt(s, from, p).filter(n => !ids.includes(n.id));
    const heirs = staying.length ? [] : E.heirsAt(s, from).filter(h => h.ctrl === p);
    for (const n of ns) n.inside = placeId || null; for (const h of heirs) h.inside = placeId || null;
    refresh(s, p); return { ok: true };
  };
  E.useFreeMove = function (s, p, ids) {
    const pl = s.players[p]; const i = pl.held.findIndex(id => KM.EVENT[id].type === 'freeMove'); if (i < 0) return fail('You hold no Free Move card.');
    if (s.turn.player !== p || s.turn.phase !== 'move') return fail('Play a Free Move during your movement phase.');
    const err = checkGroup(s, p, ids); if (err) return fail(err);
    if (ids.length !== 1) return fail('A Free Move moves a single noble.');
    const n = s.nobles[ids[0]]; if (n.free || n.usedFree) return fail('A counter may use only one Free Move per turn.');
    s.eventDiscard.push(pl.held.splice(i, 1)[0]); n.free = true; n.usedFree = s.turn.n;
    log(s, `${pl.name} plays a Free Move: ${KM.CARD[n.id].name} may move again.`, 'card'); return { ok: true };
  };
  E.endMovement = function (s) { if (s.turn.phase !== 'move') return fail('Not the movement phase.'); s.turn.phase = 'combat'; return { ok: true }; };

  // ---------- ships ----------
  // distances in sea squares; a port counts as a square of its own
  function seaDistances(fromLoc, max) {
    const portsOf = {}; for (const p of KM.MAP.places) if (p.port) (portsOf[p.port] = portsOf[p.port] || []).push(p.id);
    const d = { [fromLoc]: 0 }; const q = [fromLoc];
    while (q.length) {
      const u = q.shift(); if (d[u] >= max) continue;
      const nb = KM.P[u] ? (KM.P[u].port ? [KM.P[u].port] : []) : KM.SEA[u].adj.concat(portsOf[u] || []);
      for (const v of nb) if (d[v] === undefined) { d[v] = d[u] + 1; if (!KM.P[v] || v === fromLoc) q.push(v); }
    }
    return d;
  }
  E.seaDistances = seaDistances;
  E.shipReach = function (s, key) {
    const sh = s.ships[key]; const d = seaDistances(sh.loc, SHIP_MOVE); delete d[sh.loc]; return d;
  };
  E.shipCargo = (s, key) => Object.values(s.nobles).filter(n => n.ship === key);
  function landAt(s, nobles, port, key) {
    const pl = KM.P[port]; const p = nobles[0].owner; const friendly = E.isFriendly(s, port, p);
    const room = friendly && E.roomFor(s, port, E.stackStrength(s, nobles), nobles.map(n => n.id));
    for (const n of nobles) { n.ship = null; n.area = pl.area; n.inside = room ? port : null; }
    for (const h of E.aliveHeirs(s)) if (h.ship === key) { h.ship = null; h.area = pl.area; h.inside = room ? port : null; }
  }
  // opts: {to: seaId|portId, embark: [nobleIds] (only from the ship's port at the start of its move), heirs, enter}
  E.sail = function (s, p, key, opts) {
    const sh = s.ships[key]; if (!sh || E.shipOwner(s, sh) !== p) return fail('Not your ship.');
    if (s.turn.phase !== 'move' || s.turn.player !== p) return fail('Ships sail in the movement phase.');
    if (sh.used && !sh.free) return fail(`The ${sh.name} has already sailed this turn.`);
    const reach = E.shipReach(s, key); if (reach[opts.to] === undefined) return fail('Too far for one voyage (five squares; a port counts as one).');
    let cargo = E.shipCargo(s, key); const embark = (opts.embark || []).map(id => s.nobles[id]);
    if (embark.length) {
      if (E.shipAtSea(sh)) return fail('Nobles embark only while the ship lies in port.');
      const port = sh.loc; if (!E.isFriendly(s, port, p) && E.fortified(port)) return fail('Ships embark only at friendly or unfortified ports.');
      if (embark.some(n => n.owner !== p || n.area !== KM.P[port].area || n.ship || (n.moved && !n.free) || E.underSiege(s, n))) return fail('Only nobles in the port’s square who have not moved may embark.');
      cargo = cargo.concat(embark);
    }
    const fleet = (opts.fleet || [key]).map(k => s.ships[k]).filter(x => x && x.loc === sh.loc && E.shipOwner(s, x) === p && (!x.used || x.free));
    if (!fleet.includes(sh)) fleet.unshift(sh);
    const capTot = fleet.reduce((t, x) => t + x.cap, 0);
    const load = E.stackStrength(s, cargo); if (load > capTot) return fail(`${fleet.length > 1 ? 'These ships carry' : 'The ' + sh.name + ' carries'} only ${capTot} men; this force has ${load}.`);
    const toPort = KM.P[opts.to];
    if (toPort && cargo.length && E.fortified(opts.to) && !E.isFriendly(s, opts.to, p)) {
      const need = toPort.garrison + E.troopsInside(s, opts.to); if (load < need) return fail(`To land at ${toPort.name} the passengers must besiege it: ${need} men needed.`);
    } else if (toPort && !cargo.length && E.fortified(opts.to) && !E.isFriendly(s, opts.to, p)) return fail('An empty ship may only enter a friendly or unfortified port.');
    const from = { area: E.shipArea(sh) };
    if (embark.length) {
      const src = { area: embark[0].area, inside: embark[0].inside, ship: null };
      moveHeirsWith(s, p, src, embark.map(n => n.id), { area: opts.to, inside: null, ship: key }, opts.heirs);
      for (const n of embark) { n.ship = key; n.inside = null; }
    }
    for (const x of fleet) { x.loc = opts.to; x.used = true; x.free = false; }
    for (const n of cargo) { n.moved = true; n.free = false; n.area = toPort ? toPort.area : opts.to; }
    for (const h of E.aliveHeirs(s)) if (h.ship === key) h.area = toPort ? toPort.area : opts.to;
    if (toPort && cargo.length) {
      landAt(s, cargo, opts.to, key);
      if (opts.enter && E.isFriendly(s, opts.enter, p) && E.roomFor(s, opts.enter, load, cargo.map(n => n.id))) { for (const n of cargo) n.inside = opts.enter; for (const h of E.aliveHeirs(s)) if (h.ctrl === p && h.area === toPort.area && !h.inside && E.noblesAt(s, { area: h.area, inside: opts.enter, ship: null }, p).length) h.inside = opts.enter; }
    }
    const who = cargo.length ? cargo.map(n => KM.CARD[n.id].name).join(', ') + ' aboard the ' + sh.name : 'The ' + sh.name;
    log(s, `${who} ${toPort ? 'puts in at ' + toPort.name : 'stands out to sea'}.`, 'move', { area: toPort ? toPort.area : opts.to, from: from.area });
    refresh(s, p);
    return { ok: true, path: [from.area, toPort ? toPort.area : opts.to] };
  };
  E.sailEmpty = (s, p, key, portId) => E.sail(s, p, key, { to: portId });
  E.shipPorts = (s, key) => Object.keys(E.shipReach(s, key)).filter(k => KM.P[k]);
  E.useFreeMoveShip = function (s, p, key) {
    const pl = s.players[p]; const i = pl.held.findIndex(id => KM.EVENT[id].type === 'freeMove'); if (i < 0) return fail('You hold no Free Move card.');
    const sh = s.ships[key]; if (!sh || E.shipOwner(s, sh) !== p || !sh.used || sh.freeUsed === s.turn.n) return fail('Not now.');
    s.eventDiscard.push(pl.held.splice(i, 1)[0]); sh.free = true; sh.freeUsed = s.turn.n; log(s, `${pl.name} plays a Free Move for the ${sh.name}.`, 'card'); return { ok: true };
  };

  // ---------- combat ----------
  E.combatOptions = function (s, p) {
    const out = []; if (s.turn.player !== p || s.turn.phase !== 'combat' || s.pending) return out;
    const areas = [...new Set(E.playerNobles(s, p).filter(n => !n.fought && !n.ship).map(n => n.area))];
    for (const area of areas) {
      const mine = E.noblesInArea(s, area, p).filter(n => !n.fought && !n.inside); const sally = E.noblesInArea(s, area, p).filter(n => !n.fought && n.inside && s.sieges[n.inside]);
      const att = E.stackStrength(s, mine.concat(sally)); const peace = s.peace && s.peace.area === area;
      const foes = {}; for (const n of E.noblesInArea(s, area)) if (n.owner !== p && !n.inside) (foes[n.owner] = foes[n.owner] || []).push(n);
      for (const [fp, ns] of Object.entries(foes)) {
        const def = E.stackStrength(s, ns); const all = mine.concat(sally);
        out.push({ type: 'battle', area, foe: +fp, attackers: all.map(n => n.id), defenders: ns.map(n => n.id), att, def, ok: all.length > 0 && !peace && !ns.some(n => n.attackedOn === s.turn.n), why: peace ? 'The King’s Peace forbids fighting here.' : null, heirs: E.heirsAt(s, { area, inside: null, ship: null }).filter(h => h.ctrl === +fp).map(h => h.id) });
      }
      for (const pid of KM.A[area].places) {
        if (!E.fortified(pid) || E.isFriendly(s, pid, p) || !mine.length) continue;
        const inside = Object.values(s.nobles).filter(n => n.inside === pid); const def = KM.P[pid].garrison + E.stackStrength(s, inside);
        const att2 = E.stackStrength(s, mine);
        out.push({ type: 'siege', area, place: pid, foe: E.placeOwner(s, pid), attackers: mine.map(n => n.id), defenders: inside.map(n => n.id), att: att2, def, ok: att2 >= def && !peace, why: peace ? 'The King’s Peace forbids fighting here.' : att2 < def ? `At least ${def} men are needed to lay siege.` : null, under: !!s.sieges[pid], heirs: E.aliveHeirs(s).filter(h => h.inside === pid).map(h => h.id) });
      }
    }
    return out;
  };
  // ratio test: the larger side wins if larger/smaller >= the card's odds
  const beats = (big, small, odds) => small === 0 ? big > 0 : big * odds[1] >= small * odds[0] && big > small;
  function capture(s, victor, losers, area) {
    const lead = E.noblesInArea(s, area, victor).sort((a, b) => E.strength(s, b) - E.strength(s, a))[0];
    const prisoners = [];
    for (const n of losers) { if (!s.nobles[n.id]) continue;
      for (const cid of n.mercs.concat(n.towns, n.ships, n.bishops)) { detach(s, n, cid); if (lead) attach(s, lead, cid); else returnToDeck(s, cid); }
      prisoners.push(n.id); n.captive = victor; }
    return prisoners;
  }
  E.attack = function (s, p, o) {
    if (s.turn.player !== p || s.turn.phase !== 'combat') return fail('Battles are fought in the combat phase.');
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (s.peace && s.peace.area === o.area) return fail('The King’s Peace forbids fighting here.');
    const att = o.attackers.map(id => s.nobles[id]);
    if (!att.length || att.some(n => !n || n.owner !== p || n.area !== o.area || n.fought || n.ship)) return fail('Those nobles cannot attack.');
    let def, garrison = 0, place = null;
    if (o.type === 'battle') { def = E.noblesInArea(s, o.area, o.foe).filter(n => !n.inside); if (!def.length) return fail('No enemy stands in the open there.'); if (def.some(n => n.attackedOn === s.turn.n)) return fail('That force has already been attacked this turn.'); }
    else { place = KM.P[o.place]; if (!place || place.area !== o.area || !E.fortified(place.id) || E.isFriendly(s, place.id, p)) return fail('Not a place you can besiege.'); def = Object.values(s.nobles).filter(n => n.inside === place.id); garrison = place.garrison; }
    const A = E.stackStrength(s, att), D = garrison + E.stackStrength(s, def);
    if (place && A < D) return fail(`You need at least ${D} men to besiege ${place.name}; you have ${A}.`);
    for (const n of att) { n.fought = true; if (!(n.inside && s.sieges[n.inside])) n.inside = null; }
    for (const n of def) n.attackedOn = s.turn.n;
    // draw: Free Move and Writ cards are kept and another drawn
    let cid = drawEventCard(s), guard = 0;
    while (!KM.EVENT[cid].battle && guard++ < 40) { s.players[p].held.push(cid); log(s, `${s.players[p].name} turns up a ${KM.EVENT[cid].title} card, keeps it, and draws again.`, 'card'); cid = drawEventCard(s); }
    s.eventDiscard.push(cid); const b = KM.EVENT[cid].battle;
    const res = { ok: true, type: o.type, area: o.area, place: place ? place.id : null, foe: o.type === 'battle' ? o.foe : E.placeOwner(s, o.place), card: cid, att: A, def: D, attackers: att.map(n => n.id), defenders: def.map(n => n.id), killed: [], prisoners: [], heirs: [], outcome: null, victor: null };
    if (b.weather) {
      res.outcome = 'weather';
      if (place) { s.sieges[place.id] = { by: p }; log(s, `Bad weather delays the assault: ${place.name} is now under siege.`, 'battle', { area: o.area }); }
      else log(s, `Bad weather delays the attack near ${E.areaName(o.area)} (${A} against ${D}).`, 'battle', { area: o.area });
      return res;
    }
    for (const n of att.concat(def)) if (b.killed.includes(n.id)) res.killed.push(n.id);
    if (place) {
      res.outcome = 'win'; res.victor = p;
      log(s, `${s.players[p].name} storms ${place.name} with ${A} men against ${D}.`, 'battle', { area: o.area });
      for (const id of res.killed) E.killNoble(s, id, 'is slain in the assault', null);
      delete s.sieges[place.id];
      const victors = att.filter(n => s.nobles[n.id]);
      if (victors.length) {
        s.captured[place.id] = p;
        const tc = KM.CARDS.towns.find(c => c.place === place.id); if (tc) { const h = E.holder(s, tc.id); if (h && h.owner !== p) { detach(s, h, tc.id); returnToDeck(s, tc.id); } }
        const survivors = def.filter(n => s.nobles[n.id]); for (const n of survivors) n.inside = null;
        res.prisoners = capture(s, p, survivors, o.area);
        for (const h of E.aliveHeirs(s)) if (h.inside === place.id && h.ctrl !== p) { h.ctrl = p; res.heirs.push(h.id); log(s, `${KM.HEIR[h.id].name} falls into the hands of ${s.players[p].name}.`, 'heir'); }
        const str = E.stackStrength(s, victors);
        if (E.roomFor(s, place.id, str)) { for (const n of victors) n.inside = place.id; for (const h of E.aliveHeirs(s)) if (h.ctrl === p && h.area === o.area && !h.inside && !h.ship) h.inside = place.id; }
        for (const h of res.heirs) { s.heirs[h].inside = victors[0].inside; }
      }
    } else {
      const big = Math.max(A, D), small = Math.min(A, D); const decisive = A !== D && beats(big, small, b.odds);
      res.need = b.odds; res.label = b.label;
      log(s, `${s.players[p].name} gives battle near ${E.areaName(o.area)}: ${A} against ${D}. The card demands ${b.label}: ${decisive ? (A > D ? 'the attackers carry the day!' : 'the defenders win the day!') : 'the day is indecisive.'}`, 'battle', { area: o.area });
      for (const id of res.killed) E.killNoble(s, id, 'is slain in the fighting', null);
      if (decisive) {
        const victor = A > D ? p : o.foe; const loseSide = A > D ? def : att; res.victor = victor; res.outcome = victor === p ? 'win' : 'loss';
        const losers = loseSide.filter(n => s.nobles[n.id]);
        const lossLoc = losers[0] ? { area: o.area, inside: null, ship: null } : null;
        for (const n of losers) n.inside = null;
        res.prisoners = capture(s, victor, losers, o.area);
        if (lossLoc) for (const h of E.aliveHeirs(s)) if (h.area === o.area && !h.inside && !h.ship && h.ctrl !== victor && h.ctrl !== null) { h.ctrl = victor; res.heirs.push(h.id); log(s, `${KM.HEIR[h.id].name} is captured by ${s.players[victor].name}.`, 'heir'); }
      } else res.outcome = 'indecisive';
    }
    if (res.prisoners.length) { s.pending = { type: 'prisoners', victor: res.victor, list: res.prisoners.slice(), area: o.area }; for (const id of res.prisoners) log(s, `${KM.CARD[id].name} is taken prisoner by ${s.players[res.victor].name}.`, 'info'); }
    refresh(s, res.victor === null ? p : res.victor); E.checkVictory(s);
    return res;
  };
  // a captured noble is ransomed (returned with his title and office) or executed in the turn of capture
  E.resolvePrisoner = function (s, id, fate) {
    if (!s.pending || s.pending.type !== 'prisoners' || !s.pending.list.includes(id)) return fail('No such prisoner.');
    const victor = s.pending.victor; const n = s.nobles[id];
    if (fate === 'execute') E.killNoble(s, id, `is executed by order of ${s.players[victor].name}`, victor);
    else { delete n.captive; log(s, `${KM.CARD[id].name} is ransomed and returns to ${s.players[n.owner].name} with his title and office.`, 'info'); s.pending.list = s.pending.list.filter(x => x !== id); if (!s.pending.list.length) s.pending = null; }
    refresh(s, victor);
    return { ok: true };
  };
  E.executeHeir = function (s, p, id) {
    const h = s.heirs[id]; if (!h || !h.alive || h.ctrl !== p) return fail('That heir is not in your keeping.');
    if (s.turn.player !== p) return fail('Only in your own turn.');
    E.killHeir(s, id, `is put to death by ${s.players[p].name}`); return { ok: true };
  };
  E.chances = function (att, def, siege) {
    let win = 0, bad = 0, lose = 0, n = 0;
    for (const e of KM.CARDS.events) { if (!e.battle) continue; n++;
      if (e.battle.weather) bad++;
      else if (siege) win++;
      else { const big = Math.max(att, def), small = Math.min(att, def); if (att !== def && beats(big, small, e.battle.odds)) { if (att > def) win++; else lose++; } } }
    return { win: win / n, lose: lose / n, weather: bad / n, stall: (n - win - bad - lose) / n };
  };
  E.endCombat = function (s) { if (s.turn.phase !== 'combat') return fail('Not the combat phase.'); if (s.pending) return fail('Decide the fate of your prisoners first.'); s.turn.phase = 'court'; return { ok: true }; };

  // ---------- coronation ----------
  function crownHelpers(s, p, loc) { const here = E.noblesAt(s, loc, p); const bs = here.reduce((t, n) => t.concat(n.bishops), []); return bs.some(b => KM.CARD[b].arch) || bs.length >= 2; }
  function cathedralAt(loc) { return KM.A[loc.area].places.find(pl => KM.P[pl].cathedral && (!E.fortified(pl) || loc.inside === pl)) || null; }
  E.coronationOptions = function (s, p) {
    const out = [];
    const nk = E.kings(s).length + (s.beaufortKing ? 1 : 0);
    for (const house of ['lancaster', 'york']) {
      const h = E.seniorHeir(s, house); if (!h || h.crowned || h.ctrl !== p) continue;
      if (E.kings(s).some(k => KM.HEIR[k.id].house === house)) continue;
      const cath = KM.A[h.area].places.filter(pl => KM.P[pl].cathedral); const place = cathedralAt(h);
      const ok = !!place && crownHelpers(s, p, h) && nk < 2 && !h.ship;
      out.push({ heir: h.id, ok, place: place || cath[0] || null, why: !cath.length ? 'Must be in a cathedral city or town.' : !place ? `Must be inside ${KM.P[cath[0]].name}.` : !crownHelpers(s, p, h) ? 'Needs nobles here holding an Archbishop or two Bishops.' : nk >= 2 ? 'There are already two Kings.' : null });
    }
    const b = s.nobles.beaufort;
    if (b && b.owner === p && E.lancasterExtinct(s) && !s.beaufortKing) {
      const place = cathedralAt(b); const ok = !!place && crownHelpers(s, p, b) && nk < 2 && !E.aliveHeirs(s).some(h => h.ctrl === p && KM.HEIR[h.id].house === 'york');
      out.push({ heir: 'beaufort', ok, place, why: ok ? null : !place ? 'Beaufort must stand in a cathedral.' : 'Needs an Archbishop or two Bishops, and no Yorkist in your keeping.' });
    }
    return out;
  };
  E.crown = function (s, p, heirId) {
    if (s.turn.player !== p || s.turn.phase !== 'court') return fail('Coronations take place after combat and Parliament.');
    const o = E.coronationOptions(s, p).find(x => x.heir === heirId); if (!o) return fail('Only the senior surviving heir of a house in your keeping may be crowned.');
    if (!o.ok) return fail(o.why);
    if (heirId === 'beaufort') { s.beaufortKing = true; log(s, `Beaufort, last of the blood of Lancaster, is crowned at ${KM.P[o.place].name}.`, 'crown'); }
    else { s.heirs[heirId].crowned = true; log(s, `${KM.HEIR[heirId].name} is crowned at ${KM.P[o.place].name}. Long live the ${KM.HEIR[heirId].queen ? 'Queen' : 'King'}!`, 'crown', { heir: heirId }); }
    E.checkVictory(s); return { ok: true };
  };

  // ---------- parliament ----------
  const PARL_TYPES = ['city', 'town', 'open'];
  function venueFor(s, x) {
    if (x.ship || E.onIsland(x) || x.area === KM.P.calais.area || (x.inside && s.sieges[x.inside])) return null;
    if (x.inside) return KM.P[x.inside].type === 'city' || KM.P[x.inside].type === 'town' ? x.inside : null;
    return KM.A[x.area].places.find(pl => PARL_TYPES.includes(KM.P[pl].type)) || null;
  }
  E.canSummon = function (s, p) {
    if (s.turn.player !== p || s.turn.phase !== 'court') return { ok: false, why: 'Parliament is summoned after combat.' };
    if (s.turn.parliament) return { ok: false, why: 'Parliament has already sat this turn.' };
    if (!s.chancery.length) return { ok: false, why: 'Chancery holds nothing to bestow.' };
    const held = s.players[p].held; const writs = held.filter(id => KM.EVENT[id].type === 'writ');
    const sk = E.soleKing(s); let who = null, via = null;
    if (sk) { if (sk.ctrl !== p) return { ok: false, why: 'Only the faction holding the sole King may summon Parliament.' }; who = sk; via = 'king'; }
    else {
      const ch = E.holder(s, 'o_chancellor'); if (!ch || ch.owner !== p) return { ok: false, why: 'With two Kings or none, only the Chancellor of England may summon Parliament.' };
      if (!held.some(id => KM.EVENT[id].type === 'parl')) return { ok: false, why: 'The Chancellor must also play a Parliament card.' };
      who = ch; via = 'chancellor';
    }
    if (!writs.length) return { ok: false, why: 'A Writ of Summons is needed to call another faction’s noble.' };
    const venue = venueFor(s, who); if (!venue) return { ok: false, why: `${via === 'king' ? 'The King' : 'The Chancellor'} must be at a town, city or open town (not a castle, not Calais, not under siege).` };
    return { ok: true, via, venue, writs: writs.length };
  };
  E.summonable = (s, p) => Object.values(s.nobles).filter(n => n.owner !== p && !n.ship && !E.onIsland(n) && n.area !== KM.P.calais.area && !E.underSiege(s, n)).map(n => n.id);
  // opts: {writs: [nobleIds of other factions], attend: [own nobleIds who come voluntarily]}
  E.openParliament = function (s, p, opts) {
    const c = E.canSummon(s, p); if (!c.ok) return fail(c.why); opts = opts || {};
    const summ = (opts.writs || []).filter(id => E.summonable(s, p).includes(id)).slice(0, c.writs);
    if (!summ.length) return fail('Name at least one noble of another faction to summon with a Writ.');
    const venue = KM.P[c.venue]; const pl = s.players[p];
    for (let k = 0; k < summ.length; k++) { const i = pl.held.findIndex(id => KM.EVENT[id].type === 'writ'); s.eventDiscard.push(pl.held.splice(i, 1)[0]); }
    if (c.via === 'chancellor') { const i = pl.held.findIndex(id => KM.EVENT[id].type === 'parl'); s.eventDiscard.push(pl.held.splice(i, 1)[0]); }
    const goers = summ.concat((opts.attend || []).filter(id => s.nobles[id] && s.nobles[id].owner === p && !s.nobles[id].ship && !E.onIsland(s.nobles[id])));
    for (const id of goers) { const n = s.nobles[id]; if (n.area !== venue.area) relocate(s, n, null, venue.area); }
    const attending = E.noblesInArea(s, venue.area);
    s.turn.parliament = true; s.turn.attended = attending.map(n => n.id);
    shuffle(s, s.chancery); const cards = s.chancery.splice(0, attending.length);
    s.parl = { summoner: p, venue: c.venue, cards, votes: s.players.map(q => { const v = E.votes(s, q.id); return { commons: v.commons, lords: v.lords }; }), favoured: {}, results: [], attending: attending.map(n => n.id) };
    s.peace = { area: venue.area, until: s.turn.n + s.players.length };
    log(s, `${pl.name} summons Parliament to ${venue.name}; ${attending.length} lords attend and ${cards.length} grants come out of Chancery. The King’s Peace holds there until ${pl.name}’s next turn.`, 'parliament');
    refresh(s);
    if (s.options.parliamentVictory && c.via === 'king') {
      const votes = s.players.map(q => E.votes(s, q.id)); const tot = votes.reduce((t, v) => t + v.commons, 0); const mine = votes[p];
      if (mine.commons * 2 > tot && votes.every((v, i) => i === p || v.lords < mine.lords)) { s.parl = null; return win(s, p, `${pl.name} commands both Houses of Parliament in the name of ${KM.HEIR[E.soleKing(s).id].name}.`); }
    }
    return { ok: true, parl: s.parl };
  };
  E.parlTargets = function (s, cardId) {
    const k = KM.CARD[cardId].kind; const all = Object.values(s.nobles);
    if (k === 'title') return all.filter(n => !E.isTitled(s, n)).map(n => n.id);
    if (k === 'office') return all.filter(n => E.isTitled(s, n) && !n.office).map(n => n.id);
    return all.map(n => n.id);
  };
  // ballots: {playerId: true|false}; ignored unless the votes option is on
  E.propose = function (s, cardId, nobleId, ballots) {
    const P = s.parl; if (!P || !P.cards.includes(cardId)) return fail('Not before Parliament.');
    if (!E.parlTargets(s, cardId).includes(nobleId)) return fail('That noble is not eligible.');
    const n = s.nobles[nobleId]; const lordsOnly = KM.CARD[cardId].kind === 'bishop';
    let ayeC = 0, noC = 0, ayeL = 0, noL = 0, pass = true;
    if (s.options.votes) {
      s.players.forEach((pl, i) => { const v = i === P.summoner ? true : (ballots || {})[i]; if (v === undefined) return; if (v) { ayeC += P.votes[i].commons; ayeL += P.votes[i].lords; } else { noC += P.votes[i].commons; noL += P.votes[i].lords; } });
      pass = ayeL > noL && (lordsOnly || ayeC > noC);
    }
    P.cards.splice(P.cards.indexOf(cardId), 1);
    const r = { card: cardId, noble: nobleId, pass, ayeC, noC, ayeL, noL, lordsOnly, voted: s.options.votes }; P.results.push(r);
    if (n.owner !== P.summoner) P.favoured[n.owner] = true;
    if (pass) { attach(s, n, cardId); log(s, `Parliament grants ${KM.CARD[cardId].name} to ${KM.CARD[nobleId].name} (${s.players[n.owner].name}).`, 'parliament'); refresh(s); }
    else { unplaced(s, cardId); log(s, `Parliament refuses ${KM.CARD[cardId].name} to ${KM.CARD[nobleId].name}.`, 'parliament'); }
    return Object.assign({ ok: true }, r);
  };
  function unplaced(s, cid) { if (KM.CARD[cid].kind === 'bishop') s.chancery.push(cid); else returnToDeck(s, cid); }
  E.closeParliament = function (s) {
    if (!s.parl) return fail('Parliament is not sitting.');
    for (const cid of s.parl.cards) unplaced(s, cid);
    s.parl = null; log(s, 'Parliament is dissolved.', 'parliament'); return { ok: true };
  };
  // Return from Parliament: any noble who attended may go home to one of his castles
  E.returnHome = function (s, p, id) {
    const n = s.nobles[id]; if (!n || n.owner !== p || !s.turn.attended || !s.turn.attended.includes(id) || s.parl) return fail('Only nobles leaving Parliament may return home.');
    const home = KM.CARD[id].castles.find(pl => E.isFriendly(s, pl, p) && !E.onIsland({ area: KM.P[pl].area })); if (!home) return fail('None of his castles is in friendly hands on the mainland.');
    const from = { area: n.area, inside: n.inside, ship: null }; const alone = !E.noblesAt(s, from, p).some(x => x.id !== id);
    n.area = KM.P[home].area; n.inside = home; if (alone) for (const h of E.heirsAt(s, from)) if (h.ctrl === p) { h.area = n.area; h.inside = home; }
    s.turn.attended = s.turn.attended.filter(x => x !== id);
    log(s, `${KM.CARD[id].name} rides home to ${KM.P[home].name}.`, 'move'); refresh(s, p); return { ok: true };
  };

  // ---------- victory / end of turn ----------
  function win(s, p, text) { if (s.winner === null) { s.winner = p; s.winText = text; log(s, text, 'victory'); } return { ok: true, winner: p }; }
  E.checkVictory = function (s) {
    if (s.winner !== null) return true;
    const alive = E.aliveHeirs(s); const beau = s.nobles.beaufort;
    if (alive.length === 1) {
      const h = alive[0]; const lanc = KM.HEIR[h.id].house === 'lancaster';
      if ((h.crowned || !s.options.crownToWin) && h.ctrl !== null && (lanc || !beau)) { win(s, h.ctrl, `${KM.HEIR[h.id].name} reigns unchallenged. ${s.players[h.ctrl].name} is the Kingmaker.`); return true; }
    } else if (alive.length === 0) {
      if (beau && (s.beaufortKing || !s.options.crownToWin)) { win(s, beau.owner, `Both royal houses are extinct, and Beaufort is crowned. ${s.players[beau.owner].name} is the Kingmaker.`); return true; }
      if (!beau) { const best = s.players.slice().sort((a, b) => E.factionStrength(s, b.id) - E.factionStrength(s, a.id))[0]; win(s, best.id, `The royal blood is spent. ${best.name}, strongest in the field, seizes the realm.`); return true; }
    }
    return false;
  };
  E.bothHousesWarning = function (s, p) {
    const hs = E.aliveHeirs(s).filter(h => h.ctrl === p); const both = hs.some(h => KM.HEIR[h.id].house === 'york') && hs.some(h => KM.HEIR[h.id].house === 'lancaster');
    if (!both) { delete s.bothSince[p]; return null; }
    if (s.bothSince[p] === undefined) s.bothSince[p] = s.turn.round;
    return { since: s.bothSince[p], left: s.bothSince[p] + 2 - s.turn.round };
  };
  E.endTurn = function (s) {
    if (s.winner !== null) return { ok: true };
    if (s.pending) return fail('Decide the fate of your prisoners first.');
    if (s.parl) E.closeParliament(s);
    if (s.turn.phase === 'event') return fail('Draw your Event card first.');
    const p = s.turn.player; const pl = s.players[p];
    const w = E.bothHousesWarning(s, p);
    if (w && w.left < 0) return fail('You have held heirs of both houses for two rounds: execute those of one house before ending your turn.');
    const drawn = drawCrownCard(s); if (drawn) { pl.hand.push(drawn); log(s, `${pl.name} draws a Crown card.`, 'draw', { priv: p, card: drawn }); }
    refresh(s); if (E.checkVictory(s)) return { ok: true, drawn };
    const n = s.players.length; s.turn.player = (p + 1) % n; s.turn.n++; if (s.turn.player === s.firstPlayer) s.turn.round++;
    startTurn(s);
    return { ok: true, drawn };
  };
  E.serialize = (s) => JSON.stringify(s);
  E.deserialize = (txt) => { E.init(); return JSON.parse(txt); };
})();
