"""Elements du generateur de corps en TRACES PLEINS, a retoucher dans l'atelier de dessin (app/web/js/draw.js).

Chaque element est fait de formes de l'atelier (formes libres « blob » remplies et cernees, traits libres « free » pour
les details, ellipses) : couleur de remplissage et de contour, epaisseur, tremble et points se changent dans l'atelier,
et le detourage est parfait par construction (rien hors des formes, pas de blanc rebouche). Les formes sont gardees en
calques dans le .json de l'element (meme format que ce que l'atelier enregistre) ; le PNG est rendu ici, avec la meme
geometrie que draw.js (geom : courbes passant par les milieux des points, premier et dernier point aux bouts).

Une vingtaine de « gabarits » (GABARITS) : carrure, longueur du buste et des jambes, tenue, couleurs. Chaque gabarit
donne un corps entier (un calque par piece) et un element de chaque categorie (torse, bras, mains, jambes, chaussures),
tous dans le cadre 1000 x 2000 du generateur et au meme identifiant : 🎲 tire bras et mains avec leur torse, chaussures
avec leurs jambes. Mesures en hauteurs de tete U (app/bodydraw.py) : menton en (500, CHIN), la tete du portrait-robot
se pose par-dessus le cou. Pour qu'on puisse melanger les pieces de deux gabarits, le haut du pantalon remonte sous le
torse plus haut que la ceinture la plus haute, et chaque piece passe un peu sous celle qui la recouvre (ordre du
generateur : jambes, chaussures, torse, bras, mains).

  construire(g)              -> {categorie: (nom, calques)} pour un gabarit
  ecrire(refaire=False)      -> elements ecrits dans data/parts/_corps-el/<categorie>/ (Banque Claude)
  planche(sortie)            -> planche de controle
"""
import json
import math
import random

import numpy as np
from PIL import Image, ImageDraw

from . import bodydraw as B
from . import parts, store

W, H = 1000, 2000
U, CX, CHIN = B.U, 500.0, B.CHIN
ROOT = parts.ROOT / "_corps-el"
INK = "#1f1a17"
SW, SWD = 1.3, 0.85                                # epaisseur du contour (x 4 pixels dans l'atelier), des details

PEAUX = ["#f3cfb0", "#e4b08a", "#c98d62", "#9c6642", "#6d4329", "#f7dcc6", "#d9a077", "#b37a52"]
DEF = dict(ep=1.05, taille=0.62, hanches=0.72, cou=0.26, bras=0.19, jambe=0.27, ventre=0.0, buste=1.9, jambes=2.6,
           main=1.0, haut="tshirt", manches="courtes", bas="pantalon", pieds="chaussures", peau=0,
           c_haut="#5b8fc9", c_bas="#3d4a63", c_pieds="#4a3426", c_semelle="#2a211c", c_dessous="#f4f1ea")

