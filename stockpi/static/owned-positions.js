(function(){
  'use strict';

  var REFRESH_MS=15000;
  var PRIMARY_TIMEOUT_MS=25000;
  var SECONDARY_TIMEOUT_MS=12000;
  var CHART_TIMEOUT_MS=6000;
  var MAX_PER_PAGE=6;
  var chartCache={};
  var lastPositions=[];
  var lastQuotes={};
  var busy=false;
  var lastRotationSignature='';

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function number(){for(var i=0;i<arguments.length;i++){var n=Number(arguments[i]);if(Number.isFinite(n))return n;}return NaN;}
  function money(v){var n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
  function signedMoney(v){var n=Number(v);return Number.isFinite(n)?(n>=0?'+':'-')+money(Math.abs(n)):'—';}
  function signedPct(v){var n=Number(v);return Number.isFinite(n)?(n>=0?'↑ ':'↓ ')+Math.abs(n).toFixed(2)+'%':'—';}
  function shares(v){var n=Number(v);if(!Number.isFinite(n))return '—';return n.toFixed(n<10?5:2).replace(/0+$/,'').replace(/\.$/,'');}
  function tone(v){var n=Number(v);return !Number.isFinite(n)?'flat':n>0?'up':n<0?'down':'flat';}
  function identity(symbol){return window.getStockIdentity?window.getStockIdentity(symbol):{displayName:String(symbol||'').toUpperCase(),description:'Equity position',domain:null};}
  function logoCandidates(symbol){return window.getStockLogoCandidates?window.getStockLogoCandidates(symbol):[];}

  function fetchJSON(url,timeoutMs,fallback){
    return new Promise(function(resolve){
      var done=false;
      var timer=setTimeout(function(){if(!done){done=true;console.warn('1838 Estate timeout',url);resolve(fallback);}},timeoutMs);
      fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.json();}).then(function(data){if(!done){done=true;clearTimeout(timer);resolve(data);}}).catch(function(err){if(!done){done=true;clearTimeout(timer);console.warn('1838 Estate request failed',url,err);resolve(fallback);}});
    });
  }

  function logoHTML(symbol){
    var meta=identity(symbol),letter=esc(String(symbol||'?').charAt(0)),candidates=logoCandidates(symbol);
    if(!candidates.length)return '<span class="owned-logo"><span class="owned-logo-letter">'+letter+'</span></span>';
    var encoded=esc(JSON.stringify(candidates));
    return '<span class="owned-logo"><span class="owned-logo-letter">'+letter+'</span><img src="'+esc(candidates[0])+'" alt="'+esc(meta.displayName)+' logo" referrerpolicy="no-referrer" data-logo-index="0" data-logo-candidates=\''+encoded+'\' onerror="window.advanceStockLogo&&window.advanceStockLogo(this)"></span>';
  }

  function ensurePortfolio(){
    var screen=document.querySelector('.screen[data-screen="stocks"]');
    if(!screen)return null;
    screen.dataset.marketTitle='Portfolio';
    var eyebrow=screen.querySelector('.eyebrow'),title=screen.querySelector('h2'),caption=screen.querySelector('.section-caption');
    if(eyebrow)eyebrow.textContent='WEBULL • OWNED POSITIONS';
    if(title)title.textContent='Portfolio';
    if(caption)caption.textContent='Owned investments • cost • value • gain/loss • 1-day progress';
    ['rows','portfolioFocusRows','portfolioPanel'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('owned-legacy-hidden');});
    var summary=document.getElementById('ownedPortfolioSummary');
    if(!summary){summary=document.createElement('section');summary.id='ownedPortfolioSummary';summary.className='owned-summary-strip';var heading=screen.querySelector('.screen-heading');if(heading)heading.insertAdjacentElement('afterend',summary);}
    var root=document.getElementById('ownedPositionCards');
    if(!root){root=document.createElement('section');root.id='ownedPositionCards';root.className='owned-position-grid';summary.insertAdjacentElement('afterend',root);}
    if(!root.dataset.ready){root.dataset.ready='1';root.innerHTML='<div class="owned-empty owned-loading"><b>Loading portfolio…</b><span>Reading your owned Webull positions.</span></div>';}
    return {screen:screen,summary:summary,root:root};
  }

  function ensureMarkets(){
    var screen=document.querySelector('.screen[data-screen="markets"]');
    if(!screen){
      var main=document.querySelector('main.screens');if(!main)return null;
      screen=document.createElement('section');screen.className='screen';screen.dataset.screen='markets';screen.dataset.marketTitle='Markets';
      screen.innerHTML='<div class="screen-heading"><div><div class="eyebrow">MARKET WATCH • FOLLOWING</div><h2>Markets</h2></div><div class="section-caption">Stocks being followed • current price • daily move • entry levels</div></div><div id="marketsFollowGrid" class="markets-follow-grid"><div class="markets-empty"><b>Loading markets…</b><span>Portfolio loads first; market watch follows.</span></div></div>';
      main.appendChild(screen);
    }
    return screen.querySelector('#marketsFollowGrid');
  }

  function ensureContinuationPages(count){
    var main=document.querySelector('main.screens'),pages=[],keep={};if(!main)return pages;
    for(var p=2;p<=count;p++){
      var name='portfolio-'+p;keep[name]=true;
      var screen=document.querySelector('.screen[data-screen="'+name+'"]');
      if(!screen){screen=document.createElement('section');screen.className='screen portfolio-continuation-screen';screen.dataset.screen=name;screen.dataset.marketTitle='Portfolio '+p;screen.innerHTML='<div class="screen-heading"><div><div class="eyebrow">WEBULL • OWNED POSITIONS</div><h2>Portfolio</h2></div><div class="section-caption">Owned positions • page '+p+' of '+count+'</div></div><section id="ownedPositionCards-'+p+'" class="owned-position-grid"></section>';main.appendChild(screen);}
      pages.push({name:name,root:screen.querySelector('#ownedPositionCards-'+p)});
    }
    Array.prototype.forEach.call(document.querySelectorAll('.portfolio-continuation-screen'),function(s){if(!keep[s.dataset.screen])s.remove();});
    return pages;
  }

  function setPortfolioLayout(root,count){
    var cols=1,rows=1,density='roomy';
    if(count===2)cols=2;else if(count===3)cols=3;else if(count===4){cols=2;rows=2;density='normal';}else if(count===5||count===6){cols=3;rows=2;density='normal';}
    root.style.setProperty('--owned-cols',String(cols));root.style.setProperty('--owned-rows',String(rows));root.dataset.count=String(count);root.dataset.density=density;
  }
  function setMarketsLayout(root,count){var cols=count<=10?2:count<=15?3:4;root.style.setProperty('--markets-cols',String(cols));root.dataset.density=count<=10?'roomy':count<=15?'normal':'compact';}

  function quoteFromPosition(p){
    var m=p&&p.market&&typeof p.market==='object'?p.market:{};
    return {price:number(m.price,p.last_price,p.current_price),prev_close:number(m.prev_close,m.previous_close),pct:number(p.day_pct,m.pct)};
  }
  function metrics(p,q){
    q=q||{};
    var quantity=number(p.quantity,p.qty),avg=number(p.average_cost,p.avg_price,p.cost_price),current=number(q.price,p.last_price,p.current_price);
    var invested=number(p.cost_basis,p.position_usd,Number.isFinite(quantity)&&Number.isFinite(avg)?quantity*avg:NaN);
    var value=number(p.market_value,p.webull_market_value,Number.isFinite(quantity)&&Number.isFinite(current)?quantity*current:NaN);
    var totalPL=number(p.unrealized_pl,p.webull_unrealized_pl,Number.isFinite(value)&&Number.isFinite(invested)?value-invested:NaN);
    var totalPct=number(p.unrealized_pct,p.webull_unrealized_pct);
    if(Number.isFinite(totalPct)&&Math.abs(totalPct)<=1&&Math.abs(totalPL)>0.01)totalPct*=100;
    if(!Number.isFinite(totalPct)&&Number.isFinite(totalPL)&&invested)totalPct=totalPL/invested*100;
    var prev=number(q.prev_close,q.previous_close),dayPct=number(q.pct,p.day_pct,Number.isFinite(current)&&Number.isFinite(prev)&&prev?(current-prev)/prev*100:NaN),dayPL=number(p.day_pl,Number.isFinite(dayPct)&&Number.isFinite(value)?value*dayPct/100:NaN);
    return {quantity:quantity,avg:avg,current:current,invested:invested,value:value,totalPL:totalPL,totalPct:totalPct,prev:prev,dayPct:dayPct,dayPL:dayPL};
  }

  function sparkline(symbol,m){
    var vals=(chartCache[symbol]||[]).map(Number).filter(Number.isFinite),fallback=false;
    if(vals.length<2&&Number.isFinite(m.prev)&&Number.isFinite(m.current)){vals=[m.prev,m.current];fallback=true;}
    if(vals.length<2)return '<div class="owned-chart-empty">1D chart loading…</div>';
    var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals),span=max-min||Math.max(Math.abs(max)*.002,1);
    var pts=vals.map(function(v,i){var x=i/(vals.length-1)*100,y=46-(v-min)/span*40;return x.toFixed(2)+','+y.toFixed(2);}).join(' ');
    return '<svg class="owned-sparkline '+tone(m.dayPct)+'" viewBox="0 0 100 52" preserveAspectRatio="none"><line x1="0" y1="46" x2="100" y2="46" class="chart-baseline"/><polyline points="'+pts+'" fill="none" vector-effect="non-scaling-stroke"/></svg>'+(fallback?'<div class="owned-chart-fallback">OPEN → NOW</div>':'');
  }

  function renderCard(p,q){
    var symbol=String(p.symbol||'').toUpperCase(),meta=identity(symbol),m=metrics(p,q),gain=Number.isFinite(m.totalPL)&&m.totalPL>=0;
    return '<article class="owned-investment-card '+tone(m.totalPL)+'" data-symbol="'+esc(symbol)+'">'+
      '<header class="owned-card-head"><div class="owned-company">'+logoHTML(symbol)+'<div class="owned-company-copy"><b>'+esc(meta.displayName)+'</b><span class="owned-ticker">'+esc(symbol)+'</span><small>'+esc(meta.description)+'</small></div></div><div class="owned-current"><b>'+money(m.current)+'</b><span class="'+tone(m.dayPct)+'">'+signedPct(m.dayPct)+'</span></div></header>'+
      '<div class="owned-chart-wrap">'+sparkline(symbol,m)+'<div class="owned-chart-caption"><span>1 DAY</span><span class="'+tone(m.dayPct)+'">'+(Number.isFinite(m.dayPL)?signedMoney(m.dayPL)+' today':'Today')+'</span></div></div>'+
      '<section class="owned-investment-section"><div class="owned-investment-title">My investment</div><div class="owned-investment-hero"><div><b>'+money(m.invested)+'</b><span>Total invested</span></div><div class="owned-result '+tone(m.totalPL)+'"><b>'+signedMoney(m.totalPL)+'</b><span>'+(gain?'Gain':'Loss')+'</span></div></div><div class="owned-detail-list">'+
      '<div><span>Total value $</span><b>'+money(m.value)+'</b></div><div><span>'+(gain?'Total gain %':'Total loss %')+'</span><b class="'+tone(m.totalPL)+'">'+signedPct(m.totalPct)+'</b></div><div><span>Shares owned</span><b>'+shares(m.quantity)+'</b></div><div><span>Average cost per share</span><b>'+money(m.avg)+'</b></div><div><span>Current share price</span><b>'+money(m.current)+'</b></div></div></section></article>';
  }

  function renderSummary(positions,qmap){
    var invested=0,value=0,pl=0,chips=[];
    positions.forEach(function(p){var s=String(p.symbol||'').toUpperCase(),m=metrics(p,qmap[s]||quoteFromPosition(p));if(Number.isFinite(m.invested))invested+=m.invested;if(Number.isFinite(m.value))value+=m.value;if(Number.isFinite(m.totalPL))pl+=m.totalPL;chips.push('<div class="owned-summary-chip"><b>'+esc(s)+'</b><span>'+money(m.value)+'</span><em class="'+tone(m.dayPct)+'">'+signedPct(m.dayPct)+'</em></div>');});
    return '<div class="owned-summary-total"><span>Total invested</span><b>'+money(invested)+'</b></div><div class="owned-summary-total"><span>Total value</span><b>'+money(value)+'</b></div><div class="owned-summary-total"><span>Total gain / loss</span><b class="'+tone(pl)+'">'+signedMoney(pl)+'</b></div><div class="owned-summary-total"><span>Positions</span><b>'+positions.length+'</b></div><div class="owned-summary-chips">'+chips.join('')+'</div>';
  }

  function renderPortfolio(positions,qmap){
    var base=ensurePortfolio();if(!base)return [];
    base.summary.innerHTML=positions.length?renderSummary(positions,qmap):'<div class="owned-summary-total"><span>Portfolio</span><b>No positions</b></div>';
    var chunks=[];for(var i=0;i<positions.length;i+=MAX_PER_PAGE)chunks.push(positions.slice(i,i+MAX_PER_PAGE));if(!chunks.length)chunks.push([]);
    setPortfolioLayout(base.root,chunks[0].length);
    base.root.innerHTML=chunks[0].length?chunks[0].map(function(p){var s=String(p.symbol||'').toUpperCase();return renderCard(p,qmap[s]||quoteFromPosition(p));}).join(''):'<div class="owned-empty"><b>No owned positions found.</b><span>Webull returned no positive-share positions.</span></div>';
    var pages=ensureContinuationPages(chunks.length);
    pages.forEach(function(page,index){var rows=chunks[index+1]||[];setPortfolioLayout(page.root,rows.length);page.root.innerHTML=rows.map(function(p){var s=String(p.symbol||'').toUpperCase();return renderCard(p,qmap[s]||quoteFromPosition(p));}).join('');});
    return pages;
  }

  function followedStocks(stocks,positions){
    var owned={};positions.forEach(function(p){owned[String(p.symbol||'').toUpperCase()]=true;});
    return (Array.isArray(stocks)?stocks:[]).filter(function(s){var sym=String(s.symbol||'').toUpperCase();if(!sym||owned[sym]||s.owned||Number(s.position_usd)>0)return false;return Number.isFinite(number(s.buy,s.strong_buy,s.strong,s.aggressive_buy,s.aggressive))||!!s.note;});
  }
  function signal(stock,current){var a=number(stock.aggressive_buy,stock.aggressive),s=number(stock.strong_buy,stock.strong),b=number(stock.buy);if(Number.isFinite(current)&&Number.isFinite(a)&&current<=a)return'AGGRESSIVE BUY';if(Number.isFinite(current)&&Number.isFinite(s)&&current<=s)return'STRONG BUY';if(Number.isFinite(current)&&Number.isFinite(b)&&current<=b)return'BUY';return'HOLD';}
  function renderMarketCard(stock,q){var sym=String(stock.symbol||'').toUpperCase(),meta=identity(sym),current=number(q&&q.price,stock.webull_last_price),pct=number(q&&q.pct),action=signal(stock,current);return '<article class="market-follow-card"><div class="market-follow-main"><div class="market-follow-company">'+logoHTML(sym)+'<div><b>'+esc(meta.displayName)+'</b><span>'+esc(sym)+' • '+esc(meta.description)+'</span></div></div><div class="market-follow-price"><b>'+money(current)+'</b><span class="'+tone(pct)+'">'+signedPct(pct)+'</span></div><div class="market-follow-signal '+(action.indexOf('BUY')>=0?'buy':'')+'">'+action+'</div></div><div class="market-follow-levels"><div><span>Buy</span><b>'+money(stock.buy)+'</b></div><div><span>Strong Buy</span><b>'+money(number(stock.strong_buy,stock.strong))+'</b></div><div><span>Aggressive</span><b>'+money(number(stock.aggressive_buy,stock.aggressive))+'</b></div></div><div class="market-follow-note">'+esc(stock.note||'Following for a better entry.')+'</div></article>';}
  function renderMarkets(stocks,positions,qmap){var root=ensureMarkets();if(!root)return;var followed=followedStocks(stocks,positions);setMarketsLayout(root,followed.length);root.innerHTML=followed.length?followed.map(function(s){return renderMarketCard(s,qmap[String(s.symbol||'').toUpperCase()]||{});}).join(''):'<div class="markets-empty"><b>No followed stocks configured.</b><span>Stocks with saved entry levels appear here automatically.</span></div>';}

  function updateRotation(extra){
    try{if(typeof cfg==='undefined'||!Array.isArray(cfg.screens))return;var active=document.querySelector('.screen.active'),activeName=active?active.dataset.screen:'';var wanted=['stocks'].concat(extra||[]).concat(['markets','activity','home','water','power','thesis']);var available=wanted.filter(function(n){return !!document.querySelector('.screen[data-screen="'+n+'"]');});var sig=available.join('|');var changed=sig!==lastRotationSignature||cfg.screens.join('|')!==sig;cfg.rotation_enabled=true;if(changed){cfg.screens=available;var keep=available.indexOf(activeName);if(typeof idx!=='undefined')idx=keep>=0?keep:0;if(typeof buildDots==='function')buildDots();lastRotationSignature=sig;}if(changed&&typeof schedule==='function')schedule();}catch(e){console.warn('1838 Estate rotation update failed',e);}
  }

  function loadCharts(positions){
    positions.forEach(function(p){var sym=String(p.symbol||'').toUpperCase();fetchJSON(location.protocol+'//'+location.hostname+':8092/api/chart/'+encodeURIComponent(sym),CHART_TIMEOUT_MS,null).then(function(data){if(data&&Array.isArray(data.points)&&data.points.length>=2){chartCache[sym]=data.points;renderPortfolio(lastPositions,lastQuotes);}});});
  }

  function secondaryRefresh(positions){
    return fetchJSON('/api/quotes',SECONDARY_TIMEOUT_MS,{quotes:{}}).then(function(qr){
      var qmap=qr&&qr.quotes&&typeof qr.quotes==='object'?qr.quotes:{};
      positions.forEach(function(p){var s=String(p.symbol||'').toUpperCase(),fromPos=quoteFromPosition(p);if(!qmap[s])qmap[s]=fromPos;else{if(!Number.isFinite(Number(qmap[s].price)))qmap[s].price=fromPos.price;if(!Number.isFinite(Number(qmap[s].pct)))qmap[s].pct=fromPos.pct;if(!Number.isFinite(Number(qmap[s].prev_close)))qmap[s].prev_close=fromPos.prev_close;}});
      lastQuotes=qmap;renderPortfolio(positions,qmap);
      return fetchJSON('/api/stocks',SECONDARY_TIMEOUT_MS,[]).then(function(stocks){renderMarkets(stocks,positions,qmap);});
    });
  }

  function showError(message){var base=ensurePortfolio();if(base)base.root.innerHTML='<div class="owned-empty owned-error"><b>Portfolio display error</b><span>'+esc(message)+'</span></div>';var st=document.getElementById('status');if(st)st.textContent='Portfolio data error • retrying';}

  function refresh(){
    if(busy)return;busy=true;
    var base=ensurePortfolio();ensureMarkets();if(!base){busy=false;return;}
    fetchJSON('/api/webull/summary',PRIMARY_TIMEOUT_MS,null).then(function(webull){
      if(!webull){showError('Webull summary did not answer in time.');return;}
      var raw=Array.isArray(webull.positions)?webull.positions:[];
      var positions=raw.filter(function(p){return number(p.quantity,p.qty)>0;});
      var qmap={};positions.forEach(function(p){qmap[String(p.symbol||'').toUpperCase()]=quoteFromPosition(p);});
      lastPositions=positions;lastQuotes=qmap;
      var pages=renderPortfolio(positions,qmap);updateRotation(pages.map(function(p){return p.name;}));
      var st=document.getElementById('status');if(st)st.textContent=positions.length?'Systems online • '+positions.length+' owned position'+(positions.length===1?'':'s'):'Webull connected • no owned positions';
      window.ownedPortfolioRendererReady=true;
      secondaryRefresh(positions).catch(function(e){console.warn('secondary market refresh',e);});
      loadCharts(positions);
    }).catch(function(e){showError(e&&e.message?e.message:String(e));}).finally(function(){busy=false;});
  }

  function boot(){ensurePortfolio();ensureMarkets();window.ownedPortfolioRefresh=refresh;setTimeout(refresh,200);setInterval(refresh,REFRESH_MS);document.addEventListener('farm-screen-change',function(e){var n=e&&e.detail?String(e.detail.screen||''):'';if(n==='stocks'||n==='markets'||n.indexOf('portfolio-')===0)setTimeout(refresh,100);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
