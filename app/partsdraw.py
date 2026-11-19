"""Elements de visage du portrait-robot, traces par le calcul.

Pourquoi par le calcul : un modele d'image redessine toujours le meme element moyen et ajoute des morceaux du reste du
visage (un bout de nez sous les yeux, un cou sous la barbe). Ici chaque variante est decrite par ses cotes : deux nez
different vraiment par leur forme, un element ne contient que lui-meme, tout est vu strictement de face.

Tout est dessine dans le meme cadre de 1000 x 1000, celui de l'atelier (identikit.js), sur une tete de reference :
axe du visage x = 500, sommet du crane y = 150, ligne des yeux y = 480, base du nez y = 625, bouche y = 715,
menton y = 880, largeur aux pommettes 520. Un element garde donc sa vraie taille et sa vraie place : un petit nez
reste petit, des yeux ecartes restent ecartes. Chaque fonction rend (image RGBA rognee, place = [cx, cy, largeur]).

Trait noir pose au pinceau rond le long d'une courbe lissee, epaisseur vivante, leger tremble ; blanc opaque sous
l'element (il cache ce qui est dessous), transparent autour.
"""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

F = 1000                                         # cadre de l'atelier
FH = 1300                                        # hauteur de dessin : une longue barbe descend sous le cadre
SS = 2                                           # sur-echantillonnage
CX = 500


def smooth(pts, closed=False, n=16):
    """Courbe lisse passant par les points (Catmull-Rom)."""
    pts = [np.array(q, float) for q in pts]
    if len(pts) < 3:
        return pts
    p = ([pts[-1]] + pts + pts[:2]) if closed else ([pts[0]] + pts + [pts[-1]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1:i + 3]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[0] if closed else pts[-1])
    return out


def resample(c, step=0.7):
    """Points regulierement espaces le long de la courbe : sans cela le pinceau fait des pointilles sur les longs segments."""
    c = np.array(c, float)
    d = np.hypot(*np.diff(c, axis=0).T)
    s = np.concatenate([[0], np.cumsum(d)])
    if s[-1] < 1e-6:
        return c[:1], 0.0
    t = np.arange(0, s[-1], step)
    return np.column_stack([np.interp(t, s, c[:, 0]), np.interp(t, s, c[:, 1])]), s[-1]


def mirror(pts):
    return [(2 * CX - x, y) for x, y in pts]


class Canvas:
    def __init__(self, seed=1, w=F, h=FH):
        self.W, self.H = w, h
        self.ink = Image.new("L", (w * SS, h * SS), 0)
        self.fill = Image.new("L", (w * SS, h * SS), 0)
        self.rnd = random.Random(seed)

    def line(self, pts, w=4.0, ends=(0.3, 0.3), wob=0.9, closed=False, straight=False, on=None):
        """Trait au pinceau. ends : epaisseur relative au depart et a l'arrivee (1 = pleine, 0.2 = effilee)."""
        c = [np.array(q, float) for q in pts] if straight else smooth(pts, closed)
        c, length = resample(c)
        if not len(c):
            return
        d = ImageDraw.Draw(on or self.ink)
        ph = [self.rnd.uniform(0, 6.28) for _ in range(4)]
        n = len(c)
        for i, (x, y) in enumerate(c):
            t = i / max(1, n - 1)
            k = 1.0
            if not closed:
                a, b = ends
                k = min(1.0, a + (1 - a) * min(1, t / 0.22), b + (1 - b) * min(1, (1 - t) / 0.22))
            s = t * length
            k *= 1 + 0.13 * math.sin(s / 23 + ph[0]) + 0.06 * math.sin(s / 7 + ph[1])
            x += wob * 0.7 * math.sin(s / 31 + ph[2])
            y += wob * 0.7 * math.sin(s / 27 + ph[3])
            r = max(0.55, w * k / 2) * SS
            d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=255)

    def black(self, pts, on=None):
        ImageDraw.Draw(on or self.ink).polygon([(x * SS, y * SS) for x, y in smooth(pts, True)], fill=255)

    def disc(self, cx, cy, rx, ry=None, on=None):
        ry = rx if ry is None else ry
        ImageDraw.Draw(on or self.ink).ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=255)

    def white(self, pts, curved=True):
        """Blanc opaque sous l'element."""
        ImageDraw.Draw(self.fill).polygon([(x * SS, y * SS) for x, y in (smooth(pts, True) if curved else pts)], fill=255)

    def erase(self, pts):
        """Efface l'encre dans une forme (reflet de l'oeil, verre de lunettes)."""
        ImageDraw.Draw(self.ink).polygon([(x * SS, y * SS) for x, y in smooth(pts, True)], fill=0)

    def layer(self):
        return Image.new("L", (self.W * SS, self.H * SS), 0)

    def stamp(self, layer, mask_pts=None, curved=True):
        """Pose un calque d'encre, eventuellement decoupe par une forme (l'iris coupe par les paupieres)."""
        if mask_pts is not None:
            m = Image.new("L", layer.size, 0)
            ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in (smooth(mask_pts, True) if curved else mask_pts)], fill=255)
            layer = ImageChops.multiply(layer, m)
        self.ink = ImageChops.lighter(self.ink, layer)

    def result(self):
        ink = np.asarray(self.ink.filter(ImageFilter.GaussianBlur(SS * 0.3)).resize((self.W, self.H), Image.LANCZOS))
        fill = np.asarray(self.fill.filter(ImageFilter.GaussianBlur(SS * 0.5)).resize((self.W, self.H), Image.LANCZOS))
        a = np.maximum(ink, fill)
        grey = (255 - ink).astype(np.uint8)
        ys, xs = np.where(a > 24)
        x0, x1, y0, y1 = max(0, xs.min() - 4), min(self.W, xs.max() + 5), max(0, ys.min() - 4), min(self.H, ys.max() + 5)
        im = Image.fromarray(np.dstack([grey, grey, grey, a])).crop((x0, y0, x1, y1))
        return im, [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1), int(x1 - x0)]


# ------------------------------------------------------------------ forme du visage (contour seul, sans oreilles)
VISAGE = dict(top=150,        # sommet du crane
              wf=500,         # largeur du crane aux tempes (a y = 330)
              wc=520,         # largeur aux pommettes (a y = 500)
              wj=440,         # largeur de la machoire a son angle
              wch=170,        # largeur du menton
              chin=880,       # bas du menton
              ja=0.35,        # angle de la machoire : 0 arrondi, 1 anguleux
              jy=735,         # hauteur de l'angle de la machoire
              cs="rond",      # menton : rond | pointu | carre | fossette
              crane=1.0,      # hauteur du crane (bombe > 1, plat < 1)
              dbl=0,          # double menton
              joue=0,         # joues : > 0 pleines, < 0 creuses
              profil=None,    # contour mesure sur une photo (Transposer), a la place de la machoire calculee
              trait=5.0)


