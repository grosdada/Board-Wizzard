"""Pont In-House-Dubbing -> Board Wizzard : le scenario et les voix maquettes deviennent un storyboard.

In-House-Dubbing (voix maquettes d'un film, replique par replique) copie sur ce poste, par son bouton « Transfert
audio », un dossier : `_projet.js` (sequences, personnages, repliques, intentions) et, par sequence, la prise retenue
de chaque replique (`SEQ01_slug/SEQ01_L04_PERSONNAGE.wav`). Cet outil lit ce dossier, rien d'autre : il ne touche ni
au serveur d'In-House-Dubbing ni a ses fichiers.

    python tools/doublage.py lire    <dossier>                    ce que le dossier contient, la distribution proposee
    python tools/doublage.py monter  <dossier> --nom "zz essai"   cree le storyboard (--seq SEQ01,SEQ02 pour une partie)
    python tools/doublage.py voix    <storyboard>                 pose les voix arrivees depuis le dernier passage
    python tools/doublage.py voix    <storyboard> --surveiller 30 idem, toutes les 30 secondes

Le storyboard : une suite de pages par sequence (4 cases 16:9), le titre de la scene en cartouche, un plan par case
(une a trois repliques), les personnages de la banque places et tournes les uns vers les autres, et un deck de
montage par sequence. Pas de bulles : les repliques sont portees par les voix (--bulles pour les ecrire aussi). Chaque replique garde son identifiant (`SEQ01_L04`) sur le calque de celui
qui la dit : `voix` y pose le son, les bouches du lip sync (meme ecoute que le navigateur, portee en numpy) et cale
la duree du plan. Relancable : une voix deja posee et inchangee n'est pas retouchee, le reste du storyboard non plus.

La distribution (personnage du scenario -> element de la banque) et les decors par sequence sont dans
`data/doublage/<projet>.json`, a corriger a la main : l'outil ne fait que proposer. Rien n'est genere ni paye ici.
"""
import argparse
import hashlib
import io
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "data" / "doublage"
URL = "http://127.0.0.1:8795/api/"
CID = "pont-doublage"
PAGE = {"format": "hd", "width": 2400, "height": 1350, "bg": "#ffffff", "fill": "#ffffff", "stroke": "#111111",
        "strokeWidth": 5, "gutter": 26, "margin": 60}
PAR_PAGE = 4
HUMEURS = (("colere", r"col[eè]re|furieu|rage|hurle|explose"), ("surpris", r"surpris|stup[eé]f|panique|choc|souffle coup|hoquet"),
           ("rit", r"\brit\b|rire|ricane|glouss|hilare|moqu"), ("triste", r"triste|m[eé]lancol|bless[eé]|peine|sanglot"),
           ("pointe", r"d[eé]signe|pointe du doigt|accuse"))


