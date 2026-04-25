import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Set

import anthropic
import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from price_parsers import PriceExtractionError, fetch_price

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://the-garderobe.com,http://localhost:5173",
).split(",")

SUPABASE_URL          = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "")
PRICE_REFRESH_INTERVAL = int(os.environ.get("PRICE_REFRESH_INTERVAL_SECONDS", str(6 * 60 * 60)))


# ── Background price-refresh loop ─────────────────────────────────────────────

async def _price_refresh_loop():
    await asyncio.sleep(60)  # short delay after startup
    while True:
        try:
            await _refresh_sources()
        except Exception as exc:
            logger.error("Scheduled price refresh failed: %s", exc)
        await asyncio.sleep(PRICE_REFRESH_INTERVAL)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_price_refresh_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="GARDEROBE API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

REMOVE_BG_API_KEY = os.environ.get("REMOVE_BG_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
TAG_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}  # no GIF for vision tagging
MAGIC_BYTES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
    b"RIFF": "image/webp",  # checked further below
}


# ── Feed ingestion ────────────────────────────────────────────────────────────

FEEDS = [
    {"name": "HYPEBEAST",    "url": "https://hypebeast.com/feed"},
    {"name": "HIGHSNOBIETY", "url": "https://www.highsnobiety.com/feed/"},
    {"name": "HYPEBAE",      "url": "https://hypebae.com/feed"},
    {"name": "SNEAKER NEWS", "url": "https://sneakernews.com/feed/"},
    {"name": "COMPLEX",      "url": "https://www.complex.com/style.xml"},
    {"name": "VOGUE",        "url": "https://www.vogue.com/feed/rss"},
    {"name": "GQ",           "url": "https://www.gq.com/feed/rss"},
]

FEED_CACHE: dict = {"ts": 0.0, "articles": []}
FEED_CACHE_TTL = 30 * 60  # seconds

_MEDIA_NS  = "http://search.yahoo.com/mrss/"
_CONTENT_NS = "http://purl.org/rss/1.0/modules/content/"
_DC_NS      = "http://purl.org/dc/elements/1.1/"


