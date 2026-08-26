(() => {
  const REFRESH_MS = 20000;
  let timer = null;

  function money(v){
    v=Number(v); return Number.isFinite(v)?v.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  }
  function compact(v){
    v=Number(v); if(!Number.isFinite(v))return '—';
    return new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(v);
  }
  function signedMoney(v){v=Number(v);return Number.isFinite(v)?`${v>=0?'+':'-'}${money(Math.abs(v))}`:'—'}
  function signedPct(v){v=Number(v);return Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(2)}%`:'—'}
  function plClass(v){v=Number(v);return !Number.isFinite(v)?'portfolio-flat':v>0?'portfolio-up':v<0?'portfolio-down':'portfolio-flat'}
  function num(...vals){for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n}return NaN}
  function text(v,fallback='—'){return v===undefined||v===null||v===''?fallback:String(v)}
  function fmtShares(v){v=Number(v);if(!Number.isFinite(v))return '—';return `${v.toFixed(v<10?4:2)} sh`}
  function fmtTime(value){
    if(!value)return '';
    const d=new Date(value); if(Number.isNaN(d.getTime()))return String(value);
    return d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }

  function latestActivity(symbol, activity){
    const open=(activity.open_orders||[]).filter(o=>o.symbol===symbol);
    if(open.length){
      const o=open[0]; const px=num(o.limit_price,o.stop_price);
      return {label:'Open order', detail:`${text(o.side)} ${num(o.quantity).toFixed(4)} ${text(o.order_type)}${Number.isFinite(px)?' @ '+money(px):''}`, open:true};
    }
    const rows=[...(activity.today_orders||[]),...(activity.history||[])].filter(o=>o.symbol===symbol);
    if(!rows.length)return {label:'Last activity',detail:'No recent order activity'};
    rows.sort((a,b)=>String(b.place_time||b.filled_time||'').localeCompare(String(a.place_time||a.filled_time||'')));
    const o=rows[0];
    const qty=num(o.filled_quantity,o.quantity); const px=num(o.filled_price,o.limit_price,o.stop_price);
    const action=o.status==='FILLED'?(o.side==='BUY'?'Bought':'Sold'):`${text(o.side)} ${text(o.status)}`;
    return {label:'Last activity',detail:`${action}${Number.isFinite(qty)?' '+qty.toFixed(4):''}${Number.isFinite(px)?' @ '+money(px):''}${o.place_time?' • '+fmtTime(o.place_time):''}`};
  }

  function sessionLine(m){
    const ext=num(m.ext_price,m.extended_price), ovn=num(m.ovn_price,m.overnight_price);
    if(Number.isFinite(ovn))return `Overnight ${money(ovn)} ${signedPct(num(m.ovn_pct,m.overnight_pct))}`;
    if(Number.isFinite(ext))return `Extended ${money(ext)} ${signedPct(num(m.ext_pct,m.extended_pct))}`;
    return 'Regular session';
  }

  async function getJSON(url, fallback){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}
  }

  async function refresh(){
    const panel=document.getElementById('portfolioPanel');
    if(!panel)return;
    const [stocksData,quotesData,webull,activity]=await Promise.all([
      getJSON('/api/stocks',[]),
      getJSON('/api/quotes',{quotes:{}}),
      getJSON('/api/webull/summary',{connected:false,positions:[],balance:{}}),
      getJSON('/static/webull-activity.json',{open_orders:[],today_orders:[],history:[]})
    ]);
    if(!webull.connected)return;

    panel.classList.add('portfolio-enhanced');
    const owned=(stocksData||[]).filter(s=>s.owned||Number(s.position_usd)>0);
    const qmap=quotesData.quotes||{};
    const pmap=new Map((webull.positions||[]).map(p=>[p.symbol,p]));
    const wb=webull.balance||{};
    const openCount=(activity.open_orders||[]).length;

    const source=document.getElementById('portfolioSource');
    if(source){
      const liveMarket=(webull.positions||[]).some(p=>p.market&&p.market.source==='webull');
      source.textContent=liveMarket?'WEBULL • READ ONLY • ACCOUNT + MARKET DATA':'WEBULL • READ ONLY • ACCOUNT DATA • PUBLIC QUOTE FALLBACK';
      source.className=liveMarket?'portfolio-source':'portfolio-source fallback';
    }

    const total=document.getElementById('portfolioValue');
    const totalPL=document.getElementById('portfolioPL');
    const nav=num(wb.net_liquidation_value,wb.market_value);
    if(total)total.textContent=money(nav);
    if(totalPL){totalPL.textContent=`${signedMoney(wb.unrealized_pl)} total P/L`;totalPL.className=plClass(wb.unrealized_pl)}

    const accountGrid=document.getElementById('portfolioAccountGrid');
    if(accountGrid){
      accountGrid.classList.add('enhanced');
      accountGrid.innerHTML=`
        <div><span>Account Value</span><b>${money(wb.net_liquidation_value)}</b></div>
        <div><span>Cash / Buying Power</span><b>${money(wb.cash)} / ${money(wb.buying_power)}</b></div>
        <div><span>Today's P/L</span><b class="${plClass(wb.day_pl)}">${signedMoney(wb.day_pl)}</b></div>
        <div><span>Total P/L</span><b class="${plClass(wb.unrealized_pl)}">${signedMoney(wb.unrealized_pl)}</b></div>
        <div><span>Open Orders</span><b>${openCount}</b></div>`;
    }

    const grid=document.getElementById('portfolioGrid');
    if(!grid)return;
    grid.classList.add('enhanced');
    const totalMarket=num(wb.market_value);

    grid.innerHTML=owned.map(s=>{
      const wp=pmap.get(s.symbol)||{};
      const m=wp.market||{};
      const q=qmap[s.symbol]||{};
      const shares=num(wp.quantity,s.shares_estimate);
      const avg=num(wp.average_cost,s.average_cost);
      const current=num(m.price,wp.last_price,q.price);
      const value=num(wp.market_value,Number.isFinite(shares)&&Number.isFinite(current)?shares*current:NaN);
      const cost=num(wp.cost_basis,s.position_usd,Number.isFinite(shares)&&Number.isFinite(avg)?shares*avg:NaN);
      const totalGain=num(wp.unrealized_pl,Number.isFinite(value)&&Number.isFinite(cost)?value-cost:NaN);
      const totalPct=num(wp.unrealized_pct,Number.isFinite(totalGain)&&cost?totalGain/cost*100:NaN);
      const prev=num(m.prev_close,q.prev_close);
      const dayChange=num(m.change,q.change,Number.isFinite(current)&&Number.isFinite(prev)?current-prev:NaN);
      const dayPct=num(m.pct,q.pct,Number.isFinite(dayChange)&&prev?dayChange/prev*100:NaN);
      const dayPL=num(wp.day_pl,Number.isFinite(dayChange)&&Number.isFinite(shares)?dayChange*shares:NaN);
      const weight=Number.isFinite(value)&&Number.isFinite(totalMarket)&&totalMarket?value/totalMarket*100:NaN;
      const low=num(m.low),high=num(m.high),volume=num(m.volume);
      const act=latestActivity(s.symbol,activity);
      const buy=num(s.buy),strong=num(s.strong),aggressive=num(s.aggressive);
      const distance=Number.isFinite(current)&&Number.isFinite(buy)&&buy?((buy-current)/current)*100:NaN;
      return `<div class="portfolio-position enhanced-card">
        <div class="enhanced-symbol-row"><div class="ticker">${s.symbol}</div><div class="shares">${fmtShares(shares)}<br>${Number.isFinite(weight)?weight.toFixed(1)+'% of portfolio':'Portfolio position'}</div></div>
        <div class="enhanced-price-row"><div class="price">${money(current)}</div><div class="day ${plClass(dayChange)}">${signedMoney(dayChange)} • ${signedPct(dayPct)}<br>${Number.isFinite(dayPL)?signedMoney(dayPL)+' position today':''}</div></div>
        <div class="enhanced-metrics">
          <div class="enhanced-metric"><span>Market Value</span><b>${money(value)}</b></div>
          <div class="enhanced-metric"><span>Average Cost</span><b>${money(avg)}</b></div>
          <div class="enhanced-metric"><span>Total P/L</span><b class="${plClass(totalGain)}">${signedMoney(totalGain)} • ${signedPct(totalPct)}</b></div>
          <div class="enhanced-metric"><span>Cost Basis</span><b>${money(cost)}</b></div>
        </div>
        <div class="enhanced-market">
          <div><span>Day Range</span><b>${Number.isFinite(low)&&Number.isFinite(high)?money(low)+'–'+money(high):'—'}</b></div>
          <div><span>Volume</span><b>${compact(volume)}</b></div>
          <div><span>Session</span><b>${sessionLine(m)}</b></div>
        </div>
        <div class="enhanced-levels">
          <div><span>Buy</span><b>${money(buy)}</b></div><div><span>Strong Buy</span><b>${money(strong)}</b></div><div><span>Aggressive</span><b>${money(aggressive)}</b></div>
        </div>
        <div class="enhanced-source-note">${Number.isFinite(distance)?`Buy level is ${Math.abs(distance).toFixed(1)}% ${distance<0?'above':'below'} current price • `:''}${m.source==='webull'?'Webull market snapshot':'Account/public price'}</div>
        <div class="enhanced-activity"><span>${act.label}</span><b>${act.detail}</b></div>
      </div>`;
    }).join('');
  }

  function boot(){
    setTimeout(refresh,1200);
    timer=setInterval(refresh,REFRESH_MS);
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>{if(document.querySelector('.screen.active')?.dataset.screen==='stocks')setTimeout(refresh,250)}).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
