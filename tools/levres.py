"""Bouches de lip sync dessinees dans le style du personnage (fal, Nano Banana Pro), posees sur son orbite.

    python tools/levres.py <element> <variante> [--images 0,7,14] [--refaire]     # payant : 4 images fal par image-cle
    python tools/levres.py <element> <variante> --images 0 --formes A              # ne redessiner qu'une forme (1 image fal)

Il faut d'abord que la bouche soit suivie dans l'orbite (montage : « Tracer la bouche », mouth.json). Pour chaque image-cle
de l'orbite, la tete est decoupee autour de la bouche, et le modele redessine la meme tete avec la bouche qui dit A, O, E,
ou entrouverte (D), sans toucher au reste. On ne garde que ce qui a change autour de la bouche (un meme masque adouci pour
les quatre, pour que la peau autour ne clignote pas) : des cartes transparentes, en pixels de l'image d'orbite.

    <orbite>/lips/kFFF_A.webp ...        les cartes
    <orbite>/lips/kFFF_A_g.webp ...      les gommes : ou effacer le dessin d'origine sous la carte (menton plus haut...)
    <orbite>/lips.json                   { w, h, keys: [{ f, x, y, s, cards: {A, O, E, D}, gom?: {A, ...} }] }
    variants[v].orbit.lips               instant de la derniere ecriture (le navigateur recharge)
    data/qa/levres-<element>-<variante>.jpg    planche de controle : a regarder avant de s'en servir

A l'affichage (lipsync.js, cardMarkup), la carte de l'image-cle la plus proche est recalee sur la bouche suivie de l'image
montree ; trop loin d'une image-cle, c'est la bouche tracee habituelle qui prend le relais.
"""

import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

from app import falapi, settings, store  # noqa: E402

MODEL = "fal-ai/nano-banana-pro/edit"
KEEP = (" Change ONLY the mouth. Everything else stays exactly as in the reference, pixel for pixel: same head, same eyes, same "
        "nose, same moustache or beard if there is one (same shape, same size, same hatching, never removed), same jaw outline, same hair, same clothes, same framing, same position, same size, same viewing angle. The new mouth "
        "is drawn by the same artist with the same tools: the same kind of line with the same thickness and roughness, the same "
        "way of filling, the same colours as the rest of the drawing. No clean ink, no new colours, no added detail, no added shading.")
SHAPES = {
    "A": "The character is speaking: the mouth is wide open as when saying 'AH', the lower lip dropped. The inside of the mouth is "
         "NOT a flat black or flat dark shape: it is shaded only with the medium this drawing already uses for its dark areas "
         "(rough pencil hatching if it is a line drawing with no paint, loose uneven wash if it is painted), in a tone already "
         "present in the drawing, with the paper showing through, a lighter rounded tongue resting at the bottom. On a drawing "
         "that has no paint, add no grey paint and no wash: lines and hatching only.",
    "O": "The character is speaking: the lips are pushed forward into a small round 'OH' shape, a small round opening filled with "
         "the darkest colour already used in the drawing. The lips themselves keep exactly the same pale colour and the same "
         "light shading as the lips in the reference: NO lipstick, NO dark or brown lips, NO filled-in lips; only the small "
         "opening is dark.",
    "E": "The character is speaking: the mouth is half open and stretched wide as when saying 'EE', showing a plain row of upper "
         "teeth left as bare paper, a thin dark gap under them.",
    "D": "The character is speaking: the mouth is slightly open, a narrow dark slit between the lips, as when saying 'D' or 'S'.",
}
UP = 1024


