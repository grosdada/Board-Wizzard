// Aplatit une case (fond + calques + flou de profondeur) dans un canvas : image envoyee a « Integrate » et a l'orbite
// de case. Les bulles n'y sont pas : elles restent par-dessus. sharp : sans le flou de profondeur (le modele travaille
// mieux sur une image nette ; le flou reste un reglage d'affichage).
import { loadImage } from "./api.js";
import { sprite, placement, layerBox, depthOf, blurOf, background, vecReady, inkStroke, shadeOf } from "./model.js";

export async function flattenPanel(app, g, longSide = 1344, sharp = true) {
  const pg = app.page(), pan = pg.panels[g.id] || {}, bb = g.bbox;
  const k = longSide / Math.max(bb.w, bb.h);
  const cv = document.createElement("canvas");
  cv.width = Math.round(bb.w * k / 16) * 16;
  cv.height = Math.round(bb.h * k / 16) * 16;
  const ctx = cv.getContext("2d");
  const kx = cv.width / bb.w, ky = cv.height / bb.h;
  const local = { x0: 0, y0: 0, w: bb.w, h: bb.h };
  ctx.fillStyle = pg.page.fill || "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingQuality = "high";
  const draw = (im, x, y, w, h, blur, flip) => {
    ctx.save();
    ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
    if (flip) { ctx.translate((x + w / 2) * 2 * kx, 0); ctx.scale(-1, 1); }
    ctx.drawImage(im, x * kx, y * ky, w * kx, h * ky);
    ctx.restore();
  };
  const bg = background(pan, app.bank, app.project.id);
  if (bg) {
    const pl = placement(local, bg.w || 16, bg.h || 9, pan.view);
    const bvf = await vecReady(bg);
    if (bvf) {                                             // decor en traces
      const st = inkStroke(pan.bglw), blur = sharp ? 0 : blurOf(pan, 1, bb), ink = new Path2D(bvf.ink);
      ctx.save();
      ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
      ctx.scale(kx, ky); ctx.translate(pl.x, pl.y); ctx.scale(pl.w / bvf.w, pl.h / bvf.h);
      ctx.fillStyle = "#ffffff"; ctx.fill(new Path2D(bvf.body));
      ctx.fillStyle = "#111111"; ctx.fill(ink, "evenodd");
      if (st.width > 0) { ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.lineJoin = "round"; ctx.stroke(ink); }
      ctx.restore();
    } else draw(await loadImage(bg.url), pl.x, pl.y, pl.w, pl.h, sharp ? 0 : blurOf(pan, 1, bb));
  }
  const layers = pan.layers || [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i], item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
    if (!sp) continue;
    const vf = await vecReady(sp);
    if (vf) {                                              // dessin en traces : dessine en vectoriel, a la taille du canvas
      const box = layerBox(local, l, { w: vf.w, h: vf.h }), sc = Math.min(box.w / vf.w, box.h / vf.h);
      const tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc, st = inkStroke(l.lw), blur = sharp ? 0 : blurOf(pan, depthOf(pan, i), bb);
      const body = new Path2D(vf.body), ink = new Path2D(vf.ink);
      ctx.save();
      ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
      ctx.scale(kx, ky);
      if (l.flip) { ctx.translate(2 * (box.x + box.w / 2), 0); ctx.scale(-1, 1); }
      ctx.translate(tx, ty); ctx.scale(sc, sc);
      ctx.fillStyle = "#ffffff"; ctx.fill(body);
      ctx.save(); ctx.clip(body);
      const shd = shadeOf(l.sh, vf.h);
      if (shd) {
        ctx.fillStyle = shd.fill; ctx.fill(body);
        ctx.save(); ctx.translate(l.flip ? -shd.dx : shd.dx, shd.dy); ctx.fillStyle = "#ffffff"; ctx.fill(body); ctx.restore();
      }
      ctx.fillStyle = "#111111"; ctx.fill(ink, "evenodd");
      if (st.width > 0) { ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.lineJoin = "round"; ctx.stroke(ink); }
      ctx.restore();
      if (st.outline > 0) { ctx.strokeStyle = "#111111"; ctx.lineWidth = st.outline; ctx.stroke(body); }
      ctx.restore();
      continue;
    }
    const im = await loadImage(sp.url);
    const box = layerBox(local, l, { w: im.naturalWidth, h: im.naturalHeight });
    draw(im, box.x, box.y, box.w, box.h, sharp ? 0 : blurOf(pan, depthOf(pan, i), bb), l.flip);
  }
  return new Promise((ok) => cv.toBlob(ok, "image/png"));
}