def _pchip(xs, ys, d0=None, d1=None):
    """Interpolation cubique monotone : pas de bosse parasite entre deux cotes (contrairement a une spline libre)."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    m = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    d = [0.0] * n
    for i in range(1, n - 1):
        if m[i - 1] * m[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            d[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i])
    d[0], d[-1] = (m[0] if d0 is None else d0), (m[-1] if d1 is None else d1)

    def f(x):
        i = max(0, min(n - 2, next((k for k in range(n - 1) if x <= xs[k + 1]), n - 2)))
        t = (x - xs[i]) / h[i]
        return ((2 * t ** 3 - 3 * t * t + 1) * ys[i] + (t ** 3 - 2 * t * t + t) * h[i] * d[i]
                + (-2 * t ** 3 + 3 * t * t) * ys[i + 1] + (t ** 3 - t * t) * h[i] * d[i + 1])
    return f


def visage(seed=1, **kw):
    p = dict(VISAGE, **kw)
    c = Canvas(seed)
    top, chin, jy = p["top"], p["chin"], p["jy"]
    ym = (500 + jy) / 2
    ys = [330, 500, ym, jy]
    hs = [p["wf"] / 2, p["wc"] / 2, (p["wc"] + p["wj"]) / 4 + p["joue"], p["wj"] / 2]
    side = _pchip(ys, hs, d0=0.0, d1=0.0)
    e = 2.0 * p["crane"]
    right = []
    for u in np.cos(np.linspace(0, math.pi / 2, 30)):          # le crane : une ellipse plus ou moins bombee
        right.append((CX + p["wf"] / 2 * max(0.0, 1 - u ** e) ** (1 / e), 330 - (330 - top) * u))
    if p.get("profil"):                            # contour mesure (Transposer) : [(y, demi-largeur)] des tempes au menton
        right += [(CX + float(hw), float(y)) for y, hw in p["profil"] if y > 334]
        right.append((CX, float(chin)))
    else:
        right += [(CX + side(float(y)), float(y)) for y in np.arange(336, jy, 6.0)]
        # de l'angle de la machoire au bas du menton : une part « machoire » (droite si anguleuse, ronde sinon) et une part
        # « menton » (large et plate, ronde, ou pointue) qui se fondent, sans decrochement
        nj = 2.0 - 1.0 * p["ja"]
        nc = {"pointu": 1.05, "carre": 6.0}.get(p["cs"], 2.6)
        wch = p["wch"] / 2
        for th in np.linspace(0, math.pi / 2, 60):
            co, si = max(0.0, math.cos(th)), math.sin(th)
            right.append((CX + wch * co ** (2 / nc) + (p["wj"] / 2 - wch) * co ** (2 / nj), jy + (chin - jy) * si ** (2 / 2.0)))
    pts = right + mirror(right[1:-1])[::-1]
    arr, _ = resample(pts + pts[:1], 4.0)                           # lissage ferme : efface les decrochements aux raccords
    k = int(5 + 9 * (1 - p["ja"]))
    ker = np.hanning(2 * k + 1); ker /= ker.sum()
    pad = np.concatenate([arr[-k:], arr, arr[:k]])
    pts = [tuple(q) for q in np.column_stack([np.convolve(pad[:, 0], ker, "valid"), np.convolve(pad[:, 1], ker, "valid")])]
    right = [q for q in pts if q[0] >= CX]
    half = lambda y: max(x for x, yy in right if abs(yy - y) < 8) - CX
    if p["dbl"]:                                   # double menton : un arc sous le menton, d'un bord a l'autre de la machoire
        y0 = chin - 62
        w0 = half(y0)
        yb = chin + 36 * p["dbl"]
        arc = [(CX - w0, y0), (CX - w0 * 0.8, yb - 30), (CX - w0 * 0.38, yb - 4), (CX, yb), (CX + w0 * 0.38, yb - 4), (CX + w0 * 0.8, yb - 30), (CX + w0, y0)]
        c.white([tuple(q) for q in smooth(arc)], curved=False)
        c.line(arc, p["trait"] * 0.85, ends=(0.5, 0.5), wob=1.2)
    c.white(pts, curved=False)
    c.line(pts + pts[:1], p["trait"], ends=(1, 1), wob=1.3, straight=True)
    if p["cs"] == "fossette":
        c.line([(CX, chin - 50), (CX - 1, chin - 18)], p["trait"] * 0.7, ends=(0.2, 0.5))
    if p["joue"] < -8:                             # joues creuses : un trait sous la pommette
        for s in (-1, 1):
            x0 = CX + s * (p["wc"] / 2 - 30)
            c.line([(x0, 545), (x0 - s * 26, 610), (x0 - s * 34, 680)], p["trait"] * 0.5, ends=(0.15, 0.15))
    return c.result()


VISAGE_VARIANTES = [
    ("Ovale", {}),
    ("Rond", dict(wf=540, wc=590, wj=540, wch=260, chin=850, ja=0.0, joue=14, jy=700)),
    ("Carré", dict(wf=520, wc=530, wj=510, wch=330, chin=865, ja=0.85, cs="carre", jy=770)),
    ("Long étroit", dict(top=110, wf=420, wc=430, wj=380, wch=150, chin=945, crane=0.95, jy=760)),
    ("Triangle, menton pointu", dict(wf=540, wc=530, wj=400, wch=60, chin=905, cs="pointu", ja=0.8, jy=690)),
    ("Poire, mâchoire lourde", dict(wf=420, wc=480, wj=560, wch=300, chin=885, ja=0.5, jy=770, joue=14)),
    ("Losange, pommettes larges", dict(wf=420, wc=570, wj=400, wch=80, chin=900, cs="pointu", ja=0.6, joue=-14, jy=700)),
    ("Menton en galoche", dict(wf=480, wc=500, wj=450, wch=300, chin=965, ja=0.9, cs="carre", jy=760)),
    ("Menton court, fuyant", dict(wf=500, wc=520, wj=440, wch=110, chin=810, ja=0.3, jy=690)),
    ("Émacié", dict(wf=470, wc=480, wj=380, wch=140, chin=905, ja=0.9, joue=-26, jy=750)),
    ("Double menton", dict(wf=500, wc=570, wj=540, wch=230, chin=850, ja=0.0, dbl=1.0, joue=16, jy=710)),
    ("Menton à fossette", dict(wj=470, wch=260, ja=0.7, cs="fossette", chin=890, jy=750)),

    ("Carré court", dict(wf=540, wc=560, wj=540, wch=360, chin=805, ja=0.9, cs="carre", jy=715)),
    ("Rectangulaire", dict(top=120, wf=470, wc=470, wj=460, wch=300, chin=925, ja=0.9, cs="carre", jy=800)),
    ("Oblong arrondi", dict(top=120, wf=450, wc=460, wj=440, wch=250, chin=930, ja=0.0, jy=730)),
    ("Trapèze, mâchoire écartée", dict(wf=430, wc=500, wj=590, wch=330, chin=870, ja=1.0, cs="carre", jy=790)),
    ("Cœur", dict(wf=560, wc=560, wj=430, wch=70, chin=885, ja=0.2, cs="pointu", joue=16, jy=680)),
    ("Menton pointu en V", dict(wf=490, wc=510, wj=470, wch=30, chin=910, ja=1.0, cs="pointu", jy=640)),
    ("Crâne large, bas étroit", dict(top=130, wf=580, wc=500, wj=350, wch=150, chin=880, ja=0.3, crane=1.15, jy=720)),
    ("Front fuyant, crâne pointu", dict(top=110, wf=440, wc=520, wj=460, wch=200, chin=880, crane=0.72, ja=0.4)),
]


# ------------------------------------------------------------------ yeux (la paire, sans sourcils)
YEUX = dict(w=104,            # longueur de la fente
            h=40,             # ouverture
            ecart=250,        # distance entre les centres des deux yeux
            y=480,
            tilt=0,           # coin externe : < 0 remonte (bride), > 0 tombe
            peak=0.45,        # ou la paupiere superieure est la plus haute (0 = coin interne, 1 = coin externe)
            low=0.42,         # courbure de la paupiere inferieure (part de l'ouverture)
            arc=0.58,         # hauteur de l'arc de la paupiere superieure (part de l'ouverture)
            pli=14,           # hauteur de paupiere visible au-dessus de l'oeil (0 = paupiere sans pli)
            hood=0,           # paupiere tombante : le pli descend sur le coin externe (0 a 1)
            iris=23,          # rayon de l'iris
            pup=9,            # rayon de la pupille
            dy=-2,            # hauteur de l'iris dans l'ouverture (< 0 : en partie sous la paupiere superieure)
            dx=0,             # regard decale (strabisme : mettre dxg different)
            cils=0,           # 0 aucun, 1 courts, 2 longs
            poche=0,          # poches sous les yeux : 0, 1, 2
            cerne=0,          # trait de cerne
            sup=6.5, inf=2.6, # epaisseur des paupieres
            g=None)           # reglages propres a l'oeil gauche de l'image (dissymetrie)


def _oeil(c, p, cx, side):
    """Un oeil ; side = +1 : coin externe a droite de l'image."""
    w, h, y = p["w"], p["h"], p["y"]
    xi, xo = cx - side * w / 2, cx + side * w / 2
    yi, yo = y + 4, y + p["tilt"]
    pk = xi + side * w * p["peak"]
    ar = p["arc"]
    up = [(xi, yi), (xi + side * w * 0.14, y - h * ar * 0.6), (pk, y - h * ar), (xi + side * w * 0.78, y - h * ar * 0.62 + p["tilt"] * 0.6), (xo, yo)]
    lo = [(xo, yo), (xi + side * w * 0.72, y + h * p["low"] + p["tilt"] * 0.5), (xi + side * w * 0.42, y + h * (p["low"] + 0.06)), (xi + side * w * 0.14, y + h * p["low"] * 0.7), (xi, yi)]
    opening = [tuple(q) for q in smooth(up)] + [tuple(q) for q in smooth(lo)][1:-1]      # l'ouverture exacte, entre les deux paupieres
    c.white(opening, curved=False)
    # l'iris, coupe par les paupieres
    ir = c.layer()
    ix, iy, R = cx + p["dx"], y + p["dy"], p["iris"]
    c.line([(ix + R * math.cos(a), iy + R * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 30)[:-1]], 2.6, closed=True, wob=0.3, on=ir)
    for i in range(22):                           # stries de l'iris
        a = 2 * math.pi * i / 22 + c.rnd.uniform(-0.08, 0.08)
        r0, r1 = p["pup"] + 3, R - c.rnd.uniform(2, 5)
        c.line([(ix + r0 * math.cos(a), iy + r0 * math.sin(a)), (ix + r1 * math.cos(a), iy + r1 * math.sin(a))], 1.2, ends=(0.6, 0.3), wob=0, straight=True, on=ir)
    c.disc(ix, iy, p["pup"], on=ir)
    ImageDraw.Draw(ir).ellipse([(ix - R * 0.42 - 3.2) * SS, (iy - R * 0.4 - 3.2) * SS, (ix - R * 0.42 + 3.2) * SS, (iy - R * 0.4 + 3.2) * SS], fill=0)   # reflet
    c.stamp(ir, opening, curved=False)
    # les paupieres
    c.line(up, p["sup"], ends=(0.45, 0.7), wob=0.5)
    c.line(lo[:4], p["inf"], ends=(0.8, 0.15), wob=0.5)
    c.line([(xi, yi), (xi - side * 9, yi + 5)], 2.4, ends=(0.8, 0.2), straight=True, wob=0)      # caroncule
    if p["pli"] > 0:
        d, hd = p["pli"], p["hood"]
        pli = [(xi + side * w * 0.08, y - h * ar * 0.52 - d * 0.5), (pk, y - h * ar - d), (xi + side * w * 0.8, y - h * ar * 0.62 - d * (1 - hd) + p["tilt"] * 0.6),
               (xo + side * w * 0.06 * (1 + hd), yo - d * 0.5 * (1 - hd) + hd * 7)]
        c.line(pli, 2.6 + hd * 1.6, ends=(0.2, 0.3), wob=0.6)
    if p["cils"]:
        L = 7 if p["cils"] == 1 else 14
        for i in range(7):
            t = 0.42 + 0.58 * i / 6
            q = smooth(up)[int(t * (len(smooth(up)) - 1))]   # le long de la paupiere superieure
            c.line([(q[0], q[1]), (q[0] + side * L * (0.35 + 0.65 * t), q[1] - L * (1.05 - 0.5 * t))], 2.0, ends=(1, 0.2), straight=True, wob=0)
    for i in range(int(p["poche"])):              # poches
        yy = y + h * p["low"] + 15 + i * 12
        c.line([(xi + side * w * 0.1, yy - 5), (xi + side * w * 0.5, yy + 6), (xi + side * w * 0.92, yy - 6)], 2.3, ends=(0.15, 0.15), wob=0.8)
    if p["cerne"]:
        c.line([(xi - side * 2, yi + 12), (xi + side * w * 0.3, y + h * p["low"] + 24), (xi + side * w * 0.62, y + h * p["low"] + 22)], 2.2, ends=(0.5, 0.1), wob=0.8)


