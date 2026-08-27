# VAB 5 Monitor – Cloudflare iPhone PWA

Eigene iPhone-PWA für VAB 5 zwischen Wien Praterstern und Flughafen Wien.

## Live-Ziel

Der Worker ist bewusst als eigene Anwendung getrennt von der bestehenden Flugpass-App konfiguriert:

- Worker: `vab5-monitor`
- erwartete workers.dev-URL im bestehenden Account: `https://vab5-monitor.max-flugpass-schrievers.workers.dev`
- bestehender Worker `max-flugpass-schrievers` bleibt unangetastet

Die tatsächliche URL wird von Cloudflare vergeben und setzt voraus, dass die `workers.dev`-Subdomain im Account aktiviert ist.

## Architektur

- Cloudflare Workers: API + Monitoring + Cron
- Workers Static Assets: PWA
- Cloudflare D1: Benutzer, Einstellungen, Push-Abos, Statushistorie
- Cloudflare Access: Login per One-Time PIN (E-Mail)
- ÖBB HAFAS / Scotty `fahrplan.oebb.at/bin/mgate.exe`: primäre Echtzeitquelle
- HAFAS European MCP: Referenz-/Erweiterungslayer für weitere Betreiber; das MCP-Projekt selbst ist ein stdio-MCP-Server und wird daher nicht direkt innerhalb eines Workers gestartet. Die Worker-Implementierung verwendet dieselbe HAFAS-Profilidee und hält den ÖBB-Adapter lokal edge-kompatibel.
- Web Push: `@mmmike/web-push`, da das Paket Web Crypto nutzt und Cloudflare Workers unterstützt.

## Standard-Monitoring

- Praterstern → Flughafen: 06:00–09:30
- Flughafen → Praterstern: 16:00–18:30
- alle Wochentage
- standardmäßig Meldung ab 2 Minuten Verspätung
- zusätzlich Meldung beim ersten Status des Tages und bei Statusänderungen
- Scheduler: alle 5 Minuten (UTC-Cron; Zeitfenster werden in Europe/Vienna geprüft)

## Cloudflare

`wrangler.jsonc` ist auf den separaten Worker `vab5-monitor` ausgelegt und enthält Static Assets, D1-Binding und den 5-Minuten-Cron. Die D1-ID bleibt absichtlich außerhalb des Repositories.

```bash
npm install
npx wrangler login
npx wrangler d1 create vab5-monitor
# database_id in wrangler.jsonc eintragen
npx wrangler d1 migrations apply vab5-monitor --remote
npx wrangler deploy
```

VAPID-Secrets werden nur als Worker Secrets hinterlegt.

## Cloudflare Access – One-Time PIN

In Cloudflare Zero Trust eine Self-hosted Application für die finale Worker-Adresse bzw. die gewünschte Custom Domain anlegen.

Login-Methode: **One-Time PIN**.

Policy für die persönliche Nutzung: nur die gewünschte E-Mail-Adresse erlauben.

Der Worker liest die authentifizierte Identität aus `Cf-Access-Authenticated-User-Email` und verwendet die normalisierte E-Mail als stabilen Schlüssel für die D1-Daten.

## iPhone

1. Worker-URL in Safari öffnen.
2. Mit Cloudflare Access per E-Mail-One-Time-PIN anmelden.
3. Safari: Teilen → Zum Home-Bildschirm.
4. PWA starten und Push erlauben.

## API

- `GET /api/me`
- `GET /api/status?direction=OUTBOUND`
- `GET /api/status?direction=INBOUND`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/push/config`
- `POST /api/push/subscribe`
- `POST /api/monitor/run`
- `GET /api/health`

## Recht / Datenquellen

Die App verwendet den HAFAS-Endpunkt als technische Datenquelle. Für VAB-Fahrplandaten wird keine Website-/PDF-Scraping-Logik verwendet.

## Quellen

- ÖBB HAFAS / `oebb-hafas`: https://github.com/derhuerst/oebb-hafas
- HAFAS European MCP: https://github.com/McCullonas/mcp-hafas-european
- Cloudflare Workers Static Assets
- Cloudflare Cron Triggers
- Cloudflare D1
- Cloudflare Access One-Time PIN
