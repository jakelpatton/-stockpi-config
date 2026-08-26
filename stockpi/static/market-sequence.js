(() => {
  const REFRESH_MS = 20000;
  const WATCHLIST_NAME = 'My Watchlist';
  const WATCH_ROWS_PER_PAGE = 4;
  let installed = false;

  const $ = id => document.getElementById(id);
  const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) return n; } return NaN; };
  const money = v => { v = Number(v); return Number.isFinite(v) ? v.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; };
  const signedMoney = v => { v=Number(v); return Number.isFinite(v) ? `${v>=0?'+':'-'}${money(Math.abs(v))}` : '—'; };
  const signedPct = v => { v=Number(v); return Number.isFinite(v) ? `${v>=0?'+':''}${v.toFixed(2)}%` : '—'; };
  const cls = v => { v=Number(v); return !Number.isFinite(v)?'market-flat':v>0?'market-up':v<0?'market-down':'market-flat'; };
  const shares = v => { v=Number(v); return Number.isFinite(v) ? `${v.toFixed(v<10?4:2)} sh` : '—'; };
  const dateLabel = value => {
    if(!value) return 'Recommendation timestamp not recorded';
    const d = new Date(value.length===10 ? value+'T12:00:00' : value);
    if(Number.isNaN(d.getTime())) return `Recommendation reviewed ${value}`;
    const hasTime = String(value).includes('T');
    return hasTime
      ? `Recommendation • ${d.toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}`
      : `Recommendation reviewed • ${d.toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})} • exact time not recorded`;
  };
  const fmtOrderTime = value => { if(!value)return '—'; const d=new Date(value); return Number.isNaN(d.getTime())?String(value):d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
  const getJSON = async (url,fallback) => { try { const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error(String(r.status)); return await r.json(); } catch(e) { return fallback; } };

  function ensureAssets(){
    if(!document.querySelector('link[href="/static/market-sequence.css"]')){
      const l=document.createElement('link'); l.rel='stylesheet'; l.href='/static/market-sequence.css'; document.head.appendChild(l);
    }
  }

  function removeGenerated(){ document.querySelectorAll('.market-sequence-screen').forEach(x=>x.remove()); }
  function mkScreen(name,title,eyebrow,caption){
    const s=document.createElement('section');
    s.className='screen market-sequence-screen'; s.dataset.screen=name; s.dataset.marketTitle=title;
    s.innerHTML=`<div class="market-heading"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div><div class="market-caption">${caption}</div></div><div class="market-body"></div>`;
    document.querySelector('main.screens').appendChild(s); return s.querySelector('.market-body');
  }

  function latestActivity(symbol,activity){
    const open=(activity.open_orders||[]).filter(o=>o.symbol===symbol);
    if(open.length){ const o=open[0]; return {main:`OPEN ${o.side||''} ${o.order_type||''} • ${shares(o.quantity)}${Number.isFinite(num(o.limit_price))?' @ '+money(o.limit_price):''}`,sub:`${o.status||''} • ${o.time_in_force||''} • placed ${fmtOrderTime(o.place_time)}`}; }
    const rows=[...(activity.today_orders||[]),...(activity.history||[])].filter(o=>o.symbol===symbol);
    if(!rows.length)return {main:'No recent order activity',sub:'Webull order history connected'};
    rows.sort((a,b)=>String(b.place_time||b.filled_time||'').localeCompare(String(a.place_time||a.filled_time||'')));
    const o=rows[0], qty=num(o.filled_quantity,o.quantity), px=num(o.filled_price,o.limit_price,o.stop_price);
    const verb=o.status==='FILLED'?(o.side==='BUY'?'BOUGHT':'SOLD'):`${o.side||''} ${o.status||''}`;
    return {main:`${verb} ${Number.isFinite(qty)?shares(qty):''}${Number.isFinite(px)?' @ '+money(px):''}`,sub:`${o.order_type||''} • ${o.time_in_force||''} • ${fmtOrderTime(o.place_time||o.filled_time)}`};
  }

  function renderPortfolio(webull,activity){
    const b=webull.balance||{}, ps=webull.positions||[];
    const body=mkScreen('portfolio','Portfolio','WEBULL • ACCOUNT OVERVIEW','Large-format account summary • read only');
    const openCount=(activity.open_orders||[]).length;
    body.innerHTML=`
      <div class="portfolio-summary-grid">
        <div class="market-panel"><span>Net Account Value</span><b>${money(b.net_liquidation_value)}</b></div>
        <div class="market-panel"><span>Invested Market Value</span><b>${money(b.market_value)}</b></div>
        <div class="market-panel"><span>Cash</span><b>${money(b.cash)}</b></div>
        <div class="market-panel"><span>Buying Power</span><b>${money(b.buying_power)}</b></div>
        <div class="market-panel"><span>Open Orders</span><b>${openCount}</b></div>
        <div class="market-panel"><span>Today's P/L</span><b class="${cls(b.day_pl)}">${signedMoney(b.day_pl)}</b></div>
        <div class="market-panel"><span>Total Unrealized P/L</span><b class="${cls(b.unrealized_pl)}">${signedMoney(b.unrealized_pl)}</b></div>
        <div class="market-panel"><span>Settled Cash</span><b>${money(b.settled_cash)}</b></div>
        <div class="market-panel"><span>Unsettled Cash</span><b>${money(b.unsettled_cash)}</b></div>
        <div class="market-panel"><span>Account Type</span><b>${webull.account?.account_type||'—'}</b></div>
      </div>
      <div class="portfolio-summary-main">
        <div class="portfolio-holdings market-panel">
          <div class="portfolio-holding-row head"><span>Symbol</span><span>Shares</span><span>Avg Cost</span><span>Last</span><span>Market Value</span><span>Weight</span><span>Total P/L</span></div>
          ${ps.map(p=>`<div class="portfolio-holding-row"><b class="ticker">${p.symbol}</b><b>${shares(p.quantity)}</b><b>${money(p.average_cost)}</b><b>${money(p.last_price)}</b><b>${money(p.market_value)}</b><b>${Number.isFinite(num(p.proportion_pct))?num(p.proportion_pct).toFixed(2)+'%':'—'}</b><b class="${cls(p.unrealized_pl)}">${signedMoney(p.unrealized_pl)} • ${signedPct(p.unrealized_pct)}</b></div>`).join('')}
        </div>
        <div class="portfolio-side market-panel">
          <div class="big-account"><span class="market-kicker">Portfolio Position Count</span><b>${ps.length}</b></div>
          <div class="detail-pair"><span>Night Buying Power</span><b>${money(b.night_trading_buying_power)}</b></div>
          <div class="detail-pair"><span>Available Withdrawal</span><b>${money(b.available_withdrawal)}</b></div>
          <div class="detail-pair"><span>Held Amount</span><b>${money(b.held_amount)}</b></div>
          <div class="detail-pair"><span>Margin Calls</span><b>${Array.isArray(b.open_margin_calls)?b.open_margin_calls.length:'—'}</b></div>
          <div class="detail-pair"><span>Data Source</span><b>Webull account</b></div>
          <div class="detail-pair"><span>Market Quotes</span><b>Public fallback</b></div>
        </div>
      </div>`;
  }

  function renderOwned(stock,p,quote,activity){
    const symbol=p.symbol, title=`${symbol} • Owned Position`;
    const body=mkScreen(`owned-${symbol}`,title,'OWNED STOCK • WEBULL POSITION','One position per page • readable across the room');
    const price=num(quote.price,p.last_price), prev=num(quote.prev_close), change=num(quote.change,Number.isFinite(price)&&Number.isFinite(prev)?price-prev:NaN), pct=num(quote.pct,Number.isFinite(change)&&prev?change/prev*100:NaN);
    const act=latestActivity(symbol,activity);
    const recBuy=num(stock?.buy), recStrong=num(stock?.strong_buy,stock?.strong), recAgg=num(stock?.aggressive_buy,stock?.aggressive);
    const action=Number.isFinite(price)&&Number.isFinite(recAgg)&&price<=recAgg?'AGGRESSIVE BUY':Number.isFinite(price)&&Number.isFinite(recStrong)&&price<=recStrong?'STRONG BUY':Number.isFinite(price)&&Number.isFinite(recBuy)&&price<=recBuy?'BUY':'HOLD / WAIT';
    body.innerHTML=`<div class="owned-hero">
      <div class="owned-primary market-panel">
        <div class="owned-symbol-line"><div><div class="owned-ticker">${symbol}</div><div class="owned-company">${stock?.name||stock?.note||p.instrument_type||'Equity position'}</div></div><div class="owned-weight"><b>${Number.isFinite(num(p.proportion_pct))?num(p.proportion_pct).toFixed(2)+'%':'—'}</b><span>OF INVESTED PORTFOLIO</span></div></div>
        <div class="owned-price-row"><div class="owned-price">${money(price)}</div><div class="owned-day ${cls(change)}">${signedMoney(change)} • ${signedPct(pct)}<br><span class="market-kicker">PUBLIC MARKET QUOTE</span></div></div>
        <div class="owned-metric-grid">
          <div class="owned-metric"><span>Shares</span><b>${shares(p.quantity)}</b></div>
          <div class="owned-metric"><span>Market Value</span><b>${money(p.market_value)}</b></div>
          <div class="owned-metric"><span>Average Cost</span><b>${money(p.average_cost)}</b></div>
          <div class="owned-metric"><span>Cost Basis</span><b>${money(p.cost_basis)}</b></div>
          <div class="owned-metric"><span>Total P/L</span><b class="${cls(p.unrealized_pl)}">${signedMoney(p.unrealized_pl)} • ${signedPct(p.unrealized_pct)}</b></div>
          <div class="owned-metric"><span>Today's Position P/L</span><b class="${cls(p.day_pl)}">${signedMoney(p.day_pl)}</b></div>
          <div class="owned-metric"><span>Realized Today</span><b class="${cls(p.day_realized_pl)}">${signedMoney(p.day_realized_pl)}</b></div>
          <div class="owned-metric"><span>Instrument</span><b>${p.instrument_type||'EQUITY'}</b></div>
        </div>
      </div>
      <div class="owned-secondary market-panel">
        <div class="rec-box"><div class="rec-title"><b>ChatGPT Entry Levels</b><span>${dateLabel(stock?.recommendation_timestamp||stock?.last_reviewed)}</span></div>
          <div class="rec-levels"><div><span>Buy</span><b>${money(recBuy)}</b></div><div><span>Strong Buy</span><b>${money(recStrong)}</b></div><div><span>Aggressive</span><b>${money(recAgg)}</b></div></div>
          <div class="rec-status ${action.includes('BUY')?'market-up':'market-flat'}">CURRENT SIGNAL • ${action}</div>
          <div class="rec-note">${stock?.note||'Recommendation thesis note not recorded.'}</div>
        </div>
        <div class="activity-box market-panel"><span class="market-kicker">Latest Webull Activity</span><div class="activity-main">${act.main}</div><div class="activity-sub">${act.sub}</div></div>
        <div class="activity-box market-panel"><span class="market-kicker">Data Provenance</span><div class="activity-main">Shares, cost, value & P/L • Webull account</div><div class="activity-sub">Price movement • public market feed until Webull STOCK QUOTES is subscribed</div></div>
      </div>
    </div>`;
  }

  function renderLimits(activity){
    const body=mkScreen('limits','Open Limit Orders','WEBULL • ORDERS','Open limit orders immediately after owned positions');
    const orders=(activity.open_orders||[]).filter(o=>String(o.order_type||'').toUpperCase().includes('LIMIT'));
    if(!orders.length){ body.innerHTML=`<div class="limit-empty market-panel"><b>No open limit orders</b><span>Webull order monitor is connected • this page will populate automatically when a limit order is open.</span></div>`; return; }
    body.innerHTML=`<div class="limit-list">${orders.map(o=>`<div class="limit-order market-panel"><div class="ticker">${o.symbol||'—'}</div><div><span>Side</span><b>${o.side||'—'}</b></div><div><span>Quantity</span><b>${shares(o.quantity)}</b></div><div><span>Limit Price</span><b>${money(o.limit_price)}</b></div><div><span>Filled</span><b>${shares(o.filled_quantity)}</b></div><div><span>Status</span><b>${o.status||'—'}</b></div><div><span>Placed / TIF</span><b>${fmtOrderTime(o.place_time)} • ${o.time_in_force||'—'}</b></div></div>`).join('')}</div>`;
  }

  function renderWatchlist(watch,stocks,quotes,ownedSymbols){
    const instruments=(watch?.instruments||[]).filter(i=>!ownedSymbols.has(i.symbol));
    const pages=[]; for(let i=0;i<instruments.length;i+=WATCH_ROWS_PER_PAGE)pages.push(instruments.slice(i,i+WATCH_ROWS_PER_PAGE));
    if(!pages.length) pages.push([]);
    pages.forEach((items,idx)=>{
      const body=mkScreen(`watchlist-${idx+1}`,'My Watchlist','WEBULL • WATCHLIST SYNC',`Synced automatically • page ${idx+1} of ${pages.length}`);
      if(!items.length){body.innerHTML='<div class="limit-empty market-panel"><b>No non-owned watchlist stocks</b><span>Owned names are shown on their own pages.</span></div>';return;}
      body.innerHTML=`<div class="watchlist-grid">${items.map(i=>{
        const s=stocks.find(x=>x.symbol===i.symbol)||{}, q=quotes[i.symbol]||{}, price=num(q.price), buy=num(s.buy), strong=num(s.strong_buy,s.strong), agg=num(s.aggressive_buy,s.aggressive), reviewed=s.recommendation_timestamp||s.last_reviewed;
        return `<div class="watch-row market-panel"><div class="ticker">${i.symbol}</div><div class="company">${i.name||s.note||'Watchlist stock'}<small>${i.exchange||''}</small></div><div><span>Price</span><b>${money(price)}</b></div><div><span>Buy</span><b>${money(buy)}</b></div><div><span>Strong Buy</span><b>${money(strong)}</b></div><div><span>Aggressive</span><b>${money(agg)}</b></div><div>${Number.isFinite(buy)?`<span>Recommendation</span><b>${dateLabel(reviewed)}</b>`:`<div class="rec-missing">NOT YET REVIEWED<br>No entry levels stored</div>`}</div></div>`;
      }).join('')}</div>`;
    });
    return pages.length;
  }

  function updateRotation(dynamicScreens){
    try{
      if(typeof cfg==='undefined'||!Array.isArray(cfg.screens)) return;
      const rest=cfg.screens.filter(s=>!['stocks','activity','portfolio','limits'].includes(s)&&!String(s).startsWith('owned-')&&!String(s).startsWith('watchlist-'));
      cfg.screens=[...dynamicScreens,...rest];
      if(typeof idx!=='undefined') idx=0;
      if(typeof buildDots==='function') buildDots();
      if(typeof showScreen==='function') showScreen(0);
    }catch(e){console.error('market sequence rotation',e)}
  }

  async function build(){
    ensureAssets();
    const [stocks,quotesResult,webull,activity]=await Promise.all([
      getJSON('/api/stocks',[]), getJSON('/api/quotes',{quotes:{}}), getJSON('/api/webull/summary',{positions:[],watchlists:[],balance:{}}), getJSON('/static/webull-activity.json',{open_orders:[],today_orders:[],history:[]})
    ]);
    if(!webull.connected) return;
    removeGenerated();
    const quotes=quotesResult.quotes||{}, positions=webull.positions||[], stockMap=new Map(stocks.map(s=>[s.symbol,s]));
    renderPortfolio(webull,activity);
    positions.forEach(p=>renderOwned(stockMap.get(p.symbol)||{},p,quotes[p.symbol]||{},activity));
    renderLimits(activity);
    const watch=(webull.watchlists||[]).find(w=>w.name===WATCHLIST_NAME)||null;
    const ownedSymbols=new Set(positions.map(p=>p.symbol));
    const watchPages=renderWatchlist(watch,stocks,quotes,ownedSymbols);
    const dynamic=['portfolio',...positions.map(p=>`owned-${p.symbol}`),'limits',...Array.from({length:watchPages},(_,i)=>`watchlist-${i+1}`)];
    if(!installed){ updateRotation(dynamic); installed=true; }
  }

  function labelObserver(){
    const main=document.querySelector('main.screens'); if(!main)return;
    const update=()=>{ const a=document.querySelector('.screen.active'); const label=$('screenName'); if(a?.dataset.marketTitle&&label)label.textContent=a.dataset.marketTitle; };
    new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']}); update();
  }

  function boot(){ ensureAssets(); labelObserver(); setTimeout(build,800); setInterval(build,REFRESH_MS); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
