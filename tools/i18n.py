"""Controle de la version anglaise : liste les textes francais de l'interface restes sans traduction.

    python tools/i18n.py            rapport (vide = rien d'oublie)
    python tools/i18n.py --wrap F   (developpement) entoure de tt(...) / tt`...` les textes francais nus du fichier F

Ce qui est controle :
  - app/web/js/*.js : tout texte (chaine ou gabarit) qui ressemble a du francais doit passer par tt("...") ou tt`...`
    (ou etre dans tools/i18n_ignore.txt), et chaque cle doit exister dans app/web/i18n/en.json ("ui") ;
  - app.css : les textes des proprietes content: ;
  - login.html : chaque texte francais doit avoir sa traduction dans son petit dictionnaire EN ;
  - le serveur : noms des poses et paliers (poses), categories du portrait-robot (parts), objets tout faits
    (procedural), messages d'erreur (raise ApiError / ValueError / RuntimeError) et libelles des taches (S.add) :
    chacun doit avoir sa traduction dans en.json ("server") ;
  - en.json : cles inutilisees, valeurs vides, nombre de {0} {1}... ou de %s different entre francais et anglais.
Ce que l'outil ne voit pas : un mot isole en minuscules sans accent (« fixe ») si personne ne l'a entoure, le texte
fabrique a la volee par le serveur ailleurs que dans ces endroits, les messages du systeme (exceptions Python, erreurs du
navigateur), le texte dessine dans les images, et les donnees enregistrees (noms, dossiers, bulles) qu'on ne traduit pas.
"""
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "app" / "web"
JS = WEB / "js"
EN = WEB / "i18n" / "en.json"
IGNORE = Path(__file__).with_name("i18n_ignore.txt")
SKIP_JS = {"i18n.js"}

# ------------------------------------------------------------------------------------------------ lecture du JavaScript
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^") | {""}
KEYWORDS_BEFORE = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"}


def lex(src):
    """Rend les litteraux du source : dicts {kind: 'str'|'tpl', start, end, parts (textes statiques), line}."""
    out, i, n = [], 0, len(src)
    last = ""                                     # dernier signe utile, pour distinguer division et expression reguliere

    def skip_str(i, q):
        j = i + 1
        while j < n and src[j] != q:
            j += 2 if src[j] == "\\" else 1
        return j + 1

    def skip_tpl(i):                              # rend (fin, parts statiques brutes)
        parts, buf, j = [], [], i + 1
        while j < n:
            c = src[j]
            if c == "\\":
                buf.append(src[j:j + 2]); j += 2; continue
            if c == "`":
                parts.append("".join(buf)); return j + 1, parts
            if c == "$" and j + 1 < n and src[j + 1] == "{":
                parts.append("".join(buf)); buf = []
                j = skip_expr(j + 2)
                continue
            buf.append(c); j += 1
        return n, parts + ["".join(buf)]

    def skip_expr(j):                             # contenu de ${ ... } : on y releve aussi les litteraux
        depth = 1
        while j < n:
            c = src[j]
            if c in "\"'":
                k = skip_str(j, c); out.append(mk("str", j, k)); j = k; continue
            if c == "`":
                k, parts = skip_tpl(j); out.append(mk("tpl", j, k, parts)); j = k; continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
        return n

    def mk(kind, s, e, parts=None):
        return {"kind": kind, "start": s, "end": e, "parts": parts if parts is not None else [src[s + 1:e - 1]],
                "line": src.count("\n", 0, s) + 1}

    while i < n:
        c = src[i]
        if c in " \t\r\n":
            i += 1; continue
        if src.startswith("//", i):
            i = src.find("\n", i); i = n if i < 0 else i; continue
        if src.startswith("/*", i):
            i = src.find("*/", i + 2); i = n if i < 0 else i + 2; continue
        if c in "\"'":
            j = skip_str(i, c); out.append(mk("str", i, j)); i = j; last = "lit"; continue
        if c == "`":
            j, parts = skip_tpl(i); out.append(mk("tpl", i, j, parts)); i = j; last = "lit"; continue
        if c == "/" and (last in REGEX_BEFORE or last in KEYWORDS_BEFORE):
            j, cls = i + 1, False
            while j < n:
                d = src[j]
                if d == "\\":
                    j += 2; continue
                if d == "[":
                    cls = True
                elif d == "]":
                    cls = False
                elif d == "/" and not cls:
                    break
                elif d == "\n":
                    break
                j += 1
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            i = j; last = "lit"; continue
        m = re.match(r"[A-Za-z_$][\w$]*", src[i:i + 60])
        if m:
            last = m.group(0); i += len(last); continue
        m = re.match(r"\d[\w.]*", src[i:i + 40])
        if m:
            last = "num"; i += len(m.group(0)); continue
        last = c if c not in ")]" else "lit"
        i += 1
    return sorted(out, key=lambda x: x["start"])


