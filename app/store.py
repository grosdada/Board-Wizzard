"""Donnees sur disque : storyboards (projects/<id>/project.json) et banque partagee (bank/<id>/item.json).

Un element de banque (personnage, decor, asset) :
  {id, kind, name, style, tags, created, updated, source: "source.png", w, h,
   variants: {"base": {label, pose, ref: "v/base/ref.png", cut: "v/base/cut.webp"|None,
                       orbit: {n, w, h, dir: "v/base/f", ext, snaps: {axe: image}}|None}}}
  Une variante = une pose (personnage), une ambiance (decor) ou simplement « base ».
"""

import json
import os
import re
import shutil
import threading
import time
import unicodedata
import uuid

from . import settings

_lock = threading.RLock()
KINDS = ("character", "decor", "asset")


def _dir(*parts):
    return settings.DATA.joinpath(*parts)


def slug(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()[:40]
    return s or "sans-nom"


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp%s" % uuid.uuid4().hex[:6])
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def safe(base, rel):
    """Chemin sous base, ou ValueError s'il en sort."""
    p = (base / rel).resolve()
    if base.resolve() not in p.parents and p != base.resolve():
        raise ValueError("chemin refuse")
    return p


# ------------------------------------------------------------------ storyboards
def project_dir(pid):
    if not re.fullmatch(r"[a-z0-9-]{1,60}", pid or ""):
        raise ValueError("identifiant refuse")
    return _dir("projects", pid)


def list_projects():
    out = []
    root = _dir("projects")
    if root.exists():
        for d in root.iterdir():
            try:
                p = _read(d / "project.json")
                out.append({"id": p["id"], "name": p["name"], "updated": p.get("updated", 0),
                            "pages": len(p.get("pages", []))})
            except (OSError, ValueError, KeyError):
                continue
    return sorted(out, key=lambda x: -x["updated"])


def new_page(n, page, layout):
    return {"id": "pg%d" % n, "page": page, "layout": layout, "panels": {}}


def create_project(name, page, layout):
    with _lock:
        base = slug(name)
        pid, i = base, 2
        while _dir("projects", pid).exists():
            pid, i = "%s-%d" % (base, i), i + 1
        now = time.time()
        p = {"id": pid, "name": name or "Storyboard", "created": now, "updated": now, "rev": 1, "nextId": 50,
             "pages": [new_page(1, page, layout)]}
        _write(project_dir(pid) / "project.json", p)
        return p


def load_project(pid):
    return _read(project_dir(pid) / "project.json")


def save_project(p):
    with _lock:
        p["updated"] = time.time()
        p["rev"] = int(p.get("rev", 0)) + 1
        _write(project_dir(p["id"]) / "project.json", p)
        return p


def mutate_project(pid, fn):
    with _lock:
        p = load_project(pid)
        fn(p)
        return save_project(p)


def delete_project(pid):
    with _lock:
        d = project_dir(pid)
        if d.exists():
            trash = _dir("trash")
            trash.mkdir(parents=True, exist_ok=True)
            shutil.move(str(d), str(trash / ("%s-%d" % (pid, time.time()))))


def find_panel(p, panel_id):
    for pg in p.get("pages", []):
        if panel_id in pg.get("panels", {}):
            return pg["panels"][panel_id]
    return None


# ------------------------------------------------------------------ banque
def item_dir(iid):
    if not re.fullmatch(r"[a-z0-9-]{1,70}", iid or ""):
        raise ValueError("identifiant refuse")
    return _dir("bank", iid)


def list_items():
    out = []
    root = _dir("bank")
    if root.exists():
        for d in root.iterdir():
            try:
                out.append(_read(d / "item.json"))
            except (OSError, ValueError):
                continue
    return sorted(out, key=lambda x: (x.get("kind", ""), x.get("name", "").lower()))


def create_item(kind, name, style="photo", tags=None):
    if kind not in KINDS:
        raise ValueError("type inconnu")
    with _lock:
        base = slug(name)
        iid, i = base, 2
        while _dir("bank", iid).exists():
            iid, i = "%s-%d" % (base, i), i + 1
        now = time.time()
        it = {"id": iid, "kind": kind, "name": name or iid, "style": style, "tags": tags or [], "created": now,
              "updated": now, "source": "", "w": 0, "h": 0, "variants": {}}
        _write(item_dir(iid) / "item.json", it)
        return it


def load_item(iid):
    return _read(item_dir(iid) / "item.json")


def mutate_item(iid, fn):
    with _lock:
        it = load_item(iid)
        fn(it)
        it["updated"] = time.time()
        _write(item_dir(iid) / "item.json", it)
        return it


def delete_item(iid):
    with _lock:
        d = item_dir(iid)
        if d.exists():
            trash = _dir("trash")
            trash.mkdir(parents=True, exist_ok=True)
            shutil.move(str(d), str(trash / ("%s-%d" % (iid, time.time()))))


def variant_id(it, label):
    base = slug(label)
    vid, i = base, 2
    while vid in it["variants"]:
        vid, i = "%s-%d" % (base, i), i + 1
    return vid