# (id, nom, cotes) : ep, taille, hanches, cou, bras, jambe = demi-largeurs ; buste = menton -> ceinture ; jambes = ceinture -> chevilles
GABARITS = [
    ("moyen", "Moyen, t-shirt et pantalon", dict(pieds="baskets")),
    ("mince", "Mince, chemise", dict(ep=0.92, taille=0.5, hanches=0.6, bras=0.15, jambe=0.21, cou=0.22, haut="chemise", manches="longues",
                                     c_haut="#e8e4d8", c_bas="#57534c", peau=1)),
    ("costaud", "Costaud, t-shirt", dict(ep=1.32, taille=0.74, hanches=0.8, bras=0.27, jambe=0.33, cou=0.34, main=1.15, pieds="baskets",
                                         c_haut="#c4473a", c_bas="#2f3f5c", peau=2)),
    ("rond", "Rond, pull", dict(ep=1.1, taille=0.86, hanches=0.92, ventre=0.26, bras=0.24, jambe=0.33, cou=0.32, main=1.08, haut="pull",
                                manches="longues", c_haut="#7a9a55", c_bas="#6b5a48", peau=5)),
    ("costume-sombre", "Costume", dict(ep=1.12, taille=0.66, hanches=0.72, haut="veste", manches="longues", c_haut="#3a3f4a", c_bas="#3a3f4a",
                                c_pieds="#1d1b1a", peau=3)),
    ("grand-mince", "Grand, mince, costume", dict(ep=1.0, taille=0.52, hanches=0.6, bras=0.15, jambe=0.2, cou=0.22, buste=2.0, jambes=2.95,
                                                  haut="veste", manches="longues", c_haut="#6b5d4f", c_bas="#6b5d4f", c_pieds="#2b1f17", peau=0)),
    ("trapu", "Petit, trapu", dict(ep=1.2, taille=0.8, hanches=0.84, ventre=0.1, bras=0.26, jambe=0.34, cou=0.34, buste=1.72, jambes=2.0,
                                         main=1.1, haut="chemise", manches="courtes", c_haut="#d9b44a", c_bas="#4c5a3c", peau=6)),
    ("robe-simple", "Robe", dict(ep=0.86, taille=0.46, hanches=0.7, bras=0.14, jambe=0.2, cou=0.2, main=0.88, haut="robe", manches="sans", bas="robe",
                          pieds="escarpins", c_haut="#b9466b", c_bas="#b9466b", c_pieds="#6e1f33", peau=1)),
    ("jupe-blouse", "Jupe et blouse", dict(ep=0.88, taille=0.48, hanches=0.74, bras=0.15, jambe=0.2, cou=0.2, main=0.88, haut="blouse",
                                           manches="longues", bas="jupe", pieds="escarpins", c_haut="#f0e6d2", c_bas="#2e4a6e",
                                           c_pieds="#1d1b1a", peau=4)),
    ("sportif", "Débardeur et short", dict(ep=1.0, taille=0.6, hanches=0.7, bras=0.2, jambe=0.26, haut="debardeur", manches="sans", bas="short",
                                           pieds="baskets", c_haut="#e07b2a", c_bas="#2b2b33", peau=2)),
    ("enfant", "Enfant", dict(ep=0.72, taille=0.5, hanches=0.55, bras=0.13, jambe=0.18, cou=0.18, buste=1.35, jambes=1.55, main=0.72,
                              haut="tshirt", bas="short", pieds="baskets", c_haut="#e9c53b", c_bas="#3a6fb0", peau=5)),
    ("ado", "Ado, sweat à capuche", dict(ep=0.98, taille=0.6, hanches=0.66, bras=0.17, jambe=0.23, cou=0.23, buste=1.85, jambes=2.7,
                                         haut="sweat", manches="longues", bas="jean", pieds="baskets", c_haut="#5d6470", c_bas="#3f5f8a", peau=7)),
    ("athlete", "Athlète, épaules larges", dict(ep=1.6, taille=0.7, hanches=0.74, bras=0.31, jambe=0.33, cou=0.38, main=1.2, buste=1.95, jambes=2.6,
                                                 haut="debardeur", manches="sans", bas="pantalon", pieds="baskets", c_haut="#f2f2ee",
                                                 c_bas="#2c3440", peau=3)),
    ("gros", "Gros, chemise", dict(ep=1.25, taille=1.05, hanches=1.08, ventre=0.42, bras=0.28, jambe=0.4, cou=0.36, main=1.15, buste=1.95,
                                   jambes=2.3, haut="chemise", manches="courtes", c_haut="#9fc3d9", c_bas="#4f463c", peau=0)),
    ("ancien", "Ancien, gilet", dict(ep=0.96, taille=0.64, hanches=0.7, ventre=0.08, bras=0.17, jambe=0.24, cou=0.25, buste=1.8, jambes=2.35,
                                     haut="gilet", manches="longues", bas="pantalon", c_haut="#8a6d4b", c_bas="#77736a", c_pieds="#3b2b20",
                                     peau=5)),
    ("longues-jambes", "Longues jambes, robe courte", dict(ep=0.84, taille=0.44, hanches=0.62, bras=0.13, jambe=0.18, cou=0.19, main=0.86,
                                                           buste=1.85, jambes=3.15, haut="robe", manches="sans", bas="robe-courte",
                                                           pieds="escarpins", c_haut="#2d2d33", c_bas="#2d2d33", c_pieds="#a8323a",
                                                           peau=6)),
    ("jambes-courtes", "Jambes courtes, polo", dict(ep=1.12, taille=0.7, hanches=0.76, bras=0.23, jambe=0.3, cou=0.3, buste=1.9, jambes=1.85,
                                                    haut="polo", manches="courtes", bas="pantalon", c_haut="#3f8a6b", c_bas="#c9b78f",
                                                    c_pieds="#5a3a24", peau=2)),
    ("ronde", "Ronde, jupe longue", dict(ep=1.02, taille=0.8, hanches=1.0, ventre=0.12, bras=0.22, jambe=0.32, cou=0.26, main=0.95, buste=1.85,
                                         jambes=2.4, haut="blouse", manches="courtes", bas="jupe-longue", pieds="escarpins",
                                         c_haut="#d77f5a", c_bas="#55406e", c_pieds="#2b2433", peau=4)),
    ("vacancier", "Vacancier, bermuda", dict(ep=1.05, taille=0.7, hanches=0.74, ventre=0.12, bras=0.2, jambe=0.28, buste=1.9, jambes=2.45,
                                             haut="chemise", manches="courtes", bas="bermuda", pieds="baskets", c_haut="#e6603e",
                                             c_bas="#c7b07c", peau=7)),
    ("manteau", "Long manteau", dict(ep=1.1, taille=0.68, hanches=0.78, bras=0.2, jambe=0.26, cou=0.27, buste=1.95, jambes=2.75, haut="manteau",
                                     manches="longues", bas="pantalon", pieds="bottes", c_haut="#7c5a3a", c_bas="#2d2f36", c_pieds="#24201c",
                                     peau=1)),
    ("ouvrier", "Ouvrier, salopette", dict(ep=1.15, taille=0.74, hanches=0.8, bras=0.23, jambe=0.3, cou=0.3, main=1.1, buste=1.9, jambes=2.55,
                                           haut="tshirt", manches="courtes", bas="salopette", pieds="bottes", c_haut="#c9c2b2",
                                           c_bas="#4a6a8c", c_pieds="#3a2a1d", peau=3)),
]

TAGS = {"costume-sombre": "costume", "robe-simple": "robe", "trapu": "petit, trapu", "jupe-blouse": "jupe et blouse", "sportif": "sportif", "athlete": "athlète", "longues-jambes": "longues jambes"}
NOMS_HAUT = {"tshirt": "T-shirt", "chemise": "Chemise", "veste": "Veste de costume", "pull": "Pull", "sweat": "Sweat à capuche",
             "debardeur": "Débardeur", "blouse": "Blouse", "robe": "Haut de robe", "gilet": "Gilet sur chemise", "polo": "Polo",
             "manteau": "Long manteau"}
NOMS_BAS = {"pantalon": "Pantalon", "jean": "Jean", "short": "Short", "bermuda": "Bermuda", "jupe": "Jupe", "jupe-longue": "Jupe longue",
            "robe": "Jupe de robe", "robe-courte": "Jupe de robe courte", "salopette": "Salopette"}
NOMS_PIEDS = {"chaussures": "Chaussures de ville", "baskets": "Baskets", "bottes": "Bottes", "escarpins": "Escarpins"}
NOMS_MANCHES = {"courtes": "Manches courtes", "longues": "Manches longues", "sans": "Bras nus"}


# ------------------------------------------------------------------------------------------------ formes de l'atelier
class Forms:
    """Liste de formes d'un calque ; x en unites U depuis l'axe, y en U depuis le menton (ou pixels si px=True)."""

    def __init__(self, tag):
        self.tag, self.shapes, self.n = tag, [], 0

    def _id(self):
        self.n += 1
        return "%s%d" % (self.tag, self.n)

    @staticmethod
    def P(pts, px=False):
        out = []
        for x, y in pts:
            X, Y = (x, y) if px else (CX + x * U, CHIN + y * U)
            out.append([round(X / W, 5), round(Y / H, 5)])
        return out

    def blob(self, pts, col, stroke=INK, sw=SW, px=False):
        """Forme libre fermee, remplie ; le premier et le dernier point sont relies par une droite."""
        self.shapes.append({"id": self._id(), "t": "blob", "p": self.P(pts, px), "fon": True, "col": col, "tr": "none",
                            "stroke": stroke, "sw": sw if stroke != "none" else 0, "hand": 0, "ed": 1})

    def line(self, pts, stroke=INK, sw=SWD, px=False):
        """Trait libre (detail) : lisse, ouvert."""
        self.shapes.append({"id": self._id(), "t": "free", "p": self.P(pts, px), "fon": False, "stroke": stroke, "sw": sw, "hand": 0, "ed": 1})

    def ellipse(self, cx, cy, rx, ry, col, stroke=INK, sw=SWD):
        self.shapes.append({"id": self._id(), "t": "ellipse", "p": self.P([(cx - rx, cy - ry), (cx + rx, cy + ry)]), "fon": True,
                            "col": col, "tr": "none", "stroke": stroke, "sw": sw, "hand": 0})

    def pair(self, fn, *a, **k):
        """Dessine le cote gauche (x < 0) puis son miroir exact a droite."""
        before = len(self.shapes)
        fn(self, -1, *a, **k)
        for sh in [dict(s) for s in self.shapes[before:]]:
            s2 = dict(sh, id=self._id(), p=[[round(1 - x, 5), y] for x, y in sh["p"]])
            if sh["t"] == "ellipse":
                s2["p"] = [[round(1 - sh["p"][1][0], 5), sh["p"][0][1]], [round(1 - sh["p"][0][0], 5), sh["p"][1][1]]]
            self.shapes.append(s2)