ESC = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "`": "`", "$": "$", "0": "\0"}


def unescape(s):
    def rep(m):
        e = m.group(1)
        if e[0] == "u":
            return chr(int(e[2:-1] if e[1] == "{" else e[1:], 16))
        if e[0] == "x":
            return chr(int(e[1:], 16))
        return ESC.get(e, e)
    return re.sub(r"\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", rep, s, flags=re.S)


def key_of(lit):
    """Cle du dictionnaire : la chaine elle-meme, ou le gabarit avec {0} {1}... a la place des ${...}."""
    parts = [unescape(p) for p in lit["parts"]]
    if lit["kind"] == "str":
        return parts[0]
    return "".join(p + ("{%d}" % i if i < len(parts) - 1 else "") for i, p in enumerate(parts))


# ------------------------------------------------------------------------------------------------ est-ce du francais ?
STOP = set("""le la les un une des du de et au aux pour sur dans par pas est ce cet cette ces son sa ses sans avec ou qui
que en il elle on ne plus tout toute tous toutes ici puis mais aussi deja encore rien aucun aucune chaque cliquer clic
glisser vers entre sous apres avant votre vos mon ma mes ton ta tes leur leurs nous vous je tu y a etre fait faire peut
dessin case cases banque calque fond trait image images pose poses orbite orbites personnage personnages element elements
dossier nom taille couleur bulle bulles page pages montage choisir voir retirer ajouter supprimer annuler fermer""".split())
TECH = re.compile(r"""^(?:
    [a-z0-9_$\-]*(?:[.#][\w\-]+)+                       # selecteur de h()
  | [\w\-]+/[\w\-.+*,]*(?:/[\w\-.+]+)*                    # type mime, chemin
  | [Mm]\s*[\d{\-].*                                   # trace SVG
  | url\(.*\)|Files
  | [\w\-.]*\[[\w\-]+(?:="[^"]*")?\][\w\-.\[\]="]*      # selecteur d'attribut
  | \.?/.*|https?:.*|data:.*|blob:.*                       # urls
  | [A-Z][a-z]+(?:[A-Z][a-z]+)+                         # ArrowLeft, PageUp
  | (?:Arrow\w+|Enter|Escape|Backspace|Delete|Tab|Shift|Control|Alt|Meta|Home|End|Content-Type|X-[\w-]+)
)$""", re.X)
TAG = re.compile(r"<[^<>]*>")


def frenchy(text):
    t = TAG.sub(" ", text)
    t = re.sub(r"\{\d+\}|var\(--[\w\-]+\)", " ", t)
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿœŒ]", t):
        return False
    if TECH.match(text.strip()):
        return False
    if re.match(r"\s*[.#@a-z][\w\-., :>#\[\]=\"()*]*\{", text) and ";" in text:   # feuille de style
        return False
    if re.search(r"[À-ÖØ-öø-ÿœŒ«»…]", t):
        return True
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", t)]
    if any(w in STOP or w in MORE for w in words):
        return not re.match(r"^[\w\-]+$", text.strip()) or text.strip()[0].isupper() or text.strip().lower() in MORE
    s = re.sub(r"^[^A-Za-z]+", "", t).strip()
    return bool(re.match(r"^[A-Z][a-z]", s)) and (" " in s or bool(re.match(r"^[A-Z][a-z]+(?:-[A-Za-z]+)*[ .:!?]*$", s)))


MORE = set("""fixe automatique erreur injoignable chargement connexion requise identifiant ouverte neutre arques
droits grand grands court long attention invite valider oui non bonjour
colonnes colonne bandes bande var cases images seulement machines""".split())


