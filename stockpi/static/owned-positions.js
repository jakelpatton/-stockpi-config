(() => {
  window.FARM_SIMPLE_MARKETS = true;

  const REFRESH_MS = 15000;
  const CHART_REFRESH_MS = 60000;
  const chartCache = new Map();
  let lastChartFetch = 0;

  const IDENTITY = {
    EXE:{name:'Chesapeake Energy',description:'Energy • Owned position',domain:'expandenergy.com'},
    TEL:{name:'TE Connectivity',description:'Connectivity & sensors • Owned position',domain:'te.com'},
    CMI:{name:'Cummins',description:'Power & industrial • Owned position',domain:'cummins.com'},
    ADI:{name:'Analog Devices',description:'Semiconductors',domain:'analog.com'},
    AEIS:{name:'Advanced Energy Industries',description:'Power conversion',domain:'advancedenergy.com'},
    ALAB:{name:'Astera Labs',description:'AI connectivity',domain:'asteralabs.com'},
    AMAT:{name:'Applied Materials',description:'Semiconductor equipment',domain:'appliedmaterials.com'},
    ASML:{name:'ASML Holding',description:'Lithography systems',domain:'asml.com'},
    GNRC:{name:'Generac',description:'Power generation',domain:'generac.com'},
    KLAC:{name:'KLA',description:'Process control equipment',domain:'kla.com'},
    LRCX:{name:'Lam Research',description:'Semiconductor equipment',domain:'lamresearch.com'},
    NVDA:{name:'NVIDIA',description:'AI computing',domain:'nvidia.com'},
    POWL:{name:'Powell Industries',description:'Electrical infrastructure',domain:'powellind.com'},
    TER:{name:'Teradyne',description:'Semiconductor test',domain:'teradyne.com'}
  };

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(...vals)=>{for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n}return NaN};
  const money=v=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'};
  const signedMoney=v=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':'-'}${money(Math.abs(n))}`:'—'};
  const signedPct=v=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?'↑':'↓'} ${Math.abs(n).toFixed(2)}%`:'—'};
  const shares=v=>{const n=Number(v);return Number.isFinite(n)?n.toFixed(n<10?5:2).replace(/0+$/,'').replace(/\.$/,''):'—'};
  const tone=v=>{const n=Number(v);return !Number.isFinite(n)?'flat':n>0?'up':n<0?'down':'flat'};
  const identity=symbol=>IDENTITY[symbol]||{name:symbol,description:'Owned stock',domain:null};

  async function getJSON(url,fallback){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}
  }

  function logoHTML(symbol){
    const meta=identity(symbol),letter=esc(symbol.slice(0,1));
    if(!meta.domain)return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span></span>`;
    const google=`https://www.google.com/s2/favicons?domain=${encodeURIComponent(meta.domain)}&sz=128`;
    const duck=`https://icons.duckduckgo.com/ip3/${encodeURIComponent(meta.domain)}.ico`;
    return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span><img src="${google}" alt="${esc(meta.name)} logo" referrerpolicy="no-referrer" data-fallback="${duck}" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback=''}else{this.style.display='none'}"></span>`;
  }

  function relabelPortfolio(){
    const screen=document.querySelector('.screen[data-screen="stocks"]');
    if(!screen)return;
    screen.dataset.marketTitle='Portfolio';
    const eyebrow=screen.querySelector('.screen-heading .eyebrow');
    const title=screen.querySelector('.screen-heading h2');
    const caption=screen.querySelector('.screen-heading .section-caption');
    if(eyebrow)eyebrow.textContent='WEBULL • OWNED POSITIONS';
    if(title)title.textContent='Portfolio';
    if(caption)caption.textContent='Your owned investments • value • cost • gain/loss • 1-day progress';
  }

  function ensurePortfolioRoot(){
    const screen=document.querySelector('.screen[data-screen="stocks"]');
    if(!screen)return null;
    relabelPortfolio();
    ['rows','portfolioFocusRows','portfolioPanel'].forEach(id=>document.getElementById(id)?.classList.add('owned-legacy-hidden'));
    let root=document.getElementById('ownedPositionCards');
    if(root)return root;
    root=document.createElement('section');
    root.id='ownedPositionCards';
    root.className='owned-position-grid';
    const heading=screen.querySelector('.screen-heading');
    heading?.insertAdjacentElement('afterend',root);
    return root;
  }

  function ensureMarketsRoot(){
    let screen=document.querySelector('.screen[data-screen="markets"]');
    if(!screen){
      const main=document.querySelector('main.screens');
      if(!main)return null;
      screen=document.createElement('section');
      screen.className='screen';
      screen.dataset.screen='markets';
      screen.dataset.marketTitle='Markets';
      screen.innerHTML=`<div class="screen-heading markets-heading"><div><div class="eyebrow">MARKET WATCH • FOLLOWING</div><h2>Markets</h2></div><div class="section-caption">Stocks being followed • current price • daily move • entry levels</div></div><div id="marketsFollowGrid" class="markets-follow-grid"></div>`;
      main.appendChild(screen);
    }
    screen.dataset.marketTitle='Markets';
    return screen.querySelector('#marketsFollowGrid');
  }

  function setPortfolioLayout(root,count){
    let cols=1,rows=1,density='roomy';
    if(count===2){cols=2}
    else if(count===3){cols=3}
    else if(count===4){cols=2;rows=2;density='normal'}
    else if(count<=6){cols=3;rows=2;density='normal'}
    else if(count<=8){cols=4;rows=2;density='compact'}
    else {cols=4;rows=Math.ceil(count/4);density='dense'}
    root.style.setProperty('--owned-cols',cols);
    root.style.setProperty('--owned-rows',rows);
    root.dataset.count=String(count);
    root.dataset.density=density;
  }

  function setMarketsLayout(root,count){
    const cols=count<=8?2:count<=15?3:4;
    root.style.setProperty('--markets-cols',cols);
    root.dataset.density=count<=8?'roomy':count<=15?'normal':'compact';
  }

  function sparkline(points,cls,fallbackStart,fallbackEnd){
    let vals=(points||[]).map(Number).filter(Number.isFinite);
    let fallback=false;
    if(vals.length<2&&Number.isFinite(fallbackStart)&&Number.isFinite(fallbackEnd)){
      vals=[fallbackStart,fallbackEnd];fallback=true;
    }
    if(vals.length<2)return `<div class="owned-chart-empty">1D chart loading…</div>`;
    const min=Math.min(...vals),max=Math.max(...vals),span=max-min||Math.max(Math.abs(max)*.002,1);
    const coords=vals.map((v,i)=>{
      const x=(i/(vals.length-1))*100;
      const y=42-((v-min)/span)*34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return `<svg class="owned-sparkline ${cls}" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label="1-day stock price chart"><line x1="0" y1="42" x2="100" y2="42" class="chart-baseline"/><polyline points="${coords}" fill="none" vector-effect="non-scaling-stroke"/></svg>${fallback?'<div class="owned-chart-fallback">START → NOW</div>':''}`;
  }

  async function loadCharts(symbols){
    const unique=[...new Set(symbols.filter(Boolean))];
    const now=Date.now();
    if(now-lastChartFetch<CHART_REFRESH_MS&&unique.every(s=>chartCache.has(s)))return;
    lastChartFetch=now;
    await Promise.all(unique.map(async symbol=>{
      const data=await getJSON(`${location.protocol}//${location.hostname}:8092/api/chart/${encodeURIComponent(symbol)}`,null);
      if(data&&Array.isArray(data.points)&&data.points.length>=2)chartCache.set(symbol,data.points);
    }));
  }

  function renderOwnedCard(position,quote){
    const symbol=String(position.symbol||'').toUpperCase();
    const meta=identity(symbol);
    const quantity=num(position.quantity);
    const avg=num(position.average_cost);
    const current=num(quote?.price,position.last_price);
    const invested=num(position.cost_basis,Number.isFinite(quantity)&&Number.isFinite(avg)?quantity*avg:NaN);
    const value=num(position.market_value,Number.isFinite(quantity)&&Number.isFinite(current)?quantity*current:NaN);
    const totalPL=num(position.unrealized_pl,Number.isFinite(value)&&Number.isFinite(invested)?value-invested:NaN);
    const totalPct=num(position.unrealized_pct,Number.isFinite(totalPL)&&invested?totalPL/invested*100:NaN);
    const prev=num(quote?.prev_close);
    const dayPct=num(quote?.pct,Number.isFinite(current)&&Number.isFinite(prev)&&prev?(current-prev)/prev*100:NaN);
    const dayPL=num(position.day_pl,Number.isFinite(dayPct)&&Number.isFinite(value)?value*(dayPct/100):NaN);
    const totalTone=tone(totalPL),dayTone=tone(dayPct);
    const gain=Number.isFinite(totalPL)&&totalPL>=0;

    return `<article class="owned-investment-card ${totalTone}">
      <header class="owned-card-head">
        <div class="owned-company">${logoHTML(symbol)}<div class="owned-company-copy"><b>${esc(meta.name)}</b><span class="owned-ticker">${esc(symbol)}</span><small>${esc(meta.description)}</small></div></div>
        <div class="owned-current"><b>${money(current)}</b><span class="${dayTone}">${signedPct(dayPct)}</span></div>
      </header>

      <div class="owned-chart-wrap">
        ${sparkline(chartCache.get(symbol),dayTone,prev,current)}
        <div class="owned-chart-caption"><span>1 DAY</span><span class="${dayTone}">${Number.isFinite(dayPL)?`${signedMoney(dayPL)} today`:'Today'}</span></div>
      </div>

      <section class="owned-investment-section">
        <div class="owned-investment-title">My investment</div>
        <div class="owned-investment-hero">
          <div><b>${money(invested)}</b><span>Total invested</span></div>
          <div class="owned-result ${totalTone}"><b>${signedMoney(totalPL)}</b><span>${gain?'Gain':'Loss'}</span></div>
        </div>
        <div class="owned-detail-list">
          <div><span>Total value $</span><b>${money(value)}</b></div>
          <div><span>${gain?'Total gain %':'Total loss %'}</span><b class="${totalTone}">${signedPct(totalPct)}</b></div>
          <div><span>Shares owned</span><b>${shares(quantity)}</b></div>
          <div><span>Average cost per share</span><b>${money(avg)}</b></div>
          <div><span>Current share price</span><b>${money(current)}</b></div>
        </div>
      </section>
    </article>`;
  }

  function signal(stock,current){
    const buy=num(stock.buy),strong=num(stock.strong_buy,stock.strong),agg=num(stock.aggressive_buy,stock.aggressive);
    if(Number.isFinite(current)&&Number.isFinite(agg)&&current<=agg)return 'AGGRESSIVE BUY';
    if(Number.isFinite(current)&&Number.isFinite(strong)&&current<=strong)return 'STRONG BUY';
    if(Number.isFinite(current)&&Number.isFinite(buy)&&current<=buy)return 'BUY';
    return 'HOLD';
  }

  function renderMarketCard(stock,quote){
    const symbol=String(stock.symbol||'').toUpperCase(),meta=identity(symbol);
    const current=num(quote?.price,stock.webull_last_price),dayPct=num(quote?.pct);
    const buy=num(stock.buy),strong=num(stock.strong_buy,stock.strong),agg=num(stock.aggressive_buy,stock.aggressive);
    const action=signal(stock,current);
    return `<article class="market-follow-card"><div class="market-follow-main"><div class="market-follow-company">${logoHTML(symbol)}<div><b>${esc(meta.name)}</b><span>${esc(symbol)} • ${esc(meta.description.replace(' • Owned position',''))}</span></div></div><div class="market-follow-price"><b>${money(current)}</b><span class="${tone(dayPct)}">${signedPct(dayPct)}</span></div><div class="market-follow-signal ${action.includes('BUY')?'buy':''}">${action}</div></div><div class="market-follow-levels"><div><span>Buy</span><b>${money(buy)}</b></div><div><span>Strong Buy</span><b>${money(strong)}</b></div><div><span>Aggressive</span><b>${money(agg)}</b></div></div><div class="market-follow-note">${esc(stock.note||'Following for a better entry.')}</div></article>`;
  }

  function followedStocks(stocks,positions){
    const owned=new Set((positions||[]).filter(p=>Number(p.quantity)>0).map(p=>String(p.symbol||'').toUpperCase()));
    return (stocks||[]).filter(stock=>{
      const symbol=String(stock.symbol||'').toUpperCase();
      if(!symbol||owned.has(symbol)||stock.owned||Number(stock.position_usd)>0)return false;
      return Number.isFinite(num(stock.buy,stock.strong_buy,stock.strong,stock.aggressive_buy,stock.aggressive))||!!stock.note;
    });
  }

  function repairRotation(){
    try{
      if(typeof cfg==='undefined'||!Array.isArray(cfg.screens))return;
      const active=document.querySelector('.screen.active')?.dataset.screen||'';
      const wanted=['stocks','markets','activity','home','water','power','thesis'];
      const available=wanted.filter(name=>document.querySelector(`.screen[data-screen="${name}"]`));
      const same=cfg.screens.length===available.length&&cfg.screens.every((x,i)=>x===available[i]);
      cfg.rotation_enabled=true;
      if(!same)cfg.screens=available;
      if(typeof idx!=='undefined'){
        const keep=active?cfg.screens.indexOf(active):-1;
        idx=keep>=0?keep:0;
      }
      if(typeof buildDots==='function')buildDots();
      if(typeof schedule==='function')schedule();
    }catch(e){console.warn('rotation repair',e)}
  }

  async function refresh(){
    const portfolioRoot=ensurePortfolioRoot(),marketsRoot=ensureMarketsRoot();
    if(!portfolioRoot||!marketsRoot)return;
    const [webull,quotesResult,stocks]=await Promise.all([
      getJSON('/api/webull/summary',{positions:[]}),
      getJSON('/api/quotes',{quotes:{}}),
      getJSON('/api/stocks',[])
    ]);
    const positions=(webull.positions||[]).filter(p=>Number(p.quantity)>0);
    const qmap=quotesResult.quotes||{};
    const followed=followedStocks(stocks,positions);

    setPortfolioLayout(portfolioRoot,positions.length);
    if(!positions.length){
      portfolioRoot.innerHTML='<div class="owned-empty"><b>No owned positions found.</b><span>Waiting for Webull position data.</span></div>';
    }else{
      await loadCharts(positions.map(p=>String(p.symbol||'').toUpperCase()));
      portfolioRoot.innerHTML=positions.map(p=>renderOwnedCard(p,qmap[String(p.symbol||'').toUpperCase()]||{})).join('');
    }

    setMarketsLayout(marketsRoot,followed.length);
    marketsRoot.innerHTML=followed.length?followed.map(s=>renderMarketCard(s,qmap[String(s.symbol||'').toUpperCase()]||{})).join(''):'<div class="markets-empty"><b>No followed stocks configured.</b><span>Stocks with stored entry levels appear here automatically.</span></div>';
    repairRotation();
  }

  function boot(){
    ensurePortfolioRoot();
    ensureMarketsRoot();
    relabelPortfolio();
    setTimeout(refresh,350);
    setTimeout(repairRotation,1200);
    setInterval(refresh,REFRESH_MS);
    setInterval(repairRotation,10000);
    document.addEventListener('farm-screen-change',e=>{
      if(e.detail?.screen==='stocks'||e.detail?.screen==='markets')setTimeout(refresh,80);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
