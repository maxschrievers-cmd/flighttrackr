from __future__ import annotations

import math
import os
from typing import Any

from flask import Flask, jsonify, render_template, request

from opensky_client import OpenSkyClient


EARTH_RADIUS_KM = 6371.0088
DEFAULT_RADIUS_KM = 5.0
MAX_RADIUS_KM = 100.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(degrees: float) -> str:
    points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return points[int((degrees + 22.5) // 45) % 8]


def create_client() -> OpenSkyClient:
    return OpenSkyClient(
        client_id=os.getenv("OPENSKY_CLIENT_ID", ""),
        client_secret=os.getenv("OPENSKY_CLIENT_SECRET", ""),
        min_request_interval_seconds=int(os.getenv("OPENSKY_MIN_REQUEST_INTERVAL", "10")),
        request_timeout_seconds=int(os.getenv("OPENSKY_REQUEST_TIMEOUT", "10")),
    )


app = Flask(__name__)
client = create_client()


@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "source": "OpenSky", "default_radius_km": DEFAULT_RADIUS_KM})


@app.get("/api/flights")
def flights() -> Any:
    try:
        latitude = float(request.args["lat"])
        longitude = float(request.args["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "lat and lon are required"}), 400

    try:
        radius_km = float(request.args.get("radius_km", DEFAULT_RADIUS_KM))
    except ValueError:
        return jsonify({"error": "radius_km must be numeric"}), 400

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "invalid coordinates"}), 400
    if not (0.1 <= radius_km <= MAX_RADIUS_KM):
        return jsonify({"error": f"radius_km must be between 0.1 and {MAX_RADIUS_KM}"}), 400

    # OpenSky queries a bounding box. Exact radius filtering is applied below.
    radius_miles = max(1, math.ceil(radius_km / 1.609344))
    nearby = client.get_nearby_flights(latitude, longitude, radius_miles)

    aircraft: list[dict[str, Any]] = []
    for flight in nearby:
        if flight.latitude is None or flight.longitude is None:
            continue
        distance = haversine_km(latitude, longitude, flight.latitude, flight.longitude)
        if distance > radius_km:
            continue
        bearing = bearing_deg(latitude, longitude, flight.latitude, flight.longitude)
        aircraft.append(
            {
                "icao24": flight.icao24,
                "callsign": flight.callsign,
                "latitude": flight.latitude,
                "longitude": flight.longitude,
                "distance_km": round(distance, 2),
                "bearing_deg": round(bearing, 1),
                "bearing_cardinal": compass(bearing),
                "altitude_m": flight.altitude_m,
                "altitude_ft": round(flight.altitude_m * 3.28084) if flight.altitude_m is not None else None,
                "velocity_ms": flight.velocity_ms,
                "velocity_kmh": round(flight.velocity_ms * 3.6) if flight.velocity_ms is not None else None,
                "heading_deg": flight.heading_deg,
                "vertical_rate_ms": flight.vertical_rate_ms,
                "squawk": flight.squawk,
            }
        )

    aircraft.sort(key=lambda item: item["distance_km"])
    return jsonify({
        "center": {"latitude": latitude, "longitude": longitude},
        "radius_km": radius_km,
        "count": len(aircraft),
        "aircraft": aircraft,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=True)
