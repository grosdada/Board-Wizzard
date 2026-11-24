"""Serveur HTTP de Board Wizzard (bibliotheque standard) : interface, API, fichiers de la banque et des storyboards.

    python -m app [--no-browser] [--port N] [--host 0.0.0.0]
Mot de passe facultatif (server.password dans local_settings.json) : indispensable si le serveur est en ligne.
"""

import argparse
import hashlib
import hmac
import io
import json
import mimetypes
import re
import shutil
import sys
import tempfile
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

REALTIME_APP = "fal-ai/flux-2/klein/realtime"              # croquis -> image en direct (essai)
REALISTIC_MODEL = "openai/gpt-image-2.6/sunburst/edit"     # portrait-robot -> photo (modele par defaut)
REALISTIC_MODELS = {"gpt": "openai/gpt-image-2.6/sunburst/edit", "seedream": "bytedance/seedream/v5.5/edit"}
from . import comfy, accounts, archive, brain, cost, jobs, mouthfind, packs, parts, poses, procedural, retouch, settings, sprites, store, eleven

WEB = Path(__file__).resolve().parent / "web"
VERSION = "0.1"
MAX_BODY = 80 * 1024 * 1024
MAX_PACK = 40 * 1024 ** 3                                    # un paquet de personnages (recu sur disque, pas en memoire)
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")                # MediaPipe (repérage du visage, « Transposer »)
mimetypes.add_type("application/wasm", ".wasm")


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


