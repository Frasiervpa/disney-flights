// ── Flight Tracker ────────────────────────────────────────────────────────

const DATA_URL = 'data/flights.json';
let allRoutes     = [];
let activeFilter  = 'all';
let activeOrigin  = 'all';
let activeGroup   = 'all';
let activeAirline = 'all';
let stopsFilter   = 'all'; // 'all' | 'nonstop' | 'layover'

const PRICE_LOW  = 300;
const PRICE_HIGH = 550;

function priceClass(p) {
  if (!p) return '';
  return p <= PRICE_LOW ? 'price-low' : p <= PRICE_HIGH ? 'price-mid' : 'price-high';
}
function fmt(p) { return p ? '$' + p.toLocaleString() : null; }
function typeClass(t) { return 'type-' + t.toLowerCase().replace(/[^a-z0-9]/g, '-'); }

// Normalize a snapshot to { price, airline, stops, nonstopPrice, nonstopAirline }
// Handles both old { date, price } and new { date, nonstop, cheapest } formats.
function normSnap(s) {
  if (!s) return null;
  // New format
  if (s.cheapest || s.nonstop) {
    const ch = s.cheapest || {};
    const ns = s.nonstop   || {};
    return {
      date:           s.date,
      price:          ch.price   || null,
      airline:        ch.airline || '',
      stops:          ch.stops   != null ? ch.stops : null,
      nonstopPrice:   ns.price   || null,
      nonstopAirline: ns.airline || '',
    };
  }
  // Legacy format
  if (s.price) return { date: s.date, price: s.price, airline: '', stops: null, nonstopPrice: null, nonstopAirline: '' };
  return null;
}

function latestPrice(r) {
  const s = r.snapshots.map(normSnap).filter(x => x && x.price);
  return s.length ? s[s.length - 1] : null;
}
function latestNonstop(r) {
  const s = r.snapshots.map(normSnap).filter(x => x && x.nonstopPrice);
  return s.length ? s[s.length - 1] : null;
}
function low7(r) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const s = r.snapshots.map(normSnap).filter(x => x && x.price && new Date(x.date) >= cutoff);
  return s.length ? Math.min(...s.map(x => x.price)) : null;
}
function allTimeLow(r) {
  const p = r.snapshots.map(normSnap).filter(x => x && x.price).map(x => x.price);
  return p.length ? Math.min(...p) : null;
}
function trend(r) {
  const s = r.snapshots.map(normSnap).filter(x => x && x.price);
  if (s.length < 2) return null;
  const d = s[s.length-1].price - s[s.length-2].price;
  return d < 0 ? 'down' : d > 0 ? 'up' : 'flat';
}
function renderSparkline(r) {
  const s = r.snapshots.map(normSnap).filter(x => x && x.price).slice(-14);
  if (s.length < 2) return `<span class="spark-none">—</span>`;
  const max = Math.max(...s.map(x => x.price));
  const min = Math.min(...s.map(x => x.price));
  const range = max - min || 1;
  return `<div class="sparkline">${s.map((x,i) => {
    const h = Math.max(3, Math.round(((x.price-min)/range)*24+2));
    return `<div class="spark-bar${i===s.length-1?' spark-latest':''}" style="height:${h}px" title="${x.date}: $${x.price}"></div>`;
  }).join('')}</div>`;
}
function renderTrend(r) {
  const t = trend(r);
  if (!t) return `<span class="trend-none">—</span>`;
  if (t==='down') return `<span class="trend-down" title="Price dropped">↓</span>`;
  if (t==='up')   return `<span class="trend-up" title="Price rose">↑</span>`;
  return `<span class="trend-flat" title="No change">→</span>`;
}
function stopsLabel(stops) {
  if (stops === null || stops === undefined) return '';
  if (stops === 0) return '<span class="stops-badge stops-0">Nonstop</span>';
  if (stops === 1) return '<span class="stops-badge stops-1">1 stop</span>';
  return `<span class="stops-badge stops-n">${stops} stops</span>`;
}

