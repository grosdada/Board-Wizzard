"""Orbites parties d'un gros plan (portrait seul envoye en banque) : leurs premieres images montrent la tete seule, le reste
le personnage en pied. Remplace ces premieres images par la premiere en pied et refait la vignette.

  python tools/enpied.py [ids]            liste les orbites concernees
  python tools/enpied.py --reparer [ids]  les corrige (originaux dans data/backup/enpied/<id>/<variante>/)
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from app import settings, sprites, store  # noqa: E402


def count(folder, n):
    mask = lambda i: np.asarray(Image.open(folder / ("%03d.webp" % i)).convert("RGBA"))[..., 3] > 60
    iou = lambda a, b: (a & b).sum() / max(1, (a | b).sum())
    prev = mask(0)
    for i in range(1, 9):
        cur = mask(i)
        if iou(prev, cur) < 0.7:
            return i
        prev = cur
    return 0


def main():
    fix = "--reparer" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for it in store.list_items():
        if it["kind"] != "character" or (only and it["id"] not in only):
            continue
        x = store.load_item(it["id"])
        d = store.item_dir(it["id"])
        for vid, v in x["variants"].items():
            o = v.get("orbit") or {}
            if not o.get("dir") or not (d / o["dir"] / "000.webp").exists():
                continue
            try:
                k = count(d / o["dir"], int(o["n"]))
            except Exception as e:  # noqa: BLE001
                print("illisible :", it["id"], vid, e)
                continue
            if not k:
                continue
            print("%s / %s : %d image(s) en gros plan" % (it["id"], vid, k), flush=True)
            if not fix:
                continue
            n = int(o["n"])
            sprites.fix_closeup_start(d / o["dir"], n, keep=settings.DATA / "backup" / "enpied" / it["id"] / vid)
            vec = d / o["dir"] / "vec.json"
            if vec.exists():                                   # les traces suivent les images
                j = json.loads(vec.read_text(encoding="utf-8"))
                (settings.DATA / "backup" / "enpied" / it["id"] / vid / "vec.json").write_text(json.dumps(j), encoding="utf-8")
                for i in range(k):
                    j["frames"][i] = j["frames"][k]
                vec.write_text(json.dumps(j), encoding="utf-8")
            if vid == "base":
                sprites.thumb_frame(d / o["dir"] / "000.webp", d / "thumb.jpg")

            def fn(y, vid=vid, dr=o["dir"], k=k):
                oo = (y["variants"].get(vid) or {}).get("orbit") or {}
                if oo.get("dir") == dr:
                    oo["closeup"], oo["t"], oo["vt"] = k, int(time.time()), int(time.time())
                y["updated"] = int(time.time())
            store.mutate_item(it["id"], fn)


if __name__ == "__main__":
    main()
