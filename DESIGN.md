---
# gstack: design-md-format=spec
name: Locus
description: Clean native-feeling chrome around a dark game-style map; ink is the only accent, colour belongs to the map.
colors:
  surface: "#f5f5f7"
  surface-raised: "#ffffff"
  fill: "#e5e5ea"
  fill-strong: "#d1d1d6"
  text: "#000000"
  text-muted: "#6e6e73"
  text-tertiary: "#aeaeb2"
  separator: "#c6c6c8"
  primary: "#000000"
  on-primary: "#ffffff"
  success: "#34c759"
  warning: "#ff9500"
  error: "#ff3b30"
  live: "#ff3b30"
  dark-surface: "#000000"
  dark-surface-raised: "#1c1c1e"
  dark-fill: "#2c2c2e"
  dark-text: "#ffffff"
  dark-text-muted: "#98989f"
  dark-separator: "#38383a"
  map-ground: "#20252c"
  map-outside: "#161a20"
  map-building: "#363e49"
  map-building-edge: "#262c34"
  map-water: "#1e5a88"
  map-shore: "#4a92c6"
  map-park: "#2c5836"
  map-casing: "#0f1216"
  map-road-primary: "#f0c75e"
  map-road-secondary: "#e3e8ee"
  map-road-lane: "#a3adb8"
  map-road-path: "#b9a58a"
  map-route: "#5ab0ff"
  map-walked: "#3ddc84"
  map-landmark: "#f3d27a"
  map-door: "#ffffff"
typography:
  display:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Display, Inter
    fontWeight: 400
    fontSize: clamp(36px, 6vw, 60px)
    lineHeight: 1.02
    letterSpacing: -0.035em
  title:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Display, Inter
    fontWeight: 400
    fontSize: 30px
    letterSpacing: -0.025em
  heading:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Text, Inter
    fontWeight: 400
    fontSize: 20px
    letterSpacing: -0.015em
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Text, Inter
    fontWeight: 400
    fontSize: 1rem
    lineHeight: 1.45
  label:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Text, Inter
    fontWeight: 400
    fontSize: 0.8125rem
  section-label:
    fontFamily: -apple-system, BlinkMacSystemFont, SF Pro Text, Inter
    fontWeight: 400
    fontSize: 0.8125rem
    letterSpacing: 0.04em
  scripts:
    fontFamily: Anek Devanagari, Anek Kannada
    fontWeight: 400
  mono:
    fontFamily: ui-monospace, SF Mono, Menlo
    fontFeature: tnum
rounded:
  sm: 12px
  md: 16px
  lg: 20px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    height: 48px
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
  group:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    separator: 0.5px "{colors.separator}", inset 16px
  cell:
    minHeight: 52px
    padding: 10px 16px
  input:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.sm}"
    height: 48px
  switch-on:
    backgroundColor: "{colors.success}"
    rounded: "{rounded.full}"
  bubble-locus:
    backgroundColor: "{colors.fill}"
    rounded: 18px
  bubble-rider:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: 18px
  map-pin:
    backgroundColor: rgba(12, 14, 18, 0.82)
    pip: "{colors.map-landmark}"
    rounded: "{rounded.full}"
---

# Locus

## Overview

Creative north star: the calm of a native iOS settings screen, wrapped around a game map you can read at a glance. The chrome stays out of the way (grouped grey, white cards, black ink); the map carries all the colour, and that colour always means something.

Product context: Locus answers a delivery rider's call and guides them to the recipient's door in Hinglish. Recipients set up once on a phone (details, gate pin, walk video, landmarks), turn on "Expecting a delivery", and can watch calls live or try one from the browser.

References:
- Spatial Agents (sister project, `web/src/index.css`, `screenshots/`): grouped lists, inset separators, pill buttons, spring presses, ink as the only accent.
- Sadak (sister project, `game_engine/components/map/mapKit.ts`): the map palette.

Surfaces:
- Home (Operate): map on the left (or top on a phone), grouped panel on the right: Deliveries, Calls, Your route, Account.
- Setup (Operate): four steps (details, gate pin, walk video, landmarks), map plus a panel, step dots.
- Call view and test call (Experience): map with the route and rider; status, progress and chat bubbles beside it.
- Landing and demo call (Persuade).

## Colors

Strategy: restrained chrome, committed map.
- Chrome: grey grouped background, white raised surfaces, black ink. Black is the primary button and the rider's chat bubble. There is no brand hue in the chrome.
- Status colours are iOS system colours and appear only for status: green for a switch that is on and for reached progress, red for live calls, errors and ending a call, orange for warnings.
- Map: Sadak's game palette, identical in light and dark mode so the route always reads. Dark ground and building blocks, gold primary roads, pale secondaries, grey lanes, all in dark casings; blue water with a lighter shore; green parks.
- Map meanings: blue is the route and the rider; green is the stretch already walked and reached landmarks; gold is a landmark; white is the door.

