"""
Per-source price parsers.

Each parser tries, in order:
  1. JSON-LD schema.org/Product  (most reliable, site-agnostic)
  2. Site-specific embedded JSON (Next.js __NEXT_DATA__, window.__STATE__, etc.)
  3. Site-specific HTML selector  (narrow regex, last resort)

Raises PriceExtractionError if no price can be determined.
Does NOT write to the database — callers own that.
"""

import json
import re
from dataclasses import dataclass
from typing import Callable, Dict, Optional


@dataclass
class PriceResult:
    price: float
    currency: str
    available: bool


class PriceExtractionError(Exception):
    pass


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _json_ld_price(html: str) -> Optional[tuple[float, str]]:
    """Return (price, currency) from the first schema.org/Product JSON-LD block."""
    for text in re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE,
    ):
        try:
            data = json.loads(text)
            for node in (data if isinstance(data, list) else [data]):
                if not isinstance(node, dict) or node.get("@type") != "Product":
                    continue
                offers = node.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                raw = offers.get("price") or offers.get("lowPrice")
                currency = offers.get("priceCurrency", "USD")
                if raw is not None:
                    return float(str(raw).replace(",", "").strip()), currency
        except Exception:
            pass
    return None


def _next_data(html: str) -> Optional[dict]:
    """Extract __NEXT_DATA__ JSON blob present in Next.js apps."""
    m = re.search(
        r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _coerce(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# ── Per-source parsers ─────────────────────────────────────────────────────────

def _parse_ssense(html: str) -> PriceResult:
    # 1. JSON-LD
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # 2. __NEXT_DATA__ → props.pageProps.product
    nd = _next_data(html)
    if nd:
        try:
            p = nd["props"]["pageProps"]["product"]
            price = _coerce(p.get("price") or p.get("salePrice"))
            if price:
                return PriceResult(price=price, currency=p.get("currency", "USD"), available=True)
        except (KeyError, TypeError):
            pass

    # 3. data-testid="product-price" text content
    m = re.search(
        r'data-testid=["\']product-price["\'][^>]*>[^<]*[\$€£]?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)',
        html,
    )
    if m:
        price = _coerce(m.group(1))
        if price:
            return PriceResult(price=price, currency="USD", available=True)

    raise PriceExtractionError("SSENSE: no price found")


def _parse_farfetch(html: str) -> PriceResult:
    # 1. JSON-LD
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # 2. __NEXT_DATA__ → props.pageProps.product.price.current
    nd = _next_data(html)
    if nd:
        try:
            pi = nd["props"]["pageProps"]["product"]["price"]["current"]
            price = _coerce(pi.get("value"))
            if price:
                return PriceResult(price=price, currency=pi.get("currencyCode", "USD"), available=True)
        except (KeyError, TypeError):
            pass

    # 3. Embedded: "currentPrice":{"value":NNN}
    m = re.search(r'"currentPrice"\s*:\s*\{"value"\s*:\s*([0-9.]+)', html)
    if m:
        price = _coerce(m.group(1))
        if price:
            return PriceResult(price=price, currency="USD", available=True)

    raise PriceExtractionError("Farfetch: no price found")


def _parse_mytheresa(html: str) -> PriceResult:
    # 1. JSON-LD
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # 2. window.__PRELOADED_STATE__ → pdp.product.price
    m = re.search(r'window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
    if m:
        try:
            state = json.loads(m.group(1))
            price_obj = state["pdp"]["product"]["price"]
            price = _coerce(price_obj.get("value"))
            if price:
                return PriceResult(price=price, currency=price_obj.get("currency", "EUR"), available=True)
        except Exception:
            pass

    raise PriceExtractionError("Mytheresa: no price found")


def _parse_grailed(html: str) -> PriceResult:
    # 1. JSON-LD
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # 2. __NEXT_DATA__ → props.pageProps.listing
    nd = _next_data(html)
    if nd:
        try:
            listing = nd["props"]["pageProps"]["listing"]
            price = _coerce(listing.get("price"))
            if price:
                return PriceResult(price=price, currency=listing.get("currency", "USD"), available=True)
        except (KeyError, TypeError):
            pass

    # 3. Inline: "price":NNN (Grailed embeds listing JSON in page)
    m = re.search(r'"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*[,}]', html)
    if m:
        price = _coerce(m.group(1))
        if price:
            return PriceResult(price=price, currency="USD", available=True)

    raise PriceExtractionError("Grailed: no price found")


def _parse_shopify(html: str) -> PriceResult:
    """Generic Shopify store parser — works for any retailer running Shopify.
    Shopify always injects schema.org/Product JSON-LD; no site-specific selectors needed."""
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # Shopify also embeds product JSON in window.ShopifyAnalytics or meta[property="og:price:amount"]
    m = re.search(r'"price"\s*:\s*"([0-9.]+)"', html)
    if m:
        price = _coerce(m.group(1))
        if price:
            return PriceResult(price=price, currency="USD", available=True)

    raise PriceExtractionError("Shopify: no price found in JSON-LD or embedded JSON")


def _parse_stockx(html: str) -> PriceResult:
    # StockX is heavily JS-rendered; JSON-LD is the most reliable static path.
    # 1. JSON-LD
    r = _json_ld_price(html)
    if r:
        return PriceResult(price=r[0], currency=r[1], available=True)

    # 2. __NEXT_DATA__ → deeply nested lowestAsk
    nd = _next_data(html)
    if nd:
        try:
            product = (
                nd["props"]["pageProps"]["req"]
                ["appContext"]["states"]["query"]["payload"]["product"]
            )
            price = _coerce(product["market"]["bidAskData"]["lowestAsk"])
            if price:
                return PriceResult(price=price, currency="USD", available=True)
        except (KeyError, TypeError):
            pass

    raise PriceExtractionError(
        "StockX: no price found — page may be fully JS-rendered with no static price"
    )


# ── Registry ───────────────────────────────────────────────────────────────────

_PARSERS: Dict[str, Callable[[str], PriceResult]] = {
    "ssense":      _parse_ssense,
    "farfetch":    _parse_farfetch,
    "mytheresa":   _parse_mytheresa,
    "grailed":     _parse_grailed,
    "stockx":      _parse_stockx,
    # Shopify-based retailers
    "justinreed":  _parse_shopify,
    "endclothing": _parse_shopify,
    "kith":        _parse_shopify,
    "dover":       _parse_shopify,  # Dover Street Market
    "shopify":     _parse_shopify,
}

SUPPORTED_SOURCES = sorted(_PARSERS.keys())


def _detect_parser_key(source_name: str, source_url: str) -> Optional[str]:
    key = source_name.lower().replace(" ", "").replace("-", "").replace("_", "")
    if key in _PARSERS:
        return key
    for name in _PARSERS:
        if name in source_url.lower():
            return name
    return None


def fetch_price(source_name: str, source_url: str, html: str) -> PriceResult:
    """
    Dispatch HTML to the correct per-source parser.
    Raises PriceExtractionError if the source is unsupported or parsing fails.
    Does not make any network calls — callers are responsible for fetching html.
    """
    key = _detect_parser_key(source_name, source_url)
    if key is None:
        raise PriceExtractionError(
            f"Unsupported source '{source_name}'. Supported: {', '.join(SUPPORTED_SOURCES)}"
        )
    return _PARSERS[key](html)
