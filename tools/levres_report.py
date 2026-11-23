"""Reporte les bouches dessinees d'une orbite sur une autre (gratuit) : meme personnage, autre pose ou orbite refaite.

    python tools/levres_report.py <element> <variante> <element cible> <variante cible> [--dos]

Les cartes (tools/levres.py) et leurs gommes sont copiees dans l'orbite cible avec, pour chaque image-cle, la bouche suivie de l'orbite
d'origine (up0). A l'affichage (lipsync.cardMarkup) la carte est recalee sur la bouche suivie de l'orbite cible : place,
taille, inclinaison. Il faut que la bouche soit suivie dans la cible (montage : « Tracer la bouche »). Une image-cle garde
son angle : il est lu sur les reperes (snaps) des deux orbites, sens de rotation compris. Une carte de dos va sur l'image
de dos de la cible du meme cote, a la meme place entre profil et 3/4 dos. Sert a ne dessiner les bouches qu'une
fois (sur la base) et a garder celles d'une orbite qu'on refait.
--dos : ne reporte que les cartes de dos, et garde les autres cles de la cible (ses propres bouches de face) ; les
anciennes cartes de dos de la cible sont remplacees. Sans --dos, tout le lips.json de la cible est remplace.
"""

import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import sprites, store  # noqa: E402

AXES = sprites.AXES


def _reversed(n, snaps):
    fr = [snaps[a] for a in AXES if a in snaps]
    back = fwd = 0
    for k in range(len(fr)):
        d = (fr[(k + 1) % len(fr)] - fr[k]) % n
        if d:
            if d > n / 2:
                back += 1
            else:
                fwd += 1
    return back > fwd


def _table(n, snaps):
    """Comme model.js : [(angle, image deroulee)] dans l'ordre des axes ; None si les reperes sont incoherents."""
    rows = [(k * 45, snaps[a]) for k, a in enumerate(AXES) if a in snaps]
    if len(rows) < 2:
        return None
    out, prev = [], None
    for ang, fr in rows:
        if prev is not None:
            while fr <= prev:
                fr += n
        prev = fr
        out.append((ang, fr))
    if out[-1][1] - out[0][1] >= n:
        return None
    out.append((out[0][0] + 360, out[0][1] + n))
    return out


def frame_to_angle(n, snaps, f):
    rev = _reversed(n, snaps)
    s = {a: (n - v % n) % n for a, v in snaps.items()} if rev else snaps
    t = _table(n, s)
    f = f % n
    if rev:
        f = (n - f) % n
    if not t:
        return f / n * 360
    for ff in (f, f + n):
        for k in range(len(t) - 1):
            if t[k][1] <= ff <= t[k + 1][1]:
                u = (ff - t[k][1]) / max(1e-6, t[k + 1][1] - t[k][1])
                return (t[k][0] + u * (t[k + 1][0] - t[k][0])) % 360
    return f / n * 360


def angle_to_frame(n, snaps, ang):
    rev = _reversed(n, snaps)
    s = {a: (n - v % n) % n for a, v in snaps.items()} if rev else snaps
    t = _table(n, s)
    ang %= 360
    if not t:
        return round(ang / 360 * n) % n
    for aa in (ang, ang + 360):
        for k in range(len(t) - 1):
            if t[k][0] <= aa <= t[k + 1][0]:
                u = (aa - t[k][0]) / max(1e-6, t[k + 1][0] - t[k][0])
                fr = round(t[k][1] + u * (t[k + 1][1] - t[k][1])) % n
                return (n - fr) % n if rev else fr
    return round(ang / 360 * n) % n


def back_side(n, snaps, f):
    """Cote d'une image de dos : 'gauche' ou 'droit', selon le profil dont elle est le plus pres."""
    d = lambda a: min((f - snaps[a]) % n, (snaps[a] - f) % n)
    return "gauche" if d("profil gauche") <= d("profil droit") else "droit"


def _side_span(n, snaps, side):
    p, b = snaps["profil " + side] % n, snaps["3/4 dos " + ("gauche" if side == "gauche" else "droite")] % n
    step = 1 if (b - p) % n <= n // 2 else -1
    return p, step, max(1, (b - p) % n if step == 1 else (p - b) % n)


def back_frac(n, snaps, f, side):
    """Place d'une image de dos entre le profil (0) et le 3/4 dos (1)."""
    p, step, span = _side_span(n, snaps, side)
    return (((f - p) * step) % n) / span


