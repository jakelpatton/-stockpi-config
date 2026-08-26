(() => {
  let quoteMap = {};

  const money = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  };

  async function refreshQuotes(){
    try{
      const r = await fetch('/api/quotes',{cache:'no-store'});
      if(!r.ok) return;
      const j = await r.json();
      quoteMap = j.quotes || {};
      decorateTicker();
    }catch(e){}
  }

  function decorateTicker(){
    document.querySelectorAll('#tickerTrack .ticker-item').forEach(item => {
      const label = item.querySelector('b');
      if(!label) return;
      const symbol = String(label.textContent || '').trim().toUpperCase();
      const q = quoteMap[symbol];
      let tag = item.querySelector('.ticker-live-price');
      if(!q || !Number.isFinite(Number(q.price))){
        if(tag) tag.remove();
        return;
      }
      if(!tag){
        tag = document.createElement('span');
        tag.className = 'ticker-live-price';
        label.insertAdjacentElement('afterend', tag);
      }
      const pct = Number(q.pct);
      const pctText = Number.isFinite(pct) ? ` ${pct>=0?'+':''}${pct.toFixed(2)}%` : '';
      tag.textContent = ` ${money(q.price)}${pctText}`;
      tag.classList.toggle('up', Number.isFinite(pct) && pct > 0);
      tag.classList.toggle('down', Number.isFinite(pct) && pct < 0);
    });
  }

  function watchTicker(){
    const track = document.getElementById('tickerTrack');
    if(!track) return;
    new MutationObserver(()=>decorateTicker()).observe(track,{childList:true,subtree:true});
  }

  function boot(){
    const style=document.createElement('style');
    style.textContent=`
      #tickerTrack .ticker-live-price{margin-left:.38em;color:var(--estate-ivory,#eadfc7);font-weight:700;white-space:nowrap}
      #tickerTrack .ticker-live-price.up{color:var(--estate-good,#8ca883)}
      #tickerTrack .ticker-live-price.down{color:#d27d72}
    `;
    document.head.appendChild(style);
    watchTicker();
    setTimeout(refreshQuotes,700);
    setInterval(refreshQuotes,20000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
