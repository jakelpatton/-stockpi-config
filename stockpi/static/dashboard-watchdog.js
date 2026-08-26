(() => {
  const CHECK_MS=1000;
  let lastScreen='';
  let lastScreenChange=Date.now();
  let lastAdvance=0;

  const fmtTs=value=>{
    if(!value)return '—';
    const n=Number(value);
    const d=Number.isFinite(n)?new Date(n>1e12?n:n*1000):new Date(value);
    return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
  };

  function ensureFreshness(){
    let el=document.getElementById('dataFreshness');
    if(el)return el;
    const right=document.querySelector('.header-right');
    if(!right)return null;
    el=document.createElement('div');
    el.id='dataFreshness';
    el.style.cssText='font-size:10px;line-height:1.25;letter-spacing:.06em;opacity:.78;margin-top:3px;white-space:nowrap';
    el.textContent='DATA • checking…';
    right.appendChild(el);
    return el;
  }

  async function refreshFreshness(){
    const el=ensureFreshness(); if(!el)return;
    try{
      const [wq,qq]=await Promise.all([
        fetch('/api/webull/summary',{cache:'no-store'}).then(r=>r.json()),
        fetch('/api/quotes',{cache:'no-store'}).then(r=>r.json())
      ]);
      const w=fmtTs(wq.updated),q=fmtTs(qq.ts);
      const state=wq.connected?'WEBULL CONNECTED':wq.configured?'WEBULL ERROR':'WEBULL OFFLINE';
      el.textContent=`DATA • ${state} • account ${w} • quotes ${q}`;
      el.title=wq.error||wq.market_data_error||'';
    }catch(e){el.textContent='DATA • refresh unavailable';el.title=String(e)}
  }

  function activeName(){return document.querySelector('.screen.active')?.dataset.screen||''}

  function recoverRotation(){
    const current=activeName();
    if(current!==lastScreen){lastScreen=current;lastScreenChange=Date.now();return;}
    if(document.getElementById('cameraMotionOverlay')?.classList.contains('visible'))return;

    // The thesis screen deliberately owns the rotation timer while its long
    // scrolling review is running. Never let the generic stuck-screen watchdog
    // interrupt it before the thesis script reaches the end and advances itself.
    if(current==='thesis')return;

    if(typeof cfg==='undefined'||!cfg.rotation_enabled||!Array.isArray(cfg.screens)||cfg.screens.length<2)return;
    const limit=Math.max(8000,(Number(cfg.rotation_seconds)||18)*1000+5000);
    const now=Date.now();
    if(now-lastScreenChange<limit||now-lastAdvance<5000)return;
    if(typeof showScreen!=='function')return;
    let i=cfg.screens.indexOf(current);
    if(i<0)i=Number.isFinite(Number(idx))?Number(idx):0;
    lastAdvance=now;
    showScreen((i+1)%cfg.screens.length);
    lastScreen=activeName();
    lastScreenChange=Date.now();
  }

  function removeLegacyPortfolioError(){
    const p=document.getElementById('portfolioPL');
    if(p&&/portfolio data unavailable/i.test(p.textContent||'')){
      p.textContent='Webull account data reconnecting…';
    }
  }

  function boot(){
    ensureFreshness();
    refreshFreshness();
    lastScreen=activeName();
    setInterval(refreshFreshness,15000);
    setInterval(()=>{recoverRotation();removeLegacyPortfolioError()},CHECK_MS);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
