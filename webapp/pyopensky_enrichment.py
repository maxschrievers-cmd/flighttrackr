from __future__ import annotations

import asyncio
import re
from typing import Any


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


async def route_for_callsign(callsign: str | None) -> dict[str, str | None]:
    """Resolve a live callsign to OpenSky route data via pyopensky.

    pyopensky exposes REST.routes(callsign), which is specifically intended for
    callsign-to-route resolution. The synchronous SDK call is moved off the
    FastAPI event loop.
    """
    if not callsign:
        return {}
    clean = re.sub(r"\s+", "", callsign).upper()
    try:
        from pyopensky.rest import REST
        rest = REST()
        rows = await asyncio.to_thread(rest.routes, callsign=clean)
        if rows is None:
            return {}
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
        return {
            "origin": origin,
            "destination": destination,
            "airline": airline,
            "operator": airline,
            "route": f"{origin} → {destination}" if origin and destination else None,
            "source": "opensky-pyopensky",
        }
    except Exception:
        return {}
