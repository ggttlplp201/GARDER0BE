import base64
import json
import logging
import os
import re

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
    allow_methods=["POST"],
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


def sniff_mime(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def validate_upload(file: UploadFile, allowed: set[str]) -> bytes:
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
