"""Paquets de personnages (.bwpack) et bibliotheque en ligne.

Un paquet = une archive zip sans compression :
  pack.json                     {format: "board-wizzard-pack", version: 1, app, created,
                                 items: [{id, name, kind, folder, tags, variants, orbits, files, size, updated, body}]}
  bank/<id>/item.json           la fiche de l'element, telle quelle
  bank/<id>/...                 tous ses fichiers : image de base, detourages, poses, orbites (images et traces), planche de vues
Un personnage assemble (portrait-robot) n'a pas d'images a lui : son corps part avec lui dans le paquet.
Les identifiants ne changent pas a l'import (les cases des storyboards les citent).

Une bibliotheque en ligne = un dossier servi en HTTPS, protege par identifiant et mot de passe (authentification « Basic ») :
  index.json                    {format: "board-wizzard-library", version: 1, name, updated, items: [... + pack, thumb]}
  <id>.bwpack, <id>.jpg         un paquet et une vignette par element
"""

import base64
import hashlib
import json
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from . import settings, store

FORMAT, LIBRARY, VERSION, EXT = "board-wizzard-pack", "board-wizzard-library", 1, ".bwpack"
OK_EXT = (".json", ".png", ".webp", ".jpg", ".jpeg")
_ID = re.compile(r"[a-z0-9-]{1,70}")


class PackError(ValueError):
    pass


# ------------------------------------------------------------------ choix des elements
def select(ids=None, folder=None, kind=None):
    """Identifiants a mettre en paquet : ceux donnes, ou ceux d'un dossier (sous-dossiers compris) ; les corps suivent."""
    items = {it["id"]: it for it in store.list_items()}
    if ids:
        missing = [i for i in ids if i not in items]
        if missing:
            raise PackError("introuvable dans la banque : %s" % ", ".join(missing))
        out = list(ids)
    else:
        f = store._clean_folder(folder or "")
        out = [i for i, it in items.items() if (not kind or it.get("kind") == kind) and
               (not f or it.get("folder", "") == f or (it.get("folder") or "").startswith(f + "/"))]
    for i in list(out):                                             # portrait-robot : son corps part avec lui
        b = items[i].get("body")
        if b and b in items and b not in out:
            out.append(b)
    return out


def _files(iid):
    d = store.item_dir(iid)
    return sorted(p for p in d.rglob("*") if p.is_file() and p.suffix.lower() in OK_EXT
                  and not re.search(r"\.tmp[0-9a-f]*$", p.name) and p.name != "item.json")


def _entry(it, files):
    vs = (store.resolve(dict(it)).get("variants") or {}) if it.get("body") else (it.get("variants") or {})
    return {"id": it["id"], "name": it.get("name", it["id"]), "kind": it.get("kind", "character"), "style": it.get("style", ""),
            "folder": it.get("folder", ""), "tags": it.get("tags") or [], "variants": len(vs),
            "orbits": sum(1 for v in vs.values() if v.get("orbit")), "files": len(files),
            "size": sum(p.stat().st_size for p in files), "updated": it.get("updated", 0), "body": it.get("body") or ""}


# ------------------------------------------------------------------ export
def export(ids, dest, progress=None):
    """Ecrit le paquet des elements ids dans dest. Rend le manifeste."""
    if not ids:
        raise PackError("rien à mettre dans le paquet")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        for n, iid in enumerate(ids):
            it = store.load_item(iid)
            d, files = store.item_dir(iid), _files(iid)
            if progress:
                progress(n, len(ids), it.get("name", iid))
            for p in files:
                z.write(p, "bank/%s/%s" % (iid, p.relative_to(d).as_posix()))
            z.writestr("bank/%s/item.json" % iid, json.dumps(it, ensure_ascii=False, indent=1))
            entries.append(_entry(it, files))
        man = {"format": FORMAT, "version": VERSION, "created": int(time.time()), "items": entries}
        z.writestr("pack.json", json.dumps(man, ensure_ascii=False, indent=1))
    return man