def wrapped(src, lit):
    j = lit["start"] - 1
    if lit["kind"] == "tpl":
        return j >= 1 and src[j - 1:j + 1] == "tt" and (j == 1 or not re.match(r"[\w$.]", src[j - 2]))
    while j >= 0 and src[j] in " \t\r\n":
        j -= 1
    return j >= 2 and src[j - 2:j + 1] == "tt(" and (j < 3 or not re.match(r"[\w$.]", src[j - 3]))


# ------------------------------------------------------------------------------------------------ le serveur
def server_texts():
    """Textes que le serveur envoie a l'interface : (cle, origine)."""
    sys.path.insert(0, str(ROOT))
    out = []
    from app import poses, procedural, parts                   # noqa: E402
    cat = poses.catalogue()
    for kind in ("character", "decor"):
        out += [(r["label"], "poses.%s" % kind) for r in cat[kind]]
    out += [(v, "poses.TIERS") for v in cat["tiers"].values()]
    out += [(v[0] if isinstance(v, (tuple, list)) else v, "poses.SHEET_VIEWS") for v in getattr(poses, "SHEET_LABELS", {}).values()]
    for o in procedural.catalogue():
        out.append((o["label"], "procedural"))
        for q in o["params"]:
            out.append((q["label"], "procedural"))
            out += [(c, "procedural (choix)") for c in q.get("choices", [])]
    from app import sprites                                    # noqa: E402
    out += [(a, "sprites.AXES") for a in sprites.AXES]
    for c in parts.catalogue():
        out.append((c["label"], "parts"))
        out += [(it["name"], "parts (element)") for it in c["items"] if not it.get("mine")]
    for f in sorted((ROOT / "app").glob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            msg = None
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call) and getattr(node.exc.func, "id", "") in ("ApiError", "ValueError", "RuntimeError", "FalError", "ElevenError") and node.exc.args:
                msg = node.exc.args[0]
            elif isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add" and getattr(node.func.value, "id", "") == "S" and len(node.args) >= 3:
                msg = node.args[2]
            elif isinstance(node, ast.Dict):                     # {"progress": "...", "error": "..."} : textes montres
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value in SHOWN and v is not None:
                        s = fmt_of(v)
                        if s and shown(s):
                            out.append((s, "%s:%d" % (f.name, node.lineno)))
                continue
            elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Subscript) and isinstance(t.slice, ast.Constant) and t.slice.value in SHOWN for t in node.targets):
                msg = node.value
            for m in ([msg.body, msg.orelse] if isinstance(msg, ast.IfExp) else [msg]):   # « a » if x else « b » : les deux
                s = fmt_of(m) if m is not None else None
                if s and shown(s):
                    out.append((s, "%s:%d" % (f.name, node.lineno)))
    return out


def shown(s):
    """Message du serveur montre a l'ecran : tout ce qui contient des lettres (pas seulement ce qui « fait » francais)."""
    return bool(re.search(r"[A-Za-zÀ-ÿ]{2}", re.sub(r"%[sd]|%\.\d+f", "", s)))


SHOWN = {"progress", "error", "title", "message", "info", "label"}


