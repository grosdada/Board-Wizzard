"""Objets tout faits (table, chaise, etagere...) : decrits par quelques cotes, dessines au trait et tournes sur 360°
sans aucun calcul d'IA. Chaque objet est un assemblage de boites et de cylindres ; l'orbite est rendue ici, image par
image (tampon de profondeur, puis un trait partout ou deux faces se rencontrent), et rangee comme une orbite normale.

CATALOGUE : cle -> (nom, [(cle, nom, min, max, pas, defaut) ou (cle, nom, [choix], defaut)], fonction(params) -> pieces).
Cotes en centimetres. Repere : x largeur, y hauteur (sol a 0), z profondeur.
"""
import math
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from . import jobs, sprites, store, vector

FRAMES, HEIGHT, SS, ELEV = 72, 720, 2, 14.0


# ------------------------------------------------------------------ pieces
def box(cx, y0, cz, sx, sy, sz):
    """Boite posee a la hauteur y0, centree en (cx, cz). Rend (sommets, faces) : chaque face a son propre trait."""
    x0, x1, z0, z1, y1 = cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, y0 + sy
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return np.array(v, float), [(q, None) for q in f]


def cyl(cx, y0, cz, r, h, seg=28, r2=None):
    """Cylindre (ou tronc de cone si r2) debout. Le tour est une seule surface lisse : pas de trait entre ses facettes."""
    r2 = r if r2 is None else r2
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        v.append((cx + r * math.cos(a), y0, cz + r * math.sin(a)))
        v.append((cx + r2 * math.cos(a), y0 + h, cz + r2 * math.sin(a)))
    for i in range(seg):
        j = (i + 1) % seg
        f.append(((2 * i, 2 * j, 2 * j + 1, 2 * i + 1), "side"))
    f.append((tuple(2 * i for i in range(seg)), None))
    f.append((tuple(2 * i + 1 for i in range(seg)), None))
    return np.array(v, float), f


def legs(w, d, h, t, inset=0.0, round_=False):
    out = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (w / 2 - t / 2 - inset), sz * (d / 2 - t / 2 - inset)
            out.append(cyl(x, 0, z, t / 2, h, 14) if round_ else box(x, 0, z, t, h, t))
    return out


# ------------------------------------------------------------------ objets
def table(p):
    w, d, h, e, t = p["largeur"], p["profondeur"], p["hauteur"], p["plateau"], p["pieds"]
    rond = p["forme"] == "rond"
    top = cyl(0, h - e, 0, w / 2, e, 40) if rond else box(0, h - e, 0, w, e, d)
    if p["pietement"] == "central":
        return [top, cyl(0, 0, 0, max(w, d) * 0.22, t * 0.6, 28), cyl(0, t * 0.6, 0, t * 0.8, h - e - t * 0.6, 18)]
    k = 0.70 if rond else 1.0
    return [top] + legs(w * k, (w if rond else d) * k, h - e, t, inset=t * 0.4, round_=p["pietement"] == "ronds")


def chaise(p):
    w, d, hs, hd, t, e = p["largeur"], p["profondeur"], p["assise"], p["dossier"], p["pieds"], 4.0
    parts = [box(0, hs - e, 0, w, e, d)]
    for sx in (-1, 1):                                              # pieds avant, et pieds arriere qui montent en dossier
        parts.append(box(sx * (w / 2 - t / 2), 0, d / 2 - t / 2, t, hs - e, t))
        parts.append(box(sx * (w / 2 - t / 2), 0, -(d / 2 - t / 2), t, hs + hd, t))
    zb = -(d / 2 - t / 2)
    if p["dos"] == "plein":
        parts.append(box(0, hs + hd * 0.35, zb, w - 2 * t, hd * 0.65, t * 0.6))
    else:
        parts.append(box(0, hs + hd - t, zb, w - 2 * t, t, t * 0.7))
        n = int(p["barreaux"])
        for i in range(n):
            x = (i + 1) / (n + 1) * (w - 2 * t) - (w - 2 * t) / 2
            parts.append(box(x, hs, zb, t * 0.45, hd - t, t * 0.45))
    return parts


