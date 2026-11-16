"""Du rendu aux images de la banque : orbite (video couleur + video du masque) -> suite d'images detourees.

Toutes les images d'une orbite sont rognees sur la meme boite (union des silhouettes) : le personnage reste cale
d'une image a l'autre. La boucle 360 rend sa derniere image identique a la premiere : on la retire.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import settings

# Axes dans l'ordre ou l'orbite H3 les parcourt (mesure sur les rendus : apres « face », le sujet regarde vers la
# gauche de l'image). Gauche / droite = cote de l'ecran vers lequel le sujet regarde.
AXES = ["face", "3/4 face gauche", "profil gauche", "3/4 dos gauche", "dos", "3/4 dos droite", "profil droit",
        "3/4 face droite"]


def _ffmpeg(*args):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True)
    if r.returncode:
        raise RuntimeError("ffmpeg : " + r.stderr.decode("utf-8", "replace")[-600:])


def _extract(video, folder):
    folder.mkdir(parents=True, exist_ok=True)
    _ffmpeg("-i", str(video), "-fps_mode", "passthrough", str(folder / "%04d.png"))
    return sorted(folder.glob("*.png"))


def default_snaps(n, start="face"):
    """Reperes d'axes repartis regulierement sur l'orbite, a partir de l'axe de l'image de depart. H3 ne tourne
    pas a vitesse constante : ce sont des valeurs de depart, corrigees a la main dans la banque."""
    i0 = AXES.index(start) if start in AXES else 0
    return {AXES[(i0 + k) % 8]: round(k * n / 8) % n for k in range(8)}


def frame_stats(frames):
    """Controle d'une orbite : (mouvement moyen entre images 0-1, part d'images presque noires)."""
    small = [np.asarray(Image.open(f).convert("L").resize((64, 64)), dtype=np.float32) for f in frames]
    if len(small) < 2:
        return 0.0, 0.0
    diffs = [float(np.abs(a - b).mean()) for a, b in zip(small, small[1:])]
    dark = sum(1 for s in small if s.mean() < 12) / len(small)
    return sum(diffs) / len(diffs) / 255.0 * 100, dark


def build_orbit(rgb_video, matte_video, dest, height=None, fill=False):
    """Ecrit dest/000.webp... et renvoie {n, w, h, ext, motion, dark, cover}. matte_video None : decor, sans alpha."""
    height = height or settings.load()["render"]["frame_height"]
    dest = Path(dest)
    tmp = Path(tempfile.mkdtemp(prefix="bw_"))
    try:
        rgb = _extract(rgb_video, tmp / "rgb")
        if len(rgb) > 2:
            rgb = rgb[:-1]                                   # derniere image = premiere
        motion, dark = frame_stats(rgb)
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        if matte_video is None:
            w = h = 0
            for i, f in enumerate(rgb):
                im = Image.open(f).convert("RGB")
                if im.height > height:
                    im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
                w, h = im.size
                im.save(dest / ("%03d.webp" % i), quality=84, method=4)
            return {"n": len(rgb), "w": w, "h": h, "ext": "webp", "alpha": False, "motion": round(motion, 2),
                    "dark": round(dark, 2), "cover": 1.0}
        mat = _extract(matte_video, tmp / "mat")[:len(rgb)]
        alphas = []
        for f in mat:
            a = np.asarray(Image.open(f).convert("L"), dtype=np.uint8)
            a = np.where(a < 14, 0, a).astype(np.uint8)
            alphas.append(fill_holes(a) if fill else a)
        union = np.zeros_like(alphas[0], dtype=bool)
        for a in alphas:
            union |= a > 40
        box = _bbox(union, pad=6)
        cover = float(np.mean([(a > 128).mean() for a in alphas]))
        w = h = 0
        for i, (f, a) in enumerate(zip(rgb, alphas)):
            im = Image.open(f).convert("RGB")
            if im.size != (a.shape[1], a.shape[0]):
                im = im.resize((a.shape[1], a.shape[0]), Image.LANCZOS)
            im.putalpha(Image.fromarray(a))
            im = im.crop(box)
            if im.height > height:
                im = im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)
            w, h = im.size
            im.save(dest / ("%03d.webp" % i), quality=86, method=4)
        return {"n": len(rgb), "w": w, "h": h, "ext": "webp", "alpha": True, "motion": round(motion, 2),
                "dark": round(dark, 2), "cover": round(cover, 3)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def fill_holes(a):
    """Dessin sur papier blanc : le detourage troue l'interieur blanc du sujet. Tout ce que la silhouette enferme
    (non relie au bord de l'image) redevient opaque."""
    solid = (a > 40)
    h, w = solid.shape
    im = Image.new("L", (w + 2, h + 2), 0)
    im.paste(Image.fromarray((solid * 255).astype(np.uint8)), (1, 1))
    ImageDraw.floodfill(im, (0, 0), 128)                       # 128 = exterieur
    inner = np.asarray(im)[1:-1, 1:-1] == 0                    # ni sujet ni exterieur : un trou
    return np.where(inner, 255, a).astype(np.uint8)


def _bbox(mask, pad=0):
    ys, xs = np.where(mask)
    if not len(xs):
        return (0, 0, mask.shape[1], mask.shape[0])
    return (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
            min(mask.shape[1], int(xs.max()) + 1 + pad), min(mask.shape[0], int(ys.max()) + 1 + pad))


def build_cut(rgba_png, dest, height=1024, fill=False):
    """Image detouree fixe : rognee sur la silhouette, en WebP avec transparence. Renvoie (w, h, couverture)."""
    im = Image.open(rgba_png).convert("RGBA")
    a = np.asarray(im.getchannel("A"))
    a = np.where(a < 14, 0, a).astype(np.uint8)
    if fill:
        a = fill_holes(a)
    im.putalpha(Image.fromarray(a))
    cover = float((a > 128).mean())
    im = im.crop(_bbox(a > 40, pad=6))
    if im.height > height:
        im = im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, quality=90, method=4)
    return im.width, im.height, cover


def normalize(src, dest, max_side=1600):
    """Image importee -> PNG RVB de taille raisonnable. Renvoie (w, h)."""
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert("RGB")
    if max(im.size) > max_side:
        k = max_side / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest)
    return im.size


def thumb(src, dest, size=320):
    im = Image.open(src)
    im.thumbnail((size, size), Image.LANCZOS)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, quality=82)
