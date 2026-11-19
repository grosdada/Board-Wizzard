"""Retouches d'une orbite deja faite.

punch : vider une zone que le rebouchage a remplie a tort (le vide entre un bras et le corps, entre deux jambes).
On designe la zone d'un clic sur une image ; elle est retrouvee sur les images voisines tant qu'elle existe, puis
l'orbite est retracee. Les images d'origine sont gardees dans data/backup/trous/<element>/... (une seule fois).
"""
import shutil
import time

import cv2
import numpy as np
from PIL import Image

from . import settings, store, vector

BACKUP = settings.DATA / "backup" / "trous"
MAX_SHARE = 0.30          # une zone plus grande que ca n'est pas un vide : c'est le corps
UNDO = settings.DATA / "backup" / "annuler"   # annulation des retouches : <element>/<dossier de l'orbite>/{undo,redo}/<pas>/
UNDO_STEPS = 15
NEW = "_crees.txt"                            # dans un pas : les fichiers qui n'existaient pas avant


# ------------------------------------------------------------------ annuler / retablir une retouche (Ctrl+Z, 15 pas)
class _Step:
    """Un pas d'annulation : avant de reecrire un fichier de l'orbite, on en garde la version d'avant (une fois par pas)."""
    def __init__(self, d, odir):
        self.folder = d / odir
        self.base = UNDO / d.name / odir
        self.dir = self.base / "undo" / ("%d" % time.time_ns())

    def keep(self, path):
        rel = path.relative_to(self.folder)
        if not path.exists():                                       # fichier cree par la retouche : l'annulation le retire
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self.dir / NEW, "a", encoding="utf-8") as fh:
                fh.write(rel.as_posix() + "\n")
            return
        dest = self.dir / rel
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)

    def close(self):
        """Pas termine : la pile de retablissement est videe, on ne garde que les UNDO_STEPS derniers pas."""
        shutil.rmtree(self.base / "redo", ignore_errors=True)
        steps = sorted((self.base / "undo").iterdir(), key=lambda x: int(x.name)) if (self.base / "undo").is_dir() else []
        for old in steps[:-UNDO_STEPS]:
            shutil.rmtree(old, ignore_errors=True)


def _stack(base, which):
    d = base / which
    return sorted(d.iterdir(), key=lambda x: int(x.name)) if d.is_dir() else []


def undo_state(item_id, variant):
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    if not o.get("dir"):
        return {"undo": 0, "redo": 0}
    base = UNDO / store.item_dir(item_id).name / o["dir"]
    return {"undo": len(_stack(base, "undo")), "redo": len(_stack(base, "redo"))}


def undo(item_id, variant, redo=False):
    """Annule (ou retablit) la derniere retouche de cette orbite : remet les fichiers gardes, garde l'etat courant pour
    l'autre sens, et change la version des images pour qu'elles se rechargent. Rend {undo, redo, frames}."""
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    if not o.get("dir"):
        raise ValueError("cette variante n'a pas d'orbite détourée")
    d = store.item_dir(item_id)
    folder, base = d / o["dir"], UNDO / d.name / o["dir"]
    src, dst = ("redo", "undo") if redo else ("undo", "redo")
    steps = _stack(base, src)
    if not steps:
        raise ValueError("rien à rétablir" if redo else "rien à annuler")
    step = steps[-1]
    back = base / dst / ("%d" % time.time_ns())
    frames, created = [], []

    def save_current(rel):                                          # l'etat courant part dans l'autre pile
        cur = folder / rel
        if cur.exists():
            (back / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cur, back / rel)
        else:
            created.append(rel)
    for f in sorted(step.rglob("*")):
        if not f.is_file() or f.name == NEW:
            continue
        rel = f.relative_to(step)
        save_current(rel)
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, folder / rel)
        if f.suffix == ".webp" and f.stem.isdigit():
            frames.append(int(f.stem))
    if (step / NEW).exists():                                       # ce que la retouche avait cree disparait
        from pathlib import PurePosixPath
        for line in (step / NEW).read_text(encoding="utf-8").split():
            rel = PurePosixPath(line)
            if (folder / rel).exists():
                save_current(rel)
                (folder / rel).unlink()
    if created:
        back.mkdir(parents=True, exist_ok=True)
        (back / NEW).write_text("".join(r.as_posix() + "\n" for r in created), encoding="utf-8")
    shutil.rmtree(step, ignore_errors=True)
    now = int(time.time())

    def bump(v):
        oo = (v["variants"].get(variant) or {}).get("orbit") or {}
        if oo.get("dir") == o["dir"]:
            oo["t"] = oo["vt"] = now
    store.mutate_item(item_id, bump)
    return {"undo": len(_stack(base, "undo")), "redo": len(_stack(base, "redo")), "frames": sorted(frames)}


