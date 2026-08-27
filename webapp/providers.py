"""Flight status and metadata providers.

OpenSky is used for live aircraft state; route/operator enrichment combines
OpenSky flight records with open ADS-B metadata. Commercial status providers
remain optional and server-side only.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass
class FlightStatus:
    provider: str
    flight_number: str
    status: str | None = None
    departure_airport: str | None = None
    arrival_airport: str | None = None
    scheduled_departure: str | None = None
    estimated_departure: str | None = None
    actual_departure: str | None = None
    scheduled_arrival: str | None = None
    estimated_arrival: str | None = None
    actual_arrival: str | None = None
    departure_gate: str | None = None
    arrival_gate: str | None = None
    terminal: str | None = None
    aircraft: str | None = None
    registration: str | None = None
    airline: str | None = None
    route: str | None = None

    def as_dict(self) -> dict:
        return self.__dict__.copy()


class Provider(Protocol):
    name: str

    async def lookup(self, flight_number: str, date: str | None) -> FlightStatus | None: ...


class AviationStackProvider:
    name = "aviationstack"

    def __init__(self, access_key: str):
        self.access_key = access_key

    async def lookup(self, flight_number: str, date: str | None) -> FlightStatus | None:
        params = {"access_key": self.access_key, "flight_iata": flight_number}
        if date:
            params["flight_date"] = date
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get("https://api.aviationstack.com/v1/flights", params=params)
            response.raise_for_status()
            payload = response.json()
        records = payload.get("data") or []
        if not records:
            return None
        item = records[0]
        dep, arr, flight, aircraft, airline = (
            item.get("departure") or {}, item.get("arrival") or {}, item.get("flight") or {},
            item.get("aircraft") or {}, item.get("airline") or {},
        )
        dep_code, arr_code = dep.get("iata"), arr.get("iata")
        return FlightStatus(
            provider=self.name,
            flight_number=(flight.get("iata") or flight_number).upper(),
            status=item.get("flight_status"),
            departure_airport=dep_code,
            arrival_airport=arr_code,
            scheduled_departure=dep.get("scheduled"),
            estimated_departure=dep.get("estimated"),
            actual_departure=dep.get("actual"),
            scheduled_arrival=arr.get("scheduled"),
            estimated_arrival=arr.get("estimated"),
            actual_arrival=arr.get("actual"),
            departure_gate=dep.get("gate"),
            arrival_gate=arr.get("gate"),
            terminal=dep.get("terminal"),
            aircraft=aircraft.get("iata") or aircraft.get("icao"),
            registration=aircraft.get("registration"),
            airline=airline.get("name") or airline.get("iata"),
            route=f"{dep_code} → {arr_code}" if dep_code and arr_code else None,
        )


async def _opensky_flight_records(icao24: str | None, begin: int | None = None, end: int | None = None) -> list[dict]:
    if not icao24:
        return []
    begin = begin or int(time.time()) - 6 * 3600
    end = end or int(time.time())
    url = "https://opensky-network.org/api/flights/aircraft"
    params = {"icao24": icao24.lower(), "begin": begin, "end": end}
    headers = {}
    client_id = os.getenv("OPENSKY_CLIENT_ID", "").strip()
    client_secret = os.getenv("OPENSKY_CLIENT_SECRET", "").strip()
    if client_id and client_secret:
        try:
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
                token_response = await client.post(
                    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
                    data={"client_id": client_id, "client_secret": client_secret, "grant_type": "client_credentials"},
                )
                if token_response.is_success:
                    token = token_response.json().get("access_token")
                    if token:
                        headers["Authorization"] = f"Bearer {token}"
        except (httpx.HTTPError, ValueError):
            pass
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
        return payload if isinstance(payload, list) else []
    except (httpx.HTTPError, ValueError):
        return []


def _clean_callsign(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"\s+", "", value).upper()
    return value or None


def _callsign_variants(callsign: str | None) -> list[str]:
    cs = _clean_callsign(callsign)
    if not cs:
        return []
    variants = [cs]
    # ADS-B feeds sometimes use ICAO airline designators plus numeric flight no.
    # Keep only conservative variants; never infer an airline from arbitrary text.
    m = re.match(r"^([A-Z0-9]{2,4})([0-9]{1,4}[A-Z]?)$", cs)
    if m:
        variants.append(f"{m.group(1)}{m.group(2)}")
    return list(dict.fromkeys(variants))


async def enrich_live_aircraft(
    *, icao24: str | None, callsign: str | None, registration: str | None = None,
    base_operator: str | None = None, base_aircraft_type: str | None = None,
    base_description: str | None = None,
) -> dict[str, str | None]:
    result = {
        "airline": base_operator,
        "operator": base_operator,
        "registration": registration,
        "aircraft_type": base_aircraft_type,
        "aircraft_description": base_description,
        "origin": None,
        "destination": None,
        "route": None,
        "metadata_source": None,
    }

    # Open ADS-B metadata is strongest for registration/operator/type.
    if icao24:
        try:
            async with httpx.AsyncClient(timeout=(2.0, 4.0), follow_redirects=True) as client:
                response = await client.get(
                    f"https://api.adsb.lol/v2/hex/{icao24.lower()}",
                    headers={"Accept": "application/json", "User-Agent": "FlightTrackr/1.0"},
                )
                response.raise_for_status()
                item = (response.json().get("ac") or [{}])[0]
            result["registration"] = result["registration"] or item.get("r")
            result["airline"] = result["airline"] or item.get("own") or item.get("owner")
            result["operator"] = result["operator"] or item.get("own") or item.get("owner")
            result["aircraft_type"] = result["aircraft_type"] or item.get("t")
            result["aircraft_description"] = result["aircraft_description"] or item.get("desc")
            result["origin"] = item.get("orig") or None
            result["destination"] = item.get("dest") or None
            result["route"] = f"{result['origin']} → {result['destination']}" if result["origin"] and result["destination"] else None
            if any(result[k] for k in ("airline", "registration", "origin", "destination")):
                result["metadata_source"] = "adsb.lol"
        except (httpx.HTTPError, ValueError, IndexError, TypeError):
            pass

    # ADSB.lol has a callsign endpoint that may expose live route metadata.
    for variant in _callsign_variants(callsign):
        try:
            async with httpx.AsyncClient(timeout=(2.0, 4.0), follow_redirects=True) as client:
                response = await client.get(
                    f"https://api.adsb.lol/v2/callsign/{variant}",
                    headers={"Accept": "application/json", "User-Agent": "FlightTrackr/1.0"},
                )
                if not response.is_success:
                    continue
                items = response.json().get("ac") or []
            if items:
                item = items[0]
                result["registration"] = result["registration"] or item.get("r")
                result["airline"] = result["airline"] or item.get("own") or item.get("owner")
                result["operator"] = result["operator"] or item.get("own") or item.get("owner")
                result["aircraft_type"] = result["aircraft_type"] or item.get("t")
                result["aircraft_description"] = result["aircraft_description"] or item.get("desc")
                result["origin"] = result["origin"] or item.get("orig")
                result["destination"] = result["destination"] or item.get("dest")
                result["route"] = result["route"] or (f"{result['origin']} → {result['destination']}" if result["origin"] and result["destination"] else None)
                result["metadata_source"] = result["metadata_source"] or "adsb.lol"
                break
        except (httpx.HTTPError, ValueError, IndexError, TypeError):
            continue

    # OpenSky flight history fills route when live ADS-B metadata has no orig/dest.
    if not result["origin"] or not result["destination"]:
        records = await _opensky_flight_records(icao24)
        candidates = [
            r for r in records
            if r.get("estDepartureAirport") or r.get("estArrivalAirport")
        ]
        if candidates:
            candidates.sort(key=lambda r: (r.get("lastSeen") or 0, r.get("firstSeen") or 0), reverse=True)
            latest = candidates[0]
            result["origin"] = result["origin"] or latest.get("estDepartureAirport")
            result["destination"] = result["destination"] or latest.get("estArrivalAirport")
            result["route"] = f"{result['origin']} → {result['destination']}" if result["origin"] and result["destination"] else result["route"]
            result["metadata_source"] = result["metadata_source"] or "opensky"

    return result


def configured_providers() -> list[Provider]:
    providers: list[Provider] = []
    key = os.getenv("AVIATIONSTACK_ACCESS_KEY", "").strip()
    if key:
        providers.append(AviationStackProvider(key))
    return providers


async def lookup_flight(flight_number: str, date: str | None) -> FlightStatus | None:
    for provider in configured_providers():
        try:
            result = await provider.lookup(flight_number, date)
            if result:
                return result
        except (httpx.HTTPError, ValueError, KeyError):
            continue
    return None


def provider_status() -> dict:
    names = [provider.name for provider in configured_providers()]
    return {
        "configured": names,
        "live_aircraft": ["opensky", "adsb.lol"],
        "metadata": ["adsb.lol", "opensky"],
        "flight_status_available": bool(names),
        "byo_provider_supported": True,
    }