def tabouret(p):
    r, h, t, e = p["diametre"] / 2, p["hauteur"], p["pieds"], 4.0
    parts = [cyl(0, h - e, 0, r, e, 36)]
    n = int(p["nombre"])
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        parts.append(cyl(r * 0.72 * math.cos(a), 0, r * 0.72 * math.sin(a), t / 2, h - e, 12))
    parts.append(cyl(0, h * 0.3, 0, r * 0.74, t * 0.5, 30))         # cercle repose-pieds
    return parts


def banc(p):
    w, d, h, t, e = p["longueur"], p["profondeur"], p["hauteur"], p["pieds"], 5.0
    parts = [box(0, h - e, 0, w, e, d)]
    for sx in (-1, 1):
        parts.append(box(sx * (w / 2 - t * 1.5), 0, 0, t, h - e, d * 0.9))
    if p["dossier"] > 0:
        for sx in (-1, 1):
            parts.append(box(sx * (w / 2 - t * 1.5), h, -(d / 2 - t / 2), t, p["dossier"], t))
        parts.append(box(0, h + p["dossier"] * 0.45, -(d / 2 - t / 2), w, p["dossier"] * 0.55, t * 0.5))
    return parts


def caisse(p):
    w, d, h = p["largeur"], p["profondeur"], p["hauteur"]
    parts = [box(0, 0, 0, w, h, d)]
    if p["couvercle"] > 0:
        parts.append(box(0, h, 0, w + 3, p["couvercle"], d + 3))
    return parts


def etagere(p):
    w, d, h, e, n = p["largeur"], p["profondeur"], p["hauteur"], p["planche"], int(p["tablettes"])
    parts = [box(-(w / 2 - e / 2), 0, 0, e, h, d), box(w / 2 - e / 2, 0, 0, e, h, d)]
    for i in range(n):
        y = (h - e) * i / max(1, n - 1)
        parts.append(box(0, y, 0, w - 2 * e, e, d))
    if p["fond"] == "oui":
        parts.append(box(0, 0, -(d / 2 - 0.6), w - 2 * e, h, 1.2))
    return parts


def lit(p):
    w, L, h, m = p["largeur"], p["longueur"], p["hauteur"], p["matelas"]
    parts = [box(0, h - 8, 0, w, 8, L), box(0, h, 0, w - 4, m, L - 4)]
    parts += legs(w, L, h - 8, 7)
    if p["tete"] > 0:
        parts.append(box(0, 0, -(L / 2 + 2), w, h + p["tete"], 4))
    parts.append(box(0, h + m, -(L / 2 - 28), w * 0.8, 9, 36))     # oreiller
    return parts


def bureau(p):
    w, d, h, e = p["largeur"], p["profondeur"], p["hauteur"], 4.0
    c = p["caisson"]
    parts = [box(0, h - e, 0, w, e, d), box(-(w / 2 - 2), 0, 0, 4, h - e, d * 0.92)]
    if c > 0:
        parts.append(box(w / 2 - c / 2 - 1, 0, 0, c, h - e, d * 0.92))
        n = int(p["tiroirs"])
        for i in range(n):                                          # facades des tiroirs, et leur poignee
            hh = (h - e - 6) / n
            y = 3 + i * hh
            parts.append(box(w / 2 - c / 2 - 1, y + 1, d * 0.46 + 0.8, c - 4, hh - 2, 1.6))
            parts.append(box(w / 2 - c / 2 - 1, y + hh / 2 - 1, d * 0.46 + 2.4, c * 0.3, 2, 1.6))
    else:
        parts.append(box(w / 2 - 2, 0, 0, 4, h - e, d * 0.92))
    return parts


def R(k, n, a, b, s, d):
    return (k, n, a, b, s, d)


