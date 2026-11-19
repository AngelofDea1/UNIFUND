import email.message
import io
import logging
import os
import threading

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import server

app = FastAPI(title="UniFund API", docs_url=None, redoc_url=None)
database_initialized = False
database_lock = threading.Lock()
initialization_errors = (RuntimeError,) + server.DB_ERRORS
if server.psycopg is not None:
    initialization_errors += (server.psycopg.Error,)


@app.get("/")
@app.get("/index.html")
def index():
    return FileResponse(os.path.join(server.STATIC_ROOT, "index.html"))


app.mount(
    "/css",
    StaticFiles(directory=os.path.join(server.STATIC_ROOT, "css")),
    name="css",
)
app.mount(
    "/fonts",
    StaticFiles(directory=os.path.join(server.STATIC_ROOT, "fonts")),
    name="fonts",
)
app.mount(
    "/js",
    StaticFiles(directory=os.path.join(server.STATIC_ROOT, "js")),
    name="js",
)


class VercelAPIHandler(server.UniFundAPIHandler):
    def send_response(self, code, message=None):
        self._response_status = code

    def send_header(self, keyword, value):
        self._response_headers[keyword] = value

    def end_headers(self):
        pass


def ensure_database():
    global database_initialized
    with database_lock:
        if not database_initialized:
            server.init_db()
            database_initialized = True


@app.api_route("/api/{api_path:path}", methods=["GET", "POST", "OPTIONS"])
async def dispatch_api(api_path: str, request: Request):
    if os.environ.get("VERCEL") and not server.DATABASE_URL:
        return JSONResponse(
            status_code=503,
            content={
                "error": "UniFund's database is not connected yet. Add the Neon DATABASE_URL in Vercel and redeploy."
            },
        )
    try:
        ensure_database()
    except initialization_errors:
        logging.exception("UniFund database initialization failed")
        return JSONResponse(
            status_code=503,
            content={
                "error": "UniFund could not connect to its database. Check the Neon connection and admin setup in Vercel."
            },
        )

    body = await request.body()
    headers = email.message.Message()
    for key, value in request.headers.items():
        headers[key] = value
    headers["Content-Length"] = str(len(body))

    handler = object.__new__(VercelAPIHandler)
    handler.path = request.url.path
    if request.url.query:
        handler.path += "?" + request.url.query
    handler.command = request.method
    handler.request_version = "HTTP/1.1"
    handler.requestline = f"{request.method} {handler.path} HTTP/1.1"
    handler.client_address = (request.client.host if request.client else "127.0.0.1", 0)
    handler.headers = headers
    handler.rfile = io.BytesIO(body)
    handler.wfile = io.BytesIO()
    handler._response_status = 500
    handler._response_headers = {}

    try:
        if request.method == "GET":
            handler.do_GET()
        elif request.method == "POST":
            handler.do_POST()
        else:
            handler.do_OPTIONS()
    except server.DB_ERRORS:
        logging.exception("UniFund database request failed")
        return JSONResponse(
            status_code=503,
            content={"error": "UniFund could not complete this request because the database is unavailable. Please try again."},
            headers={"Cache-Control": "no-store"},
        )

    return Response(
        content=handler.wfile.getvalue(),
        status_code=handler._response_status,
        headers=handler._response_headers,
    )


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"error": "API endpoint not found"})
    return FileResponse(os.path.join(server.STATIC_ROOT, "index.html"))
