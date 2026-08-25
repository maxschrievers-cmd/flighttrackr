# FlightTrackr Live

Mobile web frontend for the existing FlightTrackr project.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r web_requirements.txt
export OPENSKY_CLIENT_ID="your-client-id"
export OPENSKY_CLIENT_SECRET="your-client-secret"
python webapp.py
```

Open `http://localhost:8000`.

## Features

- Browser/iPhone geolocation
- 2, 5, 10 or 25 km monitoring radius
- OpenSky live state feed
- Exact Haversine distance filter after the OpenSky bounding-box query
- Distance, bearing, altitude, speed, heading, ICAO24 and squawk
- Automatic refresh
- Installable PWA shell

## Important

Geolocation requires HTTPS outside localhost. The current implementation is intentionally built on the existing OpenSky client in this repository. Additional feeds such as ADS-B Exchange or Airplanes.live can be added behind the same API endpoint later.
