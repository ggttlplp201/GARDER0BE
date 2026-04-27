# Fun project

Try on both mobile and desktop devices

Live at [the-garderobe.com](https://the-garderobe.com)

---

## What is this?

GARDEROBE is a personal wardrobe manager — think of it as a living archive for your clothes. You can catalog everything you own, track what you paid, log when you wore something, build outfits, and keep a wishlist with live price tracking. There's also a social layer: you can add friends, explore other people's wardrobes, and see who's liked your profile on a 3D globe.

Built mostly as a passion project, but it's fully functional and running in production.

---

## Tech stack

**Frontend**
- React (Vite) — component-based UI, fast dev server
- CSS custom properties for theming (dark/light mode)
- D3-geo + Canvas for the interactive 3D globe in Explore
- `@imgly/background-removal` — in-browser ML model that removes photo backgrounds client-side, no server needed
- `heic2any` for converting iPhone HEIC photos on the fly

**Backend**
- Supabase — auth, Postgres database, realtime subscriptions, and image storage
- FastAPI (Python) on Railway — handles price scraping and background refresh jobs
- Vercel serverless functions — Claude AI tagging endpoint (`/api/tag`)

**AI**
- Claude (via Anthropic API) — auto-tags uploaded clothing items with name, brand, color, and type from a photo
- Falls back from Railway → Vercel automatically if one endpoint is unavailable

---

## Features

**Wardrobe**
- Add items with photos (supports HEIC, JPEG, PNG)
- AI auto-tagging: upload a photo and Claude fills in the details
- One-click background removal on item photos
- Grid and list views, filterable by type, color, brand
- Full item detail view with wear logging and condition tracking

**OOTD builder**
- Drag-and-drop outfit builder with a visual mannequin layout
- HAT → TOP → BOTTOM → SHOE slots with smart compatibility filtering
- Accessories and bag slots on the side
- Save, load, and shuffle fits from your wardrobe

**Timeline**
- Chronological view of acquisitions
- See what you bought month by month with spend per period

**Wishlist**
- Track items you want with live price monitoring
- Sources are scraped automatically (Grailed, SSENSE, etc.) and refreshed every 6 hours
- Price delta tracking so you know if something went up or down

**Explore**
- Interactive 3D globe showing where other users are from
- Browse public wardrobes, like profiles, send friend requests
- Realtime notifications for likes and friend requests

**Friends**
- Friend system with accept/decline requests
- View friends' full wardrobes and stats

---

## Infrastructure

| Layer | Service |
|---|---|
| Frontend hosting | Vercel |
| Database + Auth + Storage | Supabase |
| Price scraping API | Railway (FastAPI) |
| AI tagging fallback | Vercel serverless |
| Domain | the-garderobe.com |
