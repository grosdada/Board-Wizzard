"""Essai de l'intelligence (app/brain.py) et du compteur de cout (app/cost.py) sans cle ni reseau : un faux fournisseur
repond a la place d'Anthropic et d'OpenAI. Verifie la forme des requetes (consigne en cache, dessin d'origine en
premier, sortie JSON stricte), la lecture des reponses, le cout et le plafond. Ne touche a aucun element de banque.

    python tools/test_brain.py
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from app import brain, cost  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

ok = True


def check(cond, what):
    global ok
    print(("  ok   " if cond else "  RATE ") + what)
    ok &= bool(cond)


tmp = Path(tempfile.mkdtemp(prefix="bw_brain_"))
orig, img = tmp / "orig.png", tmp / "pose.png"
Image.new("RGB", (800, 1600), "white").save(orig)
Image.new("RGBA", (300, 600), (0, 0, 0, 0)).save(img)
seen = {}


def fake_anthropic(url, headers, body):
    seen.update(url=url, headers=headers, body=body)
    verdict = {"verdict": "refaire", "defauts": ["slip ajouté"], "consigne": "le personnage reste nu", "non_verifie": ["le dos"]}
    return {"type": "message", "stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""},
            {"type": "text", "text": json.dumps(verdict, ensure_ascii=False)}],
            "usage": {"input_tokens": 3000, "output_tokens": 500, "cache_read_input_tokens": 2500, "cache_creation_input_tokens": 0}}


def fake_openai(url, headers, body):
    seen.update(url=url, headers=headers, body=body)
    return {"status": "completed", "output": [{"type": "reasoning"}, {"type": "message", "content": [
        {"type": "output_text", "text": '{"verdict":"garder","defauts":[],"consigne":"","non_verifie":[]}'}]}],
        "usage": {"input_tokens": 4000, "output_tokens": 200, "input_tokens_details": {"cached_tokens": 1000}}}


print("Sans clé")
check(brain.juge("pose", img, orig, cfg={"key": ""}) is None, "juge() rend None sans clé")

print("Anthropic (faux)")
r = brain.juge("pose", img, orig, contexte="mains sur les hanches", cfg={"key": "sk-test", "provider": "anthropic",
               "model": "claude-opus-5-5", "effort": "medium"}, transport=fake_anthropic)
b = seen["body"]
check(seen["url"].endswith("/v1/messages") and seen["headers"]["x-api-key"] == "sk-test", "adresse et en-tête de clé")
check(seen["headers"]["anthropic-version"] == brain.ANTHROPIC_VERSION, "version de l'API")
check(b["system"][0]["cache_control"] == {"type": "ephemeral"} and "Fabriquer un personnage" in b["system"][0]["text"],
      "guide en consigne système, mis en cache")
check(b["output_config"]["format"]["type"] == "json_schema" and b["output_config"]["effort"] == "medium", "sortie JSON stricte, effort")
content = b["messages"][0]["content"]
imgs = [i for i, c in enumerate(content) if c["type"] == "image"]
check(len(imgs) == 2 and "dessin d'origine" in content[imgs[0] - 1]["text"], "le dessin d'origine est la première image")
check("thinking" not in b and "temperature" not in b, "ni thinking désactivé ni température")
check(r["verdict"] == "refaire" and r["defauts"] == ["slip ajouté"] and r["consigne"], "verdict lu")
exp = (3000 * 4 + 500 * 20 + 2500 * 0.2) / 1e6
check(abs(r["cout"] - exp) < 1e-5, "coût calculé (%.5f $)" % r["cout"])

print("OpenAI (faux)")
r = brain.juge("vues", img, orig, extra=[("la pose", img)], cfg={"key": "sk-o", "provider": "openai", "model": "gpt-6.2-sol"},
               transport=fake_openai)
b = seen["body"]
check(seen["url"].endswith("/v1/responses") and seen["headers"]["Authorization"] == "Bearer sk-o", "adresse et clé")
check(b["text"]["format"]["strict"] is True and "Fabriquer un personnage" in b["instructions"], "JSON strict, guide en instructions")
check(sum(1 for c in b["input"][0]["content"] if c["type"] == "input_image") == 3, "trois images (origine, pose, vue)")
check(r["verdict"] == "garder", "verdict lu")
check(abs(r["cout"] - (3000 * 2 + 200 * 10 + 1000 * 0.2) / 1e6) < 1e-6, "coût calculé (%.5f $)" % r["cout"])

print("Réponses de travers")
r = brain.juge("pose", img, orig, cfg={"key": "k"}, transport=lambda u, h, b: {"stop_reason": "refusal", "content": [], "usage": {}})
check(r["verdict"] is None and "refus" in r["erreur"], "refus : pas de verdict, erreur dite")
r = brain.juge("pose", img, orig, cfg={"key": "k"}, transport=lambda u, h, b: {"stop_reason": "end_turn", "usage": {},
               "content": [{"type": "text", "text": '{"verdict":"peut-etre","defauts":[],"consigne":"","non_verifie":[]}'}]})
check(r["verdict"] is None and r.get("erreur"), "verdict inconnu refusé")

def boom(u, h, b):
    raise brain.BrainError("injoignable : test")

r = brain.juge("pose", img, orig, cfg={"key": "k"}, transport=boom)
check(r["verdict"] is None and "injoignable" in r["erreur"], "réseau coupé : la chaîne n'est pas bloquée")
check(brain.test(cfg={"key": "k"}, transport=lambda u, h, b: fake_anthropic(u, h, b))["verdict"] == "refaire", "bouton Tester")

print("Prix fal et estimations")
check(cost.fal_price("openai/gpt-image-2.5/flare/edit") == 0.02, "GPT Image 2.5 : 0,02 $")
check(cost.fal_price("fal-ai/nano-banana-2/edit") == 0.08, "Nano Banana 2 : 0,08 $")
check(cost.fal_price("fal-ai/nano-banana-pro/edit") == 0.15, "Nano Banana Pro : 0,15 $")
check(abs(cost.fal_price("minimax/h3/image-to-video/lora", {"resolution": "480P", "duration": 5}) - 0.31) < 1e-9, "orbite H3 480P 5 s : 0,31 $")
check(cost.fal_price("quelque/chose/inconnu") == 0.15, "modèle inconnu : prix prudent")

print("Plafond")
fake = {"zz": {"id": "zz", "cost": {"total": 9.5}}}
cost.store.load_item = lambda iid: fake[iid]                     # element imaginaire : la banque n'est pas touchee
check(cost.cap_for(fake["zz"]) == 10, "plafond par défaut 10 $")
try:
    cost.check("zz", 0.9, "6 tirages")
    check(False, "dépassement refusé")
except cost.BudgetExceeded as e:
    check(e.info["spent"] == 9.5 and e.info["estimate"] == 0.9 and "plafond" in str(e), "dépassement refusé avec le détail")
cost.check("zz", 0.4, "une image")
check(True, "sous le plafond : accepté")
fake["zz"]["cost"]["allow"] = 15
cost.check("zz", 0.9, "6 tirages")
check(cost.cap_for(fake["zz"]) == 15, "plafond relevé par l'humain : accepté")

print("Audit après tirage (faux juge)")
from app import jobs, store  # noqa: E402

store.item_dir = lambda iid: tmp                                 # element imaginaire : dessin d'origine = orig.png
it = {"id": "zz", "variants": {"base": {"ref": "orig.png"}}}
brain.enabled = lambda: True
brain.config = lambda: {"key": "k", "audit": True, "auto_retry": True, "max_retries": 2}


def scripted(*verdicts):
    seq = list(verdicts)

    def juge(etape, image, origine, contexte="", extra=(), item=None, cfg=None, transport=None):
        v = seq.pop(0) if seq else "garder"
        return {"verdict": v, "defauts": [] if v == "garder" else ["slip ajouté"], "consigne": "reste nu", "non_verifie": []}
    return juge


drawn = []


def redraw(consigne, n):
    drawn.append(consigne)
    return tmp / ("redo_%d.png" % n)


brain.juge = scripted("garder")
im, a = jobs._audit({}, it, "pose", img, redraw=redraw)
check(a["final"] == "garder" and im == img and not drawn, "garder du premier coup : aucune reprise")
brain.juge = scripted("refaire", "garder")
im, a = jobs._audit({}, it, "pose", img, redraw=redraw)
check(a["final"] == "garder" and a["reprises"] == 1 and im.name == "redo_1.png" and drawn == ["reste nu"],
      "refaire puis garder : une reprise, avec la consigne")
drawn.clear()
brain.juge = scripted("refaire", "refaire", "refaire", "refaire")
im, a = jobs._audit({}, it, "pose", img, redraw=redraw)
check(len(drawn) == 2 and a["final"] == "refaire" and a.get("raison"), "au plus deux reprises, puis écartée avec la raison")
drawn.clear()
brain.config = lambda: {"key": "k", "audit": True, "auto_retry": False, "max_retries": 2}
brain.juge = scripted("refaire")
im, a = jobs._audit({}, it, "pose", img, redraw=redraw)
check(not drawn and a["final"] == "refaire", "reprise automatique coupée : avis seul")
brain.config = lambda: {"key": "k", "audit": True, "auto_retry": True, "max_retries": 2}
brain.juge = scripted("refaire")


def broke(consigne, n):
    raise cost.BudgetExceeded("zz", 9.9, 0.15, 10, "reprise")


im, a = jobs._audit({}, it, "pose", img, redraw=broke)
check(a["final"] == "refaire" and "plafond" in a.get("erreur", ""), "plafond atteint pendant une reprise : arrêt propre")
brain.config = lambda: {"key": "k", "audit": False}
check(jobs._audit({}, it, "pose", img)[1] is None, "audit coupé dans les réglages : rien")
brain.enabled = lambda: False
check(jobs._audit({}, it, "pose", img)[1] is None, "sans clé : rien")

print("Planche de la tournette")
odir = tmp / "orbit"
odir.mkdir()
for f in range(72):
    Image.new("RGBA", (200, 400), (255, 255, 255, 255 if f % 2 else 128)).save(odir / ("%03d.webp" % f))
out = jobs._contact_sheet(odir, 72, tmp / "planche.png")
check(Image.open(out).size == (1200, 900), "12 angles sur une planche 4 × 3")

print("\n" + ("Tout est bon." if ok else "Des essais ont raté."))
sys.exit(0 if ok else 1)
