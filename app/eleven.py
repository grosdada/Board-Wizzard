"""Voix de synthese par ElevenLabs (texte -> mp3). La cle se regle dans l'application (Reglages > ElevenLabs).

API : GET /v1/voices (les voix du compte) et POST /v1/text-to-speech/{voice_id} (rend le son), en-tete xi-api-key.
Pas encore essaye avec une vraie cle : a verifier au premier usage.
"""
import json
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io/v1"


class ElevenError(Exception):
    pass


def _call(key, path, body=None, timeout=120):
    if not key:
        raise ElevenError("pas de clé ElevenLabs : la donner dans les Réglages")
    req = urllib.request.Request(API + path, data=json.dumps(body).encode("utf-8") if body is not None else None,
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "User-Agent": "board-wizzard"},
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            d = json.loads(raw).get("detail")
            msg = d.get("message") if isinstance(d, dict) else str(d)
        except (ValueError, AttributeError):
            msg = raw[:200]
        raise ElevenError("ElevenLabs a refusé (%s) : %s" % (e.code, msg or raw[:200]))
    except urllib.error.URLError as e:
        raise ElevenError("ElevenLabs injoignable : %s" % e.reason)


def voices(key):
    """Voix du compte : [{id, name, info}]."""
    data = json.loads(_call(key, "/voices", timeout=30).decode("utf-8"))
    out = []
    for v in data.get("voices") or []:
        lab = v.get("labels") or {}
        info = " · ".join(x for x in (lab.get("gender"), lab.get("age"), lab.get("accent"), lab.get("language")) if x)
        out.append({"id": v.get("voice_id"), "name": v.get("name") or "voix", "info": info})
    return sorted(out, key=lambda v: v["name"].lower())


def speak(key, voice, text, model="eleven_multilingual_v2"):
    """Rend le mp3 de `text` dit par la voix `voice`."""
    text = (text or "").strip()
    if not text:
        raise ElevenError("texte vide")
    if not voice:
        raise ElevenError("aucune voix choisie")
    return _call(key, "/text-to-speech/%s?output_format=mp3_44100_128" % voice,
                 {"text": text[:5000], "model_id": model or "eleven_multilingual_v2"})
