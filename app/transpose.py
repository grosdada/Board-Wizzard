"""Transposer : d'un portrait (photo ou dessin de face) vers un portrait-robot.

Le navigateur repere 478 points sur le visage (MediaPipe Face Landmarker, app/web/vendor/mediapipe) et n'envoie que ces
points : la photo ne quitte pas le poste. Ici on les ramene dans le cadre de l'atelier (1000 x 1000, tete de reference de
app/partsdraw.py), on en tire des mesures, et de ces mesures les cotes des elements traces par le calcul : les yeux a leur
ecart, le nez a sa longueur, les levres a leur epaisseur. Ce que les points ne disent pas (cheveux, barbe, lunettes,
oreilles, pli de paupiere exact) n'est pas devine ici.

  frame(points)            -> points dans le cadre de l'atelier (+ la transformation, pour y ramener la photo)
  fit(points, shapes)      -> {categorie: cotes pour partsdraw}, {"neutre": ..., "face": ...} (qualite de la pose)
"""
import math

import numpy as np

from . import partsdraw

CX = partsdraw.CX
EYE_Y = 480.0                                    # ligne des yeux de la tete de reference
REF = math.sqrt(520.0 * 400.0)                   # taille de reference : largeur aux pommettes x hauteur yeux-menton

# reperes du maillage (cote « r » = a gauche de l'image, « l » = a droite)
EYE = {"r": dict(out=33, inn=133, up=[246, 161, 160, 159, 158, 157, 173], lo=[7, 163, 144, 145, 153, 154, 155], iris=468, ring=[469, 470, 471, 472],
                 fold=[247, 30, 29, 27, 28, 56, 190]),
       "l": dict(out=263, inn=362, up=[466, 388, 387, 386, 385, 384, 398], lo=[249, 390, 373, 374, 380, 381, 382], iris=473, ring=[474, 475, 476, 477],
                 fold=[467, 260, 259, 257, 258, 286, 414])}
BROW = {"r": dict(up=[107, 66, 105, 63, 70], lo=[55, 65, 52, 53, 46]), "l": dict(up=[336, 296, 334, 293, 300], lo=[285, 295, 282, 283, 276])}   # du nez vers la tempe
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
        127, 162, 21, 54, 103, 67, 109]
LIP_UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]
LIP_LO = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
LIP_MID = [61, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 291]


def frame(points):
    """Ramene les points dans le cadre de l'atelier : yeux a l'horizontale sur la ligne des yeux, axe du visage en x = 500,
    taille normalisee (une tete longue devient haute et etroite, une tete ronde large et courte). Rend (P, M) ou M est la
    matrice 2 x 3 qui applique la meme transformation a l'image."""
    p = np.array(points, float)[:, :2]
    er = (p[33] + p[133]) / 2
    el = (p[263] + p[362]) / 2
    ang = math.atan2(el[1] - er[1], el[0] - er[0])                  # inclinaison de la tete
    c, s = math.cos(-ang), math.sin(-ang)
    R = np.array([[c, -s], [s, c]])
    q = p @ R.T
    mid = (q[33] + q[133] + q[263] + q[362]) / 4
    width = abs(q[454][0] - q[234][0])
    height = q[152][1] - mid[1]
    k = REF / math.sqrt(max(1.0, width * height))
    q = (q - mid) * k
    axis = (q[234][0] + q[454][0]) / 2 * 0.5                        # axe : entre le milieu des yeux (0) et celui des joues
    q[:, 0] += CX - axis
    q[:, 1] += EYE_Y
    M = np.zeros((2, 3))
    M[:, :2] = R * k
    M[:, 2] = -(R @ p.mean(0) * 0) - (mid * k) + np.array([CX - axis, EYE_Y])
    return q, M


def _d(a, b):
    return float(np.hypot(*(a - b)))


