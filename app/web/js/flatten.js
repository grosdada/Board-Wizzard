// Aplatit une case (fond + calques + flou de profondeur) dans un canvas : image envoyee a « Integrate » et a l'orbite
// de case. Les bulles n'y sont pas : elles restent par-dessus. sharp : sans le flou de profondeur (le modele travaille
// mieux sur une image nette ; le flou reste un reglage d'affichage).
import { loadImage } from "./api.js";
import { groundSvg, groundFor, groundInFrame, frameVis } from "./ground.js";
import { drawImage } from "./draw.js";
import { faceOps, headReady, opsCanvas } from "./face.js";
import { bgStroke, frameToAngle, variantOf, lineWidth, frameT, layerCM, bgCM, blinkAll, colorMatrix, cmFilter, cmPixels, mouthFrame } from "./model.js";
// clignoteur du montage : le sol prend aussi sa couleur de la 1re image
const blinkGround = (pan, svg) => { const bk = blinkAll(pan, 0), gm = bk && colorMatrix(null, bk); return gm ? cmFilter("grb", gm) + `<g filter="url(#grb)">${svg}</g>` : svg; };
import { exprCard } from "./lipsync.js";
import { sprite, layerSp, placement, layerBox, depthOf, blurOf, groundShadow, bodyFill, inkFill, background, vecReady, inkStroke, shadeOf, shadeShapes } from "./model.js";

