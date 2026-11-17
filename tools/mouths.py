"""Decoupe une planche de bouches en cartes pour le lip sync : au trait noir et blanc, et telles quelles (couleurs).

    python tools/mouths.py planche.png nom [clair|noir|peau|violet]

    clair : levres rouges sur fond clair (pate a modeler)        noir : bouches claires sur fond noir (cartoon)
    violet : bouches au trait violet sombre sur fond clair, legendes en noir (planche de 60 expressions). Le trait
            devient noir, ce qu'il enferme devient blanc, la langue orange devient grise.
    peau  : bouches dessinees sur une pastille couleur peau, fond blanc. Au trait, la peau devient transparente : il ne
            reste que le dessin de la bouche, et c'est le « masque de peau » du personnage qui fait le fond.

Chaque bouche est detouree et ecrite dans un cadre commun 360 x 240, a la meme echelle que les autres :
    app/web/mouths/<nom>/nNN.png   au trait (levres et dents blanches, interieur noir, langue grise, contours noirs)
    app/web/mouths/<nom>/cNN.png   couleurs d'origine, detouree
    app/web/mouths/<nom>/_planche.png   planche de controle, avec les numeros
Les jeux de bouches (quel numero sert a quelle bouche) sont declares dans app/web/js/lipsync.js, `IMG_SETS`.
Le dossier app/web/mouths/ n'est pas versionne : les planches d'origine ne sont pas a nous.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
UP = 4                      # agrandissement avant le trait, pour des contours lisses (6 pour les petites planches)
CW, CH = 360, 240           # cadre commun des cartes
INK = (17, 17, 17, 255)


def _open(m, k=7):
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0


def _chan(img):
    b, g, r = [img[..., i].astype(int) for i in range(3)]
    return r, g, b, 0.3 * r + 0.59 * g + 0.11 * b


def _skin(r, g, b):
    return (r > 215) & (g > 160) & (g < 222) & (b > 120) & (b < 200) & (r - b > 40)


def _violet(r, g, b, lum):
    """Trait violet sombre (pas le noir des legendes) ou langue orange."""
    ink = (lum < 150) & (b - g > 9) & (r - g > 4)
    tongue = (r > 190) & (g < 150) & (b < 120) & (r - g > 70)
    return ink, tongue


def find(img, mode):
    """Silhouettes des bouches, trous bouches. Rend [(x, y, w, h, masque)] rangees ligne par ligne."""
    r, g, b, lum = _chan(img)
    if mode == "noir":
        m = (np.maximum(np.maximum(r, g), b) > 55).astype(np.uint8) * 255
        k, top = 5, 0
    elif mode == "peau":
        m = _skin(r, g, b).astype(np.uint8) * 255
        k, top = 9, 0
    elif mode == "violet":                                        # traits separes d'une meme bouche : on les soude avant de compter
        ink, tongue = _violet(r, g, b, lum)
        raw = ((ink | tongue).astype(np.uint8)) * 255
        glue = cv2.dilate(raw, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 13)))
        cs, _ = cv2.findContours(glue, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        out = []
        for c in cs:
            x, y, w, h = cv2.boundingRect(c)
            mask = np.zeros(img.shape[:2], np.uint8)
            cv2.drawContours(mask, [c], -1, 255, -1)
            if int((raw[y:y + h, x:x + w] > 0).sum()) < 25 or w < 24:
                continue
            out.append((x, y, w, h, mask))
        rows = []
        for o in sorted(out, key=lambda o: o[1] + o[3] / 2):
            cy = o[1] + o[3] / 2
            if rows and abs(cy - np.mean([q[1] + q[3] / 2 for q in rows[-1]])) < 30:
                rows[-1].append(o)
            else:
                rows.append([o])
        return [o for row in rows for o in sorted(row, key=lambda o: o[0])]
    else:
        m = ((r > 120) & (r - g > 45) & (r - b > 35)).astype(np.uint8) * 255
        k, top = 13, 85                                           # 85 : sous l'en-tete de la capture
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        x, y, w, h = cv2.boundingRect(c)
        if cv2.contourArea(c) < 900 or y < top:
            continue
        mask = np.zeros(img.shape[:2], np.uint8)
        cv2.drawContours(mask, [c], -1, 255, -1)
        out.append((x, y, w, h, mask))
    if mode == "peau":                                            # planche en grille, bouches de hauteurs tres differentes
        rows = []
        for o in sorted(out, key=lambda o: o[1] + o[3] / 2):
            cy = o[1] + o[3] / 2
            if rows and abs(cy - np.mean([q[1] + q[3] / 2 for q in rows[-1]])) < 55:
                rows[-1].append(o)
            else:
                rows.append([o])
        return [o for row in rows for o in sorted(row, key=lambda o: o[0])]
    if mode == "noir":                                            # planche en grille : ligne par ligne
        rowh = max(40, int(np.median([o[3] for o in out]) * 1.2)) if out else 60
        return sorted(out, key=lambda o: (round((o[1] + o[3] / 2) / rowh), o[0]))
    return sorted(out, key=lambda o: (round((o[1] + o[3] / 2) / 60), o[0]))


def cards(img, x, y, w, h, mask, scale, mode):
    """Une bouche dans le cadre commun : (au trait, en couleurs)."""
    pad = 6
    x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
    crop = cv2.resize(img[y0:y1, x0:x1], None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    sil = cv2.resize(mask[y0:y1, x0:x1], None, fx=UP, fy=UP, interpolation=cv2.INTER_LINEAR) > 127
    colour = np.dstack([crop, np.where(sil, 255, 0).astype(np.uint8)])
    soft = cv2.bilateralFilter(crop, 9, 50, 9)
    r, g, b, lum = _chan(soft)
    if mode == "violet":
        ink, tongue = _violet(r, g, b, lum)
        ink, tongue = ink & sil, tongue & sil
        solid = (ink | tongue).astype(np.uint8)
        solid = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))   # barriere : on bouche les petites coupures du trait
        flood = np.zeros((solid.shape[0] + 2, solid.shape[1] + 2), np.uint8)
        bg = (solid * 255).copy()
        cv2.floodFill(bg, flood, (0, 0), 128)                     # ce que le fond atteint depuis le bord
        for cx, cy in ((bg.shape[1] - 1, 0), (0, bg.shape[0] - 1), (bg.shape[1] - 1, bg.shape[0] - 1)):
            if bg[cy, cx] == 0:
                cv2.floodFill(bg, flood, (cx, cy), 128)
        inside = (bg == 0) | ((solid > 0) & ~ink & ~tongue)      # enferme par le trait : dents, levres
        out = np.zeros(crop.shape[:2] + (4,), np.uint8)
        out[inside] = (255, 255, 255, 255)
        out[tongue] = (190, 190, 190, 255)
        out[ink] = INK
        return _framed(out, scale), _framed(colour, scale)
    if mode == "peau":                                            # dessin sur pastille de peau : la peau s'efface, le dessin reste
        skin = sil & _skin(r, g, b)
        skin = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))) > 0
        core = cv2.erode(sil.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0   # sans le lisere du bord de la pastille
        art = core & ~skin
        dark = art & (lum < 110)
        tongue = _open(art & ~dark & (r > 170) & (g < 150) & (r - g > 60), 5)
        teeth = art & ~dark & ~tongue
        out = np.zeros(crop.shape[:2] + (4,), np.uint8)
        out[teeth] = (255, 255, 255, 255)
        out[tongue] = (190, 190, 190, 255)
        out[dark] = INK
        a = cv2.GaussianBlur(out[..., 3], (0, 0), 0.8)            # bord adouci
        out[..., 3] = np.where(out[..., 3] > 0, 255, 0).astype(np.uint8)
        return _framed(out, scale), _framed(colour, scale)
    if mode == "noir":                                            # cartoon : levres roses, interieur brun sombre, dents creme, langue rouge
        teeth = _open(sil & (lum > 195) & (r - b < 90) & (g > 180), 5)
        lip = _open(sil & ~teeth & (r > 170) & (g > 105) & (b > 110), 5)
        tongue = _open(sil & ~lip & ~teeth & (r > 120) & (g < 100) & (r - g > 60), 5)
        inner = sil & ~lip
    else:                                                         # pate a modeler : levres rouges
        lip = _open(sil & (r > 120) & (r - g > 45) & (r - b > 35))
        inner = sil & ~lip
        teeth = _open(inner & (lum > 112) & (r - g < 42))
        tongue = _open(inner & ~teeth & (r > 150) & (lum > 105))
    out = np.zeros(crop.shape[:2] + (4,), np.uint8)
    out[sil] = (255, 255, 255, 255)                               # levres : blanc
    out[inner] = INK                                              # interieur : noir
    # levres jointes : la partie nettement plus sombre des levres devient un trait
    med = np.median(lum[lip]) if lip.any() else 0
    crease = _open(lip & (lum < med - 30), 5)
    closed = inner.sum() < 0.04 * sil.sum()
    if closed:
        out[crease] = INK
    out[teeth] = (255, 255, 255, 255)
    out[tongue] = (190, 190, 190, 255)
    line = max(2, int(round(1.1 * UP)))
    for m, t in ((sil, line + 2), (lip, line), (teeth, line - 1), (tongue, line - 1)):
        cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(out, [c for c in cs if cv2.contourArea(c) > 40], -1, INK, t, cv2.LINE_AA)
    if closed and crease.sum() < 0.02 * sil.sum():                # sans pli visible : un trait au milieu
        cols = np.where(sil.any(axis=0))[0]
        a, b2 = cols[0] + int(len(cols) * 0.1), cols[-1] - int(len(cols) * 0.1)
        pts = np.array([[cx, int(np.mean(np.where(sil[:, cx])[0]))] for cx in range(a, b2, 6) if sil[:, cx].any()], np.int32)
        if len(pts) > 2:
            cv2.polylines(out, [pts], False, INK, line, cv2.LINE_AA)

    return _framed(out, scale), _framed(colour, scale)


def _framed(im, scale):
    if True:
        hh, ww = im.shape[:2]
        small = cv2.resize(im, (max(1, int(ww * scale)), max(1, int(hh * scale))), interpolation=cv2.INTER_AREA)
        canvas = np.zeros((CH, CW, 4), np.uint8)
        sh, sw = min(small.shape[0], CH), min(small.shape[1], CW)
        oy, ox = (CH - sh) // 2, (CW - sw) // 2
        sy, sx = (small.shape[0] - sh) // 2, (small.shape[1] - sw) // 2
        canvas[oy:oy + sh, ox:ox + sw] = small[sy:sy + sh, sx:sx + sw]
        return canvas


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, name = Path(sys.argv[1]), sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "clair"
    dest = ROOT / "app" / "web" / "mouths" / name
    dest.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    if img is None:
        sys.exit("image illisible : %s" % src)
    found = find(img, mode)
    if not found:
        sys.exit("aucune bouche trouvee (essayer l'autre mode : clair ou noir)")
    scale = min((CW - 24) / ((max(o[2] for o in found) + 12) * UP), (CH - 16) / ((max(o[3] for o in found) + 12) * UP))
    cols = 5 if mode == "violet" else 4
    sheet = np.full((((len(found) + cols - 1) // cols) * CH, 2 * cols * CW, 3), 200, np.uint8)
    for i, o in enumerate(found):
        line, colour = cards(img, *o, scale, mode)
        cv2.imwrite(str(dest / ("n%02d.png" % i)), line)
        cv2.imwrite(str(dest / ("c%02d.png" % i)), colour)
        for j, c in enumerate((line, colour)):
            y, x = (i // cols) * CH, (i % cols + j * cols) * CW
            a = c[..., 3:4] / 255.0
            sheet[y:y + CH, x:x + CW] = (c[..., :3] * a + sheet[y:y + CH, x:x + CW] * (1 - a)).astype(np.uint8)
        cv2.putText(sheet, str(i), ((i % cols) * CW + 8, (i // cols) * CH + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
    cv2.imwrite(str(dest / "_planche.png"), sheet)
    print("%d bouches -> %s (planche de controle : _planche.png)" % (len(found), dest))


if __name__ == "__main__":
    main()
