"""Convertit en traces les orbites de dessins deja calculees (les nouvelles le sont toutes seules).

    python tools/vectorize.py                 tous les elements de style « dessin » (personnages, objets, decors)
    python tools/vectorize.py <element> ...   seulement ceux-la
    python tools/vectorize.py --force         refait aussi ceux qui ont deja leurs traces
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import store, vector  # noqa: E402


def main():
    if not vector.available():
        sys.exit("opencv manque : pip install opencv-python-headless")
    force = "--force" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    done = 0
    for it in store.list_items():
        if (only and it["id"] not in only) or (not only and it.get("style") != "dessin"):
            continue
        d = store.item_dir(it["id"])
        for vid, v in it["variants"].items():
            o = v.get("orbit")
            if not o or (o.get("vec") and not force and (d / o["dir"] / "vec.json").exists()):
                continue
            vector.orbit(d / o["dir"], o["n"])

            def mark(x, vid=vid, rel=o["dir"]):
                cur = x["variants"].get(vid, {}).get("orbit")
                if cur and cur.get("dir") == rel:                 # l'orbite n'a pas ete refaite entre-temps
                    cur["vec"] = True
                    cur["vt"] = int(time.time())               # version des traces : le navigateur les recharge
            store.mutate_item(it["id"], mark)
            done += 1
            print("traces :", it["id"], vid, flush=True)
    print(done, "orbite(s) converties")


if __name__ == "__main__":
    main()
