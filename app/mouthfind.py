"""Repere la bouche dessinee d'un personnage au trait, sur une image detouree de son orbite.

Idee : dans un dessin, le visage est une zone blanche fermee par des traits, et ses elements (yeux, nez, bouche) sont
des ilots d'encre poses dedans. On cherche donc la zone blanche du haut du personnage qui contient le plus d'ilots :
c'est le visage. La bouche est l'ilot allonge a l'horizontale le plus bas de ce visage, a peu pres dans son axe.
Rien n'est suppose de la forme de la tete : ca marche sur un dessin tordu, pas seulement sur un visage regulier.

    find(image RGBA) -> None, ou { box [x0, y0, x1, y1] de la bouche, mask (encre de la bouche, dans la box), face [x0, y0,
                        x1, y1], stroke (epaisseur du trait), conf (0 a 1), open (bouche deja ouverte : dents, trou) }
Demande OpenCV, comme les traces (app/vector.py). Sans lui : available() est faux.
"""
import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None


def available():
    return cv2 is not None


def _stroke(ink):
    dist = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    ridge = dist[(dist > 0) & (dist >= cv2.dilate(dist, np.ones((3, 3), np.uint8)))]
    return float(np.percentile(ridge, 60)) * 2 if len(ridge) else 2.0


def _fill(mask):
    """Le masque avec ses trous bouches."""
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(mask)
    cv2.drawContours(out, cs, -1, 255, -1)
    return out


def candidates(im):
    """Tous les visages possibles et leurs ilots, pour le controle. Rend (encre, epaisseur, [(zone pleine, ilots)])."""
    a = np.asarray(im.convert("RGBA"))
    alpha = (a[..., 3] > 60).astype(np.uint8) * 255
    lum = a[..., :3].astype(int).sum(axis=2) / 3
    ink = ((alpha > 0) & (lum < 120)).astype(np.uint8) * 255
    ys = np.where(alpha.any(axis=1))[0]
    if not len(ys) or not ink.any():
        return ink, 2.0, []
    top, tall = ys[0], ys[-1] - ys[0] + 1
    sw = max(1.5, _stroke(ink))
    gap = max(3, int(round(sw * 1.6)) | 1)
    closed = cv2.dilate(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (gap, gap)))    # referme les traits qui ne se touchent pas
    n, lab, st, _ = cv2.connectedComponentsWithStats(((alpha > 0) & (closed == 0)).astype(np.uint8), connectivity=4)
    area = int((alpha > 0).sum())
    faces = []
    for i in range(1, n):
        x, y, w, h, s = st[i]
        if s < area * 0.004 or y + h / 2 > top + tall * 0.5 or w < sw * 8 or h < sw * 8:
            continue
        zone = cv2.dilate((lab == i).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (gap, gap)))
        full = _fill(zone)
        k = max(3, int(round(sw * 2.2)) | 1)
        inner = cv2.erode(full, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        isl = cv2.bitwise_and(ink, inner)
        if not isl.any():
            continue
        # les morceaux d'un meme element se regroupent : deux levres, une rangee de dents
        kx, ky = max(3, int(round(sw * 3.5)) | 1), max(3, int(round(sw * 2.5)) | 1)
        glue = cv2.dilate(isl, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kx, ky)))
        m, gl, gs, gc = cv2.connectedComponentsWithStats(glue, connectivity=8)
        out = []
        for j in range(1, m):
            piece = ((gl == j) & (isl > 0))
            if piece.sum() < sw * sw * 2:
                continue
            py, px = np.where(piece)
            out.append(dict(x0=int(px.min()), y0=int(py.min()), x1=int(px.max()) + 1, y1=int(py.max()) + 1, n=int(piece.sum()), mask=piece))
        if out:
            faces.append(dict(box=[int(x), int(y), int(x + w), int(y + h)], full=full, isl=out))
    return ink, sw, faces


