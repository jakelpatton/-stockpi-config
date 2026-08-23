(() => {
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
        <span class="propane-demo" id="propaneDemo">DEMO</span>
      </div>
      <div class="propane-visual">
        <div class="propane-tank-wrap">
          <div class="propane-cap"></div>
          <div class="propane-tank"><div class="propane-fill"></div></div>
        </div>
        <div class="propane-gauge"><strong id="propaneLevel">—</strong><span>LEVEL</span></div>
      </div>
      <div class="propane-detail">
        <div><span>Status</span><b id="propaneStatus" class="propane-status">—</b></div>
        <div><span>Estimated Fuel</span><b id="propaneGallons">Tank size TBD</b></div>
        <div><span>Runtime Estimate</span><b id="propaneDays">Learning usage</b></div>
        <div><span>Low Alert</span><b id="propaneAlert">25%</b></div>
      </div>`;
    grid.appendChild(card);
  }

  function statusFor(level){
    if(level==null) return ['Sensor pending','watch','#c08a2f'];
    if(level<15) return ['Low','low','#cc4e52'];
    if(level<25) return ['Refill soon','watch','#c08a2f'];
    if(level<40) return ['Watch','watch','#c08a2f'];
    return ['Normal','good','#4f9a5a'];
  }

  function fmt(v,suffix=''){return v==null?'—':`${v}${suffix}`}

  async function updatePropane(){
    try{
      const h=await fetch('/api/home').then(r=>r.json());
      const p=h.propane||{};
      const level=Number.isFinite(Number(p.level))?Number(p.level):null;
      const [status,cls,color]=statusFor(level);
      const card=document.getElementById('propaneCard');
      if(!card) return;
      card.style.setProperty('--level',level??0);
      card.style.setProperty('--gauge-color',color);
      document.getElementById('propaneLevel').textContent=level==null?'—':`${Math.round(level)}%`;
      const statusEl=document.getElementById('propaneStatus');
      statusEl.textContent=p.status||status;
      statusEl.className=`propane-status ${cls}`;
      document.getElementById('propaneGallons').textContent=p.estimated_gallons==null ? (p.tank_capacity_gal?`Capacity ${p.tank_capacity_gal} gal`:'Tank size TBD') : `${Math.round(p.estimated_gallons)} gal`;
      document.getElementById('propaneDays').textContent=p.days_remaining==null ? 'Learning usage' : `~${Math.round(p.days_remaining)} days`;
      document.getElementById('propaneAlert').textContent=fmt(p.low_alert_pct??25,'%');
      const demo=document.getElementById('propaneDemo');
      if(p.demo===false){demo.textContent='LIVE';demo.classList.add('live');} else {demo.textContent='DEMO';}
    }catch(e){
      const s=document.getElementById('propaneStatus');
      if(s){s.textContent='Awaiting sensor';s.className='propane-status watch';}
    }
  }

  function boot(){makeCard();updatePropane();setInterval(updatePropane,15000)}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
