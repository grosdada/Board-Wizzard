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
# le type de nez, de sourcils, de bouche et d'yeux est choisi a l'oeil sur la photo (nom d'une variante de la banque, dont
# on prend la forme ; les tailles restent celles mesurees) ; cheveux, pilosite, lunettes et corps font la variation
FACES = {
    "p18": dict(nez="Grand nez fort", sourcils=dict(poils=1, tout=0.3), yeux=dict(poche=1), oreilles="Moyenne"),
    "p57": dict(nez="Court retroussé", sourcils="Fins, arqués", bouche=dict(plein=0.5), yeux=dict(cils=1), oreilles="Petite"),
    "p22": dict(nez="Bout en boule", sourcils=dict(tout=0.4), bouche="Lèvres fines", yeux=dict(hood=0.5, cerne=1), oreilles="Décollée"),
    "p37": dict(nez="Petit bouton", sourcils="Clairsemés", bouche=dict(plein=0.8), yeux=dict(cils=1), oreilles="Collée"),
    "p19": dict(nez="Épaté, ailes évasées", sourcils="Arrondis en demi-lune", bouche=dict(plein=0.85), yeux=dict(cils=2), oreilles="Petite"),
    "p42": dict(nez="Ailes charnues", sourcils="Broussailleux", bouche="Lèvres fines", yeux=dict(poche=2, hood=0.4), oreilles="Grande"),
    "p59": dict(nez="Narines rondes ouvertes", sourcils=dict(poils=1, tin=1.0, tout=0.4), bouche=dict(plein=0.9), yeux={}, oreilles="Lobe attaché"),
    "p24": dict(nez="Long étroit", sourcils="Fins, arqués", bouche={}, yeux=dict(cils=1, poche=1), oreilles="Collée"),
    "p32": dict(nez="Bout pointu, narines pincées", sourcils="Clairsemés", bouche="Lèvres fines", yeux=dict(hood=0.3), oreilles="Très décollée, en feuille de chou"),
    "p31": dict(nez="Moyen droit", sourcils=dict(tout=0.2), bouche=dict(plein=0.8), yeux=dict(cils=2), oreilles="Petite"),
}
ACCENT = 1.8                                     # de combien on accentue ce qui distingue chaque visage de la moyenne
# (source, nom, ce que les points ne disent pas, corps)
CAST = [
    ("p18", "Armand", dict(cheveux="courts", lunettes="Rectangulaires", barbe="Bouc", moustache="Chevron"), "Costume"),
    ("p18", "Basile", dict(cheveux="gomines", barbe="Courte, pleine"), "Sweat à capuche, baskets"),
    ("p57", "Colette", dict(cheveux="mi-longs"), "Jupe et blouse"),
    ("p57", "Denise", dict(cheveux="carre", lunettes="Papillon"), "Robe"),
    ("p22", "Émile", dict(cheveux="courts"), "Moyen, t-shirt et pantalon"),
    ("p22", "Firmin", dict(cheveux="brosse", barbe="Trois jours"), "Salopette, bottes"),
    ("p37", "Gisèle", dict(cheveux="ondules"), "Robe"),
    ("p37", "Hortense", dict(cheveux="chignon", lunettes="Rondes"), "Mince, chemise"),
    ("p19", "Inès", dict(cheveux="chignon"), "Robe"),
    ("p19", "Jeanne", dict(cheveux="longs-raides"), "Jupe et blouse"),
    ("p42", "Kléber", dict(cheveux="brosse"), "Costaud, t-shirt"),
    ("p42", "Lucien", dict(cheveux="degarni", moustache="Large, droite"), "Rond, pull"),
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
    kw, _ = transpose.fit(d["points"], d.get("shapes"), d.get("matrix"), k=ACCENT)
    head = transpose.head(kw, dict(FACES.get(src, {}), **extras), seed, trait=bodydraw.HEAD_STROKE)
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
