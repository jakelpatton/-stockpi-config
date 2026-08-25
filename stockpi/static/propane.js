(() => {
  const PLACEHOLDER = {
    level: 67,
    status: 'Normal',
    tank_capacity_gal: 500,
    estimated_gallons: 335,
    burn_rate_gpd: 6.4,
    days_remaining: 52,
    low_alert_pct: 25
  };

  function makeCard(){
    const grid=document.querySelector('.overview-grid');
    if(!grid || document.getElementById('propaneCard')) return;
    grid.classList.add('has-propane');
    const card=document.createElement('article');
    card.id='propaneCard';
    card.className='propane-card panel';
    card.innerHTML=`
      <div class="propane-head">
        <div><div class="panel-title blue">PROPANE</div><small>Outdoor storage tank</small></div>
        <div class="propane-level-label">TANK LEVEL</div>
      </div>
      <div class="propane-visual">
        <div class="propane-tank-wrap">
          <div class="propane-cap"></div>
          <div class="propane-tank"><div class="propane-fill"></div></div>
        </div>
        <div class="propane-gauge"><strong id="propaneLevel">67%</strong><span>LEVEL</span></div>
      </div>
      <div class="propane-detail">
        <div><span>Status</span><b id="propaneStatus" class="propane-status good">Normal</b></div>
        <div><span>Estimated Fuel</span><b id="propaneGallons">335 gal</b></div>
        <div><span>Estimated Remaining</span><b id="propaneDays">~52 days</b></div>
        <div><span>Usage Trend</span><b id="propaneBurn">6.4 gal/day</b></div>
        <div><span>Refill Alert</span><b id="propaneAlert">25%</b></div>
      </div>`;
    grid.appendChild(card);
  }

  function statusFor(level){
    if(level<15) return ['Low','low','#cc4e52'];
    if(level<25) return ['Refill soon','watch','#c08a2f'];
    if(level<40) return ['Watch','watch','#c08a2f'];
    return ['Normal','good','#4f9a5a'];
  }

  async function updatePropane(){
    let p={...PLACEHOLDER};
    try{
      const h=await fetch('/api/home').then(r=>r.json());
      if(h.propane && h.propane.demo===false){
        p={...PLACEHOLDER,...h.propane};
      }
    }catch(e){}

    const level=Number.isFinite(Number(p.level))?Number(p.level):PLACEHOLDER.level;
    const [derivedStatus,cls,color]=statusFor(level);
    const card=document.getElementById('propaneCard');
    if(!card) return;

    card.style.setProperty('--level',level);
    card.style.setProperty('--gauge-color',color);
    document.getElementById('propaneLevel').textContent=`${Math.round(level)}%`;
    const statusEl=document.getElementById('propaneStatus');
    statusEl.textContent=p.status||derivedStatus;
    statusEl.className=`propane-status ${cls}`;
    document.getElementById('propaneGallons').textContent=`${Math.round(p.estimated_gallons ?? PLACEHOLDER.estimated_gallons)} gal`;
    document.getElementById('propaneDays').textContent=`~${Math.round(p.days_remaining ?? PLACEHOLDER.days_remaining)} days`;
    document.getElementById('propaneBurn').textContent=`${Number(p.burn_rate_gpd ?? PLACEHOLDER.burn_rate_gpd).toFixed(1)} gal/day`;
    document.getElementById('propaneAlert').textContent=`${p.low_alert_pct ?? PLACEHOLDER.low_alert_pct}%`;
  }

  function loadCameraModule(){
    if(document.querySelector('script[src="/static/cameras.js"]')) return;
    const s=document.createElement('script');
    s.src='/static/cameras.js';
    s.defer=true;
    document.body.appendChild(s);
  }

  function boot(){makeCard();updatePropane();loadCameraModule();setInterval(updatePropane,15000)}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

/* Owned stock portfolio summary for the Stocks screen. */
(() => {
  let ownedSymbols=new Set();

  const fm=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const signedMoney=v=>`${v>=0?'+':'-'}$${Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const signedPct=v=>`${v>=0?'+':''}${Number(v).toFixed(2)}%`;

  function ensurePortfolioPanel(){
    const rows=document.getElementById('rows');
    const screen=document.querySelector('.screen[data-screen="stocks"]');
    if(!rows||!screen||document.getElementById('portfolioPanel')) return;
    const panel=document.createElement('div');
    panel.id='portfolioPanel';
    panel.className='portfolio-panel';
    panel.innerHTML=`
      <div class="portfolio-top">
        <div class="portfolio-title">PORTFOLIO</div>
        <div id="portfolioTotals" class="portfolio-totals">Loading positions…</div>
      </div>
      <div id="portfolioHoldings" class="portfolio-holdings"></div>
      <div class="portfolio-watch-label">WATCHLIST</div>`;
    screen.insertBefore(panel,rows);
  }

  function hideOwnedRows(){
    const rows=document.getElementById('rows');
    if(!rows) return;
    rows.querySelectorAll('.stock').forEach(row=>{
      const sym=row.querySelector('.symbol')?.textContent?.trim().toUpperCase();
      row.style.display=ownedSymbols.has(sym)?'none':'grid';
    });
  }

  async function updatePortfolio(){
    ensurePortfolioPanel();
    try{
      const [qs,ss]=await Promise.all([
        fetch('/api/quotes',{cache:'no-store'}).then(r=>r.json()),
        fetch('/api/stocks',{cache:'no-store'}).then(r=>r.json())
      ]);
      const owned=ss.filter(s=>s.owned||Number(s.position_usd)>0);
      ownedSymbols=new Set(owned.map(s=>String(s.symbol||'').toUpperCase()));
      let totalCost=0,totalValue=0,totalPL=0,pricedCount=0;

      const cards=owned.map(s=>{
        const q=qs.quotes?.[s.symbol]||{};
        const cost=Number(s.position_usd)||0;
        const avg=Number(s.average_cost);
        const configuredShares=Number(s.shares_estimate);
        const shares=Number.isFinite(configuredShares)&&configuredShares>0?configuredShares:(Number.isFinite(avg)&&avg>0?cost/avg:NaN);
        const current=Number(q.price);
        const exact=Number.isFinite(avg)&&avg>0&&Number.isFinite(shares)&&shares>0&&Number.isFinite(current)&&current>0;
        totalCost+=cost;
        let value=null,pl=null,pct=null;
        if(exact){
          value=shares*current;
          pl=value-cost;
          pct=cost?pl/cost*100:0;
          totalValue+=value;
          totalPL+=pl;
          pricedCount++;
        }
        const cls=exact?(pl>=0?'portfolio-positive':'portfolio-negative'):'portfolio-pending';
        return `<div class="portfolio-position-card">
          <div class="portfolio-symbol">${s.symbol}</div>
          <div class="portfolio-details">
            <div class="portfolio-metric"><span>PURCHASE</span><b>${Number.isFinite(avg)&&avg>0?fm(avg):'Basis pending'}</b></div>
            <div class="portfolio-metric"><span>CURRENT</span><b>${Number.isFinite(current)&&current>0?fm(current):'—'}</b></div>
            <div class="portfolio-metric"><span>VALUE</span><b>${exact?fm(value):fm(cost)+' invested'}</b></div>
          </div>
          <div class="portfolio-pl ${cls}">${exact?signedMoney(pl):'P/L pending'}<small>${exact?signedPct(pct):'cost basis needed'}</small></div>
        </div>`;
      }).join('');

      const pct=totalCost?totalPL/totalCost*100:0;
      const pcls=totalPL>=0?'portfolio-positive':'portfolio-negative';
      const holdings=document.getElementById('portfolioHoldings');
      const totals=document.getElementById('portfolioTotals');
      if(holdings) holdings.innerHTML=cards||'<div class="muted">No owned positions recorded.</div>';
      if(totals){
        if(pricedCount===owned.length){
          totals.innerHTML=`<span>Cost <b>${fm(totalCost)}</b></span><span>Value <b>${fm(totalValue)}</b></span><span>P/L <b class="${pcls}">${signedMoney(totalPL)} (${signedPct(pct)})</b></span>`;
        }else{
          totals.innerHTML=`<span>Invested <b>${fm(totalCost)}</b></span><span>Known value <b>${fm(totalValue)}</b></span><span>Known P/L <b class="${pcls}">${signedMoney(totalPL)}</b></span>`;
        }
      }
      hideOwnedRows();
    }catch(e){}
  }

  function bootPortfolio(){
    ensurePortfolioPanel();
    const rows=document.getElementById('rows');
    if(rows) new MutationObserver(hideOwnedRows).observe(rows,{childList:true});
    updatePortfolio();
    setInterval(updatePortfolio,5000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootPortfolio); else bootPortfolio();
})();
