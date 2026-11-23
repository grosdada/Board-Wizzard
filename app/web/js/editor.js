// Editeur de page : SVG (fonds, calques de la banque, traits) + calque HTML (numeros, bulles).
// Gestes : glisser un personnage = le deplacer ; poignee d'orbite au centre (ou Alt+glisser) = le faire tourner ;
// poignee du haut = le pencher ; boules des coins = taille ;
// clic droit = pose, axe, ordre. Glisser un fond en orbite = tourner le decor (Maj : recadrer). Base : Alive-Comics.
import { tt, tr } from "./i18n.js";
import { compute, nodeAt, area } from "./geometry.js";
import { h } from "./api.js";
import { markShape, thin } from "./marks.js";
import { vecFrame, inkStroke, shadeOf, shadeShapes, bodyFill, inkFill, wiggleFilter } from "./model.js";
import { drawSvg, hasDraw, W as DRAW_W } from "./draw.js";
import { faceFor, opsSvg } from "./face.js";
import { frameToAngle, thinMask, lineWidth, tintOf, tintFilter, frameT } from "./model.js";
import { sprite, preload, placement, layerBox, depthOf, blurOf, groundShadow, background, clamp, variantOf, pad3 } from "./model.js";
import { handlesSvg, cornerStart, cornerFactor, cornerFeet } from "./handles.js";
import { makeScene } from "./montage.js";
import { voiceTime } from "./lipsync.js";
import { groundSvg } from "./ground.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};
const pts = (poly) => poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const PX_PER_FRAME = 5;                       // glisser de 5 px = une image d'orbite

