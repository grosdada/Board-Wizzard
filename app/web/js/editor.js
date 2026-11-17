// Editeur de page : SVG (fonds, calques de la banque, traits) + calque HTML (numeros, bulles).
// Gestes : glisser un personnage = le faire tourner (orbite) ; poignee ✥ ou Alt+glisser = le deplacer ; coin = taille ;
// clic droit = pose, axe, ordre. Glisser un fond en orbite = tourner le decor (Maj : recadrer). Base : Alive-Comics.
import { compute, nodeAt, area } from "./geometry.js";
import { h } from "./api.js";
import { markShape, thin } from "./marks.js";
import { vecFrame, inkStroke, shadeOf } from "./model.js";
import { sprite, preload, placement, layerBox, depthOf, blurOf, background, clamp, variantOf, pad3 } from "./model.js";

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
      const empty = !pan.bg && !(pan.layers || []).length && !pan.integrated && !pan.orbit;
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
            gb.append(s("path", { d: bvf.ink, fill: "#111111", "fill-rule": "evenodd", stroke: st.color, "stroke-width": st.width, "stroke-linejoin": "round", "pointer-events": "none" }));
            grp.append(gb);
          } else
          grp.append(this.image("b:" + g.id, bg.url, { x: pl.x, y: pl.y, width: pl.w, height: pl.h, "data-bg": g.id,
                                                        preserveAspectRatio: "none", filter: this.blur(defs, blur) }));
        }
        (pan.layers || []).forEach((l, i) => {
          const item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
          if (!sp) return;
          const box = layerBox(bb, l, sp);
          const vf = vecFrame(sp, () => this.render(true));
          if (vf) {                                          // dessin en traces : net a tout zoom, trait reglable
            const sc = Math.min(box.w / vf.w, box.h / vf.h), tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc;
            const st = inkStroke(l.lw), tag = { "data-layer": l.id, "data-panel": g.id };
            const gv = s("g", Object.assign({ class: "layer vlayer", transform: (l.flip ? `translate(${2 * box.cx} 0) scale(-1 1) ` : "") + `translate(${tx} ${ty}) scale(${sc})`,
                                              filter: this.blur(defs, blurOf(pan, depthOf(pan, i), bb)) }, tag));
            const cid = "vc-" + g.id + "-" + l.id, clip = s("clipPath", { id: cid });
            clip.append(s("path", { d: vf.body }));
            defs.append(clip);
            gv.append(s("path", Object.assign({ d: vf.body, fill: "#ffffff" }, tag)));
            const gi = s("g", { "clip-path": `url(#${cid})` });
            const shd = shadeOf(l.sh, vf.h);
            if (shd) {                                       // ombre : aplat gris, puis la silhouette decalee en blanc par-dessus
              gi.append(s("path", Object.assign({ d: vf.body, fill: shd.fill }, tag)));
              gi.append(s("path", { d: vf.body, fill: "#ffffff", transform: `translate(${(l.flip ? -shd.dx : shd.dx).toFixed(2)} ${shd.dy.toFixed(2)})`, "pointer-events": "none" }));
            }
            gi.append(s("path", Object.assign({ d: vf.ink, fill: "#111111", "fill-rule": "evenodd", stroke: st.color, "stroke-width": st.width, "stroke-linejoin": "round" }, tag)));
            gv.append(gi);
            if (st.outline > 0) gv.append(s("path", { d: vf.body, fill: "none", stroke: "#111111", "stroke-width": st.outline, "pointer-events": "none" }));
            grp.append(gv);
            if (sel.panel === g.id && sel.layer === l.id) handles = { box, sp, g };
            return;
          }
          const im = this.image("l:" + g.id + ":" + l.id, sp.url, {
            x: box.x, y: box.y, width: box.w, height: box.h, preserveAspectRatio: "xMidYMax meet", "data-layer": l.id,
            "data-panel": g.id, transform: l.flip ? `translate(${2 * box.cx} 0) scale(-1 1)` : null,
            filter: this.blur(defs, blurOf(pan, depthOf(pan, i), bb)), class: "layer" });
          grp.append(im);
          if (sel.panel === g.id && sel.layer === l.id) handles = { box, sp, g };
        });
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
    for (const g of this.geom.panels) {
      svg.append(s("polygon", { points: pts(g.poly), fill: "none", stroke: page.stroke, "stroke-width": page.strokeWidth,
                                "stroke-linejoin": "miter", class: "panel-stroke" }));
    }
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
    if (handles) {                                         // cadre du calque choisi : ✥ deplace, coin = taille
      const { box } = handles, r = 13 * k, bb = handles.g.bbox;
      // poignees toujours atteignables : placees sur la partie du calque visible dans la case (gros plans compris)
      const vx0 = Math.max(box.x, bb.x0), vx1 = Math.min(box.x + box.w, bb.x1), vy0 = Math.max(box.y, bb.y0), vy1 = Math.min(box.y + box.h, bb.y1);
      const seen = vx1 > vx0 && vy1 > vy0;
      const mcx = seen ? (vx0 + vx1) / 2 : clamp(box.cx, bb.x0 + r, bb.x1 - r), mcy = seen ? (vy0 + vy1) / 2 : clamp(box.y + box.h / 2, bb.y0 + r, bb.y1 - r);
      const scx = seen ? Math.max(vx1 - r, mcx + r * 2.4) : mcx + r * 2.4, scy = seen ? Math.min(vy0 + r, mcy - r * 2.4) : mcy - r * 2.4;
      const gh = s("g", { class: "lh" });
      gh.append(s("rect", { x: box.x, y: box.y, width: box.w, height: box.h, class: "lh-box" }));
      gh.append(s("circle", { cx: box.cx, cy: box.y1, r: r * 0.5, class: "lh-foot" }));
      const mv = s("g", { class: "lh-grip", "data-h": "move", transform: `translate(${mcx} ${mcy})` });
      mv.append(s("circle", { r, "data-h": "move" }));
      mv.append(s("path", { d: `M ${-r * .6} 0 H ${r * .6} M 0 ${-r * .6} V ${r * .6}`, "data-h": "move" }));
      const sc = s("g", { class: "lh-grip", "data-h": "scale", transform: `translate(${scx} ${scy})` });
      sc.append(s("rect", { x: -r * .8, y: -r * .8, width: r * 1.6, height: r * 1.6, rx: r * .3, "data-h": "scale" }));
      gh.append(mv, sc);
      svg.append(gh);
    }
    if (mhandles) {                                        // poignees de l'indication choisie
      const gh = s("g", { class: "lh mh" });
      for (const [x, y, i] of mhandles.sh.handles) gh.append(s("circle", { cx: x, cy: y, r: 9 * k, class: "mh-pt", "data-mh": i }));
      svg.append(gh);
    }
    this.wrap.classList.toggle("drawing", !!app.markTool);
    for (const key of [...this.imgs.keys()]) if (!this.used.has(key)) this.imgs.delete(key);
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
        pan.show === "integrated" ? h("span.tag", "intégrée") : pan.show === "orbit" ? h("span.tag", "orbite") : null);
      this.overlay.append(chip);
      if (!pan.bg && !(pan.layers || []).length && !pan.integrated && !pan.orbit) {
        this.overlay.append(h("div.empty-hint", { style: { left: rect[0] + "%", top: rect[1] + "%", width: rect[2] + "%", height: rect[3] + "%" } },
          h("span", "Glisse ici un décor, un personnage ou une image")));
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
    if (t.dataset && t.dataset.h) {                        // poignee du calque choisi
      const g = this.geom.panels.find((x) => x.id === app.sel.panel), l = app.layer();
      if (g && l) this.drag = { kind: t.dataset.h === "scale" ? "lscale" : "lmove", l, bb: g.bbox, start: pt, x: l.x, y: l.y, s: l.s };
      e.preventDefault();
      return;
    }
    if (t.dataset && t.dataset.layer) {
      const pid = t.dataset.panel, g = this.geom.panels.find((x) => x.id === pid);
      const l = (this.panel(pid).layers || []).find((x) => x.id === t.dataset.layer);
      if (!l || !g) return;
      app.select({ panel: pid, layer: l.id });
      const item = app.bank.get(l.item), sp = item && sprite(item, l.v, l.f);
      if (item) preload(item, l.v);
      const turn = sp && sp.orbit && !e.altKey && !e.shiftKey;
      this.drag = { kind: turn ? "lturn" : "lmove", l, bb: g.bbox, start: pt, sx: e.clientX, x: l.x, y: l.y, s: l.s, f: l.f || 0,
                    n: sp ? sp.n : 1 };
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
        const pl = placement(g.bbox, bg.w, bg.h, pan.view);
        this.drag = { kind: "pan", pan, bg, bb: g.bbox, start: pt, ox: pl.ox, oy: pl.oy };
      }
    }
    e.preventDefault();
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const pt = this.pagePt(e);
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
    if (d.kind === "lmove") {
      d.l.x = clamp(d.x + (pt.x - d.start.x) / d.bb.w, -40, 40);     // sans limite pratique : gros plans, hors-champ
      d.l.y = clamp(d.y + (pt.y - d.start.y) / d.bb.h, -40, 40);
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
