"""Reglages locaux (local_settings.json a la racine, jamais dans le depot) fusionnes sur DEFAULTS.

Dossier des donnees (banque + storyboards) : variable d'environnement BW_DATA, sinon « data » a la racine.
Sur un VPS : server.host = "0.0.0.0", aucune machine ComfyUI, chaque utilisateur donne sa cle fal dans son navigateur.
"""

import copy
import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "local_settings.json"
DATA = Path(os.environ.get("BW_DATA") or ROOT / "data")
_lock = threading.Lock()

DEFAULTS = {
    # password : mot de passe d'acces a l'application (vide = pas de mot de passe).
    # lock_settings : sur une instance partagee, les reglages du poste (machines, mots de passe, bibliotheque, cles) ne
    # se changent plus depuis l'interface, seulement dans local_settings.json. Chacun garde sa cle fal dans son navigateur.
    "server": {"host": "127.0.0.1", "port": 8795, "password": "", "lock_settings": False},
    # machines ComfyUI : [{"name": "...", "url": "http://ip:8188", "enabled": true}]
    "workers": [],
    # reglages de Workflows Q-builder : ses machines (comfy_nodes) sont reprises telles quelles
    "qbuilder_settings": "",
    "fal": {
        "key": "",                       # cle du poste ; un collegue peut donner la sienne dans son navigateur
        "concurrency": 10,                             # calculs fal en meme temps
        "orbit": "minimax/h3/image-to-video/lora",
        "orbit_resolution": "768P",                    # 480P (le moins cher), 768P, 2K, 4K
        "edit": "fal-ai/qwen-image-edit-plus",
        "t2i": "fal-ai/z-image/turbo",
        "matte": "fal-ai/birefnet/v2",
        "matte_video": "fal-ai/birefnet/v2/video",
    },
    "elevenlabs": {"key": "", "model": "eleven_multilingual_v2"},      # voix de synthese du montage (lip sync)
    # intelligence (app/brain.py) : regarde chaque image produite a cote du dessin d'origine et rend un verdict.
    # provider : anthropic | openai ; key : cle d'API du poste (jamais envoyee au navigateur) ; effort : Anthropic seulement.
    # audit : juger les images apres chaque tirage ; auto_retry : sur « refaire », retirer avec la consigne corrigee
    # (au plus max_retries fois par image), sinon l'avis est seulement affiche.
    "brain": {"provider": "anthropic", "key": "", "model": "claude-opus-5-5", "effort": "medium",
              "audit": True, "auto_retry": True, "max_retries": 2},
    # budget par personnage (app/cost.py) : plafond en dollars et prix estimes (releves a la main, a revoir).
    "budget": {
        "cap": 10,
        "fal_prices": {                                  # dollars par image ; la cle la plus longue contenue dans le modele
            "gpt-image-2.5": 0.02, "gpt-image-2": 0.04, "nano-banana-2": 0.08, "nano-banana-pro": 0.15,
            "nano-banana": 0.04, "qwen-image-edit": 0.03, "flux": 0.03, "seedream": 0.03, "z-image": 0.005,
            "birefnet": 0.002,
        },
        "fal_unknown": 0.15,                             # modele absent de la table : au prix le plus prudent
        "h3_per_second": {"480P": 0.062, "768P": 0.075, "2K": 0.15, "4K": 0.3},
        "matte_video": 0.05,
        "llm_prices": {                                  # dollars par million de jetons : entree, sortie, cache lu, cache ecrit
            "claude-opus-5-5": [4, 20, 0.2, 5], "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
            "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125], "claude-fable-5-2": [8, 40, 0.2, 10],
            "gpt-6.2-astra": [8, 40, 0.8, 8], "gpt-6.2-sol": [2, 10, 0.2, 2], "gpt-6.1-terra": [1, 5, 0.1, 1],
            "gpt-6-luna": [0.1, 0.5, 0.01, 0.1],
        },
    },
    # bibliotheque en ligne de personnages (dossier de paquets .bwpack servi en HTTPS, voir app/packs.py)
    "library": {"url": "", "user": "", "password": ""},
    # comptes invites : [{id, name, vip, salt, hash, created}] ; geres par l'admin (Reglages > Mon compte), jamais envoyes
    # au navigateur. vip = acces a la bibliotheque en ligne.
    "accounts": [],
    "render": {
        "target": "auto",                # local | fal | auto (machines d'abord, fal si aucune)
        "orbit_length": 73,              # images a 24 i/s, forme 17k+5 : 73 = 3 s, 124 = 5,2 s
        "integrate_engine": "",          # moteur d'Integrate : "" (comme le reste), "local", ou "fal:<modele d'edition>"
        "pose_engine": "",               # moteur des poses et de la planche de vues : "" (comme le reste) ou "fal:<modele d'edition>"
        "sheet": True,                   # planche de vues (dos, profil) avant l'orbite d'un personnage
        "megapixels": 0.6,
        "steps": 28,
        "seed": 904231,
        "frame_height": 720,             # hauteur des images detourees gardees dans la banque
    },
}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load():
    with _lock:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
    return _merge(DEFAULTS, raw)


