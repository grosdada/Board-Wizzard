"""Corps du portrait-robot, traces par le calcul dans le meme trait que les tetes (app/partsdraw.py).

Un corps est vu de face, debout, bras le long du corps un peu ecartes. Il est dessine dans un cadre de 1000 x 1900 dont
l'unite est la hauteur de tete U : le bas du menton est en (500, CHIN), le sol vers CHIN + 5,6 U. Chaque corps = une
carrure (largeurs) + une tenue (ce qui est dessine par-dessus). Le cou monte derriere le menton : la tete est posee
par-dessus, ce qui cache le raccord.

  corps(seed, **cotes) -> (image RGBA rognee, place = [cx, cy, largeur] dans le cadre 1000 x 1900)
  CORPS_VARIANTES      -> [(nom, cotes)]
  personnage(tete, cotes) -> image RGBA d'un personnage entier (tete = image du visage dans le cadre 1000 x 1300)
"""
import math

import numpy as np
from PIL import Image

from .partsdraw import CX, Canvas, smooth

W, H = 1000, 2000
U = 285.0                                        # hauteur de tete (du sommet du crane au menton)
CHIN = 450.0                                     # bas du menton
HEAD_SCALE = 1.32 * U / 730.0                    # tete un peu grosse, facon dessin : le visage reste lisible ; la tete de reference fait 730 de haut                          # la tete de reference fait 730 de haut dans le cadre des visages (150 a 880)

CORPS = dict(
    ep=1.05,          # demi-largeur des epaules (en U)
    taille=0.62,      # demi-largeur a la taille
    hanches=0.72,     # demi-largeur aux hanches
    cou=0.26,         # demi-largeur du cou
    bras=0.19,        # epaisseur d'un bras (demi)
    jambe=0.27,       # epaisseur d'une cuisse (demi)
    ventre=0.0,       # ventre : elargit la taille et l'arrondit
    buste=1.9,        # longueur du menton a la ceinture
    jambes=2.6,       # longueur de la ceinture aux chevilles
    haut="tshirt",    # tshirt | chemise | veste | sweat | debardeur | pull | blouse
    bas="pantalon",   # pantalon | short | jupe | robe | salopette
    manches="courtes",  # courtes | longues | sans
    pieds="chaussures",  # chaussures | bottes | baskets
    trait=5.0)


def _tube(c, pts, widths, w=5.0, cap=True):
    """Membre : blanc dessous, un trait de chaque cote, le long d'une ligne d'epaisseur variable."""
    cl = smooth(pts, n=10)
    ws = np.interp(np.linspace(0, 1, len(cl)), np.linspace(0, 1, len(widths)), widths)
    a, b = [], []
    for i, q in enumerate(cl):
        t = cl[min(len(cl) - 1, i + 1)] - cl[max(0, i - 1)]
        n = np.array([-t[1], t[0]]) / (np.hypot(*t) or 1)
        a.append(tuple(q + n * ws[i]))
        b.append(tuple(q - n * ws[i]))
    c.white(a + b[::-1], curved=False)
    c.line(a, w, ends=(0.8, 0.8), straight=True, wob=1.0)
    c.line(b, w, ends=(0.8, 0.8), straight=True, wob=1.0)
    if cap:
        c.line([a[-1], b[-1]], w * 0.9, ends=(1, 1), straight=True, wob=0.4)
    return a, b


