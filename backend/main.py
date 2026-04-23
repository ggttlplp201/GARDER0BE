import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Set

import anthropic
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="GARDEROBE API")

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://the-garderobe.com,http://localhost:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
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
