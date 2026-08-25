(() => {
  let thesisData=null, raf=null, lastTs=0, y=0, maxY=0, active=false, pauseUntil=0;
  const SPEED=38;
  const TOP_PAUSE=2500;
  const SECTION_PAUSE=700;
  const END_PAUSE=2500;
  let sectionStops=[];

  const HOUSE='/static/38C388BD-A21A-4A6D-9EC6-14B5CC26F7C1.png';
  const BOB='/static/art1/bob.png';
  const LIVE_THESIS='https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi/static/thesis.json';
  const money=v=>v==null?'—':'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paraHtml=v=>(Array.isArray(v)?v:[v]).filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join('');

  function ensureSummaryStyles(){
    if(document.querySelector('link[href="/static/thesis-summary.css"]')) return;
    const l=document.createElement('link'); l.rel='stylesheet'; l.href='/static/thesis-summary.css'; document.head.appendChild(l);
  }

  function holdRotation(){
    try{ clearTimeout(timer); }catch(e){}
  }

  function makeScreen(){
    if(document.querySelector('[data-screen="thesis"]')) return;
    const main=document.querySelector('main.screens'); if(!main) return;
    const s=document.createElement('section');
    s.className='screen thesis-screen';
    s.dataset.screen='thesis';
    s.innerHTML=`<div class="thesis-shell thesis-paused" id="thesisShell">
      <div class="thesis-sticky"><div class="thesis-sticky-left"><img src="${HOUSE}" alt="Main House"><div class="title" id="thesisStickyTitle">MARKET POSITION REVIEW</div></div><div class="status" id="thesisStickyStatus">Loading latest review…</div></div>
      <div class="thesis-viewport" id="thesisViewport"><div class="thesis-track" id="thesisTrack"><div class="thesis-hero"><div class="thesis-hero-copy"><div class="thesis-kicker">INVESTMENT RESEARCH</div><h2>Loading market review…</h2></div></div></div></div>
      <div class="thesis-progress"><i id="thesisProgress"></i></div>
    </div>`;
    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks?.nextSibling) main.insertBefore(s,stocks.nextSibling); else main.appendChild(s);
  }

  function compactStockRow(s){
    const action=(s.action||'HOLD').toUpperCase();
    const actionClass=action.includes('BUY')?'buy':action.includes('WARNING')||action.includes('SELL')?'warn':'';
    return `<article class="thesis-stock thesis-stock-compact">
      <div class="compact-symbol"><div class="thesis-symbol">${esc(s.symbol)}</div><div class="thesis-company">${esc(s.company)}</div></div>
      <div class="compact-action"><span class="thesis-badge ${actionClass}">${esc(action)}</span><span class="thesis-badge intact">${esc(s.thesis_status||'INTACT')}</span></div>
      <div class="compact-price"><span>Close</span><b>${money(s.close)}</b></div>
      <div class="compact-price"><span>Buy</span><b>≤ ${money(s.buy)}</b></div>
      <div class="compact-price"><span>Strong</span><b>≤ ${money(s.strong)}</b></div>
      <div class="compact-headline">${esc(s.headline||'')}</div>
    </article>`;
  }

  function render(d){
    thesisData=d;
    const stocks=d.stocks||[];
    const date=new Date(d.review_date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    const buys=stocks.filter(s=>(s.action||'').toUpperCase().includes('BUY'));
    const near=stocks.filter(s=>(s.action||'').toUpperCase().includes('APPROACHING'));
    const warnings=stocks.filter(s=>(s.thesis_status||'INTACT').toUpperCase()!=='INTACT');
    const leadSummary=(d.summary_paragraphs||d.summary||[]);
    const summary=Array.isArray(leadSummary)?leadSummary.slice(0,1):[leadSummary];

    document.getElementById('thesisStickyTitle').textContent=`MARKET POSITION REVIEW • ${d.review_date}`;
    document.getElementById('thesisStickyStatus').textContent=d.status_line||'';
    const track=document.getElementById('thesisTrack');
    track.innerHTML=`
      <section class="thesis-hero thesis-hero-compact" data-thesis-stop>
        <div class="thesis-hero-copy">
          <div class="thesis-kicker">FARM • INVESTMENT RESEARCH • WEEKLY SUMMARY</div>
          <h2>Market Position Review</h2>
          <div class="thesis-date">${esc(date)}</div>
          <div class="thesis-summary">${paraHtml(summary)}</div>
        </div>
        <div class="thesis-hero-art"><img src="${HOUSE}" alt="Main House"><div class="thesis-bob-chip"><img src="${BOB}" alt="Bob"></div></div>
      </section>

      <section class="market-summary-grid" data-thesis-stop>
        <article class="thesis-card market-summary-card"><span>BUY NOW</span><b>${buys.length?buys.map(x=>esc(x.symbol)).join(' • '):'None'}</b></article>
        <article class="thesis-card market-summary-card"><span>NEAREST BUY</span><b>${near.length?near.map(x=>esc(x.symbol)).join(' • '):(d.new_money_ranking?.[0]?esc(d.new_money_ranking[0]):'—')}</b></article>
        <article class="thesis-card market-summary-card"><span>THESIS WARNINGS</span><b>${warnings.length?warnings.map(x=>esc(x.symbol)).join(' • '):'None'}</b></article>
        <article class="thesis-card market-summary-card"><span>NEW MONEY RANKING</span><b>${(d.new_money_ranking||[]).slice(0,4).map(esc).join(' → ')||'—'}</b></article>
      </section>

      <section class="compact-position-list" data-thesis-stop>
        <div class="compact-list-title"><span>POSITION SUMMARY</span><small>Current close vs. existing entry zones</small></div>
        ${stocks.map(compactStockRow).join('')}
      </section>

      <section class="thesis-end thesis-end-compact" data-thesis-stop><img src="${BOB}" alt="Bob"><h3>${esc(d.status_line||'Review complete')}</h3></section>`;
    recalc();
  }

  function recalc(){
    const vp=document.getElementById('thesisViewport'), track=document.getElementById('thesisTrack');
    if(!vp||!track) return;
    maxY=Math.max(0,track.scrollHeight-vp.clientHeight+24);
    sectionStops=[...track.querySelectorAll('[data-thesis-stop]')].map(el=>Math.max(0,el.offsetTop-86));
  }

  function setY(v){
    y=Math.max(0,Math.min(maxY,v));
    const track=document.getElementById('thesisTrack'); if(track) track.style.transform=`translateY(${-y}px)`;
    const p=document.getElementById('thesisProgress'); if(p) p.style.width=(maxY?y/maxY*100:100)+'%';
  }

  function start(){
    if(active) return;
    active=true; lastTs=0; setY(0); recalc();
    pauseUntil=performance.now()+TOP_PAUSE;
    document.getElementById('thesisShell')?.classList.add('thesis-paused');
    holdRotation();
    if(maxY<=1){
      setTimeout(()=>{
        if(!active) return;
        stop();
        try{ showScreen((idx+1)%cfg.screens.length); }catch(e){}
      },7000);
      return;
    }
    raf=requestAnimationFrame(tick);
  }

  function stop(){active=false;if(raf)cancelAnimationFrame(raf);raf=null;}

  function tick(ts){
    if(!active) return;
    holdRotation();
    if(!lastTs) lastTs=ts;
    const shell=document.getElementById('thesisShell');
    if(ts<pauseUntil){ shell?.classList.add('thesis-paused'); lastTs=ts; raf=requestAnimationFrame(tick); return; }
    shell?.classList.remove('thesis-paused');
    const prev=y, dt=Math.min(.1,(ts-lastTs)/1000); lastTs=ts; setY(y+SPEED*dt);
    const crossed=sectionStops.find(stop=>stop>prev+2 && stop<=y+2);
    if(crossed!=null){ setY(crossed); pauseUntil=ts+SECTION_PAUSE; }
    if(y>=maxY-1){
      setY(maxY);
      shell?.classList.add('thesis-paused');
      holdRotation();
      setTimeout(()=>{
        if(!active) return;
        stop();
        try{ showScreen((idx+1)%cfg.screens.length); }catch(e){}
      },END_PAUSE);
      return;
    }
    raf=requestAnimationFrame(tick);
  }

  function watchScreen(){
    const main=document.querySelector('main.screens'); if(!main) return;
    const handle=()=>{
      const isActive=document.querySelector('.screen.active')?.dataset.screen==='thesis';
      const label=document.getElementById('screenName');
      if(isActive){
        if(label) label.textContent='Market Position Review';
        holdRotation();
        start();
        holdRotation();
      } else if(active) stop();
    };
    new MutationObserver(handle).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
    handle();
  }

  async function getJson(url){
    const r=await fetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function load(){
    try{ render(await getJson(LIVE_THESIS)); }
    catch(e){
      try{ render(await getJson('/static/thesis.json')); }
      catch(e2){ const t=document.getElementById('thesisTrack'); if(t)t.innerHTML='<div class="thesis-hero"><div class="thesis-hero-copy"><div class="thesis-kicker">FARM • INVESTMENT RESEARCH</div><h2>Latest review unavailable</h2><div class="thesis-summary">The dashboard will retry automatically.</div></div></div>'; }
    }
  }

  function boot(){ensureSummaryStyles();makeScreen();watchScreen();load();setInterval(load,300000);window.addEventListener('resize',recalc)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