def corps(seed=1, **kw):
    p = dict(CORPS, **kw)
    c = Canvas(seed, W, H)
    u = U
    tr = p["trait"]
    X = lambda dx: CX + dx * u
    Y = lambda dy: CHIN + dy * u
    ep, ta, ha = p["ep"], p["taille"] + p["ventre"], p["hanches"] + p["ventre"] * 0.6
    y_ep, y_ais = 0.42, 0.95                       # epaules, aisselles
    y_ta = p["buste"] * 0.78                       # taille
    y_ce = p["buste"]                              # ceinture
    y_ent = y_ce + 0.75                            # entrejambe
    y_ch = y_ce + p["jambes"]                      # chevilles
    y_ge = y_ce + p["jambes"] * 0.52               # genoux
    robe = p["bas"] == "robe"
    jupe = p["bas"] in ("jupe", "robe")

    # ---- jambes et pieds (derriere tout le reste)
    lj = p["jambe"]
    nu = jupe or p["bas"] == "short"
    for sg in (-1, 1):
        hip = (X(sg * ha * 0.5), Y(y_ent - 0.35))
        knee = (X(sg * (ha * 0.46)), Y(y_ge))
        ankle = (X(sg * (ha * 0.42)), Y(y_ch))
        k = 0.82 if nu else 1.0
        _tube(c, [hip, knee, ankle], [lj * u * k, lj * u * 0.72 * k, lj * u * (0.42 if nu else 0.62)], tr, cap=not nu)
        if p["bas"] == "short":                    # bas du short
            ys = Y(y_ent + 0.55)
            c.line([(X(sg * (ha * 0.49) - lj * 0.8), ys), (X(sg * (ha * 0.49) + lj * 0.8), ys)], tr, ends=(1, 1), straight=True, wob=0.5)
        # le pied : tourne un peu vers l'exterieur
        fx, fy = ankle
        L = 0.62 * u if p["pieds"] != "bottes" else 0.58 * u
        hh = (0.2 if p["pieds"] != "bottes" else 0.3) * u
        foot = [(fx - sg * 0.2 * u, fy - 4), (fx + sg * 0.16 * u, fy - 4), (fx + sg * L * 0.72, fy + hh * 0.35), (fx + sg * L * 0.78, fy + hh),
                (fx - sg * 0.24 * u, fy + hh)]
        c.white(foot)
        c.line(foot + foot[:1], tr, ends=(1, 1), wob=0.8)
        if p["pieds"] == "baskets":
            c.line([(fx - sg * 0.22 * u, fy + hh * 0.62), (fx + sg * L * 0.76, fy + hh * 0.66)], tr * 0.6, ends=(0.5, 0.5), straight=True, wob=0.4)
        if p["pieds"] == "bottes":
            c.line([(fx - lj * u * 0.66, fy - 0.55 * u), (fx + lj * u * 0.66, fy - 0.55 * u)], tr, ends=(1, 1), straight=True, wob=0.5)

    # ---- cou
    co = p["cou"]
    neck = [(X(-co), Y(-0.5)), (X(-co * 1.05), Y(y_ep - 0.16)), (X(co * 1.05), Y(y_ep - 0.16)), (X(co), Y(-0.5))]
    c.white(neck, curved=False)
    c.line(neck[:2], tr * 0.9, ends=(1, 0.6), straight=True, wob=0.6)
    c.line(neck[2:][::-1], tr * 0.9, ends=(0.6, 1), straight=True, wob=0.6)

    # ---- bas du corps : pantalon (bassin), jupe ou robe
    if jupe:
        hem_y = y_ge + (0.25 if robe else -0.05)
        hw = ha * (1.35 if robe else 1.2)
        skirt = [(X(-ta), Y(y_ta)), (X(-ha), Y(y_ce + 0.3)), (X(-hw), Y(hem_y)), (X(hw), Y(hem_y)), (X(ha), Y(y_ce + 0.3)), (X(ta), Y(y_ta))]
        c.white(skirt, curved=False)
        c.line(skirt[:3], tr, ends=(1, 1), wob=1.0)
        c.line(skirt[3:], tr, ends=(1, 1), wob=1.0)
        c.line([skirt[2], (X(0), Y(hem_y + 0.05)), skirt[3]], tr, ends=(1, 1), wob=1.0)
    else:
        pelvis = [(X(-ta), Y(y_ta)), (X(-ha), Y(y_ce + 0.25)), (X(-ha * 0.98), Y(y_ent - 0.1)), (X(0), Y(y_ent)), (X(ha * 0.98), Y(y_ent - 0.1)),
                  (X(ha), Y(y_ce + 0.25)), (X(ta), Y(y_ta))]
        c.white(pelvis, curved=False)
        c.line(pelvis[:3], tr, ends=(1, 0.8), wob=1.0)
        c.line(pelvis[4:], tr, ends=(0.8, 1), wob=1.0)
        c.line([(X(0), Y(y_ce + 0.1)), (X(0), Y(y_ent))], tr * 0.7, ends=(0.4, 0.8), straight=True, wob=0.6)                    # braguette
        c.line([(X(-ta * 1.02), Y(y_ce)), (X(0), Y(y_ce + 0.04)), (X(ta * 1.02), Y(y_ce))], tr, ends=(1, 1), wob=0.8)          # ceinture

    # ---- torse
    vent = p["ventre"]
    side = [(X(co * 1.3), Y(y_ep - 0.2)), (X(ep * 0.7), Y(y_ep - 0.07)), (X(ep * 0.95), Y(y_ep + 0.08)), (X(ep * 1.0), Y(y_ep + 0.34)), (X(ep * 0.9), Y(y_ais)),
            (X(ta * (0.96 + vent * 0.5)), Y(y_ta - 0.25)), (X(ta), Y(y_ta)), (X(ta * 1.04 if not robe else ta), Y(y_ce + (0.08 if not robe else -0.05)))]
    left = [(2 * CX - x, y) for x, y in side]
    def soft(pts):                                 # coins arrondis, sans depassement
        out = [pts[0]]
        for a_, b_, c_ in zip(pts[:-2], pts[1:-1], pts[2:]):
            a2, b2, c2 = np.array(a_), np.array(b_), np.array(c_)
            out += [tuple(b2 + (a2 - b2) * 0.22), tuple(b2 + (a2 - b2) * 0.06 + (c2 - b2) * 0.06), tuple(b2 + (c2 - b2) * 0.22)]
        return out + [pts[-1]]
    side_s, left_s = soft(side), soft(left)
    c.white(side_s + left_s[::-1], curved=False)
    c.line(side_s[2:], tr, ends=(1, 1), straight=True, wob=1.0)
    c.line(left_s[2:], tr, ends=(1, 1), straight=True, wob=1.0)
    c.line([side[0], side[1]], tr, ends=(1, 1), straight=True, wob=0.5)
    c.line([left[0], left[1]], tr, ends=(1, 1), straight=True, wob=0.5)
    # ---- bras (par-dessus le bord du torse : l'epaule reste ronde)
    lb = p["bras"]
    for sg in (-1, 1):
        sh = (X(sg * (ep - lb * 0.95)), Y(y_ep + 0.3))
        el = (X(sg * (ep + 0.02 + p["ventre"] * 0.4)), Y(y_ta + 0.1))
        wr = (X(sg * (ep + 0.1 + p["ventre"] * 0.5)), Y(y_ce + 0.62))
        _tube(c, [sh, el, wr], [lb * u * 1.12, lb * u * 0.9, lb * u * 0.62], tr, cap=p["manches"] == "longues")
        hand = [(wr[0] - lb * u * 0.62, wr[1] - 2), (wr[0] + lb * u * 0.62, wr[1] - 2), (wr[0] + lb * u * 0.74 + sg * 6, wr[1] + 0.2 * u),
                (wr[0] + sg * 5, wr[1] + 0.44 * u), (wr[0] - lb * u * 0.72 + sg * 6, wr[1] + 0.22 * u)]
        c.white(hand)
        c.line(hand + hand[:1], tr * 0.85, ends=(1, 1), wob=0.8)
        c.line([(wr[0] - sg * lb * u * 0.2, wr[1] + 0.18 * u), (wr[0] - sg * lb * u * 0.12, wr[1] + 0.34 * u)], tr * 0.5, ends=(0.3, 0.3))   # pouce
        if p["manches"] == "courtes":              # bas de manche
            t = 0.42
            mx, my = sh[0] + (el[0] - sh[0]) * t, sh[1] + (el[1] - sh[1]) * t
            c.line([(mx - lb * u * 1.15, my - sg * 6), (mx + lb * u * 1.15, my + sg * 6)], tr, ends=(1, 1), straight=True, wob=0.4)

    haut = p["haut"]
    if not robe and haut not in ("veste",):
        c.line([left[-1], (X(0), Y(y_ce + 0.12)), side[-1]], tr, ends=(1, 1), wob=0.8)                                        # bas du vetement
    # encolure et details
    if haut in ("tshirt", "pull", "sweat") or robe:
        c.line([(X(-co * 1.3), Y(y_ep - 0.2)), (X(0), Y(y_ep + (0.06 if haut != "tshirt" else 0.02))), (X(co * 1.3), Y(y_ep - 0.2))], tr * 0.9, ends=(1, 1), wob=0.5)
    if haut == "debardeur":
        c.line([(X(-co * 1.5), Y(y_ep - 0.18)), (X(0), Y(y_ep + 0.3)), (X(co * 1.5), Y(y_ep - 0.18))], tr * 0.9, ends=(1, 1), wob=0.5)
    if haut == "sweat":                            # capuche derriere le cou, cordons, poche ventrale
        for sg in (-1, 1):
            c.line([(X(sg * co * 1.3), Y(y_ep - 0.2)), (X(sg * co * 2.1), Y(y_ep - 0.42)), (X(sg * co * 1.2), Y(-0.38))], tr * 0.9, ends=(1, 0.6), wob=0.6)
            c.line([(X(sg * 0.08), Y(y_ep + 0.06)), (X(sg * 0.1), Y(y_ep + 0.5))], tr * 0.5, ends=(0.6, 0.6), straight=True, wob=0.4)
        c.line([(X(-ta * 0.6), Y(y_ta + 0.05)), (X(-ta * 0.45), Y(y_ta - 0.3)), (X(ta * 0.45), Y(y_ta - 0.3)), (X(ta * 0.6), Y(y_ta + 0.05))], tr * 0.7, ends=(0.6, 0.6), straight=True, wob=0.5)
    if haut in ("chemise", "blouse", "veste"):     # col en V et boutonnage
        v = y_ep + (0.75 if haut == "veste" else 0.3)
        for sg in (-1, 1):
            c.line([(X(sg * co * 1.3), Y(y_ep - 0.2)), (X(sg * co * 0.9), Y(y_ep + 0.12)), (X(0), Y(v))], tr * 0.9, ends=(1, 0.8), wob=0.5)
            if haut == "chemise":                  # pointes du col
                c.line([(X(sg * co * 1.3), Y(y_ep - 0.2)), (X(sg * co * 1.7), Y(y_ep + 0.14)), (X(sg * co * 0.9), Y(y_ep + 0.12))], tr * 0.7, ends=(0.8, 0.8), wob=0.4)
        if haut == "veste":                        # revers, chemise dessous, boutons, pans
            for sg in (-1, 1):
                c.line([(X(sg * co * 0.9), Y(y_ep + 0.12)), (X(sg * ep * 0.5), Y(y_ep + 0.5)), (X(0), Y(v))], tr * 0.8, ends=(0.8, 0.8), wob=0.5)
            c.line([(X(0), Y(v)), (X(0.02), Y(y_ce + 0.2))], tr * 0.8, ends=(0.8, 0.8), straight=True, wob=0.5)
            for i in range(2):
                c.disc(X(0.07), Y(v + 0.28 + i * 0.36), 6)
            c.line([left[-1], (X(-ta * 0.5), Y(y_ce + 0.32)), (X(0.02), Y(y_ce + 0.2)), (X(ta * 0.5), Y(y_ce + 0.32)), side[-1]], tr, ends=(1, 1), wob=0.8)
            c.line([(X(-0.06), Y(y_ep + 0.14)), (X(0), Y(y_ep + 0.3)), (X(0.06), Y(y_ep + 0.14))], tr * 0.6, ends=(0.6, 0.6), wob=0.3)   # noeud de cravate
        else:
            c.line([(X(0), Y(v)), (X(0), Y(y_ce + 0.08))], tr * 0.6, ends=(0.8, 0.5), straight=True, wob=0.5)
            for i in range(4):
                c.disc(X(0.045), Y(v + 0.18 + i * (y_ce - v - 0.2) / 4), 4.5)
    if p["bas"] == "salopette":                    # bavette et bretelles
        bib = [(X(-ta * 0.6), Y(y_ce)), (X(-ta * 0.5), Y(y_ais + 0.05)), (X(ta * 0.5), Y(y_ais + 0.05)), (X(ta * 0.6), Y(y_ce))]
        c.line(bib, tr, ends=(1, 1), straight=True, wob=0.6)
        for sg in (-1, 1):
            c.line([(X(sg * ta * 0.45), Y(y_ais + 0.05)), (X(sg * ep * 0.55), Y(y_ep - 0.08))], tr * 1.6, ends=(1, 1), straight=True, wob=0.5)
            c.disc(X(sg * ta * 0.42), Y(y_ais + 0.14), 7)
    return c.result()


