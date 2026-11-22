"""Compteur de cout par personnage et plafond (10 $ par defaut).

Chaque appel payant (fal, intelligence) ajoute son cout estime a item["cost"] : {"total", "lines": [...], "allow"}.
Les prix sont ceux de settings["budget"] (modifiables dans Reglages) : des estimations relevees a la main, pas une
facture. Avant chaque lancement, estimate_job donne le cout probable (au pire) d'une tache ; si le cumul du personnage
plus cette estimation depasse son plafond, la tache est refusee (BudgetExceeded) tant que l'humain n'a pas releve le
plafond de ce personnage (allow, route bank/<id>/budget). FalProvider.run verifie aussi juste avant chaque appel fal.
"""

import json
import threading
import time

from . import settings, store

_lock = threading.Lock()
MAX_LINES = 60


class BudgetExceeded(ValueError):
    def __init__(self, item, spent, estimate, cap, what=""):
        self.info = {"item": item, "spent": round(spent, 4), "estimate": round(estimate, 4), "cap": round(cap, 2),
                     "what": what}
        super().__init__("plafond du personnage atteint : %.2f $ dépensés, %s coûterait ≈ %.2f $ de plus (plafond %.2f $). "
                         "Confirme dans la fiche pour relever le plafond de ce personnage."
                         % (spent, what or "ce calcul", estimate, cap))


def _cfg():
    return settings.load().get("budget") or {}


def cap_for(it):
    """Plafond d'un element : le plafond general, ou celui que l'humain a releve pour lui."""
    cap = float(_cfg().get("cap") or 10)
    allow = float(((it or {}).get("cost") or {}).get("allow") or 0)
    return max(cap, allow)


def spent(it):
    return float(((it or {}).get("cost") or {}).get("total") or 0)


# ------------------------------------------------------------------ prix
def _match(table, name):
    """Prix d'un modele : l'entree de la table la plus longue contenue dans son nom (None si aucune)."""
    best = None
    for k, v in (table or {}).items():
        if k and k in (name or "") and (best is None or len(k) > len(best[0])):
            best = (k, v)
    return best[1] if best else None


def fal_price(endpoint, payload=None):
    """Cout estime d'un appel fal (en dollars). Orbite MiniMax H3 : au tarif par seconde de sa resolution."""
    c, payload = _cfg(), payload or {}
    ep = endpoint or ""
    if "minimax/h3" in ep:
        res = str(payload.get("resolution") or "768P")
        per_s = float((c.get("h3_per_second") or {}).get(res) or (c.get("h3_per_second") or {}).get("768P") or 0.075)
        return per_s * float(payload.get("duration") or 5)
    if "birefnet" in ep and "video" in ep:
        return float(c.get("matte_video") or 0.05)
    unit = _match(c.get("fal_prices"), ep)
    if unit is None:
        unit = float(c.get("fal_unknown") or 0.15)            # modele inconnu : prudence, au prix de Nano Banana Pro
    if "nano-banana" in ep and str(payload.get("resolution") or "1K") in ("2K", "4K"):
        unit *= 2 if "pro" in ep and payload.get("resolution") == "4K" else 1.5
    return float(unit) * int(payload.get("num_images") or 1)


def llm_price(model, usage):
    """Cout d'un appel a l'intelligence d'apres son usage : {input, output, cache_read, cache_write} en jetons."""
    p = _match(_cfg().get("llm_prices"), model)
    if p is None:                                             # modele inconnu : au prix le plus cher de la table
        p = max((_cfg().get("llm_prices") or {"?": [10, 50, 1, 12.5]}).values(), key=lambda x: x[1])
    pin, pout, pread, pwrite = (list(p) + [0, 0, 0, 0])[:4]
    u = usage or {}
    return (u.get("input", 0) * pin + u.get("output", 0) * pout + u.get("cache_read", 0) * (pread or pin / 10)
            + u.get("cache_write", 0) * (pwrite or pin * 1.25)) / 1e6


def edit_price():
    """Prix d'une image du moteur des poses (fal) ; 0 si les poses se font sur les machines."""
    eng = (settings.load()["render"].get("pose_engine") or "").strip()
    return fal_price(eng[4:], {}) if eng.startswith("fal:") else 0.0


def estimate_job(kind, params, target="auto"):
    """Cout probable, au pire, d'une tache de banque. Les orbites et detourages sur les machines sont gratuits."""
    from . import jobs                                        # import tardif : jobs importe falapi qui importe cost
    s = settings.load()
    p, img = params or {}, edit_price()
    it = None
    try:
        it = store.load_item(p["item"]) if p.get("item") else None
    except (OSError, ValueError, KeyError):
        pass
    tgt = s["render"].get("target", "auto") if target == "auto" else target
    on_fal = tgt == "fal" or not settings.workers()
    if kind == "item_apose":
        return 2 * img
    if kind == "item_views":
        return 3 * img
    if kind == "item_lips":                                   # une bouche redessinee : 1 image Nano Banana Pro
        return fal_price("fal-ai/nano-banana-pro/edit", {})
    if kind == "item_sheet":
        return 3 * img
    if kind == "item_pose":
        drawing = (it or {}).get("style") == "dessin" and (it or {}).get("kind") == "character"
        return img * (jobs.DRAW_TRIES if drawing else 1)
    if kind == "item_orbit":
        if not on_fal:
            return 0.0
        res = s["fal"].get("orbit_resolution") or "768P"
        return fal_price("minimax/h3", {"resolution": res, "duration": 5}) + float(_cfg().get("matte_video") or 0.05)
    if kind in ("item_cut", "item_new"):
        return 0.01 if on_fal else 0.0
    return 0.0


# ------------------------------------------------------------------ compte et plafond
def check(item_id, estimate, what=""):
    """Refuse (BudgetExceeded) si le cumul de l'element plus l'estimation depasse son plafond."""
    if not item_id or estimate <= 0:
        return
    try:
        it = store.load_item(item_id)
    except (OSError, ValueError):
        return
    sp, cap = spent(it), cap_for(it)
    if sp + estimate > cap + 1e-9:
        raise BudgetExceeded(item_id, sp, estimate, cap, what)


def add(item_id, usd, what, kind="fal"):
    """Ajoute une depense a l'element (et au journal data/costs.jsonl). Ne leve jamais."""
    if not item_id or not usd:
        return
    line = {"t": round(time.time()), "what": what, "usd": round(float(usd), 4), "kind": kind}
    try:
        with _lock:
            def fn(it):
                c = it.setdefault("cost", {})
                c["total"] = round(float(c.get("total") or 0) + float(usd), 4)
                c.setdefault("lines", []).append(line)
                del c["lines"][:-MAX_LINES]
            store.mutate_item(item_id, fn)
    except (OSError, ValueError, KeyError):
        pass
    try:
        with open(settings.DATA / "costs.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(dict(line, item=item_id), ensure_ascii=False) + "\n")
    except OSError:
        pass


def allow(item_id, ceiling):
    """L'humain releve le plafond de cet element (jamais en dessous du plafond general)."""
    def fn(it):
        it.setdefault("cost", {})["allow"] = round(float(ceiling), 2)
    return store.mutate_item(item_id, fn)


def summary(it):
    c = (it or {}).get("cost") or {}
    return {"total": round(float(c.get("total") or 0), 4), "cap": cap_for(it), "lines": (c.get("lines") or [])[-30:]}
