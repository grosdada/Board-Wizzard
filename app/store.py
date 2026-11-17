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


# ---- banque audio : les voix importees, enregistrees au micro ou generees. data/audio/index.json + les fichiers.
AUDIO_EXT = (".webm", ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".aac", ".flac", ".mp4")


def list_audio():
    try:
        out = _read(_dir("audio") / "index.json")
    except (OSError, ValueError):
        out = []
    return [a for a in out if isinstance(a, dict) and a.get("id")]


def add_audio(body, name, source="import", text="", voice="", folder=""):
    """Range un son dans la banque audio et rend sa fiche."""
    ext = os.path.splitext(name or "")[1].lower()
    if ext not in AUDIO_EXT:
        ext = ".webm"
    aid = "a%x%s" % (int(time.time() * 1000), uuid.uuid4().hex[:3])
    with _lock:
        _dir("audio").mkdir(parents=True, exist_ok=True)
        (_dir("audio") / (aid + ext)).write_bytes(body)
        label = re.sub(r"\.[a-z0-9]{2,5}$", "", (name or "voix").strip(), flags=re.I)[:80] or "voix"
        entry = {"id": aid, "name": label, "file": aid + ext, "source": source or "import", "text": (text or "")[:2000],
                 "voice": voice or "", "folder": _clean_folder(folder), "dur": 0, "created": int(time.time())}
        _write(_dir("audio") / "index.json", list_audio() + [entry])
    return entry


def update_audio(aid, patch):
    with _lock:
        items = list_audio()
        for a in items:
            if a["id"] == aid:
                for k in ("name", "folder", "dur"):
                    if k in (patch or {}):
                        a[k] = _clean_folder(patch[k]) if k == "folder" else (float(patch[k] or 0) if k == "dur" else str(patch[k])[:80])
                _write(_dir("audio") / "index.json", items)
                return a
    raise KeyError(aid)


def remove_audio(aid):
    with _lock:
        items = list_audio()
        keep = [a for a in items if a["id"] != aid]
        for a in items:
            if a["id"] == aid:
                try:
                    safe(_dir("audio"), a["file"]).unlink()
                except OSError:
                    pass
        _write(_dir("audio") / "index.json", keep)
    return len(items) - len(keep)


def audio_entry(aid):
    for a in list_audio():
        if a["id"] == aid:
            return a
    raise KeyError(aid)


# ---- dossiers de la banque : un chemin « Projet/Sous-dossier », propre a chaque onglet (personnages, decors, assets,
# audio). folders.json garde les dossiers encore vides : { "character": [...], "decor": [...], "asset": [...], "audio": [...] }.
FOLDER_KINDS = ("character", "decor", "asset", "audio")


def _clean_folder(name):
    parts = [re.sub(r"[\<>:\"|?*]", "", p).strip() for p in str(name or "").replace("\\", "/").split("/")]
    return "/".join(p for p in parts if p)[:120]


def _foldered(kind=None):
    """Tout ce qui se range en dossiers : (onglet, dossier, fonction qui change le dossier)."""
    out = [(it.get("kind"), _clean_folder(it.get("folder", "")), (lambda f, i=it["id"]: mutate_item(i, lambda x: x.update(folder=f))))
           for it in list_items()]
    out += [("audio", _clean_folder(a.get("folder", "")), (lambda f, i=a["id"]: update_audio(i, {"folder": f}))) for a in list_audio()]
    return [o for o in out if kind is None or o[0] == kind]


def _empty_folders(things=None):
    try:
        extra = _read(_dir("bank") / "folders.json")
    except (OSError, ValueError):
        extra = {}
    if isinstance(extra, list):                                   # ancienne liste commune aux onglets
        used = set(f for _, f, _ in (things if things is not None else _foldered()))
        old, extra = extra, {k: [] for k in FOLDER_KINDS}
        for f in old:
            if isinstance(f, str) and f and f not in used:        # dossier vide : on ne sait pas a qui il etait, on le garde partout
                for k in ("character", "decor", "asset"):
                    extra[k].append(f)
    return {k: [f for f in (extra.get(k) or []) if isinstance(f, str) and f] for k in FOLDER_KINDS}


def list_folders():
    """Dossiers de chaque onglet : { type: [chemins] }."""
    things = _foldered()
    seen = {k: set(v) for k, v in _empty_folders(things).items()}
    for kind, f, _ in things:
        if f and kind in seen:
            seen[kind].add(f)
    for fs in seen.values():
        for f in list(fs):                                        # un sous-dossier fait exister ses parents
            parts = f.split("/")
            for i in range(1, len(parts)):
                fs.add("/".join(parts[:i]))
    return {k: sorted(f for f in fs if f) for k, fs in seen.items()}


def add_folder(name, kind):
    name = _clean_folder(name)
    if not name:
        raise ValueError("nom de dossier vide")
    if kind not in FOLDER_KINDS:
        raise ValueError("onglet inconnu : %s" % kind)
    with _lock:
        _dir("bank").mkdir(parents=True, exist_ok=True)
        extra = _empty_folders()
        extra[kind] = sorted(set(extra[kind]) | {name})
        _write(_dir("bank") / "folders.json", extra)
    return name


def remove_folder(name, kind):
    """Supprime un dossier d'un onglet et ses sous-dossiers. Leurs elements ne sont pas supprimes : ils remontent dans
    le dossier parent (ou hors dossier). Les dossiers du meme nom dans les autres onglets ne bougent pas.
    Renvoie le nombre d'elements deplaces."""
    name = _clean_folder(name)
    if not name or kind not in FOLDER_KINDS:
        raise ValueError("dossier ou onglet inconnu")
    parent = "/".join(name.split("/")[:-1])
    inside = lambda f: f == name or (f or "").startswith(name + "/")
    moved = 0
    for _, f, move in _foldered(kind):
        if inside(f):
            move(parent)
            moved += 1
    with _lock:
        extra = _empty_folders()
        extra[kind] = sorted(f for f in extra[kind] if not inside(f))
        if parent:
            extra[kind] = sorted(set(extra[kind]) | {parent})     # le parent reste, meme s'il se retrouve vide
        _write(_dir("bank") / "folders.json", extra)
    return moved


def rename_folder(name, to, kind):
    """Renomme un dossier d'un onglet (chemin complet vers chemin complet) ; ses sous-dossiers et ses elements suivent.
    Renvoie le nombre d'elements deplaces."""
    name, to = _clean_folder(name), _clean_folder(to)
    if not name or not to or kind not in FOLDER_KINDS:
        raise ValueError("dossier ou onglet inconnu")
    if to == name:
        return 0
    if to.startswith(name + "/"):
        raise ValueError("un dossier ne peut pas aller dans lui-meme")
    inside = lambda f: f == name or (f or "").startswith(name + "/")
    swap = lambda f: to + f[len(name):]
    moved = 0
    for _, f, move in _foldered(kind):
        if inside(f):
            move(swap(f))
            moved += 1
    with _lock:
        extra = _empty_folders()
        extra[kind] = sorted(set(swap(f) if inside(f) else f for f in extra[kind]) | {to})
        _write(_dir("bank") / "folders.json", extra)
    return moved


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
