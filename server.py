from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os

port = int(os.environ.get('PORT', '8080'))
server = ThreadingHTTPServer(('0.0.0.0', port), SimpleHTTPRequestHandler)
print(f'FlightTrackr static server listening on 0.0.0.0:{port}')
server.serve_forever()