export class Editor {
  constructor(host, app) {
    this.app = app;
    this.drawCache = new Map();
    this.wrap = h("div.page-wrap");
    this.svg = s("svg", { class: "page-svg" });
    this.overlay = h("div.overlay");
    this.wrap.append(this.svg, this.overlay);
    host.append(this.wrap);
    this.geom = null;
    this.drag = null;
    this.imgs = new Map();
    this.bubs = new Map();
    this.svg.addEventListener("pointerdown", (e) => this.down(e));
    // double-clic sur une case : elle prend toute la place de la feuille ; double-clic encore (ou Echap) : retour a la page
    this.host = host; this.focusId = null;
    this.back = h("button.mini.focus-back", { title: tt("Revenir à la page entière (Échap, ou double-clic)"), on: { click: () => this.focus(null) } }, tt("⤡ Page entière"));
    host.append(this.back);
    this.svg.addEventListener("dblclick", (e) => { const g = this.panelAt(this.pagePt(e)); if (g) { e.preventDefault(); this.focus(this.focusId === g.id ? null : g.id); } });
    window.addEventListener("resize", () => this.applyFocus());
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.up(e));
    this.svg.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.svg.addEventListener("contextmenu", (e) => this.context(e));
    this.wrap.addEventListener("dragover", (e) => this.dragover(e));
    this.wrap.addEventListener("dragleave", () => this.hoverDrop(null));
    this.wrap.addEventListener("drop", (e) => this.drop(e));
    this.overlay.addEventListener("pointerdown", (e) => this.bubDown(e));
    this.overlay.addEventListener("pointermove", (e) => this.bubMove(e));
    this.overlay.addEventListener("pointerup", () => this.bubUp());
    this.overlay.addEventListener("pointercancel", () => this.bubUp());
    this.overlay.addEventListener("contextmenu", (e) => {
      const id = e.target.closest(".ac-bub, .ac-btip")?.dataset.id;
      if (id) { e.preventDefault(); this.app.bubbleMenu(e, e.target.closest(".ac-bubs").dataset.panel, id); }
    });
  }

  get pg() { return this.app.page(); }
  panel(id) { return this.pg.panels[id] || (this.pg.panels[id] = {}); }

  pagePt(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(this.svg.getScreenCTM().inverse());
  }
  scale() { return this.svg.getScreenCTM().a || 1; }            // px ecran par unite de page

  focus(pid) { this.focusId = pid || null; this.applyFocus(); }
  /** Cadre la feuille sur la case choisie (ou la remet entiere) : on agrandit toute la feuille, bulles comprises. */
  applyFocus() {
    const w = this.wrap, g = this.focusId && this.geom ? this.geom.panels.find((x) => x.id === this.focusId) : null;
    w.style.transform = ""; w.style.transformOrigin = "0 0";
    this.back.style.display = g ? "" : "none";
    this.host.classList.toggle("focused", !!g);
    if (!g) { this.focusId = null; this.drawHandles(); return; }
    const wr = w.getBoundingClientRect(), cr = this.host.getBoundingClientRect(), s0 = wr.width / this.pg.page.width;
    const pad = this.animated(g.id) ? 46 : 0;                    // case animee : place pour le bouton lecture sous la case
    const k = Math.min((cr.width - 28) / (g.bbox.w * s0), (cr.height - 44 - pad) / (g.bbox.h * s0));
    const tx = cr.left + cr.width / 2 - (wr.left + (g.bbox.x0 + g.bbox.w / 2) * s0 * k), ty = cr.top + (cr.height - 16 - pad) / 2 - (wr.top + (g.bbox.y0 + g.bbox.h / 2) * s0 * k);
    w.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`;
    this.drawHandles();
  }
  /** Poignees du calque choisi, a taille fixe a l'ecran quel que soit le cadrage : orbite au centre, inclinaison en haut,
   *  une boule par coin pour la taille. Elles suivent l'inclinaison ; sur un petit personnage, elles s'ecartent de la boite. */
  drawHandles() {
    this.drawPlays();
    const svg = this.svg;
    svg.querySelectorAll(":scope > g.lh").forEach((x) => { if (!x.classList.contains("mh")) x.remove(); });
    const hs = this.hs, l = this.app.layer();
    if (!hs || !l) return;
    const { box, sp, g } = hs, bb = g.bbox, FT = frameT(this.panel(g.id), bb), u = 1 / (this.scale() || 1) / (FT ? FT.z : 1);      // u : unites de page par pixel d'ecran
    this.rotCenter = { x: box.cx, y: box.y + box.h / 2 };
    const gh = s("g");
    gh.innerHTML = handlesSvg({ box, rz: l.rz || 0, u, view: FT ? { x0: FT.inv({ x: bb.x0, y: bb.y0 }).x, y0: FT.inv({ x: bb.x0, y: bb.y0 }).y, x1: FT.inv({ x: bb.x0 + bb.w, y: bb.y0 + bb.h }).x, y1: FT.inv({ x: bb.x0 + bb.w, y: bb.y0 + bb.h }).y } : bb, bounds: { x0: 0, y0: 0, x1: this.pg.page.width, y1: this.pg.page.height }, orbit: !!(sp && sp.orbit) });
    if (FT) gh.firstChild.setAttribute("transform", FT.m + " " + (gh.firstChild.getAttribute("transform") || ""));   // cadrage de la case
    svg.append(gh.firstChild);
  }
  /** Case animee (mode montage) : un petit bouton lecture dans la gouttiere, sous le milieu de la case, a taille fixe a
   *  l'ecran. Il rejoue l'animation dans la case, une fois (un second clic l'arrete). */
  animated(pid) { const pan = this.pg && this.pg.panels[pid], tr = pan && pan.anim && pan.anim.tracks; return !!(tr && Object.values(tr).some((k) => k && k.length)); }
  drawPlays() {
    const svg = this.svg, pg = this.pg;
    svg.querySelectorAll(":scope > g.pv-play").forEach((x) => x.remove());
    if (!pg || !this.geom) return;
    const page = pg.page, u = 1 / (this.scale() || 1), r = 11 * u;
    for (const g of this.geom.panels) {
      if (!this.animated(g.id)) continue;
      const bb = g.bbox, bottom = bb.y0 + bb.h;
      const below = bottom >= page.height - page.margin - 1 ? page.margin : (page.gutterV ?? page.gutter);
      const cx = bb.x0 + bb.w / 2, cy = bottom + (this.focusId === g.id ? 22 * u : Math.max(below / 2, 0));   // case agrandie : juste sous elle
      const on = this.pv && this.pv.pid === g.id;
      const gp = s("g", { class: "pv-play" + (on ? " on" : ""), "data-pv": g.id, transform: `translate(${cx.toFixed(2)} ${(cy).toFixed(2)}) scale(${(r / 11).toFixed(5)})` });
      const tip = s("title"); tip.textContent = on ? tt("Arrêter l'animation") : tt("Voir l'animation de cette case (mode montage)");
      gp.append(tip, s("circle", { r: 11, class: "pv-disk", "data-pv": g.id }),
        on ? s("rect", { x: -4, y: -4, width: 8, height: 8, class: "pv-ico", "data-pv": g.id })
           : s("path", { d: "M-3.2 -5.2 L5.6 0 L-3.2 5.2 Z", class: "pv-ico", "data-pv": g.id }));
      svg.append(gp);
    }
  }
  /** Rejoue l'animation d'une case par-dessus son image, a sa place sur la planche, puis la retire. */
  playPanel(pid) {
    const stop = () => { if (!this.pv) return; cancelAnimationFrame(this.pv.raf); for (const a of this.pv.voices) a.a.pause(); this.pv.el.remove(); this.pv = null; this.drawPlays(); };
    const was = this.pv && this.pv.pid;
    stop();
    if (was === pid) return;
    const pg = this.pg, g = this.geom && this.geom.panels.find((x) => x.id === pid), pan = pg && pg.panels[pid];
    if (!g || !pan || !pan.anim) return;
    const bb = g.bbox, scene = makeScene(this.app, pg, JSON.parse(JSON.stringify(pan)), bb.h / bb.w, "pv");
    const w = scene.H * bb.w / bb.h, dur = pan.anim.dur || 4;
    const inner = s("svg", { x: bb.x0, y: bb.y0, width: bb.w, height: bb.h, viewBox: `0 0 ${w.toFixed(2)} ${scene.H.toFixed(2)}`, preserveAspectRatio: "none" });
    const el = s("g", { class: "pv-anim", "clip-path": `url(#cp-${pid})` });
    el.append(inner);
    // les voix de la case (montage, lip sync) : chacune suit le temps de la lecture, comme dans le montage
    const voices = (pan.layers || []).filter((l) => l.lip && l.lip.src).map((l) => {
      const a = new Audio(`/projects/${this.app.project.id}/${l.lip.src}`); a.preload = "auto";
      return { a, lip: l.lip };
    });
    const sync = (t) => {
      for (const v of voices) {
        const want = voiceTime(v.lip, t);
        if (want < 0) { if (!v.a.paused) v.a.pause(); continue; }
        if (v.a.paused) { try { v.a.currentTime = want; } catch (e) { /* pas encore charge */ } v.a.play().catch(() => {}); }
        else if (Math.abs(v.a.currentTime - want) > 0.25) v.a.currentTime = want;
      }
    };
    const t0 = performance.now();
    this.pv = { pid, el, raf: 0, voices };
    sync(0);                                                 // dans le clic : le navigateur laisse partir le son
    const tick = (now) => {
      if (!this.pv || this.pv.el !== el) return;
      const t = (now - t0) / 1000;
      if (t > dur) return stop();
      sync(t);
      if (!el.isConnected) this.svg.insertBefore(el, this.svg.querySelector(":scope > g.pv-play") || null);   // la planche a ete redessinee
      inner.innerHTML = scene.markup(t, null, () => {});
      this.pv.raf = requestAnimationFrame(tick);
    };
    this.svg.append(el);
    this.drawPlays();
    this.pv.raf = requestAnimationFrame(tick);
  }
  panelAt(pt) {
    if (!this.geom) return null;
    for (const g of this.geom.panels) if (inside([pt.x, pt.y], g.poly)) return g;
    return null;
  }

  image(key, url, attrs) {                   // <image> garde d'un rendu a l'autre : pas de clignotement
    let im = this.imgs.get(key);
    if (!im) { im = s("image"); this.imgs.set(key, im); }
    if (im.getAttribute("href") !== url) im.setAttribute("href", url);
    for (const [k, v] of Object.entries(attrs)) { if (v == null) im.removeAttribute(k); else im.setAttribute(k, v); }
    this.used.add(key);
    return im;
  }

  // ---------------------------------------------------------------- dessin
  render(light) {
    const pg = this.pg;
    if (!pg) return;
    const page = pg.page, app = this.app, sel = app.sel;
    this.geom = compute(page, pg.layout);
    this.wrap.style.aspectRatio = `${page.width} / ${page.height}`;
    this.wrap.style.setProperty("--ratio", page.width / page.height);
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${page.width} ${page.height}`);
    svg.textContent = "";
    this.used = new Set();
    const defs = s("defs");
    svg.append(defs, s("rect", { x: 0, y: 0, width: page.width, height: page.height, fill: page.bg }));
    const k = page.width / 900;
    let handles = null, mhandles = null;
    for (const g of this.geom.panels) {
      const pan = pg.panels[g.id] || {}, bb = g.bbox;
      const cp = s("clipPath", { id: "cp-" + g.id });
      cp.append(s("polygon", { points: pts(g.poly) }));
      defs.append(cp);
      const grp = s("g", { "clip-path": `url(#cp-${g.id})` });
      const drawn = hasDraw(pan.draw);
      const empty = !pan.bg && !drawn && !(pan.layers || []).length && !pan.integrated && !pan.orbit;
      grp.append(s("polygon", { points: pts(g.poly), fill: empty ? "var(--empty)" : (page.fill || "#fff") }));
      const cover = { x: bb.x0, y: bb.y0, width: bb.w, height: bb.h, preserveAspectRatio: "xMidYMid slice", "data-bg": g.id };
      const show = pan.show || "layers";
      if (show === "integrated" && pan.integrated) {
        grp.append(this.image("i:" + g.id, `/projects/${app.project.id}/${pan.integrated}`, cover));
      } else if (show === "orbit" && pan.orbit) {
        const o = pan.orbit, f = (((o.frame || 0) % o.n) + o.n) % o.n;
        grp.append(this.image("o:" + g.id, `/projects/${app.project.id}/${o.dir}/${pad3(f)}.webp`, cover));
      } else {
        const bg = background(pan, app.bank, app.project.id);
        if (bg) {
          const pl = placement(bb, bg.w || 16, bg.h || 9, pan.view);
          const blur = blurOf(pan, 1, bb);
          const bvf = vecFrame(bg, () => this.render(true));
          if (bvf) {                                         // decor dessine, en traces : net au zoom, trait reglable
            const st = inkStroke(pan.bglw), gb = s("g", { transform: `translate(${pl.x} ${pl.y}) scale(${pl.w / bvf.w} ${pl.h / bvf.h})`, filter: this.blur(defs, blur), "data-bg": g.id });
            gb.append(s("path", { d: bvf.body, fill: "#ffffff", "data-bg": g.id }));
            const bw = wiggleFilter("wgb-" + g.id, pan.bghand, pan.bgwave, bvf.w, bvf.h, 11);     // tremble du trait du decor
            if (bw) defs.insertAdjacentHTML("beforeend", bw);
            gb.append(s("path", { d: bvf.ink, fill: "#111111", "fill-rule": "evenodd", stroke: st.color, "stroke-width": st.width, "stroke-linejoin": "round", "pointer-events": "none", filter: bw ? `url(#wgb-${g.id})` : null }));
            grp.append(gb);
          } else
          grp.append(this.image("b:" + g.id, bg.url, { x: pl.x, y: pl.y, width: pl.w, height: pl.h, "data-bg": g.id,
                                                        preserveAspectRatio: "none", filter: this.blur(defs, blur) }));
        }
        if (pan.ground && pan.ground.on) {                   // carte de sol, en perspective (ground.js)
          const gg = s("g", { "pointer-events": "none" });
          gg.innerHTML = groundSvg(pan.ground, { x: bb.x0, y: bb.y0, w: bb.w, h: bb.h }, "gr-" + g.id);
          grp.append(gg);
        }
        if (drawn) {                                         // fond dessine a la main : formes, traces, trames
          const key = g.id + "|" + bb.w + "x" + bb.h + "|" + JSON.stringify(pan.draw);
          let c = this.drawCache.get(g.id);
          if (!c || c.key !== key) { c = { key, html: drawSvg(pan.draw, DRAW_W * bb.h / bb.w, "d" + g.id + "-") }; this.drawCache.set(g.id, c); }
          const gd = s("g", { transform: `translate(${bb.x0} ${bb.y0}) scale(${bb.w / DRAW_W})`, "pointer-events": "none", filter: this.blur(defs, blurOf(pan, 0.9, bb)) });
          gd.innerHTML = c.html;
          grp.append(gd);
        }
        (pan.layers || []).forEach((l, i) => {
          const item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
          if (!sp) return;
          const box = layerBox(bb, l, sp);
          const gsd = groundShadow(l, box);                  // ombre portee : sous l'element
          if (gsd) grp.append(s("path", { d: gsd.d, fill: gsd.col, opacity: gsd.a, "pointer-events": "none",
                                             filter: this.blur(defs, gsd.blur + blurOf(pan, depthOf(pan, i), bb)) }));
          const vf = vecFrame(sp, () => this.render(true));
          if (vf) {                                          // dessin en traces : net a tout zoom, trait reglable
            const sc = Math.min(box.w / vf.w, box.h / vf.h), tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc;
            const col = bodyFill(l), ink = inkFill(l), st = inkStroke(l.lw, col, ink, vf.sw), tag = { "data-layer": l.id, "data-panel": g.id };
            const gv = s("g", Object.assign({ class: "layer vlayer", transform: (l.rz ? `rotate(${l.rz} ${box.cx} ${box.y + box.h / 2}) ` : "") + (l.flip ? `translate(${2 * box.cx} 0) scale(-1 1) ` : "") + `translate(${tx} ${ty}) scale(${sc})`,
                                              filter: this.blur(defs, blurOf(pan, depthOf(pan, i), bb)) }, tag));
            const cid = "vc-" + g.id + "-" + l.id, clip = s("clipPath", { id: cid });
            clip.append(s("path", { d: vf.body }));
            defs.append(clip);
            const lw = wiggleFilter("wg-" + g.id + "-" + l.id, l.hand, l.wave, vf.w, vf.h);      // tremble du trait : tout le dessin ondule ensemble
            if (lw) defs.insertAdjacentHTML("beforeend", lw);
            const gw = lw ? s("g", { filter: `url(#wg-${g.id}-${l.id})` }) : gv;
            if (gw !== gv) gv.append(gw);
            const orb = (variantOf(item, l.v) || {}).orbit;     // portrait-robot : la tete en traces, tournee comme le corps
            const fo = faceFor(item, sp, vf, orb ? frameToAngle(orb, sp.i) * Math.PI / 180 : 0, { peau: col, trait: ink, lw: lineWidth(vf.sw, l.lw) }, () => this.render(true));
            const fattr = ` data-layer="${l.id}" data-panel="${g.id}"`;
            if (fo) gw.insertAdjacentHTML("beforeend", opsSvg(fo.under, fattr));
            const gb = st.thin ? s("g", { mask: `url(#vm-${g.id}-${l.id})` }) : gw;     // trait affine : la silhouette recule avec lui
            if (st.thin) { defs.insertAdjacentHTML("beforeend", thinMask(`vm-${g.id}-${l.id}`, vf.body, st.thin)); gw.append(gb); }
            gb.append(s("path", Object.assign({ d: vf.body, fill: col }, tag)));
            const gi = s("g", { "clip-path": `url(#${cid})` });
            const shd = shadeOf(l.sh, vf.h, col, ink);
            if (shd) {                                       // ombre : aplat gris, puis la silhouette decalee en blanc par-dessus
              const mv = `translate(${(l.flip ? -shd.dx : shd.dx).toFixed(2)} ${shd.dy.toFixed(2)})`;
              shadeShapes(l.sh, vf).forEach((pd, pi) => {                 // forme par forme : chaque zone fermee par le trait a son ombre
                const pcid = cid + "-" + pi, pc = s("clipPath", { id: pcid });
                pc.append(s("path", { d: pd }));
                defs.append(pc);
                const gp = s("g", { "clip-path": `url(#${pcid})`, "pointer-events": "none" });
                gp.append(s("path", { d: pd, fill: shd.fill }), s("path", { d: pd, fill: col, transform: mv }));
                gi.append(gp);
              });
            }
            gi.append(s("path", Object.assign({ d: vf.ink, fill: ink, "fill-rule": "evenodd", stroke: st.color, "stroke-width": st.width, "stroke-linejoin": "round" }, tag)));
            gb.append(gi);
            if (fo) gw.insertAdjacentHTML("beforeend", opsSvg(fo.over, fattr));
            if (st.outline > 0) gv.append(s("path", { d: vf.body, fill: "none", stroke: "#111111", "stroke-width": st.outline, "pointer-events": "none" }));
            grp.append(gv);
            if (sel.panel === g.id && sel.layer === l.id) handles = { box, sp, g };
            return;
          }
          const im = this.image("l:" + g.id + ":" + l.id, sp.url, {
            x: box.x, y: box.y, width: box.w, height: box.h, preserveAspectRatio: "xMidYMax meet", "data-layer": l.id,
            "data-panel": g.id, transform: ((l.rz ? `rotate(${l.rz} ${box.cx} ${box.y + box.h / 2}) ` : "") + (l.flip ? `translate(${2 * box.cx} 0) scale(-1 1)` : "")) || null,
            filter: this.blur(defs, blurOf(pan, depthOf(pan, i), bb)), class: "layer" });
          const tc = tintOf(l);
          if (tc) {                                          // colorize : la couleur en produit dans la decoupe
            const tid = "tn-" + g.id + "-" + l.id;
            defs.insertAdjacentHTML("beforeend", tintFilter(tid, tc));
            const gt = s("g", { filter: `url(#${tid})` });
            gt.append(im); grp.append(gt);
          } else grp.append(im);
          if (sel.panel === g.id && sel.layer === l.id) handles = { box, sp, g };
        });
      }
      const FT = show === "layers" ? frameT(pan, bb) : null;
      if (FT) {                                            // cadrage de la case (1re image du montage) : le contenu, pas les indications
        const inner = s("g", { transform: FT.m });
        while (grp.childNodes.length > 1) inner.append(grp.childNodes[1]);
        grp.append(inner);
      }
      for (const m of pan.marks || []) {                    // indications : fleches, rotation, cadres
        const sh = markShape(m, bb, k), col = m.color || "#111111", halo = col === "#ffffff" ? "#111111" : "#ffffff";
        const gm = s("g", { class: "mark", "data-mark": m.id, "data-panel": g.id });
        const line = (extra) => s("path", Object.assign({ d: sh.d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "data-mark": m.id, "data-panel": g.id }, extra));
        gm.append(line({ stroke: "transparent", "stroke-width": Math.max(sh.width * 4, 26 * k), class: "mark-hit" }));
        gm.append(line({ stroke: halo, "stroke-width": sh.width + 5 * k, "stroke-opacity": 0.85, "stroke-dasharray": sh.dash }));
        for (const hp of sh.heads) gm.append(s("polygon", { points: hp, fill: halo, stroke: halo, "stroke-width": 5 * k, "stroke-linejoin": "round", "fill-opacity": 0.85, "stroke-opacity": 0.85, "data-mark": m.id, "data-panel": g.id }));
        gm.append(line({ stroke: col, "stroke-width": sh.width, "stroke-dasharray": sh.dash }));
        for (const hp of sh.heads) gm.append(s("polygon", { points: hp, fill: col, "data-mark": m.id, "data-panel": g.id }));
        grp.append(gm);
        if (sel.panel === g.id && sel.mark === m.id) mhandles = { sh, m, g };
      }
      svg.append(grp);
    }
    const pw = wiggleFilter("wg-page", page.hand, page.wave, page.width, page.height, 7);   // tremble du contour des cases
    if (pw) defs.insertAdjacentHTML("beforeend", pw);
    const strokes = s("g", { filter: pw ? "url(#wg-page)" : null, class: "panel-stroke" });
    for (const g of this.geom.panels) {
      strokes.append(s("polygon", { points: pts(g.poly), fill: "none", stroke: page.stroke, "stroke-width": page.strokeWidth,
                                "stroke-linejoin": "miter", class: "panel-stroke" }));
    }
    svg.append(strokes);
    for (const g of this.geom.panels) {
      if (g.id === sel.panel && !sel.layer) svg.append(s("polygon", { points: pts(g.poly), class: "sel-outline" }));
      if (g.id === this.dropTarget) svg.append(s("polygon", { points: pts(g.poly), class: "drop-outline" }));
    }
    this.geom.cuts.forEach((c, i) => {                    // traits : le milieu deplace, les bouts inclinent
      if (!c.seg) return;
      const [E0, E1] = c.seg;
      const gl = s("g", { class: "cut", "data-cut": i });
      gl.append(s("line", { x1: E0[0], y1: E0[1], x2: E1[0], y2: E1[1], class: "cut-hit",
                            "stroke-width": Math.max(page.gutter + 8, 20 * k), "data-cut": i, "data-mode": "move" }));
      gl.append(s("line", { x1: E0[0], y1: E0[1], x2: E1[0], y2: E1[1], class: "cut-line", "stroke-width": 3 * k }));
      gl.append(s("circle", { cx: (E0[0] + E1[0]) / 2, cy: (E0[1] + E1[1]) / 2, r: 9 * k, class: "cut-mid", "data-cut": i, "data-mode": "move" }));
      gl.append(s("circle", { cx: E0[0], cy: E0[1], r: 8 * k, class: "cut-end", "data-cut": i, "data-mode": "end0" }));
      gl.append(s("circle", { cx: E1[0], cy: E1[1], r: 8 * k, class: "cut-end", "data-cut": i, "data-mode": "end1" }));
      svg.append(gl);
    });
    this.hs = handles;                                    // poignees du calque choisi : dessinees par drawHandles, apres le cadrage
    if (mhandles) {                                        // poignees de l'indication choisie
      const gh = s("g", { class: "lh mh" });
      for (const [x, y, i] of mhandles.sh.handles) gh.append(s("circle", { cx: x, cy: y, r: 9 * k, class: "mh-pt", "data-mh": i }));
      svg.append(gh);
    }
    this.wrap.classList.toggle("drawing", !!app.markTool);
    for (const key of [...this.imgs.keys()]) if (!this.used.has(key)) this.imgs.delete(key);
    this.applyFocus();
    if (!light) this.renderOverlay();
  }

  blur(defs, amount) {
    if (!(amount > 0.4)) return null;
    const id = "bl" + Math.round(amount * 4);
    if (!defs.querySelector("#" + id)) {
      const f = s("filter", { id, x: "-15%", y: "-15%", width: "130%", height: "130%" });
      f.append(s("feGaussianBlur", { stdDeviation: (amount).toFixed(2) }));
      defs.append(f);
    }
    return `url(#${id})`;
  }

  renderOverlay() {
    const pg = this.pg, page = pg.page, app = this.app;
    for (const c of this.bubs.values()) c.destroy();
    this.bubs.clear();
    this.overlay.textContent = "";
    for (const g of this.geom.panels) {
      const pan = pg.panels[g.id] || {};
      const rect = [g.bbox.x0 / page.width * 100, g.bbox.y0 / page.height * 100, g.bbox.w / page.width * 100, g.bbox.h / page.height * 100];
      const state = app.panelState(g.id);
      const chip = h("div.pchip", { style: { left: rect[0] + "%", top: rect[1] + "%" } }, h("span.num", String(g.order)),
        state ? h("span.dot." + state.kind, { title: state.text }) : null,
        pan.show === "integrated" ? h("span.tag", tt("intégrée")) : pan.show === "orbit" ? h("span.tag", tt("orbite")) : null);
      this.overlay.append(chip);
      if (!pan.bg && !(pan.layers || []).length && !pan.integrated && !pan.orbit) {
        this.overlay.append(h("div.empty-hint", { style: { left: rect[0] + "%", top: rect[1] + "%", width: rect[2] + "%", height: rect[3] + "%" } },
          h("span", tt("Glisse ici un décor, un personnage ou une image"))));
      }
      if ((pan.bubbles || []).length && window.AliveBubbles) {
        const ctl = window.AliveBubbles.mount(this.overlay, pan.bubbles, { edit: true, rect });
        ctl.root.dataset.panel = g.id;
        if (app.sel.panel === g.id && app.sel.bubble) ctl.select(app.sel.bubble);
        this.bubs.set(g.id, ctl);
      }
    }
  }

  // ---------------------------------------------------------------- bulles (calque HTML)
  bubDown(e) {
    if (e.button !== 0) return;
    const tip = e.target.closest(".ac-btip"), bub = e.target.closest(".ac-bub");
    const id = (tip || bub)?.dataset.id;
    if (!id) return;
    const root = (tip || bub).closest(".ac-bubs"), pid = root.dataset.panel;
    const b = (this.panel(pid).bubbles || []).find((x) => x.id === id);
    if (!b) return;
    this.app.select({ panel: pid, bubble: id }, true);
    for (const [k, c] of this.bubs) c.select(k === pid ? id : null);
    const r = root.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    this.bdrag = { b, root, ctl: this.bubs.get(pid), tip: !!tip && !tip.classList.contains("base"), base: !!tip && tip.classList.contains("base"),
                   px, py, x: b.x, y: b.y, tx: b.tx, ty: b.ty, bx: b.bx, by: b.by, moved: false };
    this.overlay.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  }
  bubMove(e) {
    const d = this.bdrag;
    if (!d) return;
    const r = d.root.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height, dx = px - d.px, dy = py - d.py, b = d.b;
    if (d.tip) { b.tx = clamp(d.tx + dx, -0.3, 1.3); b.ty = clamp(d.ty + dy, -0.3, 1.3); }
    else if (d.base) { b.bx = clamp(px, -0.3, 1.3); b.by = clamp(py, -0.3, 1.3); }
    else {
      if (d.bx != null) { b.bx = d.bx + (clamp(d.x + dx, -0.2, 1.2) - d.x); b.by = d.by + (clamp(d.y + dy, -0.2, 1.2) - d.y); }
      b.x = clamp(d.x + dx, -0.2, 1.2); b.y = clamp(d.y + dy, -0.2, 1.2);
      if (d.tx != null) { b.tx = clamp(d.tx + (b.x - d.x), -0.3, 1.3); b.ty = clamp(d.ty + (b.y - d.y), -0.3, 1.3); }
    }
    d.moved = true;
    d.ctl.layout();
  }
  bubUp() {
    const d = this.bdrag;
    this.bdrag = null;
    if (d && d.moved) this.app.commit("bubble");
  }

  // ---------------------------------------------------------------- gestes
  down(e) {
    if (e.button !== 0) return;
    const pv = e.target.closest && e.target.closest("[data-pv]");
    if (pv) { e.preventDefault(); e.stopPropagation(); this.playPanel(pv.dataset.pv); return; }   // lecture d'une case animee
    const t = e.target, pt = this.pagePt(e), app = this.app;
    if (t.dataset && t.dataset.cut != null) {
      const cut = this.geom.cuts[+t.dataset.cut];
      this.drag = { kind: "cut", mode: t.dataset.mode, path: cut.path, bb: cut.bb, seg: cut.seg, start: pt, a: cut.node.a, b: cut.node.b };
      e.preventDefault();
      return;
    }
    const relOf = (g) => [(pt.x - g.bbox.x0) / g.bbox.w, (pt.y - g.bbox.y0) / g.bbox.h];
    if (app.markTool) {                                    // outil d'indication arme : on la trace dans la case
      const g = this.panelAt(pt);
      if (!g) { app.markTool = null; this.render(true); return; }
      const m = app.addMark(g.id, app.markTool, relOf(g), true), r = relOf(g);
      m.pts = m.type === "curve" ? [r, r, r] : [r, r];
      this.drag = { kind: "mdraw", m, bb: g.bbox, start: pt, pid: g.id };
      e.preventDefault();
      return;
    }
    if (t.dataset && t.dataset.mh != null) {               // un point de l'indication choisie
      const g = this.geom.panels.find((x) => x.id === app.sel.panel), m = app.mark();
      if (g && m) this.drag = { kind: "mpt", m, i: +t.dataset.mh, bb: g.bbox, start: pt };
      e.preventDefault();
      return;
    }
    if (t.dataset && t.dataset.mark) {                     // l'indication entiere
      const pid = t.dataset.panel, g = this.geom.panels.find((x) => x.id === pid);
      const m = (this.panel(pid).marks || []).find((x) => x.id === t.dataset.mark);
      if (!m || !g) return;
      app.select({ panel: pid, mark: m.id });
      this.drag = { kind: "mmove", m, bb: g.bbox, start: pt, pts: m.pts.map((p) => p.slice()) };
      e.preventDefault();
      return;
    }
    const inPanel = (pid, g) => {                          // cadrage de la case : le point dans le repere de son contenu
      const F = g && frameT(this.panel(pid), g.bbox);
      return F ? [F.inv(pt), F] : [pt, null];
    };
    if (t.dataset && t.dataset.h) {                        // poignee du calque choisi
      const g0 = this.geom.panels.find((x) => x.id === app.sel.panel), [pt, F] = inPanel(app.sel.panel, g0);
      const g = g0, l = app.layer();
      const item = l && app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
      if (g && l && t.dataset.h === "rot") { const c = this.rotCenter || { x: pt.x, y: pt.y + 1 }; this.drag = { kind: "lrot", l, c, a0: Math.atan2(pt.y - c.y, pt.x - c.x), rz: l.rz || 0 }; }
      else if (g && l && t.dataset.h === "turn" && sp) { preload(item, l.v); this.drag = { kind: "lturn", l, sx: e.clientX, f: l.f || 0, n: sp.n }; }
      else if (g && l && t.dataset.h === "corner" && sp) {
        // taille par un coin : le coin oppose de la boite reste en place, proportions gardees
        this.drag = Object.assign(cornerStart(layerBox(g.bbox, l, sp), l.rz, +t.dataset.c), { kind: "lscale", corner: true, l, bb: g.bbox, start: [pt.x, pt.y], s: l.s });
      }
      else if (g && l) this.drag = { kind: "lmove", l, bb: g.bbox, start: pt, x: l.x, y: l.y, s: l.s };
      if (this.drag) this.drag.F = F;
      e.preventDefault();
      return;
    }
    if (t.dataset && t.dataset.layer) {
      const pid = t.dataset.panel, g = this.geom.panels.find((x) => x.id === pid), [pt, F] = inPanel(pid, g);
      const l = (this.panel(pid).layers || []).find((x) => x.id === t.dataset.layer);
      if (!l || !g) return;
      if (app.focusPick) { app.focusOn(pid, l); e.preventDefault(); return; }      // cible : la mise au point se fait sur lui
      app.select({ panel: pid, layer: l.id });
      const item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
      if (item) preload(item, l.v);
      const turn = sp && sp.orbit && e.altKey;             // glisser = deplacer ; Alt + glisser = orbite (comme la poignee du centre)
      this.drag = { kind: turn ? "lturn" : "lmove", l, bb: g.bbox, start: pt, sx: e.clientX, x: l.x, y: l.y, s: l.s, f: l.f || 0,
                    n: sp ? sp.n : 1, F };
      e.preventDefault();
      return;
    }
    const g = this.panelAt(pt);
    if (!g) { app.select({}); return; }
    app.select({ panel: g.id });
    const pan = this.panel(g.id), show = pan.show || "layers";
    if (show === "orbit" && pan.orbit) {
      this.drag = { kind: "oturn", o: pan.orbit, sx: e.clientX, f: pan.orbit.frame || 0 };
    } else if (show === "layers") {
      const bg = background(pan, app.bank, app.project.id);
      if (!bg) return;
      if (bg.orbit && !e.shiftKey && !e.altKey) {
        preload(bg.item, pan.bg.v || "base");
        this.drag = { kind: "bturn", bg: pan.bg, sx: e.clientX, f: pan.bg.f || 0, n: bg.n };
      } else {
        const pl = placement(g.bbox, bg.w, bg.h, pan.view), [p1, F] = inPanel(g.id, g);
        this.drag = { kind: "pan", pan, bg, bb: g.bbox, start: p1, ox: pl.ox, oy: pl.oy, F };
      }
    }
    e.preventDefault();
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const pt = d.F ? d.F.inv(this.pagePt(e)) : this.pagePt(e);      // cadrage de la case : repere de son contenu
    d.moved = true;
    if (d.kind === "lturn") { d.l.f = (((d.f + Math.round((e.clientX - d.sx) / PX_PER_FRAME)) % d.n) + d.n) % d.n; return this.render(true); }
    if (d.kind === "bturn") { d.bg.f = (((d.f + Math.round((e.clientX - d.sx) / PX_PER_FRAME)) % d.n) + d.n) % d.n; return this.render(true); }
    if (d.kind === "oturn") { d.o.frame = (((d.f + Math.round((e.clientX - d.sx) / PX_PER_FRAME)) % d.o.n) + d.o.n) % d.o.n; return this.render(true); }
    if (d.kind === "mdraw" || d.kind === "mpt" || d.kind === "mmove") {
      const m = d.m, r = [(pt.x - d.bb.x0) / d.bb.w, (pt.y - d.bb.y0) / d.bb.h];
      if (d.kind === "mmove") {
        const dx = (pt.x - d.start.x) / d.bb.w, dy = (pt.y - d.start.y) / d.bb.h;
        m.pts = d.pts.map((p) => [p[0] + dx, p[1] + dy]);
      } else if (d.kind === "mpt") {
        if (m.type === "turn" && d.i === 0) { const dx = r[0] - m.pts[0][0], dy = r[1] - m.pts[0][1]; m.pts = m.pts.map((p) => [p[0] + dx, p[1] + dy]); }
        else m.pts[d.i] = r;
      } else if (m.type === "free") {
        const last = m.pts[m.pts.length - 1];
        if (Math.hypot((r[0] - last[0]) * d.bb.w, (r[1] - last[1]) * d.bb.h) > this.pg.page.width / 220) m.pts.push(r);
      } else if (m.type === "curve") {
        const a = m.pts[0], mx = (a[0] + r[0]) / 2, my = (a[1] + r[1]) / 2;
        const px = (r[0] - a[0]) * d.bb.w, py = (r[1] - a[1]) * d.bb.h;      // creux de la courbe : perpendiculaire, en pixels
        m.pts = [a, [mx + py * 0.22 / d.bb.w, my - px * 0.22 / d.bb.h], r];
      } else m.pts[1] = r;
      return this.render(true);
    }
    if (d.kind === "lrot") {                               // inclinaison ; Maj : par crans de 15 degres
      let rz = d.rz + (Math.atan2(pt.y - d.c.y, pt.x - d.c.x) - d.a0) * 180 / Math.PI;
      rz = ((rz + 180) % 360 + 360) % 360 - 180;
      d.l.rz = e.shiftKey ? Math.round(rz / 15) * 15 : Math.round(rz);
      return this.render(true);
    }
    if (d.kind === "lmove") {
      d.l.x = clamp(d.x + (pt.x - d.start.x) / d.bb.w, -40, 40);     // sans limite pratique : gros plans, hors-champ
      d.l.y = clamp(d.y + (pt.y - d.start.y) / d.bb.h, -40, 40);
      if (this.app.syncLayer) this.app.syncLayer();
      return this.render(true);
    }
    if (d.kind === "lscale" && d.corner) {                // coin : facteur = avancee le long de la diagonale depuis le coin oppose
      d.l.s = clamp(d.s * cornerFactor(d, [pt.x, pt.y]), 0.03, 40);
      const F = cornerFeet(d, d.l.s / d.s);
      d.l.x = (F[0] - d.bb.x0) / d.bb.w; d.l.y = (F[1] - d.bb.y0) / d.bb.h;
      if (this.app.syncLayer) this.app.syncLayer();
      return this.render(true);
    }
    if (d.kind === "lscale") {                             // taille autour des pieds
      const y1 = d.bb.y0 + d.l.y * d.bb.h;
      const y0 = d.bb.y0 + d.y * d.bb.h, ref = y0 - d.start.y;         // proportionnel au geste, ou que soit la poignee
      d.l.s = clamp(Math.abs(ref) > 4 ? d.s * (y1 - pt.y) / ref : d.s * Math.exp((d.start.y - pt.y) / d.bb.h * 2), 0.03, 40);
      if (this.app.syncLayer) this.app.syncLayer();
      return this.render(true);
    }
    if (d.kind === "pan") {
      d.pan.view = Object.assign({}, d.pan.view, { ox: d.ox + (pt.x - d.start.x) / d.bb.w, oy: d.oy + (pt.y - d.start.y) / d.bb.h });
      const pl = placement(d.bb, d.bg.w, d.bg.h, d.pan.view);
      d.pan.view.ox = pl.ox; d.pan.view.oy = pl.oy;
      if (this.app.syncPan) this.app.syncPan();
      return this.render(true);
    }
    const pg = this.pg, node = nodeAt(pg.layout, d.path);
    const bb = d.bb, horiz = node.dir === "h";
    const len = horiz ? bb.h : bb.w;
    const along = (p) => horiz ? (p.y - bb.y0) / bb.h : (p.x - bb.x0) / bb.w;
    const tOf = (E) => horiz ? (E[0] - bb.x0) / bb.w : (E[1] - bb.y0) / bb.h;
    let a = d.a, b = d.b;
    if (d.mode === "move") {
      const delta = (horiz ? pt.y - d.start.y : pt.x - d.start.x) / len;
      a = d.a + delta; b = d.b + delta;
    } else if (d.mode === "end0") {
      const t = Math.min(0.9, Math.max(0, tOf(d.seg[0])));
      a = (along(pt) - d.b * t) / (1 - t);
    } else {
      const t = Math.max(0.1, Math.min(1, tOf(d.seg[1])));
      b = (along(pt) - d.a * (1 - t)) / t;
    }
    if (e.shiftKey && d.mode !== "move") { if (d.mode === "end0") a = b; else b = a; }   // Maj : trait droit
    a = clamp(a, 0.04, 0.96); b = clamp(b, 0.04, 0.96);
    const keep = [node.a, node.b];
    node.a = a; node.b = b;
    const geo = compute(pg.page, pg.layout);
    const minA = pg.page.width * pg.page.height * 0.004;
    if (geo.panels.length !== this.geom.panels.length || geo.panels.some((p) => area(p.poly) < minA)) {
      node.a = keep[0]; node.b = keep[1];                  // une case deviendrait trop petite : on refuse
    }
    this.render();
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (d && d.kind === "mdraw") {                         // fin du trace : un simple clic pose une indication de taille standard
      const m = d.m, a = m.pts[0], b = m.pts[m.pts.length - 1];
      const tiny = Math.hypot((b[0] - a[0]) * d.bb.w, (b[1] - a[1]) * d.bb.h) < this.pg.page.width / 90;
      if (tiny) this.app.resetMark(m, a); else if (m.type === "free") m.pts = thin(m.pts);
      this.app.markTool = null;
      this.render(); this.app.commit("mark"); this.app.refreshInspector();
      return;
    }
    if (!d || !d.moved) return;
    this.render();
    if (d.kind === "lrot") this.app.refreshInspector();
    this.app.commit(d.kind);
    this.app.refreshInspector();
  }

  wheel(e) {
    const app = this.app, l = app.layer();
    const k = Math.exp(-e.deltaY * 0.0015);
    if (l && e.target.dataset && (e.target.dataset.layer === l.id || e.target.dataset.h)) {
      e.preventDefault();
      l.s = clamp(l.s * k, 0.03, 40);
      if (app.syncLayer) app.syncLayer();
      this.render(true);
      return app.commitSoon("lscale");
    }
    const g = this.panelAt(this.pagePt(e));
    if (!g || g.id !== app.sel.panel) return;
    const pan = this.panel(g.id);
    if (!pan.bg || (pan.show && pan.show !== "layers")) return;
    e.preventDefault();
    const v = Object.assign({ zoom: 1, ox: 0, oy: 0 }, pan.view);
    v.zoom = clamp(v.zoom * k, 1, 6);
    pan.view = v;
    this.render(true);
    if (app.syncPan) app.syncPan();
    app.commitSoon("pan");
  }

  context(e) {
    e.preventDefault();
    const t = e.target, app = this.app;
    if (t.dataset && t.dataset.mark) {
      app.select({ panel: t.dataset.panel, mark: t.dataset.mark });
      return app.markMenu(e);
    }
    if (t.dataset && t.dataset.layer) {
      app.select({ panel: t.dataset.panel, layer: t.dataset.layer });
      return app.layerMenu(e);
    }
    const g = this.panelAt(this.pagePt(e));
    if (!g) return;
    if (!(app.sel.panel === g.id && app.sel.layer && t.dataset && t.dataset.h)) app.select({ panel: g.id });
    if (app.sel.layer) return app.layerMenu(e);
    app.panelMenu(e, g.id, this.pagePt(e), g);
  }

  // ---------------------------------------------------------------- depot (banque ou fichier)
  dragover(e) {
    const types = [...(e.dataTransfer?.types || [])];
    if (!types.includes("Files") && !types.includes("application/x-bw-item")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const g = this.panelAt(this.pagePt(e));
    this.hoverDrop(g ? g.id : null);
  }
  hoverDrop(id) {
    if (this.dropTarget === id) return;
    this.dropTarget = id;
    this.render(true);
  }
  drop(e) {
    e.preventDefault();
    const pt = this.pagePt(e), g = this.panelAt(pt);
    this.hoverDrop(null);
    if (!g) return;
    const rel = { x: (pt.x - g.bbox.x0) / g.bbox.w, y: (pt.y - g.bbox.y0) / g.bbox.h };
    const raw = e.dataTransfer.getData("application/x-bw-item");
    if (raw) {
      const d = JSON.parse(raw);
      return this.app.dropItem(g.id, d.id, d.v || "base", rel);
    }
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) this.app.dropFile(g.id, f);
  }
}

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export { variantOf };