CATALOGUE = {
    "table": ("Table", [R("largeur", "Largeur", 40, 260, 5, 140), R("profondeur", "Profondeur", 40, 140, 5, 80),
                        R("hauteur", "Hauteur", 30, 110, 1, 75), R("plateau", "Épaisseur du plateau", 2, 12, 0.5, 4),
                        R("pieds", "Épaisseur des pieds", 3, 16, 0.5, 6), ("forme", "Plateau", ["rectangle", "rond"], "rectangle"),
                        ("pietement", "Piètement", ["carrés", "ronds", "central"], "carrés")], table),
    "chaise": ("Chaise", [R("largeur", "Largeur", 30, 70, 1, 44), R("profondeur", "Profondeur", 30, 70, 1, 44),
                          R("assise", "Hauteur d'assise", 30, 80, 1, 46), R("dossier", "Hauteur du dossier", 20, 80, 1, 44),
                          R("pieds", "Épaisseur des pieds", 2, 8, 0.5, 4), ("dos", "Dossier", ["barreaux", "plein"], "barreaux"),
                          R("barreaux", "Nombre de barreaux", 1, 8, 1, 3)], chaise),
    "tabouret": ("Tabouret", [R("diametre", "Diamètre", 24, 60, 1, 34), R("hauteur", "Hauteur", 30, 110, 1, 70),
                              R("pieds", "Épaisseur des pieds", 2, 8, 0.5, 3.5), R("nombre", "Nombre de pieds", 3, 4, 1, 4)], tabouret),
    "banc": ("Banc", [R("longueur", "Longueur", 80, 300, 5, 160), R("profondeur", "Profondeur", 25, 60, 1, 38),
                      R("hauteur", "Hauteur", 30, 60, 1, 45), R("pieds", "Épaisseur des pieds", 3, 12, 0.5, 6),
                      R("dossier", "Dossier (0 = sans)", 0, 60, 1, 0)], banc),
    "caisse": ("Caisse / boîte", [R("largeur", "Largeur", 10, 200, 1, 60), R("profondeur", "Profondeur", 10, 200, 1, 40),
                                  R("hauteur", "Hauteur", 5, 200, 1, 40), R("couvercle", "Couvercle (0 = sans)", 0, 12, 0.5, 0)], caisse),
    "etagere": ("Étagère", [R("largeur", "Largeur", 40, 220, 5, 90), R("profondeur", "Profondeur", 15, 60, 1, 30),
                            R("hauteur", "Hauteur", 40, 240, 5, 180), R("planche", "Épaisseur des planches", 1.5, 6, 0.5, 2.5),
                            R("tablettes", "Nombre de tablettes", 2, 9, 1, 5), ("fond", "Fond", ["oui", "non"], "oui")], etagere),
    "lit": ("Lit", [R("largeur", "Largeur", 70, 200, 5, 140), R("longueur", "Longueur", 160, 220, 5, 195),
                    R("hauteur", "Hauteur du sommier", 15, 60, 1, 32), R("matelas", "Épaisseur du matelas", 8, 35, 1, 20),
                    R("tete", "Tête de lit (0 = sans)", 0, 90, 5, 50)], lit),
    "bureau": ("Bureau", [R("largeur", "Largeur", 80, 220, 5, 140), R("profondeur", "Profondeur", 45, 100, 5, 65),
                          R("hauteur", "Hauteur", 60, 85, 1, 74), R("caisson", "Caisson à tiroirs (0 = sans)", 0, 60, 1, 40),
                          R("tiroirs", "Nombre de tiroirs", 1, 5, 1, 3)], bureau),
}


def catalogue():
    out = []
    for key, (label, params, _) in CATALOGUE.items():
        ps = [({"key": q[0], "label": q[1], "min": q[2], "max": q[3], "step": q[4], "def": q[5]} if len(q) == 6
               else {"key": q[0], "label": q[1], "choices": q[2], "def": q[3]}) for q in params]
        out.append({"key": key, "label": label, "params": ps})
    return out


