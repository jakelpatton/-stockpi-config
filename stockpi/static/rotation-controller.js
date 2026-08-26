(() => {
  let installed=false;
  let ownTimer=null;
  let heartbeat=null;
  let lastScreen='';
  let lastScreenChange=Date.now();
  let lastAdvance=0;

  function screenFor(name){
    if(!name)return null;
    try{return document.querySelector(`.screen[data-screen="${CSS.escape(String(name))}"]`)}catch(e){return null}
  }
  function activeScreen(){return document.querySelector('.screen.active')}
  function activeName(){return activeScreen()?.dataset.screen||''}
  function motionVisible(){return document.getElementById('cameraMotionOverlay')?.classList.contains('visible')}
  function thesisOwnsRotation(){return activeName()==='thesis'}
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
    const map={stocks:'Portfolio',markets:'Markets',activity:'Orders & Trading Activity',home:'Estate Overview',water:'Water & Leak Watch',power:'Energy & Electrical',thesis:'Sunday Market Review'};
    return map[name]||name||'';
  }
  function clearTimers(){
    if(ownTimer){clearTimeout(ownTimer);ownTimer=null;}
    try{if(typeof timer!=='undefined')clearTimeout(timer)}catch(e){}
  }
  function seconds(){return Math.max(5,Number(cfg?.rotation_seconds)||18)}

  function markScreenChange(){
    const nowName=activeName();
    if(nowName!==lastScreen){lastScreen=nowName;lastScreenChange=Date.now();}
  }

  function advance(reason='timer'){
    if(typeof cfg==='undefined'||!cfg.rotation_enabled||!Array.isArray(cfg.screens)||cfg.screens.length<2)return false;
    if(motionVisible()||thesisOwnsRotation())return false;
    const current=activeName();
    let currentIndex=cfg.screens.indexOf(current);
    if(currentIndex<0)currentIndex=Number.isFinite(Number(idx))?Number(idx):0;
    const next=nextExisting(currentIndex+1);
    if(next<0||next===currentIndex)return false;
    lastAdvance=Date.now();
    window.showScreen(next,reason);
    return true;
  }

  function install(){
    if(installed)return;
    if(typeof cfg==='undefined'||typeof idx==='undefined'||typeof buildDots!=='function'){setTimeout(install,100);return;}
    installed=true;

    window.showScreen=function(requested,reason='manual'){
      if(!Array.isArray(cfg.screens)||!cfg.screens.length)return;
      const target=nextExisting(requested);
      if(target<0)return;
      idx=target;
      const name=cfg.screens[idx],el=screenFor(name);
      if(!el)return;
      document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x===el));
      const title=document.getElementById('screenName');if(title)title.textContent=labelFor(el,name);
      lastScreen=name;lastScreenChange=Date.now();
      buildDots();
      window.schedule();
      document.dispatchEvent(new CustomEvent('farm-screen-change',{detail:{screen:name,index:idx,reason}}));
    };

    window.schedule=function(){
      clearTimers();
      if(!cfg.rotation_enabled||motionVisible()||thesisOwnsRotation())return;
      ownTimer=setTimeout(()=>advance('timer'),seconds()*1000);
    };

    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>{
      const active=activeScreen();
      if(active&&Array.isArray(cfg.screens)){
        const i=cfg.screens.indexOf(active.dataset.screen);if(i>=0)idx=i;
      }else if(!active){
        const next=nextExisting(Number(idx)||0);if(next>=0)window.showScreen(next,'repair');
      }
      markScreenChange();
    }).observe(main,{childList:true,subtree:false});

    heartbeat=setInterval(()=>{
      markScreenChange();
      if(!cfg.rotation_enabled||motionVisible()||thesisOwnsRotation())return;
      if(!Array.isArray(cfg.screens)||cfg.screens.length<2)return;
      const limit=seconds()*1000+5000,now=Date.now();
      if(now-lastScreenChange>=limit&&now-lastAdvance>=5000)advance('heartbeat');
    },1000);

    const active=activeScreen();
    if(active&&Array.isArray(cfg.screens)){const i=cfg.screens.indexOf(active.dataset.screen);if(i>=0)idx=i;}
    lastScreen=activeName();lastScreenChange=Date.now();
    buildDots();window.schedule();

    window.farmRotationDebug=()=>({active:activeName(),index:typeof idx!=='undefined'?idx:null,screens:Array.isArray(cfg?.screens)?[...cfg.screens]:[],enabled:!!cfg?.rotation_enabled,seconds:seconds(),motion:motionVisible(),thesis:thesisOwnsRotation(),lastScreenChange,lastAdvance,installed});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
