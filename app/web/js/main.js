// Board Wizzard : storyboards par decalcomanie. Cases (decoupage d'Alive-Comics), banque de personnages / decors /
// assets en orbite, bulles, fausse profondeur de champ, « Integrate », orbite de case.
import { h, get, post, put, del, upload, toast, modal, debounce } from "./api.js";
import { compute, PRESETS, transpose, splitLeaf, removeLeaf, leaves, randomLayout, clone } from "./geometry.js";
import { Editor } from "./editor.js";
import { Bank, target } from "./bank.js";
import { flattenPanel } from "./flatten.js";
import { MARKS, MARK_COLORS, newMark } from "./marks.js";
import { swatch } from "./colors.js";
import { openDrawEditor } from "./draw.js";
import { openMontage } from "./montage.js";
import { openDeck, addClip } from "./deck.js";
import { sprite, variantOf, AXES, angleToFrame, frameToAngle, nearestAxis, depthOf, clamp, uid, background, placement } from "./model.js";

const FORMATS = [
  { id: "story", label: "Storyboard 16:10", w: 2400, h: 1500 },
  { id: "hd", label: "Écran 16:9", w: 2400, h: 1350 },
  { id: "a4", label: "A4 paysage", w: 2400, h: 1697 },
  { id: "a4p", label: "A4 portrait", w: 1697, h: 2400 },
  { id: "bd", label: "Page BD 2:3", w: 1600, h: 2400 },
  { id: "carre", label: "Carré", w: 2000, h: 2000 },
];
const PAGE0 = { format: "story", width: 2400, height: 1500, bg: "#ffffff", fill: "#ffffff", stroke: "#111111", strokeWidth: 5, gutter: 26, margin: 60 };
const LAYOUTS = [
  ...PRESETS.filter((p) => ["plein", "2x2", "3x3", "g3", "col2", "action"].includes(p.id)),
  { id: "2x3", label: "6 cases (2 rangées)", make: (L) => transpose(PRESETS.find((p) => p.id === "3x2").make(L)) },
  { id: "1x3", label: "3 colonnes", make: (L) => transpose(PRESETS.find((p) => p.id === "3b").make(L)) },
  { id: "1x2", label: "2 colonnes", make: (L) => transpose(PRESETS.find((p) => p.id === "2b").make(L)) },
  { id: "2x4", label: "8 cases", make: (L) => transpose(PRESETS.find((p) => p.id === "3x2").make(() => transpose(PRESETS.find((q) => q.id === "2b").make(L)))) },
  ...PRESETS.filter((p) => ["2b", "3b", "3x2"].includes(p.id)),
];
const BUB = { oval: ["Parole", "Bonjour !", true], thought: ["Pensée", "Hmm…", true], shout: ["Cri", "ATTENTION !", true],
              whisper: ["Chuchote", "chut…", true], box: ["Narration", "Le lendemain…", false] };

class App {
  constructor() {
    this.bank = new Map();
    this.sel = {};
    this.undo = []; this.redo = [];
    this.jobs = [];
    this.pageIndex = 0;
    try { this.pending = JSON.parse(localStorage.getItem("bw.pending") || "{}"); } catch (e) { this.pending = {}; }
  }

  async start() {
    this.info = await get("info");
    this.shell();
    this.bankUI = new Bank(this, this.el.bank);
    await this.bankUI.reload();
    const list = await get("projects");
    const last = localStorage.getItem("bw.project");
    if (list.find((p) => p.id === last)) await this.open(last);
    else if (list.length) await this.open(list[0].id);
    else await this.create("Storyboard 1");
    this.keys();
    this.poll();
    this.pollWorkers();
  }

  // ---------------------------------------------------------------- squelette
  shell() {
    const el = this.el = {};
    el.title = h("button.title", { title: "Changer de storyboard", on: { click: () => this.projectsDialog() } }, "…");
    el.pages = h("div.pages");
    el.workers = h("div.workers", { title: "Machines de rendu", on: { click: () => this.settingsDialog() } });
    el.jobsBtn = h("button", { on: { click: () => this.toggleJobs() } }, "Rendus");
    el.target = h("select", { title: "Où calculer", on: { change: (e) => localStorage.setItem("bw.target", e.target.value) } },
      [["auto", "Calcul : auto"], ["local", "Mes machines"], ["fal", "fal (cloud)"]].map(([v, l]) => h("option", { value: v, selected: v === target() }, l)));
    el.left = h("aside.left"); el.center = h("div.center"); el.bank = h("div.bank"); el.insp = h("div.insp");
    el.drawer = h("div.drawer.hidden");
    const top = h("header.top", h("div.logo", "BOARD", h("b", "WIZZARD")), el.title,
      h("button.icon", { title: "Annuler (Ctrl+Z)", on: { click: () => this.doUndo() } }, "↶"),
      h("button.icon", { title: "Rétablir (Ctrl+Y)", on: { click: () => this.doRedo() } }, "↷"),
      el.pages, h("div.grow"), el.workers, el.target, el.jobsBtn,
      h("button", { title: "Decks de montage : les cases animées mises bout à bout", on: { click: (e) => this.decksMenu(e) } }, "🎞 Decks ▾"),
      h("button", { title: "Imprimer ou enregistrer la page en PDF", on: { click: () => window.print() } }, "Imprimer"),
      h("button.icon", { title: "Réglages", on: { click: () => this.settingsDialog() } }, "⚙"));
    document.getElementById("app").append(top, h("div.work", el.left, el.center, h("aside.right", el.bank, el.insp)), el.drawer);
    this.editor = new Editor(el.center, this);
    el.center.append(h("div.hint", "Glisser un personnage : le faire tourner · ✥ ou Alt+glisser : déplacer · coin : taille · clic droit : pose, axe, ordre"));
  }

  // ---------------------------------------------------------------- storyboard
  page() { return this.project && this.project.pages[this.pageIndex]; }
  newId(prefix = "p") { return prefix + (this.project.nextId++); }
  layer() { const p = this.page()?.panels[this.sel.panel]; return p && (p.layers || []).find((l) => l.id === this.sel.layer); }
  curPanel() { const pg = this.page(); return this.sel.panel ? (pg.panels[this.sel.panel] || (pg.panels[this.sel.panel] = {})) : null; }
  geo(id) { return this.editor.geom.panels.find((g) => g.id === id); }

  async create(name) {
    let n = 1;
    const layout = LAYOUTS.find((l) => l.id === "2x3").make(() => ({ t: "leaf", id: "p" + (n++) }));
    const p = await post("projects", { name, page: PAGE0, layout });
    await this.open(p.id);
  }

  async open(id) {
    this.project = await get("projects/" + id);
    localStorage.setItem("bw.project", id);
    this.pageIndex = 0; this.sel = {}; this.undo = []; this.redo = [];
    this.last = this.snapshot();
    this.refresh();
  }

  refresh() {
    this.el.title.textContent = this.project.name + " ▾";
    this.renderPages(); this.renderLeft(); this.editor.render(); this.refreshInspector();
  }

  renderPages() {
    const P = this.project;
    this.el.pages.textContent = "";
    this.el.pages.append(h("span.muted", "Page"), ...P.pages.map((pg, i) => h("button.pg" + (i === this.pageIndex ? ".on" : ""),
      { on: { click: () => { this.pageIndex = i; this.sel = {}; this.refresh(); } } }, String(i + 1))),
      h("button.pg", { title: "Ajouter une page (même découpage)", on: { click: () => this.addPage() } }, "+"),
      ...(P.pages.length > 1 ? [h("button.pg", { title: "Supprimer cette page", on: { click: () => this.removePage() } }, "−")] : []));
  }

  addPage() {
    const cur = this.page(), P = this.project;
    const layout = clone(cur.layout);
    (function renum(n, app) { if (n.t === "leaf") n.id = app.newId(); else n.c.forEach((c) => renum(c, app)); })(layout, this);
    P.pages.splice(this.pageIndex + 1, 0, { id: "pg" + P.nextId++, page: clone(cur.page), layout, panels: {} });
    this.pageIndex++; this.sel = {};
    this.commit("page"); this.refresh();
  }
  removePage() {
    if (!confirm("Supprimer cette page et ses cases ?")) return;
    this.project.pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.max(0, this.pageIndex - 1); this.sel = {};
    this.commit("page"); this.refresh();
  }

  async projectsDialog() {
    const list = await get("projects");
    const name = h("input", { type: "text", placeholder: "Nom du nouveau storyboard" });
    const rename = h("input", { type: "text", value: this.project.name });
    const m = modal("Storyboards", h("div.form",
      h("label.row", "Nom de celui-ci", rename),
      h("div.plist", list.map((p) => h("div.prow" + (p.id === this.project.id ? ".on" : ""),
        h("button.link", { on: { click: async () => { m.close(); await this.open(p.id); } } }, p.name),
        h("span.muted", `${p.pages} page(s) · ${new Date(p.updated * 1000).toLocaleDateString("fr-FR")}`),
        p.id !== this.project.id ? h("button.mini.danger", { on: { click: async (e) => {
          if (!confirm(`Supprimer « ${p.name} » ? (corbeille du dossier de données)`)) return;
          await del("projects/" + p.id); e.target.closest(".prow").remove(); } } }, "Supprimer") : null))),
      h("div.row", name, h("button.primary", { on: { click: async () => { m.close(); await this.create(name.value.trim() || "Storyboard"); } } }, "Créer"))),
      [{ label: "Fermer", click: () => { if (rename.value.trim() && rename.value !== this.project.name) { this.project.name = rename.value.trim(); this.commit("name"); this.refresh(); } } }]);
  }

