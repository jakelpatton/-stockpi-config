# Surface test checklist

1. Start `./run-preview.sh` and open `http://localhost:8090`.
2. Verify Home/Lights/Thermostat/Cameras/Water/Gate/Scenes/Systems navigation by touch.
3. In Preview Mode, verify light toggles, thermostat +/- and mode buttons, Goodnight, gate open/close confirmation, and water-off confirmation.
4. If `farmpi.local` is online, verify weather/property values and Amcrest channels 1–3 populate.
5. After Home Assistant is mapped, verify the Systems page shows LIVE before testing real control actions.

Do not use an unmapped critical control as proof of hardware operation; Preview Mode intentionally simulates the UI without changing real equipment.
