---
# gstack: design-md-format=spec
name: Locus
description: A hand-drawn neighbourhood map on a pista-green wedding card, inked in ballpoint, calm and local.
colors:
  surface: "#E3ECD0"
  surface-raised: "#FAFAF2"
  ghost: "#C9D5B4"
  ghost-deep: "#B3C49A"
  text: "#16213B"
  text-muted: "#4B5672"
  primary: "#2340B0"
  primary-pressed: "#1A3190"
  on-primary: "#FAFAF2"
  door: "#C8102E"
  rider: "#F2B705"
  success: "#2F7D4F"
  warning: "#9A6A00"
  error: "#C8102E"
  night-surface: "#0F1A2E"
  night-surface-raised: "#16233D"
  night-ghost: "#22324F"
  night-ghost-deep: "#2B3D5E"
  night-text: "#E8EEDC"
  night-text-muted: "#A7B1C8"
  night-primary: "#8EA2FF"
  night-primary-pressed: "#B3C1FF"
  night-on-primary: "#0F1A2E"
  night-door: "#FF6B7D"
  night-rider: "#F6C531"
  night-success: "#6FCB95"
typography:
  display:
    fontFamily: Anek Latin
    fontWeight: 400
    fontStretch: 125%
    fontSize: clamp(28px, 4vw, 44px)
    lineHeight: 1.05
    letterSpacing: -0.01em
  heading:
    fontFamily: Anek Latin
    fontWeight: 400
    fontStretch: 125%
    fontSize: 24px
    lineHeight: 1.15
  body:
    fontFamily: Anek Latin
    fontWeight: 400
    fontStretch: 100%
    fontSize: 1rem
    lineHeight: 1.5
  body-devanagari:
    fontFamily: Anek Devanagari
    fontWeight: 400
    fontStretch: 100%
  body-kannada:
    fontFamily: Anek Kannada
    fontWeight: 400
    fontStretch: 100%
  label:
    fontFamily: Anek Latin
    fontWeight: 400
    fontStretch: 75%
    fontSize: 0.8125rem
    lineHeight: 1.4
  annotation:
    fontFamily: Kalam
    fontWeight: 400
    fontSize: 17px
    lineHeight: 1.15
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontFeature: tnum
    letterSpacing: 0.02em
rounded:
  xs: 2px
  sm: 3px
  md: 4px
  lg: 6px
  device: 22px
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
    borderColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.primary-pressed}"
    shadow: 3px 3px 0 "{colors.text}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    borderColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: 48px
  input:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: 44px
  card:
    backgroundColor: "{colors.surface-raised}"
    borderColor: "{colors.text}"
    rounded: "{rounded.md}"
  switch-on:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  landmark-stamp:
    backgroundColor: "{colors.surface-raised}"
    borderColor: "{colors.text}"
    rounded: "{rounded.xs}"
    shadow: 4px 4px 0 "{colors.text}"
  rider-dot:
    backgroundColor: "{colors.rider}"
    borderColor: "{colors.text}"
    rounded: "{rounded.full}"
  focus-ring:
    outlineColor: "{colors.rider}"
    outlineWidth: 3px
---

# Locus

## Overview

Creative north star: the map your neighbour draws on the back of a wedding card. Only the route is drawn; the rest of the city fades into the card. It fits because Locus's promise is "it knows my street": the screen should feel local and hand-drawn, not like a generic navigation app.

Product context: Locus answers a delivery rider's phone call and guides them to a recipient's door, landmark by landmark, in Hinglish. Recipients set up their home once on a phone (door pin, walk video, confirmed landmarks). Peers are Google Maps, Ola Maps and the delivery apps' own tracking screens. All of them look like satellite-era utility maps, which is the look Locus avoids.

Mode per surface:
- Live call view on a projector or laptop (Experience): one map, one route, one rider, and a transcript column.
- Recipient setup on a phone (Operate): door placement, walk recording, landmark review, the expecting-delivery switch.
- Call history (Read): a list of past calls with the outcome.

Platform: a mobile-first web app. Walk recording happens in a normal browser tab, not as an installed home-screen app, because iOS MediaRecorder is unreliable in installed web apps. A native app (Expo) comes later, only if background GPS or push is needed.

