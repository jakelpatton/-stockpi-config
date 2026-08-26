(() => {
  const REFRESH_MS = 15000;
  const CHART_REFRESH_MS = 60000;
  let lastChartFetch = 0;
  const chartCache = new Map();

  // User-facing names intentionally override broker/provider naming.
  const IDENTITY = {
    EXE: {name:'Chesapeake Energy', domain:'chesapeakeenergy.com'},
    TEL: {name:'TE Connectivity', domain:'te.com'},
    CMI: {name:'Cummins', domain:'cummins.com'},
    ADI: {name:'Analog Devices', domain:'analog.com'},
    AEIS:{name:'Advanced Energy Industries',domain:'advancedenergy.com'},
    ALAB:{name:'Astera Labs',domain:'asteralabs.com'},
    AMAT:{name:'Applied Materials',domain:'appliedmaterials.com'},
    ASML:{name:'ASML Holding',domain:'asml.com'},
    GNRC:{name:'Generac',domain:'generac.com'},
    KLAC:{name:'KLA',domain:'kla.com'},
    LRCX:{name:'Lam Research',domain:'lamresearch.com'},
    NVDA:{name:'NVIDIA',domain:'nvidia.com'},
    POWL:{name:'Powell Industries',domain:'powellind.com'},
    TER:{name:'Teradyne',domain:'teradyne.com'}
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (...values) => { for (const value of values) { const n = Number(value); if (Number.isFinite(n)) return n; } return NaN; };
  const money = value => { const n=Number(value); return Number.isFinite(n) ? n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; };
  const signedMoney = value => { const n=Number(value); return Number.isFinite(n) ? `${n>=0?'+':'-'}${money(Math.abs(n))}` : '—'; };
  const signedPct = value => { const n=Number(value); return Number.isFinite(n) ? `${n>=0?'↑ ':'↓ '}${Math.abs(n).toFixed(2)}%` : '—'; };
  const shares = value => { const n=Number(value); return Number.isFinite(n) ? n.toFixed(n<10?5:2).replace(/0+$/,'').replace(/\.$/,'') : '—'; };
  const tone = value => { const n=Number(value); return !Number.isFinite(n)?'flat':n>0?'up':n<0?'down':'flat'; };
  const identity = symbol => IDENTITY[symbol] || {name:symbol,domain:null};

  async function getJSON(url,fallback){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}
  }

  function logoHTML(symbol){
    const meta=identity(symbol);
    const src=meta.domain?`https://icons.duckduckgo.com/ip3/${encodeURIComponent(meta.domain)}.ico`:'';
    return `<span class="owned-logo"><span class="owned-logo-letter">${esc(symbol.slice(0,1))}</span>${src?`<img src="${src}" alt="${esc(meta.name)} logo" referrerpolicy="no-referrer" onerror="this.style.display='none'">`:''}</span>`;
  }

  function ensureRoot(){
    const stocks=document.querySelector('.screen[data-screen="stocks"]');
    if(!stocks)return null;
    document.getElementById('rows')?.classList.add('owned-legacy-hidden');
    document.getElementById('portfolioFocusRows')?.classList.add('owned-legacy-hidden');
    let root=document.getElementById('ownedPositionCards');
    if(root)return root;
    root=document.createElement('section');
    root.id='ownedPositionCards';
    root.className='owned-position-grid';
    const anchor=document.getElementById('portfolioFocusRows')||document.getElementById('rows')||document.getElementById('portfolioPanel')||stocks.querySelector('.screen-heading');
    anchor?.insertAdjacentElement('afterend',root);
    return root;
  }

  function configureGrid(root,count){
    let cols=1;
    if(count===2)cols=2;
    else if(count===3)cols=3;
    else if(count===4)cols=2;
    else if(count<=6)cols=3;
    else if(count<=8)cols=4;
    else if(count<=12)cols=4;
    else cols=5;
    const rows=Math.max(1,Math.ceil(count/cols));
    root.style.setProperty('--owned-cols',String(cols));
    root.style.setProperty('--owned-rows',String(rows));
    root.dataset.count=String(count);
    root.dataset.density=count<=3?'roomy':count<=6?'normal':count<=8?'compact':'dense';
  }

  function sparkline(points,cls){
    const vals=(points||[]).map(Number).filter(Number.isFinite);
    if(vals.length<2)return `<div class="owned-chart-empty">DAY CHART • collecting data</div>`;
    const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
    const coords=vals.map((v,i)=>{
      const x=vals.length===1?0:(i/(vals.length-1))*100;
      const y=26-((v-min)/span)*22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return `<svg class="owned-sparkline ${cls}" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Intraday price chart"><polyline points="${coords}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  async function loadCharts(symbols){
    const now=Date.now();
    if(now-lastChartFetch<CHART_REFRESH_MS && symbols.every(s=>chartCache.has(s)))return;
    lastChartFetch=now;
    await Promise.all(symbols.map(async symbol=>{
      const data=await getJSON(`${location.protocol}//${location.hostname}:8092/api/chart/${encodeURIComponent(symbol)}`,null);
      if(data&&Array.isArray(data.points)&&data.points.length)chartCache.set(symbol,data.points);
    }));
  }

  function renderCard(position,quote){
    const symbol=String(position.symbol||'').toUpperCase();
    const meta=identity(symbol);
    const current=num(quote?.price,position.last_price);
    const quantity=num(position.quantity);
    const avg=num(position.average_cost);
    const invested=num(position.cost_basis,Number.isFinite(quantity)&&Number.isFinite(avg)?quantity*avg:NaN);
    const value=num(position.market_value,Number.isFinite(quantity)&&Number.isFinite(current)?quantity*current:NaN);
    const totalPL=num(position.unrealized_pl,Number.isFinite(value)&&Number.isFinite(invested)?value-invested:NaN);
    const totalPct=num(position.unrealized_pct,Number.isFinite(totalPL)&&invested?totalPL/invested*100:NaN);
    const prev=num(quote?.prev_close);
    const dayPct=num(quote?.pct,Number.isFinite(current)&&Number.isFinite(prev)&&prev?(current-prev)/prev*100:NaN);
    const dayPL=num(position.day_pl,Number.isFinite(dayPct)&&Number.isFinite(value)?value*(dayPct/100):NaN);
    const gain=Number.isFinite(totalPL)&&totalPL>=0;
    const resultWord=gain?'Gain':'Loss';
    const percentLabel=gain?'Total gain %':'Total loss %';
    const cardTone=tone(totalPL);
    const chartTone=tone(dayPct);

    return `<article class="owned-investment-card ${cardTone}">
      <header class="owned-card-head">
        <div class="owned-company">${logoHTML(symbol)}<div><b>${esc(meta.name)}</b><span>${esc(symbol)}</span></div></div>
        <div class="owned-current"><b>${money(current)}</b><span class="${chartTone}">${signedPct(dayPct)}</span></div>
      </header>

      <div class="owned-chart-wrap">
        ${sparkline(chartCache.get(symbol),chartTone)}
        <div class="owned-chart-caption"><span>1D</span><span>${Number.isFinite(dayPL)?`${signedMoney(dayPL)} today`:'Today'}</span></div>
      </div>

      <div class="owned-investment-title">My investment</div>
      <div class="owned-investment-hero">
        <div><b>${money(invested)}</b><span>Total invested</span></div>
        <div class="owned-result ${cardTone}"><b>${signedMoney(totalPL)}</b><span>${resultWord}</span></div>
      </div>

      <div class="owned-detail-list">
        <div><span>Total value $</span><b>${money(value)}</b></div>
        <div><span>${percentLabel}</span><b class="${cardTone}">${signedPct(totalPct)}</b></div>
        <div><span>Shares owned</span><b>${shares(quantity)}</b></div>
        <div><span>Average cost per share</span><b>${money(avg)}</b></div>
        <div><span>Current share price</span><b>${money(current)}</b></div>
      </div>
    </article>`;
  }

  async function refresh(){
    const root=ensureRoot();
    if(!root)return;
    const [webull,quotesResult]=await Promise.all([
      getJSON('/api/webull/summary',{positions:[],connected:false}),
      getJSON('/api/quotes',{quotes:{}})
    ]);
    const positions=(webull.positions||[]).filter(p=>Number(p.quantity)>0);
    configureGrid(root,positions.length);
    if(!positions.length){
      root.innerHTML='<div class="owned-empty"><b>No owned positions found.</b><span>Waiting for the Webull account position feed.</span></div>';
      return;
    }
    await loadCharts(positions.map(p=>String(p.symbol||'').toUpperCase()));
    const qmap=quotesResult.quotes||{};
    root.innerHTML=positions.map(p=>renderCard(p,qmap[String(p.symbol||'').toUpperCase()]||{})).join('');
  }

  function boot(){
    ensureRoot();
    setTimeout(refresh,500);
    setInterval(refresh,REFRESH_MS);
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>{
      if(document.querySelector('.screen.active')?.dataset.screen==='stocks')setTimeout(refresh,100);
    }).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