def fmt_of(node):
    """Gabarit d'un message : "texte %s" % x -> "texte %s" ; "a" + x -> "a%s" ; f"a{x}" -> "a%s"."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod):
        return fmt_of(node.left)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        a, b = fmt_of(node.left), fmt_of(node.right)
        return (a if a is not None else "%s") + (b if b is not None else "%s")
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value if isinstance(v, ast.Constant) else "%s" for v in node.values)
    return None


# ------------------------------------------------------------------------------------------------ rapport
def holes(s):
    return sorted(re.findall(r"\{\d+\}", s)), len(re.findall(r"%[sd]|%\.\d+f", s))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    en = json.loads(EN.read_text(encoding="utf-8")) if EN.exists() else {"ui": {}, "server": {}}
    ui, srv = en.get("ui", {}), en.get("server", {})
    ignore = set()
    if IGNORE.exists():
        ignore = {l.rstrip("\n") for l in IGNORE.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")}
    problems, used = [], set()
    for f in sorted(JS.glob("*.js")):
        if f.name in SKIP_JS:
            continue
        src = f.read_text(encoding="utf-8")
        for lit in lex(src):
            k = key_of(lit)
            if wrapped(src, lit):
                used.add(k)
                if k not in ui:
                    problems.append("%s:%d  sans traduction : %r" % (f.name, lit["line"], k))
            elif frenchy(k) and k not in ignore and "%s: %s" % (f.name, k) not in ignore:
                problems.append("%s:%d  texte non entoure : %r" % (f.name, lit["line"], k))
    for f in sorted((WEB / "lib").glob("*.js")):              # bibliotheque des bulles : ses textes se traduisent par i18n.js
        src = f.read_text(encoding="utf-8")
        for lit in lex(src):
            k = key_of(lit)
            if frenchy(k) and k not in ignore and "%s: %s" % (f.name, k) not in ignore:
                used.add(k)
                if k not in ui:
                    problems.append("lib/%s:%d  sans traduction : %r" % (f.name, lit["line"], k))
    css = (WEB / "app.css").read_text(encoding="utf-8")
    for m in re.finditer(r"content:\s*\"([^\"]*)\"", css):
        if frenchy(m.group(1)) and m.group(1) not in ignore:
            problems.append("app.css  texte francais dans content: %r" % m.group(1))
    login = (WEB / "login.html").read_text(encoding="utf-8")
    m = re.search(r"const EN = (\{.*?\});", login, re.S)
    lmap = json.loads(m.group(1)) if m else {}
    body = re.sub(r"<script>.*?</script>|<style>.*?</style>", "", login, flags=re.S)
    texts = re.findall(r">([^<>]+)<", body) + re.findall(r'(?:placeholder|title)="([^"]+)"', body)
    texts += [unescape(x) for x in re.findall(r'"((?:[^"\\]|\\.)*)"', re.sub(r"const EN = \{.*?\};", "", re.search(r"<script>(.*?)</script>", login, re.S).group(1), flags=re.S)) if frenchy(unescape(x))]
    for t_ in texts:
        t_ = t_.strip()
        if t_ and frenchy(t_) and t_ not in lmap and t_ not in ignore and t_ not in ("BOARD", "WIZZARD"):
            problems.append("login.html  sans traduction : %r" % t_)
    try:
        stexts = server_texts()
    except Exception as e:                                    # le controle du serveur ne doit pas cacher le reste
        problems.append("serveur : lecture impossible (%s)" % e)
        stexts = []
    seen = set()
    parts = en.get("parts", {})                               # noms des elements du portrait-robot : la liste change souvent
    for s, where in stexts:
        if s in seen:
            continue
        seen.add(s)
        if s not in srv and s not in ui and s not in parts and s not in ignore:
            problems.append("serveur %s  sans traduction : %r" % (where, s))
    for d, name in ((ui, "ui"), (srv, "server"), (en.get("parts", {}), "parts")):
        for k, v in d.items():
            if not isinstance(v, str) or not v.strip():
                problems.append("en.json %s  traduction vide : %r" % (name, k))
            elif holes(k) != holes(v) and not (name == "ui" and set(holes(v)[0]) <= set(holes(k)[0])):
                problems.append("en.json %s  trous differents : %r -> %r" % (name, k, v))
    for k in ui:
        if k not in used:
            problems.append("en.json ui  cle inutilisee : %r" % k)
    for k in srv:
        if k not in seen and k not in EXTRA_SERVER:
            problems.append("en.json server  cle inutilisee : %r" % k)
    for p in problems:
        print(p)
    print("%d probleme(s)." % len(problems), file=sys.stderr)
    return 1 if problems else 0


EXTRA_SERVER = set()                                          # cles serveur gardees a la main (ex. messages hors raise)


def wrap(path):
    p = Path(path)
    src = p.read_text(encoding="utf-8")
    ignore = set()
    if IGNORE.exists():
        ignore = {l.rstrip("\n") for l in IGNORE.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")}
    lits = [l for l in lex(src) if not wrapped(src, l) and frenchy(key_of(l)) and key_of(l) not in ignore]
    for lit in sorted(lits, key=lambda x: -x["start"]):
        s, e = lit["start"], lit["end"]
        src = src[:s] + "tt" + src[s:] if lit["kind"] == "tpl" else src[:s] + "tt(" + src[s:e] + ")" + src[e:]
    p.write_text(src, encoding="utf-8")
    print("%s : %d texte(s) entoure(s)" % (p.name, len(lits)))


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--wrap":
        for a in sys.argv[2:]:
            wrap(a)
    else:
        sys.exit(main())
