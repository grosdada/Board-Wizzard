"""Bouches de lip sync dessinees dans le style du personnage (fal, Nano Banana Pro), posees sur son orbite.

    python tools/levres.py <element> <variante> [--images 0,7,14] [--refaire]     # payant : 4 images fal par image-cle

Il faut d'abord que la bouche soit suivie dans l'orbite (montage : « Tracer la bouche », mouth.json). Pour chaque image-cle
de l'orbite, la tete est decoupee autour de la bouche, et le modele redessine la meme tete avec la bouche qui dit A, O, E,
ou entrouverte (D), sans toucher au reste. On ne garde que ce qui a change autour de la bouche (un meme masque adouci pour
les quatre, pour que la peau autour ne clignote pas) : des cartes transparentes, en pixels de l'image d'orbite.

    <orbite>/lips/kFFF_A.webp ...        les cartes
    <orbite>/lips.json                   { w, h, keys: [{ f, x, y, s, cards: {A, O, E, D} }] }
    variants[v].orbit.lips               instant de la derniere ecriture (le navigateur recharge)
    data/qa/levres-<element>-<variante>.jpg    planche de controle : a regarder avant de s'en servir

A l'affichage (lipsync.js, cardMarkup), la carte de l'image-cle la plus proche est recalee sur la bouche suivie de l'image
montree ; trop loin d'une image-cle, c'est la bouche tracee habituelle qui prend le relais.
"""

import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

from app import falapi, settings, store  # noqa: E402

MODEL = "fal-ai/nano-banana-pro/edit"
KEEP = (" Change ONLY the mouth. Everything else stays exactly as in the reference, pixel for pixel: same head, same eyes, same "
        "nose, same jaw outline, same hair, same clothes, same framing, same position, same size, same viewing angle. The new mouth "
        "is drawn by the same artist with the same tools: the same kind of line with the same thickness and roughness, the same "
        "way of filling, the same colours as the rest of the drawing. No clean ink, no new colours, no added detail, no added shading.")
