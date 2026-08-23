(() => {
  const DEFAULT_CAMERAS = [
    {name:'North Drive', location:'Gate / driveway'},
    {name:'Front Porch', location:'Main House'},
    {name:'Barn', location:'Farmyard'},
    {name:'Rockhouse', location:'Rockhouse'}
  ];

  function ensureStyles(){
    if(document.querySelector('link[href="/static/cameras.css"]')) return;
    const l=document.createElement('link');
    l.rel='stylesheet'; l.href='/static/cameras.css'; document.head.appendChild(l);
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
        <div class="camera-system-status"><span class="camera-dot"></span><div><b>Amcrest NVR</b><small id="cameraSystemText">Ready for connection</small></div></div>
      </div>
      <div class="camera-grid" id="cameraGrid"></div>
      <div class="camera-footer"><span>4-camera overview</span><span>Substreams preferred for smooth kiosk playback</span><span id="cameraUpdated">Farm security</span></div>`;
    main.appendChild(s);

    const grid=document.getElementById('cameraGrid');
    DEFAULT_CAMERAS.forEach((c,i)=>{
      const tile=document.createElement('article');
      tile.className='camera-tile panel';
      tile.innerHTML=`
        <div class="camera-placeholder">
          <div class="camera-placeholder-icon">◉</div>
          <div class="camera-placeholder-copy"><b>Camera ${i+1}</b><span>Awaiting NVR connection</span></div>
        </div>
        <img class="camera-feed" id="cameraFeed${i+1}" alt="${c.name}" hidden>
        <div class="camera-overlay"><div><b>${c.name}</b><span>${c.location}</span></div><div class="live-pill"><i></i> LIVE</div></div>`;
      grid.appendChild(tile);
    });
  }

  function patchScreenName(){
    const map = {stocks:'Stocks',home:'Home Overview',water:'Water Systems',power:'Power / Climate / Electrical',cameras:'Cameras'};
    const obs=new MutationObserver(()=>{
      const active=document.querySelector('.screen.active');
      const el=document.getElementById('screenName');
      if(active && el && map[active.dataset.screen]) el.textContent=map[active.dataset.screen];
    });
    const main=document.querySelector('main.screens');
    if(main) obs.observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
  }

  function boot(){ensureStyles();makeScreen();patchScreenName();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