def yeux(seed=1, **kw):
    p = dict(YEUX, **kw)
    c = Canvas(seed)
    _oeil(c, p, CX + p["ecart"] / 2, +1)
    _oeil(c, dict(p, **(p["g"] or {})), CX - p["ecart"] / 2, -1)
    return c.result()


YEUX_VARIANTES = [
    ("Moyens", {}),
    ("En amande, étirés", dict(w=124, h=34, tilt=-7, peak=0.4, pli=10, iris=21)),
    ("Ronds, grands ouverts", dict(w=96, h=62, peak=0.5, low=0.48, pli=16, dy=2, iris=24)),
    ("Petits, enfoncés", dict(w=78, h=26, pli=24, iris=17, pup=7, sup=7.5, cerne=1)),
    ("Bridés, paupière sans pli", dict(w=112, h=26, tilt=-10, peak=0.55, pli=0, iris=20, dy=-3, sup=7.5)),
    ("Tombants", dict(w=108, h=36, tilt=13, peak=0.36, hood=0.7, pli=13)),
    ("Paupières lourdes", dict(w=106, h=24, pli=26, hood=0.5, dy=-7, iris=23, sup=8)),
    ("Globuleux", dict(w=112, h=66, peak=0.5, low=0.5, pli=9, iris=24, dy=4, sup=5.5, poche=1)),
    ("Rapprochés", dict(ecart=196, w=96)),
    ("Écartés", dict(ecart=304, w=100)),
    ("Poches marquées", dict(h=34, poche=2, pli=18, hood=0.3)),
    ("Plissés, mi-clos", dict(w=110, h=16, pli=8, dy=-4, iris=22, sup=7, low=0.3)),
    ("Longs cils", dict(w=120, h=52, tilt=-6, cils=2, pli=18, iris=25)),
    ("Dissymétriques", dict(h=46, w=108, g=dict(h=26, w=92, y=492, pli=22, hood=0.6))),
    ("Strabisme convergent", dict(dx=-14, h=46, w=100, pli=11, g=dict(dx=14))),

    ("Grands iris", dict(w=112, h=54, iris=36, pup=15, dy=0, pli=10, arc=0.55)),
    ("Paupière découverte, pli haut", dict(w=106, h=40, pli=34, sup=5.5)),
    ("Dessus plat, dessous courbe", dict(w=110, h=40, arc=0.14, low=0.8, pli=10, dy=6, peak=0.5)),
    ("Dessus arqué, dessous plat", dict(w=104, h=44, arc=0.9, low=0.08, pli=13, dy=-12, iris=22)),
    ("Triangulaires", dict(w=110, h=42, peak=0.22, arc=0.72, tilt=8, pli=9)),
    ("Cernés", dict(w=92, h=30, cerne=1, pli=22, poche=0, dy=-5, sup=7)),
]


# ------------------------------------------------------------------ nez (de face)
NEZ = dict(top=470,           # haut de l'arete dessinee
           base=625,          # bas des ailes
           wr=30,             # largeur de l'arete en haut
           wm=38,             # largeur de l'arete au milieu
           bump=0,            # bosse (elargissement au milieu)
           tw=62,             # largeur de la pointe
           th=40,             # hauteur de la pointe
           tip="rond",        # rond | boule | pointu | carre | bilobe
           wa=124,            # largeur totale aux ailes
           ah=46,             # hauteur des ailes
           fl=0.0,            # ailes : -1 pincees, 0 moyennes, 1 evasees
           drop=0,            # pointe : > 0 plonge sous les ailes (narines cachees), < 0 retroussee (narines visibles)
           nar="ovale",       # ovale | fente | rond
           col=0,             # cloison qui descend
           bend=0, s=0,       # deviation de l'arete : en C, en S
           cote=0.75,         # part de l'arete dessinee (du bas vers le haut)
           sillon=0,          # sillon derriere l'aile (aile charnue)
           trait=4.6)


