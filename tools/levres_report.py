"""Reporte les bouches dessinees d'une orbite sur une autre (gratuit) : meme personnage, autre pose ou orbite refaite.

    python tools/levres_report.py <element> <variante> <element cible> <variante cible>

Les cartes (tools/levres.py) et leurs gommes sont copiees dans l'orbite cible avec, pour chaque image-cle, la bouche suivie de l'orbite
d'origine (up0). A l'affichage (lipsync.cardMarkup) la carte est recalee sur la bouche suivie de l'orbite cible : place,
taille, inclinaison. Il faut que la bouche soit suivie dans la cible (montage : « Tracer la bouche »). Une image-cle garde
son angle : son numero est rapporte au nombre d'images de la cible. Sert a ne dessiner les bouches qu'une fois (sur la
base) et a garder celles d'une orbite qu'on refait.
"""

import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import store  # noqa: E402


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    si, sv, di, dv = sys.argv[1:5]
    s_it, d_it = store.load_item(si), store.load_item(di)
    so, do = s_it["variants"][sv]["orbit"], d_it["variants"][dv]["orbit"]
    sf, df = store.item_dir(si) / so["dir"], store.item_dir(di) / do["dir"]
    lips = json.loads((sf / "lips.json").read_text(encoding="utf-8"))
    smouth = json.loads((sf / "mouth.json").read_text(encoding="utf-8"))["frames"]
    try:
        dmouth = json.loads((df / "mouth.json").read_text(encoding="utf-8"))["frames"]
    except OSError:
        sys.exit("la bouche n'est pas suivie dans l'orbite cible : trace-la d'abord dans le montage")
    (df / "lips").mkdir(exist_ok=True)
    keys = []
    for k in lips["keys"]:
        m = smouth[k["f"]]
        if not m:
            continue
        f = round(k["f"] * do["n"] / so["n"]) % do["n"]
        near = min((min(abs(i - f), do["n"] - abs(i - f)) for i, x in enumerate(dmouth) if x), default=99)
        if near > 4:                                            # aucun angle suivi pres de cette cle dans la cible
            print("image-cle %d : pas de bouche suivie a cet angle dans la cible, laissee" % k["f"])
            continue
        cards, gom = {}, {}
        for sh, rel in k["cards"].items():
            name = "lips/r%03d_%s.webp" % (f, sh)
            shutil.copyfile(sf / rel, df / name)
            cards[sh] = name
            g = (k.get("gom") or {}).get(sh)                    # la gomme suit la carte (meme place, meme recalage)
            if g and (sf / g).exists():
                shutil.copyfile(sf / g, df / (name[:-5] + "_g.webp"))
                gom[sh] = name[:-5] + "_g.webp"
            else:
                (df / (name[:-5] + "_g.webp")).unlink(missing_ok=True)
        keys.append({"f": f, "x": k["x"], "y": k["y"], "s": k["s"], "cards": cards, "up0": [m["up"][0], m["up"][-1]],
                     "from": "%s/%s" % (si, sv)})
        if gom:
            keys[-1]["gom"] = gom
        if k.get("dos"):
            keys[-1]["dos"] = 1                          # carte de dos : reste servie aux images de dos de la pose
    data = {"w": lips["w"], "h": lips["h"], "model": lips.get("model", ""), "keys": sorted(keys, key=lambda e: e["f"])}
    (df / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    store.mutate_item(di, lambda x: x["variants"][dv]["orbit"].update(lips=int(time.time() * 1000)))
    print("%d image(s)-cle reportee(s) de %s/%s vers %s/%s" % (len(keys), si, sv, di, dv))


if __name__ == "__main__":
    main()
