"""Proportions d'une caricature : part de la tete dans la hauteur du personnage (tete_h) et largeur de la tete rapportee a
cette hauteur (tete_l). La tete = ce qui est au-dessus du cou (rangee la plus etroite entre 12 % et 55 % de la hauteur).
Meme mesure que tools/proportions.py. Ne vaut que pour un personnage debout, tete en haut : pas pour assis, accroupi, a
terre. La masse du corps (epaules, epaisseur des membres) ne se voit pas ici : elle se juge a l'oeil.

On compare deux images sur le meme fond de couleur (la pose, et le dessin d'origine repose sur ce fond) : la decoupe par
la couleur donne la silhouette sans reseau de detourage."""

import numpy as np
from PIL import Image

from . import sprites

TOL = 0.08          # au-dela de 8 % d'ecart sur la tete, la caricature est perdue (a l'oeil : « plus filiforme »)


def _mask(path, key=None):
    im = Image.open(path).convert("RGB")
    if key:
        return np.asarray(sprites.key_rgba(im, key))[..., 3] > 128
    a = np.asarray(im).astype(int)
    m = a.min(axis=2) < 235                                   # papier blanc : l'encre et le lavis, contour ferme
    import cv2
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnt, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(m)
    cv2.drawContours(out, [max(cnt, key=cv2.contourArea)], -1, 1, -1)
    return out > 0


def measure(path, key=None):
    m = _mask(path, key)
    ys = np.where(m.any(1))[0]
    if len(ys) < 20:
        raise ValueError("silhouette introuvable")
    y0, y1 = ys[0], ys[-1]
    H = y1 - y0 + 1
    w = m[y0:y1 + 1].sum(1).astype(float)
    k = np.convolve(w, np.ones(7) / 7, mode="same")
    a, b = int(0.12 * H), int(0.55 * H)
    neck = a + int(np.argmin(k[a:b]))
    return {"tete_h": float(neck / H), "tete_l": float(w[:neck].max() / H)}


def compare(ref, img, key=None, ref_key=None):
    """Rapport des mesures de img a celles de ref : {tete_h, tete_l, ok}. ok faux si un rapport s'ecarte de plus de TOL."""
    r, m = measure(ref, ref_key if ref_key is not None else key), measure(img, key)
    d = {k: round(m[k] / r[k], 3) if r[k] else 1.0 for k in ("tete_h", "tete_l")}
    d["ok"] = all(abs(v - 1) <= TOL for v in d.values())
    return d


def describe(p):
    """Texte court pour le juge et les journaux."""
    if not p:
        return ""
    return ("tête %.0f %% de la hauteur de l'original, largeur de tête %.0f %% (tolérance ±%d %%)%s"
            % (p["tete_h"] * 100, p["tete_l"] * 100, round(TOL * 100), "" if p.get("ok") else " : HORS PROPORTIONS"))