Reference sites: mapcn.dev (MapLibre components, MIT), felt.com (hand-drawn map illustration), Sadak (our sister repo's photo-stamp markers).

Key characteristics:
- Pista-green card ground with paper-coloured roads; only the active route is inked.
- One family (Anek) at a single weight; hierarchy comes from width and size.
- Landmarks are tilted photo stamps with names in English, Hindi and Kannada.
- Two colours with fixed meanings: kumkum red is the door, turmeric yellow is the rider.
- Handwritten Kalam notes appear on the map as the guide speaks.

## Colors

Strategy: restrained, with a fixed meaning for each colour. The card colour owns the page. Ink and ballpoint blue carry all text and interaction. Two vivid colours each have exactly one job and never appear anywhere else:
- Kumkum (`door`) marks the recipient's door on maps. It also doubles as the error colour, because both mean "stop here".
- Turmeric (`rider`) marks the rider's live position, the trail behind them, reached landmarks, and the keyboard focus ring. It is never used as a button fill.

Ballpoint blue (`primary`) is the route line and every primary action, so "the thing to follow" and "the thing to press" look the same.

Neutrals come from the card's own green: `ghost` and `ghost-deep` are the faded city (parks, minor roads, water). Text is a deep blue-black ink rather than grey-black, so it sits on the green like pen on paper.

Light or dark: light by default. Recipients set up at home in daylight, and the light card projects well. The night card is a full theme, not an inversion: the surfaces turn deep navy, ink becomes off-white, and the three meaning colours are lifted (`night-primary`, `night-door`, `night-rider`) so they keep their contrast. Every colour keeps its meaning in both themes.

## Typography

Anek (Ek Type) is the one family. It was designed in India with Latin, Devanagari and Kannada in one voice, so a landmark's three names sit together without a font change. It is a variable font, and Locus uses only its width axis:
- Display and headings: width 125%. Wide and poster-like, used for street names and screen titles.
- Body: width 100%.
- Labels, captions and metadata: width 75%, smaller and muted.

The weight is 400 everywhere, including headings and "bold" moments. Emphasis comes from width, size or colour, never weight.

Kalam is the ballpoint handwriting: it is used only for annotations written onto the map (stamp names, directions between stops, the door label). It never appears in UI chrome.

JetBrains Mono is used only for strings people read digit by digit: the Locus phone number, DIGIPIN, timers and clock times. It always uses tabular figures.

Load all of them from Google Fonts (Anek Latin, Anek Devanagari and Anek Kannada with the `wdth` axis 75–125 at weight 400; Kalam 400; JetBrains Mono 400) with `display=swap`. All five faces are verified on Google Fonts.

## Layout

Map first and full bleed. The map is the product; chrome sits on top of it or beside it.
- Phone (under 640px): the street name sits at the top left like a poster, with one bottom sheet for actions. The call badge moves to the bottom left so it never covers the street name.
- Projector or desktop (860px and up): the map takes the left two thirds; the right third is a column holding the status ("Guiding to …", five-step progress) above the transcript.
- 640–860px: the map sits above the column.

Spacing uses a 4px base with the scale in the tokens. Tap targets are at least 48px tall; inputs are 44px. Phone screens use 16px side gutters, and marketing sections use `clamp(16px, 4vw, 48px)`. Section headings cap at about 18 characters per line, and paragraph text caps at 60 characters.

Progress is shown as named places ("Guiding to Iyengar bakery"), not percentages or distances.

## Elevation & Depth

Depth is flat and printed, never blurred. Raised things (landmark stamps, phone frames, hovered buttons) get a hard ink offset shadow (`3–6px 3–6px 0`) with no blur, like a stamp pressed onto card. Everything else is separated by a 1.5px ink border or a dashed `ghost-deep` rule. A subtle paper-grain noise sits over the page (6% opacity in light, 8% at night). Glows, soft drop shadows and glassmorphism are not used.

The route is drawn in three layers: a thin ink edge, a paper road band on top of it, and a slightly jittered double ballpoint line over the band so it reads as hand-drawn.

## Shapes

Corners are nearly square, as on printed card stock:
- 2px: stamps.
- 3px: buttons, inputs, switches.
- 4px: cards, sheets, alerts.
- 6px: large panels such as the live-call stage.
- 22px: device frames, in previews only.
- Full circle: only the rider dot and the record button.

Stamps are rotated ±2–3°, alternating between neighbours; nothing else is rotated except Kalam notes (−3°).

## Components

- Primary button: ballpoint fill, paper text, 48px tall.
  - Hover: a darker blue, a 3px ink offset shadow, and a 1px lift.
  - Active: no shadow and a 1px press.
  - Focus-visible: a 3px turmeric outline with a 2px offset.
  - Disabled: 45% opacity with no shadow. Hide controls that cannot work in the current state rather than leaving them dead.
- Secondary button: paper fill with an ink border. The ghost variant is transparent.
- Input: card fill, ink border, a 75%-width label above it, and the same turmeric focus outline.
- Switch: a square-cornered track that fills ballpoint blue when on; the thumb slides 27px.
- Landmark stamp: a paper card, 2px ink border, a 4px hard shadow and a slight rotation. It shows the stop number, the name in Kalam, then the Hindi and Kannada names at 75% width. Reached stamps take a turmeric tint.
  - Photo-backed stamps show the walk-video frame.
  - While the frame is loading, show a shimmer skeleton, never a stock photo.
- Door marker: a Kalam × in kumkum with a short label under it.
- Rider dot: a turmeric circle with an ink border and a soft turmeric halo, followed by a translucent turmeric trail.
- Door placement: the map moves under a fixed kumkum × crosshair, and the resolved address sits in a paper chip at the bottom.
- Alerts: paper card with an ink border and a coloured Phosphor icon (success leaf, warning amber, error kumkum, info ballpoint); the copy names what happened and what to do next.
- Transcript turn: the speaker label in a 75%-width label with a Phosphor icon (waveform for Locus, moped for the rider), and Locus's lines in ballpoint blue.
- Icons: Phosphor Regular only.
- Map: MapLibre through mapcn components, with a custom style on OpenFreeMap (OpenMapTiles schema).
  - Base layers: background, park, landcover, water, transportation.
  - Labels and buildings are off; annotations are HTML markers.

## Do's and Don'ts

- Do keep every type style at weight 400 and get hierarchy from `font-stretch` and size.
- Do use kumkum only for the door and errors, and turmeric only for the rider, reached state and focus.
- Do show every landmark name in all three scripts on stamps.
- Do give every async surface a loading state (skeleton or shimmer) instead of letting content pop in.
- Do credit OpenStreetMap and OpenFreeMap on every map.
- Don't use bold or semibold anywhere, including headings and buttons.
- Don't show the full city at full contrast or turn on base-map labels; only the route is inked.
- Don't use the overused "warm editorial" look: cream grounds, Fraunces or other high-contrast serif display faces, or terracotta accents.
- Don't use blurred shadows, glows, gradients on buttons, or rounded-pill buttons.
- Don't use stock or placeholder photos of landmarks; show the real frame or a labelled skeleton.

## Motion

- Approach: intentional. Motion explains where the rider is; it never decorates.
- Easing: enter ease-out, exit ease-out, move ease-in-out.
- Duration: micro 100ms (button press), short 200ms (switch, fades), medium 350ms (transcript turn enter), long 500–900ms (note write-on).
- The one authored moment, the live call:
  1. The route inks itself in from the first point to the door in about 2 seconds.
  2. The turmeric rider moves along it as the rider names landmarks, leaving a trail.
  3. Each stamp tints when it is reached.
  4. A Kalam note writes itself onto the map (a left-to-right clip reveal) as Locus speaks the next direction.
- Under `prefers-reduced-motion`: animations and transitions are off, the route draws instantly, and the rider jumps between stops.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-21 | Initial design system created ("wedding-card map") | Created by /design-consultation from the Locus product brief, research on mapcn, Felt and Sadak, and a Codex outside voice; approved through a live HTML preview. |
| 2026-11-21 | Mobile-first web app, not native | Recipients set up once; walk recording works in a browser tab. Native (Expo) is deferred until background GPS or push is needed. |
| 2026-11-21 | Anek at one weight, with width as the hierarchy axis | Covers Latin, Devanagari and Kannada in one voice, and matches the no-bold rule. |
| 2026-11-21 | Rejected cream, Fraunces and terracotta | Codex suggested them; that palette is the overused editorial look and reads as generic. |
| 2026-11-21 | Adopted from Codex: crosshair door placement, photo-backed stamps, named-place progress, and the projector split | They make the demo legible from the back of a room. |
