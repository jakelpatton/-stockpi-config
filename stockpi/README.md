# StockPi Dashboard v2

This version uses your GitHub JSON as the cloud recommendation/thesis feed:

https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/portfolio.json

It checks that file about every 3 minutes. If GitHub or the internet is unavailable, it keeps using the last successfully downloaded copy.

Supported cloud fields:
symbol, action, buy, strong_buy, aggressive_buy, consider_trim, sell_exit, thesis, last_reviewed, note

Supported actions:
BUY, STRONG BUY, AGGRESSIVE BUY, HOLD, CONSIDER TRIM, THESIS WARNING, SELL/EXIT

Phone settings:
http://stockpi.local:8080/settings

The phone page controls the local watchlist. Matching GitHub cloud fields override local fallback thresholds.

A complete seven-stock GitHub example is included as:
portfolio.full-example.json

Fresh install:
1. Install Raspberry Pi OS 64-bit with Desktop.
2. Copy this folder to the Pi.
3. Run:
   chmod +x install.sh
   ./install.sh
4. Reboot.

Quotes/news still use Yahoo Finance/yfinance for now. The cloud thesis layer is separate, so we can later replace quote data with Webull OpenAPI without changing the GitHub configuration system.

## v3 scrolling news ticker

The TV now has a continuously scrolling news ticker across the bottom.

Headline priority:
1. Stocks currently on your StockPi watchlist — including symbols added later from the phone settings page.
2. AI chip / semiconductor / HBM / GPU / data-center chip headlines.
3. Broader artificial-intelligence / generative-AI / AI-infrastructure headlines.

Portfolio headlines are sourced through yfinance/Yahoo Finance. AI-chip and general-AI headlines use public Google News RSS search feeds. Headlines are refreshed automatically about every 5 minutes, with a 10-minute server cache.

The scrolling strip pauses when hovered with a mouse. Devices configured for reduced motion receive a static horizontally scrollable strip instead.

## v4 HDMI-CEC TV control
StockPi can now wake a compatible TV, switch to the Pi HDMI input, and put the TV into standby automatically. Defaults are 07:15 wake and 22:30 standby, editable from the phone settings page. Test buttons are included. HDMI-CEC must be enabled on the TV. The installer now installs `cec-utils`.
