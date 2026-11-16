"""Etat de la file et de la banque : python tools/status.py [--wait-pose]"""
import json
import sys
import time
import urllib.request

URL = "http://127.0.0.1:8795/api/"


def get(p):
    with urllib.request.urlopen(URL + p, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def show():
    jobs = get("jobs")
    c = {}
    for j in jobs:
        c[j["status"]] = c.get(j["status"], 0) + 1
    print(time.strftime("%H:%M:%S"), c)
    for j in jobs:
        if j["status"] == "running":
            print("  >", j["worker"], j["title"], "|", j["progress"], int(time.time() - j["started"]), "s")
        if j["status"] == "error":
            print("  ERREUR", j["title"], "|", j["error"][:260])
    items = get("bank")
    orb = sum(1 for it in items for v in it["variants"].values() if v.get("orbit"))
    print("  banque : %d elements, %d variantes, %d orbites" % (len(items), sum(len(it["variants"]) for it in items), orb))
    return jobs


if "--wait" in sys.argv:                 # attend qu'une tache dont le titre contient ce texte soit finie
    key = sys.argv[sys.argv.index("--wait") + 1]
    while True:
        js = [j for j in get("jobs") if key in j["title"]]
        if js and all(j["status"] in ("done", "error", "cancelled") for j in js):
            break
        time.sleep(5)
show()
