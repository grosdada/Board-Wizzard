"""Intelligence de Board Wizzard : un modele de langage qui regarde les images produites et rend un verdict structure.

Fournisseurs : Anthropic (API Messages) ou OpenAI (API Responses), en HTTP direct (bibliotheque standard). Reglages
« brain » de local_settings.json : provider, key, model, effort. La cle reste sur le serveur : jamais renvoyee au
navigateur ni ecrite dans un journal. Sans cle, enabled() est faux et juge() renvoie None : tout marche comme avant.

Consigne systeme : app/guide/personnages.md (la methode et les controles), mise en cache chez Anthropic. Chaque appel
montre le dessin d'origine A COTE de l'image jugee (jamais une image generee comme reference). Sortie JSON stricte :
{verdict: garder|refaire|ecarter, defauts: [...], consigne: "...", non_verifie: [...]}.

L'avis de l'intelligence s'ajoute aux controles mesures (fidelite, trait) : il ne les remplace ni ne les assouplit.
Tests sans cle ni reseau : passer transport= (voir tools/test_brain.py).
"""

import base64
import io
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import cost, settings

GUIDE = Path(__file__).resolve().parent / "guide" / "personnages.md"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2026-10-21"
OPENAI_URL = "https://api.openai.com/v1/responses"
VERDICTS = ("garder", "refaire", "ecarter")

# ce que l'intelligence regarde a chaque etape (resume du guide, section 3) ; le guide entier est dans la consigne systeme
ETAPES = {
    "apose": "Étape 1, pose en A sur fond de couleur. L'humain valide cette image : donne seulement ton avis. Vérifie : "
             "fond uni partout, y compris entre les membres ; le corps est resté blanc (pas verdi) ; visage, proportions "
             "et trait fidèles au dessin d'origine ; bras écartés, aucun membre ne touche le corps ; rien d'ajouté.",
    "pose": "Étape 2, une pose. Vérifie contre le dessin d'origine : même visage et mêmes proportions ; même trait et "
            "même remplissage ; aucun vêtement ajouté (t-shirt, short, slip) ; la pose demandée est bien prise (pas "
            "identique à la base) ; aucun détail du corps perdu ; aucun membre en trop ; aucune couleur apparue.",
    "vues": "Étape 3, une vue (dos, profil ou trois-quarts dos) d'une pose. Vérifie : ligne de ceinture ou d'élastique "
            "au dos (slip ajouté) ; nombre de bras ; un « profil » qui n'est qu'un trois-quarts ; crâne devenu tout noir ; "
            "visage qui change d'expression ; l'attitude est celle de la pose. Une vue fautive s'écarte (verdict ecarter).",
    "tournette": "Étape 4, planche de 10 à 12 angles d'une tournette, dos agrandi. Vérifie : tour complet et régulier ; "
                 "profils avec du volume (pas plats) ; dos sans ceinture ; compte les bras au dos ; vides ouverts ; pas "
                 "de liseré de la couleur du fond.",
    "bouches": "Étape 5, bouches dessinées (A, O, É, entrouverte). Vérifie : même trait ; intérieur de la bouche ouverte "
               "ombré avec la matière du dessin, jamais un aplat noir ; moustache et barbe gardées ; pas de halo gris ; "
               "un É qui devient un sourire est refusé ; le O n'est pas un simple point noir.",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "defauts": {"type": "array", "items": {"type": "string"}},
        "consigne": {"type": "string"},
        "non_verifie": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "defauts", "consigne", "non_verifie"],
    "additionalProperties": False,
}

SORTIE = ("\n\n## Format de ta réponse\n"
          "Réponds uniquement par un objet JSON : verdict (garder, refaire ou ecarter), defauts (liste courte des défauts "
          "vus, en français, chacun nommé précisément ; vide si aucun), consigne (une phrase à ajouter à la consigne du "
          "prochain tirage pour corriger le défaut principal ; vide si garder), non_verifie (ce que tu n'as pas pu "
          "vérifier sur ces images). Dans le doute, refaire ou ecarter, jamais garder par indulgence.")


