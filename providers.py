from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from typing import Any

import requests

from opensky_client import OpenSkyClient

EARTH_RADIUS_KM = 6371.0088
FRESH_POSITION_SECONDS = 15
AGING_POSITION_SECONDS = 60


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


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
        if age <= FRESH_POSITION_SECONDS:
            return "fresh"
        if age <= AGING_POSITION_SECONDS:
            return "aging"
        return "stale"

    def quality_tuple(self, now: float | None = None) -> tuple:
        age = self.age_seconds(now)
        freshness = max(0.0, 100.0 - age * 5.0)
        completeness = sum(value is not None for value in (
            self.callsign, self.altitude_m, self.velocity_kmh, self.heading_deg,
            self.vertical_rate_ms, self.squawk, self.registration, self.aircraft_type,
        ))
        source_rank = {"airplanes.live": 2, "opensky": 1}.get(self.source, 0)
        return (freshness, completeness, source_rank)

    @property
    def quality_score(self) -> int:
        freshness, completeness, _ = self.quality_tuple()
        return min(100, round(freshness * 0.75 + completeness / 8 * 25))


class AirplanesLiveProvider:
    name = "airplanes.live"

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        radius_nm = max(1, min(250, math.ceil(radius_km / 1.852)))
        base_url = os.getenv("AIRPLANES_LIVE_API_BASE", "https://api.adsb.one")
        response = requests.get(f"{base_url}/v2/point/{latitude}/{longitude}/{radius_nm}", timeout=8)
        response.raise_for_status()
        now = time.time()
        aircraft: list[ProviderAircraft] = []
        for item in response.json().get("ac", []):
            lat, lon = item.get("lat"), item.get("lon")
            if lat is None or lon is None or haversine_km(latitude, longitude, lat, lon) > radius_km:
                continue
            alt_ft = item.get("alt_baro")
            seen_pos = item.get("seen_pos")
            position_timestamp = now - float(seen_pos) if isinstance(seen_pos, (int, float)) and seen_pos >= 0 else None
            aircraft.append(ProviderAircraft(
                icao24=item.get("hex"), callsign=(item.get("flight") or "").strip() or None,
                latitude=lat, longitude=lon,
                altitude_m=float(alt_ft) * 0.3048 if isinstance(alt_ft, (int, float)) else None,
                velocity_kmh=float(item["gs"]) * 1.852 if isinstance(item.get("gs"), (int, float)) else None,
                heading_deg=item.get("track"),
                vertical_rate_ms=float(item["baro_rate"]) * 0.00508 if isinstance(item.get("baro_rate"), (int, float)) else None,
                squawk=item.get("squawk"), source=self.name,
                registration=item.get("r"), aircraft_type=item.get("t"), aircraft_description=item.get("desc"),
                operator=item.get("own"), origin=item.get("orig"), destination=item.get("dest"),
                position_timestamp=position_timestamp, received_at=now,
            ))
        return aircraft


class OpenSkyProvider:
    name = "opensky"

    def __init__(self) -> None:
        self.client = OpenSkyClient(
            client_id=os.getenv("OPENSKY_CLIENT_ID", ""), client_secret=os.getenv("OPENSKY_CLIENT_SECRET", ""),
            min_request_interval_seconds=int(os.getenv("OPENSKY_MIN_REQUEST_INTERVAL", "10")),
            request_timeout_seconds=int(os.getenv("OPENSKY_REQUEST_TIMEOUT", "10")),
        )

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        radius_miles = max(1, math.ceil(radius_km / 1.609344))
        result: list[ProviderAircraft] = []
        for flight in self.client.get_nearby_flights(latitude, longitude, radius_miles):
            if flight.latitude is None or flight.longitude is None or haversine_km(latitude, longitude, flight.latitude, flight.longitude) > radius_km:
                continue
            result.append(ProviderAircraft(
                icao24=flight.icao24, callsign=flight.callsign, latitude=flight.latitude, longitude=flight.longitude,
                altitude_m=flight.altitude_m, velocity_kmh=flight.velocity_ms * 3.6 if flight.velocity_ms is not None else None,
                heading_deg=flight.heading_deg, vertical_rate_ms=flight.vertical_rate_ms, squawk=flight.squawk,
                source=self.name, position_timestamp=getattr(flight, "time_position", None),
                last_contact_timestamp=getattr(flight, "last_contact", None),
            ))
        return result


class ProviderManager:
    def __init__(self) -> None:
        self.providers = [AirplanesLiveProvider(), OpenSkyProvider()]

    def get_nearby(self, latitude: float, longitude: float, radius_km: float) -> list[ProviderAircraft]:
        candidates: dict[str, list[ProviderAircraft]] = {}
        for provider in self.providers:
            try:
                for aircraft in provider.get_nearby(latitude, longitude, radius_km):
                    key = (aircraft.icao24 or f"{aircraft.callsign}:{aircraft.latitude:.4f}:{aircraft.longitude:.4f}").lower()
                    candidates.setdefault(key, []).append(aircraft)
            except requests.RequestException:
                continue
            except Exception:
                continue
        now = time.time()
        selected: list[ProviderAircraft] = []
        for aircraft_group in candidates.values():
            fresh = [aircraft for aircraft in aircraft_group if aircraft.age_seconds(now) <= FRESH_POSITION_SECONDS]
            pool = fresh or aircraft_group
            selected.append(max(pool, key=lambda aircraft: aircraft.quality_tuple(now)))
        return selected