def nez(seed=1, **kw):
    p = dict(NEZ, **kw)
    c = Canvas(seed)
    top, base, tw, th, wa, ah = p["top"], p["base"], p["tw"], p["th"], p["wa"], p["ah"]
    L = base - top
    dev = lambda y: p["bend"] * math.sin(math.pi * (y - top) / L) + p["s"] * math.sin(2 * math.pi * (y - top) / L)
    tx = CX + p["bend"] * 0.3 + p["s"] * 0.15
    tipy = base + p["drop"]                       # bas de la pointe
    ty0 = tipy - th                               # haut de la pointe
    sides = []
    for sg in (-1, 1):                            # les deux bords de l'arete
        pts = []
        for i in range(7):
            t = i / 6
            y = top + (ty0 + th * 0.25 - top) * t
            w = p["wr"] + (p["wm"] - p["wr"]) * min(1, t * 2) if t < 0.5 else p["wm"] + (tw * 0.86 - p["wm"]) * (t - 0.5) * 2
            w += p["bump"] * math.exp(-((t - 0.42) / 0.17) ** 2)
            pts.append((CX + dev(y) * (1 - t * 0.4) + sg * w / 2, y))
        sides.append(pts)
        k0 = int(round((1 - p["cote"]) * 6))
        if len(pts[k0:]) >= 2:
            c.line(pts[k0:], p["trait"] * (0.62 if sg < 0 else 0.8), ends=(0.1, 0.5), wob=1.0)
    # la pointe
    if p["tip"] == "boule":
        r = tw / 2
        c.line([(tx + r * math.cos(a), tipy - r + r * 0.92 * math.sin(a)) for a in np.linspace(math.pi * 1.2, -math.pi * 0.2, 16)], p["trait"], ends=(0.3, 0.3))
    elif p["tip"] == "pointu":
        c.line([(tx - tw * 0.42, ty0 + th * 0.3), (tx - tw * 0.2, tipy - th * 0.22), (tx, tipy + 2), (tx + tw * 0.2, tipy - th * 0.22), (tx + tw * 0.42, ty0 + th * 0.3)], p["trait"], ends=(0.25, 0.25))
    elif p["tip"] == "carre":
        c.line([(tx - tw / 2, ty0 + th * 0.2), (tx - tw / 2, tipy - 7), (tx - tw / 2 + 7, tipy), (tx + tw / 2 - 7, tipy), (tx + tw / 2, tipy - 7), (tx + tw / 2, ty0 + th * 0.2)], p["trait"], ends=(0.3, 0.3), wob=0.5)
    elif p["tip"] == "bilobe":
        for sg in (-1, 1):
            c.line([(tx + sg * tw / 2, ty0 + th * 0.25), (tx + sg * tw * 0.47, tipy - th * 0.25), (tx + sg * tw * 0.26, tipy), (tx + sg * 3, tipy - th * 0.24)], p["trait"], ends=(0.3, 0.5))
        c.line([(tx, tipy - th * 0.6), (tx, tipy - th * 0.16)], p["trait"] * 0.65, ends=(0.2, 0.5))
    else:
        c.line([(tx - tw / 2, ty0 + th * 0.3), (tx - tw * 0.4, tipy - th * 0.2), (tx, tipy), (tx + tw * 0.4, tipy - th * 0.2), (tx + tw / 2, ty0 + th * 0.3)], p["trait"], ends=(0.25, 0.25))
    # les ailes : une courbe en C de chaque cote
    fl = p["fl"]
    ab = base - max(0, -p["drop"]) * 0.2          # bas de l'aile
    outer = []
    for sg in (-1, 1):
        xin, xout = tx + sg * tw * 0.46, tx + sg * wa / 2
        g = xout - xin
        pts = [(xin + g * 0.12, ab - ah * (0.95 + 0.1 * fl)), (xin + g * (0.62 + 0.1 * fl), ab - ah * (0.9 + 0.12 * fl)), (xout, ab - ah * 0.48),
               (xout - g * (0.1 - 0.06 * fl), ab - ah * 0.12), (xin + g * 0.55, ab + 1), (xin + g * 0.12, ab - 3)]
        c.line(pts, p["trait"] * (1.0 + 0.2 * p["sillon"]), ends=(0.2, 0.35))
        outer.append(pts)
        if p["sillon"]:
            c.line([(xout + sg * 5, ab - ah * 0.95), (xout + sg * 12, ab - ah * 0.4), (xout + sg * 7, ab + 6)], p["trait"] * 0.55, ends=(0.15, 0.15))
    # la cloison et les narines
    cy = max(tipy, ab) + 3 + 12 * p["col"]
    c.line([(tx - tw * 0.3, ab - 2), (tx - tw * 0.12, cy - 2), (tx, cy), (tx + tw * 0.12, cy - 2), (tx + tw * 0.3, ab - 2)], p["trait"] * 0.75, ends=(0.3, 0.3))
    vis = 1.0 if p["drop"] < -3 else (0.0 if p["drop"] > 9 else 0.55)
    if vis > 0:
        for sg in (-1, 1):
            nx = tx + sg * (tw * 0.3 + (wa - tw) * 0.2)
            ny = ab - 6 - (9 if vis == 1 else 0) + 10 * p["col"]
            rx = max(7, (wa - tw) * 0.2)
            if p["nar"] == "fente":
                c.black([(nx - 3, ny - 11 * vis - 3), (nx + sg * 4, ny), (nx - 2, ny + 6), (nx - sg * 5, ny - 2)])
            elif p["nar"] == "rond":
                c.disc(nx, ny - 3, 12 * vis + 3)
            else:
                c.black([(nx - rx, ny + 1), (nx - rx * 0.3, ny - 7 * vis - 2), (nx + rx * 0.7, ny - 5 * vis - 1), (nx + rx, ny + 2), (nx, ny + 4 + 2 * vis)])
    # blanc sous le nez
    k0 = max(0, int(round((1 - p["cote"]) * 6)) - 1)
    c.white(sides[0][k0:] + sides[1][k0:][::-1], curved=False)
    c.white([(tx - tw / 2, ty0), (tx + tw / 2, ty0), (tx + tw / 2, tipy - 4), (tx, max(cy, tipy) + 2), (tx - tw / 2, tipy - 4)], curved=False)
    c.white(outer[0] + [(tx, cy + 2)] + outer[1][::-1] + [(tx, ab - ah)], curved=False)
    for o in outer:
        c.white(o)
    return c.result()


NEZ_VARIANTES = [
    ("Moyen droit", {}),
    ("Long étroit", dict(top=440, base=650, wr=20, wm=24, tw=44, th=36, wa=84, ah=40, fl=-1, nar="fente")),
    ("Court retroussé", dict(top=520, base=600, wr=30, wm=36, tw=60, wa=116, drop=-8, cote=0.5)),
    ("Pointe plongeante", dict(base=620, tw=56, th=48, wa=108, drop=20, tip="pointu")),
    ("Épaté, ailes évasées", dict(top=500, base=620, wr=48, wm=60, tw=92, th=38, wa=186, ah=52, fl=1, cote=0.4)),
    ("Arête large, bout carré", dict(wr=62, wm=64, tw=84, wa=128, tip="carre", ah=44)),
    ("Racine fine, base large", dict(wr=16, wm=34, tw=76, wa=166, fl=1)),
    ("Bout en boule", dict(wr=22, wm=24, tw=94, th=52, tip="boule", wa=142)),
    ("Bout pointu, narines pincées", dict(wr=28, wm=30, tw=42, th=48, tip="pointu", wa=88, fl=-1, nar="fente")),
    ("Bout bilobé", dict(tw=80, th=44, tip="bilobe", wa=138)),
    ("Bosse sur l'arête", dict(wr=24, wm=32, bump=30, tw=60, cote=1.0)),
    ("Tordu", dict(bend=26, top=450, cote=1.0)),
    ("Cassé en S", dict(s=17, bump=12, top=455, wa=132, cote=1.0)),
    ("Narines rondes ouvertes", dict(nar="rond", drop=-9, wa=146, ah=52, tw=58, cote=0.55)),
    ("Ailes charnues", dict(sillon=1, wa=158, ah=62, tw=70, trait=5.4)),
    ("Petit bouton", dict(top=555, base=608, wr=24, wm=28, tw=46, th=30, wa=80, ah=32, cote=0.35, drop=-5)),
    ("Grand nez fort", dict(top=430, base=660, wr=44, wm=56, bump=9, tw=96, th=56, wa=182, ah=70, sillon=1, trait=5.6, cote=1.0)),

    ("Racine large, pointe fine", dict(wr=70, wm=48, tw=40, th=34, wa=92, ah=40, fl=-1, nar="fente", cote=1.0)),
    ("Narines pincées", dict(wa=86, ah=50, fl=-1, nar="fente", tw=54, wr=26, wm=30, drop=-6)),
    ("Sous-cloison découverte", dict(col=1.7, drop=-7, nar="fente", wa=120, tw=64)),
    ("Écrasé", dict(top=545, base=625, wr=64, wm=80, tw=110, th=34, wa=200, ah=44, fl=1, cote=0.3, nar="rond", drop=-5)),
]


# ------------------------------------------------------------------ bouche (au repos, levres fermees)
BOUCHE = dict(y=715,          # ligne entre les levres
              w=190,          # largeur
              up=20,          # epaisseur de la levre superieure
              lo=30,          # epaisseur de la levre inferieure
              bow=7,          # creux de l'arc de Cupidon
              pk=0.2,         # ecart des deux sommets de l'arc (part de la largeur)
              coins=0,        # commissures au repos : < 0 remontent, > 0 tombent
              onde=4,         # ondulation de la ligne entre les levres
              plein=0.62,     # part du contour de la levre inferieure qui est dessinee (au centre)
              haut=1.0,       # part du contour de la levre superieure dessinee (1 = tout)
              tilt=0,         # bouche de travers : un coin plus bas que l'autre
              plis=0,         # plis aux commissures
              sous=1,         # ombre sous la levre inferieure
              rides=0,        # petites rides verticales (levres ridees)
              trait=4.8)


def bouche(seed=1, **kw):
    p = dict(BOUCHE, **kw)
    c = Canvas(seed)
    y, w, up, lo = p["y"], p["w"], p["up"], p["lo"]
    xl, xr = CX - w / 2, CX + w / 2
    yl, yr = y + p["coins"] - p["tilt"], y + p["coins"] + p["tilt"]
    mid = lambda t: yl + (yr - yl) * t            # hauteur de reference le long de la bouche
    X = lambda t: xl + w * t
    on = p["onde"]
    centre = [(xl, yl), (X(0.2), mid(0.2) - p["coins"] * 0.75 + on * 0.5), (X(0.38), y - on * 0.3), (CX, y + on),
              (X(0.62), y - on * 0.3), (X(0.8), mid(0.8) - p["coins"] * 0.75 + on * 0.5), (xr, yr)]
    a, b = 0.5 - p["pk"] / 2, 0.5 + p["pk"] / 2
    top = [(xl, yl), (X(0.16), mid(0.16) - up * 0.5 - p["coins"] * 0.6), (X(a), y - up), (CX, y - up + p["bow"]),
           (X(b), y - up), (X(0.84), mid(0.84) - up * 0.5 - p["coins"] * 0.6), (xr, yr)]
    bot = [(xl, yl), (X(0.14), mid(0.14) + lo * 0.42 - p["coins"] * 0.5), (X(0.32), y + lo * 0.92), (CX, y + lo),
           (X(0.68), y + lo * 0.92), (X(0.86), mid(0.86) + lo * 0.42 - p["coins"] * 0.5), (xr, yr)]
    c.white(top + bot[1:-1][::-1])
    if up >= 3:
        st = smooth(top)
        n = len(st)
        k = int(n * (1 - p["haut"]) / 2)
        c.line([tuple(q) for q in st[k:n - k]], p["trait"] * 0.62, ends=(0.15, 0.15), wob=0.6, straight=True)
    c.line(centre, p["trait"] * 1.15, ends=(0.55, 0.55), wob=0.6)
    if lo >= 3:
        sb = smooth(bot)
        n = len(sb)
        k = int(n * (1 - p["plein"]) / 2)
        c.line([tuple(q) for q in sb[k:n - k]], p["trait"] * 0.7, ends=(0.1, 0.1), wob=0.6, straight=True)
    for sg, (x0, y0) in ((-1, (xl, yl)), (1, (xr, yr))):      # commissures
        c.line([(x0 - sg * 4, y0 - 1), (x0 + sg * 5, y0 + 2 + p["coins"] * 0.35)], p["trait"] * 0.9, ends=(0.8, 0.2), straight=True, wob=0)
        if p["plis"]:
            c.line([(x0 + sg * 10, y0 - 16), (x0 + sg * 15, y0 + 4), (x0 + sg * 11, y0 + 24 + p["coins"])], p["trait"] * 0.5, ends=(0.15, 0.15))
    if p["sous"]:
        yy = y + lo + 12
        c.line([(CX - w * 0.17, yy - 2), (CX, yy + 3), (CX + w * 0.17, yy - 2)], p["trait"] * 0.6, ends=(0.1, 0.1))
    for i in range(int(p["rides"])):
        t = 0.24 + 0.52 * (i + 0.5) / p["rides"]
        c.line([(X(t), y - up * 0.75), (X(t) + c.rnd.uniform(-2, 2), y - up * 0.15)], 1.5, ends=(0.2, 0.2), straight=True, wob=0)
        c.line([(X(t) + 3, y + lo * 0.2), (X(t) + c.rnd.uniform(-2, 2), y + lo * 0.78)], 1.5, ends=(0.2, 0.2), straight=True, wob=0)
    return c.result()


