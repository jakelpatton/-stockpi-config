(() => {
  const CAMERAS = [
    {channel:1, name:'Front Porch', location:'Main House'},
    {channel:2, name:'Rockhouse Front', location:'Rockhouse'},
    {channel:3, name:'Rockhouse Back', location:'Rockhouse'},
    {channel:4, name:'Not Assigned', location:'Available channel', disabled:true}
  ];
  const REFRESH_MS = 1200;
  let timer=null;

  function ensureStyles(){
    if(document.querySelector('link[href="/static/cameras.css"]')) return;
    const l=document.createElement('link'); l.rel='stylesheet'; l.href='/static/cameras.css'; document.head.appendChild(l);
  }

  function makeScreen(){
    if(document.querySelector('[data-screen="cameras"]')) return;
    const main=document.querySelector('main.screens'); if(!main) return;
    const s=document.createElement('section'); s.className='screen'; s.dataset.screen='cameras';
    s.innerHTML=`
      <div class="camera-heading">
        <div><div class="eyebrow">SECURITY • LIVE VIEW</div><h2>Cameras</h2></div>
        <div class="camera-system-status"><span class="camera-dot" id="cameraDot"></span><div><b>Amcrest NVR</b><small id="cameraSystemText">Connecting to 192.168.1.4</small></div></div>
      </div>
      <div class="camera-grid" id="cameraGrid"></div>
      <div class="camera-footer"><span>3 active cameras • 1 available channel</span><span>Channels 1–4</span><span id="cameraUpdated">Connecting…</span></div>`;
    main.appendChild(s);

    const grid=document.getElementById('cameraGrid');
    CAMERAS.forEach(c=>{
      const tile=document.createElement('article'); tile.className='camera-tile panel';
      if(c.disabled) tile.classList.add('camera-unused');
      tile.innerHTML=c.disabled ? `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}">
          <div class="camera-placeholder-icon">＋</div>
          <div class="camera-placeholder-copy"><b>${c.name}</b><span>Channel ${c.channel} available for another camera</span></div>
        </div>
        <div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill idle">AVAILABLE</div></div>` : `
        <div class="camera-placeholder" id="cameraPlaceholder${c.channel}">
          <div class="camera-placeholder-icon">◉</div>
          <div class="camera-placeholder-copy"><b>${c.name}</b><span>Connecting to NVR channel ${c.channel}</span></div>
        </div>
        <img class="camera-feed" id="cameraFeed${c.channel}" alt="${c.name}">
        <div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill"><i></i> LIVE</div></div>`;
      grid.appendChild(tile);
      if(c.disabled) return;
      const img=tile.querySelector('.camera-feed');
      img.addEventListener('load',()=>{
        const p=document.getElementById(`cameraPlaceholder${c.channel}`); if(p) p.style.display='none';
        img.classList.add('loaded');
      });
      img.addEventListener('error',()=>{
        const p=document.getElementById(`cameraPlaceholder${c.channel}`); if(p) p.style.display='flex';
        img.classList.remove('loaded');
      });
    });
  }

  async function checkStatus(){
    try{
      const s=await fetch('/api/cameras/status',{cache:'no-store'}).then(r=>r.json());
      const text=document.getElementById('cameraSystemText');
      const dot=document.getElementById('cameraDot');
      if(s.configured){ text.textContent=`NVR ${s.nvr_ip} • channels 1–3 active`; dot?.classList.add('online'); }
      else { text.textContent='Credentials needed on Pi'; dot?.classList.remove('online'); }
    }catch(e){}
  }

  function refreshFrames(){
    const active=document.querySelector('.screen.active')?.dataset.screen==='cameras';
    if(!active) return;
    const stamp=Date.now();
    CAMERAS.filter(c=>!c.disabled).forEach(c=>{
      const img=document.getElementById(`cameraFeed${c.channel}`);
      if(img) img.src=`/api/cameras/snapshot/${c.channel}?t=${stamp}`;
    });
    const u=document.getElementById('cameraUpdated'); if(u) u.textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function patchScreenName(){
    const map={stocks:'Stocks',home:'Home Overview',water:'Water Systems',power:'Power / Climate / Electrical',cameras:'Cameras'};
    const obs=new MutationObserver(()=>{
      const active=document.querySelector('.screen.active'); const el=document.getElementById('screenName');
      if(active && el && map[active.dataset.screen]) el.textContent=map[active.dataset.screen];
      if(active?.dataset.screen==='cameras') refreshFrames();
    });
    const main=document.querySelector('main.screens'); if(main) obs.observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
  }

  function boot(){ensureStyles(); makeScreen(); patchScreenName(); checkStatus(); refreshFrames(); timer=setInterval(refreshFrames,REFRESH_MS); setInterval(checkStatus,15000);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
