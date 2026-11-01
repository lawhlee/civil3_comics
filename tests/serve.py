"""Serve the real build at the GitHub Pages subpath, never the repository root."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

DIST = Path(__file__).resolve().parents[1] / 'dist'
PREFIX = '/civil3_comics/'

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if not path.startswith(PREFIX) or '..' in path.split('/'):
            self.send_error(404)
            return
        self.path = self.path[len(PREFIX) - 1:]
        super().do_GET()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, *args):
        pass

ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
