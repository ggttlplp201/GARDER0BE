"""
Garderobe — wishlist price refresh script
Run manually or via cron every 12 hours.

Usage:
    python3 scripts/refresh_wishlist_prices.py

Required env vars (same as backend):
    SUPABASE_URL          — your Supabase project URL
    SUPABASE_SERVICE_KEY  — service-role key (bypasses RLS)

Optional:
    BATCH_SIZE            — sources per batch (default: 10)
    API_URL               — if set, delegates to the backend's /wishlist/refresh-all
                            endpoint instead of scraping directly. Useful when the
                            backend is already running on Railway.

Cron example (every 12 hours):
    0 */12 * * * cd /path/to/garderobe && python3 scripts/refresh_wishlist_prices.py >> logs/price_refresh.log 2>&1
"""

import os, sys, time, logging, json, re
from datetime import datetime, timezone

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("price-refresh")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
API_URL      = os.environ.get("API_URL", "").rstrip("/")
BATCH_SIZE   = int(os.environ.get("BATCH_SIZE", "10"))

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Price extraction (mirrors backend price_parsers.py) ──────────────────────

PRICE_PATTERNS = [
    r'"price"\s*:\s*"?([\d,]+(?:\.\d{1,2})?)"?',
    r'"offers".*?"price"\s*:\s*"?([\d,]+(?:\.\d{1,2})?)"?',
    r'itemprop=["\']price["\'][^>]*content=["\']([0-9.,]+)["\']',
    r'<meta[^>]+property=["\']product:price:amount["\'][^>]*content=["\']([0-9.,]+)["\']',
    r'\$\s*([\d,]+(?:\.\d{2})?)',
    r'USD\s*([\d,]+(?:\.\d{2})?)',
]

def _extract_price(html: str) -> float | None:
    for pattern in PRICE_PATTERNS:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if m:
            raw = m.group(1).replace(",", "")
            try:
                v = float(raw)
                if 1.0 < v < 100_000:
                    return round(v, 2)
            except ValueError:
                continue
    return None

# ── Supabase helpers ─────────────────────────────────────────────────────────

def _sb_get(path: str, client: httpx.Client) -> list:
    resp = client.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=SB_HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()

def _sb_post(path: str, body: dict, client: httpx.Client) -> None:
    resp = client.post(f"{SUPABASE_URL}/rest/v1/{path}", headers=SB_HEADERS, json=body, timeout=10)
    if not resp.is_success:
        log.warning("Supabase POST %s failed: %s", path, resp.text[:200])

def _sb_patch(path: str, body: dict, client: httpx.Client) -> None:
    resp = client.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers=SB_HEADERS, json=body, timeout=10)
    if not resp.is_success:
        log.warning("Supabase PATCH %s failed: %s", path, resp.text[:200])

# ── Delegate to backend API ──────────────────────────────────────────────────

def refresh_via_api() -> dict:
    log.info("Delegating to backend API: %s/wishlist/refresh-all", API_URL)
    resp = httpx.post(f"{API_URL}/wishlist/refresh-all", timeout=120)
    resp.raise_for_status()
    result = resp.json()
    log.info("API result: %s", result)
    return result

# ── Direct refresh ───────────────────────────────────────────────────────────

def refresh_direct() -> dict:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with httpx.Client() as db:
        sources = _sb_get(
            "wishlist_price_sources?is_active=eq.true"
            "&select=id,item_id,source_name,source_url,currency",
            db,
        )

    log.info("Found %d active price sources to refresh", len(sources))
    if not sources:
        return {"refreshed": 0, "errors": 0}

    refreshed, errors, failures = 0, 0, []

    with httpx.Client(headers=SCRAPE_HEADERS, follow_redirects=True, timeout=20) as scraper:
        with httpx.Client() as db:
            # Process in batches to avoid hammering sites
            for batch_start in range(0, len(sources), BATCH_SIZE):
                batch = sources[batch_start : batch_start + BATCH_SIZE]
                for src in batch:
                    sid = src["id"]
                    try:
                        resp = scraper.get(src["source_url"])
                        if not resp.is_success:
                            log.warning("HTTP %d for source %s (%s)", resp.status_code, sid, src["source_name"])
                            errors += 1
                            failures.append({"id": sid, "reason": f"HTTP {resp.status_code}"})
                            continue

                        price = _extract_price(resp.text)
                        if price is None:
                            log.info("No price found for source %s (%s)", sid, src["source_name"])
                            errors += 1
                            failures.append({"id": sid, "reason": "price not found in page"})
                            continue

                        # Write history row
                        _sb_post("wishlist_price_history", {
                            "source_id": sid,
                            "item_id": src["item_id"],
                            "observed_price": price,
                            "currency": src.get("currency", "USD"),
                            "observed_at": now_iso,
                        }, db)

                        # Update source latest price
                        _sb_patch(f"wishlist_price_sources?id=eq.{sid}", {
                            "last_price": price,
                            "last_seen_at": now_iso,
                            "updated_at": now_iso,
                        }, db)

                        refreshed += 1
                        log.info("OK  $%.2f  %s / %s", price, src["source_name"], src["source_url"][:60])

                    except Exception as exc:
                        log.warning("Error on source %s: %s", sid, exc)
                        errors += 1
                        failures.append({"id": sid, "reason": str(exc)[:120]})

                # Small delay between batches to be polite
                if batch_start + BATCH_SIZE < len(sources):
                    time.sleep(1.5)

    log.info("Refresh complete: %d ok, %d errors", refreshed, errors)
    if failures:
        log.info("Failed sources:\n%s", json.dumps(failures, indent=2))

    return {"refreshed": refreshed, "errors": errors, "failures": failures}

# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    start = time.time()
    if API_URL:
        result = refresh_via_api()
    else:
        result = refresh_direct()
    elapsed = round(time.time() - start, 1)
    log.info("Done in %.1fs — refreshed=%d errors=%d", elapsed, result.get("refreshed", 0), result.get("errors", 0))
