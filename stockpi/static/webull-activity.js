(() => {
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const money=v=>{const n=num(v);return n==null?'—':n.toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2})};
  const qty=v=>{const n=num(v);return n==null?'—':n.toLocaleString(undefined,{maximumFractionDigits:5})};
  const timeLabel=v=>{
    if(v==null||v==='')return '—';
    const s=String(v);
    let d;
    if(/^\d+$/.test(s)){const n=Number(s);d=new Date(n>1e12?n:n*1000)} else d=new Date(s);
    return Number.isNaN(d.getTime())?s:new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
  };
  const statusClass=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const priceText=o=>{
    if(num(o.limit_price)!=null)return `Limit ${money(o.limit_price)}`;
    if(num(o.stop_price)!=null)return `Stop ${money(o.stop_price)}`;
    return esc(o.order_type||'Market');
  };
  const fillText=o=>{
    const fq=num(o.filled_quantity),fp=num(o.filled_price);
    if(fq!=null&&fq>0)return `${qty(fq)} @ ${fp==null?'—':money(fp)}`;
    return 'Not filled';
  };

  function orderRow(o){
    const side=String(o.side||'').toUpperCase();
    const status=String(o.status||'UNKNOWN').toUpperCase();
    return `<div class="activity-row">
      <div class="activity-symbol"><b>${esc(o.symbol||'—')}</b><small>${esc(o.instrument_type||'')}</small></div>
      <div><div class="activity-side ${side==='BUY'?'buy':'sell'}">${esc(side||'—')}</div><small>${qty(o.quantity)} ${esc(o.time_in_force||'')}</small></div>
      <div class="activity-detail"><small>${esc(o.order_type||'ORDER')} • ${timeLabel(o.place_time)}</small><b>${priceText(o)} • Fill ${fillText(o)}</b></div>
      <div class="activity-status ${statusClass(status)}">${esc(status)}</div>
    </div>`;
  }

  function empty(title,sub){return `<div class="activity-empty"><div><b>${esc(title)}</b>${esc(sub)}</div></div>`}

  function makeScreen(){
    if(document.querySelector('[data-screen="activity"]'))return;
    const main=document.querySelector('main.screens');if(!main)return;
    const s=document.createElement('section');s.className='screen webull-activity-screen';s.dataset.screen='activity';
    s.innerHTML=`
      <div class="activity-heading">
        <div><div class="eyebrow">WEBULL • ACCOUNT ACTIVITY • QUERY ONLY</div><h2>Orders & Trading Activity</h2></div>
        <div class="activity-connection" id="activityConnection"><i></i><div><b id="activityConnectionText">Waiting for Webull</b><span id="activityUpdated">Read-only monitor</span></div></div>
      </div>
      <div class="activity-metrics">
        <article class="activity-metric"><span>Open / Pending</span><b id="activityOpenCount">—</b><small>Current resting orders</small></article>
        <article class="activity-metric"><span>Today's Orders</span><b id="activityTodayCount">—</b><small>All submitted today</small></article>
        <article class="activity-metric"><span>Filled Today</span><b id="activityFilledCount">—</b><small>Full or partial fills</small></article>
        <article class="activity-metric"><span>Cancelled / Failed</span><b id="activityCancelCount">—</b><small>Today's exceptions</small></article>
        <article class="activity-metric"><span>Complete History</span><b id="activityHistoryCount">—</b><small id="activityHistoryRange">All available orders</small></article>
      </div>
      <div class="activity-main">
        <article class="activity-panel"><div class="activity-panel-head"><h3>Open Orders</h3><span>Pending • Submitted • Partial</span></div><div class="activity-list" id="activityOpen"></div></article>
        <article class="activity-panel"><div class="activity-panel-head"><h3>Today's Trading</h3><span>Order details & fills</span></div><div class="activity-list" id="activityToday"></div></article>
      </div>
      <div class="activity-bottom">
        <article class="activity-history-strip"><h4>Recent Order History</h4><div class="recent-history" id="activityHistory"></div></article>
        <article class="activity-events"><h4>Live Order Event</h4><div id="activityEvent" class="event-line">Waiting for event stream…</div></article>
      </div>`;
    const stocks=document.querySelector('[data-screen="stocks"]');
    if(stocks?.nextSibling)main.insertBefore(s,stocks.nextSibling);else main.appendChild(s);
  }

  function render(d){
    const connected=!!d.connected;
    const counts=d.counts||{};
    const conn=document.getElementById('activityConnection');
    if(conn)conn.classList.toggle('live',connected&&d.event_stream==='live');
    document.getElementById('activityConnectionText').textContent=connected?(d.event_stream==='live'?'Webull Live Events':'Webull Connected • Polling'):(d.error?'Webull Connection Pending':'Waiting for Webull');
    document.getElementById('activityUpdated').textContent=d.updated?`Updated ${timeLabel(d.updated)}`:'Read-only monitor';
    document.getElementById('activityOpenCount').textContent=counts.open??'—';
    document.getElementById('activityTodayCount').textContent=counts.today??'—';
    document.getElementById('activityFilledCount').textContent=counts.filled_today??'—';
    document.getElementById('activityCancelCount').textContent=(Number(counts.cancelled_today||0)+Number(counts.failed_today||0)).toString();
    document.getElementById('activityHistoryCount').textContent=counts.history??'—';
    document.getElementById('activityHistoryRange').textContent=d.history_complete?`Since ${d.history_start||'account opening'}`:'History sync pending';

    const open=d.open_orders||[],today=d.today_orders||[],history=d.history||[],events=d.real_time_events||[];
    document.getElementById('activityOpen').innerHTML=open.length?open.slice(0,5).map(orderRow).join(''):empty(connected?'No Open Orders':'Waiting for Webull',connected?'Nothing pending or partially filled.':(d.error||'Connect the account to populate activity.'));
    document.getElementById('activityToday').innerHTML=today.length?today.slice(0,5).map(orderRow).join(''):empty(connected?'No Orders Today':'No Account Data',connected?'No trading activity recorded today.':(d.error||'Waiting for authentication.'));
    document.getElementById('activityHistory').innerHTML=history.length?history.slice(0,5).map(o=>`<div class="history-chip"><b>${esc(o.symbol||'—')} • ${esc(o.side||'—')}</b><span>${esc(o.status||'—')} • ${qty(o.quantity)} • ${timeLabel(o.place_time)}</span></div>`).join(''):'<div class="event-line">Complete history will appear after the first Webull sync.</div>';
    const e=events[0];
    document.getElementById('activityEvent').innerHTML=e?`<b>${esc(e.scene_type||e.status||'ORDER UPDATE')}</b> ${esc(e.symbol||'')} ${esc(e.side||'')} • ${qty(e.filled_quantity)} @ ${money(e.filled_price)} • ${timeLabel(e.filled_time||e.received)}`:(connected?`<b>${d.event_stream==='live'?'LIVE':'POLLING'}</b> No new order-status event yet.`:`<span>${esc(d.error||'Waiting for Webull connection')}</span>`);
  }

  async function refresh(){
    try{
      const r=await fetch('/static/webull-activity.json?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('Activity monitor has not written data yet');
      render(await r.json());
    }catch(e){render({connected:false,error:e.message,counts:{}})}
  }

  function watch(){
    const main=document.querySelector('main.screens');if(!main)return;
    const update=()=>{if(document.querySelector('.screen.active')?.dataset.screen==='activity'){const n=document.getElementById('screenName');if(n)n.textContent='Orders & Trading Activity';refresh()}};
    new MutationObserver(update).observe(main,{attributes:true,subtree:true,attributeFilter:['class']});update();
  }

  function boot(){makeScreen();watch();refresh();setInterval(refresh,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
