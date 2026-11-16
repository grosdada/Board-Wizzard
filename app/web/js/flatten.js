// Aplatit une case (fond + calques + flou de profondeur) dans un canvas : image envoyee a « Integrate » et a l'orbite
// de case. Les bulles n'y sont pas : elles restent par-dessus.
import { loadImage } from "./api.js";
import { sprite, placement, layerBox, depthOf, blurOf, background } from "./model.js";

export async function flattenPanel(app, g, longSide = 1344) {
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
    draw(await loadImage(bg.url), pl.x, pl.y, pl.w, pl.h, blurOf(pan, 1, bb));
  }
  const layers = pan.layers || [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i], item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
    if (!sp) continue;
    const im = await loadImage(sp.url);
    const box = layerBox(local, l, { w: im.naturalWidth, h: im.naturalHeight });
    draw(im, box.x, box.y, box.w, box.h, blurOf(pan, depthOf(pan, i), bb), l.flip);
  }
  return new Promise((ok) => cv.toBlob(ok, "image/png"));
}