BOUCHE_VARIANTES = [
    ("Moyenne", {}),
    ("Lèvres fines", dict(up=8, lo=13, bow=3, w=186, plein=0.5, sous=0)),
    ("Lèvres épaisses", dict(up=34, lo=46, bow=11, w=206, plein=0.8)),
    ("Supérieure fine, inférieure charnue", dict(up=8, lo=44, bow=3, plein=0.8)),
    ("Supérieure épaisse, inférieure fine", dict(up=36, lo=14, bow=10, pk=0.24, plein=0.5)),
    ("Petite, en cœur", dict(w=124, up=24, lo=30, bow=13, pk=0.3, plein=0.8)),
    ("Large", dict(w=262, up=17, lo=25, bow=5, pk=0.14)),
    ("Sans lèvres, simple trait", dict(up=2, lo=2, w=200, onde=1, sous=0, trait=5.4)),
    ("Arc de Cupidon marqué", dict(up=27, bow=17, pk=0.28, lo=31)),
    ("Lèvre supérieure plate", dict(up=24, bow=0, pk=0.5, lo=22, onde=0, w=172, plein=0.75)),
    ("Coins tombants", dict(coins=13, up=15, lo=24, onde=2)),
    ("Coins montants", dict(coins=-9, up=18, lo=28, onde=6)),
    ("De travers", dict(tilt=11, up=17, lo=26)),
    ("Ridée", dict(w=150, up=10, lo=12, bow=2, rides=6, sous=0)),
    ("Lèvre inférieure pendante", dict(up=14, lo=52, w=180, plein=0.9, coins=4)),

    ("Pleine, lèvres égales", dict(up=32, lo=32, bow=8, w=180, plein=0.85)),
    ("Fente droite stricte", dict(up=13, lo=17, bow=2, onde=0, w=176, plein=0.9, haut=1.0)),
    ("En losange", dict(w=150, up=30, lo=40, bow=6, pk=0.12, plein=0.85)),
    ("Bord flou", dict(up=18, lo=26, haut=0.3, plein=0.25, sous=0, trait=4.2)),
]


# ------------------------------------------------------------------ sourcils (la paire, sans les yeux)
SOURCILS = dict(y=418,        # hauteur du debut du sourcil (cote nez)
                ecart=64,     # espace entre les deux sourcils
                L=128,        # longueur
                ep=15,        # epaisseur la plus forte
                arc=14,       # hauteur de l'arc
                pk=0.6,       # position du sommet (0 = cote nez, 1 = cote tempe)
                tilt=6,       # la queue par rapport au debut : > 0 descend, < 0 remonte
                tin=0.85,     # epaisseur au debut (part de ep)
                tout=0.12,    # epaisseur a la queue
                angle=0,      # sommet anguleux (0 arrondi, 1 en accent circonflexe)
                poils=0,      # 0 plein ; 1 poils qui depassent ; 2 broussailleux
                clair=0,      # clairseme : poils separes, sans aplat
                joint=0,      # poils entre les deux sourcils
                g=None)


def _sourcil(c, p, side):
    x0 = CX + side * p["ecart"] / 2
    L, ep, pk = p["L"], p["ep"], p["pk"]

    def mid(t):
        b = math.sin(math.pi / 2 * t / pk) if t < pk else math.cos(math.pi / 2 * (t - pk) / (1 - pk))
        if p["angle"]:
            lin = t / pk if t < pk else 1 - (t - pk) / (1 - pk)
            b = (1 - p["angle"]) * b + p["angle"] * lin
        base = p["tilt"] * (t - pk) / (1 - pk) if t > pk else 0.0
        return x0 + side * L * t, p["y"] - p["arc"] * b + base + (0 if t > pk else p["arc"] * 0)

    def thick(t):
        k = p["tin"] + (1 - p["tin"]) * min(1, t / 0.3) if t < 0.3 else 1 - (1 - p["tout"]) * ((t - 0.3) / 0.7) ** 1.3
        return ep * k

    ts = np.linspace(0, 1, 26)
    up = [(mid(t)[0], mid(t)[1] - thick(t) * 0.5) for t in ts]
    lo = [(mid(t)[0], mid(t)[1] + thick(t) * 0.5) for t in ts]
    if not p["clair"]:
        c.black(up + lo[::-1])
    n = 46 if p["clair"] else (0, 30, 70)[int(p["poils"])]
    for _ in range(n):                            # poils : obliques vers la tempe, plus couches vers la queue
        t = c.rnd.uniform(0.0, 0.97)
        x, y = mid(t)
        th = thick(t)
        y += c.rnd.uniform(-0.5, 0.5) * th
        ln = c.rnd.uniform(9, 16) * (1.5 if p["poils"] == 2 else 1.0) * (1 if p["clair"] else 0.9)
        ang = math.radians(c.rnd.uniform(48, 72) * (1 - t) + c.rnd.uniform(4, 16) * t)
        c.line([(x, y), (x + side * ln * math.cos(ang), y - ln * math.sin(ang))], 2.3 if p["clair"] else 2.0, ends=(1, 0.2), straight=True, wob=0)
    return x0


def sourcils(seed=1, **kw):
    p = dict(SOURCILS, **kw)
    c = Canvas(seed)
    _sourcil(c, p, +1)
    _sourcil(c, dict(p, **(p["g"] or {})), -1)
    for i in range(int(p["joint"] * 14)):         # sourcils joints : des poils au-dessus du nez
        x = CX + c.rnd.uniform(-p["ecart"] / 2 - 4, p["ecart"] / 2 + 4)
        y = p["y"] + c.rnd.uniform(-5, 6)
        c.line([(x, y), (x + c.rnd.uniform(-5, 5), y - c.rnd.uniform(7, 12))], 2.0, ends=(1, 0.2), straight=True, wob=0)
    return c.result()


SOURCILS_VARIANTES = [
    ("Moyens", {}),
    ("Fins, arqués", dict(ep=6, arc=24, pk=0.55, tilt=10, L=124)),
    ("Épais, droits", dict(ep=24, arc=3, tilt=2, tin=1.0, tout=0.45, L=132)),
    ("Broussailleux", dict(ep=24, arc=10, poils=2, tout=0.4, L=136)),
    ("Circonflexes", dict(ep=14, arc=26, angle=1.0, pk=0.5, tilt=16)),
    ("Tombants", dict(ep=14, arc=6, pk=0.3, tilt=28, y=412)),
    ("Remontants", dict(ep=15, arc=26, pk=0.93, tilt=3, y=438, L=124, tin=0.7, tout=0.3)),
    ("Courts", dict(L=78, ep=16, arc=7, tout=0.3, ecart=86)),
    ("Longs, fins", dict(L=160, ep=7, arc=10, tilt=14, ecart=58)),
    ("Joints", dict(ep=18, arc=8, ecart=36, joint=1.0, tin=1.0)),
    ("Très écartés", dict(ecart=124, L=104, ep=12)),
    ("Clairsemés", dict(clair=1, ep=14, arc=10)),
    ("Épais au début, queue fine", dict(ep=24, tin=1.0, tout=0.05, arc=12, L=130)),
    ("Arrondis en demi-lune", dict(ep=11, arc=30, pk=0.5, tilt=30, y=424, L=120)),
    ("Inégaux", dict(ep=14, arc=12, g=dict(y=402, arc=22, tilt=12))),

    ("Linéaires", dict(ep=4, arc=1, tilt=0, tin=1.0, tout=0.7, L=126, y=424)),
    ("Arc haut, épais", dict(ep=20, arc=34, pk=0.5, tilt=26, tout=0.5, y=430, L=126)),
    ("Anguleux au tiers externe", dict(ep=13, arc=24, angle=1.0, pk=0.72, tilt=14, y=430)),
    ("Queue épaisse", dict(ep=20, tin=0.25, tout=0.95, arc=8, L=124)),
    ("Très longs", dict(L=176, ep=13, arc=16, pk=0.5, tilt=34, ecart=54)),
    ("En virgule", dict(L=74, ep=24, tin=1.0, tout=0.04, arc=5, pk=0.3, tilt=14, ecart=74)),
]


