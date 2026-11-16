"""Planches de controle des orbites de la banque : 8 vues par orbite, sur fond bleu (le detourage se voit).

    python tools/qa.py [filtre] [--new]      -> data/qa/<element>__<variante>.jpg et data/qa/_index.jpg (mosaique)
--new : seulement les orbites qui n'ont pas encore leur planche.
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import settings  # noqa: E402

BANK = settings.DATA / "bank"
OUT = settings.DATA / "qa"


def sheet(item, vid, orbit, th=260):
    n = orbit["n"]
    ims = []
    for k in range(8):
        f = BANK / item["id"] / orbit["dir"] / ("%03d.webp" % (round(k * n / 8) % n))
        im = Image.open(f).convert("RGBA")
        im = im.resize((max(1, round(im.width * th / im.height)), th))
        ims.append(im)
    w = max(i.width for i in ims)
    out = Image.new("RGBA", (w * 8, th), (70, 120, 190, 255))
    for k, im in enumerate(ims):
        out.alpha_composite(im, (k * w + (w - im.width) // 2, 0))
    return out.convert("RGB")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flt = args[0].lower() if args else ""
    only_new = "--new" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for f in sorted(BANK.glob("*/item.json")):
        it = json.loads(f.read_text(encoding="utf-8"))
        if flt and flt not in (it["id"] + " " + it.get("folder", "") + " " + it["kind"]).lower():
            continue
        for vid, v in it["variants"].items():
            o = v.get("orbit")
            if not o:
                continue
            dest = OUT / ("%s__%s__%s.jpg" % (it["id"], vid, o["dir"].split("/")[-1]))
            if only_new and dest.exists():
                continue
            try:
                sheet(it, vid, o).save(dest, quality=82)
                made.append(dest)
            except OSError as exc:
                print("illisible", it["id"], vid, exc)
    print(len(made), "planches dans", OUT)
    if made:                                   # mosaique des planches faites a cet appel (12 par image)
        for page in range(0, len(made), 12):
            ims = [Image.open(p) for p in made[page:page + 12]]
            ims = [i.resize((1000, max(1, round(i.height * 1000 / i.width)))) for i in ims]
            m = Image.new("RGB", (2000, sum(i.height for i in ims[::2]) + 4), (30, 30, 30))
            y = 0
            for k in range(0, len(ims), 2):
                m.paste(ims[k], (0, y))
                if k + 1 < len(ims):
                    m.paste(ims[k + 1], (1000, y))
                y += ims[k].height
            m.save(OUT / ("_index_%02d.jpg" % (page // 12)), quality=80)
            print(" ", OUT / ("_index_%02d.jpg" % (page // 12)), [p.name.split("__")[0] for p in made[page:page + 12]])


if __name__ == "__main__":
    main()