class BrainError(RuntimeError):
    pass


def config():
    return settings.load().get("brain") or {}


def enabled():
    return bool((config().get("key") or "").strip())


def system_prompt():
    return GUIDE.read_text(encoding="utf-8") + SORTIE


# ------------------------------------------------------------------ images
def _encode(path, max_side=1024):
    """Image en PNG base64, reduite (cote max 1024) ; la transparence est posee sur un gris moyen, ou le blanc d'un
    dessin reste visible."""
    from PIL import Image
    im = Image.open(path)
    im.load()
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (128, 128, 128, 255))
        bg.alpha_composite(im)
        im = bg
    im = im.convert("RGB")
    k = max_side / max(im.size)
    if k < 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def _parse(text):
    try:
        out = json.loads(text)
    except ValueError:
        a, b = text.find("{"), text.rfind("}")
        if a < 0 or b <= a:
            raise BrainError("réponse illisible : %s" % text[:200])
        out = json.loads(text[a:b + 1])
    v = str(out.get("verdict", "")).strip().lower().replace("é", "e")
    if v not in VERDICTS:
        raise BrainError("verdict inconnu : %r" % out.get("verdict"))
    return {"verdict": v, "defauts": [str(x) for x in out.get("defauts") or []][:12],
            "consigne": str(out.get("consigne") or "")[:600],
            "non_verifie": [str(x) for x in out.get("non_verifie") or []][:12]}


# ------------------------------------------------------------------ transport
def _post(url, headers, body, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers=dict(headers, **{"Content-Type": "application/json"}))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        if e.code in (401, 403):
            raise BrainError("la clé est refusée (%d)" % e.code)
        raise BrainError("erreur %d : %s" % (e.code, detail))
    except urllib.error.URLError as e:
        raise BrainError("injoignable : %s" % e.reason)


def _anthropic(cfg, system, blocks, max_tokens, transport):
    content = []
    for kind, val in blocks:
        content.append({"type": "text", "text": val} if kind == "text" else
                       {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": val}})
    body = {"model": cfg["model"], "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": content}],
            "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}}}
    if cfg.get("effort"):
        body["output_config"]["effort"] = cfg["effort"]
    headers = {"x-api-key": cfg["key"], "anthropic-version": ANTHROPIC_VERSION}
    r = transport(ANTHROPIC_URL, headers, body) if transport else _post(ANTHROPIC_URL, headers, body)
    if r.get("type") == "error":
        raise BrainError((r.get("error") or {}).get("message") or "erreur")
    u = r.get("usage") or {}
    usage = {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0),
             "cache_read": u.get("cache_read_input_tokens", 0) or 0, "cache_write": u.get("cache_creation_input_tokens", 0) or 0}
    if r.get("stop_reason") == "refusal":
        return None, usage, "refus du modèle"
    if r.get("stop_reason") == "max_tokens":
        return None, usage, "réponse coupée (max_tokens)"
    text = "".join(b.get("text", "") for b in r.get("content") or [] if b.get("type") == "text")
    return text, usage, ""


def _openai(cfg, system, blocks, max_tokens, transport):
    content = []
    for kind, val in blocks:
        content.append({"type": "input_text", "text": val} if kind == "text" else
                       {"type": "input_image", "image_url": "data:image/png;base64," + val, "detail": "high"})
    body = {"model": cfg["model"], "instructions": system, "max_output_tokens": max_tokens,
            "input": [{"role": "user", "content": content}],
            "text": {"format": {"type": "json_schema", "name": "verdict", "schema": SCHEMA, "strict": True}}}
    headers = {"Authorization": "Bearer " + cfg["key"]}
    r = transport(OPENAI_URL, headers, body) if transport else _post(OPENAI_URL, headers, body)
    if r.get("error"):
        raise BrainError((r["error"] or {}).get("message") or "erreur")
    u = r.get("usage") or {}
    cached = (u.get("input_tokens_details") or {}).get("cached_tokens", 0) or 0
    usage = {"input": max(0, u.get("input_tokens", 0) - cached), "output": u.get("output_tokens", 0), "cache_read": cached}
    text, refusal = "", ""
    for item in r.get("output") or []:
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if part.get("type") == "output_text":
                    text += part.get("text", "")
                elif part.get("type") == "refusal":
                    refusal = part.get("refusal") or "refus"
    if refusal:
        return None, usage, "refus du modèle : " + refusal[:200]
    if r.get("status") == "incomplete":
        return None, usage, "réponse incomplète (%s)" % ((r.get("incomplete_details") or {}).get("reason") or "?")
    return text, usage, ""


