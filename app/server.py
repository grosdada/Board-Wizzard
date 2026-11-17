"""Serveur HTTP de Board Wizzard (bibliotheque standard) : interface, API, fichiers de la banque et des storyboards.

    python -m app [--no-browser] [--port N] [--host 0.0.0.0]
Mot de passe facultatif (server.password dans local_settings.json) : indispensable si le serveur est en ligne.
"""

import argparse
import hashlib
import hmac
import json
import mimetypes
import re
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import jobs, poses, settings, sprites, store

WEB = Path(__file__).resolve().parent / "web"
VERSION = "0.1"
MAX_BODY = 80 * 1024 * 1024
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/javascript", ".js")


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


def merge_project(new, old):
    """Enregistrement venu de l'interface : elle gagne partout, sauf sur ce que les taches ont ecrit entre-temps
    (image integree, orbite de case) quand l'interface ne les connaissait pas encore."""
    stale = int(new.get("rev", 0)) < int(old.get("rev", 0))
    for pg in new.get("pages", []):
        for pid, pan in pg.get("panels", {}).items():
            srv = store.find_panel(old, pid)
            if not srv:
                continue
            known = set(pan.get("integrations") or [])
            fresh = [f for f in srv.get("integrations") or [] if f not in known]
            if fresh and stale:                 # a jour, l'interface a le droit de les retirer (« Vider la case »)
                pan["integrations"] = (pan.get("integrations") or []) + fresh
                pan["integrated"], pan["show"] = srv.get("integrated"), srv.get("show")
            if stale and (srv.get("orbit") or {}).get("dir") != (pan.get("orbit") or {}).get("dir") and srv.get("orbit"):
                pan["orbit"], pan["show"] = srv["orbit"], srv.get("show")
    new["rev"] = old.get("rev", 0)
    new["created"] = old.get("created", new.get("created"))
    return new


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "BoardWizzard/" + VERSION

    def log_message(self, fmt, *args):
        pass

    # ---------------------------------------------------------------- reponses
    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, cache="no-cache"):
        path = Path(path)
        if not path.is_file():
            return self.send_json({"error": "introuvable"}, 404)
        size = path.stat().st_size
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype == "application/json":
            ctype += "; charset=utf-8"
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", cache)
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except OSError:
                    return
                left -= len(chunk)

    # ---------------------------------------------------------------- acces
    def _token(self):
        pw = settings.load()["server"].get("password") or ""
        return hashlib.sha256(("bw:" + pw).encode()).hexdigest() if pw else ""

    def _allowed(self):
        tok = self._token()
        if not tok:
            return True
        m = re.search(r"(?:^|;\s*)bw=([0-9a-f]{64})", self.headers.get("Cookie") or "")
        return bool(m and hmac.compare_digest(m.group(1), tok))

    def _login(self, body):
        try:
            pw = json.loads(body.decode("utf-8") or "{}").get("password", "")
        except ValueError:
            pw = ""
        good = settings.load()["server"].get("password") or ""
        if not good or not hmac.compare_digest(pw.encode(), good.encode()):
            time.sleep(1)
            return self.send_json({"error": "mot de passe refusé"}, 403)
        body = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "bw=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" % self._token())
        self.end_headers()
        self.wfile.write(body)

    # ---------------------------------------------------------------- aiguillage
    def do_GET(self):
        self.route("GET")

    def do_HEAD(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_json({"error": "envoi trop lourd"}, 413)
            self.close_connection = True
            return
        body = self.rfile.read(length) if length else b""          # lu une seule fois, toujours (keep-alive)
        try:
            if path == "/api/login" and method == "POST":
                return self._login(body)
            if path == "/login" or (not self._allowed() and not path.startswith("/api/")):
                if self._allowed():
                    return self.redirect("/")
                return self.send_file(WEB / "login.html")
            if not self._allowed():
                return self.send_json({"error": "connexion requise"}, 401)
            if method == "GET" and not path.startswith("/api/"):
                return self.static(path)
            if path.startswith("/api/"):
                data = None
                ctype = self.headers.get("Content-Type") or ""
                if body and "json" in ctype:
                    data = json.loads(body.decode("utf-8"))
                return self.api(method, path[5:].strip("/").split("/"), q, data, body)
            self.send_json({"error": "introuvable"}, 404)
        except ApiError as e:
            self.send_json({"error": str(e)}, e.code)
        except (FileNotFoundError, KeyError) as e:
            self.send_json({"error": "introuvable : %s" % e}, 404)
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except (BrokenPipeError, ConnectionError):
            pass
        except Exception as e:                                       # noqa: BLE001
            traceback.print_exc()
            self.send_json({"error": "%s : %s" % (e.__class__.__name__, e)}, 500)

    def redirect(self, to):
        self.send_response(302)
        self.send_header("Location", to)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def static(self, path):
        if path in ("/", "/index.html"):
            return self.send_file(WEB / "index.html")
        parts = path.strip("/").split("/")
        if parts[0] == "web":
            return self.send_file(store.safe(WEB, "/".join(parts[1:])))
        if parts[0] == "bank" and len(parts) > 2:
            return self.send_file(store.safe(store.item_dir(parts[1]), "/".join(parts[2:])), "max-age=86400")
        if parts[0] == "projects" and len(parts) > 2:
            return self.send_file(store.safe(store.project_dir(parts[1]), "/".join(parts[2:])), "max-age=86400")
        self.send_json({"error": "introuvable"}, 404)

    # ---------------------------------------------------------------- API
    def job_opts(self, data):
        return {"target": (data or {}).get("target") or "auto", "_fal_key": self.headers.get("X-Fal-Key") or None,
                "prio": 2 if (data or {}).get("low") else None}

    def api(self, method, seg, q, data, body):
        head = seg[0]
        S = jobs.SCHEDULER
        if head == "info":
            return self.send_json({"version": VERSION, "settings": settings.public(), "poses": poses.catalogue(),
                                   "axes": sprites.AXES})
        if head == "settings":
            if method == "PUT":
                settings.save(data or {})
                S.caps.clear()
            return self.send_json(settings.public())
        if head == "workers":
            if q.get("fresh"):
                S.caps.clear()
            return self.send_json(S.workers_status())
        if head == "jobs":
            if method == "GET":
                return self.send_json(S.public(bool(q.get("active"))))
            if len(seg) == 2 and seg[1] == "clear":
                S.clear()
            elif len(seg) == 2 and seg[1] == "pause":
                S.paused = bool((data or {}).get("on", True))
                return self.send_json({"paused": S.paused})
            elif len(seg) == 2 and seg[1] == "cancel-all":
                S.cancel_all()
            elif len(seg) == 3 and seg[2] == "cancel":
                S.cancel(seg[1])
            return self.send_json({"ok": True})
        if head == "folders":                                       # dossiers et sous-dossiers de la banque
            if method == "POST":
                store.add_folder((data or {}).get("name", ""), (data or {}).get("kind", ""))
            elif method == "PUT":
                d = data or {}
                store.rename_folder(d.get("name", ""), d.get("to", ""), d.get("kind", ""))
            elif method == "DELETE":
                return self.send_json({"moved": store.remove_folder(q.get("name", ""), q.get("kind", "")), "folders": store.list_folders()})
            return self.send_json(store.list_folders())
        if head == "bank":
            return self.api_bank(method, seg[1:], q, data, body)
        if head == "projects":
            return self.api_projects(method, seg[1:], q, data, body)
        raise ApiError("route inconnue", 404)

    def api_bank(self, method, seg, q, data, body):
        S = jobs.SCHEDULER
        if not seg:
            if method == "GET":
                return self.send_json(store.list_items())
            if method == "POST":                                    # corps brut = l'image
                if not body:
                    raise ApiError("image manquante")
                tmp = settings.DATA / "tmp"
                tmp.mkdir(parents=True, exist_ok=True)
                f = tmp / ("up_%d_%s" % (time.time() * 1000, re.sub(r"[^\w.]", "_", q.get("file", "image.png"))[-40:]))
                f.write_bytes(body)
                try:
                    it = jobs.add_item(q.get("kind", "character"), q.get("name") or "Sans nom", f,
                                       q.get("style", "photo"), facing=q.get("facing", "face"), folder=q.get("folder", ""))
                finally:
                    f.unlink(missing_ok=True)
                if q.get("prepare", "1") != "0":
                    jobs.prepare(it["id"], orbit=q.get("orbit", "1") != "0", **self._follow(q))
                return self.send_json(store.load_item(it["id"]))
        if seg[0] == "generate" and method == "POST":
            d = data or {}
            if not (d.get("prompt") or "").strip():
                raise ApiError("décris ce qu'il faut générer")
            jid = S.add("item_new", {"kind": d.get("kind", "asset"), "name": d.get("name", ""), "prompt": d["prompt"],
                                     "style": d.get("style", "photo"), "orbit": d.get("orbit", True),
                                     "folder": d.get("folder", "")},
                        "Création · %s" % (d.get("name") or d["prompt"][:30]), **self.job_opts(d))
            return self.send_json({"job": jid})
        iid = seg[0]
        if len(seg) == 1:
            if method == "PUT":
                keep = {k: v for k, v in (data or {}).items() if k in ("name", "style", "facing", "tags", "folder")}
                return self.send_json(store.mutate_item(iid, lambda x: x.update(keep)))
            if method == "DELETE":
                store.delete_item(iid)
                return self.send_json({"ok": True})
            return self.send_json(store.load_item(iid))
        act, d = seg[1], data or {}
        opts = self.job_opts(d)
        it = store.load_item(iid)
        if act == "prepare":
            made = jobs.prepare(iid, orbit=d.get("orbit", True), pose_keys=d.get("poses") or [], target=opts["target"],
                                fal_key=opts["_fal_key"], prio=2 if d.get("low") else 1)
            for c in d.get("custom") or []:
                if (c or "").strip():
                    made.append(S.add("item_pose", {"item": iid, "pose": "", "custom": c.strip(),
                                                    "orbit": d.get("orbit", True)},
                                      "Pose · %s · %s" % (it["name"], c.strip()[:30]), **opts))
            return self.send_json({"jobs": made})
        if act == "orbit":
            vid = d.get("variant", "base")
            params = {"item": iid, "variant": vid}
            for k in ("seed", "length", "megapixels", "studio"):
                if d.get(k):
                    params[k] = d[k]
            return self.send_json({"job": S.add("item_orbit", params, "Orbite · %s · %s" % (
                it["name"], it["variants"][vid]["label"]), **opts)})
        if act == "sheet":                                          # planche de vues d'un personnage (dos, profil...)
            return self.send_json({"job": S.add("item_sheet", {"item": iid, "redo": bool(d.get("redo"))},
                                                "Planche de vues · %s" % it["name"], **opts)})
        if act == "cut":
            vid = d.get("variant", "base")
            return self.send_json({"job": S.add("item_cut", {"item": iid, "variant": vid},
                                                "Détourage · %s" % it["name"], **opts)})
        if act == "snaps":
            vid = d.get("variant", "base")

            def apply(x):
                x["variants"][vid]["orbit"]["snaps"] = {k: int(v) for k, v in (d.get("snaps") or {}).items()}
            return self.send_json(store.mutate_item(iid, apply))
        if act == "variant" and method == "DELETE" and len(seg) == 3 and seg[2] != "base":
            return self.send_json(store.mutate_item(iid, lambda x: x["variants"].pop(seg[2], None)))
        raise ApiError("route inconnue", 404)

    def _follow(self, q):
        return {"target": q.get("target", "auto"), "fal_key": self.headers.get("X-Fal-Key") or None,
                "prio": 2 if q.get("low") else 1}

    def api_projects(self, method, seg, q, data, body):
        S = jobs.SCHEDULER
        if not seg:
            if method == "POST":
                d = data or {}
                return self.send_json(store.create_project(d.get("name", "Storyboard"), d.get("page") or {},
                                                           d.get("layout") or {"t": "leaf", "id": "p1"}))
            return self.send_json(store.list_projects())
        pid = seg[0]
        if len(seg) == 1:
            if method == "PUT":
                with store._lock:
                    old = store.load_project(pid)
                    new = merge_project(data, old)
                    new["id"] = pid
                    return self.send_json(store.save_project(new))
            if method == "DELETE":
                store.delete_project(pid)
                return self.send_json({"ok": True})
            return self.send_json(store.load_project(pid))
        act, d = seg[1], data or {}
        pdir = store.project_dir(pid)
        if act == "rev":
            return self.send_json({"rev": store.load_project(pid).get("rev", 0)})
        if act == "upload" and method == "POST":
            name = "%d_%s" % (time.time() * 1000, re.sub(r"[^\w.]", "_", q.get("name", "image.png"))[-40:])
            dest = pdir / "assets" / (Path(name).stem + ".png")
            tmp = pdir / "assets" / ("_" + name)
            tmp.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_bytes(body)
            try:
                w, h = sprites.normalize(tmp, dest, 2400)
            finally:
                tmp.unlink(missing_ok=True)
            return self.send_json({"file": "assets/" + dest.name, "w": w, "h": h})
        if act == "flat" and method == "POST":                     # la case aplatie par le navigateur (PNG)
            panel = re.sub(r"[^\w-]", "", seg[2])
            rel = "flat/%s_%d.png" % (panel, time.time())
            (pdir / rel).parent.mkdir(parents=True, exist_ok=True)
            (pdir / rel).write_bytes(body)
            return self.send_json({"file": rel})
        if act == "integrate" and method == "POST":
            store.safe(pdir, d["flat"])
            jid = S.add("panel_integrate", {"project": pid, "panel": d["panel"], "flat": d["flat"],
                                            "style": d.get("style", "photo"), "prompt": d.get("prompt", ""),
                                            "extra": d.get("extra", "")},
                        "Integrate · case %s" % d["panel"], **self.job_opts(d))
            return self.send_json({"job": jid})
        if act == "orbit" and method == "POST":
            store.safe(pdir, d["flat"])
            jid = S.add("panel_orbit", {"project": pid, "panel": d["panel"], "flat": d["flat"]},
                        "Orbite de la case %s" % d["panel"], **self.job_opts(d))
            return self.send_json({"job": jid})
        raise ApiError("route inconnue", 404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--port", type=int)
    ap.add_argument("--host")
    args = ap.parse_args()
    s = settings.load()["server"]
    host, port = args.host or s["host"], args.port or s["port"]
    settings.DATA.mkdir(parents=True, exist_ok=True)

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = sys.platform != "win32"

        def server_bind(self):
            if sys.platform == "win32":
                import socket
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    try:
        httpd = Server((host, port), Handler)
    except OSError:
        print("Le port %d est déjà pris : Board Wizzard tourne sans doute déjà (http://127.0.0.1:%d/)." % (port, port))
        return
    jobs.SCHEDULER.start()
    url = "http://%s:%d/" % ("127.0.0.1" if host in ("0.0.0.0", "") else host, port)
    print("Board Wizzard : %s   (données : %s)" % (url, settings.DATA), flush=True)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