export async function flattenPanel(app, g, longSide = 1344, sharp = true, over = null, type = "image/png") {
  const pg = app.page(), pan = over || pg.panels[g.id] || {}, bb = g.bbox;     // over : une case modifiee (image du montage)
  const k = longSide / Math.max(bb.w, bb.h);
  const cv = document.createElement("canvas");
  cv.width = Math.round(bb.w * k / 16) * 16;
  cv.height = Math.round(bb.h * k / 16) * 16;
  let ctx = cv.getContext("2d");
  const kx = cv.width / bb.w, ky = cv.height / bb.h;
  const local = { x0: 0, y0: 0, w: bb.w, h: bb.h };
  ctx.fillStyle = pg.page.fill || "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingQuality = "high";
  const FT = frameT(pan, local);                           // cadrage de la case (1re image du montage) : tout le contenu
  if (FT) { ctx.translate(FT.C[0] * kx, FT.C[1] * ky); ctx.scale(FT.z, FT.z); ctx.rotate(-FT.rot * Math.PI / 180); ctx.translate(-FT.c[0] * kx, -FT.c[1] * ky); }
  // plan a la profondeur d de la camera de la case (avancee, parallaxe), comme le montage ; faux : la camera l'a depasse
  const plane = (d) => {
    if (!FT) return true;
    const q = FT.dep(d);
    if (!q.k) return false;
    ctx.translate((FT.c[0] + q.ox) * kx, (FT.c[1] + q.oy) * ky); ctx.scale(q.k, q.k); ctx.translate(-FT.c[0] * kx, -FT.c[1] * ky);
    return true;
  };
  const draw = (im, x, y, w, h, blur, flip, rz) => {
    ctx.save();
    ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
    if (rz) { const cx = (x + w / 2) * kx, cy = (y + h / 2) * ky; ctx.translate(cx, cy); ctx.rotate(rz * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (flip) { ctx.translate((x + w / 2) * 2 * kx, 0); ctx.scale(-1, 1); }
    ctx.drawImage(im, x * kx, y * ky, w * kx, h * ky);
    ctx.restore();
  };
  // colorimetrie (decor, element) : le dessin part sur un canvas a part, ses pixels prennent la matrice, puis il est pose
  const graded = async (M, fn) => {
    if (!M) return fn();
    const main = ctx, oc = document.createElement("canvas");
    oc.width = cv.width; oc.height = cv.height;
    ctx = oc.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.setTransform(main.getTransform());
    try { await fn(); } finally { ctx = main; }
    cmPixels(oc, M);
    main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(oc, 0, 0); main.restore();
  };
  const bg = background(pan, app.bank, app.project.id);
  if (pan.bgCanvas) await graded(bgCM(pan, 0), async () => { ctx.drawImage(pan.bgCanvas, 0, 0, cv.width, cv.height); });   // decor deja rendu (cylindre de la vue 3D)
  ctx.save();
  const bgOn = pan.bgCanvas || plane(1);                   // decor, sol et fond dessine : au plan du decor
  if (bg && bgOn && !pan.bgCanvas) await graded(bgCM(pan, 0), async () => {
    const pl = placement(local, bg.w || 16, bg.h || 9, (FT && FT.view) || pan.view);
    const bvf = await vecReady(bg);
    if (bvf) {                                             // decor en traces
      const st = bgStroke(pan), blur = sharp ? 0 : blurOf(pan, 1, bb), ink = new Path2D(bvf.ink);
      ctx.save();
      ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
      ctx.scale(kx, ky); ctx.translate(pl.x, pl.y); ctx.scale(pl.w / bvf.w, pl.h / bvf.h);
      ctx.fillStyle = "#ffffff"; ctx.fill(new Path2D(bvf.body));
      ctx.fillStyle = st.ink; ctx.fill(ink, "evenodd");
      if (st.width > 0) { ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.lineJoin = "round"; ctx.stroke(ink); }
      ctx.restore();
    } else draw(await loadImage(bg.url), pl.x, pl.y, pl.w, pl.h, sharp ? 0 : blurOf(pan, 1, bb));
  });
  ctx.restore();
  // carte de sol : une vraie plaque sous le decor (ground.js), dans le cadrage mais pas au plan du decor ; elle s'arrete au
  // pied du decor et, camera de la case comprise, descend toujours jusqu'au bas de l'image
  const GR = FT ? groundInFrame(groundFor(pan), pan.frame, local) : groundFor(pan);
  if (GR && GR.on && !pan.bgCanvas) {
    const v = FT ? frameVis(pan.frame, local) : { x: 0, y: 0, w: bb.w, h: bb.h };
    const gs = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(v.w * kx)}" height="${Math.round(v.h * ky)}" viewBox="${v.x} ${v.y} ${v.w} ${v.h}">${blinkGround(pan, groundSvg(GR, { x: 0, y: 0, w: bb.w, h: bb.h }, "gr", v))}</svg>`;
    ctx.drawImage(await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(gs)), v.x * kx, v.y * ky, v.w * kx, v.h * ky);
  }
  ctx.save();
  const drOn = pan.bgCanvas || plane(1);
  if (drOn && pan.draw && ((pan.draw.shapes || []).length || (pan.draw.fx && pan.draw.fx.on))) {        // fond dessine a la main, lignes d'effet
    const dim = await drawImage(pan.draw, cv.width, cv.height);
    if (dim) ctx.drawImage(dim, 0, 0, cv.width, cv.height);
  }
  ctx.restore();
  const layers = pan.layers || [];
  const cast = (l, box) => {                               // ombre portee : tache floue aux pieds, sous l'element
    const q = groundShadow(l, box);
    if (!q) return;
    ctx.save();
    ctx.filter = `blur(${(q.blur * kx).toFixed(2)}px)`; ctx.globalAlpha = q.a; ctx.fillStyle = q.col;
    ctx.scale(kx, ky); ctx.fill(new Path2D(q.d));
    ctx.restore();
  };
  // expression du visage (l.exk) : sa carte, posee en pixels de l'image d'orbite comme le calque
  const exprFind = async (l, sp) => {
    if (!l.exk || !sp || !sp.orbit || !sp.expr) return null;
    let mf = mouthFrame(sp);
    for (let k = 0; k < 20 && !(mf && mf.expr); k++) { await new Promise((ok) => setTimeout(ok, 50)); mf = mouthFrame(sp); }
    const c = mf && mf.expr && exprCard(l.exk, mf.expr, mf.all, sp.i);
    return c ? { c, mf } : null;
  };
  const exprPut = (g, { c, mf }, l, box, img) => {         // une image (carte ou gomme) a la place de la carte, comme le calque
    const sc = Math.min(box.w / mf.w, box.h / mf.h);
    g.save();
    g.scale(kx, ky);
    if (l.rz) { const cx = box.x + box.w / 2, cy = box.y + box.h / 2; g.translate(cx, cy); g.rotate(l.rz * Math.PI / 180); g.translate(-cx, -cy); }
    if (l.flip) { g.translate(2 * (box.cx ?? box.x + box.w / 2), 0); g.scale(-1, 1); }
    g.translate(box.x + (box.w - mf.w * sc) / 2, box.y + box.h - mf.h * sc); g.scale(sc, sc);
    if (c.move) { const q = c.move; g.translate(q.c1[0], q.c1[1]); g.rotate(q.rot * Math.PI / 180); g.scale(q.sx, 1); g.translate(-q.c0[0], -q.c0[1]); }
    g.drawImage(img, c.x, c.y, c.s, c.s);
    g.restore();
  };
  const exprDraw = async (l, sp, box) => { const e = await exprFind(l, sp); if (e) exprPut(ctx, e, l, box, await loadImage(e.c.href)); };
  // gomme de l'expression : le calque est dessine a part, la gomme l'efface (destination-out), puis il est pose
  const withGom = async (l, sp, box, fn) => {
    const e = await exprFind(l, sp);
    if (!e || !e.c.gom) return fn();
    const gimg = await loadImage(e.c.gom), main = ctx, oc = document.createElement("canvas");
    oc.width = cv.width; oc.height = cv.height;
    ctx = oc.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.setTransform(main.getTransform());
    try { await fn(); } finally { ctx = main; }
    const og = oc.getContext("2d");
    og.setTransform(main.getTransform()); og.globalCompositeOperation = "destination-out";
    exprPut(og, e, l, box, gimg);
    main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(oc, 0, 0); main.restore();
  };
  const order = layers.map((l, i) => i);                   // avec la camera du montage : du plus loin au plus pres, comme lui
  if (FT) order.sort((a, b) => depthOf(pan, b) - depthOf(pan, a) || a - b);
  for (const i of order) {
    ctx.save();
    try { if (plane(depthOf(pan, i))) await oneLayer(i); } finally { ctx.restore(); }
  }
  async function oneLayer(i) {
    const l = layers[i], item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
    if (!sp) return;
    const vf = await vecReady(layerSp(sp, l));
    if (vf) {                                              // dessin en traces : dessine en vectoriel, a la taille du canvas
      const box = layerBox(local, l, { w: vf.w, h: vf.h }), sc = Math.min(box.w / vf.w, box.h / vf.h);
      const tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc, col = bodyFill(l), inkc = inkFill(l), st = inkStroke(l.lw, col, inkc, vf.sw), blur = sharp ? 0 : blurOf(pan, depthOf(pan, i), bb);
      const body = new Path2D(vf.body), ink = new Path2D(vf.ink);
      cast(l, box);
      await withGom(l, sp, box, () => graded(layerCM(l, true, blinkAll(pan, 0)), async () => {
      ctx.save();
      ctx.filter = blur > 0.4 ? `blur(${(blur * kx).toFixed(2)}px)` : "none";
      ctx.scale(kx, ky);
      if (l.rz) { ctx.translate(box.x + box.w / 2, box.y + box.h / 2); ctx.rotate(l.rz * Math.PI / 180); ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2)); }
      if (l.flip) { ctx.translate(2 * (box.x + box.w / 2), 0); ctx.scale(-1, 1); }
      ctx.translate(tx, ty); ctx.scale(sc, sc);
      const hd = item.face ? await headReady(sp) : null, orb = (variantOf(item, l.v) || {}).orbit;      // portrait-robot : la tete en traces
      const fo = hd ? faceOps(item.face, hd, vf.w, vf.h, orb ? frameToAngle(orb, sp.i) * Math.PI / 180 : 0, { peau: col, trait: inkc, lw: lineWidth(vf.sw, l.lw) }) : null;
      if (fo) opsCanvas(ctx, fo.under);
      ctx.fillStyle = col; ctx.fill(body);
      ctx.save(); ctx.clip(body);
      const shd = shadeOf(l.sh, vf.h, col, inkc);
      if (shd) {
        for (const pd of shadeShapes(l.sh, vf)) {                       // forme par forme
          const part = new Path2D(pd);
          ctx.save(); ctx.clip(part);
          ctx.fillStyle = shd.fill; ctx.fill(part);
          ctx.translate(l.flip ? -shd.dx : shd.dx, shd.dy); ctx.fillStyle = col; ctx.fill(part);
          ctx.restore();
        }
      }
      ctx.fillStyle = inkc; ctx.fill(ink, "evenodd");
      if (st.width > 0) { ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.lineJoin = "round"; ctx.stroke(ink); }
      ctx.restore();
      if (fo) opsCanvas(ctx, fo.over);
      if (st.outline > 0) { ctx.strokeStyle = "#111111"; ctx.lineWidth = st.outline; ctx.stroke(body); }
      ctx.restore();
      }));
      await exprDraw(l, sp, box);
      return;
    }
    let im = await loadImage(sp.url);
    const box = layerBox(local, l, { w: im.naturalWidth, h: im.naturalHeight });
    const cm = layerCM(l, false, blinkAll(pan, 0));
    if (cm) {                                              // colorize et colorimetrie : la matrice sur les pixels, la decoupe gardee
      const tcv = document.createElement("canvas");
      tcv.width = im.naturalWidth; tcv.height = im.naturalHeight;
      tcv.getContext("2d").drawImage(im, 0, 0);
      im = cmPixels(tcv, cm);
    }
    cast(l, box);
    await withGom(l, sp, box, async () => draw(im, box.x, box.y, box.w, box.h, sharp ? 0 : blurOf(pan, depthOf(pan, i), bb), l.flip, l.rz));
    await exprDraw(l, sp, box);
  }
  return new Promise((ok) => cv.toBlob(ok, type, 0.92));
}