SHAPES = {
    "A": "The character is speaking: the mouth is wide open as when saying 'AH', the lower lip dropped, the inside of the mouth "
         "filled with the darkest colour already used in the drawing.",
    "O": "The character is speaking: the lips are pushed forward into a small round 'OH' shape, a small round opening filled with "
         "the darkest colour already used in the drawing.",
    "E": "The character is speaking: the mouth is half open and stretched wide as when saying 'EE', showing a plain row of upper "
         "teeth left as bare paper, a thin dark gap under them.",
    "D": "The character is speaking: the mouth is slightly open, a narrow dark slit between the lips, as when saying 'D' or 'S'.",
}
UP = 1024


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        sys.exit(__doc__)
    iid, vid = args[0], args[1]
    it = store.load_item(iid)
    d = store.item_dir(iid)
    o = it["variants"][vid]["orbit"]
    folder = d / o["dir"]
    try:
        mouth = json.loads((folder / "mouth.json").read_text(encoding="utf-8"))
    except OSError:
        sys.exit("pas de bouche suivie sur cette orbite : trace-la d'abord dans le montage")
    fr = mouth["frames"]
    keys = [0]
    for a in sys.argv[1:]:
        if a.startswith("--images="):
            keys = [int(x) for x in a.split("=")[1].split(",")]
    if "--images" in sys.argv:
        keys = [int(x) for x in sys.argv[sys.argv.index("--images") + 1].split(",")]
    keys = [k for k in keys if 0 <= k < len(fr) and fr[k]]
    if not keys:
        sys.exit("la bouche n'est suivie sur aucune des images demandees")
    try:
        old = json.loads((folder / "lips.json").read_text(encoding="utf-8")) if "--refaire" not in sys.argv else None
    except OSError:
        old = None
    key = settings.load()["fal"].get("key")
    prov = falapi.FalProvider(key, {})
    (folder / "lips").mkdir(exist_ok=True)
    tmp = folder / "lips" / "_tmp"
    tmp.mkdir(exist_ok=True)
    got, lock = {}, threading.Lock()
    crops = {}
    for k in keys:
        im = Image.open(folder / ("%03d.webp" % k)).convert("RGBA")
        m = fr[k]
        s = int(min(max(4.2 * m["w"], 200), im.width, im.height))
        x = int(min(max(m["cx"] - s / 2, 0), im.width - s))
        y = int(min(max(m["cy"] - s * 0.62, 0), im.height - s))       # la bouche dans le bas du cadre : on voit les yeux et le nez
        rgba = im.crop((x, y, x + s, y + s))
        flat = Image.new("RGB", (s, s), "white")
        flat.paste(rgba, (0, 0), rgba)
        src = tmp / ("src_%03d.png" % k)
        flat.resize((UP, UP), Image.LANCZOS).save(src)
        crops[k] = (x, y, s, rgba, flat, prov.upload(src))

    def work(k, sh):
        try:
            out = falapi.FalProvider(key, {}).run(MODEL, {"prompt": SHAPES[sh] + KEEP, "image_urls": [crops[k][5]], "num_images": 1,
                                                             "aspect_ratio": "1:1"})
            p = prov.fetch(out["images"][0]["url"], tmp / ("gen_%03d_%s.png" % (k, sh)))
            with lock:
                got[(k, sh)] = p
            print("ok", k, sh, flush=True)
        except Exception as e:                                       # noqa: BLE001
            print("ERREUR", k, sh, repr(e)[:300], flush=True)

    sem = threading.Semaphore(8)

    def guarded(*a):
        with sem:
            work(*a)

    ts = [threading.Thread(target=guarded, args=(k, sh)) for k in keys for sh in SHAPES]
    [t.start() for t in ts]
    [t.join() for t in ts]

    entries, rows = [], []
    for k in keys:
        x, y, s, rgba, flat, _ = crops[k]
        m = fr[k]
        base = np.asarray(flat, dtype=np.int16)
        gens = {sh: Image.open(got[(k, sh)]).convert("RGB").resize((s, s), Image.LANCZOS) for sh in SHAPES if (k, sh) in got}
        if not gens:
            continue
        # ce qui a change, toutes bouches confondues, autour de la bouche seulement
        yy, xx = np.mgrid[0:s, 0:s]
        mx, my, mw = m["cx"] - x, m["cy"] - y, m["w"]
        zone = (((xx - mx) / (mw * 1.05)) ** 2 + ((yy - my - mw * 0.22) / (mw * 0.95)) ** 2) <= 1.0
        diff = np.zeros((s, s), bool)
        outside = {}
        for sh, g in gens.items():
            dd = np.abs(np.asarray(g, dtype=np.int16) - base).max(axis=2)
            diff |= dd > 30
            outside[sh] = float((dd[~zone] > 45).mean())           # part de l'image changee HORS de la bouche : controle
        mask = Image.fromarray(((diff & zone) * 255).astype("uint8"))
        r = max(2, int(mw * 0.10))
        mask = mask.filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.GaussianBlur(r * 0.8))
        mask = Image.fromarray(np.minimum(np.asarray(mask), ((zone * 255).astype("uint8"))))
        mask = mask.filter(ImageFilter.GaussianBlur(1.2))
        alpha = Image.fromarray((np.asarray(mask, dtype=np.float32) * np.asarray(rgba.split()[3], dtype=np.float32) / 255).astype("uint8"))
        cards = {}
        for sh, g in gens.items():
            card = g.convert("RGBA")
            card.putalpha(alpha)
            rel = "lips/k%03d_%s.webp" % (k, sh)
            card.save(folder / rel, quality=92, method=4)
            cards[sh] = rel
        entries.append({"f": k, "x": x, "y": y, "s": s, "cards": cards, "out": {a: round(b, 4) for a, b in outside.items()}})
        row = [flat] + [Image.alpha_composite(flat.convert("RGBA"), Image.open(folder / cards[sh])).convert("RGB") for sh in cards]
        rows.append((k, row, outside))
        print("image %d : change hors de la bouche %s" % (k, {a: "%.1f %%" % (b * 100) for a, b in outside.items()}))

    keep = [e for e in (old or {}).get("keys", []) if e["f"] not in {e2["f"] for e2 in entries}]
    data = {"w": mouth["w"], "h": mouth["h"], "model": MODEL, "keys": sorted(keep + entries, key=lambda e: e["f"])}
    (folder / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    for p in tmp.glob("*"):
        p.unlink()
    tmp.rmdir()
    store.mutate_item(iid, lambda x: x["variants"][vid]["orbit"].update(lips=int(time.time() * 1000)))
    if rows:
        z = 3
        cell = max(r[1][0].width for r in rows) * z
        sheet = Image.new("RGB", (cell * 5, sum(r[1][0].height * z for r in rows)), "white")
        yy = 0
        for k, row, _ in rows:
            for c, im in enumerate(row):
                sheet.paste(im.resize((im.width * z, im.height * z), Image.LANCZOS), (c * cell, yy))
            yy += row[0].height * z
        out = settings.DATA / "qa" / ("levres-%s-%s.jpg" % (iid, vid))
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out, quality=88)
        print("planche", out)
    print("%d image(s)-cle, %d carte(s)" % (len(entries), sum(len(e["cards"]) for e in entries)))


if __name__ == "__main__":
    main()