def _eye(P, e, side):
    """Cotes d'un oeil (side = +1 : coin externe a droite de l'image)."""
    out, inn = P[e["out"]], P[e["inn"]]
    cen = (out + inn) / 2
    w = _d(out, inn)
    up = P[e["up"]]
    lo = P[e["lo"]]
    line = lambda x: inn[1] + (out[1] - inn[1]) * (x - inn[0]) / (out[0] - inn[0] or 1)       # la droite d'un coin a l'autre
    rise = np.array([line(x) - y for x, y in up])                   # hauteur de la paupiere superieure au-dessus de cette droite
    fall = np.array([y - line(x) for x, y in lo])
    h = float(rise.max() + fall.max())
    k = int(rise.argmax())
    peak = abs(up[k][0] - inn[0]) / w
    iris = P[e["iris"]]
    r = float(np.mean([_d(P[i], iris) for i in e["ring"]]))
    fold = P[e["fold"]]
    pli = float(np.mean([line(x) - y for x, y in fold[2:5]]) - rise.max())
    return dict(cx=float(cen[0]), y=float(cen[1]), w=w, h=h, tilt=float(out[1] - inn[1]), peak=float(min(0.7, max(0.25, peak))),
                arc=float(rise.max() / max(1.0, h)), low=float(fall.max() / max(1.0, h)), iris=r, dy=float(iris[1] - (cen[1] + (fall.max() - rise.max()) / 2)),
                dx=float(iris[0] - cen[0]), pli=max(0.0, pli))


def _brow(P, b, side):
    up, lo = P[b["up"]], P[b["lo"]]
    mid = (up + lo) / 2
    a, z = mid[0], mid[-1]                                          # tete (cote nez), queue (cote tempe)
    L = _d(a, z)
    line = lambda x: a[1] + (z[1] - a[1]) * (x - a[0]) / (z[0] - a[0] or 1)
    rise = np.array([line(x) - y for x, y in mid])
    k = int(rise.argmax())
    ep = float(np.mean([_d(u, l) for u, l in zip(up[:4], lo[:4])]))
    return dict(x0=float(a[0]), y=float(a[1]), L=L, ep=ep, arc=float(max(0.0, rise.max())), pk=float(min(0.9, max(0.25, abs(mid[k][0] - a[0]) / (abs(z[0] - a[0]) or 1)))),
                tilt=float(z[1] - a[1]))


def neutral(shapes):
    """A quel point le visage est au repos (1 = neutre) et ce qui le derange, d'apres les scores d'expression."""
    s = shapes or {}
    g = lambda *n: max([s.get(k, 0.0) for k in n] or [0.0])
    smile = g("mouthSmileLeft", "mouthSmileRight")
    op = g("jawOpen")
    out = {"sourire": round(smile, 2), "bouche_ouverte": round(op, 2), "yeux_fermes": round(g("eyeBlinkLeft", "eyeBlinkRight"), 2),
           "yeux_plisses": round(g("eyeSquintLeft", "eyeSquintRight"), 2), "sourcils_fronces": round(g("browDownLeft", "browDownRight"), 2),
           "sourcils_leves": round(g("browInnerUp", "browOuterUpLeft", "browOuterUpRight"), 2), "moue": round(g("mouthPucker", "mouthFunnel"), 2)}
    out["neutre"] = round(1 - max(smile, min(1, op * 2.5), out["yeux_fermes"], out["moue"]), 2)
    return out


def pose(matrix):
    """Rotation de la tete en degres (lacet = tourne a gauche / droite, tangage = leve / baisse) depuis la matrice de pose."""
    if not matrix:
        return {"lacet": 0.0, "tangage": 0.0}
    m = np.array(matrix, float)[:3, :3]
    yaw = math.degrees(math.atan2(-m[2][0], math.hypot(m[0][0], m[1][0])))
    pitch = math.degrees(math.atan2(m[2][1], m[2][2]))
    return {"lacet": round(yaw, 1), "tangage": round(pitch, 1)}


