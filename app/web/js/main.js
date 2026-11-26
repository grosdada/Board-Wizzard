// Board Wizzard : storyboards par decalcomanie. Cases (decoupage d'Alive-Comics), banque de personnages / decors /
// assets en orbite, bulles, fausse profondeur de champ, « Integrate », orbite de case.
import { tt, tr, LANG, setLang } from "./i18n.js";
import { h, get, post, put, del, upload, toast, modal, debounce } from "./api.js";
import { compute, PRESETS, transpose, splitLeaf, removeLeaf, leaves, randomLayout, clone, keep169, equalize, equalizeBest } from "./geometry.js";
import { Editor } from "./editor.js";
import { Bank, target } from "./bank.js";
import { flattenPanel } from "./flatten.js";
import { MARKS, MARK_COLORS, newMark } from "./marks.js";
import { swatch } from "./colors.js";
import { exprName } from "./lipsync.js";
import { openDrawEditor, drawImage } from "./draw.js";
import { openMontage } from "./montage.js";
import { photoDialog, openGenerations } from "./photo.js";
import { openDeck, addClip } from "./deck.js";
import { orbitPerspective } from "./orbitpersp.js";
import { sprite, layerSp, variantOf, AXES, angleToFrame, frameToAngle, nearestAxis, depthOf, clamp, uid, background, placement, layerBox, pad3 } from "./model.js";

const FORMATS = [
  { id: "story", label: tt("Storyboard 16:10"), w: 2400, h: 1500 },
  { id: "hd", label: tt("Écran 16:9"), w: 2400, h: 1350 },
  { id: "a4", label: tt("A4 paysage"), w: 2400, h: 1697 },
  { id: "a4p", label: tt("A4 portrait"), w: 1697, h: 2400 },
  { id: "bd", label: tt("Page BD 2:3"), w: 1600, h: 2400 },
  { id: "carre", label: tt("Carré"), w: 2000, h: 2000 },
];
const PAGE0 = { format: "story", width: 2400, height: 1500, bg: "#ffffff", fill: "#ffffff", stroke: "#111111", strokeWidth: 5, gutter: 26, margin: 60 };
const LAYOUTS = [
  ...PRESETS.filter((p) => ["story169", "storynotes", "plein", "2x2", "3x3", "g3", "col2", "action"].includes(p.id)),
  { id: "2x3", label: tt("6 cases (2 rangées)"), make: (L) => transpose(PRESETS.find((p) => p.id === "3x2").make(L)) },
  { id: "1x3", label: tt("3 colonnes"), make: (L) => transpose(PRESETS.find((p) => p.id === "3b").make(L)) },
  { id: "1x2", label: tt("2 colonnes"), make: (L) => transpose(PRESETS.find((p) => p.id === "2b").make(L)) },
  { id: "2x4", label: tt("8 cases"), make: (L) => transpose(PRESETS.find((p) => p.id === "3x2").make(() => transpose(PRESETS.find((q) => q.id === "2b").make(L)))) },
  ...PRESETS.filter((p) => ["2b", "3b", "3x2"].includes(p.id)),
];
const BUB = { oval: [tt("Parole"), tt("Bonjour !"), true], thought: [tt("Pensée"), tt("Hmm…"), true], shout: [tt("Cri"), tt("ATTENTION !"), true],
              whisper: [tt("Chuchote"), tt("chut…"), true], box: [tt("Narration"), tt("Le lendemain…"), false] };

class App {
  constructor() {
    this.bank = new Map();
    this.sel = {};
    this.undo = []; this.redo = [];
    this.jobs = [];
    this.pageIndex = 0;
    this.editCuts = localStorage.getItem("bw.editCuts") === "1";   // traits entre les cases : seulement en mode edition des cases
    try { this.pending = JSON.parse(localStorage.getItem("bw.pending") || "{}"); } catch (e) { this.pending = {}; }
  }

  // invite non VIP : pas de machines du poste, tous ses calculs partent sur fal avec sa propre cle
  noMachines() { const me = this.info && this.info.me; return !!(me && me.role === "guest" && !me.vip); }

  async start() {
    this.info = await get("info");
    this.shell();
    this.bankUI = new Bank(this, this.el.bank);
    await this.bankUI.reload();
    const list = await get("projects");
    const last = localStorage.getItem("bw.project");
    if (list.find((p) => p.id === last)) await this.open(last);
    else if (list.length) await this.open(list[0].id);
    else await this.create(tt("Storyboard 1"));
    window.addEventListener("beforeunload", () => this.savePos());
    this.keys();
    this.poll();
    this.pollWorkers();
  }

  // ---------------------------------------------------------------- squelette
  shell() {
    const el = this.el = {};
    el.title = h("button.title", { title: tt("Changer de storyboard"), on: { click: () => this.projectsDialog() } }, "…");
    el.pages = h("div.pages");
    el.workers = h("div.workers", { title: tt("Machines de rendu"), on: { click: () => this.settingsDialog() } });
    el.jobsBtn = h("button", { on: { click: () => this.toggleJobs() } }, tt("Rendus"));
    el.target = this.noMachines()
      ? h("select", { title: tt("Compte invité : tes calculs partent sur fal avec ta propre clé (Réglages › fal › « Ma clé (ce navigateur) »)."), disabled: true }, h("option", { value: "fal" }, tt("Calcul : fal (ma clé)")))
      : h("select", { title: tt("Où calculer"), on: { change: (e) => localStorage.setItem("bw.target", e.target.value) } },
        [["auto", tt("Calcul : auto")], ["local", tt("Mes machines")], ["fal", "fal (cloud)"]].map(([v, l]) => h("option", { value: v, selected: v === target() }, l)));
    el.left = h("aside.left"); el.center = h("div.center"); el.bank = h("div.bank"); el.insp = h("div.insp");
    el.drawer = h("div.drawer.hidden");
    const top = h("header.top", h("div.logo", "BOARD", h("b", "WIZZARD")), el.title,
      h("button.icon", { title: tt("Annuler (Ctrl+Z)"), on: { click: () => this.doUndo() } }, "↶"),
      h("button.icon", { title: tt("Rétablir (Ctrl+Y)"), on: { click: () => this.doRedo() } }, "↷"),
      el.pages,
      h("button.primary.drawasset", { title: tt("Fabriquer un asset sans calcul : le dessiner soi-même (crayons, formes de base), ou partir d'un objet tout fait (table, chaise, étagère…) réglable, qui tourne sur 360°"), on: { click: () => this.assetDialog() } }, tt("✏ Dessiner un asset")),
      h("button.genasset", { title: tt("Générer un objet ou un véhicule d'après une description, un croquis et des dessins de référence pour le style (GPT Image 2.5)"), on: { click: () => this.genDialog("asset") } }, tt("✨ Générer un asset")),
      h("button.genasset", { title: tt("Générer un personnage d'après une description, un croquis et des dessins de référence pour le style (GPT Image 2.5)"), on: { click: () => this.genDialog("character") } }, tt("✨ Générer un personnage")),
      h("div.grow"), el.workers, el.target, el.jobsBtn,
      h("button", { title: tt("Decks de montage : les cases animées mises bout à bout"), on: { click: (e) => this.decksMenu(e) } }, tt("🎞 Decks ▾")),
      this.info && this.info.me && this.info.me.role === "guest" ? "" : h("button", { title: tt("Toutes les images et vidéos générées par l'IA (fal et machines), téléchargées ou non"), on: { click: () => openGenerations() } }, tt("🗂 Générations")),
      h("button", { title: tt("Imprimer ou enregistrer la page en PDF"), on: { click: () => window.print() } }, tt("Imprimer")),
      h("button.lang", { title: tt("Passer l'interface en anglais"), on: { click: (e) => { e.currentTarget.disabled = true; setLang(LANG === "fr" ? "en" : "fr"); } } },
        h("b" + (LANG === "fr" ? ".on" : ""), "FR"), " / ", h("b" + (LANG !== "fr" ? ".on" : ""), "EN")),
      h("button.icon", { title: tt("Réglages"), on: { click: () => this.settingsDialog() } }, "⚙"));
    document.getElementById("app").append(top, h("div.work", el.left, el.center, h("aside.right", el.bank, el.insp)), el.drawer);
    this.editor = new Editor(el.center, this);
    el.center.append(h("div.hint", tt("Glisser un personnage : le déplacer · anneau au centre (ou Alt+glisser) : orbite · flèche du haut : pencher · boules des coins : taille · clic droit : pose, axe, ordre")));
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
    let pos = null;                                        // F5 : retour a la page, a la case (et au montage) ou l'on en etait
    try { pos = JSON.parse(localStorage.getItem("bw.pos." + id) || "null"); } catch (e) { pos = null; }
    const pi = pos ? this.project.pages.findIndex((p) => p.id === pos.pg) : -1;
    if (pi >= 0) this.pageIndex = pi;
    this.restoring = true;
    this.refresh();
    if (pos && pos.sel && pos.sel.panel && this.geo(pos.sel.panel)) {
      this.sel = pos.sel;
      if ((this.sel.layer && !this.layer()) || (this.sel.mark && !this.mark()) || (this.sel.bubble && !this.bubble())) this.sel = { panel: pos.sel.panel };
      this.editor.render(); this.refreshInspector(); this.renderLeft();
    }
    this.restoring = false;
    this.savePos();
    if (pos && pos.mt && this.geo(pos.mt)) openMontage(this, pos.mt);
    else if (pos && pos.dk && (this.project.decks || []).some((d) => d.id === pos.dk)) openDeck(this, pos.dk);
  }
  savePos() {
    if (!this.project || this.restoring) return;
    const pg = this.page();
    try { localStorage.setItem("bw.pos." + this.project.id, JSON.stringify({ pg: pg && pg.id, sel: this.sel || {}, mt: this.montagePid || null, dk: this.deckOpen || null })); } catch (e) { /* plein */ }
  }

  refresh() {
    this.el.title.textContent = this.project.name + " ▾";
    this.renderPages(); this.renderLeft(); this.editor.render(); this.refreshInspector();
    this.savePos();
  }

  renderPages() {
    const P = this.project;
    this.el.pages.textContent = "";
    const go = (i) => { if (i < 0 || i >= P.pages.length || i === this.pageIndex) return; this.pageIndex = i; this.sel = {}; this.refresh(); };
    // peu de pages : un bouton par page ; au-dela, ‹ Page n / N ▾ › et la planche de toutes les pages en menu
    const nav = P.pages.length <= 8 ? [h("span.muted", tt("Page")), ...P.pages.map((pg, i) => h("button.pg" + (i === this.pageIndex ? ".on" : "") + (pg.name ? ".named" : ""),
      { title: this.pageTitle(i), on: { click: () => go(i), contextmenu: (e) => this.pageMenu(e, i) } }, String(i + 1)))]
      : [h("button.pg", { title: tt("Page précédente"), disabled: this.pageIndex === 0, on: { click: () => go(this.pageIndex - 1) } }, "‹"),
         h("button.pg.pg-cur", { title: this.pageTitle(this.pageIndex) + " · " + tt("clic : toutes les pages ; clic droit : renommer"), on: { click: (e) => this.pagesGrid(e.currentTarget, go), contextmenu: (e) => this.pageMenu(e, this.pageIndex) } },
           tt`Page ${this.pageIndex + 1} / ${P.pages.length}` + (P.pages[this.pageIndex].name ? " · " + P.pages[this.pageIndex].name : "") + " ▾"),
         h("button.pg", { title: tt("Page suivante"), disabled: this.pageIndex === P.pages.length - 1, on: { click: () => go(this.pageIndex + 1) } }, "›")];
    this.el.pages.append(...nav,
      h("button.pg", { title: tt("Ajouter une page (même découpage)"), on: { click: () => this.addPage() } }, "+"),
      ...(P.pages.length > 1 ? [h("button.pg", { title: tt("Supprimer cette page"), on: { click: () => this.removePage() } }, "−")] : []));
  }

