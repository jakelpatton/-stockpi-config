(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const previewKey = 'patton-estate-control-preview-v2';
  const preview = Object.assign({lights:{'light-main-exterior':true,'light-front-porch':true,'light-rockhouse':false},setpoint:72,hvac_mode:'cool',gate:'Closed',water_closed:false}, safeJSON(localStorage.getItem(previewKey)) || {});
  let panelStatus={control_mode:'preview',home_assistant:false,mappings:{}};
  let lastHome=null,pendingConfirm=null;

  function safeJSON(s){try{return JSON.parse(s)}catch{return null}}
  function savePreview(){localStorage.setItem(previewKey,JSON.stringify(preview))}
  function setText(sel,val){const el=$(sel);if(el&&val!==undefined&&val!==null)el.textContent=val}
  function title(s){return String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
  function show(view){$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));$$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));if(view==='cameras')refreshCameras()}
  function toast(message,ms=2200){const t=$('#toast');if(!t)return;t.textContent=message;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),ms)}
  function clock(){const d=new Date();setText('#clock',d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));setText('#date',d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'}))}
  function weatherIcon(condition){const c=String(condition||'').toLowerCase();if(c.includes('rain')||c.includes('storm'))return'☂';if(c.includes('sun')||c.includes('clear'))return'☀';if(c.includes('snow'))return'❄';return'☁'}

  function bindHome(h){
    lastHome=h;
    const main=h.main||{},water=h.water?.main||{},leaks=h.water?.leaks||{},gate=h.gate||{},p=h.propane||{},e=h.electrical||{},wh=h.wellhouse||{},rh=h.rockhouse||{},tesla=h.tesla||{},weather=h.weather||{};
    setText('#weatherTemp',weather.temp!=null?`${Math.round(weather.temp)}°`:'--°');setText('#weatherCondition',weather.condition||'Weather');setText('#weatherIcon',weatherIcon(weather.condition));
    const current=main.upstairs!=null?Number(main.upstairs):73;setText('#homeTemp',`${Math.round(current)}°`);setText('#climateCurrent',`${Math.round(current)}°`);
    if(panelStatus.control_mode!=='live'){setText('#homeSetpoint',`${preview.setpoint}°`);setText('#climateSetpoint',`${preview.setpoint}°`)}
    setText('#waterPressure',water.pressure);setText('#waterFlow',water.flow);setText('#waterToday',water.today);
    const leakStates=[leaks.main,leaks.rockhouse,leaks.wellhouse].filter(Boolean);const dry=leakStates.length?leakStates.every(x=>String(x).toLowerCase()==='dry'):true;
    setText('#homeWaterState',preview.water_closed?'SHUT OFF':(dry?'NORMAL':'CHECK'));setText('#waterLeaks',dry?'DRY':'CHECK');setText('#waterHeadline',dry?'Normal':'Leak Alert');setText('#waterHeroState',preview.water_closed?'SHUT OFF':(dry?'NORMAL':'CHECK'));setText('#waterHeroLeaks',dry?'No leaks detected':'Leak sensor requires attention');
    const gateState=panelStatus.control_mode==='preview'?preview.gate:(gate.state||preview.gate);setText('#homeGate',gateState);setText('#gateState',gateState);setText('#gateLargeState',String(gateState).toUpperCase());setText('#gateLast',gate.last_event?`Last event: ${gate.last_event}`:'Last event available from Farm');setText('#gateNetwork',`Network ${gate.network||'—'}`);
    setText('#homePropane',p.level!=null?`${Math.round(p.level)}%`:'—');setText('#homePropaneDays',p.days_remaining!=null?`~${Math.round(p.days_remaining)} days`:'Estimate pending');setText('#sysPropane',p.level!=null?`${Math.round(p.level)}%`:'—');setText('#sysPropaneGallons',p.estimated_gallons!=null?`${Math.round(p.estimated_gallons)} gal`:'Estimate pending');setText('#sysPower',e.main_load_kw!=null?`${e.main_load_kw} kW`:'—');setText('#sysWell',wh.pump||'—');setText('#sysWellVoltage',wh.voltage!=null?`${wh.voltage} V`:'—');setText('#sysRockTemp',rh.temp!=null?`${rh.temp}°`:'—');setText('#sysTesla',tesla.charge!=null?`${tesla.charge}%`:'—');setText('#sysTeslaState',tesla.state||'—');setText('#estateStatus',dry?'NORMAL':'ATTENTION');updatePreviewLights();
  }

  function updatePreviewLights(){const keys=['light-main-exterior','light-front-porch','light-rockhouse'];let count=0;keys.forEach(k=>{const on=!!preview.lights[k];count+=on?1:0;const el=document.querySelector(`[data-switch="${k}"]`);if(el){el.textContent=on?'ON':'OFF';el.classList.toggle('on',on)}});setText('#homeLightsCount',count);setText('#lightingSummary',`${count} mapped preview lights on`)}

  function applyHAState(s){
    if(!s||!s.home_assistant)return;panelStatus=s;setText('#sysControlMode','LIVE');setText('#sysHomeAssistant','Home Assistant connected');setText('#connection','Home Assistant • connected');const entities=s.entities||{};
    const climate=entities.climate_upstairs;if(climate){const current=Number(climate.attributes?.current_temperature),target=Number(climate.attributes?.temperature);if(Number.isFinite(current)){setText('#homeTemp',`${Math.round(current)}°`);setText('#climateCurrent',`${Math.round(current)}°`)}if(Number.isFinite(target)){setText('#homeSetpoint',`${Math.round(target)}°`);setText('#climateSetpoint',`${Math.round(target)}°`)}setText('#climateMode',title(climate.state));setText('#climateCalling',title(climate.attributes?.hvac_action||climate.state));$$('.mode-controls button').forEach(b=>b.classList.toggle('active',b.dataset.action===`mode-${climate.state}`))}
    Object.entries({'light-main-exterior':'light_main_exterior','light-front-porch':'light_front_porch','light-rockhouse':'light_rockhouse'}).forEach(([action,key])=>{const ent=entities[key];if(!ent)return;const on=ent.state==='on';preview.lights[action]=on;const el=document.querySelector(`[data-switch="${action}"]`);if(el){el.textContent=on?'ON':'OFF';el.classList.toggle('on',on)}});
    const realCount=['light_main_exterior','light_front_porch','light_rockhouse'].map(k=>entities[k]).filter(ent=>ent?.state==='on').length;setText('#homeLightsCount',realCount);setText('#lightingSummary',`${realCount} mapped lights on`);
    const gate=entities.gate;if(gate){const state=title(gate.state);setText('#homeGate',state);setText('#gateState',state);setText('#gateLargeState',state.toUpperCase())}
    const valve=entities.water_shutoff;if(valve&&['closed','off'].includes(valve.state)){setText('#homeWaterState','SHUT OFF');setText('#waterHeroState','SHUT OFF')}
  }

  async function refresh(){
    try{const r=await fetch('/api/home',{cache:'no-store'});if(!r.ok)throw new Error();bindHome(await r.json());if(panelStatus.control_mode!=='live')setText('#connection','Farm data • connected')}catch{if(!lastHome)bindHome({});setText('#connection','Farm data • preview')}
    try{const r=await fetch('/api/panel/state',{cache:'no-store'});if(r.ok){const s=await r.json();panelStatus=s;if(s.home_assistant)applyHAState(s);else{setText('#sysControlMode','PREVIEW');setText('#sysHomeAssistant','Home Assistant not mapped')}}}catch{}
  }

  function confirmAction(titleText,body,action){pendingConfirm=action;setText('#confirmTitle',titleText);setText('#confirmText',body);$('#confirm').hidden=false}
  function closeConfirm(){pendingConfirm=null;$('#confirm').hidden=true}
  async function execute(action){if(action==='water-off')return confirmAction('Shut Off Main Water','This command closes the main water valve. Re-opening is intentionally not available from this emergency button.',action);if(action==='gate-close')return confirmAction('Close North Drive Gate','Confirm the driveway is clear before closing the gate.',action);return sendAction(action)}

  function previewAction(action){
    if(action.startsWith('light-')&&action!=='light-all-off'){preview.lights[action]=!preview.lights[action];updatePreviewLights();savePreview();return`${title(action.replace('light-',''))} ${preview.lights[action]?'on':'off'} • preview`}
    if(action==='light-all-off'){Object.keys(preview.lights).forEach(k=>preview.lights[k]=false);updatePreviewLights();savePreview();return'All property lights off • preview'}
    if(action==='temp-up'||action==='temp-down'){preview.setpoint+=action==='temp-up'?1:-1;preview.setpoint=Math.max(55,Math.min(85,preview.setpoint));setText('#homeSetpoint',`${preview.setpoint}°`);setText('#climateSetpoint',`${preview.setpoint}°`);savePreview();return`Upstairs set to ${preview.setpoint}° • preview`}
    if(action.startsWith('mode-')){preview.hvac_mode=action.replace('mode-','');setText('#climateMode',title(preview.hvac_mode));$$('.mode-controls button').forEach(b=>b.classList.toggle('active',b.dataset.action===action));savePreview();return`${title(preview.hvac_mode)} mode • preview`}
    if(action==='water-off'){preview.water_closed=true;setText('#homeWaterState','SHUT OFF');setText('#waterHeroState','SHUT OFF');savePreview();return'Main water shutoff closed • preview'}
    if(action==='gate-open'){preview.gate='Open';setText('#homeGate','Open');setText('#gateState','Open');setText('#gateLargeState','OPEN');savePreview();return'Gate open command • preview'}
    if(action==='gate-close'){preview.gate='Closed';setText('#homeGate','Closed');setText('#gateState','Closed');setText('#gateLargeState','CLOSED');savePreview();return'Gate close command • preview'}
    if(action==='goodnight'){Object.keys(preview.lights).forEach(k=>preview.lights[k]=false);preview.setpoint=68;updatePreviewLights();setText('#homeSetpoint','68°');setText('#climateSetpoint','68°');savePreview();return'Goodnight scene activated • preview'}
    return`${title(action)} • preview`;
  }

  async function sendAction(action){try{const r=await fetch('/api/panel/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const result=await r.json();if(result.executed){toast(result.message||'Command sent');setTimeout(refresh,500);return}toast(previewAction(action))}catch{toast(previewAction(action))}}
  function refreshCameras(){if(document.querySelector('.view.active')?.dataset.view!=='cameras')return;const stamp=Date.now();$$('img[data-camera]').forEach(img=>{img.src=`/api/cameras/snapshot/${img.dataset.camera}?t=${stamp}`})}
  function bind(){$$('[data-nav]').forEach(el=>el.addEventListener('click',()=>show(el.dataset.nav)));$$('[data-action]').forEach(el=>el.addEventListener('click',()=>execute(el.dataset.action)));$('#confirmCancel')?.addEventListener('click',closeConfirm);$('#confirmGo')?.addEventListener('click',()=>{const a=pendingConfirm;closeConfirm();if(a)sendAction(a)});$('#confirm')?.addEventListener('click',e=>{if(e.target.id==='confirm')closeConfirm()})}
  async function boot(){bind();clock();setInterval(clock,10000);updatePreviewLights();await refresh();setInterval(refresh,12000);setInterval(refreshCameras,1600);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
