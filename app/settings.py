"""Reglages locaux (local_settings.json a la racine, jamais dans le depot) fusionnes sur DEFAULTS.

Dossier des donnees (banque + storyboards) : variable d'environnement BW_DATA, sinon « data » a la racine.
Sur un VPS : server.host = "0.0.0.0", aucune machine ComfyUI, chaque utilisateur donne sa cle fal dans son navigateur.
"""

import copy
import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "local_settings.json"
DATA = Path(os.environ.get("BW_DATA") or ROOT / "data")
_lock = threading.Lock()

DEFAULTS = {
    "server": {"host": "127.0.0.1", "port": 8795},
    # machines ComfyUI : [{"name": "...", "url": "http://ip:8188", "enabled": true}]
    "workers": [],
    # reglages de Workflows Q-builder : ses machines (comfy_nodes) sont reprises telles quelles
    "qbuilder_settings": "",
    "fal": {
        "key": "",                       # cle du poste ; un collegue peut donner la sienne dans son navigateur
        "concurrency": 10,                             # calculs fal en meme temps
        "orbit": "minimax/h3/image-to-video/lora",
        "orbit_resolution": "768P",                    # 480P (le moins cher), 768P, 2K, 4K
        "edit": "fal-ai/qwen-image-edit-plus",
        "t2i": "fal-ai/z-image/turbo",
        "matte": "fal-ai/birefnet/v2",
        "matte_video": "fal-ai/birefnet/v2/video",
    },
    "elevenlabs": {"key": "", "model": "eleven_multilingual_v2"},      # voix de synthese du montage (lip sync)
    "render": {
        "target": "auto",                # local | fal | auto (machines d'abord, fal si aucune)
        "orbit_length": 73,              # images a 24 i/s, forme 17k+5 : 73 = 3 s, 124 = 5,2 s
        "sheet": True,                   # planche de vues (dos, profil) avant l'orbite d'un personnage
        "megapixels": 0.6,
        "steps": 28,
        "seed": 904231,
        "frame_height": 720,             # hauteur des images detourees gardees dans la banque
    },
}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load():
    with _lock:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
    return _merge(DEFAULTS, raw)


def save(patch):
    with _lock:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
        if (patch.get("fal") or {}).get("key", "").startswith("••"):     # cle masquee renvoyee telle quelle
            patch["fal"].pop("key")
        if (patch.get("elevenlabs") or {}).get("key", "").startswith("••"):
            patch["elevenlabs"].pop("key")
        if (patch.get("server") or {}).get("password", "").startswith("••"):
            patch["server"].pop("password")
        raw = _merge(raw, patch)
        if "workers" in patch:
            raw["workers"] = patch["workers"]
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, FILE)
    return load()


def workers():
    """Machines ComfyUI actives : celles des reglages + celles de Q-builder (sans doublon d'adresse)."""
    s = load()
    out, seen = [], set()

    def add(name, url, enabled=True):
        url = (url or "").strip().rstrip("/")
        if url and url not in seen and enabled:
            seen.add(url)
            out.append({"name": name or url, "url": url})

    for w in s["workers"]:
        add(w.get("name"), w.get("url"), w.get("enabled", True))
    qb = s.get("qbuilder_settings")
    if qb:
        try:
            for n in json.loads(Path(qb).read_text(encoding="utf-8")).get("comfy_nodes", []):
                add(n.get("name"), n.get("url"), n.get("auto", True))
        except (OSError, ValueError):
            pass
    return out


def public():
    s = load()
    key = s["fal"].get("key") or ""
    s["fal"]["key"] = ("••••" + key[-4:]) if key else ""
    ekey = (s.get("elevenlabs") or {}).get("key") or ""
    s.setdefault("elevenlabs", {})["key"] = ("••••" + ekey[-4:]) if ekey else ""
    if s["server"].get("password"):
        s["server"]["password"] = "••••"
    s["data"] = str(DATA)
    return s
