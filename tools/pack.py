"""Paquets de personnages et bibliotheque en ligne, sans passer par l'interface.

  python tools/pack.py export SORTIE.bwpack --dossier "Dessins/Footeux"        tout un dossier de la banque (un seul paquet)
  python tools/pack.py export SORTIE.bwpack --ids le-blafard,autre-id          des elements precis
  python tools/pack.py import PAQUET.bwpack [--remplacer]                      verse un paquet dans la banque
  python tools/pack.py bibliotheque DOSSIER_DE_SORTIE --dossier "Dessins" [--nom "..."] [--identifiant board --mot-de-passe ...]
        fabrique le dossier a deposer sur l'hebergement : un paquet et une vignette par element, index.json, et la
        protection par mot de passe (.htaccess + .htpasswd). Relance : seuls les elements modifies sont refaits.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import packs  # noqa: E402


def show(n, total, name):
    print("  %d/%d  %s" % (n + 1, total, name), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["export", "import", "bibliotheque"])
    ap.add_argument("chemin")
    ap.add_argument("--dossier", default="")
    ap.add_argument("--type", default="", help="character, decor ou asset (avec --dossier)")
    ap.add_argument("--ids", default="")
    ap.add_argument("--remplacer", action="store_true")
    ap.add_argument("--nom", default="Bibliothèque Board Wizzard")
    ap.add_argument("--identifiant", default="board")
    ap.add_argument("--mot-de-passe", default="")
    a = ap.parse_args()
    try:
        if a.action == "import":
            r = packs.import_pack(a.chemin, replace=a.remplacer)
            for k, label in (("added", "ajoutés"), ("replaced", "remplacés"), ("skipped", "déjà là, laissés tels quels")):
                if r[k]:
                    print("%d %s : %s" % (len(r[k]), label, ", ".join(x["name"] for x in r[k])))
            return
        ids = packs.select([i for i in a.ids.split(",") if i] or None, a.dossier, a.type or None)
        if a.action == "export":
            man = packs.export(ids, a.chemin, show)
            print("%d élément(s), %.0f Mo : %s" % (len(man["items"]), Path(a.chemin).stat().st_size / 1e6, a.chemin))
        else:
            idx = packs.build_library(ids, a.chemin, a.nom, a.identifiant, a.mot_de_passe, show)
            print("%d élément(s) dans la bibliothèque : %s" % (len(idx["items"]), a.chemin))
    except packs.PackError as e:
        sys.exit("Erreur : %s" % e)


if __name__ == "__main__":
    main()
