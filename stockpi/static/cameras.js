(() => {
  const CAMERAS = [
    {channel:1, name:'Front Porch', location:'Main House'},
    {channel:2, name:'Rockhouse Front', location:'Rockhouse'},
    {channel:3, name:'Rockhouse Back', location:'Rockhouse'},
    {channel:4, name:'Farm Backyard', location:'Wyze Floodlight Pro • 192.168.1.253', disabled:true, wyze:true}
  ];
  const REFRESH_MS = 1200;
  let timer=null, portfolioTimer=null;

  function addStyle(href){
    if(!document.querySelector(`link[href="${href}"]`)){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l)}
  }
  function addScript(src){
    if(!document.querySelector(`script[src="${src}"]`)){const s=document.createElement('script');s.src=src;s.defer=true;document.body.appendChild(s)}
  }
  function ensureStyles(){
    addStyle('/static/cameras.css');
    addStyle('/static/thesis.css');
    addStyle('/static/thesis-summary.css');
    addStyle('/static/tv-fit.css');
    addScript('/static/thesis.js');
    if(!document.getElementById('portfolioStyles')){
      const s=document.createElement('style'); s.id='portfolioStyles'; s.textContent=`
        .portfolio-panel{margin:0 0 14px;padding:14px 16px;border:1px solid rgba(100,116,139,.22);border-radius:16px;background:rgba(255,255,255,.72);box-shadow:0 8px 28px rgba(15,23,42,.06)}
        .portfolio-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:10px}.portfolio-head h3{margin:2px 0 0;font-size:22px}.portfolio-head .eyebrow{font-size:10px;letter-spacing:.14em;font-weight:800;color:#64748b}
        .portfolio-total{text-align:right}.portfolio-total span{display:block;font-size:10px;letter-spacing:.1em;color:#64748b;font-weight:800}.portfolio-total b{font-size:24px}.portfolio-total em{display:block;font-style:normal;font-weight:800;font-size:13px;margin-top:2px}
        .portfolio-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.portfolio-position{padding:11px 12px;border-radius:12px;background:rgba(248,250,252,.9);border:1px solid rgba(148,163,184,.2)}
        .portfolio-symbol{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.portfolio-symbol b{font-size:18px}.portfolio-symbol small{font-weight:800;color:#64748b}.portfolio-metrics{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px}.portfolio-metrics span{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.portfolio-metrics b{display:block;font-size:13px;color:#0f172a}.portfolio-pl{grid-column:1/-1;margin-top:3px;padding-top:6px;border-top:1px solid rgba(148,163,184,.18)}
        .portfolio-up{color:#15803d!important}.portfolio-down{color:#b91c1c!important}.portfolio-flat{color:#475569!important}.portfolio-note{font-size:10px;color:#64748b;margin-top:7px}
        @media(max-width:900px){.portfolio-grid{grid-template-columns:1fr}.portfolio-head{align-items:flex-start}.portfolio-total b{font-size:20px}}
      `; document.head.appendChild(s);
    }
    /* Estate theme must be last so it intentionally overrides legacy dashboard styles. */
    addStyle('/static/estate-tv.css');
    addScript('/static/estate-tv.js');
  }

  function money(v){return Number.isFinite(v)?v.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'}
  function signedMoney(v){if(!Number.isFinite(v))return '—'; return `${v>=0?'+':'-'}${money(Math.abs(v))}`}
  function signedPct(v){if(!Number.isFinite(v))return '—'; return `${v>=0?'+':''}${v.toFixed(2)}%`}
  function plClass(v){return !Number.isFinite(v)?'portfolio-flat':v>0?'portfolio-up':v<0?'portfolio-down':'portfolio-flat'}

  function makePortfolio(){
    const screen=document.querySelector('[data-screen="stocks"]'); const rows=document.getElementById('rows');
    if(!screen||!rows||document.getElementById('portfolioPanel')) return;
    const p=document.createElement('article'); p.id='portfolioPanel'; p.className='portfolio-panel';
    p.innerHTML=`<div class="portfolio-head"><div><div class="eyebrow">OWNED POSITIONS</div><h3>Portfolio</h3></div><div class="portfolio-total"><span>TOTAL MARKET VALUE</span><b id="portfolioValue">—</b><em id="portfolioPL" class="portfolio-flat">Loading…</em></div></div><div class="portfolio-grid" id="portfolioGrid"></div>`;
    rows.parentNode.insertBefore(p,rows);
  }

  async function refreshPortfolio(){
    const panel=document.getElementById('portfolioPanel'); if(!panel) return;
    try{
      const [stocksData,quotesData]=await Promise.all([fetch('/api/stocks',{cache:'no-store'}).then(r=>r.json()),fetch('/api/quotes',{cache:'no-store'}).then(r=>r.json())]);
      const owned=(stocksData||[]).filter(s=>s.owned||Number(s.position_usd)>0); const quotes=quotesData.quotes||{}; const grid=document.getElementById('portfolioGrid');
      let totalValue=0,totalCost=0,complete=true;
      grid.innerHTML=owned.map(s=>{
        const q=quotes[s.symbol]||{}; const current=Number(q.price); const cost=Number(s.position_usd)||0; const avg=Number(s.average_cost); let shares=Number(s.shares_estimate);
        if(!Number.isFinite(shares)&&Number.isFinite(avg)&&avg>0) shares=cost/avg;
        const canValue=Number.isFinite(current)&&Number.isFinite(shares)&&shares>0; const value=canValue?shares*current:NaN; const pl=canValue?value-cost:NaN; const pct=canValue&&cost>0?pl/cost*100:NaN;
        if(canValue){totalValue+=value;totalCost+=cost}else{complete=false}
        const cls=plClass(pl);
        return `<div class="portfolio-position"><div class="portfolio-symbol"><b>${s.symbol}</b><small>${Number.isFinite(shares)?shares.toFixed(4)+' sh':'$'+cost.toFixed(0)+' invested'}</small></div><div class="portfolio-metrics"><div><span>Purchase price</span><b>${Number.isFinite(avg)?money(avg):'Cost basis needed'}</b></div><div><span>Current price</span><b>${Number.isFinite(current)?money(current):'—'}</b></div><div><span>Market value</span><b>${money(value)}</b></div><div class="portfolio-pl"><span>Gain / Loss</span><b class="${cls}">${signedMoney(pl)} &nbsp; ${signedPct(pct)}</b></div></div>${!Number.isFinite(avg)?'<div class="portfolio-note">Add average purchase price to enable live value and P/L.</div>':''}</div>`;
      }).join('');
      const valueEl=document.getElementById('portfolioValue'),plEl=document.getElementById('portfolioPL');
      if(complete&&owned.length){const pl=totalValue-totalCost,pct=totalCost?pl/totalCost*100:0;valueEl.textContent=money(totalValue);plEl.textContent=`${signedMoney(pl)} • ${signedPct(pct)}`;plEl.className=plClass(pl)}
      else {valueEl.textContent=owned.length?money(totalValue)+' + pending':'—';plEl.textContent='EXE cost basis needed for full total';plEl.className='portfolio-flat'}
    }catch(e){const pl=document.getElementById('portfolioPL');if(pl)pl.textContent='Portfolio data unavailable'}
  }

  function makeScreen(){
    if(document.querySelector('[data-screen="cameras"]')) return;
    const main=document.querySelector('main.screens'); if(!main) return;
    const s=document.createElement('section'); s.className='screen'; s.dataset.screen='cameras';
    s.innerHTML=`
      <div class="camera-heading">
        <div><div class="eyebrow">SECURITY • LIVE VIEW</div><h2>Cameras</h2></div>
        <div class="camera-system-status"><span class="camera-dot" id="cameraDot"></span><div><b>Camera System</b><small id="cameraSystemText">Connecting to Amcrest NVR</small></div></div>
      </div>
      <div class="camera-grid" id="cameraGrid"></div>
      <div class="camera-footer"><span>3 Amcrest cameras • 1 Wyze camera</span><span>Farm security overview</span><span id="cameraUpdated">Connecting…</span></div>`;
    main.appendChild(s);

    const grid=document.getElementById('cameraGrid');
    CAMERAS.forEach(c=>{
      const tile=document.createElement('article'); tile.className='camera-tile panel';
      if(c.disabled) tile.classList.add('camera-unused');
      tile.innerHTML=c.disabled ? `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}"><div class="camera-placeholder-icon">◉</div><div class="camera-placeholder-copy"><b>${c.name}</b><span>Wyze bridge connection pending</span></div></div><div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill idle">WYZE</div></div>` : `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}"><div class="camera-placeholder-icon">◉</div><div class="camera-placeholder-copy"><b>${c.name}</b><span>Connecting to NVR channel ${c.channel}</span></div></div><img class="camera-feed" id="cameraFeed${c.channel}" alt="${c.name}"><div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill"><i></i> LIVE</div></div>`;
      grid.appendChild(tile);
      if(c.disabled) return;
      const img=tile.querySelector('.camera-feed');
      img.addEventListener('load',()=>{const p=document.getElementById(`cameraPlaceholder${c.channel}`);if(p)p.style.display='none';img.classList.add('loaded')});
      img.addEventListener('error',()=>{const p=document.getElementById(`cameraPlaceholder${c.channel}`);if(p)p.style.display='flex';img.classList.remove('loaded')});
    });
  }

  async function checkStatus(){try{const s=await fetch('/api/cameras/status',{cache:'no-store'}).then(r=>r.json());const text=document.getElementById('cameraSystemText');const dot=document.getElementById('cameraDot');if(s.configured){text.textContent=`Amcrest NVR ${s.nvr_ip} • channels 1–3`;dot?.classList.add('online')}else{text.textContent='Amcrest credentials needed on Pi';dot?.classList.remove('online')}}catch(e){}}

  function refreshFrames(){const active=document.querySelector('.screen.active')?.dataset.screen==='cameras';if(!active)return;const stamp=Date.now();CAMERAS.filter(c=>!c.disabled).forEach(c=>{const img=document.getElementById(`cameraFeed${c.channel}`);if(img)img.src=`/api/cameras/snapshot/${c.channel}?t=${stamp}`});const u=document.getElementById('cameraUpdated');if(u)u.textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}

  function patchScreenName(){const map={stocks:'Portfolio & Markets',thesis:'Sunday Market Review',home:'Estate Overview',water:'Water & Leak Watch',power:'Energy & Electrical',cameras:'Security & Cameras'};const obs=new MutationObserver(()=>{const active=document.querySelector('.screen.active');const el=document.getElementById('screenName');if(active&&el&&map[active.dataset.screen])el.textContent=map[active.dataset.screen];if(active?.dataset.screen==='cameras')refreshFrames();if(active?.dataset.screen==='stocks')refreshPortfolio()});const main=document.querySelector('main.screens');if(main)obs.observe(main,{attributes:true,subtree:true,attributeFilter:['class']})}

  function boot(){ensureStyles();makePortfolio();makeScreen();patchScreenName();checkStatus();refreshFrames();refreshPortfolio();timer=setInterval(refreshFrames,REFRESH_MS);portfolioTimer=setInterval(refreshPortfolio,20000);setInterval(checkStatus,15000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