def mir(pts):
    return [(-x, y) for x, y in pts]


def _tube(cl, ws, n=3):
    """Contour d'un membre le long de la ligne cl (points), demi-largeurs ws : (cote exterieur, cote interieur), chacun du
    haut vers le bas. Exterieur = du cote des x negatifs (le membre gauche s'ecarte du corps)."""
    pts, wid = [], []
    for i in range(len(cl) - 1):
        for k in range(n):
            t = k / n
            pts.append((cl[i][0] + (cl[i + 1][0] - cl[i][0]) * t, cl[i][1] + (cl[i + 1][1] - cl[i][1]) * t))
            wid.append(ws[i] + (ws[i + 1] - ws[i]) * t)
    pts.append(cl[-1])
    wid.append(ws[-1])
    a, b = [], []
    for i, q in enumerate(pts):
        p0, p1 = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        tx, ty = p1[0] - p0[0], p1[1] - p0[1]
        m = math.hypot(tx, ty) or 1
        nx, ny = ty / m, -tx / m                          # normale vers l'exterieur (x negatifs) pour un membre qui descend
        if nx > 0:
            nx, ny = -nx, -ny
        a.append((q[0] + nx * wid[i], q[1] + ny * wid[i]))
        b.append((q[0] - nx * wid[i], q[1] - ny * wid[i]))
    return a, b


def _lerp(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def _cut(cl, ws, t):
    """La ligne cl (et ses largeurs) gardee de 0 a la fraction t de sa longueur."""
    L = [0.0]
    for i in range(1, len(cl)):
        L.append(L[-1] + math.hypot(cl[i][0] - cl[i - 1][0], cl[i][1] - cl[i - 1][1]))
    goal = L[-1] * t
    out, ow = [cl[0]], [ws[0]]
    for i in range(1, len(cl)):
        if L[i] >= goal:
            f = (goal - L[i - 1]) / ((L[i] - L[i - 1]) or 1)
            out.append(_lerp(cl[i - 1], cl[i], f))
            ow.append(ws[i - 1] + (ws[i] - ws[i - 1]) * f)
            break
        out.append(cl[i])
        ow.append(ws[i])
    return out, ow


# ------------------------------------------------------------------------------------------------ mesures d'un gabarit
def cotes(kw):
    g = dict(DEF)
    g.update(kw)
    g["skin"] = PEAUX[g["peau"] % len(PEAUX)]
    t = g["taille"] + g["ventre"] * 0.6
    g["T"] = t
    g["y_ais"] = 0.95
    g["y_w"] = g["buste"]
    g["y_cr"] = g["buste"] + 0.62                         # entrejambe
    g["y_an"] = g["buste"] + g["jambes"]                  # chevilles
    j = g["jambe"]
    g["ankle_c"] = j * 0.62 + 0.1                          # ecart des chevilles a l'axe
    g["ankle_w"] = j * 0.52
    # bras : epaule, coude, poignet
    br = g["bras"]
    g["J"] = (-(g["ep"] - br * 0.9), 0.56)
    g["E"] = (-(max(t, g["ep"] * 0.7) + br * 0.95 + 0.1), g["buste"] - 0.08)
    g["Wr"] = (-(max(g["hanches"], t) + br * 0.6 + 0.16), g["buste"] + 0.78)
    g["arm_w"] = [br * 1.05, br * 0.88, br * 0.66]
    return g


# ------------------------------------------------------------------------------------------------ torse
def torse(g):
    f = Forms("t")
    ep, t, hp, cou, y_w = g["ep"], g["T"], g["hanches"], g["cou"], g["y_w"]
    haut, col = g["haut"], g["c_haut"]
    # le cou (et la capuche) derriere le haut ; le haut du cou passe sous la tete
    if haut == "sweat":
        f.blob([(-cou * 1.25, 0.42), (-cou * 2.3, 0.3), (-cou * 2.3, -0.12), (-cou * 1.2, -0.28), (cou * 1.2, -0.28), (cou * 2.3, -0.12),
                (cou * 2.3, 0.3), (cou * 1.25, 0.42)], _shade(col, 0.82))
    f.blob([(-cou, -0.32), (-cou, 0.05), (-cou * 1.1, 0.3), (-cou * 1.1, 0.42), (cou * 1.1, 0.42), (cou * 1.1, 0.3), (cou, 0.05), (cou, -0.32)], g["skin"])
    hem = {"veste": 0.48, "manteau": 1.75, "robe": 0.1, "gilet": 0.3, "debardeur": 0.14, "sweat": 0.2, "pull": 0.16, "blouse": 0.12}.get(haut, 0.12)
    y_h = y_w + hem
    w_h = (max(hp, t) * 1.02 if hem < 0.6 else max(hp, t) * 1.06 + (hem - 0.6) * 0.18)
    sh_top = 0.3 if haut != "debardeur" and haut != "robe" else 0.38
    belly = g["ventre"]
    left = [(-w_h, y_h), (-w_h, y_h)]
    if hem > 0.6:                                         # manteau : le bas s'evase
        left += [(-max(hp, t) * 1.05, y_w + 0.4)]
    left += [(-max(t, hp * 0.98), y_w - 0.02)]
    if belly > 0.05:
        left += [(-(t + belly * 0.35), y_w - 0.45)]
    left += [(-(g["taille"] + max(0, (ep - g["taille"])) * 0.35), 1.15)]
    if haut in ("debardeur", "robe"):                      # emmanchure profonde : l'epaule reste nue
        left += [(-(ep - g["bras"] * 1.6), 0.95), (-(ep - g["bras"] * 1.7), 0.6), (-(cou + 0.32), 0.36), (-(cou + 0.18), sh_top)]
    else:
        left += [(-ep * 0.98, 0.78), (-ep, 0.52), (-ep * 0.9, 0.36), (-ep * 0.55, 0.28), (-(cou + 0.08), 0.22)]
    # encolure
    if haut in ("veste", "manteau", "gilet", "blouse", "polo", "chemise"):
        neck = [(-(cou + 0.02), 0.2), (-cou * 0.5, 0.3)]
    elif haut in ("debardeur", "robe"):
        neck = [(-(cou + 0.06), 0.34), (-cou * 0.6, 0.52)]
    else:
        neck = [(-(cou + 0.02), 0.21), (-cou * 0.7, 0.33)]
    left += neck
    mid = (0, 0.36 if haut not in ("debardeur", "robe") else 0.56)
    pts = left + [mid] + list(reversed(mir(left)))
    f.blob(pts, col)
    _details_torse(f, g, y_h, w_h)
    if g["bas"] == "salopette":                          # la bavette et les bretelles de la salopette passent sur le haut
        cb = g["c_bas"]
        f.pair(lambda F, sg: F.blob([(sg * (ep * 0.62), 0.34), (sg * (ep * 0.5), 0.3), (sg * 0.3, 1.02), (sg * 0.44, 1.06)], cb, sw=SWD))
        f.blob([(-0.46, y_w + 0.3), (-0.46, y_w + 0.3), (-0.44, 0.98), (-0.44, 0.98), (0.44, 0.98), (0.44, 0.98), (0.46, y_w + 0.3), (0.46, y_w + 0.3)], cb)
        f.blob([(-0.2, 1.12), (-0.2, 1.12), (-0.2, 1.38), (-0.2, 1.38), (0.2, 1.38), (0.2, 1.38), (0.2, 1.12), (0.2, 1.12)], _shade(cb, 0.88), sw=SWD)
        f.pair(lambda F, sg: F.ellipse(sg * 0.36, 1.04, 0.045, 0.045, "#d8b54a"))
    return f.shapes


def _shade(c, k):
    r, g_, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v * k))) for v in (r, g_, b))


