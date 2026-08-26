(() => {
  window.FARM_SIMPLE_MARKETS = true;

  const REFRESH_MS = 15000;
  const CHART_REFRESH_MS = 60000;
  const MAX_OWNED_PER_PAGE = 6;
  const chartCache = new Map();
  let lastChartFetch = 0;
  let lastRotationSignature = '';

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(...vals)=>{for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n}return NaN};
  const money=v=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'};
  const signedMoney=v=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':'-'}${money(Math.abs(n))}`:'—'};
  const signedPct=v=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?'↑':'↓'} ${Math.abs(n).toFixed(2)}%`:'—'};
  const shares=v=>{const n=Number(v);return Number.isFinite(n)?n.toFixed(n<10?5:2).replace(/0+$/,'').replace(/\.$/,''):'—'};
  const tone=v=>{const n=Number(v);return !Number.isFinite(n)?'flat':n>0?'up':n<0?'down':'flat'};
  const identity=symbol=>window.getStockIdentity?window.getStockIdentity(symbol):{displayName:String(symbol||'').toUpperCase(),description:'Equity position',domain:null};
  const logoCandidates=symbol=>window.getStockLogoCandidates?window.getStockLogoCandidates(symbol):[];

  async function getJSON(url,fallback){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}
  }

  function logoHTML(symbol){
    const meta=identity(symbol),letter=esc(String(symbol||'?').slice(0,1)),candidates=logoCandidates(symbol);
    if(!candidates.length)return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span></span>`;
    const encoded=esc(JSON.stringify(candidates));
    return `<span class="owned-logo"><span class="owned-logo-letter">${letter}</span><img src="${esc(candidates[0])}" alt="${esc(meta.displayName)} logo" referrerpolicy="no-referrer" data-logo-index="0" data-logo-candidates='${encoded}' onerror="window.advanceStockLogo&&window.advanceStockLogo(this)"></span>`;
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
    if(caption)caption.textContent='Owned investments • cost • value • gain/loss • 1-day progress';
  }

  function ensurePortfolioRoot(){
    const screen=document.querySelector('.screen[data-screen="stocks"]');
    if(!screen)return null;
    relabelPortfolio();
    ['rows','portfolioFocusRows','portfolioPanel'].forEach(id=>document.getElementById(id)?.classList.add('owned-legacy-hidden'));

    let summary=document.getElementById('ownedPortfolioSummary');
    if(!summary){
      summary=document.createElement('section');
      summary.id='ownedPortfolioSummary';
      summary.className='owned-summary-strip';
      screen.querySelector('.screen-heading')?.insertAdjacentElement('afterend',summary);
    }

    let root=document.getElementById('ownedPositionCards');
    if(!root){
      root=document.createElement('section');
      root.id='ownedPositionCards';
      root.className='owned-position-grid';
      summary.insertAdjacentElement('afterend',root);
    }
    return {screen,summary,root};
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

  function ensureOwnedContinuationPages(pageCount){
    const main=document.querySelector('main.screens');
    if(!main)return [];
    const keep=new Set();
    const roots=[];
    for(let page=2;page<=pageCount;page++){
      const name=`portfolio-${page}`;
      keep.add(name);
      let screen=document.querySelector(`.screen[data-screen="${name}"]`);
      if(!screen){
        screen=document.createElement('section');
        screen.className='screen portfolio-continuation-screen';
        screen.dataset.screen=name;
        screen.dataset.marketTitle=`Portfolio ${page}`;
        screen.innerHTML=`<div class="screen-heading"><div><div class="eyebrow">WEBULL • OWNED POSITIONS</div><h2>Portfolio</h2></div><div class="section-caption">Owned positions • page ${page} of ${pageCount}</div></div><section id="ownedPositionCards-${page}" class="owned-position-grid"></section>`;
        main.appendChild(screen);
      }
      screen.dataset.marketTitle=`Portfolio ${page}`;
      const caption=screen.querySelector('.section-caption');if(caption)caption.textContent=`Owned positions • page ${page} of ${pageCount}`;
      roots.push({screen,root:screen.querySelector(`#ownedPositionCards-${page}`),name});
    }
    document.querySelectorAll('.portfolio-continuation-screen').forEach(screen=>{if(!keep.has(screen.dataset.screen))screen.remove()});
    return roots;
  }

  function setPortfolioLayout(root,count){
    let cols=1,rows=1,density='roomy';
    if(count===2){cols=2}
    else if(count===3){cols=3}
    else if(count===4){cols=2;rows=2;density='normal'}
    else if(count===5||count===6){cols=3;rows=2;density='normal'}
    root.style.setProperty('--owned-cols',String(cols));
    root.style.setProperty('--owned-rows',String(rows));
    root.dataset.count=String(count);
    root.dataset.density=density;
  }

  function setMarketsLayout(root,count){
    const cols=count<=10?2:count<=15?3:4;
    root.style.setProperty('--markets-cols',String(cols));
    root.dataset.density=count<=10?'roomy':count<=15?'normal':'compact';
  }

  function sparkline(points,cls,fallbackStart,fallbackEnd){
    let vals=(points||[]).map(Number).filter(Number.isFinite);
    let fallback=false;
    if(vals.length<2&&Number.isFinite(fallbackStart)&&Number.isFinite(fallbackEnd)){vals=[fallbackStart,fallbackEnd];fallback=true;}
    if(vals.length<2)return `<div class="owned-chart-empty">1D chart loading…</div>`;
    const min=Math.min(...vals),max=Math.max(...vals),span=max-min||Math.max(Math.abs(max)*.002,1);
    const coords=vals.map((v,i)=>{
      const x=(i/(vals.length-1))*100;
      const y=46-((v-min)/span)*40;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return `<svg class="owned-sparkline ${cls}" viewBox="0 0 100 52" preserveAspectRatio="none" role="img" aria-label="1-day stock price chart"><line x1="0" y1="46" x2="100" y2="46" class="chart-baseline"/><polyline points="${coords}" fill="none" vector-effect="non-scaling-stroke"/></svg>${fallback?'<div class="owned-chart-fallback">START → NOW</div>':''}`;
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

  function metrics(position,quote){
    const quantity=num(position.quantity),avg=num(position.average_cost),current=num(quote?.price,position.last_price);
    const invested=num(position.cost_basis,Number.isFinite(quantity)&&Number.isFinite(avg)?quantity*avg:NaN);
    const value=num(position.market_value,Number.isFinite(quantity)&&Number.isFinite(current)?quantity*current:NaN);
    const totalPL=num(position.unrealized_pl,Number.isFinite(value)&&Number.isFinite(invested)?value-invested:NaN);
    const totalPct=num(position.unrealized_pct,Number.isFinite(totalPL)&&invested?totalPL/invested*100:NaN);
    const prev=num(quote?.prev_close),dayPct=num(quote?.pct,Number.isFinite(current)&&Number.isFinite(prev)&&prev?(current-prev)/prev*100:NaN);
    const dayPL=num(position.day_pl,Number.isFinite(dayPct)&&Number.isFinite(value)?value*(dayPct/100):NaN);
    return {quantity,avg,current,invested,value,totalPL,totalPct,prev,dayPct,dayPL};
  }

  function renderSummary(positions,qmap){
    let invested=0,value=0,completeInvested=true,completeValue=true,totalPL=0;
    const chips=[];
    positions.forEach(position=>{
      const symbol=String(position.symbol||'').toUpperCase(),m=metrics(position,qmap[symbol]||{});
      if(Number.isFinite(m.invested))invested+=m.invested;else completeInvested=false;
      if(Number.isFinite(m.value))value+=m.value;else completeValue=false;
      if(Number.isFinite(m.totalPL))totalPL+=m.totalPL;
      chips.push(`<div class="owned-summary-chip"><b>${esc(symbol)}</b><span>${money(m.value)}</span><em class="${tone(m.dayPct)}">${signedPct(m.dayPct)}</em></div>`);
    });
    return `<div class="owned-summary-total"><span>Total invested</span><b>${completeInvested?money(invested):'—'}</b></div><div class="owned-summary-total"><span>Total value</span><b>${completeValue?money(value):'—'}</b></div><div class="owned-summary-total"><span>Total gain / loss</span><b class="${tone(totalPL)}">${signedMoney(totalPL)}</b></div><div class="owned-summary-total"><span>Positions</span><b>${positions.length}</b></div><div class="owned-summary-chips">${chips.join('')}</div>`;
  }

  function renderOwnedCard(position,quote){
    const symbol=String(position.symbol||'').toUpperCase(),meta=identity(symbol),m=metrics(position,quote);
    const totalTone=tone(m.totalPL),dayTone=tone(m.dayPct),gain=Number.isFinite(m.totalPL)&&m.totalPL>=0;
    return `<article class="owned-investment-card ${totalTone}">
      <header class="owned-card-head">
        <div class="owned-company">${logoHTML(symbol)}<div class="owned-company-copy"><b>${esc(meta.displayName)}</b><span class="owned-ticker">${esc(symbol)}</span><small>${esc(meta.description)}</small></div></div>
        <div class="owned-current"><b>${money(m.current)}</b><span class="${dayTone}">${signedPct(m.dayPct)}</span></div>
      </header>
      <div class="owned-chart-wrap">${sparkline(chartCache.get(symbol),dayTone,m.prev,m.current)}<div class="owned-chart-caption"><span>1 DAY</span><span class="${dayTone}">${Number.isFinite(m.dayPL)?`${signedMoney(m.dayPL)} today`:'Today'}</span></div></div>
      <section class="owned-investment-section">
        <div class="owned-investment-title">My investment</div>
        <div class="owned-investment-hero"><div><b>${money(m.invested)}</b><span>Total invested</span></div><div class="owned-result ${totalTone}"><b>${signedMoney(m.totalPL)}</b><span>${gain?'Gain':'Loss'}</span></div></div>
        <div class="owned-detail-list">
          <div><span>Total value $</span><b>${money(m.value)}</b></div>
          <div><span>${gain?'Total gain %':'Total loss %'}</span><b class="${totalTone}">${signedPct(m.totalPct)}</b></div>
          <div><span>Shares owned</span><b>${shares(m.quantity)}</b></div>
          <div><span>Average cost per share</span><b>${money(m.avg)}</b></div>
          <div><span>Current share price</span><b>${money(m.current)}</b></div>
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
    const buy=num(stock.buy),strong=num(stock.strong_buy,stock.strong),agg=num(stock.aggressive_buy,stock.aggressive),action=signal(stock,current);
    return `<article class="market-follow-card"><div class="market-follow-main"><div class="market-follow-company">${logoHTML(symbol)}<div><b>${esc(meta.displayName)}</b><span>${esc(symbol)} • ${esc(meta.description)}</span></div></div><div class="market-follow-price"><b>${money(current)}</b><span class="${tone(dayPct)}">${signedPct(dayPct)}</span></div><div class="market-follow-signal ${action.includes('BUY')?'buy':''}">${action}</div></div><div class="market-follow-levels"><div><span>Buy</span><b>${money(buy)}</b></div><div><span>Strong Buy</span><b>${money(strong)}</b></div><div><span>Aggressive</span><b>${money(agg)}</b></div></div><div class="market-follow-note">${esc(stock.note||'Following for a better entry.')}</div></article>`;
  }

  function followedStocks(stocks,positions){
    const owned=new Set((positions||[]).filter(p=>Number(p.quantity)>0).map(p=>String(p.symbol||'').toUpperCase()));
    return (stocks||[]).filter(stock=>{
      const symbol=String(stock.symbol||'').toUpperCase();
      if(!symbol||owned.has(symbol)||stock.owned||Number(stock.position_usd)>0)return false;
      return Number.isFinite(num(stock.buy,stock.strong_buy,stock.strong,stock.aggressive_buy,stock.aggressive))||!!stock.note;
    });
  }

  function updateRotation(extraPortfolioNames=[]){
    try{
      if(typeof cfg==='undefined'||!Array.isArray(cfg.screens))return;
      const active=document.querySelector('.screen.active')?.dataset.screen||'';
      const wanted=['stocks',...extraPortfolioNames,'markets','activity','home','water','power','thesis'];
      const available=wanted.filter(name=>document.querySelector(`.screen[data-screen="${name}"]`));
      const signature=available.join('|');
      const wasEnabled=!!cfg.rotation_enabled;
      const changed=signature!==lastRotationSignature||cfg.screens.length!==available.length||cfg.screens.some((x,i)=>x!==available[i]);
      cfg.rotation_enabled=true;
      if(changed){
        cfg.screens=available;
        const keep=active?cfg.screens.indexOf(active):-1;
        if(typeof idx!=='undefined')idx=keep>=0?keep:0;
        if(typeof buildDots==='function')buildDots();
        lastRotationSignature=signature;
      }
      if((changed||!wasEnabled)&&typeof schedule==='function')schedule();
    }catch(e){console.warn('rotation update',e)}
  }

  async function refresh(){
    const base=ensurePortfolioRoot(),marketsRoot=ensureMarketsRoot();
    if(!base||!marketsRoot)return;
    const [webull,quotesResult,stocks]=await Promise.all([getJSON('/api/webull/summary',{positions:[]}),getJSON('/api/quotes',{quotes:{}}),getJSON('/api/stocks',[])]);
    const positions=(webull.positions||[]).filter(p=>Number(p.quantity)>0),qmap=quotesResult.quotes||{},followed=followedStocks(stocks,positions);
    await loadCharts(positions.map(p=>String(p.symbol||'').toUpperCase()));

    base.summary.innerHTML=renderSummary(positions,qmap);
    const chunks=[];for(let i=0;i<positions.length;i+=MAX_OWNED_PER_PAGE)chunks.push(positions.slice(i,i+MAX_OWNED_PER_PAGE));
    if(!chunks.length)chunks.push([]);

    const first=chunks[0];
    setPortfolioLayout(base.root,first.length);
    base.root.innerHTML=first.length?first.map(p=>renderOwnedCard(p,qmap[String(p.symbol||'').toUpperCase()]||{})).join(''):'<div class="owned-empty"><b>No owned positions found.</b><span>Waiting for Webull position data.</span></div>';

    const continuations=ensureOwnedContinuationPages(chunks.length);
    continuations.forEach((page,index)=>{
      const rows=chunks[index+1]||[];
      setPortfolioLayout(page.root,rows.length);
      page.root.innerHTML=rows.map(p=>renderOwnedCard(p,qmap[String(p.symbol||'').toUpperCase()]||{})).join('');
    });

    setMarketsLayout(marketsRoot,followed.length);
    marketsRoot.innerHTML=followed.length?followed.map(s=>renderMarketCard(s,qmap[String(s.symbol||'').toUpperCase()]||{})).join(''):'<div class="markets-empty"><b>No followed stocks configured.</b><span>Stocks with stored entry levels appear here automatically.</span></div>';
    updateRotation(continuations.map(p=>p.name));
  }

  function boot(){
    ensurePortfolioRoot();ensureMarketsRoot();relabelPortfolio();
    setTimeout(refresh,350);
    setInterval(refresh,REFRESH_MS);
    document.addEventListener('farm-screen-change',e=>{if(String(e.detail?.screen||'').startsWith('portfolio')||e.detail?.screen==='stocks'||e.detail?.screen==='markets')setTimeout(refresh,80)});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();