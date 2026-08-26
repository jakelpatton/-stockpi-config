#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"

if [ ! -f "$APPDIR/webull_readonly.py" ] || [ ! -f "$APPDIR/app.py" ]; then
  echo "Farm dashboard files not found in $APPDIR"
  exit 1
fi

python3 - "$APPDIR" <<'PY'
from pathlib import Path
import sys

base = Path(sys.argv[1])

# 1) Preserve the richer position fields Webull already returns on account reads.
p = base / "webull_readonly.py"
s = p.read_text()
old = '''            positions = []
            for p in positions_list:
                qty = _float(p.get("quantity") or p.get("qty"))
                avg = _float(p.get("cost_price") or p.get("avg_cost") or p.get("average_cost"))
                last = _float(p.get("last_price") or p.get("market_price"))
                upl = _float(p.get("unrealized_profit_loss") or p.get("unrealized_pl"))
                market_value = (qty * last) if qty is not None and last is not None else None
                cost_basis = (qty * avg) if qty is not None and avg is not None else None
                total_pct = (upl / cost_basis * 100) if upl is not None and cost_basis else None
                symbol = str(p.get("symbol") or "").upper()
                if not symbol:
                    continue
                positions.append({
                    "symbol": symbol,
                    "instrument_type": p.get("instrument_type") or "",
                    "quantity": qty,
                    "average_cost": avg,
                    "last_price": last,
                    "market_value": market_value,
                    "cost_basis": cost_basis,
                    "unrealized_pl": upl,
                    "unrealized_pct": total_pct,
                    "currency": p.get("currency") or "USD",
                    "event_outcome": p.get("event_outcome") or "",
                })
'''
new = '''            positions = []
            for p in positions_list:
                qty = _float(p.get("quantity") or p.get("qty"))
                avg = _float(p.get("cost_price") or p.get("avg_cost") or p.get("average_cost"))
                last = _float(p.get("last_price") or p.get("market_price"))
                upl = _float(p.get("unrealized_profit_loss") or p.get("unrealized_pl"))

                # Prefer Webull's account-native values over reconstructed values.
                raw_cost = _float(p.get("cost"))
                raw_market_value = _float(p.get("market_value"))
                raw_upl_rate = _float(p.get("unrealized_profit_loss_rate"))
                raw_proportion = _float(p.get("proportion"))
                day_pl = _float(p.get("day_profit_loss"))
                day_realized_pl = _float(p.get("day_realized_profit_loss"))

                market_value = raw_market_value if raw_market_value is not None else ((qty * last) if qty is not None and last is not None else None)
                cost_basis = raw_cost if raw_cost is not None else ((qty * avg) if qty is not None and avg is not None else None)
                if raw_upl_rate is not None:
                    total_pct = raw_upl_rate * 100 if abs(raw_upl_rate) <= 1 else raw_upl_rate
                else:
                    total_pct = (upl / cost_basis * 100) if upl is not None and cost_basis else None
                if raw_proportion is not None:
                    proportion_pct = raw_proportion * 100 if abs(raw_proportion) <= 1 else raw_proportion
                else:
                    proportion_pct = None

                symbol = str(p.get("symbol") or "").upper()
                if not symbol:
                    continue
                positions.append({
                    "symbol": symbol,
                    "instrument_type": p.get("instrument_type") or "",
                    "quantity": qty,
                    "average_cost": avg,
                    "last_price": last,
                    "market_value": market_value,
                    "cost_basis": cost_basis,
                    "unrealized_pl": upl,
                    "unrealized_pct": total_pct,
                    "day_pl": day_pl,
                    "day_realized_pl": day_realized_pl,
                    "proportion_pct": proportion_pct,
                    "currency": p.get("currency") or "USD",
                    "event_outcome": p.get("event_outcome") or "",
                })
'''
if old in s:
    s = s.replace(old, new)
    p.write_text(s)
    print("Enhanced Webull account-native position fields")
elif '"day_realized_pl": day_realized_pl' in s:
    print("Webull position fields already enhanced")
else:
    raise SystemExit("Could not locate Webull position normalization block; no changes made")