def _details_torse(f, g, y_h, w_h):
    haut, cou, y_w, col = g["haut"], g["cou"], g["y_w"], g["c_haut"]
    if haut in ("tshirt", "pull", "sweat"):
        f.line([(-(cou + 0.02), 0.28), (-cou * 0.6, 0.4), (0, 0.43), (cou * 0.6, 0.4), (cou + 0.02, 0.28)])
    if haut == "pull":
        f.line([(-w_h * 0.98, y_h - 0.12), (0, y_h - 0.12), (w_h * 0.98, y_h - 0.12)])
    if haut == "sweat":
        f.blob([(-0.42, y_w + 0.18), (-0.36, y_w - 0.32), (-0.3, y_w - 0.42), (0.3, y_w - 0.42), (0.36, y_w - 0.32), (0.42, y_w + 0.18)],
               _shade(col, 0.92), sw=SWD)
        f.line([(-0.12, 0.42), (-0.13, 0.75)])
        f.line([(0.12, 0.42), (0.13, 0.75)])
    if haut in ("chemise", "polo", "blouse", "gilet"):
        light = g["c_dessous"] if haut == "gilet" else col
        if haut == "gilet":                               # gilet ouvert en V sur une chemise claire et une cravate
            f.blob([(-cou * 0.95, 0.22), (-0.06, y_w + 0.1), (0.06, y_w + 0.1), (cou * 0.95, 0.22)], light, sw=SWD)
            f.blob([(-0.04, 0.34), (-0.1, 0.42), (-0.07, y_w - 0.1), (0, y_w - 0.02), (0.07, y_w - 0.1), (0.1, 0.42), (0.04, 0.34)],
                   "#8c2f2f", sw=SWD)
        f.pair(lambda F, sg: F.blob([(sg * 0.02, 0.33), (sg * (cou + 0.06), 0.18), (sg * (cou + 0.12), 0.25), (sg * 0.2, 0.46), (sg * 0.02, 0.36)],
                                     _shade(light, 1.04) if haut != "gilet" else light, sw=SWD))
        if haut == "gilet":
            f.line([(-0.06, 0.6), (-0.07, y_w + 0.28)])
            f.line([(0.06, 0.6), (0.07, y_w + 0.28)])
            for k in range(4):
                f.ellipse(-0.1, 0.85 + k * (y_w - 0.7) / 4, 0.035, 0.035, _shade(col, 0.7))
        else:
            n = 2 if haut == "polo" else 5
            f.line([(0, 0.38), (0, 0.42 + (0.45 if haut == "polo" else y_w + 0.02))])
            for k in range(n):
                f.ellipse(0.045, 0.52 + k * (0.18 if haut == "polo" else (y_w - 0.4) / n), 0.03, 0.03, _shade(col, 0.75))
            if haut == "chemise" and g["ventre"] < 0.2:
                f.pair(lambda F, sg: F.line([(sg * 0.5, 0.75), (sg * 0.62, 0.78), (sg * 0.62, 0.95)], sw=SWD * 0.8))
    if haut in ("veste", "manteau"):
        under = g["c_dessous"]
        f.blob([(-cou * 0.9, 0.2), (-0.03, 1.15), (0.03, 1.15), (cou * 0.9, 0.2)], under, sw=SWD)          # chemise dans le V
        f.blob([(-0.04, 0.33), (-0.1, 0.41), (-0.07, 1.0), (0, 1.12), (0.07, 1.0), (0.1, 0.41), (0.04, 0.33)], "#7a2430", sw=SWD)   # cravate
        lap = _shade(g["c_haut"], 0.85)
        f.pair(lambda F, sg: F.blob([(sg * (cou + 0.02), 0.2), (sg * (cou + 0.16), 0.32), (sg * 0.42, 0.62), (sg * 0.3, 0.68), (sg * 0.22, 0.72),
                                     (sg * 0.04, 1.16), (sg * 0.02, 1.18), (sg * cou * 0.8, 0.22)], lap, sw=SWD))
        f.line([(0, 1.16), (0.01, y_h)])
        nb = 3 if haut == "manteau" else 2
        for k in range(nb):
            f.ellipse(-0.08, 1.3 + k * (0.3 if haut == "manteau" else 0.25), 0.04, 0.04, _shade(g["c_haut"], 0.65))
        f.pair(lambda F, sg: F.line([(sg * 0.6, y_w + 0.1), (sg * 0.3, y_w + 0.12)], sw=SWD))         # poches
        if haut == "manteau":
            f.line([(0.01, y_h - 0.02), (0.01, y_h)])
    if haut in ("debardeur", "robe"):
        f.line([(-(g["cou"] + 0.06), 0.42), (-g["cou"] * 0.6, 0.58), (0, 0.62), (g["cou"] * 0.6, 0.58), (g["cou"] + 0.06, 0.42)])
    if haut == "robe":
        f.line([(-g["T"] * 1.02, g["y_w"] - 0.02), (0, g["y_w"]), (g["T"] * 1.02, g["y_w"] - 0.02)])
    if haut == "blouse":
        f.ellipse(0, 0.47, 0.06, 0.05, _shade(col, 0.8))


