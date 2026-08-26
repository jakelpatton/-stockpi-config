(() => {
  let installed=false;

  function screenFor(name){
    if(!name)return null;
    try{return document.querySelector(`.screen[data-screen="${CSS.escape(String(name))}"]`)}catch(e){return null}
  }
  function activeScreen(){return document.querySelector('.screen.active')}
  function motionVisible(){return document.getElementById('cameraMotionOverlay')?.classList.contains('visible')}
  function thesisOwnsRotation(){return activeScreen()?.dataset.screen==='thesis'}
  function normalizedIndex(i,len){const n=Number(i)||0;return ((n%len)+len)%len}
  function nextExisting(start){
    if(typeof cfg==='undefined'||!Array.isArray(cfg.screens)||!cfg.screens.length)return -1;
    const len=cfg.screens.length;
    let i=normalizedIndex(start,len);
    for(let n=0;n<len;n++,i=(i+1)%len){if(screenFor(cfg.screens[i]))return i}
    return -1;
  }
  function labelFor(el,name){
    if(el?.dataset.marketTitle)return el.dataset.marketTitle;
    const map={stocks:'Portfolio & Markets',portfolio:'Portfolio',activity:'Orders & Trading Activity',home:'Estate Overview',water:'Water & Leak Watch',power:'Energy & Electrical',cameras:'Security & Cameras',thesis:'Sunday Market Review',limits:'Open Limit Orders'};
    return map[name]||name||'';
  }

  function install(){
    if(installed)return;
    if(typeof cfg==='undefined'||typeof idx==='undefined'||typeof timer==='undefined'||typeof buildDots!=='function'){
      setTimeout(install,100);return;
    }
    installed=true;

    window.showScreen=function(requested){
      if(!Array.isArray(cfg.screens)||!cfg.screens.length)return;
      const target=nextExisting(requested);
      if(target<0)return;
      idx=target;
      const name=cfg.screens[idx],el=screenFor(name);
      document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x===el));
      const title=document.getElementById('screenName');if(title)title.textContent=labelFor(el,name);
      buildDots();
      window.schedule();
      document.dispatchEvent(new CustomEvent('farm-screen-change',{detail:{screen:name,index:idx}}));
    };

    window.schedule=function(){
      clearTimeout(timer);
      if(!cfg.rotation_enabled||motionVisible()||thesisOwnsRotation())return;
      const seconds=Math.max(5,Number(cfg.rotation_seconds)||18);
      timer=setTimeout(()=>{
        const next=nextExisting((Number(idx)||0)+1);
        if(next>=0)window.showScreen(next);
      },seconds*1000);
    };

    // Repair cases where another script updates cfg while preserving the active
    // page by name. This is intentionally the only generic rotation scheduler.
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>{
      const active=activeScreen();
      if(active)return;
      const next=nextExisting(Number(idx)||0);
      if(next>=0)window.showScreen(next);
    }).observe(main,{childList:true,subtree:false});

    const active=activeScreen();
    if(active&&Array.isArray(cfg.screens)){
      const i=cfg.screens.indexOf(active.dataset.screen);if(i>=0)idx=i;
    }
    buildDots();
    window.schedule();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