def manifest(path):
    try:
        with zipfile.ZipFile(path) as z:
            man = json.loads(z.read("pack.json").decode("utf-8"))
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        raise PackError("ce fichier n'est pas un paquet Board Wizzard")
    if man.get("format") != FORMAT:
        raise PackError("ce fichier n'est pas un paquet Board Wizzard")
    if int(man.get("version", 0)) > VERSION:
        raise PackError("paquet fait par une version plus récente de Board Wizzard : mettre l'application à jour")
    return man


# ------------------------------------------------------------------ import
def import_pack(path, replace=False, only=None):
    """Verse un paquet dans la banque. Un element deja present est laisse tel quel, sauf replace (l'ancien part a la
    corbeille). only : n'importer que ces identifiants. Rend {added, replaced, skipped} (listes de {id, name})."""
    man = manifest(path)
    names = {e["id"]: e.get("name", e["id"]) for e in man.get("items", []) if _ID.fullmatch(e.get("id", ""))}
    out = {"added": [], "replaced": [], "skipped": []}
    now = int(time.time())
    with zipfile.ZipFile(path) as z:
        by = {}
        for info in z.infolist():
            m = re.fullmatch(r"bank/([a-z0-9-]{1,70})/(.+)", info.filename)
            if not m or info.is_dir() or m.group(1) not in names:
                continue
            rel = m.group(2)
            if Path(rel).suffix.lower() not in OK_EXT or ".." in rel.split("/") or rel.startswith("/") or ":" in rel:
                continue
            by.setdefault(m.group(1), []).append((info, rel))
        for iid, name in names.items():
            if only and iid not in only:
                continue
            files = by.get(iid) or []
            card = [f for f in files if f[1] == "item.json"]
            if not card:
                continue
            d = store.item_dir(iid)
            had = (d / "item.json").exists()
            if had and not replace:
                out["skipped"].append({"id": iid, "name": name})
                continue
            it = json.loads(z.read(card[0][0]).decode("utf-8"))
            if not isinstance(it, dict) or not isinstance(it.get("variants"), dict) or it.get("kind") not in store.KINDS:
                raise PackError("fiche illisible dans le paquet : %s" % iid)
            if had:
                store.delete_item(iid)
            elif d.exists():                                         # reste d'un import interrompu, sans fiche
                shutil.rmtree(d, ignore_errors=True)
            for info, rel in files:
                if rel == "item.json":
                    continue
                target = store.safe(d, rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
            it["id"], it["updated"] = iid, time.time()
            for v in it["variants"].values():                       # le navigateur garde les images un jour : nouvelles adresses
                if isinstance(v, dict):
                    v["t"] = now
                    if isinstance(v.get("orbit"), dict):
                        v["orbit"]["t"] = now
                        if v["orbit"].get("vec"):
                            v["orbit"]["vt"] = now
                        if v["orbit"].get("mouth"):
                            v["orbit"]["mt"] = now * 1000
            if it.get("sheet"):
                it["sheet_t"] = now
            store._write(d / "item.json", it)                       # la fiche en dernier : sans elle, l'element n'existe pas
            out["replaced" if had else "added"].append({"id": iid, "name": name})
    return out


# ------------------------------------------------------------------ bibliotheque en ligne : fabrication
def build_library(ids, dest, name="Bibliothèque Board Wizzard", user="", password="", progress=None):
    """Fabrique dans dest le dossier a deposer sur l'hebergement : un paquet et une vignette par element, index.json,
    et, si un mot de passe est donne, .htaccess + .htpasswd (Apache / LiteSpeed)."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    try:
        old = {e["id"]: e for e in json.loads((dest / "index.json").read_text(encoding="utf-8")).get("items", [])}
    except (OSError, ValueError):
        old = {}
    entries = dict(old)
    for n, iid in enumerate(ids):
        it = store.load_item(iid)
        if progress:
            progress(n, len(ids), it.get("name", iid))
        e = old.get(iid)
        if e and e.get("updated") == it.get("updated", 0) and (dest / (iid + EXT)).exists():
            continue                                                 # inchange depuis la derniere fabrication
        e = export([iid], dest / (iid + EXT))["items"][0]
        e["pack"], e["bytes"] = iid + EXT, (dest / (iid + EXT)).stat().st_size
        thumb = store.item_dir(it.get("body") or iid) / "thumb.jpg"
        if thumb.exists():
            shutil.copyfile(thumb, dest / (iid + ".jpg"))
            e["thumb"] = iid + ".jpg"
        entries[iid] = e
    index = {"format": LIBRARY, "version": VERSION, "name": name, "updated": int(time.time()),
             "items": sorted(entries.values(), key=lambda e: (e.get("kind", ""), e.get("folder", ""), e.get("name", "").lower()))}
    (dest / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    if password:
        sha = base64.b64encode(hashlib.sha1(password.encode("utf-8")).digest()).decode()
        (dest / ".htpasswd").write_text("%s:{SHA}%s\n" % (user or "board", sha), encoding="utf-8")
        (dest / ".htaccess").write_text(
            'AuthType Basic\nAuthName "Board Wizzard"\nAuthUserFile REMPLACER/PAR/LE/CHEMIN/COMPLET/.htpasswd\nRequire valid-user\n'
            '<Files ".htpasswd">\nRequire all denied\n</Files>\nOptions -Indexes\n', encoding="utf-8")
    return index


# ------------------------------------------------------------------ bibliotheque en ligne : lecture
def _lib():
    c = settings.load().get("library") or {}
    url = (c.get("url") or "").strip().rstrip("/")
    if url.endswith("/index.json"):
        url = url[:-len("/index.json")]
    if not re.match(r"https?://", url):
        raise PackError("aucune bibliothèque en ligne : donner son adresse dans les réglages")
    return url, c.get("user") or "", c.get("password") or ""


def _open(name, timeout=60):
    url, user, pw = _lib()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,90}", name) or name.startswith("."):
        raise PackError("nom de fichier refusé")
    req = urllib.request.Request(url + "/" + name, headers={"User-Agent": "BoardWizzard"})
    if user or pw:
        req.add_header("Authorization", "Basic " + base64.b64encode(("%s:%s" % (user, pw)).encode("utf-8")).decode())
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise PackError("la bibliothèque refuse l'identifiant ou le mot de passe")
        raise PackError("bibliothèque : %s introuvable (erreur %d)" % (name, e.code))
    except (urllib.error.URLError, OSError) as e:
        raise PackError("bibliothèque injoignable : %s" % getattr(e, "reason", e))


def library_index():
    with _open("index.json") as r:
        try:
            idx = json.loads(r.read(8 << 20).decode("utf-8"))
        except ValueError:
            raise PackError("la bibliothèque n'a pas rendu un index lisible")
    if idx.get("format") != LIBRARY:
        raise PackError("cette adresse n'est pas une bibliothèque Board Wizzard")
    for e in idx.get("items", []):
        try:
            e["have"] = (store.item_dir(e["id"]) / "item.json").exists()
        except (ValueError, KeyError):
            e["have"] = False
    return idx


def library_thumb(name):
    with _open(name, 30) as r:
        return r.read(2 << 20)


def library_import(iid, replace=False, progress=None):
    """Telecharge le paquet d'un element de la bibliotheque et le verse dans la banque."""
    hit = next((e for e in library_index().get("items", []) if e.get("id") == iid), None)
    if not hit or not hit.get("pack"):
        raise PackError("élément absent de la bibliothèque : %s" % iid)
    body, extra = hit.get("body"), None
    if body and _ID.fullmatch(body) and not (store.item_dir(body) / "item.json").exists():
        extra = library_import(body, False, progress)               # portrait-robot : son corps d'abord, s'il manque
    tmp = Path(tempfile.mkdtemp(prefix="bwlib_"))
    try:
        f, got = tmp / "p.bwpack", 0
        with _open(hit["pack"], 120) as r, open(f, "wb") as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                got += len(chunk)
                if progress:
                    progress(got, hit.get("bytes") or 0)
        out = import_pack(f, replace=replace)
        if extra:
            out["added"] += extra["added"]
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