# ------------------------------------------------------------------------------------------------ bras
def bras(g):
    f = Forms("b")
    f.pair(_bras1, g)
    return f.shapes


def _arm_outline(cl, ws, cap=True):
    a, b = _tube(cl, ws)
    top = cl[0]
    w0 = ws[0]
    caps = [(top[0] - w0 * 0.7, top[1] - w0 * 0.95), (top[0] + w0 * 0.2, top[1] - w0 * 1.2)] if cap else []
    return [a[-1], a[-1]] + list(reversed(a[1:])) + caps + b[1:] + [b[-1]]


def _bras1(f, sg, g):
    cl, ws = [g["J"], g["E"], g["Wr"]], g["arm_w"]
    man, col = g["manches"], g["c_haut"]
    if man != "longues":
        f.blob(_arm_outline(cl, ws), g["skin"])
    if man == "courtes":
        c2, w2 = _cut(cl, [ws[0] * 1.16, ws[1] * 1.2, ws[2] * 1.2], 0.36)
        f.blob(_arm_outline(c2, w2), col)
    elif man == "longues":
        c2 = [g["J"], g["E"], _lerp(g["E"], g["Wr"], 0.96)]
        w2 = [ws[0] * 1.18, ws[1] * 1.16, ws[2] * 1.22]
        f.blob(_arm_outline(c2, w2), col)
        a, b = _tube(c2, w2)
        f.line([_lerp(a[-3], a[-2], 0.5), _lerp(b[-3], b[-2], 0.5)])          # poignet de la manche
        if g["haut"] in ("veste", "manteau"):
            f.line([_lerp(a[-4], b[-4], 0.15), _lerp(a[-4], b[-4], 0.5), _lerp(a[-4], b[-4], 0.85)], sw=SWD * 0.6)


# ------------------------------------------------------------------------------------------------ mains
def mains(g):
    f = Forms("m")
    f.pair(_main1, g)
    return f.shapes


def _main1(f, sg, g):
    E, Wr = g["E"], g["Wr"]
    dx, dy = Wr[0] - E[0], Wr[1] - E[1]
    m = math.hypot(dx, dy)
    ux, uy = dx / m, dy / m                                # le long de la main (vers le bas)
    vx, vy = -uy, ux                                       # en travers, vers l'interieur (x positifs pour la main gauche)
    if vx < 0:
        vx, vy = -vx, -vy
    s = 0.95 * g["main"]
    top = -0.08 if g["manches"] == "longues" else -0.05
    loc = [(top, -0.15), (0.12, -0.17), (0.34, -0.18), (0.55, -0.14), (0.66, -0.05), (0.66, 0.06), (0.56, 0.13), (0.4, 0.15),
           (0.33, 0.2), (0.3, 0.27), (0.2, 0.28), (0.1, 0.21), (top, 0.15)]
    P = [(Wr[0] + (u * ux + v * vx) * s, Wr[1] + (u * uy + v * vy) * s) for u, v in loc]
    f.blob(P, g["skin"])                                   # une seule forme : remplie et cernee, ses points se tirent d'un coup
    q = [(Wr[0] + (u * ux + v * vx) * s, Wr[1] + (u * uy + v * vy) * s) for u, v in [(0.36, 0.14), (0.42, 0.06), (0.47, 0.03)]]
    f.line(q, sw=SWD * 0.8)


