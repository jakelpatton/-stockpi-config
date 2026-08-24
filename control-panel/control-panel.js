(() => {
  const API_BASE = '';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let lastHome = null;

  function show(view){
    $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));
    $$('.ribbon [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));
  }

  function toast(msg){
    const t=$('#toast');
    if(!t) return;
    t.textContent=msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2200);
  }

  function clock(){
    const d=new Date();
    $('#clock').textContent=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    $('#date').textContent=d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
  }

  function setText(sel,val){ const el=$(sel); if(el && val!==undefined && val!==null) el.textContent=val; }

  function bindHome(h){
    lastHome=h;
    const main=h.main||{}, water=h.water?.main||{}, leaks=h.water?.leaks||{}, gate=h.gate||{}, p=h.propane||{}, e=h.electrical||{}, wh=h.wellhouse||{}, rh=h.rockhouse||{};
    setText('#homeTemp', main.upstairs!=null ? `${Math.round(main.upstairs)}°` : undefined);
    setText('#climateCurrent', main.upstairs!=null ? `${Math.round(main.upstairs)}°` : undefined);
    setText('#homePressure', water.pressure);
    setText('#waterPressure', water.pressure);
    setText('#waterFlow', water.flow);
    setText('#waterToday', water.today);
    const leakStates=[leaks.main,leaks.rockhouse,leaks.wellhouse].filter(Boolean);
    const dry=leakStates.length ? leakStates.every(x=>String(x).toLowerCase()==='dry') : true;
    setText('#homeLeaks', dry ? 'No leaks' : 'Check leak');
    setText('#waterLeaks', dry ? 'DRY' : 'CHECK');
    setText('#waterHeadline', dry ? 'Normal' : 'Leak Alert');
    setText('#homeGate', gate.state);
    setText('#gateState', gate.state);
    setText('#gateLargeState', gate.state);
    setText('#homeGateNetwork', gate.network);
    setText('#gateLast', gate.last_event ? `Last event: ${gate.last_event}` : undefined);
    setText('#sysPropane', p.level!=null ? `${Math.round(p.level)}%` : undefined);
    setText('#sysPropaneGallons', p.estimated_gallons!=null ? `${Math.round(p.estimated_gallons)} gal` : undefined);
    setText('#sysPower', e.main_load_kw!=null ? `${e.main_load_kw} kW` : undefined);
    setText('#sysWell', wh.pump);
    setText('#sysWellVoltage', wh.voltage!=null ? `${wh.voltage} V` : undefined);
    setText('#sysRockTemp', rh.temp!=null ? `${rh.temp}°` : undefined);
  }

  async function refresh(){
    try{
      const r=await fetch(`${API_BASE}/api/home`,{cache:'no-store'});
      if(!r.ok) throw new Error('Farm API unavailable');
      bindHome(await r.json());
      setText('#connection','Farm data • connected');
    }catch(e){
      setText('#connection','Farm data • preview mode');
    }
  }

  function control(action){
    // Visual shell only. Actual writes will be mapped to Home Assistant entities.
    // This intentionally prevents the concept UI from changing live property state.
    if(action==='water-off') return toast('Water shutoff • Home Assistant mapping required');
    if(action==='gate-open' || action==='gate-close') return toast('Gate control • Home Assistant mapping required');
    if(action==='temp-up' || action==='temp-down' || action.startsWith('mode-')) return toast('Upstairs Thermostat • Home Assistant mapping required');
    if(action.startsWith('light-')) return toast('Caséta lighting • Home Assistant mapping required');
    if(action==='goodnight') return toast('Goodnight scene • Home Assistant mapping required');
    toast('Control mapping pending');
  }

  function boot(){
    $$('[data-nav]').forEach(el=>el.addEventListener('click',()=>show(el.dataset.nav)));
    $$('[data-action]').forEach(el=>el.addEventListener('click',()=>control(el.dataset.action)));
    clock(); setInterval(clock,10000);
    refresh(); setInterval(refresh,15000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