Dark mode follows the system: black background, `#1c1c1e` cards, white ink. The map does not change.

## Typography

The system font (SF Pro on Apple devices, Inter or Helvetica elsewhere) carries the UI. Weight stays 400 everywhere, as the user's rules require; hierarchy comes from size and negative tracking on large text (display −0.035em, title −0.025em). Section labels are small uppercase muted text above each group. Anek Devanagari and Anek Kannada render Hindi and Kannada landmark names. Mono (SF Mono) is for phone numbers, DIGIPIN and timers.

## Layout

- Map-first. On desktop the map fills the left and the panel (420–440px) sits on the right; on a phone the map takes the top half and the panel slides over it as a sheet with 20px top corners.
- Panels are a stack of groups with 24px between them.
- Overlays on the map (street name, call timer, notices) are frosted glass cards: `--glass` with backdrop blur.
- Phone side gutters 16px; tap targets at least 44px (cells 52px, buttons 48px).

## Elevation & Depth

Flat surfaces separated by background tone, not borders: white groups on grey. Only things floating over the map get shadows (pins, callouts, map controls), soft and dark so they read on the dark ground. The call stage card has a very soft lift.

## Shapes

- 12px: inputs, small cards, alerts.
- 16px: groups and cards.
- 20px: the call stage and phone sheets.
- Full pill: buttons, chips, segmented controls, map pins, the call timer.
- Circles: the rider dot, the door dot, landmark pips.

## Components

- Buttons: pills. Primary is black with white text, secondary is grey fill, danger is red. Pressing scales to 0.97 with a quick fade (Spatial Agents' `pressable`). Disabled is 40% opacity; controls that can't work are hidden.
- Group and cell: a white rounded list. Each row has an optional 30px rounded icon tile, a title, a muted subtitle, and an end value or chevron. Separators are 0.5px and inset 16px.
- Switch: iOS style, green when on.
- Inputs: white on grey (grey on white inside a card), 12px corners, a 2px ink focus ring.
- Chat bubbles: Locus's lines are grey on the left, the rider's black on the right; the speaker label shows only when the speaker changes; the active line is ringed in route blue.
- Map pins: a dark pill with a gold numbered pip, the name, and the Hindi and Kannada names in small grey text. When there is a walk photo, a 40px rounded photo replaces the pip and the number moves onto its corner. Reached pins turn their pip green; draft pins are translucent with a dashed gold outline.
- Door: a white dot with a dark ring and a small "Door" pill (left off when the last landmark is the door).
- Rider: a blue dot with a white border and a soft blue halo.
- Callout: a white rounded bubble on the map showing Locus's latest line, rising in.
- Placement pins (setup): a fixed pin at the map centre, white for the gate and gold for landmarks.
- Live indicator: a pulsing red dot; a four-bar waveform shows who is speaking (red for you, blue for Locus).
- Loading: shimmer skeletons in fill colour; never a stock image.
- Icons: Phosphor, regular weight.

## Do's and Don'ts

- Do keep the chrome monochrome; let the map and status carry colour.
- Do use grouped lists for settings-like content, not freestanding bordered boxes.
- Do give every async view a skeleton.
- Do credit OpenStreetMap and OpenFreeMap on every map.
- Don't use bold or semibold; use size and tracking.
- Don't add a brand colour to buttons or headings.
- Don't change the map palette with the theme.
- Don't use heavy borders, hard offset shadows or handwritten fonts (the earlier "wedding card" look is retired).

## Motion

- Approach: snappy and functional, on a critically damped spring (`cubic-bezier(0.22, 1, 0.36, 1)`).
- Presses 100–160ms; switches 200–250ms; content rises 8px over 280ms.
- The route draws in over about 1.8 seconds on load; the walked stretch turns green as the rider reaches each landmark; the callout rises in with each new line.
- `prefers-reduced-motion` turns animation off.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-21 | Initial "wedding-card map" system | First /design-consultation pass. |
| 2026-11-22 | Replaced with Spatial Agents chrome and Sadak map colours | The user found the wedding-card look too stylised ("looks vibe coded") and asked for clean and modern like Spatial Agents, with maps coloured like Sadak. |
| 2026-11-22 | Weight 400 throughout, unlike Spatial Agents' bold titles | The user's standing rule: no bold or semibold. |
| 2026-11-22 | Map identical in light and dark mode | The route, rider and door keep the same meaning and contrast everywhere. |
