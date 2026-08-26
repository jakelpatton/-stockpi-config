(() => {
  const POLL_MS = 400;
  const MAX_VIEW_MS = 10000;
  const SNAPSHOT_MS = 500;
  const MOTION_API = `${location.protocol}//${location.hostname}:8091/api/motion`;
  const CAMERAS = {
    1: {name:'Front Porch', kind:'amcrest', snapshot:'/api/cameras/snapshot/1'},
    2: {name:'Rockhouse Front', kind:'amcrest', snapshot:'/api/cameras/snapshot/2'},
    3: {name:'Rockhouse Back', kind:'amcrest', snapshot:'/api/cameras/snapshot/3'},
    4: {name:'Farm Backyard', kind:'wyze', player:`${location.protocol}//${location.hostname}:5080/camera/farm_backyard_cam`}
  };

  let overlay=null;
  let currentEventId=0;
  let currentChannel=null;
  let eventStarted=0;
  let restoreScreen=null;
  let snapshotTimer=null;
  let countdownTimer=null;
  let pollBusy=false;

  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=document.createElement('div');
    overlay.id='cameraMotionOverlay';
    overlay.className='camera-motion-overlay';
    overlay.innerHTML=`
      <div class="camera-motion-stage" id="cameraMotionStage"></div>
      <div class="camera-motion-topbar">
        <div class="camera-motion-alert"><i></i><span>MOTION DETECTED</span></div>
        <div class="camera-motion-title" id="cameraMotionTitle">Camera</div>
        <div class="camera-motion-return" id="cameraMotionReturn">AUTO RETURN</div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function stopSnapshotRefresh(){
    if(snapshotTimer){clearInterval(snapshotTimer);snapshotTimer=null;}
  }

  function freezeRotation(){
    if(restoreScreen===null){
      restoreScreen=document.querySelector('.screen.active')?.dataset.screen || '';
    }
    try{ if(typeof timer!=='undefined') clearTimeout(timer); }catch(e){}
  }

  function resumeRotation(){
    const wanted=restoreScreen;
    restoreScreen=null;
    try{
      if(wanted && typeof cfg!=='undefined' && Array.isArray(cfg.screens) && typeof showScreen==='function'){
        const i=cfg.screens.indexOf(wanted);
        if(i>=0){showScreen(i);return;}
      }
      if(typeof schedule==='function')schedule();
    }catch(e){}
  }

  function updateCountdown(){
    const el=document.getElementById('cameraMotionReturn');
    if(!el||!eventStarted)return;
    const left=Math.max(0,Math.ceil((MAX_VIEW_MS-(Date.now()-eventStarted))/1000));
    el.textContent=`AUTO RETURN • ${left}s`;
  }

  function renderCamera(channel){
    const cam=CAMERAS[channel];
    const stage=document.getElementById('cameraMotionStage');
    const title=document.getElementById('cameraMotionTitle');
    if(!cam||!stage)return;
    stopSnapshotRefresh();
    stage.innerHTML='';
    if(title)title.textContent=cam.name;

    if(cam.kind==='wyze'){
      const frame=document.createElement('iframe');
      frame.className='camera-motion-frame';
      frame.src=cam.player;
      frame.title=`${cam.name} live camera`;
      frame.allow='autoplay; fullscreen; picture-in-picture';
      frame.referrerPolicy='no-referrer';
      stage.appendChild(frame);
      return;
    }

    const img=document.createElement('img');
    img.className='camera-motion-image';
    img.alt=`${cam.name} live camera`;
    const refresh=()=>{img.src=`${cam.snapshot}?motion=${Date.now()}`;};
    stage.appendChild(img);
    refresh();
    snapshotTimer=setInterval(refresh,SNAPSHOT_MS);
  }

  function showEvent(event){
    if(!event||!CAMERAS[event.channel])return;
    ensureOverlay();
    freezeRotation();
    currentEventId=Number(event.event_id)||0;
    currentChannel=Number(event.channel);
    eventStarted=Date.now();
    renderCamera(currentChannel);
    overlay.classList.add('visible');
    updateCountdown();
    if(countdownTimer)clearInterval(countdownTimer);
    countdownTimer=setInterval(updateCountdown,250);
  }

  function hideEvent(){
    if(!overlay?.classList.contains('visible'))return;
    overlay.classList.remove('visible');
    stopSnapshotRefresh();
    if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}
    const stage=document.getElementById('cameraMotionStage');
    if(stage)stage.innerHTML='';
    currentChannel=null;
    eventStarted=0;
    resumeRotation();
  }

  function cameraState(data,channel){
    return (data.cameras||[]).find(c=>Number(c.channel)===Number(channel));
  }

  function processMotion(data){
    const latest=data?.latest;

    // A newly-started event always wins. If a second camera detects motion
    // while one is already full-screen, switch immediately to the newer one.
    if(latest && Number(latest.event_id)>currentEventId){
      showEvent(latest);
      return;
    }

    if(!overlay?.classList.contains('visible')||!currentChannel)return;

    const state=cameraState(data,currentChannel);
    const timedOut=eventStarted && Date.now()-eventStarted>=MAX_VIEW_MS;
    const motionStopped=state && state.motion===false;
    if(timedOut||motionStopped)hideEvent();
  }

  async function poll(){
    if(pollBusy)return;
    pollBusy=true;
    try{
      const r=await fetch(MOTION_API,{cache:'no-store'});
      if(!r.ok)throw new Error(String(r.status));
      processMotion(await r.json());
    }catch(e){
      // Motion monitoring must never interfere with the normal dashboard.
    }finally{
      pollBusy=false;
    }
  }

  function boot(){ensureOverlay();poll();setInterval(poll,POLL_MS);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
