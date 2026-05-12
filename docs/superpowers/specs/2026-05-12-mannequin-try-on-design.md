# Mannequin Try-On — Design Spec

**Date:** 2026-05-12  
**Status:** Approved  

---

## Overview

Replace the current flat-lay OOTD builder (`OutfitsView.jsx`) with an AI-powered mannequin try-on view. Users assemble an outfit from their wardrobe, hit GENERATE, and see a white matte featureless mannequin wearing the actual clothing items — rendered seamlessly via Fashn.ai's virtual try-on API.

---

## User Flow

1. User opens the Fits page (replaces current OOTD tab).
2. User selects a physique preset (SLIM / STANDARD / CURVY) — defaults to STANDARD.
3. User picks items from the rack into slots (same click/drag mechanic as today).
4. User hits **GENERATE**.
5. Fashn.ai calls chain sequentially: TOP → OUTER → BOTTOM. Each completed layer updates the mannequin display in place.
6. Final result: the mannequin wearing the full outfit.
7. User can save or share the result (same as today).
8. Changing a slot item or physique preset clears the result and requires re-generation.

---

## Layout

### Desktop (≥768px)

```
┌─────────────────────────────────────────────────────────┐
│  [ LEFT PANEL 140px ]  [ CENTER flex ]  [ RIGHT 160px ] │
│                                                          │
│  SLOTS                  ┌────────────┐   THE RACK · N   │
│  ─────                  │            │   ─────────────   │
│  TOP    [thumb] Nike     │  MANNEQUIN │   [item] [item]  │
│  BOTTOM [thumb] Levi's   │   + AI     │   [item] [item]  │
│  + OUTER (empty)         │   RESULT   │   [item] [item]  │
│  + SHOE  (empty)         │            │   [item] [item]  │
│  + HAT   (empty)         │            │                  │
│  + BAG   (empty)         └────────────┘                  │
│                          UNTITLED                        │
│  PHYSIQUE                                                │
│  [SLM] [STD▪] [CRV]                                     │
│                                                          │
│  [ GENERATE ]                                            │
│  [ SAVE ] [ SHARE ]                                      │
└─────────────────────────────────────────────────────────┘
```

### Mobile (<768px)

```
┌──────────────────────┐
│  FITS    SLM STD CRV │
├──────────────────────┤
│                      │
│   [MANNEQUIN / AI]   │
│                      │
│       UNTITLED       │
├──────────────────────┤
│ [TOP▪][BTM▪][SHOE][…]│  ← horizontal scroll
├──────────────────────┤
│ [ GENERATE ]  [ ↑ ]  │
└──────────────────────┘
```

The item rack on mobile is accessible via a collapsible panel (same toggle as current rack).

---

## Physique Presets

Three base mannequin images, AI-generated (Midjourney/DALL-E 3):
- **SLIM** — lean proportions
- **STANDARD** — average proportions  
- **CURVY** — fuller proportions

All three: white matte finish, featureless head/face, neutral standing pose, pure white background, front-facing. Stored in Supabase Storage as static assets. User preference persisted in `localStorage` keyed by user ID; defaults to STANDARD for new users.

---

## AI Generation: Fashn.ai Integration

### API

- **Endpoint:** `POST https://api.fashn.ai/v1/run`
- **Auth:** `Authorization: Bearer <FASHN_API_KEY>` (server-side only — key never exposed to client)
- **Input:** `model_image` (mannequin base URL), `garment_image` (item image URL), `category` (`upper_body` | `lower_body` | `dresses`)

### Chaining Logic

Garments are processed in this order, using the previous result as the next `model_image`:

| Step | Slot | Fashn category |
|------|------|----------------|
| 1 | TOP | `upper_body` |
| 2 | OUTER | `upper_body` |
| 3 | BOTTOM | `lower_body` |

Steps are skipped if the slot is empty. If only one garment is filled, one call is made.

**Unsupported slots** (SHOE, HAT, BAG, ACC1–4): Fashn.ai does not reliably support these garment types. They are displayed as thumbnails below the mannequin result rather than being AI-composed.

### Backend Proxy

A Supabase Edge Function (`/functions/v1/fashn-proxy/index.ts`) proxies the Fashn.ai calls to keep the API key server-side. The function:
1. Receives `{ modelImageUrl, garmentImageUrl, category }` from the client.
2. Calls Fashn.ai and polls for completion (Fashn uses async job pattern).
3. Returns the result image URL.

The client calls this function once per garment in sequence.

### Error Handling

- If a Fashn.ai call fails or times out (>30s), the chain stops and shows the partial result with an error badge on the failed slot.
- The user can retry generation from the failed slot without restarting the full chain.

---

## Generation UX

- **Progress indicator** overlaid on the mannequin: `TOP ✓ · OUTER — · BTM —` updates as each step completes.
- **In-progress state**: mannequin shows a subtle shimmer/pulse animation while waiting.
- **Partial results**: each completed layer replaces the mannequin image immediately — user sees the outfit build up layer by layer.
- **GENERATE button** disabled during generation; shows a spinner.
- **Re-generate trigger**: any slot change or physique change after a result exists clears the result and re-enables GENERATE.

---

## Data Model Changes

No new database tables required. The generated result image is:
- Displayed ephemerally in the session (not stored by default).
- Optionally uploaded to Supabase Storage `outfit-shares` bucket when the user hits **SHARE** (same flow as current `ShareModal`).

Saved fits (`saved_fits` table) continue to store the slot array as today. The mannequin result is not stored — it is regenerated on demand when loading a saved fit.

---

## Component Changes

| File | Change |
|------|--------|
| `src/components/OutfitsView.jsx` | Full rewrite — new layout, mannequin display, generation trigger |
| `src/components/MannequinDisplay.jsx` | New — renders base/result image, progress overlay, shimmer state |
| `supabase/functions/fashn-proxy/index.ts` | New — Edge Function proxying Fashn.ai |
| `.env` / Supabase secrets | Add `FASHN_API_KEY` |

`ShareModal` and saved fits logic are reused with minimal changes.

---

## Out of Scope

- Video try-on (Kling AI).
- User-uploaded custom model photos.
- Storing generated images per saved fit.
- Accessory / shoe / hat AI try-on.
- A/B testing or analytics on generation quality.
