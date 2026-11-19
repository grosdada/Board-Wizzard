"""Banque d'elements de visage du portrait-robot (voir app/parts.py).

  python tools/parts.py liste                         les categories, et ce qui est deja fait
  python tools/parts.py generer nez bouche            genere les elements qui manquent de ces categories (toutes si aucune)
  python tools/parts.py generer nez --seul "Aquilin" --graine 23 --refaire      refait un element avec une autre graine
  python tools/parts.py generer --machine 2           choisit la machine ComfyUI (numero dans la liste) ; --fal : sur fal
  python tools/parts.py planches                      planches de controle dans data/qa/parts/<categorie>.jpg
  python tools/parts.py retirer nez aquilin           enleve un element rate
  python tools/parts.py redecouper visage nez         refait la decoupe depuis les images d'origine, sans regenerer
  python tools/parts.py dessiner yeux nez             trace les categories par le calcul (app/partsdraw.py), les controle
                                                      (zone, paires, elements trop semblables) et ne les range que si tout
                                                      est bon ; sans nom : toutes les categories tracees. --controle : sans ranger

Si data/parts/style.png existe, les elements sont dessines dans le trait de cette planche (modele d'edition) ; sinon
par le modele d'image seul. L'image d'origine de chaque element est gardee dans data/parts/_brut/.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import falapi, jobs, parts, settings  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["liste", "generer", "planches", "retirer", "redecouper", "dessiner"])
    ap.add_argument("noms", nargs="*")
    ap.add_argument("--seul", default="")
    ap.add_argument("--graine", type=int, default=11)
    ap.add_argument("--refaire", action="store_true")
    ap.add_argument("--machine", type=int, default=1)
    ap.add_argument("--fal", action="store_true")
    ap.add_argument("--controle", action="store_true")
    a = ap.parse_args()
    idx = parts.index()
    if a.action == "liste":
        for cat, (label, _, _, els) in parts.CATEGORIES.items():
            print("%-12s %-22s %2d / %2d" % (cat, label, len(idx.get(cat, [])), len(els)))
        return
    if a.action == "retirer":
        parts.remove(a.noms[0], parts.slug(a.noms[1]))
        return
    if a.action == "dessiner":
        from app import partsdraw
        ok = True
        for c in [c for c in (a.noms or partsdraw.CATEGORIES) if c in partsdraw.CATEGORIES]:
            if a.controle:
                fn, var = partsdraw.CATEGORIES[c]
                bad = parts.check_drawn(c, [(n,) + fn(seed=i + 1, **kw) for i, (n, kw) in enumerate(var)])
                n = 0
            else:
                n, bad = parts.draw_bank(c)
            print("%-10s %s" % (c, ("%d élément(s) rangé(s)" % n) if n else ("contrôle bon" if not bad else "REFUSÉ")), flush=True)
            for b in bad:
                ok = False
                print("     -", b, flush=True)
        sys.exit(0 if ok else 1)
    cats = [c for c in (a.noms or parts.CATEGORIES) if c in parts.CATEGORIES]
    if a.action == "redecouper":                                    # sans regenerer : depuis les images d'origine
        for c in cats:
            print(c, parts.recut(c), "élément(s) redécoupé(s)")
        return
    if a.action == "planches":
        for c in cats:
            d = parts.sheet(c, settings.DATA / "qa" / "parts" / (c + ".jpg"))
            if d:
                print(d)
        return
    if a.fal:
        prov = falapi.FalProvider(settings.load()["fal"].get("key") or "", {})
    else:
        ws = settings.workers()
        if not ws:
            sys.exit("Aucune machine ComfyUI déclarée : utiliser --fal")
        w = ws[min(len(ws), max(1, a.machine)) - 1]
        print("machine :", w["name"], flush=True)
        prov = jobs.LocalProvider(w["url"], {})
    t0, done = time.time(), 0
    for c in cats:
        for name, desc in parts.CATEGORIES[c][3]:
            if a.seul and parts.slug(a.seul) != parts.slug(name):
                continue
            try:
                r = parts.make(c, name, desc, prov, seed=a.graine, redo=a.refaire)
                if r:
                    done += 1
                    print("%5.0f s  %s / %s  (%d x %d)" % (time.time() - t0, c, name, r["w"], r["h"]), flush=True)
            except Exception as e:  # noqa: BLE001
                print("ECHEC %s / %s : %s" % (c, name, str(e)[:200]), flush=True)
    print("FIN :", done, "élément(s) fait(s)", flush=True)


if __name__ == "__main__":
    main()
