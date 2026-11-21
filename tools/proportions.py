"""Proportions d'une caricature : part de la tete dans la hauteur du personnage, et largeur de la tete rapportee a cette
hauteur. La tete = ce qui est au-dessus du cou (rangee la plus etroite entre 12 % et 55 % de la hauteur).
La mesure vaut pour un personnage debout, tete en haut (pose en A, poses debout) ; elle ne dit rien d'une pose assise,
accroupie ou a terre : la, comparer a l'oeil.

    python tools/proportions.py <dessin d'origine> <image> [<image>...]   (fond blanc, ou fond vert : decoupe par la couleur)"""
import sys
sys.path.insert(0, "K:/Claude-projets/Board-Wizzard")
import numpy as np
from PIL import Image
from app import sprites
TOL = 0.08          # au-dela de 8 % d'ecart sur la tete, la caricature est perdue (a l'oeil : « plus filiforme »)


def mask(p):
    im = Image.open(p).convert("RGB"); a = np.asarray(im).astype(int)
    g = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    if (g > 80).mean() > 0.2: return np.asarray(sprites.key_rgba(im, "vert"))[..., 3] > 128      # fond vert
    m = a.min(axis=2) < 235                                                                         # fond blanc : l'encre et le lavis
    import cv2
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnt, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(m); cv2.drawContours(out, [max(cnt, key=cv2.contourArea)], -1, 1, -1); return out > 0
def measure(p):
    m = mask(p); ys = np.where(m.any(1))[0]; y0, y1 = ys[0], ys[-1]; H = y1 - y0 + 1
    w = m[y0:y1 + 1].sum(1).astype(float)
    k = np.convolve(w, np.ones(7) / 7, mode="same")
    a, b = int(0.12 * H), int(0.55 * H); neck = a + int(np.argmin(k[a:b]))
    return {"tete_h": round(float(neck / H), 3), "tete_l": round(float(w[:neck].max() / H), 3)}
if __name__ == "__main__":
    ref = measure(sys.argv[1]); print("origine", ref)
    for p in sys.argv[2:]:
        m = measure(p); d = {k: round(m[k] / ref[k], 2) for k in ref}
        bad = [k for k, v in d.items() if abs(v - 1) > TOL]
        print(p.split("/")[-1].split("\\")[-1], m, "rapport", d, "HORS PROPORTIONS : " + ", ".join(bad) if bad else "ok")
