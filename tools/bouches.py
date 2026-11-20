"""Les trois bouches de lip sync des personnages de la galerie : fermee, ouverte, ronde, tracees aux cotes de la bouche
du personnage (app/partsdraw.py), donc dans son dessin. Rien n'est calcule sur les machines.

  python tools/bouches.py planche [noms]     data/qa/bouches.jpg : les trois bouches posees sur l'image de face de l'orbite
  python tools/bouches.py ranger [noms]      ecrit data/bank/<id>/mouths/{x,a,o}.png et le champ « mouths » de l'element

Champ « mouths » d'un element :
  cards  {"X": "mouths/x.png", "A": ..., "O": ...}   cartes 420 x 280, encre noire sur fond transparent, dents blanches
  cover  trace SVG (unites du lip sync : carte = 120 x 80 centree sur l'origine) de la forme a remplir de la couleur du
         personnage derriere la carte : elle couvre la bouche du dessin. La meme pour les trois cartes.
  x, y   centre de la carte dans l'image de face de l'orbite de base (fraction de sa largeur, de sa hauteur)
  s      taille au sens de lip.s (100 unites, en fraction de la hauteur de l'image)
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from app import bodydraw, partsdraw, settings, store, transpose  # noqa: E402
from tools import galerie  # noqa: E402

CW, CH, DY = 420, 280, 35                       # cadre d'une carte (unites de la tete), centre 35 sous la ligne de la bouche
U = 120.0 / CW                                  # unites de la tete -> unites du lip sync


def cards(src, extras, body, seed):
    """Les trois cartes et la place de leur centre dans l'image de base. Rend ({lettre: image}, trace du cache, (fx, fy, fw))
    ou fx, fy sont des fractions de la boite du personnage et fw la largeur de la carte en fraction de sa hauteur."""
    d = json.loads((galerie.SRC / (src + ".json")).read_text(encoding="utf-8"))
    kw, _ = transpose.fit(d["points"], d.get("shapes"), d.get("matrix"), k=galerie.ACCENT)
    ex = dict(galerie.FACES.get(src, {}), **extras)
    c = dict(kw["bouche"])
    style = ex.get("bouche")
    if isinstance(style, str):
        style = {k: v for k, v in transpose._variant("bouche", style).items() if k in transpose.STYLE_KEYS["bouche"]}
    c.update(style or {})
    cx = c.pop("_cx", transpose.CX)
    old = partsdraw.STROKE
    partsdraw.STROKE = bodydraw.HEAD_STROKE
    out, union = {}, np.zeros((CH, CW), bool)
    box = (round(cx - CW / 2), round(c["y"] + DY - CH / 2), round(cx - CW / 2) + CW, round(c["y"] + DY - CH / 2) + CH)

    def poils(cat):                                # l'encre de la moustache ou de la barbe dans le cadre de la carte
        if not ex.get(cat):
            return None
        sans = {k: v for k, v in ex.items() if k not in ("barbe", "moustache")}
        full = np.asarray(transpose.head(kw, dict(sans, **{cat: ex[cat]}), seed, trait=bodydraw.HEAD_STROKE).crop(box)).astype(int)
        base = np.asarray(transpose.head(kw, sans, seed, trait=bodydraw.HEAD_STROKE).crop(box)).astype(int)
        return np.clip((255 - full[..., 0]) * full[..., 3] // 255 - (255 - base[..., 0]) * base[..., 3] // 255, 0, 255).astype(np.uint8)
    beard, moust = poils("barbe"), poils("moustache")
    try:
        for key in "XAO":
            extra = {}
            im, pl = partsdraw.bouche(seed=seed, **c) if key == "X" else partsdraw.bouche_parle(key, seed=seed, sortie=extra, **c)
            x0, y0 = round(CW / 2 + pl[0] - transpose.CX - im.width / 2), round(CH / 2 + pl[1] - (c["y"] + DY) - im.height / 2)
            full = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
            full.alpha_composite(im, (x0, y0))
            a = np.asarray(full)
            union |= a[..., 3] > 24
            ink = ((255 - a[..., 0].astype(int)) * a[..., 3] // 255).astype(np.uint8)     # l'encre seule : le blanc des levres vient du cache
            if beard is not None:                  # la barbe reste autour de la bouche, la moustache passe devant
                ink = np.maximum(ink, (beard.astype(int) * (255 - a[..., 3]) // 255).astype(np.uint8))
            if moust is not None:
                ink = np.maximum(ink, moust)
            card = np.dstack([np.full_like(ink, 17)] * 3 + [ink])
            if "dents" in extra:
                t = np.asarray(extra["dents"].crop((round(transpose.CX - CW / 2), round(c["y"] + DY - CH / 2),
                                                    round(transpose.CX - CW / 2) + CW, round(c["y"] + DY - CH / 2) + CH)))
                teeth = t > 128
                card[teeth, :3] = np.maximum(card[teeth, :3], 255 - ink[teeth, None])
                card[teeth, 3] = 255
            out[key] = Image.fromarray(card)
    finally:
        partsdraw.STROKE = old
    hull = cv2.convexHull(np.argwhere(union)[:, ::-1].astype(np.int32))
    m = np.zeros((CH, CW), np.uint8)
    cv2.fillConvexPoly(m, hull, 255)
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    cnt = max(cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
    cnt = cv2.approxPolyDP(cnt, 1.2, True)[:, 0, :]
    cover = "M" + "L".join("%.1f %.1f" % ((x - CW / 2) * U, (y - CH / 2) * U) for x, y in cnt) + "Z"
    info = {}
    head = transpose.head(kw, ex, seed, trait=bodydraw.HEAD_STROKE)
    bodydraw.personnage(head, galerie.B[body], seed, nom=body, info=info)
    s, pad = info["s"], info["pad"]
    bw, bh = info["w"] - 2 * pad, info["h"] - 2 * pad
    return out, cover, ((info["ox"] + cx * s - pad) / bw, (info["oy"] + (c["y"] + DY) * s - pad) / bh, CW * s / bh)


def front(item):
    """Image de face de l'orbite de base et la boite de la silhouette : (image RGBA, (x0, y0, x1, y1))."""
    o = item["variants"]["base"]["orbit"]
    f = store.item_dir(item["id"]) / o["dir"] / ("%03d.webp" % (o.get("snaps") or {}).get("face", 0))
    im = Image.open(f).convert("RGBA")
    ys, xs = np.where(np.asarray(im)[..., 3] > 60)
    return im, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def place(item, frac):
    """La place du centre de la carte dans l'image de face de l'orbite : x, y, s (voir en-tete)."""
    im, (x0, y0, x1, y1) = front(item)
    fx, fy, fw = frac
    return dict(x=round((x0 + fx * (x1 - x0)) / im.width, 4), y=round((y0 + fy * (y1 - y0)) / im.height, 4),
                s=round(fw * (y1 - y0) / im.height * 100 / 120, 4))