  // planche des pages : une vignette par page (le decoupage, les cases remplies en gris), sous le bouton
  pagesGrid(anchor, go) {
    document.querySelector(".pages-grid")?.remove();
    const P = this.project, NS = "http://www.w3.org/2000/svg";
    const box = h("div.pages-grid");
    P.pages.forEach((pg, i) => {
      const svg = document.createElementNS(NS, "svg"), W = pg.page.width, H = pg.page.height;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      let inner = `<rect width="${W}" height="${H}" fill="#f4f1ea"/>`;
      try {
        for (const g of compute(pg.page, pg.layout).panels) {
          const pan = pg.panels[g.id] || {}, full = (pan.layers || []).length || pan.bg || pan.draw;
          inner += `<polygon points="${g.poly.map((q) => q.join(",")).join(" ")}" fill="${full ? "#b9b2a4" : "#fff"}" stroke="#333" stroke-width="${W / 160}"/>`;
        }
      } catch (e) { /* page illisible : vignette vide */ }
      svg.innerHTML = inner;
      box.append(h("button.pg-tile" + (i === this.pageIndex ? ".on" : ""), { title: this.pageTitle(i), on: { click: () => { close(); go(i); }, contextmenu: (e) => { close(); this.pageMenu(e, i); } } }, svg, h("span", String(i + 1) + (pg.name ? " · " + pg.name : ""))));
    });
    document.body.append(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + "px"; box.style.top = (r.bottom + 6) + "px";
    box.querySelector(".pg-tile.on")?.scrollIntoView({ block: "nearest" });
    const outside = (e) => { if (!box.contains(e.target) && e.target !== anchor) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    const close = () => { box.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", esc, true); });
  }
  // nom d'une feuille (pg.name) : la feuille garde son numero, le nom vient au survol
  pageTitle(i) { const pg = this.project.pages[i]; return tt`Page ${i + 1}` + (pg && pg.name ? " · " + pg.name : ""); }
  pageMenu(e, i) {
    e.preventDefault();
    const pg = this.project.pages[i];
    menu(e, [{ head: this.pageTitle(i) }, { label: tt("✎ Renommer la feuille…"), click: () => {
      const n = prompt(tt`Nom de la page ${i + 1} (vide : sans nom) :`, pg.name || "");
      if (n === null) return;
      if (n.trim()) pg.name = n.trim(); else delete pg.name;
      this.commit("page-name"); this.renderPages();
    } }]);
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
    if (!confirm(tt("Supprimer cette page et ses cases ?"))) return;
    this.project.pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.max(0, this.pageIndex - 1); this.sel = {};
    this.commit("page"); this.refresh();
  }

  async projectsDialog() {
    const list = await get("projects");
    const name = h("input", { type: "text", placeholder: tt("Nom du nouveau storyboard") });
    const rename = h("input", { type: "text", value: this.project.name });
    const m = modal(tt("Storyboards"), h("div.form",
      h("label.row", tt("Nom de celui-ci"), rename),
      h("div.plist", list.map((p) => { const sub = h("div.psub"); let shown = false;
        // la fleche deplie les feuilles : numero et nom ; un clic ouvre le storyboard a cette feuille
        const arrow = h("button.mini.parrow", { title: tt("Voir ses feuilles"), on: { click: async () => {
          shown = !shown; arrow.textContent = shown ? "▾" : "▸"; sub.textContent = "";
          if (!shown) return;
          const pj = p.id === this.project.id ? this.project : await get("projects/" + p.id);
          sub.append(...pj.pages.map((pg, i) => h("button.link.psheet", { on: { click: async () => { m.close(); if (p.id !== this.project.id) await this.open(p.id); this.pageIndex = i; this.sel = {}; this.refresh(); } } },
            h("b", String(i + 1)), pg.name ? " " + pg.name : h("span.muted", " " + tt("sans nom")))));
        } } }, "▸");
        return h("div", h("div.prow" + (p.id === this.project.id ? ".on" : ""), arrow,
        h("button.link", { on: { click: async () => { m.close(); await this.open(p.id); } } }, p.name),
        h("span.muted", tt`${p.pages} page(s) · ${new Date(p.updated * 1000).toLocaleDateString("fr-FR")}`),
        p.id !== this.project.id ? h("button.mini.danger", { on: { click: async (e) => {
          if (!confirm(tt`Supprimer « ${p.name} » ? (corbeille du dossier de données)`)) return;
          await del("projects/" + p.id); e.target.closest(".prow").parentNode.remove(); } } }, tt("Supprimer")) : null), sub); })),
      h("div.row", name, h("button.primary", { on: { click: async () => { m.close(); await this.create(name.value.trim() || tt("Storyboard")); } } }, tt("Créer")))),
      [{ label: tt("Fermer"), click: () => { if (rename.value.trim() && rename.value !== this.project.name) { this.project.name = rename.value.trim(); this.commit("name"); this.refresh(); } } }]);
  }

  // ---------------------------------------------------------------- annuler / enregistrer
  snapshot() { const P = this.project; return JSON.stringify({ pages: P.pages, nextId: P.nextId, name: P.name, decks: P.decks || [], deckCur: P.deckCur || null }); }
  commit(kind, merge = false) {      // merge : reglage continu (curseur, molette, fleches) ; un geste fini fait toujours une etape
    const now = Date.now(), snap = this.snapshot();
    if (snap === this.last) return;
    if (!(merge && kind && kind === this.lastKind && now - this.lastAt < 1200)) {
      this.undo.push(this.last); if (this.undo.length > 80) this.undo.shift();
    }
    this.redo = []; this.last = snap; this.lastKind = kind; this.lastAt = now;
    this.save();
  }
  commitSoon(kind) { (this._soon = this._soon || debounce((k) => this.commit(k, true), 350))(kind); }
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
      if (this.frozen) return;
      try { const r = await put("projects/" + this.project.id, Object.assign({}, this.project, { _cid: CID })); this.project.rev = r.rev; this.absorb(r); }
      catch (e) {
        if (e.status === 409) {                // modifie ailleurs : on arrete d'enregistrer plutot que d'ecraser
          this.frozen = true;
          modal(tt("Storyboard modifié ailleurs"), h("div.form", h("p", tt("Ce storyboard a été enregistré depuis un autre onglet ou un autre appareil après que cette page l'a chargé.")),
            h("p", tt("Pour ne rien écraser, cette page n'enregistre plus. Recharge-la pour repartir de la dernière version ; ce que tu viens de faire ici depuis le dernier enregistrement réussi sera perdu."))),
            [{ label: tt("Plus tard") }, { label: tt("Recharger"), primary: true, click: () => location.reload() }]);
        } else toast(tt("Enregistrement impossible : ") + e.message, "error");
      }
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
      if (sp.orbitBg && sp.orbitBg !== mine.orbitBg) {
        mine.bg = sp.bg; mine.orbitBg = sp.orbitBg; delete mine.view; mine.show = "layers"; changed = true;
        (this._orbitSnap = this._orbitSnap || new Set()).add(pid);
      }
    }
    this.project.rev = srv.rev;
    if (changed) { this.last = this.snapshot(); this.editor.render(); this.refreshInspector(); }
    for (const pid of this._orbitSnap || []) if (this.geo(pid)) { this._orbitSnap.delete(pid); this.orbitSnap(pid, "decor"); }
  }

  // ---------------------------------------------------------------- selection
  // cible de la mise au point : le prochain clic sur un element de la case y fait la mise au point
  setFocusPick(on) {
    this.focusPick = !!on;
    document.body.classList.toggle("focus-pick", this.focusPick);
    document.querySelectorAll(".insp button.target").forEach((b) => b.classList.toggle("on", this.focusPick));
    if (on && !this.focusEsc) {
      this.focusEsc = (e) => { if (e.key === "Escape" && this.focusPick) { e.stopPropagation(); this.setFocusPick(false); } };
      document.addEventListener("keydown", this.focusEsc, true);
    }
  }
  focusOn(pid, l) {
    const pan = this.page().panels[pid] || {}, i = (pan.layers || []).indexOf(l);
    this.setFocusPick(false);
    if (i < 0) return;
    pan.dof = Object.assign({ on: false, focus: 0.3, amount: 12 }, pan.dof, { on: true, focus: Math.round(depthOf(pan, i) * 100) / 100 });
    this.commit("dof"); this.sel = { panel: pid }; this.editor.render(); this.refreshInspector();
  }
  // « Restore case » : la case redevient vide (decor, elements, bulles, indications, dessin, sol, montage, rendus), apres confirmation
  // Inserer une case : une case vide prend la place de `pid`, tout ce qui suit (contenu des cases et texte de leur cadre
  // d'annotation) recule d'une case, de page en page. La derniere case du storyboard : vide, elle disparait ; pleine, une page
  // neuve (meme decoupage) s'ajoute a la fin pour la recevoir. Les decks et les calculs en cours suivent leurs cases.
  ctxMenu(e, items) { menu(e, items); }
  insertCase(pid) {
    const P = this.project, slots = [];
    const listSlots = () => { slots.length = 0; for (const pg of P.pages) for (const g of compute(pg.page, pg.layout).panels.slice().sort((a, b) => a.order - b.order)) slots.push({ pg, id: g.id, g }); };
    listSlots();
    const i0 = slots.findIndex((s) => s.id === pid);
    if (i0 < 0) return;
    const noteOf = (s) => (s.pg.notes || []).find((n) => n.under === s.id);
    const full = (c) => !!(c.pan && ((c.pan.layers || []).length || c.pan.bg || c.pan.draw || (c.pan.bubbles || []).length || (c.pan.marks || []).length || c.pan.integrated || c.pan.orbit)) || !!(c.note && (c.note.text || "").trim());
    const C = slots.slice(i0).map((s) => ({ pan: s.pg.panels[s.id] || null, note: noteOf(s), text: (noteOf(s) || {}).text || "" }));
    let added = false;
    if (full(C[C.length - 1])) {                          // la derniere case est pleine : une page de plus, au meme decoupage
      const cur = P.pages[P.pages.length - 1], layout = clone(cur.layout);
      (function renum(n, app) { if (n.t === "leaf") n.id = app.newId(); else n.c.forEach((c) => renum(c, app)); })(layout, this);
      P.pages.push({ id: "pg" + P.nextId++, page: clone(cur.page), layout, panels: {} });
      listSlots(); added = true;
    }
    const moving = added ? C : C.slice(0, -1), map = {};
    for (let k = moving.length - 1; k >= 0; k--) {        // de la fin vers le debut : rien n'est ecrase avant d'etre deplace
      const t = slots[i0 + 1 + k], c = moving[k];
      if (c.pan) t.pg.panels[t.id] = c.pan; else delete t.pg.panels[t.id];
      map[slots[i0 + k].id] = t;
      const tn = noteOf(t);
      if (tn) tn.text = c.text;
      else if (c.text.trim()) {                            // pas de cadre sous la case d'arrivee : on en pose un, comme celui d'origine
        const geom = compute(t.pg.page, t.pg.layout), g = geom.panels.find((q) => q.id === t.id), r = g && this.roomUnder(geom, t.pg.page, g);
        (t.pg.notes = t.pg.notes || []).push(Object.assign({}, c.note, r || {}, { id: uid(), under: t.id, text: c.text }));
      }
    }
    delete slots[i0].pg.panels[pid];
    const n0 = noteOf(slots[i0]); if (n0) n0.text = "";
    for (const d of P.decks || []) for (const c of d.clips || []) { const t = map[c.panel]; if (t) { c.page = t.pg.id; c.panel = t.id; } }
    let moved = false;
    for (const j of Object.values(this.pending || {})) if (j.project === P.id && map[j.pid]) { j.pid = map[j.pid].id; moved = true; }
    if (moved) localStorage.setItem("bw.pending", JSON.stringify(this.pending));
    this.pageIndex = P.pages.indexOf(slots[i0].pg); this.sel = { panel: pid };
    this.commit("insert-case"); this.refresh();
    toast(added ? tt("Case insérée : la suite recule d'une case, et une page s'ajoute à la fin pour la dernière. Ctrl+Z pour revenir.") : tt("Case insérée : la suite recule d'une case. Ctrl+Z pour revenir."));
  }
  restorePanel(pid) {
    const pg = this.page(), pan = pg.panels[pid];
    if (!pan || !Object.keys(pan).length) return toast(tt("Cette case est déjà vide."));
    const n = (k) => (pan[k] || []).length, tr = pan.anim && pan.anim.tracks ? Object.values(pan.anim.tracks).reduce((a, k) => a + (k || []).length, 0) : 0;
    const what = [n("layers") && tt`${n("layers")} élément(s)`, pan.bg && tt("le décor"), n("bubbles") && tt`${n("bubbles")} bulle(s)`, n("marks") && tt`${n("marks")} indication(s)`,
      pan.draw && tt("le fond dessiné"), pan.ground && tt("la carte de sol"), tr && tt`le montage (${tr} clé(s))`, (pan.integrated || pan.orbit) && tt("les rendus Integrate et l'orbite")].filter(Boolean);
    const nl = String.fromCharCode(10).repeat(2);
    if (!confirm(tt("Vider entièrement cette case ?") + nl + tt`Tout ce qu'elle contient part : ${what.join(", ") || tt("ses réglages")}.` + nl + tt("Ctrl+Z permet de revenir en arrière."))) return;
    delete pg.panels[pid];
    this.sel = { panel: pid };
    this.commit("restore"); this.editor.render(); this.refreshInspector();
    toast(tt("Case vidée. Ctrl+Z pour la retrouver."));
  }
  select(sel, keepOverlay) {
    const same = sel.panel === this.sel.panel && sel.layer === this.sel.layer && sel.bubble === this.sel.bubble && sel.mark === this.sel.mark && sel.note === this.sel.note;
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
    // gouttieres : entre les rangees (↕) et entre les colonnes (↔) ; verrou ferme = les deux bougent ensemble
    const gutters = () => {
      const locked = page.gutterV === undefined, GMAX = 1200;
      const set = (key, e) => {
        const v = clamp(+e.target.value || 0, 0, GMAX);
        if (locked) { page.gutter = v; row.querySelectorAll("input").forEach((x) => { if (x !== e.target) x.value = v; }); } else page[key] = v;
        this.editor.render(); this.commitSoon("page-gutter");
      };
      const field = (key, title, sign) => h("label", { title }, sign, h("input", { type: "number", min: 0, max: GMAX, step: 1, value: page[key] ?? page.gutter, on: { input: (e) => set(key, e) } }));
      const row = h("div.row.gutters", h("span", tt("Gouttière")),
        field("gutter", tt("Espace entre les rangées (au-dessus et au-dessous des cases)"), "↕"),
        h("button.mini.lock" + (locked ? ".on" : ""), { title: locked ? tt("Verrouillé : les deux gouttières bougent ensemble. Cliquer pour les régler séparément.") : tt("Déverrouillé : chaque gouttière a sa valeur. Cliquer pour les lier (la valeur ↕ sert pour les deux)."),
          on: { click: () => { if (locked) page.gutterV = page.gutter; else delete page.gutterV; this.editor.render(); this.commit("page-gutter"); this.renderLeft(); } } }, locked ? "🔒" : "🔓"),
        field("gutterV", tt("Espace entre les colonnes (à gauche et à droite des cases)"), "↔"));
      return row;
    };
    left.textContent = "";
    left.append(h("h3", tt("Découpage")),
      h("div.presets", LAYOUTS.map((p) => h("button.preset", { title: p.label, on: { click: () => this.applyLayout(p.make, p.page) } }, presetThumb(p, page)))),
      h("div.row", h("button.mini", { title: tt("Découpage au hasard"), on: { click: () => this.randomLayout() } }, tt("🎲 Hasard")),
        h("button.mini", { title: tt("Les bandes deviennent des colonnes"), on: { click: () => { pg.layout = transpose(pg.layout); this.commit("layout"); this.refresh(); } } }, tt("⟲ Pivoter"))),
      h("div.row", h("button.mini", { on: { click: () => this.split("h") } }, tt("Couper ━")), h("button.mini", { on: { click: () => this.split("v") } }, tt("Couper ┃")),
        h("button.mini.danger", { on: { click: () => this.removePanel() } }, tt("Supprimer la case"))),
      h("button.mini.editcuts" + (this.editCuts ? ".on" : ""), { title: tt("Mode édition des cases : les traits entre les cases apparaissent au survol, on les glisse pour changer la taille des cases. Hors de ce mode, ils restent cachés."),
        on: { click: () => { this.editCuts = !this.editCuts; localStorage.setItem("bw.editCuts", this.editCuts ? "1" : ""); this.editor.render(true); this.renderLeft(); } } }, this.editCuts ? tt("✓ Édition des cases") : tt("✂ Éditer les cases")),
      this.editCuts ? h("p.muted", tt("Glisse un trait pour le déplacer, un de ses bouts pour l'incliner (Maj : trait droit).")) : "",
      h("h3", tt("Cadres de texte")),
      h("div.row.wrap", h("button.mini", { title: tt("Un cadre de texte posé sur la page, n'importe où : titre de page, annotation, indication. Double-clic pour écrire dedans."), on: { click: () => this.addNote() } }, tt("▭ Cadre de texte")),
        h("button.mini", { title: tt("Un cadre de texte sous chaque case, dans la place libre en dessous (storyboard annoté)"), on: { click: () => this.notesUnder() } }, tt("▤ Annotations sous les cases"))),
      h("h3", tt("Page")),
      h("label.row", tt("Format"), h("select", { on: { change: (e) => { const f = FORMATS.find((x) => x.id === e.target.value);
        Object.assign(page, { format: f.id, width: f.w, height: f.h }); this.commit("format"); this.refresh(); } } },
        FORMATS.map((f) => h("option", { value: f.id, selected: f.id === page.format }, f.label)))),
      gutters(), num(tt("Marge"), "margin", 0, 400), num(tt("Trait"), "strokeWidth", 0, 40),
      // placement de toutes les cases d'un bloc : de la place en bas pour ecrire, et le bloc decale vers le haut ou le cote
      h("details.fold", { open: !!(page.under || page.room || page.dx || page.dy) }, h("summary", tt("Placement des cases")),
        ...[[tt("Place sous chaque rangée"), "under", 0, 0.35, tt("La même place sous chaque rangée de cases, la dernière comprise, pour écrire : les cases remontent et rétrécissent.")],
            [tt("Décaler ↕"), "dy", -0.3, 0.3, tt("Toutes les cases montent (curseur à gauche) ou descendent (curseur à droite), d'un bloc.")],
            [tt("Décaler ↔"), "dx", -0.3, 0.3, tt("Toutes les cases glissent sur le côté, d'un bloc.")]].map(([label, key, min, max, tip]) => {
          const pc = (v) => Math.round(v * 100) + " %", out = h("output", pc(page[key] || 0));
          return h("label.row.range", { title: tip }, label, h("input", { type: "range", min, max, step: 0.005, value: page[key] || 0,
            on: { input: (e) => { const v = +e.target.value; if (Math.abs(v) < 0.004) delete page[key]; else page[key] = v; out.textContent = pc(v); if (key === "under") this.fit169(); this.reflowNotes(); this.editor.render(); this.commitSoon("page-place"); } } }), out); }),
        h("label.row.check", { title: tt("Quand la place sous les rangées grandit, les cases rétrécissent aussi en largeur et restent centrées : elles gardent leur format 16/9.") },
          h("input", { type: "checkbox", checked: page.keep169 ?? page.gutter0 !== undefined, on: { change: (e) => { page.keep169 = e.target.checked; this.fit169(); this.reflowNotes(); this.editor.render(); this.commit("page-place"); } } }), tt("Garder les cases en 16/9")),
        h("div.row.wrap",
          h("button.mini", { title: tt("Toutes les cases de la même taille, au format de celle qui remplit le mieux le cadre : le bloc se resserre sur les côtés ou en hauteur. Un trait penché garde sa pente."),
            on: { click: () => { const pg = this.page(), r = equalizeBest(pg.page, pg.layout); this.reflowNotes(); this.editor.render(); this.commit("page-equal"); this.renderLeft();
              toast(tt`Cases égalisées au format ${r.toFixed(2)} (largeur / hauteur). Ctrl+Z pour revenir.`); } } }, tt("▦ Égaliser les cases")),
          h("button.mini", { title: tt("Le bloc de cases colle au haut de la page"), on: { click: () => { page.dy = -Math.max(0, page.margin - page.height * 0.012) / page.height; this.reflowNotes(); this.editor.render(); this.commit("page-place"); this.renderLeft(); } } }, tt("⤒ Tout en haut")),
          h("button.mini", { title: tt("Cases à leur place : sans décalage ni place libre ajoutée"), on: { click: () => { delete page.dx; delete page.dy; delete page.room; delete page.under; delete page.mx; this.reflowNotes(); this.editor.render(); this.commit("page-place"); this.renderLeft(); } } }, tt("Recentrer")))),
      h("details.fold", { open: !!(page.hand > 0) }, h("summary", tt("Tremblé du contour")), ...[[tt("Tremblé"), "hand", 0, 10, 0], [tt("Ondulation"), "wave", 0.5, 12, 4]].map(([label, key, min, max, def]) => {
        const val = page[key] ?? def, out = h("output", fmt(val));
        return h("label.row.range", label, h("input", { type: "range", min, max, step: 0.1, value: val,
          on: { input: (e) => { page[key] = +e.target.value; out.textContent = fmt(page[key]); this.editor.render(); this.commitSoon("page-hand"); } } }), out); })),
      col(tt("Fond de page"), "bg"), col(tt("Fond des cases"), "fill"), col(tt("Couleur du trait"), "stroke"),
      h("h3", tt("Toute la page")),
      h("div.row", h("button.mini", { title: tt("Chaque case composée devient un dessin homogène"), on: { click: () => this.integratePage("dessin") } }, tt("✦ Tout en dessin")),
        h("button.mini", { title: tt("Chaque case composée devient une photo unifiée"), on: { click: () => this.integratePage("photo") } }, tt("✦ Tout en photo"))),
      h("div.row", h("button.mini", { on: { click: () => this.showAll("layers") } }, tt("Voir les calques")),
        h("button.mini", { on: { click: () => this.showAll("integrated") } }, tt("Voir les intégrées"))));
  }

  fit169() {                                              // cases gardees en 16/9 quand la place sous les rangees change
    const pg = this.page(), P = pg.page;
    const mx = P.under && (P.keep169 ?? P.gutter0 !== undefined) ? keep169(P, pg.layout) : null;
    if (mx) P.mx = Math.round(mx); else delete P.mx;
  }
  applyLayout(make, pageFix) {
    const pg = this.page();
    const old = compute(pg.page, pg.layout).panels.sort((a, b) => a.order - b.order).map((g) => g.id);
    let i = 0; const used = [];
    const P = pg.page;
    if (P.gutter0 !== undefined) { P.gutter = P.gutter0; delete P.gutterV; delete P.gutter0; }   // on quitte le storyboard : la gouttiere d'avant revient
    delete P.marginB; delete P.mx;                         // marge du bas propre au storyboard annote ; marges des cotes en 16/9
    pg.layout = make(() => { const id = i < old.length ? old[i] : this.newId(); i++; used.push(id); return { t: "leaf", id }; }, pg.page);
    if (pageFix) { const g0 = P.gutter; Object.assign(P, pageFix(P)); P.gutter0 = g0; }   // decoupage qui regle aussi la page (gouttieres du storyboard)
    for (const id of Object.keys(pg.panels)) if (!used.includes(id)) delete pg.panels[id];
    this.fit169();
    this.sel = {}; this.commit("layout"); this.refresh();
  }
  randomLayout() {
    const n = Math.max(2, Math.min(9, leaves(this.page().layout).length));
    this.applyLayout((L) => transposeIf(this.page().page, randomLayout(Math.floor(Math.random() * 1e9), n, 0.06, () => L().id)));
  }
  split(dir) {
    const pg = this.page();
    if (!this.sel.panel) return toast(tt("Choisis d'abord une case."));
    pg.layout = splitLeaf(pg.layout, this.sel.panel, dir, this.newId(), "c" + this.project.nextId++);
    this.commit("layout"); this.refresh();
  }
  removePanel() {
    const pg = this.page(), id = this.sel.panel;
    if (!id) return toast(tt("Choisis d'abord une case."));
    if (leaves(pg.layout).length < 2) return toast(tt("C'est la dernière case de la page."));
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
    } catch (e) { toast(tt("Image refusée : ") + e.message, "error"); }
  }