def _strip_html(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", "", html)
    text = re.sub(r"&(?:amp|lt|gt|quot|apos|nbsp);", lambda m: {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " "}[m.group()], text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_desc(text: str, max_len: int = 200) -> str:
    text = re.sub(r"^\?si=\S*\s*(Summary\s*)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^Summary\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(Name|SKU|MSRP|Colorway|Release\s+Date|Where\s+to\s+Buy)\s*:.+", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()[:max_len]


def _first_img(html: str) -> Optional[str]:
    if not html:
        return None
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE)
    return m.group(1) if m else None


def _stable_id(url: str, title: str) -> str:
    return hashlib.md5((url or title or "").encode()).hexdigest()[:16]


def _el_text(item: ET.Element, tag: str, ns: Optional[str] = None) -> str:
    el = item.find(f"{{{ns}}}{tag}" if ns else tag)
    return (el.text or "").strip() if el is not None else ""


def _parse_rss(text: str, source_name: str) -> List[Dict]:
    # Escape bare ampersands that would break XML parsing
    text = re.sub(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", text)
    try:
        root = ET.fromstring(text.encode("utf-8", errors="replace"))
    except ET.ParseError:
        logger.warning("XML parse failed for %s", source_name)
        return []

    result = []
    for item in root.findall(".//item")[:8]:
        title    = _el_text(item, "title")
        link     = _el_text(item, "link")
        desc     = _el_text(item, "description")
        content_el = item.find(f"{{{_CONTENT_NS}}}encoded")
        content  = (content_el.text or "") if content_el is not None else ""
        pub_date = _el_text(item, "pubDate") or _el_text(item, "date", _DC_NS)
        guid     = _el_text(item, "guid") or link

        enc      = item.find("enclosure")
        enc_url  = enc.get("url") if enc is not None else None
        mc       = item.find(f"{{{_MEDIA_NS}}}content")
        media_url = mc.get("url") if mc is not None else None
        if not media_url:
            mt = item.find(f"{{{_MEDIA_NS}}}thumbnail")
            media_url = mt.get("url") if mt is not None else None

        image    = enc_url or media_url or _first_img(content) or _first_img(desc)
        desc_clean = _clean_desc(_strip_html(desc or content))

        if not title and not link:
            continue
        result.append({
            "id": _stable_id(guid, title),
            "source": source_name,
            "title": title,
            "desc": desc_clean,
            "image": image,
            "link": link,
            "date": pub_date,
        })
    return result


def _parse_json_feed(data: dict, source_name: str) -> List[Dict]:
    result = []
    for item in (data.get("items") or [])[:8]:
        result.append({
            "id":     _stable_id(item.get("url", ""), item.get("title", "")),
            "source": source_name,
            "title":  item.get("title", ""),
            "desc":   _clean_desc(_strip_html(item.get("summary", "") or item.get("content_html", ""))),
            "image":  item.get("image") or item.get("banner_image"),
            "link":   item.get("url", ""),
            "date":   item.get("date_published", ""),
        })
    return result


async def _fetch_one(client: httpx.AsyncClient, feed: dict) -> List[Dict]:
    try:
        resp = await client.get(feed["url"], timeout=12, follow_redirects=True)
        if not resp.is_success:
            logger.warning("Feed %s HTTP %d", feed["name"], resp.status_code)
            return []
        text = resp.text.strip()
        if text.startswith("{"):
            return _parse_json_feed(resp.json(), feed["name"])
        if "<item" in text:
            return _parse_rss(text, feed["name"])
        logger.warning("Feed %s: unrecognized format", feed["name"])
    except Exception as exc:
        logger.warning("Feed %s failed: %s", feed["name"], exc)
    return []


@app.get("/feed/articles")
async def get_feed_articles():
    global FEED_CACHE
    now = time.time()
    if now - FEED_CACHE["ts"] < FEED_CACHE_TTL and FEED_CACHE["articles"]:
        return {"articles": FEED_CACHE["articles"], "cached": True}

    headers = {"User-Agent": "Mozilla/5.0 (compatible; GARDEROBE/1.0; +https://the-garderobe.com)"}
    async with httpx.AsyncClient(headers=headers) as client:
        results = await asyncio.gather(
            *[_fetch_one(client, feed) for feed in FEEDS],
            return_exceptions=True,
        )

    articles: List[Dict] = []
    seen: Set[str] = set()
    ok = 0
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.warning("Feed gather error %s: %s", FEEDS[i]["name"], result)
            continue
        for article in result:
            if article["id"] not in seen and article.get("title"):
                seen.add(article["id"])
                articles.append(article)
        if result:
            ok += 1

    if not articles:
        raise HTTPException(status_code=503, detail="All feed sources failed")

    logger.info("Feed refreshed: %d articles from %d/%d sources", len(articles), ok, len(FEEDS))
    FEED_CACHE = {"ts": now, "articles": articles}
    return {"articles": articles, "cached": False}


# ── Image utilities ───────────────────────────────────────────────────────────

def sniff_mime(data: bytes) -> Optional[str]:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def validate_upload(file: UploadFile, allowed: Set[str]) -> bytes:
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail="Unsupported file type")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    real_mime = sniff_mime(data)
    if real_mime is None or real_mime not in allowed:
        raise HTTPException(status_code=415, detail="File content does not match a supported image type")
    return data


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/remove-bg")
async def remove_background(file: UploadFile = File(...)):
    if not REMOVE_BG_API_KEY:
        raise HTTPException(status_code=503, detail="REMOVE_BG_API_KEY not configured")

    data = await validate_upload(file, ALLOWED_MIME)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            headers={"X-Api-Key": REMOVE_BG_API_KEY},
            files={"image_file": (file.filename, data, file.content_type)},
            data={"size": "auto"},
        )

    if not resp.is_success:
        logger.error("remove.bg failed status=%d", resp.status_code)
        raise HTTPException(status_code=502, detail="Background removal failed")

    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/png"),
    )


