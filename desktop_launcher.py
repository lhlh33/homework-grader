from __future__ import annotations

import socket
import os
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app import app


APP_NAME = "HomeworkGraderPro"


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    bundled = base / relative
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parent / relative


def find_port(preferred: int = 8765) -> int:
    forced = os.environ.get("HOMEWORK_GRADER_PORT")
    if forced:
        return int(forced)
    for port in [preferred, *range(8766, 8800)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.15)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free local port found between 8765 and 8799.")


dist_dir = resource_path("dist")
assets_dir = dist_dir / "assets"
index_file = dist_dir / "index.html"

if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")


@app.get("/")
def desktop_index():
    if not index_file.exists():
        raise HTTPException(status_code=500, detail="Frontend dist/index.html was not found.")
    return FileResponse(index_file)


@app.get("/{full_path:path}")
def desktop_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    candidate = dist_dir / full_path
    if candidate.exists() and candidate.is_file():
        return FileResponse(candidate)
    if not index_file.exists():
        raise HTTPException(status_code=500, detail="Frontend dist/index.html was not found.")
    return FileResponse(index_file)


def open_browser(url: str) -> None:
    if os.environ.get("HOMEWORK_GRADER_NO_BROWSER") == "1":
        return
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()


def main() -> None:
    port = find_port()
    url = f"http://127.0.0.1:{port}"
    print(f"{APP_NAME} is starting at {url}")
    open_browser(url)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
