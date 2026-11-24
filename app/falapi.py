"""Fournisseur fal.ai : memes quatre gestes que la machine locale (t2i, edit, matte, orbit), par la file fal.

Ecrit d'apres la documentation publique de fal (schemas OpenAPI des modeles, novembre 2026) et le client d'Alive-Comics
pour H3. Essaye avec une vraie cle le 17/11/2026 : cle, image (t2i), envoi de fichier et detourage d'image. L'orbite H3 +
LoRA et la video de masque BiRefNet aussi (480P, 5 s, 198 s). Reste a valider : l'edition. Les modeles se choisissent dans les reglages (fal.orbit, fal.edit, fal.t2i...).
"""

import json
import mimetypes
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import comfy, cost, settings

QUEUE = "https://queue.fal.run/"
ORBIT_LORA = {"path": "pablodawson/MiniMax-H3-360-Orbit-LoRA", "weight_name": "minimax_h3_flf2v_lora_v1.safetensors",
              "scale": 1.0}
NO_SEED = ("flux-3", "seedream", "gpt-image", "nano-banana")
RATIO_MODELS = ("nano-banana", "flux-3")


class FalError(RuntimeError):
    pass


def _req(url, key, payload=None, method=None, raw=None, headers=None, timeout=120):
    h = {"Accept": "application/json"}
    if key:
        h["Authorization"] = "Key " + key
    data = raw
    if payload is not None:
        data = json.dumps(payload).encode()
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        if e.code in (401, 403):
            raise FalError("fal refuse la clé (%d) : %s" % (e.code, detail))
        raise FalError("fal %d : %s" % (e.code, detail))
    try:
        return json.loads(body.decode("utf-8") or "null")
    except ValueError:
        return None


def _ratio(w, h):
    best, name = 9, "1:1"
    for n in ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"):
        a, b = n.split(":")
        d = abs(w / h - int(a) / int(b))
        if d < best:
            best, name = d, n
    return name


