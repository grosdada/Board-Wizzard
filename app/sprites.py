"""Du rendu aux images de la banque : orbite (video couleur + video du masque) -> suite d'images detourees.

Toutes les images d'une orbite sont rognees sur la meme boite (union des silhouettes) : le personnage reste cale
d'une image a l'autre. La boucle 360 rend sa derniere image identique a la premiere : on la retire.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

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


def singles(frames):
    """Indices des images a garder quand une orbite est « exposee a deux » (chaque image y est deux fois de suite,
    comme les videos H3 de fal : 124 images pour 62 dessins). Rend tous les indices si ce n'est pas le cas."""
    n = len(frames)
    if n < 12:
        return list(range(n))
    small = [np.asarray((Image.open(f) if not isinstance(f, Image.Image) else f).convert("L").resize((96, 96)), dtype=np.float32) for f in frames]
    d = np.array([float(np.abs(a - b).mean()) for a, b in zip(small, small[1:])])
    even, odd = float(np.median(d[0::2])), float(np.median(d[1::2]))
    if even < 0.35 * odd:                                           # paires (0,1), (2,3)...
        return list(range(0, n, 2))
    if odd < 0.35 * even:                                           # paires (1,2), (3,4)...
        return [0] + list(range(1, n, 2))
    return list(range(n))


