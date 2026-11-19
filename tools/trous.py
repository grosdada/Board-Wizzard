"""Trous dans les dessins de la banque : zones transparentes ou a moitie transparentes a l'interieur d'un personnage,
laissees par le detourage, par ou le decor se voit. Invisibles sur fond blanc.

  python tools/trous.py                      passe toute la banque en revue et liste les orbites touchees (ne change rien)
  python tools/trous.py footeux              seulement les elements dont l'identifiant contient « footeux »
  python tools/trous.py --reparer            rebouche les images et refait les traces des orbites touchees
  python tools/trous.py --reparer --part 0/4 un quart du travail (pour lancer quatre fois en parallele : 0/4 ... 3/4)

  python tools/trous.py footeux --vides      l'inverse : reperer les vides remplis a tort (sous un bras, entre les jambes, un
                                             coin referme). Ne change rien : ecrit une planche par orbite dans data/qa/vides/
                                             (rouge = vide sur, orange = doute)
  python tools/trous.py footeux --vides --appliquer     vide les zones sures (ajouter --doutes pour vider aussi les douteuses)

Avant de reecrire une image, l'originale est copiee dans data/backup/trous/<element>/... (une seule fois).
Le compte rendu va aussi dans data/qa/trous.txt. Seuls les elements en rendu « dessin » sont concernes (pas les decors).
"""
import argparse
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import retouch, settings, sprites, store, vector  # noqa: E402

MIN = 300          # pixels vraiment a jour dans une image pour qu'elle compte
GROS = 2500        # au-dela : un trou qui se voit dans une case
BACKUP = settings.DATA / "backup" / "trous"


def holes(path):
    """(pixels a jour au coeur du dessin, image, alpha rebouche) d'une image detouree."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)[..., 3]
    b = sprites.fill_holes(a, rim=False)
    return int(((a < 128) & (b == 255)).sum()), im, a, b


def keep(d, path):
    dest = BACKUP / d.name / path.relative_to(d)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)


def repair(d, path, quality):
    n, im, a, b = holes(path)
    if n < MIN:
        return 0
    keep(d, path)
    rgb = np.asarray(im)[..., :3].copy()
    rgb[(a < 40) & (b == 255)] = 255                                # sous un trou complet : papier blanc
    Image.fromarray(np.dstack([rgb, b])).save(path, quality=quality, method=4)
    return n


def mutate(iid, fn):
    for k in range(6):                                              # le serveur ecrit aussi les fiches : on reessaie
        try:
            return store.mutate_item(iid, fn)
        except OSError:
            time.sleep(1.5 + k)
    print("ECHEC fiche", iid, flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filtre", nargs="?", default="")
    ap.add_argument("--reparer", action="store_true")
    ap.add_argument("--part", default="0/1")
    ap.add_argument("--vides", action="store_true")
    ap.add_argument("--appliquer", action="store_true")
    ap.add_argument("--doutes", action="store_true")
    a = ap.parse_args()
    part, parts = (int(x) for x in a.part.split("/"))
    todo = []
    for it in store.list_items():
        if it.get("body") or it.get("style") != "dessin" or it.get("kind") == "decor" or a.filtre not in it["id"]:
            continue
        for vid, v in it["variants"].items():
            todo.append((it["id"], vid, v, "mannequin" in (it.get("tags") or [])))
    todo.sort(key=lambda x: (x[0], x[1]))
    t0, lines, touched = time.time(), [], 0
    for i, (iid, vid, v, man) in enumerate(todo):
        if i % parts != part:
            continue
        d = store.item_dir(iid)
        try:
            if a.vides:
                r = retouch.auto(iid, vid, apply=a.appliquer, doubts=a.doutes, sheet_dir=settings.DATA / "qa" / "vides")
                if r["sure"] or r["doubt"]:
                    line = "%-44s %-16s %3d zone(s) sûre(s), %3d douteuse(s), sur %d image(s)%s" % (
                        iid, vid, r["sure"], r["doubt"], len(r["frames"]), (" · %d vidée(s)" % r["emptied"]) if r.get("emptied") else "")
                    lines.append(line)
                    touched += 1
                    print(line, flush=True)
                continue
            o = v.get("orbit") or {}
            frames = [d / o["dir"] / ("%03d.webp" % f) for f in range(o.get("n") or 0)] if o.get("alpha", True) else []
            frames = [p for p in frames if p.exists()]
            cut = d / v["cut"] if v.get("cut") and (d / v["cut"]).exists() else None
            if not a.reparer:
                counts = [(holes(p)[0], int(p.stem)) for p in frames]
                bad = [(n, f) for n, f in counts if n >= MIN]
                big = [(n, f) for n, f in bad if n >= GROS]
                cn = holes(cut)[0] if cut else 0
                if bad or cn >= MIN:
                    worst = max(bad, default=(0, 0))
                    line = "%-44s %-16s %3d image(s) touchée(s), %3d gros trou(s)%s%s" % (
                        iid, vid, len(bad), len(big), (" · pire : image %d (%d px)" % (worst[1], worst[0])) if bad else "",
                        " · détourage fixe troué" if cn >= MIN else "")
                    lines.append(line)
                    touched += 1
                    print(line, flush=True)
                continue
            if cut and repair(d, cut, 90):
                mutate(iid, lambda x, vid=vid: x["variants"].get(vid, {}).update(t=int(time.time())))
            hit = [int(p.stem) for p in frames if repair(d, p, 86)]
            if not hit:
                continue
            if o.get("vec"):
                keep(d, d / o["dir"] / "vec.json")
                vector.orbit(d / o["dir"], o["n"], man)

            def bump(x, vid=vid, dr=o["dir"]):                      # le navigateur garde les images un jour : nouvelles adresses
                oo = (x["variants"].get(vid) or {}).get("orbit") or {}
                if oo.get("dir") == dr:
                    oo["vt"] = oo["t"] = int(time.time())
            mutate(iid, bump)
            touched += 1
            line = "%4d/%d %5.0f s  %s / %s : %d image(s) rebouchée(s)" % (i + 1, len(todo), time.time() - t0, iid, vid, len(hit))
            lines.append(line)
            print(line, flush=True)
        except Exception as e:  # noqa: BLE001
            print("ECHEC %s / %s : %s" % (iid, vid, e), flush=True)
    end = "FIN : %d orbite(s) %s sur %d variante(s) vues" % (touched, "reprise(s)" if a.reparer else "touchée(s)", len([1 for i in range(len(todo)) if i % parts == part]))
    print(end, flush=True)
    out = settings.DATA / "qa" / ("%s%s.txt" % ("vides" if a.vides else "trous", "" if parts == 1 else "-%d" % part))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join([time.strftime("%d/%m/%Y %H:%M"), "réparation" if a.reparer else "contrôle seul"] + lines + [end]) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