// ── URL builder (mirrors Python scraper logic in JS) ──────────────────────

const KG = {
  SLC: { id: '/m/0f2r6', type: 2 },
  PVU: { id: '/m/0l39b', type: 3 },
  ORL: { id: '/m/0ply0', type: 3 },
};

function buildFlightsUrl(depart, ret, originKey) {
  const o = KG[originKey], d = KG.ORL;
  function enc(s) { return new TextEncoder().encode(s); }
  function dateField(s) { const b=enc(s); return new Uint8Array([0x12,b.length,...b]); }
  function place(tag, tv, id) {
    const b=enc(id), inner=new Uint8Array([0x08,tv,0x12,b.length,...b]);
    return new Uint8Array([tag,inner.length,...inner]);
  }
  function leg(date, oid, ot, did, dt) {
    const c=new Uint8Array([...dateField(date),...place(0x6a,ot,oid),...place(0x72,dt,did)]);
    return new Uint8Array([0x1a,c.length,...c]);
  }
  const raw = new Uint8Array([
    0x08,0x1c,0x10,0x02,
    ...leg(depart, o.id, o.type, d.id, d.type),
    ...leg(ret,    d.id, d.type, o.id, o.type),
    0x40,0x01,0x48,0x01,0x70,0x01,0x82,0x01,0x0b,
    0x08,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x01,0x98,0x01,0x01,
  ]);
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `https://www.google.com/travel/flights/search?tfs=${b64}&hl=en&curr=USD`;
}

// ── Row rendering ─────────────────────────────────────────────────────────

function routeAirlines(r) {
  // Returns set of airlines mentioned in latest snapshot
  const latest  = latestPrice(r);
  const nonstop = latestNonstop(r);
  const set = new Set();
  if (latest  && latest.airline)  set.add(latest.airline);
  if (nonstop && nonstop.nonstopAirline) set.add(nonstop.nonstopAirline);
  return set;
}

function isHidden(r) {
  if (activeGroup  !== 'all' && r.group  !== activeGroup)  return true;
  if (activeOrigin !== 'all' && r.origin !== activeOrigin) return true;
  if (activeFilter !== 'all' && r.type   !== activeFilter) return true;
  if (stopsFilter === 'nonstop' && !latestNonstop(r))      return true;
  if (stopsFilter === 'layover' && !latestPrice(r))        return true;
  if (stopsFilter === 'layover') {
    const ch = latestPrice(r);
    if (ch && ch.stops === 0) return true; // cheapest is nonstop — not a layover route
  }
  if (activeAirline !== 'all') {
    const airlines = routeAirlines(r);
    if (!airlines.has(activeAirline)) return true;
  }
  return false;
}

// Top 3 cheapest visible routes — returns [{id, rank}]
function topPicks() {
  const visible = allRoutes.filter(r => !isHidden(r));
  const useNs = stopsFilter === 'nonstop';
  const withPrice = visible.map(r => {
    const snap = useNs ? latestNonstop(r) : latestPrice(r);
    const price = snap ? (useNs ? snap.nonstopPrice : snap.price) : null;
    return { r, price };
  }).filter(x => x.price);
  withPrice.sort((a, b) => a.price - b.price);
  return withPrice.slice(0, 3).map((x, i) => ({ id: x.r.id, rank: i + 1 }));
}

// Sort routes so top picks appear first, hidden last
function sortedRoutes() {
  const picks = topPicks();
  const pickIds = picks.map(p => p.id);
  const tops    = pickIds.map(id => allRoutes.find(r => r.id === id)).filter(Boolean);
  const rest    = allRoutes.filter(r => !pickIds.includes(r.id));
  return [...tops, ...rest];
}

function groupColor(group) {
  // Deterministic pastel color from group name
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360}, 55%, 88%)`;
}
function groupTextColor(group) {
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360}, 45%, 30%)`;
}