def clean(key, params):
    if key not in CATALOGUE:
        raise ValueError("objet inconnu : %s" % key)
    out = {}
    for q in CATALOGUE[key][1]:
        v = (params or {}).get(q[0])
        if len(q) == 6:
            try:
                v = float(v)
            except (TypeError, ValueError):
                v = q[5]
            out[q[0]] = min(q[3], max(q[2], v))
        else:
            out[q[0]] = v if v in q[2] else q[3]
    return out


# ------------------------------------------------------------------ rendu au trait
def _mesh(parts):
    tris, gid, n, g = [], [], 0, 0
    verts = []
    for v, faces in parts:
        side = None
        for idx, tag in faces:
            if tag == "side":
                if side is None:
                    g += 1
                    side = g
                gg = side
            else:
                g += 1
                gg = g
            for i in range(1, len(idx) - 1):
                tris.append((n + idx[0], n + idx[i], n + idx[i + 1]))
                gid.append(gg)
        verts.append(v)
        n += len(v)
    return np.vstack(verts), np.array(tris, int), np.array(gid, int)


def view_of(params):
    """Reglages de vue (hors cotes) : _elev = hauteur de la camera en degres (negatif : vue d'en dessous), _persp = force de
    la perspective, 0 (lignes paralleles) a 100 (camera tout pres : les fuyantes convergent fort)."""
    p = params or {}
    try:
        elev = min(70.0, max(-30.0, float(p.get("_elev", ELEV))))
    except (TypeError, ValueError):
        elev = ELEV
    try:
        persp = min(100.0, max(0.0, float(p.get("_persp", 0))))
    except (TypeError, ValueError):
        persp = 0.0
    return {"elev": elev, "persp": persp}


def _frame(verts, tris, gid, az, size, scale, centre, line, view=None, radius=1.0):
    """Une image : (alpha, encre) a la taille demandee, vue sous l'angle az (degres). view : hauteur de la camera et force
    de la perspective (view_of) ; sans view, camera un peu au-dessus, en vue parallele."""
    view = view or {"elev": ELEV, "persp": 0.0}
    a, e = math.radians(az), math.radians(view["elev"])
    p = verts - centre
    x = p[:, 0] * math.cos(a) + p[:, 2] * math.sin(a)
    z = -p[:, 0] * math.sin(a) + p[:, 2] * math.cos(a)
    y = p[:, 1] * math.cos(e) - z * math.sin(e)
    depth = p[:, 1] * math.sin(e) + z * math.cos(e)                 # grand = pres de la camera
    if view["persp"] > 0:                                            # perspective : la camera a une distance finie, plus pres = fuyantes plus fortes
        k = view["persp"] / 100.0
        D = radius * (2.2 + 14.0 * (1.0 - k) ** 2)
        f = (D - radius) / np.maximum(D - depth, 1e-3)              # 1 au plus pres : l'objet garde sa taille dans le cadre
        x, y = x * f, y * f
    S = size * SS
    px, py = S / 2 + x * scale * SS, S / 2 - y * scale * SS
    zb = np.full((S, S), -1e9)
    ib = np.zeros((S, S), np.int32)
    for t, g in zip(tris, gid):
        xs, ys, ds = px[t], py[t], depth[t]
        x0, x1 = max(0, int(math.floor(xs.min()))), min(S - 1, int(math.ceil(xs.max())))
        y0, y1 = max(0, int(math.floor(ys.min()))), min(S - 1, int(math.ceil(ys.max())))
        if x1 < x0 or y1 < y0:
            continue
        den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(den) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
        w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
        w2 = 1 - w0 - w1
        d = w0 * ds[0] + w1 * ds[1] + w2 * ds[2]
        sub_z, sub_i = zb[y0:y1 + 1, x0:x1 + 1], ib[y0:y1 + 1, x0:x1 + 1]
        hit = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6) & (d > sub_z + 1e-6)
        sub_z[hit] = d[hit]
        sub_i[hit] = g
    solid = ib > 0
    edge = np.zeros((S, S), bool)                                    # un trait la ou deux faces se rencontrent, et au bord
    edge[:, 1:] |= ib[:, 1:] != ib[:, :-1]
    edge[1:, :] |= ib[1:, :] != ib[:-1, :]
    k = max(3, int(round(line * SS)) | 1)
    ink = Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))
    alpha = Image.fromarray(((solid | (np.asarray(ink) > 0)) * 255).astype(np.uint8))
    return alpha.resize((size, size), Image.LANCZOS), ink.resize((size, size), Image.LANCZOS)


