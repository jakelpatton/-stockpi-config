(() => {
  const REFRESH_MS=5000;
  const META={
    ADI:['Analog Devices','analog.com'],AEIS:['Advanced Energy Industries','advancedenergy.com'],ALAB:['Astera Labs','asteralabs.com'],AMAT:['Applied Materials','appliedmaterials.com'],ASML:['ASML Holding','asml.com'],CMI:['Cummins','cummins.com'],EXE:['Expand Energy','expandenergy.com'],GNRC:['Generac Holdings','generac.com'],KLAC:['KLA','kla.com'],LRCX:['Lam Research','lamresearch.com'],NVDA:['NVIDIA','nvidia.com'],POWL:['Powell Industries','powellind.com'],TEL:['TE Connectivity','te.com'],TER:['Teradyne','teradyne.com']
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(...v)=>{for(const x of v){const n=Number(x);if(Number.isFinite(n))return n}return NaN};
  const money=v=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'};
  const pct=v=>{const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—'};
  const cls=v=>{const n=Number(v);return !Number.isFinite(n)?'':n>0?'up':n<0?'down':''};
  const shares=v=>{const n=Number(v);return Number.isFinite(n)?`${n.toFixed(n<10?4:2)} sh`:'—'};
  const info=s=>META[s]||[s,null];
  const logo=s=>{const [name,domain]=info(s);const src=domain?`https://www.google.com/s2/favicons?domain_url=https://${encodeURIComponent(domain)}&sz=128`:'';const letter=esc(s.slice(0,1));return `<span class="pf-logo">${src?`<img src="${src}" alt="" referrerpolicy="no-referrer">`:''}<i>${letter}</i></span>`};
  async function j(url,fallback){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}}
  function ensure(){
    const legacy=document.getElementById('rows'); if(!legacy)return null;
    legacy.style.display='none';
    let rows=document.getElementById('portfolioFocusRows');
    if(!rows){rows=document.createElement('div');rows.id='portfolioFocusRows';rows.className='portfolio-focus-fixed';legacy.insertAdjacentElement('afterend',rows)}
    if(!document.getElementById('portfolioFocusFixedStyle')){
      const s=document.createElement('style');s.id='portfolioFocusFixedStyle';s.textContent=`
      .portfolio-focus-fixed{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px;margin-top:9px}.pf-card{display:grid;grid-template-columns:minmax(125px,1.2fr) 90px minmax(110px,1fr);gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--estate-line,var(--line,#334155));border-radius:14px;background:var(--estate-panel,var(--panel,#111827));min-width:0}.pf-id{display:flex;align-items:center;gap:9px;min-width:0}.pf-id>div{min-width:0}.pf-id b{display:block;font:800 18px/1 Georgia,serif}.pf-id span{display:block;margin-top:3px;font:700 9px/1.15 Arial,sans-serif;color:var(--estate-muted,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pf-logo{position:relative;width:34px;height:34px;display:grid;place-items:center;flex:0 0 34px;border-radius:9px;background:#fff;border:1px solid rgba(148,163,184,.35);overflow:hidden}.pf-logo img{position:absolute;inset:4px;width:26px;height:26px;object-fit:contain;z-index:2}.pf-logo i{font:900 12px Arial,sans-serif;color:#64748b;font-style:normal}.pf-price{text-align:right}.pf-price b{display:block;font:700 17px/1 Georgia,serif}.pf-price span{display:block;margin-top:4px;font:800 9px Arial,sans-serif}.pf-status{min-width:0;padding-left:9px;border-left:1px solid var(--estate-line,var(--line,#334155))}.pf-status b{display:block;font:850 8px/1.1 Arial,sans-serif;letter-spacing:.08em;color:var(--estate-gold,#c49b59)}.pf-status span{display:block;margin-top:4px;font:700 8px/1.2 Arial,sans-serif;color:var(--estate-muted,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pf-empty{padding:10px 12px;color:var(--estate-muted,#94a3b8);font-weight:700}`;document.head.appendChild(s)
    }
    return rows;
  }
  function openFor(symbol,activity){return (activity.open_orders||[]).find(o=>String(o.symbol||'').toUpperCase()===symbol)||null}
  function orderText(o){if(!o)return'';const side=String(o.side||'').toUpperCase(),type=String(o.order_type||'').toUpperCase(),qty=num(o.quantity),px=num(o.limit_price,o.stop_price);return `${side}${type?' '+type:''}${Number.isFinite(qty)?' • '+shares(qty):''}${Number.isFinite(px)?' @ '+money(px):''}`}
  async function render(){
    const rows=ensure();if(!rows)return;
    const [stocks,qr,w,a]=await Promise.all([j('/api/stocks',[]),j('/api/quotes',{quotes:{}}),j('/api/webull/summary',{positions:[]}),j('/static/webull-activity.json',{open_orders:[]})]);
    const pmap=new Map((w.positions||[]).map(p=>[String(p.symbol||'').toUpperCase(),p]));
    const smap=new Map((stocks||[]).map(s=>[String(s.symbol||'').toUpperCase(),s]));
    const symbols=[],seen=new Set();
    for(const p of (w.positions||[])){const s=String(p.symbol||'').toUpperCase();if(s&&!seen.has(s)){seen.add(s);symbols.push(s)}}
    if(!symbols.length){for(const s of (stocks||[])){const sym=String(s.symbol||'').toUpperCase();if(sym&&(s.owned||Number(s.position_usd)>0)&&!seen.has(sym)){seen.add(sym);symbols.push(sym)}}}
    for(const o of (a.open_orders||[])){const s=String(o.symbol||'').toUpperCase();if(s&&!seen.has(s)){seen.add(s);symbols.push(s)}}
    if(!symbols.length){rows.innerHTML='<div class="pf-empty">No owned positions or open orders.</div>';return}
    rows.innerHTML=symbols.map(symbol=>{const p=pmap.get(symbol)||{},s=smap.get(symbol)||{},q=(qr.quotes||{})[symbol]||{},o=openFor(symbol,a),[name]=info(symbol);const price=num(q.price,p.last_price,s.webull_last_price),day=num(q.pct),owned=pmap.has(symbol)||!!s.owned||Number(s.position_usd)>0,status=owned&&o?'OWNED + OPEN ORDER':o?'OPEN ORDER':'OWNED',detail=o?orderText(o):shares(p.quantity??s.shares_estimate);return `<article class="pf-card"><div class="pf-id">${logo(symbol)}<div><b>${esc(symbol)}</b><span>${esc(name)}</span></div></div><div class="pf-price"><b>${money(price)}</b><span class="${cls(day)}">${pct(day)}</span></div><div class="pf-status"><b>${status}</b><span>${esc(detail)}</span></div></article>`}).join('');
  }
  function boot(){ensure();render();setInterval(render,REFRESH_MS)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