def _call(cfg, system, blocks, max_tokens=16000, transport=None):
    if not cfg.get("key"):
        raise BrainError("aucune clé : Réglages › Intelligence")
    fn = _openai if cfg.get("provider") == "openai" else _anthropic
    return fn(cfg, system, blocks, max_tokens, transport)


# ------------------------------------------------------------------ le juge
def juge(etape, image, origine, contexte="", extra=(), item=None, cfg=None, transport=None):
    """Verdict de l'intelligence sur une image produite.

    etape : apose | pose | vues | tournette | bouches ; image : l'image jugee ; origine : le dessin d'origine (toujours
    montre a cote, c'est la reference) ; extra : autres images [(legende, chemin)] (pose en A, vues voisines...) ;
    contexte : ce qui a ete demande (pose, vue, consigne). item : id de l'element, pour compter le cout.
    Renvoie None sans cle ; sinon {verdict, defauts, consigne, non_verifie, modele, cout, erreur?}. Une erreur de
    l'intelligence ne bloque jamais la chaine : verdict None et erreur renseignee."""
    cfg = dict(config(), **(cfg or {}))
    if not (cfg.get("key") or "").strip():
        return None
    if etape not in ETAPES:
        raise ValueError("étape inconnue : %s" % etape)
    cfg.setdefault("model", "claude-opus-5-5")
    blocks = [("text", "Étape : " + ETAPES[etape] + ("\nCe qui a été demandé : " + contexte if contexte else "")),
              ("text", "Image 1 : le dessin d'origine de l'auteur (la référence)."), ("img", _encode(origine))]
    n = 2
    for legend, path in extra or ():
        blocks += [("text", "Image %d : %s." % (n, legend)), ("img", _encode(path))]
        n += 1
    blocks += [("text", "Image %d : l'image à juger." % n), ("img", _encode(image)),
               ("text", "Rends ton verdict sur l'image %d, en la comparant au dessin d'origine (image 1)." % n)]
    out = {"verdict": None, "defauts": [], "consigne": "", "non_verifie": [], "modele": cfg["model"], "cout": 0.0,
           "etape": etape, "t": round(time.time())}
    try:
        text, usage, err = _call(cfg, system_prompt(), blocks, transport=transport)
        out["cout"] = round(cost.llm_price(cfg["model"], usage), 5)
        if err:
            out["erreur"] = err
        else:
            out.update(_parse(text))
    except BrainError as e:
        out["erreur"] = str(e)
    if out["cout"] and item:
        cost.add(item, out["cout"], "intelligence · %s" % etape, kind="brain")
    return out


def test(cfg=None, transport=None):
    """Petit appel pour verifier la cle et le modele (quelques jetons, sans image). Renvoie le texte du modele."""
    cfg = dict(config(), **(cfg or {}))
    cfg.setdefault("model", "claude-opus-5-5")
    if cfg.get("provider") != "openai":
        cfg["effort"] = "low"
    text, usage, err = _call(cfg, "Réponds par un objet JSON valide.",
                             [("text", "Test de connexion : verdict garder, listes vides, consigne vide.")],
                             max_tokens=2000, transport=transport)
    if err:
        raise BrainError(err)
    return {"ok": True, "verdict": _parse(text)["verdict"], "cout": round(cost.llm_price(cfg.get("model"), usage), 5)}
