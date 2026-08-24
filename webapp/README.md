# FlightTrackr Web

FlightTrackr is a free, open-source, privacy-first flight logbook and live aircraft tracker.

## Current capabilities

- personal flight log with create/edit/delete
- **Excel `.xlsx` / `.xls` and CSV import directly in the browser**
- JSON backup import/export and XLSX export
- automatic duplicate detection during import and manual entry
- searchable, filterable history by year
- route map / personal passport map
- dashboard, annual, airline, airport and aircraft statistics
- cabin, seat, booking reference, travel reason, notes, distance and duration fields
- nearby-aircraft live map using ADSB.lol through a small server-side proxy
- browser geolocation only after explicit user action
- local-first storage: personal flight history is not persisted on the server
- security headers, CSP, rate limiting, bounded provider queries, no accounts, no analytics

The spreadsheet importer recognizes common column names including `Date`, `Datum`, `Flight Number`, `Flugnummer`, `Airline`, `From`, `Origin`, `Von`, `To`, `Destination`, `Nach`, `Aircraft`, `Type`, `Departure`, `Arrival`, `Distance`, `Duration`, `Cabin`, `Seat`, `PNR`, `Booking Ref`, and `Notes`. Unrecognized rows are skipped and reported.

### Recommended FlightTrackr Excel schema

| Column | Example |
|---|---|
| Date | 2026-08-24 |
| Flight Number | OS123 |
| Airline | Austrian |
| From | VIE |
| To | FRA |
| Aircraft | A320-214 |
| Departure | 2026-08-24 08:10 |
| Arrival | 2026-08-24 09:35 |
| Distance km | 600 |
| Duration min | 85 |
| Cabin | Economy |
| Seat | 12A |
| Reason | Leisure |
| Booking Ref | ABC123 |
| Notes | Window seat |

## Flighty-like feature parity

Flighty currently advertises live flight tracking, personal flight history, Passport/map, annual/all-time stats, flight history import, manual edits, notes, export, calendar/TripIt/email import, delay alerts, delay predictions, gate/tail information and sharing. citeturn967488search0turn967488search3

FlightTrackr's free/open-source architecture covers the product-independent parts first and avoids copying Flighty's proprietary branding or data. Some advanced features need data providers that are not safely or legally available as a free public service. Those are planned as optional provider adapters instead of hard-coding a commercial dependency.

## Why Excel import is local

The selected spreadsheet is parsed in the browser with SheetJS. No spreadsheet contents are uploaded to the FlightTrackr server. The current SheetJS browser release is 0.20.3, and its official documentation recommends vendoring the script for stronger operational stability. citeturn713997search0

For the next hardening step, the SheetJS bundle should therefore be vendored into `webapp/static/vendor/` and referenced locally rather than loaded from the CDN.

## Data provider

The default live endpoint uses ADSB.lol. Its API is intended for open ADS-B data and its published data/API use ODbL. Production deployments should respect the provider's current usage policy and attribution requirements. citeturn629016search0turn629016search1

OpenSky is not used as the default public live endpoint because OpenSky currently states that operational REST API use in an application or product requires a written agreement. citeturn243445search0

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r webapp/requirements.txt
uvicorn webapp.app:app --reload --port 8000
```

Open `http://127.0.0.1:8000`.

## Security

See `SECURITY.md`. Never commit credentials. The uploaded development credentials are not embedded in the app source; keep all provider secrets in local ignored files or the hosting platform's secret store.
