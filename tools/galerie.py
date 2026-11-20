"""Galerie de personnages du portrait-robot : des tetes transposees de portraits de face, posees sur des corps traces.

  python tools/galerie.py planche           planche de controle data/qa/galerie.jpg (photo | personnages), sans rien ranger
  python tools/galerie.py ranger            cree les personnages dans la banque, dossier « Galerie portraits-robots »
                                            (un personnage deja present, meme nom dans ce dossier, n'est pas refait)

Les portraits source et leurs points sont dans data/tmp/tpdne (tools/facepoints.py). Chaque source donne deux
personnages : meme visage mesure, coiffure, pilosite, lunettes et corps differents (choisis a la main, voir CAST).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image, ImageDraw  # noqa: E402

from app import bodydraw, jobs, settings, store, transpose  # noqa: E402

SRC = settings.DATA / "tmp" / "tpdne"
FOLDER = "Galerie portraits-robots"
B = dict(bodydraw.CORPS_VARIANTES)
# (source, nom, ce que les points ne disent pas, corps)
CAST = [
    ("p18", "Armand", dict(cheveux="courts", lunettes="Rectangulaires", barbe="Bouc", moustache="Chevron"), "Costume"),
    ("p18", "Basile", dict(cheveux="gomines", barbe="Courte, pleine"), "Sweat à capuche, baskets"),
    ("p57", "Colette", dict(cheveux="mi-longs", oreilles="Petite"), "Jupe et blouse"),
    ("p57", "Denise", dict(cheveux="carre", lunettes="Papillon"), "Robe"),
    ("p22", "Émile", dict(cheveux="courts"), "Moyen, t-shirt et pantalon"),
    ("p22", "Firmin", dict(cheveux="brosse", barbe="Trois jours", oreilles="Décollée"), "Salopette, bottes"),
    ("p37", "Gisèle", dict(cheveux="ondules"), "Robe"),
    ("p37", "Hortense", dict(cheveux="chignon", lunettes="Rondes"), "Mince, chemise"),
    ("p19", "Inès", dict(cheveux="chignon"), "Robe"),
    ("p19", "Jeanne", dict(cheveux="longs-raides"), "Jupe et blouse"),
    ("p42", "Kléber", dict(cheveux="brosse"), "Costaud, t-shirt"),
    ("p42", "Lucien", dict(cheveux="degarni", moustache="Large, droite", oreilles="Lobe long"), "Rond, pull"),
    ("p59", "Marius", dict(cheveux="afro"), "Sweat à capuche, baskets"),
    ("p59", "Nestor", dict(cheveux="dreadlocks", barbe="Bouc"), "Débardeur et short"),
    ("p24", "Odile", dict(cheveux="carre"), "Mince, chemise"),
    ("p24", "Paulette", dict(cheveux="frange", lunettes="Grandes, années 70"), "Rond, pull"),
    ("p32", "Quentin", dict(cheveux="degarni", lunettes="Ovales fines"), "Costume"),
    ("p32", "Raoul", dict(cheveux="raie-de-cote", lunettes="Rectangulaires épaisses", moustache="Fine, au crayon"), "Petit, trapu"),
    ("p31", "Suzanne", dict(cheveux="longs-raides"), "Moyen, t-shirt et pantalon"),
    ("p31", "Thérèse", dict(cheveux="tresses"), "Salopette, bottes"),
]


def make(src, extras, body, seed):
    d = json.loads((SRC / (src + ".json")).read_text(encoding="utf-8"))
    kw, _ = transpose.fit(d["points"], d.get("shapes"), d.get("matrix"))
    head = transpose.head(kw, extras, seed)
    return bodydraw.personnage(head, B[body], seed, nom=body), head


def flat(im, bg=(255, 255, 255)):
    out = Image.new("RGB", im.size, bg)
    out.paste(im, (0, 0), im)
    return out


def main():
    act = sys.argv[1] if len(sys.argv) > 1 else "planche"
    only = sys.argv[2:]
    cast = [c for c in CAST if not only or c[1] in only]
    if act == "planche":
        th = 620
        tiles = []
        for i, (src, name, ex, body) in enumerate(cast):
            im, head = make(src, ex, body, i + 1)
            person = flat(im, (255, 214, 122)); person.thumbnail((th, th))
            hd = flat(head.crop((150, 60, 850, 1000)), (255, 214, 122)); hd.thumbnail((300, 300))
            ph = Image.open(SRC / (src + ".jpg")).convert("RGB").resize((300, 300))
            t = Image.new("RGB", (300 + person.width + 10, th + 18), "white")
            t.paste(ph, (0, 18)); t.paste(hd, (0, 320)); t.paste(person, (305, 18))
            ImageDraw.Draw(t).text((4, 3), "%s (%s) · %s" % (name, src, body), fill="black")
            tiles.append(t)
            print(name, flush=True)
        cols = 5
        w = max(t.width for t in tiles)
        sheet = Image.new("RGB", (cols * w, -(-len(tiles) // cols) * (th + 18)), "white")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * w, (i // cols) * (th + 18)))
        out = settings.DATA / "qa" / "galerie.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out, quality=86)
        print(out, sheet.size)
        return
    if act == "ranger":
        have = {it["name"] for it in store.list_items() if it.get("folder") == FOLDER}
        tmp = settings.DATA / "tmp" / "galerie"
        tmp.mkdir(parents=True, exist_ok=True)
        for i, (src, name, ex, body) in enumerate(cast):
            if name in have:
                print("deja la :", name)
                continue
            im, _ = make(src, ex, body, i + 1)
            f = tmp / (name + ".png")
            flat(im).save(f)
            it = jobs.add_item("character", name, f, style="dessin", tags=["portrait-robot", "galerie"], folder=FOLDER)
            print("cree :", name, it["id"], flush=True)


if __name__ == "__main__":
    main()
