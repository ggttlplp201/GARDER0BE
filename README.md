# GARDEROBE

A personal wardrobe catalogue app — upload clothing items, auto-tag them with AI, and browse your collection.

Live at [the-garderobe.com](https://the-garderobe.com)

---

## Features

- **Image upload** with automatic background removal (remove.bg API)
- **AI tagging** — Claude analyzes each item and fills in type, color, brand, and style tags
- **HEIC support** — converts iPhone photos before upload
- **Inventory view** — filterable grid with lightbox, edit, and delete
- **Animated auth screen** — ASCII art title, 3D tilt scatter cards, door open animation on sign-in
- **Music player** — background ambient tracks with BPM/key display
- **Profile panel** — persistent local profile with avatar

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8 |
| Auth & Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage |
| AI Tagging | Claude API (via Supabase Edge Function) |
| Background Removal | remove.bg API |
| Styling | Plain CSS |
| CI/CD | GitHub Actions |
| Hosting | Netlify |

## Project Structure

```
src/
├── components/
│   ├── AuthScreen.jsx       # Login/signup with door animation
│   ├── AsciiTitle.jsx       # Animated 3D ASCII title renderer
│   ├── ScatterCards.jsx     # Tilt-effect clothing cards on auth screen
│   ├── Inventory.jsx        # Main wardrobe grid + filters
│   ├── ItemCard.jsx         # Individual item card
│   ├── AddItemModal.jsx     # Upload + AI tag flow
│   ├── EditItemModal.jsx    # Edit item fields
│   ├── Lightbox.jsx         # Full-screen image viewer
│   ├── MusicPlayer.jsx      # Ambient music player
│   └── ProfilePanel.jsx     # User profile drawer
├── hooks/
│   ├── useAuth.js           # Supabase auth state
│   ├── useItems.js          # Fetch, add, edit, delete items
│   └── usePlayer.js         # Audio playback logic
└── lib/
    ├── ascii.js             # ASCII art renderers (title + scatter frames)
    ├── constants.js         # API keys, track list, item types
    ├── imageUtils.js        # HEIC conversion, bg removal, Claude tagging
    └── supabase.js          # Supabase client
```

## Getting Started

```bash
npm install
npm run dev
```

Requires a `.env.local` with:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## CI/CD

GitHub Actions runs on every push to `main`:

- **CI** — lint and build check
- **Deploy** — auto-deploys to Netlify on success

## License

© Leon Meng. All rights reserved.
