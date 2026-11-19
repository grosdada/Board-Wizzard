"""Comptes invites de l'application.

L'admin est celui qui connait server.password. Il peut creer des invites (Reglages > Mon compte) : un invite se connecte
avec son nom et son mot de passe, travaille sur la meme banque et les memes storyboards, mais ne touche ni aux reglages
ni aux comptes. Un invite VIP a en plus acces a la bibliotheque en ligne. Les mots de passe des invites ne sont gardes
que haches (PBKDF2, sel par compte).
"""
import hashlib
import hmac
import re
import secrets
import time

from . import settings

ROUNDS = 200_000


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), ROUNDS).hex()


def _all():
    return [a for a in (settings.load().get("accounts") or []) if isinstance(a, dict) and a.get("id")]


def token(acc):
    """Jeton du cookie d'un invite : il meurt avec le compte, et change avec son mot de passe."""
    return hashlib.sha256(("bw-guest:%s:%s" % (acc["id"], acc["hash"])).encode()).hexdigest()


def by_token(tok):
    for a in _all():
        if hmac.compare_digest(tok, token(a)):
            return a
    return None


def find(name):
    key = (name or "").strip().casefold()
    for a in _all():
        if a["name"].casefold() == key:
            return a
    return None


def verify(acc, password):
    return hmac.compare_digest(_hash(str(password), acc["salt"]), acc["hash"])


def public():
    return [{"id": a["id"], "name": a["name"], "vip": bool(a.get("vip")), "created": a.get("created", 0)} for a in _all()]


def _check_password(password):
    if len(password) < 8:
        raise ValueError("le mot de passe doit faire au moins 8 caractères")


def create(name, vip=False, password=""):
    """Cree un invite. Sans mot de passe donne, en tire un au hasard. Rend (compte public, mot de passe en clair) :
    c'est la seule fois ou il est lisible."""
    name = re.sub(r"\s+", " ", (name or "").strip())[:40]
    if not name:
        raise ValueError("il faut un nom pour l'invité")
    if name.casefold() == "admin" or find(name):
        raise ValueError("ce nom est déjà pris")
    password = str(password or "") or secrets.token_urlsafe(9)
    _check_password(password)
    salt = secrets.token_hex(16)
    acc = {"id": secrets.token_hex(6), "name": name, "vip": bool(vip), "salt": salt, "hash": _hash(password, salt),
           "created": int(time.time())}
    settings.set_accounts(_all() + [acc])
    return {"id": acc["id"], "name": name, "vip": acc["vip"], "created": acc["created"]}, password


def update(aid, vip=None, password=None, reset=False):
    """Change le type d'un invite, ou son mot de passe (reset=True : en tire un nouveau). Rend le mot de passe en clair
    s'il vient d'etre tire, sinon None."""
    accs, out = _all(), None
    for a in accs:
        if a["id"] == aid:
            if vip is not None:
                a["vip"] = bool(vip)
            if reset:
                password = out = secrets.token_urlsafe(9)
            if password is not None:
                _check_password(str(password))
                a["salt"] = secrets.token_hex(16)
                a["hash"] = _hash(str(password), a["salt"])
            settings.set_accounts(accs)
            return out
    raise KeyError("invité")


def remove(aid):
    accs = _all()
    keep = [a for a in accs if a["id"] != aid]
    if len(keep) == len(accs):
        raise KeyError("invité")
    settings.set_accounts(keep)
