"""Elements de visage traces par le calcul, pour le portrait-robot : chaque variante est decrite par ses cotes, ce qui
garantit que deux nez (deux bouches...) different vraiment par leur forme. Les modeles d'image, eux, redessinent toujours
le meme nez moyen, quelle que soit la description.

Les axes de variation viennent des coffrets de police et du portrait parle de Bertillon (voir la recherche resumee dans
app/parts.py) : pour un nez vu de face, la largeur de l'arete, la pointe, la base, les ailes, la longueur et l'axe.

Le trait est pose au pinceau rond, avec un leger tremble et une epaisseur qui varie, pour ne pas faire « dessin technique ».
Chaque fonction rend une image RGBA (trait noir, fond blanc opaque sous l'element, transparent autour).
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 3                                           # sur-echantillonnage


def _smooth(pts, n=14):
    """Courbe lisse passant par les points (Catmull-Rom)."""
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = (np.array(q, float) for q in p[i - 1:i + 3])
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(pts[-1], float))
    return out


class Sheet:
    def __init__(self, w, h, seed=1):
        self.w, self.h = w, h
        self.ink = Image.new("L", (w * SS, h * SS), 0)
        self.fill = Image.new("L", (w * SS, h * SS), 0)
        self.rnd = random.Random(seed)
        self.d, self.f = ImageDraw.Draw(self.ink), ImageDraw.Draw(self.fill)

    def line(self, pts, w=5.0, taper=True, wob=1.2):
        """Trait au pinceau le long d'une courbe : epaisseur un peu vivante, fine aux deux bouts, leger tremble."""
        c = _smooth(pts)
        n = len(c)
        ph1, ph2 = self.rnd.uniform(0, 6.28), self.rnd.uniform(0, 6.28)
        for i, q in enumerate(c):
            t = i / max(1, n - 1)
            k = (0.35 + 0.65 * math.sin(math.pi * min(1, max(0, t))) ** 0.6) if taper else 1.0
            k *= 1 + 0.16 * math.sin(7 * t + ph1)
            x = q[0] + wob * math.sin(5.3 * t * math.pi + ph1) * 0.6
            y = q[1] + wob * math.sin(4.1 * t * math.pi + ph2) * 0.6
            r = max(0.8, w * k / 2) * SS
            self.d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=255)
        return c

    def blob(self, cx, cy, rx, ry, rot=0.0):
        pts = []
        for i in range(40):
            a = 2 * math.pi * i / 40
            x, y = rx * math.cos(a), ry * math.sin(a)
            pts.append(((cx + x * math.cos(rot) - y * math.sin(rot)) * SS, (cy + x * math.sin(rot) + y * math.cos(rot)) * SS))
        self.d.polygon(pts, fill=255)

    def back(self, pts):
        self.f.polygon([(x * SS, y * SS) for x, y in pts], fill=255)

    def image(self):
        ink = self.ink.filter(ImageFilter.GaussianBlur(SS * 0.35)).resize((self.w, self.h), Image.LANCZOS)
        fill = self.fill.filter(ImageFilter.GaussianBlur(SS * 0.6)).resize((self.w, self.h), Image.LANCZOS)
        i, f = np.asarray(ink), np.asarray(fill)
        grey = (255 - i).astype(np.uint8)
        a = np.maximum(i, f)
        im = Image.fromarray(np.dstack([grey, grey, grey, a]))
        ys, xs = np.where(a > 20)
        return im.crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(self.w, xs.max() + 7), min(self.h, ys.max() + 7)))


# ------------------------------------------------------------------ nez
NEZ = dict(L=250,          # longueur, de la racine au bas de la pointe
           wt=44, wm=50,   # largeur de l'arete : a la racine, au milieu
           bump=0,         # bosse au milieu de l'arete (elargissement)
           tw=78, th=46,   # pointe : largeur, hauteur
           tip="rond",     # rond | boule | pointu | carre | bilobe
           wa=150, ah=62,  # ailes : largeur totale du nez, hauteur des ailes
           aile="moyen",   # pince | moyen | evase | charnu
           base=0,         # -1 relevee (narines bien visibles), 0 horizontale, +1 abaissee (pointe plongeante, narines cachees)
           nar="ovale",    # ovale | fente | rond | point
           col=0,          # cloison qui descend sous les ailes
           bend=0, s=0,    # deviation : en C (bend), en S (s)
           arete=1.0,      # part de l'arete dessinee (1 = du haut jusqu'a la pointe ; 0.4 = seulement le bas)
           trait=5.0)


