"""Banque de corps du portrait-robot : chaque corps trace par le calcul (app/bodydraw.py) sert de guide de pose et de
tenue, et le modele d'edition d'image le redessine a l'encre. La tete n'est pas dessinee par le modele : celle du
portrait-robot est posee par-dessus (voir bodydraw.personnage).

  python tools/corps.py encrer                 encre les corps qui manquent (data/bodies/<id>.png, guide dans _guide/)
  python tools/corps.py encrer "Costume" --refaire --graine 7 --machine 2
  python tools/corps.py planche                data/qa/corps.jpg : guide | encre, pour controle
  python tools/corps.py decouper               coupe chaque corps encre en torse, bras, mains, jambes, chaussures pour le
                                               generateur de corps (app/bodycut.py), planches dans data/qa/corps-el/ ;
                                               --refaire : recoupe ceux deja faits
"""
import argparse
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image, ImageDraw  # noqa: E402

from app import bodydraw, jobs, settings, store  # noqa: E402

ROOT = settings.DATA / "bodies"
PROMPT = ("This is a rough schematic of a standing character seen strictly from the front, with a blank oval in place of the head. "
          "Redraw it as a clean hand-drawn black ink line drawing of the same person: same pose, same proportions and build, same "
          "clothes ({tenue}), arms hanging slightly away from the body, feet on the ground. Draw natural rounded shoulders with the sleeve "
          "seam, real hands with fingers, "
          "believable clothing with a few folds, seams and details, proper shoes. Keep the head as a completely blank white oval with "
          "no face, no hair and no ears, and keep the neck. Confident ink outline of even medium weight, white inside, pure white "
          "background, no grey shading, no hatching, no colour, no text, no ground line. Full figure from head to feet, centred.")
TENUES = {"tshirt": "a plain t-shirt", "chemise": "a buttoned shirt with a collar", "veste": "a suit jacket over a shirt and tie", "sweat": "a hooded sweatshirt with a front pocket",
          "debardeur": "a sleeveless tank top", "pull": "a knitted jumper", "blouse": "a blouse with buttons", "pantalon": "trousers", "short": "shorts", "jupe": "a knee-length skirt",
          "robe": "a simple knee-length dress", "salopette": "dungarees with a bib and straps", "chaussures": "leather shoes", "bottes": "boots", "baskets": "sneakers"}


def guide(kw, seed):
    """Le corps trace, sur fond blanc, avec un ovale vide a la place de la tete."""
    body, place = bodydraw.corps(seed=seed, **kw)
    im = Image.new("RGB", (bodydraw.W, bodydraw.H), "white")
    im.paste(body, (round(place[0] - body.width / 2), round(place[1] - body.height / 2)), body)
    s = bodydraw.HEAD_SCALE
    d = ImageDraw.Draw(im)
    d.ellipse([500 - 250 * s, bodydraw.CHIN - 730 * s, 500 + 250 * s, bodydraw.CHIN], fill="white", outline="black", width=4)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["encrer", "planche", "decouper"])
    ap.add_argument("noms", nargs="*")
    ap.add_argument("--refaire", action="store_true")
    ap.add_argument("--graine", type=int, default=11)
    ap.add_argument("--machine", type=int, default=1)
    a = ap.parse_args()
    var = [(n, kw) for n, kw in bodydraw.CORPS_VARIANTES if not a.noms or n in a.noms]
    if a.action == "decouper":
        from app import bodycut
        n = sum(bodycut.decouper(refaire=a.refaire, seul=nom) for nom, _ in var)
        for c in bodycut.CATS:
            bodycut.planche(c, settings.DATA / "qa" / "corps-el" / (c + ".jpg"))
        print(n, "élément(s) découpé(s) ; planches dans", settings.DATA / "qa" / "corps-el")
        return
    if a.action == "planche":
        tiles = []
        for n, kw in var:
            f = ROOT / (store.slug(n) + ".png")
            g = ROOT / "_guide" / (store.slug(n) + ".png")
            if not f.exists():
                continue
            t = Image.new("RGB", (520, 540), "white")
            for i, p in enumerate((g, f)):
                im = Image.open(p).convert("RGB"); im.thumbnail((255, 510))
                t.paste(im, (i * 260, 22))
            ImageDraw.Draw(t).text((4, 4), n, fill="black")
            tiles.append(t)
        sheet = Image.new("RGB", (520 * 4, 540 * -(-len(tiles) // 4)), "white")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 4) * 520, (i // 4) * 540))
        out = settings.DATA / "qa" / "corps.jpg"
        sheet.save(out, quality=86)
        print(out)
        return
    ws = settings.workers()
    w = ws[min(len(ws), max(1, a.machine)) - 1]
    print("machine :", w["name"], flush=True)
    prov = jobs.LocalProvider(w["url"], {})
    (ROOT / "_guide").mkdir(parents=True, exist_ok=True)
    for i, (n, kw) in enumerate(var):
        dest = ROOT / (store.slug(n) + ".png")
        if dest.exists() and not a.refaire:
            continue
        p = dict(bodydraw.CORPS, **kw)
        tenue = ", ".join(TENUES[p[k]] for k in ("haut", "bas", "pieds") if not (p["bas"] == "robe" and k == "haut"))
        g = guide(kw, i + 1)
        gp = ROOT / "_guide" / dest.name
        g.save(gp)
        tmp = Path(tempfile.mkdtemp(prefix="bwcorps_"))
        t0 = time.time()
        try:
            png = prov.edit([gp], PROMPT.format(tenue=tenue), a.graine, tmp)
            Image.open(png).convert("RGB").save(dest)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        print("%4.0f s  %s" % (time.time() - t0, n), flush=True)


if __name__ == "__main__":
    main()