function renderRow(r) {
  const latest   = latestPrice(r);
  const nonstop  = latestNonstop(r);
  const l7       = low7(r);
  const atl      = allTimeLow(r);
  const bookUrl  = buildFlightsUrl(r.depart, r.return, r.origin);

  // Nonstop column
  const nsCell = nonstop
    ? `<div class="price-val ${priceClass(nonstop.nonstopPrice)}">${fmt(nonstop.nonstopPrice)}</div>
       ${nonstop.nonstopAirline ? `<div class="airline-label">${nonstop.nonstopAirline}</div>` : ''}`
    : `<div class="price-none">—</div>`;

  // Best deal column (cheapest, may have stops)
  const bdCell = latest
    ? `<div class="price-val ${priceClass(latest.price)}">${fmt(latest.price)}</div>
       ${latest.airline ? `<div class="airline-label">${latest.airline}</div>` : ''}
       ${stopsLabel(latest.stops)}
       <a class="book-btn" href="${bookUrl}" target="_blank" rel="noopener">Book →</a>`
    : `<div class="price-none">—</div>`;

  const l7Cell  = l7  ? `<div class="price-val ${priceClass(l7)}">${fmt(l7)}</div>`   : `<div class="price-none">—</div>`;
  const atlCell = atl ? `<div class="price-val ${priceClass(atl)}">${fmt(atl)}</div>` : `<div class="price-none">—</div>`;

  const gLabel = r.group || '';
  const gBadge = gLabel
    ? `<span class="group-badge" style="background:${groupColor(gLabel)};color:${groupTextColor(gLabel)}">${gLabel}</span>`
    : '';
  const pick = topPicks().find(p => p.id === r.id);
  const bestBadge = pick ? `<span class="best-badge rank-${pick.rank}">★ #${pick.rank}</span>` : '';

  return `<tr data-type="${r.type}" data-origin="${r.origin}" data-group="${r.group||''}" class="${isHidden(r)?'hidden':''}">
    <td>${gBadge}${bestBadge}</td>
    <td><span class="origin-badge origin-${r.origin.toLowerCase()}">${r.origin}</span></td>
    <td><div class="date-label">${r.label}</div></td>
    <td>${r.nights}</td>
    <td><span class="type-badge ${typeClass(r.type)}">${r.type}</span></td>
    <td class="price-col">${nsCell}</td>
    <td class="price-col">${bdCell}</td>
    <td class="price-col">${l7Cell}</td>
    <td class="price-col">${atlCell}</td>
    <td>${renderTrend(r)}</td>
    <td class="col-history">${renderSparkline(r)}</td>
  </tr>`;
}

// ── Summary strip ─────────────────────────────────────────────────────────

function renderSummary() {
  const visible = allRoutes.filter(r => !isHidden(r));
  const withPrice = visible.map(r => ({ r, snap: latestPrice(r) })).filter(x => x.snap);
  const withAtl   = visible.map(r => ({ r, price: allTimeLow(r) })).filter(x => x.price);

  if (!withPrice.length) {
    document.getElementById('summaryStrip').innerHTML =
      `<div class="summary-card"><div class="sc-label">Status</div><div class="sc-value" style="font-size:16px">Awaiting first data pull</div></div>`;
    return;
  }

  const cheapNow  = withPrice.reduce((a,b) => a.snap.price < b.snap.price ? a : b);
  const cheapEver = withAtl.length ? withAtl.reduce((a,b) => a.price < b.price ? a : b) : null;
  const dropping  = visible.filter(r => trend(r) === 'down').length;
  const who       = activeGroup === 'all' ? 'All groups' : activeGroup;

  document.getElementById('summaryStrip').innerHTML = `
    <div class="summary-card sc-green">
      <div class="sc-label">Cheapest Right Now</div>
      <div class="sc-value">${fmt(cheapNow.snap.price)}</div>
      <div class="sc-sub">${cheapNow.r.origin} · ${cheapNow.r.label} · ${cheapNow.r.group||''}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">All-Time Low</div>
      <div class="sc-value">${cheapEver ? fmt(cheapEver.price) : '—'}</div>
      <div class="sc-sub">${cheapEver ? cheapEver.r.origin+' · '+cheapEver.r.label : ''}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Prices Dropping</div>
      <div class="sc-value">${dropping}</div>
      <div class="sc-sub">of ${visible.length} routes shown</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Viewing</div>
      <div class="sc-value sc-who">${who}</div>
      <div class="sc-sub">→ Orlando (MCO area)</div>
    </div>`;
}