def save(patch, trusted=False):
    """Enregistre des reglages. Venant de l'interface (trusted=False), ni le bloc server ni les comptes ne passent :
    le mot de passe et les invites ont leurs propres routes."""
    patch = dict(patch or {})
    patch.pop("accounts", None)
    if not trusted:
        patch.pop("server", None)
    with _lock:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
        if (patch.get("fal") or {}).get("key", "").startswith("••"):     # cle masquee renvoyee telle quelle
            patch["fal"].pop("key")
        if (patch.get("elevenlabs") or {}).get("key", "").startswith("••"):
            patch["elevenlabs"].pop("key")
        if (patch.get("brain") or {}).get("key", "").startswith("••"):
            patch["brain"].pop("key")
        if (patch.get("server") or {}).get("password", "").startswith("••"):
            patch["server"].pop("password")
        if (patch.get("library") or {}).get("password", "").startswith("••"):
            patch["library"].pop("password")
        raw = _merge(raw, patch)
        if "workers" in patch:
            raw["workers"] = patch["workers"]
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, FILE)
    return load()


def set_accounts(accounts):
    """Remplace d'un bloc la liste des comptes invites."""
    with _lock:
        try:
            raw = json.loads(FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
        raw["accounts"] = accounts
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(raw, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, FILE)


def workers():
    """Machines ComfyUI actives : celles des reglages + celles de Q-builder (sans doublon d'adresse)."""
    s = load()
    out, seen = [], set()

    def add(name, url, enabled=True):
        url = (url or "").strip().rstrip("/")
        if url and url not in seen and enabled:
            seen.add(url)
            out.append({"name": name or url, "url": url})

    for w in s["workers"]:
        add(w.get("name"), w.get("url"), w.get("enabled", True))
    qb = s.get("qbuilder_settings")
    if qb:
        try:
            for n in json.loads(Path(qb).read_text(encoding="utf-8")).get("comfy_nodes", []):
                add(n.get("name"), n.get("url"), n.get("auto", True))
        except (OSError, ValueError):
            pass
    return out


def public(library=True):
    """Reglages envoyes au navigateur : cles et mots de passe masques, comptes retires ; library=False retire aussi la
    bibliotheque en ligne (invite sans acces)."""
    s = load()
    s.pop("accounts", None)
    if not library:                                  # invite non VIP : ni bibliotheque, ni cles du serveur (fal, ElevenLabs)
        s["library"] = {"url": "", "user": "", "password": ""}
        s["fal"]["key"] = ""
        s.setdefault("elevenlabs", {})["key"] = ""
        s["workers"], s["qbuilder_settings"] = [], ""      # ni les machines du poste, ni leurs adresses
    key = s["fal"].get("key") or ""
    s["fal"]["key"] = ("••••" + key[-4:]) if key else ""
    b = s.setdefault("brain", {})                    # cle de l'intelligence : jamais envoyee, seulement « il y en a une »
    b["key"] = "••••" if (b.get("key") and library) else ""
    ekey = (s.get("elevenlabs") or {}).get("key") or ""
    s.setdefault("elevenlabs", {})["key"] = ("••••" + ekey[-4:]) if ekey else ""
    if s["server"].get("password"):
        s["server"]["password"] = "••••"
    if (s.get("library") or {}).get("password"):
        s["library"]["password"] = "••••"
    s["data"] = str(DATA)
    return s