def card_alpha(gens, flat, rgba, mx, my, mw, bg=(255, 255, 255)):
    """Alphas des cartes de bouche (une par forme) et mesure `out`.
    gens : {forme: image RGB s x s recalee sur la decoupe}, flat : la decoupe source sur son fond `bg`, rgba : la meme avec
    son alpha, (mx, my, mw) : la bouche suivie dans la decoupe.
    Regle : alpha = masque de changement (partage par les formes, autour de la bouche, elargi vers le bas : la machoire du A
    descend jusqu'a 0,8 x largeur de bouche plus bas) x silhouette generee (le fond de la case generee, relie au fond
    de la source, est transparent). Source opaque + case generee en fond : alpha 0 (on garde le dessin d'origine, jamais de
    fond colle) ; source transparente + case generee opaque dans la zone (machoire qui depasse) : la carte la montre.
    Rend ({forme: image L}, {forme: part changee hors de la zone}, {forme: gomme L ou None}) ; la gomme (voir save_gom) dit
    ou masquer le dessin d'origine sous la carte."""
    import cv2
    s = flat.width
    yy, xx = np.mgrid[0:s, 0:s]
    # vers le haut, la zone va jusque sous le nez (1,35 x largeur de bouche) : une bouche grande ouverte remonte la levre
    # du haut bien au-dessus de la bouche fermee suivie ; plus bas la machoire du A descend
    ry = np.where(yy > my + mw * 0.22, mw * (0.95 + 0.8), mw * 1.35)
    zone = (((xx - mx) / (mw * 1.05)) ** 2 + ((yy - my - mw * 0.22) / ry) ** 2) <= 1.0
    e = int(s * 0.06)
    inner = np.zeros((s, s), bool)
    inner[e:s - e, e:s - e] = True
    soft = lambda im: np.asarray(im.filter(ImageFilter.GaussianBlur(1.3)), dtype=np.int16)   # un demi-pixel de recalage ne compte pas
    base = soft(flat)
    srcA = np.asarray(rgba.split()[3]) > 40
    bgc = np.array(bg, np.int16)
    # silhouette generee : le fond de la case = pixels de la couleur du fond relies a du fond de la source
    seedmask = ~srcA
    gal = {}
    for sh, g in gens.items():
        arr = np.asarray(g, dtype=np.int16)
        near = (np.abs(arr - bgc).max(axis=2) <= 24).astype(np.uint8)
        # peau aussi blanche que le fond : un trait de machoire interrompu ferait passer la machoire generee pour du fond ;
        # le blanc est ronge avant de chercher ce qui touche le fond de la source, puis rendu (comme pour la gomme)
        kg = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, ((int(max(5, mw * 0.18)) | 1),) * 2)
        n, lab = cv2.connectedComponents(cv2.erode(near, kg), connectivity=4)
        seeds = np.bincount(lab[seedmask], minlength=n)
        isbg = (cv2.dilate(np.isin(lab, [i for i in range(1, n) if seeds[i] >= 12]).astype(np.uint8), kg) & near) > 0
        # contour genere ferme : le trait sombre, fermeture de 0,6 x largeur de bouche ; n'est fond que ce qui reste relie au
        # fond de la source hors de ce contour (un trait pale ou interrompu ne laisse plus le fond entrer dans la machoire)
        ink = (arr.min(axis=2) < 200).astype(np.uint8)
        kc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, ((int(max(5, mw * 0.6)) | 1),) * 2)
        free = 1 - cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kc)
        n2, lab2 = cv2.connectedComponents(free, connectivity=4)
        s2 = np.bincount(lab2[seedmask & (free > 0)], minlength=n2)
        outside_c = np.isin(lab2, [i for i in range(1, n2) if s2[i] >= 12])
        # seulement sous la bouche (la machoire du A descend) : a hauteur de bouche, la fermeture relierait au visage une
        # lettre ou une tache dessinee a cote, que la regle des composantes ne retirerait plus
        isbg &= (cv2.dilate(outside_c.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) | (yy < my + mw * 0.5)
        bgm = cv2.dilate(isbg.astype(np.uint8) * 255, np.ones((3, 3), np.uint8))           # un pixel de plus : pas de liseré de fond
        gal[sh] = 1.0 - np.asarray(Image.fromarray(bgm).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32) / 255
    diff = np.zeros((s, s), bool)
    outside = {}
    for sh, g in gens.items():
        dd = np.abs(soft(g) - base).max(axis=2)
        diff |= (dd > 30) & inner
        diff |= (~srcA) & (gal[sh] > 0.5) & zone                     # machoire qui depasse de la silhouette d'origine
        outside[sh] = float((dd[inner & ~zone] > 45).mean())
    # les trous du changement sont bouches : l'interieur d'une bouche ouverte au lavis pale differe peu du visage, et
    # l'ancienne bouche y transparaissait (bouche fantome)
    ch = cv2.morphologyEx((diff & zone).astype(np.uint8), cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(max(3, mw * 0.2)) | 1,) * 2))
    ff = (1 - ch).astype(np.uint8)
    cv2.floodFill(ff, np.zeros((s + 2, s + 2), np.uint8), (0, 0), 2)
    ch = ((ch > 0) | (ff == 1)) & zone
    mask = Image.fromarray((ch * 255).astype("uint8"))
    r = max(2, int(mw * 0.10))
    mask = mask.filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.GaussianBlur(r * 0.8))
    mask = Image.fromarray(np.minimum(np.asarray(mask), ((zone * 255).astype("uint8")))).filter(ImageFilter.GaussianBlur(1.2))
    mk = np.asarray(mask, dtype=np.float32)
    # gomme : source opaque mais case generee en fond (menton, joue, machoire fermee plus haut) : le dessin d'origine doit
    # disparaitre sous la carte, sinon il depasse (double menton, double trait). Seulement dans la zone, et pres du bord de
    # la silhouette d'origine : un trait genere interrompu ferait fuir le fond dans le visage (pas de trou au milieu)
    near = cv2.distanceTransform(srcA.astype(np.uint8), cv2.DIST_L2, 3) <= max(3.0, mw * 0.4)
    zf = zone.astype(np.float32)
    goms = {}
    kk = int(max(5, mw * 0.18)) | 1
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk))
    for sh in gens:
        # fond de la case pour la gomme : le blanc ronge (0,09 x largeur de bouche) avant de chercher ce qui touche le fond
        # de la source, puis rendu : un trou dans un trait genere ne laisse plus fuir le fond dans la machoire
        arr = np.asarray(gens[sh], dtype=np.int16)
        near_bg = (np.abs(arr - bgc).max(axis=2) <= 24).astype(np.uint8)
        n, lab = cv2.connectedComponents(cv2.erode(near_bg, k5), connectivity=4)
        seeds = np.bincount(lab[seedmask], minlength=n)
        isbg = np.isin(lab, [i for i in range(1, n) if seeds[i] >= 12]).astype(np.uint8)
        isbg = cv2.dilate(isbg, k5) & near_bg
        # sans l'elargissement d'un pixel de gal : sur un bord ou les deux silhouettes coincident, le trait d'origine reste
        raw = isbg.astype(np.float32) * srcA * zf
        g = Image.fromarray((raw * near * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.7))
        g = np.minimum(np.asarray(g), (zf * 255).astype("uint8"))                    # jamais hors de la zone
        goms[sh] = Image.fromarray(g) if (g > 128).sum() >= 6 else None
        goms_raw = int((raw > 0.5).sum())
        if goms_raw:
            print("  gomme %s : %d px (%d sans la borne du bord)" % (sh, int((g > 128).sum()), goms_raw))
    # hors de la silhouette d'origine, on ne garde que ce qui y est relie (machoire qui depasse) : une lettre ou une tache
    # dessinee a cote du visage par le modele est une composante isolee, retiree
    out_al = {}
    for sh in gens:
        solid = ((gal[sh] > 0.3) | srcA).astype(np.uint8)
        n, lab = cv2.connectedComponents(solid, connectivity=8)
        hold = np.isin(lab, np.unique(lab[srcA & (lab > 0)]))
        hold = cv2.dilate(hold.astype(np.uint8) * 255, np.ones((3, 3), np.uint8))
        hold = np.asarray(Image.fromarray(hold).filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255
        out_al[sh] = Image.fromarray((mk * gal[sh] * hold).astype("uint8"))
    # la gomme ne doit jamais ouvrir un trou ferme dans le visage : sur une peau aussi blanche que le fond, un trait genere
    # interrompu fait passer la peau pour du fond ; ce que la gomme vide et que rien ne relie au fond d'origine est rendu
    for sh in gens:
        if goms[sh] is None:
            continue
        g = np.asarray(goms[sh], dtype=np.float32) / 255
        a0 = np.asarray(rgba.split()[3], dtype=np.float32) / 255
        comp = np.maximum(a0 * (1 - g), np.asarray(out_al[sh], dtype=np.float32) / 255)
        clear = (comp < 0.5).astype(np.uint8)
        n, lab = cv2.connectedComponents(clear, connectivity=8)
        opened = np.unique(lab[(~srcA) & (g < 0.1) & (clear > 0)])
        hole = (clear > 0) & ~np.isin(lab, opened)
        if hole.any():
            hole = cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
            g2 = np.where(hole, 0, np.asarray(goms[sh]))
            g2 = np.asarray(Image.fromarray(g2.astype("uint8")).filter(ImageFilter.GaussianBlur(0.7)))
            print("  gomme %s : %d px de trou ferme rendus" % (sh, int(hole.sum())))
            goms[sh] = Image.fromarray(g2) if (g2 > 128).sum() >= 6 else None
    return out_al, outside, goms


def save_gom(folder, card_rel, g):
    """Ecrit la gomme d'une carte a cote d'elle (lips/kFFF_X_g.webp : noir, alpha = part du dessin d'origine a effacer,
    meme taille et place que la carte). Rend son chemin relatif, ou None (pas de gomme : l'ancienne est retiree)."""
    rel = card_rel[:-5] + "_g.webp"
    if g is None:
        (folder / rel).unlink(missing_ok=True)
        return None
    im = Image.new("RGBA", g.size, (0, 0, 0, 0))
    im.putalpha(g)
    im.save(folder / rel, lossless=True, method=4)
    return rel


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        sys.exit(__doc__)
    iid, vid = args[0], args[1]
    it = store.load_item(iid)
    d = store.item_dir(iid)
    o = it["variants"][vid]["orbit"]
    folder = d / o["dir"]
    try:
        mouth = json.loads((folder / "mouth.json").read_text(encoding="utf-8"))
    except OSError:
        sys.exit("pas de bouche suivie sur cette orbite : trace-la d'abord dans le montage")
    fr = mouth["frames"]
    keys = [0]
    for a in sys.argv[1:]:
        if a.startswith("--images="):
            keys = [int(x) for x in a.split("=")[1].split(",")]
    if "--images" in sys.argv:
        keys = [int(x) for x in sys.argv[sys.argv.index("--images") + 1].split(",")]
    todo = list(SHAPES)                                              # --formes A : ne redessiner que ces formes, garder les autres
    if "--formes" in sys.argv:
        todo = [s for s in sys.argv[sys.argv.index("--formes") + 1].upper().split(",") if s in SHAPES]
    keys = [k for k in keys if 0 <= k < len(fr) and fr[k]]
    if not keys:
        sys.exit("la bouche n'est suivie sur aucune des images demandees")
    try:
        old = json.loads((folder / "lips.json").read_text(encoding="utf-8")) if "--refaire" not in sys.argv else None
    except OSError:
        old = None
    key = settings.load()["fal"].get("key")
    prov = falapi.FalProvider(key, {})
    (folder / "lips").mkdir(exist_ok=True)
    tmp = folder / "lips" / "_tmp"
    tmp.mkdir(exist_ok=True)
    got, lock = {}, threading.Lock()
    crops = {}
    for k in keys:
        im = Image.open(folder / ("%03d.webp" % k)).convert("RGBA")
        m = fr[k]
        s = int(min(max(4.2 * m["w"], 200), im.width, im.height))
        x = int(min(max(m["cx"] - s / 2, 0), im.width - s))
        y = int(min(max(m["cy"] - s * 0.62, 0), im.height - s))       # la bouche dans le bas du cadre : on voit les yeux et le nez
        rgba = im.crop((x, y, x + s, y + s))
        flat = Image.new("RGB", (s, s), "white")
        flat.paste(rgba, (0, 0), rgba)
        src = tmp / ("src_%03d.png" % k)
        flat.resize((UP, UP), Image.LANCZOS).save(src)
        crops[k] = (x, y, s, rgba, flat, prov.upload(src))

    def work(k, sh):
        try:
            out = falapi.FalProvider(key, {}).run(MODEL, {"prompt": SHAPES[sh] + KEEP, "image_urls": [crops[k][5]], "num_images": 1,
                                                             "aspect_ratio": "1:1"})
            p = prov.fetch(out["images"][0]["url"], tmp / ("gen_%03d_%s.png" % (k, sh)))
            with lock:
                got[(k, sh)] = p
            print("ok", k, sh, flush=True)
        except Exception as e:                                       # noqa: BLE001
            print("ERREUR", k, sh, repr(e)[:300], flush=True)

    sem = threading.Semaphore(8)

    def guarded(*a):
        with sem:
            work(*a)

    ts = [threading.Thread(target=guarded, args=(k, sh)) for k in keys for sh in todo]
    [t.start() for t in ts]
    [t.join() for t in ts]

    entries, rows = [], []
    for k in keys:
        x, y, s, rgba, flat, _ = crops[k]
        m = fr[k]
        base = np.asarray(flat, dtype=np.int16)
        gens = {sh: Image.open(got[(k, sh)]).convert("RGB").resize((s, s), Image.LANCZOS) for sh in SHAPES if (k, sh) in got}
        if not gens:
            continue
        for sh in SHAPES:                                            # les formes gardees : leur carte reposee sur la tete d'origine
            p = folder / ("lips/k%03d_%s.webp" % (k, sh))
            if sh not in gens and sh not in todo and p.exists():
                gens[sh] = Image.alpha_composite(flat.convert("RGBA"), Image.open(p).convert("RGBA")).convert("RGB")
        gens = {sh: gens[sh] for sh in SHAPES if sh in gens}
        # ce qui a change autour de la bouche (zone elargie vers le bas) x silhouette generee, voir card_alpha
        alphas, outside, goms = card_alpha(gens, flat, rgba, m["cx"] - x, m["cy"] - y, m["w"])
        cards, gom = {}, {}
        for sh, g in gens.items():
            card = g.convert("RGBA")
            card.putalpha(alphas[sh])
            rel = "lips/k%03d_%s.webp" % (k, sh)
            card.save(folder / rel, quality=92, method=4)
            cards[sh] = rel
            gr = save_gom(folder, rel, goms[sh])
            if gr:
                gom[sh] = gr
        entries.append({"f": k, "x": x, "y": y, "s": s, "cards": cards, "out": {a: round(b, 4) for a, b in outside.items()}})
        if gom:
            entries[-1]["gom"] = gom
        row = [flat] + [Image.alpha_composite(flat.convert("RGBA"), Image.open(folder / cards[sh])).convert("RGB") for sh in cards]
        rows.append((k, row, outside))
        print("image %d : change hors de la bouche %s" % (k, {a: "%.1f %%" % (b * 100) for a, b in outside.items()}))

    keep = [e for e in (old or {}).get("keys", []) if e["f"] not in {e2["f"] for e2 in entries}]
    data = {"w": mouth["w"], "h": mouth["h"], "model": MODEL, "keys": sorted(keep + entries, key=lambda e: e["f"])}
    (folder / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    for p in tmp.glob("*"):
        p.unlink()
    tmp.rmdir()
    store.mutate_item(iid, lambda x: x["variants"][vid]["orbit"].update(lips=int(time.time() * 1000)))
    if rows:
        z = 3
        cell = max(r[1][0].width for r in rows) * z
        sheet = Image.new("RGB", (cell * 5, sum(r[1][0].height * z for r in rows)), "white")
        yy = 0
        for k, row, _ in rows:
            for c, im in enumerate(row):
                sheet.paste(im.resize((im.width * z, im.height * z), Image.LANCZOS), (c * cell, yy))
            yy += row[0].height * z
        out = settings.DATA / "qa" / ("levres-%s-%s.jpg" % (iid, vid))
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out, quality=88)
        print("planche", out)
    print("%d image(s)-cle, %d carte(s)" % (len(entries), sum(len(e["cards"]) for e in entries)))


if __name__ == "__main__":
    main()
