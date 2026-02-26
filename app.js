// ── Flight Tracker ────────────────────────────────────────────────────────

const DATA_URL = 'data/flights.json';
let allRoutes = [];
let activeFilter = 'all';
let activeOrigin = 'all';

// Price tier thresholds (round trip per person)
const PRICE_LOW  = 300;
const PRICE_HIGH = 550;

function priceClass(p) {
  if (!p) return '';
  if (p <= PRICE_LOW) return 'price-low';
  if (p <= PRICE_HIGH) return 'price-mid';
  return 'price-high';
}

function fmt(p) {
  if (!p) return null;
  return '$' + p.toLocaleString();
}

function typeClass(type) {
  return 'type-' + type.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function latestPrice(route) {
  const snaps = route.snapshots.filter(s => s.price);
  if (!snaps.length) return null;
  return snaps[snaps.length - 1];
}

function low7(route) {
  const snaps = route.snapshots.filter(s => s.price);
  if (!snaps.length) return null;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const recent = snaps.filter(s => new Date(s.date) >= cutoff);
  if (!recent.length) return null;
  return Math.min(...recent.map(s => s.price));
}

function allTimeLow(route) {
  const prices = route.snapshots.filter(s => s.price).map(s => s.price);
  if (!prices.length) return null;
  return Math.min(...prices);
}

function trend(route) {
  const snaps = route.snapshots.filter(s => s.price);
  if (snaps.length < 2) return null;
  const last = snaps[snaps.length - 1].price;
  const prev = snaps[snaps.length - 2].price;
  if (last < prev) return 'down';
  if (last > prev) return 'up';
  return 'flat';
}

function renderSparkline(route) {
  const snaps = route.snapshots.filter(s => s.price).slice(-14);
  if (snaps.length < 2) return `<span class="spark-none">—</span>`;
  const max = Math.max(...snaps.map(s => s.price));
  const min = Math.min(...snaps.map(s => s.price));
  const range = max - min || 1;
  return `<div class="sparkline">${snaps.map((s, i) => {
    const h = Math.max(3, Math.round(((s.price - min) / range) * 24 + 2));
    const isLatest = i === snaps.length - 1;
    return `<div class="spark-bar${isLatest ? ' spark-latest' : ''}" style="height:${h}px" title="${s.date}: $${s.price}"></div>`;
  }).join('')}</div>`;
}

function renderTrend(route) {
  const t = trend(route);
  if (!t) return `<span class="trend-none">—</span>`;
  if (t === 'down') return `<span class="trend-down" title="Price dropped">↓</span>`;
  if (t === 'up')   return `<span class="trend-up" title="Price rose">↑</span>`;
  return `<span class="trend-flat" title="No change">→</span>`;
}

function isRowHidden(route) {
  const originMatch = activeOrigin === 'all' || route.origin === activeOrigin;
  const typeMatch   = activeFilter === 'all' || route.type === activeFilter;
  return !(originMatch && typeMatch);
}

function renderRow(route) {
  const latest = latestPrice(route);
  const l7 = low7(route);
  const atl = allTimeLow(route);
  const pc = latest ? priceClass(latest.price) : '';

  const priceCell = latest
    ? `<div class="price-cell"><div class="price-val ${pc}">${fmt(latest.price)}</div><div class="price-airline">${latest.airline || ''}</div></div>`
    : `<div class="price-none">—</div>`;

  const low7Cell = l7
    ? `<div class="price-cell"><div class="price-val ${priceClass(l7)}">${fmt(l7)}</div></div>`
    : `<div class="price-none">—</div>`;

  const atlCell = atl
    ? `<div class="price-cell"><div class="price-val ${priceClass(atl)}">${fmt(atl)}</div></div>`
    : `<div class="price-none">—</div>`;

  const hidden = isRowHidden(route);
  const originBadge = `<span class="origin-badge origin-${route.origin.toLowerCase()}">${route.origin}</span>`;

  return `<tr data-type="${route.type}" data-origin="${route.origin}" class="${hidden ? 'hidden' : ''}">
    <td>${originBadge}</td>
    <td><div class="date-label">${route.label}</div></td>
    <td>${route.nights}</td>
    <td><span class="type-badge ${typeClass(route.type)}">${route.type}</span></td>
    <td class="price-col">${priceCell}</td>
    <td class="price-col">${low7Cell}</td>
    <td class="price-col">${atlCell}</td>
    <td>${renderTrend(route)}</td>
    <td>${renderSparkline(route)}</td>
  </tr>`;
}

function visibleRoutes() {
  return allRoutes.filter(r => !isRowHidden(r));
}

function renderSummary(routes) {
  const visible = routes.filter(r => !isRowHidden(r));
  const allLatest = visible.map(r => ({ route: r, ...latestPrice(r) })).filter(x => x.price);
  const allAtl    = visible.map(r => ({ route: r, price: allTimeLow(r) })).filter(x => x.price);

  if (!allLatest.length) {
    document.getElementById('summaryStrip').innerHTML =
      `<div class="summary-card"><div class="sc-label">Status</div><div class="sc-value" style="font-size:16px">Awaiting first data pull</div></div>`;
    return;
  }

  const cheapestNow  = allLatest.reduce((a, b) => a.price < b.price ? a : b);
  const cheapestEver = allAtl.length ? allAtl.reduce((a, b) => a.price < b.price ? a : b) : null;
  const dropping     = visible.filter(r => trend(r) === 'down').length;
  const originLabel  = activeOrigin === 'all' ? 'SLC + PVU' : activeOrigin;

  document.getElementById('summaryStrip').innerHTML = `
    <div class="summary-card sc-green">
      <div class="sc-label">Cheapest Right Now</div>
      <div class="sc-value">${fmt(cheapestNow.price)}</div>
      <div class="sc-sub">${cheapestNow.route.origin} · ${cheapestNow.route.label}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">All-Time Low</div>
      <div class="sc-value">${cheapestEver ? fmt(cheapestEver.price) : '—'}</div>
      <div class="sc-sub">${cheapestEver ? cheapestEver.route.origin + ' · ' + cheapestEver.route.label : ''}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Routes Dropping</div>
      <div class="sc-value">${dropping}</div>
      <div class="sc-sub">of ${visible.length} shown</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Tracking</div>
      <div class="sc-value">${originLabel}</div>
      <div class="sc-sub">→ Orlando (MCO area)</div>
    </div>`;
}

function render(routes) {
  allRoutes = routes;
  document.getElementById('flightBody').innerHTML = routes.map(renderRow).join('');
  renderSummary(routes);
}

function applyFilters() {
  document.querySelectorAll('#flightBody tr').forEach(row => {
    const type   = row.dataset.type;
    const origin = row.dataset.origin;
    const hide   = (activeOrigin !== 'all' && origin !== activeOrigin) ||
                   (activeFilter !== 'all' && type   !== activeFilter);
    row.classList.toggle('hidden', hide);
  });
  renderSummary(allRoutes);
}

async function load() {
  try {
    const res = await fetch(DATA_URL + '?v=' + Date.now());
    const data = await res.json();

    const lu = data.lastUpdated;
    document.getElementById('lastUpdated').textContent = lu
      ? 'Last updated: ' + new Date(lu).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : 'Not yet updated';

    render(data.routes || []);
  } catch (e) {
    document.getElementById('flightBody').innerHTML =
      `<tr><td colspan="9" class="loading">Could not load price data. Try refreshing.</td></tr>`;
  }
}

// ── Custom date search ────────────────────────────────────────────────────

const KG = {
  SLC: { id: '/m/0f2r6', type: 2 },
  PVU: { id: '/m/0l39b', type: 3 },
  ORL: { id: '/m/0ply0', type: 3 },
};

function buildFlightsUrl(departDate, returnDate, originKey) {
  const o = KG[originKey], d = KG.ORL;
  function dateField(s) {
    const b = new TextEncoder().encode(s);
    return new Uint8Array([0x12, b.length, ...b]);
  }
  function placeField(tag, typeVal, placeId) {
    const pb = new TextEncoder().encode(placeId);
    const inner = new Uint8Array([0x08, typeVal, 0x12, pb.length, ...pb]);
    return new Uint8Array([tag, inner.length, ...inner]);
  }
  function leg(date, fromId, fromType, toId, toType) {
    const content = new Uint8Array([
      ...dateField(date),
      ...placeField(0x6a, fromType, fromId),
      ...placeField(0x72, toType, toId),
    ]);
    return new Uint8Array([0x1a, content.length, ...content]);
  }
  const header  = new Uint8Array([0x08, 0x1c, 0x10, 0x01]);
  const leg1    = leg(departDate, o.id, o.type, d.id, d.type);
  const leg2    = leg(returnDate, d.id, d.type, o.id, o.type);
  const trailer = new Uint8Array([0x40,0x01,0x48,0x01,0x70,0x01,0x82,0x01,0x0b,0x08,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x01,0x98,0x01,0x01]);
  const raw = new Uint8Array([...header, ...leg1, ...leg2, ...trailer]);
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `https://www.google.com/travel/flights/search?tfs=${b64}&hl=en&curr=USD`;
}

document.getElementById('csSearch').addEventListener('click', () => {
  const dep    = document.getElementById('csDepart').value;
  const ret    = document.getElementById('csReturn').value;
  const origin = document.getElementById('csOrigin').value;
  if (!dep || !ret) { alert('Please select both a departure and return date.'); return; }
  if (ret <= dep)   { alert('Return date must be after departure date.'); return; }
  window.open(buildFlightsUrl(dep, ret, origin), '_blank');
});

// Origin buttons
document.querySelectorAll('.origin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeOrigin = btn.dataset.origin;
    document.querySelectorAll('.origin-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

// Duration filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.type;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });
});

load();
