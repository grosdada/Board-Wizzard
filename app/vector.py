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


def _paths(mask):
    """Contours d'un masque (avec ses trous) -> attribut d d'un trace SVG, en coordonnees de l'image d'origine."""
    cs, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < 6 * UP * UP:
            continue
        c = cv2.approxPolyDP(c, EPS, True)[:, 0, :].astype(np.float32) / UP
        if len(c) < 3:
            continue
        mid = (c + np.roll(c, -1, axis=0)) / 2                    # courbe lisse : on passe par les milieux des cotes
        d = "M%.1f %.1f" % tuple(mid[-1])
        for p, m in zip(c, mid):
            d += "Q%.1f %.1f %.1f %.1f" % (p[0], p[1], m[0], m[1])
        out.append(d + "Z")
    return "".join(out)


def frame(src):
    """(largeur, hauteur, trace de la silhouette, trace de l'encre) d'une image detouree."""
    im = np.asarray(Image.open(src).convert("RGBA"))
    h, w = im.shape[:2]
    big = cv2.resize(im, (w * UP, h * UP), interpolation=cv2.INTER_CUBIC)
    grey = cv2.GaussianBlur(cv2.cvtColor(big[..., :3], cv2.COLOR_RGB2GRAY), (0, 0), 1.0)
    if im[..., 3].min() > 250:                                    # image pleine (un decor) : tout le cadre est du papier
        ink = (grey < 175).astype(np.uint8)
        return w, h, "M0 0H%dV%dH0Z" % (w, h), _paths(ink)
    solid = cv2.GaussianBlur(big[..., 3], (0, 0), 1.2) > 128
    ink = ((grey < 175) & solid).astype(np.uint8)
    # silhouette : arrondie (le rebouchage des dessins laisse de petites marches), mais jamais plus petite que l'encre
    soft = cv2.GaussianBlur(big[..., 3], (0, 0), 2.0 * UP) > 128
    body = (soft | (cv2.dilate(ink, np.ones((3, 3), np.uint8)) > 0)).astype(np.uint8)
    return w, h, _paths(body), _paths(ink)


def orbit(folder, n):
    """Trace les n images d'une orbite (000.webp...). Renvoie True si vec.json est ecrit."""
    if cv2 is None:
        return False
    folder = Path(folder)
    frames, w, h = [], 0, 0
    for i in range(n):
        w, h, body, ink = frame(folder / ("%03d.webp" % i))
        frames.append({"body": body, "ink": ink})
    (folder / "vec.json").write_text(json.dumps({"w": w, "h": h, "frames": frames}, separators=(",", ":")), encoding="utf-8")
    return True
