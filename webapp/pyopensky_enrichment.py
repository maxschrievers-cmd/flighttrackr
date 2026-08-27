from __future__ import annotations

import asyncio
import re
import time
from typing import Any

_CACHE: dict[str, tuple[float, dict[str, str | None]]] = {}
_TTL = 120
_LOCK = asyncio.Lock()


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _sync_route(callsign: str) -> dict[str, str | None]:
    try:
        from pyopensky.rest import REST
        rows = REST().routes(callsign=callsign)
        if hasattr(rows, "to_dict"):
            records = rows.to_dict("records")
        elif isinstance(rows, list):
            records = rows
        else:
            records = []
        if not records:
            return {}
        item = records[0]
        origin = _clean(item.get("estdepartureairport") or item.get("departure_airport") or item.get("origin"))
        destination = _clean(item.get("estarrivalairport") or item.get("arrival_airport") or item.get("destination"))
        airline = _clean(item.get("airline") or item.get("operator"))
        return {"origin": origin, "destination": destination, "airline": airline, "operator": airline, "route": f"{origin} → {destination}" if origin and destination else None, "source": "opensky-pyopensky"}
    except Exception:
        return {}


async def route_for_callsign(callsign: str | None) -> dict[str, str | None]:
    if not callsign:
        return {}
    clean = re.sub(r"\s+", "", callsign).upper()
    async with _LOCK:
        cached = _CACHE.get(clean)
        if cached and time.monotonic() - cached[0] < _TTL:
            return cached[1].copy()
    value = await asyncio.to_thread(_sync_route, clean)
    async with _LOCK:
        _CACHE[clean] = (time.monotonic(), value.copy())
    return value
