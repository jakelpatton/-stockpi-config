(() => {
  // Temporary stabilization flag: keep all camera implementation in place, but
  // keep cameras out of the kiosk until the stock pages / rotation work is done.
  const CAMERAS_ENABLED = false;
  window.FARM_CAMERAS_ENABLED = CAMERAS_ENABLED;

  const CAMERAS = [
    {channel:1, name:'Front Porch', location:'Main House'},
    {channel:2, name:'Rockhouse Front', location:'Rockhouse'},
    {channel:3, name:'Rockhouse Back', location:'Rockhouse'},
    {channel:4, name:'Farm Backyard', location:'Wyze Floodlight Pro • 192.168.1.253', disabled:true, wyze:true}
  ];
  const REFRESH_MS = 1200;
  let timer = null;

  function addStyle(href){
    if(!document.querySelector(`link[href="${href}"]`)){
      const l=document.createElement('link');
      l.rel='stylesheet';
      l.href=href;
      document.head.appendChild(l);
    }
  }

  function addScript(src){
    if(!document.querySelector(`script[src="${src}"]`)){
      const s=document.createElement('script');
      s.src=src;
      s.defer=true;
      document.body.appendChild(s);
    }
  }

  function ensureDisplayAssets(){
    if(CAMERAS_ENABLED) addStyle('/static/cameras.css');
    addStyle('/static/thesis.css');
    addStyle('/static/thesis-summary.css');
    addStyle('/static/tv-fit.css');
    addStyle('/static/estate-tv.css');
    addScript('/static/thesis.js');
    addScript('/static/estate-tv.js');
  }

  function removeCamerasFromRotation(){
    document.querySelector('[data-screen="cameras"]')?.remove();
    try{
      if(typeof cfg==='undefined'||!Array.isArray(cfg.screens))return false;
      const active=document.querySelector('.screen.active')?.dataset.screen||'';
      const before=cfg.screens.length;
      cfg.screens=cfg.screens.filter(s=>s!=='cameras');
      if(typeof idx!=='undefined'){
        const keep=active?cfg.screens.indexOf(active):-1;
        idx=keep>=0?keep:Math.min(Number(idx)||0,Math.max(0,cfg.screens.length-1));
      }
      if(before!==cfg.screens.length){
        if(typeof buildDots==='function')buildDots();
        if(typeof schedule==='function')schedule();
      }
      return true;
    }catch(e){
      console.warn('camera rotation disable',e);
      return false;
    }
  }

  function makeScreen(){
    if(document.querySelector('[data-screen="cameras"]')) return;
    const main=document.querySelector('main.screens');
    if(!main) return;

    const s=document.createElement('section');
    s.className='screen';
    s.dataset.screen='cameras';
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
      const tile=document.createElement('article');
      tile.className='camera-tile panel';
      if(c.disabled) tile.classList.add('camera-unused');
      tile.innerHTML=c.disabled ? `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}"><div class="camera-placeholder-icon">◉</div><div class="camera-placeholder-copy"><b>${c.name}</b><span>Wyze bridge connection pending</span></div></div><div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill idle">WYZE</div></div>` : `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}"><div class="camera-placeholder-icon">◉</div><div class="camera-placeholder-copy"><b>${c.name}</b><span>Connecting to NVR channel ${c.channel}</span></div></div><img class="camera-feed" id="cameraFeed${c.channel}" alt="${c.name}"><div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill"><i></i> LIVE</div></div>`;
      grid.appendChild(tile);
      if(c.disabled) return;

      const img=tile.querySelector('.camera-feed');
      img.addEventListener('load',()=>{
        const p=document.getElementById(`cameraPlaceholder${c.channel}`);
        if(p)p.style.display='none';
        img.classList.add('loaded');
      });
      img.addEventListener('error',()=>{
        const p=document.getElementById(`cameraPlaceholder${c.channel}`);
        if(p)p.style.display='flex';
        img.classList.remove('loaded');
      });
    });
  }

  async function checkStatus(){
    try{
      const r=await fetch('/api/cameras/status',{cache:'no-store'});
      if(!r.ok)throw new Error(String(r.status));
      const s=await r.json();
      const text=document.getElementById('cameraSystemText');
      const dot=document.getElementById('cameraDot');
      if(!text)return;
      if(s.configured){
        text.textContent=`Amcrest NVR ${s.nvr_ip} • channels 1–3`;
        dot?.classList.add('online');
      }else{
        text.textContent='Amcrest credentials needed on Pi';
        dot?.classList.remove('online');
      }
    }catch(e){
      const text=document.getElementById('cameraSystemText');
      if(text)text.textContent='Camera status temporarily unavailable';
      document.getElementById('cameraDot')?.classList.remove('online');
    }
  }

  function refreshFrames(){
    const active=document.querySelector('.screen.active')?.dataset.screen==='cameras';
    if(!active)return;
    const stamp=Date.now();
    CAMERAS.filter(c=>!c.disabled).forEach(c=>{
      const img=document.getElementById(`cameraFeed${c.channel}`);
      if(img)img.src=`/api/cameras/snapshot/${c.channel}?t=${stamp}`;
    });
    const u=document.getElementById('cameraUpdated');
    if(u)u.textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function watchScreen(){
    const main=document.querySelector('main.screens');
    if(!main)return;
    const update=()=>{
      const active=document.querySelector('.screen.active');
      if(active?.dataset.screen==='cameras'){
        const label=document.getElementById('screenName');
        if(label)label.textContent='Security & Cameras';
        refreshFrames();
      }
    };
    new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
    update();
  }

  function boot(){
    window.FARM_CAMERAS_ENABLED=CAMERAS_ENABLED;
    ensureDisplayAssets();

    if(!CAMERAS_ENABLED){
      removeCamerasFromRotation();
      const cleanup=setInterval(removeCamerasFromRotation,250);
      setTimeout(()=>clearInterval(cleanup),15000);
      return;
    }

    makeScreen();
    watchScreen();
    checkStatus();
    refreshFrames();
    timer=setInterval(refreshFrames,REFRESH_MS);
    setInterval(checkStatus,15000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