def fit(points, shapes=None, matrix=None):
    """Les cotes de chaque element, mesurees sur le visage. Rend ({categorie: cotes}, etat)."""
    P, _ = frame(points)
    state = dict(neutral(shapes), **pose(matrix))
    smile, opened = state["sourire"], state["bouche_ouverte"]
    out = {}

    # ---- yeux
    er, el = _eye(P, EYE["r"], -1), _eye(P, EYE["l"], +1)
    squint = max(state["yeux_plisses"], smile * 0.6)                 # un sourire plisse les yeux : on rouvre un peu
    def eye_kw(e):
        return dict(w=round(e["w"], 1), h=round(e["h"] * (1 + 0.35 * squint), 1), tilt=round(e["tilt"], 1), peak=round(e["peak"], 2), arc=round(e["arc"], 2),
                    low=round(max(0.08, e["low"]), 2), iris=round(e["iris"], 1), pup=round(e["iris"] * 0.4, 1), dy=round(e["dy"], 1), dx=round(e["dx"], 1),
                    pli=round(min(34.0, max(0.0, e["pli"])), 1), y=round(e["y"], 1))
    kr, kl = eye_kw(er), eye_kw(el)
    both = {k: round((kr[k] + kl[k]) / 2, 2) for k in kr if k != "dx"}                # la paire : la moyenne des deux, sauf si l'ecart est net
    both["dx"] = 0
    both["ecart"] = round(el["cx"] - er["cx"], 1)
    diff = abs(kr["h"] - kl["h"]) > 0.3 * both["h"] or abs(kr["y"] - kl["y"]) > 8
    if diff:
        out["yeux"] = dict(kl, ecart=both["ecart"], g=kr)
    else:
        out["yeux"] = both
    out["yeux"]["_cx"] = round((el["cx"] + er["cx"]) / 2, 1)

    # ---- sourcils
    br, bl = _brow(P, BROW["r"], -1), _brow(P, BROW["l"], +1)
    lift = state["sourcils_leves"] * 14 - state["sourcils_fronces"] * 10   # ramene les sourcils a leur place de repos
    def brow_kw(b):
        return dict(y=round(b["y"] + lift, 1), L=round(b["L"], 1), ep=round(min(30.0, max(4.0, b["ep"] * 0.9)), 1), arc=round(b["arc"], 1), pk=round(b["pk"], 2),
                    tilt=round(b["tilt"], 1))
    k1, k2 = brow_kw(br), brow_kw(bl)
    sb = {k: round((k1[k] + k2[k]) / 2, 2) for k in k1}
    sb["ecart"] = round(bl["x0"] - br["x0"], 1)
    sb["_cx"] = round((bl["x0"] + br["x0"]) / 2, 1)
    out["sourcils"] = sb

    # ---- nez
    root, tip, sub = P[168], P[4], P[2]
    xs = P[[48, 64, 98, 129, 278, 294, 327, 358]][:, 0]
    wa = float(xs.max() - xs.min()) * 0.94
    ah = float(P[[64, 294]][:, 1].mean())                            # hauteur des ailes
    base = float(max(sub[1], P[[98, 327]][:, 1].mean()))
    top = float(root[1]) + 4
    bridge = float(_d(P[193], P[417])) * 0.55
    midw = float(_d(P[196], P[419])) * 0.8
    tw = float(_d(P[45], P[275])) * 1.05
    axis_x = float((P[64][0] + P[294][0]) / 2)
    out["nez"] = dict(top=round(top, 1), base=round(base, 1), wr=round(min(80, max(14, bridge)), 1), wm=round(min(90, max(18, midw)), 1),
                      tw=round(min(wa * 0.8, max(36, tw)), 1), th=round(max(26.0, (base - top) * 0.26), 1), wa=round(wa, 1),
                      ah=round(min(80.0, max(28.0, (base - ah) * 2.1 + 22)), 1),
                      drop=round(float(tip[1] - sub[1]) + 14, 1), bend=round(float(P[195][0] - (root[0] + tip[0]) / 2) * 2.0, 1), _cx=round(axis_x, 1))

    # ---- bouche
    cr, cl = P[61], P[291]
    mid_y = float((P[13][1] + P[14][1]) / 2)
    w = _d(cr, cl) * (1 - 0.22 * smile)                              # un sourire etire la bouche : on la ramene au repos
    up = float(P[13][1] - min(P[37][1], P[267][1]))
    lo = float(P[17][1] - P[14][1])
    gap = float(P[14][1] - P[13][1])                                # bouche entrouverte : les levres ne se touchent pas
    bow = float(P[0][1] - (P[37][1] + P[267][1]) / 2)
    corners = float((cr[1] + cl[1]) / 2 - mid_y)
    if smile > 0.25 or opened > 0.12:
        corners *= max(0.0, 1 - 2 * smile)
    out["bouche"] = dict(y=round(mid_y, 1), w=round(w, 1), up=round(max(2.0, up), 1), lo=round(max(2.0, lo), 1), bow=round(max(0.0, bow), 1),
                         pk=round(min(0.5, max(0.1, _d(P[37], P[267]) / max(1.0, _d(cr, cl)))), 2), coins=round(max(-14.0, min(18.0, corners)), 1),
                         tilt=round(float(cl[1] - cr[1]) / 2, 1), _cx=round(float((cr[0] + cl[0]) / 2), 1))
    state["levres_ecartees"] = round(gap, 1)

    # ---- forme du visage
    half = lambda a, b: float(abs(P[b][0] - P[a][0]))
    wc = half(234, 454)
    wf = half(127, 356) * 1.02
    jaw_y = float((P[172][1] + P[397][1]) / 2)
    wj = half(172, 397) * 1.03
    chin = float(P[152][1])
    wch = half(148, 377) * 1.25
    # angle de la machoire : entre la joue (132) et le bord du menton (150), au point 172
    def angle(a, o, b):
        v1, v2 = P[a] - P[o], P[b] - P[o]
        return math.degrees(math.acos(max(-1, min(1, float(v1 @ v2) / (np.hypot(*v1) * np.hypot(*v2) or 1)))))
    ang = (angle(132, 172, 150) + angle(361, 397, 379)) / 2
    ja = min(1.0, max(0.0, (165 - ang) / 40))
    flat = half(176, 400) / max(1.0, half(148, 377))                 # menton plat (proche de 2) ou en pointe (plus grand)
    drop = float(chin - (P[148][1] + P[377][1]) / 2)                 # de combien la pointe descend sous ses voisins
    cs = "pointu" if drop > 9 and wch < 190 else ("carre" if drop < 4.5 and wch > 190 else "rond")
    hair = float(P[10][1])
    oval = P[OVAL + OVAL[:1]]
    axis = float((P[234][0] + P[454][0]) / 2)
    profil = []
    for y in np.arange(338.0, chin - 2, 8.0):                        # demi-largeur du visage a chaque hauteur, des tempes au menton
        xs = [a_[0] + (b_[0] - a_[0]) * (y - a_[1]) / (b_[1] - a_[1]) for a_, b_ in zip(oval[:-1], oval[1:]) if (a_[1] - y) * (b_[1] - y) < 0]
        if len(xs) >= 2:
            profil.append([round(float(y), 1), round((max(xs) - min(xs)) / 2 * 1.03, 1)])
    if profil:
        wf = profil[0][1] * 2                                        # le crane continue le contour mesure, sans decrochement
    out["visage"] = dict(top=round(hair - 0.42 * (EYE_Y - hair), 1), wf=round(wf, 1), wc=round(wc, 1), wj=round(wj, 1), jy=round(min(chin - 70, jaw_y), 1),
                         wch=round(min(wj * 0.8, max(30.0, wch)), 1), chin=round(chin, 1), ja=round(ja, 2), cs=cs, profil=profil,
                         _cx=round(float((P[234][0] + P[454][0]) / 2), 1))
    return out, state