def _setup(key, params):
    verts, tris, gid = _mesh(CATALOGUE[key][2](clean(key, params)))
    lo, hi = verts.min(axis=0), verts.max(axis=0)
    centre = (lo + hi) / 2
    radius = float(np.linalg.norm(verts - centre, axis=1).max())
    return verts, tris, gid, centre, radius


def _rgba(alpha, ink):
    a, i = np.asarray(alpha), np.asarray(ink)
    grey = (255 - i).astype(np.uint8)
    return Image.fromarray(np.dstack([grey, grey, grey, a]))


def preview(key, params, az=30.0, size=360):
    """Apercu PNG d'un objet sous un angle : pour regler les cotes en direct."""
    verts, tris, gid, centre, radius = _setup(key, params)
    alpha, ink = _frame(verts, tris, gid, az, size, (size * 0.46) / radius, centre, 2.2 * size / HEIGHT, view_of(params), radius)
    out = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    out.alpha_composite(_rgba(alpha, ink))
    return out.convert("RGB")


def create(key, params, name="", folder=""):
    """Range l'objet dans la banque, avec son orbite complete (72 images et leurs traces), sans passer par une machine."""
    view = view_of(params)
    params = clean(key, params)
    verts, tris, gid, centre, radius = _setup(key, params)
    size = HEIGHT
    scale = (size * 0.47) / radius
    frames = [_rgba(*_frame(verts, tris, gid, 360.0 * f / FRAMES + 25.0, size, scale, centre, 2.4, view, radius)) for f in range(FRAMES)]
    union = np.zeros((size, size), bool)
    for im in frames:
        union |= np.asarray(im)[..., 3] > 20
    ys, xs = np.where(union)
    bx = (max(0, xs.min() - 6), max(0, ys.min() - 6), min(size, xs.max() + 7), min(size, ys.max() + 7))
    frames = [im.crop(bx) for im in frames]
    tmp = Path(tempfile.mkdtemp(prefix="bwproc_"))
    try:
        base = Image.new("RGBA", frames[0].size, (255, 255, 255, 255))
        base.alpha_composite(frames[0])
        base.convert("RGB").save(tmp / "base.png")
        it = jobs.add_item("asset", name or CATALOGUE[key][0], tmp / "base.png", style="dessin", tags=["procedural", key], folder=folder)
        d = store.item_dir(it["id"])
        frames[0].save(tmp / "cut.png")
        cw, ch, _ = sprites.build_cut(tmp / "cut.png", d / "v/base/cut.webp", fill=False)
        rel = "v/base/o%d_0" % int(time.time())
        (d / rel).mkdir(parents=True, exist_ok=True)
        for f, im in enumerate(frames):
            im.save(d / rel / ("%03d.webp" % f), quality=88, method=4)
        w, h = frames[0].size
        info = {"n": FRAMES, "w": w, "h": h, "ext": "webp", "alpha": True, "motion": 9.0, "dark": 0.0,
                "cover": round(float(union.mean()), 3), "lost": 0.0, "dir": rel, "seed": 0, "length": FRAMES, "bad": False}
        try:
            info["vec"] = vector.orbit(d / rel, FRAMES, False)
            info["vt"] = int(time.time())
        except Exception:                                           # noqa: BLE001 : les images suffisent a afficher
            info["vec"] = False
        info["snaps"] = sprites.default_snaps(FRAMES, "3/4 face gauche")
        info["t"] = int(time.time())

        def apply(x):
            x["proc"] = {"key": key, "params": params, "view": view}
            x["variants"]["base"].update({"cut": "v/base/cut.webp", "cw": cw, "ch": ch, "t": int(time.time()), "orbit": info})
        return store.mutate_item(it["id"], apply)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
