"""Vues de dos et de profil propres a une pose (fal, Nano Banana Pro) : references de son orbite.

    python tools/vues_pose.py <element> <variante> [<variante>...]     # payant : 3 images fal par variante
    python tools/vues_pose.py <element> --manquantes                   # toutes les poses qui n'ont pas encore leurs vues

Les vues de la base, dans une autre attitude, deteignent sur l'orbite d'une pose (bras en trop, mains qui retournent dans
les poches) ; sans vues du tout, les profils sortent plats. Les images vont dans v/<variante>/sheet/ et sont inscrites
dans variants[v].sheet : l'orbite suivante les prend d'elle-meme (jobs.run_item_orbit). Une planche de controle est ecrite
dans data/qa/vues-<element>-<n>.jpg : la regarder avant de lancer les orbites.
"""

import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import falapi, poses, settings, sprites, store  # noqa: E402

MODEL = "fal-ai/nano-banana-pro/edit"
SAME = ("Exactly the same pose: the arms, the hands, the legs and whatever the character holds stay exactly where they are in "
        "the reference, nothing else moves. The character wears exactly what it wears in the reference and nothing more: add no "
        "garment, no underwear, no shorts, no accessory. The head and the body keep real volume and thickness seen from this angle. ")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    iid = args[0]
    it = store.load_item(iid)
    d = store.item_dir(iid)
    vids = args[1:]
    if "--manquantes" in sys.argv:
        vids = [k for k, v in it["variants"].items() if k != "base" and not v.get("sheet")]
    if not vids:
        sys.exit("aucune variante a traiter")
    key = settings.load()["fal"].get("key")
    prov = falapi.FalProvider(key, {})
    done, lock = {}, threading.Lock()

    def work(vid, view, desc, url):
        try:
            out = falapi.FalProvider(key, {}).run(MODEL, {"prompt": "%s %s%s" % (desc, SAME, poses.FAITHFUL), "image_urls": [url],
                                                             "num_images": 1, "aspect_ratio": "9:16"})
            tmp = d / "v" / vid / "sheet" / (view + ".tmp.png")
            tmp.parent.mkdir(parents=True, exist_ok=True)
            prov.fetch(out["images"][0]["url"], tmp)
            sprites.normalize(tmp, tmp.with_name(view + ".png"))
            tmp.unlink()
            with lock:
                done.setdefault(vid, {})[view] = "v/%s/sheet/%s.png" % (vid, view)
            print("ok", vid, view, flush=True)
        except Exception as e:                                       # noqa: BLE001
            print("ERREUR", vid, view, repr(e)[:300], flush=True)

    sem = threading.Semaphore(9)

    def guarded(*a):
        with sem:
            work(*a)

    ts = []
    for vid in vids:
        url = prov.upload(d / it["variants"][vid]["ref"])
        ts += [threading.Thread(target=guarded, args=(vid, view, desc, url)) for view, desc in poses.SHEET_VIEWS]
    [t.start() for t in ts]
    [t.join() for t in ts]

    full = {vid: s for vid, s in done.items() if len(s) == len(poses.SHEET_VIEWS)}

    def apply(x):
        for vid, s in full.items():
            x["variants"][vid]["sheet"] = s
    store.mutate_item(iid, apply)

    from PIL import Image
    qa = settings.DATA / "qa"
    qa.mkdir(parents=True, exist_ok=True)
    order = [v for v, _ in poses.SHEET_VIEWS]
    rows = [vid for vid in vids if vid in full]
    for part in range(0, len(rows), 4):
        chunk = rows[part:part + 4]
        sheet = Image.new("RGB", (4 * 300, len(chunk) * 500), "white")
        for r, vid in enumerate(chunk):
            for c, p in enumerate([d / it["variants"][vid]["ref"]] + [d / full[vid][v] for v in order]):
                im = Image.open(p).convert("RGB")
                im.thumbnail((296, 496))
                sheet.paste(im, (c * 300, r * 500))
        out = qa / ("vues-%s-%d.jpg" % (iid, part // 4))
        sheet.save(out, quality=86)
        print("planche", out)
    print("%d variante(s) avec leurs vues, %d incomplete(s) : %s" % (len(full), len(vids) - len(full),
                                                                     ", ".join(v for v in vids if v not in full)))


if __name__ == "__main__":
    main()