# ------------------------------------------------------------------ oreille (une seule ; l'atelier pose sa jumelle en miroir)
OREILLE = dict(x=742,         # ou l'oreille s'attache a la tete
               top=430,       # haut
               h=170,         # hauteur
               out=44,        # largeur visible de face (plus grande = oreille decollee)
               haut=1.0,      # largeur du haut par rapport au milieu (> 1 : pavillon large en haut)
               pointe=0,      # haut pointu
               lobe="libre",  # libre | attache | long
               lobe_w=0.55,   # largeur du lobe (part de out)
               pli=1,         # trait de l'anthelix (pli interieur)
               trait=4.4)


def oreille(seed=1, **kw):
    p = dict(OREILLE, **kw)
    c = Canvas(seed)
    x, top, h, out = p["x"], p["top"], p["h"], p["out"]
    bot = top + h
    lob = {"libre": 0.2, "attache": 0.06, "long": 0.3}[p["lobe"]]
    yl = bot - h * lob                            # ou le lobe commence
    ext = [(x - 6, top + h * 0.16), (x + out * 0.3 * p["haut"], top + h * (0.02 if not p["pointe"] else 0.05)),
           (x + out * (0.82 * p["haut"] if not p["pointe"] else 0.62), top + h * (0.03 if not p["pointe"] else -0.04 * p["pointe"])),
           (x + out * 1.0 * p["haut"], top + h * 0.2), (x + out * 0.98, top + h * 0.42), (x + out * 0.8, yl - h * 0.08), (x + out * p["lobe_w"] * 1.05, yl + h * lob * 0.25)]
    if p["lobe"] == "attache":
        ext += [(x + out * p["lobe_w"] * 0.5, bot - 4), (x - 4, bot + 6)]
    else:
        ext += [(x + out * p["lobe_w"], bot - h * lob * 0.25), (x + out * p["lobe_w"] * 0.45, bot), (x + 2, bot - h * lob * 0.45), (x - 6, yl - 4)]
    c.white([tuple(q) for q in smooth(ext)] + [(x - 34, bot - 8), (x - 34, top + h * 0.16)], curved=False)   # deborde sous le visage, pose par-dessus
    c.line(ext, p["trait"], ends=(0.5, 0.5), wob=0.9)
    if p["pli"]:                                  # helix replie, anthelix, conque
        c.line([(x + out * 0.3, top + h * 0.13), (x + out * 0.7 * p["haut"], top + h * 0.16), (x + out * 0.78, top + h * 0.4), (x + out * 0.6, yl - h * 0.12)], p["trait"] * 0.6, ends=(0.2, 0.2))
        c.line([(x + 4, top + h * 0.34), (x + out * 0.42, top + h * 0.33), (x + out * 0.5, top + h * 0.52), (x + out * 0.3, yl - h * 0.1), (x + 5, yl - h * 0.14)], p["trait"] * 0.6, ends=(0.2, 0.2))
    return c.result()


OREILLE_VARIANTES = [
    ("Moyenne", {}),
    ("Collée", dict(out=24, pli=0)),
    ("Décollée", dict(out=78, haut=1.05)),
    ("Très décollée, en feuille de chou", dict(out=104, haut=1.15, h=180, lobe_w=0.4)),
    ("Petite", dict(h=118, out=34, top=455)),
    ("Grande", dict(h=226, out=58, top=410)),
    ("Lobe attaché", dict(lobe="attache")),
    ("Lobe long", dict(lobe="long", h=196, lobe_w=0.62)),
    ("Pointue", dict(pointe=1.6, out=50, h=180)),
    ("Large en haut, lobe étroit", dict(haut=1.3, out=56, lobe_w=0.3)),
    ("Étroite et longue", dict(out=30, h=200, top=420)),
    ("Lobe large et charnu", dict(lobe_w=0.85, out=52, lobe="long", h=186)),

    ("Ronde large", dict(h=132, out=86, top=450, haut=1.0, lobe_w=0.7)),
    ("Sans lobe", dict(lobe="attache", h=140, out=40, lobe_w=0.25, top=445)),
    ("Décollée du haut", dict(haut=1.7, out=46, lobe_w=0.22, h=176)),
]


# ------------------------------------------------------------------ poil : moustaches et barbes
def _hair(c, mask, dens=1.0, down=(0, 1), spread=0.5, w=1.5, edge=1.0, stub=False):
    """Rend une zone de poil : aplat noir strie de clair dans le sens du poil, bord effile. mask : image L au format du
    cadre sur-echantillonne. stub : barbe de trois jours (pointilles au lieu de l'aplat)."""
    m = np.asarray(mask) > 127
    ys, xs = np.where(m)
    if not len(xs):
        return
    d = ImageDraw.Draw(c.ink)
    er = np.asarray(mask.filter(ImageFilter.MinFilter(9))) > 127
    eys, exs = np.where(m & ~er)
    ang0 = math.atan2(down[1], down[0])
    if stub:
        for _ in range(int(len(xs) / (SS * SS) / 26 * dens)):
            k = c.rnd.randrange(len(xs))
            x, y = xs[k] / SS, ys[k] / SS
            a = ang0 + c.rnd.uniform(-0.9, 0.9)
            c.line([(x, y), (x + 5 * math.cos(a), y + 5 * math.sin(a))], 1.7, ends=(1, 0.4), straight=True, wob=0)
        return
    c.ink = ImageChops.lighter(c.ink, mask)
    c.fill = ImageChops.lighter(c.fill, mask)
    for _ in range(int(len(exs) / SS / 7 * edge)):                  # poils qui depassent du bord
        k = c.rnd.randrange(len(exs))
        x, y = exs[k] / SS, eys[k] / SS
        a = ang0 + c.rnd.uniform(-spread, spread) * 1.6
        ln = c.rnd.uniform(5, 12)
        c.line([(x, y), (x + ln * math.cos(a), y + ln * math.sin(a))], 2.0, ends=(1, 0.2), straight=True, wob=0)
    d = ImageDraw.Draw(c.ink)
    for _ in range(int(len(xs) / (SS * SS) / 55 * dens)):           # stries claires dans l'aplat
        k = c.rnd.randrange(len(xs))
        x, y = xs[k], ys[k]
        a = ang0 + c.rnd.uniform(-spread, spread)
        ln = c.rnd.uniform(10, 26) * SS
        d.line([x, y, x + ln * math.cos(a), y + ln * math.sin(a)], fill=0, width=int(w * SS))


def _ribbon(layer, pts, widths, n=14):
    """Ruban plein le long d'une courbe, d'epaisseur variable (une branche de moustache)."""
    cl = smooth(pts, n=n)
    ws = np.interp(np.linspace(0, 1, len(cl)), np.linspace(0, 1, len(widths)), widths)
    up, lo = [], []
    for i, q in enumerate(cl):
        a, b = cl[max(0, i - 1)], cl[min(len(cl) - 1, i + 1)]
        t = b - a
        nrm = np.array([-t[1], t[0]]) / (np.hypot(*t) or 1)
        up.append(tuple((q + nrm * ws[i] / 2) * SS)); lo.append(tuple((q - nrm * ws[i] / 2) * SS))
    ImageDraw.Draw(layer).polygon(up + lo[::-1], fill=255)


MOUSTACHE = dict(y=660,       # sous le nez
                 pts=[(4, 0), (55, 4), (100, 22)],                 # une branche : points (dx depuis l'axe, dy)
                 ep=[26, 24, 6],                                   # epaisseur le long de la branche
                 dens=1.0, clair=0, edge=1.0)


def moustache(seed=1, **kw):
    p = dict(MOUSTACHE, **kw)
    c = Canvas(seed)
    m = c.layer()
    for sg in (-1, 1):
        _ribbon(m, [(CX + sg * dx, p["y"] + dy) for dx, dy in p["pts"]], p["ep"])
    if p["clair"]:
        _hair(c, m, dens=2.2, down=(0, 1), stub=True)
    else:
        for sg in (-1, 1):                         # le poil part de l'axe vers l'exterieur et vers le bas
            half = Image.new("L", m.size, 0)
            box = (CX * SS, 0, F * SS, FH * SS) if sg > 0 else (0, 0, CX * SS, FH * SS)
            half.paste(m.crop(box), box[:2])
            _hair(c, half, dens=p["dens"], down=(sg * 0.75, 0.66), spread=0.35, edge=p["edge"])
    return c.result()


