(() => {
  'use strict';

  const APY = 0.0335;
  const REFRESH_MS = 30000;
  let latest = { webull: null, quotes: {} };
  let applying = false;

  const n = (...values) => {
    for (const value of values) {
      const x = Number(value);
      if (Number.isFinite(x)) return x;
    }
    return NaN;
  };
  const money = value => {
    const x = Number(value);
    return Number.isFinite(x)
      ? x.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  };
  const compact = value => {
    const x = Number(value);
    return Number.isFinite(x)
      ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(x)
      : '—';
  };
  const signedMoney = value => {
    const x = Number(value);
    return Number.isFinite(x) ? `${x >= 0 ? '+' : '-'}${money(Math.abs(x))}` : '—';
  };
  const signedPct = value => {
    const x = Number(value);
    return Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}%` : '—';
  };
  const tone = value => {
    const x = Number(value);
    return !Number.isFinite(x) ? 'flat' : x > 0 ? 'up' : x < 0 ? 'down' : 'flat';
  };

  async function getJSON(url, fallback) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } catch (_) {
      return fallback;
    }
  }

  function aggregatePositions(positions) {
    let cost = 0, value = 0, totalPL = 0, dayPL = 0;
    let hasCost = false, hasValue = false, hasTotalPL = false, hasDayPL = false;
    (positions || []).forEach(position => {
      const c = n(position.cost_basis);
      const v = n(position.market_value);
      const p = n(position.unrealized_pl);
      const d = n(position.day_pl);
      if (Number.isFinite(c)) { cost += c; hasCost = true; }
      if (Number.isFinite(v)) { value += v; hasValue = true; }
      if (Number.isFinite(p)) { totalPL += p; hasTotalPL = true; }
      if (Number.isFinite(d)) { dayPL += d; hasDayPL = true; }
    });
    return {
      cost: hasCost ? cost : NaN,
      value: hasValue ? value : NaN,
      totalPL: hasTotalPL ? totalPL : NaN,
      dayPL: hasDayPL ? dayPL : NaN,
      totalPct: hasCost && cost ? totalPL / cost * 100 : NaN,
      dayPct: hasValue && Number.isFinite(dayPL) && (value - dayPL) ? dayPL / (value - dayPL) * 100 : NaN,
    };
  }

  function setSummaryTile(tile, label, value, subtext, valueTone) {
    if (!tile) return;
    const labelEl = tile.querySelector(':scope > span');
    const valueEl = tile.querySelector(':scope > b');
    if (labelEl) labelEl.textContent = label;
    if (valueEl) {
      valueEl.textContent = value;
      valueEl.classList.remove('up', 'down', 'flat');
      if (valueTone) valueEl.classList.add(valueTone);
    }
    let sub = tile.querySelector(':scope > em.portfolio-insight-sub');
    if (!sub) {
      sub = document.createElement('em');
      sub.className = 'portfolio-insight-sub';
      tile.appendChild(sub);
    }
    sub.textContent = subtext || '';
    sub.classList.remove('up', 'down', 'flat');
    if (valueTone) sub.classList.add(valueTone);
  }

  function enhanceSummary() {
    const summary = document.getElementById('ownedPortfolioSummary');
    const webull = latest.webull;
    if (!summary || !webull) return;

    const tiles = summary.querySelectorAll(':scope > .owned-summary-total');
    if (tiles.length < 4) return;

    const balance = webull.balance || {};
    const positions = webull.positions || [];
    const agg = aggregatePositions(positions);
    const accountValue = n(balance.net_liquidation_value, agg.value);
    const totalPL = n(balance.unrealized_pl, agg.totalPL);
    const dayPL = n(balance.day_pl, agg.dayPL);
    const cash = n(balance.settled_cash, balance.cash);
    const buyingPower = n(balance.buying_power);
    const annualInterest = Number.isFinite(cash) ? cash * APY : NaN;

    setSummaryTile(
      tiles[0],
      'Portfolio Total',
      money(accountValue),
      Number.isFinite(agg.value) && Number.isFinite(cash) ? `${money(agg.value)} invested • ${money(cash)} cash` : 'Current account value'
    );
    setSummaryTile(
      tiles[1],
      'Cumulative P&L',
      signedMoney(totalPL),
      Number.isFinite(agg.totalPct) ? signedPct(agg.totalPct) : 'Unrealized positions',
      tone(totalPL)
    );
    setSummaryTile(
      tiles[2],
      "Today's P&L",
      signedMoney(dayPL),
      Number.isFinite(agg.dayPct) ? signedPct(agg.dayPct) : 'Owned positions today',
      tone(dayPL)
    );
    setSummaryTile(
      tiles[3],
      'Cash • up to 3.35% APY',
      money(cash),
      Number.isFinite(annualInterest)
        ? `${Number.isFinite(buyingPower) ? 'Buying power '+money(buyingPower)+' • ' : ''}≈ ${money(annualInterest)}/yr`
        : 'Premium cash yield'
    );

    summary.classList.add('portfolio-insights-active');

    const caption = document.querySelector('.screen[data-screen="stocks"] .section-caption');
    if (caption) {
      caption.innerHTML = '<span class="premium-pill">PREMIUM</span> account value • P&L • cash yield • live market context';
    }
  }

  function marketFor(symbol, position) {
    const q = (latest.quotes || {})[symbol] || {};
    const m = position && position.market && typeof position.market === 'object' ? position.market : {};
    return { ...q, ...m };
  }

  function findPosition(symbol) {
    const positions = (latest.webull && latest.webull.positions) || [];
    return positions.find(p => String(p.symbol || '').toUpperCase() === symbol) || null;
  }

  function replaceDetailRow(card, label, htmlValue) {
    const rows = card.querySelectorAll('.owned-detail-list > div');
    for (const row of rows) {
      const span = row.querySelector('span');
      const bold = row.querySelector('b');
      if (span && bold && span.textContent.trim() === 'Current share price') {
        span.textContent = label;
        bold.innerHTML = htmlValue;
        return;
      }
    }
  }

  function enhanceCard(card) {
    const symbol = String(card.dataset.symbol || '').toUpperCase();
    if (!symbol) return;
    const position = findPosition(symbol);
    const market = marketFor(symbol, position);

    const low = n(market.low);
    const high = n(market.high);
    const volume = n(market.volume);
    const value = n(position && position.market_value);
    const totalMarket = n(latest.webull && latest.webull.balance && latest.webull.balance.market_value);
    const weight = Number.isFinite(value) && Number.isFinite(totalMarket) && totalMarket ? value / totalMarket * 100 : NaN;
    const extPrice = n(market.ext_price, market.extended_price);
    const extPct = n(market.ext_pct, market.extended_pct);
    const ovnPrice = n(market.ovn_price, market.overnight_price);
    const ovnPct = n(market.ovn_pct, market.overnight_pct);

    const range = Number.isFinite(low) && Number.isFinite(high) ? `${money(low)} – ${money(high)}` : '—';
    replaceDetailRow(card, 'Day range', range);

    let footer = card.querySelector('.owned-market-context');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'owned-market-context';
      const section = card.querySelector('.owned-investment-section');
      if (section) section.appendChild(footer);
      else card.appendChild(footer);
    }

    const pieces = [];
    if (Number.isFinite(volume)) pieces.push(`<span><i>VOL</i><b>${compact(volume)}</b></span>`);
    if (Number.isFinite(weight)) pieces.push(`<span><i>WEIGHT</i><b>${weight.toFixed(1)}%</b></span>`);
    if (Number.isFinite(ovnPrice)) {
      pieces.push(`<span class="session"><i>OVERNIGHT</i><b>${money(ovnPrice)} <em class="${tone(ovnPct)}">${signedPct(ovnPct)}</em></b></span>`);
    } else if (Number.isFinite(extPrice)) {
      pieces.push(`<span class="session"><i>EXTENDED</i><b>${money(extPrice)} <em class="${tone(extPct)}">${signedPct(extPct)}</em></b></span>`);
    }
    footer.innerHTML = pieces.join('');
    footer.style.display = pieces.length ? '' : 'none';
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      enhanceSummary();
      document.querySelectorAll('.owned-investment-card[data-symbol]').forEach(enhanceCard);
    } finally {
      applying = false;
    }
  }

  async function refresh() {
    const [webull, quotes] = await Promise.all([
      getJSON('/api/webull/summary', latest.webull || { positions: [], balance: {} }),
      getJSON('/api/quotes', { quotes: latest.quotes || {} }),
    ]);
    latest.webull = webull || latest.webull;
    latest.quotes = (quotes && quotes.quotes) || latest.quotes || {};
    apply();
  }

  function boot() {
    setTimeout(refresh, 900);
    setInterval(refresh, REFRESH_MS);
    // owned-positions.js rebuilds card HTML during its live refresh. Re-apply the
    // lightweight DOM enhancements between network refreshes without adding
    // another observer that could react to our own text changes.
    setInterval(apply, 4000);
    document.addEventListener('farm-screen-change', event => {
      const name = event && event.detail ? String(event.detail.screen || '') : '';
      if (name === 'stocks' || name.indexOf('portfolio-') === 0) setTimeout(refresh, 150);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
