"""Remplit la banque a partir d'un manifeste JSON, par l'API du serveur local (qui met les orbites en file).

    python tools/seed_bank.py manifeste.json [--poses-only] [--url http://127.0.0.1:8795]
Manifeste : [{"kind": "character|decor|asset", "name": "...", "file": "chemin de l'image", "style": "photo|dessin",
              "facing": "face", "tags": ["..."], "poses": ["parle", ...] ou "essentiel" | "complet" | "tout"}]
Un element deja present (meme nom) n'est pas reimporte ; ses poses manquantes sont demandees.
"""

import json
import sys
import urllib.parse
import urllib.request

URL = "http://127.0.0.1:8795"
TIERS = {"essentiel": 1, "complet": 2, "tout": 3}


def call(method, path, body=None, raw=None):
    data, headers = None, {}
    if raw is not None:
        data, headers["Content-Type"] = raw, "application/octet-stream"
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(URL + "/api/" + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    global URL
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--url" in sys.argv:
        URL = sys.argv[sys.argv.index("--url") + 1].rstrip("/")
        args = [a for a in args if a.rstrip("/") != URL]
    poses_only = "--poses-only" in sys.argv
    manifest = json.load(open(args[0], encoding="utf-8"))
    catalogue = call("GET", "info")["poses"]
    have = {it["name"]: it for it in call("GET", "bank")}
    made = []
    for m in manifest:                                           # 1. tous les elements d'abord (base + orbite)
        if m["name"] in have:
            made.append((m, have[m["name"]]["id"]))
            continue
        if poses_only:
            continue
        q = urllib.parse.urlencode({"kind": m["kind"], "name": m["name"], "style": m.get("style", "photo"),
                                    "facing": m.get("facing", "face"), "file": "seed.png", "orbit": "1",
                                    "folder": m.get("folder", "")})
        try:
            it = call("POST", "bank?" + q, raw=open(m["file"], "rb").read())
        except Exception as exc:                                  # noqa: BLE001
            print("ECHEC", m["name"], exc)
            continue
        if m.get("tags"):
            call("PUT", "bank/" + it["id"], {"tags": m["tags"]})
        made.append((m, it["id"]))
        print("+", m["kind"], m["name"])
    for m, iid in made:                                          # 2. puis les poses
        want = m.get("poses")
        if not want:
            continue
        if isinstance(want, str):
            want = [p["key"] for p in catalogue.get(m["kind"], []) if p["tier"] <= TIERS[want]]
        r = call("POST", "bank/%s/prepare" % iid, {"orbit": True, "poses": want})
        print("  poses", m["name"], len(r["jobs"]))


if __name__ == "__main__":
    main()