  // generation depuis une case : « genere-moi un marteau » ; l'element entre en banque et se pose ici des qu'il existe
  // « Generer un asset / un personnage » : une description, un croquis rough (facultatif) qui guide la pose et la composition,
  // jusqu'a 15 dessins de reference pour le style (GPT Image 2.5 prend 16 images en tout), et des cases a cocher pour ce qu'on
  // veut obtenir : l'image seule, sa tournette, la pose en A sur fond de couleur (personnage).
  genDialog(kind) {
    const MAXREF = 15, refs = [];
    let sketch = null;
    const toData = (file) => new Promise((ok, ko) => {              // reduite a 1280 px de cote au plus : assez pour guider
      const fr = new FileReader();
      fr.onerror = () => ko(new Error(tt("image illisible")));
      fr.onload = () => { const im = new Image(); im.onerror = () => ko(new Error(tt("image illisible"))); im.onload = () => {
        const k = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/png")); }; im.src = fr.result; };
      fr.readAsDataURL(file);
    });
    const prompt = h("textarea", { rows: 3, placeholder: kind === "character" ? tt("Une vieille aviatrice en blouson de cuir, lunettes sur le front, sourire en coin…") : tt("Un vieux tracteur rouge, pneus boueux, cabine ouverte…") });
    const name = h("input", { type: "text", placeholder: tt("Nom (facultatif : sinon le début de la description)") });
    // dossier de destination : celui ouvert dans la banque s'il est du meme onglet ; la liste propose les dossiers existants
    const B = this.bankUI, here = B.tab === kind && B.folder && B.folder !== "·" ? B.folder : "", lid = "genfolders-" + kind;
    const folderList = h("datalist", { id: lid }, B.folders(kind).map((x) => h("option", { value: x })));
    const folderIn = h("input", { type: "text", value: here, list: lid, placeholder: tt("Racine de la banque") });
    const style = h("select", [["dessin", tt("Dessin")], ["photo", tt("Photoréaliste")], ["3d", "3D"]].map(([v, t]) => h("option", { value: v }, t)));
    const view = h("select", [["", tt("De face")], ["dessus", tt("De face, légèrement du dessus")], ["dessous", tt("De face, légèrement d'en dessous")]].map(([v, t]) => h("option", { value: v }, t)));
    const sketchBox = h("div.genrefs.one"), refBox = h("div.genrefs"), count = h("span.muted");
    const pickIn = (multi, onFiles) => { const i = h("input", { type: "file", accept: "image/*", multiple: multi, style: { display: "none" }, on: { change: async (e) => { await onFiles([...e.target.files]); e.target.value = ""; } } }); return i; };
    const thumb = (src, drop) => { const t = h("div.genthumb", h("img", { src }), h("button.mini", { title: tt("Retirer"), on: { click: drop } }, "✕")); return t; };
    const draw = () => {
      sketchBox.textContent = ""; refBox.textContent = "";
      sketchBox.append(sketch ? thumb(sketch, () => { sketch = null; draw(); }) : h("button.mini", { on: { click: () => sIn.click() } }, tt("＋ Croquis…")));
      refs.forEach((r, i) => refBox.append(thumb(r, () => { refs.splice(i, 1); draw(); })));
      if (refs.length < MAXREF) refBox.append(h("button.mini", { on: { click: () => rIn.click() } }, tt("＋ Dessins de référence…")));
      count.textContent = tt`${refs.length} / ${MAXREF}`;
      est();
    };
    const addRefs = async (files) => { for (const f of files.slice(0, MAXREF - refs.length)) refs.push(await toData(f)); if (files.length > MAXREF - refs.length) toast(tt`${MAXREF} dessins de référence au plus.`); draw(); };
    const sIn = pickIn(false, async (f) => { if (f[0]) { sketch = await toData(f[0]); draw(); } }), rIn = pickIn(true, addRefs);
    const dropZone = (el, onFiles) => { el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); }); el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", async (e) => { e.preventDefault(); el.classList.remove("over"); const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/")); if (f.length) await onFiles(f); }); };
    dropZone(sketchBox, async (f) => { sketch = await toData(f[0]); draw(); }); dropZone(refBox, addRefs);
    const orbit = h("input", { type: "checkbox", checked: true }), apose = h("input", { type: "checkbox", checked: false });
    const note = h("p.muted.genest");
    function est() {                                       // ce qui va partir, et ce que ca coute
      const guided = !!sketch || refs.length > 0, parts = [];
      parts.push(guided ? tt("image : GPT Image 2.5 sur fal, ≈ 0,02 $") : tt("image : générateur habituel"));
      if (kind === "character" && apose.checked) parts.push(tt("pose en A sur fond de couleur, à valider dans la fiche (la tournette attend la validation)"));
      else if (orbit.checked) parts.push(tt("détourage et tournette 360° (≈ 0,31 $ si elle part sur fal, gratuite sur tes machines)"));
      else parts.push(tt("détourage seulement"));
      note.textContent = parts.join(" · ");
    }
    orbit.addEventListener("change", est); apose.addEventListener("change", est);
    modal(kind === "character" ? tt("Générer un personnage") : tt("Générer un asset"), h("div.form.genform",
      h("label.col", tt("Description"), prompt),
      h("div.col", h("span", tt("Croquis (facultatif) : un rough qui guide la pose et la composition")), sketchBox, sIn),
      h("div.col", h("span", tt("Dessins de référence pour le style (facultatif) "), count), refBox, rIn,
        h("p.muted", tt("Ils disent le style à obtenir : trait, couleurs, rendu. Leurs sujets ne sont pas recopiés. Glisse des images ici ou clique le bouton."))),
      h("div.row", h("label.row", tt("Rendu"), style), h("label.row", tt("Nom"), name)),
      h("label.row", { title: tt("Dossier de la banque où ranger l'élément : un dossier existant (liste) ou un nouveau nom ; « / » pour un sous-dossier. Vide : à la racine.") }, tt("Dossier"), folderIn, folderList),
      kind === "asset" ? h("label.row", { title: tt("L'objet est vu de face par défaut ; un peu du dessus ou un peu d'en dessous au choix") }, tt("Vue"), view) : "",
      h("h4", tt("Ce qu'on génère")),
      h("label.row.check", h("input", { type: "checkbox", checked: true, disabled: true }), tt("L'image, rangée dans la banque")),
      h("label.row.check", orbit, tt("Sa tournette 360° (pivotable dans les cases)")),
      kind === "character" ? h("label.row.check", { title: tt("Première étape d'un personnage : sa pose en A sur un fond uni, que tu valides dans la fiche ; ensuite les poses et la tournette sont découpées par la couleur, sans trous.") }, apose, tt("D'abord la pose en A sur fond de couleur (à valider)")) : "",
      note),
      [{ label: tt("Annuler") }, { label: tt("Générer"), primary: true, click: async () => {
        const text = prompt.value.trim();
        if (!text) { toast(tt("Décris ce qu'il faut générer."), "error"); return false; }
        const f = folderIn.value.trim().replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");
        try {
          await post("bank/generate", { kind, name: (name.value.trim() || text).slice(0, 36), prompt: text, style: style.value, view: kind === "asset" ? view.value : "", orbit: orbit.checked,
                                        apose: kind === "character" && apose.checked, sketch, refs, folder: f, target: target() });
        } catch (e) { toast(tt("Refusé : ") + e.message, "error"); return false; }
        toast(tt("Génération lancée : l'élément arrivera dans la banque.")); this.pollSoon();
      } }]);
    draw();
    setTimeout(() => prompt.focus(), 30);
  }
  generateHere(pid, rel) {
    const prompt = h("textarea", { rows: 3, placeholder: tt("Un marteau de charpentier usé, manche en bois…") });
    const kind = h("select", [["asset", tt("Objet / véhicule")], ["character", tt("Personnage")], ["decor", tt("Décor (devient le fond)")]].map(([v, t]) => h("option", { value: v }, t)));
    const style = h("select", [["photo", tt("Photoréaliste")], ["dessin", tt("Dessin")], ["3d", "3D"]].map(([v, t]) => h("option", { value: v, selected: v === this.guessStyle(this.findPanel(pid) || {}) }, t)));
    const orbit = h("input", { type: "checkbox", checked: true });
    const B = this.bankUI, folderList = h("datalist", { id: "genherefolders" }), folderIn = h("input", { type: "text", list: "genherefolders", placeholder: tt("Racine de la banque"),
      value: B.tab === "asset" && B.folder && B.folder !== "·" ? B.folder : "" });
    const fill = () => { folderList.textContent = ""; folderList.append(...B.folders(kind.value).map((x) => h("option", { value: x }))); };
    kind.addEventListener("change", fill); fill();
    modal(tt("Générer dans cette case"), h("div.form", h("label.col", tt("Quoi ?"), prompt), h("label.row", tt("Type"), kind), h("label.row", tt("Rendu"), style),
      h("label.row", { title: tt("Dossier de la banque où ranger l'élément : un dossier existant (liste) ou un nouveau nom ; « / » pour un sous-dossier. Vide : à la racine.") }, tt("Dossier"), folderIn, folderList),
      h("label.row.check", orbit, tt("Avec son orbite 360° (pivotable ensuite)")),
      h("p.muted", tt("L'élément est ajouté à la banque : il resservira. Il se pose dans la case dès que son image existe (≈ 1 min), puis devient pivotable."))),
      [{ label: tt("Annuler") }, { label: tt("Générer"), primary: true, click: async () => {
        const text = prompt.value.trim();
        if (!text) { toast(tt("Décris ce qu'il faut générer."), "error"); return false; }
        const f = folderIn.value.trim().replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");
        const r = await post("bank/generate", { kind: kind.value, name: text.slice(0, 36), prompt: text, style: style.value, orbit: orbit.checked,
                                                folder: f, target: target() });
        this.pending[r.job] = { project: this.project.id, pid, rel };
        localStorage.setItem("bw.pending", JSON.stringify(this.pending));
        toast(tt("Génération lancée : l'élément se posera dans la case.")); this.pollSoon();
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
  /** « Remplacer par… » : un autre element de la banque prend la place du calque (meme place, meme hauteur, meme miroir,
   *  meme axe si les deux tournent). */
  async replaceLayer(l) {
    const old = this.bank.get(l.item);
    const pick = await this.bankUI.pickItem(old ? old.kind : "character", tt`Remplacer « ${old ? old.name : "?"} » par…`);
    if (!pick || pick.id === l.item && pick.v === l.v) return;
    const a = variantOf(old, l.v), it = this.bank.get(pick.id), b = variantOf(it, pick.v);
    const ang = a && a.orbit ? frameToAngle(a.orbit, l.f || 0) : 0;
    l.item = pick.id; l.v = pick.v; l.f = b && b.orbit ? angleToFrame(b.orbit, ang) : 0;
    delete l.exk;                                            // les expressions sont celles de l'ancien personnage
    this.commit("replace"); this.editor.render(); this.refreshInspector();
    toast(tt`« ${old ? old.name : "?"} » remplacé par « ${it.name} ».`);
  }
  // ---------------------------------------------------------------- cases enregistrees (onglet Cases)
  saveCase(pid) {
    const pan = pid && this.page().panels[pid], g = pid && this.geo(pid);
    if (!pan || !g || (!pan.bg && !(pan.layers || []).length && !pan.draw)) return toast(tt("Choisis d'abord une case remplie."));
    const names = (pan.layers || []).map((l) => this.bank.get(l.item)?.name).filter(Boolean);
    const name = h("input", { type: "text", value: (this.project.name + " · " + tt`case ${g.order}`) + (names.length ? " · " + names.slice(0, 3).join(", ") : "") });
    const bf = this.bankUI, cur = (bf.folderBy || {}).case || "", folder = bf.folderInput(cur && cur !== "·" ? cur : "", "case");
    modal(tt("💾 Enregistrer la case"), h("div.form",
      h("p.muted", tt("La case entière (fond et cadrage, personnages et objets, bulles, carte de sol, montage) part dans l'onglet Cases, à glisser dans n'importe quelle case, de n'importe quel storyboard. Les images calculées (Integrate, orbite) ne suivent pas.")),
      h("label.row", tt("Nom"), name), h("label.row", tt("Dossier"), folder)),
      [{ label: tt("Annuler") }, { label: tt("💾 Enregistrer"), primary: true, click: async () => {
        try {
          const blob = await flattenPanel(this, g, 480);
          const thumb = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
          const c = await post("cases", { project: this.project.id, panel: JSON.parse(JSON.stringify(pan)), name: name.value.trim(), folder: folder.querySelector("select").value,
                                          ratio: g.bbox.h / g.bbox.w, thumb });
          await this.bankUI.reload();
          toast(tt`Case enregistrée : « ${c.name} »` + (c.folder ? tt` · dossier « ${c.folder} »` : "") + ".");
        } catch (e) { toast(tt("Case non enregistrée : ") + e.message, "error"); return false; }
      } }]);
  }
  /** Pose une case enregistree dans la case pid (remplace son contenu, Ctrl+Z la retrouve). */
  async dropCase(pid, cid) {
    const pg = this.page(), g = pid && this.geo(pid);
    if (!g) return toast(tt("Choisis d'abord une case où la poser."));
    const cur = pg.panels[pid] || {};
    if ((cur.bg || (cur.layers || []).length || (cur.bubbles || []).length) && !confirm(tt`La case ${g.order} est déjà remplie : la remplacer par la case enregistrée ?`)) return;
    try {
      const data = await get(`cases/${cid}?project=${encodeURIComponent(this.project.id)}`);
      const copy = JSON.parse(JSON.stringify(data.panel || {})), ren = {};
      for (const l of copy.layers || []) { const n = uid(); ren[l.id] = n; l.id = n; }
      for (const b of copy.bubbles || []) b.id = uid();
      for (const m of copy.marks || []) m.id = uid();
      const tr0 = copy.anim && copy.anim.tracks;
      if (tr0) for (const k of Object.keys(tr0)) if (ren[k]) { tr0[ren[k]] = tr0[k]; delete tr0[k]; }
      copy.show = "layers";
      const missing = (copy.layers || []).filter((l) => !this.bank.has(l.item)).length;
      pg.panels[pid] = copy;
      this.commit("case"); this.select({ panel: pid }); this.editor.render(); this.refreshInspector();
      const c = (this.bankUI.cases || []).find((x) => x.id === cid);
      toast(tt`Case « ${c ? c.name : cid} » posée dans la case ${g.order}.` + (missing ? tt` ${missing} élément(s) ne sont plus dans la banque.` : "") + tt(" Ctrl+Z pour revenir."));
    } catch (e) { toast(tt("Case non posée : ") + e.message, "error"); }
  }
  /** Verrouiller un element : il ne se prend plus a la souris (le clic passe a travers, sur la case) ; clic droit pour le liberer. */
  toggleLock(l) {
    if (l.lock) delete l.lock; else l.lock = 1;
    this.commit("lock"); this.editor.render(); this.refreshInspector();
    toast(l.lock ? tt("Élément verrouillé : il ne bouge plus à la souris. Clic droit dessus pour le déverrouiller.") : tt("Élément déverrouillé."));
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
    if (!others.length) return toast(tt("Il n'y a pas d'autre case sur cette page."));
    const boxes = others.map((g) => [g, h("input", { type: "checkbox" })]);
    const all = h("button.mini", { on: { click: (e) => { e.preventDefault(); const on = boxes.some(([, c]) => !c.checked); boxes.forEach(([, c]) => { c.checked = on; }); } } }, tt("Toutes / aucune"));
    modal(tt`Copier « ${item ? item.name : tt("l'élément")} » vers…`, h("div.form",
      h("p.muted", tt("L'élément est ajouté dans les cases cochées avec la même pose, le même axe, la même place et la même taille. Si une case a déjà des éléments, on te demandera de les garder ou de les remplacer.")),
      h("div.checks", boxes.map(([g, c]) => h("label.row.check", c, tt`Case ${g.order}`))), h("div.row", all)),
      [{ label: tt("Annuler") }, { label: tt("Copier"), primary: true, click: () => {
        const to = boxes.filter(([, c]) => c.checked).map(([g]) => g);
        if (!to.length) { toast(tt("Coche au moins une case."), "error"); return false; }
        // une case d'arrivee qui a deja des elements (calques) : ajouter, ou remplacer ses elements ; son fond, ses bulles
        // et ses reperes ne sont jamais touches (la copie ne porte que sur un element)
        const apply = (replace) => {
          for (const g of to) {
            const pan = pg.panels[g.id] || (pg.panels[g.id] = {});
            if (replace && pan.layers && pan.layers.length) {
              if (pan.anim && pan.anim.tracks) for (const x of pan.layers) delete pan.anim.tracks[x.id];   // les pistes des elements retires
              pan.layers = [];
            }
            (pan.layers = pan.layers || []).push(Object.assign(clone(l), { id: uid() })); pan.show = "layers";
          }
          this.commit("copy-layer"); this.editor.render(); this.refreshInspector();   // une seule etape : Ctrl+Z annule tout
          toast((replace ? tt("Éléments remplacés dans ") : tt("Élément copié vers ")) + to.map((g) => g.order).join(", ") + ".");
        };
        const full = to.filter((g) => ((pg.panels[g.id] || {}).layers || []).length);
        if (!full.length) return apply(false);
        modal(tt("Case déjà occupée"), h("div.form",
          h("p", full.length > 1 ? tt`Les cases ${full.map((g) => g.order).join(", ")} contiennent déjà des éléments.` : tt`La case ${full[0].order} contient déjà ${(pg.panels[full[0].id].layers || []).length} élément(s).`),
          h("p.muted", tt("Ajouter : la copie s'ajoute, rien n'est retiré. Remplacer : la copie prend la place des éléments de la case ; le fond, les bulles et les repères restent."))),
          [{ label: tt("Annuler") }, { label: tt("Ajouter aux éléments"), primary: true, click: () => apply(false) }, { label: tt("Remplacer les éléments"), primary: true, click: () => apply(true) }]);
      } }]);
  }

  layerMenu(e) {
    const l = this.layer(); if (!l) return;
    // en haut, les gestes directs ; puis un sous-menu par theme (Pose, Expression, Axe, Calque), ouvert au survol
    const item = this.bank.get(l.item), v = variantOf(item, l.v), items = [{ label: tt("🎬 Montage (animer la case)… (Tab)"), star: true, click: () => openMontage(this, this.sel.panel) },
      { label: tt("✎ Dessiner le fond… (Q)"), star: "blue", click: () => this.drawBackground(this.sel.panel) },
      { label: tt("📍 Montrer dans la banque"), click: () => this.bankUI.reveal(l.item) },
      { label: tt("🔄 Remplacer par…"), click: () => this.replaceLayer(l) },
      { label: l.lock ? tt("🔓 Déverrouiller l'élément") : tt("🔒 Verrouiller l'élément"), click: () => this.toggleLock(l) },
      { label: tt("Générer d'autres poses…"), click: () => this.bankUI.openItem(l.item) }];
    // ↻ : orbite calculee, la pose tourne · ⏳ : orbite en calcul · ▫ : image fixe, pas d'orbite
    const poses = Object.entries(item?.variants || {}).map(([k, vv]) => ({ label: (vv.orbit ? "↻ " : this.jobsFor(l.item, k) ? "⏳ " : "▫ ") + tr(vv.label), checked: k === l.v, click: () => this.setPose(l, k) }));
    poses.push({ note: tt("↻ orbite prête · ⏳ en calcul · ▫ image fixe") });
    items.push({ sub: tt("Pose"), value: v ? tr(v.label) : "", items: poses });
    {                                                     // expression du visage (cartes de l'orbite, app/exprcards.py) ; la bouche du lip sync passe par-dessus
      const sp = item && sprite(item, l.v, l.f), ex = (sp && sp.expr && sp.exprs) || [];
      const exs = ex.length ? ["", ...ex].map((k) => ({ label: exprName(k), checked: (l.exk || "") === k,
        click: () => { if (k) l.exk = k; else delete l.exk; this.commit("expr"); this.editor.render(); this.refreshInspector(); } }))
        : [{ note: tt("Pas encore d'expressions pour ce personnage.") }];
      items.push({ sub: tt("Expression"), value: ex.length ? exprName(l.exk || "") : "", items: exs });
    }
    if (v && v.orbit) {
      const cur = nearestAxis(v.orbit, l.f || 0);
      items.push({ sub: tt("Axe"), value: tr(cur), items: AXES.map((a) => ({ label: tr(a), checked: a === cur, click: () => this.setAxis(l, a), half: true })) });
    }
    items.push({ sub: tt("Calque"), items: [
      { label: tt("Miroir"), checked: !!l.flip, click: () => { l.flip = !l.flip; this.commit("flip"); this.editor.render(); } },
      { label: tt("Premier plan"), click: () => this.order(l, "top"), half: true }, { label: tt("Arrière-plan"), click: () => this.order(l, "bottom"), half: true },
      { label: tt("Avancer"), click: () => this.order(l, "up"), half: true }, { label: tt("Reculer"), click: () => this.order(l, "down"), half: true },
      { label: tt("Dupliquer"), click: () => this.duplicate(l), half: true }, { label: tt("Supprimer"), click: () => this.removeLayer(l), half: true, danger: true },
      { label: tt("Copier vers une case…"), click: () => this.copyLayerTo(l) }] });
    menu(e, items);
  }

  panelMenu(e, pid, pt, g) {
    const pan = this.curPanel(), items = [{ label: tt("🎬 Montage (animer la case)… (Tab)"), star: true, click: () => openMontage(this, pid) },
      { label: tt("✎ Dessiner le fond… (Q)"), star: "blue", click: () => this.drawBackground(pid) }, { head: tt("Bulle") }];
    const rel = { x: (pt.x - g.bbox.x0) / g.bbox.w, y: (pt.y - g.bbox.y0) / g.bbox.h };
    for (const [t, [label]] of Object.entries(BUB)) items.push({ label, click: () => this.addBubble(t, rel), half: true });
    items.push({ head: tt("Indication") });
    for (const [t, [label, ico]] of Object.entries(MARKS)) items.push({ label: `${ico} ${label}`, half: true, click: () => (t === "free" ? this.armMark(t) : this.addMark(pid, t, [rel.x, rel.y])) });
    items.push({ head: tt("Banque") }, { label: tt("✨ Générer un élément ici…"), click: () => this.generateHere(pid, rel) });
    items.push({ head: tt("Integrate (image unifiée)") },
      ...INTEGRATE_STYLES.map(([k, label, tip]) => ({ label, click: () => this.integrate(k) })),
      { head: tt("Case") }, { label: tt("⬒ Profondeur (vue de dessus)"), click: () => this.depthDialog(pid) }, { label: tt("Orbite de la case"), click: () => this.panelOrbit() },
      { label: tt("💾 Enregistrer la case…"), click: () => this.saveCase(pid) },
      { label: tt("➕ Insérer une case ici (la suite recule d'une case)"), click: () => this.insertCase(pid) },
      { label: tt("🧹 Restore case (tout vider)"), danger: true, click: () => this.restorePanel(pid) });
    if (pan.integrated || pan.orbit) {
      items.push({ head: tt("Afficher") }, { label: tt("Calques d'origine"), checked: (pan.show || "layers") === "layers", click: () => this.setShow("layers") });
      // les images generees de la case (Integrate) : on passe de l'une a l'autre, ou on revient aux calques d'origine
      const vers = (pan.integrations || []).length ? pan.integrations : (pan.integrated ? [pan.integrated] : []);
      vers.forEach((f, i) => {
        const ts = +((f.match(/_(\d{9,})\.\w+$/) || [])[1] || 0), when = ts ? new Date(ts * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        items.push({ label: tt`Image générée ${i + 1}${when ? " · " + when : ""}`, checked: pan.show === "integrated" && pan.integrated === f,
                     click: () => { pan.integrated = f; pan.show = "integrated"; this.commit("ver"); this.editor.render(); this.refreshInspector(); } });
      });
      if (pan.show === "integrated" && vers.length) items.push({ label: tt("Retirer l'image affichée de la liste"), danger: true, click: () => {
        const left = vers.filter((f) => f !== pan.integrated);
        pan.integrations = left; pan.integrated = left[left.length - 1] || null; if (!pan.integrated) { delete pan.integrated; pan.show = "layers"; }
        this.commit("ver"); this.editor.render(); this.refreshInspector(); } });
      if (pan.orbit) items.push({ label: tt("Orbite"), checked: pan.show === "orbit", click: () => this.setShow("orbit") });
      if (pan.orbit && pan.show === "orbit") items.push({ label: tt("↻ Recalculer la perspective (cet angle de l'orbite)…"), star: true, click: () => this.orbitPlace() });
    }
    if (this.editor.geom.panels.length > 1) items.push({ label: tt("Copier cette case vers…"), click: () => this.copyPanelTo(pid) });
    items.push({ head: tt("Découpage") }, { label: tt("Couper ━"), click: () => this.split("h"), half: true }, { label: tt("Couper ┃"), click: () => this.split("v"), half: true });
    if (pan.bg) items.push({ label: tt("Retirer le fond"), click: () => { delete pan.bg; this.commit("bg"); this.editor.render(); this.refreshInspector(); } });
    items.push({ label: tt("Vider la case"), danger: true, click: () => { this.page().panels[pid] = {}; this.commit("clear"); this.editor.render(); this.refreshInspector(); } });
    menu(e, items);
  }
  // copie tout le contenu d'une case (fond, cadrage, calques, bulles, profondeur de champ) dans d'autres cases de la page
  copyPanelTo(pid) {
    const pg = this.page(), src = pg.panels[pid] || {}, from = this.geo(pid);
    const others = this.editor.geom.panels.filter((g) => g.id !== pid).sort((x, y) => x.order - y.order);
    const filled = (g) => { const q = pg.panels[g.id] || {}; return !!(q.bg || (q.layers || []).length || (q.bubbles || []).length); };
    const boxes = others.map((g) => [g, h("input", { type: "checkbox" })]);
    const all = h("button.mini", { on: { click: (e) => { e.preventDefault(); const on = boxes.some(([, c]) => !c.checked); boxes.forEach(([, c]) => { c.checked = on; }); } } }, tt("Toutes / aucune"));
    modal(tt`Copier la case ${from ? from.order : ""} vers…`, h("div.form",
      h("p.muted", tt("Tout est copié : fond et cadrage, personnages et objets, bulles, profondeur de champ. Si une case cochée est déjà remplie, on te demandera d'ajouter ou de remplacer.")),
      h("div.checks", boxes.map(([g, c]) => h("label.row.check", c, tt`Case ${g.order}`, filled(g) ? h("span.muted", tt(" (déjà remplie)")) : ""))), h("div.row", all)),
      [{ label: tt("Annuler") }, { label: tt("Copier"), primary: true, click: () => {
        const to = boxes.filter(([, c]) => c.checked).map(([g]) => g);
        if (!to.length) { toast(tt("Coche au moins une case."), "error"); return false; }
        // une copie neuve de la case d'origine : nouveaux identifiants, pistes d'animation renommees avec leurs calques
        const fresh = () => {
          const copy = JSON.parse(JSON.stringify(src)), ren = {};
          for (const k of ["integrated", "integrations", "orbit"]) delete copy[k];   // images calculées pour la case d'origine
          copy.show = "layers";
          for (const l of copy.layers || []) { const n = uid(); ren[l.id] = n; l.id = n; }
          for (const b of copy.bubbles || []) b.id = uid();
          for (const m of copy.marks || []) m.id = uid();
          const tr0 = copy.anim && copy.anim.tracks;
          if (tr0) for (const k of Object.keys(tr0)) if (ren[k]) { tr0[ren[k]] = tr0[k]; delete tr0[k]; }
          return copy;
        };
        // ajouter : personnages et objets, bulles et reperes s'ajoutent ; le fond, le cadrage et le dessin du fond de la
        // case d'arrivee restent (une case sans fond prend celui de la copie), son animation aussi, avec les pistes des
        // elements ajoutes
        const add = (dst, copy) => {
          for (const k of ["layers", "bubbles", "marks"]) if ((copy[k] || []).length) dst[k] = (dst[k] || []).concat(copy[k]);
          if (!dst.bg && copy.bg) { dst.bg = copy.bg; if (copy.view) dst.view = copy.view; if (copy.draw && !dst.draw) dst.draw = copy.draw; }
          const tr0 = copy.anim && copy.anim.tracks, ids = new Set((copy.layers || []).map((l) => l.id));
          if (tr0) for (const k of Object.keys(tr0)) if (ids.has(k)) { dst.anim = dst.anim || { dur: copy.anim.dur || 4, tracks: {} }; (dst.anim.tracks = dst.anim.tracks || {})[k] = tr0[k]; }
          delete dst.integrated; dst.show = "layers";
        };
        const apply = (mode) => {
          for (const g of to) {
            const copy = fresh();
            if (mode === "add" && filled(g)) add(pg.panels[g.id], copy); else pg.panels[g.id] = copy;
          }
          this.commit("copy"); this.editor.render(); this.refreshInspector();   // une seule etape : Ctrl+Z annule tout
          toast((mode === "add" ? tt("Case ajoutée dans ") : tt("Case copiée vers ")) + to.map((g) => g.order).join(", ") + ".");
        };
        const full = to.filter(filled);
        if (!full.length) return apply("replace");
        modal(tt("Case déjà occupée"), h("div.form",
          h("p", full.length > 1 ? tt`Les cases ${full.map((g) => g.order).join(", ")} contiennent déjà des éléments.` : tt`La case ${full[0].order} contient déjà des éléments.`),
          h("p.muted", tt("Ajouter : les personnages, objets, bulles et repères copiés s'ajoutent ; le fond et le cadrage de la case restent. Remplacer : la case devient une copie exacte, fond compris."))),
          [{ label: tt("Annuler") }, { label: tt("Ajouter aux éléments"), primary: true, click: () => apply("add") }, { label: tt("Remplacer les éléments"), primary: true, click: () => apply("replace") }]);
      } }]);
  }
  // atelier de dessin du fond de la case : formes simples, traces, gris en trame
  drawBackground(pid) {
    const pg = this.page(), pan = pg.panels[pid] || (pg.panels[pid] = {}), g = this.geo(pid);
    if (!g) return;
    const bg = background(pan, this.bank, this.project.id);
    const ghosts = (pan.layers || []).map((l) => { const it = this.bank.get(l.item), sp = it && sprite(it, l.v, l.f); return sp && { url: sp.url, x: l.x, y: l.y, s: l.s, ar: sp.w / sp.h, flip: l.flip }; }).filter(Boolean);
    openDrawEditor({ draw: pan.draw, ratio: g.bbox.h / g.bbox.w, backdrop: bg ? bg.url : null, ghosts, title: tt`Dessiner le fond de la case ${g.order}`,
      onSave: (d) => { if (d.shapes.length || (d.fx && d.fx.on)) pan.draw = d; else delete pan.draw; pan.show = "layers"; this.commit("draw"); this.editor.render(); this.refreshInspector(); } });
  }
  // ---------------------------------------------------------------- profondeur : la case vue de dessus
  // Meme schema et memes donnees que le bouton « Profondeur » du montage : l.d (0 devant, 1 au fond) et l.x. Regler ici
  // ou la-bas revient au meme : c'est la place de l'element dans l'espace de la case.
  depthDialog(pid) {
    let pan = this.page().panels[pid];
    const g = this.geo(pid);
    if (!pan || !g || !(pan.layers || []).length) return toast(tt("Pose d'abord des éléments dans la case."));
    const W = 1000, H = W * g.bbox.h / g.bbox.w, bb = { x0: 0, y0: 0, w: W, h: H }, DY0 = 0.8, DY1 = 0.14;
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H.toFixed(1)}`); svg.setAttribute("class", "depthview");
    const yOf = (d) => H * (DY0 + (DY1 - DY0) * d), f1 = (x) => x.toFixed(1), f3 = (x) => +(+x).toFixed(3);
    const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    let sel = this.sel.layer || null, drag = null;
    const setDepth = (l, d) => {                             // comme au montage : l'ordre d'empilement suit la profondeur
      pan.layers.forEach((x, i) => { if (x.d == null) x.d = f3(depthOf(pan, i)); });
      l.d = f3(clamp(d, 0, 1)); pan.layers.sort((a, b) => b.d - a.d);
    };
    const paint = () => {
      const fs = Math.max(11, H * 0.03), th = H * 0.03, dof = pan.dof || {};
      let o = `<rect width="${W}" height="${f1(H)}" fill="#f3f1ec"/>` +
        `<polygon points="${W / 2},${f1(yOf(-0.2))} 0,${f1(yOf(1))} ${W},${f1(yOf(1))}" fill="#3b82f6" fill-opacity="0.09" stroke="#3b82f6" stroke-opacity="0.5" stroke-dasharray="6 5"/>`;
      for (const d of [0, 0.25, 0.5, 0.75, 1])
        o += `<line x1="0" x2="${W}" y1="${f1(yOf(d))}" y2="${f1(yOf(d))}" stroke="#b9b4a8" stroke-width="1" stroke-dasharray="${d === 0 || d === 1 ? "none" : "3 6"}"/>` +
          `<text x="6" y="${f1(yOf(d) - 4)}" font-size="${f1(fs * 0.75)}" fill="#8a8578">${d === 0 ? tt("Devant · 0") : d === 1 ? tt("Fond · 1") : d}</text>`;
      o += `<rect x="0" y="${f1(yOf(1) - H * 0.035)}" width="${W}" height="${f1(H * 0.035)}" fill="#cfcabd"/>` +
        tt`<text x="${W / 2}" y="${f1(yOf(1) - H * 0.045)}" font-size="${f1(fs * 0.8)}" fill="#8a8578" text-anchor="middle">DÉCOR</text>`;
      if (dof.on) o += `<line x1="0" x2="${W}" y1="${f1(yOf(dof.focus ?? 0.5))}" y2="${f1(yOf(dof.focus ?? 0.5))}" stroke="#16a34a" stroke-width="2.5"/>` +
        tt`<text x="${W - 6}" y="${f1(yOf(dof.focus ?? 0.5) - 5)}" font-size="${f1(fs * 0.75)}" fill="#16a34a" text-anchor="end">MISE AU POINT · ${(dof.focus ?? 0.5).toFixed(2)}</text>` +
        `<line x1="0" x2="${W}" y1="${f1(yOf(dof.focus ?? 0.5))}" y2="${f1(yOf(dof.focus ?? 0.5))}" stroke="transparent" stroke-width="${f1(Math.max(16, H * 0.03))}" data-focus="1" style="cursor:ns-resize"><title>${tt("Glisser : déplacer la mise au point")}</title></line>`;
      pan.layers.forEach((l, li) => {
        const it = this.bank.get(l.item), sp = it && sprite(it, l.v, l.f);
        if (!sp) return;
        const box = layerBox(bb, l, sp), y = yOf(depthOf(pan, li)), on = sel === l.id, ih = H * 0.11, iw = ih * sp.w / sp.h;
        o += `<g data-layer="${l.id}" style="cursor:grab">` +
          `<image href="${sp.url}" x="${f1(box.cx - iw / 2)}" y="${f1(y - th / 2 - ih - 2)}" width="${f1(iw)}" height="${f1(ih)}" opacity="${on ? 1 : 0.75}" data-layer="${l.id}"/>` +
          `<rect x="${f1(box.x)}" y="${f1(y - th / 2)}" width="${f1(Math.max(box.w, 14))}" height="${f1(th)}" rx="${f1(th / 3)}" fill="${on ? "#e2603a" : "#2f2d2a"}" stroke="#fff" stroke-width="1.5" data-layer="${l.id}"/>` +
          `<text x="${f1(box.cx)}" y="${f1(y + th / 2 + fs * 0.9)}" font-size="${f1(fs * 0.8)}" fill="${on ? "#b8431f" : "#444"}" text-anchor="middle" data-layer="${l.id}">${esc(it.name)} · ${depthOf(pan, li).toFixed(2)}</text></g>`;
      });
      o += `<g transform="translate(${W / 2} ${f1(yOf(-0.2))})"><rect x="${f1(-fs * 1.1)}" y="${f1(-fs * 0.5)}" width="${f1(fs * 2.2)}" height="${f1(fs * 1.3)}" rx="3" fill="#5b6472"/>` +
        tt`<text y="${f1(fs * 1.75)}" font-size="${f1(fs * 0.8)}" fill="#5b6472" text-anchor="middle">CAMÉRA</text></g>`;
      svg.innerHTML = o;
    };
    const pt = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    svg.addEventListener("pointerdown", (e) => {
      if (e.target.dataset && e.target.dataset.focus && pan.dof && pan.dof.on) {   // la ligne verte de mise au point se glisse
        svg.setPointerCapture(e.pointerId); e.preventDefault();
        drag = { focus: true, p: pt(e), fo: pan.dof.focus ?? 0.5 };
        return;
      }
      const id = e.target.dataset && e.target.dataset.layer, l = id && pan.layers.find((x) => x.id === id);
      if (!l) return;
      sel = id; svg.setPointerCapture(e.pointerId); e.preventDefault();
      drag = { l, p: pt(e), d: depthOf(pan, pan.layers.indexOf(l)), x: l.x };
      this.select({ panel: pid, layer: id }); paint();
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const q = pt(e);
      if (drag.focus) { pan.dof.focus = f3(clamp(drag.fo - (q.y - drag.p.y) / (DY0 - DY1), 0, 1)); paint(); this.editor.render(true); return; }
      setDepth(drag.l, drag.d - (q.y - drag.p.y) / (DY0 - DY1)); drag.l.x = f3(clamp(drag.x + (q.x - drag.p.x), -0.3, 1.3));
      paint(); this.editor.render(true);
    });
    svg.addEventListener("pointerup", () => { if (drag) { const f = drag.focus; drag = null; this.commit(f ? "dof" : "depth"); this.editor.render(); this.refreshInspector(); } });
    // Ctrl+Z / Ctrl+Y (Cmd sur Mac) : la meme annulation que la case, puisque c'est la meme case
    const onKey = (e) => {
      if (!document.body.contains(svg)) return document.removeEventListener("keydown", onKey);
      const backs = document.querySelectorAll(".modal-back");
      if (backs[backs.length - 1] !== svg.closest(".modal-back") || !(e.ctrlKey || e.metaKey)) return;
      if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) this.doRedo(); else this.doUndo();
      pan = this.page().panels[pid];
      if (!pan || !(pan.layers || []).length) { m.close(); return; }
      if (sel && !pan.layers.some((x) => x.id === sel)) sel = null;
      paint();
    };
    document.addEventListener("keydown", onKey);
    paint();
    const m = modal(tt`Profondeur · case ${g.order}`, h("div.depthbox", svg,
      h("p.muted", tt("La case vue de dessus : la caméra en bas, le décor en haut. Glisser une carte vers le haut l'éloigne, vers le bas la rapproche ; à gauche ou à droite, elle se déplace dans le cadre. L'élément le plus loin passe derrière les autres. C'est la même position que dans le montage (bouton « Profondeur ») : régler ici ou là-bas revient au même."))),
      [{ label: tt("Fermer") }]);
    m.box.classList.add("wide");
  }

  // ---------------------------------------------------------------- dessiner un asset : a la main, ou objet tout fait
  assetDialog() {
    const m = modal(tt("Dessiner un asset"), h("div.form.assetpick",
      h("button.big", { on: { click: () => { m.close(); this.drawAsset(); } } }, h("b", tt("✏ Le dessiner")), h("span", tt("Crayon, tracé libre, formes de base (rectangle, ellipse, triangle…), épaisseur du trait, aplats et trames. L'atelier de dessin des fonds, sur une feuille blanche."))),
      h("button.big", { on: { click: () => { m.close(); this.proceduralDialog(); } } }, h("b", tt("🪑 Objet tout fait")), h("span", tt("Table, chaise, tabouret, banc, caisse, étagère, lit, bureau : on règle les cotes avec des curseurs. L'objet tourne sur 360° tout de suite, sans calcul.")))),
      [{ label: tt("Fermer") }]);
  }
  // item : un asset deja dessine (son dessin est garde dans sa fiche, item.drawn) : on le reprend, et a l'enregistrement son
  // image de base est remplacee (detourage refait ; l'orbite, retiree, se relance au choix)
  drawAsset(item = null) {
    openDrawEditor({ draw: item && item.drawn ? JSON.parse(JSON.stringify(item.drawn)) : null, ratio: 1, backdrop: null,
      title: item ? tt`Reprendre le dessin : ${item.name}` : tt("Dessiner un asset"), saveLabel: item ? tt("Remplacer dans la banque") : tt("Ranger dans la banque"),
      onSave: async (d) => {
        if (!d.shapes.length) return;
        const drawn = Object.assign({ shapes: d.shapes }, d.ext ? { ext: d.ext } : null, d.fx ? { fx: d.fx } : null);
        if (item) {
          const orbit = confirm(tt("Recalculer aussi son orbite 360° (environ 3 minutes sur une machine) ?\nAnnuler : l'image est remplacée, l'orbite se relancera depuis sa fiche."));
          const im = await drawImage(d, 1024, 1024);
          if (!im) return toast(tt("Le dessin n'a pas pu être converti en image."), "error");
          const c = document.createElement("canvas"); c.width = c.height = 1024;
          const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1024, 1024); x.drawImage(im, 0, 0, 1024, 1024);
          const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
          try {
            await upload(`bank/${item.id}/rebase`, blob);
            await put(`bank/${item.id}`, { drawn });
            await post(`bank/${item.id}/cut`, { variant: "base", target: target() });
            if (orbit) await post(`bank/${item.id}/orbit`, { variant: "base", target: target() });
            await this.bankUI.reload(); this.pollSoon();
            toast(tt`« ${item.name} » remplacé : détourage en cours.` + (orbit ? tt(" Son orbite suivra.") : ""));
          } catch (e) { toast(tt("Remplacement refusé : ") + e.message, "error"); }
          return;
        }
        const name = (prompt(tt("Nom de l'asset :"), tt("Asset dessiné")) || "").trim();
        if (!name) return toast(tt("Dessin abandonné : il faut un nom pour le ranger dans la banque."), "error");
        const orbit = confirm(tt("Calculer aussi son orbite 360° (environ 3 minutes sur une machine) ?\nAnnuler : il reste une image fixe, tu pourras lancer l'orbite plus tard depuis sa fiche."));
        const im = await drawImage(d, 1024, 1024);
        if (!im) return toast(tt("Le dessin n'a pas pu être converti en image."), "error");
        const c = document.createElement("canvas"); c.width = c.height = 1024;
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1024, 1024); x.drawImage(im, 0, 0, 1024, 1024);
        const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
        const f = this.bankUI.tab === "asset" && this.bankUI.folder && this.bankUI.folder !== "·" ? this.bankUI.folder : "";
        try {
          const it = await upload("bank?" + new URLSearchParams({ kind: "asset", name, style: "dessin", facing: "face", orbit: orbit ? "1" : "0", target: target(), file: "dessin.png", folder: f }), blob);
          if (it && it.id) await put(`bank/${it.id}`, { drawn }).catch(() => null);   // le dessin, pour le reprendre plus tard
          this.bankUI.tab = "asset"; await this.bankUI.reload(); this.pollSoon();
          toast(tt`« ${name} » est dans la banque, onglet Assets.` + (orbit ? tt(" Son orbite est en calcul.") : ""));
        } catch (e) { toast(tt("Asset refusé : ") + e.message, "error"); }
      } });
  }
  async proceduralDialog() {
    let cat;
    try { cat = await get("procedural"); } catch (e) { return toast(e.message, "error"); }
    let cur = cat[0], vals = {}, az = 30, spin = null, url = null, busy = false, again = false;
    const img = h("img.procview", { alt: "", draggable: false });
    const knobs = h("div.knobs");
    const name = h("input", { type: "text", placeholder: tt("Nom dans la banque") });
    const refresh = async () => {                              // un seul apercu a la fois ; le dernier reglage gagne
      if (busy) { again = true; return; }
      busy = true;
      try {
        const r = await fetch("/api/procedural/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: cur.key, params: vals, az }) });
        if (r.ok) { const b = await r.blob(); if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(b); img.src = url; }
      } catch (e) { /* le prochain reglage relancera */ }
      busy = false;
      if (again) { again = false; refresh(); }
    };
    // vue : hauteur de la camera (l'axe) et force de la perspective (les fuyantes), gardees d'un objet a l'autre
    let view = { _elev: 14, _persp: 0 };
    const viewKnob = (label, k, min, max, tip) => { const out = h("output", String(view[k]));
      return h("label.row.range", { title: tip }, label, h("input", { type: "range", min, max, step: 1, value: view[k], on: { input: (e) => { view[k] = +e.target.value; vals[k] = view[k]; out.textContent = String(view[k]); refresh(); } } }), out); };
    const viewBox = h("div.knobs",
      viewKnob(tt("Axe de vue (°)"), "_elev", -30, 70, tt("Hauteur de la caméra : négatif, vu d'en dessous ; 0, à hauteur ; positif, vu du dessus.")),
      viewKnob(tt("Perspective (fuyantes)"), "_persp", 0, 100, tt("0 : lignes parallèles. Plus haut : la caméra s'approche et les arêtes fuient vers des points de fuite.")));
    const build = () => {
      vals = Object.assign(Object.fromEntries(cur.params.map((q) => [q.key, q.def])), view);
      name.value = tr(cur.label);
      knobs.textContent = "";
      for (const q of cur.params) {
        if (q.choices) knobs.append(h("label.row", tr(q.label), h("select", { on: { change: (e) => { vals[q.key] = e.target.value; refresh(); } } }, q.choices.map((c) => h("option", { value: c, selected: c === q.def }, tr(c))))));
        else { const out = h("output", String(q.def)); knobs.append(h("label.row.range", tr(q.label), h("input", { type: "range", min: q.min, max: q.max, step: q.step, value: q.def, on: { input: (e) => { vals[q.key] = +e.target.value; out.textContent = e.target.value; refresh(); } } }), out)); }
      }
      refresh();
    };
    const pick = h("select", { on: { change: (e) => { cur = cat.find((c) => c.key === e.target.value); build(); } } }, cat.map((c) => h("option", { value: c.key }, tr(c.label))));
    const turn = h("input", { type: "range", min: 0, max: 359, step: 1, value: az, on: { input: (e) => { az = +e.target.value; refresh(); } } });
    const play = h("button.mini", { title: tt("Faire tourner l'aperçu"), on: { click: () => { if (spin) { clearInterval(spin); spin = null; play.textContent = "▶"; return; } play.textContent = "⏸"; spin = setInterval(() => { if (!document.body.contains(img)) { clearInterval(spin); return; } az = (az + 6) % 360; turn.value = az; refresh(); }, 140); } } }, "▶");
    const m = modal(tt("Objet tout fait"), h("div.procedural",
      h("div.procleft", img, h("div.scrub", play, turn)),
      h("div.form", h("label.row", tt("Objet"), pick), knobs, h("h4", tt("Vue")), viewBox, h("label.row", tt("Nom"), name),
        h("p.muted", tt("Cotes en centimètres. L'objet est rangé dans les Assets avec son orbite complète (72 images), sans passer par une machine : compte une demi-minute.")))),
      [{ label: tt("Annuler") }, { label: tt("Ajouter à la banque"), primary: true, click: async () => {
        toast(tt("Fabrication de l'orbite (une demi-minute)…"), "info", 9000);
        const f = this.bankUI.tab === "asset" && this.bankUI.folder && this.bankUI.folder !== "·" ? this.bankUI.folder : "";
        try {
          const it = await post("procedural/create", { key: cur.key, params: vals, name: name.value.trim(), folder: f });
          this.bankUI.tab = "asset"; await this.bankUI.reload(); this.bankUI.reveal(it.id);
        } catch (e) { toast(tt("Objet refusé : ") + e.message, "error", 9000); return false; }
      } }]);
    m.box.classList.add("wide");
    build();
  }
  // decks de montage : plusieurs par storyboard, enregistres avec lui
  decks() {
    const P = this.project;
    if (!P.decks) { P.decks = []; if (P.deck && (P.deck.clips || []).length) P.decks.push({ id: uid(), name: tt("Deck 1"), clips: P.deck.clips }); delete P.deck; }
    return P.decks;
  }
  newDeck(name, clips) { const d = { id: uid(), name: name || tt`Deck ${this.decks().length + 1}`, clips: clips || [] }; this.decks().push(d); this.project.deckCur = d.id; this.commit("deck"); this.refreshTop(); return d; }
  /** Le deck demande, sinon le deck en cours, sinon le premier, sinon un deck neuf. */
  deckOf(id) { const ds = this.decks(); return ds.find((d) => d.id === id) || ds.find((d) => d.id === this.project.deckCur) || ds[0] || this.newDeck(tt("Deck 1")); }
  refreshTop() { this.refreshInspector(); }
  decksMenu(e) {
    const ds = this.decks(), items = [{ head: ds.length ? tt("Decks enregistrés") : tt("Aucun deck pour l'instant") }];
    for (const d of ds) items.push({ label: `🎞 ${d.name} · ${d.clips.length} plan${d.clips.length > 1 ? "s" : ""}`, checked: d.id === this.project.deckCur, click: () => openDeck(this, d.id) });
    items.push({ label: tt("＋ Nouveau deck…"), click: () => { const n = (prompt(tt("Nom du nouveau deck :"), tt`Deck ${ds.length + 1}`) || "").trim(); if (n) openDeck(this, this.newDeck(n).id); } });
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
    const pan = this.curPanel(); if (!pan) return toast(tt("Choisis d'abord une case."));
    const [, text, tail] = BUB[type];
    const b = { id: uid(), type, text, size: "M", color: "white", font: "bd", show: "always", x: clamp(rel?.x ?? 0.5, 0.1, 0.9), y: clamp(rel?.y ?? 0.2, 0.08, 0.9) };
    if (tail) { b.tx = clamp(b.x + 0.06, 0, 1); b.ty = clamp(b.y + 0.2, 0, 1.1); }
    (pan.bubbles = pan.bubbles || []).push(b);
    this.sel = { panel: this.sel.panel, bubble: b.id };
    this.commit("bubble-add"); this.editor.render(); this.refreshInspector();
    setTimeout(() => this.el.insp.querySelector("textarea")?.select(), 30);
  }
  bubble() { return (this.curPanel()?.bubbles || []).find((b) => b.id === this.sel.bubble); }
  // ---------------------------------------------------------------- cadres de texte (page) : titres, annotations sous les cases
  // pg.notes : [{id, x, y, w, h (fractions de la page), text, fs (taille, en milliemes de la largeur de page), al, b, border, fill, under}]
  note() { return (this.page()?.notes || []).find((n) => n.id === this.sel.note); }
  addNote(r, quiet) {
    const pg = this.page(), n = Object.assign({ id: uid(), x: 0.3, y: 0.012, w: 0.4, h: 0.045, text: "", fs: 14, al: "center", border: true, fill: "#ffffff" }, r);
    (pg.notes = pg.notes || []).push(n);
    if (!quiet) { this.sel = { note: n.id }; this.commit("note"); this.editor.render(); this.refreshInspector(); setTimeout(() => this.editor.editNote(n.id), 30); }
    return n;
  }
  // place libre sous une case (jusqu'a la case du dessous, ou le bas de la page) : le rectangle d'un cadre d'annotation, ou null
  roomUnder(geom, page, g) {
    const b = g.bbox, bottom = b.y0 + b.h;
    const next = geom.panels.filter((q) => q.bbox && q !== g && q.bbox.y0 > bottom - 1 && q.bbox.x0 < b.x0 + b.w && q.bbox.x0 + q.bbox.w > b.x0).map((q) => q.bbox.y0);
    const end = next.length ? Math.min(...next) : page.height - page.margin, room = end - bottom, pad = Math.min(10, room * 0.1);   // sous la derniere rangee : jusqu a la marge, la meme place qu entre les rangees
    return room < 36 ? null : { x: b.x0 / page.width, y: (bottom + pad) / page.height, w: b.w / page.width, h: (room - 2 * pad) / page.height };
  }
  reflowNotes() {                                         // les cadres d'annotation suivent la place sous leur case
    const pg = this.page(), geom = compute(pg.page, pg.layout);
    for (const n of pg.notes || []) {
      const g = n.under && geom.panels.find((q) => q.id === n.under && q.bbox), r = g && this.roomUnder(geom, pg.page, g);
      if (r) Object.assign(n, r);
    }
  }
  notesUnder() {                                         // un cadre dans la place libre sous chaque case (une seule fois par case)
    const pg = this.page(), page = pg.page, geom = compute(page, pg.layout), made = [];
    const have = new Set((pg.notes || []).map((n) => n.under).filter(Boolean));
    for (const g of geom.panels) {
      if (!g.bbox || have.has(g.id)) continue;
      const r = this.roomUnder(geom, page, g);
      if (r) made.push(this.addNote(Object.assign(r, { under: g.id, fs: 13, al: "left", border: false, fill: "" }), true));
    }
    if (!made.length) return toast(tt("Pas de place libre sous les cases : prends le découpage « Storyboard annoté » ou agrandis la gouttière."), "error");
    this.sel = {}; this.commit("note"); this.editor.render(); this.refreshInspector();
    toast(tt`${made.length} cadre(s) d'annotation : double-clic pour écrire.`);
  }
  removeNote() {
    const pg = this.page(), n = this.note(); if (!n) return;
    pg.notes = pg.notes.filter((x) => x !== n); this.sel = {};
    this.commit("note"); this.editor.render(); this.refreshInspector();
  }
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
    toast(type === "free" ? tt("Dessine la flèche dans la case : la pointe se met au bout du trait.") : tt("Glisse dans une case pour tracer (un simple clic pose une taille standard)."));
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
    items.push({ label: tt("Contour"), checked: m.ol !== false, click: set("ol", m.ol === false ? undefined : false) });
    if (m.type === "turn") items.push({ label: tt("Inverser le sens"), click: set("cw", m.cw === false) });
    else if (m.type !== "frame") items.push({ label: tt("Pointe aux deux bouts"), checked: !!m.both, click: set("both", !m.both) });
    items.push({ label: tt("Pointillés"), checked: m.type === "frame" ? m.dash !== false : !!m.dash, click: set("dash", m.type === "frame" ? m.dash === false : !m.dash) },
      { label: tt("Dupliquer"), click: () => this.duplicateMark() }, { label: tt("Supprimer"), danger: true, click: () => this.removeMark() });
    menu(e, items);
  }
  removeBubble() {
    const list = this.curPanel().bubbles, b = this.bubble(); if (!b) return;
    list.splice(list.indexOf(b), 1); this.sel = { panel: this.sel.panel };
    this.commit("bubble-del"); this.editor.render(); this.refreshInspector();
  }
  bubbleMenu(e, pid, id) {
    this.select({ panel: pid, bubble: id });
    const b = this.bubble(), items = [{ head: tt("Forme") }];
    for (const [t, [label]] of Object.entries(BUB)) items.push({ label, checked: b.type === t, half: true, click: () => { b.type = t; this.commit("bub"); this.editor.render(); this.refreshInspector(); } });
    items.push({ head: tt("Bulle") }, { label: b.tx != null ? tt("Sans queue") : tt("Avec queue"), click: () => {
      if (b.tx != null) { delete b.tx; delete b.ty; delete b.bx; delete b.by; } else { b.tx = b.x + 0.06; b.ty = b.y + 0.2; }
      this.commit("bub"); this.editor.render(); } }, { label: tt("Supprimer"), danger: true, click: () => this.removeBubble() });
    menu(e, items);
  }

  // ---------------------------------------------------------------- Integrate et orbite de case
  async flat(pid) {
    const g = this.geo(pid || this.sel.panel);
    const blob = await flattenPanel(this, g);
    return (await upload(`projects/${this.project.id}/flat/${g.id}`, blob)).file;
  }
  async integrate(style, extra) {
    const pan = this.curPanel(); if (!pan) return toast(tt("Choisis d'abord une case."));
    if (!pan.bg && !(pan.layers || []).length) return toast(tt("La case est vide."));
    try {
      const flat = await this.flat();
      await post(`projects/${this.project.id}/integrate`, { panel: this.sel.panel, flat, style: style || pan.style || this.guessStyle(pan), extra: extra || "", target: target() });
      toast(tt("Integrate lancé : l'image unifiée remplacera les calques (ils restent disponibles).")); this.pollSoon();
    } catch (e) { toast(tt("Integrate impossible : ") + e.message, "error"); }
  }
  // « Générer photo » : la case aplatie (ou, depuis le montage, l'image a la tete de lecture : over) rendue en photo
  casePhoto(pid = this.sel.panel, over = null) {
    const pan = this.page().panels[pid];
    if (!pan || (!pan.bg && !(pan.layers || []).length && !pan.draw)) return toast(tt("La case est vide."));
    const g = this.geo(pid);
    photoDialog({ title: over ? tt("Générer photo (image du montage)") : tt("Générer photo"), project: this.project.id, panel: pid, name: `case-${pid}`,
      snap: () => flattenPanel(this, g, 1344, true, over),
      keep: (rel) => { const p = this.page().panels[pid]; if (!p) return; p.integrations = [...(p.integrations || []), rel]; p.integrated = rel; p.show = "integrated"; this.commit("photo"); this.editor.render(); this.refreshInspector(); toast(tt("La case montre la photo (Afficher : Intégrée).")); } });
  }
  // toute la page d'un coup : chaque case composee part a Integrate (les cases deja integrees sont refaites)
  async integratePage(style) {
    const pg = this.page(), todo = this.editor.geom.panels.filter((g) => { const p = pg.panels[g.id] || {}; return p.bg || (p.layers || []).length; });
    if (!todo.length) return toast(tt("Aucune case composée sur cette page."));
    if (!confirm(tt`Lancer Integrate (${(INTEGRATE_STYLES.find(([k]) => k === style) || INTEGRATE_STYLES[2])[1].toLowerCase()}) sur ${todo.length} case(s) ?`)) return;
    let n = 0;
    for (const g of todo) {
      try {
        const flat = await this.flat(g.id);
        await post(`projects/${this.project.id}/integrate`, { panel: g.id, flat, style, target: target() }); n++;
      } catch (e) { toast(tt`Case ${g.order} : ${e.message}`, "error"); }
    }
    toast(tt`${n} Integrate lancé(s).`); this.pollSoon();
  }
  panelOrbit() {                                            // la camera tourne autour de toute la scene ; consigne modifiable
    const pan = this.curPanel(); if (!pan) return toast(tt("Choisis d'abord une case."));
    const base = (this.info && this.info.sceneOrbit) || "";
    const prompt = h("textarea", { rows: 9 }); prompt.value = localStorage.getItem("bw.sceneOrbit") || base;
    const rs = (this.info && this.info.settings && this.info.settings.render) || {};
    const seed = h("input", { type: "number", min: 1, step: 1, style: { width: "11em" }, placeholder: rs.seed ? tt`réglages (${rs.seed})` : tt("réglages") });
    const go = async () => {
      const txt = prompt.value.trim();
      if (txt && txt !== base) localStorage.setItem("bw.sceneOrbit", txt); else localStorage.removeItem("bw.sceneOrbit");
      try {
        let flat;
        if (pan.show === "integrated" && pan.integrated) flat = pan.integrated;        // l'image integree tourne mieux qu'un collage
        else flat = await this.flat();
        await post(`projects/${this.project.id}/orbit`, { panel: this.sel.panel, flat, prompt: txt, seed: +seed.value || 0, target: target() });
        toast(tt("Orbite de la case lancée (≈ 3 min).")); this.pollSoon();
      } catch (e) { toast(tt("Orbite impossible : ") + e.message, "error"); return false; }
    };
    // Sans generation : 72 images de la case aplatie, la camera tournant de 5 degres a chaque image. Les elements montrent
    // l'image de leur tournette sous cet angle (orbitpersp.js) ; un decor 360 de la banque tourne du meme angle, comme
    // enroule sur un cylindre autour de la scene (ses images se lisent a rebours : la camera part a droite, le decor
    // defile vers la droite). Essaye sur p92 de zz-essais le 26/11/2026. Un decor en simple image reste fixe.
    const goLocal = async () => {
      const g = this.geo(this.sel.panel), pid = this.sel.panel, N = 72, opt = { glue: true, tele: 2 };
      const base = pan.orbitBase || { layers: pan.layers || [], ground: pan.ground || null, bg: pan.bg || null, view: pan.view || null };
      const src = Object.assign({}, pan, { layers: base.layers, ground: base.ground, bg: base.bg, view: base.view || pan.view, show: "layers" });
      if (!g || !(src.layers || []).some((l) => { const it = this.bank.get(l.item), v = it && variantOf(it, l.v); return v && v.orbit && v.orbit.n > 1; }))
        { toast(tt("Aucun élément de cette case n'a de tournette : rien ne tournerait."), "error"); return false; }
      const bgIt = src.bg && src.bg.item && this.bank.get(src.bg.item), bgV = bgIt && variantOf(bgIt, src.bg.v || "base");
      const turns = !!(bgV && bgV.orbit && bgV.orbit.n > 1), a0 = turns ? frameToAngle(bgV.orbit, src.bg.f || 0) : 0;
      const run = Date.now();
      toast(tt("Orbite sans génération : rendu des 72 images…"));
      (async () => {
        try {
          let dir = "", w = 0, hh = 0;
          for (let k = 0; k < N; k++) {
            const yaw = k * 360 / N, r = orbitPerspective(src, g.bbox.h / g.bbox.w, this.bank, yaw, opt);
            const by = new Map(r.out.map((x) => [x.l.id, x]));
            const layers = src.layers.map((l, i) => { const x = by.get(l.id), c = Object.assign({}, l, l.d == null ? { d: depthOf(src, i) } : {});
              return x ? Object.assign(c, { x: x.x, y: x.y, s: x.s, d: x.d }, x.f != null ? { f: x.f } : {}) : c; }).sort((p, q) => q.d - p.d);
            const over = Object.assign({}, src, { layers });
            if (turns) over.bg = Object.assign({}, src.bg, { f: angleToFrame(bgV.orbit, a0 - yaw) });
            if (r.ground && src.ground) over.ground = Object.assign({}, src.ground, r.ground);
            const blob = await flattenPanel(this, g, 1152, true, over, "image/webp");
            if (!k) { const im = await createImageBitmap(blob); w = im.width; hh = im.height; }
            dir = (await upload(`projects/${this.project.id}/orbit-frame/${pid}?run=${run}&k=${k}`, blob)).dir;
          }
          const tgt = this.project.pages.flatMap((pg) => (pg.panels[pid] ? [pg.panels[pid]] : []))[0];
          if (!tgt) return;
          tgt.orbit = { n: N, w, h: hh, ext: "webp", alpha: false, dir, frame: 0, local: opt };
          tgt.show = "orbit";
          this.commit("orbit-local"); this.editor.render(); this.refreshInspector();
          toast(tt("Orbite sans génération prête.") + (turns ? "" : " " + tt("Le décor n'est pas un décor 360 : il reste fixe.")));
        } catch (e) { toast(tt("Orbite impossible : ") + e.message, "error"); }
      })();
    };
    modal(tt("Orbite de la case"), h("div.form",
      h("p.muted", tt("La caméra fait le tour de la scène : le décor tourne avec les personnages, et ce qui était hors champ est inventé dans le même style. La consigne se modifie ; elle est gardée pour les prochaines orbites.")),
      h("label.col", tt("Consigne"), prompt),
      h("button.mini", { type: "button", on: { click: () => { prompt.value = base; } } }, tt("Remettre la consigne d'origine")),
      h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, tt("Graine"), seed,
        h("button.mini", { type: "button", title: tt("Tirer une autre graine"), on: { click: () => { seed.value = 1 + Math.floor(Math.random() * 999999); } } }, "🎲"),
        h("button.mini", { type: "button", title: tt("Revenir à la graine des réglages"), on: { click: () => { seed.value = ""; } } }, tt("Réglages"))),
      h("p.muted", tt("Même graine et même consigne donnent la même vidéo. Si le décor reste vide au demi-tour, relance avec une autre graine.")),
      h("p.muted", tt("« ⚡ Sans génération » : immédiat et gratuit. Les éléments montrent leur tournette sous chaque angle et un décor 360 de la banque défile derrière eux ; un décor en simple image reste fixe."))),
      [{ label: tt("Annuler") }, { label: tt("⚡ Sans génération"), title: tt("Immédiat et gratuit : les tournettes des éléments et le décor 360 de la banque, sans calcul"), click: goLocal },
       { label: tt("↻ Lancer l'orbite"), primary: true, click: go }]).box.classList.add("wide");
  }
  // « Recalculer la perspective » depuis l'orbite de la case : les marionnettes de la case (pas une image calculee) se
  // calent sur l'angle ou l'orbite est arretee (orbitpersp.js, la meme reconstruction que la vue 3D du montage). Le calcul
  // part toujours de la case telle qu'avant le premier recalcul (pan.orbitBase) : recalculer deux fois ne tourne pas deux
  // fois. Le resultat va dans la case choisie ; un instantane aplati part dans processed_orbit/ ; le decor de cet angle
  // peut etre redessine (image de l'orbite sans les personnages, moteur d'Integrate).
  orbitPlace() {
    const pid = this.sel.panel, pg = this.page(), pan = pg.panels[pid], g = this.geo(pid);
    if (!pan || !pan.orbit || !g) return toast(tt("Cette case n'a pas d'orbite."));
    const o = pan.orbit, n = o.n || 72, k = (((o.frame || 0) % n) + n) % n, yaw = k * 360 / n;
    const base = pan.orbitBase || { layers: JSON.parse(JSON.stringify(pan.layers || [])), ground: pan.ground ? JSON.parse(JSON.stringify(pan.ground)) : null, bg: pan.bg ? JSON.parse(JSON.stringify(pan.bg)) : null, view: pan.view || null };
    if (!base.layers.length) return toast(tt("Pose d'abord des éléments dans la case."));
    const filled = (q) => !!(q && (q.bg || (q.layers || []).length));
    const cases = this.editor.geom.panels.slice().sort((a, b) => a.order - b.order);
    const free = cases.find((x) => x.id !== pid && !filled(pg.panels[x.id]));
    const dest = h("select", cases.map((x) => h("option", { value: x.id, selected: x.id === (free ? free.id : pid) },
      tt`Case ${x.order}` + (x.id === pid ? tt(" (cette case, son orbite reste)") : filled(pg.panels[x.id]) ? tt(" (déjà remplie : remplacée)") : ""))));
    const bgIt = base.bg && base.bg.item && this.bank.get(base.bg.item), bgV = bgIt && variantOf(bgIt, base.bg.v || "base");
    const turns = !!(bgV && bgV.orbit && bgV.orbit.n > 1);
    const decor = h("input", { type: "checkbox", checked: !turns && localStorage.getItem("bw.orbitDecor") === "1" });
    const eng = ((this.info.settings.render || {}).integrate_engine || "");
    const engName = (INTEGRATE_ENGINES.find(([x]) => x === eng) || [eng, eng.replace(/^fal:/, "fal · ")])[1];
    modal(tt`Recalculer la perspective · image ${k} (${Math.round(yaw)}°)`, h("div.form",
      h("p.muted", tt("Les éléments de la case (les mêmes marionnettes) prennent la place, la taille et l'image de tournette qu'ils ont sous cet angle de l'orbite. Rien n'est régénéré, sauf le décor si tu le coches.")),
      h("label.row", tt("Mettre dans"), dest),
      turns ? h("p.muted", tt("Le décor est un décor 360 de la banque : il tourne avec, sans calcul.")) : "",
      h("label.row.check", decor, tt("Redessiner le décor sous cet angle"), h("span.muted", " · " + tt("l'image de l'orbite sans les personnages, moteur d'Integrate : ") + (engName || tt("automatique")) + (/^fal:/.test(eng) || (!eng && this.noMachines()) ? tt(" (fal, payant)") : ""))),
      h("p.muted", tt("Un instantané de la case part dans le dossier processed_orbit du storyboard (et un second quand le décor arrive)."))),
      [{ label: tt("Annuler") }, { label: tt("↻ Placer"), primary: true, click: () => {
        const to = dest.value, same = to === pid;
        const r = orbitPerspective(Object.assign({}, pan, { layers: base.layers, ground: base.ground, bg: base.bg }), g.bbox.h / g.bbox.w, this.bank, yaw, o.local || {});
        // les elements de la case tels qu'a l'image 0 (pan.orbitBase) ; ceux ajoutes depuis gardent leur place, ceux
        // retires depuis ne reviennent pas
        const baseOf = new Map(base.layers.map((l, i) => [l.id, Object.assign(JSON.parse(JSON.stringify(l)), l.d == null ? { d: +depthOf({ layers: base.layers }, i).toFixed(3) } : {})]));
        const now = (pan.layers || []).map((l) => baseOf.get(l.id) || JSON.parse(JSON.stringify(l)));
        let tgt;
        if (same) { pan.orbitBase = base; tgt = pan; tgt.layers = now; }
        else {                                               // une copie neuve de la case : sans ses images calculees, nouveaux identifiants
          tgt = JSON.parse(JSON.stringify(pan));
          for (const x of ["integrated", "integrations", "orbit", "orbitBase", "orbitBg", "anim"]) delete tgt[x];
          tgt.layers = now;
          for (const b of tgt.bubbles || []) b.id = uid();
          for (const m of tgt.marks || []) m.id = uid();
        }
        const byId = new Map(tgt.layers.map((l) => [l.id, l]));
        for (const x of r.out) { const l = byId.get(x.l.id); if (!l) continue; l.x = x.x; l.y = x.y; l.s = x.s; l.d = x.d; if (x.f != null) l.f = x.f; }
        tgt.layers.forEach((l, i, a) => { if (l.d == null) l.d = +depthOf({ layers: a }, i).toFixed(3); });
        tgt.layers.sort((a, b) => b.d - a.d);
        if (!same) for (const l of tgt.layers) l.id = uid();
        if (r.ground && tgt.ground) Object.assign(tgt.ground, r.ground);
        tgt.bg = base.bg ? JSON.parse(JSON.stringify(base.bg)) : tgt.bg;
        if (same && base.view) tgt.view = base.view;
        if (turns) { const a = frameToAngle(bgV.orbit, base.bg.f || 0); tgt.bg.f = angleToFrame(bgV.orbit, o.local ? a - yaw : a + yaw); }
        tgt.show = "layers";
        tgt.orbitOf = { panel: pid, frame: k };
        if (!same) pg.panels[to] = tgt;
        const keyed = same && pan.anim && Object.keys(pan.anim.tracks || {}).some((id) => byId.has(id) && (pan.anim.tracks[id] || []).length);
        this.commit("orbit-place"); this.select({ panel: to }); this.editor.render(); this.refreshInspector();
        localStorage.setItem("bw.orbitDecor", decor.checked ? "1" : "0");
        const go = async () => {
          await this.orbitSnap(to, "f" + k);
          if (decor.checked && !turns) {
            try {
              await post(`projects/${this.project.id}/integrate`, { panel: to, flat: `${o.dir}/${pad3(k)}.webp`, to: "bg", prompt: ORBIT_DECOR_PROMPT, target: target() });
              this.pollSoon();
            } catch (e) { toast(tt("Décor non lancé : ") + e.message, "error"); }
          }
        };
        go();
        toast(tt`Perspective de l'image ${k} posée : ${r.out.length} élément(s)` + (r.skipped ? tt` · ${r.skipped} derrière la caméra, laissé(s) tel(s) quels` : "") +
          (keyed ? tt(" · des clés du montage gardent leur valeur") : "") + (decor.checked && !turns ? tt(" · décor en calcul") : "") + ".");
      } }]);
  }
  /** La case aplatie, dans processed_orbit/ du storyboard. */
  async orbitSnap(pid, tag) {
    try {
      const g = this.geo(pid); if (!g) return;
      const blob = await flattenPanel(this, g);
      const r = await upload(`projects/${this.project.id}/orbit-snap/${pid}?tag=${encodeURIComponent(tag || "")}`, blob);
      toast(tt("Instantané : ") + r.file);
    } catch (e) { toast(tt("Instantané impossible : ") + e.message, "error"); }
  }
  guessStyle(pan) {
    const it = (pan.layers || []).map((l) => this.bank.get(l.item)).find(Boolean) || this.bank.get(pan.bg?.item);
    return it && it.style === "dessin" ? "dessin" : "photo";
  }

  // ---------------------------------------------------------------- inspecteur
  refreshInspector() {
    this.savePos();
    const box = this.el.insp; box.textContent = ""; this.syncLayer = null;
    const pan = this.curPanel(), l = this.layer(), b = this.bubble();
    const range = (label, val, min, max, step, fn, kind) => { const out = h("output", fmt(val));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: val, on: { input: (e) => { fn(+e.target.value); out.textContent = fmt(+e.target.value); this.editor.render(true); this.commitSoon(kind); } } }), out); };
    // Teinte / Saturation / Luminosite (comme le Ctrl+U de Photoshop), plus Contraste : depliant, pour un element ou le decor
    const hslFold = (get, set, kind, what) => {
      this.folds = this.folds || { sh: true, gs: true, wig: false };
      const g = get() || {}, put = (k, x) => { const n = Object.assign({}, get(), { [k]: x }); set(Object.values(n).some((v) => +v) ? n : null); };
      const on = Object.values(g).some((v) => +v);
      return h("details.fold", { open: !!this.folds.hsl, title: what, on: { toggle: (e) => { this.folds.hsl = e.target.open; } } },
        h("summary", tt("Teinte / Saturation") + (on ? " ●" : "")),
        range(tt("Teinte"), g.h || 0, -180, 180, 1, (x) => put("h", x), kind),
        range(tt("Saturation"), g.s || 0, -100, 100, 1, (x) => put("s", x), kind),
        range(tt("Luminosité"), g.l || 0, -100, 100, 1, (x) => put("l", x), kind),
        range(tt("Contraste"), g.c || 0, -100, 100, 1, (x) => put("c", x), kind),
        on ? h("button.mini", { on: { click: () => { set(null); this.commit(kind); this.editor.render(); this.refreshInspector(); } } }, tt("Réinitialiser")) : "");
    };
    const nt = this.note();
    if (nt) {                                              // cadre de texte de la page
      const redo = () => { this.commit("note"); this.editor.renderOverlay(); };
      const ta = h("textarea", { rows: 4, placeholder: tt("Texte du cadre…"), on: { input: (e) => { nt.text = e.target.value; this.editor.renderOverlay(); this.commitSoon("note"); } } });
      ta.value = nt.text || "";
      box.append(h("h3", tt("Cadre de texte")), ta,
        range(tt("Taille du texte"), nt.fs || 14, 5, 60, 0.5, (x) => { nt.fs = x; this.editor.renderOverlay(); }, "note"),
        h("div.row", h("span", tt("Alignement")), ...[["left", "⯇"], ["center", "≡"], ["right", "⯈"]].map(([a, lab]) => h("button.mini" + ((nt.al || "left") === a ? ".on" : ""), { on: { click: () => { nt.al = a; redo(); this.refreshInspector(); } } }, lab)),
          h("button.mini" + (nt.b ? ".on" : ""), { title: tt("Gras"), on: { click: () => { nt.b = !nt.b; redo(); this.refreshInspector(); } } }, "B")),
        h("label.row.check", h("input", { type: "checkbox", checked: nt.border !== false, on: { change: (e) => { nt.border = e.target.checked; redo(); } } }), tt("Cadre (contour)")),
        h("div.row.colrow", h("span", tt("Couleur du texte")), swatch(nt.color || "#111111", (c) => { nt.color = c; this.editor.renderOverlay(); this.commitSoon("note"); })),
        h("div.row.colrow", h("label.row.check", h("input", { type: "checkbox", checked: !!nt.fill, on: { change: (e) => { nt.fill = e.target.checked ? "#ffffff" : ""; redo(); this.refreshInspector(); } } }), tt("Fond")),
          nt.fill ? swatch(nt.fill, (c) => { nt.fill = c; this.editor.renderOverlay(); this.commitSoon("note"); }) : ""),
        h("p.muted", tt("Glisser le cadre : le déplacer ; coin en bas à droite : sa taille ; double-clic : écrire dedans.")),
        h("button.mini.danger", { on: { click: () => this.removeNote() } }, tt("Supprimer le cadre")));
      return;
    }
    if (!pan) { box.append(h("h3", tt("Sélection")), h("p.muted", tt("Clique une case pour la régler ; glisse-y un décor puis des personnages depuis la banque."))); return; }
    if (l) {
      const item = this.bank.get(l.item), v = variantOf(item, l.v), sp0 = item && sprite(item, l.v, l.f), ls = pan.layers, i = ls.indexOf(l);
      // le trait est une version de l'illustration, jamais a sa place : l.ill montre l'illustration (les images de l'orbite) ;
      // pour un element qui n'est pas un dessin, l'illustration par defaut et le trait sur demande (l.tr)
      const sp = layerSp(sp0, l), trait = !!(sp && sp.vec);
      box.append(h("h3", item ? item.name : tt("Élément retiré de la banque"), l.lock ? h("span", { title: tt("Verrouillé : clic droit dessus pour le déverrouiller") }, " 🔒") : ""));
      if (sp0 && (sp0.vec || sp0.vecAlt)) box.append(h("div.axes", { title: tt("Le trait est une version de l'illustration, tracée pour être nette à tout zoom. L'illustration reste toujours là.") },
        [[true, tt("Illustration")], [false, tt("Trait")]].map(([ill, lab]) => h("button.mini" + (ill !== trait ? ".on" : ""), { on: { click: () => {
          if (ill) { if (sp0.vec) l.ill = 1; delete l.tr; } else { delete l.ill; if (sp0.vecAlt) l.tr = 1; }
          this.commit("ill"); this.editor.render(); this.refreshInspector(); } } }, lab))));
      if (!item) { box.append(h("button.mini.danger", { on: { click: () => this.removeLayer(l) } }, tt("Supprimer le calque"))); return; }
      box.append(h("label.row", tt("Pose"), h("select", { on: { change: (e) => this.setPose(l, e.target.value) } },
        Object.entries(item.variants).map(([k, vv]) => h("option", { value: k, selected: k === l.v }, (vv.orbit ? "↻ " : this.jobsFor(l.item, k) ? "⏳ " : "▫ ") + tr(vv.label))))));
      if (v && v.orbit) {
        const cur = nearestAxis(v.orbit, l.f || 0);
        box.append(h("div.axes", AXES.map((a) => h("button.mini" + (a === cur ? ".on" : ""), { on: { click: () => this.setAxis(l, a) } }, tr(a)))),
          range(tt("Rotation"), sp.i, 0, sp.n - 1, 1, (x) => { l.f = x; }, "frame"));
      } else box.append(h("p.muted", this.jobsFor(l.item, l.v) ? tt("Orbite en calcul : le personnage deviendra pivotable.") : tt("Pas d'orbite pour cette pose : image fixe.")));
      const rs = range(tt("Taille"), l.s, 0.05, 12, 0.01, (x) => { l.s = x; }, "lscale");
      const rpx = range(tt("Position ↔"), l.x, -4, 5, 0.005, (x) => { l.x = x; }, "lmove"), rpy = range(tt("Position ↕"), l.y, -4, 8, 0.005, (x) => { l.y = x; }, "lmove");
      this.syncLayer = () => { for (const [r, v] of [[rs, l.s], [rpx, l.x], [rpy, l.y]]) { r.querySelector("input").value = v; r.querySelector("output").textContent = fmt(v); } };
      // dépliant : reste ouvert ou fermé d'un élément à l'autre
      const fold = (key, label, ...rows) => { this.folds = this.folds || { sh: true, gs: true, wig: false };
        return h("details.fold", { open: !!this.folds[key], on: { toggle: (e) => { this.folds[key] = e.target.open; } } }, h("summary", label), ...rows); };
      if (sp && sp.vec) box.append(h("div", { title: tt("Dessin en tracés : net à tout zoom. Trait à 0 = celui du dessin ; vers la droite plus épais, vers la gauche plus fin, jusqu'à un filet.") }, range(tt("Trait ⓘ"), l.lw || 0, -12, 6, 0.1, (x) => { l.lw = x; }, "lw")),
        h("div", { title: tt("Épaisseur aléatoire : par endroits le trait s'épaissit, ailleurs il s'amincit, comme tracé à la plume. 0 : régulier.") }, range(tt("Épaisseur aléatoire ⓘ"), l.lj || 0, 0, 10, 0.1, (x) => { if (x > 0) l.lj = x; else delete l.lj; }, "lj")),
        fold("wig", tt("Tremblé du trait"), range(tt("Tremblé"), l.hand || 0, 0, 10, 0.1, (x) => { l.hand = x; }, "hand"), range(tt("Ondulation"), l.wave ?? 4, 0.5, 12, 0.1, (x) => { l.wave = x; }, "hand")),
        h("div.row.colrow", { title: tt("Couleur unie du personnage (le blanc du dessin). L'ombre et le masque de la bouche suivent.") }, h("span", tt("Couleur")),
          swatch(l.col || "#ffffff", (c) => { l.col = c; this.editor.render(true); this.commitSoon("col"); }),
          l.col && l.col.toLowerCase() !== "#ffffff" ? h("button.mini", { on: { click: () => { delete l.col; this.commit("col"); this.editor.render(); this.refreshInspector(); } } }, tt("Blanc")) : ""),
        h("div.row.colrow", { title: tt("Couleur du trait : tout ce qui est noir dans le dessin prend cette couleur.") }, h("span", tt("Contour")),
          swatch(l.ink || "#111111", (c) => { l.ink = c; this.editor.render(true); this.commitSoon("ink"); }),
          l.ink && l.ink.toLowerCase() !== "#111111" ? h("button.mini", { on: { click: () => { delete l.ink; this.commit("ink"); this.editor.render(); this.refreshInspector(); } } }, tt("Noir")) : ""));
      if (sp && !sp.vec) {                                   // colorize : une couleur en produit dans la decoupe (le blanc la prend)
        const tn = l.tint || {};
        const cb = h("input", { type: "checkbox", checked: !!tn.on, on: { change: (e) => { l.tint = Object.assign({ c: "#e9b98f" }, l.tint, { on: e.target.checked }); this.commit("tint"); this.editor.render(); } } });
        box.append(h("div.row.colrow", { title: tt("Pose une couleur en produit sur le personnage, dans sa découpe : le blanc prend la couleur, les traits et la peinture restent visibles. Les bouches du lip sync prennent la même couleur.") },
          h("label.row.check", cb, tt("Colorize ⓘ")),
          swatch(tn.c || "#e9b98f", (c) => { l.tint = { on: true, c }; cb.checked = true; this.editor.render(true); this.commitSoon("tint"); })));
      }
      if (sp0) box.append(hslFold(() => l.hsl, (n) => { if (n) l.hsl = n; else delete l.hsl; }, "hsl", tt("Teinte, saturation, luminosité et contraste de l'élément, comme dans Photoshop (Ctrl+U). Les bouches du lip sync suivent.")));
      box.append(range(tt("Inclinaison"), l.rz || 0, -180, 180, 1, (x) => { l.rz = x; }, "rz"));
      box.append(rs, rpx, rpy,
        range(tt("Profondeur"), depthOf(pan, i), 0, 1, 0.01, (x) => { l.d = x; }, "depth"));
      // ombre et ombre portee : en dernier, apres la profondeur
      if (sp && sp.vec) {
        const sh = l.sh || {}, put = (k, x) => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135 }, l.sh, { [k]: x }); };
        box.append(h("label.row.check", { title: tt("Un aplat gris posé sur le dessin, du côté opposé à la lumière. Sans calcul.") }, h("input", { type: "checkbox", checked: !!sh.on, on: { change: (e) => { put("on", e.target.checked); this.commit("shade"); this.editor.render(); this.refreshInspector(); } } }), tt("Ombre")));
        if (sh.on) box.append(fold("sh", tt("Réglages de l'ombre"),
          h("label.row.check", { title: tt("L'ombre prend la couleur choisie pour le contour du dessin, au lieu d'assombrir la couleur du corps") }, h("input", { type: "checkbox", checked: !!sh.ink, on: { change: (e) => { put("ink", e.target.checked); this.editor.render(true); this.commit("shade"); } } }), tt("Cloner la couleur de contour")),
          range(tt("Gris"), sh.g ?? 0.72, 0.2, 0.95, 0.01, (x) => put("g", x), "shade"),
          range(tt("Largeur"), sh.w ?? 5, 0.5, 25, 0.1, (x) => put("w", x), "shade"),
          range(tt("Lumière (angle)"), sh.a ?? 135, 0, 360, 1, (x) => put("a", x), "shade"),
          h("div", { title: tt("0 : ombre sur la silhouette seule. Monter ajoute une ombre aux plus grandes formes du dessin (tête, torse…), une par cran.") }, range(tt("Formes détaillées ⓘ"), sh.k ?? 0, 0, 8, 1, (x) => put("k", x), "shade"))));
      }
      {
        const gs = l.gs || {}, putg = (k, x) => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { [k]: x }); };
        box.append(h("div.row.wrap", h("label.row.check", { title: tt("Une tache sombre et floue sous l'élément, pour le poser au sol") }, h("input", { type: "checkbox", checked: !!gs.on, on: { change: (e) => { putg("on", e.target.checked); this.commit("cast"); this.editor.render(); this.refreshInspector(); } } }), tt("Ombre portée")),
          gs.on ? h("label.row.check", { title: tt("Au mur : l'ombre se dresse à la verticale sur le côté, derrière le personnage, au lieu d'être couchée au sol. Mêmes réglages.") }, h("input", { type: "checkbox", checked: !!gs.wall, on: { change: (e) => { putg("wall", e.target.checked); this.commit("cast"); this.editor.render(); } } }), tt("Au mur")) : ""));
        if (gs.on) box.append(fold("gs", tt("Réglages de l'ombre portée"),
          h("div.row.colrow", { title: tt("Couleur de l'ombre portée. « Cloner la couleur de contour », s'il est coché, l'emporte sur elle.") }, h("span", tt("Couleur")),
            swatch(gs.c || "#000000", (c) => { putg("c", c); this.editor.render(true); this.commitSoon("cast"); })),
          h("label.row.check", { title: tt("L'ombre prend la couleur choisie pour le contour du dessin, au lieu du noir") }, h("input", { type: "checkbox", checked: !!gs.ink, on: { change: (e) => { putg("ink", e.target.checked); this.editor.render(true); this.commit("cast"); } } }), tt("Cloner la couleur de contour")),
          range(tt("Opacité"), gs.a ?? 0.35, 0.05, 1, 0.01, (x) => putg("a", x), "cast"),
          h("div", { title: tt("0 : bord net. Vers la droite : de plus en plus floue.") }, range(tt("Flou ⓘ"), gs.b ?? 1, 0, 4, 0.05, (x) => putg("b", x), "cast")),
          range(tt("Épaisseur"), gs.h ?? 1, 0.2, 4, 0.05, (x) => putg("h", x), "cast"),
          h("div", { title: tt("Pour la caler sous les pieds quand le personnage a l'air de flotter") }, range(tt("Décalage ↔ ⓘ"), gs.dx || 0, -0.6, 0.6, 0.005, (x) => putg("dx", x), "cast"), range(tt("Décalage ↕"), gs.dy || 0, -0.6, 0.6, 0.005, (x) => putg("dy", x), "cast")),
          range(tt("Largeur"), gs.w ?? 0.8, 0.2, 2.5, 0.01, (x) => putg("w", x), "cast"),
          h("div", { title: tt("Déforme le contour de l'ombre. 0 : ovale net. Tout à droite : une tache abstraite. Ondulation courte = bord déchiqueté, longue = grandes vagues. Forme : une autre tache, au hasard.") },
            range(tt("Tremblé ⓘ"), gs.hand || 0, 0, 10, 0.1, (x) => putg("hand", x), "cast"), range(tt("Ondulation"), gs.wave ?? 4, 0.5, 12, 0.1, (x) => putg("wave", x), "cast"), range(tt("Forme"), gs.seed || 0, 0, 40, 1, (x) => putg("seed", x), "cast"))));
      }
      box.append(
        h("div.row", h("button.mini" + (l.flip ? ".on" : ""), { on: { click: () => { l.flip = !l.flip; this.commit("flip"); this.editor.render(); this.refreshInspector(); } } }, tt("⇋ Miroir")),
          h("button.mini", { on: { click: () => this.order(l, "up") } }, tt("Avancer")), h("button.mini", { on: { click: () => this.order(l, "down") } }, tt("Reculer")),
          h("button.mini", { on: { click: () => this.duplicate(l) } }, tt("Dupliquer")),
          h("button.mini", { title: tt("Ajouter cet élément, tel qu'il est réglé, dans d'autres cases"), on: { click: () => this.copyLayerTo(l) } }, tt("Copier vers…")),
          h("button.mini.danger", { on: { click: () => this.removeLayer(l) } }, tt("Supprimer"))),
        h("button.mini", { on: { click: () => this.bankUI.openItem(l.item) } }, tt("Fiche : poses et orbites…")));
      return;
    }
    if (b) {
      const AB = window.AliveBubbles, upd = () => { this.editor.bubs.get(this.sel.panel)?.layout(); this.commitSoon("bub-" + b.id); };
      const sel = (label, key, opts) => h("label.row", label, h("select", { on: { change: (e) => { b[key] = e.target.value; this.editor.render(); this.commit("bub"); } } },
        opts.map(([v, t]) => h("option", { value: v, selected: (b[key] || opts[0][0]) === v }, t))));
      box.append(h("h3", tt("Bulle")),
        h("textarea", { rows: 3, on: { input: (e) => { b.text = e.target.value; const it = this.editor.bubs.get(this.sel.panel)?.items.find((x) => x.b === b); if (it) it.txt.textContent = b.text; upd(); } } }, b.text || ""),
        sel(tt("Forme"), "type", Object.entries(BUB).map(([k, v]) => [k, v[0]])),
        sel(tt("Taille"), "size", [["S", tt("Petite")], ["M", tt("Moyenne")], ["L", tt("Grande")]]),
        sel(tt("Couleur"), "color", Object.entries(AB.COLOR_NAMES)),
        sel(tt("Police"), "font", Object.entries(AB.FONTS).map(([k, v]) => [k, v[0]])),
        h("div.row", h("button.mini", { on: { click: () => { if (b.tx != null) { delete b.tx; delete b.ty; delete b.bx; delete b.by; } else { b.tx = b.x + 0.06; b.ty = b.y + 0.2; } this.commit("bub"); this.editor.render(); } } }, tt("Queue oui / non")),
          h("button.mini.danger", { on: { click: () => this.removeBubble() } }, tt("Supprimer"))));
      return;
    }
    const mk = this.mark();
    if (mk) {
      const redo = () => { this.editor.render(); this.commit("mark"); this.refreshInspector(); };
      box.append(h("h3", tt("Indication · ") + MARKS[mk.type][0]),
        h("div.row.colrow", h("span", tt("Couleur")), swatch(mk.color || "#111111", (c) => { mk.color = c; this.editor.render(true); this.commitSoon("mark"); })),
        range(tt("Épaisseur"), mk.w || 1, 0.4, 4, 0.1, (x) => { mk.w = x; }, "mark"),
        h("label.row.check", h("input", { type: "checkbox", checked: mk.ol !== false, on: { change: (e) => { if (e.target.checked) delete mk.ol; else mk.ol = false; redo(); } } }), tt("Contour")),
        ...(mk.ol !== false ? [range(tt("Taille du contour"), mk.ow ?? 1, 0.2, 4, 0.1, (x) => { mk.ow = x; }, "mark"),
          h("div.row.colrow", h("span", tt("Couleur du contour")), swatch(mk.oc || ((mk.color || "#111111") === "#ffffff" ? "#111111" : "#ffffff"), (c) => { mk.oc = c; this.editor.render(true); this.commitSoon("mark"); }))] : []),
        ...(mk.type === "turn" ? [range(tt("Perspective"), mk.pv || 0, 0, 85, 1, (x) => { mk.pv = x; }, "mark"),
          range(tt("Inclinaison"), mk.pa || 0, -90, 90, 1, (x) => { mk.pa = x; }, "mark"),
          h("p.muted", tt("Perspective : la rotation se couche, comme vue en biais, pour montrer un objet qui tourne sur son axe. Inclinaison : l'axe penche."))] : []),
        h("div.row",
          h("button.mini" + ((mk.type === "frame" ? mk.dash !== false : mk.dash) ? ".on" : ""), { on: { click: () => { mk.dash = mk.type === "frame" ? mk.dash === false : !mk.dash; redo(); } } }, tt("Pointillés")),
          mk.type === "turn" ? h("button.mini", { on: { click: () => { mk.cw = mk.cw === false; redo(); } } }, tt("Inverser le sens"))
            : mk.type !== "frame" ? h("button.mini" + (mk.both ? ".on" : ""), { on: { click: () => { mk.both = !mk.both; redo(); } } }, tt("Deux pointes")) : ""),
        h("div.row", h("button.mini", { title: tt("Glisser l'indication la déplace ; ses points ronds la déforment."), on: { click: () => this.duplicateMark() } }, tt("Dupliquer")), h("button.mini.danger", { title: tt("Ou touche Suppr"), on: { click: () => this.removeMark() } }, tt("Supprimer"))));
      return;
    }
    // ---- la case
    const g = this.geo(this.sel.panel), bg = background(pan, this.bank, this.project.id);
    const dof = pan.dof || (pan.dof = { on: false, focus: 0.3, amount: 12 });
    box.append(h("h3", tt("Case ") + (g ? g.order : "")));
    box.append(h("div.row", h("span.muted", tt("Fond :")), h("span", bg ? (bg.item ? bg.item.name : tt("image importée")) : "aucun"),
      bg && bg.item ? h("button.mini", { title: tt("Montrer ce décor dans la banque"), on: { click: () => this.bankUI.reveal(bg.item.id) } }, "📍") : null,
      bg ? h("button.mini", { on: { click: () => { delete pan.bg; this.commit("bg"); this.editor.render(); this.refreshInspector(); } } }, tt("Retirer")) : null));
    box.append(h("div.row", h("button.mini", { title: tt("Formes simples, tracés, gris en trame de points : un décor fait à la main en noir et blanc"), on: { click: () => this.drawBackground(this.sel.panel) } }, (pan.draw ? tt("✎ Modifier le fond dessiné") : tt("✎ Dessiner le fond"))),
      pan.draw ? h("button.mini.danger", { on: { click: () => { delete pan.draw; this.commit("draw"); this.editor.render(); this.refreshInspector(); } } }, tt("Retirer le dessin")) : ""));
    if (bg && bg.item && Object.keys(bg.item.variants).length > 1) box.append(h("label.row", tt("Ambiance"), h("select", { on: { change: (e) => { pan.bg.v = e.target.value; pan.bg.f = 0; this.commit("bg"); this.editor.render(); this.refreshInspector(); } } },
      Object.entries(bg.item.variants).map(([k, vv]) => h("option", { value: k, selected: k === (pan.bg.v || "base") }, tr(vv.label))))));
    if (bg && bg.orbit) box.append(range(tt("Axe du décor"), pan.bg.f || 0, 0, bg.n - 1, 1, (x) => { pan.bg.f = x; }, "bturn"));
    if (bg) {
      // cadrage du fond : zoom, puis position horizontale et verticale (-100 = bord gauche / haut, 100 = bord droit / bas)
      const travel = () => { const pl = placement(g.bbox, bg.w || 16, bg.h || 9, pan.view); return { pl, mx: (pl.w - g.bbox.w) / (2 * g.bbox.w), my: (pl.h - g.bbox.h) / (2 * g.bbox.h) }; };
      const pos = (axis) => { const t = travel(), m = axis === "x" ? t.mx : t.my, o = axis === "x" ? t.pl.ox : t.pl.oy; return m > 1e-4 ? Math.round(-o / m * 100) : 0; };
      const setPos = (axis, x) => { const t = travel(), v = Object.assign({ zoom: 1, ox: 0, oy: 0 }, pan.view); if (axis === "x") v.ox = -x / 100 * t.mx; else v.oy = -x / 100 * t.my; pan.view = v; };
      const rx = range(tt("Cadrage ↔"), pos("x"), -100, 100, 1, (x) => setPos("x", x), "pan");
      const ry = range(tt("Cadrage ↕"), pos("y"), -100, 100, 1, (x) => setPos("y", x), "pan");
      const sync = () => { for (const [r, a] of [[rx, "x"], [ry, "y"]]) { const t = travel(), free = (a === "x" ? t.mx : t.my) > 1e-4; r.querySelector("input").value = pos(a); r.querySelector("output").textContent = pos(a); r.querySelector("input").disabled = !free; r.classList.toggle("off", !free); } };
      this.syncPan = sync;
      if (bg.vec) box.append(h("div", { title: tt("Trait à 0 = celui du dessin ; vers la gauche plus fin, jusqu'à effacer les traits les plus fins ; vers la droite plus épais.") }, range(tt("Trait du fond ⓘ"), pan.bglw || 0, -12, 6, 0.1, (x) => { pan.bglw = x; }, "bglw")),
        h("div", { title: tt("Épaisseur aléatoire : par endroits le trait s'épaissit, ailleurs il s'amincit, comme tracé à la plume. 0 : régulier.") }, range(tt("Épaisseur aléatoire ⓘ"), pan.bglj || 0, 0, 10, 0.1, (x) => { if (x > 0) pan.bglj = x; else delete pan.bglj; }, "bglj")),
        h("div.row.colrow", { title: tt("Tout ce qui est noir dans le décor prend cette couleur.") }, h("span", tt("Couleur du trait")),
          swatch(pan.bgink || "#111111", (c) => { pan.bgink = c; this.editor.render(true); this.commitSoon("bgink"); }),
          pan.bgink && pan.bgink.toLowerCase() !== "#111111" ? h("button.mini", { on: { click: () => { delete pan.bgink; this.commit("bgink"); this.editor.render(); this.refreshInspector(); } } }, tt("Noir")) : ""),
        range(tt("Tremblé du fond"), pan.bghand || 0, 0, 10, 0.1, (x) => { pan.bghand = x; }, "bghand"), range(tt("Ondulation du fond"), pan.bgwave ?? 4, 0.5, 12, 0.1, (x) => { pan.bgwave = x; }, "bghand"));
      {                                                    // colorize et colorimetrie du decor, comme pour un element
        const tn = pan.bgtint || {};
        const cb = h("input", { type: "checkbox", checked: !!tn.on, on: { change: (e) => { pan.bgtint = Object.assign({ c: "#e9b98f" }, pan.bgtint, { on: e.target.checked }); this.commit("bgtint"); this.editor.render(); } } });
        box.append(h("div.row.colrow", { title: tt("Pose une couleur en produit sur tout le décor : le blanc prend la couleur, les traits et la peinture restent visibles.") },
          h("label.row.check", cb, tt("Colorize ⓘ")),
          swatch(tn.c || "#e9b98f", (c) => { pan.bgtint = { on: true, c }; cb.checked = true; this.editor.render(true); this.commitSoon("bgtint"); })),
          hslFold(() => pan.bghsl, (n) => { if (n) pan.bghsl = n; else delete pan.bghsl; }, "bghsl", tt("Teinte, saturation, luminosité et contraste du décor, comme dans Photoshop (Ctrl+U).")));
      }
      box.append(range(tt("Zoom du fond"), (pan.view || {}).zoom || 1, 0.25, 6, 0.01, (x) => { const t0 = travel(), kx = t0.mx > 1e-4 ? t0.pl.ox / t0.mx : 0, ky = t0.my > 1e-4 ? t0.pl.oy / t0.my : 0; pan.view = Object.assign({ ox: 0, oy: 0 }, pan.view, { zoom: x }); const t1 = travel(); pan.view.ox = kx * t1.mx; pan.view.oy = ky * t1.my; sync(); }, "pan"),
        rx, ry, h("div.row", h("button.mini", { title: tt("Zoom 1, fond centré"), on: { click: () => { pan.view = { zoom: 1, ox: 0, oy: 0 }; this.commit("pan"); this.editor.render(); this.refreshInspector(); } } }, tt("Recentrer le fond")),
          h("span.muted", bg.orbit ? tt("Maj + glisser dans la case : recadrer") : tt("Glisser dans la case : recadrer"))));
      sync();
    } else this.syncPan = null;
    box.append(h("button", { title: tt("Vue de dessus de la case : la caméra en bas, le décor en haut, chaque élément posé à sa profondeur. Glisser une carte : haut / bas = sa profondeur, gauche / droite = sa place. C'est la même position que dans le montage."), on: { click: () => this.depthDialog(this.sel.panel) } }, tt("⬒ Profondeur (vue de dessus)")),
      h("button.danger", { title: tt("Vide entièrement la case : décor, éléments, bulles, indications, fond dessiné, montage, rendus. Une alerte demande confirmation."), on: { click: () => this.restorePanel(this.sel.panel) } }, tt("🧹 Restore case")));
    if (pan.frame) box.append(h("div.row", h("span.muted", { title: tt("Le cadrage de la caméra à la première image du montage (« 1re image → case »). La case le montre, l'impression et Integrate aussi.") }, tt`Cadrage du montage : zoom ${(+pan.frame.z).toFixed(2)} ⓘ`),
      h("button.mini", { on: { click: () => { delete pan.frame; this.commit("frame"); this.editor.render(); this.refreshInspector(); } } }, tt("Retirer le cadrage"))));
    box.append(h("h4", { title: tt("0 = premier plan, 1 = décor. Chaque calque a sa profondeur (par défaut : son ordre).") }, tt("Profondeur de champ ⓘ")),
      h("label.row.check", h("input", { type: "checkbox", checked: dof.on, on: { change: (e) => { dof.on = e.target.checked; this.commit("dof"); this.editor.render(); } } }), tt("Flouter selon la profondeur")),
      (() => { const r = range(tt("Mise au point"), dof.focus, 0, 1, 0.01, (x) => { dof.focus = x; dof.on = true; }, "dof");
        r.append(h("button.mini.target" + (this.focusPick ? ".on" : ""), { title: tt("Cible : clique ensuite sur un personnage ou un élément de la case, la mise au point se fait sur lui (sur sa profondeur). Échap : annuler."), on: { click: (e) => { e.preventDefault(); this.setFocusPick(!this.focusPick); } } }, "🎯"));
        return r; })(),
      range(tt("Flou"), dof.amount, 0, 60, 1, (x) => { dof.amount = x; dof.on = true; }, "dof"));
    const style = h("select", { title: INTEGRATE_STYLES.map(([, l, tip]) => l + " : " + tip).join("\n") }, INTEGRATE_STYLES.map(([v, t]) => h("option", { value: v, selected: v === (pan.style || this.guessStyle(pan)) }, t)));
    style.addEventListener("change", () => { pan.style = style.value; this.commitSoon("style"); });
    const extra = h("input", { type: "text", placeholder: tt("Consigne en plus (facultatif) : « night, rain »…") });
    // moteur d'Integrate : choisi une fois, applique a tous les Integrate (cases, clic droit, « Tout en… »)
    const engNow = (this.info.settings.render || {}).integrate_engine || "";
    const engList = INTEGRATE_ENGINES.some(([k]) => k === engNow) ? INTEGRATE_ENGINES : [...INTEGRATE_ENGINES, [engNow, engNow.replace(/^fal:/, "fal · ")]];
    const engine = h("select", { title: tt("Le moteur qui calcule Integrate. Ce choix est gardé et s'applique à tous les Integrate, jusqu'à ce que tu le changes.") },
      engList.map(([k, t]) => h("option", { value: k, selected: k === engNow }, t)), h("option", { value: "+" }, tt("Autre modèle fal…")));
    engine.addEventListener("change", async () => {
      let v = engine.value;
      if (v === "+") { const m = (prompt(tt("Identifiant du modèle d'édition sur fal (il doit accepter plusieurs images en « image_urls ») :"), "fal-ai/") || "").trim(); if (!m || m === "fal-ai/") { engine.value = engNow; return; } v = "fal:" + m; }
      try { await put("settings", { render: { integrate_engine: v } }); }
      catch (e) { engine.value = engNow; return toast(tt("Moteur d'Integrate non changé : ") + e.message + ".", "error"); }
      this.info = await get("info");
      toast(tt("Moteur d'Integrate enregistré : ") + (v ? v.replace(/^fal:/, "fal · ") : tt("automatique")) + "."); this.refreshInspector();
    });
    box.append(h("h4", tt("Image finale")), h("label.row", tt("Rendu"), style), h("label.row", tt("Moteur"), this.noMachines() ? h("span.muted", tt("fal, avec ta clé")) : engine), extra,
      h("div.row", h("button.primary", { title: tt("Une seule image, lumière et ombres unifiées"), on: { click: () => this.integrate(style.value, extra.value.trim()) } }, tt("✦ Integrate")),
        h("button", { title: tt("Orbite 360° de toute la case"), on: { click: () => this.panelOrbit() } }, tt("↻ Orbite de la case"))),
      h("div.row", h("button.photo-go", { title: tt("La case rendue en photo : GPT Image 2.6 et Seedream 5.5 à comparer (fal, payant)"), on: { click: () => this.casePhoto() } }, tt("📷 Générer photo"))));
    if (pan.integrated || pan.orbit) {
      const modes = [["layers", tt("Calques")]]; if (pan.integrated) modes.push(["integrated", tt("Intégrée")]); if (pan.orbit) modes.push(["orbit", tt("Orbite")]);
      const oOn = pan.orbit && pan.show === "orbit";
      box.append(h("div.row", h("span.muted", tt("Afficher :")), modes.map(([m, t]) => h("button.mini" + ((pan.show || "layers") === m ? ".on" : ""), { on: { click: () => this.setShow(m) } }, t)),
        pan.orbit ? h("button.mini" + (oOn ? ".star" : ""), { disabled: !oOn, title: oOn ? tt("Remet les éléments de la case en place vus sous cet angle de l'orbite : même place, même taille, l'image de leur tournette qui correspond. Rien n'est calculé, sauf le décor si tu le demandes.") : tt("Affiche l'orbite et arrête-toi sur un angle"),
          on: { click: () => this.orbitPlace() } }, tt("↻ Recalculer la perspective")) : ""));
      if ((pan.integrations || []).length > 1) box.append(h("div.versions", pan.integrations.map((f, i) => h("img" + (f === pan.integrated ? ".on" : ""), {
        src: `/projects/${this.project.id}/${f}`, title: tt("Version ") + (i + 1), on: { click: () => { pan.integrated = f; pan.show = "integrated"; this.commit("ver"); this.editor.render(); this.refreshInspector(); } } }))));
      if (pan.show === "orbit" && pan.orbit) box.append(range(tt("Axe de la scène"), pan.orbit.frame || 0, 0, pan.orbit.n - 1, 1, (x) => { pan.orbit.frame = x; }, "oturn"));
    }
    box.append(h("h4", tt("Animation")), h("div.row", h("button.mini", { title: tt("Timeline, poses clés, caméra virtuelle"), on: { click: () => openMontage(this, this.sel.panel) } }, pan.anim ? tt("🎬 Ouvrir le montage") : tt("🎬 Mode montage")),
      pan.anim ? h("span.muted", tt`${pan.anim.dur} s · ${Object.values(pan.anim.tracks || {}).reduce((n, k) => n + k.length, 0)} clés`) : ""),
      h("div.row", h("button.mini", { title: tt("Ajoute cette case comme plan dans le deck de montage global"), on: { click: () => this.sendToDeck(this.sel.panel) } }, tt("▸ Envoyer dans le deck")),
        h("button.mini", { on: { click: () => openDeck(this) } }, tt("🎞 Ouvrir le deck")),
        h("button.mini", { title: tt("La case entière dans l'onglet Cases de la banque, à glisser dans d'autres cases"), on: { click: () => this.saveCase(this.sel.panel) } }, tt("💾 Enregistrer la case")),
        (() => { const d = this.decks().find((x) => x.id === this.project.deckCur) || this.decks()[0]; if (!d) return ""; const n = d.clips.filter((c) => c.panel === this.sel.panel && c.page === this.page().id).length; return h("span.muted", `« ${d.name} »` + (n ? tt` · déjà ${n} fois` : "")); })()));
    box.append(h("h4", tt("Indications")), h("div.row.wrap", Object.entries(MARKS).map(([t, [label, ico]]) => h("button.mini" + (this.markTool === t ? ".on" : ""), { title: tt("Tracer dans une case : ") + label, on: { click: () => this.armMark(t) } }, `${ico} ${label}`))));
    box.append(h("h4", tt("Bulles")), h("div.row", Object.entries(BUB).map(([t, [label]]) => h("button.mini", { on: { click: () => this.addBubble(t) } }, "+ " + label))));
    if ((pan.layers || []).length) box.append(h("h4", tt("Calques (du fond vers l'avant)")), h("div.layers", pan.layers.map((x) => {
      const it = this.bank.get(x.item);
      return h("button.lrow", { on: { click: () => this.select({ panel: this.sel.panel, layer: x.id }) } }, it ? it.name : "?", h("span.muted", it ? tr(variantOf(it, x.v).label) : ""));
    })));
  }

  // ---------------------------------------------------------------- rendus
  jobsFor(itemId, variant) {
    return this.jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.params.item === itemId &&
      (!variant || j.params.variant === variant || (!j.params.variant && variant !== "base"))).length;
  }
  panelState(pid) {
    const j = this.jobs.find((x) => (x.status === "queued" || x.status === "running") && x.params.panel === pid && x.params.project === this.project?.id);
    return j ? { kind: j.status === "running" ? "busy" : "wait", text: tr(j.title) } : null;
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
      this.el.jobsBtn.textContent = active ? tt`Rendus · ${run} en cours, ${active - run} en file` : tt("Rendus");
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
    const label = { queued: tt("en file"), running: tt("en cours"), done: tt("fait"), error: tt("erreur"), cancelled: tt("annulé") };
    d.textContent = "";
    d.append(h("header", h("b", tt("Rendus")), h("div.grow"),
      h("button.mini", { on: { click: async () => { await post("jobs/cancel-all"); this.pollSoon(); } } }, tt("Tout annuler")),
      h("button.mini", { on: { click: async () => { await post("jobs/clear"); this.pollSoon(); } } }, tt("Effacer les terminés")),
      h("button.icon", { on: { click: () => this.toggleJobs() } }, "✕")),
      h("div.joblist", rows.length ? rows.map((j) => h("div.job." + j.status, h("span.dot." + ({ queued: "wait", running: "busy", done: "ok", error: "err", cancelled: "off" })[j.status]),
        h("span.jt", tr(j.title)), h("span.muted", [label[j.status], j.worker, tr(j.progress), j.status === "running" ? Math.round(Date.now() / 1000 - j.started) + " s" : "",
          j.status === "done" ? Math.round(j.finished - j.started) + " s" : ""].filter(Boolean).join(" · ")),
        j.error ? h("span.err", { title: tr(j.error) }, tr(j.error).slice(0, 140)) : null,
        j.status === "queued" || j.status === "running" ? h("button.mini", { on: { click: async () => { await post(`jobs/${j.id}/cancel`); this.pollSoon(); } } }, tt("Annuler")) : null))
        : h("p.muted", tt("Aucun rendu pour l'instant."))));
  }
  async pollWorkers() {
    if (this.noMachines()) {                                   // pas d'etat des machines : seulement la cle fal personnelle
      const mine = !!localStorage.getItem("bw.falKey");
      this.el.workers.replaceChildren(h("span.muted", mine ? tt("fal · ma clé") : tt("pas de clé fal")));
      this.el.workers.title = mine ? tt("Compte invité : tes calculs partent sur fal avec ta propre clé.") : tt("Compte invité : entre ta clé fal dans Réglages › fal › « Ma clé (ce navigateur) » pour lancer des calculs.");
      return;
    }
    try {
      const ws = await get("workers");
      this.el.workers.textContent = "";
      this.el.workers.append(...ws.map((w) => h("span.dot." + (!w.online ? "err" : w.busy || w.load ? "busy" : w.orbit ? "ok" : "wait"),
        { title: `${w.name} : ${!w.online ? tt("injoignable") : (w.busy || w.load ? tt("occupée") : tt("prête"))}${w.missing?.length ? " · manque : " + w.missing.join(", ") : ""}${w.gpu ? " · " + w.gpu : ""}` })),
        h("span.muted", ws.length ? tt`${ws.filter((w) => w.online).length}/${ws.length} machines` : (this.info.settings.fal.key || localStorage.getItem("bw.falKey") ? "fal" : tt("aucune machine"))));
    } catch (e) { /* plus tard */ }
    setTimeout(() => this.pollWorkers(), 20000);
  }

  // ---------------------------------------------------------------- reglages
  async settingsDialog() {
    // la fenetre s'ouvre des que les reglages sont lus ; l'etat des machines arrive ensuite (une machine injoignable
    // peut faire attendre longtemps)
    let s;
    try { s = await get("settings"); }
    catch (e) { toast(tt("Réglages illisibles : ") + (e.message || e), "error"); return; }
    const wbox = h("div.wstatus", h("p.muted", tt("Recherche des machines…")));
    get("workers?fresh=1").catch(() => []).then((ws) => {
      wbox.replaceChildren(...(ws.length ? ws.map((w) => h("div", h("span.dot." + (w.online ? (w.orbit ? "ok" : "wait") : "err")), ` ${w.name} · ${w.online ? (w.gpu || tt("en ligne")) : tt("injoignable")}`,
        w.online ? h("span.muted", " · " + ["orbit", "matte", "edit", "t2i"].map((c) => (w[c] ? "✓ " : "✗ ") + ({ orbit: "orbite", matte: tt("détourage"), edit: tt("édition"), t2i: "image" })[c]).join("  ")) : null)) : [h("p.muted", tt("Aucune machine déclarée."))]));
    });
    const f = (v, ph, type = "text") => h("input", { type, value: v ?? "", placeholder: ph || "", autocomplete: type === "password" ? "new-password" : "off" });
    const workers = h("textarea", { rows: 4, placeholder: "HITCHCOCK | http://192.168.1.60:8188" }, (s.workers || []).map((w) => `${w.name} | ${w.url}`).join("\n"));
    const qb = f(s.qbuilder_settings, tt("…\\Workflows-Q-Builder\\local_settings.json"));
    const len = h("select", [[73, tt("3 s (73 images)")], [90, "3,75 s"], [107, "4,5 s"], [124, tt("5,2 s (124 images)")]].map(([v, t]) => h("option", { value: v, selected: v === s.render.orbit_length }, t)));
    const POSE_ENGINES = [["", tt("Comme le reste (Qwen-Image-Edit)")],
      ["fal:openai/gpt-image-2.5/flare/edit", tt("fal · GPT Image 2.5 Flare, qualité moyenne 1K : le moins cher (≈ 0,02 $ l'image)")],
      ["fal:fal-ai/nano-banana-2/edit", tt("fal · Nano Banana 2, 1K (≈ 0,08 $ l'image)")],
      ["fal:fal-ai/nano-banana-pro/edit", tt("fal · Nano Banana Pro : fidèle au trait et aux couleurs (≈ 0,15 $ l'image)")]];
    const peNow = s.render.pose_engine || "", pose = h("select", { title: tt("Le modèle qui dessine les poses et la planche de vues (dos, profil). Le détourage et l'orbite restent sur tes machines.") },
      (POSE_ENGINES.some(([k]) => k === peNow) ? POSE_ENGINES : [...POSE_ENGINES, [peNow, peNow.replace(/^fal:/, "fal · ")]]).map(([v, t]) => h("option", { value: v, selected: v === peNow }, t)));
    const tgt = h("select", [["auto", tt("Auto : machines d'abord, fal sinon")], ["local", tt("Machines seulement")], ["fal", tt("fal seulement")]].map(([v, t]) => h("option", { value: v, selected: v === s.render.target }, t)));
    // champ secret : toujours masque, jamais propose par l'historique du navigateur, avec un bouton pour coller
    const secret = (v, ph) => h("input", { type: "password", value: v ?? "", placeholder: ph || "", autocomplete: "new-password", name: "bw-" + uid(), spellcheck: "false", "data-lpignore": "true", "data-1p-ignore": "true" });
    const paste = (inp) => h("button.mini", { type: "button", title: tt("Coller le contenu du presse-papiers dans ce champ"), on: { click: async (e) => {
      e.preventDefault();
      try { const t = (await navigator.clipboard.readText()).trim(); if (!t) return toast(tt("Le presse-papiers est vide."), "error"); inp.value = t; toast(tt("Clé collée (") + t.length + tt(" caractères). N'oublie pas « Enregistrer ».")); }
      catch (err) { toast(tt("Le navigateur refuse l'accès au presse-papiers : clique dans le champ puis Ctrl+V."), "error"); } } } }, tt("Coller"));
    const key = secret(s.fal.key, tt("clé fal du poste")), myKey = secret(localStorage.getItem("bw.falKey") || "", tt("ma clé fal (reste dans ce navigateur)"));
    const orbit = f(s.fal.orbit), edit = f(s.fal.edit), t2i = f(s.fal.t2i);
    const el = s.elevenlabs || {}, ekey = secret(el.key, tt("clé ElevenLabs du poste")), emodel = f(el.model || "eleven_multilingual_v2");
    const myEkey = secret(localStorage.getItem("bw.elevenKey") || "", tt("ma clé ElevenLabs (reste dans ce navigateur)"));
    const help = (which) => h("button.mini.keyhelp", { type: "button", title: tt("Comment obtenir ma clé ?"), on: { click: (e) => { e.preventDefault(); this.keyGuide(which); } } }, "?");
    const fres = h("select", [["480P", tt("480P · le moins cher (≈ 0,31 $ l'orbite de 5 s)")], ["768P", "768P (≈ 0,375 $)"], ["2K", "2K"], ["4K", "4K"]].map(([v, t]) => h("option", { value: v, selected: v === (s.fal.orbit_resolution || "768P") }, t)));
    const fcon = h("input", { type: "number", min: 1, max: 20, step: 1, value: s.fal.concurrency || 3 });
    // intelligence : la cle reste sur le serveur (le navigateur ne recoit que « •••• » quand il y en a une)
    const br = s.brain || {}, MODELS = { anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"], openai: ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-terra", "gpt-6-luna"] };
    const bprov = h("select", [["anthropic", "Anthropic (Claude)"], ["openai", "OpenAI (GPT)"]].map(([v, t]) => h("option", { value: v, selected: v === (br.provider || "anthropic") }, t)));
    const bkey = secret(br.key, tt("clé d'API (reste sur ce poste)")), bmodel = f(br.model || "claude-opus-5-5"), blist = h("datalist", { id: "bw-brain-models" });
    bmodel.setAttribute("list", "bw-brain-models");
    const fillModels = () => { blist.replaceChildren(...MODELS[bprov.value].map((m) => h("option", { value: m }))); };
    bprov.addEventListener("change", () => { if (!MODELS[bprov.value].includes(bmodel.value)) bmodel.value = MODELS[bprov.value][0]; fillModels(); beffRow.style.display = bprov.value === "anthropic" ? "" : "none"; });
    fillModels();
    const beff = h("select", [["low", tt("bas")], ["medium", tt("moyen")], ["high", tt("haut")]].map(([v, t]) => h("option", { value: v, selected: v === (br.effort || "medium") }, t)));
    const beffRow = h("label.row", { style: { display: (br.provider || "anthropic") === "anthropic" ? "" : "none" } }, tt("Effort de réflexion"), beff);
    const baudit = h("input", { type: "checkbox", checked: br.audit !== false }), bretry = h("input", { type: "checkbox", checked: br.auto_retry !== false });
    const bmax = h("input", { type: "number", min: 0, max: 2, step: 1, value: br.max_retries ?? 2 });
    const bcap = h("input", { type: "number", min: 1, max: 1000, step: 1, value: (s.budget || {}).cap ?? 10 });
    const btest = h("button.mini", { type: "button", on: { click: async (e) => {
      e.preventDefault(); btest.disabled = true;
      try { const r = await post("brain", { provider: bprov.value, model: bmodel.value.trim(), key: bkey.value.trim() }); toast(tt`L'intelligence répond (${bmodel.value.trim()}, ≈ ${r.cout.toFixed(4)} $ l'essai).`); }
      catch (err) { toast(tt("L'intelligence ne répond pas : ") + err.message, "error", 8000); }
      finally { btest.disabled = false; } } } }, tt("Tester"));
    const me = (this.info && this.info.me) || { role: "admin", vip: true, password: !!s.server.password }, guest = me.role === "guest";
    const locked = !!s.server.lock_settings || guest;                // un invite ne change que ce qui reste dans son navigateur
    const lib = s.library || {}, lurl = f(lib.url || "", tt("https://…/bibliotheque")), luser = f(lib.user || "", tt("identifiant")), lpw = secret(lib.password, tt("mot de passe de la bibliothèque"));
    modal(tt("Réglages"), h("div.form.settings",
      this.noMachines() ? null : h("h4", tt("Machines ComfyUI")),
      ...(this.noMachines() ? [h("p.muted", tt("Compte invité : les machines du poste ne te sont pas ouvertes. Tes calculs (images, poses, orbites, Integrate) partent sur fal avec ta propre clé, celle de « Ma clé (ce navigateur) » dans la rubrique fal ci-dessous."))]
        : [wbox, h("label.col", tt("Une machine par ligne : nom | adresse"), workers), h("label.col", tt("Réglages de Workflows Q-builder (ses machines sont reprises)"), qb)]),
      h("h4", tt("Calcul")), h("label.row", tt("Durée d'une orbite"), len), this.noMachines() ? null : h("label.row", tt("Où calculer par défaut"), tgt), h("label.row", tt("Moteur des poses"), pose),
      h("h4", "fal (cloud)"), h("div.row.keyrow", h("span", tt("Clé du poste")), key, paste(key)), h("div.row.keyrow", h("span", tt("Ma clé (ce navigateur)")), myKey, paste(myKey), help("fal")),
      h("label.row", tt("Résolution de l'orbite"), fres), h("label.row", tt("Calculs fal en même temps"), fcon),
      h("label.row", tt("Modèle orbite"), orbit), h("label.row", tt("Modèle édition / Integrate"), edit), h("label.row", tt("Modèle image"), t2i),
      h("p.muted", tt("Sur fal, l'orbite H3 + LoRA dure 5 s au minimum ; « minimax/h3-max/camera-controls » accepte 3 s. Sur fal : image, détourage et orbite essayés ; édition pas encore.")),
      guest ? null : h("h4", { title: tt("Un modèle de langage regarde chaque image produite (pose, vues, tournette, bouches) à côté du dessin d'origine et donne son verdict : garder, refaire ou écarter. Il suit la méthode de app/guide/personnages.md. Sans clé, tout marche comme avant.") }, tt("Intelligence ⓘ")),
      ...(guest ? [] : [h("label.row", tt("Fournisseur"), bprov), h("div.row.keyrow", h("span", tt("Clé d'API")), bkey, paste(bkey), btest),
        h("label.row", tt("Modèle"), bmodel), blist, beffRow,
        h("label.check", baudit, tt("Juger chaque image après son tirage")),
        h("label.check", bretry, tt("Sur « refaire », retirer tout seul avec la consigne corrigée")), h("label.row", tt("Reprises par image (au plus)"), bmax),
        h("label.row", { title: tt("Au-delà, chaque lancement demande confirmation. Le cumul de chaque personnage (fal et intelligence) est dans sa fiche.") }, tt("Plafond par personnage ($)"), bcap)]),
      h("h4", { title: tt("Pour le bouton « Générer une voix » du montage. La clé reste sur ce poste.") }, tt("ElevenLabs (voix) ⓘ")), h("div.row.keyrow", h("span", tt("Clé ElevenLabs")), ekey, paste(ekey)),
      h("div.row.keyrow", h("span", tt("Ma clé (ce navigateur)")), myEkey, paste(myEkey), help("eleven")),
      h("label.row", tt("Modèle de voix"), emodel),
      h("h4", { title: tt("Un dossier de personnages tout faits, hébergé en ligne et protégé par un mot de passe. On y pioche depuis la banque : bouton « 📦 Paquets ».") }, tt("Bibliothèque en ligne ⓘ")),
      h("label.row", tt("Adresse"), lurl), h("label.row", tt("Identifiant"), luser), h("div.row.keyrow", h("span", tt("Mot de passe")), lpw, paste(lpw)),
      h("h4", tt("Mon compte")),
      h("div.row.wrap", h("span", !me.password ? tt("L'application n'a pas de mot de passe : tout le monde est administrateur.")
          : guest ? tt`Connecté : ${me.name} · invité${me.vip ? tt(" VIP (bibliothèque en ligne comprise)") : ""}` : tt("Connecté : administrateur")),
        h("button.mini", { type: "button", on: { click: () => this.passwordDialog(me.password) } }, me.password ? tt("🔑 Changer mon mot de passe…") : tt("🔑 Mettre un mot de passe…")),
        me.password ? h("button.mini", { type: "button", title: tt("Ferme la session dans ce navigateur"), on: { click: async () => { await post("logout", {}); location.href = "/login"; } } }, tt("⏻ Se déconnecter")) : null),
      locked ? h("p.muted", guest ? tt("Compte invité : les réglages de cette page sont ceux de l'administrateur. Tu peux seulement donner tes clés « de ce navigateur » et changer ton mot de passe.")
        : tt("Instance en ligne : les autres réglages de cette page sont verrouillés. Les clés fal et ElevenLabs « de ce navigateur » et le mot de passe restent modifiables.")) : null,
      !guest && me.password ? this.guestsBox() : null,
      h("p.muted", tt`Données (banque et storyboards) : ${s.data}`)),
      [{ label: tt("Annuler") }, { label: tt("Enregistrer"), primary: true, click: async () => {
        if (myKey.value.trim()) localStorage.setItem("bw.falKey", myKey.value.trim()); else localStorage.removeItem("bw.falKey");
        if (myEkey.value.trim()) localStorage.setItem("bw.elevenKey", myEkey.value.trim()); else localStorage.removeItem("bw.elevenKey");
        if (locked) { toast(tt("Clé de ce navigateur enregistrée.")); return; }
        const list = workers.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0])
          .map((p) => (p.length > 1 ? { name: p[0], url: p[1], enabled: true } : { name: p[0], url: p[0], enabled: true }));
        await put("settings", { workers: list, qbuilder_settings: qb.value.trim(), render: { orbit_length: +len.value, target: tgt.value, pose_engine: pose.value },
                                fal: { key: key.value.trim(), orbit_resolution: fres.value, concurrency: Math.max(1, Math.min(20, +fcon.value || 3)), orbit: orbit.value.trim(), edit: edit.value.trim(), t2i: t2i.value.trim() },
                                elevenlabs: { key: ekey.value.trim(), model: emodel.value.trim() || "eleven_multilingual_v2" },
                                library: { url: lurl.value.trim(), user: luser.value.trim(), password: lpw.value },
                                brain: { provider: bprov.value, key: bkey.value.trim(), model: bmodel.value.trim() || "claude-opus-5-5", effort: beff.value,
                                         audit: baudit.checked, auto_retry: bretry.checked, max_retries: Math.max(0, Math.min(2, +bmax.value || 0)) },
                                budget: { cap: Math.max(1, +bcap.value || 10) } });
        this.info = await get("info"); toast(tt("Réglages enregistrés.")); this.pollWorkers();
      } }]);
  }

  // petit guide pour obtenir sa propre cle (fal ou ElevenLabs) et la coller dans « Ma clé (ce navigateur) »
  keyGuide(which) {
    const link = (url, text) => h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text);
    const eleven = which === "eleven";
    const steps = eleven ? [
      [tt("Crée un compte sur "), link("https://elevenlabs.io", "elevenlabs.io"), tt(" (ou connecte-toi).")],
      [tt("Ouvre la page des clés d'API : "), link("https://elevenlabs.io/app/settings/api-keys", "elevenlabs.io/app/settings/api-keys"), tt(" (dans leur application : rubrique Developers, onglet API Keys).")],
      [tt("Crée une clé et donne-lui un nom. Si des droits sont demandés, autorise au moins la synthèse vocale (Text to Speech) et la lecture des voix (Voices).")],
      [tt("Copie la clé tout de suite : elle ne s'affiche qu'une fois.")],
      [tt("Reviens ici, clique « Coller » à côté de « Ma clé (ce navigateur) » dans la rubrique ElevenLabs, puis « Enregistrer ».")],
    ] : [
      [tt("Crée un compte sur "), link("https://fal.ai", "fal.ai"), tt(" (ou connecte-toi) et ajoute des crédits sur ton compte.")],
      [tt("Ouvre la page des clés : "), link("https://fal.ai/dashboard/keys", "fal.ai/dashboard/keys"), "."],
      [tt("Clique « Create Key », donne-lui un nom ; pour les droits, « API » suffit.")],
      [tt("Copie la clé tout de suite : elle ne s'affiche qu'une fois.")],
      [tt("Reviens ici, clique « Coller » à côté de « Ma clé (ce navigateur) » dans la rubrique fal, puis « Enregistrer ».")],
    ];
    modal(eleven ? tt("Ma clé ElevenLabs : mode d'emploi") : tt("Ma clé fal : mode d'emploi"), h("div.form.keyguide",
      h("ol", steps.map((st) => h("li", ...st))),
      h("p.muted", eleven ? tt("La clé reste dans ce navigateur : elle n'est pas enregistrée sur le serveur et les autres comptes ne la voient pas. Les voix générées sont décomptées de ton compte ElevenLabs, selon ton abonnement.")
        : tt("La clé reste dans ce navigateur : elle n'est pas enregistrée sur le serveur et les autres comptes ne la voient pas. Les calculs envoyés à fal (images, orbites) sont facturés sur ton compte fal."))),
      [{ label: tt("Fermer"), primary: true }]);
  }

  // comptes invites, geres par l'admin : un invite travaille sur la meme banque et les memes storyboards, sans toucher aux
  // reglages ; un invite VIP a en plus la bibliotheque en ligne
  guestsBox() {
    const list = h("div.guests", h("p.muted", tt("Chargement…")));
    const shown = (name, pw, what) => {                              // le mot de passe n'est lisible qu'a cet instant
      const out = h("input", { type: "text", readOnly: true, value: pw, on: { focus: (e) => e.target.select() } });
      modal(what, h("div.form", h("label.row", tt("Nom d'invité"), h("input", { type: "text", readOnly: true, value: name })),
        h("div.row.keyrow", h("span", tt("Mot de passe")), out, h("button.mini", { type: "button", on: { click: async () => {
          try { await navigator.clipboard.writeText(tt`Nom : ${name}\nMot de passe : ${pw}`); toast(tt("Nom et mot de passe copiés.")); } catch (e) { out.focus(); toast(tt("Copie refusée par le navigateur : sélectionne le texte et copie-le."), "error"); } } } }, tt("Copier"))),
        h("p.muted", tt("Note-le maintenant : il ne sera plus jamais affiché. L'invité se connecte à la même adresse que toi, avec ce nom et ce mot de passe, et peut ensuite le changer dans ses réglages."))), [{ label: tt("C'est noté"), primary: true }]);
    };
    const draw = (accs) => {
      list.replaceChildren(...(accs.length ? accs.map((a) => {
        const kind = h("select", { title: tt("Invité : toute l'application sauf la bibliothèque en ligne. VIP : la bibliothèque en ligne aussi."), on: { change: async () => {
          try { draw((await put("accounts/" + a.id, { vip: kind.value === "vip" })).accounts); toast(`${a.name} : ${kind.value === "vip" ? tt("invité VIP") : tt("invité")}.`); } catch (e) { toast(e.message, "error"); } } } },
          h("option", { value: "guest", selected: !a.vip }, tt("Invité")), h("option", { value: "vip", selected: !!a.vip }, tt("Invité VIP")));
        return h("div.row.guest", h("span.gname", a.name), kind,
          h("button.mini", { type: "button", title: tt("Tire un nouveau mot de passe pour cet invité : l'ancien ne marche plus"), on: { click: async () => {
            if (!confirm(tt`Donner un nouveau mot de passe à « ${a.name} » ? L'ancien ne marchera plus.`)) return;
            try { const r = await put("accounts/" + a.id, { reset: true }); draw(r.accounts); shown(a.name, r.password, tt("Nouveau mot de passe")); } catch (e) { toast(e.message, "error"); } } } }, tt("🔑 Nouveau mot de passe")),
          h("button.mini", { type: "button", title: tt("Supprime ce compte : l'invité est déconnecté tout de suite"), on: { click: async () => {
            if (!confirm(tt`Supprimer le compte de « ${a.name} » ?`)) return;
            try { draw((await del("accounts/" + a.id)).accounts); toast(tt`Compte de ${a.name} supprimé.`); } catch (e) { toast(e.message, "error"); } } } }, tt("✕ Supprimer")));
      }) : [h("p.muted", tt("Aucun invité pour l'instant."))]));
    };
    get("accounts").then((r) => draw(r.accounts)).catch((e) => { list.replaceChildren(h("p.muted", e.message)); });
    const name = h("input", { type: "text", placeholder: tt("nom de l'invité"), maxLength: 40, autocomplete: "off" });
    const type = h("select", h("option", { value: "guest" }, tt("Invité")), h("option", { value: "vip" }, tt("Invité VIP")));
    const add = async () => {
      if (!name.value.trim()) return toast(tt("Donne un nom à l'invité."), "error");
      try { const r = await post("accounts", { name: name.value, vip: type.value === "vip" }); name.value = ""; draw((await get("accounts")).accounts); shown(r.account.name, r.password, tt("Compte invité créé")); }
      catch (e) { toast(e.message, "error"); }
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    return h("div.guestsbox",
      h("h4", { title: tt("Un invité utilise toute l'application (même banque, mêmes storyboards) mais ne touche ni aux réglages ni aux comptes. Un invité VIP a en plus accès à la bibliothèque en ligne.") }, tt("Comptes invités ⓘ")),
      list, h("div.row.guest", name, type, h("button.mini", { type: "button", on: { click: add } }, tt("＋ Créer l'invité"))),
      h("p.muted", tt("Invité : toute l'application, sans la bibliothèque en ligne. Invité VIP : avec la bibliothèque en ligne. Les invités travaillent sur ta banque et tes storyboards et peuvent les modifier.")));
  }

  // mon compte : changer le mot de passe de l'application (l'actuel est demande)
  passwordDialog(has) {
    const fld = (ph) => h("input", { type: "password", placeholder: ph, autocomplete: "new-password", spellcheck: "false" });
    const old = fld(tt("mot de passe actuel")), n1 = fld(tt("au moins 8 caractères")), n2 = fld(tt("le même, une seconde fois"));
    const err = h("p.error");
    const show = h("input", { type: "checkbox", on: { change: () => [old, n1, n2].forEach((i) => { i.type = show.checked ? "text" : "password"; }) } });
    modal(has ? tt("Changer le mot de passe") : tt("Mettre un mot de passe"), h("div.form",
      has ? h("label.row", tt("Mot de passe actuel"), old) : null,
      h("label.row", tt("Nouveau mot de passe"), n1), h("label.row", tt("Confirmer"), n2),
      h("label.row", tt("Afficher ce que je tape"), show), err,
      h("p.muted", tt("Les autres navigateurs connectés à cette application devront se reconnecter avec le nouveau mot de passe."))),
      [{ label: tt("Annuler") }, { label: tt("Enregistrer"), primary: true, click: async () => {
        err.textContent = "";
        if (n1.value.length < 8) { err.textContent = tt("Le nouveau mot de passe doit faire au moins 8 caractères."); return false; }
        if (n1.value !== n2.value) { err.textContent = tt("Les deux saisies du nouveau mot de passe sont différentes."); return false; }
        try { await post("password", { old: old.value, new: n1.value }); }
        catch (e) { err.textContent = tt("Refusé : ") + (e.message || e); return false; }
        toast(tt("Mot de passe changé."));
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
      if (k === "escape" && this.editor.focusId && !document.querySelector(".menu") && !this.markTool) return this.editor.focus(null);
      if (k === "escape") { document.querySelector(".menu")?.remove(); if (this.markTool) { this.markTool = null; this.editor.render(true); } return this.select({}); }
      if (k === "delete" || k === "backspace") {
        e.preventDefault();
        if (l) return this.removeLayer(l);
        if (this.bubble()) return this.removeBubble();
        if (this.mark()) return this.removeMark();
        if (this.note()) return this.removeNote();
        return;
      }
      if (!ctrl && !e.altKey && (k === "tab" || k === "q")) {   // Tab : montage de la case ; Q : dessiner son fond
        e.preventDefault();
        if (!this.sel.panel) return toast(tt("Sélectionne d'abord une case."));
        return k === "tab" ? openMontage(this, this.sel.panel) : this.drawBackground(this.sel.panel);
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
const CID = Math.random().toString(36).slice(2, 10);       // cet onglet, pour que le serveur reconnaisse ses propres enregistrements
// moteurs d'Integrate : [valeur du reglage render.integrate_engine, nom]. Seul Qwen Image Edit Plus a servi sur fal.
// decor d'un angle de l'orbite de case : l'image de l'orbite sans personne, meme cadrage et meme style
const ORBIT_DECOR_PROMPT = "Remove every character, person and creature from this picture, and change nothing else. Keep the place exactly as it is: " +
  "same framing, same camera angle and perspective, same drawing style, line work, colours and wash. Where a character stood, continue the floor, " +
  "walls and furniture that were behind them. No people, no new objects, no text.";
const INTEGRATE_ENGINES = [
  ["", tt("Automatique (mes machines, sinon fal)")],
  ["local", tt("Mes machines · Qwen-Image-Edit")],
  ["fal:fal-ai/qwen-image-edit-plus", tt("fal · Qwen Image Edit Plus")],
  ["fal:fal-ai/nano-banana/edit", tt("fal · Nano Banana (non essayé)")],
  ["fal:fal-ai/bytedance/seedream/v4/edit", tt("fal · Seedream 4 (non essayé)")]];
// rendus d'Integrate : [cle envoyee au serveur (poses.INTEGRATE), nom, ce que ca fait]
const INTEGRATE_STYLES = [
  ["encre", tt("Encrage (net et fidèle)"), tt("met la case dessinée au propre, à l'encre, sans rien redessiner : silhouettes, têtes et proportions verrouillées")],
  ["dessin", tt("Dessin (storyboard)"), tt("redessine le collage en un seul dessin de storyboard, plus libre")],
  ["photo", tt("Photoréaliste"), tt("en fait une seule photographie, lumière et ombres unifiées")]];
function defaultIntegrate(style) {
  return style === "dessin"
    ? "Redraw this rough collage as one coherent storyboard drawing in a single consistent line style. Keep every character and object exactly where it is, same pose, same size, same framing."
    : "Turn this rough collage into one coherent photograph. Keep every character and object exactly where it is, same pose, same size, same framing. Unify the lighting and colour, add contact shadows, blend the cut-out edges.";
}

function presetThumb(p, page) {
  let n = 0;
  const W = 60, H = Math.round(60 * page.height / page.width), mini = { width: W, height: H, gutter: 3, margin: 3 };
  const layout = p.make(() => ({ t: "leaf", id: "t" + (n++) }), mini);
  const g = compute(p.page ? Object.assign(mini, p.page(mini)) : mini, layout);
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  for (const pn of g.panels) {
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", pn.poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
    svg.append(poly);
  }
  return svg;
}

// menu contextuel : [{head}, {note}, {label, click, checked, half, danger}, {sub, value, items}] ; un {sub} ouvre ses
// items en sous-menu, a cote, quand la souris s'y arrete
function menu(e, items) {
  document.querySelector(".menu")?.remove();
  const box = h("div.menu");
  let open = null;                                           // sous-menu ouvert : [bouton, panneau]
  const shut = () => { if (open) { open[0].classList.remove("open"); open[1].remove(); open = null; } };
  const fill = (into, list) => {
    for (const it of list) {
      if (it.head) { into.append(h("div.mhead", it.head)); continue; }
      if (it.note) { into.append(h("div.mnote", it.note)); continue; }
      if (it.sub) {
        const b = h("button.msub", h("span", it.sub), it.value ? h("span.mval", it.value) : "", h("span.marrow", "▸"));
        const show = () => {
          if (open && open[0] === b) return;
          shut();
          const p = h("div.menu.submenu"); fill(p, it.items);
          box.append(p); open = [b, p]; b.classList.add("open");
          const r = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
          const right = r.right + pr.width + 4 <= innerWidth;
          p.style.left = (right ? box.getBoundingClientRect().right + 2 : box.getBoundingClientRect().left - pr.width - 2) + "px";
          p.style.top = Math.max(4, Math.min(r.top - 6, innerHeight - pr.height - 6)) + "px";
        };
        b.addEventListener("pointerenter", show);
        b.addEventListener("click", show);
        into.append(b); continue;
      }
      const btn = h("button" + (it.half ? ".half" : "") + (it.checked ? ".on" : "") + (it.danger ? ".danger" : "") + (it.star ? ".star" : "") + (it.star === "blue" ? ".blue" : ""),
        { on: { click: () => { box.remove(); it.click(); } } }, it.checked ? "✓ " : "", it.label);
      if (into === box) btn.addEventListener("pointerenter", shut);      // un autre geste du menu : le sous-menu se ferme
      into.append(btn);
    }
  };
  fill(box, items);
  box.addEventListener("pointerover", (ev) => { if (ev.target.classList?.contains("mhead") || ev.target.classList?.contains("mnote")) shut(); });
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
  box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
  const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

const app = new App();
window.app = app;
app.start().catch((e) => { console.error(e); toast(tt("Démarrage impossible : ") + e.message, "error", 20000); });
