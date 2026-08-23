# Farm Dashboard

A Raspberry Pi TV dashboard for the farm. It combines the stock/watchlist display with rotating property-monitoring screens in a light, airy interface.

## Rotation

Default rotation: 18 seconds per screen.

1. Stocks
2. Home Overview
3. Water Systems
4. Power / Climate / Electrical

Rotation can be enabled/disabled and timing can be changed from `http://farmpi.local:8080/settings`. The settings page also switches between the light/airy and dark themes.

## Home screens

The property screens are already wired to `/api/home`. Until physical sensors and external integrations are connected, that endpoint returns clearly identified realistic demo values for:

- Local weather summary
- Main house upstairs/downstairs temperature and humidity
- Rockhouse temperature/humidity
- Main house and Rockhouse well pressure, flow, daily gallons and water status
- Wellhouse temperature, pump status and electrical supply
- Leak/flood detector status
- Main house, Rockhouse and well electrical monitoring
- Gate state, battery, network and last event
- Tesla charge, estimated range and charging state

Replace the values inside `api_home()` in `app.py` with real sensor/API integrations as they are added. The dashboard UI does not need to be redesigned.

## Stocks and news

The stock screen uses the repository root `portfolio.json` as the cloud thesis/recommendation feed. Local watchlist values remain available as fallbacks. Quotes use yfinance. The scrolling news strip prioritizes watchlist headlines, AI-chip/semiconductor news and broader AI news.

## Fresh Raspberry Pi install

Use Raspberry Pi OS 64-bit with Desktop. Raspberry Pi's current kiosk guidance uses Chromium in kiosk mode from the desktop session; this installer configures the current `labwc` autostart path.

```bash
git clone https://github.com/jakelpatton/-stockpi-config.git
cd ./-stockpi-config/stockpi
chmod +x install.sh
./install.sh
sudo raspi-config
```

In `raspi-config`, enable **Desktop Autologin** and disable **Screen Blanking**, then reboot:

```bash
sudo reboot
```

The installer creates the `farm-dashboard.service`, installs Chromium/CEC support, sets the hostname to `farmpi`, and launches Chromium automatically in full-screen kiosk mode after the graphical desktop starts.

## Addresses

Dashboard: `http://farmpi.local:8080`

Phone/settings: `http://farmpi.local:8080/settings`

## HDMI-CEC

The settings page can wake a compatible TV, switch it to the Pi input and put it in standby on a schedule. Default schedule is 07:15 wake and 22:30 standby. HDMI-CEC must be enabled on the television.

## Configuration files

- `dashboard_config.json` — rotation timing/theme
- `power_schedule.json` — TV CEC schedule
- `stocks.json` — local watchlist/fallbacks
- root `portfolio.json` — cloud stock thesis/recommendation feed

## Next integrations

The dashboard is intentionally structured so the visual layer is finished first. As hardware comes online, connect the real water-meter pulse inputs, pressure sensors, leak detectors, electrical monitors, thermostats, gate controller, weather source and Tesla data to `/api/home`.