def draw(cat, kw, seed=1):
    """Trace l'element d'une categorie a ses cotes mesurees, recentre sur l'axe mesure. Rend (image, place)."""
    kw = dict(kw)
    cx = kw.pop("_cx", CX)
    im, place = partsdraw.CATEGORIES[cat][0](seed=seed, **kw)
    place = [round(place[0] + (cx - CX), 1), place[1], place[2]]
    return im, place


def contours(points):
    """Les contours mesures, dans le cadre de l'atelier, pour les superposer au portrait compose (controle)."""
    P, _ = frame(points)
    out = [P[OVAL + OVAL[:1]], P[LIP_UP], P[LIP_LO], P[LIP_MID]]
    for e in EYE.values():
        out += [P[[e["inn"]] + e["up"][::-1] + [e["out"]]] if False else P[[e["out"]] + e["up"] + [e["inn"]]], P[[e["out"]] + e["lo"] + [e["inn"]]]]
    for b in BROW.values():
        out += [P[b["up"] + b["lo"][::-1] + b["up"][:1]]]
    out += [P[[168, 6, 197, 195, 5, 4]], P[[129, 64, 98, 2, 327, 294, 358]]]
    return [c.tolist() for c in out]


# ------------------------------------------------------------------ composition d'une tete entiere
# de combien le sommet de chaque coupe depasse du crane (volume au-dessus de la tete), et largeur de pose
HAIR_TOP = {"afro": 70, "boucles": 62, "banane": 78, "crete": 96, "herisses": 80, "chignon": 150, "queue-de-cheval": 60, "tresses": 30,
            "dreadlocks": 44, "carre": 40, "longs-raides": 34, "mi-longs": 44, "ondules": 44, "frange": 44, "degarni": 6, "couronne": 10}
