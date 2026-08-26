(() => {
  function setText(selector,text){const el=document.querySelector(selector);if(el)el.textContent=text}
  function addScriptOnce(src){
    if(document.querySelector(`script[src="${src}"]`))return;
    const s=document.createElement('script');
    s.src=src;
    s.async=false;
    document.body.appendChild(s);
  }
  function addStyleOnce(href){
    if(document.querySelector(`link[href="${href}"]`))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);
  }

  function ensureActivityAssets(){
    addStyleOnce('/static/webull-activity.css');
    addScriptOnce('/static/webull-activity.js');
  }

  function ensurePortfolioAssets(){
    addStyleOnce('/static/portfolio-enhanced.css');
    addScriptOnce('/static/portfolio-enhanced.js');
  }

  function ensureMarketAssets(){
    addScriptOnce('/static/rotation-controller.js');
    addStyleOnce('/static/market-sequence.css');
    addStyleOnce('/static/market-alerts.css');
    addScriptOnce('/static/market-alerts.js');
    addScriptOnce('/static/market-watchlist-sync.js');
    addScriptOnce('/static/ticker-prices.js');
    addScriptOnce('/static/dashboard-watchdog.js');
  }

  function ensureOwnedPositionAssets(){
    addStyleOnce('/static/owned-positions.css');
    addScriptOnce('/static/owned-positions.js');
  }

  function slowTickerToHalfSpeed(){
    const track=document.getElementById('tickerTrack');
    if(!track||track.dataset.halfSpeed==='1')return;
    const raw=getComputedStyle(track).animationDuration||'';
    const first=raw.split(',')[0].trim();
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
    const h=document.createElement('div');h.className='screen-heading estate-home-heading';
    h.innerHTML='<div><div class="eyebrow">1838 ESTATE • PROPERTY STATUS</div><h2>Estate Overview</h2></div><div class="section-caption">Weather, climate, access and vehicle status</div>';
    home.insertBefore(h,home.firstChild);
  }

  function relabel(){
    setText('.brand h1','1838 Estate');
    setText('.location-block b',"Farm • Est’d. 1838");
    setText('.location-block small','Mt. Vernon, Missouri');

    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks){
      stocks.dataset.marketTitle='Portfolio';
      const e=stocks.querySelector('.eyebrow');if(e)e.textContent='WEBULL • OWNED POSITIONS';
      const h=stocks.querySelector('h2');if(h)h.textContent='Portfolio';
      const c=stocks.querySelector('.section-caption');if(c)c.textContent='Your owned investments • value • cost • gain/loss • 1-day progress';
    }
    const markets=document.querySelector('[data-screen="markets"]');if(markets)markets.dataset.marketTitle='Markets';
    addHomeHeading();
    const water=document.querySelector('[data-screen="water"]');if(water){const e=water.querySelector('.screen-heading .eyebrow');if(e)e.textContent='WATER • WELLS • LEAK DETECTION';const h=water.querySelector('.screen-heading h2');if(h)h.textContent='Water & Leak Watch'}
    const power=document.querySelector('[data-screen="power"]');if(power){const e=power.querySelector('.screen-heading .eyebrow');if(e)e.textContent='ESTATE POWER • LOADS • SUPPLY';const h=power.querySelector('.screen-heading h2');if(h)h.textContent='Energy & Electrical';const c=power.querySelector('.section-caption');if(c)c.textContent='Main House and Rockhouse energy usage'}
    const footer=document.querySelector('footer');if(footer)footer.innerHTML='1838 Estate <span>•</span> Settings: <b>farmpi.local:8080/settings</b>';
  }

  function maintainScreenLabel(){
    const labels={stocks:'Portfolio',markets:'Markets',activity:'Orders & Trading Activity',home:'Estate Overview',water:'Water & Leak Watch',power:'Energy & Electrical',thesis:'Sunday Market Review'};
    const update=()=>{const active=document.querySelector('.screen.active');const el=document.getElementById('screenName');if(!active||!el)return;if(active.dataset.marketTitle)el.textContent=active.dataset.marketTitle;else if(labels[active.dataset.screen])el.textContent=labels[active.dataset.screen]};
    const main=document.querySelector('main.screens');if(main)new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});update();
  }

  function boot(){
    ensureActivityAssets();
    ensurePortfolioAssets();
    ensureMarketAssets();
    addScriptOnce('/static/stock-identity.js');
    ensureOwnedPositionAssets();
    relabel();
    maintainScreenLabel();
    setTimeout(slowTickerToHalfSpeed,700);
    setTimeout(relabel,600);
    setTimeout(relabel,1800);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
