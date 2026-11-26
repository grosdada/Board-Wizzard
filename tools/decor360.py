"""Décors en 360 « à plat » pour l'orbite de case sans génération (le décor défile comme sur un cylindre).

python tools/decor360.py liste                 inventaire : décors déjà en 360, décors à faire
python tools/decor360.py faire <id> [...]      crée « <Nom> 360 » à côté de chaque décor (l'ancien n'est pas touché)
python tools/decor360.py faire --tous          tous ceux qui restent
python tools/decor360.py planche [sortie.jpg]  planche de contrôle (data/qa/decors-360-cylindre.jpg)

Options de « faire » : --ext image.png  (suite du décor vers la droite, même hauteur de vue, collée après l'original)
                       --refaire         (réécrit le panorama et les 72 vues d'un « … 360 » déjà créé par cet outil)

Méthode (celle des 66 intérieurs 360, sans le fondu de bord) : la vue d'origine, cadrée en 1216 × 704, suivie de son
miroir ; les deux bords se raccordent exactement, sans couture. 72 vues : une fenêtre 1216 × 704 glisse le long de la
bande, d'un pas régulier (5° par image). L'image 0 est la vue d'origine, au pixel près. Aucun calcul sur les machines.
"""
import sys, json, time, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import numpy as np
from PIL import Image

W, H, N = 1216, 704, 72
ESSAI = "tourniquet 360 a plat (panorama)"
BANK = ROOT / "data" / "bank"
QA = ROOT / "data" / "qa" / "decors-360-cylindre.jpg"
# Décors qui ne s'y prêtent pas (raison donnée dans « liste » et sur la planche).
ECARTES = {
    "cathedrale-arche-interieure": "image en hauteur (896 × 1360) : cadrée en 16:9 il n'en reste qu'un tiers",
}


def decors():
    out = []
    for p in sorted(BANK.glob("*/item.json")):
        try:
            it = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if it.get("kind") == "decor":
            out.append(it)
    return out


def est360(it):
    o = (it.get("variants", {}).get("base") or {}).get("orbit") or {}
    return bool(it.get("pan360") and o.get("n") == N and (BANK / it["id"] / "v/base/pano.png").exists())


def jumeau(it, tous):
    """Le « … 360 » fabriqué à partir de ce décor, s'il existe."""
    for x in tous:
        if x.get("pan360_de") == it["id"]:
            return x
    return None