CORPS_VARIANTES = [
    ("Moyen, t-shirt et pantalon", {}),
    ("Mince, chemise", dict(ep=0.92, taille=0.5, hanches=0.6, bras=0.15, jambe=0.21, cou=0.22, haut="chemise", manches="longues")),
    ("Costaud, t-shirt", dict(ep=1.32, taille=0.72, hanches=0.78, bras=0.27, jambe=0.33, cou=0.34, pieds="baskets")),
    ("Rond, pull", dict(ep=1.1, taille=0.86, hanches=0.9, ventre=0.26, bras=0.24, jambe=0.33, cou=0.32, haut="pull", manches="longues")),
    ("Costume", dict(ep=1.12, taille=0.66, hanches=0.72, haut="veste", manches="longues")),
    ("Sweat à capuche, baskets", dict(ep=1.08, taille=0.7, hanches=0.74, haut="sweat", manches="longues", pieds="baskets")),
    ("Robe", dict(ep=0.86, taille=0.46, hanches=0.7, bras=0.14, jambe=0.2, cou=0.2, bas="robe", manches="sans")),
    ("Jupe et blouse", dict(ep=0.88, taille=0.48, hanches=0.74, bras=0.15, jambe=0.2, cou=0.2, haut="blouse", bas="jupe", manches="longues")),
    ("Débardeur et short", dict(ep=1.0, taille=0.6, hanches=0.7, bras=0.2, jambe=0.26, haut="debardeur", bas="short", manches="sans", pieds="baskets")),
    ("Salopette, bottes", dict(ep=1.12, taille=0.74, hanches=0.8, bras=0.23, jambe=0.3, bas="salopette", pieds="bottes")),
    ("Grand, mince, costume", dict(ep=1.0, taille=0.52, hanches=0.6, bras=0.15, jambe=0.2, cou=0.22, buste=2.0, jambes=2.85, haut="veste", manches="longues")),
    ("Petit, trapu", dict(ep=1.2, taille=0.8, hanches=0.84, ventre=0.1, bras=0.26, jambe=0.34, cou=0.34, buste=1.75, jambes=2.1, haut="chemise", manches="courtes")),
]


