from __future__ import annotations

import math
import os
from typing import Any

from flask import Flask, jsonify, render_template, request

from providers import ProviderManager, haversine_km

DEFAULT_RADIUS_KM = 5.0
MAX_RADIUS_KM = 100.0


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(degrees: float) -> str:
    points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return points[int((degrees + 22.5) // 45) % 8]


def serialize_aircraft(flight: Any, latitude: float, longitude: float) -> dict[str, Any]:
    distance = haversine_km(latitude, longitude, flight.latitude, flight.longitude)
    bearing = bearing_deg(latitude, longitude, flight.latitude, flight.longitude)
    return {"icao24": flight.icao24, "callsign": flight.callsign, "latitude": flight.latitude, "longitude": flight.longitude, "distance_km": round(distance, 2), "bearing_deg": round(bearing, 1), "bearing_cardinal": compass(bearing), "altitude_m": flight.altitude_m, "altitude_ft": round(flight.altitude_m * 3.28084) if flight.altitude_m is not None else None, "velocity_kmh": round(flight.velocity_kmh) if flight.velocity_kmh is not None else None, "heading_deg": flight.heading_deg, "vertical_rate_ms": flight.vertical_rate_ms, "squawk": flight.squawk, "registration": flight.registration, "aircraft_type": flight.aircraft_type, "aircraft_description": flight.aircraft_description, "operator": flight.operator, "origin": flight.origin, "destination": flight.destination, "source": flight.source, "position_age_seconds": flight.position_age_seconds, "freshness": flight.freshness, "quality_score": flight.quality_score}


app = Flask(__name__)
providers = ProviderManager()


@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "sources": [p.name for p in providers.providers], "default_radius_km": DEFAULT_RADIUS_KM})


@app.get("/api/flights")
def flights() -> Any:
    try:
        latitude, longitude = float(request.args["lat"]), float(request.args["lon"])
        radius_km = float(request.args.get("radius_km", DEFAULT_RADIUS_KM))
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "lat, lon and numeric radius_km are required"}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "invalid coordinates"}), 400
    if not (0.1 <= radius_km <= MAX_RADIUS_KM):
        return jsonify({"error": f"radius_km must be between 0.1 and {MAX_RADIUS_KM}"}), 400
    aircraft = [serialize_aircraft(flight, latitude, longitude) for flight in providers.get_nearby(latitude, longitude, radius_km)]
    aircraft.sort(key=lambda item: item["distance_km"])
    return jsonify({"center": {"latitude": latitude, "longitude": longitude}, "radius_km": radius_km, "count": len(aircraft), "aircraft": aircraft, "providers": providers.last_provider_status})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=True)