# ------------------------------------------------------------------------------------------------ jambes
def jambes(g):
    f = Forms("j")
    bas = g["bas"]
    j, hp, t = g["jambe"], g["hanches"], g["T"]
    y_w, y_cr, y_an = g["y_w"], g["y_cr"], g["y_an"]
    top = min(y_w, 1.35) - 0.5                              # le haut remonte sous le torse (melange de gabarits)
    knee_y = y_cr + (y_an - y_cr) * 0.48
    ac, aw = g["ankle_c"], g["ankle_w"]
    kc = (j * 0.8 + ac) / 2 + 0.02
    kw = j * 0.74

    def leg_side(wk, wa, y_end):
        """Cote gauche d'une jambe : de la hanche a la cheville puis remontee par l'interieur (demi-largeurs wk, wa)."""
        yk = knee_y if y_end > knee_y + 0.1 else (y_cr + y_end) / 2
        ce = ac if y_end >= y_an - 0.05 else kc + (ac - kc) * (y_end - yk) / max(0.1, (y_an - yk))
        we = wa if y_end >= y_an - 0.05 else wk + (wa - wk) * (y_end - yk) / max(0.1, (y_an - yk))
        return [(-(hp * 1.0), y_w + 0.42), (-(kc + wk), yk), (-(ce + we), y_end), (-(ce + we), y_end), (-(ce - we), y_end), (-(ce - we), y_end),
                (-(kc - wk), yk), (-0.04, y_cr + 0.2), (0, y_cr), (0, y_cr)]

    if bas in ("pantalon", "jean", "salopette"):
        wide = 1.12 if bas == "pantalon" else 1.0
        left = [(-t * 1.0, top), (-max(t, hp * 0.95), y_w + 0.15)] + leg_side(kw * wide, aw * (1.25 if bas == "pantalon" else 1.1), y_an + 0.06)
        f.blob(left[:-1] + list(reversed(mir(left[:-1]))), g["c_bas"])
        f.line([(-0.02, y_w + 0.14), (-0.06, y_cr - 0.12), (0, y_cr - 0.04)], sw=SWD)
        if bas == "jean":
            f.pair(lambda F, sg: F.line([(sg * hp * 0.9, y_w + 0.18), (sg * hp * 0.55, y_w + 0.36), (sg * hp * 0.45, y_w + 0.16)], stroke="#d9a441", sw=SWD * 0.7))
        else:
            f.pair(lambda F, sg: F.line([(sg * kc, knee_y - 0.5), (sg * kc, knee_y + 0.4)], sw=SWD * 0.6))
        return f.shapes
    # jambes nues sous un short, une jupe, une robe
    f.pair(lambda F, sg: F.blob([(-(kc + j * 0.98), y_cr - 0.1), (-(kc + kw * 1.0), knee_y), (-(kc + kw * 0.8), knee_y + 0.35),
                                 (-(ac + aw), y_an + 0.06), (-(ac + aw), y_an + 0.06), (-(ac - aw), y_an + 0.06), (-(ac - aw), y_an + 0.06),
                                 (-(kc - kw * 0.9), knee_y + 0.3), (-(kc - kw), knee_y), (-0.02, y_cr - 0.1)], g["skin"]))
    if bas in ("short", "bermuda"):
        y_end = y_cr + (0.42 if bas == "short" else 0.95)
        wk2 = j * (1.08 if bas == "short" else 0.95)
        left = [(-t * 1.0, top), (-max(t, hp * 0.95), y_w + 0.15), (-(hp * 1.04), y_w + 0.42), (-(kc + wk2 + 0.04), y_end), (-(kc + wk2 + 0.04), y_end),
                (-(kc - wk2 * 0.92), y_end), (-(kc - wk2 * 0.92), y_end), (-0.03, y_cr + 0.1), (0, y_cr - 0.02)]
        f.blob(left[:-1] + [(0, y_cr - 0.02)] + list(reversed(mir(left[:-1]))), g["c_bas"])
        f.line([(-0.02, y_w + 0.14), (-0.05, y_cr - 0.12), (0, y_cr - 0.06)], sw=SWD)
        if bas == "bermuda":
            f.pair(lambda F, sg: F.blob([(sg * (hp * 0.98), y_cr + 0.15), (sg * (hp * 1.0), y_cr + 0.42), (sg * (hp * 0.72), y_cr + 0.45),
                                         (sg * (hp * 0.7), y_cr + 0.15)], _shade(g["c_bas"], 0.9), sw=SWD))
        return f.shapes
    # jupes et robes
    y_end = {"jupe": knee_y + 0.15, "jupe-longue": y_an - 0.45, "robe": knee_y + 0.05, "robe-courte": y_cr + 0.4}[bas]
    flare = {"jupe": 0.22, "jupe-longue": 0.35, "robe": 0.32, "robe-courte": 0.2}[bas]
    w_end = max(hp, t) * 1.04 + flare * (y_end - y_w)
    left = [(-t * 1.0, top), (-max(t, hp * 0.9), y_w + 0.1), (-hp * 1.05, y_w + 0.45), (-w_end, y_end), (-w_end, y_end), (-w_end * 0.5, y_end + 0.06)]
    pts = left + [(0, y_end + 0.07)] + list(reversed(mir(left)))
    f.blob(pts, g["c_bas"])
    if bas in ("jupe", "jupe-longue"):
        f.pair(lambda F, sg: F.line([(sg * hp * 0.5, y_w + 0.5), (sg * w_end * 0.55, y_end + 0.02)], sw=SWD * 0.7))
    else:
        f.pair(lambda F, sg: F.line([(sg * hp * 0.3, y_w + 0.6), (sg * w_end * 0.35, y_end + 0.04)], sw=SWD * 0.7))
    return f.shapes


# ------------------------------------------------------------------------------------------------ chaussures
def chaussures(g):
    f = Forms("c")
    f.pair(_pied1, g)
    return f.shapes


def _pied1(f, sg, g):
    ac, aw, ya = g["ankle_c"], g["ankle_w"], g["y_an"]
    kind, col, sole = g["pieds"], g["c_pieds"], g["c_semelle"]
    w = max(0.15, aw * 1.45) * (0.85 if kind == "escarpins" else 1.0)
    cx = -ac - 0.03
    if kind == "escarpins":                               # petit soulier pointu, le cou-de-pied nu
        f.blob([(cx - w * 0.85, ya + 0.06), (cx - w * 1.0, ya + 0.24), (cx - w * 0.65, ya + 0.36), (cx - w * 0.1, ya + 0.4), (cx + w * 0.55, ya + 0.36),
                (cx + w * 0.85, ya + 0.22), (cx + w * 0.75, ya + 0.06), (cx + w * 0.2, ya + 0.12), (cx - w * 0.35, ya + 0.12)], col)
        f.blob([(cx - w * 0.12, ya + 0.36), (cx - w * 0.18, ya + 0.44), (cx + w * 0.18, ya + 0.44), (cx + w * 0.12, ya + 0.36)], sole, sw=SWD)
        return
    tall = 0.75 if kind == "bottes" else 0.0
    top = ya - 0.06 - tall
    toe = 0.34 if kind != "baskets" else 0.36
    sole_h = 0.07 if kind != "baskets" else 0.09
    up = [(cx - w * 0.92, top), (cx - w * 0.95, ya + 0.06), (cx - w * 1.12, ya + 0.16), (cx - w * 1.15, ya + toe), (cx - w * 1.15, ya + toe),
          (cx + w * 1.05, ya + toe), (cx + w * 1.05, ya + toe), (cx + w * 1.05, ya + 0.15), (cx + w * 0.92, ya + 0.06), (cx + w * 0.92, top)]
    if kind == "bottes":
        up[0] = (cx - w * 1.0, top)
        up[-1] = (cx + w * 1.0, top)
    f.blob(up, col if kind != "baskets" else "#f4f2ee")
    f.blob([(cx - w * 1.18, ya + toe - sole_h), (cx - w * 1.2, ya + toe + 0.03), (cx + w * 1.1, ya + toe + 0.03), (cx + w * 1.08, ya + toe - sole_h)],
           sole if kind != "baskets" else col, sw=SWD)
    if kind == "baskets":
        for k in range(3):
            y = ya + 0.02 + k * 0.05
            f.line([(cx - w * 0.45, y), (cx + w * 0.45, y + 0.015)], sw=SWD * 0.7)
        f.line([(cx - w * 0.9, ya + 0.12), (cx - w * 0.2, ya + 0.2), (cx + w * 0.85, ya + 0.12)], stroke=col, sw=SWD)
    elif kind == "bottes":
        f.line([(cx - w * 0.95, ya - 0.05), (cx, ya - 0.02), (cx + w * 0.95, ya - 0.05)], sw=SWD * 0.7)
    else:
        f.line([(cx - w * 0.4, ya + 0.04), (cx + w * 0.35, ya + 0.04)], sw=SWD * 0.7)


