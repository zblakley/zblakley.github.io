/* Kingmaker — the map: static cartography, pieces, highlights, pan & zoom. */
(function () {
  const KM = (globalThis.KM = globalThis.KM || {});
  const B = (KM.Board = {});
  const H = () => KM.H, E = () => KM.Engine;
  let svg, L = {}, on = {}, vb, full, drag = null, moved = false, hlState = {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function smooth(pts) { if (pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join('L'); let d = 'M' + pts[0].join(' '); for (let i = 1; i < pts.length - 1; i++) d += `Q${pts[i].join(' ')} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`; return d + 'L' + pts[pts.length - 1].join(' '); }

  B.mount = function (el, handlers) {
    on = handlers; const M = KM.MAP; E().init();
    full = { x: -20, y: -20, w: M.w + 40, h: M.h + 40 }; vb = Object.assign({}, full);
    let s = `<svg id="board" xmlns="http://www.w3.org/2000/svg" viewBox="${full.x} ${full.y} ${full.w} ${full.h}" preserveAspectRatio="xMidYMid meet" tabindex="0" aria-label="Map of England and Wales">
<defs>
<pattern id="pSea" width="46" height="22" patternUnits="userSpaceOnUse"><path d="M2 12q6-6 12 0t12 0" fill="none" stroke="#7fa3ab" stroke-width=".8" opacity=".5"/></pattern>
<pattern id="pWood" width="22" height="20" patternUnits="userSpaceOnUse"><path d="M6 14l4-9 4 9zM10 14v3M15 19l3-7 3 7zM-4 19l3-7 3 7z" fill="#5c8251" stroke="#34512f" stroke-width=".6" opacity=".75"/></pattern>
<filter id="fGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .15  0 0 0 .09 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
<rect x="-400" y="-400" width="${M.w + 800}" height="${M.h + 800}" fill="#a9c6c9"/><rect x="-400" y="-400" width="${M.w + 800}" height="${M.h + 800}" fill="url(#pSea)"/>
<g class="far"><path d="${M.land.other}"/></g><g id="lSeas">${M.seas.map(z => `<path class="seasq" data-area="${z.id}" d="${z.d}"/>`).join('')}</g>
<path class="wash" d="${M.land.england}"/>
<g id="lAreas">`;
    for (const a of M.areas) if (a.d) s += `<path class="area ${a.terrain} r-${a.region}" data-area="${a.id}" d="${a.d}"/>`;
    s += `</g><g class="woods">`;
    for (const a of M.areas) if (a.d && a.terrain === 'forest') s += `<path d="${a.d}" fill="url(#pWood)"/>`;
    s += `</g><path class="grain" d="${M.land.england}" filter="url(#fGrain)"/><path class="coast" d="${M.land.england}"/><g id="lRoads">`;
    for (const r of M.roads) s += `<path class="road" d="${smooth(r.pts)}"><title>${esc(r.name)}</title></path>`;
    for (const k of Object.keys(M.borders || {})) s += `<path class="border" d="M${M.borders[k].map(p => p.join(' ')).join('L')}"/>`;
    s += `</g><g id="lLabels">`;
    for (const l of M.labels) s += `<text class="${l.kind === 'land' ? 'landname' : 'realm'}" x="${l.x}" y="${l.y}" font-size="${l.size}">${esc(l.text)}</text>`;
    for (const a of M.areas) if (a.name && !a.places.length && !a.special) s += `<text class="areaname" x="${a.c[0]}" y="${a.c[1] + (a.terrain === 'forest' ? 3 : 3)}">${esc(a.name)}</text>`;
    s += `</g><g id="lHi"></g><g id="lPlaces">`;
    for (const p of M.places) {
      const below = p.type === 'city' ? 31 : 25; const lord = p.type === 'castle' ? KM.CARDS.nobles.find(n => n.castles.includes(p.id)) : null;
      const tip = `${p.name} — ${p.type === 'castle' && lord ? 'castle of ' + lord.name : { city: 'city', town: 'walled town', open: 'open town', royal: 'royal castle', castle: 'castle' }[p.type]}${p.garrison ? ', garrison ' + p.garrison : ''}${p.cathedral ? ', cathedral' : ''}${p.port ? ', port' : ''}`;
      s += `<g class="place t-${p.type}" data-place="${p.id}" transform="translate(${p.x} ${p.y})"><title>${esc(tip)}</title><circle class="own" r="${p.type === 'city' ? 18 : 15}"/>${p.port ? `<g transform="translate(${p.type === 'city' ? 17 : 13} ${-12}) scale(1.15)">${H().anchorInner}</g>` : ''}<g class="sym" transform="scale(1.35)">${H().placeInner(p)}</g><text class="pname" y="${below}">${esc(p.name)}</text></g>`;
    }
    s += `</g><g id="lPieces"></g><g id="lFx"></g></svg>`;
    el.innerHTML = s; svg = el.querySelector('svg');
    for (const k of ['lAreas', 'lHi', 'lPlaces', 'lPieces', 'lFx']) L[k] = svg.querySelector('#' + k);
    wire(el);
  };

  // ---------- pan & zoom ----------
  function setVB() { svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); svg.classList.toggle('zoomed', vb.w < full.w * 0.62); svg.classList.toggle('far-out', vb.w > full.w * 0.9); }
  function pt(ev) { const r = svg.getBoundingClientRect(); const sc = Math.max(vb.w / r.width, vb.h / r.height); const ox = (r.width - vb.w / sc) / 2, oy = (r.height - vb.h / sc) / 2; return { x: vb.x + (ev.clientX - r.left - ox) * sc, y: vb.y + (ev.clientY - r.top - oy) * sc, sc }; }
  function clamp() { vb.w = Math.min(full.w, Math.max(240, vb.w)); vb.h = vb.w * full.h / full.w; vb.x = Math.min(full.x + full.w - vb.w * 0.3, Math.max(full.x - vb.w * 0.7, vb.x)); vb.y = Math.min(full.y + full.h - vb.h * 0.3, Math.max(full.y - vb.h * 0.7, vb.y)); }
  B.zoom = function (f, cx, cy) { if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; } const nw = Math.min(full.w, Math.max(240, vb.w * f)); const k = nw / vb.w; vb.x = cx - (cx - vb.x) * k; vb.y = cy - (cy - vb.y) * k; vb.w = nw; clamp(); if (vb.w >= full.w) vb = Object.assign({}, full); setVB(); };
  B.fit = function () { vb = Object.assign({}, full); setVB(); };
  function wire(el) {
    svg.addEventListener('wheel', ev => { ev.preventDefault(); const p = pt(ev); B.zoom(ev.deltaY > 0 ? 1.18 : 0.85, p.x, p.y); }, { passive: false });
    svg.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; drag = { x: ev.clientX, y: ev.clientY, vx: vb.x, vy: vb.y }; moved = false; });
    window.addEventListener('pointermove', ev => { if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!moved && Math.hypot(dx, dy) < 5) return; moved = true; const sc = pt(ev).sc; vb.x = drag.vx - dx * sc; vb.y = drag.vy - dy * sc; clamp(); setVB(); svg.classList.add('dragging'); });
    window.addEventListener('pointerup', () => { drag = null; svg.classList.remove('dragging'); });
    svg.addEventListener('click', ev => {
      if (moved) { moved = false; return; }
      const t = ev.target.closest('[data-tok],[data-ship],[data-place],[data-area]'); if (!t) { on.onNothing && on.onNothing(); return; }
      if (t.dataset.tok) on.onToken && on.onToken(JSON.parse(t.dataset.tok), ev);
      else if (t.dataset.ship) on.onShip && on.onShip(t.dataset.ship, ev);
      else if (t.dataset.place) on.onPlace && on.onPlace(t.dataset.place, ev);
      else on.onArea && on.onArea(t.dataset.area, ev);
    });
    svg.addEventListener('keydown', ev => { const k = ev.key; if (k === '+' || k === '=') B.zoom(0.8); else if (k === '-') B.zoom(1.25); else if (k === '0') B.fit(); else if (k.startsWith('Arrow')) { const d = vb.w * 0.12; if (k === 'ArrowLeft') vb.x -= d; if (k === 'ArrowRight') vb.x += d; if (k === 'ArrowUp') vb.y -= d; if (k === 'ArrowDown') vb.y += d; clamp(); setVB(); ev.preventDefault(); } });
  }
  B.center = function (areaId, force) {
    const a = KM.A[areaId]; if (!a) return; const [x, y] = a.c;
    const inView = x > vb.x + vb.w * 0.12 && x < vb.x + vb.w * 0.88 && y > vb.y + vb.h * 0.12 && y < vb.y + vb.h * 0.88;
    if (!inView || force) { vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; clamp(); setVB(); }
  };
  B.ping = function (areaId, color) {
    const a = KM.A[areaId]; if (!a) return; B.center(areaId);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); g.setAttribute('cx', a.c[0]); g.setAttribute('cy', a.c[1]); g.setAttribute('r', 10); g.setAttribute('class', 'ping'); if (color) g.style.stroke = color;
    L.lFx.appendChild(g); setTimeout(() => g.remove(), 1500);
  };
  B.flashPath = function (ids, color) {
    if (!ids || ids.length < 2) return; const pts = ids.map(id => KM.A[id].c);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', smooth(pts)); p.setAttribute('class', 'trail'); if (color) p.style.stroke = color;
    L.lFx.appendChild(p); setTimeout(() => p.remove(), 2600);
  };

  // ---------- highlights ----------
  // h: {areas:{id:'land'|'road'}, ports:{placeId:'ok'|'siege'|'full'}, places:[ids], attacks:{areaId:true}, sel:{area}}
  B.highlight = function (h) {
    hlState = h || {}; let s = '';
    for (const [id, kind] of Object.entries(hlState.areas || {})) { const a = KM.A[id]; s += a.d ? `<path class="hl ${kind}" data-area="${id}" d="${a.d}"/>` : `<circle class="hl ${kind}" data-area="${id}" cx="${a.c[0]}" cy="${a.c[1]}" r="${id === 'scotland' ? 46 : 40}"/>`; }
    if (hlState.sel) { const a = KM.A[hlState.sel.area]; s += a.d ? `<path class="hl sel" d="${a.d}"/>` : `<circle class="hl sel" cx="${a.c[0]}" cy="${a.c[1]}" r="40"/>`; }
    for (const [pid, kind] of Object.entries(hlState.ports || {})) { const p = KM.P[pid]; s += `<circle class="hl port ${kind}" data-place="${pid}" cx="${p.x}" cy="${p.y}" r="24"/>`; }
    for (const pid of hlState.places || []) { const p = KM.P[pid]; s += `<circle class="hl pick" data-place="${pid}" cx="${p.x}" cy="${p.y}" r="26"/>`; }
    for (const id of Object.keys(hlState.attacks || {})) { const a = KM.A[id]; s += `<g class="hl atk" data-area="${id}" transform="translate(${a.c[0]} ${a.c[1] - 44}) scale(1.5)"><circle r="11"/><path d="M-5-5l10 10M5-5L-5 5" /></g>`; }
    L.lHi.innerHTML = s;
  };

  // ---------- pieces ----------
  B.render = function (s, viewer) {
    if (!svg) return; const En = E(); let out = '';
    // ownership rings
    for (const el of L.lPlaces.querySelectorAll('.place')) {
      const pid = el.dataset.place; const o = En.fortified(pid) ? En.placeOwner(s, pid) : null; const ring = el.querySelector('.own');
      ring.style.stroke = o === null ? 'none' : s.players[o].color; el.classList.toggle('mine', o !== null && o === viewer);
      if (KM.P[pid].type === 'castle') { const sym = el.querySelector('.sym path'); if (sym) sym.setAttribute('fill', o === null ? '#6f675c' : s.players[o].color); }
    }
    // gather forces
    const groups = {};
    for (const n of Object.values(s.nobles)) { const k = n.area + '|' + (n.inside || '') + '|' + n.owner + '|' + (n.ship || ''); (groups[k] = groups[k] || { area: n.area, inside: n.inside, ship: n.ship || null, owner: n.owner, nobles: [], heirs: [] }).nobles.push(n); }
    for (const h of En.aliveHeirs(s)) { const k = h.area + '|' + (h.inside || '') + '|' + (h.ctrl === null ? 'x' : h.ctrl) + '|' + (h.ship || ''); (groups[k] = groups[k] || { area: h.area, inside: h.inside, ship: h.ship || null, owner: h.ctrl, nobles: [], heirs: [] }).heirs.push(h); }
    const byArea = {}; for (const g of Object.values(groups)) (byArea[g.area] = byArea[g.area] || []).push(g);
    const cur = s.turn.player, phase = s.turn.phase;
    for (const [aid, gs] of Object.entries(byArea)) {
      const a = KM.A[aid]; const open = gs.filter(g => !g.inside); const places = a.places.map(p => KM.P[p]);
      let cx = a.c[0], cy = a.c[1];
      if (places.some(p => Math.hypot(p.x - cx, p.y - cy) < 34)) { cy += 44; if (places.some(p => Math.hypot(p.x - cx, p.y - cy) < 30)) { cy -= 44; cx -= 44; } }
      open.forEach((g, i) => { g.x = cx + (i - (open.length - 1) / 2) * 42; g.y = cy; });
      const perPlace = {};
      for (const g of gs.filter(g => g.inside)) { const p = KM.P[g.inside]; const i = (perPlace[g.inside] = (perPlace[g.inside] || 0) + 1) - 1; g.x = p.x - 26 - i * 38; g.y = p.y - 22; }
      for (const g of gs) out += token(s, g, viewer, cur, phase);
    }
    // ships in harbour
    const perLoc = {};
    for (const sh of Object.values(s.ships)) {
      const o = En.shipOwner(s, sh); if (o === null) continue;
      const atSea = !KM.P[sh.loc]; const base = atSea ? { x: KM.SEA[sh.loc].c[0], y: KM.SEA[sh.loc].c[1] - 34 } : { x: KM.P[sh.loc].x + 23, y: KM.P[sh.loc].y + 12 };
      const i = (perLoc[sh.loc] = (perLoc[sh.loc] || 0) + 1) - 1; const cargo = En.shipCargo(s, sh.key);
      out += `<g class="shiptok${sh.used ? ' used' : ''}${atSea ? ' atsea' : ''}" data-ship="${sh.key}" transform="translate(${base.x + i * 16} ${base.y}) scale(${atSea ? 1.9 : 1.35})"><title>${esc(sh.name)}: carries ${sh.cap}, ${esc(s.players[o].name)}${cargo.length ? '. Aboard: ' + esc(cargo.map(n => KM.CARD[n.id].name).join(', ')) : ''}${atSea ? ', at sea' : ', in ' + esc(KM.P[sh.loc].name)}</title>${H().shipInner(s.players[o].color)}</g>`;
    }
    L.lPieces.innerHTML = out;
  };
  function token(s, g, viewer, cur, phase) {
    const En = E(); const data = esc(JSON.stringify({ area: g.area, inside: g.inside || null, ship: g.ship || null, owner: g.owner }));
    if (!g.nobles.length) { // unescorted heirs
      let o = `<g class="tok loose" data-tok="${data}" transform="translate(${g.inside ? KM.P[g.inside].x - 24 : g.x} ${g.inside ? KM.P[g.inside].y - 22 : g.y}) scale(1.45)">`;
      g.heirs.forEach((h, i) => { const hh = KM.HEIR[h.id]; o += `<g transform="translate(${-i * 13} ${-i * 3})"><title>${esc(hh.name)} — unescorted${h.crowned ? ', crowned' : ''}</title><circle r="9" class="loosebase"/><g transform="scale(.62)">${H().roseInner(hh.house, h.crowned)}</g></g>`; });
      return o + '</g>';
    }
    const pl = s.players[g.owner]; const str = En.stackStrength(s, g.nobles); const leadN = g.nobles.slice().sort((a, b) => En.strength(s, b) - En.strength(s, a))[0];
    const ready = g.owner === cur && g.owner === viewer && ((phase === 'move' && g.nobles.some(n => En.canMove(s, n))) || (phase === 'combat' && g.nobles.some(n => !n.fought)));
    const names = g.nobles.map(n => KM.CARD[n.id].name).join(', ');
    let o = `<g class="tok${ready ? ' ready' : ''}${g.inside ? ' inside' : ''}" data-tok="${data}" transform="translate(${g.x} ${g.y}) scale(1.45)"><title>${esc(pl.name)}: ${esc(names)} — ${str} men${g.inside ? ' within ' + esc(KM.P[g.inside].name) : ''}</title>`;
    if (ready) o += `<circle r="17" class="readyring"/>`;
    if (g.inside) o += `<circle r="14.6" class="wallring"/>`;
    o += `<circle r="12.4" fill="${pl.color}" class="base"/><svg x="-7.6" y="-10" width="15.2" height="18.2" viewBox="0 0 100 120">${H().shieldInner(KM.CARD[leadN.id].arms)}</svg>`;
    o += `<g transform="translate(0 15.5)"><rect x="-13" y="-6" width="26" height="11.5" rx="5.5" class="pill"/><text class="str" y="3">${str}</text></g>`;
    if (g.nobles.length > 1) o += `<g transform="translate(-11.5 -10)"><circle r="6" class="cnt"/><text class="cntt" y="3">${g.nobles.length}</text></g>`;
    g.heirs.forEach((h, i) => { const hh = KM.HEIR[h.id]; o += `<g transform="translate(${12 + i * 10} ${-11}) scale(.6)"><title>${esc(hh.name)}${h.crowned ? ' — crowned' : ''}</title><circle r="11" class="heirbase"/>${H().roseInner(hh.house, h.crowned)}</g>`; });
    return o + '</g>';
  }
})();