@app.post("/tag")
async def tag_item(file: UploadFile = File(...)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    data = await validate_upload(file, TAG_ALLOWED_MIME)
    media_type = sniff_mime(data) or "image/jpeg"
    b64 = base64.standard_b64encode(data).decode()

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    try:
        message = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": b64},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Identify this clothing item. Reply with only a JSON object: "
                                '{"name": "item name", "brand": "brand or unknown", '
                                '"color": "primary color", "type": "one of: Shirt/T-Shirt/'
                                'Sweatshirt/Jeans/Jacket/Coat/Trousers/Shorts/Footwear/Accessories/Other"}'
                            ),
                        },
                    ],
                }
            ],
        )
    except anthropic.APIError as exc:
        logger.error("Anthropic API error type=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="AI tagging service unavailable")

    ITEM_TYPES = {
        "Shirt", "T-Shirt", "Sweatshirt", "Jeans", "Jacket",
        "Coat", "Trousers", "Shorts", "Footwear", "Accessories", "Other",
    }

    raw = message.content[0].text.strip()
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        raise HTTPException(status_code=422, detail="Could not parse item tags")

    try:
        tags = json.loads(match.group(0))
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Could not parse item tags")

    if not isinstance(tags, dict):
        raise HTTPException(status_code=422, detail="Could not parse item tags")

    if tags.get("type") not in ITEM_TYPES:
        tags["type"] = "Other"

    return tags


# ── Price tracking ────────────────────────────────────────────────────────────

_SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class SourceCreate(BaseModel):
    source_name: str
    source_url: str
    currency: str = "USD"


def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _user_sb_headers(token: str) -> dict:
    """Supabase headers using the caller's JWT — RLS is enforced."""
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _bearer_token(authorization: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")


def _jwt_sub(token: str) -> Optional[str]:
    """Extract the 'sub' claim (user UUID) without verifying the signature.
    Supabase PostgREST verifies the JWT; we only read the claim to include user_id in inserts."""
    try:
        segment = token.split(".")[1]
        segment += "=" * (4 - len(segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(segment))
        return payload.get("sub")
    except Exception:
        return None


async def _refresh_sources(item_id: Optional[str] = None) -> dict:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        logger.warning("Price refresh skipped: SUPABASE_URL or SUPABASE_SERVICE_KEY not configured")
        return {"refreshed": 0, "errors": 0, "skipped": True}

    sb_rest = f"{SUPABASE_URL}/rest/v1"
    qs = "is_active=eq.true&select=id,item_id,source_name,source_url,currency"
    if item_id:
        qs += f"&item_id=eq.{item_id}"

    async with httpx.AsyncClient(timeout=15) as db:
        resp = await db.get(f"{sb_rest}/wishlist_price_sources?{qs}", headers=_sb_headers())

    if not resp.is_success:
        logger.error("Failed to fetch price sources: %s", resp.text)
        return {"refreshed": 0, "errors": 1}

    sources = resp.json()
    if not sources:
        return {"refreshed": 0, "errors": 0}

    refreshed = 0
    errors = 0
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    async with httpx.AsyncClient(timeout=20, headers=_SCRAPE_HEADERS, follow_redirects=True) as scraper:
        async with httpx.AsyncClient(timeout=15) as db:
            for source in sources:
                sid = source["id"]
                try:
                    page = await scraper.get(source["source_url"])
                    if not page.is_success:
                        logger.warning("Scrape HTTP %d for source %s", page.status_code, sid)
                        errors += 1
                        continue

                    result = fetch_price(source["source_name"], source["source_url"], page.text)

                    await db.post(
                        f"{sb_rest}/wishlist_price_history",
                        headers=_sb_headers(),
                        json={
                            "source_id": sid,
                            "item_id": source["item_id"],
                            "observed_price": result.price,
                            "currency": result.currency,
                            "observed_at": now_iso,
                        },
                    )
                    await db.patch(
                        f"{sb_rest}/wishlist_price_sources?id=eq.{sid}",
                        headers=_sb_headers(),
                        json={"last_price": result.price, "last_seen_at": now_iso, "updated_at": now_iso},
                    )

                    refreshed += 1
                    logger.info("Priced %.2f %s source=%s", result.price, result.currency, sid)

                except PriceExtractionError as exc:
                    logger.info("No price for source %s: %s", sid, exc)
                    errors += 1
                except Exception as exc:
                    logger.warning("Error on source %s: %s", sid, exc)
                    errors += 1

    logger.info("Price refresh complete: %d ok, %d errors", refreshed, errors)
    return {"refreshed": refreshed, "errors": errors}


# ── Wishlist price endpoints ───────────────────────────────────────────────────

@app.get("/wishlist/{item_id}/prices")
async def get_item_prices(
    item_id: str,
    authorization: Optional[str] = Header(None),
):
    token = _bearer_token(authorization)
    select = (
        "id,source_name,source_url,currency,last_price,last_seen_at,is_active,created_at,"
        "wishlist_price_history(observed_price,currency,observed_at)"
    )
    qs = (
        f"item_id=eq.{item_id}&is_active=eq.true&select={select}"
        "&wishlist_price_history.order=observed_at.desc"
        "&wishlist_price_history.limit=12"
    )
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/wishlist_price_sources?{qs}",
            headers=_user_sb_headers(token),
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail="Failed to fetch price data")
    return {"sources": resp.json()}


@app.post("/wishlist/{item_id}/sources", status_code=201)
async def add_price_source(
    item_id: str,
    body: SourceCreate,
    authorization: Optional[str] = Header(None),
):
    token = _bearer_token(authorization)
    user_id = _jwt_sub(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not determine user from token")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/wishlist_price_sources",
            headers={**_user_sb_headers(token), "Prefer": "return=representation"},
            json={
                "item_id": item_id,
                "user_id": user_id,
                "source_name": body.source_name,
                "source_url": body.source_url,
                "currency": body.currency,
            },
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to create source: {resp.text}")
    rows = resp.json()
    return rows[0] if rows else {}


@app.delete("/wishlist/sources/{source_id}", status_code=204)
async def delete_price_source(
    source_id: str,
    authorization: Optional[str] = Header(None),
):
    token = _bearer_token(authorization)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/wishlist_price_sources?id=eq.{source_id}",
            headers=_user_sb_headers(token),
            json={"is_active": False, "updated_at": now_iso},
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail="Failed to deactivate source")
    return Response(status_code=204)


@app.post("/wishlist/sources/{source_id}/refresh")
async def refresh_one_source(source_id: str):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    sb_rest = f"{SUPABASE_URL}/rest/v1"
    async with httpx.AsyncClient(timeout=10) as db:
        resp = await db.get(
            f"{sb_rest}/wishlist_price_sources"
            f"?id=eq.{source_id}&select=id,item_id,source_name,source_url,currency,is_active",
            headers=_sb_headers(),
        )
    if not resp.is_success or not resp.json():
        raise HTTPException(status_code=404, detail="Source not found")

    source = resp.json()[0]
    if not source.get("is_active"):
        raise HTTPException(status_code=400, detail="Source is inactive")

    try:
        async with httpx.AsyncClient(
            timeout=20, headers=_SCRAPE_HEADERS, follow_redirects=True
        ) as scraper:
            page = await scraper.get(source["source_url"])
        if not page.is_success:
            raise PriceExtractionError(f"HTTP {page.status_code} fetching source URL")
        result = fetch_price(source["source_name"], source["source_url"], page.text)
    except PriceExtractionError as exc:
        logger.warning("Price extraction failed source=%s: %s", source_id, exc)
        raise HTTPException(status_code=422, detail=str(exc))

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    async with httpx.AsyncClient(timeout=10) as db:
        await db.post(
            f"{sb_rest}/wishlist_price_history",
            headers=_sb_headers(),
            json={
                "source_id": source_id,
                "item_id": source["item_id"],
                "observed_price": result.price,
                "currency": result.currency,
                "observed_at": now_iso,
            },
        )
        await db.patch(
            f"{sb_rest}/wishlist_price_sources?id=eq.{source_id}",
            headers=_sb_headers(),
            json={"last_price": result.price, "last_seen_at": now_iso, "updated_at": now_iso},
        )

    logger.info("Manual refresh: %.2f %s source=%s", result.price, result.currency, source_id)
    return {"price": result.price, "currency": result.currency, "available": result.available}


@app.post("/wishlist/refresh-all")
async def refresh_all_prices():
    return await _refresh_sources()
