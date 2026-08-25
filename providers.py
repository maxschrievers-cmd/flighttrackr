from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field, replace
from typing import Any

import requests

from opensky_client import OpenSkyClient

EARTH_RADIUS_KM = 6371.0088
FRESH_POSITION_SECONDS = 15
AGING_POSITION_SECONDS = 60
OPERATOR_CACHE_TTL_SECONDS = 86400
ROUTE_CACHE_TTL_SECONDS = 300
ROUTE_LOOKBACK_SECONDS = 6 * 3600


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _clean_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip().upper()
    return value or None


def _parse_route(value: Any) -> tuple[str | None, str | None]:
    if not isinstance(value, str):
        return None, None
    text = value.strip().upper()
    for separator in ("→", "->", " TO ", " – ", "-"):
        if separator in text:
            left, right = [part.strip() for part in text.split(separator, 1)]
            if len(left) >= 3 and len(right) >= 3:
                return left, right
    return None, None


@dataclass(frozen=True)
class ProviderAircraft:
    icao24: str | None
    callsign: str | None
    latitude: float
    longitude: float
    altitude_m: float | None
    velocity_kmh: float | None
    heading_deg: float | None
    vertical_rate_ms: float | None
    squawk: str | None
    source: str
    registration: str | None = None
    aircraft_type: str | None = None
    aircraft_description: str | None = None
    operator: str | None = None
    origin: str | None = None
    destination: str | None = None
    position_timestamp: float | None = None
    last_contact_timestamp: float | None = None
    received_at: float = field(default_factory=time.time)

    def age_seconds(self, now: float | None = None) -> float:
        reference = self.position_timestamp or self.last_contact_timestamp or self.received_at
        return max(0.0, (now or time.time()) - reference)

    @property
    def position_age_seconds(self) -> int:
        return round(self.age_seconds())

    @property
    def freshness(self) -> str:
        age = self.age_seconds()
        return "fresh" if age <= FRESH_POSITION_SECONDS else "aging" if age <= AGING_POSITION_SECONDS else "stale"

    def quality_tuple(self, now: float | None = None) -> tuple:
        age = self.age_seconds(now)
        freshness = max(0.0, 100.0 - age * 5.0)
        completeness = sum(value is not None for value in (
            self.callsign, self.altitude_m, self.velocity_kmh, self.heading_deg,
            self.vertical_rate_ms, self.squawk, self.registration, self.aircraft_type,
            self.operator, self.origin, self.destination,
        ))
        source_rank = {"airplanes.live": 3, "adsb.lol": 2, "opensky": 1}.get(self.source, 0)
        return (freshness, completeness, source_rank)

    @property
    def quality_score(self) -> int:
        freshness, completeness, _ = self.quality_tuple()
        return min(100, round(freshness * 0.7 + completeness / 11 * 30))