  // ---------------------------------------------------------------- annuler / enregistrer
  snapshot() { const P = this.project; return JSON.stringify({ pages: P.pages, nextId: P.nextId, name: P.name, decks: P.decks || [], deckCur: P.deckCur || null }); }
  commit(kind) {
    const now = Date.now(), snap = this.snapshot();
    if (snap === this.last) return;
    if (!(kind && kind === this.lastKind && now - this.lastAt < 1200)) {       // meme geste repete : une seule etape
      this.undo.push(this.last); if (this.undo.length > 80) this.undo.shift();
    }
    this.redo = []; this.last = snap; this.lastKind = kind; this.lastAt = now;
    this.save();
  }
  commitSoon(kind) { (this._soon = this._soon || debounce((k) => this.commit(k), 350))(kind); }
  restore(snap) {
    Object.assign(this.project, JSON.parse(snap));
    this.pageIndex = Math.min(this.pageIndex, this.project.pages.length - 1);
    this.last = snap; this.lastKind = null; this.sel = {};
    this.refresh(); this.save();
  }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.last); this.restore(this.undo.pop()); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.last); this.restore(this.redo.pop()); }
  save() {
    (this._save = this._save || debounce(async () => {
      try { const r = await put("projects/" + this.project.id, this.project); this.project.rev = r.rev; this.absorb(r); }
      catch (e) { toast("Enregistrement impossible : " + e.message, "error"); }
    }, 400))();
  }
  absorb(srv) {                      // ce que les taches ont ecrit cote serveur : image integree, orbite de case
    let changed = false;
    for (const spg of srv.pages) for (const [pid, sp] of Object.entries(spg.panels || {})) {
      const mine = this.project.pages.flatMap((pg) => pg.panels[pid] ? [pg.panels[pid]] : [])[0];
      if (!mine) continue;
      if ((sp.integrations || []).length !== (mine.integrations || []).length) {
        mine.integrations = sp.integrations; mine.integrated = sp.integrated; mine.show = sp.show; changed = true;
      }
      if (sp.orbit && (!mine.orbit || mine.orbit.dir !== sp.orbit.dir)) { mine.orbit = sp.orbit; mine.show = sp.show; changed = true; }
    }
    this.project.rev = srv.rev;
    if (changed) { this.last = this.snapshot(); this.editor.render(); this.refreshInspector(); }
  }

  // ---------------------------------------------------------------- selection
  select(sel, keepOverlay) {
    const same = sel.panel === this.sel.panel && sel.layer === this.sel.layer && sel.bubble === this.sel.bubble && sel.mark === this.sel.mark;
    this.sel = sel;
    if (same) return;
    this.editor.render(keepOverlay);
    this.refreshInspector();
  }

  // ---------------------------------------------------------------- colonne de gauche : decoupage
  renderLeft() {
    const pg = this.page(), page = pg.page, left = this.el.left;
    const num = (label, key, min, max, step = 1) => h("label.row", label, h("input", { type: "number", min, max, step, value: page[key],
      on: { input: (e) => { page[key] = clamp(+e.target.value || 0, min, max); this.editor.render(); this.commitSoon("page-" + key); } } }));
    const col = (label, key) => h("div.row.colrow", h("span", label), swatch(page[key], (c) => { page[key] = c; this.editor.render(); this.commitSoon("page-" + key); }));
    left.textContent = "";
    left.append(h("h3", "Découpage"),
      h("div.presets", LAYOUTS.map((p) => h("button.preset", { title: p.label, on: { click: () => this.applyLayout(p.make) } }, presetThumb(p, page)))),
      h("div.row", h("button.mini", { title: "Découpage au hasard", on: { click: () => this.randomLayout() } }, "🎲 Hasard"),
        h("button.mini", { title: "Les bandes deviennent des colonnes", on: { click: () => { pg.layout = transpose(pg.layout); this.commit("layout"); this.refresh(); } } }, "⟲ Pivoter")),
      h("div.row", h("button.mini", { on: { click: () => this.split("h") } }, "Couper ━"), h("button.mini", { on: { click: () => this.split("v") } }, "Couper ┃"),
        h("button.mini.danger", { on: { click: () => this.removePanel() } }, "Supprimer la case")),
      h("p.muted", "Glisse un trait pour le déplacer, un de ses bouts pour l'incliner (Maj : trait droit)."),
      h("h3", "Page"),
      h("label.row", "Format", h("select", { on: { change: (e) => { const f = FORMATS.find((x) => x.id === e.target.value);
        Object.assign(page, { format: f.id, width: f.w, height: f.h }); this.commit("format"); this.refresh(); } } },
        FORMATS.map((f) => h("option", { value: f.id, selected: f.id === page.format }, f.label)))),
      num("Gouttière", "gutter", 0, 200), num("Marge", "margin", 0, 400), num("Trait", "strokeWidth", 0, 40),
      col("Fond de page", "bg"), col("Fond des cases", "fill"), col("Couleur du trait", "stroke"),
      h("h3", "Toute la page"),
      h("div.row", h("button.mini", { title: "Chaque case composée devient un dessin homogène", on: { click: () => this.integratePage("dessin") } }, "✦ Tout en dessin"),
        h("button.mini", { title: "Chaque case composée devient une photo unifiée", on: { click: () => this.integratePage("photo") } }, "✦ Tout en photo")),
      h("div.row", h("button.mini", { on: { click: () => this.showAll("layers") } }, "Voir les calques"),
        h("button.mini", { on: { click: () => this.showAll("integrated") } }, "Voir les intégrées")));
  }

  applyLayout(make) {
    const pg = this.page();
    const old = compute(pg.page, pg.layout).panels.sort((a, b) => a.order - b.order).map((g) => g.id);
    let i = 0; const used = [];
    pg.layout = make(() => { const id = i < old.length ? old[i] : this.newId(); i++; used.push(id); return { t: "leaf", id }; });
    for (const id of Object.keys(pg.panels)) if (!used.includes(id)) delete pg.panels[id];
    this.sel = {}; this.commit("layout"); this.refresh();
  }
  randomLayout() {
    const n = Math.max(2, Math.min(9, leaves(this.page().layout).length));
    this.applyLayout((L) => transposeIf(this.page().page, randomLayout(Math.floor(Math.random() * 1e9), n, 0.06, () => L().id)));
  }
  split(dir) {
    const pg = this.page();
    if (!this.sel.panel) return toast("Choisis d'abord une case.");
    pg.layout = splitLeaf(pg.layout, this.sel.panel, dir, this.newId(), "c" + this.project.nextId++);
    this.commit("layout"); this.refresh();
  }
  removePanel() {
    const pg = this.page(), id = this.sel.panel;
    if (!id) return toast("Choisis d'abord une case.");
    if (leaves(pg.layout).length < 2) return toast("C'est la dernière case de la page.");
    pg.layout = removeLeaf(pg.layout, id); delete pg.panels[id];
    this.sel = {}; this.commit("layout"); this.refresh();
  }

  // ---------------------------------------------------------------- depot dans une case
  dropItem(pid, itemId, vid, rel) {
    const item = this.bank.get(itemId), pan = this.findPanel(pid);
    if (!item || !pan) return;
    if (item.kind === "decor") {
      pan.bg = { item: itemId, v: vid, f: 0 }; pan.view = { zoom: 1, ox: 0, oy: 0 }; pan.show = "layers";
      this.select({ panel: pid });
    } else {
      const s = item.kind === "character" ? 0.8 : 0.35;
      const l = { id: uid(), item: itemId, v: vid, f: 0, x: clamp(rel.x, 0, 1), y: clamp(rel.y + s / 2, 0.1, 1.4), s };
      (pan.layers = pan.layers || []).push(l); pan.show = "layers";
      this.sel = {}; this.select({ panel: pid, layer: l.id });
    }
    this.commit("drop"); this.editor.render(); this.refreshInspector();
  }
  async dropFile(pid, file) {
    try {
      const r = await upload(`projects/${this.project.id}/upload?name=${encodeURIComponent(file.name)}`, file);
      const pan = this.page().panels[pid] || (this.page().panels[pid] = {});
      pan.bg = { file: r.file, w: r.w, h: r.h }; pan.view = { zoom: 1, ox: 0, oy: 0 }; pan.show = "layers";
      this.commit("drop"); this.select({ panel: pid }); this.editor.render(); this.refreshInspector();
    } catch (e) { toast("Image refusée : " + e.message, "error"); }
  }

  // generation depuis une case : « genere-moi un marteau » ; l'element entre en banque et se pose ici des qu'il existe
  generateHere(pid, rel) {
    const prompt = h("textarea", { rows: 3, placeholder: "Un marteau de charpentier usé, manche en bois…" });
    const kind = h("select", [["asset", "Objet / véhicule"], ["character", "Personnage"], ["decor", "Décor (devient le fond)"]].map(([v, t]) => h("option", { value: v }, t)));
    const style = h("select", [["photo", "Photoréaliste"], ["dessin", "Dessin"], ["3d", "3D"]].map(([v, t]) => h("option", { value: v, selected: v === this.guessStyle(this.findPanel(pid) || {}) }, t)));
    const orbit = h("input", { type: "checkbox", checked: true });
    modal("Générer dans cette case", h("div.form", h("label.col", "Quoi ?", prompt), h("label.row", "Type", kind), h("label.row", "Rendu", style),
      h("label.row.check", orbit, "Avec son orbite 360° (pivotable ensuite)"),
      h("p.muted", "L'élément est ajouté à la banque : il resservira. Il se pose dans la case dès que son image existe (≈ 1 min), puis devient pivotable.")),
      [{ label: "Annuler" }, { label: "Générer", primary: true, click: async () => {
        const text = prompt.value.trim();
        if (!text) { toast("Décris ce qu'il faut générer.", "error"); return false; }
        const f = this.bankUI.folder;
        const r = await post("bank/generate", { kind: kind.value, name: text.slice(0, 36), prompt: text, style: style.value, orbit: orbit.checked,
                                                folder: f && f !== "·" ? f : "", target: target() });
        this.pending[r.job] = { project: this.project.id, pid, rel };
        localStorage.setItem("bw.pending", JSON.stringify(this.pending));
        toast("Génération lancée : l'élément se posera dans la case."); this.pollSoon();
      } }]);
    setTimeout(() => prompt.focus(), 30);
  }
  findPanel(pid) { for (const pg of this.project.pages) if (pg.panels[pid] || leaves(pg.layout).includes(pid)) return pg.panels[pid] || (pg.panels[pid] = {}); return null; }
  settlePending() {
    let changed = false;
    for (const [jid, d] of Object.entries(this.pending)) {
      const j = this.jobs.find((x) => x.id === jid);
      if (j && (j.status === "queued" || j.status === "running")) continue;
      delete this.pending[jid]; changed = true;
      const item = j && j.result && this.bank.get(j.result.item);
      if (!item || d.project !== this.project.id || !this.findPanel(d.pid)) continue;
      this.dropItem(d.pid, item.id, "base", d.rel);
    }
    if (changed) localStorage.setItem("bw.pending", JSON.stringify(this.pending));
  }

  // ---------------------------------------------------------------- calques
  setPose(l, vid) {                    // change de pose en gardant le meme axe
    const item = this.bank.get(l.item), a = variantOf(item, l.v), b = variantOf(item, vid);
    const ang = a && a.orbit ? frameToAngle(a.orbit, l.f || 0) : 0;
    l.v = vid; l.f = b && b.orbit ? angleToFrame(b.orbit, ang) : 0;
    this.commit("pose"); this.editor.render(); this.refreshInspector();
  }
  setAxis(l, axis) {
    const v = variantOf(this.bank.get(l.item), l.v);
    if (!v || !v.orbit) return;
    l.f = v.orbit.snaps?.[axis] ?? angleToFrame(v.orbit, AXES.indexOf(axis) * 45);
    this.commit("axis"); this.editor.render(); this.refreshInspector();
  }
  order(l, where) {
    const ls = this.curPanel().layers, i = ls.indexOf(l);
    ls.splice(i, 1);
    ls.splice(where === "top" ? ls.length : where === "bottom" ? 0 : clamp(i + (where === "up" ? 1 : -1), 0, ls.length), 0, l);
    delete l.d;
    this.commit("order"); this.editor.render(); this.refreshInspector();
  }
  removeLayer(l) {
    const ls = this.curPanel().layers; ls.splice(ls.indexOf(l), 1);
    this.sel = { panel: this.sel.panel }; this.commit("del"); this.editor.render(); this.refreshInspector();
  }
  duplicate(l) {
    const c = Object.assign(clone(l), { id: uid(), x: l.x + 0.08 });
    this.curPanel().layers.push(c); this.sel = { panel: this.sel.panel, layer: c.id };
    this.commit("dup"); this.editor.render(); this.refreshInspector();
  }

  // copie l'element choisi (meme pose, meme axe, meme place, meme taille) dans d'autres cases de la page
  copyLayerTo(l) {
    const pg = this.page(), pid = this.sel.panel, item = this.bank.get(l.item);
    const others = this.editor.geom.panels.filter((g) => g.id !== pid).sort((x, y) => x.order - y.order);
    if (!others.length) return toast("Il n'y a pas d'autre case sur cette page.");
    const boxes = others.map((g) => [g, h("input", { type: "checkbox" })]);
    const all = h("button.mini", { on: { click: (e) => { e.preventDefault(); const on = boxes.some(([, c]) => !c.checked); boxes.forEach(([, c]) => { c.checked = on; }); } } }, "Toutes / aucune");
    modal(`Copier « ${item ? item.name : "l'élément"} » vers…`, h("div.form",
      h("p.muted", "L'élément est ajouté dans les cases cochées avec la même pose, le même axe, la même place et la même taille. Le reste de ces cases n'est pas touché."),
      h("div.checks", boxes.map(([g, c]) => h("label.row.check", c, `Case ${g.order}`))), h("div.row", all)),
      [{ label: "Annuler" }, { label: "Copier", primary: true, click: () => {
        const to = boxes.filter(([, c]) => c.checked).map(([g]) => g);
        if (!to.length) { toast("Coche au moins une case.", "error"); return false; }
        for (const g of to) { const pan = pg.panels[g.id] || (pg.panels[g.id] = {}); (pan.layers = pan.layers || []).push(Object.assign(clone(l), { id: uid() })); pan.show = "layers"; }
        this.commit("copy-layer"); this.editor.render(); this.refreshInspector();
        toast(`Élément copié vers ${to.map((g) => g.order).join(", ")}.`);
      } }]);
  }

  layerMenu(e) {
    const l = this.layer(); if (!l) return;
    const item = this.bank.get(l.item), v = variantOf(item, l.v), items = [];
    items.push({ head: "Pose" });
    // ↻ : orbite calculee, la pose tourne · ⏳ : orbite en calcul · ▫ : image fixe, pas d'orbite
    for (const [k, vv] of Object.entries(item?.variants || {})) items.push({ label: (vv.orbit ? "↻ " : this.jobsFor(l.item, k) ? "⏳ " : "▫ ") + vv.label, checked: k === l.v, click: () => this.setPose(l, k) });
    items.push({ note: "↻ orbite prête · ⏳ en calcul · ▫ image fixe" });
    items.push({ label: "Générer d'autres poses…", click: () => this.bankUI.openItem(l.item) });
    if (v && v.orbit) {
      const cur = nearestAxis(v.orbit, l.f || 0);
      items.push({ head: "Axe" });
      for (const a of AXES) items.push({ label: a, checked: a === cur, click: () => this.setAxis(l, a), half: true });
    }
    items.push({ head: "Calque" },
      { label: "Miroir", checked: !!l.flip, click: () => { l.flip = !l.flip; this.commit("flip"); this.editor.render(); } },
      { label: "Premier plan", click: () => this.order(l, "top"), half: true }, { label: "Arrière-plan", click: () => this.order(l, "bottom"), half: true },
      { label: "Avancer", click: () => this.order(l, "up"), half: true }, { label: "Reculer", click: () => this.order(l, "down"), half: true },
      { label: "Dupliquer", click: () => this.duplicate(l), half: true }, { label: "Supprimer", click: () => this.removeLayer(l), half: true, danger: true },
      { label: "Copier vers une case…", click: () => this.copyLayerTo(l) });
    menu(e, items);
  }

  panelMenu(e, pid, pt, g) {
    const pan = this.curPanel(), items = [{ head: "Bulle" }];
    const rel = { x: (pt.x - g.bbox.x0) / g.bbox.w, y: (pt.y - g.bbox.y0) / g.bbox.h };
    for (const [t, [label]] of Object.entries(BUB)) items.push({ label, click: () => this.addBubble(t, rel), half: true });
    items.push({ head: "Fond" }, { label: "✎ Dessiner le fond…", click: () => this.drawBackground(pid) });
    items.push({ head: "Indication" });
    for (const [t, [label, ico]] of Object.entries(MARKS)) items.push({ label: `${ico} ${label}`, half: true, click: () => (t === "free" ? this.armMark(t) : this.addMark(pid, t, [rel.x, rel.y])) });
    items.push({ head: "Banque" }, { label: "✨ Générer un élément ici…", click: () => this.generateHere(pid, rel) });
    items.push({ head: "Case" }, { label: "Integrate (image unifiée)", click: () => this.integrate() },
      { label: "Orbite de la case", click: () => this.panelOrbit() },
      { label: "🎬 Montage (animer la case)…", click: () => openMontage(this, pid) });
    if (pan.integrated || pan.orbit) {
      items.push({ head: "Afficher" }, { label: "Calques", checked: (pan.show || "layers") === "layers", click: () => this.setShow("layers") });
      if (pan.integrated) items.push({ label: "Image intégrée", checked: pan.show === "integrated", click: () => this.setShow("integrated") });
      if (pan.orbit) items.push({ label: "Orbite", checked: pan.show === "orbit", click: () => this.setShow("orbit") });
    }
    if (this.editor.geom.panels.length > 1) items.push({ label: "Copier cette case vers…", click: () => this.copyPanelTo(pid) });
    items.push({ head: "Découpage" }, { label: "Couper ━", click: () => this.split("h"), half: true }, { label: "Couper ┃", click: () => this.split("v"), half: true });
    if (pan.bg) items.push({ label: "Retirer le fond", click: () => { delete pan.bg; this.commit("bg"); this.editor.render(); this.refreshInspector(); } });
    items.push({ label: "Vider la case", danger: true, click: () => { this.page().panels[pid] = {}; this.commit("clear"); this.editor.render(); this.refreshInspector(); } });
    menu(e, items);
  }
  // copie tout le contenu d'une case (fond, cadrage, calques, bulles, profondeur de champ) dans d'autres cases de la page
  copyPanelTo(pid) {
    const pg = this.page(), src = pg.panels[pid] || {}, from = this.geo(pid);
    const others = this.editor.geom.panels.filter((g) => g.id !== pid).sort((x, y) => x.order - y.order);
    const filled = (g) => { const q = pg.panels[g.id] || {}; return !!(q.bg || (q.layers || []).length || (q.bubbles || []).length); };
    const boxes = others.map((g) => [g, h("input", { type: "checkbox" })]);
    const all = h("button.mini", { on: { click: (e) => { e.preventDefault(); const on = boxes.some(([, c]) => !c.checked); boxes.forEach(([, c]) => { c.checked = on; }); } } }, "Toutes / aucune");
    modal(`Copier la case ${from ? from.order : ""} vers…`, h("div.form",
      h("p.muted", "Tout est copié : fond et cadrage, personnages et objets, bulles, profondeur de champ. Le contenu des cases cochées est remplacé."),
      h("div.checks", boxes.map(([g, c]) => h("label.row.check", c, `Case ${g.order}`, filled(g) ? h("span.muted", " (déjà remplie)") : ""))), h("div.row", all)),
      [{ label: "Annuler" }, { label: "Copier", primary: true, click: () => {
        const to = boxes.filter(([, c]) => c.checked).map(([g]) => g);
        if (!to.length) { toast("Coche au moins une case.", "error"); return false; }
        for (const g of to) {
          const copy = JSON.parse(JSON.stringify(src));
          for (const k of ["integrated", "integrations", "orbit"]) delete copy[k];   // images calculées pour la case d'origine
          copy.show = "layers";
          for (const l of copy.layers || []) l.id = uid();
          for (const b of copy.bubbles || []) b.id = uid();
          for (const m of copy.marks || []) m.id = uid();
          pg.panels[g.id] = copy;
        }
        this.commit("copy"); this.editor.render(); this.refreshInspector();
        toast(`Case copiée vers ${to.map((g) => g.order).join(", ")}.`);
      } }]);
  }
  // atelier de dessin du fond de la case : formes simples, traces, gris en trame
  drawBackground(pid) {
    const pg = this.page(), pan = pg.panels[pid] || (pg.panels[pid] = {}), g = this.geo(pid);
    if (!g) return;
    const bg = background(pan, this.bank, this.project.id);
    const ghosts = (pan.layers || []).map((l) => { const it = this.bank.get(l.item), sp = it && sprite(it, l.v, l.f); return sp && { url: sp.url, x: l.x, y: l.y, s: l.s, ar: sp.w / sp.h, flip: l.flip }; }).filter(Boolean);
    openDrawEditor({ draw: pan.draw, ratio: g.bbox.h / g.bbox.w, backdrop: bg ? bg.url : null, ghosts, title: `Dessiner le fond de la case ${g.order}`,
      onSave: (d) => { if (d.shapes.length) pan.draw = d; else delete pan.draw; pan.show = "layers"; this.commit("draw"); this.editor.render(); this.refreshInspector(); } });
  }
  // decks de montage : plusieurs par storyboard, enregistres avec lui
  decks() {
    const P = this.project;
    if (!P.decks) { P.decks = []; if (P.deck && (P.deck.clips || []).length) P.decks.push({ id: uid(), name: "Deck 1", clips: P.deck.clips }); delete P.deck; }
    return P.decks;
  }
  newDeck(name, clips) { const d = { id: uid(), name: name || `Deck ${this.decks().length + 1}`, clips: clips || [] }; this.decks().push(d); this.project.deckCur = d.id; this.commit("deck"); this.refreshTop(); return d; }
  /** Le deck demande, sinon le deck en cours, sinon le premier, sinon un deck neuf. */
  deckOf(id) { const ds = this.decks(); return ds.find((d) => d.id === id) || ds.find((d) => d.id === this.project.deckCur) || ds[0] || this.newDeck("Deck 1"); }
  refreshTop() { this.refreshInspector(); }
  decksMenu(e) {
    const ds = this.decks(), items = [{ head: ds.length ? "Decks enregistrés" : "Aucun deck pour l'instant" }];
    for (const d of ds) items.push({ label: `🎞 ${d.name} · ${d.clips.length} plan${d.clips.length > 1 ? "s" : ""}`, checked: d.id === this.project.deckCur, click: () => openDeck(this, d.id) });
    items.push({ label: "＋ Nouveau deck…", click: () => { const n = (prompt("Nom du nouveau deck :", `Deck ${ds.length + 1}`) || "").trim(); if (n) openDeck(this, this.newDeck(n).id); } });
    menu(e, items);
  }
  // deck de montage global : une case animee y devient un plan
  sendToDeck(pid) { addClip(this, pid); this.refreshInspector(); }
  openPanelMontage(pageIndex, pid) {
    if (pageIndex !== this.pageIndex) { this.pageIndex = pageIndex; this.sel = {}; this.refresh(); }
    this.select({ panel: pid });
    openMontage(this, pid);
  }
  showAll(mode) {
    for (const pan of Object.values(this.page().panels)) { if (mode === "layers" || pan.integrated) pan.show = mode; }
    this.commit("show"); this.editor.render(); this.refreshInspector();
  }
  setShow(mode) { this.curPanel().show = mode; this.commit("show"); this.editor.render(); this.refreshInspector(); }

  // ---------------------------------------------------------------- bulles
  addBubble(type, rel) {
    const pan = this.curPanel(); if (!pan) return toast("Choisis d'abord une case.");
    const [, text, tail] = BUB[type];
    const b = { id: uid(), type, text, size: "M", color: "white", font: "bd", show: "always", x: clamp(rel?.x ?? 0.5, 0.1, 0.9), y: clamp(rel?.y ?? 0.2, 0.08, 0.9) };
    if (tail) { b.tx = clamp(b.x + 0.06, 0, 1); b.ty = clamp(b.y + 0.2, 0, 1.1); }
    (pan.bubbles = pan.bubbles || []).push(b);
    this.sel = { panel: this.sel.panel, bubble: b.id };
    this.commit("bubble-add"); this.editor.render(); this.refreshInspector();
    setTimeout(() => this.el.insp.querySelector("textarea")?.select(), 30);
  }
  bubble() { return (this.curPanel()?.bubbles || []).find((b) => b.id === this.sel.bubble); }
  // ---------------------------------------------------------------- indications (fleches, rotation, cadres)
  mark() { return (this.curPanel()?.marks || []).find((m) => m.id === this.sel.mark); }
  addMark(pid, type, at, quiet) {
    const pg = this.page(), pan = pg.panels[pid] || (pg.panels[pid] = {});
    const m = newMark(type, uid(), at);
    (pan.marks = pan.marks || []).push(m);
    this.sel = { panel: pid, mark: m.id };
    if (!quiet) { this.commit("mark"); this.editor.render(); this.refreshInspector(); }
    return m;
  }
  resetMark(m, at) { m.pts = newMark(m.type, m.id, [at[0] + (m.type === "frame" || m.type === "turn" ? 0 : 0.15), at[1]]).pts; }
  armMark(type) {                                       // l'indication se trace au prochain glisser dans une case
    this.markTool = type; this.editor.render(true);
    toast(type === "free" ? "Dessine la flèche dans la case : la pointe se met au bout du trait." : "Glisse dans une case pour tracer (un simple clic pose une taille standard).");
  }
  removeMark() {
    const pan = this.curPanel(), m = this.mark();
    if (!pan || !m) return;
    pan.marks = pan.marks.filter((x) => x !== m);
    this.sel = { panel: this.sel.panel };
    this.commit("mark"); this.editor.render(); this.refreshInspector();
  }
  duplicateMark() {
    const pan = this.curPanel(), m = this.mark();
    if (!m) return;
    const c = JSON.parse(JSON.stringify(m)); c.id = uid(); c.pts = c.pts.map((p) => [p[0] + 0.04, p[1] + 0.04]);
    pan.marks.push(c); this.sel = { panel: this.sel.panel, mark: c.id };
    this.commit("mark"); this.editor.render(); this.refreshInspector();
  }
  markMenu(e) {
    const m = this.mark();
    if (!m) return;
    const set = (k, v) => () => { m[k] = v; this.commit("mark"); this.editor.render(); this.refreshInspector(); };
    const items = [{ head: MARKS[m.type][0] }];
    for (const [c, name] of Object.entries(MARK_COLORS)) items.push({ label: name, half: true, checked: (m.color || "#111111") === c, click: set("color", c) });
    if (m.type === "turn") items.push({ label: "Inverser le sens", click: set("cw", m.cw === false) });
    else if (m.type !== "frame") items.push({ label: "Pointe aux deux bouts", checked: !!m.both, click: set("both", !m.both) });
    items.push({ label: "Pointillés", checked: m.type === "frame" ? m.dash !== false : !!m.dash, click: set("dash", m.type === "frame" ? m.dash === false : !m.dash) },
      { label: "Dupliquer", click: () => this.duplicateMark() }, { label: "Supprimer", danger: true, click: () => this.removeMark() });
    menu(e, items);
  }
  removeBubble() {
    const list = this.curPanel().bubbles, b = this.bubble(); if (!b) return;
    list.splice(list.indexOf(b), 1); this.sel = { panel: this.sel.panel };
    this.commit("bubble-del"); this.editor.render(); this.refreshInspector();
  }
  bubbleMenu(e, pid, id) {
    this.select({ panel: pid, bubble: id });
    const b = this.bubble(), items = [{ head: "Forme" }];
    for (const [t, [label]] of Object.entries(BUB)) items.push({ label, checked: b.type === t, half: true, click: () => { b.type = t; this.commit("bub"); this.editor.render(); this.refreshInspector(); } });
    items.push({ head: "Bulle" }, { label: b.tx != null ? "Sans queue" : "Avec queue", click: () => {
      if (b.tx != null) { delete b.tx; delete b.ty; delete b.bx; delete b.by; } else { b.tx = b.x + 0.06; b.ty = b.y + 0.2; }
      this.commit("bub"); this.editor.render(); } }, { label: "Supprimer", danger: true, click: () => this.removeBubble() });
    menu(e, items);
  }

  // ---------------------------------------------------------------- Integrate et orbite de case
  async flat(pid) {
    const g = this.geo(pid || this.sel.panel);
    const blob = await flattenPanel(this, g);
    return (await upload(`projects/${this.project.id}/flat/${g.id}`, blob)).file;
  }
  async integrate(style, extra) {
    const pan = this.curPanel(); if (!pan) return toast("Choisis d'abord une case.");
    if (!pan.bg && !(pan.layers || []).length) return toast("La case est vide.");
    try {
      const flat = await this.flat();
      await post(`projects/${this.project.id}/integrate`, { panel: this.sel.panel, flat, style: style || pan.style || this.guessStyle(pan), extra: extra || "", target: target() });
      toast("Integrate lancé : l'image unifiée remplacera les calques (ils restent disponibles)."); this.pollSoon();
    } catch (e) { toast("Integrate impossible : " + e.message, "error"); }
  }
  // toute la page d'un coup : chaque case composee part a Integrate (les cases deja integrees sont refaites)
  async integratePage(style) {
    const pg = this.page(), todo = this.editor.geom.panels.filter((g) => { const p = pg.panels[g.id] || {}; return p.bg || (p.layers || []).length; });
    if (!todo.length) return toast("Aucune case composée sur cette page.");
    if (!confirm(`Lancer Integrate (${style === "dessin" ? "dessin" : "photoréaliste"}) sur ${todo.length} case(s) ?`)) return;
    let n = 0;
    for (const g of todo) {
      try {
        const flat = await this.flat(g.id);
        await post(`projects/${this.project.id}/integrate`, { panel: g.id, flat, style, target: target() }); n++;
      } catch (e) { toast(`Case ${g.order} : ${e.message}`, "error"); }
    }
    toast(`${n} Integrate lancé(s).`); this.pollSoon();
  }
  async panelOrbit() {
    const pan = this.curPanel(); if (!pan) return toast("Choisis d'abord une case.");
    try {
      let flat;
      if (pan.show === "integrated" && pan.integrated) flat = pan.integrated;        // l'image integree tourne mieux qu'un collage
      else flat = await this.flat();
      await post(`projects/${this.project.id}/orbit`, { panel: this.sel.panel, flat, target: target() });
      toast("Orbite de la case lancée (≈ 3 min)."); this.pollSoon();
    } catch (e) { toast("Orbite impossible : " + e.message, "error"); }
  }
  guessStyle(pan) {
    const it = (pan.layers || []).map((l) => this.bank.get(l.item)).find(Boolean) || this.bank.get(pan.bg?.item);
    return it && it.style === "dessin" ? "dessin" : "photo";
  }

  // ---------------------------------------------------------------- inspecteur
  refreshInspector() {
    const box = this.el.insp; box.textContent = ""; this.syncLayer = null;
    const pan = this.curPanel(), l = this.layer(), b = this.bubble();
    const range = (label, val, min, max, step, fn, kind) => { const out = h("output", fmt(val));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: val, on: { input: (e) => { fn(+e.target.value); out.textContent = fmt(+e.target.value); this.editor.render(true); this.commitSoon(kind); } } }), out); };
    if (!pan) { box.append(h("h3", "Sélection"), h("p.muted", "Clique une case pour la régler ; glisse-y un décor puis des personnages depuis la banque.")); return; }
    if (l) {
      const item = this.bank.get(l.item), v = variantOf(item, l.v), sp = item && sprite(item, l.v, l.f), ls = pan.layers, i = ls.indexOf(l);
      box.append(h("h3", item ? item.name : "Élément retiré de la banque"));
      if (!item) { box.append(h("button.mini.danger", { on: { click: () => this.removeLayer(l) } }, "Supprimer le calque")); return; }
      box.append(h("label.row", "Pose", h("select", { on: { change: (e) => this.setPose(l, e.target.value) } },
        Object.entries(item.variants).map(([k, vv]) => h("option", { value: k, selected: k === l.v }, (vv.orbit ? "↻ " : this.jobsFor(l.item, k) ? "⏳ " : "▫ ") + vv.label)))));
      if (v && v.orbit) {
        const cur = nearestAxis(v.orbit, l.f || 0);
        box.append(h("div.axes", AXES.map((a) => h("button.mini" + (a === cur ? ".on" : ""), { on: { click: () => this.setAxis(l, a) } }, a))),
          range("Rotation", sp.i, 0, sp.n - 1, 1, (x) => { l.f = x; }, "frame"));
      } else box.append(h("p.muted", this.jobsFor(l.item, l.v) ? "Orbite en calcul : le personnage deviendra pivotable." : "Pas d'orbite pour cette pose : image fixe."));
      const rs = range("Taille", l.s, 0.05, 12, 0.01, (x) => { l.s = x; }, "lscale");
      const rpx = range("Position ↔", l.x, -4, 5, 0.005, (x) => { l.x = x; }, "lmove"), rpy = range("Position ↕", l.y, -4, 8, 0.005, (x) => { l.y = x; }, "lmove");
      this.syncLayer = () => { for (const [r, v] of [[rs, l.s], [rpx, l.x], [rpy, l.y]]) { r.querySelector("input").value = v; r.querySelector("output").textContent = fmt(v); } };
      if (sp && sp.vec) box.append(h("div", { title: "Dessin en tracés : net à tout zoom. Trait à 0 = celui du dessin ; vers la droite plus épais, vers la gauche plus fin." }, range("Trait ⓘ", l.lw || 0, -2, 6, 0.1, (x) => { l.lw = x; }, "lw")));
      // dépliant : reste ouvert ou fermé d'un élément à l'autre
      const fold = (key, label, ...rows) => { this.folds = this.folds || { sh: true, gs: true };
        return h("details.fold", { open: !!this.folds[key], on: { toggle: (e) => { this.folds[key] = e.target.open; } } }, h("summary", label), ...rows); };
      if (sp && sp.vec) {
        const sh = l.sh || {}, put = (k, x) => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135 }, l.sh, { [k]: x }); };
        box.append(h("label.row.check", { title: "Un aplat gris posé sur le dessin, du côté opposé à la lumière. Sans calcul." }, h("input", { type: "checkbox", checked: !!sh.on, on: { change: (e) => { put("on", e.target.checked); this.commit("shade"); this.editor.render(); this.refreshInspector(); } } }), "Ombre"));
        if (sh.on) box.append(fold("sh", "Réglages de l'ombre", range("Gris", sh.g ?? 0.72, 0.2, 0.95, 0.01, (x) => put("g", x), "shade"),
          range("Largeur", sh.w ?? 5, 0.5, 25, 0.1, (x) => put("w", x), "shade"),
          range("Lumière (angle)", sh.a ?? 135, 0, 360, 1, (x) => put("a", x), "shade"),
          h("div", { title: "0 : ombre sur la silhouette seule. Monter ajoute une ombre aux plus grandes formes du dessin (tête, torse…), une par cran." }, range("Formes détaillées ⓘ", sh.k ?? 0, 0, 8, 1, (x) => put("k", x), "shade"))));
      }
      {
        const gs = l.gs || {}, putg = (k, x) => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { [k]: x }); };
        box.append(h("label.row.check", { title: "Une tache sombre et floue sous l'élément, pour le poser au sol" }, h("input", { type: "checkbox", checked: !!gs.on, on: { change: (e) => { putg("on", e.target.checked); this.commit("cast"); this.editor.render(); this.refreshInspector(); } } }), "Ombre portée"));
        if (gs.on) box.append(fold("gs", "Réglages de l'ombre portée", range("Force", gs.a ?? 0.35, 0.05, 0.9, 0.01, (x) => putg("a", x), "cast"),
          range("Largeur", gs.w ?? 0.8, 0.2, 2.5, 0.01, (x) => putg("w", x), "cast")));
      }
      box.append(rs, rpx, rpy,
        range("Profondeur", depthOf(pan, i), 0, 1, 0.01, (x) => { l.d = x; }, "depth"),
        h("div.row", h("button.mini" + (l.flip ? ".on" : ""), { on: { click: () => { l.flip = !l.flip; this.commit("flip"); this.editor.render(); this.refreshInspector(); } } }, "⇋ Miroir"),
          h("button.mini", { on: { click: () => this.order(l, "up") } }, "Avancer"), h("button.mini", { on: { click: () => this.order(l, "down") } }, "Reculer"),
          h("button.mini", { on: { click: () => this.duplicate(l) } }, "Dupliquer"),
          h("button.mini", { title: "Ajouter cet élément, tel qu'il est réglé, dans d'autres cases", on: { click: () => this.copyLayerTo(l) } }, "Copier vers…"),
          h("button.mini.danger", { on: { click: () => this.removeLayer(l) } }, "Supprimer")),
        h("button.mini", { on: { click: () => this.bankUI.openItem(l.item) } }, "Fiche : poses et orbites…"));
      return;
    }
    if (b) {
      const AB = window.AliveBubbles, upd = () => { this.editor.bubs.get(this.sel.panel)?.layout(); this.commitSoon("bub-" + b.id); };
      const sel = (label, key, opts) => h("label.row", label, h("select", { on: { change: (e) => { b[key] = e.target.value; this.editor.render(); this.commit("bub"); } } },
        opts.map(([v, t]) => h("option", { value: v, selected: (b[key] || opts[0][0]) === v }, t))));
      box.append(h("h3", "Bulle"),
        h("textarea", { rows: 3, on: { input: (e) => { b.text = e.target.value; const it = this.editor.bubs.get(this.sel.panel)?.items.find((x) => x.b === b); if (it) it.txt.textContent = b.text; upd(); } } }, b.text || ""),
        sel("Forme", "type", Object.entries(BUB).map(([k, v]) => [k, v[0]])),
        sel("Taille", "size", [["S", "Petite"], ["M", "Moyenne"], ["L", "Grande"]]),
        sel("Couleur", "color", Object.entries(AB.COLOR_NAMES)),
        sel("Police", "font", Object.entries(AB.FONTS).map(([k, v]) => [k, v[0]])),
        h("div.row", h("button.mini", { on: { click: () => { if (b.tx != null) { delete b.tx; delete b.ty; delete b.bx; delete b.by; } else { b.tx = b.x + 0.06; b.ty = b.y + 0.2; } this.commit("bub"); this.editor.render(); } } }, "Queue oui / non"),
          h("button.mini.danger", { on: { click: () => this.removeBubble() } }, "Supprimer")));
      return;
    }
    const mk = this.mark();
    if (mk) {
      const redo = () => { this.editor.render(); this.commit("mark"); this.refreshInspector(); };
      box.append(h("h3", "Indication · " + MARKS[mk.type][0]),
        h("div.row.colrow", h("span", "Couleur"), swatch(mk.color || "#111111", (c) => { mk.color = c; this.editor.render(true); this.commitSoon("mark"); })),
        range("Épaisseur", mk.w || 1, 0.4, 4, 0.1, (x) => { mk.w = x; }, "mark"),
        h("div.row",
          h("button.mini" + ((mk.type === "frame" ? mk.dash !== false : mk.dash) ? ".on" : ""), { on: { click: () => { mk.dash = mk.type === "frame" ? mk.dash === false : !mk.dash; redo(); } } }, "Pointillés"),
          mk.type === "turn" ? h("button.mini", { on: { click: () => { mk.cw = mk.cw === false; redo(); } } }, "Inverser le sens")
            : mk.type !== "frame" ? h("button.mini" + (mk.both ? ".on" : ""), { on: { click: () => { mk.both = !mk.both; redo(); } } }, "Deux pointes") : ""),
        h("div.row", h("button.mini", { title: "Glisser l'indication la déplace ; ses points ronds la déforment.", on: { click: () => this.duplicateMark() } }, "Dupliquer"), h("button.mini.danger", { title: "Ou touche Suppr", on: { click: () => this.removeMark() } }, "Supprimer")));
      return;
    }
    // ---- la case
    const g = this.geo(this.sel.panel), bg = background(pan, this.bank, this.project.id);
    const dof = pan.dof || (pan.dof = { on: false, focus: 0.3, amount: 12 });
    box.append(h("h3", "Case " + (g ? g.order : "")));
    box.append(h("div.row", h("span.muted", "Fond :"), h("span", bg ? (bg.item ? bg.item.name : "image importée") : "aucun"),
      bg ? h("button.mini", { on: { click: () => { delete pan.bg; this.commit("bg"); this.editor.render(); this.refreshInspector(); } } }, "Retirer") : null));
    box.append(h("div.row", h("button.mini", { title: "Formes simples, tracés, gris en trame de points : un décor fait à la main en noir et blanc", on: { click: () => this.drawBackground(this.sel.panel) } }, (pan.draw ? "✎ Modifier le fond dessiné" : "✎ Dessiner le fond")),
      pan.draw ? h("button.mini.danger", { on: { click: () => { delete pan.draw; this.commit("draw"); this.editor.render(); this.refreshInspector(); } } }, "Retirer le dessin") : ""));
    if (bg && bg.item && Object.keys(bg.item.variants).length > 1) box.append(h("label.row", "Ambiance", h("select", { on: { change: (e) => { pan.bg.v = e.target.value; pan.bg.f = 0; this.commit("bg"); this.editor.render(); this.refreshInspector(); } } },
      Object.entries(bg.item.variants).map(([k, vv]) => h("option", { value: k, selected: k === (pan.bg.v || "base") }, vv.label)))));
    if (bg && bg.orbit) box.append(range("Axe du décor", pan.bg.f || 0, 0, bg.n - 1, 1, (x) => { pan.bg.f = x; }, "bturn"));
    if (bg) {
      // cadrage du fond : zoom, puis position horizontale et verticale (-100 = bord gauche / haut, 100 = bord droit / bas)
      const travel = () => { const pl = placement(g.bbox, bg.w || 16, bg.h || 9, pan.view); return { pl, mx: (pl.w - g.bbox.w) / (2 * g.bbox.w), my: (pl.h - g.bbox.h) / (2 * g.bbox.h) }; };
      const pos = (axis) => { const t = travel(), m = axis === "x" ? t.mx : t.my, o = axis === "x" ? t.pl.ox : t.pl.oy; return m > 1e-4 ? Math.round(-o / m * 100) : 0; };
      const setPos = (axis, x) => { const t = travel(), v = Object.assign({ zoom: 1, ox: 0, oy: 0 }, pan.view); if (axis === "x") v.ox = -x / 100 * t.mx; else v.oy = -x / 100 * t.my; pan.view = v; };
      const rx = range("Cadrage ↔", pos("x"), -100, 100, 1, (x) => setPos("x", x), "pan");
      const ry = range("Cadrage ↕", pos("y"), -100, 100, 1, (x) => setPos("y", x), "pan");
      const sync = () => { for (const [r, a] of [[rx, "x"], [ry, "y"]]) { const t = travel(), free = (a === "x" ? t.mx : t.my) > 1e-4; r.querySelector("input").value = pos(a); r.querySelector("output").textContent = pos(a); r.querySelector("input").disabled = !free; r.classList.toggle("off", !free); } };
      this.syncPan = sync;
      if (bg.vec) box.append(range("Trait du fond", pan.bglw || 0, -2, 6, 0.1, (x) => { pan.bglw = x; }, "bglw"));
      box.append(range("Zoom du fond", (pan.view || {}).zoom || 1, 1, 6, 0.01, (x) => { const t0 = travel(), kx = t0.mx > 1e-4 ? t0.pl.ox / t0.mx : 0, ky = t0.my > 1e-4 ? t0.pl.oy / t0.my : 0; pan.view = Object.assign({ ox: 0, oy: 0 }, pan.view, { zoom: x }); const t1 = travel(); pan.view.ox = kx * t1.mx; pan.view.oy = ky * t1.my; sync(); }, "pan"),
        rx, ry, h("div.row", h("button.mini", { title: "Zoom 1, fond centré", on: { click: () => { pan.view = { zoom: 1, ox: 0, oy: 0 }; this.commit("pan"); this.editor.render(); this.refreshInspector(); } } }, "Recentrer le fond"),
          h("span.muted", bg.orbit ? "Maj + glisser dans la case : recadrer" : "Glisser dans la case : recadrer")));
      sync();
    } else this.syncPan = null;
    box.append(h("h4", { title: "0 = premier plan, 1 = décor. Chaque calque a sa profondeur (par défaut : son ordre)." }, "Profondeur de champ ⓘ"),
      h("label.row.check", h("input", { type: "checkbox", checked: dof.on, on: { change: (e) => { dof.on = e.target.checked; this.commit("dof"); this.editor.render(); } } }), "Flouter selon la profondeur"),
      range("Mise au point", dof.focus, 0, 1, 0.01, (x) => { dof.focus = x; dof.on = true; }, "dof"),
      range("Flou", dof.amount, 0, 60, 1, (x) => { dof.amount = x; dof.on = true; }, "dof"));
    const style = h("select", [["photo", "Photoréaliste"], ["dessin", "Dessin"]].map(([v, t]) => h("option", { value: v, selected: v === (pan.style || this.guessStyle(pan)) }, t)));
    style.addEventListener("change", () => { pan.style = style.value; this.commitSoon("style"); });
    const extra = h("input", { type: "text", placeholder: "Consigne en plus (facultatif) : « night, rain »…" });
    box.append(h("h4", "Image finale"), h("label.row", "Rendu", style), extra,
      h("div.row", h("button.primary", { title: "Une seule image, lumière et ombres unifiées", on: { click: () => this.integrate(style.value, extra.value.trim()) } }, "✦ Integrate"),
        h("button", { title: "Orbite 360° de toute la case", on: { click: () => this.panelOrbit() } }, "↻ Orbite de la case")));
    if (pan.integrated || pan.orbit) {
      const modes = [["layers", "Calques"]]; if (pan.integrated) modes.push(["integrated", "Intégrée"]); if (pan.orbit) modes.push(["orbit", "Orbite"]);
      box.append(h("div.row", h("span.muted", "Afficher :"), modes.map(([m, t]) => h("button.mini" + ((pan.show || "layers") === m ? ".on" : ""), { on: { click: () => this.setShow(m) } }, t))));
      if ((pan.integrations || []).length > 1) box.append(h("div.versions", pan.integrations.map((f, i) => h("img" + (f === pan.integrated ? ".on" : ""), {
        src: `/projects/${this.project.id}/${f}`, title: "Version " + (i + 1), on: { click: () => { pan.integrated = f; pan.show = "integrated"; this.commit("ver"); this.editor.render(); this.refreshInspector(); } } }))));
      if (pan.show === "orbit" && pan.orbit) box.append(range("Axe de la scène", pan.orbit.frame || 0, 0, pan.orbit.n - 1, 1, (x) => { pan.orbit.frame = x; }, "oturn"));
    }
    box.append(h("h4", "Animation"), h("div.row", h("button.mini", { title: "Timeline, poses clés, caméra virtuelle", on: { click: () => openMontage(this, this.sel.panel) } }, pan.anim ? "🎬 Ouvrir le montage" : "🎬 Mode montage"),
      pan.anim ? h("span.muted", `${pan.anim.dur} s · ${Object.values(pan.anim.tracks || {}).reduce((n, k) => n + k.length, 0)} clés`) : ""),
      h("div.row", h("button.mini", { title: "Ajoute cette case comme plan dans le deck de montage global", on: { click: () => this.sendToDeck(this.sel.panel) } }, "▸ Envoyer dans le deck"),
        h("button.mini", { on: { click: () => openDeck(this) } }, "🎞 Ouvrir le deck"),
        (() => { const d = this.decks().find((x) => x.id === this.project.deckCur) || this.decks()[0]; if (!d) return ""; const n = d.clips.filter((c) => c.panel === this.sel.panel && c.page === this.page().id).length; return h("span.muted", `« ${d.name} »` + (n ? ` · déjà ${n} fois` : "")); })()));
    box.append(h("h4", "Indications"), h("div.row.wrap", Object.entries(MARKS).map(([t, [label, ico]]) => h("button.mini" + (this.markTool === t ? ".on" : ""), { title: "Tracer dans une case : " + label, on: { click: () => this.armMark(t) } }, `${ico} ${label}`))));
    box.append(h("h4", "Bulles"), h("div.row", Object.entries(BUB).map(([t, [label]]) => h("button.mini", { on: { click: () => this.addBubble(t) } }, "+ " + label))));
    if ((pan.layers || []).length) box.append(h("h4", "Calques (du fond vers l'avant)"), h("div.layers", pan.layers.map((x) => {
      const it = this.bank.get(x.item);
      return h("button.lrow", { on: { click: () => this.select({ panel: this.sel.panel, layer: x.id }) } }, it ? it.name : "?", h("span.muted", it ? variantOf(it, x.v).label : ""));
    })));
  }

  // ---------------------------------------------------------------- rendus
  jobsFor(itemId, variant) {
    return this.jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.params.item === itemId &&
      (!variant || j.params.variant === variant || (!j.params.variant && variant !== "base"))).length;
  }
  panelState(pid) {
    const j = this.jobs.find((x) => (x.status === "queued" || x.status === "running") && x.params.panel === pid && x.params.project === this.project?.id);
    return j ? { kind: j.status === "running" ? "busy" : "wait", text: j.title } : null;
  }
  pollSoon() { clearTimeout(this._poll); this._poll = setTimeout(() => this.poll(), 500); }
  async poll() {
    clearTimeout(this._poll);
    let active = 0;
    try {
      const jobs = await get("jobs");
      const before = this.jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => j.id).join();
      const doneBefore = this.jobs.filter((j) => j.status === "done").length;
      this.jobs = jobs;
      const act = jobs.filter((j) => j.status === "queued" || j.status === "running");
      active = act.length;
      const run = act.filter((j) => j.status === "running").length;
      this.el.jobsBtn.textContent = active ? `Rendus · ${run} en cours, ${active - run} en file` : "Rendus";
      this.el.jobsBtn.classList.toggle("busy", active > 0);
      if (before !== act.map((j) => j.id).join() || doneBefore !== jobs.filter((j) => j.status === "done").length) {
        await this.bankUI.reload();
        this.settlePending();
        if (this.project) { try { this.absorb(await get("projects/" + this.project.id)); } catch (e) { /* storyboard supprime */ } }
        this.editor.render(); this.refreshInspector();
      }
      if (!this.el.drawer.classList.contains("hidden")) this.renderJobs();
    } catch (e) { /* serveur en redemarrage */ }
    this._poll = setTimeout(() => this.poll(), active ? 2500 : 9000);
  }
  toggleJobs() { this.el.drawer.classList.toggle("hidden"); this.renderJobs(); }
  renderJobs() {
    const d = this.el.drawer, rows = [...this.jobs].reverse().slice(0, 80);
    const label = { queued: "en file", running: "en cours", done: "fait", error: "erreur", cancelled: "annulé" };
    d.textContent = "";
    d.append(h("header", h("b", "Rendus"), h("div.grow"),
      h("button.mini", { on: { click: async () => { await post("jobs/cancel-all"); this.pollSoon(); } } }, "Tout annuler"),
      h("button.mini", { on: { click: async () => { await post("jobs/clear"); this.pollSoon(); } } }, "Effacer les terminés"),
      h("button.icon", { on: { click: () => this.toggleJobs() } }, "✕")),
      h("div.joblist", rows.length ? rows.map((j) => h("div.job." + j.status, h("span.dot." + ({ queued: "wait", running: "busy", done: "ok", error: "err", cancelled: "off" })[j.status]),
        h("span.jt", j.title), h("span.muted", [label[j.status], j.worker, j.progress, j.status === "running" ? Math.round(Date.now() / 1000 - j.started) + " s" : "",
          j.status === "done" ? Math.round(j.finished - j.started) + " s" : ""].filter(Boolean).join(" · ")),
        j.error ? h("span.err", { title: j.error }, j.error.slice(0, 140)) : null,
        j.status === "queued" || j.status === "running" ? h("button.mini", { on: { click: async () => { await post(`jobs/${j.id}/cancel`); this.pollSoon(); } } }, "Annuler") : null))
        : h("p.muted", "Aucun rendu pour l'instant.")));
  }
  async pollWorkers() {
    try {
      const ws = await get("workers");
      this.el.workers.textContent = "";
      this.el.workers.append(...ws.map((w) => h("span.dot." + (!w.online ? "err" : w.busy || w.load ? "busy" : w.orbit ? "ok" : "wait"),
        { title: `${w.name} : ${!w.online ? "injoignable" : (w.busy || w.load ? "occupée" : "prête")}${w.missing?.length ? " · manque : " + w.missing.join(", ") : ""}${w.gpu ? " · " + w.gpu : ""}` })),
        h("span.muted", ws.length ? `${ws.filter((w) => w.online).length}/${ws.length} machines` : (this.info.settings.fal.key || localStorage.getItem("bw.falKey") ? "fal" : "aucune machine")));
    } catch (e) { /* plus tard */ }
    setTimeout(() => this.pollWorkers(), 20000);
  }

  // ---------------------------------------------------------------- reglages
  async settingsDialog() {
    const s = await get("settings"), ws = await get("workers?fresh=1").catch(() => []);
    const f = (v, ph, type = "text") => h("input", { type, value: v ?? "", placeholder: ph || "", autocomplete: type === "password" ? "new-password" : "off" });
    const workers = h("textarea", { rows: 4, placeholder: "HITCHCOCK | http://192.168.1.60:8188" }, (s.workers || []).map((w) => `${w.name} | ${w.url}`).join("\n"));
    const qb = f(s.qbuilder_settings, "…\\Workflows-Q-Builder\\local_settings.json");
    const len = h("select", [[73, "3 s (73 images)"], [90, "3,75 s"], [107, "4,5 s"], [124, "5,2 s (124 images)"]].map(([v, t]) => h("option", { value: v, selected: v === s.render.orbit_length }, t)));
    const tgt = h("select", [["auto", "Auto : machines d'abord, fal sinon"], ["local", "Machines seulement"], ["fal", "fal seulement"]].map(([v, t]) => h("option", { value: v, selected: v === s.render.target }, t)));
    // champ secret : toujours masque, jamais propose par l'historique du navigateur, avec un bouton pour coller
    const secret = (v, ph) => h("input", { type: "password", value: v ?? "", placeholder: ph || "", autocomplete: "new-password", name: "bw-" + uid(), spellcheck: "false", "data-lpignore": "true", "data-1p-ignore": "true" });
    const paste = (inp) => h("button.mini", { type: "button", title: "Coller le contenu du presse-papiers dans ce champ", on: { click: async (e) => {
      e.preventDefault();
      try { const t = (await navigator.clipboard.readText()).trim(); if (!t) return toast("Le presse-papiers est vide.", "error"); inp.value = t; toast("Clé collée (" + t.length + " caractères). N'oublie pas « Enregistrer »."); }
      catch (err) { toast("Le navigateur refuse l'accès au presse-papiers : clique dans le champ puis Ctrl+V.", "error"); } } } }, "Coller");
    const key = secret(s.fal.key, "clé fal du poste"), myKey = secret(localStorage.getItem("bw.falKey") || "", "ma clé fal (reste dans ce navigateur)");
    const orbit = f(s.fal.orbit), edit = f(s.fal.edit), t2i = f(s.fal.t2i);
    const fres = h("select", [["480P", "480P · le moins cher (≈ 0,31 $ l'orbite de 5 s)"], ["768P", "768P (≈ 0,375 $)"], ["2K", "2K"], ["4K", "4K"]].map(([v, t]) => h("option", { value: v, selected: v === (s.fal.orbit_resolution || "768P") }, t)));
    const fcon = h("input", { type: "number", min: 1, max: 20, step: 1, value: s.fal.concurrency || 3 });
    const pw = f(s.server.password || "", "vide = pas de mot de passe", "password");
    modal("Réglages", h("div.form.settings",
      h("h4", "Machines ComfyUI"),
      h("div.wstatus", ws.length ? ws.map((w) => h("div", h("span.dot." + (w.online ? (w.orbit ? "ok" : "wait") : "err")), ` ${w.name} · ${w.online ? (w.gpu || "en ligne") : "injoignable"}`,
        w.online ? h("span.muted", " · " + ["orbit", "matte", "edit", "t2i"].map((c) => (w[c] ? "✓ " : "✗ ") + ({ orbit: "orbite", matte: "détourage", edit: "édition", t2i: "image" })[c]).join("  ")) : null)) : h("p.muted", "Aucune machine déclarée.")),
      h("label.col", "Une machine par ligne : nom | adresse", workers),
      h("label.col", "Réglages de Workflows Q-builder (ses machines sont reprises)", qb),
      h("h4", "Calcul"), h("label.row", "Durée d'une orbite", len), h("label.row", "Où calculer par défaut", tgt),
      h("h4", "fal (cloud)"), h("div.row.keyrow", h("span", "Clé du poste"), key, paste(key)), h("div.row.keyrow", h("span", "Ma clé (ce navigateur)"), myKey, paste(myKey)),
      h("label.row", "Résolution de l'orbite", fres), h("label.row", "Calculs fal en même temps", fcon),
      h("label.row", "Modèle orbite", orbit), h("label.row", "Modèle édition / Integrate", edit), h("label.row", "Modèle image", t2i),
      h("p.muted", "Sur fal, l'orbite H3 + LoRA dure 5 s au minimum ; « minimax/h3-max/camera-controls » accepte 3 s. Sur fal : image, détourage et orbite essayés ; édition pas encore."),
      h("h4", "Accès"), h("label.row", "Mot de passe de l'application", pw),
      h("p.muted", `Données (banque et storyboards) : ${s.data}`)),
      [{ label: "Annuler" }, { label: "Enregistrer", primary: true, click: async () => {
        if (myKey.value.trim()) localStorage.setItem("bw.falKey", myKey.value.trim()); else localStorage.removeItem("bw.falKey");
        const list = workers.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0])
          .map((p) => (p.length > 1 ? { name: p[0], url: p[1], enabled: true } : { name: p[0], url: p[0], enabled: true }));
        await put("settings", { workers: list, qbuilder_settings: qb.value.trim(), render: { orbit_length: +len.value, target: tgt.value },
                                fal: { key: key.value.trim(), orbit_resolution: fres.value, concurrency: Math.max(1, Math.min(20, +fcon.value || 3)), orbit: orbit.value.trim(), edit: edit.value.trim(), t2i: t2i.value.trim() }, server: { password: pw.value } });
        this.info = await get("info"); toast("Réglages enregistrés."); this.pollWorkers();
      } }]);
  }

  // ---------------------------------------------------------------- clavier
  keys() {
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector(".modal-back")) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, l = this.layer();
      if (ctrl && k === "z") { e.preventDefault(); return e.shiftKey ? this.doRedo() : this.doUndo(); }
      if (ctrl && k === "y") { e.preventDefault(); return this.doRedo(); }
      if (k === "escape") { document.querySelector(".menu")?.remove(); if (this.markTool) { this.markTool = null; this.editor.render(true); } return this.select({}); }
      if (k === "delete" || k === "backspace") {
        e.preventDefault();
        if (l) return this.removeLayer(l);
        if (this.bubble()) return this.removeBubble();
        if (this.mark()) return this.removeMark();
        return;
      }
      if (!l) return;
      const step = e.shiftKey ? 0.05 : 0.01, v = variantOf(this.bank.get(l.item), l.v);
      if (k.startsWith("arrow")) {
        e.preventDefault();
        if (!e.altKey && v && v.orbit && (k === "arrowleft" || k === "arrowright")) l.f = (((l.f || 0) + (k === "arrowright" ? 1 : -1)) % v.orbit.n + v.orbit.n) % v.orbit.n;
        else if (k === "arrowleft") l.x -= step; else if (k === "arrowright") l.x += step; else if (k === "arrowup") l.y -= step; else l.y += step;
        this.editor.render(true); this.commitSoon("key"); this.refreshInspector();
      } else if (k === "f") { l.flip = !l.flip; this.commit("flip"); this.editor.render(); }
      else if (k === "pageup") { e.preventDefault(); this.order(l, "up"); } else if (k === "pagedown") { e.preventDefault(); this.order(l, "down"); }
      else if (ctrl && k === "d") { e.preventDefault(); this.duplicate(l); }
    });
  }
}

