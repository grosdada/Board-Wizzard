"""Bouches dessinees (lip sync) tirees sur Dzine : preparation des grilles 2x2 et assemblage des cartes (gratuit, sans fal).

    python tools/levres_dzine.py prep <element> <f,f,f> [--out DOSSIER]      # grilles de reference + bouches.json (variante base)
    python tools/levres_dzine.py assemble <element> <f> <image_rendue.png> [--test] [--variante base]
    python tools/levres_dzine.py fake <element> <f> <sortie.png>              # fausse grille (decalee, mise a l'echelle) pour essai

La grille : la meme tete (decoupee comme tools/levres.py) repetee 4 fois, 1024 px, petite marge blanche entre les cases.
Dzine (Nano Banana Pro) la rend avec une bouche differente par case : haut-gauche A, haut-droite O, bas-gauche E, bas-droite D.
assemble : decoupe la grille rendue en 4 cases, recale chaque case sur la decoupe source (translation + echelle, par
correlation sur les zones hors bouche, puis affinage ECC), puis fait comme tools/levres.py : masque de ce qui a change
autour de la bouche, cartes <orbite>/lips/kFFF_<forme>.webp et leurs gommes kFFF_<forme>_g.webp (ou effacer le dessin
d'origine sous la carte : menton ou joue plus etroits dans la tete redessinee), lips.json (les autres images-cles sont gardees), orbit.lips.
--test : n'ecrit rien dans la banque ni dans l'orbite ; la planche part dans data/qa/levres-<element>-<variante>-test.jpg.
Mesure out : part de la case changee HORS de la bouche (doit rester sous 1 a 2 %).
Ensuite, pour les poses : python tools/levres_report.py <element> base <element> <pose>.

Bouches de dos (3/4 dos, quand on ne voit plus que le bout des levres sur le bord de la silhouette) :
    python tools/levres_dzine.py dos-suivi [element ...]                    # place la bouche apres chaque profil (mouth.json)
    python tools/levres_dzine.py prep <element> dos --dos [--out DOSSIER]    # une grille par cote, a profil + 3
    python tools/levres_dzine.py assemble <element> <f> <rendu.png> --dos [--test]
dos-suivi (gratuit) : sur les orbites dont la bouche est suivie, la bouche est placee sur les 6 images qui suivent chaque
profil vers le dos (mouthfind.extend_back) ; l'ancien mouth.json est garde dans data/backup/mouth/. Sans element : toutes.
--dos : grille a deux formes (haut-gauche : bouche ouverte, haut-droite : entrouverte ; en bas la tete inchangee, bouche
fermee). Deux cartes A et D ; a l'affichage les autres sons prennent A, et la bouche fermee reste le dessin.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

from app import settings, store  # noqa: E402
import levres  # noqa: E402  (SHAPES, KEEP)

SIDE = 1024
MARGIN = 16
CELL = (SIDE - 3 * MARGIN) // 2           # 488
ORDER = ["A", "O", "E", "D"]              # haut-gauche, haut-droite, bas-gauche, bas-droite
DEFAULT_OUT = Path(r"C:\Users\pc\AppData\Local\Temp\claude\ebb38a403fad88c8\32a025f9-41da-4864-9398-e4dfd1671c72\scratchpad\dz\bouches")

PROMPT = ("The image is a 2x2 grid of four panels separated by thin white gutters. All four panels show the SAME drawn head, "
          "repeated. Redraw the four panels so that the head stays identical in every panel, pixel for pixel, and ONLY the mouth "
          "changes, differently in each panel. Keep the grid layout, every panel at the same size and position, no text, no labels. "
          "Top-left panel: " + levres.SHAPES["A"] + " "
          "Top-right panel: " + levres.SHAPES["O"] + " "
          "Bottom-left panel: " + levres.SHAPES["E"] + " It is not a smile: the lips are drawn as a plain thin line. "
          "Bottom-right panel: " + levres.SHAPES["D"] + " "
          "All panels: " + levres.KEEP.strip() + " No grey halo around the mouth, the same framing and the same head size in each "
          "panel, never a flat black fill inside the mouth.")


PROMPT_DOS = ("The image is a 2x2 grid of four panels separated by thin white gutters. All four panels show the SAME drawn head, "
              "seen from three-quarter back: only the very tip of the lips and of the chin show on the edge of the face. Redraw the "
              "four panels so that the head stays identical in every panel, pixel for pixel, and ONLY the visible tip of the mouth "
              "changes. Keep the grid layout, every panel at the same size and position, no text, no labels. "
              "Top-left panel: the character is speaking with the mouth open: on the edge of the profile, the lower lip and the "
              "chin drop a little and a small dark gap opens between the lips, drawn with the same line and the same colours. "
              "Top-right panel: the character is speaking with the mouth barely open: a very thin dark gap between the lips on the "
              "edge of the profile. Bottom-left and bottom-right panels: exactly the reference, mouth closed, unchanged. "
              "All panels: the head is still seen from three-quarter back, never turned towards the viewer, no new mouth drawn on "
              "the cheek, no teeth, no tongue." + levres.KEEP + " Never a flat black fill.")
DOS_ORDER = ["A", "D", None, None]          # haut-gauche, haut-droite ; en bas : la tete inchangee


def dos_frames(iid, vid="base"):
    """Images-cles des bouches de dos : profil + 3 vers le dos, de chaque cote, la ou la bouche est placee."""
    from app import sprites
    it = store.load_item(iid)
    o = it["variants"][vid]["orbit"]
    n = int(o["n"])
    snaps = o.get("snaps") or sprites.default_snaps(n)
    fr = json.loads((store.item_dir(iid) / o["dir"] / "mouth.json").read_text(encoding="utf-8"))["frames"]
    out = []
    for p, b in (("profil gauche", "3/4 dos gauche"), ("profil droit", "3/4 dos droite")):
        p, b = int(snaps[p]) % n, int(snaps[b]) % n
        step = 1 if (b - p) % n <= n // 2 else -1
        for k in (3, 2, 4, 1, 5):                  # profil + 3, sinon le plus pres possible
            f = (p + step * k) % n
            if fr[f] and fr[f].get("ext"):
                out.append(f)
                break
    if not out:
        sys.exit("pas de bouche de dos placee sur %s : lancer d'abord dos-suivi" % iid)
    return out


def dos_suivi(ids):
    """Place la bouche de dos (mouthfind.extend_back) sur les orbites dont la bouche est suivie. Garde l'ancien mouth.json."""
    import shutil
    from app import mouthfind, sprites
    for iid in ids or [p.name for p in sorted((settings.DATA / "bank").iterdir()) if (p / "item.json").exists()]:
        try:
            it = store.load_item(iid)
        except Exception:
            continue
        for vid, v in it["variants"].items():
            o = v.get("orbit") or {}
            if not o.get("dir") or not o.get("n"):
                continue
            folder = store.item_dir(iid) / o["dir"]
            mj = folder / "mouth.json"
            if not mj.exists():
                continue
            bk = settings.DATA / "backup" / "mouth" / iid / vid
            bk.mkdir(parents=True, exist_ok=True)
            shutil.copy(mj, bk / ("mouth-%d.json" % int(time.time())))
            got = mouthfind.extend_back(folder, int(o["n"]), o.get("snaps") or sprites.default_snaps(int(o["n"])))
            print("%s/%s : %d images de dos" % (iid, vid, got))
            if got:
                def fn(x, vid=vid, d=o["dir"]):
                    oo = (x["variants"].get(vid) or {}).get("orbit") or {}
                    if oo.get("dir") == d:
                        oo["mt"] = int(time.time() * 1000)     # le navigateur recharge mouth.json
                store.mutate_item(iid, fn)


