"""Attend un evenement de la file puis rend la main : python tools/watch.py [orbites en plus] [minutes max]
Sort quand : une tache est en erreur (nouvelle), N orbites de plus sont arrivees, la file est vide, ou le delai est passe."""
import json
import sys
import time
import urllib.request

URL = "http://127.0.0.1:8795/api/"
more = int(sys.argv[1]) if len(sys.argv) > 1 else 40
limit = float(sys.argv[2]) * 60 if len(sys.argv) > 2 else 3600


def get(p):
    with urllib.request.urlopen(URL + p, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def orbits():
    return sum(1 for it in get("bank") for v in it["variants"].values() if v.get("orbit"))


start, t0, err0 = orbits(), time.time(), None
while True:
    try:
        jobs = get("jobs")
        errs = {j["id"] for j in jobs if j["status"] == "error"}
        if err0 is None:
            err0 = errs
        active = [j for j in jobs if j["status"] in ("queued", "running")]
        n = orbits()
        why = ("erreur" if errs - err0 else "file vide" if not active else "%d orbites de plus" % (n - start)
               if n - start >= more else "delai" if time.time() - t0 > limit else "")
        if why:
            print(time.strftime("%H:%M"), why, "| orbites", n, "| en file", len(active))
            for j in jobs:
                if j["id"] in errs - err0:
                    print("  ERREUR", j["title"], "|", j["error"][:300])
            break
    except OSError as exc:
        print("serveur muet :", exc)
        break
    time.sleep(20)
