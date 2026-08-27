"""Route enrichment using the maintained pyopensky REST client.

pyopensky exposes REST.routes(callsign), which is preferable to guessing a
route from an airline code. Calls are executed off the event loop and cached
briefly because the live radar can contain many aircraft.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

_CACHE: dict[str, tuple[float, dict[str, str | None]]] = {}
_TTL = 120


def _first_value(obj: Any, *names: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        for n in names:
            if obj.get(n) not in (None, ""):
                return obj[n]
        return None
    for n in names:
        try:
            value = getattr(obj, n, None)
        except Exception:
            value = None
        if value not in (None, ""):
            return value
    return None


def _sync_lookup(callsign: str) -> dict[str, str | None]:
    try:
        from pyopensky.rest import REST
        rest = REST()
        result = rest.routes(callsign=callsign)
        rows = result if isinstance(result, list) else getattr(result, "to_dict", lambda: result)()
        if isinstance(rows, dict):
            rows = [rows]
        if not rows:
            return {"origin": None, "destination": None, "route": None, "source": "pyopensky"}
        row = rows[0]
        origin = _first_value(row, "departure", "origin", "estDepartureAirport", "departure_airport")
        destination = _first_value(row, "arrival", "destination", "estArrivalAirport", "arrival_airport")
        if isinstance(origin, dict):
            origin = _first_value(origin, "icao", "iata", "airport", "name")
        if isinstance(destination, dict):
            destination = _first_value(destination, "icao", "iata", "airport", "name")
        return {
            "origin": str(origin).upper() if origin else None,
            "destination": str(destination).upper() if destination else None,
            "route": f"{str(origin).upper()} → {str(destination).upper()}" if origin and destination else None,
            "source": "pyopensky",
        }
    except Exception:
        return {"origin": None, "destination": None, "route": None, "source": "pyopensky"}


async def lookup_route(callsign: str | None) -> dict[str, str | None]:
    clean = "".join((callsign or "").split()).upper()
    if not clean:
        return {}
    cached = _CACHE.get(clean)
    if cached and time.monotonic() - cached[0] < _TTL:
        return cached[1].copy()
    value = await asyncio.to_thread(_sync_lookup, clean)
    _CACHE[clean] = (time.monotonic(), value.copy())
    return value
