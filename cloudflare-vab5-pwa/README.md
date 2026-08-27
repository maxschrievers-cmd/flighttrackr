# VAB 5 Monitor – Cloudflare iPhone PWA

Eine iPhone-optimierte PWA für VAB 5 zwischen Wien Praterstern und Flughafen Wien.

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

## Cloudflare anlegen

```bash
npx wrangler login
npx wrangler d1 create vab5-monitor
```

Die ausgegebene `database_id` in `wrangler.jsonc` eintragen.

Migration anwenden:

```bash
npx wrangler d1 migrations apply vab5-monitor --remote
```

VAPID-Schlüssel erzeugen:

```bash
node -e "import('@mmmike/web-push/vapid').then(async m=>console.log(await m.generateVapidKeys()))"
```

Danach als Cloudflare Worker Secrets setzen:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Deploy:

```bash
npm install
npx wrangler deploy
```

## Cloudflare Access – One-Time PIN

In Cloudflare Zero Trust eine Self-hosted Application für die Worker-Adresse bzw. die verwendete Custom Domain anlegen.

Login-Methode: **One-Time PIN**.

Policy: nur die gewünschte E-Mail-Adresse bzw. E-Mail-Domain erlauben.

Cloudflare Access stellt danach vor dem Worker den E-Mail-OTP-Login bereit. Der Worker liest die authentifizierte Identität aus dem Access-Kontext-Header `Cf-Access-Authenticated-User-Email` und verwendet die E-Mail als Benutzer-Schlüssel in D1.

## iPhone

1. Die Worker-Adresse öffnen.
2. Mit Cloudflare Access per E-Mail-One-Time-PIN anmelden.
3. In Safari „Zum Home-Bildschirm“ wählen.
4. In der PWA „Push aktivieren“ wählen und iOS-Benachrichtigungen erlauben.

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

Die App verwendet den HAFAS-Endpunkt als technische Datenquelle. Die Nutzung muss die jeweils geltenden Bedingungen des Betreibers beachten. Für VAB-Fahrplandaten wird keine Website-/PDF-Scraping-Logik verwendet.

## Quellen

- ÖBB HAFAS / `oebb-hafas`: https://github.com/derhuerst/oebb-hafas
- HAFAS European MCP: https://github.com/McCullonas/mcp-hafas-european
- Cloudflare Workers Static Assets
- Cloudflare Cron Triggers
- Cloudflare D1
- Cloudflare Access One-Time PIN