# 2) Make the free/public quote fallback carry day range and volume too.
p = base / "app.py"
s = p.read_text()
old = '''def quote_for(symbol):
    try:
        fi = yf.Ticker(symbol).fast_info
        last, prev = fi.get("last_price"), fi.get("previous_close")
        if last is None:
            return None
        change = last - prev if prev else None
        pct = (change / prev) * 100 if prev and change is not None else None
        return {"symbol": symbol, "price": round(float(last), 4), "prev_close": round(float(prev), 4) if prev else None,
                "change": round(float(change), 4) if change is not None else None,
                "pct": round(float(pct), 3) if pct is not None else None, "source": "public"}
    except Exception:
        return None
'''
new = '''def quote_for(symbol):
    try:
        fi = yf.Ticker(symbol).fast_info
        last, prev = fi.get("last_price"), fi.get("previous_close")
        if last is None:
            return None
        change = last - prev if prev else None
        pct = (change / prev) * 100 if prev and change is not None else None
        def n(key):
            try:
                value = fi.get(key)
                return round(float(value), 4) if value is not None else None
            except Exception:
                return None
        return {
            "symbol": symbol,
            "price": round(float(last), 4),
            "prev_close": round(float(prev), 4) if prev else None,
            "change": round(float(change), 4) if change is not None else None,
            "pct": round(float(pct), 3) if pct is not None else None,
            "open": n("open"),
            "high": n("day_high"),
            "low": n("day_low"),
            "volume": n("last_volume"),
            "source": "public",
        }
    except Exception:
        return None
'''
if old in s:
    s = s.replace(old, new)
elif '"volume": n("last_volume")' not in s:
    raise SystemExit("Could not locate public quote function; Webull patch was applied but app.py was not changed")

old_merge = '''        for key in ("price", "prev_close", "change", "pct"):
            if wq.get(key) is not None:
                current[key] = wq[key]
'''
new_merge = '''        for key in ("price", "prev_close", "change", "pct", "open", "high", "low", "volume", "turnover",
                    "ext_price", "ext_change", "ext_pct", "ext_high", "ext_low", "ext_volume",
                    "ovn_price", "ovn_change", "ovn_pct", "ovn_high", "ovn_low", "ovn_volume"):
            if wq.get(key) is not None:
                current[key] = wq[key]
'''
if old_merge in s:
    s = s.replace(old_merge, new_merge)
p.write_text(s)
print("Enhanced public quote fallback with day range and volume")

# 3) Make the TV cards prefer Webull's exact proportion/day P&L and show realized P&L.
p = base / "static" / "portfolio-enhanced.js"
s = p.read_text()
s = s.replace(
'''      const dayPL=num(wp.day_pl,Number.isFinite(dayChange)&&Number.isFinite(shares)?dayChange*shares:NaN);
      const weight=Number.isFinite(value)&&Number.isFinite(totalMarket)&&totalMarket?value/totalMarket*100:NaN;
''',
'''      const dayPL=num(wp.day_pl,Number.isFinite(dayChange)&&Number.isFinite(shares)?dayChange*shares:NaN);
      const dayRealizedPL=num(wp.day_realized_pl);
      const weight=num(wp.proportion_pct,Number.isFinite(value)&&Number.isFinite(totalMarket)&&totalMarket?value/totalMarket*100:NaN);
''')
s = s.replace(
'''          <div class="enhanced-metric"><span>Total P/L</span><b class="${plClass(totalGain)}">${signedMoney(totalGain)} • ${signedPct(totalPct)}</b></div>
          <div class="enhanced-metric"><span>Cost Basis</span><b>${money(cost)}</b></div>
''',
'''          <div class="enhanced-metric"><span>Total P/L</span><b class="${plClass(totalGain)}">${signedMoney(totalGain)} • ${signedPct(totalPct)}</b></div>
          <div class="enhanced-metric"><span>Cost Basis</span><b>${money(cost)}</b></div>
          <div class="enhanced-metric"><span>Today's P/L</span><b class="${plClass(dayPL)}">${signedMoney(dayPL)}</b></div>
          <div class="enhanced-metric"><span>Realized Today</span><b class="${plClass(dayRealizedPL)}">${signedMoney(dayRealizedPL)}</b></div>
''')
s = s.replace(
'''${m.source==='webull'?'Webull market snapshot':'Account/public price'}''',
'''${m.source==='webull'?'Webull market snapshot':'Webull account + public market quote'}''')
p.write_text(s)
print("Enhanced portfolio cards with native weight/day/realized P&L")
PY

sudo systemctl restart farm-dashboard
sleep 3

echo
echo "Hybrid Webull/public portfolio upgrade applied."
echo "Webull account and order data remain query-only."
echo "Public quotes continue to supply market price/range/volume while STOCK QUOTES is unsubscribed."
echo
echo "Check: http://farmpi.local:8080/"
