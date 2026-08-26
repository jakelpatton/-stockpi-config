(() => {
  let lastSignature='';
  function syncRotation(){
    try{
      if(typeof cfg==='undefined'||!Array.isArray(cfg.screens))return;
      const generated=[...document.querySelectorAll('.market-sequence-screen')].map(x=>x.dataset.screen).filter(Boolean);
      if(!generated.length)return;
      const signature=generated.join('|');
      if(signature===lastSignature)return;
      const active=document.querySelector('.screen.active')?.dataset.screen;
      const rest=cfg.screens.filter(s=>!['stocks','activity','portfolio','limits'].includes(s)&&!String(s).startsWith('owned-')&&!String(s).startsWith('watchlist-'));
      cfg.screens=[...generated,...rest];
      lastSignature=signature;
      if(typeof idx!=='undefined'){
        const keep=active?cfg.screens.indexOf(active):-1;
        idx=keep>=0?keep:0;
      }
      if(typeof buildDots==='function')buildDots();
      if(typeof schedule==='function')schedule();
    }catch(e){console.error('watchlist rotation sync',e)}
  }
  function boot(){
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>setTimeout(syncRotation,100)).observe(main,{childList:true,subtree:false});
    setTimeout(syncRotation,1500);setInterval(syncRotation,15000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
