"""Inbound authentication for the Spring-to-Python boundary.

Constant-time comparison, header-only: a key in a query string would land in access logs.
"""
from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request


async def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    settings = request.app.state.settings
    expected: str = settings.ai_service_api_key

    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "UNAUTHENTICATED",
                "message": "A valid X-API-Key header is required for this internal endpoint.",
            },
        )