def back_frame(n, snaps, frames, side, frac=0.5):
    """Image de dos de la cible pour ce cote, a la meme place entre profil et 3/4 dos, sinon l'image de dos la plus proche."""
    p, step, span = _side_span(n, snaps, side)
    want = round(frac * span)
    for d in (0, 1, -1, 2, -2, 3, -3, 4, -4):
        f = (p + step * (want + d)) % n
        if frames[f] and (frames[f].get("ext") or frames[f].get("back")):
            return f
    return None


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    if len(a) < 4:
        sys.exit(__doc__)
    only_back = "--dos" in sys.argv
    si, sv, di, dv = a[:4]
    s_it, d_it = store.load_item(si), store.load_item(di)
    so, do = s_it["variants"][sv]["orbit"], d_it["variants"][dv]["orbit"]
    sn, dn = int(so["n"]), int(do["n"])
    ss, ds = so.get("snaps") or sprites.default_snaps(sn), do.get("snaps") or sprites.default_snaps(dn)
    sf, df = store.item_dir(si) / so["dir"], store.item_dir(di) / do["dir"]
    lips = json.loads((sf / "lips.json").read_text(encoding="utf-8"))
    smouth = json.loads((sf / "mouth.json").read_text(encoding="utf-8"))["frames"]
    try:
        dmouth = json.loads((df / "mouth.json").read_text(encoding="utf-8"))["frames"]
    except OSError:
        sys.exit("la bouche n'est pas suivie dans l'orbite cible : trace-la d'abord dans le montage")
    (df / "lips").mkdir(exist_ok=True)
    keys = []
    for k in lips["keys"]:
        m = smouth[k["f"]]
        if not m:
            continue
        dos = bool(k.get("dos") or m.get("ext"))
        if only_back and not dos:
            continue
        if dos:                                                 # carte de dos : meme cote, image de dos de la cible
            side = back_side(sn, ss, k["f"])
            f = back_frame(dn, ds, dmouth, side, back_frac(sn, ss, k["f"], side))
            if f is None:
                print("image-cle %d (dos) : pas d'image de dos dans la cible (levres_dzine.py dos-suivi), laissee" % k["f"])
                continue
        else:                                                   # meme angle, lu sur les reperes des deux orbites
            f = angle_to_frame(dn, ds, frame_to_angle(sn, ss, k["f"]))
            near = min((min(abs(i - f), dn - abs(i - f)) for i, x in enumerate(dmouth) if x and not x.get("ext") and not x.get("back")), default=99)
            if near > 4:                                        # aucun angle suivi pres de cette cle dans la cible
                print("image-cle %d : pas de bouche suivie a cet angle dans la cible, laissee" % k["f"])
                continue
        cards, gom = {}, {}
        for sh, rel in k["cards"].items():
            name = "lips/r%03d_%s.webp" % (f, sh)
            shutil.copyfile(sf / rel, df / name)
            cards[sh] = name
            g = (k.get("gom") or {}).get(sh)                    # la gomme suit la carte (meme place, meme recalage)
            if g and (sf / g).exists():
                shutil.copyfile(sf / g, df / (name[:-5] + "_g.webp"))
                gom[sh] = name[:-5] + "_g.webp"
            else:
                (df / (name[:-5] + "_g.webp")).unlink(missing_ok=True)
        keys.append({"f": f, "x": k["x"], "y": k["y"], "s": k["s"], "cards": cards, "up0": [m["up"][0], m["up"][-1]],
                     "from": "%s/%s" % (si, sv)})
        if gom:
            keys[-1]["gom"] = gom
        if dos:
            keys[-1]["dos"] = 1                          # carte de dos : reste servie aux images de dos de la pose
    keep = []
    if only_back:                                       # les autres cles de la cible restent ; ses anciennes cartes de dos partent
        try:
            old = json.loads((df / "lips.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            old = {}
        fr = {e["f"] for e in keys}
        keep = [e for e in old.get("keys", []) if not e.get("dos") and e["f"] not in fr]
    data = {"w": lips["w"], "h": lips["h"], "model": lips.get("model", ""), "keys": sorted(keep + keys, key=lambda e: e["f"])}
    (df / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    store.mutate_item(di, lambda x: x["variants"][dv]["orbit"].update(lips=int(time.time() * 1000)))
    print("%d image(s)-cle reportee(s) de %s/%s vers %s/%s%s" % (len(keys), si, sv, di, dv, " (%d cles gardees)" % len(keep) if only_back else ""))


if __name__ == "__main__":
    main()