MOUSTACHE_VARIANTES = [
    ("Chevron", {}),
    ("Fine, au crayon", dict(pts=[(6, 6), (50, 8), (92, 16)], ep=[7, 7, 3], edge=0.3, dens=0.3)),
    ("Brosse à dents", dict(pts=[(0, 4), (20, 4), (34, 5)], ep=[36, 36, 32], edge=0.6)),
    ("Guidon, pointes relevées", dict(pts=[(4, 2), (60, 14), (112, 6), (140, -26)], ep=[24, 22, 9, 3], edge=0.5)),
    ("Fer à cheval", dict(pts=[(4, 0), (70, 6), (104, 50), (108, 150)], ep=[24, 24, 22, 16])),
    ("Morse, tombante", dict(pts=[(4, 6), (56, 22), (104, 62)], ep=[46, 50, 20], dens=1.3, edge=1.6)),
    ("Gauloise, longues pointes", dict(pts=[(4, 0), (64, 10), (112, 60), (124, 170)], ep=[26, 24, 16, 5])),
    ("Impériale", dict(pts=[(4, 2), (60, 10), (118, -4), (156, -58)], ep=[30, 30, 16, 4], dens=1.2)),
    ("Dalí, pointes en l'air", dict(pts=[(6, 6), (50, 12), (92, -8), (112, -84)], ep=[9, 8, 5, 2], edge=0.2, dens=0.3)),
    ("Deux traits", dict(pts=[(16, 4), (54, 8), (86, 18)], ep=[9, 10, 4], edge=0.3, dens=0.4)),
    ("Large, droite", dict(pts=[(4, 2), (70, 4), (128, 10)], ep=[28, 28, 20])),
    ("Fu Manchu", dict(pts=[(10, 8), (64, 10), (96, 60), (100, 210)], ep=[8, 9, 8, 4], edge=0.3, dens=0.4)),
    ("Clairsemée", dict(clair=1, pts=[(4, 2), (56, 6), (100, 20)], ep=[24, 22, 10])),
    ("Pyramide", dict(pts=[(2, 0), (40, 12), (84, 34)], ep=[16, 30, 12])),

    ("Trapèze", dict(pts=[(0, 6), (50, 8), (96, 12)], ep=[40, 42, 44], edge=0.5)),
    ("Petit guidon", dict(pts=[(4, 4), (40, 10), (72, 6), (88, -12)], ep=[18, 16, 8, 3], edge=0.4)),
    ("Large, broussailleuse", dict(pts=[(4, 6), (80, 14), (150, 34)], ep=[44, 44, 26], edge=3.0, dens=1.4)),
    ("Pinceau", dict(pts=[(0, 14), (46, 16), (84, 24)], ep=[50, 46, 22], edge=0.8)),
]


BARBE = dict(haut=560,        # ou la barbe commence sur la joue (favoris)
             joue=0.5,        # hauteur de la ligne des joues (0 = barbe basse, 1 = monte haut sur la joue)
             wj=452, jy=740, chin=885,       # la machoire de reference : la barbe la suit
             ep=34,           # debord de la barbe sous la machoire
             long=0,          # longueur sous le menton
             bas="rond",      # rond | pointe | carre | fourche
             zone="pleine",   # pleine | collier | bouc | barbiche | mouche | favoris | ancre
             bouche=1,        # degage la bouche
             trois=0,         # barbe de trois jours (pointilles)
             dens=1.0)


def barbe(seed=1, **kw):
    p = dict(BARBE, **kw)
    c = Canvas(seed)
    m = c.layer()
    d = ImageDraw.Draw(m)
    P = lambda pts: d.polygon([(x * SS, y * SS) for x, y in smooth(pts, True)], fill=255)
    E = lambda pts: d.polygon([(x * SS, y * SS) for x, y in smooth(pts, True)], fill=0)
    hw, jy, chin, ep = p["wj"] / 2, p["jy"], p["chin"], p["ep"]
    z = p["zone"]
    bot = chin + ep * 0.5 + p["long"]
    merged = False
    if z in ("pleine", "collier", "favoris"):
        outer = [(CX - hw - 14, p["haut"]), (CX - hw - 10 - ep * 0.3, jy - 30), (CX - hw * 0.86 - ep * 0.5, jy + 62 + p["long"] * 0.3)]
        if p["bas"] == "pointe":
            low = [(CX - hw * 0.5, chin + ep * 0.6 + p["long"] * 0.25), (CX - hw * 0.16, bot - p["long"] * 0.25), (CX, bot + 18)]
        elif p["bas"] == "carre":
            low = [(CX - hw * 0.62, bot - 4), (CX - hw * 0.3, bot + 4), (CX, bot + 4)]
        else:
            low = [(CX - hw * 0.5, bot - 12), (CX, bot + 4)]
        left = outer + low
        P(left + mirror(left[:-1])[::-1])
        yj = 690 - 110 * p["joue"]                 # ligne des joues
        merged = bool(p["bouche"]) and z == "pleine" and yj + 78 > 668      # la ligne des joues rejoint la bouche : une seule decoupe
        if merged:
            cut = [(CX - hw + 26, p["haut"] - 60), (CX - hw + 34, yj - 20), (CX - 150, min(yj + 50, 690)), (CX - 110, 738), (CX - 56, 768), (CX, 776)]
        else:
            cut = [(CX - hw + 26, p["haut"] - 60), (CX - hw + 34, yj - 20), (CX - 120, yj + 62), (CX, yj + 78)]
        E(cut + mirror(cut[:-1])[::-1] + [(CX, 300)])
        if p["bas"] == "fourche":
            E([(CX - 60, bot + 40), (CX - 8, bot - p["long"] * 0.5), (CX, bot - p["long"] * 0.85), (CX + 8, bot - p["long"] * 0.5), (CX + 60, bot + 40)])
        if z == "collier":                         # seulement le long de la machoire
            E([(CX - hw + 30, 540), (CX - hw + 42, jy - 20), (CX - hw * 0.5, chin - 42), (CX, chin - 26), (CX + hw * 0.5, chin - 42), (CX + hw - 42, jy - 20), (CX + hw - 30, 540), (CX, 400)])
        if z == "favoris":
            E([(CX - hw + 60, 480), (CX - hw + 70, 1000), (CX + hw - 70, 1000), (CX + hw - 60, 480)])
            d.rectangle([0, (jy + 6) * SS, F * SS, FH * SS], fill=0)
    if z == "cou":                                 # sous la machoire et sur le cou seulement
        P([(CX - hw * 0.8, chin - 30), (CX - hw * 0.7, chin + 60 + p["long"]), (CX, chin + 96 + p["long"]), (CX + hw * 0.7, chin + 60 + p["long"]), (CX + hw * 0.8, chin - 30), (CX, chin + 30)])
    if z == "touffe":                              # petite tache sur la pointe du menton
        P([(CX - 34, chin - 46), (CX - 40, chin - 6), (CX, chin + 14 + p["long"]), (CX + 40, chin - 6), (CX + 34, chin - 46), (CX, chin - 56)])
    if z in ("bouc", "ancre", "barbiche", "mouche"):
        if z == "bouc":                            # cercle autour de la bouche, menton compris
            P([(CX - 96, 668), (CX - 108, 760), (CX - 78, chin - 6 + p["long"] * 0.6), (CX, bot + 6), (CX + 78, chin - 6 + p["long"] * 0.6), (CX + 108, 760), (CX + 96, 668), (CX, 646)])
        elif z == "ancre":                         # trait le long de la machoire + pointe au menton
            P([(CX - 130, chin - 78), (CX - 60, chin - 34), (CX - 22, 762), (CX + 22, 762), (CX + 60, chin - 34), (CX + 130, chin - 78), (CX + 70, bot - 4), (CX, bot + 22 + p["long"]), (CX - 70, bot - 4)])
        elif z == "barbiche":                      # touffe sous la levre, jusqu'au menton et au-dela
            P([(CX - 46, 772), (CX - 62, chin - 30), (CX - 30, bot + p["long"] * 0.5), (CX, bot + 14 + p["long"]), (CX + 30, bot + p["long"] * 0.5), (CX + 62, chin - 30), (CX + 46, 772), (CX, 762)])
        else:                                      # mouche : petite touffe sous la levre
            P([(CX - 22, 768), (CX - 14, 806), (CX, 818), (CX + 14, 806), (CX + 22, 768), (CX, 762)])
    if p["bouche"] and z == "pleine" and not merged:
        E([(CX - 112, 716), (CX - 60, 690), (CX, 684), (CX + 60, 690), (CX + 112, 716), (CX + 62, 752), (CX, 762), (CX - 62, 752)])
    if p["bouche"] and z == "bouc":
        E([(CX - 76, 716), (CX - 42, 694), (CX, 690), (CX + 42, 694), (CX + 76, 716), (CX + 44, 748), (CX, 756), (CX - 44, 748)])
    if p["trois"]:
        _hair(c, m, dens=1.6 * p["dens"], down=(0, 1), stub=True)
    else:
        _hair(c, m, dens=p["dens"], down=(0, 1), spread=0.3, edge=1.2)
    return c.result()


