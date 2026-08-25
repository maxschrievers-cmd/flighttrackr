# Security

## Data model
FlightTrackr is local-first by design. Historical flight data, ticket images, PNRs and notes are stored in the browser's local storage unless the user explicitly exports them.

## Secrets
Never commit API keys, credentials, PNRs, tickets or personal datasets to GitHub. Use environment variables or a private deployment for any optional backend integrations.

## Scanner privacy
Ticket scanning uses browser-side barcode detection and OCR. The app does not upload the image to a FlightTrackr server.

## Reporting
Please report security issues privately to the repository owner rather than opening a public issue when the issue contains exploitable details.
