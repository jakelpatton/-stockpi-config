(() => {
  const STREAM_NAME='farm-backyard-cam';
  const HLS_PAGE=`http://farmpi.local:8888/${STREAM_NAME}`;

  function install(){
    const placeholder=document.getElementById('cameraPlaceholder4');
    if(!placeholder||placeholder.dataset.wyzeInstalled==='1')return false;
    const tile=placeholder.closest('.camera-tile');
    if(tile)tile.classList.remove('camera-unused');
    placeholder.dataset.wyzeInstalled='1';
    placeholder.style.display='block';
    placeholder.style.padding='0';
    placeholder.style.background='#000';
    placeholder.innerHTML=`<iframe id="wyzeFarmBackyard" src="${HLS_PAGE}" title="Farm Backyard Wyze Camera" allow="autoplay; fullscreen; picture-in-picture" loading="eager" style="width:100%;height:100%;border:0;background:#000;display:block" referrerpolicy="no-referrer"></iframe>`;
    const badge=tile?.querySelector('.live-pill');
    if(badge){badge.classList.remove('idle');badge.innerHTML='<i></i> WYZE LIVE';}
    const copy=tile?.querySelector('.camera-overlay div span');
    if(copy)copy.textContent='Wyze Floodlight Pro • local HLS bridge';
    return true;
  }

  function boot(){
    if(install())return;
    const main=document.querySelector('main.screens')||document.body;
    const obs=new MutationObserver(()=>{if(install())obs.disconnect()});
    obs.observe(main,{childList:true,subtree:true});
    setTimeout(()=>obs.disconnect(),15000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
