(() => {
  'use strict';

  window.FARM_SIMPLE_MARKETS = true;
  window.ownedPortfolioRendererReady = false;

  const REFRESH_MS = 15000;
  const CHART_REFRESH_MS = 60000;
  const REQUEST_TIMEOUT_MS = 8000;
  const CHART_TIMEOUT_MS = 4500;
  const MAX_OWNED_PER_PAGE = 6;

  const chartCache = new Map();
  let lastChartFetch = 0;
  let lastRotationSignature = '';
  let lastPositions = [];
  let lastQuotes = {};
  let refreshBusy = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  };
  const money = value => {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2})
      : '—';
  };
  const signedMoney = value => {
    const n = Number(value);
    return Number.isFinite(n) ? `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}` : '—';
  };
  const signedPct = value => {
    const n = Number(value);
    return Number.isFinite(n) ? `${n >= 0 ? '↑' : '↓'} ${Math.abs(n).toFixed(2)}%` : '—';
  };
  const shares = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(n < 10 ? 5 : 2).replace(/0+$/,'').replace(/\.$/,'');
  };
  const tone = value => {
    const n = Number(value);
    return !Number.isFinite(n) ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  };
  const identity = symbol => window.getStockIdentity
    ? window.getStockIdentity(symbol)
    : {displayName:String(symbol || '').toUpperCase(),description:'Equity position',domain:null};
  const logoCandidates = symbol => window.getStockLogoCandidates ? window.getStockLogoCandidates(symbol) : [];

  async function getJSON(url, fallback, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url,{cache:'no-store',signal:controller.signal});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      console.warn('1838 Estate request failed', url, error);
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  function logoHTML(symbol) {
    const meta = identity(symbol);
    const letter = esc(String(symbol || '?').slice(0,1));
    const candidates = logoCandidates(symbol);
    if (!candidates.length) return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span></span>`;
    const encoded = esc(JSON.stringify(candidates));
    return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span><img src="${esc(candidates[0])}" alt="${esc(meta.displayName)} logo" referrerpolicy="no-referrer" data-logo-index="0" data-logo-candidates='${encoded}' onerror="window.advanceStockLogo&&window.advanceStockLogo(this)"></span>`;
  }

  function relabelPortfolio() {
    const screen = document.querySelector('.screen[data-screen="stocks"]');
    if (!screen) return;
    screen.dataset.marketTitle = 'Portfolio';
    const eyebrow = screen.querySelector('.screen-heading .eyebrow');
    const title = screen.querySelector('.screen-heading h2');
    const caption = screen.querySelector('.screen-heading .section-caption');
    if (eyebrow) eyebrow.textContent = 'WEBULL • OWNED POSITIONS';
    if (title) title.textContent = 'Portfolio';
    if (caption) caption.textContent = 'Owned investments • cost • value • gain/loss • 1-day progress';
  }

  function ensurePortfolioRoot() {
    const screen = document.querySelector('.screen[data-screen="stocks"]');
    if (!screen) return null;
    relabelPortfolio();
    ['rows','portfolioFocusRows','portfolioPanel'].forEach(id => document.getElementById(id)?.classList.add('owned-legacy-hidden'));

    let summary = document.getElementById('ownedPortfolioSummary');
    if (!summary) {
      summary = document.createElement('section');
      summary.id = 'ownedPortfolioSummary';
      summary.className = 'owned-summary-strip';
      screen.querySelector('.screen-heading')?.insertAdjacentElement('afterend',summary);
    }

    let root = document.getElementById('ownedPositionCards');
    if (!root) {
      root = document.createElement('section');
      root.id = 'ownedPositionCards';
      root.className = 'owned-position-grid';
      summary.insertAdjacentElement('afterend',root);
    }

    if (!root.dataset.initialized) {
      root.dataset.initialized = '1';
      root.innerHTML = '<div class="owned-empty owned-loading"><b>Loading portfolio…</b><span>Reading owned positions from Webull.</span></div>';
    }
    return {screen,summary,root};
  }

  function ensureMarketsRoot() {
    let screen = document.querySelector('.screen[data-screen="markets"]');
    if (!screen) {
      const main = document.querySelector('main.screens');
      if (!main) return null;
      screen = document.createElement('section');
      screen.className = 'screen';
      screen.dataset.screen = 'markets';
      screen.dataset.marketTitle = 'Markets';
      screen.innerHTML = '<div class="screen-heading markets-heading"><div><div class="eyebrow">MARKET WATCH • FOLLOWING</div><h2>Markets</h2></div><div class="section-caption">Stocks being followed • current price • daily move • entry levels</div></div><div id="marketsFollowGrid" class="markets-follow-grid"><div class="markets-empty"><b>Loading markets…</b><span>Reading followed stocks.</span></div></div>';
      main.appendChild(screen);
    }
    screen.dataset.marketTitle = 'Markets';
    return screen.querySelector('#marketsFollowGrid');
  }

  function ensureOwnedContinuationPages(pageCount) {
    const main = document.querySelector('main.screens');
    if (!main) return [];
    const keep = new Set();
    const pages = [];
    for (let page = 2; page <= pageCount; page++) {
      const name = `portfolio-${page}`;
      keep.add(name);
      let screen = document.querySelector(`.screen[data-screen="${name}"]`);
      if (!screen) {
        screen = document.createElement('section');
        screen.className = 'screen portfolio-continuation-screen';
        screen.dataset.screen = name;
        screen.dataset.marketTitle = `Portfolio ${page}`;
        screen.innerHTML = `<div class="screen-heading"><div><div class="eyebrow">WEBULL • OWNED POSITIONS</div><h2>Portfolio</h2></div><div class="section-caption">Owned positions • page ${page} of ${pageCount}</div></div><section id="ownedPositionCards-${page}" class="owned-position-grid"></section>`;
        main.appendChild(screen);
      }
      screen.dataset.marketTitle = `Portfolio ${page}`;
      const caption = screen.querySelector('.section-caption');
      if (caption) caption.textContent = `Owned positions • page ${page} of ${pageCount}`;
      pages.push({screen,root:screen.querySelector(`#ownedPositionCards-${page}`),name});
    }
    document.querySelectorAll('.portfolio-continuation-screen').forEach(screen => {
      if (!keep.has(screen.dataset.screen)) screen.remove();
    });
    return pages;
  }

  function setPortfolioLayout(root,count) {
    let cols = 1, rows = 1, density = 'roomy';
    if (count === 2) cols = 2;
    else if (count === 3) cols = 3;
    else if (count === 4) { cols = 2; rows = 2; density = 'normal'; }
    else if (count === 5 || count === 6) { cols = 3; rows = 2; density = 'normal'; }
    root.style.setProperty('--owned-cols',String(cols));
    root.style.setProperty('--owned-rows',String(rows));
    root.dataset.count = String(count);
    root.dataset.density = density;
  }

  function setMarketsLayout(root,count) {
    const cols = count <= 10 ? 2 : count <= 15 ? 3 : 4;
    root.style.setProperty('--markets-cols',String(cols));
    root.dataset.density = count <= 10 ? 'roomy' : count <= 15 ? 'normal' : 'compact';
  }

  function sparkline(points, cls, fallbackStart, fallbackEnd) {
    let values = (points || []).map(Number).filter(Number.isFinite);
    let fallback = false;
    if (values.length < 2 && Number.isFinite(fallbackStart) && Number.isFinite(fallbackEnd)) {
      values = [fallbackStart,fallbackEnd];
      fallback = true;
    }
    if (values.length < 2) return '<div class="owned-chart-empty">1D chart loading…</div>';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.max(Math.abs(max) * .002,1);
    const coords = values.map((value,index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 46 - ((value - min) / span) * 40;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return `<svg class="owned-sparkline ${cls}" viewBox="0 0 100 52" preserveAspectRatio="none" role="img" aria-label="1-day stock price chart"><line x1="0" y1="46" x2="100" y2="46" class="chart-baseline"/><polyline points="${coords}" fill="none" vector-effect="non-scaling-stroke"/></svg>${fallback ? '<div class="owned-chart-fallback">OPEN → NOW</div>' : ''}`;
  }

  function metrics(position,quote) {
    const quantity = num(position.quantity,position.qty);
    const avg = num(position.average_cost,position.avg_price,position.cost_price);
    const current = num(quote?.price,position.last_price,position.current_price);
    const invested = num(position.cost_basis,position.position_usd,Number.isFinite(quantity) && Number.isFinite(avg) ? quantity * avg : NaN);
    const value = num(position.market_value,position.webull_market_value,Number.isFinite(quantity) && Number.isFinite(current) ? quantity * current : NaN);
    const totalPL = num(position.unrealized_pl,position.webull_unrealized_pl,Number.isFinite(value) && Number.isFinite(invested) ? value - invested : NaN);
    let totalPct = num(position.unrealized_pct,position.webull_unrealized_pct);
    if (Number.isFinite(totalPct) && Math.abs(totalPct) <= 1 && Math.abs(totalPL) > 0.01) totalPct *= 100;
    if (!Number.isFinite(totalPct) && Number.isFinite(totalPL) && invested) totalPct = totalPL / invested * 100;
    const prev = num(quote?.prev_close,quote?.previous_close);
    const dayPct = num(quote?.pct,Number.isFinite(current) && Number.isFinite(prev) && prev ? (current - prev) / prev * 100 : NaN);
    const dayPL = num(position.day_pl,Number.isFinite(dayPct) && Number.isFinite(value) ? value * (dayPct / 100) : NaN);
    return {quantity,avg,current,invested,value,totalPL,totalPct,prev,dayPct,dayPL};
  }

  function renderSummary(positions,qmap) {
    let invested = 0, value = 0, totalPL = 0;
    let investedComplete = true, valueComplete = true;
    const chips = [];
    positions.forEach(position => {
      const symbol = String(position.symbol || '').toUpperCase();
      const m = metrics(position,qmap[symbol] || {});
      if (Number.isFinite(m.invested)) invested += m.invested; else investedComplete = false;
      if (Number.isFinite(m.value)) value += m.value; else valueComplete = false;
      if (Number.isFinite(m.totalPL)) totalPL += m.totalPL;
      chips.push(`<div class="owned-summary-chip"><b>${esc(symbol)}</b><span>${money(m.value)}</span><em class="${tone(m.dayPct)}">${signedPct(m.dayPct)}</em></div>`);
    });
    return `<div class="owned-summary-total"><span>Total invested</span><b>${investedComplete ? money(invested) : '—'}</b></div><div class="owned-summary-total"><span>Total value</span><b>${valueComplete ? money(value) : '—'}</b></div><div class="owned-summary-total"><span>Total gain / loss</span><b class="${tone(totalPL)}">${signedMoney(totalPL)}</b></div><div class="owned-summary-total"><span>Positions</span><b>${positions.length}</b></div><div class="owned-summary-chips">${chips.join('')}</div>`;
  }

  function renderOwnedCard(position,quote) {
    const symbol = String(position.symbol || '').toUpperCase();
    const meta = identity(symbol);
    const m = metrics(position,quote);
    const totalTone = tone(m.totalPL);
    const dayTone = tone(m.dayPct);
    const gain = Number.isFinite(m.totalPL) && m.totalPL >= 0;
    return `<article class="owned-investment-card ${totalTone}" data-symbol="${esc(symbol)}">
      <header class="owned-card-head">
        <div class="owned-company">${logoHTML(symbol)}<div class="owned-company-copy"><b>${esc(meta.displayName)}</b><span class="owned-ticker">${esc(symbol)}</span><small>${esc(meta.description)}</small></div></div>
        <div class="owned-current"><b>${money(m.current)}</b><span class="${dayTone}">${signedPct(m.dayPct)}</span></div>
      </header>
      <div class="owned-chart-wrap">${sparkline(chartCache.get(symbol),dayTone,m.prev,m.current)}<div class="owned-chart-caption"><span>1 DAY</span><span class="${dayTone}">${Number.isFinite(m.dayPL) ? `${signedMoney(m.dayPL)} today` : 'Today'}</span></div></div>
      <section class="owned-investment-section">
        <div class="owned-investment-title">My investment</div>
        <div class="owned-investment-hero"><div><b>${money(m.invested)}</b><span>Total invested</span></div><div class="owned-result ${totalTone}"><b>${signedMoney(m.totalPL)}</b><span>${gain ? 'Gain' : 'Loss'}</span></div></div>
        <div class="owned-detail-list">
          <div><span>Total value $</span><b>${money(m.value)}</b></div>
          <div><span>${gain ? 'Total gain %' : 'Total loss %'}</span><b class="${totalTone}">${signedPct(m.totalPct)}</b></div>
          <div><span>Shares owned</span><b>${shares(m.quantity)}</b></div>
          <div><span>Average cost per share</span><b>${money(m.avg)}</b></div>
          <div><span>Current share price</span><b>${money(m.current)}</b></div>
        </div>
      </section>
    </article>`;
  }

  function signal(stock,current) {
    const buy = num(stock.buy);
    const strong = num(stock.strong_buy,stock.strong);
    const aggressive = num(stock.aggressive_buy,stock.aggressive);
    if (Number.isFinite(current) && Number.isFinite(aggressive) && current <= aggressive) return 'AGGRESSIVE BUY';
    if (Number.isFinite(current) && Number.isFinite(strong) && current <= strong) return 'STRONG BUY';
    if (Number.isFinite(current) && Number.isFinite(buy) && current <= buy) return 'BUY';
    return 'HOLD';
  }

  function renderMarketCard(stock,quote) {
    const symbol = String(stock.symbol || '').toUpperCase();
    const meta = identity(symbol);
    const current = num(quote?.price,stock.webull_last_price);
    const dayPct = num(quote?.pct);
    const buy = num(stock.buy);
    const strong = num(stock.strong_buy,stock.strong);
    const aggressive = num(stock.aggressive_buy,stock.aggressive);
    const action = signal(stock,current);
    return `<article class="market-follow-card"><div class="market-follow-main"><div class="market-follow-company">${logoHTML(symbol)}<div><b>${esc(meta.displayName)}</b><span>${esc(symbol)} • ${esc(meta.description)}</span></div></div><div class="market-follow-price"><b>${money(current)}</b><span class="${tone(dayPct)}">${signedPct(dayPct)}</span></div><div class="market-follow-signal ${action.includes('BUY') ? 'buy' : ''}">${action}</div></div><div class="market-follow-levels"><div><span>Buy</span><b>${money(buy)}</b></div><div><span>Strong Buy</span><b>${money(strong)}</b></div><div><span>Aggressive</span><b>${money(aggressive)}</b></div></div><div class="market-follow-note">${esc(stock.note || 'Following for a better entry.')}</div></article>`;
  }

  function followedStocks(stocks,positions) {
    const owned = new Set((positions || []).filter(p => Number(p.quantity) > 0).map(p => String(p.symbol || '').toUpperCase()));
    return (Array.isArray(stocks) ? stocks : []).filter(stock => {
      const symbol = String(stock.symbol || '').toUpperCase();
      if (!symbol || owned.has(symbol) || stock.owned || Number(stock.position_usd) > 0) return false;
      return Number.isFinite(num(stock.buy,stock.strong_buy,stock.strong,stock.aggressive_buy,stock.aggressive)) || !!stock.note;
    });
  }

  function renderOwnedPages(positions,qmap) {
    const base = ensurePortfolioRoot();
    if (!base) return [];
    base.summary.innerHTML = positions.length
      ? renderSummary(positions,qmap)
      : '<div class="owned-summary-total"><span>Portfolio</span><b>Waiting for Webull</b></div>';

    const chunks = [];
    for (let i = 0; i < positions.length; i += MAX_OWNED_PER_PAGE) chunks.push(positions.slice(i,i + MAX_OWNED_PER_PAGE));
    if (!chunks.length) chunks.push([]);

    const first = chunks[0];
    setPortfolioLayout(base.root,first.length);
    base.root.innerHTML = first.length
      ? first.map(p => renderOwnedCard(p,qmap[String(p.symbol || '').toUpperCase()] || {})).join('')
      : '<div class="owned-empty"><b>No owned positions found.</b><span>Webull is connected, but no positive-share positions were returned.</span></div>';

    const continuations = ensureOwnedContinuationPages(chunks.length);
    continuations.forEach((page,index) => {
      const rows = chunks[index + 1] || [];
      setPortfolioLayout(page.root,rows.length);
      page.root.innerHTML = rows.map(p => renderOwnedCard(p,qmap[String(p.symbol || '').toUpperCase()] || {})).join('');
    });
    return continuations;
  }

  function renderMarkets(stocks,positions,qmap) {
    const root = ensureMarketsRoot();
    if (!root) return;
    const followed = followedStocks(stocks,positions);
    setMarketsLayout(root,followed.length);
    root.innerHTML = followed.length
      ? followed.map(stock => renderMarketCard(stock,qmap[String(stock.symbol || '').toUpperCase()] || {})).join('')
      : '<div class="markets-empty"><b>No followed stocks configured.</b><span>Stocks with stored entry levels appear here automatically.</span></div>';
  }

  function updateRotation(extraPortfolioNames = []) {
    try {
      if (typeof cfg === 'undefined' || !Array.isArray(cfg.screens)) return;
      const active = document.querySelector('.screen.active')?.dataset.screen || '';
      const wanted = ['stocks',...extraPortfolioNames,'markets','activity','home','water','power','thesis'];
      const available = wanted.filter(name => document.querySelector(`.screen[data-screen="${name}"]`));
      const signature = available.join('|');
      const wasEnabled = !!cfg.rotation_enabled;
      const changed = signature !== lastRotationSignature || cfg.screens.length !== available.length || cfg.screens.some((name,index) => name !== available[index]);
      cfg.rotation_enabled = true;
      if (changed) {
        cfg.screens = available;
        const keep = active ? cfg.screens.indexOf(active) : -1;
        if (typeof idx !== 'undefined') idx = keep >= 0 ? keep : 0;
        if (typeof buildDots === 'function') buildDots();
        lastRotationSignature = signature;
      }
      if ((changed || !wasEnabled) && typeof schedule === 'function') schedule();
    } catch (error) {
      console.warn('1838 Estate rotation update failed',error);
    }
  }

  async function loadCharts(symbols) {
    const unique = [...new Set(symbols.filter(Boolean))];
    const now = Date.now();
    if (now - lastChartFetch < CHART_REFRESH_MS && unique.every(symbol => chartCache.has(symbol))) return false;
    lastChartFetch = now;
    let changed = false;
    await Promise.all(unique.map(async symbol => {
      const data = await getJSON(`${location.protocol}//${location.hostname}:8092/api/chart/${encodeURIComponent(symbol)}`,null,CHART_TIMEOUT_MS);
      if (data && Array.isArray(data.points) && data.points.length >= 2) {
        chartCache.set(symbol,data.points);
        changed = true;
      }
    }));
    return changed;
  }

  function showRendererError(error) {
    const base = ensurePortfolioRoot();
    if (!base) return;
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    base.root.innerHTML = `<div class="owned-empty owned-error"><b>Portfolio display error</b><span>${esc(message)}</span></div>`;
    const status = document.getElementById('status');
    if (status) status.textContent = 'Portfolio renderer error • retrying';
  }

  async function refresh() {
    if (refreshBusy) return;
    refreshBusy = true;
    const base = ensurePortfolioRoot();
    ensureMarketsRoot();
    if (!base) { refreshBusy = false; return; }

    try {
      const [webull,quotesResult,stocks] = await Promise.all([
        getJSON('/api/webull/summary',{positions:[],connected:false}),
        getJSON('/api/quotes',{quotes:{}}),
        getJSON('/api/stocks',[])
      ]);

      const rawPositions = Array.isArray(webull?.positions) ? webull.positions : [];
      const positions = rawPositions.filter(position => num(position.quantity,position.qty) > 0);
      const qmap = quotesResult?.quotes && typeof quotesResult.quotes === 'object' ? quotesResult.quotes : {};
      lastPositions = positions;
      lastQuotes = qmap;

      const continuations = renderOwnedPages(positions,qmap);
      renderMarkets(stocks,positions,qmap);
      updateRotation(continuations.map(page => page.name));
      window.ownedPortfolioRendererReady = true;

      const status = document.getElementById('status');
      if (status && positions.length) status.textContent = `Systems online • ${positions.length} owned position${positions.length === 1 ? '' : 's'}`;

      loadCharts(positions.map(position => String(position.symbol || '').toUpperCase())).then(changed => {
        if (changed && lastPositions.length) renderOwnedPages(lastPositions,lastQuotes);
      }).catch(error => console.warn('1838 Estate chart refresh failed',error));
    } catch (error) {
      console.error('1838 Estate Portfolio renderer failed',error);
      showRendererError(error);
    } finally {
      refreshBusy = false;
    }
  }

  function boot() {
    ensurePortfolioRoot();
    ensureMarketsRoot();
    relabelPortfolio();
    window.ownedPortfolioRendererReady = true;
    window.ownedPortfolioRefresh = refresh;
    setTimeout(refresh,150);
    setInterval(refresh,REFRESH_MS);
    document.addEventListener('farm-screen-change',event => {
      const name = String(event.detail?.screen || '');
      if (name === 'stocks' || name === 'markets' || name.startsWith('portfolio-')) setTimeout(refresh,50);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();