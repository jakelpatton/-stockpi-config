(() => {
  const REFRESH_MS=15000;
  const num=(...vals)=>{for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n}return NaN};
  const money=v=>{v=Number(v);return Number.isFinite(v)?v.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'—'};
  const getJSON=async(url,fallback)=>{try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return await r.json()}catch(e){return fallback}};

  function state(price,s){
    const buy=num(s?.buy),strong=num(s?.strong_buy,s?.strong),aggressive=num(s?.aggressive_buy,s?.aggressive);
    if(!Number.isFinite(price))return {level:'none',label:'Price unavailable'};
    if(Number.isFinite(aggressive)&&price<=aggressive)return {level:'aggressive',label:'Aggressive Buy threshold reached',threshold:aggressive};
    if(Number.isFinite(strong)&&price<=strong)return {level:'strong',label:'Strong Buy threshold reached',threshold:strong};
    if(Number.isFinite(buy)&&price<=buy)return {level:'buy',label:'Buy threshold reached',threshold:buy};
    return {level:'none',label:'Above entry thresholds'};
  }

  function clearThresholdClasses(el){el.classList.remove('threshold-buy','threshold-strong','threshold-aggressive')}
  function applyClass(el,level){clearThresholdClasses(el);if(level!=='none')el.classList.add(`threshold-${level}`)}

  function banner(screen,st,price){
    let b=screen.querySelector('.threshold-banner');
    if(st.level==='none'){if(b)b.remove();return}
    if(!b){b=document.createElement('div');b.className='threshold-banner';const body=screen.querySelector('.market-body');if(body)body.insertBefore(b,body.firstChild)}
    b.className=`threshold-banner ${st.level}`;
    b.innerHTML=`<div><span class="threshold-dot"></span><strong>${st.label}</strong></div><div>${money(price)} ≤ ${money(st.threshold)} <small>• recommendation threshold</small></div>`;
  }

  async function decorate(){
    const [stocks,quotesResult]=await Promise.all([getJSON('/api/stocks',[]),getJSON('/api/quotes',{quotes:{}})]);
    const qmap=quotesResult.quotes||{}, smap=new Map((stocks||[]).map(s=>[s.symbol,s]));

    document.querySelectorAll('.market-sequence-screen[data-screen^="owned-"]').forEach(screen=>{
      const symbol=screen.dataset.screen.replace('owned-','');const s=smap.get(symbol)||{},q=qmap[symbol]||{};const price=num(q.price);
      const st=state(price,s);applyClass(screen,st.level);banner(screen,st,price);
    });

    document.querySelectorAll('.watch-row').forEach(row=>{
      const symbol=row.querySelector('.ticker')?.textContent?.trim();if(!symbol)return;const s=smap.get(symbol)||{},q=qmap[symbol]||{},price=num(q.price);const st=state(price,s);applyClass(row,st.level);
      let a=row.querySelector('.watch-alert');
      if(st.level==='none'){if(a)a.remove();return}
      if(!a){a=document.createElement('div');a.className='watch-alert';const company=row.querySelector('.company');if(company)company.appendChild(a)}
      a.textContent=`● ${st.label}`;
    });

    document.querySelectorAll('.portfolio-holding-row:not(.head)').forEach(row=>{
      const symbol=row.querySelector('.ticker')?.textContent?.trim();if(!symbol)return;const s=smap.get(symbol)||{},q=qmap[symbol]||{},price=num(q.price);applyClass(row,state(price,s).level);
    });
  }

  function boot(){
    const main=document.querySelector('main.screens');
    if(main)new MutationObserver(()=>setTimeout(decorate,80)).observe(main,{childList:true,subtree:true});
    setTimeout(decorate,1200);setInterval(decorate,REFRESH_MS);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
