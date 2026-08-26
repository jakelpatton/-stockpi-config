(() => {
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

  function removeLegacyPortfolioError(){
    const p=document.getElementById('portfolioPL');
    if(p&&/portfolio data unavailable/i.test(p.textContent||''))p.textContent='Webull account data reconnecting…';
  }

  function boot(){
    ensureFreshness();
    refreshFreshness();
    setInterval(refreshFreshness,15000);
    setInterval(removeLegacyPortfolioError,1000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
