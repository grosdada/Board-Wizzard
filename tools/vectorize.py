"""Prototype : convertit l'orbite d'un dessin (images WebP detourees) en traces SVG.

    python tools/vectorize.py <element> [variante]

Chaque image devient deux traces : la silhouette (remplie en blanc) et l'encre (remplie en noir). Le trait reste net a
n'importe quel zoom et son epaisseur se regle a l'affichage (contour ajoute a l'encre : noir = plus epais, blanc = plus
fin). Sortie : data/bank/<element>/v/<variante>/vec/NNN.svg et essai.html. Demande opencv (outil d'essai seulement).
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import settings  # noqa: E402

UP = 3            # sur-echantillonnage avant de tracer : bords plus lisses
EPS = 1.6         # tolerance de simplification, en pixels sur-echantillonnes


def paths(mask, scale):
    """Contours d'un masque (avec ses trous) -> attribut d d'un trace SVG, en coordonnees de l'image d'origine."""
    cs, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < 6 * scale * scale:
            continue
        c = cv2.approxPolyDP(c, EPS, True)[:, 0, :].astype(np.float32) / scale
        if len(c) < 3:
            continue
        # courbe lisse : chaque sommet sert de point de controle, on passe par les milieux des cotes
        mid = (c + np.roll(c, -1, axis=0)) / 2
        d = "M%.1f %.1f" % tuple(mid[-1])
        for p, m in zip(c, mid):
            d += "Q%.1f %.1f %.1f %.1f" % (p[0], p[1], m[0], m[1])
        out.append(d + "Z")
    return "".join(out)


def frame(src):
    im = np.asarray(Image.open(src).convert("RGBA"))
    h, w = im.shape[:2]
    big = cv2.resize(im, (w * UP, h * UP), interpolation=cv2.INTER_CUBIC)
    alpha = cv2.GaussianBlur(big[..., 3], (0, 0), 1.2)
    grey = cv2.GaussianBlur(cv2.cvtColor(big[..., :3], cv2.COLOR_RGB2GRAY), (0, 0), 1.0)
    body = (alpha > 128).astype(np.uint8)
    ink = ((grey < 140) & (alpha > 128)).astype(np.uint8)
    return w, h, paths(body, UP), paths(ink, UP)


def main():
    item = sys.argv[1]
    vid = sys.argv[2] if len(sys.argv) > 2 else "base"
    d = settings.DATA / "bank" / item
    o = json.loads((d / "item.json").read_text(encoding="utf-8"))["variants"][vid]["orbit"]
    out = d / "v" / vid / "vec"
    out.mkdir(parents=True, exist_ok=True)
    total, frames = 0, []
    for i in range(o["n"]):
        w, h, body, ink = frame(d / o["dir"] / ("%03d.webp" % i))
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d"><path class="body" fill="#fff" d="%s"/>'
               '<path class="ink" fill="#111" fill-rule="evenodd" d="%s"/></svg>' % (w, h, body, ink))
        (out / ("%03d.svg" % i)).write_text(svg, encoding="utf-8")
        total += len(svg)
        frames.append({"body": body, "ink": ink})
    (out / "frames.json").write_text(json.dumps({"w": w, "h": h, "frames": frames}), encoding="utf-8")
    raster = sum((d / o["dir"] / ("%03d.webp" % i)).stat().st_size for i in range(o["n"]))
    print("%s/%s : %d vues, %.0f Ko en traces (%.0f Ko en images)" % (item, vid, o["n"], total / 1024, raster / 1024))
    (out / "essai.html").write_text(ESSAI.replace("__DIR__", "/bank/%s/%s" % (item, o["dir"])), encoding="utf-8")


ESSAI = """<!doctype html><meta charset="utf-8"><title>Essai de traces</title>
<style>body{margin:0;background:#8fa3b8;font:14px system-ui;color:#111}
.bar{padding:8px 14px;background:#fff;display:flex;gap:18px;align-items:center}
.row{display:flex;gap:14px;padding:14px;align-items:flex-start}
.cell{background:#c9d4df;text-align:center;padding:6px}.cell b{display:block;margin-bottom:4px}
.view{width:330px;height:420px;overflow:hidden;position:relative;background:#c9d4df}
.view>*{position:absolute;left:0;top:0;transform-origin:0 0}</style>
<div class="bar"><label>Vue <input id="f" type="range" min="0" max="71" value="8"></label>
<label>Zoom <input id="z" type="range" min="1" max="8" step="0.1" value="2.4"></label>
<label>Epaisseur du trait <input id="t" type="range" min="-2" max="5" step="0.1" value="0"></label><span id="o"></span></div>
<div class="row" id="row"></div>
<script type="module">
const data = await (await fetch("frames.json")).json(), row = document.getElementById("row");
const cells = [["Image actuelle (720 px)", null], ["Trace, trait fin", -1.2], ["Trace, trait d'origine", 0], ["Trace, trait epais", 2.5], ["Trace, curseur", "t"]];
const views = cells.map(([name, t]) => { const c = document.createElement("div"); c.className = "cell"; c.innerHTML = "<b>" + name + "</b><div class='view'></div>"; row.append(c); return [c.querySelector(".view"), t]; });
function draw() {
  const f = +document.getElementById("f").value, z = +document.getElementById("z").value, tt = +document.getElementById("t").value, fr = data.frames[f];
  document.getElementById("o").textContent = "vue " + f + " · zoom x" + z.toFixed(1) + " · epaisseur " + tt.toFixed(1);
  const W = 330 / data.w * z, ox = (330 - data.w * W) / 2, oy = -data.h * W * 0.02 * (z - 1);
  for (const [v, t] of views) {
    const th = t === "t" ? tt : t;
    if (t === null) v.innerHTML = `<img src="__DIR__/${String(f).padStart(3, "0")}.webp" style="width:${data.w * W}px;transform:translate(${ox}px,${oy}px)">`;
    else v.innerHTML = `<svg viewBox="0 0 ${data.w} ${data.h}" style="width:${data.w * W}px;transform:translate(${ox}px,${oy}px)">
      <clipPath id="c${t}"><path d="${fr.body}"/></clipPath><path fill="#fff" d="${fr.body}"/>
      <g clip-path="url(#c${t})"><path fill="#111" fill-rule="evenodd" d="${fr.ink}" stroke="${th >= 0 ? "#111" : "#fff"}" stroke-width="${Math.abs(th)}" stroke-linejoin="round"/></g>
      <path fill="none" stroke="#111" stroke-width="${Math.max(0, 1.2 + th * 0.5)}" d="${fr.body}"/></svg>`;
  }
}
for (const id of ["f", "z", "t"]) document.getElementById(id).addEventListener("input", draw);
draw();
</script>
"""

if __name__ == "__main__":
    main()