def nez(seed=1, **kw):
    p = dict(NEZ, **kw)
    W, H, cx, y0 = 420, 470, 210, 60
    sh = Sheet(W, H, seed)
    L = p["L"]
    ty = y0 + L                                   # bas de la pointe
    dev = lambda y: p["bend"] * math.sin(math.pi * (y - y0) / L) + p["s"] * math.sin(2 * math.pi * (y - y0) / L)
    tcx = cx + (p["bend"] * 0.35 + p["s"] * 0.2)   # la pointe suit un peu la deviation
    drop = 16 * p["base"]                         # pointe plongeante : elle descend sous les ailes
    tipy = ty + max(0, drop)
    tw, th, wa, ah = p["tw"], p["th"], p["wa"], p["ah"]
    ay = ty - ah * 0.55                           # centre des ailes
    ytop = y0 + L * (1 - p["arete"]) * 0.9
    sides = []
    for sgn in (-1, 1):                           # les deux lignes de l'arete
        pts = []
        for t in (0, 0.25, 0.5, 0.75, 1.0):
            y = ytop + (ty - th - ytop) * t
            tt = (y - y0) / max(1, (ty - th - y0))
            w = p["wt"] + (p["wm"] - p["wt"]) * min(1, tt * 2) if tt < 0.5 else p["wm"] + (tw * 0.8 - p["wm"]) * (tt - 0.5) * 2
            w += p["bump"] * math.exp(-((tt - 0.45) / 0.16) ** 2)
            pts.append((cx + dev(y) + sgn * w / 2, y))
        sides.append(pts)
        sh.line(pts, p["trait"] * 0.8, wob=1.4)
    # la pointe
    if p["tip"] == "boule":
        r = tw / 2
        sh.line([(tcx + r * math.cos(a), tipy - r + r * math.sin(a)) for a in np.linspace(math.pi * 1.15, -math.pi * 0.15, 15)], p["trait"], taper=False)
    elif p["tip"] == "pointu":
        sh.line([(tcx - tw * 0.36, tipy - th * 0.75), (tcx - tw * 0.16, tipy - th * 0.2), (tcx, tipy + 3), (tcx + tw * 0.16, tipy - th * 0.2), (tcx + tw * 0.36, tipy - th * 0.75)], p["trait"])
    elif p["tip"] == "carre":
        sh.line([(tcx - tw / 2, tipy - th * 0.85), (tcx - tw / 2, tipy - 6), (tcx - tw / 2 + 6, tipy), (tcx + tw / 2 - 6, tipy), (tcx + tw / 2, tipy - 6), (tcx + tw / 2, tipy - th * 0.85)], p["trait"], taper=False, wob=0.6)
    elif p["tip"] == "bilobe":
        for sgn in (-1, 1):
            sh.line([(tcx + sgn * tw / 2, tipy - th * 0.8), (tcx + sgn * tw * 0.48, tipy - th * 0.25), (tcx + sgn * tw * 0.27, tipy), (tcx + sgn * 3, tipy - th * 0.22)], p["trait"])
        sh.line([(tcx, tipy - th * 0.55), (tcx, tipy - th * 0.12)], p["trait"] * 0.7)
    else:
        sh.line([(tcx - tw / 2, tipy - th * 0.8), (tcx - tw * 0.42, tipy - th * 0.22), (tcx, tipy), (tcx + tw * 0.42, tipy - th * 0.22), (tcx + tw / 2, tipy - th * 0.8)], p["trait"])
    # les ailes
    k = {"pince": (0.55, 0.9), "moyen": (1.0, 1.0), "evase": (1.0, 1.15), "charnu": (1.0, 1.25)}[p["aile"]]
    outer = []
    for sgn in (-1, 1):
        x_in, x_out = tcx + sgn * tw * 0.5, tcx + sgn * wa / 2
        pts = [(x_in + sgn * 2, ay - ah * 0.5 * k[1]), (x_out - sgn * (wa / 2 - tw / 2) * 0.25, ay - ah * 0.42 * k[1]), (x_out, ay + ah * 0.05),
               (x_out - sgn * (wa / 2 - tw / 2) * 0.3, ty - 2 - min(0, drop)), (x_in + sgn * 6, ty + 3 - min(0, drop) * 0.6)]
        sh.line(pts, p["trait"] * (1.25 if p["aile"] == "charnu" else 1.0))
        outer.append(pts)
        if p["aile"] == "charnu":                 # sillon de l'aile
            sh.line([(x_in + sgn * 4, ay - ah * 0.2), (x_in + sgn * (wa / 2 - tw / 2) * 0.45, ay - ah * 0.05), (x_in + sgn * (wa / 2 - tw / 2) * 0.5, ay + ah * 0.3)], p["trait"] * 0.6)
    # la base : cloison, puis les narines
    cy = ty + 4 + 14 * p["col"] - min(0, drop) * 0.3
    sh.line([(tcx - tw * 0.3, ty + 2 - min(0, drop) * 0.6), (tcx, cy), (tcx + tw * 0.3, ty + 2 - min(0, drop) * 0.6)], p["trait"] * 0.8)
    vis = {-1: 1.0, 0: 0.55, 1: 0.0}[int(p["base"])]
    if p["nar"] == "point":
        for sgn in (-1, 1):
            sh.blob(tcx + sgn * tw * 0.3, ty - 4, 4.5, 4.5)
    elif vis > 0:
        for sgn in (-1, 1):
            nx = tcx + sgn * (tw * 0.34 + (wa - tw) * 0.14)
            ny = ty - 6 - (10 if p["base"] < 0 else 0) + (12 * p["col"])
            if p["nar"] == "fente":
                sh.blob(nx, ny, 4.5, 13 * vis + 4, sgn * 0.25)
            elif p["nar"] == "rond":
                sh.blob(nx, ny - 4, 15 * vis + 3, 15 * vis + 3)
            else:
                sh.blob(nx, ny, (wa - tw) * 0.13 + 8, 9 * vis + 2, -sgn * 0.3)
    # le fond blanc : tout l'interieur du nez
    left, right = sides[0], sides[1]
    poly = left + [(tcx - tw / 2, tipy - th * 0.8)] + outer[0][1:] + [(tcx, max(cy, tipy) + 2)] + outer[1][1:][::-1] + [(tcx + tw / 2, tipy - th * 0.8)] + right[::-1]
    sh.back(poly)
    return sh.image()


