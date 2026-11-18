/* Kingmaker — interface controller: setup, the faction roll, map interaction, dialogs, AI pacing. */
(function () {
  const KM = globalThis.KM; const E = KM.Engine, AI = KM.AI, H = KM.H, B = KM.Board;
  const $ = (q, r) => (r || document).querySelector(q);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LIVERY = [['Murrey', '#8a2c52'], ['Azure', '#2d5fa8'], ['Vert', '#2f7d4f'], ['Tawny', '#c8731d'], ['Sable', '#3a393f'], ['Purpure', '#6d4aa6'], ['Celeste', '#2b8f97']];
  const SAVE = 'kingmaker.save.v1';
  const KIND = { noble: 'Noble', title: 'Title', office: 'Office', bishop: 'Bishopric', merc: 'Mercenaries', town: 'Town', ship: 'Ship' };
  const KICON = { title: 'crown', office: 'scroll', bishop: 'mitre', merc: 'pike', town: 'tower', ship: 'anchor' };
  const TYPE = { city: 'City', town: 'Walled town', open: 'Open town', royal: 'Royal castle', castle: 'Castle' };
  let S = null, viewer = 0, sel = null, mode = null, tab = 'faction', busy = false, speed = 1, newCard = null, expand = {}, opts = null, leaveHeirs = false, popFns = [];
  const cfg = { n: 4, players: LIVERY.map((l, i) => ({ name: l[0], ai: i > 0 })), crownToWin: true, parliamentVictory: false };
  const store = { get() { try { return localStorage.getItem(SAVE); } catch (e) { return null; } }, set(v) { try { localStorage.setItem(SAVE, v); } catch (e) { /* storage unavailable: play on without saving */ } }, clear() { try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ } } };
  const humans = () => S.players.filter(p => !p.ai);
  const myTurn = () => S && !busy && S.winner === null && S.turn.player === viewer && !S.players[viewer].ai && S.turn.phase !== 'muster';
  const mustering = () => S && S.turn.phase === 'muster' && !S.players[viewer].ai && !S.players[viewer].mustered;
  const wait = ms => new Promise(r => setTimeout(r, Math.max(0, ms * speed)));
  const dot = p => `<i class="dot" style="background:${S.players[p].color}"></i>`;
  const pname = p => esc(S.players[p].name);
  const nname = id => esc(KM.CARD[id].name);
  const full = id => { const c = KM.CARD[id], n = S.nobles[id]; const t = n ? E.titleName(S, n) : c.title; return esc(c.name) + (t ? ', ' + esc(t) : ''); };

  // ================= setup screen =================
  function renderSetup() {
    E.init(); const saved = store.get();
    let roll = ''; for (const n of KM.CARDS.nobles) roll += `<figure>${H.shield(n.arms, 44)}<figcaption>${esc(n.name)}</figcaption></figure>`;
    let rows = '';
    for (let i = 0; i < cfg.n; i++) rows += `<div class="prow"><span class="sw" style="background:${LIVERY[i][1]}"></span><input aria-label="Faction ${i + 1} name" data-name="${i}" value="${esc(cfg.players[i].name)}" maxlength="18"><span class="seg"><button data-ai="${i}" data-v="0" aria-pressed="${!cfg.players[i].ai}">Player</button><button data-ai="${i}" data-v="1" aria-pressed="${cfg.players[i].ai}">Computer</button></span></div>`;
    $('#setup').innerHTML = `<div class="title"><h1>Kingmaker</h1>
<p class="lede">England, 1455. Two royal houses, eight claimants, and twenty-three great families who would rather hold a king than be one.</p>
<div class="roll" aria-label="The noble houses">${roll}</div>
<div class="setupgrid"><section><h2>Factions at the table</h2>
<div class="stepper" style="margin-bottom:10px"><button data-n="-1" aria-label="Fewer factions">−</button><span class="num">${cfg.n}</span><button data-n="1" aria-label="More factions">+</button></div>${rows}</section>
<section><h2>How the war is won</h2>
<label class="opt"><input type="checkbox" data-opt="crownToWin" ${cfg.crownToWin ? 'checked' : ''}><span>The last heir must be crowned<small>Untick to win as soon as you hold the sole surviving heir.</small></span></label>
<label class="opt"><input type="checkbox" data-opt="parliamentVictory" ${cfg.parliamentVictory ? 'checked' : ''}><span>Allow victory in Parliament<small>Hold the only King, a majority of the Commons and the most Lords when you summon it. Makes for a shorter game.</small></span></label>
<div class="begin"><button class="btn gilt" data-go="new">Deal the cards</button>${saved ? '<button class="btn" data-go="continue">Resume saved game</button>' : ''}<button class="btn ghost" data-go="rules">How to play</button></div></section></div></div>`;
  }
  $('#setup').addEventListener('click', ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.n) { cfg.n = Math.min(7, Math.max(2, cfg.n + +t.dataset.n)); renderSetup(); }
    else if (t.dataset.ai) { cfg.players[+t.dataset.ai].ai = t.dataset.v === '1'; renderSetup(); }
    else if (t.dataset.go === 'new') startGame();
    else if (t.dataset.go === 'continue') resume();
    else if (t.dataset.go === 'rules') showRules();
  });
  $('#setup').addEventListener('input', ev => { const t = ev.target; if (t.dataset.name) cfg.players[+t.dataset.name].name = t.value || LIVERY[+t.dataset.name][0]; if (t.dataset.opt) cfg[t.dataset.opt] = t.checked; });

  function enterGame() {
    $('#setup').hidden = true; $('#game').hidden = false;
    if (!$('#board')) { B.mount($('#map'), { onToken, onPlace, onArea, onShip, onNothing: () => { hidePop(); } }); renderLegend(); }
    B.fit();
  }
  function startGame() {
    S = E.newGame({ players: cfg.players.slice(0, cfg.n).map((p, i) => ({ name: p.name.trim() || LIVERY[i][0], ai: p.ai, color: LIVERY[i][1] })), options: { crownToWin: cfg.crownToWin, parliamentVictory: cfg.parliamentVictory } });
    sel = null; mode = null; tab = 'faction'; busy = false; viewer = (humans()[0] || S.players[0]).id; enterGame(); advance();
  }
  function resume() { try { const d = JSON.parse(store.get()); S = E.deserialize(JSON.stringify(d.s)); viewer = d.viewer; } catch (e) { store.clear(); renderSetup(); return; } sel = null; mode = null; busy = false; enterGame(); advance(true); }
  function save() { if (S) store.set(JSON.stringify({ s: S, viewer })); }

  // ================= flow =================
  function advance(resumed) {
    validateSel(); render();
    if (S.winner !== null) return showVictory();
    if (S.turn.phase === 'muster') {
      for (const p of S.players) if (p.ai && !p.mustered) AI.muster(S, p.id);
      const h = S.players.find(p => !p.ai && !p.mustered);
      if (h) { if (viewer !== h.id || !resumed) return passTo(h.id, 'muster'); return render(); }
      if (S.turn.phase === 'muster') return; // cannot happen
      return advance();
    }
    const cur = S.players[S.turn.player];
    if (cur.ai) { if (!humans().length) viewer = cur.id; return aiLoop(); }
    if (viewer !== cur.id) return passTo(cur.id);
    render();
  }
  function passTo(id, why) {
    const go = () => { viewer = id; sel = null; mode = null; tab = 'faction'; $('#curtain').hidden = true; render(); if (why === 'muster') musterIntro(); };
    if (humans().length < 2) return go();
    const pl = S.players[id];
    $('#curtain').innerHTML = `<div><span style="display:inline-block;width:46px;height:56px;background:${pl.color};border-radius:4px 4px 23px 23px;border:2px solid #000"></span><h2>${esc(pl.name)}</h2><p>${why === 'muster' ? 'Muster your faction in private.' : 'The table is yours. Others, look away.'}</p><button class="btn gilt" id="curtgo">Take my turn</button></div>`;
    $('#curtain').hidden = false; $('#curtgo').onclick = go; $('#curtgo').focus();
  }
  function musterIntro() {
    modal(`<h2>Muster your faction</h2><p>These are the Crown cards dealt to you. Raise each noble's banner at one of his castles, then bestow your titles, offices, bishoprics, mercenaries, towns and ships on the nobles who should hold them.</p><p>A title needs an untitled noble. An office needs a titled one. What you cannot bestow goes to Chancery, to be shared out by a later Parliament.</p>`, [{ label: 'Arrange it for me', fn: () => { autoMuster(); } }, { label: 'I will do it myself', cls: 'gilt' }]);
  }
  function autoMuster() { let g = 0; while (g++ < 60 && AI.playOne(S, viewer, true)); mode = null; render(); }
  function act(fn) { const r = fn(); if (r && r.ok === false) toast(r.error); validateSel(); render(); return r; }
  function validateSel() { if (!sel || !S) return; sel.ids = sel.ids.filter(id => S.nobles[id] && S.nobles[id].owner === viewer); if (sel.ids.length) { const f = S.nobles[sel.ids[0]]; sel.ids = sel.ids.filter(id => E.sameLoc(S.nobles[id], f)); } if (!sel.ids.length) sel = null; }
  function selectLoc(loc) { const ns = E.noblesAt(S, loc, viewer); if (!ns.length) return; sel = { ids: ns.map(n => n.id) }; mode = null; leaveHeirs = false; hidePop(); render(); }

  // ----- primary button -----
  function primary() {
    if (mustering()) { const r = act(() => E.finishMuster(S, viewer)); if (r.ok) { sel = null; advance(); } return; }
    if (!myTurn()) return;
    const ph = S.turn.phase;
    if (ph === 'event') return drawEvent();
    if (ph === 'move') { act(() => E.endMovement(S)); sel = null; mode = null; render(); return; }
    if (ph === 'combat') { act(() => E.endCombat(S)); return; }
    if (ph === 'court') { const mark = S.log.length; const r = act(() => E.endTurn(S)); if (r.ok) { newCard = r.drawn || null; sel = null; mode = null; if (r.drawn && S.winner === null) toast(`You drew ${KM.CARD[r.drawn].name}.`, 2200); advance(); } }
  }
  function drawEvent() {
    const mark = S.log.length; const r = E.drawEvent(S); if (!r.ok) return toast(r.error);
    validateSel(); render(); const ev = r.event; const lines = S.log.slice(mark + 1).map(l => l.text);
    for (const f of r.fx) if (f.to || f.area) B.ping(f.to || f.area, '#a4232a');
    modal(eventCardHTML(ev, lines), [{ label: 'So be it', cls: 'gilt', fn: () => { if (S.winner !== null) showVictory(); else if (S.turn.mustParl) toast('You may summon Parliament after combat this turn.', 2600); } }]);
  }
  function eventCardHTML(ev, lines) {
    let body = ev.text ? `<p>${esc(ev.text)}</p>` : '';
    if (ev.type === 'summons') body = '<p>The realm is troubled, and those whose duty it is must go at once:</p><ul class="effects">' + ev.calls.map(c => `<li>${esc(c.who)} to ${esc(c.to ? KM.P[c.to].name : 'the Cheviots')}</li>`).join('') + '</ul>';
    return `<h2>${esc(ev.title)}</h2><div class="evcard">${body}</div>${lines.length ? '<ul class="effects">' + lines.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>' : ''}`;
  }

  // ================= AI pacing =================
  async function aiLoop() {
    if (busy) return; busy = true; render();
    try {
      let guard = 0;
      while (S.winner === null && S.players[S.turn.player].ai && S.turn.phase !== 'muster' && guard++ < 400) {
        const p = S.turn.player; if (!humans().length) viewer = p;
        const mark = S.log.length; const a = AI.step(S); if (!a) break;
        await present(a, p, mark);
      }
    } finally { busy = false; }
    save(); advance();
  }
  async function present(a, p, mark) {
    const pl = S.players[p]; const lines = S.log.slice(mark).map(l => l.text);
    if (a.kind === 'event') { render(); for (const f of a.fx || []) if (f.to || f.area) B.ping(f.to || f.area, '#a4232a'); await banner(a.event.title, lines.slice(1), `${pl.name} draws an Event card`, a.fx && a.fx.length ? 2600 : 1500); }
    else if (a.kind === 'move') { render(); B.flashPath(a.path, pl.color); B.ping(a.dest.area, pl.color); await wait(650); }
    else if (a.kind === 'attack') {
      render(); B.ping(a.area, '#a4232a');
      const involved = a.foe !== null && a.foe !== undefined && !S.players[a.foe].ai;
      if (involved) { await new Promise(res => modal(battleReport(a, p), [{ label: 'Continue', cls: 'gilt', fn: res }], { onClose: res })); }
      else await banner(a.type === 'siege' ? `${pl.name} besieges ${KM.P[a.place].name}` : `${pl.name} gives battle near ${E.areaName(a.area)}`, lines.slice(0, 4), '', 2400);
    }
    else if (a.kind === 'parliament') await aiParliament(p);
    else if (a.kind === 'crown') { render(); B.ping(S.heirs[a.heir].area, '#d2a633'); await banner(lines[0] || 'A coronation', [], '', 2600); }
    else if (a.kind === 'heir' || a.kind === 'prisoner') { render(); await banner(lines[0] || '', lines.slice(1), '', 1700); }
    else if (a.kind === 'card') { render(); await wait(260); }
    else if (a.kind === 'endTurn') { render(); await wait(300); }
    else render();
  }
  async function aiParliament(p) {
    const props = AI.proposals(S, p); const voters = humans().filter(h => h.id !== p);
    render();
    if (!voters.length) { const mark = S.log.length; AI.runParliament(S); await banner(`${S.players[p].name} summons Parliament`, S.log.slice(mark).map(l => l.text).slice(0, 6), '', 3200); return; }
    await new Promise(res => {
      const votes = {}; props.forEach((pr, i) => voters.forEach(v => { votes[i + ':' + v.id] = S.nobles[pr.noble].owner === v.id; }));
      const draw = (results) => {
        let h = `<h2>Parliament at ${esc(KM.P[S.parl ? S.parl.venue : 'london'].name)}</h2><p>${pname(p)} has summoned Parliament and lays these grants before it. Cast your faction's votes on each.</p>${votesTable()}`;
        props.forEach((pr, i) => {
          h += `<div class="bill"><div><b>${esc(KM.CARD[pr.card].name)}</b><br><small>to ${full(pr.noble)} — ${dot(S.nobles[pr.noble] ? S.nobles[pr.noble].owner : p)} ${S.nobles[pr.noble] ? pname(S.nobles[pr.noble].owner) : ''}</small></div><div>`;
          if (results) h += `<span class="res ${results[i] && results[i].pass ? 'pass' : 'fail'}">${results[i] ? (results[i].pass ? 'Granted' : 'Refused') + tally(results[i]) : 'Lapsed'}</span>`;
          else for (const v of voters) h += `<span class="seg" title="${esc(v.name)}"><button data-vote="${i}:${v.id}" data-v="1" aria-pressed="${votes[i + ':' + v.id]}">${esc(v.name)}: Aye</button><button data-vote="${i}:${v.id}" data-v="0" aria-pressed="${!votes[i + ':' + v.id]}">No</button></span> `;
          h += `</div><span></span></div>`;
        });
        modal(h, results ? [{ label: 'Parliament is dissolved', cls: 'gilt', fn: res }] : [{ label: 'Count the votes', cls: 'gilt', keep: true, fn: () => {
          const out = []; props.forEach((pr, i) => { if (!S.parl.cards.includes(pr.card) || !E.parlTargets(S, pr.card).includes(pr.noble)) { out.push(null); return; } const ballots = {}; for (const q of S.players) if (q.id !== p) ballots[q.id] = q.ai ? AI.ballot(S, q.id, pr.card, pr.noble) : votes[i + ':' + q.id]; out.push(E.propose(S, pr.card, pr.noble, ballots)); });
          E.closeParliament(S); render(); draw(out);
        } }], { wide: true, onClick: t => { if (t.dataset.vote) { votes[t.dataset.vote] = t.dataset.v === '1'; draw(); } } });
      };
      draw();
    });
  }
  const tally = r => ` <small>(Lords ${r.ayeL}–${r.noL}${r.lordsOnly ? '' : `, Commons ${r.ayeC}–${r.noC}`})</small>`;
  function votesTable() {
    let h = '<table class="votes"><tr><th>Faction</th><th class="n">Commons</th><th class="n">Lords</th></tr>';
    S.players.forEach((pl, i) => { const v = S.parl ? S.parl.votes[i] : E.votes(S, i); h += `<tr><td>${dot(i)} ${esc(pl.name)}${S.parl && S.parl.summoner === i ? ' <small>(summoner)</small>' : ''}</td><td class="n">${v.commons}</td><td class="n">${v.lords}</td></tr>`; });
    return h + '</table>';
  }

  // ================= map interaction =================
  const reach = (aid) => opts && !opts.error && (opts.land[aid] ? 'land' : opts.road[aid] ? 'road' : null);
  function onToken(t, ev) {
    if (mustering() || myTurn()) {
      if (t.owner === viewer) {
        if (sel && S.nobles[sel.ids[0]].area !== t.area && reach(t.area) && myTurn()) return menu(ev, E.areaName(t.area), [{ label: 'March the selected force here', fn: () => onArea(t.area, ev) }, { label: 'Select this force instead', alt: true, fn: () => selectLoc(t) }]);
        return selectLoc(t);
      }
      if (sel && reach(t.area)) return onArea(t.area, ev);
    }
    areaInfo(t.area, ev);
  }
  function onShip(key, ev) {
    const sh = S.ships[key]; const o = E.shipOwner(S, sh);
    if (o === viewer && myTurn() && S.turn.phase === 'move') { mode = { type: 'ship', key }; sel = null; render(); toast(sh.used ? `The ${sh.name} cannot sail again this turn.` : `Choose a port for the ${sh.name}, or select a force at ${KM.P[sh.port].name} to carry.`, 2600); return; }
    areaInfo(KM.P[sh.port].area, ev);
  }
  function onPlace(pid, ev) {
    const pl = KM.P[pid];
    if (mode && mode.type === 'card' && KM.CARD[mode.card].kind === 'noble') { if (E.cardTargets(S, viewer, mode.card).includes(pid)) { const c = mode.card; mode = null; act(() => E.playCard(S, viewer, c, pid)); if (S.nobles[c]) selectLoc(S.nobles[c]); } return; }
    if (mode && mode.type === 'ship') { if (E.shipPorts(S, mode.key).includes(pid)) { const k = mode.key; mode = null; act(() => E.sailEmpty(S, viewer, k, pid)); } else toast('Too far for one voyage.'); return; }
    if (sel && myTurn() && opts && !opts.error) {
      const items = [];
      for (const o of opts.sea.filter(o => o.port === pid)) { const sh = S.ships[o.ship]; items.push(o.fits ? { label: `Sail here aboard the ${sh.name}` + (o.friendly ? '' : ' — to land before hostile walls'), fn: () => doMove({ area: o.area, via: 'sea', ship: o.ship, port: pid, enter: E.isFriendly(S, pid, viewer) ? pid : null }) } : { label: `The ${sh.name} carries only ${sh.cap} men`, alt: true, fn: () => {} }); }
      const via = reach(pl.area);
      if (via) { if (E.isFriendly(S, pid, viewer)) items.push({ label: `${via === 'road' ? 'Ride' : 'March'} into ${pl.name}`, fn: () => doMove({ area: pl.area, via, enter: pid }) }); items.push({ label: `${via === 'road' ? 'Ride' : 'March'} to the field outside ${pl.name}`, alt: items.length > 0, fn: () => doMove({ area: pl.area, via }) }); }
      if (items.length === 1 && via && !E.isFriendly(S, pid, viewer)) return items[0].fn();
      if (items.length) return menu(ev, pl.name, items);
    }
    areaInfo(pl.area, ev);
  }
  function onArea(aid, ev) {
    if (mode && mode.type !== 'transfer') { mode = null; render(); }
    if (sel && myTurn()) {
      const via = reach(aid);
      if (via) {
        const fr = KM.A[aid].places.filter(pl => E.isFriendly(S, pl, viewer));
        if (!fr.length) return doMove({ area: aid, via });
        return menu(ev, E.areaName(aid), fr.map(pl => ({ label: `Enter ${KM.P[pl].name}`, fn: () => doMove({ area: aid, via, enter: pl }) })).concat([{ label: 'Stay in the field', alt: true, fn: () => doMove({ area: aid, via }) }]));
      }
    }
    areaInfo(aid, ev);
  }
  function doMove(dest) {
    hidePop(); const ids = sel.ids.slice(); const r = act(() => E.move(S, viewer, ids, dest, leaveHeirs ? [] : undefined));
    if (r.ok) { B.flashPath(r.path, '#fff'); sel = { ids }; validateSel(); render(); }
  }
  function areaInfo(aid, ev) {
    const a = KM.A[aid]; let h = `<h4>${esc(E.areaName(aid))}</h4>`;
    const notes = []; if (a.terrain === 'forest') notes.push('Forest: a force entering from open country halts here.'); if (a.road.length) notes.push('On a road.'); if (aid === 'scotland') notes.push('No battles may be fought beyond the border.');
    if (['ireland', 'calais', 'wight', 'man'].includes(aid)) notes.push('Reached only by ship.');
    if (notes.length) h += `<small>${notes.join(' ')}</small>`;
    for (const pid of a.places) {
      const p = KM.P[pid]; const o = E.fortified(pid) ? E.placeOwner(S, pid) : null; const lord = KM.CARDS.nobles.find(n => n.castles.includes(pid));
      h += `<div class="row"><svg width="26" height="30" viewBox="-13 -19 26 30">${H.placeInner(p, o !== null ? S.players[o].color : null)}</svg><div class="grow"><b>${esc(p.name)}</b><br><small>${p.type === 'castle' && lord ? 'Castle of ' + esc(lord.name) : TYPE[p.type]}${p.cathedral ? ', cathedral' : ''}${p.port ? ', port on the ' + esc(KM.SEA[p.port].name) : ''}${p.garrison ? ' — garrison ' + p.garrison : ''}</small></div><div>${o !== null ? dot(o) + ' <small>' + pname(o) + '</small>' : E.fortified(pid) ? '<small>holds for no lord</small>' : ''}</div></div>`;
    }
    const gs = {}; for (const n of E.noblesInArea(S, aid)) { const k = n.owner + '|' + (n.inside || ''); (gs[k] = gs[k] || []).push(n); }
    for (const [k, ns] of Object.entries(gs)) { const [o, ins] = k.split('|'); h += `<div class="row">${dot(+o)}<div class="grow"><b>${pname(+o)}</b> <small>${ins ? 'within ' + esc(KM.P[ins].name) : 'in the field'}</small><br><small>${ns.map(n => full(n.id) + ' ' + E.strength(S, n)).join('; ')}</small></div><b class="num">${E.stackStrength(S, ns)}</b></div>`; }
    for (const hr of E.aliveHeirs(S).filter(x => x.area === aid)) h += `<div class="row">${H.rose(KM.HEIR[hr.id].house, 18, hr.crowned)}<div class="grow">${esc(KM.HEIR[hr.id].name)}${hr.crowned ? ' <small>(crowned)</small>' : ''}<br><small>${hr.ctrl === null ? 'unescorted' + (hr.inside ? ' within ' + esc(KM.P[hr.inside].name) : '') : 'kept by ' + pname(hr.ctrl)}</small></div></div>`;
    for (const sh of Object.values(S.ships)) if (KM.P[sh.port].area === aid && E.shipOwner(S, sh) !== null) h += `<div class="row">${H.icon('anchor', 16)}<div class="grow">${esc(sh.name)} <small>carries ${sh.cap}, at ${esc(KM.P[sh.port].name)}</small></div>${dot(E.shipOwner(S, sh))}</div>`;
    showPop(h, ev);
  }

  // ================= popover / modal / banner =================
  function showPop(html, ev) {
    const el = $('#pop'); el.innerHTML = html; el.hidden = false;
    const x = ev && ev.clientX !== undefined ? ev.clientX : innerWidth / 2, y = ev && ev.clientY !== undefined ? ev.clientY : innerHeight / 2;
    const r = el.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 14)) + 'px'; el.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y - 10)) + 'px';
  }
  function hidePop() { $('#pop').hidden = true; popFns = []; }
  function menu(ev, title, items) { popFns = items.map(i => i.fn); showPop(`<h4>${esc(title)}</h4><div class="menu">${items.map((it, i) => `<button data-i="${i}" class="${it.alt ? 'alt' : ''}">${esc(it.label)}</button>`).join('')}</div>`, ev); }
  $('#pop').addEventListener('click', ev => { const t = ev.target.closest('button[data-i]'); if (!t) return; const fn = popFns[+t.dataset.i]; hidePop(); fn && fn(); });
  document.addEventListener('pointerdown', ev => { if (!$('#pop').hidden && !ev.target.closest('#pop')) setTimeout(() => { if (!$('#pop').matches(':hover')) hidePop(); }, 0); }, true);
  let modalCb = null;
  function modal(html, buttons, o) {
    o = o || {}; const box = $('#modalbox'); box.className = o.wide ? 'wide' : '';
    box.innerHTML = html + `<div class="mfoot">${(buttons || []).map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $('#modal').hidden = false; modalCb = { buttons: buttons || [], o }; const f = box.querySelector('.mfoot .btn.gilt') || box.querySelector('.mfoot .btn'); f && f.focus();
  }
  function closeModal() { $('#modal').hidden = true; modalCb = null; }
  $('#modalbox').addEventListener('click', ev => {
    const t = ev.target.closest('button,[data-click]'); if (!t || !modalCb) return;
    if (t.dataset.b !== undefined) { const b = modalCb.buttons[+t.dataset.b]; if (!b.keep) closeModal(); b.fn && b.fn(); return; }
    modalCb.o.onClick && modalCb.o.onClick(t);
  });
  $('#modalbox').addEventListener('change', ev => { if (modalCb && modalCb.o.onChange) modalCb.o.onChange(ev.target); });
  let bannerT = null;
  function banner(title, lines, by, ms) {
    const el = $('#banner'); el.innerHTML = `${by ? `<div class="by">${esc(by)}</div>` : ''}<h3>${esc(title)}</h3>${(lines || []).map(l => `<p>${esc(l)}</p>`).join('')}`; el.hidden = false;
    clearTimeout(bannerT); return new Promise(res => { bannerT = setTimeout(() => { el.hidden = true; res(); }, Math.max(speed ? 350 : 0, ms * speed)); });
  }
  function toast(text, ms) { const el = $('#banner'); el.innerHTML = `<p style="font-size:15px;color:#2a2118;margin:0">${esc(text)}</p>`; el.hidden = false; clearTimeout(bannerT); bannerT = setTimeout(() => { el.hidden = true; }, ms || 2400); }

  // ================= combat =================
  function sideList(ids, slain) { return '<ul>' + ids.map(id => `<li class="${slain && slain.includes(id) ? 'slain' : ''}">${H.nobleShield(id, 16)} ${nname(id)}</li>`).join('') + '</ul>'; }
  function openAttack(o) {
    const ch = E.chances(o.att, o.def, o.type === 'siege'); const place = o.place ? KM.P[o.place] : null;
    const pct = v => Math.round(v * 100) + '%';
    let h = `<h2>${place ? 'Besiege ' + esc(place.name) : 'Give battle near ' + esc(E.areaName(o.area))}</h2>
<div class="sides"><div class="side-col"><h4>${dot(viewer)} ${pname(viewer)}</h4><div class="tot">${o.att}</div>${sideList(o.attackers)}</div><div class="vs">against</div>
<div class="side-col"><h4>${o.foe !== null && o.foe !== undefined ? dot(o.foe) + ' ' + pname(o.foe) : 'The garrison'}</h4><div class="tot">${o.def}</div>${place ? `<ul><li>${H.icon('tower', 15)} Garrison of ${esc(place.name)}: ${place.garrison}</li></ul>` : ''}${sideList(o.defenders)}</div></div>`;
    if (!o.ok) h += `<p><b>${place ? `You need at least ${o.def} men to lay siege.` : 'The weaker force cannot give battle.'}</b></p>`;
    else h += `<p>${place ? 'A siege succeeds unless bad weather delays it.' : `You outnumber them ${(o.att / Math.max(1, o.def)).toFixed(2)} to 1. An Event card names the odds the day demands.`} Whatever the outcome, any noble named on the card dies if he is on the field.</p>
<div class="bar" style="height:12px"><i class="w" style="width:${pct(ch.win)}"></i><i class="s" style="width:${pct(ch.stall)}"></i><i class="x" style="width:${pct(ch.weather)}"></i></div>
<p><small>${pct(ch.win)} of battle cards give you the ${place ? 'walls' : 'victory'}${ch.stall ? ', ' + pct(ch.stall) + ' leave the day undecided' : ''}, ${pct(ch.weather)} bring bad weather.</small></p>${o.heirs.length ? `<p>${o.heirs.map(x => esc(KM.HEIR[x].name)).join(' and ')} ${o.heirs.length > 1 ? 'are' : 'is'} the prize.</p>` : ''}`;
    modal(h, [{ label: 'Hold back', cls: 'ghost' }].concat(o.ok ? [{ label: place ? 'Storm the walls' : 'Attack', cls: 'gules', keep: true, fn: () => { const r = E.attack(S, viewer, o); if (!r.ok) { closeModal(); return toast(r.error); } validateSel(); render(); showReport(r); } }] : []));
  }
  function battleReport(r, p) {
    const b = KM.EVENT[r.card].battle; const place = r.place ? KM.P[r.place] : null;
    const head = r.outcome === 'weather' ? 'Bad weather delays the attack' : r.outcome === 'win' ? (place ? `${esc(place.name)} falls` : `Victory for ${pname(p)}`) : 'The day is undecided';
    let h = `<h2>${head}</h2><div class="evcard"><div class="fate">${b.weather ? '<b>Rain</b><span>No battle is fought. The attackers have had their chance this turn.</span>' : `<b>${esc(b.label)}</b><span>${place ? 'Sieges ignore the odds.' : 'odds needed for a victory'}</span><span>Marked for death: ${b.killed.length ? b.killed.map(nname).join(', ') : 'no one'}</span>`}</div></div>
<div class="sides"><div class="side-col"><h4>${dot(p)} ${pname(p)}</h4><div class="tot">${r.att}</div>${sideList(r.attackers, r.killed)}</div><div class="vs">against</div><div class="side-col"><h4>${r.foe !== null && r.foe !== undefined ? dot(r.foe) + ' ' + pname(r.foe) : 'The garrison'}</h4><div class="tot">${r.def}</div>${sideList(r.defenders, r.killed)}</div></div>`;
    if (r.heirs.length) h += `<p><b>${r.heirs.map(x => esc(KM.HEIR[x].name)).join(' and ')}</b> ${r.heirs.length > 1 ? 'pass' : 'passes'} into the keeping of ${pname(p)}.</p>`;
    return h;
  }
  function showReport(r) {
    const draw = () => {
      let h = battleReport(r, viewer); const pend = S.pending && S.pending.type === 'prisoners' ? S.pending.list : [];
      if (pend.length) { h += `<h3>Prisoners</h3><p><small>Their mercenaries, towns and ships are already yours. A released noble keeps his title and office.</small></p>`; for (const id of pend) h += `<div class="prisoner">${H.nobleShield(id, 26)}<div class="grow"><b>${full(id)}</b><br><small>${pname(S.nobles[id].owner)}</small></div><button class="btn gules small" data-fate="execute" data-id="${id}">Execute</button><button class="btn small" data-fate="release" data-id="${id}">Release</button></div>`; }
      modal(h, pend.length ? [] : [{ label: 'Continue', cls: 'gilt', fn: () => { if (S.winner !== null) showVictory(); } }], { onClick: t => { if (t.dataset.fate) { E.resolvePrisoner(S, t.dataset.id, t.dataset.fate); validateSel(); render(); draw(); } } });
    };
    draw();
  }

  // ================= parliament (human summoner) =================
  function openParliament() {
    const r = E.openParliament(S, viewer); if (!r.ok) return toast(r.error); render(); if (S.winner !== null) return showVictory();
    const picks = {}, ballots = {}, results = {}; const others = humans().filter(h => h.id !== viewer);
    const draw = () => {
      if (!S.parl) return;
      let h = `<h2>Parliament at ${esc(KM.P[S.parl.venue].name)}</h2><p>Propose a holder for each grant. Titles and offices need a majority in both Houses; bishoprics need only the Lords. Your own votes are always cast in favour. A rival who receives a grant from you will support the rest of your proposals.</p>${votesTable()}`;
      for (const cid of r.parl.cards.concat(Object.keys(results).filter(c => !r.parl.cards.includes(c)))) {
        const c = KM.CARD[cid]; const done = results[cid];
        h += `<div class="bill"><div><b>${esc(c.name)}</b><br><small>${KIND[c.kind]}${c.troops ? ', ' + c.troops + ' men' : ''}${c.lords ? ', ' + c.lords + ' Lords votes' : ''}</small></div>`;
        if (done) h += `<div class="res ${done.pass ? 'pass' : 'fail'}">${done.pass ? 'Granted to ' : 'Refused to '}${nname(done.noble)}${tally(done)}</div><span></span>`;
        else {
          const t = E.parlTargets(S, cid).map(id => S.nobles[id]).sort((a, b) => (a.owner === viewer ? -1 : 1) - (b.owner === viewer ? -1 : 1) || E.strength(S, b) - E.strength(S, a));
          if (!t.length) h += `<div><small>No eligible noble in the realm.</small></div><span></span>`;
          else { if (!picks[cid] || !t.some(n => n.id === picks[cid])) picks[cid] = t[0].id; h += `<div><select data-bill="${cid}">${t.map(n => `<option value="${n.id}" ${picks[cid] === n.id ? 'selected' : ''}>${nname(n.id)} — ${pname(n.owner)}</option>`).join('')}</select>${others.map(o => ` <label><input type="checkbox" data-ballot="${cid}:${o.id}" ${ballots[cid + ':' + o.id] ? 'checked' : ''}> ${esc(o.name)} votes aye</label>`).join('')}</div><button class="btn small" data-put="${cid}">Put to the vote</button>`; }
        }
        h += '</div>';
      }
      modal(h, [{ label: 'Dissolve Parliament', cls: 'gilt', fn: () => { E.closeParliament(S); render(); } }], { wide: true, onChange: t => { if (t.dataset.bill) picks[t.dataset.bill] = t.value; if (t.dataset.ballot) ballots[t.dataset.ballot] = t.checked; }, onClick: t => {
        if (!t.dataset.put) return; const cid = t.dataset.put; const b = {};
        for (const q of S.players) if (q.id !== viewer) b[q.id] = q.ai ? AI.ballot(S, q.id, cid, picks[cid]) : !!ballots[cid + ':' + q.id];
        const res = E.propose(S, cid, picks[cid], b); if (!res.ok) return toast(res.error); results[cid] = res; render(); draw();
      } });
    };
    draw();
  }

  // ================= rendering =================
  function render() { if (!S) return; B.render(S, viewer); renderTop(); renderPanel(); computeOpts(); renderTray(); save(); }
  function computeOpts() {
    const h = {}; opts = null;
    if (mode && mode.type === 'card' && KM.CARD[mode.card].kind === 'noble') h.places = E.cardTargets(S, viewer, mode.card);
    else if (mode && mode.type === 'ship' && S.ships[mode.key] && !S.ships[mode.key].used) { h.ports = {}; for (const p of E.shipPorts(S, mode.key)) h.ports[p] = 'ok'; }
    if (sel) {
      h.sel = { area: S.nobles[sel.ids[0]].area };
      if (myTurn() && S.turn.phase === 'move') { opts = E.moveOptions(S, viewer, sel.ids); if (!opts.error) { h.areas = {}; for (const k of Object.keys(opts.road)) h.areas[k] = 'road'; for (const k of Object.keys(opts.land)) h.areas[k] = 'land'; h.ports = h.ports || {}; for (const o of opts.sea) if (o.fits || !h.ports[o.port]) h.ports[o.port] = o.fits ? 'ok' : 'full'; } }
    }
    if (myTurn() && S.turn.phase === 'combat') { h.attacks = {}; for (const o of E.combatOptions(S, viewer)) if (o.ok) h.attacks[o.area] = true; }
    B.highlight(h);
  }
  function renderLegend() {
    const sym = (t, x) => `<svg width="22" height="26" viewBox="-11 -17 22 28">${H.placeInner(Object.assign({ type: t }, x || {}))}</svg>`;
    $('#legend').innerHTML = `<span>${sym('city')}City, garrison 300</span><span>${sym('town')}Walled town, 200</span><span>${sym('royal')}Royal castle, 200</span><span>${sym('castle')}Noble's castle, 100</span><span>${sym('open')}Open town</span><span>${sym('town', { cathedral: true })}Cathedral</span><span><svg width="22" height="14" viewBox="-8 -7 16 14">${H.anchorInner}</svg>Port</span><span><svg width="22" height="8"><path d="M1 4h20" stroke="#c9865a" stroke-width="2.6" stroke-dasharray="6 3"/></svg>Road</span>`;
  }
  function renderTop() {
    const t = S.turn, cur = S.players[t.player]; const steps = [['event', 'Event'], ['move', 'March'], ['combat', 'Battle'], ['court', 'Court']]; const idx = steps.findIndex(s => s[0] === t.phase);
    let label = '', dis = false;
    if (mustering()) label = 'Finish muster'; else if (myTurn()) label = { event: 'Draw event card', move: 'Finish marching', combat: 'Finish fighting', court: 'End turn' }[t.phase]; else { label = busy ? `${cur.name} is moving…` : 'Waiting'; dis = true; }
    $('#top').innerHTML = `<span class="word">Kingmaker</span>
<span class="who"><span class="pen" style="background:${t.phase === 'muster' ? S.players[viewer].color : cur.color}"></span>${t.phase === 'muster' ? 'Muster' : esc(cur.name) + ', round ' + t.round}</span>
<ol class="steps">${t.phase === 'muster' ? '' : steps.map((s, i) => `<li class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${s[1]}</li>`).join('')}</ol><span class="grow"></span>
<span class="chips">${S.players.map(p => `<span class="pchip ${p.id === t.player && t.phase !== 'muster' ? 'cur' : ''}" title="${esc(p.name)}: ${E.factionStrength(S, p.id)} men"><i style="background:${p.color}"></i>${esc(p.name)}${E.aliveHeirs(S).filter(h => h.ctrl === p.id).map(h => H.rose(KM.HEIR[h.id].house, 13, h.crowned)).join('')}</span>`).join('')}</span>
<button class="btn small ghost" data-act="speed" title="Pace of the computer factions">${speed === 1 ? 'Measured pace' : speed === 0.35 ? 'Brisk pace' : 'Instant'}</button><button class="btn small ghost" data-act="rules">Rules</button><button class="btn small ghost" data-act="quit">New game</button>
<button class="btn gilt" data-act="primary" ${dis ? 'disabled' : ''}>${esc(label)}</button>`;
  }
  function chip(n, cid) {
    const c = KM.CARD[cid]; const moveable = E.transferable(cid) && n.owner === viewer;
    const val = c.kind === 'ship' ? `carries ${c.cap}` : c.kind === 'town' ? '' : c.troops ? `<b>+${c.troops}</b>` : '';
    const extra = '';
    const bits = []; if (c.bonus) bits.push(`+${c.bonus.troops} ${esc(c.bonus.text)}`); if (c.places && c.places.length) bits.push('holds ' + c.places.map(p => esc(KM.P[p].name)).join(' and ')); if (c.ships && c.ships.length) bits.push('ships ' + c.ships.map(s => esc(s.name)).join(' and ')); if (c.lords) bits.push(c.lords + ' Lords votes');
    const sub = bits.length ? `<br><small>${bits.join('; ')}</small>` : '';
    return `<span class="chip ${moveable ? 'move' : 'fixed'} ${mode && mode.type === 'transfer' && mode.card === cid ? 'on' : ''}" ${moveable ? `data-act="chip" data-card="${cid}" role="button" tabindex="0" title="Can change hands: click, then choose another of your nobles in this area"` : `title="${c.kind === 'office' || c.kind === 'title' || c.kind === 'bishop' ? 'Held until death; cannot be passed on' : ''}"`}>${H.icon(moveable ? 'swap' : KICON[c.kind], 12)}<span>${esc(c.name)} ${val}${extra}${sub}</span></span>`;
  }
  function nobleRow(n, eligible) {
    const c = KM.CARD[n.id]; const t = E.titleName(S, n); const str = E.strength(S, n);
    let h = `<div class="noble ${eligible ? 'eligible' : ''}">${H.nobleShield(n.id, 34)}<div><div class="nm">${esc(c.name)}</div><div class="ttl ${t ? '' : 'none'}">${t ? esc(t) : 'untitled'}</div>`;
    const at = E.attachments(n); if (at.length) h += `<div class="assets">${at.map(cid => chip(n, cid)).join('')}</div>`;
    if (eligible) h += `<div class="assets"><button class="btn gilt small" data-act="assign" data-id="${n.id}">${mode.type === 'transfer' ? 'Pass it to ' : 'Bestow on '}${esc(c.name)}</button></div>`;
    h += `</div><div class="st" data-act="expand" data-id="${n.id}" title="Show where these men come from">${str}<small>men</small></div>`;
    if (expand[n.id]) h += `<div class="breakdown">${E.strengthParts(S, n).map(x => `<div class="${x.on ? '' : 'off'}"><span>${esc(x.label)}</span><span class="num">${x.troops}</span></div>`).join('')}<div><span>Votes in Parliament</span><span>${c.commons} Commons${E.isTitled(S, n) ? ', ' + c.lords + ' Lords' : ''}</span></div></div>`;
    return h + '</div>';
  }
  function cardHTML(cid, o) {
    const c = KM.CARD[cid]; o = o || {}; let v = '';
    if (c.kind === 'noble') v = `<b>${c.troops}</b> men<br>${c.title ? esc(c.title) : 'untitled'}<br>${c.castles.map(p => esc(KM.P[p].name)).join(', ')}`;
    else if (c.kind === 'ship') v = `carries <b>${c.cap}</b><br>home port ${esc(KM.P[c.ports[0]].name)}`;
    else if (c.kind === 'town') v = `friendly walls, garrison ${KM.P[c.place].garrison}${KM.P[c.place].noVote ? '' : '<br>' + (KM.P[c.place].type === 'city' ? 4 : 3) + ' Commons votes'}`;
    else v = `${c.troops ? `<b>+${c.troops}</b> men` : ''}${c.bonus ? `<br>+${c.bonus.troops} ${esc(c.bonus.text)}` : ''}${c.places && c.places.length ? '<br>holds ' + c.places.map(p => esc(KM.P[p].name)).join(', ') : ''}${c.ships && c.ships.length ? '<br>ships ' + c.ships.map(s => esc(s.name)).join(', ') : ''}${c.lords ? `<br>${c.lords} Lords votes` : ''}${c.arch ? '<br>may crown alone' : c.kind === 'bishop' ? '<br>two bishops may crown' : ''}`;
    return `<button class="card k-${c.kind} ${o.on ? 'on' : ''} ${o.fresh ? 'new' : ''}" ${o.act ? `data-act="${o.act}" data-card="${cid}"` : 'disabled style="cursor:default"'}><span class="kind">${c.kind === 'noble' ? '' : H.icon(KICON[c.kind], 12)}${KIND[c.kind]}</span><span class="cn">${esc(c.name)}</span>${c.kind === 'noble' ? H.shield(c.arms, 24) : ''}<span class="cv">${v}</span></button>`;
  }
  function hintText() {
    if (mode && mode.type === 'card') { const c = KM.CARD[mode.card]; return c.kind === 'noble' ? `Choose where ${c.name} raises his banner: his castles are ringed on the map.` : `Choose who receives ${c.name}. Eligible nobles are marked below.`; }
    if (mode && mode.type === 'transfer') return `Choose which noble in the same area takes over ${KM.CARD[mode.card].name}.`;
    if (mode && mode.type === 'ship') return `Choose a ringed port for the ${S.ships[mode.key].name}.`;
    if (mustering()) return S.players[viewer].hand.length ? 'Click a card in your hand, then choose where it goes.' : 'Your faction is mustered. Press “Finish muster”.';
    if (S.players[viewer].ai) return 'A computer faction. You are watching.';
    if (S.turn.player !== viewer) return `${S.players[S.turn.player].name} is taking a turn.`;
    return { event: 'Draw your Event card to open the turn.', move: sel ? 'Gold areas are within a march; orange ones lie along the road; ringed ports can be reached by ship.' : 'Select a force, here or on the map, to see where it can march.', combat: 'Crossed swords mark where you may attack.', court: 'Crown an heir or summon Parliament if you can, then end your turn.' }[S.turn.phase] || '';
  }
  function panelFaction() {
    const p = viewer, pl = S.players[p]; const mine = E.playerNobles(S, p); const v = E.votes(S, p); const spect = pl.ai;
    let elig = []; if (mode && mode.type === 'card' && KM.CARD[mode.card].kind !== 'noble') elig = E.cardTargets(S, p, mode.card); if (mode && mode.type === 'transfer') elig = E.transferTargets(S, p, mode.card);
    let h = `<div class="fhead"><span class="pen" style="background:${pl.color}"></span><div><div class="nm">${esc(pl.name)}</div><div class="sub">${mine.length} noble${mine.length === 1 ? '' : 's'}. ${v.commons} votes in the Commons, ${v.lords} in the Lords.</div></div><div class="big">${E.factionStrength(S, p)}<small>men under arms</small></div></div>`;
    const hint = hintText(); if (hint) h += `<div class="hint">${esc(hint)}${mode ? ' <button class="btn small" data-act="cancel">Cancel</button>' : ''}</div>`;
    // heirs
    const heirs = E.aliveHeirs(S).filter(x => x.ctrl === p);
    if (heirs.length) {
      h += `<h3>Royal heirs in your keeping</h3><div class="army">`;
      const cor = E.coronationOptions(S, p);
      for (const hr of heirs) { const k = KM.HEIR[hr.id]; const co = cor.find(c => c.heir === hr.id); const sen = E.seniorHeir(S, k.house).id === hr.id;
        h += `<div class="heirrow">${H.rose(k.house, 24, hr.crowned)}<div class="grow">${esc(k.name)}<small>${hr.crowned ? 'Crowned. ' : sen ? 'Senior heir of ' + (k.house === 'york' ? 'York' : 'Lancaster') + '. ' : 'Not yet senior in the line. '}At ${esc(E.locName(hr))}.</small></div>${co && !spect ? `<button class="btn small gilt" data-act="crown" data-id="${hr.id}" ${co.ok && myTurn() ? '' : 'disabled'} title="${esc(co.why || 'Crown this heir')}">Crown</button>` : ''}${!spect ? `<button class="btn small gules" data-act="exec-heir" data-id="${hr.id}" ${myTurn() ? '' : 'disabled'}>Execute</button>` : ''}</div>`; }
      h += '</div>';
    }
    // forces
    h += `<h3>Forces <small>grouped by where they stand</small></h3>`;
    const groups = {}; for (const n of mine) { const k = n.area + '|' + (n.inside || ''); (groups[k] = groups[k] || []).push(n); }
    const list = Object.entries(groups).map(([k, ns]) => ({ k, ns, str: E.stackStrength(S, ns) })).sort((a, b) => b.str - a.str);
    if (!list.length) h += `<p class="hint">No noble follows you yet. ${pl.hand.some(c => KM.CARD[c].kind === 'noble') ? 'Raise one from your hand.' : 'You will draw a Crown card at the end of each turn.'}</p>`;
    for (const g of list) {
      const f = g.ns[0]; const isSel = sel && E.sameLoc(S.nobles[sel.ids[0]], f); const can = S.turn.phase === 'move' && S.turn.player === p && g.ns.some(n => E.canMove(S, n));
      const tags = (f.inside ? '<span class="tag walls">within the walls</span>' : '<span class="tag">in the field</span>') + (S.turn.player === p && S.turn.phase === 'move' ? (g.ns.some(n => n.held) ? '<span class="tag">summoned</span>' : can ? '<span class="tag go">may march</span>' : '<span class="tag">has marched</span>') : '') + (S.turn.player === p && S.turn.phase === 'combat' && g.ns.every(n => n.fought) ? '<span class="tag">has fought</span>' : '');
      h += `<section class="army ${isSel ? 'sel' : ''}"><header data-act="sel" data-area="${f.area}" data-inside="${f.inside || ''}" role="button" tabindex="0" title="Select this force and show it on the map"><span class="where">${esc(E.locName(f))}${tags}</span><span class="tot num">${g.str}</span></header>${g.ns.sort((a, b) => E.strength(S, b) - E.strength(S, a)).map(n => nobleRow(n, elig.includes(n.id))).join('')}</section>`;
    }
    // hand
    if (!spect) {
      h += `<h3>Crown cards in hand <small>${pl.hand.length ? 'play them at any time in your turn' : 'none'}</small></h3><div class="hand">${pl.hand.map(c => cardHTML(c, { act: (myTurn() || mustering()) ? 'card' : null, on: mode && mode.card === c && mode.type === 'card', fresh: newCard === c })).join('')}</div>`;
      if (pl.held.length) { const fm = pl.held.filter(id => KM.EVENT[id].type === 'freeMove').length, wr = pl.held.length - fm; h += `<h3>Event cards kept</h3><div class="hand">${fm ? `<div class="card k-event"><span class="cn">Free Move${fm > 1 ? ' ×' + fm : ''}</span><span class="cv">Select a force that has marched and let it march again.</span></div>` : ''}${wr ? `<div class="card k-event"><span class="cn">Writ of Summons${wr > 1 ? ' ×' + wr : ''}</span><span class="cv">Lets the Chancellor summon Parliament when no King reigns alone.</span></div>` : ''}</div>`; }
    }
    const ships = E.playerShips(S, p);
    if (ships.length) { h += `<h3>Ships</h3>`; for (const sh of ships) h += `<div class="shiprow">${H.icon('anchor', 16)}<div class="grow">${esc(sh.name)} <small>carries ${sh.cap}, lying at ${esc(KM.P[sh.port].name)}${sh.used ? ', spent this turn' : ''}</small></div><button class="btn small" data-act="ship" data-key="${sh.key}" ${myTurn() && S.turn.phase === 'move' && !sh.used ? '' : 'disabled'}>Sail empty</button><button class="btn small ghost" data-act="locate" data-area="${KM.P[sh.port].area}">${H.icon('eye', 14)}</button></div>`; }
    const fr = E.friendlyPlaces(S, p);
    if (fr.length) h += `<h3>Friendly walls <small>your forces may shelter here</small></h3><div class="assets">${fr.map(id => `<button class="chip move" style="border-style:solid" data-act="locate" data-area="${KM.P[id].area}">${H.icon('tower', 12)}${esc(KM.P[id].name)}</button>`).join('')}</div>`;
    return h;
  }
  function panelRealm() {
    let h = `<h3>The factions</h3><table class="realm"><tr><th>Faction</th><th>Nobles</th><th>Men</th><th>Commons</th><th>Lords</th></tr>`;
    for (const p of S.players) { const v = E.votes(S, p.id); h += `<tr><td>${dot(p.id)}${esc(p.name)}${p.ai ? '' : ' <small>(player)</small>'}</td><td class="n">${E.playerNobles(S, p.id).length}</td><td class="n">${E.factionStrength(S, p.id)}</td><td class="n">${v.commons}</td><td class="n">${v.lords}</td></tr>`; }
    h += '</table>';
    for (const house of ['lancaster', 'york']) {
      h += `<h3>House of ${house === 'york' ? 'York' : 'Lancaster'}</h3><div class="army">`;
      for (const k of KM.CARDS.heirs.filter(x => x.house === house)) { const hr = S.heirs[k.id]; h += `<div class="heirrow ${hr.alive ? '' : 'dead'}" ${hr.alive ? `data-act="locate" data-area="${hr.area}" role="button" tabindex="0"` : ''}>${H.rose(house, 20, hr.crowned)}<div class="grow">${esc(k.name)}${hr.alive ? `<small>${hr.crowned ? 'Crowned. ' : ''}${esc(E.locName(hr))}, ${hr.ctrl === null ? 'unescorted' : 'kept by ' + pname(hr.ctrl)}</small>` : ''}</div>${hr.alive && hr.ctrl !== null ? dot(hr.ctrl) : ''}</div>`; }
      h += '</div>';
    }
    h += `<h3>Chancery <small>awaiting a Parliament</small></h3>${S.chancery.length ? `<div class="assets">${S.chancery.map(c => `<span class="chip fixed">${H.icon(KICON[KM.CARD[c].kind], 12)}${esc(KM.CARD[c].name)}</span>`).join('')}</div>` : '<p class="hint">Empty.</p>'}`;
    h += `<h3>The decks</h3><p>${S.crownDeck.length} Crown cards to draw, ${S.crownDiscard.length} set aside. ${S.eventDeck.length} Event cards before the reshuffle.</p>`;
    const dead = S.crownDiscard.filter(c => KM.CARD[c].kind === 'noble'); if (dead.length) h += `<h3>Fallen houses <small>their heirs return when the Crown deck is reshuffled</small></h3><div class="assets">${dead.map(c => `<span class="chip fixed">${H.nobleShield(c, 12)} ${nname(c)}</span>`).join('')}</div>`;
    return h;
  }
  function panelLog() {
    let h = '<div class="log">'; let lastT = null; const rows = [];
    for (const l of S.log) { if (l.t !== lastT) { rows.push({ t: l.t, p: l.p, items: [] }); lastT = l.t; } rows[rows.length - 1].items.push(l); }
    for (const r of rows.reverse().slice(0, 60)) { h += `<div class="turn">${r.t === 0 ? 'Muster' : `<i style="background:${S.players[r.p].color}"></i>Turn ${r.t}, ${esc(S.players[r.p].name)}`}</div>`; for (const l of r.items) h += `<p class="${l.kind}" ${l.area ? `data-act="locate" data-area="${l.area}" style="cursor:pointer"` : ''}>${esc(l.text)}</p>`; }
    return h + '</div>';
  }
  function renderPanel() {
    $('#tabs').innerHTML = [['faction', S.players[viewer].ai ? S.players[viewer].name : 'Your faction'], ['realm', 'The realm'], ['log', 'Chronicle']].map(t => `<button data-tab="${t[0]}" aria-selected="${tab === t[0]}">${esc(t[1])}</button>`).join('');
    const el = $('#panel'); const st = el.scrollTop; el.innerHTML = tab === 'faction' ? panelFaction() : tab === 'realm' ? panelRealm() : panelLog(); el.scrollTop = st; newCard = null;
  }
  function renderTray() {
    const el = $('#tray'); let h = '';
    if (mustering()) h = `<h4>Muster</h4><p>${S.players[viewer].hand.length} card${S.players[viewer].hand.length === 1 ? '' : 's'} still in hand. Unplaced titles, offices and bishoprics go to Chancery when you finish.</p><div class="acts"><button class="btn" data-act="auto">Arrange the rest for me</button></div>`;
    else if (!myTurn()) h = '';
    else if (S.turn.phase === 'event') h = `<h4>Your turn, ${esc(S.players[viewer].name)}</h4><p>Every turn opens with an Event card: plague, raids, embassies and royal summons fall on all factions alike.</p>`;
    else if (S.turn.phase === 'combat') {
      const os = E.combatOptions(S, viewer); h = `<h4>Battle</h4>`;
      if (!os.length) h += `<p>No enemy force or hostile walls share an area with your nobles.</p>`;
      for (const o of os) { const ch = E.chances(o.att, o.def, o.type === 'siege'); const i = os.indexOf(o);
        h += `<div class="atkrow"><div>${o.type === 'siege' ? `Besiege <b>${esc(KM.P[o.place].name)}</b>` : `Attack <b>${pname(o.foe)}</b> near ${esc(E.areaName(o.area))}`} <span class="num">— ${o.att} against ${o.def}</span>${o.heirs.length ? ' <small>(' + o.heirs.map(x => esc(KM.HEIR[x].short)).join(', ') + ' within reach)</small>' : ''}${o.ok ? `<div class="bar" title="Share of battle cards: victory, undecided, bad weather"><i class="w" style="width:${ch.win * 100}%"></i><i class="s" style="width:${ch.stall * 100}%"></i><i class="x" style="width:${ch.weather * 100}%"></i></div>` : `<br><small>${o.type === 'siege' ? 'Too few men to lay siege.' : 'Too weak to give battle.'}</small>`}</div><button class="btn small ${o.ok ? 'gules' : ''}" data-act="attack" data-i="${i}">${o.ok ? 'Review' : 'Details'}</button></div>`; }
    }
    else if (S.turn.phase === 'court') {
      const cs = E.canSummon(S, viewer); const cor = E.coronationOptions(S, viewer);
      h = `<h4>Court</h4><div class="acts">${cor.map(c => `<button class="btn ${c.ok ? 'gilt' : ''}" data-act="crown" data-id="${c.heir}" ${c.ok ? '' : 'disabled'}>Crown ${esc(KM.HEIR[c.heir].short)}</button>${c.ok ? '' : `<small>${esc(c.why)}</small>`}`).join('')}<button class="btn ${cs.ok ? 'gilt' : ''}" data-act="parliament" ${cs.ok ? '' : 'disabled'}>Summon Parliament</button>${cs.ok ? '' : `<small>${esc(cs.why)}</small>`}</div><p>Ending your turn draws one Crown card.</p>`;
    }
    else if (sel) {
      const f = S.nobles[sel.ids[0]]; const here = E.noblesAt(S, f, viewer); const heirs = E.heirsAt(S, f).filter(x => x.ctrl === viewer);
      h = `<h4>${esc(E.locName(f))} <span class="num">— ${E.stackStrength(S, sel.ids)} men selected</span></h4><div class="force">${here.map(n => `<button class="fn" data-act="pick" data-id="${n.id}" aria-pressed="${sel.ids.includes(n.id)}" title="Include or leave behind">${H.nobleShield(n.id, 18)}${nname(n.id)} <b>${E.strength(S, n)}</b></button>`).join('')}${heirs.map(x => `<span class="fn" style="background:#171310;color:#efe5c9;border-color:#d2a633">${H.rose(KM.HEIR[x.id].house, 16, x.crowned)}${esc(KM.HEIR[x.id].short)}</span>`).join('')}</div>`;
      if (heirs.length && sel.ids.length < here.length) h += `<label class="key"><input type="checkbox" data-act="leaveheirs" ${leaveHeirs ? 'checked' : ''}> Leave the heir${heirs.length > 1 ? 's' : ''} with those who stay</label>`;
      if (opts && opts.error) h += `<p>${esc(opts.error)}</p>`;
      else if (opts) { const short = opts.sea.filter(o => !o.fits).map(o => S.ships[o.ship]); h += `<p><span class="key"><i class="k-land"></i>five areas on foot</span>${Object.keys(opts.road).length ? '<span class="key"><i class="k-road"></i>any distance by road</span>' : ''}${opts.sea.some(o => o.fits) ? '<span class="key"><i class="k-sea"></i>by ship</span>' : ''}</p>${short.length && !opts.sea.some(o => o.fits) ? `<p><small>The ${esc(short[0].name)} carries only ${short[0].cap} men: select a smaller force to embark.</small></p>` : ''}`; }
      const acts = []; const en = KM.A[f.area].places.filter(pl => E.isFriendly(S, pl, viewer) && f.inside !== pl);
      for (const pl of en) acts.push(`<button class="btn small" data-act="enter" data-place="${pl}">Enter ${esc(KM.P[pl].name)}</button>`);
      if (f.inside) acts.push(`<button class="btn small" data-act="enter" data-place="">Take the field outside</button>`);
      if (S.players[viewer].held.some(id => KM.EVENT[id].type === 'freeMove') && sel.ids.some(id => S.nobles[id].moved && !S.nobles[id].held)) acts.push(`<button class="btn small gilt" data-act="freemove">Play a Free Move</button>`);
      acts.push(`<button class="btn small ghost" data-act="clear">Deselect</button>`);
      h += `<div class="acts">${acts.join('')}</div>`;
    }
    else h = `<h4>March</h4><p>Select one of your forces on the map or in the roll. Its reach lights up: click a lit area or port to send it there.</p>`;
    el.innerHTML = h ? `<div class="traybox">${h}</div>` : '';
  }

  // ================= delegated clicks =================
  function handle(t) {
    const a = t.dataset.act;
    if (a === 'primary') return primary();
    if (a === 'speed') { speed = speed === 1 ? 0.35 : speed === 0.35 ? 0 : 1; return renderTop(); }
    if (a === 'rules') return showRules();
    if (a === 'quit') return modal('<h2>Abandon this war?</h2><p>The saved game will be replaced when you deal a new one.</p>', [{ label: 'Keep playing', cls: 'ghost' }, { label: 'Return to the title', cls: 'gules', fn: () => { S = null; $('#game').hidden = true; $('#setup').hidden = false; renderSetup(); } }]);
    if (a === 'zoom-in') return B.zoom(0.75); if (a === 'zoom-out') return B.zoom(1.33); if (a === 'zoom-fit') return B.fit();
    if (a === 'locate') return B.ping(t.dataset.area);
    if (a === 'expand') { expand[t.dataset.id] = !expand[t.dataset.id]; return renderPanel(); }
    if (a === 'sel') { const loc = { area: t.dataset.area, inside: t.dataset.inside || null }; B.ping(loc.area); if (S.players[viewer].ai) return; return selectLoc(loc); }
    if (a === 'cancel' || a === 'clear') { mode = null; if (a === 'clear') sel = null; return render(); }
    if (a === 'auto') return autoMuster();
    if (!(myTurn() || mustering())) return;
    if (a === 'card') { const cid = t.dataset.card; if (mode && mode.card === cid) mode = null; else { mode = { type: 'card', card: cid }; if (!E.cardTargets(S, viewer, cid).length) { mode = null; toast(KM.CARD[cid].kind === 'title' ? 'A title needs an untitled noble.' : KM.CARD[cid].kind === 'office' ? 'An office needs a titled noble with no office.' : 'You need a noble in play first.'); } } return render(); }
    if (a === 'chip') { const cid = t.dataset.card; if (!E.transferTargets(S, viewer, cid).length) return toast('No other noble of yours stands in the same area to receive it.'); mode = mode && mode.card === cid ? null : { type: 'transfer', card: cid }; return render(); }
    if (a === 'assign') { const m = mode; mode = null; return act(() => m.type === 'transfer' ? E.transfer(S, viewer, m.card, t.dataset.id) : E.playCard(S, viewer, m.card, t.dataset.id)); }
    if (a === 'pick') { const id = t.dataset.id; const i = sel.ids.indexOf(id); if (i >= 0) { if (sel.ids.length > 1) sel.ids.splice(i, 1); } else sel.ids.push(id); return render(); }
    if (a === 'leaveheirs') { leaveHeirs = t.checked; return; }
    if (a === 'enter') return act(() => E.shelter(S, viewer, sel.ids, t.dataset.place || null));
    if (a === 'freemove') return act(() => E.useFreeMove(S, viewer, sel.ids));
    if (a === 'ship') { mode = { type: 'ship', key: t.dataset.key }; sel = null; return render(); }
    if (a === 'attack') return openAttack(E.combatOptions(S, viewer)[+t.dataset.i]);
    if (a === 'crown') { const r = act(() => E.crown(S, viewer, t.dataset.id)); if (r.ok) { B.ping(S.heirs[t.dataset.id].area, '#d2a633'); if (S.winner !== null) showVictory(); } return; }
    if (a === 'exec-heir') { const id = t.dataset.id; return modal(`<h2>Put ${esc(KM.HEIR[id].name)} to death?</h2><p>A dead heir cannot be crowned by anyone. This cannot be undone.</p>`, [{ label: 'Spare the heir', cls: 'ghost' }, { label: 'Execute', cls: 'gules', fn: () => { act(() => E.executeHeir(S, viewer, id)); if (S.winner !== null) showVictory(); } }]); }
    if (a === 'parliament') return openParliament();
  }
  document.addEventListener('click', ev => {
    const tb = ev.target.closest('#tabs button'); if (tb) { tab = tb.dataset.tab; return renderPanel(); }
    const t = ev.target.closest('[data-act]'); if (t && !t.disabled && !t.closest('#modalbox')) handle(t);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { if (!$('#pop').hidden) return hidePop(); if (mode) { mode = null; return render(); } if (sel && $('#modal').hidden) { sel = null; return render(); } }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][data-act]')) { ev.preventDefault(); handle(ev.target); }
  });

  // ================= victory & rules =================
  function showVictory() {
    render(); store.clear(); const w = S.players[S.winner];
    modal(`<div style="text-align:center"><span style="display:inline-block;width:54px;height:66px;background:${w.color};border-radius:4px 4px 27px 27px;border:2px solid #2a2118"></span><h2 style="font-size:40px">${esc(w.name)} is the Kingmaker</h2><p style="margin:8px auto">${esc(S.winText)}</p><p style="margin:8px auto"><small>${S.turn.round} rounds of war.</small></p></div>`, [{ label: 'Look over the field', cls: 'ghost' }, { label: 'Deal a new game', cls: 'gilt', fn: () => { S = null; $('#game').hidden = true; $('#setup').hidden = false; renderSetup(); } }]);
  }
  function showRules() {
    modal(`<div class="rules"><h2>How to play</h2>
<p>You lead a faction of nobles in the Wars of the Roses. Seize the royal heirs of Lancaster and York, see the rivals of your chosen claimant dead, and have the last heir standing crowned while in your keeping.</p>
<h3>Your turn</h3><ul>
<li><b>Event.</b> Draw one card. Plague kills everyone inside the named walls. Raids and revolts call named office-holders and lords away to deal with them, alone and at once. An embassy drags a lone King and his escort to a port.</li>
<li><b>March.</b> Each force moves up to five areas. Entering forest from open country ends the march. A force that starts on a road may instead follow it any distance, but not past a town or castle held by another faction. A ship at the same port can carry a force no stronger than its capacity to any port within two seas.</li>
<li><b>Battle.</b> In an area you share with an enemy in the open, the stronger side may attack. An Event card names the odds needed: at 2 to 1 you win on a little over half the cards, at 4 to 1 on most. Nobles named on the card die if present, win or lose. Forces within walls must be besieged: match the garrison plus the nobles inside and the place falls, unless bad weather intervenes.</li>
<li><b>Court.</b> Crown the senior living heir of a house inside a cathedral city if an escort holds an Archbishop or two Bishops. Summon Parliament to share out what lies in Chancery.</li>
<li><b>Draw.</b> Ending your turn draws one Crown card, to play at any time in a later turn.</li></ul>
<h3>Your faction</h3><ul>
<li>A noble may hold one title and, if titled, one office. These stay with him until death, then return to Chancery.</li>
<li>Mercenaries, towns and ships (dashed chips) may pass between your nobles in the same area. Bishoprics, titles and offices may not.</li>
<li>A noble's castles, the towns of his offices, town cards, and places you take by siege are friendly: your forces may shelter inside, safe from battle but not from plague or siege.</li>
<li>Captured nobles lose their mercenaries, towns and ships to you. Execute them or let them go.</li></ul>
<h3>Parliament</h3><ul>
<li>The faction holding the only crowned monarch may summon it. With no sole King, the Chancellor of England may, by spending a Writ.</li>
<li>Each faction votes in the Commons (the King or Chancellor 20, nobles, towns and cities) and the Lords (senior heirs 10 each, titled nobles, offices, bishops).</li></ul>
<h3>Where this edition departs from the board game</h3><ul>
<li>The map is freshly drawn from real coastlines. Areas, roads and forests follow the geography and the places named on the cards, not the printed board square for square.</li>
<li>Ships sail from port to port and never end a turn at sea, so storms simply keep fleets in harbour for a turn.</li>
<li>Parliament votes without moving the nobles to the meeting. Alliances, ransoms and trades between players are left to the table.</li>
<li>Battle results are a reconstruction: the odds are distributed as in the original deck, but which nobles each card dooms is this edition's own.</li></ul></div>`, [{ label: 'Close', cls: 'gilt' }], { wide: true });
  }

  renderSetup();
  KM.UI = { get state() { return S; }, render, startGame, cfg, debug: { aiParliament } };
})();
