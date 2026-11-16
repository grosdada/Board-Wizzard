"""Fait passer devant les orbites de base de quelques elements : python tools/bump.py "nom" "nom"..."""
import json
import sys
import urllib.request

URL = "http://127.0.0.1:8795/api/"


def call(method, path, body=None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


items = {it["name"]: it for it in call("GET", "bank")}
jobs = call("GET", "jobs")
for name in sys.argv[1:]:
    it = items.get(name)
    if not it:
        print("inconnu :", name)
        continue
    for j in jobs:
        if j["status"] == "queued" and j["kind"] in ("item_orbit", "item_cut") and j["params"].get("item") == it["id"] \
                and j["params"].get("variant") == "base":
            call("POST", "jobs/%s/cancel" % j["id"], {})
            call("POST", "bank/%s/%s" % (it["id"], "orbit" if j["kind"] == "item_orbit" else "cut"), {"variant": "base"})
            print("devant :", j["title"])
