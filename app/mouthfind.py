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


def lens(sh, open_=1.0, drop=0.22):
    """Le contour de la bouche ouverte : la ligne du dessin en haut, la levre du bas qui descend. open_ : 0 a 1."""
    up = np.array(sh["up"], float)
    t = np.linspace(0, 1, len(up))
    d = sh["w"] * drop * open_ * np.sin(np.pi * t) ** 0.75
    lo = up + np.stack([np.zeros_like(d), d], axis=1)
    return up.tolist(), lo.tolist()

# ------------------------------------------------------------------ accrochage a un clic, puis suivi dans l'orbite
UPS = 3                                           # agrandissement de la fenetre de travail : la morphologie y est plus fine


def _window(im, cx, cy):
    """La fenetre autour d'un point, agrandie. Rend (encre, silhouette, x0, y0, taille du personnage en pixels agrandis)."""
    a = np.asarray(im.convert("RGBA"))
    ys = np.where((a[..., 3] > 60).any(axis=1))[0]
    tall = (ys[-1] - ys[0] + 1) if len(ys) else im.height
    rx, ry = int(tall * 0.13), int(tall * 0.075)
    x0, y0 = max(0, int(cx) - rx), max(0, int(cy) - ry)
    x1, y1 = min(im.width, int(cx) + rx), min(im.height, int(cy) + ry)
    w = cv2.resize(a[y0:y1, x0:x1], None, fx=UPS, fy=UPS, interpolation=cv2.INTER_CUBIC)
    alpha = (w[..., 3] > 60).astype(np.uint8) * 255
    ink = ((alpha > 0) & (w[..., :3].astype(int).sum(axis=2) / 3 < 120)).astype(np.uint8) * 255
    return ink, alpha, x0, y0, tall * UPS


def _flat(ink, sw):
    """Les traits a peu pres horizontaux : ce qui reste de l'encre apres ouverture par des segments couches."""
    L = int(max(9, sw * 5))
    out = np.zeros_like(ink)
    for ang in (-32, -20, -10, 0, 10, 20, 32):
        k = np.zeros((L, L), np.uint8)
        c, t = (L - 1) / 2, np.tan(np.radians(ang))
        cv2.line(k, (0, int(round(c + t * c))), (L - 1, int(round(c - t * c))), 1, 1)
        out |= cv2.morphologyEx(ink, cv2.MORPH_OPEN, k)
    return out


def _hole(ink, alpha, px, py, sw, limit):
    """Bouche ouverte : la zone blanche fermee sous le point, avec ses voisines (les dents). Rend le masque ou None."""
    free = ((alpha > 0) & (ink == 0)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    h, w = ink.shape
    ok = lambda i: i > 0 and st[i][4] < limit and st[i][0] > 0 and st[i][1] > 0 and st[i][0] + st[i][2] < w and st[i][1] + st[i][3] < h
    r = int(sw * 1.5)
    seeds = set(int(v) for v in np.unique(lab[max(0, py - r):py + r + 1, max(0, px - r):px + r + 1]))
    seeds = {i for i in seeds if ok(i)}
    if not seeds:
        return None
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(sw * 2.6) | 1, int(sw * 2.6) | 1))
    for _ in range(4):                             # les zones voisines, separees par un seul trait
        zone = np.isin(lab, list(seeds)).astype(np.uint8)
        more = {int(v) for v in np.unique(lab[cv2.dilate(zone, k) > 0])} - seeds
        more = {i for i in more if ok(i)}
        if not more:
            break
        seeds |= more
    zone = np.isin(lab, list(seeds)).astype(np.uint8) * 255
    if zone.sum() / 255 > limit:
        return None
    return cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(sw * 2.2) | 1, int(sw * 2.2) | 1)))


