(() => {
  let thesisData=null, raf=null, lastTs=0, y=0, maxY=0, active=false, pauseUntil=0;
  const SPEED=18;
  const TOP_PAUSE=4500;
  const SECTION_PAUSE=1800;
  const END_PAUSE=5000;
  let sectionStops=[];

  const HOUSE='/static/38C388BD-A21A-4A6D-9EC6-14B5CC26F7C1.png';
  const BOB='/static/0CDB6933-4ACC-42AC-9089-600D0BDC904E.png';
  const LIVE_THESIS='https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi/static/thesis.json';
  const money=v=>v==null?'—':'$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pctDistance=(close,buy)=>buy?((close-buy)/buy)*100:null;
  const paraHtml=v=>(Array.isArray(v)?v:[v]).filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join('');

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
      <div class="thesis-sticky"><div class="thesis-sticky-left"><img src="${HOUSE}" alt="Main House"><div class="title" id="thesisStickyTitle">SUNDAY THESIS</div></div><div class="status" id="thesisStickyStatus">Loading latest review…</div></div>
      <div class="thesis-viewport" id="thesisViewport"><div class="thesis-track" id="thesisTrack"><div class="thesis-hero"><div class="thesis-hero-copy"><div class="thesis-kicker">INVESTMENT RESEARCH</div><h2>Loading latest thesis…</h2></div></div></div></div>
      <div class="thesis-progress"><i id="thesisProgress"></i></div>
    </div>`;
    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks?.nextSibling) main.insertBefore(s,stocks.nextSibling); else main.appendChild(s);
  }

  function overviewChart(stocks){
    const vals=stocks.map(s=>({symbol:s.symbol,d:pctDistance(s.close,s.buy)})).filter(x=>x.d!=null);
    const max=Math.max(1,...vals.map(x=>Math.abs(x.d)));
    return vals.map(x=>{
      const inZone=x.d<=0, width=Math.max(5,Math.min(100,Math.abs(x.d)/max*100));
      return `<div class="distance-row ${inZone?'in-zone':''}"><b>${esc(x.symbol)}</b><div class="distance-bar"><i style="--w:${width.toFixed(1)}%"></i></div><span>${x.d>0?'+':''}${x.d.toFixed(1)}%</span></div>`;
    }).join('');
  }

  function stockCard(s){
    const action=(s.action||'HOLD').toUpperCase();
    const actionClass=action.includes('BUY')?'buy':action.includes('WARNING')||action.includes('SELL')?'warn':'';
    return `<article class="thesis-stock" data-thesis-stop>
      <div class="thesis-stock-head">
        <div class="thesis-symbol-wrap"><div><div class="thesis-symbol">${esc(s.symbol)}</div><div class="thesis-company">${esc(s.company)}</div></div></div>
        <div class="thesis-badges"><span class="thesis-badge ${actionClass}">${esc(action)}</span><span class="thesis-badge intact">THESIS ${esc(s.thesis_status||'INTACT')}</span></div>
      </div>
      <div class="thesis-headline">${esc(s.headline)}</div>
      <div class="thesis-metrics">
        <div class="thesis-metric"><span>Review close</span><b>${money(s.close)}</b></div>
        <div class="thesis-metric"><span>Buy</span><b>≤ ${money(s.buy)}</b></div>
        <div class="thesis-metric"><span>Strong buy</span><b>≤ ${money(s.strong)}</b></div>
        <div class="thesis-metric"><span>Aggressive</span><b>≤ ${money(s.aggressive)}</b></div>
      </div>
      <div class="thesis-body">${paraHtml(s.paragraphs||s.body)}</div>
      ${s.verdict?`<div class="thesis-verdict"><span>Verdict</span><b>${esc(s.verdict)}</b></div>`:''}
      <div class="thesis-two-col"><div class="thesis-note"><span>Key catalyst</span><b>${esc(s.catalyst)}</b></div><div class="thesis-note risk"><span>Primary risk</span><b>${esc(s.risk)}</b></div></div>
    </article>`;
  }

  function render(d){
    thesisData=d;
    const date=new Date(d.review_date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    document.getElementById('thesisStickyTitle').textContent=`SUNDAY THESIS • ${d.review_date}`;
    document.getElementById('thesisStickyStatus').textContent=d.status_line||'';
    const track=document.getElementById('thesisTrack');
    track.innerHTML=`
      <section class="thesis-hero" data-thesis-stop>
        <div class="thesis-hero-copy">
          <div class="thesis-kicker">FARM • INVESTMENT RESEARCH • WEEKLY VALIDATION</div>
          <h2>${esc(d.title||'Sunday Investment Thesis')}</h2>
          <div class="thesis-date">${esc(date)}</div>
          <div class="thesis-summary">${paraHtml(d.summary_paragraphs||d.summary)}</div>
        </div>
        <div class="thesis-hero-art"><img src="${HOUSE}" alt="Main House"><div class="thesis-bob-chip"><img src="${BOB}" alt="Bob"></div></div>
      </section>
      ${d.intro_paragraphs?.length?`<section class="thesis-prose-block" data-thesis-stop><div class="thesis-body">${paraHtml(d.intro_paragraphs)}</div></section>`:''}
      <div class="thesis-overview-grid" data-thesis-stop>
        <article class="thesis-card"><h3>New money ranking</h3><div class="ranking">${(d.new_money_ranking||[]).map((x,i)=>`<span class="rank-pill">${i+1}. ${esc(x)}</span>`).join('')}</div></article>
        <article class="thesis-card"><h3>Distance from starter buy</h3><div class="distance-chart">${overviewChart(d.stocks||[])}</div></article>
      </div>
      ${(d.stocks||[]).map(stockCard).join('')}
      ${d.portfolio_conclusion?.length?`<section class="thesis-conclusion" data-thesis-stop><div class="thesis-kicker">PORTFOLIO CONCLUSION</div><div class="thesis-body">${paraHtml(d.portfolio_conclusion)}</div></section>`:''}
      <section class="thesis-end" data-thesis-stop><img src="${BOB}" alt="Bob"><h3>${esc(d.status_line||'Review complete')}</h3></section>`;
    recalc();
  }

  function recalc(){
    const vp=document.getElementById('thesisViewport'), track=document.getElementById('thesisTrack');
    if(!vp||!track) return;
    maxY=Math.max(0,track.scrollHeight-vp.clientHeight+36);
    sectionStops=[...track.querySelectorAll('[data-thesis-stop]')].map(el=>Math.max(0,el.offsetTop-90));
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
        if(label) label.textContent='Investment Thesis';
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
      catch(e2){ const t=document.getElementById('thesisTrack'); if(t)t.innerHTML='<div class="thesis-hero"><div class="thesis-hero-copy"><div class="thesis-kicker">FARM • INVESTMENT RESEARCH</div><h2>Latest thesis unavailable</h2><div class="thesis-summary">The dashboard will retry automatically.</div></div></div>'; }
    }
  }

  function boot(){makeScreen();watchScreen();load();setInterval(load,300000);window.addEventListener('resize',recalc)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
