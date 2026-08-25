# FlightTrackr

Open-source, free, privacy-first digital flight pass and personal aviation journal.

## Included in v1

- personal flight journal
- interactive world map and routes
- Excel/CSV/JSON import
- intelligent column mapping
- duplicate detection
- flight editor and filtering
- digital boarding-pass style ticket view
- flight-pass print/PDF workflow
- CSV/XLSX/JSON export
- travel grouping
- local ticket/boarding-pass scanner
- browser-side OCR and barcode support
- PWA/offline shell
- local-first persistence
- no mandatory paid API

## Privacy
The public repository intentionally contains only sanitized demo data. Personal flight history must not be committed to the public repository. The private build flow can load your own `data/private-seed.json` locally and the app can import the original Excel file directly.

## Deployment on Render
The repository is ready for a free Render web service using the included `server.py`. Render's current free web services can spin down when idle. Avoid relying on a free Render Postgres database for long-term personal storage because Render's free Postgres instances expire after 30 days. The core FlightTrackr design is therefore local-first.

## Local run
Any Python 3 installation can serve the app:

```bash
python server.py
```

Then open `http://localhost:8080` or the port provided through `PORT`.

## License
MIT
