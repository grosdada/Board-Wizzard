"""Orbite d'un dessin au trait -> traces SVG.

Chaque image devient deux traces : la silhouette (remplie en blanc) et l'encre (remplie en noir). A l'affichage le trait
reste net a n'importe quel zoom et son epaisseur se regle (contour ajoute a l'encre). Ecrit <dossier>/vec.json :
{w, h, frames: [{body, ink}]}. Demande opencv (optionnel : sans lui, les dessins restent en images).
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:                                               # pas d'opencv : pas de traces, rien d'autre ne casse
    cv2 = None

UP = 3            # sur-echantillonnage avant de tracer : bords plus lisses
EPS = 1.6         # tolerance de simplification, en pixels sur-echantillonnes


def available():
    return cv2 is not None


def _paths(mask, origin=(0, 0), holes=True):
    """Contours d'un masque (avec ses trous) -> attribut d d'un trace SVG, en coordonnees de l'image d'origine.
    origin : place du masque dans l'image sur-echantillonnee, quand on ne trace qu'un morceau."""
    cs, _ = cv2.findContours(mask, cv2.RETR_CCOMP if holes else cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < 6 * UP * UP:
            continue
        c = (cv2.approxPolyDP(c, EPS, True)[:, 0, :].astype(np.float32) + np.float32(origin)) / UP
        if len(c) < 3:
            continue
        mid = (c + np.roll(c, -1, axis=0)) / 2                    # courbe lisse : on passe par les milieux des cotes
        d = "M%.1f %.1f" % tuple(mid[-1])
        for p, m in zip(c, mid):
            d += "Q%.1f %.1f %.1f %.1f" % (p[0], p[1], m[0], m[1])
        out.append(d + "Z")
    return "".join(out)


def _stroke(ink, q=75):
    """Epaisseur du trait d'un dessin, en pixels sur-echantillonnes : mesuree sur l'axe des traits."""
    dist = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    ridge = dist[(dist > 0) & (dist >= cv2.dilate(dist, np.ones((3, 3), np.uint8)))]
    return 2 * float(np.percentile(ridge, q)) if ridge.size else 0.0


def _hollow(ink):
    """Aplats noirs (la peau d'un mannequin : tete, cou, mains) vides en ne gardant que leur contour : ils deviennent
    des formes blanches au trait, comme le reste du dessin."""
    # plus large qu'un trait : il ne reste que le coeur des aplats. L'epaisseur du trait est mesuree sur le dessin
    # (un corps au trait gras a des traits de plus de 7 px : sans cela ils etaient pris pour des aplats et vides).
    stroke = _stroke(ink)
    k = int(max(7 * UP + 1, round(2.6 * stroke))) | 1
    core = cv2.erode(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    if not core.any():
        return ink
    blob = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k + 2, k + 2))) & ink      # l'aplat entier
    ring = int(max(3 * UP + 1, round(2 * stroke))) | 1   # (l'erosion retire la moitie du noyau de chaque cote)               # epaisseur du contour garde : celle du trait du dessin
    inner = cv2.erode(blob, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring, ring)))
    return (ink & (1 - inner)).astype(np.uint8)


def frame(src, hollow=False):
    """(largeur, hauteur, trace de la silhouette, trace de l'encre) d'une image detouree."""
    im = np.asarray(Image.open(src).convert("RGBA"))
    h, w = im.shape[:2]
    big = cv2.resize(im, (w * UP, h * UP), interpolation=cv2.INTER_CUBIC)
    grey = cv2.GaussianBlur(cv2.cvtColor(big[..., :3], cv2.COLOR_RGB2GRAY), (0, 0), 1.0)
    if im[..., 3].min() > 250:                                    # image pleine (un decor) : tout le cadre est du papier
        ink = (grey < 175).astype(np.uint8)
        return w, h, "M0 0H%dV%dH0Z" % (w, h), _paths(ink), [], _stroke(ink, 50) / UP
    solid = cv2.GaussianBlur(big[..., 3], (0, 0), 1.2) > 128
    ink = ((grey < 175) & solid).astype(np.uint8)
    sw = _stroke(ink, 50) / UP                                    # epaisseur du trait, en unites du dessin
    if hollow:
        ink = _hollow(ink)
    # silhouette : arrondie (le rebouchage des dessins laisse de petites marches), mais jamais plus petite que l'encre
    soft = cv2.GaussianBlur(big[..., 3], (0, 0), 2.0 * UP) > 128
    body = (soft | (cv2.dilate(ink, np.ones((3, 3), np.uint8)) > 0)).astype(np.uint8)
    return w, h, _paths(body), _paths(ink), _parts(body, ink), sw


GAP = 2 * UP + 1      # les traits sont epaissis d'autant pour refermer les petits trous entre deux formes
MAX_PARTS = 28


def _parts(body, ink):
    """Les formes du dessin : chaque zone blanche que les traits enferment (une tete, un short, une manche...). Servent
    a l'ombre, posee forme par forme. Les plus grandes d'abord, les miettes sont laissees."""
    k = np.ones((GAP, GAP), np.uint8)
    free = (body > 0) & (cv2.dilate(ink, k) == 0)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(free.astype(np.uint8), connectivity=4)
    total = max(1, int((body > 0).sum()))
    order = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])[:MAX_PARTS]
    big = int(0.022 * body.shape[0]) | 1
    kbig = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (big, big))
    out = []
    for i in order:
        x, y, ww, hh, area = stats[i]
        if area < 0.004 * total:
            break
        pad = big + GAP
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(lab.shape[1], x + ww + pad), min(lab.shape[0], y + hh + pad)
        m = cv2.dilate((lab[y0:y1, x0:x1] == i).astype(np.uint8), k)          # on revient jusque sous le trait
        # les traits qui entrent dans la forme sans rien fermer (un pli, une ride) y creusent des couloirs : on les
        # rebouche, sinon l'ombre longe chaque trait et le dessin parait dedouble
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kbig)
        m &= body[y0:y1, x0:x1]
        full = np.zeros((y1 - y0 + 2, x1 - x0 + 2), np.uint8)
        full[1:-1, 1:-1] = m
        d = _paths(full, (x0 - 1, y0 - 1), holes=False)      # contour exterieur seul : sinon chaque petit trait interieur
                                                              # recoit son ombre et le dessin parait dedouble
        if d:
            out.append(d)
    return out


def orbit(folder, n, hollow=False):
    """Trace les n images d'une orbite (000.webp...). Renvoie True si vec.json est ecrit."""
    if cv2 is None:
        return False
    folder = Path(folder)
    frames, w, h, sws = [], 0, 0, []
    for i in range(n):
        w, h, body, ink, parts, sw = frame(folder / ("%03d.webp" % i), hollow)
        sws.append(sw)
        frames.append({"body": body, "ink": ink, "parts": parts} if parts else {"body": body, "ink": ink})
    (folder / "vec.json").write_text(json.dumps({"w": w, "h": h, "sw": round(float(np.median(sws)), 2) if sws else 0, "frames": frames}, separators=(",", ":")), encoding="utf-8")
    return True