_FAILS, _FAILS_LOCK = {}, threading.Lock()                     # essais de mot de passe rates, par adresse : (nombre, attente jusqu'a)


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

    def send_file(self, path, cache="no-cache", download=None):
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
        if download:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % re.sub(r'[^A-Za-z0-9._-]', "-", download))
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

    def _who(self):
        """Qui parle : {"role": "admin"}, {"role": "guest", "id", "name", "vip"}, ou None (pas connecte). Sans mot de passe
        d'application, tout le monde est admin."""
        tok = self._token()
        if not tok:
            return {"role": "admin", "name": "", "vip": True}
        m = re.search(r"(?:^|;\s*)bw=([0-9a-f]{64})", self.headers.get("Cookie") or "")
        if not m:
            return None
        if hmac.compare_digest(m.group(1), tok):
            return {"role": "admin", "name": "", "vip": True}
        acc = accounts.by_token(m.group(1))
        if acc:
            return {"role": "guest", "id": acc["id"], "name": acc["name"], "vip": bool(acc.get("vip"))}
        return None

    def _admin(self):
        if (self.me or {}).get("role") != "admin":
            raise ApiError("réservé à l'administrateur", 403)

    def _check(self, name, pw):
        """Verifie un nom et un mot de passe, avec le frein aux essais. Nom vide (ou « admin ») : l'administrateur ; sinon
        un invite. Rend le compte ({"role": ...}), ou repond l'erreur et rend None."""
        good = settings.load()["server"].get("password") or ""
        ip = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        now = time.time()
        with _FAILS_LOCK:                                           # frein aux essais : apres 5 erreurs, attente qui double
            n, until = _FAILS.get(ip, (0, 0))
            if now < until:
                self.send_json({"error": "trop d'essais : réessayer dans %d s" % int(until - now + 1)}, 429)
                return None
        name, pw, who = str(name or "").strip(), str(pw or ""), None
        if good and name.casefold() in ("", "admin"):
            if hmac.compare_digest(pw.encode(), good.encode()):
                who = {"role": "admin"}
        elif good:
            acc = accounts.find(name)
            if acc and accounts.verify(acc, pw):
                who = {"role": "guest", "id": acc["id"]}
        if not who:
            with _FAILS_LOCK:
                n += 1
                _FAILS[ip] = (n, now + min(3600, 30 * 2 ** (n - 5)) if n >= 5 else 0)
                if len(_FAILS) > 5000:
                    _FAILS.clear()
            time.sleep(1)
            self.send_json({"error": "nom ou mot de passe refusé"}, 403)
            return None
        with _FAILS_LOCK:
            _FAILS.pop(ip, None)
        return who

    def _send_cookie(self, who, clear=False):
        """Pose le cookie de session du compte donne (admin ou invite), ou l'efface."""
        tok = ""
        if not clear:
            tok = self._token() if who["role"] == "admin" else accounts.token(next(a for a in accounts._all() if a["id"] == who["id"]))
        body = b'{"ok": true}'
        secure = "; Secure" if (self.headers.get("X-Forwarded-Proto") or "").lower() == "https" else ""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "bw=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d%s" % (tok, 0 if clear else 2592000, secure))
        self.end_headers()
        self.wfile.write(body)

    def _login(self, body):
        try:
            d = json.loads(body.decode("utf-8") or "{}")
        except ValueError:
            d = {}
        who = self._check(d.get("name"), d.get("password"))
        if who:
            self._send_cookie(who)

    def _password(self, data):
        """Mon compte : chacun change son propre mot de passe, en donnant l'actuel. Reste possible quand les reglages sont
        verrouilles (instance en ligne). Les autres navigateurs du meme compte devront se reconnecter."""
        data = data or {}
        new = str(data.get("new") or "")
        good = settings.load()["server"].get("password") or ""
        if len(new) < 8:
            raise ApiError("le nouveau mot de passe doit faire au moins 8 caractères", 400)
        if new.startswith("••"):
            raise ApiError("ce mot de passe ne peut pas commencer par des points", 400)
        me = self.me
        if me["role"] == "guest":
            who = self._check(me["name"], data.get("old"))
            if not who:
                return
            accounts.update(me["id"], password=new)
            return self._send_cookie(who)
        if good:
            if not self._check("", data.get("old")):
                return
        elif settings.load()["server"].get("lock_settings"):
            raise ApiError("sur cette instance, le premier mot de passe se met dans local_settings.json", 403)
        settings.save({"server": {"password": new}}, trusted=True)
        self._send_cookie({"role": "admin"})

    def _accounts(self, method, seg, data):
        """Comptes invites, geres par l'admin : liste, creation (mot de passe tire au hasard, montre une seule fois),
        changement de type ou nouveau mot de passe, suppression."""
        self._admin()
        if not (settings.load()["server"].get("password") or ""):
            raise ApiError("il faut d'abord mettre un mot de passe à l'application : sans lui, tout le monde est administrateur", 400)
        data = data or {}
        if method == "POST" and len(seg) == 1:
            acc, pw = accounts.create(data.get("name"), data.get("vip"))
            return self.send_json({"account": acc, "password": pw})
        if method == "PUT" and len(seg) == 2:
            pw = accounts.update(seg[1], vip=data.get("vip") if "vip" in data else None, reset=bool(data.get("reset")))
            return self.send_json({"accounts": accounts.public(), "password": pw})
        if method == "DELETE" and len(seg) == 2:
            accounts.remove(seg[1])
        return self.send_json({"accounts": accounts.public()})

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
        if path == "/api/bank/import" and method == "POST":         # paquet de personnages : trop lourd pour la memoire
            return self.import_pack(length, q)
        if length > MAX_BODY:
            self.send_json({"error": "envoi trop lourd"}, 413)
            self.close_connection = True
            return
        body = self.rfile.read(length) if length else b""          # lu une seule fois, toujours (keep-alive)
        try:
            if path == "/api/login" and method == "POST":
                return self._login(body)
            self.me = self._who()
            if path == "/api/logout" and method == "POST":
                return self._send_cookie(None, clear=True)
            if path == "/login" or (not self.me and not path.startswith("/api/")):
                if self.me:
                    return self.redirect("/")
                return self.send_file(WEB / "login.html")
            if not self.me:
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
        except cost.BudgetExceeded as e:                            # plafond du personnage : la fiche demande confirmation
            self.send_json({"error": str(e), "budget": e.info}, 402)
        except (FileNotFoundError, KeyError) as e:
            self.send_json({"error": "introuvable : %s" % e}, 404)
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except (BrokenPipeError, ConnectionError):
            pass
        except Exception as e:                                       # noqa: BLE001
            traceback.print_exc()
            self.send_json({"error": "%s : %s" % (e.__class__.__name__, e)}, 500)

    def import_pack(self, length, q):
        """Recoit un paquet .bwpack sur le disque local, morceau par morceau, puis le verse dans la banque."""
        self.me = self._who()
        if not self.me or length <= 0 or length > MAX_PACK:
            self.close_connection = True
            return self.send_json({"error": "connexion requise" if not self.me else "paquet vide ou trop lourd"}, 413 if self.me else 401)
        tmp = Path(tempfile.mkdtemp(prefix="bwpack_"))
        try:
            left = length
            with open(tmp / "p.bwpack", "wb") as f:
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        raise ConnectionError("envoi interrompu")
                    f.write(chunk)
                    left -= len(chunk)
            self.send_json(packs.import_pack(tmp / "p.bwpack", replace=q.get("replace") == "1"))
        except (BrokenPipeError, ConnectionError):
            self.close_connection = True
        except ValueError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:                                       # noqa: BLE001
            traceback.print_exc()
            self.send_json({"error": "%s : %s" % (e.__class__.__name__, e)}, 500)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

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
        if parts[0] == "bodies" and len(parts) == 2:                # corps encres du portrait-robot
            return self.send_file(store.safe(settings.DATA / "bodies", parts[1]), "max-age=3600")
        if parts[0] == "parts" and 3 <= len(parts) <= 5:            # elements du portrait-robot (banques : _banks/<banque>/<cat>/<id>.png)
            return self.send_file(store.safe(store._dir("parts"), "/".join(parts[1:])), "max-age=86400")
        if parts[0] == "audio" and len(parts) == 2:                 # fichiers de la banque audio
            return self.send_file(store.safe(store._dir("audio"), parts[1]), "max-age=86400")
        if parts[0] == "projects" and len(parts) > 2:
            return self.send_file(store.safe(store.project_dir(parts[1]), "/".join(parts[2:])), "max-age=86400")
        if parts[0] == "generations" and len(parts) == 3:            # archive des generations IA (administrateur)
            self._admin()
            return self.send_file(store.safe(archive.root(), "/".join(parts[1:])), "max-age=86400", download=parts[2] if "dl=1" in self.path else None)
        self.send_json({"error": "introuvable"}, 404)

    # ---------------------------------------------------------------- API
    def job_opts(self, data):
        return {"target": (data or {}).get("target") or "auto", "_fal_key": self.headers.get("X-Fal-Key") or None,
                "prio": 2 if (data or {}).get("low") else None, "own_key": self.own_key()}

    def own_key(self):
        """Un invite non VIP n'utilise pas les cles du serveur (fal, ElevenLabs) : seulement sa propre cle fal."""
        return not (self.me or {}).get("vip")

    def eleven_key(self):
        """Cle ElevenLabs d'un appel de voix : celle du navigateur (en-tete X-Eleven-Key) d'abord, sinon celle du serveur pour
        l'admin et les invites VIP. Jamais journalisee ni renvoyee."""
        mine = (self.headers.get("X-Eleven-Key") or "").strip()
        if mine:
            return mine
        if not self.own_key():
            k = (settings.load().get("elevenlabs") or {}).get("key")
            if k:
                return k
        raise ApiError("aucune clé ElevenLabs : entre ta clé dans Réglages › ElevenLabs (voix) › « Ma clé (ce navigateur) »", 403)

    def api(self, method, seg, q, data, body):
        head = seg[0]
        S = jobs.SCHEDULER
        if head == "info":
            return self.send_json({"version": VERSION, "settings": settings.public(self.me["vip"]), "poses": poses.catalogue(),
                                   "me": {"role": self.me["role"], "name": self.me.get("name") or "", "vip": self.me["vip"],
                                          "password": bool(settings.load()["server"].get("password"))},
                                   "axes": sprites.AXES, "sceneOrbit": comfy.SCENE_ORBIT_PROMPT})
        if head == "password" and method == "POST":
            return self._password(data)
        if head == "generations":                                    # toutes les generations IA (data/generations)
            if method == "POST":                                     # une image rendue dans le navigateur (temps reel...)
                p = archive.keep_bytes(body, q.get("what") or "navigateur", q.get("name") or "image.png")
                return self.send_json({"ok": bool(p)})
            self._admin()
            return self.send_json({"items": archive.listing(int(q.get("limit") or 600)), "dir": str(archive.root())})
        if head == "accounts":
            return self._accounts(method, seg, data)
        if head == "settings":
            if method == "PUT":
                self._admin()
                d = data or {}                                       # le moteur d'Integrate reste reglable sur une instance verrouillee
                engine_only = set(d) == {"render"} and set(d["render"] or {}) == {"integrate_engine"}
                if settings.load()["server"].get("lock_settings") and not engine_only:
                    raise ApiError("sur cette instance, les réglages se changent dans local_settings.json, pas depuis l'interface", 403)
                settings.save(data or {})
                S.caps.clear()
            return self.send_json(settings.public(self.me["vip"]))
        if head == "brain" and method == "POST":                   # Reglages › Intelligence › « Tester » (quelques jetons)
            self._admin()
            d = dict(data or {})
            if not d.get("key") or str(d.get("key")).startswith("••"):
                d.pop("key", None)                                  # cle masquee : celle du poste
            try:
                return self.send_json(brain.test({k: v for k, v in d.items() if k in ("provider", "key", "model")}))
            except brain.BrainError as e:
                raise ApiError(str(e), 400)
        if head == "workers":
            if self.own_key():                                      # invite non VIP : les machines du poste ne lui sont pas ouvertes
                return self.send_json([])
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
        if head == "audio":                                         # banque audio : voix importees, enregistrees, generees
            if len(seg) == 1:
                if method == "POST":
                    if not body or len(body) > 80 * 1024 * 1024:
                        raise ApiError("fichier son vide ou trop gros (80 Mo au plus)", 400)
                    return self.send_json(store.add_audio(body, q.get("name", "voix.webm"), q.get("source", "import"), folder=q.get("folder", "")))
                return self.send_json(store.list_audio())
            if method == "PUT":
                return self.send_json(store.update_audio(seg[1], data or {}))
            if method == "DELETE":
                return self.send_json({"removed": store.remove_audio(seg[1])})
            return self.send_json(store.audio_entry(seg[1]))
        if head == "tts" and seg[1:] == ["voices"]:                 # voix ElevenLabs du compte
            try:
                return self.send_json(eleven.voices(self.eleven_key()))
            except eleven.ElevenError as e:
                raise ApiError(str(e), 400)
        if head == "folders":                                       # dossiers et sous-dossiers de la banque
            if method == "POST":
                store.add_folder((data or {}).get("name", ""), (data or {}).get("kind", ""))
            elif method == "PUT":
                d = data or {}
                store.rename_folder(d.get("name", ""), d.get("to", ""), d.get("kind", ""))
            elif method == "DELETE":
                return self.send_json({"moved": store.remove_folder(q.get("name", ""), q.get("kind", "")), "folders": store.list_folders()})
            return self.send_json(store.list_folders())
        if head == "parts" and (q.get("bank") or q.get("kit") or seg[1:2] in (["banks"], ["heads"], ["assets"])):
            return self._partbanks(method, seg, q, data, body)      # banques d'elements, generateur de corps (app/partbanks.py)
        if head == "parts":                                         # banque d'elements de visage du portrait-robot
            if len(seg) == 2 and method == "POST":                  # un element dessine a la main : corps brut = le PNG
                if not body:
                    raise ApiError("dessin manquant")
                return self.send_json(parts.add_drawn(seg[1], q.get("name", ""), body, replace=q.get("replace") or None))
            if len(seg) == 3 and method == "GET":                   # formes d'un element dessine, pour l'editer
                return self.send_json(parts.drawn(seg[1], seg[2]))
            if len(seg) == 3 and method == "PUT":
                return self.send_json(parts.save_shapes(seg[1], seg[2], (data or {}).get("shapes"), (data or {}).get("under"), bool((data or {}).get("pair"))))
            if len(seg) == 3 and method == "DELETE":
                parts.remove(seg[1], seg[2])
                return self.send_json({"ok": True})
            return self.send_json(parts.catalogue())
        if head == "portrait" and seg[1:] == ["realistic"] and method == "POST":   # portrait-robot -> photo (GPT Image 2.6 Sunburst)
            return self.send_json(self._realistic(data or {}))
        if head == "fal" and seg[1:] == ["realtime-token"] and method == "POST":   # croquis -> image en direct (essai)
            # jeton court fal pour le temps reel : la cle reste sur le serveur (ou celle du navigateur d'un invite non VIP)
            import urllib.request
            key = self.headers.get("X-Fal-Key") or ("" if self.own_key() else settings.load()["fal"].get("key") or "")
            if not key:
                raise ApiError("aucune clé fal : entre ta clé dans Réglages › fal (cloud)")
            app_id = (data or {}).get("app") or REALTIME_APP
            if app_id != REALTIME_APP:
                raise ApiError("modèle temps réel non autorisé")
            req = urllib.request.Request("https://rest.fal.ai/tokens/realtime", method="POST",
                                         data=json.dumps({"app": app_id, "duration": 120}).encode(),
                                         headers={"Content-Type": "application/json", "Authorization": "Key " + key})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    raw = r.read().decode("utf-8", "replace")
            except Exception as e:                                  # noqa: BLE001
                raise ApiError("fal a refusé le jeton : %s" % str(e)[:200], 502)
            try:
                tok = json.loads(raw)
            except ValueError:
                tok = raw.strip().strip('"')
            if isinstance(tok, dict):
                if not tok.get("token"):
                    raise ApiError("fal n'a pas rendu de jeton : %s" % str(tok)[:200], 502)
                tok = tok["token"]
            return self.send_json({"token": tok, "app": app_id, "duration": 120})
        if head == "procedural":                                    # objets tout faits : dessines et tournes sans calcul
            d = data or {}
            if seg[1:] == ["preview"] and method == "POST":
                import io
                buf = io.BytesIO()
                procedural.preview(d.get("key", ""), d.get("params") or {}, float(d.get("az", 30))).save(buf, "PNG")
                img = buf.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return self.wfile.write(img)
            if seg[1:] == ["create"] and method == "POST":
                return self.send_json(procedural.create(d.get("key", ""), d.get("params") or {}, (d.get("name") or "").strip(), d.get("folder", "")))
            return self.send_json(procedural.catalogue())
        if head == "transpose" and method == "POST":                # portrait-robot : points d'un visage -> elements traces
            return self.send_json(self._transpose(data or {}))
        if head == "bodies":                                        # corps du portrait-robot (tete posee dessus)
            from . import bodydraw
            if len(seg) == 1:
                return self.send_json([{"id": store.slug(n), "name": n, "ready": (settings.DATA / "bodies" / (store.slug(n) + ".png")).exists()}
                                       for n, _ in bodydraw.CORPS_VARIANTES])
            if seg[1:] == ["compose"] and method == "POST":         # la tete (PNG 1000 x 1300, cadre de l'atelier) posee sur un corps
                return self._compose(body, q.get("body", ""))
        if head == "library":                                       # bibliotheque en ligne de personnages
            if not self.me["vip"]:
                raise ApiError("la bibliothèque en ligne est réservée aux comptes VIP", 403)
            if seg[1:2] == ["thumb"] and len(seg) == 3:
                img = packs.library_thumb(seg[2])
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(img)))
                self.send_header("Cache-Control", "max-age=3600")
                self.end_headers()
                return self.wfile.write(img)
            if seg[1:] == ["import"] and method == "POST":
                d = data or {}
                return self.send_json(packs.library_import(d.get("id", ""), replace=bool(d.get("replace"))))
            return self.send_json(packs.library_index())
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
        if seg[0] == "export" and method == "GET":                  # paquet .bwpack : des elements, ou tout un dossier
            ids = packs.select([i for i in (q.get("ids") or "").split(",") if i] or None, q.get("folder"), q.get("kind"))
            busy = {(j.get("params") or {}).get("item") for j in S.public(True)}
            hot = [i for i in ids if i in busy]
            if hot:
                raise ApiError("encore en calcul : %s. Attendre la fin avant d'exporter." % ", ".join(hot), 409)
            tmp = Path(tempfile.mkdtemp(prefix="bwpack_"))
            try:
                packs.export(ids, tmp / "p.bwpack")
                asked = [i for i in (q.get("ids") or "").split(",") if i]
                name = (asked[0] if len(asked) == 1 else store.slug(q.get("folder") or "banque")) + packs.EXT
                return self.send_file(tmp / "p.bwpack", "no-store", download=name)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        if seg[0] == "generate" and method == "POST":
            d = data or {}
            if not (d.get("prompt") or "").strip():
                raise ApiError("décris ce qu'il faut générer")
            guides = self._save_guides(d)                           # croquis et references de style (images data:)
            jid = S.add("item_new", {"kind": d.get("kind", "asset"), "name": d.get("name", ""), "prompt": d["prompt"],
                                     "style": d.get("style", "photo"), "orbit": d.get("orbit", True), "apose": bool(d.get("apose")), "view": d.get("view") or "",
                                     "folder": d.get("folder", ""), "tags": d.get("tags") or None, "raw": bool(d.get("raw")), **guides,
                                     **({"seed": int(d["seed"])} if d.get("seed") else {})},
                        "Création · %s" % (d.get("name") or d["prompt"][:30]), **self.job_opts(d))
            return self.send_json({"job": jid})
        if seg[0] == "assemble" and method == "POST":               # portrait-robot : un corps de la banque + une tete en traces
            d = data or {}
            try:
                return self.send_json(store.assemble((d.get("name") or "").strip(), d.get("body", ""), d.get("face") or {}, d.get("folder", "")))
            except (OSError, ValueError) as e:
                raise ApiError("assemblage impossible : %s" % e)
        iid = seg[0]
        if len(seg) == 1:
            if method == "PUT":
                keep = {k: v for k, v in (data or {}).items() if k in ("name", "style", "facing", "tags", "folder", "face", "body", "cover", "identikit", "keep", "drawn")}
                if "keep" in keep:                                  # particularites a garder sur toutes les poses (texte libre)
                    keep["keep"] = str(keep["keep"] or "").strip()[:400]
                if "identikit" in keep:                             # composition du portrait-robot, pour le rouvrir dans l'atelier
                    keep["identikit"] = self._keep_identikit(iid, keep["identikit"])
                if keep.get("body"):
                    store.load_item(keep["body"])
                if "cover" in keep and keep["cover"] not in (store.resolve(store.load_item(iid)).get("variants") or {}):   # variante principale (vignette de la banque)
                    raise ApiError("variante inconnue : %s" % keep["cover"])
                return self.send_json(store.resolve(store.mutate_item(iid, lambda x: x.update(keep))))
            if method == "DELETE":
                store.delete_item(iid)
                return self.send_json({"ok": True})
            return self.send_json(store.resolve(store.load_item(iid)))
        act, d = seg[1], data or {}
        opts = self.job_opts(d)
        it = store.load_item(iid)
        if it.get("body"):
            raise ApiError("ce personnage est un assemblage : les poses et les orbites se calculent sur son corps (« %s »)" % it["body"])
        if act == "rebase" and method == "POST":                    # portrait-robot reedite : nouvelle image de base (corps brut)
            return self.send_json(self._rebase(iid, body))
        if act == "zones":                                          # zones suspectes d'une orbite (vides remplis a tort ?)
            return self.send_json(retouch.zones(iid, q.get("variant", "base")))
        if act == "punch" and method == "POST":                     # vider une zone remplie a tort (sous un bras)
            return self.send_json(retouch.punch(iid, d.get("variant", "base"), d.get("frame", 0), d.get("x", 0), d.get("y", 0),
                                                spread=d.get("spread", True)))
        if act == "lasso" and method == "POST":                     # retouche a la main : vider ou remplir la zone entouree
            return self.send_json(retouch.lasso(iid, d.get("variant", "base"), d.get("frame", 0), d.get("points") or [],
                                                mode=d.get("mode", "vider"), lines=bool(d.get("lines"))))
        if act == "mouth" and method in ("POST", "DELETE"):         # lip sync : la bouche tracee sur le dessin, suivie dans l'orbite
            return self.send_json(self._mouth(iid, it, method, d if method == "POST" else {"variant": q.get("variant") or q.get("v") or "base"}))
        if act == "lips" and method == "POST":                      # bouches calculees : corriger la place ou le detourage d'une image-cle
            return self.send_json(self._lips(iid, it, d))
        if act == "lips-regen" and method == "POST":                # bouches calculees : redessiner une forme d'une image-cle (fal, prioritaire)
            if self.own_key():
                raise ValueError("régénérer une bouche passe par la clé fal du poste : réservé à l'administrateur et aux invités VIP")
            if not settings.load()["fal"].get("key"):
                raise ValueError("pas de clé fal dans les réglages")
            vid, sh = d.get("variant") or "base", str(d.get("shape") or "").upper()
            if sh not in ("A", "O", "E", "D"):
                raise ValueError("forme de bouche inconnue")
            f = int(d.get("f", 0))
            if jobs.SCHEDULER.pending("item_lips", item=iid, variant=vid, f=f, shape=sh):
                raise ValueError("cette bouche est déjà en cours de régénération")
            jid = jobs.SCHEDULER.add("item_lips", {"item": iid, "variant": vid, "f": f, "shape": sh},
                                     "Bouche %s · image %d · %s" % (sh, f, it.get("name") or iid), target="fal", prio=0)
            return self.send_json({"job": jid})
        if act == "expr" and method == "POST":                      # expressions du visage : generer (fal) ou retirer des cartes
            from . import exprcards
            vids = [v for v in (d.get("variants") or [d.get("variant") or "base"]) if v in it["variants"]]
            if d.get("action") == "remove":
                for v in vids:
                    exprcards.remove(iid, v, d.get("exprs") or None)
                return self.send_json({"item": store.resolve(store.load_item(iid))})
            keys = [k for k in d.get("exprs") or [] if poses.expression(k)]
            if not keys:
                raise ValueError("coche au moins une expression")
            if self.own_key():
                raise ValueError("les expressions passent par la clé fal du poste : réservé à l'administrateur et aux invités VIP")
            if not settings.load()["fal"].get("key"):
                raise ValueError("pas de clé fal dans les réglages")
            made = []
            for v in vids:
                if not ((it["variants"][v].get("orbit") or {}).get("mouth")):
                    continue                                        # sans bouche suivie, pas d'image-cle ou poser l'expression
                params = {"item": iid, "variant": v, "exprs": keys}
                if jobs.SCHEDULER.pending("item_expr", item=iid, variant=v):
                    continue
                made.append(jobs.SCHEDULER.add("item_expr", params, "Expressions · %s · %s" % (
                    it.get("name") or iid, it["variants"][v].get("label") or v), target="fal", prio=1))
            if not made:
                raise ValueError("aucune pose avec une bouche suivie (montage : « Tracer la bouche »), ou déjà en calcul")
            return self.send_json({"jobs": made})
        if act == "lips-version" and method == "POST":              # bouches calculees : montrer une autre version d'une bouche regeneree
            sh = str(d.get("shape") or "").upper()
            return self.send_json({"item": jobs.lips_use_version(iid, d.get("variant") or "base", int(d.get("f", 0)), sh, int(d.get("i", 0)))})
        if act == "restore" and method == "POST":                   # remettre les images d'avant les retouches
            return self.send_json(retouch.restore(iid, d.get("variant", "base")))
        if act == "undo" and method == "POST":                      # Ctrl+Z / Ctrl+Y d'une retouche (15 pas par orbite)
            return self.send_json(retouch.undo(iid, d.get("variant", "base"), redo=bool(d.get("redo"))))
        if act == "undo":                                           # combien de pas a annuler / retablir
            return self.send_json(retouch.undo_state(iid, q.get("variant", "base")))
        if act == "budget":                                         # cout du personnage ; POST : l'humain releve son plafond
            if method == "POST":
                if (self.me or {}).get("role") != "admin" and not self.own_key():   # invite : seulement s'il paie avec sa cle
                    raise ApiError("réservé à l'administrateur", 403)
                cost.allow(iid, float(d.get("allow") or 0))
            return self.send_json(cost.summary(store.load_item(iid)))
        if act == "estimate":                                       # cout estime d'un lancement, avant de lancer
            n = int(d.get("count") or 1)
            one = cost.estimate_job(d.get("kind") or "item_pose", {"item": iid, "exprs": d.get("exprs") or [], "variant": d.get("variant")},
                                    opts["target"])
            return self.send_json({"estimate": round(one * n, 4), "each": round(one, 4), "spent": cost.spent(it),
                                   "queued": round(S.queued_cost(iid), 4), "cap": cost.cap_for(it)})
        if act == "prepare":
            n_poses = len(d.get("poses") or []) + len([c for c in d.get("custom") or [] if (c or "").strip()])
            if n_poses:                                             # le lot entier passe sous le plafond, ou rien ne part
                S.budget_check("item_pose", {"item": iid}, opts["target"], "%d pose(s)" % n_poses,
                               extra=cost.estimate_job("item_pose", {"item": iid}, opts["target"]) * (n_poses - 1))
            made = jobs.prepare(iid, orbit=d.get("orbit", True), pose_keys=d.get("poses") or [], target=opts["target"],
                                fal_key=opts["_fal_key"], prio=2 if d.get("low") else 1, own_key=opts["own_key"],
                                review=bool(d.get("review")))
            for c in d.get("custom") or []:
                if (c or "").strip():
                    made.append(S.add("item_pose", {"item": iid, "pose": "", "custom": c.strip(),
                                                    "orbit": d.get("orbit", True), "review": bool(d.get("review"))},
                                      "Pose · %s · %s" % (it["name"], c.strip()[:30]), **opts))
            return self.send_json({"jobs": made})
        if act == "orbit":
            vid = d.get("variant", "base")
            params = {"item": iid, "variant": vid}
            for k in ("seed", "length", "megapixels", "studio", "no_sheet"):
                if d.get(k):
                    params[k] = d[k]
            return self.send_json({"job": S.add("item_orbit", params, "Orbite · %s · %s" % (
                it["name"], it["variants"][vid]["label"]), **opts)})
        if act == "sheet" and d.get("ok"):                          # planche validee a la main : la tournette part
            store.mutate_item(iid, lambda x: x.update(sheet_wait=False))
            return self.send_json({"job": S.add("item_orbit", {"item": iid, "variant": "base"}, "Orbite · %s · Base" % it["name"], **opts)})
        if act == "sheet":                                          # planche de vues d'un personnage (dos, profil...)
            return self.send_json({"job": S.add("item_sheet", {"item": iid, "redo": bool(d.get("redo")), "gate": bool(d.get("gate"))},
                                                "Planche de vues · %s" % it["name"], **opts)})
        if act == "apose" and method == "POST":                     # fiche sur fond de couleur : pose en A (+ base), a valider
            a = d.get("action", "make")
            if a == "make":
                if it["kind"] != "character" or it.get("body"):
                    raise ApiError("la pose en A ne concerne que les personnages qui ont leur propre image")
                return self.send_json({"job": S.add("item_apose", {"item": iid, "key": d.get("key", "vert"), "seed": d.get("seed")},
                                                    "Pose en A · %s" % it["name"], **opts)})
            if a == "ok":
                try:
                    return self.send_json(store.resolve(jobs.apose_validate(iid)))
                except ValueError as e:
                    raise ApiError(str(e))
            if a == "drop":                                         # retour au detourage habituel (les poses deja faites restent)
                def off(x):
                    x.pop("key", None)
                    x.pop("apose", None)
                    x["variants"]["base"].pop("keyimg", None)
                return self.send_json(store.resolve(store.mutate_item(iid, off)))
            raise ApiError("action inconnue : %s" % a)
        if act == "views" and method == "POST":                     # vues d'une pose sur fond de couleur (3 images), a valider
            vid = d.get("variant", "base")
            if not (it["variants"].get(vid) or {}).get("keyimg"):
                raise ApiError("cette pose n'est pas sur fond de couleur")
            return self.send_json({"job": S.add("item_views", {"item": iid, "variant": vid}, "Vues · %s · %s" % (
                it["name"], it["variants"][vid].get("label") or vid), **opts)})
        if act == "cut":
            vid = d.get("variant", "base")
            return self.send_json({"job": S.add("item_cut", {"item": iid, "variant": vid},
                                                "Détourage · %s" % it["name"], **opts)})
        if act == "snaps":
            vid = d.get("variant", "base")

            def apply(x):
                x["variants"][vid]["orbit"]["snaps"] = {k: int(v) for k, v in (d.get("snaps") or {}).items()}
            return self.send_json(store.mutate_item(iid, apply))
        if act == "review" and method == "POST":                    # poses a valider : garder (orbite), refaire, tout garder
            return self.send_json(self._review(iid, it, d, opts))
        if act == "variant" and method == "DELETE" and len(seg) == 3 and seg[2] != "base":
            def drop(x):
                x["variants"].pop(seg[2], None)
                if x.get("cover") == seg[2]:                        # la principale supprimee : retour a « base »
                    x.pop("cover", None)
            return self.send_json(store.mutate_item(iid, drop))
        raise ApiError("route inconnue", 404)

    def _lips(self, iid, it, d):
        """Retouche d'une image-cle des bouches calculees (tools/levres.py) depuis le montage. d = {variant, f (image-cle),
        x, y, s (place et taille de la carte, pixels de l'orbite), cards: {A: "data:image/png;base64,..."} (cartes
        regommees), original (true : remettre les cartes d'origine)}. La premiere retouche d'une carte garde l'originale
        dans lips/orig/ ; lips.json est sauvegarde dans data/backup/. Rend {item}."""
        import base64
        from PIL import Image
        vid = d.get("variant") or "base"
        o = (it["variants"].get(vid) or {}).get("orbit") or {}
        folder = store.item_dir(iid) / o["dir"] if o.get("dir") else None
        if not folder or not (folder / "lips.json").exists():
            raise ApiError("cette pose n'a pas de bouches calculées")
        data = json.loads((folder / "lips.json").read_text(encoding="utf-8"))
        key = next((k for k in data.get("keys", []) if int(k.get("f", -1)) == int(d.get("f", -2))), None)
        if not key:
            raise ApiError("image-clé introuvable")
        bk = settings.DATA / "backup" / ("lips_%s_%s_%s.json" % (iid, vid, time.strftime("%Y%m%d_%H%M%S")))
        bk.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(folder / "lips.json", bk)
        orig = folder / "lips" / "orig"
        if d.get("original"):
            for rel in key.get("cards", {}).values():
                src = orig / Path(rel).name
                if src.exists():
                    shutil.copyfile(src, folder / rel)
            if key.get("orig_box"):
                key["x"], key["y"], key["s"] = key.pop("orig_box")
        else:
            box = [key.get("x"), key.get("y"), key.get("s")]
            for name in ("x", "y", "s"):
                if d.get(name) is not None:
                    v = int(round(float(d[name])))
                    key[name] = max(8, min(4096, v)) if name == "s" else max(-4096, min(8192, v))
            if [key.get("x"), key.get("y"), key.get("s")] != box:
                key.setdefault("orig_box", box)
            for shape, url in (d.get("cards") or {}).items():
                rel = key.get("cards", {}).get(shape)
                if not rel or not isinstance(url, str) or "," not in url:
                    continue
                dest = store.safe(folder, rel)
                orig.mkdir(parents=True, exist_ok=True)
                if not (orig / dest.name).exists():
                    shutil.copyfile(dest, orig / dest.name)
                im = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGBA")
                im.save(dest, "WEBP", lossless=True)
        (folder / "lips.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        stamp = int(time.time() * 1000)

        def fn(x):
            oo = (x["variants"].get(vid) or {}).get("orbit") or {}
            if oo.get("dir") == o["dir"]:
                oo["lips"] = stamp
        return {"item": store.resolve(store.mutate_item(iid, fn))}

    def _save_guides(self, d):
        """Images guides d'une generation (data:image/... en base64) : le croquis et jusqu'a 15 references de style, rangees
        dans data/refs/. Rend {"sketch": chemin, "refs": [chemins]} (chemins relatifs a data/)."""
        import base64
        from PIL import Image
        out, folder = {}, settings.DATA / "refs"

        def keep(uri, name):
            if not isinstance(uri, str) or not uri.startswith("data:image/") or "," not in uri:
                raise ApiError("image guide illisible")
            raw = base64.b64decode(uri.split(",", 1)[1])
            try:
                im = Image.open(io.BytesIO(raw))
                im.load()
            except Exception:
                raise ApiError("image guide illisible")
            folder.mkdir(parents=True, exist_ok=True)
            p = folder / ("%d_%s.png" % (int(time.time() * 1000), name))
            im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(p)
            return "refs/" + p.name
        if d.get("sketch"):
            out["sketch"] = keep(d["sketch"], "croquis")
        refs = [r for r in (d.get("refs") or []) if r][:16 - len(out)]
        if refs:
            out["refs"] = [keep(r, "ref%02d" % i) for i, r in enumerate(refs)]
        return out

    def _mouth(self, iid, it, method, d):
        """Bouche du dessin (jeu « trace » du lip sync) : POST {variant, f, line} accroche la bouche au trait trace sur
        l'image f de l'orbite et la suit (mouthfind.track ecrit mouth.json dans le dossier de l'orbite) ; DELETE la retire.
        Rend {frames (images suivies, 0 = rien trouve), item}."""
        vid = d.get("variant") or d.get("v") or "base"
        o = (it["variants"].get(vid) or {}).get("orbit") or {}
        if not o.get("dir") or not o.get("n"):
            raise ApiError("cette variante n'a pas d'orbite")
        folder = store.item_dir(iid) / o["dir"]

        def mark(on):
            def fn(x):
                oo = (x["variants"].get(vid) or {}).get("orbit") or {}
                if oo.get("dir") != o["dir"]:                       # une nouvelle orbite est arrivee entre-temps
                    return
                if on:
                    oo["mouth"], oo["mt"] = True, int(time.time() * 1000)
                else:
                    oo.pop("mouth", None)
                    oo.pop("mt", None)
            return store.mutate_item(iid, fn)
        if method == "DELETE":
            (folder / "mouth.json").unlink(missing_ok=True)
            return {"frames": 0, "item": store.resolve(mark(False))}
        if not mouthfind.available():
            raise ApiError("OpenCV manque sur ce serveur : pip install opencv-python-headless")
        try:
            line = [[float(p[0]), float(p[1])] for p in d.get("line") or []]
        except (TypeError, ValueError, IndexError):
            raise ApiError("trait illisible")
        if len(line) < 2:
            raise ApiError("trace un trait d'un coin de la bouche à l'autre")
        f0 = int(d.get("f") or 0) % int(o["n"])
        got = mouthfind.track(folder, int(o["n"]), f0, line)
        if not got:
            return {"frames": 0, "item": store.resolve(store.load_item(iid))}
        back = lambda dr, oo: mouthfind.extend_back(dr, int(o["n"]), oo.get("snaps") or sprites.default_snaps(int(o["n"])))
        try:                                                        # bouche de dos : le bout des levres, apres chaque profil
            back(folder, o)
        except Exception as e:
            print("bouche de dos %s/%s : %s" % (iid, vid, e), flush=True)
        mark(True)
        # les autres poses du personnage qui n'ont pas encore de bouche partent de celle-ci : le visage y est retrouve et
        # le trait reporte. Une pose deja tracee a la main n'est pas touchee.
        carried = {}
        for k, v in it["variants"].items():
            oo = v.get("orbit") or {}
            if k == vid or not oo.get("dir") or oo.get("mouth") or int(oo.get("n") or 0) != int(o["n"]):
                continue
            dst = store.item_dir(iid) / oo["dir"]
            try:
                r = mouthfind.carry(folder, f0, line, dst, int(o["n"]))
                if r and mouthfind.track(dst, int(o["n"]), f0, r[0], need_ink=True):
                    carried[k] = oo["dir"]
                    back(dst, oo)
            except Exception as e:                                  # une pose qui rate ne doit pas faire echouer le trace
                print("bouche reportee sur %s/%s : %s" % (iid, k, e), flush=True)

        def fn(x):
            for k, dr in carried.items():
                oo = (x["variants"].get(k) or {}).get("orbit") or {}
                if oo.get("dir") == dr:
                    oo["mouth"], oo["mt"] = True, int(time.time() * 1000)
        item = store.mutate_item(iid, fn) if carried else store.load_item(iid)
        return {"frames": got, "poses": len(carried), "item": store.resolve(item)}

    def _partbanks(self, method, seg, q, data, body):
        """Banques d'elements (Banque Claude = la banque d'origine) et elements dessines en calques, PNG transparent."""
        from . import partbanks as pb
        bank = q.get("bank") or pb.CLAUDE
        try:
            if seg[1:2] == ["banks"]:
                if method == "POST":
                    return self.send_json(pb.add_bank((data or {}).get("name", "")))
                if method == "PUT" and len(seg) == 3:
                    return self.send_json(pb.rename_bank(seg[2], (data or {}).get("name", "")))
                if method == "DELETE" and len(seg) == 3:
                    return self.send_json(pb.remove_bank(seg[2]))
                return self.send_json(pb.banks())
            if seg[1:2] == ["heads"] and method == "POST":
                return self.send_json(pb.add_head(body or b"", q.get("name", "")))
            if seg[1:2] == ["assets"] and method == "POST":
                return self.send_json(pb.add_asset(body or b""))
            if len(seg) == 2 and method == "POST":                  # corps brut = PNG transparent couvrant le cadre
                if not body:
                    raise ApiError("dessin manquant")
                return self.send_json(pb.save_raw(bank, seg[1], q.get("name", ""), body, replace=q.get("replace") or None, fill=q.get("fill") == "1"))
            if len(seg) == 3 and method == "GET":
                return self.send_json(pb.drawn(bank, seg[1], seg[2]))
            if len(seg) == 3 and method == "PUT":
                return self.send_json(pb.save_meta(bank, seg[1], seg[2], data or {}))
            if len(seg) == 3 and method == "DELETE":
                pb.remove(bank, seg[1], seg[2])
                return self.send_json({"ok": True})
            return self.send_json(pb.catalogue(bank, q.get("kit") or "visage"))
        except ValueError as e:
            raise ApiError(str(e), 400)

    def _transpose(self, d):
        """« Transposer » : les points d'un portrait (reperes dans le navigateur, la photo ne vient pas ici) -> visage, yeux,
        sourcils, nez, bouche traces a leurs cotes, ranges dans data/parts/_t-<id>/ (pas une categorie : 30 gardes)."""
        from . import transpose
        pts = d.get("points")
        if not isinstance(pts, list) or len(pts) < 468:
            raise ApiError("aucun visage repéré sur cette image")
        cotes, etat = transpose.fit(pts, d.get("shapes") or {}, d.get("matrix") or None)
        if abs(etat.get("lacet", 0)) > 6 or abs(etat.get("tangage", 0)) > 14:
            raise ApiError("visage tourné (%d° de côté, %d° en hauteur) : il faut un portrait bien de face, ni de profil ni de trois quarts"
                           % (round(etat.get("lacet", 0)), round(etat.get("tangage", 0))))
        root = store._dir("parts")
        tid = "%d" % time.time_ns()
        folder = root / ("_t-" + tid)
        folder.mkdir(parents=True, exist_ok=True)
        calques = []
        for cat in ("visage", "yeux", "sourcils", "nez", "bouche"):
            if cat not in cotes:
                continue
            im, place = transpose.draw(cat, cotes[cat])
            im.save(folder / (cat + ".png"))
            calques.append({"cat": cat, "file": "_t-%s/%s.png" % (tid, cat), "place": [float(v) for v in place], "name": "Transposé"})
        for old in sorted(root.glob("_t-*"), key=lambda p: p.stat().st_mtime)[:-30]:   # menage : les 30 derniers
            shutil.rmtree(old, ignore_errors=True)
        _, M = transpose.frame(pts)
        return {"etat": etat, "calques": calques, "photo": [[float(v) for v in row] for row in M]}

    def _keep_identikit(self, iid, comp):
        """Composition d'un portrait-robot gardee dans son element : les elements transposes (data/parts/_t-*, menage a 30)
        sont recopies dans data/parts/_keep-<id>/ pour survivre au menage ; de meme les elements des banques de David
        (_banks/…) et les tetes du generateur de corps (_tetes/…), qui survivent ainsi a une banque supprimee."""
        if not isinstance(comp, dict) or not isinstance(comp.get("layers"), list):
            raise ApiError("composition du portrait-robot illisible")
        root = store._dir("parts")
        for l in comp["layers"]:
            f = str(l.get("file") or "")
            if not f.startswith(("_t-", "_banks/", "_tetes/")):
                continue
            src = store.safe(root, f)
            tag = f.split("/")[0][3:] if f.startswith("_t-") else "-".join(f.split("/")[:-1])
            dest = root / ("_keep-" + iid) / ("%s-%s" % (tag, Path(f).name))
            if src.is_file():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest)
            if dest.is_file():
                l["file"] = "_keep-%s/%s" % (iid, dest.name)
        return comp

    def _realistic(self, d):
        """Le portrait-robot affiche (data:image/png) rendu en photo par GPT Image 2.6 Sunburst sur fal, avec la consigne donnee.
        Payant (≈ 0,06 $ par image en 1024, qualite haute). Rend {"image": data URI PNG}."""
        import base64
        from . import falapi
        key = self.headers.get("X-Fal-Key") or ("" if self.own_key() else settings.load()["fal"].get("key") or "")
        if not key:
            raise ApiError("aucune clé fal : entre ta clé dans Réglages › fal (cloud)")
        uri, prompt = d.get("image") or "", (d.get("prompt") or "").strip()
        if not uri.startswith("data:image/") or "," not in uri or not prompt:
            raise ApiError("image ou consigne manquante")
        from PIL import Image
        try:
            im = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
            im.load()
        except Exception:
            raise ApiError("image guide illisible")
        folder = settings.DATA / "refs"
        folder.mkdir(parents=True, exist_ok=True)
        stamp = int(time.time() * 1000)
        src = folder / ("%d_portrait.png" % stamp)
        im.convert("RGB").save(src)
        w, h = im.size
        k = 1024 / max(w, h)                                         # taille de sortie : multiples de 16, cote long 1024
        w, h = max(256, int(round(w * k / 16)) * 16), max(256, int(round(h * k / 16)) * 16)
        job = {"progress": "", "params": {}}
        fp = falapi.FalProvider(key, job)
        model = REALISTIC_MODELS.get(d.get("model") or "gpt")
        if not model:
            raise ApiError("modèle inconnu")
        payload = fp._image_payload(model, prompt, w, h, 0)
        if "seedream" in model:                                     # Seedream 5.5 : au moins 921 600 pixels ; taille deduite de l'image
            payload.update({"image_size": "auto_1.5K", "background": "opaque", "output_format": "png"})
        payload["image_urls"] = [fp.upload(src)]
        out = fp.run(model, payload)
        dest = fp.fetch(out["images"][0]["url"], folder / ("%d_photo_%s.png" % (stamp, d.get("model") or "gpt")))
        raw = Path(dest).read_bytes()
        res = {"image": "data:image/png;base64," + base64.b64encode(raw).decode(), "file": "refs/" + Path(dest).name}
        if d.get("project") and d.get("panel"):                      # photo d'une case : rangee aussi dans le storyboard
            pdir = store.project_dir(d["project"])
            rel = "integ/%s_%d_photo-%s.png" % (re.sub(r"[^\w-]", "", str(d["panel"])), stamp // 1000, re.sub(r"[^\w-]", "", d.get("model") or "gpt"))
            (pdir / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(dest, pdir / rel)
            res["rel"] = rel
        return res

    def _rebase(self, iid, raw):
        """Remplace l'image de base d'un personnage (portrait-robot reedite). Rien n'est relance : le detourage et l'orbite
        de base sont retires (l'ancienne image et l'ancienne variante sont gardees dans data/backup/rebase/), les poses
        gardent l'ancien visage."""
        if not raw:
            raise ApiError("image manquante")
        d = store.item_dir(iid)
        it = store.load_item(iid)
        back = settings.DATA / "backup" / "rebase" / iid / time.strftime("%Y%m%d-%H%M%S")
        back.mkdir(parents=True, exist_ok=True)
        for rel in ("v/base/ref.png", "thumb.jpg"):
            if (d / rel).is_file():
                shutil.copyfile(d / rel, back / Path(rel).name)
        (back / "base.json").write_text(json.dumps(it["variants"].get("base"), ensure_ascii=False, indent=1), encoding="utf-8")
        tmp = settings.DATA / "tmp" / ("rebase_%d.png" % (time.time() * 1000))
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(raw)
        try:
            w, h = sprites.normalize(tmp, d / "v/base/ref.png")
            sprites.thumb(d / "v/base/ref.png", d / "thumb.jpg")
        finally:
            tmp.unlink(missing_ok=True)

        def apply(x):
            x.update({"w": w, "h": h})
            x["sheet"] = {}                                         # planche de vues de l'ancien visage : refaite avant la prochaine orbite
            b = x["variants"]["base"]
            b.update({"cut": None, "orbit": None, "t": int(time.time())})
        return store.resolve(store.mutate_item(iid, apply))

    def _compose(self, raw, nom):
        """Personnage entier : la tete envoyee par l'atelier sur le corps `nom` (bodydraw), fond blanc. Rend le PNG."""
        from . import bodydraw
        from PIL import Image
        if not raw:
            raise ApiError("image manquante")
        names = {store.slug(n): n for n, _ in bodydraw.CORPS_VARIANTES}
        if store.slug(nom) not in names:
            raise ApiError("corps inconnu : %s" % nom)
        tete = Image.open(io.BytesIO(raw)).convert("RGBA")
        if tete.size != (1000, 1300):
            tete = tete.resize((1000, 1300), Image.LANCZOS)
        out = bodydraw.personnage(tete, nom=names[store.slug(nom)])
        flat = Image.new("RGB", out.size, "white")
        flat.paste(out, mask=out.split()[3])
        buf = io.BytesIO()
        flat.save(buf, "PNG")
        img = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(img)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(img)

    def _review(self, iid, it, d, opts):
        """Validation des poses avant leur orbite. action : keep (la pose part en orbite), keep_all (toutes celles qui
        attendent, pas les ecartees), redo (nouvelle generation de la pose, autre graine)."""
        import random
        S = jobs.SCHEDULER
        act, made = d.get("action"), []
        # keep_all : toutes celles qui attendent ; keep_rejected : toutes les ecartees, repechees d'un coup (comme « Repêcher »)
        want = {"keep_all": "pending", "keep_rejected": "rejected"}.get(act)
        vids = [k for k, v in it["variants"].items() if (v.get("review") or {}).get("state") == want] if want else [d.get("variant")]
        if act == "keep_rejected":
            act = "keep_all"
        for vid in vids:
            v = it["variants"].get(vid)
            if not v or (vid == "base" and act not in ("views_ok", "views_redo", "view_drop")):
                raise ApiError("variante inconnue : %s" % vid)
            if act == "view_drop":                                  # une vue fautive ecartee : l'orbite se fera avec les autres
                def drop_view(x, vid=vid):
                    (x["variants"][vid].get("sheet") or {}).pop(d.get("view"), None)
                store.mutate_item(iid, drop_view)
                continue
            if act in ("views_ok", "views_redo"):                  # fond de couleur : les vues d'une pose, vues avant son orbite
                if act == "views_redo":
                    made.append(S.add("item_views", {"item": iid, "variant": vid, "seed": random.randint(1, 10 ** 6)},
                                      "Vues · %s · %s" % (it["name"], v.get("label") or vid), **opts))
                    continue
                store.mutate_item(iid, lambda x, vid=vid: x["variants"][vid].__setitem__("views", dict(x["variants"][vid].get("views") or {}, state="ok")))
                if not S.pending("item_orbit", item=iid, variant=vid):
                    made.append(S.add("item_orbit", {"item": iid, "variant": vid}, "Orbite · %s · %s" % (it["name"], v.get("label") or vid), **opts))
                continue
            if act in ("keep", "keep_all"):
                store.mutate_item(iid, lambda x, vid=vid: x["variants"][vid].pop("review", None))
                if v.get("keyimg") and it.get("key") and not v.get("orbit") and v.get("sheet"):
                    # vues deja la (tirees ailleurs, Dzine) : rien a retirer, elles attendent leur validation ; seul
                    # « Refaire les vues » relance un tirage
                    store.mutate_item(iid, lambda x, vid=vid: x["variants"][vid].__setitem__(
                        "views", dict(x["variants"][vid].get("views") or {}, state=(x["variants"][vid].get("views") or {}).get("state") or "pending")))
                elif v.get("keyimg") and it.get("key") and not v.get("orbit"):   # fond de couleur : d'abord ses vues, a valider
                    if not S.pending("item_views", item=iid, variant=vid):
                        made.append(S.add("item_views", {"item": iid, "variant": vid}, "Vues · %s · %s" % (it["name"], v.get("label") or vid), **opts))
                elif not v.get("orbit") and not S.pending("item_orbit", item=iid, variant=vid):
                    made.append(S.add("item_orbit", {"item": iid, "variant": vid}, "Orbite · %s · %s" % (it["name"], v.get("label") or vid), **opts))
            elif act == "redo":
                params = {"item": iid, "pose": v.get("pose", ""), "variant": vid, "orbit": True, "review": True, "seed": random.randint(1, 10 ** 6)}
                if not v.get("pose"):
                    params["custom"] = v.get("custom") or v.get("label") or ""
                made.append(S.add("item_pose", params, "Pose · %s · %s" % (it["name"], v.get("label") or vid), **opts))
                store.mutate_item(iid, lambda x, vid=vid: x["variants"][vid].__setitem__("review", dict(x["variants"][vid].get("review") or {}, state="redo")))
            else:
                raise ApiError("action inconnue : %s" % act)
        return {"jobs": made, "item": store.resolve(store.load_item(iid))}

    def _follow(self, q):
        return {"target": q.get("target", "auto"), "fal_key": self.headers.get("X-Fal-Key") or None,
                "prio": 2 if q.get("low") else 1, "own_key": self.own_key()}

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
                    # un autre onglet (ou un autre appareil) a enregistre apres la version que celui-ci connait : on
                    # refuse, sinon son vieil etat ecraserait le travail fait ailleurs
                    cid, ui = (data or {}).pop("_cid", None), old.get("ui") or {}
                    if int((data or {}).get("rev", 0)) < int(ui.get("rev", 0)) and ui.get("cid") != cid:
                        raise ApiError("ce storyboard a été modifié dans un autre onglet ou sur un autre appareil : "
                                       "recharge la page avant de continuer, pour ne pas écraser ce travail", 409)
                    new = merge_project(data, old)
                    new["id"] = pid
                    new["ui"] = {"cid": cid, "rev": int(new.get("rev", 0)) + 1}
                    return self.send_json(store.save_project(new))
            if method == "DELETE":
                store.delete_project(pid)
                return self.send_json({"ok": True})
            return self.send_json(store.load_project(pid))
        if seg[1] == "history":                                     # versions gardees du storyboard
            if method == "POST":
                return self.send_json(store.restore_project(pid, (data or {}).get("file", "")))
            return self.send_json(store.project_history(pid))
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
        if act == "tts" and method == "POST":                      # voix generee par ElevenLabs, rangee comme une voix importee
            cfg = settings.load().get("elevenlabs") or {}
            try:
                mp3 = eleven.speak(self.eleven_key(), d.get("voice"), d.get("text"), cfg.get("model"))
            except eleven.ElevenError as e:
                raise ApiError(str(e), 400)
            dest = pdir / "assets" / ("voix_%d.mp3" % (time.time() * 1000))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(mp3)
            text = (d.get("text") or "").strip()
            entry = store.add_audio(mp3, (d.get("name") or text[:40] or "voix") + ".mp3", "elevenlabs", text, d.get("voice_name") or "")
            return self.send_json({"file": "assets/" + dest.name, "audio": entry["id"]})
        if act == "audio-from" and method == "POST":               # reprendre un son de la banque audio dans ce storyboard
            entry = store.audio_entry(d.get("id", ""))
            src = store.safe(store._dir("audio"), entry["file"])
            dest = pdir / "assets" / ("voix_%d%s" % (time.time() * 1000, src.suffix))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())
            return self.send_json({"file": "assets/" + dest.name, "name": entry["name"]})
        if act == "audio" and method == "POST":                    # voix d'un personnage (fichier importe ou micro)
            ext = Path(q.get("name", "voix.webm")).suffix.lower()
            if ext not in (".webm", ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".aac", ".flac", ".mp4"):
                ext = ".webm"
            if not body or len(body) > 80 * 1024 * 1024:
                return self.send_json({"error": "fichier son vide ou trop gros (80 Mo au plus)"}, 400)
            dest = pdir / "assets" / ("voix_%d%s" % (time.time() * 1000, ext))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            entry = store.add_audio(body, q.get("name", "voix" + ext), q.get("source", "import"))     # aussi dans la banque audio
            return self.send_json({"file": "assets/" + dest.name, "audio": entry["id"]})
        if act == "flat" and method == "POST":                     # la case aplatie par le navigateur (PNG)
            panel = re.sub(r"[^\w-]", "", seg[2])
            rel = "flat/%s_%d.png" % (panel, time.time())
            (pdir / rel).parent.mkdir(parents=True, exist_ok=True)
            (pdir / rel).write_bytes(body)
            return self.send_json({"file": rel})
        if act == "integrate" and method == "POST":
            store.safe(pdir, d["flat"])
            opts = self.job_opts(d)
            eng = d.get("engine") if d.get("engine") is not None else (settings.load()["render"].get("integrate_engine") or "")
            params = {"project": pid, "panel": d["panel"], "flat": d["flat"], "style": d.get("style", "photo"),
                      "prompt": d.get("prompt", ""), "extra": d.get("extra", "")}
            if eng == "local":                                      # moteur choisi pour Integrate : il passe avant la cible generale
                opts["target"] = "local"
            elif eng.startswith("fal:") and eng[4:].strip():
                opts["target"] = "fal"
                params["edit_model"] = eng[4:].strip()
            jid = S.add("panel_integrate", params, "Integrate · case %s" % d["panel"], **opts)
            return self.send_json({"job": jid})
        if act == "orbit" and method == "POST":
            store.safe(pdir, d["flat"])
            jid = S.add("panel_orbit", {"project": pid, "panel": d["panel"], "flat": d["flat"], "prompt": str(d.get("prompt") or "")[:4000]},
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
