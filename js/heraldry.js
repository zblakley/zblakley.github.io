/* Kingmaker — heraldic drawing: coats of arms, roses, map symbols. All original SVG. */
(function () {
  const KM = (globalThis.KM = globalThis.KM || {});
  const H = (KM.H = {});
  const T = { or: '#d8a928', argent: '#f3eee1', gules: '#a4232a', azure: '#1f4d94', sable: '#1f1c1a', vert: '#2f6d3e' };
  H.tinct = T;
  const SHIELD = 'M4 4H96V56C96 88 72 106 50 116C28 106 4 88 4 56Z';
  let uid = 0;
  const lay = {
    3: [[30, 34], [70, 34], [50, 76]], chief: [[26, 20], [50, 20], [74, 20]], fess3: [[30, 24], [70, 24], [50, 92]], bend: [[27, 27], [50, 55], [73, 83]],
    quarters: [[24, 26], [76, 26], [27, 80], [73, 80]], bendsides: [[72, 28], [28, 84]], 1: [[50, 56]], 2: [[32, 50], [68, 50]], 4: [[30, 30], [70, 30], [30, 74], [70, 74]]
  };
  function lion(col, x, y, s) {
    return `<g transform="translate(${x} ${y}) scale(${s}) translate(-50 -58)" stroke="${col}" stroke-linecap="round" fill="none">` +
      `<path d="M40 82L58 44" stroke-width="17"/><circle cx="63" cy="31" r="10" fill="${col}" stroke="none"/><path d="M70 30l9 3-7 5z" fill="${col}" stroke="none"/>` +
      `<path d="M58 46l20-7M52 58l21 2M41 80l-9 18M46 78l14 15" stroke-width="6.5"/><path d="M78 39l4-5M73 60l5 2M32 98l-6 1M60 93l6-1" stroke-width="5"/>` +
      `<path d="M37 78C16 70 17 44 28 38c6-3 10 3 5 8" stroke-width="4.5"/></g>`;
  }
  function charge(c, x, y, small) {
    const col = T[c.col], k = (small ? 0.72 : 1) * (c.s || 1);
    switch (c.t) {
      case 'lion': return lion(col, x, y + 2, 1.05 * (c.s || 1));
      case 'roundel': return `<circle cx="${x}" cy="${y}" r="${9.5 * k}" fill="${col}" stroke="#0005" stroke-width="1"/>`;
      case 'annulet': return `<circle cx="${x}" cy="${y}" r="${8.5 * k}" fill="none" stroke="${col}" stroke-width="${4.5 * k}"/>`;
      case 'crosslet': return `<path d="M${x - 8 * k} ${y}h${16 * k}M${x} ${y - 8 * k}v${16 * k}" stroke="${col}" stroke-width="${4.5 * k}"/>`;
      case 'bouget': return `<path d="M${x - 9} ${y - 7}q0 14 5 14q4 0 4-9q0 9 4 9q5 0 5-14" fill="none" stroke="${col}" stroke-width="4.5" stroke-linecap="round"/><path d="M${x - 11} ${y - 8}h22" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>`;
      case 'maunch': return `<path d="M30 30h34l10 12v44l-14-8v-26l-12 8h-18z" fill="${col}"/>`;
      case 'bar': return `<rect x="${x - 22}" y="${y - 5}" width="44" height="10" rx="5" fill="${col}"/>`;
    }
    return '';
  }
  function field(f) {
    if (typeof f === 'string') return `<rect width="100" height="120" fill="${T[f]}"/>`;
    const [a, b] = f.cols.map(c => T[c]); let s = `<rect width="100" height="120" fill="${a}"/>`;
    if (f.t === 'barry') { const h = 112 / f.n; for (let i = 1; i < f.n; i += 2) s += `<rect y="${4 + i * h}" width="100" height="${h}" fill="${b}"/>`; }
    else if (f.t === 'chequy') { for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2) s += `<rect x="${c * 16.7}" y="${r * 17.2}" width="16.7" height="17.2" fill="${b}"/>`; }
    else if (f.t === 'perpale') s += `<rect x="50" width="50" height="120" fill="${b}"/>`;
    else if (f.t === 'quarterly') s += `<rect x="50" width="50" height="58" fill="${b}"/><rect y="58" width="50" height="62" fill="${b}"/>`;
    else if (f.t === 'fretty') { for (let k = -120; k < 220; k += 26) s += `<path d="M${k} 0l120 120M${k + 120} 0l-120 120" stroke="${b}" stroke-width="5"/>`; }
    return s;
  }
  function ordinary(o) {
    const c = T[o.col];
    switch (o.t) {
      case 'fess': return `<rect y="42" width="100" height="28" fill="${c}"/>`;
      case 'chief': return `<rect width="100" height="34" fill="${c}"/>`;
      case 'bend': return `<path d="M0 0H20L100 96V120H84L0 22Z" fill="${c}"/>`;
      case 'saltire': return `<path d="M4 4L96 108M96 4L4 108" stroke="${c}" stroke-width="20"/>`;
      case 'cross': return `<path d="M50 0V120M0 52H100" stroke="${c}" stroke-width="20"/>`;
      case 'chevron': return `<path d="M2 96L50 46L98 96" fill="none" stroke="${c}" stroke-width="20" stroke-linejoin="miter"/>`;
      case 'bordure': return `<path d="${SHIELD}" fill="none" stroke="${c}" stroke-width="24"/>`;
    }
    return '';
  }
  // inner markup for a 100x120 shield (no <svg> wrapper)
  H.shieldInner = function (arms) {
    const id = 'ksh' + (++uid); let s = `<clipPath id="${id}"><path d="${SHIELD}"/></clipPath><g clip-path="url(#${id})">` + field(arms.f);
    for (const o of arms.o || []) if (o.t !== 'chief') s += ordinary(o);
    for (const c of arms.c || []) { const pts = lay[c.lay] || lay[c.n || 1]; const small = c.lay === 'chief' || c.lay === 'bend' || c.lay === 'quarters' || c.lay === 'bendsides'; if (c.t === 'maunch' || (c.t === 'lion')) s += charge(c, 50, 56); else pts.forEach(p => { s += charge(c, p[0], p[1], small); }); }
    for (const o of arms.o || []) if (o.t === 'chief') s += ordinary(o);
    return s + `</g><path d="${SHIELD}" fill="none" stroke="#2a2118" stroke-width="4"/>`;
  };
  H.shield = (arms, size, cls) => `<svg class="shield ${cls || ''}" width="${size}" height="${size * 1.2}" viewBox="0 0 100 120" aria-hidden="true">${H.shieldInner(arms)}</svg>`;
  H.nobleShield = (id, size, cls) => H.shield(KM.CARD[id].arms, size, cls);

  // five-petalled rose, centred on 0,0, radius ~10
  H.roseInner = function (house, crowned) {
    const col = house === 'lancaster' ? '#b3202a' : '#f6f2e6', edge = house === 'lancaster' ? '#5d0f14' : '#7a7466';
    let s = ''; for (let i = 0; i < 5; i++) { const a = (i * 72 - 90) * Math.PI / 180; s += `<circle cx="${(Math.cos(a) * 5.6).toFixed(2)}" cy="${(Math.sin(a) * 5.6).toFixed(2)}" r="4.9" fill="${col}" stroke="${edge}" stroke-width=".9"/>`; }
    s += `<circle r="2.6" fill="#d8a928" stroke="#7a5a10" stroke-width=".7"/>`;
    if (crowned) s += `<path d="M-7-10.5l2.2-6 2.4 4L0-18l2.4 5.5 2.4-4 2.2 6z" fill="#e7bb3a" stroke="#6b4d0c" stroke-width=".9" stroke-linejoin="round"/>`;
    return s;
  };
  H.rose = (house, size, crowned) => `<svg class="rose" width="${size}" height="${size * 1.25}" viewBox="-12 -19 24 31" aria-hidden="true">${H.roseInner(house, crowned)}</svg>`;

  // map symbols, centred on 0,0
  const TOWER = 'M-5.5 6.5V-3.5h-1.5V-8h3v2.2h2.4V-8h3.2v2.2h2.4V-8h3v4.5h-1.5V6.5Z';
  H.placeInner = function (pl, ownerColor) {
    let s = '';
    if (pl.type === 'city') s = `<circle r="8.6" fill="#f3eee1" stroke="#2a2118" stroke-width="1.3"/><circle r="5.6" fill="#a4232a" stroke="#2a2118" stroke-width="1"/>` + [0, 90, 180, 270].map(a => `<rect x="-2" y="-10.6" width="4" height="4.2" fill="#f3eee1" stroke="#2a2118" stroke-width=".9" transform="rotate(${a})"/>`).join('');
    else if (pl.type === 'town') s = `<path d="M-6.5 6V-4.5h2.6v2h2.6v-2h2.6v2h2.6v-2h2.6V6Z" fill="#b5482f" stroke="#2a2118" stroke-width="1.2" stroke-linejoin="round"/>`;
    else if (pl.type === 'open') s = `<circle r="4" fill="#f3eee1" stroke="#2a2118" stroke-width="1.4"/><circle r="1.2" fill="#2a2118"/>`;
    else if (pl.type === 'royal') s = `<path d="${TOWER}" fill="#5a3e8e" stroke="#2a2118" stroke-width="1.1" stroke-linejoin="round"/><path d="M-3.4-10.2l1.2-3 2.2 2 2.2-2 1.2 3z" fill="#e7bb3a" stroke="#6b4d0c" stroke-width=".6"/>`;
    else s = `<path d="${TOWER}" fill="${ownerColor || '#6f675c'}" stroke="#2a2118" stroke-width="1.1" stroke-linejoin="round"/><rect x="-1.4" y="1" width="2.8" height="5.5" fill="#2a2118"/>`;
    if (pl.cathedral) s += `<path d="M0-${pl.type === 'city' ? 19 : 14}v7M-2.6-${pl.type === 'city' ? 16.4 : 11.4}h5.2" stroke="#2a2118" stroke-width="1.5" stroke-linecap="round"/>`;
    return s;
  };
  H.anchorInner = `<circle r="5.2" fill="#e9f1f1" stroke="#24566b" stroke-width="1"/><path d="M0-3.2v6M-2-1.6h4M-3 1.2q3 3.4 6 0" fill="none" stroke="#24566b" stroke-width="1.1" stroke-linecap="round"/>`;
  H.shipInner = (col) => `<path d="M-7 1h14l-2.6 4.4h-8.8z" fill="${col}" stroke="#1b1a18" stroke-width=".9" stroke-linejoin="round"/><path d="M0 1v-9M0-8q5 2.5 5 6.5h-5" fill="#f3eee1" stroke="#1b1a18" stroke-width=".9" stroke-linejoin="round"/>`;
  H.icon = function (name, size) {
    const P = {
      swords: '<path d="M4 4l11 11M20 4L9 15M6 17l3-3M18 17l-3-3M4 20l3-3M20 20l-3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      crown: '<path d="M3 18l1.5-10 4.5 5 3-8 3 8 4.5-5L21 18z" fill="currentColor"/>',
      anchor: '<path d="M12 6v14M8 9h8M5 14q7 9 14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
      lock: '<rect x="6" y="11" width="12" height="9" rx="1.5" fill="currentColor"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
      swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      tower: '<path d="M6 21V10H4.5V4h3v2.5h3V4h3v2.5h3V4h3v6H18v11z" fill="currentColor"/>',
      march: '<path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      scroll: '<path d="M7 4h11v13a3 3 0 01-3 3H6a2.5 2.5 0 010-5h8V4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      mitre: '<path d="M6 20V11l6-8 6 8v9zM12 3v17M6 15h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      pike: '<path d="M5 21L17 5M15 3l4 2-2 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'
    };
    return `<svg class="ico" width="${size || 14}" height="${size || 14}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  };
})();
