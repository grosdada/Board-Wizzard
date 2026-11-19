"""Orbites « exposees a deux » : chaque image y est deux fois de suite (les videos H3 de fal : 124 images pour 62
dessins). On n'en garde qu'une de chaque paire, pour ne pas retoucher deux fois la meme image.

  python tools/doublons.py                 liste les orbites doublees (ne change rien)
  python tools/doublons.py --corriger      retire les doublons (ils vont dans data/backup/doublons/), garde l'angle des cases
  python tools/doublons.py costard --corriger     seulement les elements dont l'identifiant contient « costard »
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import retouch, sprites, store  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filtre", nargs="?", default="")
    ap.add_argument("--corriger", action="store_true")
    a = ap.parse_args()
    n = 0
    for it in store.list_items():
        if it.get("body") or a.filtre not in it["id"]:
            continue
        for vid, v in it["variants"].items():
            o = v.get("orbit") or {}
            if not o.get("n"):
                continue
            try:
                if a.corriger:
                    r = retouch.dedupe(it["id"], vid)
                    if r:
                        n += 1
                        print("%-40s %-18s %d -> %d images" % (it["id"], vid, r["before"], r["after"]), flush=True)
                else:
                    d = store.item_dir(it["id"]) / o["dir"]
                    files = [d / ("%03d.webp" % f) for f in range(o["n"])]
                    if all(f.exists() for f in files) and len(sprites.singles(files)) < o["n"]:
                        n += 1
                        print("%-40s %-18s %d images, doublées" % (it["id"], vid, o["n"]), flush=True)
            except Exception as e:  # noqa: BLE001
                print("ECHEC %s / %s : %s" % (it["id"], vid, e), flush=True)
    print("FIN :", n, "orbite(s)", "corrigée(s)" if a.corriger else "doublée(s)")


if __name__ == "__main__":
    main()
