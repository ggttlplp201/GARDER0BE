# Museum Wardrobe View — Design Spec

**Date:** 2026-05-23  
**Status:** Approved  

---

## Overview

Replace the current RACK/GRID/LIST wardrobe view with a CSS-3D museum corridor as the primary browsing experience. Clothing items hang as framed gallery pieces on alternating walls; scrolling walks the camera deeper down the hall. GRID and LIST remain as secondary modes. A floating ghost HUD provides search, filter, and utility actions without breaking the museum atmosphere. The enhanced `AsciiBackground` component (plasma / wire sphere / tunnel) replaces the hand-rolled ASCII in the auth screen as a bonus upgrade.

---

## User Flow

1. User opens the wardrobe tab — sees the 3D museum corridor (Museum mode, default).
2. A ghost HUD bar floats at the top with mode toggle, search, type filter, and add button.
3. User scrolls to walk through the corridor; item frames hang on alternating walls.
4. Hovering a frame tilts it toward the camera with a brightness/shadow effect.
5. Clicking a frame opens the item detail view (same as today).
6. User can switch to GRID or LIST via the HUD mode toggle.
7. Search and type filter dynamically filter items shown in any mode.

---

## Layout

### Museum mode

```
┌──────────────────────────────────────────────────────────┐
│  [MUSEUM|GRID|LIST]  [SEARCH…]  [TYPE ▾]  [+ ADD]       │  ← Ghost HUD, 48px, blur backdrop
│                                                          │
│          ┌──────────────────────────────────┐            │
│          │   3D museum corridor (100vh)      │            │
│          │   frames on left/right walls      │            │
│          │   scroll = walk camera forward    │            │
│          └──────────────────────────────────┘            │
│                                                          │
│  14 · 5 BRANDS · $3,200 · 2 GRAILS   Air Jordan 1 Mid  01% │  ← Bottom bar, blur backdrop
└──────────────────────────────────────────────────────────┘
```

### GRID / LIST modes

Ghost HUD persists at top. Museum is hidden. Existing GRID/LIST layouts render below the HUD with `padding-top: 48px` to clear it.

### Mobile (< 480px)

Ghost HUD: mode toggle on left, search icon on right (tap to expand full-width input). Type filter collapses into the search row when expanded. Museum 3D scroll works on mobile via touch scroll; hover tilt does not apply (no pointer).

---

## Ghost HUD

| Property | Value |
|---|---|
| Position | `absolute; top: 0; left: 0; right: 0; z-index: 100` |
| Height | 48px |
| Background | `rgba(10,10,10,0.55)` + `backdrop-filter: blur(12px)` |
| Left | Mode toggle: `[MUSEUM \| GRID \| LIST]` (monospace, same style as existing toolbar) |
| Center | Search input (expands on focus, collapses when empty and unfocused) |
| Right | Type filter `<select>` + `+ ADD` button |

---

## Bottom Status Bar (Museum mode only)

Replaces the existing Museum progress (`00%`) and item name caption with a three-zone bar:

| Zone | Content |
|---|---|
| Left | Compact stats: `{n} · {brands} BRANDS · ${value} · {grails} GRAILS` |
| Center | Nearest item name (largest type, ~18px) |
| Right | `{progress}%` corridor progress |

Style: `position: absolute; bottom: 0; left: 0; right: 0; backdrop-filter: blur(8px); background: rgba(10,10,10,0.4); padding: 8px 20px`.

---

## Frame Photo Integration

The Museum frame placeholder (colored box + brand text) is replaced with the item's first photo. `parseImageUrls(item.image_url)[0]` extracts the URL. If no image is available, the colored placeholder renders as a graceful fallback.

```jsx
// Inside MuseumFrame, replace the placeholder div with:
{imgUrl
  ? <img src={imgUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  : <div style={{ background: item.color + '18', ... }}><span>{item.brand.split(' ')[0]}</span></div>
}
```

---

## Data Mapping

Museum expects `{ id, cat, brand, name, type, color }`. Current wardrobe items supply all fields:

| Museum field | Source |
|---|---|
| `id` | `item.id` |
| `cat` | `catNum(globalIdx)` — already in WardrobeView |
| `brand` | `item.brand` |
| `name` | `item.name` |
| `type` | `item.type` |
| `color` | `item.color ?? '#888888'` |

A derived `image_url` field (not in Museum's shape) is threaded into the frame component for the photo swap above.

---

## Mode Changes

| Before | After |
|---|---|
| Default mode: RACK | Default mode: MUSEUM |
| Toggle: RACK / GRID / LIST | Toggle: MUSEUM / GRID / LIST |
| RACK removed | — |

GRID and LIST layouts are unchanged internally.

---

## Empty / Loading States

- **Loading**: shimmer pulse overlaid inside the corridor viewport (CSS animation, same pattern as existing app).
- **Empty / no match**: centered `NO ITEMS MATCH` text overlay on the corridor. An `+ ADD FIRST ITEM` button renders when the wardrobe is completely empty.

---

## AsciiBackground Upgrade (AuthScreen)

`AsciiBackground.jsx` (from handoff) is added to `src/components/`. The existing hand-rolled ASCII animation in `AuthScreen.jsx` is replaced with `<AsciiBackground opacity={0.22} />`. Three effects cycle randomly per session (plasma, wire sphere, tunnel), cached in `sessionStorage` so a tab refresh keeps the same effect. The existing vignette gradient and scanline overlay in AuthScreen are preserved.

---

## Component Changes

| File | Change |
|---|---|
| `src/components/WardrobeView.jsx` | Add MUSEUM mode (default), ghost HUD, bottom status bar; remove RACK mode |
| `src/components/Museum.jsx` | New — handoff component, frame modified to render item photos |
| `src/components/AsciiBackground.jsx` | New — handoff component |
| `src/components/AuthScreen.jsx` | Swap hand-rolled ASCII for `<AsciiBackground />` |

---

## Out of Scope

- Keyboard navigation through the corridor (arrow keys to walk forward/back).
- "Room 02" pagination (the doorway at the back wall is decorative).
- Per-frame spotlights or ambient occlusion.
- Virtual try-on integration with the Museum view.
- Smooth scroll-snap to ideal per-frame viewing positions.
