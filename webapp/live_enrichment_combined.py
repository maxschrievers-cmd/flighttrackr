from __future__ import annotations

import asyncio

from .providers import enrich_live_aircraft as base_enrich
from .pyopensky_enrichment import route_for_callsign


async def enrich_live_aircraft(**kwargs):
    base, route = await asyncio.gather(base_enrich(**kwargs), route_for_callsign(kwargs.get("callsign")))
    result = dict(base or {})
    for key in ("origin", "destination", "route", "airline", "operator"):
        if route.get(key):
            result[key] = route[key]
    if route.get("route"):
        source = result.get("metadata_source")
        result["metadata_source"] = f"{source}+pyopensky" if source else "pyopensky"
    return result