def at(im, x, y, prev=None, line=None, strict=False):
    """La bouche sous un point de l'image (un clic, ou la place de la bouche dans l'image voisine de l'orbite).
    prev : la bouche de l'image voisine, pour ne suivre que quelque chose qui lui ressemble.
    line : le trait que l'utilisateur a trace sur la bouche, [[x, y], ...] d'un coin a l'autre : on ne garde que l'encre
    sous ce trait, et s'il n'y en a pas (personnage sans bouche dessinee) c'est le trait lui-meme qui sert de bouche.
    Rend None ou { up, lo (None si c'est un simple trait), w, stroke, drop, open, cx, cy, cover (bouche ouverte : le contour a
    effacer) }, en pixels de l'image."""
    if cv2 is None:
        return None
    ink, alpha, ox, oy, tall = _window(im, x, y)
    if not ink.any():
        return None
    sw = max(2.0, _stroke(ink))
    px, py = int((x - ox) * UPS), int((y - oy) * UPS)
    want_open = None if prev is None else bool(prev["open"])
    res = None
    if want_open is not False:
        z = _hole(ink, alpha, px, py, sw, (tall * 0.11) ** 2)
        if z is not None:
            ys_, xs_ = np.where(z > 0)
            res = dict(mask=z[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1] > 0, box=[xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1], open=True, stroke=sw)
    if line is not None:
        pts = np.array([[(p[0] - ox) * UPS, (p[1] - oy) * UPS] for p in line], np.int32)
        span = float(np.abs(pts[-1] - pts[0]).max())
        if res is not None and (res["box"][2] - res["box"][0]) < span * 0.45:
            res = None                              # un petit trou sous le trait (une dent, une narine) n'est pas la bouche
        if res is None:
            band = np.zeros_like(ink)
            cv2.polylines(band, [pts], False, 255, int(sw * (9 if strict else 5)) | 1)
            got = cv2.bitwise_and(_flat(ink, sw), band)
            gx0, gx1 = pts[:, 0].min(), pts[:, 0].max()
            got[:, :max(0, gx0 - int(sw * (3 if strict else 1)))] = 0
            got[:, gx1 + int(sw * (3 if strict else 1)):] = 0
            if strict and got.any(axis=0).sum() < span * 0.45:
                return None                         # suivi : plus assez d'encre la ou etait la bouche, elle est perdue
            if (got.any(axis=0).sum()) < span * 0.4:    # pas de bouche dessinee la : le trait trace fait la bouche
                got = np.zeros_like(ink)
                cv2.polylines(got, [pts], False, 255, max(1, int(round(sw))))
            ys_, xs_ = np.where(got > 0)
            res = dict(mask=got[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1] > 0, box=[xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1], open=False, stroke=sw)
    if res is None and want_open is not True:
        flat = _flat(ink, sw)
        n, lab, st, cen = cv2.connectedComponentsWithStats(flat, connectivity=8)
        best = None
        for i in range(1, n):
            bx, by, bw, bh, s = st[i]
            if bw < sw * 4:
                continue
            d = np.hypot(min(max(px, bx), bx + bw) - px, min(max(py, by), by + bh) - py)
            if prev is not None:
                r = bw / max(1.0, prev["w"] * UPS)
                if r < 0.4 or r > 1.6:
                    continue
                d += abs(cen[i][0] - px) * 0.5
            if d < sw * (7 if prev is None else 5) and (best is None or d < best[0]):
                best = (d, i)
        if best is not None:
            bx, by, bw, bh, _ = st[best[1]]
            m = lab[by:by + bh, bx:bx + bw] == best[1]
            res = dict(mask=m, box=[bx, by, bx + bw, by + bh], open=False, stroke=sw)
    if res is None:
        return None
    sh = shape(res)
    back = lambda pts: [[round(p[0] / UPS + ox, 2), round(p[1] / UPS + oy, 2)] for p in pts] if pts else None
    out = dict(up=back(sh["up"]), lo=back(sh["lo"]), w=round(sh["w"] / UPS, 2), stroke=round(sw / UPS, 2), open=res["open"])
    b = res["box"]
    out["drop"] = round(min(out["w"] * 0.22, out["stroke"] * 14), 2)   # descente conseillee de la levre du bas, bouche grande ouverte
    out["cx"], out["cy"] = round((b[0] + b[2]) / 2 / UPS + ox, 2), round((b[1] + b[3]) / 2 / UPS + oy, 2)
    if res["open"]:
        full = np.zeros(ink.shape, np.uint8)
        full[b[1]:b[3], b[0]:b[2]][res["mask"]] = 255
        c = max(cv2.findContours(full, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
        out["cover"] = back(cv2.approxPolyDP(c, 1.5, True)[:, 0, :].tolist())
    return out


def track(folder, n, f0, line, reach=20, need_ink=False):
    """Accroche la bouche au trait trace par l'utilisateur (line : [[x, y], ...] en pixels de l'image f0 de l'orbite) puis la suit d'image en image des deux
    cotes, tant qu'elle se reconnait. Ecrit <dossier>/mouth.json : { w, h, src: {f, line}, frames: [bouche ou null] }.
    Rend le nombre d'images ou la bouche est suivie (0 : rien sous le clic, rien n'est ecrit)."""
    import json
    from pathlib import Path
    from PIL import Image
    folder = Path(folder)
    load = lambda i: Image.open(folder / ("%03d.webp" % (i % n))).convert("RGBA")
    im = load(f0)
    x, y = (line[0][0] + line[-1][0]) / 2, (line[0][1] + line[-1][1]) / 2
    first = at(im, x, y, line=line, strict=need_ink)     # need_ink : trait reporte d'une autre pose, il faut de l'encre dessous
    if first is None:
        return 0
    frames = [None] * n
    frames[f0 % n] = first
    for step in (1, -1):
        prev = first
        for k in range(1, reach + 1):
            i = (f0 + step * k) % n
            if frames[i] is not None:
                break
            cur = at(load(i), prev["cx"], prev["cy"], prev, line=None if prev["open"] else prev["up"], strict=True)
            if cur is None or abs(cur["cy"] - prev["cy"]) > max(4.0, prev["w"] * 0.35):
                break
            frames[i] = cur
            prev = cur
    (folder / "mouth.json").write_text(json.dumps(dict(w=im.width, h=im.height, src=dict(f=int(f0), auto=bool(need_ink), line=[[round(float(p[0]), 1), round(float(p[1]), 1)] for p in line]), frames=frames)), encoding="utf-8")
    return sum(1 for f in frames if f)

BACK_REACH = 6


def extend_back(folder, n, snaps, reach=BACK_REACH):
    """Bouche de dos : passe le profil, le suivi perd la bouche (il n'en reste que le bout des levres, sur le bord de la
    silhouette). On la place la, sur les `reach` images qui suivent chaque profil vers le dos (sans depasser le 3/4 dos) :
    meme hauteur que la bouche suivie la plus proche, collee au bord avant de la silhouette (a gauche pour le profil gauche,
    a droite pour le profil droit : le cote vers lequel le sujet regarde), de plus en plus etroite. Ces images sont marquees
    ext : les bouches dessinees de dos (tools/levres_dzine.py --dos) s'y recalent ; la bouche tracee ne s'y dessine pas.
    Ne touche pas aux images deja suivies. Rend le nombre d'images ajoutees (0 : rien a faire, mouth.json intact)."""
    import json
    from pathlib import Path
    from PIL import Image
    folder = Path(folder)
    path = folder / "mouth.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    frames = data.get("frames") or []
    if len(frames) != n:
        return 0
    real = [i for i, m in enumerate(frames) if m and not m.get("ext")]
    if not real:
        return 0
    old = sum(1 for m in frames if m and m.get("ext"))
    frames = [m if m and not m.get("ext") else None for m in frames]   # repartir de zero : les reperes ont pu changer
    wface = float(np.median([frames[i]["w"] for i in real]))
    stroke = float(np.median([frames[i].get("stroke") or 2 for i in real]))
    added = 0
    for side, left in (("gauche", True), ("droit", False)):
        p, b = snaps.get("profil " + side), snaps.get("3/4 dos " + ("gauche" if left else "droite"))
        if p is None or b is None:
            continue
        p, b = int(p) % n, int(b) % n
        fwd = (b - p) % n                              # images du profil au 3/4 dos, dans le sens croissant ?
        step, span = (1, fwd) if fwd <= n // 2 else (-1, n - fwd)
        # la bouche est parfois suivie au-dela du profil : la fenetre de dos part de la derniere image suivie
        k0 = 0
        while k0 < span - 1 and frames[(p + step * (k0 + 1)) % n] is not None:
            k0 += 1
        if frames[(p + step * k0) % n] is None:
            k0 = 0
        start = (p + step * k0) % n
        near = start if frames[start] is not None else min(real, key=lambda i: min(abs(i - p), n - abs(i - p)))
        cy = float(frames[near]["cy"])
        w0 = float(frames[near]["w"]) if near == start and k0 else (float(frames[p]["w"]) if frames[p] else wface * 0.5)
        last = min(k0 + reach, max(1, span - 1))
        for k in range(k0, last + 1):
            i = (p + step * k) % n
            if frames[i] is not None and not frames[i].get("ext"):
                continue
            im = np.asarray(Image.open(folder / ("%03d.webp" % i)).convert("RGBA"))
            row = im[int(round(min(max(cy, 0), im.shape[0] - 1))), :, 3] > 100
            xs = np.where(row)[0]
            if not xs.size:
                break
            runs = np.split(xs, np.where(np.diff(xs) > 1)[0] + 1)
            run = max(runs, key=len)                   # la tete : le plus long passage opaque a hauteur de bouche
            wk = max(6.0, w0 * (1 - 0.45 * (k - k0) / max(1, last - k0)))
            edge = float(run[0] if left else run[-1])
            cx = edge + wk * 0.5 if left else edge - wk * 0.5
            frames[i] = dict(up=[[round(cx - wk / 2, 2), round(cy, 2)], [round(cx + wk / 2, 2), round(cy, 2)]], lo=None, w=round(wk, 2),
                             stroke=round(stroke, 2), open=False, drop=round(min(wk * 0.22, stroke * 14), 2), cx=round(cx, 2), cy=round(cy, 2), ext=1)
            added += 1
    if added or old:
        data["frames"] = frames
        path.write_text(json.dumps(data), encoding="utf-8")
    return added


def carry(src, f0, line, dst, n, f1=None):
    """Reporte un trait de bouche d'une orbite sur une autre pose du meme personnage : le visage autour du trait (image f0
    de src) est recherche dans l'image f1 de dst (f0 par defaut), a quelques echelles. Rend (trait reporte, note de 0 a 1)
    ou None si le visage ne se retrouve pas."""
    if cv2 is None:
        return None
    from pathlib import Path
    from PIL import Image

    def gray(folder, i):
        im = np.asarray(Image.open(Path(folder) / ("%03d.webp" % (i % n))).convert("RGBA")).astype(np.float32)
        a = im[..., 3:4] / 255.0
        return (im[..., :3] * a + 255 * (1 - a)).mean(axis=2).astype(np.uint8)
    a, b = gray(src, f0), gray(dst, f0 if f1 is None else f1)
    xs, ys = [p[0] for p in line], [p[1] for p in line]
    cx, cy, w = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(12.0, max(xs) - min(xs))
    x0, x1 = int(max(0, cx - 1.5 * w)), int(min(a.shape[1], cx + 1.5 * w))      # le visage : des yeux au menton
    y0, y1 = int(max(0, cy - 2.4 * w)), int(min(a.shape[0], cy + 1.0 * w))
    tpl = a[y0:y1, x0:x1]
    if tpl.shape[0] < 12 or tpl.shape[1] < 12 or tpl.std() < 8:
        return None
    best = None
    for k in (0.8, 0.87, 0.94, 1.0, 1.07, 1.15, 1.25):
        t = cv2.resize(tpl, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
        if t.shape[0] >= b.shape[0] or t.shape[1] >= b.shape[1]:
            continue
        r = cv2.matchTemplate(b, t, cv2.TM_CCOEFF_NORMED)
        _, v, _, loc = cv2.minMaxLoc(r)
        if best is None or v > best[0]:
            best = (v, k, loc)
    if best is None or best[0] < 0.42:
        return None
    v, k, (bx, by) = best
    return [[round(bx + (p[0] - x0) * k, 1), round(by + (p[1] - y0) * k, 1)] for p in line], round(float(v), 3)
