"""Recale les couleurs d'une pose sur celles de l'image de base du personnage (rien de payant, rien sur les machines).

    python tools/couleurs.py <element> [<variante>...]            # mesure seulement : ecart de couleur de chaque pose
    python tools/couleurs.py <element> <variante>... --recaler    # corrige v/<variante>/ref.png et ses vues (sheet/)

Une pose redessinee par un modele peut sortir plus sombre ou d'une autre teinte : en changeant de pose, le personnage
changerait de couleur. On mesure, sur les pixels peints (pas le papier blanc), la moyenne et l'etalement des couleurs en
Lab, et on ramene ceux de la pose sur ceux de la base. Ecart = distance entre les moyennes (au-dela de 6, ca se voit).
Les originaux sont gardes dans data/backup/couleurs/<element>/<variante>/. Apres un recalage, refaire le detourage de la
pose, puis son orbite si elle etait deja faite. Planche de controle : data/qa/couleurs-<element>.jpg.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from app import settings, store  # noqa: E402


def _lab(path):
    rgb = np.asarray(Image.open(path).convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    paint = (rgb.min(axis=2) < 232) & ((rgb.max(axis=2).astype(int) - rgb.min(axis=2)) > 10)   # peint et colore : ni papier ni crayon gris
    soft = rgb.min(axis=2) < 240
    return rgb, lab, paint, soft


def stats(path):
    _, lab, paint, _ = _lab(path)
    px = lab[paint]
    return px.mean(axis=0), px.std(axis=0) + 1e-3


def gap(a, b):
    return float(np.linalg.norm((a[0] - b[0]) * np.array([100 / 255.0, 1, 1])))


def recolor(path, ref_stats, own_stats=None):
    rgb, lab, paint, soft = _lab(path)
    m, s = own_stats or (lab[paint].mean(axis=0), lab[paint].std(axis=0) + 1e-3)
    k = np.clip(ref_stats[1] / s, 0.7, 1.4)
    out = (lab - m) * k + ref_stats[0]
    out = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    w = cv2.GaussianBlur(soft.astype(np.float32), (0, 0), 1.5)[..., None]          # le papier blanc reste blanc
    Image.fromarray((out * w + rgb * (1 - w)).astype(np.uint8)).save(path)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    iid = args[0]
    it = store.load_item(iid)
    d = store.item_dir(iid)
    base = d / it["variants"]["base"]["ref"]
    ref = stats(base)
    vids = args[1:] or [k for k in it["variants"] if k != "base"]
    fix = "--recaler" in sys.argv
    rows = []
    for vid in vids:
        v = it["variants"][vid]
        p = d / v["ref"]
        own = stats(p)
        before = gap(own, ref)
        line = "%-16s ecart %5.1f" % (vid, before)
        if fix:
            bk = settings.DATA / "backup" / "couleurs" / iid / vid
            bk.mkdir(parents=True, exist_ok=True)
            files = [p] + [d / r for r in (v.get("sheet") or {}).values() if (d / r).exists()]
            old = Image.open(p).convert("RGB")
            for f in files:
                if not (bk / f.name).exists():
                    shutil.copyfile(f, bk / f.name)
                recolor(f, ref)                                    # chaque image ramenee a la base avec ses propres mesures
            line += " -> %5.1f  (%d image(s))" % (gap(stats(p), ref), len(files))
            rows.append((old, Image.open(p).convert("RGB")))
        print(line)
    if rows:
        b = Image.open(base).convert("RGB")
        H = 420
        fit = lambda im: im.resize((int(im.width * H / im.height), H))
        cells = [[fit(b), fit(o), fit(n)] for o, n in rows]
        sheet = Image.new("RGB", (max(sum(c.width for c in r) for r in cells), H * len(cells)), "white")
        for r, row in enumerate(cells):
            x = 0
            for c in row:
                sheet.paste(c, (x, r * H))
                x += c.width
        out = settings.DATA / "qa" / ("couleurs-%s.jpg" % iid)
        sheet.save(out, quality=88)
        print("planche (base, avant, apres) :", out)


if __name__ == "__main__":
    main()
