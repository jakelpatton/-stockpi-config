(() => {
  'use strict';
  // Cameras are intentionally paused while Portfolio / Markets and rotation are stabilized.
  // Keep this file as a harmless compatibility shim because app.py may still inject it.
  window.FARM_CAMERAS_ENABLED = false;

  function removeCameraUi(){
    document.querySelectorAll('[data-screen="cameras"],#cameraMotionOverlay').forEach(el=>el.remove());
    try{
      if(typeof cfg!=='undefined'&&Array.isArray(cfg.screens)){
        const before=cfg.screens.length;
        cfg.screens=cfg.screens.filter(name=>name!=='cameras');
        if(before!==cfg.screens.length&&typeof buildDots==='function')buildDots();
      }
    }catch(e){console.warn('camera compatibility cleanup',e)}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeCameraUi,{once:true});
  else removeCameraUi();
  setTimeout(removeCameraUi,1000);
})();