# ------------------------------------------------------------------------------------------------ accessoires
ACCESSOIRES = [
    ("cravate", "Cravate", lambda f: (f.blob([(-0.07, 0.3), (-0.09, 0.42), (0, 0.47), (0.09, 0.42), (0.07, 0.3)], "#8c2f2f"),
                                      f.blob([(-0.05, 0.44), (-0.13, 1.45), (0, 1.62), (0.13, 1.45), (0.05, 0.44)], "#8c2f2f"),
                                      f.line([(-0.08, 0.9), (0.09, 1.02)], sw=SWD * 0.6))),
    ("noeud-papillon", "Nœud papillon", lambda f: (f.blob([(-0.04, 0.33), (-0.24, 0.24), (-0.26, 0.31), (-0.26, 0.46), (-0.24, 0.52), (-0.04, 0.43)], "#232328"),
                                                  f.blob([(0.04, 0.33), (0.24, 0.24), (0.26, 0.31), (0.26, 0.46), (0.24, 0.52), (0.04, 0.43)], "#232328"),
                                                  f.ellipse(0, 0.38, 0.06, 0.07, "#232328"))),
    ("ceinture", "Ceinture", lambda f: (f.blob([(-0.7, 1.84), (-0.7, 1.84), (-0.72, 1.98), (-0.72, 1.98), (0.72, 1.98), (0.72, 1.98), (0.7, 1.84), (0.7, 1.84)], "#3b2a1e"),
                                        f.blob([(-0.1, 1.8), (-0.1, 1.8), (-0.1, 2.02), (-0.1, 2.02), (0.1, 2.02), (0.1, 2.02), (0.1, 1.8), (0.1, 1.8)], "#d8b54a", sw=SWD))),
    ("echarpe", "Écharpe", lambda f: (f.blob([(-0.52, 0.38), (-0.5, 0.22), (-0.2, 0.12), (0.2, 0.12), (0.5, 0.22), (0.52, 0.38), (0.4, 0.52), (0, 0.58),
                                              (-0.4, 0.52)], "#c0392b"),
                                      f.blob([(0.12, 0.45), (0.1, 1.3), (0.12, 1.3), (0.4, 1.28), (0.42, 1.28), (0.38, 0.42)], "#c0392b"),
                                      f.line([(0.12, 1.2), (0.4, 1.18)], sw=SWD * 0.7))),
    ("bretelles", "Bretelles", lambda f: f.pair(lambda F, sg: F.blob([(sg * 0.62, 0.3), (sg * 0.48, 0.28), (sg * 0.34, 1.9), (sg * 0.46, 1.92)], "#7a2430", sw=SWD))),
    ("sac-bandouliere", "Sac en bandoulière", lambda f: (f.blob([(-0.72, 0.32), (-0.62, 0.26), (0.66, 1.95), (0.58, 2.02)], "#5a3d28", sw=SWD),
                                                         f.blob([(0.5, 1.9), (0.5, 1.9), (0.52, 2.55), (0.52, 2.55), (1.22, 2.55), (1.22, 2.55), (1.2, 1.9), (1.2, 1.9)], "#8a5a36"),
                                                         f.blob([(0.5, 1.9), (0.5, 1.9), (0.51, 2.2), (0.85, 2.26), (1.21, 2.2), (1.2, 1.9), (1.2, 1.9)], "#734a2c", sw=SWD))),
    ("sac-a-main", "Sac à main", lambda f: (f.line([(0.9, 2.62), (0.95, 2.4), (1.15, 2.36), (1.3, 2.4), (1.32, 2.62)], sw=SW),
                                            f.blob([(0.78, 2.6), (0.78, 2.6), (0.72, 3.05), (0.72, 3.05), (1.48, 3.05), (1.48, 3.05), (1.42, 2.6), (1.42, 2.6)], "#a8323a"),
                                            f.ellipse(1.1, 2.72, 0.05, 0.04, "#d8b54a"))),
    ("collier", "Collier", lambda f: (f.line([(-0.3, 0.3), (-0.22, 0.6), (0, 0.72), (0.22, 0.6), (0.3, 0.3)], stroke="#d8b54a", sw=SWD),
                                      f.ellipse(0, 0.78, 0.06, 0.07, "#d8b54a"))),
    ("sac-a-dos", "Bretelles de sac à dos", lambda f: f.pair(lambda F, sg: F.blob([(sg * 0.7, 0.32), (sg * 0.5, 0.28), (sg * 0.52, 1.3), (sg * 0.68, 1.42), (sg * 0.86, 1.4)],
                                                                                     "#2f5d50", sw=SW))),
    ("badge", "Badge", lambda f: (f.blob([(0.36, 0.75), (0.36, 0.75), (0.36, 1.0), (0.36, 1.0), (0.7, 1.0), (0.7, 1.0), (0.7, 0.75), (0.7, 0.75)], "#ffffff", sw=SWD),
                                  f.line([(0.42, 0.85), (0.64, 0.85)], sw=SWD * 0.7), f.line([(0.42, 0.92), (0.58, 0.92)], sw=SWD * 0.7))),
]


# ------------------------------------------------------------------------------------------------ assemblage
ORDRE = [("jambes", "Jambes et bas"), ("chaussures", "Chaussures"), ("torse", "Torse et haut"), ("bras", "Bras"), ("mains", "Mains")]


