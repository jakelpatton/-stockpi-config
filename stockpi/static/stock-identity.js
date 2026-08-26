(() => {
  const MAP = {
    EXE:{displayName:'Chesapeake Energy',description:'Natural gas & energy',domain:'expandenergy.com'},
    TEL:{displayName:'TE Connectivity',description:'Connectivity, sensors & industrial electronics',domain:'te.com'},
    CMI:{displayName:'Cummins',description:'Engines, power systems & industrial equipment',domain:'cummins.com'},
    ADI:{displayName:'Analog Devices',description:'Analog & mixed-signal semiconductors',domain:'analog.com'},
    AEIS:{displayName:'Advanced Energy Industries',description:'Precision power conversion',domain:'advancedenergy.com'},
    ALAB:{displayName:'Astera Labs',description:'AI and cloud connectivity semiconductors',domain:'asteralabs.com'},
    AMAT:{displayName:'Applied Materials',description:'Semiconductor manufacturing equipment',domain:'appliedmaterials.com'},
    ASML:{displayName:'ASML Holding',description:'Semiconductor lithography systems',domain:'asml.com'},
    GNRC:{displayName:'Generac',description:'Backup power & energy technology',domain:'generac.com'},
    KLAC:{displayName:'KLA',description:'Semiconductor process control equipment',domain:'kla.com'},
    LRCX:{displayName:'Lam Research',description:'Wafer fabrication equipment',domain:'lamresearch.com'},
    NVDA:{displayName:'NVIDIA',description:'AI computing & accelerated graphics',domain:'nvidia.com'},
    POWL:{displayName:'Powell Industries',description:'Electrical distribution infrastructure',domain:'powellind.com'},
    TER:{displayName:'Teradyne',description:'Semiconductor test & automation',domain:'teradyne.com'}
  };

  function normalize(symbol){return String(symbol||'').trim().toUpperCase();}
  function get(symbol){
    const s=normalize(symbol);
    return MAP[s] || {displayName:s,description:'Equity position',domain:null};
  }
  function logoCandidates(symbol){
    const s=normalize(symbol),m=get(s),out=[];
    out.push(`/static/logos/${s.toLowerCase()}.png`);
    if(m.domain){
      out.push(`https://www.google.com/s2/favicons?domain_url=https://${encodeURIComponent(m.domain)}&sz=256`);
      out.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(m.domain)}.ico`);
    }
    return out;
  }
  function advanceLogo(img){
    if(!img)return;
    let candidates=[];
    try{candidates=JSON.parse(img.dataset.logoCandidates||'[]')}catch(e){}
    const next=Number(img.dataset.logoIndex||0)+1;
    if(next<candidates.length){img.dataset.logoIndex=String(next);img.src=candidates[next];return;}
    img.style.display='none';
  }

  window.STOCK_IDENTITY=Object.freeze(MAP);
  window.getStockIdentity=get;
  window.getStockLogoCandidates=logoCandidates;
  window.advanceStockLogo=advanceLogo;
})();