def cadre(im):
    """Vue d'origine ramenée à 1216 × 704 : mise à l'échelle pour couvrir, rognée au centre."""
    im = im.convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((max(W, round(im.width * s)), max(H, round(im.height * s))), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def bande(src, ext=None):
    """[origine | suite éventuelle] puis son miroir : boucle exacte."""
    a = np.asarray(cadre(Image.open(src)))
    if ext:
        e = Image.open(ext).convert("RGB")
        e = e.resize((round(e.width * H / e.height), H), Image.LANCZOS)
        a = np.concatenate([a, np.asarray(e)], axis=1)
    return np.concatenate([a, a[:, ::-1]], axis=1)


def vues(pano, dest):
    w = pano.shape[1]
    big = np.concatenate([pano, pano[:, :W]], axis=1)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for k in range(N):
        x = int(round(w * k / N)) % w
        Image.fromarray(big[:, x:x + W]).save(dest / ("%03d.webp" % k), quality=90, method=4)


def faire(iid, ext=None, refaire=False):
    from app import jobs, store, sprites
    tous = decors()
    it = next((x for x in tous if x["id"] == iid), None)
    if not it:
        print("inconnu :", iid); return None
    if est360(it):
        print("déjà en 360 :", iid); return None
    if iid in ECARTES:
        print("écarté :", iid, "-", ECARTES[iid]); return None
    src = BANK / iid / it["variants"]["base"]["ref"]
    deja = jumeau(it, tous)
    if deja and not refaire:
        print("déjà fait :", deja["id"]); return deja["id"]
    pano = bande(src, ext)
    if deja:
        nid = deja["id"]
    else:
        tmp = ROOT / "data" / "tmp"; tmp.mkdir(parents=True, exist_ok=True)
        f0 = tmp / ("decor360_%s.png" % iid)
        Image.fromarray(pano[:, :W]).save(f0)
        new = jobs.add_item("decor", it["name"] + " 360", f0, style=it.get("style", "photo"), tags=it.get("tags"),
                            folder=it.get("folder", ""))
        nid = new["id"]; f0.unlink()
    d = store.item_dir(nid)
    (d / "v/base").mkdir(parents=True, exist_ok=True)
    Image.fromarray(pano).save(d / "v/base/pano.png")
    rel = "v/base/o%d_0" % int(time.time())
    vues(pano, d / rel)
    motion, dark = sprites.frame_stats(sorted((d / rel).glob("*.webp")))
    info = {"n": N, "w": W, "h": H, "ext": "webp", "alpha": False, "motion": round(motion, 2), "dark": round(dark, 2),
            "cover": 1.0, "dir": rel, "snaps": sprites.default_snaps(N, "face"), "t": int(time.time()), "essai": ESSAI}

    def apply(x):
        x["variants"]["base"]["orbit"] = info
        x["variants"]["base"]["pano"] = "v/base/pano.png"
        x["pan360"] = True
        x["pan360_de"] = iid
    store.mutate_item(nid, apply)
    # contrôle : image 0 = vue d'origine cadrée, boucle sans couture
    f = np.asarray(Image.open(d / rel / "000.webp").convert("RGB")).astype(int)
    ecart = float(np.abs(f - np.asarray(cadre(Image.open(src))).astype(int)).mean())
    couture = float(np.abs(pano[:, 0].astype(int) - pano[:, -1].astype(int)).mean())
    print("fait : %s -> %s | bande %d × %d | image 0 contre l'origine : écart %.2f | couture %.2f"
          % (iid, nid, pano.shape[1], H, ecart, couture))
    return nid


def liste():
    tous = decors()
    faits = [x for x in tous if est360(x)]
    reste = [x for x in tous if not est360(x)]
    print("%d décors : %d en 360, %d autres" % (len(tous), len(faits), len(reste)))
    for x in reste:
        j = jumeau(x, tous)
        print("  %-34s %s" % (x["id"], ("-> " + j["id"]) if j else ("écarté : " + ECARTES[x["id"]]) if x["id"] in ECARTES
                              else "à faire"))
    return reste


def planche(out=QA):
    """Par décor fait par cet outil : vue d'origine, images 0, 18, 36, 54, puis la bande entière."""
    tous = decors()
    rows = [(x, jumeau(x, tous)) for x in tous if not est360(x)]
    rows = [(a, b) for a, b in rows if b or a["id"] in ECARTES]
    from PIL import ImageDraw
    w, h = 256, 148
    sheet = Image.new("RGB", (w * 5 + 512 + 10, (h + 16) * len(rows)), "white")
    dr = ImageDraw.Draw(sheet)
    try:
        from PIL import ImageFont
        font = ImageFont.truetype("arial.ttf", 12)
    except Exception:
        font = None
    for r, (a, b) in enumerate(rows):
        y = r * (h + 16)
        ref = Image.open(BANK / a["id"] / a["variants"]["base"]["ref"]).convert("RGB"); ref.thumbnail((w, h))
        sheet.paste(ref, (0, y + 14))
        if not b:
            dr.text((2, y), "%s : écarté, %s" % (a["id"], ECARTES[a["id"]]), fill="black", font=font); continue
        dr.text((2, y), "%s -> %s  (origine | images 0, 18, 36, 54 | bande)" % (a["id"], b["id"]), fill="black", font=font)
        d = BANK / b["id"]
        od = d / b["variants"]["base"]["orbit"]["dir"]
        for c, k in enumerate((0, 18, 36, 54)):
            sheet.paste(Image.open(od / ("%03d.webp" % k)).convert("RGB").resize((w, h)), ((c + 1) * w, y + 14))
        p = Image.open(d / "v/base/pano.png").convert("RGB"); p.thumbnail((512, h))
        sheet.paste(p, (w * 5 + 10, y + 14))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    print("planche :", out, "-", len(rows), "décors")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "liste":
        liste()
    elif a[0] == "planche":
        planche(a[1] if len(a) > 1 else QA)
    elif a[0] == "faire":
        ext = a[a.index("--ext") + 1] if "--ext" in a else None
        ids = [x for i, x in enumerate(a[1:], 1) if not x.startswith("--") and a[i - 1] != "--ext"]
        if "--tous" in a:
            ids = [x["id"] for x in decors() if not est360(x) and x["id"] not in ECARTES and not x.get("pan360_de")]
        for i in ids:
            faire(i, ext, "--refaire" in a)
