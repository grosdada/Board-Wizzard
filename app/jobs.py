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

from . import comfy, poses, settings, sprites, store, vector

CAPS = {"item_cut": "matte", "item_orbit": "orbit", "item_pose": "edit", "item_new": "t2i",
        "panel_integrate": "edit", "panel_orbit": "orbit"}
POLL = 3.0
# priorite : 0 = case en cours de travail (Integrate, orbite de case), 1 = banque a la main, 2 = remplissage en lot
PRIO = {"panel_integrate": 0, "panel_orbit": 0}


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
    for attempt in range(2):
        tmp = _tmp()
        try:
            job["progress"] = "orbite, essai %d" % (attempt + 1)
            start = d / v["ref"]
            if (attempt or p.get("studio")) and not decor and v.get("cut"):   # 2e essai : sujet seul sur fond de studio
                start = sprites.studio(d / v["cut"], tmp / "studio.png")
                job["progress"] = "orbite sur fond de studio"
            rgb, mat = prov.orbit(start, length, _seed(job, attempt), poses.orbit_subject(it["kind"], it["name"]),
                                  mp, not decor, tmp)
            job["progress"] = "découpe des images"
            rel = "v/%s/o%d_%d" % (p["variant"], int(time.time()), attempt)
            info = sprites.build_orbit(rgb, mat, d / rel, fill=it.get("style") == "dessin")
            info.update({"dir": rel, "seed": _seed(job, attempt), "length": length})
            if it.get("style") == "dessin":                        # dessin (decor compris) : l'orbite est aussi convertie en traces
                try:
                    job["progress"] = "conversion en tracés"
                    info["vec"] = vector.orbit(d / rel, info["n"])
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

    def apply(x):
        old = (x["variants"][p["variant"]].get("orbit") or {}).get("dir")
        x["variants"][p["variant"]]["orbit"] = best
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


DRAW_TRIES, DRAW_MIN = 4, 0.85


def _log_pose(item, pose, score):
    try:
        with open(settings.DATA / "poses.log", "a", encoding="utf-8") as f:
            f.write("%s %s/%s fidelite %.3f %s\n" % (time.strftime("%d/%m %H:%M"), item, pose, score,
                                                    "ok" if score >= DRAW_MIN else "ECARTEE"))
    except OSError:
        pass


def run_item_pose(job, prov):
    p = job["params"]
    it = store.load_item(p["item"])
    d = store.item_dir(it["id"])
    label, prompt = poses.pose_prompt(it["kind"], p.get("pose", ""), it.get("style", "photo"), p.get("custom", ""))
    tmp = _tmp()
    try:
        base = d / it["variants"]["base"]["ref"]
        if it.get("style") == "dessin" and it["kind"] == "character":
            # dessin : le visage fait partie du design. Plusieurs tirages, on garde le plus fidele a la tete d'origine,
            # et on refuse la pose si aucun ne la respecte (mieux vaut une pose en moins qu'un visage refait).
            label, prompt = poses.pose_prompt_drawing(p.get("pose", ""), p.get("custom", ""))
            best = None
            for k in range(DRAW_TRIES):
                job["progress"] = "pose, tirage %d" % (k + 1)
                cand = prov.edit([base], prompt, _seed(job) + 7919 * k, tmp)
                keep = tmp / ("cand_%d.png" % k)
                sprites.ink(cand, keep)
                score = sprites.face_score(base, keep)
                if best is None or score > best[0]:
                    best = (score, keep)
                if score >= 0.9:
                    break
            _log_pose(it["id"], p.get("pose") or label, best[0])
            if best[0] < DRAW_MIN:
                raise RuntimeError("pose écartée : le visage du dessin n'était pas respecté (fidélité %.2f)" % best[0])
            png = best[1]
        else:
            png = prov.edit([base], prompt, _seed(job), tmp)
        box = {}

        def apply(x):
            same = [k for k, v in x["variants"].items() if p.get("pose") and v.get("pose") == p["pose"]]
            vid = p.get("variant") or (same[0] if same else store.variant_id(x, p.get("pose") or label))
            box["vid"] = vid
            x["variants"].setdefault(vid, {"label": label, "pose": p.get("pose", ""), "ref": "v/%s/ref.png" % vid,
                                           "cut": None, "orbit": None})
        store.mutate_item(it["id"], apply)
        vid = box["vid"]
        sprites.normalize(png, d / ("v/%s/ref.png" % vid))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    follow = {"target": job["target"], "_fal_key": job.get("_fal_key"), "prio": job.get("prio", 1)}
    if it["kind"] != "decor":
        SCHEDULER.add("item_cut", {"item": it["id"], "variant": vid}, "Détourage · %s · %s" % (it["name"], label), **follow)
    if p.get("orbit", True):
        SCHEDULER.add("item_orbit", {"item": it["id"], "variant": vid}, "Orbite · %s · %s" % (it["name"], label), **follow)


