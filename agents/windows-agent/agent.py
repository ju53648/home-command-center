import argparse
import ctypes
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def load_allowed(path: str) -> set[str]:
    if not os.path.exists(path):
        return set()
    with open(path, "r", encoding="utf-8") as fh:
        return {line.strip() for line in fh if line.strip()}


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8", errors="ignore").strip()
    if not raw:
        return {}
    return json.loads(raw)


def write_json(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def token_valid(handler: BaseHTTPRequestHandler, token: str) -> bool:
    if not token:
        return True
    auth = handler.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() == token
    return False


def monitor_off() -> None:
    hwnd_broadcast = 0xFFFF
    wm_syscommand = 0x0112
    sc_monitorpower = 0xF170
    power_off = 2
    ctypes.windll.user32.SendMessageW(hwnd_broadcast, wm_syscommand, sc_monitorpower, power_off)


class AgentHandler(BaseHTTPRequestHandler):
    server_version = "HCCPythonAgent/1.0"

    def do_GET(self) -> None:
        if self.path == "/health":
            write_json(self, 200, {"ok": True, "agent": "python", "pid": os.getpid()})
            return
        write_json(self, 404, {"ok": False, "message": "Route not found"})

    def do_POST(self) -> None:
        token = self.server.agent_token
        if not token_valid(self, token):
            write_json(self, 401, {"ok": False, "message": "Unauthorized"})
            return

        try:
            body = read_json(self)
        except Exception as exc:
            write_json(self, 400, {"ok": False, "message": f"Invalid JSON: {exc}"})
            return

        if self.path == "/program/start":
            name = str(body.get("name", "")).strip()
            if not name:
                write_json(self, 400, {"ok": False, "message": "Program name missing"})
                return

            allowed = load_allowed(self.server.allowed_file)
            if name not in allowed:
                write_json(self, 403, {"ok": False, "message": f"Program not allowed: {name}"})
                return

            try:
                subprocess.Popen([name], creationflags=subprocess.DETACHED_PROCESS)
                write_json(self, 200, {"ok": True, "started": name})
            except Exception as exc:
                write_json(self, 500, {"ok": False, "message": str(exc)})
            return

        if self.path == "/program/stop":
            name = str(body.get("name", "")).strip()
            if not name:
                write_json(self, 400, {"ok": False, "message": "Program name missing"})
                return

            image = name if name.lower().endswith(".exe") else f"{name}.exe"
            try:
                subprocess.run(["taskkill", "/F", "/IM", image], capture_output=True, text=True, check=False)
                write_json(self, 200, {"ok": True, "stopped": image})
            except Exception as exc:
                write_json(self, 500, {"ok": False, "message": str(exc)})
            return

        if self.path == "/monitor/off":
            try:
                monitor_off()
                write_json(self, 200, {"ok": True, "monitor": "off"})
            except Exception as exc:
                write_json(self, 500, {"ok": False, "message": str(exc)})
            return

        write_json(self, 404, {"ok": False, "message": "Route not found"})

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Home Command Center Python Agent")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--token", default="")
    parser.add_argument("--allowed", default="allowed-programs.txt")
    args = parser.parse_args()

    allowed_file = args.allowed
    if not os.path.isabs(allowed_file):
        allowed_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), allowed_file)

    server = ThreadingHTTPServer(("0.0.0.0", args.port), AgentHandler)
    server.agent_token = args.token
    server.allowed_file = allowed_file

    print(f"Python Agent listening on http://*:{args.port}/")
    if args.token:
        print("Token protection enabled")

    server.serve_forever()


if __name__ == "__main__":
    main()