def construire(gid, nom, kw):
    g = cotes(kw)
    pieces = {"jambes": jambes(g), "chaussures": chaussures(g), "torse": torse(g), "bras": bras(g), "mains": mains(g)}
    tag = TAGS.get(gid, gid.replace("-", " "))
    out = {}
    names = {"torse": "%s (%s)" % (NOMS_HAUT[g["haut"]], tag), "bras": "%s (%s)" % (NOMS_MANCHES[g["manches"]], tag),
             "mains": "Mains (%s)" % tag, "jambes": "%s (%s)" % (NOMS_BAS[g["bas"]], tag),
             "chaussures": "%s (%s)" % (NOMS_PIEDS[g["pieds"]], tag)}
    for cat, label in ORDRE:
        out[cat] = (names[cat], [{"id": "L" + cat[:3], "name": label, "shapes": _relabel(pieces[cat], "%s-%s" % (gid, cat[:3]))}])
    out["silhouette"] = (nom, [{"id": "L" + c[:3], "name": label, "shapes": _relabel(pieces[c], "%s-s%s" % (gid, c[:3]))} for c, label in ORDRE])
    return out


def _relabel(shapes, pre):
    return [dict(s, id="%s%d" % (pre, i)) for i, s in enumerate(shapes)]


# ------------------------------------------------------------------------------------------------ rendu (meme geometrie que draw.js)
SS = 2


def _curve(sh):
    P = [(x * W * SS, y * H * SS) for x, y in sh["p"]]
    t = sh["t"]
    if t == "ellipse":
        (x0, y0), (x1, y1) = P
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2
        return [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 64, endpoint=False)], True
    out = [P[0]]
    cur = P[0]
    for i in range(1, len(P) - 1):
        c, e = P[i], ((P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2)
        for k in range(1, 13):
            s = k / 12
            out.append(((1 - s) ** 2 * cur[0] + 2 * (1 - s) * s * c[0] + s * s * e[0], (1 - s) ** 2 * cur[1] + 2 * (1 - s) * s * c[1] + s * s * e[1]))
        cur = e
    out.append(P[-1])
    return out, t == "blob"


def rendre(layers):
    im = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for lay in layers:
        if lay.get("hidden"):
            continue
        for sh in lay["shapes"]:
            pts, closed = _curve(sh)
            if len(pts) < 2:
                continue
            if closed and sh.get("fon"):
                d.polygon(pts, fill=sh["col"])
            if sh.get("stroke", "none") != "none" and sh.get("sw", 0) > 0:
                w = max(1, round(sh["sw"] * 4 * SS))
                line = pts + [pts[0]] if closed else pts
                d.line(line, fill=sh["stroke"], width=w, joint="curve")
                r = w / 2
                for x, y in ([pts[0], pts[-1]] if not closed else []):
                    d.ellipse([x - r, y - r, x + r, y + r], fill=sh["stroke"])
    return im.resize((W, H), Image.LANCZOS)


# ------------------------------------------------------------------------------------------------ ecriture dans la banque
CATS = ("silhouette", "torse", "bras", "mains", "jambes", "chaussures", "accessoires")


def tous():
    """[(categorie, id, nom, calques)] de toute la banque, dans l'ordre d'affichage."""
    rows = []
    built = [(gid, construire(gid, nom, kw)) for gid, nom, kw in GABARITS]
    for cat in CATS[:-1]:
        for gid, b in built:
            nm, lays = b[cat]
            rows.append((cat, gid, nm, lays))
    for aid, nm, fn in ACCESSOIRES:
        f = Forms(aid[:3])
        fn(f)
        rows.append(("accessoires", aid, nm, [{"id": "Lacc", "name": "Calque 1", "shapes": _relabel(f.shapes, aid + "-")}]))
    return rows


def _anciens(cat):
    """Identifiants des anciens elements (corps encres, decoupes) : les compositions enregistrees les retrouvent par l'id."""
    d = parts.ROOT / ("_corps" if cat == "silhouette" else "_corps-claude/" + cat)
    return {f.stem for f in d.glob("*.png")} if d.is_dir() else set()


def ecrire(refaire=False, seul=None, log=print):
    from . import partbanks
    n = 0
    for cat, pid, nm, lays in tous():
        if seul and pid not in seul:
            continue
        d = ROOT / cat
        if pid in _anciens(cat):                          # pas l'identifiant d'un corps encre ou d'une de ses decoupes
            raise ValueError("identifiant deja pris par un ancien element : %s/%s" % (cat, pid))
        if (d / (pid + ".png")).exists() and not refaire:
            continue
        im = rendre(lays)
        partbanks._store(im, d, pid, {"name": nm, "kit": "corps", "fill": False, "vec": 1}, partbanks.FRAMES["corps"], fill=False)
        partbanks.save_meta(partbanks.CLAUDE, cat, pid, {"layers": lays, "under": None, "pair": False, "fill": False})
        n += 1
        log("  %s / %s : %s" % (cat, pid, nm))
    return n


def planche(sortie, cat="silhouette", cols=7, cell=(260, 520)):
    """Planche de controle d'une categorie : chaque element a sa place dans le cadre, sur un fond colore (les trous se voient)."""
    rows = [r for r in tous() if r[0] == cat]
    nrow = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell[0], nrow * cell[1]), (120, 190, 170))
    for i, (_, pid, nm, lays) in enumerate(rows):
        im = rendre(lays).resize(cell, Image.LANCZOS)
        x, y = (i % cols) * cell[0], (i // cols) * cell[1]
        sheet.paste(im, (x, y), im)
        ImageDraw.Draw(sheet).text((x + 6, y + 6), pid, fill=(0, 0, 0))
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(sortie, quality=88)
    return sortie


def melange(sortie, n=8, seed=3):
    """Planche de corps melanges (torse, bras, mains d'un gabarit ; jambes, chaussures d'un autre), pour voir les raccords."""
    rnd = random.Random(seed)
    built = {gid: construire(gid, nom, kw) for gid, nom, kw in GABARITS}
    ids = list(built)
    cell = (260, 520)
    sheet = Image.new("RGB", (n * cell[0], cell[1]), (120, 190, 170))
    for i in range(n):
        a, b = rnd.choice(ids), rnd.choice(ids)
        lays = built[b]["jambes"][1] + built[b]["chaussures"][1] + built[a]["torse"][1] + built[a]["bras"][1] + built[a]["mains"][1]
        im = rendre(lays).resize(cell, Image.LANCZOS)
        sheet.paste(im, (i * cell[0], 0), im)
        ImageDraw.Draw(sheet).text((i * cell[0] + 6, 6), "%s / %s" % (a, b), fill=(0, 0, 0))
    sheet.save(sortie, quality=88)
    return sortie
