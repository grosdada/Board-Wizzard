"""File de taches : orbites, poses, detourages, images, « Integrate », orbite de case.

Une tache est une petite procedure (RUNNERS) qui demande des images a un fournisseur : LocalProvider (une machine
ComfyUI) ou falapi.FalProvider (cle fal). Un fil par machine, plus quelques fils fal. Cible d'une tache :
local | fal | auto (machines d'abord ; fal seulement si aucune machine ne sait faire).
Les taches en attente survivent a un redemarrage (data/jobs.json) ; la cle fal d'un collegue n'est jamais ecrite.
"""

import json
import os
import shutil
import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path

from . import brain, comfy, cost, falapi, poses, proportions, settings, sprites, store, vector, headtrack

CAPS = {"item_cut": "matte", "item_orbit": "orbit", "item_pose": "edit", "item_new": "t2i", "item_sheet": "edit",
        "item_apose": "edit", "item_views": "edit", "item_lips": "edit", "item_expr": "edit",
        "panel_integrate": "edit", "panel_orbit": "orbit"}
POLL = 3.0
# priorite : 0 = case en cours de travail (Integrate, orbite de case), 1 = banque a la main, 2 = remplissage en lot
PRIO = {"panel_integrate": 0, "panel_orbit": 0, "item_lips": 0}


class Cancelled(Exception):
    pass


# ------------------------------------------------------------------ fournisseur local
class LocalProvider:
    name = "local"

    def __init__(self, url, job):
        self.url, self.job = url, job

    def _run(self, graph, nodes, dest_dir, stem):
        pid = comfy.submit(self.url, graph)
        self.job["_prompt"] = (self.url, pid)
        try:
            while True:
                if self.job.get("_cancel"):
                    comfy.cancel(self.url, pid)
                    raise Cancelled()
                entry = comfy.poll(self.url, pid)
                if entry:
                    break
                time.sleep(POLL)
        finally:
            self.job.pop("_prompt", None)
        out = {}
        for node in nodes:
            files = comfy.node_files(entry, node)
            if not files:
                raise comfy.ComfyError("le noeud %s n'a rien rendu" % node)
            ext = Path(files[0]["filename"]).suffix
            out[node] = comfy.download(self.url, files[0], Path(dest_dir) / ("%s_%s%s" % (stem, node, ext)))
        return out

    def t2i(self, prompt, w, h, seed, dest_dir):
        g = comfy.t2i_graph(prompt, "bw/t2i", w, h, seed)
        return self._run(g, ["9"], dest_dir, "t2i")["9"]

    def edit(self, images, prompt, seed, dest_dir):
        names = [comfy.upload(self.url, p) for p in images]
        g = comfy.edit_graph(names, prompt, "bw/edit", seed)
        return self._run(g, ["20"], dest_dir, "edit")["20"]

    def matte(self, image, dest_dir):
        g = comfy.matte_graph(comfy.upload(self.url, image), "bw/cut")
        return self._run(g, ["5"], dest_dir, "cut")["5"]

    def orbit(self, image, length, seed, prompt, megapixels, matte, dest_dir, refs=None):
        r = settings.load()["render"]
        up = {k: [comfy.upload(self.url, p) for p in v] for k, v in (refs or {}).items()}
        g = comfy.orbit_graph(comfy.upload(self.url, image), "bw/orbit", length=length, seed=seed,
                              megapixels=megapixels, prompt=prompt, steps=r["steps"], matte=matte, refs=up)
        out = self._run(g, ["16", "44"] if matte else ["16"], dest_dir, "orbit")
        return out["16"], out.get("44")


# ------------------------------------------------------------------ procedures
def _tmp():
    return Path(tempfile.mkdtemp(prefix="bwjob_"))


def _seed(job, attempt=0):
    base = int(job["params"].get("seed") or settings.load()["render"]["seed"])
    return base + 7919 * attempt


def run_item_cut(job, prov):
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    v = it["variants"][p["variant"]]
    tmp = _tmp()
    try:
        png = prov.matte(d / v["ref"], tmp)
        rel = "v/%s/cut.webp" % p["variant"]
        w, h, cover = sprites.build_cut(png, d / rel, fill=it.get("style") == "dessin")
        store.mutate_item(it["id"], lambda x: x["variants"][p["variant"]].update(
            {"cut": rel, "cw": w, "ch": h, "t": int(time.time())}))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ intelligence : audit apres chaque tirage
def _brain_on():
    return brain.enabled() and brain.config().get("audit", True) is not False


def _audit(job, it, etape, image, contexte="", extra=(), redraw=None):
    """Verdict de l'intelligence sur une image (le dessin d'origine a cote). redraw(consigne, n) : nouveau tirage avec la
    consigne corrigee (une image payee de plus) ; au plus brain.max_retries reprises, si la reprise automatique est
    permise. Renvoie (image retenue, audit) ; audit None sans intelligence. audit["final"] : garder | refaire | ecarter |
    None (l'intelligence n'a pas repondu : on garde l'image, les controles mesures decident seuls)."""
    if not _brain_on():
        return image, None
    cfg = brain.config()
    tries = max(0, min(2, int(cfg.get("max_retries", 2)))) if (redraw and cfg.get("auto_retry", True) is not False) else 0
    origin = store.item_dir(it["id"]) / it["variants"]["base"]["ref"]
    hist, a = [], None
    for n in range(tries + 1):
        job["progress"] = "intelligence : %s%s" % (etape, " (reprise %d)" % n if n else "")
        a = brain.juge(etape, image, origin, contexte, extra, item=it["id"])
        hist.append({"verdict": a.get("verdict"), "defauts": a.get("defauts"), "consigne": a.get("consigne")})
        if a.get("verdict") != "refaire" or n == tries:
            break
        try:
            new = redraw(a.get("consigne") or "; ".join(a.get("defauts") or []), n + 1)
        except cost.BudgetExceeded as e:                          # plafond : on s'arrete la, l'image reste a juger par l'humain
            a["erreur"] = str(e)
            break
        if new is None:
            break
        image = new
    a["final"] = a.get("verdict")
    a["reprises"] = len(hist) - 1
    a["historique"] = hist
    if a["final"] in ("refaire", "ecarter") and (a["reprises"] >= tries):
        a["raison"] = "; ".join(a.get("defauts") or []) or a.get("consigne") or a["final"]
    return image, a


# fond de couleur : un modele rend parfois un fond blanc (ou transparent, sans background « opaque ») malgre la consigne.
# Une decoupe par la couleur n'en tire rien : l'image est retiree (au plus 2 fois, chaque tirage est compte dans le cout).
BG_MIN, BG_TRIES = 0.20, 3


def _bg_share(path, key):
    """Part des pixels de la couleur de fond attendue (dominance franche, comme sprites.key_rgba)."""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dom = (np.minimum(r, b) - g) if key == "magenta" else (g - np.maximum(r, b))
    return float((dom > 80).mean())


def _key_edit(job, eprov, refs, prompt, seed, tmp, key, what):
    """Edition sur fond de couleur, controlee : moins de BG_MIN de pixels de la couleur de fond = nouveau tirage."""
    share = 0.0
    for n in range(BG_TRIES):
        out = eprov.edit(refs, prompt, seed + 104729 * n, tmp)
        c = Path(tmp) / ("bg_%d_%d.png" % (seed % 1000003, n))
        shutil.copyfile(out, c)
        share = _bg_share(c, key)
        if share >= BG_MIN:
            return c
        job["progress"] = "%s : fond de couleur absent (%d %%), nouveau tirage" % (what, round(share * 100))
    raise RuntimeError("%s : le modèle rend un fond sans la couleur %s (%d tirages, %d %% de fond au dernier) ; la découpe "
                       "par la couleur est impossible" % (what, key, BG_TRIES, round(share * 100)))


def _prop(ref, img, key):
    """Proportions de img comparees a ref (meme fond de couleur) ; None si la mesure echoue."""
    try:
        return proportions.compare(ref, img, key)
    except Exception:                                              # noqa: BLE001 : silhouette illisible, pas de mesure
        return None