def build_orbit(rgb_video, matte_video, dest, height=None, fill=False):
    """Ecrit dest/000.webp... et renvoie {n, w, h, ext, motion, dark, cover}. matte_video None : decor, sans alpha."""
    height = height or settings.load()["render"]["frame_height"]
    dest = Path(dest)
    tmp = Path(tempfile.mkdtemp(prefix="bw_"))
    try:
        rgb = _extract(rgb_video, tmp / "rgb")
        if len(rgb) > 2:
            rgb = rgb[:-1]                                   # derniere image = premiere
        keep = singles(rgb)                                  # video exposee a deux : une seule image de chaque paire
        doubled = len(keep) < len(rgb)
        rgb = [rgb[i] for i in keep]
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
        mat = _extract(matte_video, tmp / "mat")
        mat = [mat[i] for i in keep if i < len(mat)] if doubled else mat[:len(rgb)]
        alphas = []
        for f in mat:
            a = np.asarray(Image.open(f).convert("L"), dtype=np.uint8)
            a = np.where(a < 14, 0, a).astype(np.uint8)
            alphas.append(fill_holes(a) if fill else a)
        union = np.zeros_like(alphas[0], dtype=bool)
        for a in alphas:
            union |= a > 40
        box = _bbox(union, pad=6)
        covers = [float((a > 128).mean()) for a in alphas]
        cover = float(np.mean(covers))
        med = float(np.median(covers))
        lost = sum(1 for c in covers if c < 0.3 * med) / len(covers) if med > 0 else 1.0
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
                "dark": round(dark, 2), "cover": round(cover, 3), "lost": round(lost, 2)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def fill_holes(a, rim=True):
    """Dessin sur papier blanc : le detourage troue l'interieur blanc du sujet. Tout ce que la silhouette enferme
    (non relie au bord de l'image) redevient opaque. Le contour est d'abord epaissi pour refermer les traits qui ne
    se rejoignent pas (un pantalon dessine d'un trait ouvert), puis l'interieur trouve est retreci d'autant."""
    solid = (a > 40)
    h, w = solid.shape
    f = max(1, h // 240)                                       # travail en petit : rapide, et bien assez precis
    sw, sh = max(8, w // f), max(8, h // f)
    small = Image.fromarray((solid * 255).astype(np.uint8)).resize((sw, sh), Image.BOX).point(lambda v: 255 if v > 20 else 0)
    k = 7
    im = Image.new("L", (sw + 2 * k, sh + 2 * k), 0)
    im.paste(small, (k, k))
    thick = im.filter(ImageFilter.MaxFilter(k))
    ImageDraw.floodfill(thick, (0, 0), 128)                    # 128 = exterieur
    inner = Image.fromarray(((np.asarray(thick) != 128) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(k))
    up = lambda m: np.asarray(m.crop((k, k, k + sw, k + sh)).resize((w, h), Image.BICUBIC)) > 127      # bords sans marches
    # loin du bord, tout est opaque : le detourage laisse aussi des zones a moitie transparentes (un dos tout blanc)
    # que le seuil ci-dessus prend pour du plein, et le decor se voit au travers
    deep = up(inner.filter(ImageFilter.MinFilter(5)))
    if not rim:                                                # image deja rebouchee une fois : seulement le coeur,
        import cv2                                             # et pas les vrais vides (nets, a zero) qu'on y a rouverts
        zero = (deep & (a < 14)).astype(np.uint8)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(zero, connectivity=8)
        big = np.isin(lab, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 150])
        return np.where(deep & ~big, 255, a).astype(np.uint8)
    return np.where(deep | (up(_closed(inner, small, k)) & ~solid), 255, a).astype(np.uint8)


def _closed(inner, small, k):
    """Retire de l'interieur trouve les coins que l'epaississement a refermes a tort (l'angle entre un bras et le corps) :
    un morceau ajoute qui donne largement sur l'exterieur n'est pas enferme par la silhouette."""
    import cv2
    inn = np.asarray(inner) > 127
    sol = np.zeros(inn.shape, bool)
    sol[k:k + small.size[1], k:k + small.size[0]] = np.asarray(small) > 127
    ext = (~sol).astype(np.uint8)
    cv2.floodFill(ext, None, (0, 0), 2)                        # 2 = dehors, sans epaississement
    ext = ext == 2
    add = (inn & ~sol).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(add, connectivity=4)
    out = inn.copy()
    ker = np.ones((3, 3), np.uint8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 4:
            continue
        m = (lab == i).astype(np.uint8)
        ring = (cv2.dilate(m, ker) > 0) & (m == 0)
        if ring.sum() and (ring & ext).sum() / ring.sum() > 0.25:
            out[m > 0] = False
    return Image.fromarray((out * 255).astype(np.uint8))


def _bbox(mask, pad=0):
    ys, xs = np.where(mask)
    if not len(xs):
        return (0, 0, mask.shape[1], mask.shape[0])
    return (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
            min(mask.shape[1], int(xs.max()) + 1 + pad), min(mask.shape[0], int(ys.max()) + 1 + pad))


def studio(cut, dest):
    """Pose un sujet detoure sur un fond de studio gris, avec une ombre douce au sol. Sert de depart a l'orbite quand
    l'image d'origine tourne mal (decor trop sombre : le sujet disparait de dos)."""
    sub = Image.open(cut).convert("RGBA")
    ratio = min(1.6, max(0.66, sub.width / sub.height * 1.45))
    h = int(round((1_050_000 / ratio) ** 0.5 / 16) * 16)
    w = int(round(h * ratio / 16) * 16)
    k = min(0.78 * h / sub.height, 0.78 * w / sub.width)
    sub = sub.resize((max(1, round(sub.width * k)), max(1, round(sub.height * k))), Image.LANCZOS)
    ys = np.linspace(0, 1, h)[:, None]
    wall = 208 - 14 * ys                                         # mur clair, un peu plus sombre vers le bas
    floor = 186 - 22 * (ys - 0.72) / 0.28
    t = np.clip((ys - 0.68) / 0.08, 0, 1)                        # raccord mur / sol sans arete
    lum = np.repeat(wall * (1 - t) + floor * t, w, axis=1)
    xs = np.abs(np.linspace(-1, 1, w))[None, :]
    lum = lum * (1 - 0.07 * xs ** 2)                             # leger vignettage
    bg = Image.fromarray(np.stack([lum, lum * 1.003, lum * 1.012], axis=2).clip(0, 255).astype(np.uint8)).convert("RGBA")
    x0, y1 = (w - sub.width) // 2, int(h * 0.9)
    sh = Image.new("L", (w, h), 0)
    rx, ry = sub.width * 0.46, max(8, sub.width * 0.085)
    ImageDraw.Draw(sh).ellipse([w / 2 - rx, y1 - ry, w / 2 + rx, y1 + ry * 0.8], fill=105)
    sh = sh.filter(ImageFilter.GaussianBlur(max(6, sub.width * 0.05)))
    bg = Image.composite(Image.new("RGBA", (w, h), (60, 60, 64, 255)), bg, sh)
    bg.alpha_composite(sub, (x0, y1 - sub.height))
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(dest)
    return dest


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


def _ink(path, height=220):
    """Image en gris, rognee sur le dessin, ramenee a une hauteur fixe (trait = valeurs hautes)."""
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    g = 255 - np.asarray(bg.convert("L"), dtype=np.float32)
    box = _bbox(g > 60)
    g = Image.fromarray(g[box[1]:box[3], box[0]:box[2]].astype(np.uint8))
    g = g.resize((max(8, round(g.width * height / g.height)), height), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(g, dtype=np.float32)


def face_score(original, candidate, head=0.4):
    """Fidelite de la tete d'un dessin apres une pose : meilleure correlation (0 a 1) entre la tete d'origine (le haut
    du dessin) et l'image candidate, en cherchant un peu autour (position, taille). Sert a ecarter les poses qui
    redessinent le visage."""
    a = _ink(original)
    top = a[: int(a.shape[0] * head)]
    # le gabarit est la fenetre la plus chargee en trait du haut du dessin : le visage, et non ce qui l'entoure
    # (un bras leve, une pipe et sa fumee), que la pose a le droit de deplacer
    side = int(min(top.shape[0], top.shape[1], a.shape[0] * 0.3))
    ii = np.pad(top, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    dens = ii[side:, side:] - ii[:-side, side:] - ii[side:, :-side] + ii[:-side, :-side]
    y, x = np.unravel_index(int(dens.argmax()), dens.shape)
    t0 = top[y:y + side, x:x + side]
    best = 0.0
    for scale in (0.8, 0.9, 1.0, 1.1, 1.25):
        b = _ink(candidate, int(220 * scale))
        t = t0
        if t.shape[0] >= b.shape[0]:
            continue
        if t.shape[1] > b.shape[1]:                                   # le candidat est plus etroit : on borde de blanc
            pad = t.shape[1] - b.shape[1] + 2
            b = np.pad(b, ((0, 0), (pad // 2, pad - pad // 2)))
        b = np.pad(b, ((6, 0), (10, 10)))
        win = np.lib.stride_tricks.sliding_window_view(b[: int(b.shape[0] * 0.62)], t.shape)[::2, ::2]
        tz = t - t.mean()
        wz = win - win.mean(axis=(2, 3), keepdims=True)
        den = np.sqrt((wz ** 2).sum(axis=(2, 3)) * (tz ** 2).sum()) + 1e-6
        best = max(best, float(((wz * tz).sum(axis=(2, 3)) / den).max()))
    return round(best, 3)


def ink(src, dest):
    """Ramene un dessin a du trait noir sur blanc : plus de couleur, les gris clairs partent, les traits gris foncent."""
    g = np.asarray(Image.open(src).convert("L"), dtype=np.float32)
    g = np.clip((g - 50) / (215 - 50), 0, 1) * 255
    Image.fromarray(g.astype(np.uint8)).convert("RGB").save(dest)
    return dest
