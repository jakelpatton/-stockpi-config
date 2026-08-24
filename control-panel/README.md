# Patton Estate — Gilded Domestic Switchboard

This project is intentionally separate from `stockpi/`.

- `stockpi/` = passive / rotating 37-inch information display.
- `control-panel/` = touch-first Surface Pro control station.

The control panel keeps the approved Gilded Age design language: aged brass, near-black green glass, warm ivory text, restrained Victorian linework, elegant readable script headings, **Patton Estate — Est’d. 1838**, Bob as **Resident Land Steward**, **Gilded Domestic Switchboard — Pat’d 2026**, and **The Peaceable Kingdom**.

## What works now

The UI is fully navigable by touch. It reads the existing Farm `/api/home` endpoint when available, proxies the three Amcrest camera snapshots, refreshes the clock/weather/property data, and has working touch interactions for lights, thermostat, gate, water shutoff, and scenes.

Until Home Assistant entities are mapped, control actions run in **Preview Mode** and change only local browser state. This is deliberate: you can test the complete Surface experience without accidentally changing real equipment.

When Home Assistant is configured, the same buttons automatically become live controls through the server-side REST bridge. Credentials never go into the browser or GitHub.

## Quick Surface test

On Ubuntu/Linux on the Surface:

```bash
git clone https://github.com/jakelpatton/-stockpi-config.git
cd ./-stockpi-config/control-panel
chmod +x run-preview.sh
./run-preview.sh
```

Open `http://localhost:8090`. If `farmpi.local` is already online, Farm data and the Amcrest snapshots will be proxied automatically. Otherwise the interface stays usable in Preview Mode.

## Recommended permanent layout

Run the control-panel server on the Raspberry Pi and use the Surface only as a kiosk client.

On the Pi, from this directory:

```bash
chmod +x install-control-panel-server.sh
./install-control-panel-server.sh
```

The panel will be available at `http://farmpi.local:8090`.

On the Surface running Ubuntu/GNOME:

```bash
chmod +x install-surface-kiosk.sh
./install-surface-kiosk.sh
```

The script installs/locates Chromium, installs a script-style system font, creates a GNOME autostart launcher, and opens the control panel fullscreen after login.

## Home Assistant live control

After Home Assistant is running, create a long-lived access token and put it only on the Pi in:

`~/patton-control-panel/.env`

Set:

```text
HOME_ASSISTANT_TOKEN=your_token_here
```

Then map the actual Home Assistant entity IDs in:

`~/patton-control-panel/control-panel.json`

Supported mappings include the Upstairs Thermostat, three Caséta lighting groups, main water shutoff, gate, Goodnight, Away, and Morning scenes.

Restart after mapping:

```bash
sudo systemctl restart patton-control-panel
```

## Safety behavior

- **Water OFF** requires confirmation and intentionally offers no casual re-open button.
- **Gate CLOSE** requires confirmation.
- If Home Assistant is not configured or unavailable, commands fall back to Preview Mode rather than issuing uncertain control requests.
- Home Assistant tokens and other credentials are excluded by `.gitignore` and remain server-side.