# ---------------------------------------------------------------- serveur de Board Wizzard
def call(path, method="GET", data=None, raw=None):
    body = raw if raw is not None else (json.dumps(data).encode("utf-8") if data is not None else None)
    req = urllib.request.Request(URL + path, data=body, method=method,
                                 headers={"Content-Type": "application/json" if raw is None else "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error")
        except ValueError:
            msg = str(e)
        sys.exit("Board Wizzard a refusé (%s) : %s" % (e.code, msg))
    except urllib.error.URLError as e:
        sys.exit("Board Wizzard ne répond pas sur %s (%s) : le serveur tourne-t-il ?" % (URL, e.reason))


# ---------------------------------------------------------------- le projet d'In-House-Dubbing
def norm(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn")).strip()


def lire_projet(source):
    """Rend (projet, d'ou il vient). `source` : le dossier du transfert, ou un script.json."""
    src = Path(source)
    if src.is_file():
        return json.loads(src.read_text(encoding="utf-8")), str(src)
    js = src / "_projet.js"
    if js.is_file():
        txt = js.read_text(encoding="utf-8")
        at = txt.index("{", txt.index("IHD_PROJECT"))
        projet = json.JSONDecoder().raw_decode(txt[at:])[0]
        try:
            projet["_name"] = json.JSONDecoder().raw_decode(txt[txt.index("=", txt.index("IHD_NAME")) + 1:].lstrip())[0] or ""
        except ValueError:
            projet["_name"] = ""
        return projet, str(js)
    if (src / "script.json").is_file():
        return json.loads((src / "script.json").read_text(encoding="utf-8")), str(src / "script.json")
    raise SystemExit("ni _projet.js ni script.json dans %s : refais un « Transfert audio » depuis In-House-Dubbing, "
                     "ou indique le scénario dans le fichier de distribution (clé « script »)" % src)


def repliques(projet):
    """Toutes les repliques, a plat : {id, seq, folder, num, ch, kind, text, dir}."""
    out = []
    prenom = projet.get("_name") or (projet.get("nameVar") or {}).get("def") or "{NAME}"   # prenom reglable dans In-House-Dubbing
    for s in projet.get("seqs") or []:
        for l in s.get("lines") or []:
            out.append({"id": "%s_L%s" % (s["id"], l[0]), "seq": s["id"], "folder": s.get("folder") or s["id"], "num": l[0],
                        "ch": l[1], "kind": l[2] or "", "text": (l[3] or "").replace("{NAME}", prenom), "brut": l[3] or "",
                        "dir": (l[4] if len(l) > 4 else "") or ""})
    return out


def fichier_voix(dossier, l):
    return Path(dossier) / l["folder"] / ("%s_%s.wav" % (l["id"], l["ch"]))


# ---------------------------------------------------------------- distribution et decors (data/doublage/<projet>.json)
def meme_nom(c, key, it):
    """L'element de banque porte exactement le nom du personnage (sa cle ou son nom affiche), aux accents et a la casse pres."""
    return norm(it.get("name")) in {norm(key), norm(c.get("n"))}


def proposer(projet, bank):
    """Pour chaque personnage du scenario, l'element de la banque qui porte son nom (regle de David : dans un projet,
    les personnages de la banque sont nommes comme dans In-House-Dubbing) ; a defaut, celui dont le nom lui ressemble
    le plus, ou rien. Le meme nom passe avant tout le reste."""
    titre = norm(projet.get("title"))
    persos = [it for it in bank if it["kind"] == "character"]
    cast = {}
    for key, c in (projet.get("chars") or {}).items():
        mots = set(norm(key).split()) | {m for m in norm(c.get("n")).split() if len(m) > 2}
        best = None
        for it in persos:
            nom = set(norm(it.get("name")).split())
            if not mots & nom:
                continue
            orb = sum(1 for v in it["variants"].values() if v.get("orbit"))
            note = (meme_nom(c, key, it), titre and titre in norm(it.get("folder")), len(mots & nom), orb, it.get("updated") or 0)
            if not best or note > best[0]:
                best = (note, it["id"])
        cast[key] = best[1] if best else ""
    return cast


def reglages(projet, bank, source):
    """Charge (ou cree) le fichier de distribution du projet."""
    f = CONF / ("%s.json" % re.sub(r"[^\w-]", "_", projet.get("id") or "projet"))
    cfg = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    neuf = not cfg
    cfg.setdefault("projet", projet.get("id") or "")
    cfg.setdefault("titre", projet.get("title") or "")
    cfg.setdefault("source", str(source))
    cfg.setdefault("script", "")                                   # scenario de secours tant que le dossier n'a pas de _projet.js
    cfg.setdefault("cast", {})
    for k, v in proposer(projet, bank).items():
        cfg["cast"].setdefault(k, v)
    cfg.setdefault("cast_seq", {})                                 # exceptions : {"SEQ05": {"CARL": "autre-element"}}
    cfg.setdefault("decors", {s["id"]: "" for s in projet.get("seqs") or []})
    for s in projet.get("seqs") or []:
        cfg["decors"].setdefault(s["id"], "")
    CONF.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    return cfg, f, neuf


def ouvrir(source, script=None):
    """Le projet tel que le dossier le donne ; sans _projet.js, le scenario de secours du fichier de distribution."""
    try:
        return lire_projet(script or source)
    except SystemExit:
        for f in CONF.glob("*.json") if CONF.is_dir() else []:
            c = json.loads(f.read_text(encoding="utf-8"))
            if c.get("script") and Path(c.get("source", "")).resolve() == Path(source).resolve():
                return lire_projet(c["script"])
        raise


# ---------------------------------------------------------------- decoupage : des repliques aux plans
def decouper(lignes):
    """Regroupe les repliques d'une sequence en plans : trois repliques au plus, jamais deux fois la meme voix dans un
    plan (un calque ne porte qu'un son), une longue tirade ou un son de groupe seuls dans le leur."""
    plans, cur = [], []

    def flush():
        if cur:
            plans.append(list(cur))
            cur.clear()
    for l in lignes:
        seul = l["ch"] == "GROUPE" or len(l["text"]) > 110
        if seul or len(cur) >= 3 or l["ch"] in {x["ch"] for x in cur} or sum(len(x["text"]) for x in cur) > 150:
            flush()
        cur.append(l)
        if seul:
            flush()
    flush()
    return plans


def duree_estimee(l):
    return 1.2 if l["kind"] == "v" else max(1.0, round(len(l["text"].split()) / 2.6 + 0.4, 1))


class Banque:
    def __init__(self, items):
        self.by = {it["id"]: it for it in items}

    def pose(self, iid, voulues):
        """Premiere variante de la liste qui a une orbite, sinon la base."""
        vs = self.by[iid]["variants"]
        for v in voulues:
            if v in vs and vs[v].get("orbit"):
                return v
        return "base" if "base" in vs else next(iter(vs))

    def image(self, iid, v, axe):
        orb = (self.by[iid]["variants"].get(v) or {}).get("orbit") or {}
        n = orb.get("n") or 72
        axes = ["face", "3/4 face gauche", "profil gauche", "3/4 dos gauche", "dos", "3/4 dos droite", "profil droit", "3/4 face droite"]
        snaps = orb.get("snaps") or {}
        return int(snaps[axe]) if axe in snaps else round(axes.index(axe) * n / 8) % n


def humeur(l):
    d = l["dir"].lower()
    return next((pose for pose, rx in HUMEURS if re.search(rx, d)), None)


def monter_plan(plan, ordre, presents, cast, bq, ids, decor, premier, titre):
    """Une case : calques, bulles, fond. `ordre` : rang d'entree des personnages dans la sequence (gauche -> droite)."""
    parlent = [l["ch"] for l in plan]
    large = len(plan) >= 3 or any(l["ch"] == "GROUPE" for l in plan)
    if large:
        qui = [c for c in ordre if c in parlent or c in presents][:6]
        qui = [c for c in qui if cast.get(c)] or []
    else:
        qui = sorted({c for c in parlent if cast.get(c)}, key=ordre.index)
    n = len(qui)
    layers, bubbles, lines, manque = [], [], [], []
    place = {}
    for i, c in enumerate(qui):
        if n == 1:
            gauche = ordre.index(c) % 2 == 0
            x, s, y = (0.4 if gauche else 0.6), 2.0, 2.3
            axe = "3/4 face droite" if gauche else "3/4 face gauche"
        elif n == 2:
            gauche = i == 0
            x, s, y = (0.28 if gauche else 0.72), 1.45, 1.75
            axe = "3/4 face droite" if gauche else "3/4 face gauche"
        else:
            x, s, y = round(0.12 + 0.76 * i / (n - 1), 3), 0.72, 0.97
            axe = "3/4 face droite" if x < 0.4 else "3/4 face gauche" if x > 0.6 else "face"
        dit = next((l for l in plan if l["ch"] == c), None)
        v = bq.pose(cast[c], ([humeur(dit)] if dit and humeur(dit) else []) + ["parle"]) if dit else bq.pose(cast[c], ["ecoute"])
        lid = "l%d" % next(ids)
        layers.append({"id": lid, "item": cast[c], "v": v, "f": bq.image(cast[c], v, axe), "x": x, "y": y, "s": s, "ihd": c})
        place[c] = (lid, x, y, s)
    off = 0.3
    for k, l in enumerate(plan):
        lid, x, y, s = place.get(l["ch"], (None, 0.5, 0, 0))
        b = {"id": "b%d" % next(ids), "type": "oval" if lid else "box", "text": l["text"], "size": "S", "fs": 2.5, "color": "white", "font": "bd",
             "show": "always", "ihd": l["id"]}
        if n == 1 and lid:
            b["x"], b["y"] = round(min(0.84, max(0.16, x + (0.26 if x < 0.5 else -0.26))), 3), 0.16
        else:
            b["x"], b["y"] = round(min(0.86, max(0.14, x)), 3), round(0.08 + 0.1 * k, 3)
        if lid:
            b["tx"], b["ty"] = x, round(min(1.0, y - s + 0.13 * s), 3)
        else:
            manque.append(l["ch"])
        bubbles.append(b)
        d = duree_estimee(l)
        lines.append({"id": l["id"], "ch": l["ch"], "layer": lid, "text": l["brut"], "dir": l["dir"], "off": round(off, 2), "dur": d})
        off += d + 0.25
    if premier:
        bubbles.append({"id": "b%d" % next(ids), "type": "box", "text": titre, "size": "S", "fs": 2.2, "color": "white", "font": "bd",
                        "show": "always", "x": 0.2, "y": 0.92, "ihd": "titre"})
    pan = {"layers": layers, "bubbles": bubbles, "show": "layers", "view": {"zoom": 1, "ox": 0, "oy": 0},
           "anim": {"dur": max(2.0, math.ceil((off + 0.2) * 2) / 2), "tracks": {}},
           "ihd": {"seq": plan[0]["seq"], "lines": lines}}
    if decor:
        f = 0
        if n == 1:                                                  # contrechamp : le mur d'en face
            f = 6 if layers[0]["x"] < 0.5 else -6
        nb = ((bq.by[decor]["variants"].get("base") or {}).get("orbit") or {}).get("n") or 72
        pan["bg"] = {"item": decor, "v": "base", "f": f % nb}
    return pan, sorted(set(manque))


def grille(pids):
    leaf = lambda i: {"t": "leaf", "id": pids[i]}
    rang = lambda a, b: {"t": "split", "dir": "v", "a": 0.5, "b": 0.5, "c": [leaf(a), leaf(b)]}
    return {"t": "split", "dir": "h", "a": 0.5, "b": 0.5, "c": [rang(0, 1), rang(2, 3)]}


def cmd_monter(a):
    projet, origine = ouvrir(a.source, a.script)
    bank = call("bank")
    cfg, fcfg, _ = reglages(projet, bank, a.source)
    bq = Banque(bank)
    for k, v in list(cfg["cast"].items()) + [(k, v) for d in cfg["cast_seq"].values() for k, v in d.items()] + list(cfg["decors"].items()):
        if v and v not in bq.by:
            sys.exit("%s : « %s » n'est pas dans la banque (corrige %s)" % (k, v, fcfg))
    seqs = [s for s in projet["seqs"] if not a.seq or s["id"] in a.seq.split(",")]
    if not seqs:
        sys.exit("aucune séquence ne correspond à --seq %s" % a.seq)
    toutes = repliques(projet)
    p = call("projects", "POST", {"name": a.nom, "page": PAGE, "layout": {"t": "leaf", "id": "p1"}})
    n0 = [int(p.get("nextId", 50))]

    def compteur():
        while True:
            n0[0] += 1
            yield n0[0]
    ids = compteur()
    pages, decks, sans, nplans = [], [], {}, 0
    for s in seqs:
        lignes = [l for l in toutes if l["seq"] == s["id"]]
        cast = dict(cfg["cast"], **(cfg["cast_seq"].get(s["id"]) or {}))
        ordre = []
        for l in lignes:
            if l["ch"] not in ordre:
                ordre.append(l["ch"])
        presents = {c for c in ordre if c != "GROUPE"}
        titre = "%s · %s" % (s["id"], s.get("title") or "")
        clips, cases = [], []
        for i, plan in enumerate(decouper(lignes)):
            pan, manque = monter_plan(plan, ordre, presents, cast, bq, ids, cfg["decors"].get(s["id"]), i == 0, titre)
            if not a.bulles:                                        # par defaut : les voix portent les repliques, seul le titre de scene reste
                pan["bubbles"] = [b for b in pan["bubbles"] if b.get("ihd") == "titre"]
            for c in manque:
                sans.setdefault(c, set()).add(s["id"])
            cases.append(pan)
        nplans += len(cases)
        for i in range(0, len(cases), PAR_PAGE):
            pids = ["p%d" % next(ids) for _ in range(PAR_PAGE)]
            pg = {"id": "pg%d" % next(ids), "page": dict(PAGE), "layout": grille(pids), "name": titre,
                  "ihd": {"seq": s["id"], "title": s.get("title") or "", "summary": s.get("summary") or ""},
                  "panels": {pid: (cases[i + j] if i + j < len(cases) else {"show": "layers"}) for j, pid in enumerate(pids)}}
            pages.append(pg)
            clips += [{"id": "c%d" % next(ids), "page": pg["id"], "panel": pid} for j, pid in enumerate(pids) if i + j < len(cases)]
        decks.append({"id": "dk%d" % next(ids), "name": titre, "clips": clips})
    p.update({"pages": pages, "decks": decks, "nextId": n0[0] + 1, "_cid": CID,
              "ihd": {"projet": projet.get("id") or "", "titre": projet.get("title") or "", "source": str(Path(a.source).resolve()),
                      "script": origine, "cree": time.strftime("%Y-%m-%d %H:%M")}})
    p = call("projects/" + p["id"], "PUT", p)
    print("Storyboard « %s » créé (%s) : %d séquence(s), %d plans, %d pages." % (p["name"], p["id"], len(seqs), nplans, len(pages)))
    print("  scénario lu dans : %s" % origine)
    for c, ou in sorted(sans.items()):
        nom = (projet["chars"].get(c) or {}).get("n") or c
        print("  sans élément en banque : %s (%s) — sa voix n'aura pas de calque, à distribuer dans %s" % (nom, ", ".join(sorted(ou)), fcfg.name))
    print("  décors : %s" % (", ".join("%s=%s" % (s["id"], cfg["decors"].get(s["id"]) or "aucun") for s in seqs)))
    print("Ensuite : python tools/doublage.py voix %s" % p["id"])
    return p


# ---------------------------------------------------------------- les voix : son, bouches, duree du plan
def ecouter(wav, fps=12):
    """Port fidele de lipsync.js `analyse` : une lettre de bouche par image. Rend {cues, dur, fps}."""
    import numpy as np
    with wave.open(io.BytesIO(wav)) as w:
        sr, nc, sw, total = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(total)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        x = ((b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)) - ((b[:, 2] & 0x80) << 17)).astype(np.float32) / 8388608
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648
    else:
        x = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128) / 128
    x = x.reshape(-1, nc)[:, :2].mean(axis=1) if nc > 1 else x
    total = len(x)
    N = 2048 if sr > 30000 else 1024
    hop, frames = sr / fps, max(1, math.ceil(total / (sr / fps)))
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))
    hz = np.arange(N // 2 + 1) * sr / N
    b0, b1 = min(N // 2 - 1, round(150 * N / sr)), min(N // 2 - 1, round(10000 * N / sr))
    vol, cen, hiss, low = [], [], [], []
    for f in range(frames):
        s0, s1 = int(f * hop), min(total, int((f + 1) * hop))
        seg = x[s0:s1]
        vol.append(math.sqrt(float((seg * seg).sum()) / max(1, s1 - s0)))
        st = (s0 + s1) // 2 - N // 2
        buf = np.zeros(N, np.float32)
        a, b = max(0, st), min(total, st + N)
        if b > a:
            buf[a - st:b - st] = x[a:b]
        m = np.abs(np.fft.rfft(buf * win))[b0:b1 + 1]
        h = hz[b0:b1 + 1]
        al = float(m.sum())
        sm = float(m[h <= 4000].sum())
        cen.append(float((m * h)[h <= 4000].sum()) / sm if sm else 0)
        hiss.append(float(m[h >= 4000].sum()) / al if al else 0)
        low.append(float(m[h <= 450].sum()) / al if al else 0)
    ref = sorted(vol)[int(len(vol) * 0.92)] if vol else 1e-6
    ref = ref or 1e-6
    v = [min(1.5, q / max(ref, 1e-6)) for q in vol]
    quiet = ref < 0.004

    def lettre(i):
        q = v[i]
        if quiet or q < 0.09:
            return "X"
        if hiss[i] > 0.5:
            return "F" if q < 0.35 else "D"
        if low[i] > 0.72 and q < 0.5:
            return "M"
        c = cen[i]
        if c < 620:
            return "U" if q < 0.55 else "O"
        if c < 900:
            return "O"
        if c < 1500:
            return "A" if q > 0.38 else "D"
        return "E" if q > 0.3 else "D"
    r = [lettre(i) for i in range(len(v))]
    for i in range(1, len(r) - 1):
        if v[i] < 0.32 and v[i - 1] > 0.45 and v[i + 1] > 0.45:
            r[i] = "M"
    for i in range(1, len(r)):
        if r[i - 1] == "X" and r[i] in "AO" and v[i] < 0.6:
            r[i] = "D"
    out, run = [], 0
    for i, c in enumerate(r):
        prev = out[i - 1] if i else None
        if i and c != prev and run < 2 and prev != "M" and c != "X":
            out.append(prev)
            run += 1
        else:
            run = run + 1 if c == prev else 1
            out.append(c)
    return {"cues": "".join(out), "dur": round(total / sr, 2), "fps": fps}


def passe_voix(pid, source=None, dit=print):
    """Pose sur le storyboard les voix du dossier qu'il n'a pas encore. Rend le nombre de voix posees."""
    p = call("projects/" + pid)
    meta = p.get("ihd")
    if not meta:
        sys.exit("« %s » ne vient pas d'In-House-Dubbing (pas créé par « monter »)" % pid)
    dossier = Path(source or meta["source"])
    try:
        projet, _ = ouvrir(dossier)
    except SystemExit:
        projet = None
    actuel = {l["id"]: l for l in repliques(projet)} if projet else {}
    poses, attente, orphelines, changees = [], [], [], []
    for pg in p["pages"]:
        for pan in pg["panels"].values():
            lines = (pan.get("ihd") or {}).get("lines") or []
            touche = False
            for ln in lines:
                seq = pan["ihd"].get("seq") or ln["id"].split("_")[0]
                l = {"id": ln["id"], "ch": ln["ch"], "folder": seq}
                if ln["id"] in actuel:
                    l["folder"] = actuel[ln["id"]]["folder"]
                    if norm(actuel[ln["id"]]["brut"]) != norm(ln["text"]) or actuel[ln["id"]]["ch"] != ln["ch"]:
                        changees.append(ln["id"])                  # reecrite depuis le montage : sa voix ne va plus avec cette case
                        continue
                elif projet:
                    changees.append(ln["id"])                      # retiree du scenario
                    continue
                else:                                               # pas de projet lisible : le dossier de la sequence, par son prefixe
                    d = sorted(x for x in dossier.glob(seq + "_*") if x.is_dir())
                    l["folder"] = d[0].name if d else l["folder"]
                f = fichier_voix(dossier, l)
                if not f.is_file():
                    attente.append(ln["id"])
                    continue
                layer = next((x for x in pan.get("layers") or [] if x["id"] == ln.get("layer")), None)
                if not layer or layer.get("ihd", ln["ch"]) != ln["ch"]:   # jamais la voix d'un personnage sur le calque d'un autre
                    orphelines.append(ln["id"])
                    continue
                wav = f.read_bytes()
                sig = hashlib.sha1(wav).hexdigest()[:16]
                lip = layer.get("lip") or {}
                if (lip.get("ihd") or {}).get("sig") == sig:
                    continue
                try:
                    res = ecouter(wav)
                except (wave.Error, EOFError, ValueError) as e:
                    dit("  %s : son illisible (%s), laissé de côté" % (f.name, e))
                    continue
                r = call("projects/%s/audio?%s" % (pid, urllib.parse.urlencode({"name": f.name, "source": "in-house-dubbing"})), "POST", raw=wav)
                try:                                                # banque audio : un dossier par sequence, l'ancienne prise retiree
                    rang = "%s/%s" % (meta.get("titre") or "In-House-Dubbing", seq)
                    urllib.request.urlopen(urllib.request.Request(URL + "audio/" + r["audio"], json.dumps({"folder": rang, "dur": res["dur"]}).encode("utf-8"),
                                                                  {"Content-Type": "application/json"}, method="PUT"), timeout=30).close()
                    old = (lip.get("ihd") or {}).get("audio")
                    if old:
                        urllib.request.urlopen(urllib.request.Request(URL + "audio/" + old, method="DELETE"), timeout=30).close()
                except (urllib.error.URLError, KeyError):
                    pass
                for k in ("in", "out", "segs"):                     # une decoupe faite sur l'ancienne prise ne vaut plus
                    lip.pop(k, None)
                layer["lip"] = {"on": True, "off": 0, "bg": True, **lip, "src": r["file"], "name": f.name, "dur": res["dur"],
                                "fps": res["fps"], "cues": res["cues"], "ihd": {"line": ln["id"], "sig": sig, "audio": r.get("audio")}}
                ln["dur"], touche = res["dur"], True
                poses.append(ln["id"])
            if touche:                                              # les repliques du plan s'enchainent ; la duree du plan suit
                off = 0.3
                for ln in lines:
                    ln["off"] = round(off, 2)
                    layer = next((x for x in pan.get("layers") or [] if x["id"] == ln.get("layer")), None)
                    if layer and (layer.get("lip") or {}).get("ihd", {}).get("line") == ln["id"]:
                        layer["lip"]["off"] = ln["off"]
                    off += ln["dur"] + 0.25
                anim = pan.setdefault("anim", {"dur": 4, "tracks": {}})
                anim["dur"] = max(2.0, min(60, math.ceil((off + 0.2) * 2) / 2))
    if poses:
        p["_cid"] = CID
        call("projects/" + pid, "PUT", p)
    total = sum(len((pan.get("ihd") or {}).get("lines") or []) for pg in p["pages"] for pan in pg["panels"].values())
    dit("%s  %s : %d voix posée(s)%s ; %d réplique(s) encore sans voix sur %d." % (
        time.strftime("%H:%M:%S"), pid, len(poses), (" (" + ", ".join(poses[:8]) + ("…" if len(poses) > 8 else "") + ")") if poses else "",
        len(attente), total))
    if orphelines:
        dit("  voix arrivées mais personnage absent de la case (à distribuer) : %s" % ", ".join(orphelines))
    if changees:
        dit("  répliques réécrites ou retirées dans In-House-Dubbing depuis le montage (voix non posée, case à revoir) : %s" % ", ".join(sorted(set(changees))))
    return len(poses)


def cmd_voix(a):
    if not a.surveiller:
        return passe_voix(a.storyboard, a.source)
    print("Surveillance du dossier toutes les %d s (Ctrl+C pour arrêter)." % a.surveiller)
    while True:
        try:
            passe_voix(a.storyboard, a.source)
        except SystemExit as e:                                     # serveur occupe ou storyboard enregistre ailleurs entre-temps : on repasse
            print("%s  %s" % (time.strftime("%H:%M:%S"), e))
        time.sleep(a.surveiller)


def cmd_lire(a):
    projet, origine = ouvrir(a.source, a.script)
    bank = call("bank")
    cfg, fcfg, neuf = reglages(projet, bank, a.source)
    bq = Banque(bank)
    ls = repliques(projet)
    la = [l for l in ls if fichier_voix(a.source, l).is_file()]
    print("%s (%s) — lu dans %s" % (projet.get("title"), projet.get("id"), origine))
    print("%d séquences, %d répliques, %d voix déjà dans le dossier." % (len(projet["seqs"]), len(ls), len(la)))
    for s in projet["seqs"]:
        sl = [l for l in ls if l["seq"] == s["id"]]
        print("  %s  %-34s %3d répliques, %2d plans, %2d voix   décor : %s" % (
            s["id"], (s.get("title") or "")[:34], len(sl), len(decouper(sl)), sum(1 for l in sl if l in la), cfg["decors"].get(s["id"]) or "—"))
    print("Distribution (%s%s) :" % (fcfg, ", nouvellement créée" if neuf else ""))
    for k, c in projet["chars"].items():
        iid = cfg["cast"].get(k) or ""
        it = bq.by.get(iid)
        jumeaux = [x["id"] for x in bank if x["kind"] == "character" and meme_nom(c, k, x)]
        lien = "" if not it else "  [même nom]" if meme_nom(c, k, it) else "  [NOM DIFFÉRENT : à confirmer]"
        if len(jumeaux) > 1:
            lien += "  [%d éléments portent ce nom : %s]" % (len(jumeaux), ", ".join(jumeaux))
        print("  %-14s %-22s -> %s%s" % (k, c.get("n") or "", ("%s (%s, %d orbites)" % (it["name"], iid, sum(1 for v in it["variants"].values() if v.get("orbit")))) if it
                                         else ("INTROUVABLE : " + iid) if iid else "— personne en banque", lien))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Pont In-House-Dubbing -> Board Wizzard")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for nom in ("lire", "monter"):
        s = sub.add_parser(nom)
        s.add_argument("source", help="dossier rempli par « Transfert audio »")
        s.add_argument("--script", help="scénario (script.json) à lire à la place du _projet.js du dossier")
        if nom == "monter":
            s.add_argument("--nom", required=True, help="nom du storyboard à créer")
            s.add_argument("--bulles", action="store_true", help="écrire aussi chaque réplique en bulle (sans : les voix seules)")
            s.add_argument("--seq", help="séquences à monter, par exemple SEQ01,SEQ02 (toutes par défaut)")
    s = sub.add_parser("voix")
    s.add_argument("storyboard", help="identifiant du storyboard créé par « monter »")
    s.add_argument("--source", help="autre dossier de voix que celui du montage")
    s.add_argument("--surveiller", type=int, default=0, metavar="SECONDES")
    a = ap.parse_args()
    {"lire": cmd_lire, "monter": cmd_monter, "voix": cmd_voix}[a.cmd](a)


if __name__ == "__main__":
    main()