class FalProvider:
    name = "fal"

    def __init__(self, key, job):
        if not key:
            raise FalError("aucune clé fal : entre ta clé dans Réglages › fal (cloud) › « Ma clé (ce navigateur) »")
        self.key, self.job = key, job
        self.cfg = settings.load()["fal"]

    # ---- transport
    def upload(self, path):
        path = Path(path)
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        res = _req("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", self.key,
                   {"file_name": path.name, "content_type": mime})
        _req(res["upload_url"], None, raw=path.read_bytes(), method="PUT", headers={"Content-Type": mime}, timeout=600)
        return res["file_url"]

    def run(self, endpoint, payload):
        from .jobs import Cancelled
        # cout : estime d'apres la table des reglages, verifie contre le plafond du personnage AVANT l'appel, compte apres
        item = ((self.job or {}).get("params") or {}).get("item")
        usd = cost.fal_price(endpoint, payload)
        what = "fal · " + endpoint.strip("/").split("/", 1)[-1]
        cost.check(item, usd, what)
        sub = _req(QUEUE + endpoint.strip("/"), self.key, payload)
        while True:
            if self.job.get("_cancel"):
                try:
                    _req(sub["cancel_url"], self.key, method="PUT")
                except FalError:
                    pass
                raise Cancelled()
            st = _req(sub["status_url"], self.key)
            if st.get("status") == "COMPLETED":
                if st.get("error"):
                    raise FalError("fal : %s" % st["error"])
                break
            self.job["progress"] = "fal : " + {"IN_QUEUE": "en file", "IN_PROGRESS": "en calcul"}.get(st.get("status"), "…")
            time.sleep(3)
        out = _req(sub["response_url"], self.key)
        cost.add(item, usd, what)                                  # le calcul a eu lieu : il est facture, image utile ou non
        if isinstance(out, dict) and out.get("detail") and not any(k in out for k in ("images", "image", "video")):
            raise FalError("fal : %s" % json.dumps(out["detail"])[:500])
        return out

    @staticmethod
    def fetch(url, dest):
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=600) as r:
            dest.write_bytes(r.read())
        return dest

    def _image_payload(self, endpoint, prompt, w, h, seed):
        p = {"prompt": prompt}
        if any(m in endpoint for m in RATIO_MODELS):
            p["aspect_ratio"] = _ratio(w, h)
        else:
            p["image_size"] = {"width": int(w), "height": int(h)}
        if not any(m in endpoint for m in NO_SEED):
            p["seed"] = int(seed) % 2147483647
        if "gpt-image-2.6" in endpoint:                          # portrait-robot en photo : qualite haute (≈ 0,06 $ en 1K), fond opaque
            p["quality"] = "high"
            p["background"] = "opaque"
        if "gpt-image-2.5" in endpoint:                          # qualite moyenne (≈ 0,02 $ en 1K) au lieu de « high »
            p["quality"] = self.cfg.get("gpt_quality") or "medium"
            p["background"] = "opaque"                             # sinon un PNG transparent : le fond de couleur est perdu
        if "nano-banana" in endpoint:
            p["resolution"] = "1K"                                 # en 2K le trait sort deux fois plus fin que l'original
        return p

    # ---- les quatre gestes
    def t2i(self, prompt, w, h, seed, dest_dir):
        ep = self.cfg["t2i"]
        out = self.run(ep, self._image_payload(ep, prompt, w, h, seed))
        return self.fetch(out["images"][0]["url"], Path(dest_dir) / "t2i.png")

    def edit(self, images, prompt, seed, dest_dir):
        from PIL import Image
        ep = self.cfg["edit"]
        w, h = Image.open(images[0]).size
        k = (1024 * 1024 / (w * h)) ** 0.5
        p = self._image_payload(ep, prompt, round(w * k / 16) * 16, round(h * k / 16) * 16, seed)
        p["image_urls"] = [self.upload(i) for i in images]
        out = self.run(ep, p)
        return self.fetch(out["images"][0]["url"], Path(dest_dir) / "edit.png")

    def matte(self, image, dest_dir):
        out = self.run(self.cfg["matte"], {"image_url": self.upload(image), "output_format": "png"})
        return self.fetch(out["image"]["url"], Path(dest_dir) / "cut.png")

    def orbit(self, image, length, seed, prompt, megapixels, matte, dest_dir, refs=None):
        ep = self.cfg["orbit"]
        url = self.upload(image)
        if "camera-controls" in ep or "multi-angle" in ep:        # H3 Max : trajectoire en degres, duree libre
            p = {"image_url": url, "prompt_expansion_mode": "disabled", "duration": round(length / 24, 2),
                 "resolution": self.cfg.get("orbit_resolution") or "768P", "seed": int(seed) % 2147483647,
                 "camera_trajectory": [{"time": 0, "azimuth": 0, "elevation": 0, "distance": 1},
                                       {"time": 1, "azimuth": 360, "elevation": 0, "distance": 1}]}
        else:                                                     # H3 + LoRA 360 Orbit : 5 s minimum sur fal
            p = {"prompt": (comfy.ORBIT_PROMPT + " " + prompt).strip(), "image_url": url, "end_image_url": url,
                 "duration": max(5, min(15, -(-int(length) // 24))), "resolution": self.cfg.get("orbit_resolution") or "768P",
                 "prompt_expansion_mode": "disabled", "seed": int(seed) % 2147483647, "enable_safety_checker": True}
            if ep.endswith("/lora"):
                p["loras"] = [ORBIT_LORA]
        self.job["progress"] = "fal : orbite"
        out = self.run(ep, p)
        rgb = self.fetch(out["video"]["url"], Path(dest_dir) / "orbit_rgb.mp4")
        if not matte:
            return rgb, None
        self.job["progress"] = "fal : détourage de la vidéo"
        m = self.run(self.cfg["matte_video"], {"video_url": out["video"]["url"], "output_mask": True,
                                                "video_output_type": "X264 (.mp4)"})
        mask = (m.get("mask_video") or {}).get("url")
        if not mask:
            raise FalError("fal n'a pas rendu la vidéo du masque")
        return rgb, self.fetch(mask, Path(dest_dir) / "orbit_matte.mp4")


def test(key):
    """Verifie la cle sans rien depenser : demande d'envoi de fichier (aucun calcul)."""
    _req("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", key,
         {"file_name": "test.txt", "content_type": "text/plain"})
    return True
