(() => {
  'use strict';
  function setText(selector,text){const el=document.querySelector(selector);if(el)el.textContent=text}
  function addScriptOnce(src){
    const base=src.split('?')[0];
    if([...document.scripts].some(s=>(s.getAttribute('src')||'').split('?')[0]===base))return;
    const s=document.createElement('script');s.src=src;s.async=false;(document.body||document.head).appendChild(s);
  }
  function addStyleOnce(href){
    const base=href.split('?')[0];
    if([...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>(l.getAttribute('href')||'').split('?')[0]===base))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);
  }

  function isMobileEstate(){
    const host=(location.hostname||'').toLowerCase();
    return host==='mobile.1838farm.com'||new URLSearchParams(location.search).get('mobile')==='1';
  }

  function bootMobile(){
    if(document.body)document.body.style.visibility='hidden';
    addStyleOnce('/static/mobile.css?v=20260828a');
    addScriptOnce('/static/mobile-app.js?v=20260828a');
  }

  // Activity and portfolio insight assets are independent of the core Portfolio
  // renderer and can safely enrich it after first paint.
  function ensureActivityAssets(){
    addStyleOnce('/static/webull-activity.css?v=20260826stable');
    addScriptOnce('/static/webull-activity.js?v=20260826stable');
    addStyleOnce('/static/portfolio-insights.css?v=20260828premium');
    addScriptOnce('/static/portfolio-insights.js?v=20260828premium');
  }

  function slowTickerToHalfSpeed(){
    const track=document.getElementById('tickerTrack');
    if(!track||track.dataset.halfSpeed==='1')return;
    const first=(getComputedStyle(track).animationDuration||'').split(',')[0].trim();
    const match=first.match(/^([0-9.]+)(ms|s)$/);
    if(!match)return;
    const value=parseFloat(match[1]);
    if(!Number.isFinite(value)||value<=0)return;
    track.style.animationDuration=`${value*2}${match[2]}`;
    track.dataset.halfSpeed='1';
  }

  function addHomeHeading(){
    const home=document.querySelector('[data-screen="home"]');
    if(!home||home.querySelector('.estate-home-heading'))return;
    const h=document.createElement('div');
    h.className='screen-heading estate-home-heading';
    h.innerHTML='<div><div class="eyebrow">1838 ESTATE • PROPERTY STATUS</div><h2>Estate Overview</h2></div><div class="section-caption">Weather, climate, access and vehicle status</div>';
    home.insertBefore(h,home.firstChild);
  }

  function relabel(){
    document.title='1838 Estate';
    setText('.brand h1','1838 Estate');
    setText('.location-block b','Est’d. 1838');
    setText('.location-block small','Mt. Vernon, Missouri');

    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks){
      stocks.dataset.marketTitle='Portfolio';
      const e=stocks.querySelector('.eyebrow');if(e)e.textContent='WEBULL • OWNED POSITIONS';
      const h=stocks.querySelector('h2');if(h)h.textContent='Portfolio';
      const c=stocks.querySelector('.section-caption');if(c)c.textContent='Premium • account value • P&L • cash yield • live market context';
    }
    const markets=document.querySelector('[data-screen="markets"]');if(markets)markets.dataset.marketTitle='Markets';
    addHomeHeading();

    const water=document.querySelector('[data-screen="water"]');
    if(water){const e=water.querySelector('.screen-heading .eyebrow');if(e)e.textContent='WATER • WELLS • LEAK DETECTION';const h=water.querySelector('.screen-heading h2');if(h)h.textContent='Water & Leak Watch'}
    const power=document.querySelector('[data-screen="power"]');
    if(power){const e=power.querySelector('.screen-heading .eyebrow');if(e)e.textContent='ESTATE POWER • LOADS • SUPPLY';const h=power.querySelector('.screen-heading h2');if(h)h.textContent='Energy & Electrical';const c=power.querySelector('.section-caption');if(c)c.textContent='Main House and Rockhouse energy usage'}
    const footer=document.querySelector('footer');if(footer)footer.innerHTML='1838 Estate <span>•</span> Settings: <b>farmpi.local:8080/settings</b>';
  }

  function maintainScreenLabel(){
    const labels={stocks:'Portfolio',markets:'Markets',activity:'Orders & Trading Activity',home:'Estate Overview',water:'Water & Leak Watch',power:'Energy & Electrical',thesis:'Sunday Market Review'};
    const update=()=>{
      const active=document.querySelector('.screen.active');
      const el=document.getElementById('screenName');
      if(!active||!el)return;
      el.textContent=active.dataset.marketTitle||labels[active.dataset.screen]||active.dataset.screen||'';
    };
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
    update();
  }

  function boot(){
    if(isMobileEstate()){bootMobile();return;}
    ensureActivityAssets();
    relabel();
    maintainScreenLabel();
    setTimeout(slowTickerToHalfSpeed,700);
    setTimeout(relabel,600);
    setTimeout(relabel,1800);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();