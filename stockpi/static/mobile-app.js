(() => {
  'use strict';
  const HOUSE='/static/38C388BD-A21A-4A6D-9EC6-14B5CC26F7C1.png';
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
  const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  const pct=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(2)}%`:'—';
  const pick=(o,...keys)=>{for(const k of keys){if(o&&o[k]!=null)return o[k]}return null};
  let home=null, portfolio=null, powerCfg=null, dashCfg=null, toastTimer=null;

  function addMeta(name,content){let el=document.head.querySelector(`meta[name="${name}"]`);if(!el){el=document.createElement('meta');el.name=name;document.head.appendChild(el)}el.content=content}
  function prepareHead(){
    document.title='1838 Estate Mobile';
    addMeta('theme-color','#244b3a');
    addMeta('apple-mobile-web-app-capable','yes');
    addMeta('apple-mobile-web-app-status-bar-style','black-translucent');
    addMeta('apple-mobile-web-app-title','1838 Estate');
    let icon=document.head.querySelector('link[rel="apple-touch-icon"]');if(!icon){icon=document.createElement('link');icon.rel='apple-touch-icon';icon.href=HOUSE;document.head.appendChild(icon)}
    let manifest=document.head.querySelector('link[rel="manifest"]');if(!manifest){manifest=document.createElement('link');manifest.rel='manifest';manifest.href='/static/mobile-manifest.webmanifest';document.head.appendChild(manifest)}
  }

  function shell(){
    document.body.className='mobile-estate';
    document.body.innerHTML=`<div class="m-shell">
      <header class="m-top"><div class="m-brand"><img src="${HOUSE}" alt="1838 Estate"><div class="m-brand-copy"><div class="m-kicker">EST'D 1838 • MT. VERNON, MISSOURI</div><h1>1838 Estate</h1><div class="m-sub" id="mLast">Remote property dashboard</div></div><div class="m-online" id="mOnline"><i></i><span>Connecting</span></div></div></header>
      <main class="m-main">
        <div class="m-install" id="mInstall"><div><b>Add to Home Screen</b><br>In Safari, tap Share → Add to Home Screen for an app-like shortcut.</div><button aria-label="Dismiss">×</button></div>
        <div class="m-demo" id="mDemo">Some property sensor values are still demo/placeholders until their live integrations are connected.</div>
        <section class="m-section active" data-tab="estate">
          <div class="m-hero"><div class="m-hero-row"><div><div class="m-hero-label">PROPERTY STATUS</div><h2>Estate Overview</h2><div class="m-time" id="mClock">—</div></div><div class="m-weather"><b id="mTemp">—</b><span id="mWeather">Loading weather…</span></div></div></div>
          <div class="m-grid three">
            <article class="m-card"><div class="m-card-head"><span class="m-card-title">Main House</span><span class="m-chip" id="mMainChip">Climate</span></div><div class="m-big" id="mMainTemp">—</div><div class="m-pair"><div class="m-metric"><span>Upstairs</span><b id="mUpTemp">—</b></div><div class="m-metric"><span>Humidity</span><b id="mMainHum">—</b></div></div></article>
            <article class="m-card"><div class="m-card-head"><span class="m-card-title">Rockhouse</span><span class="m-chip">Online</span></div><div class="m-big" id="mRockTemp">—</div><div class="m-metric"><span>Humidity</span><b id="mRockHum">—</b></div></article>
            <article class="m-card"><div class="m-card-head"><span class="m-card-title">North Gate</span><span class="m-chip" id="mGateChip">—</span></div><div class="m-big" id="mGate">—</div><div class="m-pair"><div class="m-metric"><span>Battery</span><b id="mGateBat">—</b></div><div class="m-metric"><span>Network</span><b id="mGateNet">—</b></div></div></article>
            <article class="m-card full"><div class="m-card-head"><span class="m-card-title">Wellhouse</span><span class="m-chip" id="mPumpChip">—</span></div><div class="m-pair"><div><div class="m-big" id="mWellTemp">—</div><div class="m-sub">Temperature</div></div><div><div class="m-big" id="mWellVolt">—</div><div class="m-sub">Supply voltage</div></div></div></article>
            <article class="m-card full"><div class="m-card-head"><span class="m-card-title">Propane</span><span class="m-chip warn" id="mPropaneChip">Monitoring</span></div><div class="m-big" id="mPropane">—</div><div class="m-sub" id="mPropaneDetail">Tank monitoring status</div></article>
          </div>
        </section>
        <section class="m-section" data-tab="water">
          <div class="m-section-title"><h2>Water & Wells</h2><button class="m-refresh" data-refresh>Refresh</button></div>
          <div class="m-grid">
            <article class="m-card"><div class="m-card-head"><span class="m-card-title">Main House Well</span><span class="m-chip" id="mMainWaterChip">—</span></div><div class="m-big" id="mMainPressure">—</div><div class="m-sub">PSI</div><div class="m-pair"><div class="m-metric"><span>Flow</span><b id="mMainFlow">—</b></div><div class="m-metric"><span>Today</span><b id="mMainToday">—</b></div></div></article>
            <article class="m-card"><div class="m-card-head"><span class="m-card-title">Rockhouse Well</span><span class="m-chip" id="mRockWaterChip">—</span></div><div class="m-big" id="mRockPressure">—</div><div class="m-sub">PSI</div><div class="m-pair"><div class="m-metric"><span>Flow</span><b id="mRockFlow">—</b></div><div class="m-metric"><span>Today</span><b id="mRockToday">—</b></div></div></article>
            <article class="m-card full"><div class="m-card-head"><span class="m-card-title">Leak / Flood Sensors</span><span class="m-chip" id="mLeakChip">—</span></div><div class="m-list" id="mLeaks"><div class="m-row"><span>Loading</span><b>—</b></div></div></article>
            <article class="m-card full"><div class="m-card-head"><span class="m-card-title">Water Quality Notes</span></div><div class="m-list"><div class="m-row"><span>Main House</span><b id="mMainQuality">—</b></div><div class="m-row"><span>Rockhouse</span><b id="mRockQuality">—</b></div></div></article>
          </div>
        </section>
        <section class="m-section" data-tab="controls">
          <div class="m-section-title"><h2>Controls</h2><span>Protected by Cloudflare Access</span></div>
          <div class="m-control-group"><div class="m-control-title">Dashboard Display</div><article class="m-card"><div class="m-buttons"><button class="m-button primary" data-tv="on">Wake TV</button><button class="m-button" data-tv="input">Pi Input</button><button class="m-button danger" data-tv="standby">Standby</button></div></article></div>
          <div class="m-control-group"><div class="m-control-title">Display Schedule</div><article class="m-card"><div class="m-form"><div class="m-field"><div><label>Automatic schedule</label><small>Wake and sleep the estate display automatically</small></div><label class="m-toggle"><input id="mPowerEnabled" type="checkbox"><i></i></label></div><div class="m-field"><label>Wake time</label><input type="time" id="mWake"></div><div class="m-field"><label>Sleep time</label><input type="time" id="mSleep"></div><button class="m-button primary m-save" id="mSavePower">Save display schedule</button></div></article></div>
          <div class="m-control-group"><div class="m-control-title">Screen Rotation</div><article class="m-card"><div class="m-form"><div class="m-field"><div><label>Automatic rotation</label><small>Cycle through the wall dashboard screens</small></div><label class="m-toggle"><input id="mRotateEnabled" type="checkbox"><i></i></label></div><div class="m-field"><label>Normal interval</label><select id="mRotateSeconds"><option value="10">10 sec</option><option value="15">15 sec</option><option value="18">18 sec</option><option value="25">25 sec</option><option value="30">30 sec</option><option value="45">45 sec</option><option value="60">60 sec</option></select></div><button class="m-button primary m-save" id="mSaveRotation">Save rotation settings</button></div></article></div>
          <p class="m-note">High-impact property controls such as gate actuation are intentionally not exposed here until their live integrations and an additional confirmation/safety layer are in place.</p>
        </section>
        <section class="m-section" data-tab="portfolio">
          <div class="m-section-title"><h2>Portfolio</h2><button class="m-refresh" data-refresh>Refresh</button></div>
          <div class="m-grid">
            <article class="m-card"><div class="m-card-title">Account Value</div><div class="m-big" id="mPortValue">—</div><div class="m-sub">Webull</div></article>
            <article class="m-card"><div class="m-card-title">Cash</div><div class="m-big" id="mPortCash">—</div><div class="m-sub">Settled / available cash</div></article>
            <article class="m-card"><div class="m-card-title">Today's P&L</div><div class="m-big" id="mPortDay">—</div><div class="m-sub">Current session</div></article>
            <article class="m-card"><div class="m-card-title">Unrealized P&L</div><div class="m-big" id="mPortPL">—</div><div class="m-sub">Open positions</div></article>
            <article class="m-card full"><div class="m-card-head"><span class="m-card-title">Owned Positions</span><span class="m-chip" id="mPortStatus">Loading</span></div><div class="m-positions" id="mPositions"><div class="m-empty">Loading portfolio…</div></div></article>
          </div>
        </section>
      </main>
      <nav class="m-nav"><div class="m-nav-inner"><button class="active" data-go="estate"><i>⌂</i>Estate</button><button data-go="water"><i>◉</i>Water</button><button data-go="controls"><i>⌁</i>Controls</button><button data-go="portfolio"><i>▤</i>Portfolio</button></div></nav>
      <div class="m-toast" id="mToast"></div>
    </div>`;
  }

  function text(id,v){const e=$(id);if(e)e.textContent=v}
  function toast(msg){const e=$('#mToast');if(!e)return;e.textContent=msg;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),2200)}
  async function json(url,opt){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opt});if(!r.ok)throw new Error(`${r.status}`);return r.json()}
  function markOnline(ok){const e=$('#mOnline');if(!e)return;e.className='m-online'+(ok?'':' m-warn');e.querySelector('span').textContent=ok?'Online':'Offline'}

  function renderHome(d){
    home=d||{}; const w=home.weather||{}, main=home.main||{}, rock=home.rockhouse||{}, gate=home.gate||{}, wh=home.wellhouse||{}, water=home.water||{}, propane=home.propane||{};
    $('#mDemo')?.classList.toggle('show',!!home.demo||!!propane.demo);
    text('#mTemp',Number.isFinite(Number(w.temp))?`${num(w.temp,0)}°`:'—'); text('#mWeather',w.condition||'Weather unavailable');
    text('#mMainTemp',Number.isFinite(Number(main.downstairs))?`${num(main.downstairs)}°`:'—'); text('#mUpTemp',Number.isFinite(Number(main.upstairs))?`${num(main.upstairs)}°`:'—'); text('#mMainHum',Number.isFinite(Number(main.humidity))?`${num(main.humidity,0)}%`:'—');
    text('#mRockTemp',Number.isFinite(Number(rock.temp))?`${num(rock.temp)}°`:'—'); text('#mRockHum',Number.isFinite(Number(rock.humidity))?`${num(rock.humidity,0)}%`:'—');
    text('#mGate',gate.state||'—'); text('#mGateBat',Number.isFinite(Number(gate.battery))?`${num(gate.battery,1)} V`:'—'); text('#mGateNet',gate.network||'—'); text('#mGateChip',gate.state||'Gate');
    text('#mWellTemp',Number.isFinite(Number(wh.temp))?`${num(wh.temp,0)}°`:'—'); text('#mWellVolt',Number.isFinite(Number(wh.voltage))?`${num(wh.voltage,0)} V`:'—'); text('#mPumpChip',wh.pump||'—');
    text('#mPropane',Number.isFinite(Number(propane.level))?`${num(propane.level,0)}%`:'—'); text('#mPropaneDetail',propane.status||'Tank monitoring status'); text('#mPropaneChip',propane.demo?'Planned':(propane.status||'Monitoring'));
    const mw=water.main||{}, rw=water.rockhouse||{}, leaks=water.leaks||{};
    text('#mMainPressure',num(mw.pressure,0)); text('#mMainFlow',Number.isFinite(Number(mw.flow))?`${num(mw.flow,1)} gpm`:'—'); text('#mMainToday',Number.isFinite(Number(mw.today))?`${num(mw.today,0)} gal`:'—'); text('#mMainWaterChip',mw.filter||'—'); text('#mMainQuality',mw.quality||'—');
    text('#mRockPressure',num(rw.pressure,0)); text('#mRockFlow',Number.isFinite(Number(rw.flow))?`${num(rw.flow,1)} gpm`:'—'); text('#mRockToday',Number.isFinite(Number(rw.today))?`${num(rw.today,0)} gal`:'—'); text('#mRockWaterChip',rw.filter||'—'); text('#mRockQuality',rw.quality||'—');
    const leakRows=Object.entries(leaks); const leakEl=$('#mLeaks'); if(leakEl){leakEl.innerHTML=leakRows.length?leakRows.map(([k,v])=>`<div class="m-row"><span>${esc(k.replace(/(^|_)(\w)/g,(_,a,b)=>' '+b.toUpperCase()).trim())}</span><b class="${String(v).toLowerCase()==='dry'?'m-good':''}">${esc(v)}</b></div>`).join(''):'<div class="m-row"><span>No leak data</span><b>—</b></div>'}
    const allDry=leakRows.length&&leakRows.every(([,v])=>String(v).toLowerCase()==='dry'); text('#mLeakChip',allDry?'All Dry':(leakRows.length?'Check':'—'));
  }

  function renderPortfolio(d){
    portfolio=d||{}; const b=portfolio.balance||{};
    const value=pick(b,'total_net_liquidation_value','net_liquidation_value','account_value'); const cash=pick(b,'settled_cash','total_cash_balance','cash_balance'); const day=pick(b,'total_day_profit_loss','day_profit_loss','day_pl'); const upl=pick(b,'total_unrealized_profit_loss','unrealized_profit_loss','unrealized_pl');
    text('#mPortValue',money(value)); text('#mPortCash',money(cash)); text('#mPortDay',money(day)); text('#mPortPL',money(upl));
    const dayEl=$('#mPortDay'), plEl=$('#mPortPL'); if(dayEl)dayEl.className='m-big '+(Number(day)>=0?'m-good':'m-bad'); if(plEl)plEl.className='m-big '+(Number(upl)>=0?'m-good':'m-bad');
    text('#mPortStatus',portfolio.connected?(portfolio.stale?'Stale':'Live'):'Unavailable');
    const pos=Array.isArray(portfolio.positions)?portfolio.positions:[]; const el=$('#mPositions'); if(!el)return;
    el.innerHTML=pos.length?pos.sort((a,b)=>Number(b.market_value||0)-Number(a.market_value||0)).map(p=>{const pl=pick(p,'unrealized_pl','unrealized_profit_loss');const pp=pick(p,'unrealized_pct','unrealized_profit_loss_rate');return `<div class="m-position"><div><b>${esc(p.symbol||'—')}</b><small>${esc(p.quantity??'—')} shares • avg ${money(p.average_cost)}</small></div><div class="m-position-value"><strong>${money(p.market_value)}</strong><span class="${Number(pl)>=0?'m-good':'m-bad'}">${money(pl)} ${Number.isFinite(Number(pp))?'• '+pct(pp):''}</span></div></div>`}).join(''):'<div class="m-empty">No owned positions returned.</div>';
  }

  function renderConfigs(){
    if(powerCfg){$('#mPowerEnabled').checked=!!powerCfg.enabled;$('#mWake').value=powerCfg.wake_time||'07:15';$('#mSleep').value=powerCfg.sleep_time||'22:30'}
    if(dashCfg){$('#mRotateEnabled').checked=!!dashCfg.rotation_enabled;const s=String(dashCfg.rotation_seconds||18);let sel=$('#mRotateSeconds');if(sel&&!([...sel.options].some(o=>o.value===s))){const o=document.createElement('option');o.value=s;o.textContent=`${s} sec`;sel.appendChild(o)}if(sel)sel.value=s}
  }

  async function refresh(silent=false){
    const tasks=[json('/api/home').then(renderHome),json('/api/webull/summary').then(renderPortfolio),json('/api/power-settings').then(d=>powerCfg=d),json('/api/dashboard-settings').then(d=>dashCfg=d)];
    const results=await Promise.allSettled(tasks); const ok=results.some(r=>r.status==='fulfilled'); markOnline(ok); renderConfigs();
    const now=new Date(); text('#mLast',`Updated ${now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`); if(!silent)toast(ok?'Updated':'Unable to refresh');
  }

  async function post(url,body){return json(url,{method:'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})}
  function bind(){
    $$('.m-nav button').forEach(b=>b.addEventListener('click',()=>{const tab=b.dataset.go;$$('.m-nav button').forEach(x=>x.classList.toggle('active',x===b));$$('.m-section').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));window.scrollTo({top:0,behavior:'smooth'})}));
    $$('[data-refresh]').forEach(b=>b.addEventListener('click',()=>refresh(false)));
    $$('[data-tv]').forEach(b=>b.addEventListener('click',async()=>{const a=b.dataset.tv;if(a==='standby'&&!confirm('Put the estate display into standby?'))return;b.disabled=true;try{const r=await post(`/api/tv/${a}`);toast(r.ok?'Command sent':(r.message||'Command failed'))}catch(e){toast('Control request failed')}finally{b.disabled=false}}));
    $('#mSavePower')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{powerCfg=await post('/api/power-settings',{enabled:$('#mPowerEnabled').checked,wake_time:$('#mWake').value,sleep_time:$('#mSleep').value,switch_to_pi_input_on_wake:true}).then(r=>r.config||r);toast('Display schedule saved')}catch(err){toast('Could not save schedule')}finally{e.currentTarget.disabled=false}});
    $('#mSaveRotation')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{dashCfg=await post('/api/dashboard-settings',{rotation_enabled:$('#mRotateEnabled').checked,rotation_seconds:Number($('#mRotateSeconds').value)});toast('Rotation settings saved')}catch(err){toast('Could not save rotation')}finally{e.currentTarget.disabled=false}});
    $('#mInstall button')?.addEventListener('click',()=>{localStorage.setItem('estate-install-tip','dismissed');$('#mInstall').classList.remove('show')});
  }

  function clock(){const d=new Date();text('#mClock',d.toLocaleString([],{weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}
  function installTip(){const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;if(!standalone&&localStorage.getItem('estate-install-tip')!=='dismissed')$('#mInstall')?.classList.add('show')}
  function boot(){prepareHead();shell();bind();clock();setInterval(clock,30000);installTip();refresh(true);setInterval(()=>refresh(true),30000);document.body.style.visibility='visible'}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