NEZ_VARIANTES = [
    ("Moyen droit", {}),
    ("Étroit long", dict(L=300, wt=26, wm=28, tw=52, th=40, wa=96, ah=50, aile="pince", nar="fente")),
    ("Court retroussé", dict(L=170, wt=40, wm=46, tw=74, wa=140, base=-1, arete=0.6)),
    ("Pointe plongeante", dict(L=260, tw=70, th=54, wa=132, base=1, tip="pointu")),
    ("Ailes évasées", dict(wa=206, ah=70, aile="evase", tw=80)),
    ("Écrasé", dict(L=190, wt=70, wm=86, tw=120, th=40, wa=216, ah=58, aile="evase", arete=0.45)),
    ("Arête large", dict(wt=84, wm=84, tw=104, wa=150, tip="carre", ah=56)),
    ("Racine étroite, base large", dict(wt=22, wm=46, tw=96, wa=196, aile="evase")),
    ("Racine large, pointe fine", dict(wt=92, wm=62, tw=48, th=38, wa=104, ah=50, aile="pince", nar="fente")),
    ("Bout en boule", dict(wt=30, wm=30, tw=112, th=60, tip="boule", wa=170)),
    ("Bout pointu", dict(wt=40, wm=40, tw=56, th=58, tip="pointu", wa=112, aile="pince", nar="fente")),
    ("Bout bilobé", dict(tw=96, th=52, tip="bilobe", wa=166)),
    ("Bout carré", dict(tw=96, th=50, tip="carre", wa=160)),
    ("Bosse médiane", dict(wt=34, wm=44, bump=34, tw=74)),
    ("Tordu", dict(bend=30, L=270)),
    ("Cassé en S", dict(s=22, bump=14, L=260, wa=160)),
    ("Narines pincées", dict(wa=104, ah=56, aile="pince", nar="fente", tw=62)),
    ("Narines rondes", dict(nar="rond", base=-1, wa=176, ah=66, tw=70, arete=0.7)),
    ("Ailes charnues", dict(aile="charnu", wa=190, ah=78, tw=84, trait=6.0)),
    ("Cloison basse", dict(col=1.6, base=-1, nar="fente", wa=140)),
    ("Petit bouton", dict(L=120, wt=30, wm=34, tw=58, th=36, wa=96, ah=40, nar="point", arete=0.3, tip="rond")),
    ("Grand nez fort", dict(L=330, wt=58, wm=70, bump=10, tw=118, th=64, wa=220, ah=86, aile="charnu", trait=6.5)),
]
