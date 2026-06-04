# Suinami — Design System

**Mood:** Abyssal bioluminescent instrument. Deep-sea dark, water in motion, precise
mono readouts glowing like a dive computer. Calm → swelling → crest. Never flat, never
"AI gradient." Texture via grain. Every number is an instrument.

## Palette (exact hex — do not invent colors)

| Token | Hex       | Use                                              |
| ----- | --------- | ------------------------------------------------ |
| abyss | `#0a1428` | Base background (full-bleed)                     |
| deep  | `#0e2a47` | Secondary background, panel fills                |
| sui   | `#4da2ff` | Primary accent (Sui blue), wordmark gradient end |
| aqua  | `#6fe6e1` | Secondary accent, wordmark gradient start, glow  |
| foam  | `#eaf6ff` | Primary text / foreground                        |
| coral | `#ff6b6b` | Hot accent — gifts, the "tsunami" tier, alerts   |

**Gradients:** tide = `linear-gradient(135deg, #6fe6e1, #4da2ff)` (aqua→sui). Used for
the wordmark and hero metrics via background-clip text. Avoid full-screen linear
gradients on dark (H.264 banding) — use **radial** glows + solid abyss instead.

**Glows (bioluminescent depth cues):**
- sui: `0 0 28px rgba(77,162,255,0.45)`
- aqua: `0 0 30px rgba(111,230,225,0.42)`
- coral: `0 0 26px rgba(255,107,107,0.45)`

**Hairline:** `1px solid rgba(234,246,255,0.10)` for panel edges.
**Glass panel:** fill `rgba(10,20,40,0.55)`, used for instrument readouts.

## Typography

- **Display** (wordmark, hero lines): `Bricolage Grotesque`, weights 600–800.
- **UI** (taglines, body, labels): `Hanken Grotesk`, weights 400–600.
- **Mono** (ALL numbers, addresses, blob IDs, gas, SUI amounts): `JetBrains Mono`,
  always `font-variant-numeric: tabular-nums`. The mono is the "instrument" voice.

Headlines 90px+, body 36px+, data labels 28px+ (rendered vertical 1080×1920).

## Texture & Motion

- **Grain:** fine SVG fractal-noise overlay, opacity ~0.05, `mix-blend-mode: overlay`,
  pointer-events none. Kills the flat-dark look.
- **Caustics:** slow-drifting radial blobs (aqua/sui), heavy blur, low opacity — the
  underwater light. Finite-repeat only (no `repeat: -1`).
- **Entrances:** rise + fade, ease `cubic-bezier(0.16,1,0.3,1)` (expo-out feel). Stagger
  letters/lines. Vary eases across a scene (≥3).
- **Energy arc:** still surface → dive → swell → crest. Gifts escalate ripple → wave →
  tsunami (scale up, coral intensifies).

## What NOT to Do

- No `#333`, `#3b82f6`, `Roboto`, or any color/font outside the tables above.
- No flat full-screen linear gradients on the dark bg (banding).
- No white flashes / pure-white backgrounds — this is a deep-sea app.
- Numbers are never proportional-figure or non-mono — always JetBrains Mono + tabular.
- No jump cuts between scenes — always a transition; entrances on every element.