HAIR_W = {"carre": 700, "longs-raides": 650, "mi-longs": 720, "ondules": 720, "tresses": 640, "dreadlocks": 640, "frange": 640, "queue-de-cheval": 640,
          "afro": 660, "boucles": 640}
ORDER = ["oreilles", "visage", "barbe", "bouche", "moustache", "nez", "yeux", "sourcils", "lunettes"]


def _variant(cat, name):
    for n, kw in partsdraw.CATEGORIES[cat][1]:
        if n == name:
            return kw
    raise KeyError("%s : %s" % (cat, name))


def head(kw, extras=None, seed=1, trait=1.0):
    """Voir _head. trait : multiplicateur d'epaisseur des traits (bodydraw.HEAD_STROKE pour une tete posee sur un corps)."""
    old = partsdraw.STROKE
    partsdraw.STROKE = trait
    try:
        return _head(kw, extras, seed)
    finally:
        partsdraw.STROKE = old


def _head(kw, extras=None, seed=1):
    """La tete entiere dans le cadre 1000 x 1300 (image RGBA, fond transparent). kw : cotes mesurees par fit(). extras : ce
    que les points ne disent pas, choisi a la main ou par un regard sur la photo : {"cheveux": id de la banque, "barbe",
    "moustache", "lunettes", "oreilles": noms de variantes de partsdraw}. Les elements ajoutes suivent le visage mesure
    (lunettes sur les yeux, moustache sous le nez, barbe sur la machoire) ; le crane est cache au-dessus des cheveux."""
    from PIL import Image, ImageOps
    from . import parts
    ex = dict(extras or {})
    out = Image.new("RGBA", (partsdraw.F, partsdraw.FH), (0, 0, 0, 0))
    vis = kw["visage"]
    cxf = vis.get("_cx", CX)
    put = lambda im, pl: out.alpha_composite(im, (int(round(pl[0] - im.width / 2)), int(round(pl[1] - im.height / 2))))
    for cat in ORDER:
        if cat == "oreilles":
            ear = dict(_variant("oreilles", ex.get("oreilles") or "Moyenne"))
            hw = vis["wc"] / 2                                       # l'oreille s'attache au bord du visage, a la hauteur des yeux
            if vis.get("profil"):
                near = min(vis["profil"], key=lambda r: abs(r[0] - 520))
                hw = near[1]
            ear["x"] = CX + hw - 10
            im, pl = partsdraw.oreille(seed=seed, **ear)
            put(im, [pl[0] + (cxf - CX), pl[1], pl[2]])
            m = ImageOps.mirror(im)
            put(m, [2 * cxf - (pl[0] + (cxf - CX)), pl[1], pl[2]])
            continue
        if cat in kw:
            im, pl = draw(cat, kw[cat], seed)
            put(im, pl)
            continue
        name = ex.get(cat)
        if not name:
            continue
        v = dict(_variant(cat, name))
        if cat == "lunettes":                      # sur les yeux : a leur hauteur, a leur ecart
            v["y"] = v.get("y", 482) + (kw["yeux"].get("y", EYE_Y) - EYE_Y)
            k = kw["yeux"]["ecart"] / 250.0
            v["w"] = v.get("w", 150) * (0.5 + 0.5 * k)
            v["pont"] = max(14, kw["yeux"]["ecart"] - v["w"])
            im, pl = partsdraw.lunettes(seed=seed, **v)
            put(im, [pl[0] + (kw["yeux"].get("_cx", CX) - CX), pl[1], pl[2]])
        elif cat == "moustache":                   # entre le nez et la bouche
            v["y"] = (kw["nez"]["base"] + kw["bouche"]["y"] - kw["bouche"]["up"]) / 2 + 6
            im, pl = partsdraw.moustache(seed=seed, **v)
            put(im, [pl[0] + (kw["bouche"].get("_cx", CX) - CX), pl[1], pl[2]])
        elif cat == "barbe":                       # sur la machoire mesuree
            near = min(vis["profil"], key=lambda r: abs(r[0] - 740)) if vis.get("profil") else [740, vis["wj"] / 2]
            v.update(wj=near[1] * 2 + 6, chin=vis["chin"] + 5, jy=min(vis["chin"] - 120, 740))
            im, pl = partsdraw.barbe(seed=seed, **v)
            dy = kw["bouche"]["y"] - 715
            put(im, [pl[0] + (cxf - CX), pl[1] + (dy if v.get("zone") in ("bouc", "mouche", "barbiche") else 0), pl[2]])
    hair = ex.get("cheveux")
    if hair:
        f = parts.ROOT / "cheveux" / (hair + ".png")
        im = Image.open(f).convert("RGBA")
        wf = max(vis["wf"], vis["wc"])
        w = ex.get("cheveux_w", HAIR_W.get(hair, 620)) * wf / 520.0
        im = im.resize((int(round(w)), int(round(im.height * w / im.width))), Image.LANCZOS)
        top = vis["top"]
        # ancrage par le haut : le sommet de la coupe juste au-dessus du crane (une coupe longue ne descend plus sur le visage)
        x0, y0 = int(round(cxf - im.width / 2)), int(round(top - ex.get("cheveux_haut", HAIR_TOP.get(hair, 34)) * wf / 520.0))
        a = np.asarray(im)[..., 3] > 60                             # masque : rien du crane au-dessus de la coupe
        arr = np.asarray(out).copy()
        cols = np.where(a.any(axis=0))[0]
        if len(cols):
            tops = np.where(a.any(axis=0), a.argmax(axis=0), -1).astype(float)
            valid = tops >= 0
            tops = np.interp(np.arange(len(tops)), np.where(valid)[0], tops[valid])
            for i in range(cols.min(), cols.max() + 1):
                x = x0 + i
                if 0 <= x < arr.shape[1]:
                    arr[:max(0, int(y0 + tops[i]) + 3), x, 3] = 0
        out = Image.fromarray(arr)
        out.alpha_composite(im, (x0, max(0, y0)) if y0 >= 0 else (x0, 0), (0, 0) if y0 >= 0 else (0, -y0))
    return out
