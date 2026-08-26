(function(){
  'use strict';

  var REFRESH_MS = 30000;
  var LIVE_TIMEOUT_MS = 30000;
  var SECONDARY_TIMEOUT_MS = 15000;
  var CHART_TIMEOUT_MS = 7000;
  var MAX_PER_PAGE = 6;
  var chartCache = {};
  var currentPositions = [];
  var currentQuotes = {};
  var refreshing = false;
  var lastRotation = '';

  function finite(v){var n=Number(v);return typeof n==='number' && isFinite(n);}
  function num(){for(var i=0;i<arguments.length;i++){var n=Number(arguments[i]);if(isFinite(n))return n;}return NaN;}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(v){var n=Number(v);return isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
  function signedMoney(v){var n=Number(v);return isFinite(n)?(n>=0?'+':'-')+money(Math.abs(n)):'—';}
  function signedPct(v){var n=Number(v);return isFinite(n)?(n>=0?'↑ ':'↓ ')+Math.abs(n).toFixed(2)+'%':'—';}
  function shares(v){var n=Number(v);if(!isFinite(n))return '—';return n.toFixed(n<10?5:2).replace(/0+$/,'').replace(/\.$/,'');}
  function tone(v){var n=Number(v);return !isFinite(n)?'flat':n>0?'up':n<0?'down':'flat';}

  function identity(symbol){
    if(window.getStockIdentity)return window.getStockIdentity(symbol);
    return {displayName:String(symbol||'').toUpperCase(),description:'Equity position',domain:null};
  }
  function logoCandidates(symbol){return window.getStockLogoCandidates?window.getStockLogoCandidates(symbol):[];}

  function fetchJSON(url,timeoutMs,fallback){
    return new Promise(function(resolve){
      var settled=false;
      var timer=setTimeout(function(){if(!settled){settled=true;resolve(fallback);}},timeoutMs);
      fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.json();}).then(function(data){if(!settled){settled=true;clearTimeout(timer);resolve(data);}}).catch(function(){if(!settled){settled=true;clearTimeout(timer);resolve(fallback);}});
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
    screen.setAttribute('data-market-title','Portfolio');
    var e=screen.querySelector('.eyebrow'),h=screen.querySelector('h2'),c=screen.querySelector('.section-caption');
    if(e)e.textContent='WEBULL • OWNED POSITIONS';
    if(h)h.textContent='Portfolio';
    if(c)c.textContent='Owned investments • cost • value • gain/loss • 1-day progress';
    ['rows','portfolioFocusRows','portfolioPanel'].forEach(function(id){var x=document.getElementById(id);if(x)x.classList.add('owned-legacy-hidden');});

    var summary=document.getElementById('ownedPortfolioSummary');
    if(!summary){summary=document.createElement('section');summary.id='ownedPortfolioSummary';summary.className='owned-summary-strip';var heading=screen.querySelector('.screen-heading');if(heading)heading.insertAdjacentElement('afterend',summary);}
    var root=document.getElementById('ownedPositionCards');
    if(!root){root=document.createElement('section');root.id='ownedPositionCards';root.className='owned-position-grid';summary.insertAdjacentElement('afterend',root);}
    if(!root.getAttribute('data-initialized')){
      root.setAttribute('data-initialized','1');
      root.innerHTML='<div class="owned-empty owned-loading"><b>Loading portfolio…</b><span>Preparing owned positions.</span></div>';
    }
    return {screen:screen,summary:summary,root:root};
  }

  function ensureMarkets(){
    var screen=document.querySelector('.screen[data-screen="markets"]');
    if(!screen){
      var main=document.querySelector('main.screens');if(!main)return null;
      screen=document.createElement('section');screen.className='screen';screen.setAttribute('data-screen','markets');screen.setAttribute('data-market-title','Markets');
      screen.innerHTML='<div class="screen-heading"><div><div class="eyebrow">MARKET WATCH • FOLLOWING</div><h2>Markets</h2></div><div class="section-caption">Stocks being followed • current price • daily move • entry levels</div></div><div id="marketsFollowGrid" class="markets-follow-grid"><div class="markets-empty"><b>Loading markets…</b><span>Portfolio loads first.</span></div></div>';
      main.appendChild(screen);
    }
    return screen.querySelector('#marketsFollowGrid');
  }

  function setPortfolioLayout(root,count){
    var cols=1,rows=1,density='roomy';
    if(count===2)cols=2;
    else if(count===3)cols=3;
    else if(count===4){cols=2;rows=2;density='normal';}
    else if(count===5||count===6){cols=3;rows=2;density='normal';}
    root.style.setProperty('--owned-cols',String(cols));
    root.style.setProperty('--owned-rows',String(rows));
    root.setAttribute('data-count',String(count));
    root.setAttribute('data-density',density);
  }

  function ensureContinuationPages(pageCount){
    var main=document.querySelector('main.screens'),pages=[],keep={};
    if(!main)return pages;
    for(var p=2;p<=pageCount;p++){
      var name='portfolio-'+p;keep[name]=true;
      var screen=document.querySelector('.screen[data-screen="'+name+'"]');
      if(!screen){
        screen=document.createElement('section');screen.className='screen portfolio-continuation-screen';screen.setAttribute('data-screen',name);screen.setAttribute('data-market-title','Portfolio '+p);
        screen.innerHTML='<div class="screen-heading"><div><div class="eyebrow">WEBULL • OWNED POSITIONS</div><h2>Portfolio</h2></div><div class="section-caption">Owned positions • page '+p+' of '+pageCount+'</div></div><section id="ownedPositionCards-'+p+'" class="owned-position-grid"></section>';
        main.appendChild(screen);
      }
      pages.push({name:name,root:screen.querySelector('#ownedPositionCards-'+p)});
    }
    var old=document.querySelectorAll('.portfolio-continuation-screen');
    for(var i=0;i<old.length;i++)if(!keep[old[i].getAttribute('data-screen')])old[i].remove();
    return pages;
  }

  function quoteFromPosition(p){
    var m=p&&p.market&&typeof p.market==='object'?p.market:{};
    return {price:num(m.price,p.last_price,p.current_price),prev_close:num(m.prev_close,m.previous_close),pct:num(p.day_pct,m.pct)};
  }

  function metrics(p,q){
    q=q||{};
    var quantity=num(p.quantity,p.qty),avg=num(p.average_cost,p.avg_price,p.cost_price),current=num(q.price,p.last_price,p.current_price);
    var invested=num(p.cost_basis,p.position_usd,isFinite(quantity)&&isFinite(avg)?quantity*avg:NaN);
    var value=num(p.market_value,p.webull_market_value,isFinite(quantity)&&isFinite(current)?quantity*current:NaN);
    var totalPL=num(p.unrealized_pl,p.webull_unrealized_pl,isFinite(value)&&isFinite(invested)?value-invested:NaN);
    var totalPct=num(p.unrealized_pct,p.webull_unrealized_pct);
    if(isFinite(totalPct)&&Math.abs(totalPct)<=1&&Math.abs(totalPL)>0.01)totalPct*=100;
    if(!isFinite(totalPct)&&isFinite(totalPL)&&invested)totalPct=totalPL/invested*100;
    var prev=num(q.prev_close,q.previous_close),dayPct=num(q.pct,p.day_pct,isFinite(current)&&isFinite(prev)&&prev?(current-prev)/prev*100:NaN);
    var dayPL=num(p.day_pl,isFinite(dayPct)&&isFinite(value)?value*dayPct/100:NaN);
    return {quantity:quantity,avg:avg,current:current,invested:invested,value:value,totalPL:totalPL,totalPct:totalPct,prev:prev,dayPct:dayPct,dayPL:dayPL};
  }

  function sparkline(symbol,m){
    var vals=(chartCache[symbol]||[]).map(Number).filter(function(v){return isFinite(v);});
    var fallback=false;
    if(vals.length<2&&isFinite(m.prev)&&isFinite(m.current)){vals=[m.prev,m.current];fallback=true;}
    if(vals.length<2)return '<div class="owned-chart-empty">1D chart loading…</div>';
    var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals),span=max-min||Math.max(Math.abs(max)*.002,1),pts=[];
    for(var i=0;i<vals.length;i++){var x=i/(vals.length-1)*100,y=46-(vals[i]-min)/span*40;pts.push(x.toFixed(2)+','+y.toFixed(2));}
    return '<svg class="owned-sparkline '+tone(m.dayPct)+'" viewBox="0 0 100 52" preserveAspectRatio="none"><line x1="0" y1="46" x2="100" y2="46" class="chart-baseline"/><polyline points="'+pts.join(' ')+'" fill="none" vector-effect="non-scaling-stroke"/></svg>'+(fallback?'<div class="owned-chart-fallback">OPEN → NOW</div>':'');
  }

  function renderCard(p,q){
    var symbol=String(p.symbol||'').toUpperCase(),meta=identity(symbol),m=metrics(p,q),gain=isFinite(m.totalPL)&&m.totalPL>=0;
    return '<article class="owned-investment-card '+tone(m.totalPL)+'" data-symbol="'+esc(symbol)+'">'+
      '<header class="owned-card-head"><div class="owned-company">'+logoHTML(symbol)+'<div class="owned-company-copy"><b>'+esc(meta.displayName)+'</b><span class="owned-ticker">'+esc(symbol)+'</span><small>'+esc(meta.description)+'</small></div></div><div class="owned-current"><b>'+money(m.current)+'</b><span class="'+tone(m.dayPct)+'">'+signedPct(m.dayPct)+'</span></div></header>'+
      '<div class="owned-chart-wrap">'+sparkline(symbol,m)+'<div class="owned-chart-caption"><span>1 DAY</span><span class="'+tone(m.dayPct)+'">'+(isFinite(m.dayPL)?signedMoney(m.dayPL)+' today':'Today')+'</span></div></div>'+
      '<section class="owned-investment-section"><div class="owned-investment-title">My investment</div><div class="owned-investment-hero"><div><b>'+money(m.invested)+'</b><span>Total invested</span></div><div class="owned-result '+tone(m.totalPL)+'"><b>'+signedMoney(m.totalPL)+'</b><span>'+(gain?'Gain':'Loss')+'</span></div></div><div class="owned-detail-list">'+
      '<div><span>Total value $</span><b>'+money(m.value)+'</b></div><div><span>'+(gain?'Total gain %':'Total loss %')+'</span><b class="'+tone(m.totalPL)+'">'+signedPct(m.totalPct)+'</b></div><div><span>Shares owned</span><b>'+shares(m.quantity)+'</b></div><div><span>Average cost per share</span><b>'+money(m.avg)+'</b></div><div><span>Current share price</span><b>'+money(m.current)+'</b></div></div></section></article>';
  }

  function renderSummary(positions,qmap){
    var invested=0,value=0,pl=0,chips=[];
    for(var i=0;i<positions.length;i++){
      var p=positions[i],s=String(p.symbol||'').toUpperCase(),m=metrics(p,qmap[s]||quoteFromPosition(p));
      if(isFinite(m.invested))invested+=m.invested;if(isFinite(m.value))value+=m.value;if(isFinite(m.totalPL))pl+=m.totalPL;
      chips.push('<div class="owned-summary-chip"><b>'+esc(s)+'</b><span>'+money(m.value)+'</span><em class="'+tone(m.dayPct)+'">'+signedPct(m.dayPct)+'</em></div>');
    }
    return '<div class="owned-summary-total"><span>Total invested</span><b>'+money(invested)+'</b></div><div class="owned-summary-total"><span>Total value</span><b>'+money(value)+'</b></div><div class="owned-summary-total"><span>Total gain / loss</span><b class="'+tone(pl)+'">'+signedMoney(pl)+'</b></div><div class="owned-summary-total"><span>Positions</span><b>'+positions.length+'</b></div><div class="owned-summary-chips">'+chips.join('')+'</div>';
  }

  function renderPortfolio(positions,qmap,source){
    var base=ensurePortfolio();if(!base)return [];
    base.root.setAttribute('data-render-source',source||'unknown');
    base.summary.innerHTML=positions.length?renderSummary(positions,qmap):'<div class="owned-summary-total"><span>Portfolio</span><b>No positions</b></div>';
    var chunks=[];for(var i=0;i<positions.length;i+=MAX_PER_PAGE)chunks.push(positions.slice(i,i+MAX_PER_PAGE));if(!chunks.length)chunks.push([]);
    setPortfolioLayout(base.root,chunks[0].length);
    base.root.innerHTML=chunks[0].length?chunks[0].map(function(p){var s=String(p.symbol||'').toUpperCase();return renderCard(p,qmap[s]||quoteFromPosition(p));}).join(''):'<div class="owned-empty"><b>No owned positions found.</b><span>Waiting for Webull.</span></div>';
    var pages=ensureContinuationPages(chunks.length);
    for(var j=0;j<pages.length;j++){var rows=chunks[j+1]||[];setPortfolioLayout(pages[j].root,rows.length);pages[j].root.innerHTML=rows.map(function(p){var s=String(p.symbol||'').toUpperCase();return renderCard(p,qmap[s]||quoteFromPosition(p));}).join('');}
    currentPositions=positions.slice();
    return pages;
  }

  function updateRotation(extra){
    try{
      if(typeof cfg==='undefined'||!cfg.screens)return;
      var wanted=['stocks'].concat(extra||[]).concat(['markets','activity','home','water','power','thesis']),available=[];
      for(var i=0;i<wanted.length;i++)if(document.querySelector('.screen[data-screen="'+wanted[i]+'"]'))available.push(wanted[i]);
      var sig=available.join('|');cfg.rotation_enabled=true;
      if(sig!==lastRotation){cfg.screens=available;lastRotation=sig;if(typeof buildDots==='function')buildDots();if(typeof schedule==='function')schedule();}
    }catch(e){}
  }

  function setMarketsLayout(root,count){var cols=count<=10?2:count<=15?3:4;root.style.setProperty('--markets-cols',String(cols));root.setAttribute('data-density',count<=10?'roomy':count<=15?'normal':'compact');}
  function followedStocks(stocks,positions){var owned={};for(var i=0;i<positions.length;i++)owned[String(positions[i].symbol||'').toUpperCase()]=true;return (stocks||[]).filter(function(s){var sym=String(s.symbol||'').toUpperCase();if(!sym||owned[sym]||s.owned||Number(s.position_usd)>0)return false;return isFinite(num(s.buy,s.strong_buy,s.strong,s.aggressive_buy,s.aggressive))||!!s.note;});}
  function signal(s,p){var a=num(s.aggressive_buy,s.aggressive),st=num(s.strong_buy,s.strong),b=num(s.buy);if(isFinite(p)&&isFinite(a)&&p<=a)return'AGGRESSIVE BUY';if(isFinite(p)&&isFinite(st)&&p<=st)return'STRONG BUY';if(isFinite(p)&&isFinite(b)&&p<=b)return'BUY';return'HOLD';}
  function renderMarketCard(s,q){var sym=String(s.symbol||'').toUpperCase(),meta=identity(sym),p=num(q&&q.price,s.webull_last_price),pct=num(q&&q.pct),action=signal(s,p);return '<article class="market-follow-card"><div class="market-follow-main"><div class="market-follow-company">'+logoHTML(sym)+'<div><b>'+esc(meta.displayName)+'</b><span>'+esc(sym)+' • '+esc(meta.description)+'</span></div></div><div class="market-follow-price"><b>'+money(p)+'</b><span class="'+tone(pct)+'">'+signedPct(pct)+'</span></div><div class="market-follow-signal '+(action.indexOf('BUY')>=0?'buy':'')+'">'+action+'</div></div><div class="market-follow-levels"><div><span>Buy</span><b>'+money(s.buy)+'</b></div><div><span>Strong Buy</span><b>'+money(num(s.strong_buy,s.strong))+'</b></div><div><span>Aggressive</span><b>'+money(num(s.aggressive_buy,s.aggressive))+'</b></div></div><div class="market-follow-note">'+esc(s.note||'Following for a better entry.')+'</div></article>';}
  function renderMarkets(stocks,positions,qmap){var root=ensureMarkets();if(!root)return;var followed=followedStocks(stocks,positions);setMarketsLayout(root,followed.length);root.innerHTML=followed.length?followed.map(function(s){return renderMarketCard(s,qmap[String(s.symbol||'').toUpperCase()]||{});}).join(''):'<div class="markets-empty"><b>No followed stocks configured.</b><span>Stocks with saved entry levels appear here automatically.</span></div>';}

  function loadCharts(positions){
    for(var i=0;i<positions.length;i++)(function(sym){fetchJSON(location.protocol+'//'+location.hostname+':8092/api/chart/'+encodeURIComponent(sym),CHART_TIMEOUT_MS,null).then(function(data){if(data&&data.points&&data.points.length>=2){chartCache[sym]=data.points;renderPortfolio(currentPositions,currentQuotes,'live');}});})(String(positions[i].symbol||'').toUpperCase());
  }

  function enrichLive(positions){
    fetchJSON('/api/quotes',SECONDARY_TIMEOUT_MS,{quotes:{}}).then(function(qr){
      var qmap=qr&&qr.quotes?qr.quotes:{};
      for(var i=0;i<positions.length;i++){var p=positions[i],s=String(p.symbol||'').toUpperCase(),fallback=quoteFromPosition(p);if(!qmap[s])qmap[s]=fallback;}
      currentQuotes=qmap;renderPortfolio(positions,qmap,'live');
      return fetchJSON('/api/stocks',SECONDARY_TIMEOUT_MS,[]).then(function(stocks){renderMarkets(stocks,positions,qmap);});
    });
  }

  function liveRefresh(){
    if(refreshing)return;refreshing=true;
    fetchJSON('/api/webull/summary',LIVE_TIMEOUT_MS,null).then(function(data){
      if(data&&data.positions){
        var positions=data.positions.filter(function(p){return num(p.quantity,p.qty)>0;});
        var qmap={};for(var i=0;i<positions.length;i++){var s=String(positions[i].symbol||'').toUpperCase();qmap[s]=quoteFromPosition(positions[i]);}
        currentQuotes=qmap;var pages=renderPortfolio(positions,qmap,'live');updateRotation(pages.map(function(p){return p.name;}));
        var status=document.getElementById('status');if(status)status.textContent='Systems online • '+positions.length+' owned position'+(positions.length===1?'':'s');
        enrichLive(positions);loadCharts(positions);
      }
      refreshing=false;
    });
  }

  function boot(){
    ensurePortfolio();ensureMarkets();
    fetchJSON('/static/portfolio-snapshot.json?ts='+Date.now(),4000,null).then(function(snapshot){
      if(snapshot&&snapshot.positions){
        var positions=snapshot.positions.filter(function(p){return num(p.quantity,p.qty)>0;});
        var qmap={};for(var i=0;i<positions.length;i++){var s=String(positions[i].symbol||'').toUpperCase();qmap[s]=quoteFromPosition(positions[i]);}
        currentQuotes=qmap;var pages=renderPortfolio(positions,qmap,'snapshot');updateRotation(pages.map(function(p){return p.name;}));
      }
      setTimeout(liveRefresh,300);
    });
    setInterval(liveRefresh,REFRESH_MS);
    document.addEventListener('farm-screen-change',function(e){var n=e&&e.detail?String(e.detail.screen||''):'';if(n==='stocks'||n==='markets'||n.indexOf('portfolio-')===0)setTimeout(liveRefresh,100);});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