// ------------------------------------------------------------------ outils
const fmt = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2));
function transposeIf(page, layout) { return page.width > page.height ? transpose(layout) : layout; }
function defaultIntegrate(style) {
  return style === "dessin"
    ? "Redraw this rough collage as one coherent storyboard drawing in a single consistent line style. Keep every character and object exactly where it is, same pose, same size, same framing."
    : "Turn this rough collage into one coherent photograph. Keep every character and object exactly where it is, same pose, same size, same framing. Unify the lighting and colour, add contact shadows, blend the cut-out edges.";
}

function presetThumb(p, page) {
  let n = 0;
  const layout = p.make(() => ({ t: "leaf", id: "t" + (n++) }));
  const W = 60, H = Math.round(60 * page.height / page.width);
  const g = compute({ width: W, height: H, gutter: 3, margin: 3 }, layout);
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  for (const pn of g.panels) {
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pn.poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
    svg.append(poly);
  }
  return svg;
}

// menu contextuel : [{head}, {label, click, checked, half, danger}]
function menu(e, items) {
  document.querySelector(".menu")?.remove();
  const box = h("div.menu");
  for (const it of items) {
    if (it.head) { box.append(h("div.mhead", it.head)); continue; }
    if (it.note) { box.append(h("div.mnote", it.note)); continue; }
    box.append(h("button" + (it.half ? ".half" : "") + (it.checked ? ".on" : "") + (it.danger ? ".danger" : ""),
      { on: { click: () => { box.remove(); it.click(); } } }, it.checked ? "✓ " : "", it.label));
  }
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
  box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
  const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

const app = new App();
window.app = app;
app.start().catch((e) => { console.error(e); toast("Démarrage impossible : " + e.message, "error", 20000); });