def _score(c, fb, sw, others):
    """Note d'un ilot comme bouche, de 0 a 1."""
    fx0, fy0, fx1, fy1 = fb
    fw, fh = fx1 - fx0, fy1 - fy0
    w, h = c["x1"] - c["x0"], c["y1"] - c["y0"]
    cx, cy = (c["x0"] + c["x1"]) / 2, (c["y0"] + c["y1"]) / 2
    nx, ny, rw = (cx - fx0) / fw, (cy - fy0) / fh, w / fw
    if ny < 0.45 or ny > 0.97 or rw < 0.1 or rw > 0.9 or w < sw * 4:
        return 0.0
    flat = min(1.0, (w / max(h, sw)) / 2.5)                       # allongee a l'horizontale
    wide = min(1.0, rw / 0.22) * (1.0 if rw < 0.7 else 0.6)
    mid = max(0.0, 1 - abs(nx - 0.5) / 0.42)
    low = 0.55 + 0.45 * min(1.0, (ny - 0.45) / 0.35)
    above = sum(1 for o in others if (o["y0"] + o["y1"]) / 2 < c["y0"])  # des yeux, un nez au-dessus : c'est bien un visage
    return flat * wide * mid * low * (1.0 if above >= 2 else 0.75 if above == 1 else 0.35)


def find(im, near=None):
    """Voir l'en-tete. near : (x, y) en pixels, pour accrocher l'ilot le plus proche d'un clic au lieu de choisir seul."""
    if cv2 is None:
        return None
    ink, sw, faces = candidates(im)
    best = None
    for f in faces:
        if near is not None:
            for c in f["isl"]:
                d = np.hypot(min(max(near[0], c["x0"]), c["x1"]) - near[0], min(max(near[1], c["y0"]), c["y1"]) - near[1])
                if best is None or d < best[0]:
                    best = (d, c, f, 0.0)
            continue
        if len(f["isl"]) < 2:
            continue
        sc = sorted(((_score(c, f["box"], sw, f["isl"]), i) for i, c in enumerate(f["isl"])), reverse=True)
        s1, s2 = sc[0][0], (sc[1][0] if len(sc) > 1 else 0.0)
        conf = s1 * (0.6 + 0.4 * min(1.0, (s1 - s2) / max(s1, 1e-6) / 0.3))     # un second presque aussi bon : on doute
        if s1 > 0 and (best is None or conf > best[0]):
            best = (conf, f["isl"][sc[0][1]], f, conf)
    if best is None:
        return None
    if near is not None and best[0] > sw * 12:
        return None
    _, c, f, conf = best
    m = c["mask"][c["y0"]:c["y1"], c["x0"]:c["x1"]]
    w, h = c["x1"] - c["x0"], c["y1"] - c["y0"]
    return dict(box=[c["x0"], c["y0"], c["x1"], c["y1"]], mask=m, face=f["box"], stroke=round(sw, 2),
                conf=round(float(conf if near is None else 1.0), 3), open=bool(h > sw * 4.5 and h > w * 0.3))


def shape(r, n=9):
    """De la bouche trouvee au trace qui la fait parler. Rend { up: [[x, y] * n] la ligne de la bouche, d'un coin a
    l'autre (levre du haut quand elle s'ouvre), lo: la meme pour le bas d'une bouche deja ouverte (sinon None),
    w: largeur, stroke }. Coordonnees en pixels de l'image donnee a find()."""
    m, (x0, y0, x1, y1) = r["mask"], r["box"]
    cols = np.where(m.any(axis=0))[0]
    top = np.array([np.argmax(m[:, c]) for c in cols], float)
    bot = np.array([m.shape[0] - 1 - np.argmax(m[::-1, c]) for c in cols], float)
    xs = np.linspace(cols[0], cols[-1], n)
    deg = 3 if len(cols) > 12 else 1

    def curve(v):                                  # courbe lisse a travers le trait (les dents et les accrocs ne comptent pas)
        fit = np.polyfit(cols, v, deg)
        return [[round(float(x0 + x), 1), round(float(y0 + np.polyval(fit, x)), 1)] for x in xs]
    if r["open"]:
        return dict(up=curve(top), lo=curve(bot), w=int(x1 - x0), stroke=r["stroke"])
    return dict(up=curve((top + bot) / 2), lo=None, w=int(x1 - x0), stroke=r["stroke"])


def lens(sh, open_=1.0, drop=0.3):
    """Le contour de la bouche ouverte : la ligne du dessin en haut, la levre du bas qui descend. open_ : 0 a 1."""
    up = np.array(sh["up"], float)
    t = np.linspace(0, 1, len(up))
    d = sh["w"] * drop * open_ * np.sin(np.pi * t) ** 0.75
    lo = up + np.stack([np.zeros_like(d), d], axis=1)
    return up.tolist(), lo.tolist()