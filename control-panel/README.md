# Patton Farm Control Panel

This directory is intentionally separate from `stockpi/`.

- `stockpi/` = passive / rotating 37-inch Farm display.
- `control-panel/` = touch-first Surface Pro control station.

The control panel does **not** replace or restyle the existing TV display. It is a separate UI project that can read the same Farm/Home Assistant data and eventually send approved control actions through Home Assistant.

## Theme

**Patton Farm — Est. 1838**

The design is based on the aged-brass Surface enclosure concept: dark charcoal glass, warm antique brass, ivory typography, restrained Victorian linework, engraved-style dividers, and large modern touch targets. The historical styling is deliberately architectural rather than ornate-for-ornate's-sake.

## Data policy

The initial UI does not invent a second set of property data. It reads the existing Farm endpoints when available and uses the same names/status values already used by the main dashboard. Home Assistant entity mappings can be added later without changing the visual theme.

## Intended pages

- Home
- Lighting
- Climate
- Water
- Cameras
- Gate / Access
- Systems

## Files

- `index.html` — touch UI structure
- `victorian.css` — full Victorian brass theme
- `control-panel.js` — data binding, navigation, clock, safe control hooks

## Safety

Critical actions such as water restore and gate operation should be routed through Home Assistant and use confirmation logic. The UI can make emergency **water OFF** easy while requiring a deliberate confirmation before restoring service.
