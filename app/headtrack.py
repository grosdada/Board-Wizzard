"""Suivi de la tete d'un corps de mannequin, image par image de son orbite.

Le mannequin a une tete pleine et sombre (c'est sa peau : tete, cou, mains). Dans chaque image on cherche la plus grosse
tache sombre du haut du corps : c'est la tete. On en garde le centre et la taille, en fraction de l'image, pour que
l'application y pose la tete en traces du portrait-robot.

    orbit(dossier, n) -> ecrit head.json : { "frames": [[cx, cy, largeur, hauteur] ou null, …], "ok": part des images suivies }
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:                                               # pas d'OpenCV : pas de suivi
    cv2 = None


def available():
    return cv2 is not None


def frame(src):
    """Tete dans une image detouree : (cx, cy, largeur, hauteur) en fraction de l'image, ou None."""
    im = np.asarray(Image.open(src).convert("RGBA"))
    h, w = im.shape[:2]
    alpha = im[..., 3] > 100
    if not alpha.any():
        return None
    lum = im[..., :3].astype(int).sum(axis=2) / 3
    dark = (alpha & (lum < 95)).astype(np.uint8)
    k = max(3, int(round(w * 0.035)) | 1)
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))   # cheveux hachures : on rebouche
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))    # traits fins : on enleve
    n, lab, stats, cent = cv2.connectedComponentsWithStats(dark, 8)
    rows = np.where(alpha.any(axis=1))[0]
    top, tall = rows[0], rows[-1] - rows[0] + 1
    best = None
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < 0.002 * w * h or bw > 0.75 * w:
            continue
        score = area * (1.6 - min(1.0, (y - top) / max(1, tall)))      # la plus grosse, de preference en haut
        if best is None or score > best[0]:
            best = (score, x, y, bw, bh, i)
    if best is None:
        return None
    _, x, y, bw, bh, i = best
    comp = lab == i
    # la tache contient souvent le cou : on garde le haut, jusqu'a la ou elle se resserre nettement
    widths = comp.sum(axis=1)[y:y + bh]
    wide = widths.max()
    cut = bh
    peak = int(np.argmax(widths))
    for r in range(peak, bh):
        if widths[r] < wide * 0.55:
            cut = r
            break
    cut = min(cut, int(wide * 1.45))
    cols = np.where(comp[y:y + cut].any(axis=0))[0]
    x0, x1 = cols[0], cols[-1]
    return [round((x0 + x1 + 1) / 2 / w, 4), round((y + cut / 2) / h, 4), round((x1 - x0 + 1) / w, 4), round(cut / h, 4)]


def orbit(folder, n):
    """Suit la tete dans les n images d'une orbite et ecrit head.json. Les images ratees sont comblees par leurs voisines."""
    folder = Path(folder)
    raw = [frame(folder / ("%03d.webp" % i)) for i in range(n)]
    found = sum(1 for r in raw if r)
    out = list(raw)
    if found:
        for i in range(n):                                        # trous : on prend la plus proche (l'orbite boucle)
            if out[i] is None:
                for d in range(1, n):
                    a, b = raw[(i - d) % n], raw[(i + d) % n]
                    if a or b:
                        out[i] = a or b
                        break
        # lissage leger : la tete ne doit pas trembler d'une image a l'autre
        arr = np.array(out, float)
        sm = (np.roll(arr, 1, axis=0) + 2 * arr + np.roll(arr, -1, axis=0)) / 4
        out = [[round(float(v), 4) for v in row] for row in sm]
    data = {"frames": out, "ok": round(found / max(1, n), 3)}
    (folder / "head.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data