def run_item_new(job, prov):
    p = job["params"]
    look = {"photo": "photograph, even soft studio lighting", "dessin": "black ink line drawing, storyboard sketch",
            "3d": "3D render"}.get(p.get("style", "photo"), "")
    kind = p["kind"]
    if kind == "decor":
        prompt, w, h = "%s. Wide establishing view of the empty place, no people. %s." % (p["prompt"], look), 1344, 768
    else:
        prompt = ("%s. One single subject, entire subject visible, centred, three-quarter front view, on a plain light "
                  "grey seamless studio backdrop with a soft ground shadow. %s." % (p["prompt"], look))
        w, h = (832, 1216) if kind == "character" else (1024, 1024)
    tmp = _tmp()
    try:
        png = prov.t2i(prompt, w, h, _seed(job), tmp)
        it = add_item(kind, p.get("name") or p["prompt"][:40], png, p.get("style", "photo"), p.get("tags"),
                      folder=p.get("folder", ""))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    job["result"] = {"item": it["id"]}
    job["params"]["item"] = it["id"]
    prepare(it["id"], orbit=p.get("orbit", True), target=job["target"], fal_key=job.get("_fal_key"), prio=job.get("prio", 1))


def run_panel_integrate(job, prov):
    p = job["params"]
    d = store.project_dir(p["project"])
    prompt = p.get("prompt") or poses.INTEGRATE.get(p.get("style", "photo"), poses.INTEGRATE["photo"])
    if p.get("extra"):
        prompt += " " + p["extra"].strip()
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


RUNNERS = {"item_cut": run_item_cut, "item_orbit": run_item_orbit, "item_pose": run_item_pose,
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


def prepare(item_id, orbit=True, pose_keys=(), target="auto", fal_key=None, prio=1):
    """Met en file ce qu'il faut pour qu'un element soit utilisable : detourage, orbite de base, poses demandees."""
    it = store.load_item(item_id)
    follow = {"target": target, "_fal_key": fal_key, "prio": prio}
    made = []
    base = it["variants"]["base"]
    if it["kind"] != "decor" and not base.get("cut") and not SCHEDULER.pending("item_cut", item=item_id, variant="base"):
        made.append(SCHEDULER.add("item_cut", {"item": item_id, "variant": "base"}, "Détourage · %s" % it["name"], **follow))
    if orbit and not base.get("orbit") and not SCHEDULER.pending("item_orbit", item=item_id, variant="base"):
        made.append(SCHEDULER.add("item_orbit", {"item": item_id, "variant": "base"}, "Orbite · %s" % it["name"], **follow))
    have = {v.get("pose") for v in it["variants"].values()}
    for key in pose_keys:
        if key in have or SCHEDULER.pending("item_pose", item=item_id, pose=key):
            continue
        hit = poses.find(it["kind"], key)
        made.append(SCHEDULER.add("item_pose", {"item": item_id, "pose": key, "orbit": orbit},
                                  "Pose · %s · %s" % (it["name"], hit[0] if hit else key), **follow))
    return made


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
    def add(self, kind, params, title, target="auto", _fal_key=None, prio=None):
        if target not in ("local", "fal", "auto"):
            target = "auto"
        if target == "auto":
            target = settings.load()["render"].get("target", "auto")
        job = {"id": uuid.uuid4().hex[:10], "kind": kind, "params": params, "title": title, "target": target,
               "status": "queued", "worker": "", "created": time.time(), "started": 0, "finished": 0, "error": "",
               "progress": "", "attempts": 0, "_fal_key": _fal_key,
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
            if mode == "local":
                if j["target"] == "fal" or not self.worker_caps(worker["url"], 120).get(cap):
                    continue
            else:
                key = j.get("_fal_key") or settings.load()["fal"].get("key")
                if not key or j["target"] == "local":
                    continue
                if j["target"] == "auto" and self._local_can(cap):
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
                    prov = falapi.FalProvider(job.get("_fal_key") or settings.load()["fal"]["key"], job)
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