class CompatiblePointProvider:
    def __init__(self, name: str, base_url: str) -> None:
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.last_error: str | None = None

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        radius_nm = max(1, min(250, math.ceil(radius_km / 1.852)))
        url = f"{self.base_url}/v2/point/{latitude:.6f}/{longitude:.6f}/{radius_nm}"
        try:
            response = requests.get(url, timeout=(3, 8), headers={"User-Agent": "FlightTrackr/1.4", "Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
            self.last_error = None
        except (requests.RequestException, ValueError) as exc:
            self.last_error = str(exc)
            return []
        now = time.time()
        result: list[ProviderAircraft] = []
        for item in payload.get("ac", []):
            lat, lon = item.get("lat"), item.get("lon")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            if haversine_km(latitude, longitude, float(lat), float(lon)) > radius_km:
                continue
            alt_ft = item.get("alt_baro")
            seen_pos = item.get("seen_pos")
            position_timestamp = now - float(seen_pos) if isinstance(seen_pos, (int, float)) and seen_pos >= 0 else None
            origin = _clean_code(item.get("orig"))
            destination = _clean_code(item.get("dest"))
            if not origin or not destination:
                route_origin, route_destination = _parse_route(item.get("route"))
                origin = origin or route_origin
                destination = destination or route_destination
            result.append(ProviderAircraft(
                icao24=_clean_code(item.get("hex")), callsign=(item.get("flight") or "").strip() or None,
                latitude=float(lat), longitude=float(lon),
                altitude_m=float(alt_ft) * 0.3048 if isinstance(alt_ft, (int, float)) else None,
                velocity_kmh=float(item["gs"]) * 1.852 if isinstance(item.get("gs"), (int, float)) else None,
                heading_deg=item.get("track"), vertical_rate_ms=float(item["baro_rate"]) * 0.00508 if isinstance(item.get("baro_rate"), (int, float)) else None,
                squawk=item.get("squawk"), source=self.name, registration=_clean_code(item.get("r")),
                aircraft_type=_clean_code(item.get("t")), aircraft_description=item.get("desc"),
                operator=item.get("own") or item.get("owner"), origin=origin, destination=destination,
                position_timestamp=position_timestamp, received_at=now,
            ))
        return result


class OpenSkyProvider:
    name = "opensky"

    def __init__(self) -> None:
        self.client = OpenSkyClient(
            client_id=os.getenv("OPENSKY_CLIENT_ID", ""),
            client_secret=os.getenv("OPENSKY_CLIENT_SECRET", ""),
            min_request_interval_seconds=int(os.getenv("OPENSKY_MIN_REQUEST_INTERVAL", "10")),
            auth_timeout_seconds=3,
            request_timeout_seconds=5,
        )

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        result: list[ProviderAircraft] = []
        for flight in self.client.get_nearby_flights(latitude, longitude, max(1, math.ceil(radius_km / 1.609344))):
            if flight.latitude is None or flight.longitude is None or haversine_km(latitude, longitude, flight.latitude, flight.longitude) > radius_km:
                continue
            result.append(ProviderAircraft(
                icao24=_clean_code(flight.icao24), callsign=flight.callsign, latitude=flight.latitude, longitude=flight.longitude,
                altitude_m=flight.altitude_m, velocity_kmh=flight.velocity_ms * 3.6 if flight.velocity_ms is not None else None,
                heading_deg=flight.heading_deg, vertical_rate_ms=flight.vertical_rate_ms, squawk=flight.squawk,
                source=self.name, position_timestamp=getattr(flight, "time_position", None),
                last_contact_timestamp=getattr(flight, "last_contact", None),
            ))
        return result


class MetadataResolver:
    def __init__(self, opensky_client: OpenSkyClient) -> None:
        self.session = requests.Session()
        self.opensky_client = opensky_client
        self.metadata_cache: dict[str, tuple[float, dict[str, str | None]]] = {}
        self.route_cache: dict[str, tuple[float, dict[str, str | None]]] = {}

    def _lookup_adsb_details(self, flight: ProviderAircraft) -> dict[str, str | None]:
        if not flight.icao24:
            return {}
        key = flight.icao24.lower()
        cached = self.metadata_cache.get(key)
        if cached and time.time() - cached[0] < OPERATOR_CACHE_TTL_SECONDS:
            return cached[1]
        result = {"operator": None, "registration": None, "aircraft_type": None, "aircraft_description": None}
        for base_url in ("https://api.airplanes.live", "https://api.adsb.lol"):
            try:
                response = self.session.get(
                    f"{base_url}/v2/hex/{key}",
                    timeout=(2, 4),
                    headers={"User-Agent": "FlightTrackr/1.4", "Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
                aircraft = (payload.get("ac") or [{}])[0]
                result.update({
                    "operator": result["operator"] or aircraft.get("own") or aircraft.get("owner"),
                    "registration": result["registration"] or _clean_code(aircraft.get("r")),
                    "aircraft_type": result["aircraft_type"] or _clean_code(aircraft.get("t")),
                    "aircraft_description": result["aircraft_description"] or aircraft.get("desc"),
                })
            except (requests.RequestException, ValueError, IndexError, TypeError):
                continue
            if result["registration"] and result["operator"]:
                break
        self.metadata_cache[key] = (time.time(), result)
        return result

    def _lookup_adsb_route(self, callsign: str | None) -> dict[str, str | None]:
        if not callsign:
            return {}
        key = callsign.replace(" ", "").upper()
        cached = self.route_cache.get(key)
        if cached and time.time() - cached[0] < ROUTE_CACHE_TTL_SECONDS:
            return cached[1]
        result = {"origin": None, "destination": None}
        try:
            response = self.session.get(
                f"https://api.adsb.lol/v2/callsign/{key}",
                timeout=(2, 4),
                headers={"User-Agent": "FlightTrackr/1.4", "Accept": "application/json"},
            )
            response.raise_for_status()
            aircraft = (response.json().get("ac") or [{}])[0]
            result["origin"] = _clean_code(aircraft.get("orig"))
            result["destination"] = _clean_code(aircraft.get("dest"))
            if not result["origin"] or not result["destination"]:
                route_origin, route_destination = _parse_route(aircraft.get("route"))
                result["origin"] = result["origin"] or route_origin
                result["destination"] = result["destination"] or route_destination
        except (requests.RequestException, ValueError, IndexError, TypeError):
            pass
        self.route_cache[key] = (time.time(), result)
        return result

    def _lookup_opensky_route(self, icao24: str | None) -> dict[str, str | None]:
        if not icao24:
            return {}
        key = icao24.lower()
        cached = self.route_cache.get(f"os:{key}")
        if cached and time.time() - cached[0] < ROUTE_CACHE_TTL_SECONDS:
            return cached[1]
        token = self.opensky_client.get_access_token()
        if not token:
            return {}
        end = int(time.time())
        begin = end - ROUTE_LOOKBACK_SECONDS
        result = {"origin": None, "destination": None}
        try:
            response = self.session.get(
                "https://opensky-network.org/api/flights/aircraft",
                params={"icao24": key, "begin": begin, "end": end},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                timeout=(2, 5),
            )
            response.raise_for_status()
            flights = response.json() or []
            for item in reversed(flights):
                origin = _clean_code(item.get("estDepartureAirport"))
                destination = _clean_code(item.get("estArrivalAirport"))
                if origin or destination:
                    result = {"origin": origin, "destination": destination}
                    break
        except (requests.RequestException, ValueError, TypeError):
            pass
        self.route_cache[f"os:{key}"] = (time.time(), result)
        return result

    def enrich(self, flight: ProviderAircraft) -> ProviderAircraft:
        metadata = self._lookup_adsb_details(flight)
        best = replace(
            flight,
            operator=flight.operator or metadata.get("operator"),
            registration=flight.registration or metadata.get("registration"),
            aircraft_type=flight.aircraft_type or metadata.get("aircraft_type"),
            aircraft_description=flight.aircraft_description or metadata.get("aircraft_description"),
        )
        if not best.origin or not best.destination:
            route = self._lookup_adsb_route(best.callsign)
            if not best.origin:
                best = replace(best, origin=route.get("origin"))
            if not best.destination:
                best = replace(best, destination=route.get("destination"))
        if not best.origin or not best.destination:
            route = self._lookup_opensky_route(best.icao24)
            if not best.origin:
                best = replace(best, origin=route.get("origin"))
            if not best.destination:
                best = replace(best, destination=route.get("destination"))
        return best


class ProviderManager:
    def __init__(self) -> None:
        self.providers = [
            CompatiblePointProvider("airplanes.live", os.getenv("AIRPLANES_LIVE_API_BASE", "https://api.airplanes.live")),
            CompatiblePointProvider("adsb.lol", os.getenv("ADSB_LOL_API_BASE", "https://api.adsb.lol")),
            OpenSkyProvider(),
        ]
        self.opensky_client = next(p.client for p in self.providers if isinstance(p, OpenSkyProvider))
        self.metadata_resolver = MetadataResolver(self.opensky_client)
        self.last_provider_status: dict[str, Any] = {}

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        candidates: dict[str, list[ProviderAircraft]] = {}
        status: dict[str, Any] = {}
        for provider in self.providers:
            try:
                aircraft = provider.get_nearby(latitude, longitude, radius_km)
                status[provider.name] = {"count": len(aircraft), "error": getattr(provider, "last_error", None)}
                for item in aircraft:
                    key = (item.icao24 or f"{item.callsign}:{item.latitude:.4f}:{item.longitude:.4f}").lower()
                    candidates.setdefault(key, []).append(item)
            except Exception as exc:
                status[getattr(provider, "name", provider.__class__.__name__)] = {"count": 0, "error": str(exc)}
        self.last_provider_status = status
        now = time.time()
        selected: list[ProviderAircraft] = []
        for group in candidates.values():
            fresh = [item for item in group if item.age_seconds(now) <= FRESH_POSITION_SECONDS]
            best = max(fresh or group, key=lambda item: item.quality_tuple(now))
            best = self.metadata_resolver.enrich(best)
            selected.append(best)
        return selected
