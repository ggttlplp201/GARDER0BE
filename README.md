# GARDEROBE

A personal wardrobe catalogue app — upload clothing items, browse your collection, and connect with other collectors.

Live at [the-garderobe.com](https://the-garderobe.com)

---

## Features

- **Image upload** with automatic background removal running client-side via WebAssembly (`@imgly/background-removal`) — no API key or backend required
- **AI tagging** — Claude analyzes each item via a Netlify serverless function and fills in type, color, brand, and style tags
- **HEIC support** — converts iPhone photos before upload
- **Inventory view** — filterable grid with lightbox, edit, and delete
- **Explore page** — browse public collections from other users
- **Friends** — send/accept friend requests, like profiles, view friends' wardrobes
- **Dark / light theme** — toggle with persistent preference
- **Animated auth screen** — ASCII art title, 3D tilt scatter cards, door open animation on sign-in
- **Music player** — background ambient tracks with BPM/key display
- **Profile panel** — avatar crop/adjust, public profile toggle, CSV export

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8 |
| Auth & Database | Supabase (PostgreSQL + Realtime) |
| Storage | Supabase Storage |
| AI Tagging | Claude API via Netlify serverless function |
| Background Removal | `@imgly/background-removal` (client-side WASM) |
| Styling | Plain CSS with CSS custom properties (dark mode) |
| CI/CD | GitHub Actions |
| Hosting | Netlify |

## Project Structure

```
├── netlify/functions/
│   └── claude-tag.js        # Serverless proxy to Anthropic API
└── src/
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
    │   ├── ProfilePanel.jsx     # User profile drawer
    │   ├── AvatarCropModal.jsx  # Drag-to-crop avatar editor
    │   ├── ExplorePage.jsx      # Public profile discovery
    │   ├── FriendsPage.jsx      # Friends, requests, and likes
    │   ├── BrandInput.jsx       # Brand autocomplete input
    │   └── ImageUploadZone.jsx  # Drag-and-drop image upload
    ├── hooks/
    │   ├── useAuth.js           # Supabase auth state
    │   ├── useItems.js          # Fetch, add, edit, delete items
    │   ├── usePlayer.js         # Audio playback logic
    │   └── useTheme.js          # Dark/light theme toggle
    └── lib/
        ├── ascii.js             # ASCII art renderers
        ├── brands.js            # Brand autocomplete list
        ├── constants.js         # Track list, item types, storage URL
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

For AI tagging, set `CLAUDE_API_KEY` in your Netlify environment variables. The Netlify dev CLI will also pick it up locally:

```bash
netlify dev
```

## Supabase Setup

The social features require two additional tables. Run this in your Supabase SQL Editor:

```sql
create table profile_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  liked_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, liked_user_id)
);

create table friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid references auth.users(id) on delete cascade,
  to_user_id uuid references auth.users(id) on delete cascade,
  status text default 'pending',
  created_at timestamptz default now(),
  unique(from_user_id, to_user_id)
);

alter table profile_likes enable row level security;
create policy "select_likes" on profile_likes for select using (true);
create policy "insert_likes" on profile_likes for insert with check (auth.uid() = user_id);
create policy "delete_likes" on profile_likes for delete using (auth.uid() = user_id);

alter table friend_requests enable row level security;
create policy "select_requests" on friend_requests for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);
create policy "insert_requests" on friend_requests for insert with check (auth.uid() = from_user_id);
create policy "update_requests" on friend_requests for update using (auth.uid() = to_user_id or auth.uid() = from_user_id);
create policy "delete_requests" on friend_requests for delete using (auth.uid() = from_user_id or auth.uid() = to_user_id);

-- Enable realtime for like notifications
alter publication supabase_realtime add table profile_likes;
```

## CI/CD

GitHub Actions runs on every push to `main`:

- **frontend** job — ESLint + Vite build check
- Netlify auto-deploys on success

## License

MIT © Leon Meng
