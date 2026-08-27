# FlightTrackr on Cloudflare

## Architecture

- Cloudflare Workers + Workers Static Assets serve the web app.
- `/api/*` is proxied at the edge to the existing FlightTrackr backend.
- The backend remains responsible for OpenSky, Airplanes.live and ADS-B/route enrichment.
- Cloudflare Access protects the Worker before the application executes.

## Deploy

From the repository root:

```bash
npm install
npx wrangler whoami
npx wrangler check
npx wrangler deploy
```

Wrangler deploys the Worker and the `webapp/static` directory as one unit.

## Cloudflare Access login

In Cloudflare Dashboard:

1. Open Workers & Pages and select `flighttrackr-live`.
2. Open **Access** and choose **Protect this Worker**.
3. Enable Cloudflare Zero Trust when prompted.
4. Create an Access policy for the desired users. For a private personal app, use an Allow policy restricted to your email address.
5. Optional: attach a custom domain to the Worker and protect the hostname with Access as well.

Access checks authorization before the Worker executes. The application itself therefore does not need to store passwords.

## Secrets

Do not put OpenSky, VAPID, or commercial provider secrets in `wrangler.jsonc`, source files, or browser code. Keep them in the existing backend service or configure them as Cloudflare secrets only when a Worker feature actually requires them.

## Live backend

The Worker is currently configured to proxy API calls to:

`https://flighttrackr-live-fixed.onrender.com`

Change `ORIGIN_BASE_URL` in `wrangler.jsonc` only when the backend has moved.
