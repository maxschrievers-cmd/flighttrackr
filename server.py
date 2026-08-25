from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
import json, os

PORT = int(os.environ.get('PORT', '8080'))
OPENSKY_URL = 'https://opensky-network.org/api/states/all'

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/opensky':
            qs = parse_qs(parsed.query)
            defaults = {'lamin': 46.0, 'lomin': 8.0, 'lamax': 49.5, 'lomax': 19.5}
            params = {}
            for key, fallback in defaults.items():
                raw = qs.get(key, [str(fallback)])[0]
                try:
                    params[key] = float(raw)
                except ValueError:
                    params[key] = fallback
            query = '&'.join(f'{k}={v}' for k, v in params.items())
            try:
                req = Request(f'{OPENSKY_URL}?{query}', headers={'User-Agent': 'FlightTrackr/1.0'})
                with urlopen(req, timeout=12) as resp:
                    body = resp.read().decode('utf-8')
                payload = json.loads(body)
                states = []
                for s in payload.get('states') or []:
                    states.append({
                        'icao24': s[0], 'callsign': (s[1] or '').strip(),
                        'country': s[2], 'timePosition': s[3], 'lastContact': s[4],
                        'longitude': s[5], 'latitude': s[6], 'baroAltitude': s[7],
                        'onGround': s[8], 'velocity': s[9], 'trueTrack': s[10],
                        'verticalRate': s[11], 'geoAltitude': s[13], 'squawk': s[14]
                    })
                out = json.dumps({'time': payload.get('time'), 'states': states}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)
                return
            except Exception as exc:
                out = json.dumps({'error': 'live-flight-provider-unavailable', 'detail': str(exc)}).encode('utf-8')
                self.send_response(502)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)
                return
        return super().do_GET()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'FlightTrackr server listening on 0.0.0.0:{PORT}')
    server.serve_forever()
