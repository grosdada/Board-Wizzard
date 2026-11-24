"""Expressions du visage d'un personnage (cartes posees sur son orbite, sous la bouche du lip sync) : app/exprcards.py.

    python tools/expressions.py cadre <element> [--variante v]                    # planche des decoupes (gratuit) : sourcils compris ?
    python tools/expressions.py prep <element> <joie,colere,...> [--variante v] [--images 0,8,66] [--out DOSSIER]
    python tools/expressions.py assemble <element> <f> <rendu.png> <joie,colere,...> [--variante v] [--test]
    python tools/expressions.py fal <element> <joie,colere,...> [--variante v] [--images ...] --oui   # PAYANT
    python tools/expressions.py essai <element> [--variante v] [--retirer]        # fausses cartes (gratuit), pour l'affichage
    python tools/expressions.py retirer <element> [--variante v] [joie,...]
    python tools/expressions.py cuire <element> [--variante v] [--portee 4]     # cartes image par image (gratuit), apres assemble

prep (Dzine, gratuit pour nos personnages) : pour chaque image-cle (par defaut celles des bouches dessinees de face), une
grille 2x2 par groupe de quatre expressions, et expressions.json (fichier, consigne, ordre des cases). Les grilles se
tirent sur Dzine (Nano Banana Pro, 1:1) avec la consigne du manifeste ; chaque rendu repasse par assemble (memes
expressions, dans le meme ordre : haut-gauche, haut-droite, bas-gauche, bas-droite ; « - » pour une case inchangee).
fal : la meme chose sur fal, 1 image Nano Banana Pro par grille (cout annonce avant, --oui pour lancer).
essai : des sourcils et une bouche traces grossierement, pour verifier l'affichage sans rien payer ; --retirer les enleve.
Planches de controle : data/qa/expressions-<element>-<variante>.jpg.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import exprcards as ex, poses, settings  # noqa: E402

DEFAULT_OUT = settings.DATA / "dzine" / "expressions"


def opt(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def keys_of(s):
    out = [None if k in ("-", "") else k for k in s.split(",")]
    bad = [k for k in out if k and not poses.expression(k)]
    if bad:
        sys.exit("expression inconnue : %s (catalogue : %s)" % (", ".join(bad), ", ".join(k for k, *_ in poses.EXPRESSIONS)))
    return out


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    for o in ("--variante", "--images", "--out", "--portee"):
        if o in sys.argv:
            a.remove(sys.argv[sys.argv.index(o) + 1])
    if len(a) < 2:
        sys.exit(__doc__)
    cmd, iid, vid = a[0], a[1], opt("--variante", "base")
    frames = [int(v) for v in opt("--images").split(",")] if opt("--images") else None
    if cmd == "cadre":
        rows = []
        for f in frames or ex.default_frames(iid, vid):
            x, y, s, rgba, flat, m, _, _ = ex.crop(iid, vid, f)
            z = ex.face_zone(s, m["cx"] - x, m["cy"] - y, m["hw"], m["w"])
            shown = flat.copy()
            px = shown.load()
            edge = z ^ __import__("numpy").roll(z, 1, axis=0)
            for yy, xx in zip(*edge.nonzero()):
                px[int(xx), int(yy)] = (230, 40, 40)
            rows.append([flat, shown])
        print("planche", ex.sheet(rows, settings.DATA / "qa" / ("expressions-cadre-%s-%s.jpg" % (iid, vid))))
    elif cmd == "prep":
        out = Path(opt("--out", str(DEFAULT_OUT)))
        out.mkdir(parents=True, exist_ok=True)
        mf = out / "expressions.json"
        try:
            manifest = json.loads(mf.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            manifest = []
        keys = keys_of(a[2])                     # « joie,colere,joie,colere » : deux propositions par expression
        groups = ex.groups([k for k in keys if k]) if len(keys) != 4 else [keys]
        for f in frames or ex.default_frames(iid, vid):
            _, _, _, _, flat, _, _, _ = ex.crop(iid, vid, f)
            for n, g in enumerate(groups):
                name = "expr_%s_%s_%d_%d.png" % (iid, vid, f, n)
                ex.grid_from(flat).save(out / name)
                manifest = [e for e in manifest if e["fichier"] != name]
                manifest.append({"id": iid, "variante": vid, "f": f, "fichier": name, "expressions": ",".join(k or "-" for k in g),
                                 "prompt": ex.prompt(g, ex.NOTES.get(iid, "")), "ratio": "1:1", "taille": "1K", "modele": "Nano Banana Pro",
                                 "cases": dict(zip(ex.GRID, [k or "inchangee" for k in g]))})
                print("grille", out / name)
        mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        print("manifeste", mf)
    elif cmd == "assemble":
        f, path, keys = int(a[2]), a[3], keys_of(a[4])
        entry, row = ex.assemble(iid, vid, f, path, keys, test="--test" in sys.argv)
        print("planche", ex.sheet([row], settings.DATA / "qa" / ("expressions-%s-%s-%d%s.jpg" % (iid, vid, f, "-test" if "--test" in sys.argv else ""))))
    elif cmd == "fal":
        keys = [k for k in keys_of(a[2]) if k]
        fr = frames or ex.default_frames(iid, vid)
        usd = ex.estimate(len(keys), len(fr))
        print("%d expression(s) x %d image(s)-cle : %d grille(s), environ %.2f $" % (len(keys), len(fr), len(ex.groups(keys)) * len(fr), usd))
        if "--oui" not in sys.argv:
            sys.exit("rien n'est lance : ajouter --oui")
        print("planche", ex.run_fal({"params": {"item": iid}}, keys, fr, vid))
    elif cmd == "essai":
        if "--retirer" in sys.argv:
            ex.remove(iid, vid, ["joie", "colere", "tristesse", "surprise"])
            print("fausses cartes retirees")
            return
        keys = ["joie", "colere", "tristesse", "surprise"]
        rows = []
        for f in frames or ex.default_frames(iid, vid):
            _, row = ex.assemble(iid, vid, f, ex.fake_grid(iid, vid, f, keys), keys, model="essai")
            rows.append(row)
        print("planche", ex.sheet(rows, settings.DATA / "qa" / ("expressions-%s-%s-essai.jpg" % (iid, vid))))
    elif cmd == "cuire":
        print(len(ex.bake(iid, vid, int(opt("--portee", "4")), test="--test" in sys.argv)), "images cuites")
    elif cmd == "retirer":
        ex.remove(iid, vid, [k for k in keys_of(a[2]) if k] if len(a) > 2 else None)
        print("retire")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