def _with_consigne(prompt, consigne):
    c = (consigne or "").strip()
    return prompt + (" Correction demandée après contrôle : " + c if c else "")


def _contact_sheet(orbit_dir, n, dest, cols=4, rows=3, cell=300):
    """Planche de controle d'une tournette : 12 angles reguliers sur fond gris, numerotes."""
    from PIL import Image, ImageDraw
    sheet = Image.new("RGB", (cols * cell, rows * cell), (128, 128, 128))
    dr = ImageDraw.Draw(sheet)
    for k in range(cols * rows):
        f = round(k * n / (cols * rows)) % n
        try:
            im = Image.open(Path(orbit_dir) / ("%03d.webp" % f)).convert("RGBA")
        except OSError:
            continue
        im.thumbnail((cell - 8, cell - 22))
        x, y = (k % cols) * cell, (k // cols) * cell
        sheet.paste(im, (x + (cell - im.width) // 2, y + 18 + (cell - 22 - im.height) // 2), im)
        dr.text((x + 6, y + 3), "%d°" % round(f * 360 / n), fill=(255, 255, 255))
    sheet.save(dest)
    return dest


def _pose_prov(job, prov):
    """Moteur des poses et de la planche de vues. Reglage render.pose_engine = "fal:<modele>" : ces images-la partent sur
    fal avec ce modele, quelle que soit la machine qui tient la tache ; le detourage et l'orbite restent ou ils sont.
    Renvoie (fournisseur, nom du modele ou "")."""
    eng = (settings.load()["render"].get("pose_engine") or "").strip()
    if not eng.startswith("fal:") or not eng[4:].strip():
        return prov, ""
    job = job if job is not None else {}
    fp = falapi.FalProvider(fal_key_for(job), job)
    fp.cfg = dict(fp.cfg, edit=eng[4:].strip())
    return fp, "fal " + eng[4:].strip()


_sheet_locks, _sheet_guard = {}, threading.Lock()


SHEET_AUDIT = ("Vue « %s » de la planche de personnage, faite a partir du dessin d'origine (montre a cote). Exige : le MEME "
               "personnage, vu exactement sous cet angle, en pied, entier, centre ; memes proportions de caricature que le dessin "
               "(taille de la tete par rapport au corps, longueur des jambes, carrure, embonpoint), memes vetements, memes "
               "couleurs, meme coiffure, memes accessoires, rien d'ajoute ni d'enleve (pas de bras en trop, pas d'objet invente) ; "
               "meme style de trait et de remplissage ; une vraie vue de cet angle (pas une vue de face retournee, pas un profil "
               "plat). Refuse au moindre ecart de proportions ou de design : la tournette partira de cette planche.")


def ensure_sheet(it, prov, job=None, redo=False, audit=False):
    """Planche de vues d'un personnage (dos, profil, trois-quarts dos), faite une fois a partir de son image de base.
    Renvoie les chemins des vues. Un verrou par element : deux orbites lancees ensemble ne la calculent qu'une fois."""
    if it["kind"] != "character" or not settings.load()["render"].get("sheet", True):
        return []
    with _sheet_guard:
        lock = _sheet_locks.setdefault(it["id"], threading.Lock())
    d = store.item_dir(it["id"])
    with lock:
        it = store.load_item(it["id"])
        have = {} if redo else dict(it.get("sheet") or {})
        base = d / it["variants"]["base"]["ref"]
        eprov, model = _pose_prov(job, prov)
        for k, (view, _) in enumerate(poses.SHEET_VIEWS):
            if view in have and (d / have[view]).exists():
                continue
            if job is not None:
                job["progress"] = "planche de vues : %s" % view
            tmp = _tmp()
            try:
                rel = "sheet/%s.png" % view
                (d / "sheet").mkdir(parents=True, exist_ok=True)

                def draw(extra="", n=0, view=view, k=k, rel=rel):
                    prompt = poses.sheet_prompt(view, it.get("style", "photo"), faithful=bool(model) and it.get("style") != "dessin")
                    png = eprov.edit([base], prompt + ((" Corrections: " + extra) if extra else ""), 31 + k + 100 * n, tmp)
                    if it.get("style") == "dessin":
                        sprites.ink(png, d / rel)
                    else:
                        sprites.normalize(png, d / rel)
                    return d / rel
                draw()
                if audit and job is not None:                      # planche controlee : chaque vue jugee contre le dessin, refaite si besoin
                    _, a = _audit(job, it, "vues", d / rel, SHEET_AUDIT % view, redraw=lambda c, n: draw(c, n))
                    job.setdefault("_sheet_audit", {})[view] = (a or {}).get("final")
                have[view] = rel
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        store.mutate_item(it["id"], lambda x: x.update(sheet=have, sheet_t=int(time.time()), sheet_model=model or x.get("sheet_model", "")))
        return [d / have[v] for v, _ in poses.SHEET_VIEWS if v in have]


def run_item_sheet(job, prov):
    """Planche de vues. gate (personnage du portrait-robot) : planche controlee AVANT la tournette ; la tournette ne part
    d'elle-meme que si l'intelligence a garde chaque vue, sinon la planche attend d'etre validee dans la fiche."""
    p = job["params"]
    it = store.load_item(p["item"])
    gate = bool(p.get("gate"))
    ensure_sheet(it, prov, job, redo=bool(p.get("redo")), audit=gate)
    if not gate:
        return
    verdicts = job.get("_sheet_audit") or {}
    ok = _brain_on() and verdicts and all(v == "garder" for v in verdicts.values())
    store.mutate_item(it["id"], lambda x: x.update(sheet_wait=not ok, sheet_audit=verdicts))
    if ok:
        SCHEDULER.add("item_orbit", {"item": it["id"], "variant": "base"}, "Orbite · %s · Base" % it["name"],
                      target=job["target"], _fal_key=job.get("_fal_key"), prio=job.get("prio", 1), own_key=bool(job.get("own_key")))


def _key_engine(job, prov):
    """Le fond de couleur demande le moteur des poses fidele (Nano Banana Pro) : Qwen redessine le personnage."""
    eprov, model = _pose_prov(job, prov)
    if not model:
        raise RuntimeError("le fond de couleur demande le moteur des poses Nano Banana Pro (Réglages › Calcul)")
    return eprov, model


def run_item_apose(job, prov):
    """Fiche du personnage : sa pose en A et son image de base, toutes deux sur un fond de couleur uni. Deux images,
    montrees dans la fiche ; rien d'autre ne part tant qu'elles ne sont pas validees (route « apose », action ok)."""
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    key = p.get("key") if p.get("key") in sprites.KEYS else "vert"
    eprov, model = _key_engine(job, prov)
    base = d / it["variants"]["base"]["ref"]
    tmp = _tmp()
    try:
        job["progress"] = "pose en A"
        sprites.normalize(_key_edit(job, eprov, [base], poses.apose_prompt(key), _seed(job), tmp, key, "pose en A"), d / "apose/key.png")
        w, h, _ = sprites.key_cut(d / "apose/key.png", d / "apose/cut.webp", key)
        sprites.key_white(d / "apose/key.png", d / "apose/ref.png", key)
        job["progress"] = "image de base sur fond de couleur"
        sprites.normalize(_key_edit(job, eprov, [base], poses.base_key_prompt(key), _seed(job) + 1, tmp, key, "dessin sur fond de couleur"), d / "apose/base.png")
        sprites.key_cut(d / "apose/base.png", d / "apose/base_cut.webp", key)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    prop = _prop(d / "apose/base.png", d / "apose/key.png", key)   # la pose en A contre le dessin sur le meme fond
    # avis de l'intelligence (l'humain valide la pose en A : pas de reprise automatique)
    _, audit = _audit(job, it, "apose", d / "apose/key.png", "pose en A sur fond %s. Proportions mesurées : %s"
                      % (key, proportions.describe(prop) or "non mesurées"))
    store.mutate_item(it["id"], lambda x: x.update(apose={"key": key, "img": "apose/key.png", "ref": "apose/ref.png",
                                                          "cut": "apose/cut.webp", "base": "apose/base.png",
                                                          "base_cut": "apose/base_cut.webp", "cw": w, "ch": h,
                                                          "state": "pending", "model": model, "t": int(time.time()),
                                                          "audit": audit, "prop": prop}))


def apose_validate(iid):
    """La pose en A est validee : l'element passe sur fond de couleur. Poses, vues et orbites suivantes en partent."""
    def apply(x):
        a = x.get("apose") or {}
        if not a.get("img"):
            raise ValueError("pas de pose en A à valider")
        if not a.get("base"):                                    # c'est lui la reference des poses : sans lui, rien ne part
            raise ValueError("le dessin sur fond de couleur manque : refais la pose en A")
        a["state"] = "ok"
        x["key"] = a.get("key", "vert")
        if a.get("base"):
            x["variants"]["base"]["keyimg"] = a["base"]
    return store.mutate_item(iid, apply)


def run_item_views(job, prov):
    """Vues de dos, de profil et de trois-quarts dos d'une pose, sur le fond de couleur : references de son orbite.
    Elles attendent d'etre validees (review « views_ok ») : un vetement ajoute ou un bras en trop se voit ici."""
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    vid = p.get("variant", "base")
    v = it["variants"][vid]
    key = it.get("key") or "vert"
    if not v.get("keyimg"):
        raise RuntimeError("cette pose n'est pas sur fond de couleur")
    eprov, _ = _key_engine(job, prov)
    have, audits = {}, {}
    for k, (view, _desc) in enumerate(poses.SHEET_VIEWS):
        job["progress"] = "vues de la pose : %s" % view
        tmp = _tmp()
        try:
            rel = "v/%s/sheet/%s.png" % (vid, view)
            prompt = poses.sheet_prompt_key(view, key, it.get("keep", ""))
            sprites.normalize(_key_edit(job, eprov, [d / v["keyimg"]], prompt, _seed(job) + 31 + k, tmp, key, "vue %s" % view), d / rel)

            def redraw(consigne, n, view=view, k=k, prompt=prompt, tmp=tmp):
                out = tmp / ("redo_%d.png" % n)
                sprites.normalize(_key_edit(job, eprov, [d / v["keyimg"]], _with_consigne(prompt, consigne), _seed(job) + 31 + k + 101 * n, tmp, key, "vue %s" % view), out)
                return out

            img, audit = _audit(job, it, "vues", d / rel, "vue « %s » de la pose « %s »" % (view, v.get("label") or vid),
                                extra=[("la pose dont c'est la vue", d / v["keyimg"])], redraw=redraw)
            if img != d / rel:
                shutil.copyfile(img, d / rel)
            if audit:
                audits[view] = audit
            if audit and audit.get("final") in ("refaire", "ecarter"):
                continue                                         # vue fautive : ecartee, l'orbite se fait avec les autres
            have[view] = rel
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    auto = bool(p.get("then_orbit"))
    store.mutate_item(it["id"], lambda x: x["variants"][vid].update(sheet=have, views={"state": "ok" if auto else "pending",
                                                                                     "t": int(time.time()), "audit": audits}))
    if auto:
        SCHEDULER.add("item_orbit", {"item": it["id"], "variant": vid}, "Orbite · %s · %s" % (it["name"], v.get("label") or vid),
                      target=job["target"], _fal_key=job.get("_fal_key"), prio=job.get("prio", 1), own_key=bool(job.get("own_key")))


def run_item_orbit(job, prov):
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    v = it["variants"][p["variant"]]
    r = settings.load()["render"]
    decor = it["kind"] == "decor"
    length = int(p.get("length") or r["orbit_length"])
    mp = float(p.get("megapixels") or (0.8 if decor else r["megapixels"]))
    best = None
    refs = None
    keyed = it.get("key") if v.get("keyimg") and (d / v["keyimg"]).exists() else None
    if keyed:                                                   # fond de couleur : ses propres vues, jamais celles sur papier blanc
        vs = v.get("sheet") or {}
        views = [d / vs[k] for k, _ in poses.SHEET_VIEWS if k in vs and (d / vs[k]).exists()]
        if views and not p.get("no_sheet"):
            refs = {"character": [d / v["keyimg"]] + views[:3]}
    elif it["kind"] == "character" and not p.get("no_sheet"):      # planche de vues d'abord : le dos et le profil servent de references
        try:
            # une pose peut avoir ses propres vues (v/<pose>/sheet) : celles de la base, dans une autre attitude,
            # deteignent sur l'orbite (bras en trop, mains qui retournent dans les poches)
            vs = v.get("sheet") or {}
            views = [d / vs[k] for k, _ in poses.SHEET_VIEWS if k in vs and (d / vs[k]).exists()]
            own = bool(views)
            views = views or ensure_sheet(it, prov, job)
            if views:
                refs = {"character": [d / (v["ref"] if own else it["variants"]["base"]["ref"])] + views[:3]}
        except Exception:                                          # noqa: BLE001 : sans planche, l'orbite se fait comme avant
            refs = None
    for attempt in range(2):
        tmp = _tmp()
        try:
            job["progress"] = "orbite, essai %d" % (attempt + 1)
            start = d / (v["keyimg"] if keyed else v["ref"])
            if (attempt or p.get("studio")) and not decor and v.get("cut") and not keyed:   # 2e essai : sujet seul sur fond de studio
                start = sprites.studio(d / v["cut"], tmp / "studio.png", fill=0.5 if it["kind"] == "asset" else 0.78)
                job["progress"] = "orbite sur fond de studio"
            if it["kind"] == "asset" and not (attempt or p.get("studio")):   # objet : de la marge, pour qu'il tienne au profil
                start = sprites.pad_subject(start, tmp / "marge.png") or start
            rgb, mat = prov.orbit(start, length, _seed(job, attempt), poses.orbit_subject(it["kind"], it["name"]),
                                  mp, not decor and not keyed, tmp, refs=refs)
            job["progress"] = "découpe des images"
            rel = "v/%s/o%d_%d" % (p["variant"], int(time.time()), attempt)
            info = sprites.build_orbit(rgb, mat, d / rel, fill=it.get("style") == "dessin" and not keyed, key=keyed)
            info.update({"dir": rel, "seed": _seed(job, attempt), "length": length})
            if not decor:                                          # base en gros plan (portrait seul) : la face devient le personnage en pied
                info["closeup"] = sprites.fix_closeup_start(d / rel, info["n"])
            if it.get("style") == "dessin":                        # dessin (decor compris) : l'orbite est aussi convertie en traces
                try:
                    job["progress"] = "conversion en tracés"
                    mannequin = "mannequin" in (it.get("tags") or [])
                    if mannequin:                                  # corps sans visage : on suit sa tete pleine, image par image
                        job["progress"] = "suivi de la tête"
                        info["head"] = headtrack.orbit(d / rel, info["n"])["ok"]
                        job["progress"] = "conversion en tracés"
                    info["vec"] = vector.orbit(d / rel, info["n"], hollow=mannequin)
                    info["vt"] = int(time.time())
                except Exception:                                  # noqa: BLE001 : les images suffisent a afficher
                    info["vec"] = False
            # orbite ratee : volet noir, sujet perdu par le detourage, ou camera presque immobile. Le mouvement est
            # rapporte a la place du sujet dans l'image : un petit objet qui tourne bouge peu de pixels.
            rel_motion = info["motion"] / (1.0 if decor else max(info["cover"], 0.03))
            bad = (info["dark"] > 0.08 or info.get("lost", 0) > 0.06 or (not decor and info["cover"] < 0.012)
                   or rel_motion < (0.25 if decor else 0.6))
            info["bad"] = bad
            _orbit_log(it, p["variant"], attempt, info, rel_motion, bad)
            if best is None or (not bad) or info.get("lost", 0) + info["dark"] < best.get("lost", 0) + best["dark"]:
                if best:
                    shutil.rmtree(d / best["dir"], ignore_errors=True)
                best = info
            else:
                shutil.rmtree(d / rel, ignore_errors=True)
            if not bad:
                break
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    best["snaps"] = sprites.default_snaps(best["n"], it.get("facing") or "face")
    best["t"] = int(time.time())
    if it["kind"] == "character" and _brain_on():               # avis de l'intelligence (l'orbite est gratuite : pas de reprise)
        try:
            planche = _contact_sheet(d / best["dir"], best["n"], d / best["dir"] / "planche.png")
            dos = d / best["dir"] / ("%03d.webp" % (best["snaps"].get("dos", best["n"] // 2) % best["n"]))
            _, best["audit"] = _audit(job, it, "tournette", planche, "tournette de « %s »" % (v.get("label") or p["variant"]),
                                      extra=[("le dos, agrandi", dos)])
        except Exception as e:                                    # noqa: BLE001 : l'avis ne doit pas faire perdre l'orbite
            best["audit"] = {"final": None, "erreur": str(e)[:200]}

    def apply(x):
        old = (x["variants"][p["variant"]].get("orbit") or {}).get("dir")
        x["variants"][p["variant"]]["orbit"] = best
        if best.get("closeup") and p["variant"] == "base":       # la vignette montre le personnage en pied, pas le portrait
            sprites.thumb_frame(d / best["dir"] / "000.webp", d / "thumb.jpg")
            x["updated"] = int(time.time())
        if old and old != best["dir"]:
            shutil.rmtree(d / old, ignore_errors=True)
    store.mutate_item(it["id"], apply)


def _orbit_log(it, vid, attempt, info, rel_motion, bad):
    try:
        with open(settings.DATA / "orbits.log", "a", encoding="utf-8") as f:
            f.write("%s %s/%s essai %d mouvement %.2f (relatif %.2f) noir %.2f sujet %.3f %s\n" % (
                time.strftime("%d/%m %H:%M"), it["id"], vid, attempt + 1, info["motion"], rel_motion, info["dark"],
                info["cover"], "RATEE" if bad else "ok"))
    except OSError:
        pass


DRAW_TRIES, DRAW_MIN = 6, 0.85
# trait de la pose par rapport a celui du dessin d'origine, a taille de personnage egale. Mesure sur 195 poses en banque :
# 90 % entre 0,72 et 1,32 ; les poses redessinees d'un trait fin tombent a 0,45-0,70, celles au trait gras a 1,5 et plus.
# Les poses ramassees (assis, accroupi, a terre) sont moins hautes : leur trait parait plus gras, la borne haute est relevee.
LINE_MIN, LINE_MAX, LINE_MAX_LOW = 0.72, 1.45, 1.95
LOW_POSES = ("assis", "accroupi", "a-terre", "assis-tete")
# proportions mesurees (signalement seulement) : poses debout, bras le long du corps ou ecartes, mains loin de la tete
PROP_POSES = ("ecoute", "marche", "mains-hanches", "tend-main")


def _line_ok(ratio, pose):
    return LINE_MIN <= ratio <= (LINE_MAX_LOW if pose in LOW_POSES else LINE_MAX)


def _log_pose(item, pose, score, line=1.0, ok=None):
    try:
        with open(settings.DATA / "poses.log", "a", encoding="utf-8") as f:
            f.write("%s %s/%s fidelite %.3f trait %.2f %s" % (time.strftime("%d/%m %H:%M"), item, pose, score, line,
                                                             "ok" if (score >= DRAW_MIN if ok is None else ok) else "ECARTEE") + chr(10))
    except OSError:
        pass


def _pose_key(job, it, d, eprov, model, validate):
    """Pose d'un personnage sur fond de couleur : dessinee d'apres le dessin d'origine et la pose en A validee, sur le meme
    fond uni. Le detourage vient de la couleur (pas de tache de detourage). Le controle de fidelite reste mesure contre
    le dessin d'origine, sur la pose reposee sur papier blanc."""
    p = job["params"]
    key = it["key"]
    label, prompt = poses.pose_prompt_key(p.get("pose", ""), p.get("custom", ""), key, it.get("keep", ""))
    base = d / it["variants"]["base"]["ref"]
    ap = it["apose"]                                             # 2e reference : le dessin repose sur le fond de couleur (la
    refs = [base, d / (ap.get("base") or ap["img"])]             # pose en A amaigrit les caricatures, elle n'est qu'un controle
    drawing = it.get("style") == "dessin"
    score, line, rejected, best = None, None, False, None
    # proportions de la caricature : un SIGNALEMENT, jamais un rejet. La mesure (cou = rangee la plus etroite du haut du
    # corps) se trompe des qu'une main passe pres de la tete, que la tete penche ou que les bras se levent : 28 poses sur
    # 54 ecartees a tort le 21/11/2026. On ne la prend que pour les poses debout, bras le long du corps ou ecartes.
    pref = d / ap["base"] if ap.get("base") and (d / ap["base"]).exists() else None
    low = p.get("pose", "") in LOW_POSES
    props = {}

    def prop_of(c):
        props[str(c)] = _prop(pref, c, key) if pref and p.get("pose", "") in PROP_POSES else None
        return props[str(c)]

    def measure(c, tag):
        """Fidelite du visage et epaisseur du trait contre le dessin d'origine, quel que soit le style (seuils inchanges).
        Renvoie (fidelite ou None, image, bon, trait)."""
        white = sprites.key_white(c, tmp / ("white_%s.png" % tag), key)
        try:
            sc = float(sprites.face_score(base, white))
        except Exception:                                          # noqa: BLE001 : visage introuvable, pas de mesure
            sc = None
        try:
            ratio = float(sprites.line_ratio(base, white))
        except Exception:                                          # noqa: BLE001 : sans OpenCV, seul le visage est controle
            ratio = 1.0
        prop_of(c)
        # le visage n'ecarte qu'un dessin au trait (style « dessin », ou la mesure a ete reglee) ; pour les autres styles
        # (lavis, couleur), elle reste peu fiable meme corrigee : un simple signalement, la pose attend David
        return (sc, c, (sc is None or sc >= DRAW_MIN or not drawing) and _line_ok(ratio, p.get("pose", "")), ratio)
    tmp = _tmp()
    try:
        for k in range(DRAW_TRIES if drawing else 1):
            job["progress"] = "pose, tirage %d" % (k + 1)
            cand = tmp / ("cand_%d.png" % k)
            shutil.copyfile(_key_edit(job, eprov, refs, prompt, _seed(job) + 7919 * k, tmp, key, "pose"), cand)
            m = measure(cand, k)
            if best is None or (m[2], m[0] or 0) > (best[2], best[0] or 0):
                best = m
            if m[2] and (m[0] or 0) >= 0.9:
                break
        audit = None
        if best[2]:                                              # les controles mesures passent : l'intelligence regarde
            def redraw(consigne, n):
                c = tmp / ("redo_%d.png" % n)
                shutil.copyfile(_key_edit(job, eprov, refs, _with_consigne(prompt, consigne), _seed(job) + 7919 * (DRAW_TRIES + n), tmp, key, "pose"), c)
                redraw.measured = measure(c, "r%d" % n)          # la reprise repasse les controles mesures
                return c
            redraw.measured = None
            pr0 = props.get(str(best[1]))
            ctx = "%s. Proportions mesurées contre le dessin d'origine : %s" % (
                label, proportions.describe(pr0) if pr0 else "non mesurées pour cette pose : juge à l'œil")
            img, audit = _audit(job, it, "pose", best[1], ctx, redraw=redraw)
            if img != best[1]:
                best = redraw.measured or (best[0], img, True, best[3])
            if audit and audit.get("final") in ("refaire", "ecarter"):
                if not validate:
                    raise RuntimeError("pose écartée par l'intelligence : %s" % audit.get("raison", audit["final"]))
                rejected = True
        prop = props.get(str(best[1]))
        score = round(best[0], 3) if best[0] is not None else None
        line = round(float(best[3]), 2)
        _log_pose(it["id"], p.get("pose") or label, best[0] if best[0] is not None else 1.0, line, best[2])
        if not best[2]:
            if not validate:
                if best[0] is not None and best[0] < DRAW_MIN:
                    raise RuntimeError("pose écartée : le visage du dessin n'était pas respecté (fidélité %.2f)" % best[0])
                raise RuntimeError("pose écartée : le trait n'était pas celui du dessin (%.2f fois son épaisseur)" % line)
            rejected = True
        box = {}

        def apply(x):
            same = [k for k, v in x["variants"].items() if p.get("pose") and v.get("pose") == p["pose"]]
            vid = p.get("variant") or (same[0] if same else store.variant_id(x, p.get("pose") or label))
            box["vid"] = vid
            v = x["variants"].setdefault(vid, {"label": label, "pose": p.get("pose", ""), "ref": "v/%s/ref.png" % vid,
                                               "cut": None, "orbit": None})
            if p.get("custom"):
                v["custom"] = p["custom"]
            if p.get("variant"):                                 # pose refaite : ses vues et son orbite ne valent plus
                v["orbit"] = None
            v.pop("sheet", None)
            v.pop("views", None)
            v.update(model=model, keyimg="v/%s/key.png" % vid)
            if validate:
                v["review"] = {"state": "rejected" if rejected else "pending", "score": score, "line": line, "at": int(time.time()),
                               "prop": prop, "low": low}
                if audit:
                    v["review"]["audit"] = audit
            else:
                v.pop("review", None)
            if audit:
                v["audit"] = audit
        store.mutate_item(it["id"], apply)
        vid = box["vid"]
        sprites.normalize(best[1], d / ("v/%s/key.png" % vid))
        sprites.key_white(d / ("v/%s/key.png" % vid), d / ("v/%s/ref.png" % vid), key)
        rel = "v/%s/cut.webp" % vid
        w, h, _ = sprites.key_cut(d / ("v/%s/key.png" % vid), d / rel, key)
        store.mutate_item(it["id"], lambda x: x["variants"][vid].update({"cut": rel, "cw": w, "ch": h, "t": int(time.time())}))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if p.get("orbit", True) and not validate:                    # sans validation demandee : les vues puis l'orbite s'enchainent
        SCHEDULER.add("item_views", {"item": it["id"], "variant": vid, "then_orbit": True},
                      "Vues · %s · %s" % (it["name"], label), target=job["target"], _fal_key=job.get("_fal_key"),
                      prio=job.get("prio", 1), own_key=bool(job.get("own_key")))


def run_item_pose(job, prov):
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    label, prompt = poses.pose_prompt(it["kind"], p.get("pose", ""), it.get("style", "photo"), p.get("custom", ""))
    # « Vérifier avant les orbites » (choisi en preparant) : la pose est generee et detouree, puis attend « Garder »
    validate = bool(p.get("orbit", True)) and bool(p.get("review"))
    score, rejected, line = None, False, None
    eprov, model = _pose_prov(job, prov)
    if model and it["kind"] == "character" and it.get("style") != "dessin":   # moteur fidele : « un autre dessin du meme auteur »
        label, prompt = poses.pose_prompt_faithful(p.get("pose", ""), p.get("custom", ""))
    if (model and it.get("key") and it["kind"] == "character" and (it.get("apose") or {}).get("state") == "ok"
            and "mannequin" not in (it.get("tags") or [])):
        return _pose_key(job, it, d, eprov, model, validate)
    tmp = _tmp()
    try:
        base = d / it["variants"]["base"]["ref"]
        if it.get("style") == "dessin" and it["kind"] == "character" and "mannequin" in (it.get("tags") or []):
            # corps de mannequin (tete lisse, sans visage : la tete est ajoutee en traces par l'application). Pas de
            # visage a respecter : un seul tirage, pas de controle de fidelite.
            label, prompt = poses.pose_prompt_drawing(p.get("pose", ""), p.get("custom", ""))
            cand = eprov.edit([base], prompt, _seed(job), tmp)
            png = tmp / "mannequin.png"
            sprites.ink(cand, png)
        elif it.get("style") == "dessin" and it["kind"] == "character":
            # dessin : le visage fait partie du design. Plusieurs tirages, on garde le plus fidele a la tete d'origine,
            # et on refuse la pose si aucun ne la respecte (mieux vaut une pose en moins qu'un visage refait).
            label, prompt = poses.pose_prompt_drawing(p.get("pose", ""), p.get("custom", ""))
            # deux controles par tirage : le visage (fidelite) et le trait (meme epaisseur que le dessin d'origine). On
            # garde le plus fidele des tirages qui passent les deux ; si aucun ne passe, le plus fidele, marque ecarte.
            best, line = None, 1.0
            for k in range(DRAW_TRIES):
                job["progress"] = "pose, tirage %d" % (k + 1)
                cand = eprov.edit([base], prompt, _seed(job) + 7919 * k, tmp)
                keep = tmp / ("cand_%d.png" % k)
                sprites.ink(cand, keep)
                score = sprites.face_score(base, keep)
                try:
                    ratio = sprites.line_ratio(base, keep)
                except Exception:                                  # noqa: BLE001 : sans OpenCV, seul le visage est controle
                    ratio = 1.0
                good = score >= DRAW_MIN and _line_ok(ratio, p.get("pose", ""))
                if best is None or (good, score) > (best[2], best[0]):
                    best = (score, keep, good, ratio)
                if good and score >= 0.9:
                    break
            line = round(float(best[3]), 2)
            _log_pose(it["id"], p.get("pose") or label, best[0], line, best[2])
            score = round(float(best[0]), 3)
            if not best[2]:
                if not validate:
                    if best[0] < DRAW_MIN:
                        raise RuntimeError("pose écartée : le visage du dessin n'était pas respecté (fidélité %.2f)" % best[0])
                    raise RuntimeError("pose écartée : le trait n'était pas celui du dessin (%.2f fois son épaisseur)" % line)
                rejected = True                                  # gardee quand meme, montree comme ecartee : a repecher ou refaire
            png = best[1]
        else:
            png = eprov.edit([base], prompt, _seed(job), tmp)
        box = {}

        def apply(x):
            same = [k for k, v in x["variants"].items() if p.get("pose") and v.get("pose") == p["pose"]]
            vid = p.get("variant") or (same[0] if same else store.variant_id(x, p.get("pose") or label))
            box["vid"] = vid
            v = x["variants"].setdefault(vid, {"label": label, "pose": p.get("pose", ""), "ref": "v/%s/ref.png" % vid,
                                               "cut": None, "orbit": None})
            if p.get("custom"):
                v["custom"] = p["custom"]
            if p.get("variant"):                                 # pose refaite : l'ancien detourage et l'ancienne orbite ne valent plus
                v["cut"], v["orbit"] = None, None
            if model:
                v["model"] = model
            else:
                v.pop("model", None)
            if validate:
                v["review"] = {"state": "rejected" if rejected else "pending", "score": score, "line": line, "at": int(time.time())}
            else:
                v.pop("review", None)
        store.mutate_item(it["id"], apply)
        vid = box["vid"]
        sprites.normalize(png, d / ("v/%s/ref.png" % vid))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    follow = {"target": job["target"], "_fal_key": job.get("_fal_key"), "prio": job.get("prio", 1),
              "own_key": bool(job.get("own_key"))}
    if it["kind"] != "decor":
        SCHEDULER.add("item_cut", {"item": it["id"], "variant": vid}, "Détourage · %s · %s" % (it["name"], label), **follow)
    if p.get("orbit", True) and not validate:
        SCHEDULER.add("item_orbit", {"item": it["id"], "variant": vid}, "Orbite · %s · %s" % (it["name"], label), **follow)


GEN_REF_MODEL = "openai/gpt-image-2.5/flare/edit"         # generation guidee (croquis, references de style) : jusqu'a 16 images


def _ref_gen(job, imgs, prompt, w, h, dest_dir):
    """Image generee par GPT Image 2.5 (fal) a partir d'images guides : croquis et references de style."""
    fp = falapi.FalProvider(fal_key_for(job), job)
    p = fp._image_payload(GEN_REF_MODEL, prompt, w, h, _seed(job))
    job["progress"] = "fal : envoi des %d image(s) guide" % len(imgs)
    p["image_urls"] = [fp.upload(x) for x in imgs]
    job["progress"] = "fal : génération (GPT Image 2.5)"
    out = fp.run(GEN_REF_MODEL, p)
    return fp.fetch(out["images"][0]["url"], Path(dest_dir) / "gen.png")


def run_item_new(job, prov):
    p = job["params"]
    look = {"photo": "photograph, even soft studio lighting", "dessin": "black ink line drawing, storyboard sketch",
            "3d": "3D render"}.get(p.get("style", "photo"), "")
    kind = p["kind"]
    if kind == "decor":
        prompt, w, h = "%s. Wide establishing view of the empty place, no people. %s." % (p["prompt"], look), 1344, 768
    else:
        # un objet : de face par defaut (legerement du dessus ou d'en dessous au choix) ; un personnage : trois-quarts face
        view = {"dessus": "seen from the front, slightly from above (gentle high angle)", "dessous": "seen from the front, slightly from below (gentle low angle)"}.get(
            p.get("view"), "seen straight from the front at eye level") if kind == "asset" else "three-quarter front view"
        prompt = ("%s. One single subject, entire subject visible, centred, %s, on a plain light "
                  "grey seamless studio backdrop with a soft ground shadow. %s." % (p["prompt"], view, look))
        w, h = (832, 1216) if kind == "character" else (1024, 1024)
    if p.get("raw"):                                             # description complete fournie telle quelle (corps de mannequin, lots)
        prompt = p["prompt"]
    sketch = [settings.DATA / x for x in ([p["sketch"]] if p.get("sketch") else [])]
    refs = [settings.DATA / x for x in (p.get("refs") or [])]
    if sketch or refs:                                           # images guides : croquis d'abord, puis les references de style
        if refs and look:                                        # le style vient des references, pas d'un mot comme « dessin a l'encre »
            prompt = prompt.replace(" %s." % look, "")
        guide = []
        if sketch:
            guide.append("The first image is a rough sketch: follow its pose, composition and proportions, but draw the subject "
                         "properly and completely.")
        if refs:
            guide.append(("The other images" if sketch else "The images") + " are style references only: draw in exactly their "
                         "style (same kind of line, same thickness, same colouring and shading, same rendering), but do not copy "
                         "their subjects, their characters or their backgrounds.")
        prompt = prompt + " " + " ".join(guide)
    tmp = _tmp()
    try:
        png = _ref_gen(job, sketch + refs, prompt, w, h, tmp) if (sketch or refs) else prov.t2i(prompt, w, h, _seed(job), tmp)
        it = add_item(kind, p.get("name") or p["prompt"][:40], png, p.get("style", "photo"), p.get("tags"),
                      folder=p.get("folder", ""))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    job["result"] = {"item": it["id"]}
    job["params"]["item"] = it["id"]
    follow = {"target": job["target"], "_fal_key": job.get("_fal_key"), "prio": job.get("prio", 1), "own_key": bool(job.get("own_key"))}
    if p.get("apose") and kind == "character":                  # pose en A sur fond de couleur, a valider dans la fiche avant la tournette
        SCHEDULER.add("item_apose", {"item": it["id"], "key": "vert"}, "Pose en A · %s" % it["name"], **follow)
        prepare(it["id"], orbit=False, **{k: v for k, v in follow.items() if k != "_fal_key"}, fal_key=job.get("_fal_key"))
    else:
        prepare(it["id"], orbit=p.get("orbit", True), target=job["target"], fal_key=job.get("_fal_key"), prio=job.get("prio", 1),
                own_key=bool(job.get("own_key")))


def run_panel_integrate(job, prov):
    p = job["params"]
    d = store.project_dir(p["project"])
    prompt = p.get("prompt") or poses.INTEGRATE.get(p.get("style", "photo"), poses.INTEGRATE["photo"])
    if p.get("extra"):
        prompt += " " + p["extra"].strip()
    if p.get("edit_model") and isinstance(getattr(prov, "cfg", None), dict):   # modele fal choisi pour Integrate
        prov.cfg = dict(prov.cfg, edit=p["edit_model"])
    tmp = _tmp()
    try:
        png = prov.edit([d / p["flat"]], prompt, _seed(job), tmp)
        rel = "integ/%s_%d.png" % (p["panel"], int(time.time()))
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(png, d / rel)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    def apply(x):
        pan = store.find_panel(x, p["panel"])
        if pan is not None:
            pan.setdefault("integrations", []).append(rel)
            pan["integrated"] = rel
            pan["show"] = "integrated"
    store.mutate_project(p["project"], apply)


def run_panel_orbit(job, prov):
    p = job["params"]
    d = store.project_dir(p["project"])
    r = settings.load()["render"]
    tmp = _tmp()
    try:
        rgb, _ = prov.orbit(d / p["flat"], int(p.get("length") or r["orbit_length"]), _seed(job),
                            "The camera orbits around the centre of the scene.", 0.8, False, tmp)
        rel = "orbit/%s_%d" % (p["panel"], int(time.time()))
        info = sprites.build_orbit(rgb, None, d / rel)
        info["dir"] = rel
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    def apply(x):
        pan = store.find_panel(x, p["panel"])
        if pan is not None:
            pan["orbit"] = dict(info, frame=0)
            pan["show"] = "orbit"
    store.mutate_project(p["project"], apply)


def _lips_folder(iid, vid):
    it = store.load_item(iid)
    o = it["variants"][vid]["orbit"]
    return store.item_dir(iid) / o["dir"]


def _lips_read(folder):
    return json.loads((folder / "lips.json").read_text(encoding="utf-8"))


def _lips_copy(folder, card_rel, dest_rel):
    """Copie une carte et sa gomme (kFFF_X_g.webp) ; rend la gomme copiee (chemin relatif) ou None."""
    (folder / dest_rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(folder / card_rel, folder / dest_rel)
    g, dg = folder / (card_rel[:-5] + "_g.webp"), folder / (dest_rel[:-5] + "_g.webp")
    if g.exists():
        shutil.copyfile(g, dg)
        return dest_rel[:-5] + "_g.webp"
    dg.unlink(missing_ok=True)
    return None


# bouche regeneree : GPT Image 2.5, qualite moyenne (0,02 $). Essai du 22/11/2026 sur 5 images-cles d'un dessin au trait :
# trait et visage gardes (rien de change hors de la bouche), la ou Nano Banana 2 (0,08 $) ajoutait des ombres grises
LIPS_MODEL = "openai/gpt-image-2.5/flare/edit"
# levres.py envoie le format de Nano Banana ; GPT Image 2.5 veut une taille, la qualite moyenne et un fond opaque
_LIPS_RUN = """import sys
sys.path.insert(0, %r)
sys.argv = ["levres.py"] + %r
import levres
from app import falapi
_run = falapi.FalProvider.run
def run(self, ep, p):
    if "gpt-image" in ep:
        p = dict(p)
        p.pop("aspect_ratio", None)
        p.update(image_size={"width": 1024, "height": 1024}, quality="medium", background="opaque")
    return _run(self, ep, p)
falapi.FalProvider.run = run
levres.MODEL = %r
levres.main()
"""


def run_item_lips(job, prov):
    """Montage, editeur des bouches calculees : « Regenerer la bouche ». Redessine une forme (A, O, E ou D) d'une image-cle
    par tools/levres.py (LIPS_MODEL sur fal, 1 image), qui garde les autres formes et les autres images-cles.
    Les versions sont gardees : lips/ver/kFFF_X_vN.webp (+ _g, la gomme), et dans la cle de lips.json
    vers = {X: [chemins des versions]}, cur = {X: version montree}. La carte kFFF_X.webp reste la version montree.
    L'original garde par les retouches (lips/orig/) de cette forme est retire : la nouvelle carte devient l'original."""
    import subprocess
    import sys
    p = job["params"]
    iid, vid, f, sh = p["item"], p["variant"], int(p["f"]), str(p["shape"]).upper()
    job["progress"] = "bouche %s, image %d" % (sh, f)
    folder = _lips_folder(iid, vid)
    old = next((k for k in _lips_read(folder).get("keys", []) if k["f"] == f), None) or {}
    vers, cur = dict(old.get("vers") or {}), dict(old.get("cur") or {})
    card = (old.get("cards") or {}).get(sh)
    if card and (folder / card).exists():
        if not vers.get(sh):                                   # premiere regeneration : la bouche d'avant devient la version 1
            vers[sh] = ["lips/ver/k%03d_%s_v1.webp" % (f, sh)]
            cur[sh] = 0
        _lips_copy(folder, card, vers[sh][cur.get(sh, 0)])    # la version montree, avec ses retouches enregistrees
    root = Path(__file__).resolve().parent.parent
    run = _LIPS_RUN % (str(root / "tools"), [iid, vid, "--images", str(f), "--formes", sh], LIPS_MODEL)
    r = subprocess.run([sys.executable, "-c", run],
                       cwd=str(root), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode or "ERREUR" in out or ("ok %d %s" % (f, sh)) not in out:
        raise RuntimeError("bouche non régénérée : " + (out.strip().splitlines() or ["?"])[-1][:400])
    data = _lips_read(folder)
    key = next((k for k in data["keys"] if k["f"] == f), None)
    if key and key.get("cards", {}).get(sh):
        n = len(vers.get(sh, [])) + 1
        rel = "lips/ver/k%03d_%s_v%d.webp" % (f, sh, n)
        _lips_copy(folder, key["cards"][sh], rel)
        vers[sh] = vers.get(sh, []) + [rel]
        cur[sh] = n - 1
        key["vers"] = {a: b for a, b in vers.items() if a in key["cards"]}
        key["cur"] = {a: b for a, b in cur.items() if a in key["vers"]}
        (folder / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    (folder / "lips" / "orig" / ("k%03d_%s.webp" % (f, sh))).unlink(missing_ok=True)
    store.mutate_item(iid, lambda x: x["variants"][vid]["orbit"].update(lips=int(time.time() * 1000)))


def lips_use_version(iid, vid, f, sh, i):
    """Montrer une autre version d'une bouche regeneree : la version montree garde ses retouches (copiee dans son fichier),
    puis la version i devient la carte kFFF_X.webp (et sa gomme). Rend l'element."""
    folder = _lips_folder(iid, vid)
    data = _lips_read(folder)
    key = next((k for k in data["keys"] if k["f"] == int(f)), None)
    vers = (key or {}).get("vers", {}).get(sh) or []
    if not key or not 0 <= int(i) < len(vers):
        raise ValueError("version de bouche inconnue")
    card = key["cards"][sh]
    c = key.setdefault("cur", {}).get(sh, len(vers) - 1)
    bk = settings.DATA / "backup" / ("lips_%s_%s_%s.json" % (iid, vid, time.strftime("%Y%m%d_%H%M%S")))
    bk.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(folder / "lips.json", bk)
    _lips_copy(folder, card, vers[c])
    g = _lips_copy(folder, vers[int(i)], card)
    if g:
        key.setdefault("gom", {})[sh] = card[:-5] + "_g.webp"
    elif key.get("gom"):
        key["gom"].pop(sh, None)
        if not key["gom"]:
            key.pop("gom")
    key["cur"][sh] = int(i)
    (folder / "lips" / "orig" / ("k%03d_%s.webp" % (int(f), sh))).unlink(missing_ok=True)
    (folder / "lips.json").write_text(json.dumps(data), encoding="utf-8")
    return store.mutate_item(iid, lambda x: x["variants"][vid]["orbit"].update(lips=int(time.time() * 1000)))


def run_item_expr(job, prov):
    """Fiche du personnage, « Expressions à générer » : cartes d'expression d'une orbite (app/exprcards.py), une image Nano
    Banana Pro sur fal par grille de quatre expressions et par image-cle de face. Les expressions deja faites sont gardees."""
    from . import exprcards
    p = job["params"]
    vid = p.get("variant") or "base"
    keys = [k for k in p.get("exprs") or [] if poses.expression(k)]
    if not keys:
        raise ValueError("aucune expression demandée")
    exprcards.run_fal(job, keys, p.get("frames") or None, vid)


RUNNERS = {"item_cut": run_item_cut, "item_lips": run_item_lips, "item_expr": run_item_expr, "item_orbit": run_item_orbit, "item_pose": run_item_pose, "item_sheet": run_item_sheet,
           "item_apose": run_item_apose, "item_views": run_item_views,
           "item_new": run_item_new, "panel_integrate": run_panel_integrate, "panel_orbit": run_panel_orbit}


# ------------------------------------------------------------------ banque : creation et preparation
def add_item(kind, name, image_path, style="photo", tags=None, facing="face", folder=""):
    """Cree un element a partir d'une image ; la variante « base » est l'image elle-meme."""
    it = store.create_item(kind, name, style, tags)
    d = store.item_dir(it["id"])
    w, h = sprites.normalize(image_path, d / "v/base/ref.png")
    sprites.thumb(d / "v/base/ref.png", d / "thumb.jpg")

    def apply(x):
        x.update({"source": "v/base/ref.png", "w": w, "h": h, "facing": facing, "folder": folder or ""})
        x["variants"]["base"] = {"label": "Base", "pose": "", "ref": "v/base/ref.png", "cut": None, "orbit": None}
    return store.mutate_item(it["id"], apply)


def prepare(item_id, orbit=True, pose_keys=(), target="auto", fal_key=None, prio=1, own_key=False, review=False):
    """Met en file ce qu'il faut pour qu'un element soit utilisable : detourage, orbite de base, poses demandees."""
    it = store.load_item(item_id)
    follow = {"target": target, "_fal_key": fal_key, "prio": prio, "own_key": own_key}
    made = []
    base = it["variants"]["base"]
    if it["kind"] != "decor" and not base.get("cut") and not SCHEDULER.pending("item_cut", item=item_id, variant="base"):
        made.append(SCHEDULER.add("item_cut", {"item": item_id, "variant": "base"}, "Détourage · %s" % it["name"], **follow))
    # fond de couleur : l'orbite de la base attend ses vues, faites et validees dans la fiche (sans elles, profils plats)
    need_views = bool(it.get("key") and base.get("keyimg") and (base.get("views") or {}).get("state") != "ok")
    if orbit and not need_views and not base.get("orbit") and not SCHEDULER.pending("item_orbit", item=item_id, variant="base"):
        made.append(SCHEDULER.add("item_orbit", {"item": item_id, "variant": "base"}, "Orbite · %s" % it["name"], **follow))
    have = {v.get("pose") for v in it["variants"].values()}
    for key in pose_keys:
        if key in have or SCHEDULER.pending("item_pose", item=item_id, pose=key):
            continue
        hit = poses.find(it["kind"], key)
        made.append(SCHEDULER.add("item_pose", {"item": item_id, "pose": key, "orbit": orbit, "review": bool(review)},
                                  "Pose · %s · %s" % (it["name"], hit[0] if hit else key), **follow))
    return made


def fal_key_for(job):
    """Cle fal d'une tache : celle du navigateur, sinon celle du serveur, sauf pour un invite non VIP (own_key)."""
    return job.get("_fal_key") or ("" if job.get("own_key") else settings.load()["fal"].get("key") or "")


# ------------------------------------------------------------------ planificateur
class Scheduler:
    def __init__(self):
        self.jobs = []
        self.lock = threading.RLock()
        self.wake = threading.Condition(self.lock)
        self.threads = {}
        self.caps = {}            # url -> (instant, preflight)
        self.started = False
        self.paused = False          # ne prend plus de tache (pour finir celles en cours avant un redemarrage)

    # ---- persistance
    def _file(self):
        return settings.DATA / "jobs.json"

    def _persist(self):
        keep = [{k: v for k, v in j.items() if not k.startswith("_")} for j in self.jobs
                if j["status"] in ("queued", "running")]
        try:
            settings.DATA.mkdir(parents=True, exist_ok=True)
            tmp = self._file().with_suffix(".tmp")
            tmp.write_text(json.dumps(keep, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self._file())
        except OSError:
            pass

    def start(self):
        if self.started:
            return
        self.started = True
        try:
            for j in json.loads(self._file().read_text(encoding="utf-8")):
                j.update({"status": "queued", "worker": "", "progress": ""})
                self.jobs.append(j)
        except (OSError, ValueError):
            pass
        threading.Thread(target=self._supervise, daemon=True).start()

    def _supervise(self):
        """Un fil par machine ComfyUI (la liste peut changer dans les reglages) + les fils fal."""
        while True:
            for w in settings.workers():
                key = "local:" + w["url"]
                if key not in self.threads or not self.threads[key].is_alive():
                    t = threading.Thread(target=self._loop, args=("local", w), daemon=True)
                    self.threads[key] = t
                    t.start()
            for i in range(int(settings.load()["fal"].get("concurrency", 3))):
                key = "fal:%d" % i
                if key not in self.threads or not self.threads[key].is_alive():
                    t = threading.Thread(target=self._loop, args=("fal", {"name": "fal", "url": ""}), daemon=True)
                    self.threads[key] = t
                    t.start()
            time.sleep(20)

    # ---- capacites
    def worker_caps(self, url, max_age=45):
        hit = self.caps.get(url)
        if hit and time.time() - hit[0] < max_age:
            return hit[1]
        info = comfy.preflight(url)
        self.caps[url] = (time.time(), info)
        return info

    def workers_status(self):
        out = []
        for w in settings.workers():
            info = dict(self.worker_caps(w["url"]))
            info.update({"name": w["name"], "url": w["url"],
                         "busy": any(j["status"] == "running" and j.get("worker") == w["name"] for j in self.jobs)})
            out.append(info)
        return out

    def _local_can(self, cap):
        return any(self.worker_caps(w["url"], 120).get(cap) for w in settings.workers())

    # ---- file
    def add(self, kind, params, title, target="auto", _fal_key=None, prio=None, own_key=False):
        """own_key : tache d'un invite non VIP, qui ne peut pas utiliser la cle fal du serveur (seulement la sienne)."""
        if own_key and not _fal_key:                   # sinon la tache attendrait sans fin : aucun fil ne peut la prendre
            raise ValueError("aucune clé fal : entre ta clé dans Réglages › fal (cloud) › « Ma clé (ce navigateur) »")
        if target not in ("local", "fal", "auto"):
            target = "auto"
        if target == "auto":
            target = settings.load()["render"].get("target", "auto")
        est = self.budget_check(kind, params, target, title)
        job = {"id": uuid.uuid4().hex[:10], "kind": kind, "params": params, "title": title, "target": target, "_est": est,
               "status": "queued", "worker": "", "created": time.time(), "started": 0, "finished": 0, "error": "",
               "progress": "", "attempts": 0, "_fal_key": _fal_key, "own_key": bool(own_key),
               "prio": PRIO.get(kind, 1) if prio is None else int(prio)}
        with self.wake:
            self.jobs.append(job)
            if len(self.jobs) > 3000:
                done = [j for j in self.jobs if j["status"] not in ("queued", "running")]
                for j in done[:len(self.jobs) - 3000]:
                    self.jobs.remove(j)
            self._persist()
            self.wake.notify_all()
        return job["id"]

    def queued_cost(self, item_id):
        """Cout estime des taches de cet element deja en file ou en cours (pas encore toutes comptees)."""
        with self.lock:
            return sum(j.get("_est") or 0 for j in self.jobs
                       if j["status"] in ("queued", "running") and j["params"].get("item") == item_id)

    def budget_check(self, kind, params, target="auto", title="", extra=0.0):
        """Plafond du personnage : son cumul + ce qui est deja en file + cette tache (+ extra) ne doit pas le depasser.
        Leve cost.BudgetExceeded ; renvoie le cout estime de la tache."""
        from . import cost
        item = (params or {}).get("item")
        if not item or kind not in CAPS:
            return 0.0
        est = cost.estimate_job(kind, params, target)
        if est > 0 or extra > 0:
            cost.check(item, est + extra + self.queued_cost(item), title or kind)
        return est

    def pending(self, kind, **match):
        """Une tache identique attend-elle deja ou tourne-t-elle ? (evite les doublons)"""
        with self.lock:
            return any(j["kind"] == kind and j["status"] in ("queued", "running") and
                       all(j["params"].get(k) == v for k, v in match.items()) for j in self.jobs)

    def public(self, active_only=False):
        with self.lock:
            rows = [{k: v for k, v in j.items() if not k.startswith("_")} for j in self.jobs
                    if not active_only or j["status"] in ("queued", "running")]
        live = [r for r in rows if r["status"] in ("queued", "running")]
        return [r for r in rows if r["status"] not in ("queued", "running")][-150:] + live

    def cancel(self, job_id):
        with self.wake:
            for j in self.jobs:
                if j["id"] == job_id and j["status"] in ("queued", "running"):
                    if j["status"] == "queued":
                        j.update({"status": "cancelled", "finished": time.time()})
                    else:
                        j["_cancel"] = True
            self._persist()

    def cancel_all(self):
        for j in list(self.jobs):
            self.cancel(j["id"])

    def clear(self):
        with self.lock:
            self.jobs = [j for j in self.jobs if j["status"] in ("queued", "running")]

    def _take(self, mode, worker):
        """Plus ancienne tache en attente que ce fil peut prendre."""
        if self.paused:
            return None
        for j in sorted(self.jobs, key=lambda x: (x.get("prio", 2), x["created"])):
            if j["status"] != "queued" or worker["name"] in j.get("_avoid", ()):
                continue
            cap = CAPS[j["kind"]]
            own = bool(j.get("own_key"))                       # invite non VIP : jamais les machines du poste, fal avec sa cle
            if mode == "local":
                if own or j["target"] == "fal" or not self.worker_caps(worker["url"], 120).get(cap):
                    continue
            else:
                key = fal_key_for(j)
                if not key or (j["target"] == "local" and not own):
                    continue
                if j["target"] == "auto" and not own and self._local_can(cap):
                    continue
            j.update({"status": "running", "worker": worker["name"], "started": time.time(), "progress": ""})
            j["attempts"] += 1
            self._persist()
            return j
        return None

    def _loop(self, mode, worker):
        while True:
            if mode == "local" and not any(w["url"] == worker["url"] for w in settings.workers()):
                return                                           # machine retiree des reglages
            if mode == "local":
                self.worker_caps(worker["url"], 120)             # appel reseau hors du verrou
            with self.wake:
                job = self._take(mode, worker)
                if not job:
                    self.wake.wait(timeout=8)
                    continue
            try:
                if mode == "local":
                    prov = LocalProvider(worker["url"], job)
                else:
                    from . import falapi
                    prov = falapi.FalProvider(fal_key_for(job), job)
                RUNNERS[job["kind"]](job, prov)
                job.update({"status": "done", "finished": time.time(), "progress": ""})
            except Cancelled:
                job.update({"status": "cancelled", "finished": time.time()})
            except Exception as exc:                              # noqa: BLE001 : une tache ne doit pas tuer le fil
                msg = "%s : %s" % (exc.__class__.__name__, exc)
                transient = any(s in msg.lower() for s in ("out of memory", "cuda", "urlerror", "timed out",
                                                           "connection", "10054", "10060", "10061"))
                if transient and job["attempts"] < 3:
                    job.setdefault("_avoid", set()).add(worker["name"])
                    if mode == "local" and len(job["_avoid"]) >= len(settings.workers()):
                        job["_avoid"] = set()
                    job.update({"status": "queued", "worker": "", "progress": "relance après : " + msg[:120]})
                    self.caps.pop(worker.get("url"), None)
                    time.sleep(5)
                else:
                    job.update({"status": "error", "finished": time.time(), "error": msg[:900]})
                    try:
                        with open(settings.DATA / "errors.log", "a", encoding="utf-8") as f:
                            f.write("%s %s %s\n%s\n" % (time.strftime("%d/%m %H:%M:%S"), job["kind"], job["title"],
                                                         traceback.format_exc()))
                    except OSError:
                        pass
            with self.wake:
                self._persist()
                self.wake.notify_all()


SCHEDULER = Scheduler()
