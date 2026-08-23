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

  function boot(){makeCard();updatePropane();setInterval(updatePropane,15000)}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
