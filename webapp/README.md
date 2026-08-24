# FlightTrackr Web

FlightTrackr is a free, open-source, privacy-first flight journal with a live nearby-aircraft view.

## Principles

- **Local-first:** your personal flight log is stored in browser `localStorage`; the server does not receive or persist it.
- **No accounts:** the MVP does not require registration, passwords, cookies, or user profiling.
- **No analytics:** no tracking pixels, ad network, session replay, or telemetry service is included.
- **Secrets stay server-side:** provider credentials, when needed for a self-hosted provider, must be environment variables and never frontend code.
- **Live data:** aircraft positions are fetched server-side from ADSB.lol. Its public API is free and the published data/API use ODbL. Production applications should follow the provider's current usage guidance. citeturn629016search0turn629016search1
- **No OpenSky in the public default path:** OpenSky currently requires a written agreement for operational use of its REST API in a live product. citeturn243445search0

## Run locally

```bash
cd webapp
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Open `http://127.0.0.1:8000`.

## Deployment

The root `render.yaml` defines a free Render web service. It has no secrets configured by default. A deployment can run entirely on the ADSB.lol public API.

## Data protection

The app only asks for browser geolocation after the user presses **Standort**. The coordinates are sent to `/api/nearby` solely to request nearby aircraft and are not written to a database. The browser remembers the last location locally so the user does not have to re-select it on every refresh.

Flight records are intentionally kept local. The Export feature creates a user-controlled JSON backup; the Import feature reads it back into local storage.

## Security

The backend applies:

- strict Content Security Policy
- frame and MIME sniffing protection
- restrictive referrer policy
- Permissions Policy
- same-origin resource policy
- in-process rate limiting for the live endpoint
- bounded provider query radius and request timeout
- validation of ICAO hex inputs
- no debug endpoints in production

See `SECURITY.md` for vulnerability reporting and secret-handling rules.

## Roadmap

The architecture is intentionally prepared for later additions such as email-based flight import, airline/frequent-flyer enrichment, route and mileage statistics, PWA installation, push notifications, and optional encrypted sync. Any sync feature should remain opt-in and encrypted rather than silently centralising a user's travel history.
