# Farm Dashboard

A Raspberry Pi TV dashboard for the farm. It combines portfolio/watchlist information with rotating property-monitoring screens and runs as a dedicated Chromium kiosk.

## Supported Raspberry Pi setup

Use the current Raspberry Pi OS **64-bit with Desktop**. Current Raspberry Pi OS uses the labwc Wayland desktop, and FarmPi launches its kiosk from the user's labwc graphical session.

The current installer supports the existing Raspberry Pi installation and Raspberry Pi 5. A Pi 5 is recommended for the display replacement because Chromium, Webull/background refreshes, and the dashboard UI have substantially more CPU/RAM headroom.

## Raspberry Pi 5 — easiest fresh install

Flash the current Raspberry Pi OS 64-bit **with Desktop** using Raspberry Pi Imager. Create the normal user during imaging/first boot, connect networking, boot into the desktop, and open a terminal.

Then run:

```bash
curl -fsSL https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi/install-pi5.sh -o /tmp/install-pi5.sh
bash /tmp/install-pi5.sh
sudo reboot
```

The Pi 5 bootstrap defaults to hostname `farmpi5` so it can be staged while the older `farmpi` remains online without an mDNS/hostname collision.

If the old Pi is already powered off and the Pi 5 should immediately take over `farmpi.local`, run:

```bash
FARMPI_HOSTNAME=farmpi bash /tmp/install-pi5.sh
sudo reboot
```

The installer automatically:

- installs Chromium, labwc/Wayland kiosk dependencies, CEC, Python, Git and rsync
- creates the Python virtual environment and installs requirements
- creates/enables `farm-dashboard.service`
- enables Raspberry Pi Desktop Autologin
- disables Raspberry Pi OS screen blanking
- installs the persistent kiosk supervisor in `~/.config/labwc/autostart`
- installs/enables the GitHub auto-deploy timer
- starts the dashboard immediately
- starts the kiosk immediately when a Wayland desktop session is already available

## Move private settings from the existing Pi

Credentials and machine-local settings are intentionally not stored in GitHub. After the Pi 5 is installed, they can be copied from the older Pi over SSH without copying old application code.

From the **new Pi 5**:

```bash
cd ~/farmpi
bash migrate-from-existing-pi.sh jpatton@farmpi.local
```

The migration helper copies only existing machine-local items such as:

- `cameras.env`
- `webull.env`
- Webull token state
- `conf/token.txt`
- `dashboard_config.json`
- `power_schedule.json`
- `stocks.json`

It then restarts the dashboard and requests a kiosk refresh.

If the old Pi uses a different username/hostname/IP, pass that instead, for example:

```bash
bash migrate-from-existing-pi.sh user@192.168.1.50
```

## Self-healing kiosk

`kiosk-supervisor.sh` owns the Chromium lifecycle. It runs inside the labwc graphical session and uses a single-instance lock, so accidentally starting it more than once is safe.

It automatically rebuilds the Chromium kiosk when:

- Chromium exits or crashes
- the HDMI output disconnects and reconnects
- the Flask dashboard temporarily goes offline and later recovers
- a successful GitHub deployment requests a refresh
- the configured morning TV wake time occurs
- the Wayland compositor/socket is replaced

The scheduled-wake recovery is important for TVs that stay electrically connected over HDMI while in standby: the TV can wake by CEC but an overnight Chromium/Wayland frame can otherwise remain invisible or stale. FarmPi now performs a fresh Chromium launch once during the configured wake minute.

Useful kiosk commands:

```bash
tail -100 /tmp/1838-estate-kiosk-supervisor.log
tail -100 /tmp/1838-estate-kiosk.log
pgrep -af chromium
touch /tmp/1838-estate-kiosk-refresh
```

The last command requests a clean Chromium rebuild through the supervisor.

## Existing Pi upgrade

An existing FarmPi with the auto-deploy timer will receive the supervisor and installer changes automatically. To force the update immediately:

```bash
sudo systemctl start farmpi-auto-deploy.service
```

Then check:

```bash
sudo journalctl -u farmpi-auto-deploy.service -n 60 --no-pager
tail -60 /tmp/1838-estate-kiosk-supervisor.log
```

The deployment script now also self-recovers its disposable Git checkout. If a power interruption leaves empty/corrupt Git objects, the updater removes only the deployment cache and reclones it automatically; live dashboard settings and credentials are preserved.

## Manual fresh install from a clone

Instead of the Pi 5 bootstrap wrapper:

```bash
git clone https://github.com/jakelpatton/-stockpi-config.git
cd ./-stockpi-config/stockpi
chmod +x install.sh
./install.sh
sudo reboot
```

Set a custom hostname by exporting `FARMPI_HOSTNAME`:

```bash
FARMPI_HOSTNAME=farmpi5 ./install.sh
```

## Rotation

Rotation timing and enabled/disabled state are controlled from the settings page. The dashboard contains the portfolio/market screens and property-monitoring screens configured in `dashboard_config.json`.

## Automatic GitHub deployment

For an already-installed Pi that does not yet have auto-deploy enabled:

```bash
curl -fsSL https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi/install-auto-deploy.sh -o /tmp/install-auto-deploy.sh
bash /tmp/install-auto-deploy.sh
```

The `farmpi-auto-deploy.timer` checks `main` about every three minutes. On a new commit it validates code/config files, snapshots current code, preserves machine-local state, syncs the new application, updates dependencies, restarts Flask, verifies health, rolls back on failed health checks, and asks the kiosk supervisor for a clean browser refresh.

Useful deployment commands:

```bash
sudo systemctl start farmpi-auto-deploy.service
systemctl status farmpi-auto-deploy.timer --no-pager
journalctl -u farmpi-auto-deploy.service -n 50 --no-pager
```

## Addresses

Default original installation:

```text
http://farmpi.local:8080
http://farmpi.local:8080/settings
```

Default Pi 5 staging installation:

```text
http://farmpi5.local:8080
http://farmpi5.local:8080/settings
```

The physical kiosk itself always uses `http://127.0.0.1:8080/`, so changing the hostname does not change the local display.

## HDMI-CEC

The settings page can wake a compatible TV, switch it to the Pi input and put it in standby on a schedule. The default schedule is 07:15 wake and 22:30 standby. HDMI-CEC must be enabled on the television.

## Configuration files

- `dashboard_config.json` — rotation timing/theme/screens
- `power_schedule.json` — TV CEC schedule
- `stocks.json` — local watchlist/fallbacks
- root `portfolio.json` — cloud stock thesis/recommendation feed
- `cameras.env`, `webull.env`, token files — machine-local private configuration, never deployed from GitHub
