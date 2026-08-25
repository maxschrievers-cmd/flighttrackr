"""Pluggable flight-data providers.

No provider secret is exposed to the browser. Optional commercial/free-tier
providers are enabled only through environment variables on the server.
"""
from __future__ import annotations

import os
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
        dep, arr, flight, aircraft = item.get("departure") or {}, item.get("arrival") or {}, item.get("flight") or {}, item.get("aircraft") or {}
        return FlightStatus(
            provider=self.name,
            flight_number=(flight.get("iata") or flight_number).upper(),
            status=item.get("flight_status"),
            departure_airport=dep.get("iata"),
            arrival_airport=arr.get("iata"),
            scheduled_departure=dep.get("scheduled"),
            estimated_departure=dep.get("estimated"),
            actual_departure=dep.get("actual"),
            scheduled_arrival=arr.get("scheduled"),
            estimated_arrival=arr.get("estimated"),
            actual_arrival=arr.get("actual"),
            departure_gate=dep.get("gate"),
            arrival_gate=arr.get("gate"),
            terminal=dep.get("terminal"),
            aircraft=aircraft.get("iata"),
            registration=aircraft.get("registration"),
        )


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
        "live_aircraft": "adsb.lol",
        "flight_status_available": bool(names),
        "byo_provider_supported": True,
    }
