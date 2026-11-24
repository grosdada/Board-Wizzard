"""Toutes les generations IA, gardees a part : data/generations/AAAA-MM-JJ/HHMMSS_<ce que c'est>_<fichier>.

Chaque image ou video rendue par fal ou par une machine ComfyUI y est copiee des qu'elle arrive, qu'elle serve ou non,
qu'on la telecharge ou non. On y recupere tout (Reglages › Generations IA, ou le dossier lui-meme). Rien n'y est jamais
efface par l'application."""
import re
import shutil
import threading
import time
from pathlib import Path

from . import settings

_lock = threading.Lock()
MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"}


def root():
    return settings.DATA / "generations"


def _slug(s, n=48):
    s = re.sub(r"[^\w\-]+", "-", str(s or ""), flags=re.UNICODE).strip("-_")
    return s[:n] or "gen"


def _dest(what, name):
    d = root() / time.strftime("%Y-%m-%d")
    d.mkdir(parents=True, exist_ok=True)
    stem, ext = Path(name).stem, Path(name).suffix.lower() or ".png"
    base = "%s_%s_%s" % (time.strftime("%H%M%S"), _slug(what), _slug(stem, 24))
    p, k = d / (base + ext), 1
    while p.exists():
        k += 1
        p = d / ("%s_%d%s" % (base, k, ext))
    return p


def keep(src, what=""):
    """Copie un fichier rendu dans l'archive. Ne leve jamais : l'archive ne doit pas faire echouer un calcul."""
    try:
        src = Path(src)
        if not src.is_file() or src.suffix.lower() not in MEDIA:
            return None
        with _lock:
            p = _dest(what, src.name)
            shutil.copyfile(src, p)
        return p
    except Exception:
        return None


def keep_bytes(raw, what="", name="image.png"):
    try:
        if not raw:
            return None
        with _lock:
            p = _dest(what, name)
            p.write_bytes(raw)
        return p
    except Exception:
        return None


def listing(limit=600):
    """Les plus recentes d'abord : [{"path": "AAAA-MM-JJ/nom", "size", "t"}]."""
    r = root()
    if not r.is_dir():
        return []
    out = []
    for day in sorted((d for d in r.iterdir() if d.is_dir()), reverse=True):
        for f in sorted(day.iterdir(), key=lambda x: x.name, reverse=True):
            if f.is_file() and f.suffix.lower() in MEDIA:
                out.append({"path": "%s/%s" % (day.name, f.name), "size": f.stat().st_size, "t": f.stat().st_mtime})
                if len(out) >= limit:
                    return out
    return out
