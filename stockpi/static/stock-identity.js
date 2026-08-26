(() => {
  const REFRESH_MS = 5000;
  let busy = false;
  let applyingRows = false;
  let lastPayload = null;

  const META = {
    ADI:{name:'Analog Devices',domain:'analog.com'},
    AEIS:{name:'Advanced Energy Industries',domain:'advancedenergy.com'},
    ALAB:{name:'Astera Labs',domain:'asteralabs.com'},
    AMAT:{name:'Applied Materials',domain:'appliedmaterials.com'},
    ASML:{name:'ASML Holding',domain:'asml.com'},
    CMI:{name:'Cummins',domain:'cummins.com'},
    EXE:{name:'Expand Energy',domain:'expandenergy.com'},
    GNRC:{name:'Generac Holdings',domain:'generac.com'},
    KLAC:{name:'KLA',domain:'kla.com'},
    LRCX:{name:'Lam Research',domain:'lamresearch.com'},
    NVDA:{name:'NVIDIA',domain:'nvidia.com'},
    POWL:{name:'Powell Industries',domain:'powellind.com'},
    TEL:{name:'TE Connectivity',domain:'te.com'},
    TER:{name:'Teradyne',domain:'teradyne.com'}
  };

  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (...vals) => { for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n;} return NaN; };
  const money = v => { const n=Number(v); return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'; };
  const pct = v => { const n=Number(v); return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—'; };
  const cls = v => { const n=Number(v); return !Number.isFinite(n)?'':n>0?'up':n<0?'down':''; };
  const shares = v => { const n=Number(v); return Number.isFinite(n)?`${n.toFixed(n<10?4:2)} sh`:'—'; };
  const meta = symbol => META[String(symbol||'').toUpperCase()] || {name:String(symbol||'').toUpperCase(),domain:null};
  const logoUrl = symbol => { const m=meta(symbol); return m.domain?`https://www.google.com/s2/favicons?domain_url=https://${encodeURIComponent(m.domain)}&sz=128`:''; };

  function logoHTML(symbol, sizeClass=''){
    const src=logoUrl(symbol), letter=esc(String(symbol||'?').slice(0,1));
    if(!src)return `<span class="stock-logo-fallback ${sizeClass}" data-letter="${letter}"></span>`;
    return `<span class="stock-logo-wrap ${sizeClass}"><img class="stock-logo" src="${src}" alt="" referrerpolicy="no-referrer"><span class="stock-logo-fallback" data-letter="${letter}"></span></span>`;
  }

  async function getJSON(url,fallback){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}
  }

  function openOrderFor(symbol,activity){
    return (activity.open_orders||[]).find(o=>String(o.symbol||'').toUpperCase()===symbol) || null;
  }

  function orderText(order){
    if(!order)return '';
    const side=String(order.side||'').toUpperCase();
    const type=String(order.order_type||'').toUpperCase();
    const qty=num(order.quantity);
    const px=num(order.limit_price,order.stop_price);
    return `${side}${type?' '+type:''}${Number.isFinite(qty)?' • '+shares(qty):''}${Number.isFinite(px)?' @ '+money(px):''}`;
  }

  function focusedSymbols(webull,activity){
    const out=[];
    const seen=new Set();
    for(const p of (webull.positions||[])){
      const s=String(p.symbol||'').toUpperCase();
      if(s&&!seen.has(s)){seen.add(s);out.push(s);}
    }
    for(const o of (activity.open_orders||[])){
      const s=String(o.symbol||'').toUpperCase();
      if(s&&!seen.has(s)){seen.add(s);out.push(s);}
    }
    return out;
  }

  function renderFocusRows(stocks,quotes,webull,activity){
    const rows=document.getElementById('rows');
    if(!rows)return;
    const symbols=focusedSymbols(webull,activity);
    const pmap=new Map((webull.positions||[]).map(p=>[String(p.symbol||'').toUpperCase(),p]));
    const smap=new Map((stocks||[]).map(s=>[String(s.symbol||'').toUpperCase(),s]));
    applyingRows=true;
    rows.className='portfolio-focus-list';
    rows.dataset.stockIdentity='1';

    if(!symbols.length){
      rows.innerHTML='<div class="portfolio-focus-empty">No owned positions or open orders.</div>';
    }else{
      rows.innerHTML=symbols.map(symbol=>{
        const m=meta(symbol),p=pmap.get(symbol)||{},s=smap.get(symbol)||{},q=(quotes||{})[symbol]||{},order=openOrderFor(symbol,activity);
        const price=num(q.price,p.last_price,s.webull_last_price);
        const dayPct=num(q.pct);
        const owned=!!pmap.get(symbol) || !!s.owned || Number(s.position_usd)>0;
        const status=owned&&order?'OWNED + OPEN ORDER':order?'OPEN ORDER':'OWNED';
        const detail=order?orderText(order):`${shares(p.quantity ?? s.shares_estimate)}${Number.isFinite(num(p.proportion_pct))?' • '+num(p.proportion_pct).toFixed(1)+'% of portfolio':''}`;
        return `<article class="portfolio-focus-card">
          <div class="portfolio-focus-id">${logoHTML(symbol,'focus-logo')}<div><b>${esc(symbol)}</b><span>${esc(m.name)}</span></div></div>
          <div class="portfolio-focus-price"><b>${money(price)}</b><span class="${cls(dayPct)}">${pct(dayPct)}</span></div>
          <div class="portfolio-focus-status"><b>${status}</b><span>${esc(detail)}</span></div>
        </article>`;
      }).join('');
    }
    setTimeout(()=>{applyingRows=false;},0);
  }

  function ensureLogo(el,symbol,sizeClass=''){
    if(!el||el.querySelector(':scope > .stock-logo-wrap, :scope > .stock-logo-fallback'))return;
    const wrap=document.createElement('span');
    wrap.innerHTML=logoHTML(symbol,sizeClass);
    const node=wrap.firstElementChild;
    if(node)el.prepend(node);
  }

  function decorateExisting(){
    document.querySelectorAll('#portfolioPanel .portfolio-position.enhanced-card').forEach(card=>{
      const ticker=card.querySelector('.enhanced-symbol-row .ticker');
      if(!ticker)return;
      const symbol=String(ticker.textContent||'').trim().toUpperCase();
      const m=meta(symbol);
      const row=card.querySelector('.enhanced-symbol-row');
      ensureLogo(ticker,symbol,'card-logo');
      if(row&&!row.querySelector('.enhanced-company-name')){
        const name=document.createElement('div');
        name.className='enhanced-company-name';
        name.textContent=m.name;
        ticker.insertAdjacentElement('afterend',name);
      }
    });

    document.querySelectorAll('.market-sequence-screen').forEach(screen=>{
      const name=screen.dataset.screen||'';
      if(name.startsWith('owned-')){
        const symbol=name.slice(6).toUpperCase();
        const ticker=screen.querySelector('.owned-ticker');
        const company=screen.querySelector('.owned-company');
        if(ticker)ensureLogo(ticker,symbol,'detail-logo');
        if(company)company.textContent=meta(symbol).name;
      }
    });

    document.querySelectorAll('.market-sequence-screen .watch-row').forEach(row=>{
      const ticker=row.querySelector('.ticker');
      if(!ticker)return;
      const symbol=String(ticker.textContent||'').trim().toUpperCase();
      ensureLogo(ticker,symbol,'row-logo');
      const company=row.querySelector('.company');
      if(company){
        const small=company.querySelector('small')?.textContent||'';
        company.innerHTML=`${esc(meta(symbol).name)}${small?`<small>${esc(small)}</small>`:''}`;
      }
    });

    document.querySelectorAll('.market-sequence-screen .limit-order .ticker,.market-sequence-screen .portfolio-holding-row:not(.head) .ticker').forEach(ticker=>{
      const symbol=String(ticker.textContent||'').trim().toUpperCase();
      ensureLogo(ticker,symbol,'row-logo');
      ticker.title=meta(symbol).name;
    });
  }

  function ensureStyle(){
    if(document.getElementById('stockIdentityStyle'))return;
    const style=document.createElement('style');
    style.id='stockIdentityStyle';
    style.textContent=`
      .portfolio-focus-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:8px;margin-top:9px}
      .portfolio-focus-card{min-width:0;display:grid;grid-template-columns:minmax(120px,1.3fr) minmax(88px,.75fr) minmax(115px,1fr);gap:10px;align-items:center;padding:9px 11px;border:1px solid var(--estate-line,var(--line,#dce7e3));border-radius:14px;background:var(--estate-panel,var(--panel,rgba(255,255,255,.92)));box-shadow:0 4px 14px rgba(0,0,0,.035)}
      .portfolio-focus-id{display:flex;align-items:center;gap:8px;min-width:0}.portfolio-focus-id>div{min-width:0}.portfolio-focus-id b{display:block;font:800 18px/1 var(--estate-serif,Georgia,serif)}.portfolio-focus-id span{display:block;margin-top:3px;font:700 9px/1.15 var(--estate-sans,Arial,sans-serif);color:var(--estate-muted,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .portfolio-focus-price{text-align:right}.portfolio-focus-price b{display:block;font:700 17px/1 var(--estate-serif,Georgia,serif)}.portfolio-focus-price span{display:block;margin-top:4px;font:800 9px/1 var(--estate-sans,Arial,sans-serif)}
      .portfolio-focus-status{min-width:0;padding-left:9px;border-left:1px solid var(--estate-line,var(--line,#dce7e3))}.portfolio-focus-status b{display:block;font:850 8px/1.1 var(--estate-sans,Arial,sans-serif);letter-spacing:.08em;color:var(--estate-gold,#b38a4a)}.portfolio-focus-status span{display:block;margin-top:4px;font:700 8px/1.2 var(--estate-sans,Arial,sans-serif);color:var(--estate-muted,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.portfolio-focus-empty{padding:10px 12px;color:var(--estate-muted,#64748b);font-weight:700}
      .stock-logo-wrap,.stock-logo-fallback{position:relative;display:inline-grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.9);border:1px solid var(--estate-line,var(--line,#dce7e3));overflow:hidden;vertical-align:middle}.stock-logo{position:absolute;inset:3px;width:calc(100% - 6px);height:calc(100% - 6px);object-fit:contain;z-index:2}.stock-logo-fallback{font:900 12px/1 var(--estate-sans,Arial,sans-serif);color:var(--estate-muted,#64748b)}.stock-logo-fallback:after{content:attr(data-letter)}.stock-logo-wrap>.stock-logo-fallback{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;z-index:1}.focus-logo{width:34px;height:34px;border-radius:9px}.card-logo{width:27px;height:27px;margin-right:7px}.detail-logo{width:38px;height:38px;margin-right:10px}.row-logo{width:23px;height:23px;margin-right:6px;border-radius:6px}
      #portfolioPanel .enhanced-symbol-row .ticker{display:flex;align-items:center;white-space:nowrap}#portfolioPanel .enhanced-company-name{flex:1;align-self:center;margin-left:-2px;font:700 9px/1.15 var(--estate-sans,Arial,sans-serif);color:var(--estate-muted,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .owned-ticker,.watch-row .ticker,.limit-order .ticker,.portfolio-holding-row .ticker{display:flex;align-items:center}
      @media(max-width:1250px){.portfolio-focus-card{grid-template-columns:minmax(115px,1.2fr) 80px minmax(100px,.9fr);gap:7px}.portfolio-focus-status span{display:none}}
    `;
    document.head.appendChild(style);
  }

  async function refresh(){
    if(busy)return;
    busy=true;
    try{
      const [stocks,quoteResult,webull,activity]=await Promise.all([
        getJSON('/api/stocks',[]),
        getJSON('/api/quotes',{quotes:{}}),
        getJSON('/api/webull/summary',{positions:[]}),
        getJSON('/static/webull-activity.json',{open_orders:[]})
      ]);
      lastPayload=[stocks,quoteResult.quotes||{},webull,activity];
      renderFocusRows(...lastPayload);
      setTimeout(decorateExisting,50);
    }finally{busy=false;}
  }

  function boot(){
    ensureStyle();
    const rows=document.getElementById('rows');
    if(rows)new MutationObserver(()=>{
      if(applyingRows||!lastPayload)return;
      setTimeout(()=>{if(!applyingRows&&lastPayload)renderFocusRows(...lastPayload);},0);
    }).observe(rows,{childList:true,subtree:false});
    setTimeout(refresh,1100);
    setInterval(refresh,REFRESH_MS);
    setInterval(decorateExisting,2000);
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>setTimeout(decorateExisting,100)).observe(main,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
