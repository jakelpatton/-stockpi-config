#!/usr/bin/env python3
"""Build the 1838 Estate daily sector-performance/outlook data file.

This is deliberately rules-based, not analyst consensus: it combines 5-day and
20-trading-day ETF performance with 5-day relative strength versus SPY. The
result is compact enough for the Market Position Review and reproducible from
public market data.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = Path(__file__).resolve().parent
OUTPUT = BASE / "static" / "sector-outlook.json"
USER_AGENT = "Mozilla/5.0 1838-Estate-Sector-Outlook/1.0"

SECTORS = [
    ("SOXX", "Semiconductors", "AI chips & semiconductor equipment"),
    ("XLK", "Technology", "Large-cap technology"),
    ("XLI", "Industrials", "Power, equipment & automation"),
    ("XLU", "Utilities", "Grid & power demand"),
    ("XLE", "Energy", "Oil, gas & power feedstock"),
    ("XLC", "Communication Services", "Digital platforms & connectivity"),
    ("XLF", "Financials", "Financial conditions"),
]
BENCHMARK = "SPY"


def history(symbol: str) -> dict:
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{quote(symbol)}?range=3mo&interval=1d&includePrePost=false&events=div%2Csplits"
    )
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(req, timeout=15) as response:
        payload = json.load(response)
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        raise RuntimeError(f"No chart result for {symbol}")
    timestamps = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])
    rows = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        rows.append((int(ts), float(close)))
    if len(rows) < 21:
        raise RuntimeError(f"Not enough daily history for {symbol}: {len(rows)}")
    return {"symbol": symbol, "rows": rows, "meta": result.get("meta") or {}}


def pct(current: float, prior: float) -> float:
    return (current / prior - 1.0) * 100.0


def metrics(series: dict) -> dict:
    rows = series["rows"]
    current = rows[-1][1]
    previous = rows[-2][1]
    five_back = rows[-6][1]
    twenty_back = rows[-21][1]
    return {
        "close": current,
        "day_pct": pct(current, previous),
        "week_pct": pct(current, five_back),
        "month_pct": pct(current, twenty_back),
        "market_ts": rows[-1][0],
    }


def sector_outlook(week_pct: float, month_pct: float, relative_5d_pct: float) -> tuple[int, str]:
    score = 0
    score += 1 if week_pct > 0.5 else -1 if week_pct < -0.5 else 0
    score += 1 if month_pct > 1.5 else -1 if month_pct < -1.5 else 0
    score += 1 if relative_5d_pct > 0.5 else -1 if relative_5d_pct < -0.5 else 0
    if score >= 3:
        return score, "STRONG"
    if score >= 1:
        return score, "POSITIVE"
    if score <= -3:
        return score, "WEAK"
    if score <= -1:
        return score, "CAUTIOUS"
    return score, "NEUTRAL"


def market_label(day_pct: float, week_pct: float, month_pct: float) -> str:
    positives = sum((day_pct > 0, week_pct > 0, month_pct > 0))
    negatives = sum((day_pct < 0, week_pct < 0, month_pct < 0))
    if positives == 3 and week_pct > 0.5 and month_pct > 1.5:
        return "POSITIVE"
    if negatives == 3 and week_pct < -0.5 and month_pct < -1.5:
        return "CAUTIOUS"
    if positives >= 2:
        return "POSITIVE"
    if negatives >= 2:
        return "CAUTIOUS"
    return "NEUTRAL"


def main() -> None:
    all_symbols = [s[0] for s in SECTORS] + [BENCHMARK]
    raw = {symbol: history(symbol) for symbol in all_symbols}
    stats = {symbol: metrics(raw[symbol]) for symbol in all_symbols}
    benchmark = stats[BENCHMARK]

    sectors = []
    for symbol, name, theme in SECTORS:
        row = stats[symbol]
        rel5 = row["week_pct"] - benchmark["week_pct"]
        score, outlook = sector_outlook(row["week_pct"], row["month_pct"], rel5)
        sectors.append({
            "symbol": symbol,
            "name": name,
            "theme": theme,
            "close": round(row["close"], 2),
            "day_pct": round(row["day_pct"], 2),
            "week_pct": round(row["week_pct"], 2),
            "month_pct": round(row["month_pct"], 2),
            "relative_5d_pct": round(rel5, 2),
            "score": score,
            "outlook": outlook,
        })

    leaders = sorted(sectors, key=lambda x: (x["score"], x["week_pct"], x["month_pct"]), reverse=True)[:2]
    laggards = sorted(sectors, key=lambda x: (x["score"], x["week_pct"], x["month_pct"]))[:2]
    market_date = datetime.fromtimestamp(benchmark["market_ts"], tz=timezone.utc).strftime("%Y-%m-%d")
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    output = {
        "as_of": market_date,
        "generated_at": generated,
        "source": "Public daily ETF market data",
        "methodology": "Rules-based 5D + 1M trend and 5D relative strength vs SPY; not analyst consensus.",
        "market_outlook": market_label(benchmark["day_pct"], benchmark["week_pct"], benchmark["month_pct"]),
        "benchmark": {
            "symbol": BENCHMARK,
            "close": round(benchmark["close"], 2),
            "day_pct": round(benchmark["day_pct"], 2),
            "week_pct": round(benchmark["week_pct"], 2),
            "month_pct": round(benchmark["month_pct"], 2),
        },
        "leadership": [x["name"] for x in leaders],
        "caution": [x["name"] for x in laggards],
        "summary": (
            f"Leadership: {leaders[0]['name']} and {leaders[1]['name']}. "
            f"Caution: {laggards[0]['name']} and {laggards[1]['name']}. "
            f"SPY is {benchmark['week_pct']:+.1f}% over 5D and {benchmark['month_pct']:+.1f}% over 1M."
        ),
        "sectors": sectors,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Wrote {OUTPUT} for {market_date}")


if __name__ == "__main__":
    main()