BARBE_VARIANTES = [
    ("Courte, pleine", {}),
    ("Trois jours", dict(trois=1, ep=16, joue=0.6)),
    ("Longue, ronde", dict(long=150, ep=70, joue=0.7, dens=1.3)),
    ("Longue, en pointe", dict(long=250, ep=30, bas="pointe", joue=0.5, dens=1.3)),
    ("Carrée", dict(long=60, ep=50, bas="carre", joue=0.4)),
    ("Fourchue", dict(long=210, ep=40, bas="fourche", joue=0.6)),
    ("Collier", dict(zone="collier", ep=26, haut=540)),
    ("Bouc", dict(zone="bouc")),
    ("Bouc long", dict(zone="bouc", long=80)),
    ("Barbiche", dict(zone="barbiche", long=40)),
    ("Mouche", dict(zone="mouche")),
    ("Ancre", dict(zone="ancre", long=10)),
    ("Favoris", dict(zone="favoris", haut=470, ep=30)),
    ("Basse, sous la mâchoire", dict(joue=-0.5, ep=50, long=30, haut=640)),
    ("Haute sur les joues", dict(joue=1.0, ep=40, long=30, dens=1.2)),

    ("Jugulaire", dict(zone="collier", ep=8, haut=500, joue=0.5)),
    ("Très longue", dict(long=330, ep=64, joue=0.7, dens=1.4)),
    ("Barbe de cou", dict(zone="cou")),
    ("Touffe de menton", dict(zone="touffe")),
]


# ------------------------------------------------------------------ lunettes (monture vue de face : pas de branches, verres vides)
LUNETTES = dict(y=482,
                w=150, h=104,  # un verre
                pont=34,       # ecart entre les deux verres
                n=2.0,         # forme : 2 = ovale / rond, 4 et plus = rectangle arrondi
                bas=1.0,       # largeur du bas par rapport au haut (< 1 : aviateur, papillon)
                goutte=0,      # le bas descend vers la joue (aviateur)
                papillon=0,    # coins externes releves
                trait=5.0,     # epaisseur de la monture
                haut=0,        # barre du haut epaisse (monture a sourcils)
                bas_fin=0,     # bas du cercle tres fin (demi-monture)
                pont_y=-0.25,  # hauteur du pont (part de h ; negatif = haut)
                double=0,      # double pont
                teinte=0,      # verres sombres
                pans=0,        # monture a pans (6 = hexagonale, 8 = octogonale)
                un=0)          # monocle


def lunettes(seed=1, **kw):
    p = dict(LUNETTES, **kw)
    c = Canvas(seed)
    w, h, y = p["w"], p["h"], p["y"]
    e = 2 / p["n"]
    for sg in ((1,) if p["un"] else (-1, 1)):
        cx = CX + sg * (p["pont"] / 2 + w / 2)
        pts = []
        for a in np.linspace(0, 2 * math.pi, 73)[:-1]:
            co, si = math.cos(a), math.sin(a)
            x = abs(co) ** e * math.copysign(1, co) * w / 2
            yy = abs(si) ** e * math.copysign(1, si) * h / 2
            if si > 0:                             # le bas
                x *= 1 - (1 - p["bas"]) * si
                yy += p["goutte"] * si * (0.5 + 0.5 * math.copysign(1, co * sg) * abs(co)) * 0.6
            else:
                yy -= p["papillon"] * max(0, co * sg) ** 2 * abs(si) ** 0.5
            pts.append((cx + x, y + yy))
        if p["pans"]:
            k = int(p["pans"])
            corners = [(cx + w / 2 * math.cos(2 * math.pi * (i + 0.5) / k), y + h / 2 * math.sin(2 * math.pi * (i + 0.5) / k)) for i in range(k)]
            pts = []
            for i in range(k):
                a, b = np.array(corners[i]), np.array(corners[(i + 1) % k])
                pts += [tuple(a + (b - a) * t) for t in np.linspace(0, 1, 10, endpoint=False)]
        pts = [tuple(q) for q in pts]
        if p["teinte"]:
            c.black(pts)
            c.erase([(cx - w * 0.3, y - h * 0.3), (cx - w * 0.12, y - h * 0.34), (cx - w * 0.3, y - h * 0.08)])
        tr = p["trait"]
        if p["bas_fin"]:
            top = [q for q in pts if q[1] <= y + h * 0.05]
            top.sort(key=lambda q: q[0])
            c.line(pts + pts[:1], 1.6, ends=(1, 1), straight=True, wob=0.3)
            c.line(top, tr, ends=(0.7, 0.7), straight=True, wob=0.4)
        else:
            c.line(pts + pts[:1], tr, ends=(1, 1), straight=True, wob=0.5)
        if p["haut"]:
            top = sorted([q for q in pts if q[1] <= y - h * 0.12], key=lambda q: q[0])
            c.line([(q[0], q[1] - p["haut"] * 0.3) for q in top], tr + p["haut"], ends=(0.8, 0.8), straight=True, wob=0.4)
        if not p["un"]:                            # tenon : le depart de la branche, tres court
            xo = cx + sg * w / 2
            c.line([(xo - sg * 2, y - h * 0.28 - p["papillon"] * 0.6), (xo + sg * 16, y - h * 0.3 - p["papillon"] * 0.6)], tr * 1.1, ends=(1, 0.6), straight=True, wob=0)
    if p["un"]:
        c.line([(CX + p["pont"] / 2 + w, y + h * 0.1), (CX + p["pont"] / 2 + w + 16, y + h * 0.9), (CX + p["pont"] / 2 + w + 4, y + h * 1.9)], 1.8, ends=(1, 0.4))
        return c.result()
    yb = y + h * p["pont_y"]
    x1 = p["pont"] / 2 + 3
    c.line([(CX - x1, yb + 6), (CX, yb - 5), (CX + x1, yb + 6)], p["trait"] * 0.9, ends=(1, 1), wob=0.3)
    if p["double"]:
        c.line([(CX - x1 - 4, y - h * 0.44), (CX, y - h * 0.47), (CX + x1 + 4, y - h * 0.44)], p["trait"] * 0.8, ends=(1, 1), wob=0.3)
    return c.result()


LUNETTES_VARIANTES = [
    ("Ovales fines", dict(trait=3.2)),
    ("Rondes", dict(w=118, h=118, pont=44, trait=4.2)),
    ("Petites rondes", dict(w=84, h=84, pont=62, trait=3.4, pont_y=-0.1)),
    ("Rectangulaires", dict(w=150, h=78, n=5.5, trait=5)),
    ("Rectangulaires épaisses", dict(w=156, h=90, n=5, trait=11, pont=30)),
    ("Carrées", dict(w=128, h=118, n=5, trait=6)),
    ("Aviateur", dict(w=158, h=116, n=2.4, bas=0.82, goutte=26, trait=3.2, double=1, pont_y=-0.2)),
    ("Papillon", dict(w=150, h=84, n=3, bas=0.8, papillon=26, trait=7)),
    ("Monture à sourcils", dict(w=148, h=98, n=3, haut=9, trait=3, bas_fin=1)),
    ("Demi-lunes de lecture", dict(w=132, h=52, n=3.2, y=512, trait=4)),
    ("Étroites allongées", dict(w=164, h=48, n=4.5, trait=5)),
    ("Grandes, années 70", dict(w=180, h=150, n=3.2, bas=0.9, trait=7, pont=26)),
    ("Hexagonales", dict(w=140, h=118, pans=6, trait=4)),
    ("Octogonales", dict(w=132, h=112, pans=8, trait=5)),
    ("Épaisses noires", dict(w=146, h=110, n=3.4, bas=0.86, trait=13, pont=30)),
    ("Lunettes de soleil", dict(w=150, h=88, n=5, bas=0.8, trait=8, teinte=1, pont=30)),
    ("Soleil, aviateur", dict(w=158, h=116, n=2.4, bas=0.82, goutte=26, trait=3.2, double=1, teinte=1)),
    ("Soleil, rondes", dict(w=110, h=110, pont=48, trait=4, teinte=1)),
    ("Monocle", dict(un=1, w=110, h=110, trait=4)),
]

CATEGORIES = {"visage": (visage, VISAGE_VARIANTES), "yeux": (yeux, YEUX_VARIANTES), "sourcils": (sourcils, SOURCILS_VARIANTES),
              "nez": (nez, NEZ_VARIANTES), "bouche": (bouche, BOUCHE_VARIANTES), "oreilles": (oreille, OREILLE_VARIANTES),
              "moustache": (moustache, MOUSTACHE_VARIANTES), "barbe": (barbe, BARBE_VARIANTES), "lunettes": (lunettes, LUNETTES_VARIANTES)}
