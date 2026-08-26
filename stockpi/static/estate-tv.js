(() => {
  function setText(selector,text){const el=document.querySelector(selector);if(el)el.textContent=text}

  function ensureActivityAssets(){
    if(!document.querySelector('link[href="/static/webull-activity.css"]')){
      const l=document.createElement('link');l.rel='stylesheet';l.href='/static/webull-activity.css';document.head.appendChild(l);
    }
    if(!document.querySelector('script[src="/static/webull-activity.js"]')){
      const s=document.createElement('script');s.src='/static/webull-activity.js';s.defer=true;document.body.appendChild(s);
    }
  }

  function ensurePortfolioAssets(){
    if(!document.querySelector('link[href="/static/portfolio-enhanced.css"]')){
      const l=document.createElement('link');l.rel='stylesheet';l.href='/static/portfolio-enhanced.css';document.head.appendChild(l);
    }
    if(!document.querySelector('script[src="/static/portfolio-enhanced.js"]')){
      const s=document.createElement('script');s.src='/static/portfolio-enhanced.js';s.defer=true;document.body.appendChild(s);
    }
  }

  function ensureMarketSequenceAssets(){
    if(!document.querySelector('link[href="/static/market-sequence.css"]')){
      const l=document.createElement('link');l.rel='stylesheet';l.href='/static/market-sequence.css';document.head.appendChild(l);
    }
    if(!document.querySelector('script[src="/static/market-sequence.js"]')){
      const s=document.createElement('script');s.src='/static/market-sequence.js';s.defer=true;document.body.appendChild(s);
    }
    if(!document.querySelector('link[href="/static/market-alerts.css"]')){
      const l=document.createElement('link');l.rel='stylesheet';l.href='/static/market-alerts.css';document.head.appendChild(l);
    }
    if(!document.querySelector('script[src="/static/market-alerts.js"]')){
      const s=document.createElement('script');s.src='/static/market-alerts.js';s.defer=true;document.body.appendChild(s);
    }
    if(!document.querySelector('script[src="/static/market-watchlist-sync.js"]')){
      const s=document.createElement('script');s.src='/static/market-watchlist-sync.js';s.defer=true;document.body.appendChild(s);
    }
    if(!document.querySelector('script[src="/static/ticker-prices.js"]')){
      const s=document.createElement('script');s.src='/static/ticker-prices.js';s.defer=true;document.body.appendChild(s);
    }
    if(!document.querySelector('script[src="/static/wyze-camera.js"]')){
      const s=document.createElement('script');s.src='/static/wyze-camera.js';s.defer=true;document.body.appendChild(s);
    }
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
    const unit=match[2];
    track.style.animationDuration=`${value*2}${unit}`;
    track.dataset.halfSpeed='1';
  }

  function addHomeHeading(){
    const home=document.querySelector('[data-screen="home"]');
    if(!home||home.querySelector('.estate-home-heading')) return;
    const h=document.createElement('div');
    h.className='screen-heading estate-home-heading';
    h.innerHTML='<div><div class="eyebrow">PATTON ESTATE • PROPERTY STATUS</div><h2>Estate Overview</h2></div><div class="section-caption">Weather, climate, access and vehicle status</div>';
    home.insertBefore(h,home.firstChild);
  }

  function relabel(){
    setText('.brand h1','Patton Estate');
    setText('.location-block b',"Farm • Est’d. 1838");
    setText('.location-block small','Mt. Vernon, Missouri');

    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks){
      const e=stocks.querySelector('.eyebrow'); if(e)e.textContent='MARKETS • PORTFOLIO';
      const h=stocks.querySelector('h2'); if(h)h.textContent='Portfolio & Markets';
      const c=stocks.querySelector('.section-caption'); if(c)c.textContent='Owned positions • Webull account • market snapshots • entry zones';
    }

    addHomeHeading();

    const water=document.querySelector('[data-screen="water"]');
    if(water){
      const e=water.querySelector('.screen-heading .eyebrow'); if(e)e.textContent='WATER • WELLS • LEAK DETECTION';
      const h=water.querySelector('.screen-heading h2'); if(h)h.textContent='Water & Leak Watch';
    }

    const power=document.querySelector('[data-screen="power"]');
    if(power){
      const e=power.querySelector('.screen-heading .eyebrow'); if(e)e.textContent='ESTATE POWER • LOADS • SUPPLY';
      const h=power.querySelector('.screen-heading h2'); if(h)h.textContent='Energy & Electrical';
      const c=power.querySelector('.section-caption'); if(c)c.textContent='Main House and Rockhouse energy usage';
    }

    const cameras=document.querySelector('[data-screen="cameras"]');
    if(cameras){
      const e=cameras.querySelector('.camera-heading .eyebrow'); if(e)e.textContent='SECURITY • ESTATE WATCH';
      const h=cameras.querySelector('.camera-heading h2'); if(h)h.textContent='Security & Cameras';
    }

    const footer=document.querySelector('footer');
    if(footer) footer.innerHTML='Patton Estate <span>•</span> Settings: <b>farmpi.local:8080/settings</b>';
  }

  function maintainScreenLabel(){
    const labels={
      stocks:'Portfolio & Markets',
      activity:'Orders & Trading Activity',
      home:'Estate Overview',
      water:'Water & Leak Watch',
      power:'Energy & Electrical',
      cameras:'Security & Cameras',
      thesis:'Sunday Market Review'
    };
    const update=()=>{
      const active=document.querySelector('.screen.active');
      const el=document.getElementById('screenName');
      if(!active||!el)return;
      if(active.dataset.marketTitle)el.textContent=active.dataset.marketTitle;
      else if(labels[active.dataset.screen])el.textContent=labels[active.dataset.screen];
    };
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
    update();
  }

  function boot(){ensureActivityAssets();ensurePortfolioAssets();ensureMarketSequenceAssets();relabel();maintainScreenLabel();setTimeout(slowTickerToHalfSpeed,700);setTimeout(relabel,600);setTimeout(relabel,1800)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
