import base64
import json
import os
import re

import anthropic
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

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

VALID_MEDIA_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/remove-bg")
async def remove_background(file: UploadFile = File(...)):
    if not REMOVE_BG_API_KEY:
        raise HTTPException(status_code=503, detail="REMOVE_BG_API_KEY not configured")

    data = await file.read()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            headers={"X-Api-Key": REMOVE_BG_API_KEY},
            files={"image_file": (file.filename, data, file.content_type)},
            data={"size": "auto"},
        )

    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail="remove.bg request failed")

    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/png"),
    )


@app.post("/tag")
async def tag_item(file: UploadFile = File(...)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    data = await file.read()
    media_type = file.content_type if file.content_type in VALID_MEDIA_TYPES else "image/jpeg"
    b64 = base64.standard_b64encode(data).decode()

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
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

    raw = message.content[0].text.strip()
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        raise HTTPException(status_code=500, detail="No JSON in Claude response")

    return json.loads(match.group(0))