def cell_origin(c):
    return MARGIN + (c % 2) * (CELL + MARGIN), MARGIN + (c // 2) * (CELL + MARGIN)


def crop_source(iid, vid, f):
    """La tete decoupee comme levres.py. Rend (x, y, s, rgba, flat, bouche, dossier, mouth.json)."""
    it = store.load_item(iid)
    folder = store.item_dir(iid) / it["variants"][vid]["orbit"]["dir"]
    mouth = json.loads((folder / "mouth.json").read_text(encoding="utf-8"))
    m = mouth["frames"][f]
    if not m:
        sys.exit("la bouche n'est pas suivie sur l'image %d" % f)
    im = Image.open(folder / ("%03d.webp" % f)).convert("RGBA")
    s = int(min(max(4.2 * m["w"], 200), im.width, im.height))
    x = int(min(max(m["cx"] - s / 2, 0), im.width - s))
    y = int(min(max(m["cy"] - s * 0.62, 0), im.height - s))
    rgba = im.crop((x, y, x + s, y + s))
    flat = Image.new("RGB", (s, s), "white")
    flat.paste(rgba, (0, 0), rgba)
    return x, y, s, rgba, flat, m, folder, mouth


def grid_from(flat, jitter=None):
    """La grille 2x2 de la tete. jitter : [(dx, dy, echelle)] par case, pour fabriquer une fausse grille."""
    g = Image.new("RGB", (SIDE, SIDE), "white")
    for c in range(4):
        t = flat.resize((CELL, CELL), Image.LANCZOS)
        ox, oy = cell_origin(c)
        if jitter:
            dx, dy, k = jitter[c]
            n = int(round(CELL * k))
            t2 = t.resize((n, n), Image.LANCZOS)
            t = Image.new("RGB", (CELL, CELL), "white")
            t.paste(t2, ((CELL - n) // 2 + dx, (CELL - n) // 2 + dy))
        g.paste(t, (ox, oy))
    return g


def prep(iid, frames, out, dos=False):
    out.mkdir(parents=True, exist_ok=True)
    mf = out / "bouches.json"
    try:
        manifest = json.loads(mf.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = []
    for f in frames:
        _, _, s, _, flat, _, _, _ = crop_source(iid, "base", f)
        name = "grille_%s_%d%s.png" % (iid, f, "_dos" if dos else "")
        grid_from(flat).save(out / name)
        manifest = [e for e in manifest if not (e["id"] == iid and e["f"] == f)]
        manifest.append({"id": iid, "variante": "base", "f": f, "fichier": name, "prompt": PROMPT_DOS if dos else PROMPT, "ratio": "1:1", "taille": "1K",
                         "modele": "Nano Banana Pro", "dos": dos,
                         "cases": {"haut-gauche": "A (ouverte)", "haut-droite": "D (entrouverte)", "bas-gauche": "inchangee", "bas-droite": "inchangee"} if dos else
                                  {"haut-gauche": "A", "haut-droite": "O", "bas-gauche": "E", "bas-droite": "D"}})
        print("grille", out / name)
    mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


def _gray(im):
    return np.asarray(im.convert("L"), dtype=np.float32)


def split_cells(img):
    """Les 4 cases de la grille rendue, elargies de `ext` px de chaque cote pour retrouver ce que le modele a decale."""
    img = img.convert("RGB")
    w, h = img.size
    sx, sy = w / SIDE, h / SIDE
    cells = []
    ext = int(CELL * 0.12)
    for c in range(4):
        ox, oy = cell_origin(c)
        x0, y0, x1, y1 = ox - ext, oy - ext, ox + CELL + ext, oy + CELL + ext
        bg = Image.new("RGB", (x1 - x0, y1 - y0), "white")
        crop = img.crop((int(round(x0 * sx)), int(round(y0 * sy)), int(round(x1 * sx)), int(round(y1 * sy))))
        bg.paste(crop.resize((x1 - x0, y1 - y0), Image.LANCZOS), (0, 0))
        cells.append(bg)
    return cells, ext


def register_cell(src, wide, zone):
    """src : tete source (s x s). wide : la case elargie. Rend (case recalee s x s, (note, echelle, dx, dy))."""
    s = src.width
    a = cv2.resize(_gray(src), (CELL, CELL), interpolation=cv2.INTER_AREA)
    b = _gray(wide)
    zk = cv2.resize(zone.astype(np.uint8), (CELL, CELL), interpolation=cv2.INTER_NEAREST)
    mask = (1 - cv2.dilate(zk, np.ones((11, 11), np.uint8))).astype(np.uint8)
    c0 = int(CELL * 0.08)
    tpl = a[c0:CELL - c0, c0:CELL - c0]
    tm = mask[c0:CELL - c0, c0:CELL - c0].astype(np.float32)
    best = None
    for k in np.arange(0.84, 1.18, 0.02):
        t = cv2.resize(tpl, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
        mm = cv2.resize(tm, None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST)
        if t.shape[0] >= b.shape[0] or t.shape[1] >= b.shape[1]:
            continue
        r = cv2.matchTemplate(b, t, cv2.TM_CCORR_NORMED, mask=mm)
        r = np.nan_to_num(r, nan=-1, posinf=-1, neginf=-1)
        _, v, _, loc = cv2.minMaxLoc(r)
        if best is None or v > best[0]:
            best = (v, k, loc)
    v, k, (lx, ly) = best
    # pixel (x_a, y_a) de la tete source (taille CELL) -> pixel de la case elargie : k * (x_a - c0) + lx
    Wf = np.array([[k, 0, lx - k * c0], [0, k, ly - k * c0]], np.float32)
    # affinage ECC (affine) hors de la bouche
    hb, wb = b.shape
    a_big = cv2.copyMakeBorder(a, 0, hb - CELL, 0, wb - CELL, cv2.BORDER_CONSTANT, value=255)
    mk = cv2.copyMakeBorder(mask, 0, hb - CELL, 0, wb - CELL, cv2.BORDER_CONSTANT, value=0)
    try:
        # ECC (templateImage = source, inputImage = case) : cherche W tel que case(W x) ~ source(x)
        _, W2 = cv2.findTransformECC(a_big, b, Wf.copy(), cv2.MOTION_AFFINE,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-7), mk * 255, 7)
        # l'affinage ne doit que corriger : s'il s'eloigne du gabarit (case trop retouchee), on garde le gabarit
        if np.abs(W2[:, :2] - Wf[:, :2]).max() < 0.04 and np.abs(W2[:, 2] - Wf[:, 2]).max() < 8:
            Wf = W2
    except cv2.error:
        pass
    f = CELL / s                                   # pixels de la decoupe source -> pixels de a
    F = (Wf @ np.array([[f, 0, 0], [0, f, 0], [0, 0, 1]], np.float32)).astype(np.float32)
    out = cv2.warpAffine(np.asarray(wide), F, (s, s), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP,
                         borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out), (round(float(v), 4), round(float(k), 3), round(float(Wf[0, 2]), 1), round(float(Wf[1, 2]), 1))


def assemble(iid, f, path, vid="base", test=False, dos=False):
    x, y, s, rgba, flat, m, folder, mouth = crop_source(iid, vid, f)
    cells, _ = split_cells(Image.open(path))
    mx, my, mw = m["cx"] - x, m["cy"] - y, m["w"]
    gens, regs = {}, {}
    zone0 = np.zeros((s, s), bool)
    yy, xx = np.mgrid[0:s, 0:s]
    zone0 = (((xx - mx) / (mw * 1.05)) ** 2 + ((yy - my - mw * 0.22) / (mw * 0.95)) ** 2) <= 1.0    # zone de recalage : hors bouche
    for sh, wide in zip(DOS_ORDER if dos else ORDER, cells):
        if sh:
            gens[sh], regs[sh] = register_cell(flat, wide, zone0)
    alphas, outside, goms = levres.card_alpha(gens, flat, rgba, mx, my, mw)
    cards, cardimgs = {}, {}
    for sh, g in gens.items():
        card = g.convert("RGBA")
        card.putalpha(alphas[sh])
        cards[sh] = "lips/k%03d_%s.webp" % (f, sh)
        cardimgs[sh] = card
    print("image %d : recalage (score, echelle, dx, dy) %s" % (f, regs))
    print("image %d : change hors de la bouche %s" % (f, {a: "%.2f %%" % (b * 100) for a, b in outside.items()}))
    entry = {"f": f, "x": x, "y": y, "s": s, "cards": cards, "out": {a: round(b, 4) for a, b in outside.items()}}
    if dos:
        entry["dos"] = 1                          # bouche de dos : servie aux images de dos (mouth.json ext), et a elles seules
    if not test:
        (folder / "lips").mkdir(exist_ok=True)
        gom = {}
        for sh, card in cardimgs.items():
            card.save(folder / cards[sh], quality=92, method=4)
            gr = levres.save_gom(folder, cards[sh], goms[sh])      # la gomme : ou effacer le dessin d'origine sous la carte
            if gr:
                gom[sh] = gr
        if gom:
            entry["gom"] = gom
        try:
            old = json.loads((folder / "lips.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            old = None
        keep = [e for e in (old or {}).get("keys", []) if e["f"] != f]
        data = {"w": mouth["w"], "h": mouth["h"], "model": "dzine/nano-banana-pro", "keys": sorted(keep + [entry], key=lambda e: e["f"])}
        (folder / "lips.json").write_text(json.dumps(data), encoding="utf-8")
        store.mutate_item(iid, lambda it: it["variants"][vid]["orbit"].update(lips=int(time.time() * 1000)))
    z = 3

    def shown(sh):                                                 # comme a l'affichage : dessin d'origine gomme, carte par-dessus
        src = rgba.copy()
        if goms[sh] is not None:
            src.putalpha(Image.fromarray((np.asarray(rgba.split()[3], np.float32) * (1 - np.asarray(goms[sh], np.float32) / 255)).astype("uint8")))
        im = Image.new("RGBA", (s, s), (110, 200, 110, 255))
        return Image.alpha_composite(Image.alpha_composite(im, src), cardimgs[sh]).convert("RGB")
    row = [flat] + [shown(sh) for sh in cardimgs]
    sheet = Image.new("RGB", (s * z * len(row), s * z), "white")
    for c, im in enumerate(row):
        sheet.paste(im.resize((s * z, s * z), Image.LANCZOS), (c * s * z, 0))
    outp = settings.DATA / "qa" / ("levres-%s-%s%s.jpg" % (iid, vid, "-test" if test else ""))
    outp.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(outp, quality=88)
    print("planche", outp)
    return entry


def fake(iid, f, out):
    """Fausse grille rendue : la source repetee, chaque case decalee et mise a l'echelle."""
    _, _, s, _, flat, _, _, _ = crop_source(iid, "base", f)
    grid_from(flat, jitter=[(6, -5, 0.97), (-4, 7, 1.04), (9, 3, 1.02), (-7, -6, 0.96)]).save(out)
    print("fausse grille", out)


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    vid = "base"
    if "--variante" in sys.argv:
        vid = sys.argv[sys.argv.index("--variante") + 1]
        a.remove(vid)
    if cmd == "prep":
        out = DEFAULT_OUT
        if "--out" in sys.argv:
            raw = sys.argv[sys.argv.index("--out") + 1]
            out = Path(raw)
            a.remove(raw)
        dos = "--dos" in sys.argv
        prep(a[1], dos_frames(a[1]) if a[2] == "dos" else [int(v) for v in a[2].split(",")], out, dos)
    elif cmd == "assemble":
        assemble(a[1], int(a[2]), a[3], vid, "--test" in sys.argv, "--dos" in sys.argv)
    elif cmd == "dos-suivi":
        dos_suivi(a[1:])
    elif cmd == "fake":
        fake(a[1], int(a[2]), a[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