def shown(item, card, cover, pl, zoom=3):
    """Controle : la tete de l'image de face, agrandie, avec la carte posee comme le fera le lip sync."""
    im, _ = front(item)
    W, H = im.width * zoom, im.height * zoom
    big = Image.new("RGBA", (W, H), (255, 214, 122, 255))
    white = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    big.paste(white, (0, 0), im.resize((W, H), Image.LANCZOS).split()[3])          # le corps blanc, comme a l'ecran
    big.alpha_composite(im.resize((W, H), Image.LANCZOS))
    if card is not None:
        k = pl["s"] * H / 100                      # une unite du lip sync, en pixels
        cx, cy = pl["x"] * W, pl["y"] * H
        pts = [tuple(float(v) for v in q.split()) for q in cover[1:-1].split("L")]
        ImageDraw.Draw(big).polygon([(cx + x * k, cy + y * k) for x, y in pts], fill=(255, 255, 255, 255))
        c = card.resize((round(120 * k), round(80 * k)), Image.LANCZOS)
        big.alpha_composite(c, (round(cx - c.width / 2), round(cy - c.height / 2)))
    top = max(0, round(pl["y"] * H - 0.6 * W))
    return big.crop((0, top, W, min(H, top + W))).convert("RGB")


def main():
    act = sys.argv[1] if len(sys.argv) > 1 else "planche"
    only = sys.argv[2:]
    items = {it["name"]: it for it in store.list_items() if it.get("folder") == galerie.FOLDER}
    tiles = []
    for i, (src, name, ex, body) in enumerate(galerie.CAST):
        if (only and name not in only) or name not in items:
            continue
        item = store.load_item(items[name]["id"])
        cs, cover, frac = cards(src, ex, body, i + 1)
        pl = place(item, frac)
        if act == "ranger":
            d = store.item_dir(item["id"]) / "mouths"
            d.mkdir(exist_ok=True)
            for key, im in cs.items():
                im.save(d / (key.lower() + ".png"))
            store.mutate_item(item["id"], lambda x: x.update(mouths=dict(cards={k: "mouths/%s.png" % k.lower() for k in cs}, cover=cover, t=int(time.time()), **pl)))
            print("range :", name, pl, flush=True)
            continue
        row = [shown(item, None, cover, pl)] + [shown(item, cs[k], cover, pl) for k in "XAO"]
        t = Image.new("RGB", (4 * 330, 350), "white")
        for j, im in enumerate(row):
            t.paste(im.resize((326, 326), Image.LANCZOS), (j * 330, 22))
        ImageDraw.Draw(t).text((4, 4), "%s : dessin | fermee | ouverte | ronde" % name, fill="black")
        tiles.append(t)
        print(name, pl, flush=True)
    if tiles:
        sheet = Image.new("RGB", (tiles[0].width * 2, 350 * -(-len(tiles) // 2)), "white")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 2) * t.width, (i // 2) * 350))
        out = settings.DATA / "qa" / "bouches.jpg"
        sheet.save(out, quality=88)
        print(out)


if __name__ == "__main__":
    main()
