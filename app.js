// ── Flight Tracker ────────────────────────────────────────────────────────

const DATA_URL = 'data/flights.json';
let allRoutes = [];
let activeFilter = 'all';

// Price tier thresholds (rough estimates for SLC→MCO round trip)
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

  const isHidden = activeFilter !== 'all' && route.type !== activeFilter;

  return `<tr data-type="${route.type}" class="${isHidden ? 'hidden' : ''}">
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

function renderSummary(routes) {
  const allLatest = routes.map(r => latestPrice(r)).filter(Boolean);
  const allAtl    = routes.map(r => ({ route: r, price: allTimeLow(r) })).filter(x => x.price);

  if (!allLatest.length) {
    document.getElementById('summaryStrip').innerHTML =
      `<div class="summary-card"><div class="sc-label">Status</div><div class="sc-value" style="font-size:16px">Awaiting first data pull</div></div>`;
    return;
  }

  const cheapestNow = allLatest.reduce((a, b) => a.price < b.price ? a : b);
  const cheapestRoute = routes.find(r => latestPrice(r) === cheapestNow);
  const cheapestEver = allAtl.length ? allAtl.reduce((a, b) => a.price < b.price ? a : b) : null;
  const dropping = routes.filter(r => trend(r) === 'down').length;

  document.getElementById('summaryStrip').innerHTML = `
    <div class="summary-card sc-green">
      <div class="sc-label">Cheapest Right Now</div>
      <div class="sc-value">${fmt(cheapestNow.price)}</div>
      <div class="sc-sub">${cheapestRoute ? cheapestRoute.label : ''} · ${cheapestNow.airline || ''}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">All-Time Low</div>
      <div class="sc-value">${cheapestEver ? fmt(cheapestEver.price) : '—'}</div>
      <div class="sc-sub">${cheapestEver ? cheapestEver.route.label : ''}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Routes Dropping</div>
      <div class="sc-value">${dropping}</div>
      <div class="sc-sub">of ${routes.length} tracked</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Routes Tracked</div>
      <div class="sc-value">${routes.length}</div>
      <div class="sc-sub">SLC → MCO round-trip</div>
    </div>`;
}

function render(routes) {
  allRoutes = routes;
  document.getElementById('flightBody').innerHTML = routes.map(renderRow).join('');
  renderSummary(routes);
}

function applyFilter(type) {
  activeFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  document.querySelectorAll('#flightBody tr').forEach(row => {
    const rt = row.dataset.type;
    row.classList.toggle('hidden', type !== 'all' && rt !== type);
  });
}

async function load() {
  try {
    const res = await fetch(DATA_URL + '?v=' + Date.now());
    const data = await res.json();

    const lu = data.lastUpdated;
    document.getElementById('lastUpdated').textContent = lu
      ? 'Last updated: ' + new Date(lu + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : 'Not yet updated';

    render(data.routes || []);
  } catch (e) {
    document.getElementById('flightBody').innerHTML =
      `<tr><td colspan="8" class="loading">Could not load price data. Try refreshing.</td></tr>`;
  }
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => applyFilter(btn.dataset.type));
});

load();