// ── Mobile card rendering ─────────────────────────────────────────────────

function renderCard(r) {
  const latest  = latestPrice(r);
  const nonstop = latestNonstop(r);
  const atl     = allTimeLow(r);
  const t       = trend(r);
  const bookUrl = buildFlightsUrl(r.depart, r.return, r.origin);
  const gLabel  = r.group || '';
  const gBadge  = gLabel
    ? `<span class="group-badge" style="background:${groupColor(gLabel)};color:${groupTextColor(gLabel)}">${gLabel}</span>`
    : '';
  const trendIcon = !t ? '—' : t === 'down' ? '<span class="trend-down">↓</span>' : t === 'up' ? '<span class="trend-up">↑</span>' : '<span class="trend-flat">→</span>';

  const nsBlock = nonstop
    ? `<div class="fc-price-block">
        <div class="fc-price-label">Nonstop</div>
        <div class="fc-price-val ${priceClass(nonstop.nonstopPrice)}">${fmt(nonstop.nonstopPrice)}</div>
        ${nonstop.nonstopAirline ? `<div class="fc-airline">${nonstop.nonstopAirline}</div>` : ''}
       </div>`
    : `<div class="fc-price-block">
        <div class="fc-price-label">Nonstop</div>
        <div class="fc-price-val price-none">—</div>
       </div>`;

  const bdBlock = latest
    ? `<div class="fc-price-block">
        <div class="fc-price-label">Best deal</div>
        <div class="fc-price-val ${priceClass(latest.price)}">${fmt(latest.price)}</div>
        ${latest.airline ? `<div class="fc-airline">${latest.airline}</div>` : ''}
        ${stopsLabel(latest.stops)}
       </div>`
    : `<div class="fc-price-block">
        <div class="fc-price-label">Best deal</div>
        <div class="fc-price-val price-none">—</div>
       </div>`;

  const atlVal = atl
    ? `<div class="fc-price-sub ${priceClass(atl)}">${fmt(atl)}</div>`
    : `<div class="fc-price-sub price-none">—</div>`;

  const pick = topPicks().find(p => p.id === r.id);

  return `<div class="fc${isHidden(r)?' hidden':''}${pick?' fc-best':''}" data-type="${r.type}" data-origin="${r.origin}" data-group="${r.group||''}">
    <div class="fc-header">
      <div class="fc-badges">
        ${gBadge}
        ${pick ? `<span class="best-badge rank-${pick.rank}">★ #${pick.rank}</span>` : ''}
        <span class="origin-badge origin-${r.origin.toLowerCase()}">${r.origin}</span>
        <span class="type-badge ${typeClass(r.type)}">${r.type}</span>
      </div>
      <div style="text-align:right">
        <div class="fc-dates">${r.label}</div>
        <div class="fc-nights">${r.nights} nights</div>
      </div>
    </div>
    <div class="fc-prices">
      ${nsBlock}
      ${bdBlock}
      <div class="fc-price-block">
        <div class="fc-price-label">All-time low</div>
        ${atlVal}
      </div>
    </div>
    <div class="fc-footer">
      <div class="fc-trend">${trendIcon}</div>
      <a class="fc-book-btn" href="${bookUrl}" target="_blank" rel="noopener">Book on Google Flights →</a>
    </div>
  </div>`;
}

function renderCards() {
  const el = document.getElementById('flightCards');
  if (el) el.innerHTML = sortedRoutes().map(renderCard).join('');
}

// ── Filters ───────────────────────────────────────────────────────────────

function applyFilters() {
  // Re-render rows and cards fully so Best Pick badge updates correctly
  document.getElementById('flightBody').innerHTML = sortedRoutes().map(renderRow).join('');
  renderCards();
  renderSummary();
  buildAirlineButtons();
}

function buildGroupButtons(routes) {
  const groups = [...new Set(routes.map(r => r.group).filter(Boolean))].sort();
  const container = document.querySelector('[data-group="all"]').parentNode;
  groups.forEach(g => {
    if (container.querySelector(`[data-group="${g}"]`)) return;
    const btn = document.createElement('button');
    btn.className = 'group-btn';
    btn.dataset.group = g;
    btn.textContent = g;
    btn.style.cssText = `background:${groupColor(g)};color:${groupTextColor(g)};border-color:${groupColor(g)}`;
    container.appendChild(btn);
    btn.addEventListener('click', () => {
      activeGroup = g;
      document.querySelectorAll('.group-btn').forEach(b => b.classList.toggle('active', b === btn));
      applyFilters();
    });
  });
}

function buildAirlineButtons() {
  const container = document.getElementById('airlineFilters');
  if (!container) return;
  // Collect airlines from currently visible routes
  const visible = allRoutes.filter(r => {
    // Ignore airline filter itself when building
    if (activeGroup  !== 'all' && r.group  !== activeGroup)  return false;
    if (activeOrigin !== 'all' && r.origin !== activeOrigin) return false;
    if (activeFilter !== 'all' && r.type   !== activeFilter) return false;
    if (stopsFilter === 'nonstop' && !latestNonstop(r))      return false;
    return true;
  });
  const airlines = [...new Set(visible.flatMap(r => [...routeAirlines(r)]))].sort();
  container.innerHTML = `<button class="airline-btn${activeAirline==='all'?' active':''}" data-airline="all">All airlines</button>` +
    airlines.map(a => `<button class="airline-btn${activeAirline===a?' active':''}" data-airline="${a}">${a}</button>`).join('');
  container.querySelectorAll('.airline-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeAirline = btn.dataset.airline;
      applyFilters();
    });
  });
}

// ── Load ──────────────────────────────────────────────────────────────────

async function load() {
  try {
    const res  = await fetch(DATA_URL + '?v=' + Date.now());
    const data = await res.json();

    const lu = data.lastUpdated;
    document.getElementById('lastUpdated').textContent = lu
      ? 'Last updated: ' + new Date(lu).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
      : 'Not yet updated';

    allRoutes = data.routes || [];
    buildGroupButtons(allRoutes);
    buildAirlineButtons();
    document.getElementById('flightBody').innerHTML = sortedRoutes().map(renderRow).join('');
    renderCards();
    renderSummary();
  } catch(e) {
    document.getElementById('flightBody').innerHTML =
      `<tr><td colspan="10" class="loading">Could not load price data. Try refreshing.</td></tr>`;
  }
}

// ── Event listeners ───────────────────────────────────────────────────────

document.querySelector('[data-group="all"]').addEventListener('click', function() {
  activeGroup = 'all';
  document.querySelectorAll('.group-btn').forEach(b => b.classList.toggle('active', b === this));
  applyFilters();
});

document.querySelectorAll('.origin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeOrigin = btn.dataset.origin;
    document.querySelectorAll('.origin-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.type;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

// ── Custom search ─────────────────────────────────────────────────────────

document.getElementById('csSearch').addEventListener('click', () => {
  const dep    = document.getElementById('csDepart').value;
  const ret    = document.getElementById('csReturn').value;
  const origin = document.getElementById('csOrigin').value;
  if (!dep || !ret) { alert('Please select both dates.'); return; }
  if (ret <= dep)   { alert('Return must be after departure.'); return; }
  window.open(buildFlightsUrl(dep, ret, origin), '_blank');
});

document.querySelectorAll('.stops-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    stopsFilter = btn.dataset.stops;
    document.querySelectorAll('.stops-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

load();