def encre(nom):
    """Le corps encre de la banque (data/bodies/<id>.png), ramene au cadre W x H, ou None s'il n'est pas fait."""
    from . import settings, store
    f = settings.DATA / "bodies" / (store.slug(nom) + ".png")
    if not f.exists():
        return None
    return Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)


def personnage(tete, cotes=None, seed=1, pad=40, nom=None):
    """Un personnage entier : la tete (image RGBA dans le cadre 1000 x 1300 des visages) posee sur un corps. Si le corps
    `nom` a ete encre (tools/corps.py), c'est lui qui sert, sa tete vide effacee ; sinon le corps trace. La tete est mise a
    l'echelle du corps, son menton (y = 880) sur le haut du cou. Rend l'image RGBA rognee (fond blanc sous un corps encre)."""
    s = HEAD_SCALE
    ink = encre(nom) if nom else None
    if ink is not None:
        from PIL import ImageDraw
        d = ImageDraw.Draw(ink)                    # efface l'ovale vide : la vraie tete vient par-dessus
        d.ellipse([CX - 250 * s - 26, CHIN - 730 * s - 40, CX + 250 * s + 26, CHIN - 6], fill="white")
        out = ink.convert("RGBA")
    else:
        body, place = corps(seed=seed, **(cotes or {}))
        out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        out.alpha_composite(body, (round(place[0] - body.width / 2), round(place[1] - body.height / 2)))
    head = tete.resize((round(tete.width * s), round(tete.height * s)), Image.LANCZOS)
    out.alpha_composite(head, (round(CX - 500 * s), round(CHIN - 880 * s)))
    arr = np.asarray(out)
    a = (arr[..., 3] > 24) & (arr[..., :3].min(axis=2) < 235) if ink is not None else arr[..., 3] > 24
    ys, xs = np.where(a)
    return out.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + pad), min(H, ys.max() + pad)))