def _keep(d, path):
    dest = BACKUP / d.name / path.relative_to(d)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)


def _zones(path):
    """(image RGBA, etiquettes des zones blanches fermees par le trait, stats, surface de la silhouette)."""
    im = np.asarray(Image.open(path).convert("RGBA")).copy()
    solid = im[..., 3] > 128
    grey = cv2.cvtColor(im[..., :3], cv2.COLOR_RGB2GRAY)
    ink = ((grey < 175) & solid).astype(np.uint8)
    free = (solid & (cv2.dilate(ink, np.ones((3, 3), np.uint8)) == 0)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    return im, lab, stats, int(solid.sum()), ink


def _cut(d, path, im, mask, ink, step=None):
    """Rend transparente la zone (elargie jusqu'au trait qui la borde) et reecrit l'image."""
    wide = (cv2.dilate(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & (ink == 0)
    _keep(d, path)
    if step:
        step.keep(path)
    im[..., 3][wide] = 0
    Image.fromarray(im).save(path, quality=86, method=4)


def punch(item_id, variant, frame, x, y, spread=True):
    """Vide la zone sous le point (x, y en fractions de l'image) de l'image frame, et la meme zone sur les images voisines.
    Rend {frames: [images retouchees]}."""
    it = store.load_item(item_id)
    if it.get("body"):
        raise ValueError("personnage assemblé : retoucher son corps (%s)" % it["body"])
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    n = int(o.get("n") or 0)
    if not n or not o.get("alpha", True):
        raise ValueError("cette variante n'a pas d'orbite détourée")
    d = store.item_dir(item_id)
    folder = d / o["dir"]
    f0 = int(frame) % n
    path = lambda f: folder / ("%03d.webp" % f)
    im, lab, stats, total, ink = _zones(path(f0))
    h, w = lab.shape
    px, py = min(w - 1, max(0, int(round(float(x) * w)))), min(h - 1, max(0, int(round(float(y) * h))))
    k = int(lab[py, px])
    if not k:                                                       # clic sur un trait : la zone la plus proche
        win = lab[max(0, py - 6):py + 7, max(0, px - 6):px + 7]
        ids = win[win > 0]
        if not ids.size:
            raise ValueError("rien à vider ici : cliquer dans la zone blanche à enlever")
        k = int(np.bincount(ids).argmax())
    if stats[k, cv2.CC_STAT_AREA] > MAX_SHARE * total:
        raise ValueError("cette zone est trop grande pour être un vide : c'est le corps du personnage")
    first = lab == k
    step = _Step(d, o["dir"])
    step.keep(folder / "vec.json")
    _cut(d, path(f0), im, first, ink, step)
    done = [f0]
    if spread:
        for step in (1, -1):                                        # la meme zone, d'image en image, tant qu'elle existe
            prev, f = first, f0
            for _ in range(n - 1):
                f = (f + step) % n
                if f in done:
                    break
                im2, lab2, stats2, total2, ink2 = _zones(path(f))
                if lab2.shape != prev.shape:
                    break
                ids = lab2[prev & (lab2 > 0)]
                if not ids.size:
                    break
                k2 = int(np.bincount(ids).argmax())
                a1, a2 = int(prev.sum()), int(stats2[k2, cv2.CC_STAT_AREA])
                over = int((ids == k2).sum())
                if over < 0.35 * a1 or a2 > 2.2 * a1 + 200 or a2 > MAX_SHARE * total2:
                    break                                           # la zone s'est ouverte, a disparu, ou a fusionne avec le corps
                prev = lab2 == k2
                _cut(d, path(f), im2, prev, ink2, step)
                done.append(f)
    if o.get("vec"):
        _keep(d, folder / "vec.json")
        vector.orbit(folder, n, "mannequin" in (it.get("tags") or []))
    step.close()
    now = int(time.time())

    def bump(v):
        oo = (v["variants"].get(variant) or {}).get("orbit") or {}
        if oo.get("dir") == o["dir"]:
            oo["t"] = oo["vt"] = now
    store.mutate_item(item_id, bump)
    return dict(undo_state(item_id, variant), frames=sorted(done))


def lasso(item_id, variant, frame, points, mode="vider", lines=False):
    """Retouche a la main d'une image d'orbite : la zone entouree au lasso (points : [[x, y], ...] en fractions de l'image)
    est videe (mode « vider » : le blanc devient transparent ; le trait est garde sauf lines) ou remplie (mode
    « remplir » : tout y devient opaque, du papier blanc la ou c'etait transparent). Seule cette image est retracee."""
    it = store.load_item(item_id)
    if it.get("body"):
        raise ValueError("personnage assemblé : retoucher son corps (%s)" % it["body"])
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    n = int(o.get("n") or 0)
    if not n or not o.get("alpha", True):
        raise ValueError("cette variante n'a pas d'orbite détourée")
    if not isinstance(points, list) or len(points) < 3:
        raise ValueError("lasso trop court : entourer la zone")
    d = store.item_dir(item_id)
    folder = d / o["dir"]
    f = int(frame) % n
    p = folder / ("%03d.webp" % f)
    im = np.asarray(Image.open(p).convert("RGBA")).copy()
    h, w = im.shape[:2]
    poly = np.array([[float(x) * w, float(y) * h] for x, y in points[:4000]], np.float32).round().astype(np.int32)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [poly], 1)
    mask = mask > 0
    _keep(d, p)
    step = _Step(d, o["dir"])
    step.keep(p)
    step.keep(folder / "vec.json")
    if mode == "remplir":
        hole = mask & (im[..., 3] < 128)
        im[..., :3][hole] = 255
        im[..., 3][mask] = 255
    else:
        if not lines:
            grey = cv2.cvtColor(im[..., :3], cv2.COLOR_RGB2GRAY)
            mask &= ~((grey < 175) & (im[..., 3] > 128))
        im[..., 3][mask] = 0
    Image.fromarray(im).save(p, quality=86, method=4)
    vec = folder / "vec.json"
    if o.get("vec") and vec.exists():                               # seule cette image est retracee : une seconde
        import json
        _keep(d, vec)
        data = json.loads(vec.read_text(encoding="utf-8"))
        _, _, body, ink, parts, _ = vector.frame(p, "mannequin" in (it.get("tags") or []))
        if f < len(data.get("frames", [])):
            data["frames"][f] = {"body": body, "ink": ink, "parts": parts} if parts else {"body": body, "ink": ink}
            vec.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    now = int(time.time())

    def bump(v):
        oo = (v["variants"].get(variant) or {}).get("orbit") or {}
        if oo.get("dir") == o["dir"]:
            oo["t"] = oo["vt"] = now
    step.close()
    store.mutate_item(item_id, bump)
    return dict(undo_state(item_id, variant), frame=f, pixels=int(mask.sum()))


def dedupe(item_id, variant):
    """Orbite « exposee a deux » (chaque image y est deux fois) : ne garde qu'une image de chaque paire. Les images
    retirees vont dans data/backup/doublons/<element>/..., les cases qui montraient cette orbite gardent le meme angle.
    Rend {before, after} (nombre d'images), ou None si l'orbite n'est pas doublee."""
    import json
    from . import sprites
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    n = int(o.get("n") or 0)
    if it.get("body") or not n:
        return None
    d = store.item_dir(item_id)
    folder = d / o["dir"]
    files = [folder / ("%03d.webp" % f) for f in range(n)]
    if not all(f.exists() for f in files):
        return None
    keep = sprites.singles(files)
    if len(keep) == n:
        return None
    back = settings.DATA / "backup" / "doublons" / d.name / o["dir"]
    back.mkdir(parents=True, exist_ok=True)
    kept = set(keep)
    for f in range(n):                                              # tout est d'abord mis de cote, puis les gardees reviennent renumerotees
        shutil.move(str(files[f]), str(back / files[f].name))
    for new, old in enumerate(keep):
        shutil.copy2(back / ("%03d.webp" % old), folder / ("%03d.webp" % new))
    for f in keep:
        (back / ("%03d.webp" % f)).unlink(missing_ok=True)          # la sauvegarde ne garde que les doublons retires
    newi = lambda f: max(0, min(len(keep) - 1, sum(1 for k in keep if k <= int(f) % n) - 1))
    for name in ("vec.json", "head.json"):
        p = folder / name
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data.get("frames"), list) and len(data["frames"]) == n:
                    shutil.copy2(p, back / name)
                    data["frames"] = [data["frames"][k] for k in keep]
                    p.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            except (OSError, ValueError):
                pass
    now = int(time.time())

    def apply(x):
        oo = (x["variants"].get(variant) or {}).get("orbit") or {}
        if oo.get("dir") != o["dir"]:
            return
        oo["n"] = len(keep)
        oo["snaps"] = {k: newi(v) for k, v in (oo.get("snaps") or {}).items()}
        oo["t"] = oo["vt"] = now
    store.mutate_item(item_id, apply)
    for pr in store.list_projects():                                # les cases gardent leur angle
        def fix(P):
            for pg in P.get("pages", []):
                for pan in pg.get("panels", {}).values():
                    for l in pan.get("layers", []) or []:
                        if l.get("item") != item_id:
                            continue
                        if (l.get("v") or "base") == variant and l.get("f") is not None:
                            l["f"] = newi(l["f"])
                        for key in ((pan.get("anim") or {}).get("tracks") or {}).get(l.get("id"), []) or []:
                            if (key.get("v") or l.get("v") or "base") == variant and key.get("f") is not None:
                                key["f"] = newi(key["f"])
        try:
            P = store.load_project(pr["id"])
            if item_id in json.dumps(P):
                store.mutate_project(pr["id"], fix)
        except (OSError, ValueError):
            pass
    return {"before": n, "after": len(keep)}


def restore(item_id, variant):
    """Remet les images d'origine d'une orbite (celles gardees avant les retouches), puis retrace."""
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    d = store.item_dir(item_id)
    src = BACKUP / d.name / o.get("dir", "-")
    if not o.get("n") or not src.is_dir():
        raise ValueError("aucune image d'origine gardée pour cette orbite")
    if any(int(p.stem) >= int(o["n"]) for p in src.glob("*.webp") if p.stem.isdigit()):
        raise ValueError("les images d'origine datent d'avant le dédoublonnage de cette orbite : elles ne se remettent plus")
    back = 0
    step = _Step(d, o["dir"])
    step.keep(d / o["dir"] / "vec.json")
    for p in src.glob("*.webp"):
        step.keep(d / o["dir"] / p.name)
        shutil.copy2(p, d / o["dir"] / p.name)
        back += 1
    step.close()
    if o.get("vec"):
        vector.orbit(d / o["dir"], int(o["n"]), "mannequin" in (it.get("tags") or []))
    now = int(time.time())
    store.mutate_item(item_id, lambda v: (v["variants"][variant]["orbit"].update(t=now, vt=now)))
    return dict(undo_state(item_id, variant), frames=back)


# ------------------------------------------------------------------ vides remplis a tort : reperage automatique
MIN_ZONE = 150            # pixels : en dessous, une miette qu'on ne juge pas
SURE, DOUBT = "sur", "doute"


def _ring(mask, inner, outer):
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return (cv2.dilate(mask, k(outer)) > 0) & (cv2.dilate(mask, k(inner)) == 0)


def analyse(folder, n):
    """Juge chaque zone blanche fermee de chaque image d'une orbite. Deux indices qu'une zone est un vide rempli a tort :
    - elle touche l'exterieur sans trait d'encre entre les deux (un dessin a toujours son contour) ;
    - a l'image d'avant ou d'apres, sa place est dehors (le bras s'est ecarte), alors qu'elle est entouree par le corps.
    Rend [{f, mask, x, y, area, cls}] (mask : la zone, dans son cadre x, y)."""
    frames = []
    for f in range(n):
        im, lab, stats, total, ink = _zones(folder / ("%03d.webp" % f))
        solid = im[..., 3] > 128
        ext = np.pad((~solid).astype(np.uint8), 1, constant_values=1)       # le vrai dehors : relie au bord de l'image
        cv2.floodFill(ext, None, (0, 0), 2)                                  # (un trou du detourage n'est pas « dehors »)
        frames.append((solid, lab, stats, total, ext[1:-1, 1:-1] == 2))
    found = []
    for f, (solid, lab, stats, total, _) in enumerate(frames):
        H, W = lab.shape
        for k in range(1, stats.shape[0]):
            x, y, w, h, area = (int(v) for v in stats[k])
            if area < MIN_ZONE or area > MAX_SHARE * total:
                continue
            p = 16
            x0, y0, x1, y1 = max(0, x - p), max(0, y - p), min(W, x + w + p), min(H, y + h + p)
            z = (lab[y0:y1, x0:x1] == k).astype(np.uint8)
            sol = solid[y0:y1, x0:x1]
            near = _ring(z, 0, 3)
            bare = float((near & ~sol).sum()) / max(1, int(near.sum()))            # bord nu : dehors sans trait
            far = _ring(z, 5, 14)
            out = float((far & ~sol).sum()) / max(1, int(far.sum()))               # entouree de vide (une oreille) ou de corps (un creux)
            # 1. l'enlever coupe-t-il le personnage ? Un avant-bras, une chaussette, un short relient deux morceaux du
            #    dessin : sans eux la main, la chaussure ou les jambes se detachent. Un vide ne relie rien.
            wide = cv2.dilate((lab == k).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
            rest = (solid & ~wide).astype(np.uint8)
            nr, _, st2, _ = cv2.connectedComponentsWithStats(rest, connectivity=8)
            left = int(rest.sum())
            cut = (left - int(st2[1:, cv2.CC_STAT_AREA].max())) / max(1, total) if nr > 1 else 1.0
            link = cut > 0.003                                                     # il detache un morceau du dessin (une main, une chaussure) : un membre
            # 2. sa place est-elle dehors, durablement, juste avant ou juste apres ? (le bras s'ecarte : le vide s'ouvre)
            #    Une seule image ne compte pas : le detourage perd parfois un membre le temps d'une image.
            zz, gone = z > 0, 0
            for side in (1, -1):
                hits = 0
                for d in (1, 2, 3, 4):
                    s2, lab2, e2 = frames[(f + side * d) % n][0], frames[(f + side * d) % n][1], frames[(f + side * d) % n][4]
                    if s2.shape != solid.shape:
                        continue
                    ext = float((zz & e2[y0:y1, x0:x1]).sum()) / area
                    ids = lab2[y0:y1, x0:x1][zz]
                    ids = ids[ids > 0]
                    kept = float(np.bincount(ids).max()) / area if ids.size else 0.0   # une zone la prolonge-t-elle ?
                    if kept < 0.3 and ext >= 0.5:
                        hits += 1
                gone = max(gone, hits)
            cls = None
            share = area / max(1, total)
            why = None
            hollow = not link and out < 0.3                                        # un creux : entoure par le corps, et ne relie rien
            if hollow and gone >= 2 and out < 0.12:                                # bien enferme dans le corps, et qui s'ouvre
                cls, why = SURE, "ouvert"
            elif hollow and gone >= 2:
                cls, why = DOUBT, "ouvert, au bord"
            elif hollow and (gone == 1 or bare >= 0.15) and share < 0.08:
                cls, why = DOUBT, "creux"
            found.append({"f": f, "mask": zz, "x": x0, "y": y0, "area": area, "cls": cls, "why": why, "bare": bare, "out": out,
                          "gone": gone, "hollow": hollow})
    # un vide reste un vide tant qu'il existe : la certitude passe d'une image a ses voisines
    by = {}
    for z in found:
        by.setdefault(z["f"], []).append(z)
    changed = True
    while changed:
        changed = False
        for z in found:
            if z["cls"] == SURE:
                continue
            for g in ((z["f"] - 1) % n, (z["f"] + 1) % n):
                for o in by.get(g, []):
                    if o["cls"] != SURE or not z["hollow"] or not (0.6 < o["area"] / z["area"] < 1.65):
                        continue
                    ax0, ay0 = max(z["x"], o["x"]), max(z["y"], o["y"])
                    ax1 = min(z["x"] + z["mask"].shape[1], o["x"] + o["mask"].shape[1])
                    ay1 = min(z["y"] + z["mask"].shape[0], o["y"] + o["mask"].shape[0])
                    if ax1 <= ax0 or ay1 <= ay0:
                        continue
                    a = z["mask"][ay0 - z["y"]:ay1 - z["y"], ax0 - z["x"]:ax1 - z["x"]]
                    b = o["mask"][ay0 - o["y"]:ay1 - o["y"], ax0 - o["x"]:ax1 - o["x"]]
                    if (a & b).sum() >= 0.6 * max(z["area"], o["area"]):
                        z["cls"], changed = SURE, True
                        z["why"] = "voisin %d" % o["f"]
                        break
                if z["cls"] == SURE:
                    break
    return [z for z in found if z["cls"]]


_ZONES = {}               # (dossier de l'orbite, instant de sa derniere retouche) -> zones suspectes, pour la fiche


def zones(item_id, variant):
    """Zones suspectes d'une orbite, pour les proposer dans la fiche : {w, h, frames: {image: [{d, x, y, cls}]}}.
    d : contour en pixels de l'image ; x, y : un point dans la zone (fractions), a renvoyer a punch pour la vider."""
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    n = int(o.get("n") or 0)
    if it.get("body") or not n or not o.get("alpha", True):
        raise ValueError("cette variante n'a pas d'orbite détourée")
    folder = store.item_dir(item_id) / o["dir"]
    key = (str(folder), o.get("t"))
    if key not in _ZONES:
        frames = {}
        for z in analyse(folder, n):
            m = z["mask"].astype(np.uint8)
            cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cs:
                continue
            c = max(cs, key=cv2.contourArea)
            c = cv2.approxPolyDP(c, 1.0, True)[:, 0, :]
            dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)                 # le point le plus au coeur de la zone
            py, px = np.unravel_index(int(dist.argmax()), dist.shape)
            frames.setdefault(str(z["f"]), []).append({
                "d": "M" + "L".join("%d %d" % (p[0] + z["x"], p[1] + z["y"]) for p in c) + "Z",
                "x": round((px + z["x"] + 0.5) / o["w"], 4), "y": round((py + z["y"] + 0.5) / o["h"], 4), "cls": z["cls"]})
        if len(_ZONES) > 12:
            _ZONES.clear()
        _ZONES[key] = {"w": o["w"], "h": o["h"], "frames": frames}
    return _ZONES[key]


def sheet(folder, n, zones, dest, cols=8):
    """Planche de controle : les images ou une zone est jugee, sur fond vif. Rouge = vide sur, orange = doute."""
    from PIL import ImageDraw
    fs = sorted({z["f"] for z in zones})
    if not fs:
        return None
    fs = fs[::max(1, -(-len(fs) // 24))][:24]
    tiles = []
    for f in fs:
        im = Image.open(folder / ("%03d.webp" % f)).convert("RGBA")
        bg = Image.new("RGBA", im.size, (40, 200, 235, 255))
        bg.alpha_composite(im)
        v = np.asarray(bg.convert("RGB")).copy()
        for z in zones:
            if z["f"] == f:
                m = z["mask"]
                sub = v[z["y"]:z["y"] + m.shape[0], z["x"]:z["x"] + m.shape[1]]
                sub[m] = (230, 30, 30) if z["cls"] == SURE else (255, 150, 0)
        t = Image.fromarray(v)
        t.thumbnail((300, 300))
        tiles.append((f, t))
    tw, th = max(t.width for _, t in tiles), max(t.height for _, t in tiles)
    rows = -(-len(tiles) // cols)
    out = Image.new("RGB", (cols * tw, rows * (th + 14)), "white")
    dr = ImageDraw.Draw(out)
    for i, (f, t) in enumerate(tiles):
        out.paste(t, ((i % cols) * tw, (i // cols) * (th + 14) + 14))
        dr.text(((i % cols) * tw + 4, (i // cols) * (th + 14) + 1), "image %d" % f, fill="black")
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, quality=85)
    return dest


def auto(item_id, variant, apply=False, doubts=False, sheet_dir=None):
    """Repere les vides remplis a tort d'une orbite ; apply : vide ceux qui sont surs (et les douteux si doubts), retrace."""
    it = store.load_item(item_id)
    o = (it["variants"].get(variant) or {}).get("orbit") or {}
    n = int(o.get("n") or 0)
    if it.get("body") or not n or not o.get("alpha", True):
        return {"sure": 0, "doubt": 0, "frames": []}
    d = store.item_dir(item_id)
    folder = d / o["dir"]
    zones = analyse(folder, n)
    if sheet_dir is not None and zones:
        sheet(folder, n, zones, sheet_dir / ("%s--%s.jpg" % (item_id, variant)))
    res = {"sure": sum(1 for z in zones if z["cls"] == SURE), "doubt": sum(1 for z in zones if z["cls"] == DOUBT),
           "frames": sorted({z["f"] for z in zones})}
    todo = [z for z in zones if z["cls"] == SURE or doubts] if apply else []
    for f in sorted({z["f"] for z in todo}):
        p = folder / ("%03d.webp" % f)
        im = np.asarray(Image.open(p).convert("RGBA")).copy()
        grey = cv2.cvtColor(im[..., :3], cv2.COLOR_RGB2GRAY)
        ink = ((grey < 175) & (im[..., 3] > 128)).astype(np.uint8)
        full = np.zeros(ink.shape, bool)
        for z in todo:
            if z["f"] == f:
                full[z["y"]:z["y"] + z["mask"].shape[0], z["x"]:z["x"] + z["mask"].shape[1]] |= z["mask"]
        _cut(d, p, im, full, ink)
    if todo:
        if o.get("vec"):
            _keep(d, folder / "vec.json")
            vector.orbit(folder, n, "mannequin" in (it.get("tags") or []))
        now = int(time.time())

        def bump(v):
            oo = (v["variants"].get(variant) or {}).get("orbit") or {}
            if oo.get("dir") == o["dir"]:
                oo["t"] = oo["vt"] = now
        store.mutate_item(item_id, bump)
        res["emptied"] = len(todo)
    return res
