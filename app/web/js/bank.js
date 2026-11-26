// Banque : personnages, decors, assets. Vignettes a glisser dans les cases, import, generation, fiche d'un element
// (orbite a faire tourner, reperes d'axes, poses a generer).
import { tt, tr } from "./i18n.js";
import { h, get, post, put, del, upload, toast, modal } from "./api.js";
import { openPortrait, portraitThumb } from "./portrait.js";
import { openIdentikit } from "./identikit.js";
import { sprite, preload, variantOf, AXES, nearestAxis, angleToFrame, frameToAngle } from "./model.js";

const KINDS = [["character", tt("Personnages")], ["decor", tt("Décors")], ["asset", tt("Assets")], ["audio", tt("Audio")], ["case", tt("Cases")]];
const SOURCES = { import: tt("importée"), micro: "micro", elevenlabs: "ElevenLabs" };
const STYLES = [["photo", tt("Photoréaliste")], ["dessin", tt("Dessin")], ["3d", "3D"]];
const KIND_ONE = { character: tt("personnage"), decor: tt("décor"), asset: tt("asset"), audio: tt("son"), case: tt("case") };
// les cases enregistrees, les sons et les elements de la banque : leurs routes et leur liste
const ROUTE = { audio: "audio/", case: "cases/" };

export function target() { return localStorage.getItem("bw.target") || "auto"; }

export class Bank {
  constructor(app, host) {
    this.app = app; this.host = host;
    this.tab = localStorage.getItem("bw.tab") || "character";
    this.query = "";
    // dossier choisi dans chaque onglet ("" = tous les dossiers) : les dossiers d'un onglet lui sont propres
    try { this.folderBy = JSON.parse(localStorage.getItem("bw.folders") || "{}") || {}; } catch (e) { this.folderBy = {}; }
    host.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); host.classList.add("drop"); } });
    host.addEventListener("dragleave", () => host.classList.remove("drop"));
    host.addEventListener("drop", (e) => {
      host.classList.remove("drop");
      if (this.tab === "case") return;
      if (this.tab === "audio") { const snd = [...e.dataTransfer.files].filter((f) => /^(audio|video)\//.test(f.type)); if (snd.length) { e.preventDefault(); this.importAudio(snd); } return; }
      const packs = [...e.dataTransfer.files].filter((f) => /\.bwpack$/i.test(f.name));
      if (packs.length) { e.preventDefault(); this.importPacks(packs); return; }
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); this.importDialog(files); }
    });
  }

  get folder() { return this.folderBy[this.tab] || ""; }
  set folder(f) { this.folderBy[this.tab] = f || ""; localStorage.setItem("bw.folders", JSON.stringify(this.folderBy)); }

  async reload() {
    const [items, extra, audio, cases] = await Promise.all([get("bank"), get("folders").catch(() => ({})), get("audio").catch(() => []), get("cases").catch(() => [])]);
    this.audio = (audio || []).map((a) => Object.assign(a, { kind: "audio" }));          // banque audio : voix importees, micro, generees
    this.cases = (cases || []).map((c) => Object.assign(c, { kind: "case" }));           // cases enregistrees, a glisser dans une case
    this.app.bank = new Map(items.map((it) => [it.id, it]));
    this.extraFolders = extra && !Array.isArray(extra) ? extra : {};
    this.render();
    if (this.openId && this.refreshItem) this.refreshItem();
  }

  render() {
    const app = this.app, folders = this.folders();
    if (this.folder && this.folder !== "·" && !folders.includes(this.folder)) this.folder = "";
    // un dossier montre aussi le contenu de ses sous-dossiers
    const inFolder = (it) => !this.folder || (this.folder === "·" ? !it.folder : it.folder === this.folder || (it.folder || "").startsWith(this.folder + "/"));
    const isAudio = this.tab === "audio", isCase = this.tab === "case", pool = (k) => this.pool(k);
    const items = pool(this.tab).filter((it) => it.kind === this.tab && inFolder(it) &&
      (!this.query || (it.name + " " + (it.tags || []).join(" ") + " " + (it.text || "")).toLowerCase().includes(this.query)));
    const pick = h("input", { type: "file", accept: isAudio ? "audio/*,video/mp4,.webm" : "image/*", multiple: true, style: { display: "none" },
                              on: { change: (e) => { if (e.target.files.length) (isAudio ? this.importAudio([...e.target.files]) : this.importDialog([...e.target.files])); e.target.value = ""; } } });
    const grid = h("div.bank-grid" + (isAudio ? ".audio" : "") + (isCase ? ".cases" : "") + (this.multi ? ".multi" : ""), items.map((it) => (isAudio ? this.audioCard(it) : isCase ? this.caseCard(it) : this.card(it))));
    if (!items.length) grid.append(h("p.muted.bank-empty", isAudio ? tt("Aucun son pour l'instant. Les voix importées, enregistrées au micro ou générées dans le montage arrivent ici ; tu peux aussi glisser des fichiers son.")
      : isCase ? tt("Aucune case enregistrée pour l'instant. Clic droit dans une case › « 💾 Enregistrer la case… » : elle arrive ici, avec tout son contenu, à glisser dans d'autres cases.")
      : tt`Aucun ${KIND_ONE[this.tab]} pour l'instant. Glisse des images ici, ou « Générer ».`));
    const search = h("input.search", { type: "search", placeholder: tt("Chercher…"), value: this.query,
                                       on: { input: (e) => { this.query = e.target.value.toLowerCase(); this.renderGrid(); } } });
    const folderSel = h("select.folder", { title: tt`Dossiers de l'onglet ${KINDS.find(([k]) => k === this.tab)[1]} (un par projet, par exemple)`,
      on: { change: (e) => { this.folder = e.target.value; this.render(); } } },
      h("option", { value: "" }, tt("Tous les dossiers")), folders.map((f) => { const parts = f.split("/"); return h("option", { value: f, selected: f === this.folder }, "   ".repeat(parts.length - 1) + (parts.length > 1 ? "└ " : "📁 ") + parts[parts.length - 1]); }),
      h("option", { value: "·", selected: this.folder === "·" }, tt("Sans dossier")));
    this.host.textContent = "";
    this.host.append(
      h("div.tabs", KINDS.map(([k, label]) => h("button" + (k === this.tab ? ".on" : ""), {
        on: { click: () => { this.tab = k; localStorage.setItem("bw.tab", k); this.render(); } } },
        label, h("span.count", String(pool(k).filter((x) => x.kind === k && (k === this.tab ? inFolder(x) : true)).length))))),
      h("div.bank-bar", folderSel,
        h("button.mini", { title: this.folder && this.folder !== "·" ? tt`Créer un sous-dossier dans « ${this.folder} »` : tt("Créer un dossier"), on: { click: () => this.newFolder() } }, tt("＋ Dossier")),
        this.folder && this.folder !== "·" ? h("button.mini", { title: tt`Renommer le dossier « ${this.folder} »`, on: { click: () => this.renameFolder() } }, "✎") : "",
        this.folder && this.folder !== "·" ? h("button.mini.danger", { title: tt`Supprimer le dossier « ${this.folder} » (ses éléments ne sont pas supprimés)`, on: { click: () => this.deleteFolder() } }, "🗑") : ""),
      h("div.bank-bar", search, isCase ? h("button.mini", { title: tt("Enregistre la case choisie dans l'onglet Cases"), on: { click: () => this.app.saveCase(this.app.sel.panel) } }, tt("💾 Enregistrer la case")) : h("button.mini", { title: isAudio ? tt("Importer des fichiers son") : tt("Importer des images"), on: { click: () => pick.click() } }, tt("＋ Importer")),
        isAudio || isCase ? "" : h("button.mini", { title: tt("Générer à partir d'une description"), on: { click: () => this.generateDialog() } }, tt("✨ Générer")),
        this.tab === "character" ? h("button.mini", { title: tt("Portrait-robot, comme ceux de la police : monter un visage en superposant des éléments dessinés (forme du visage, cheveux, yeux, nez, bouche…), ou dessiner les siens"), on: { click: () => openIdentikit(this) } }, tt("🧩 Portrait-robot")) : "",
        isAudio || isCase ? "" : h("button.mini", { title: tt("Paquets de personnages : exporter ce dossier dans un fichier, importer un paquet reçu, ou piocher dans la bibliothèque en ligne"), on: { click: () => this.packDialog() } }, tt("📦 Paquets")), pick),
      grid);
    this.grid = grid;
    if (!this.hostClick) {                           // multi-selection : un clic ailleurs que sur une vignette ou un bouton decoche tout
      this.hostClick = (e) => {
        if (!this.multi || !this.picked || !this.picked.size || e.target.closest(".card, .acard, button, input, select, label, a, .pick-acts")) return;
        this.picked.clear(); this.lastPick = null; this.updatePick();
      };
      this.host.addEventListener("click", this.hostClick);
    }
    this.pickBar = h("div.pick-bar");
    this.host.append(this.pickBar);
    this.updatePick();
  }

  // ---------------------------------------------------------------- multi-selection : cocher des vignettes, puis les deplacer ou les supprimer
  // les vignettes de la grille : elements de banque (.card) ou sons (.acard, onglet Audio)
  cards() { return [...this.grid.querySelectorAll(".card, .acard")]; }
  sound(id) { return (this.audio || []).find((a) => a.id === id); }
  pool(k) { return k === "audio" ? this.audio || [] : k === "case" ? this.cases || [] : [...this.app.bank.values()]; }
  thing(id, k = this.tab) { return k === "audio" ? this.sound(id) : k === "case" ? (this.cases || []).find((c) => c.id === id) : this.app.bank.get(id); }
  pickedIds() {                      // les elements coches presents dans la grille affichee
    this.picked = this.picked || new Set();
    const shown = new Set(this.cards().map((c) => c.dataset.id));
    return [...this.picked].filter((id) => shown.has(id) && !!this.thing(id));
  }
  pickCard(id, range) {              // clic : coche ou decoche ; Maj + clic : coche tout depuis la vignette cliquee juste avant
    this.picked = this.picked || new Set();
    const order = this.cards().filter((c) => c.style.display !== "none").map((c) => c.dataset.id);
    const a = order.indexOf(this.lastPick), b = order.indexOf(id);
    if (range && a >= 0 && b >= 0) order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => this.picked.add(x));
    else if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
    this.lastPick = id;
    this.updatePick();
  }
  updatePick() {
    const bar = this.pickBar;
    if (!bar || !this.grid) return;
    this.picked = this.picked || new Set();
    this.cards().forEach((c) => c.classList.toggle("picked", !!this.multi && this.picked.has(c.dataset.id)));
    const ids = this.multi ? this.pickedIds() : [];
    bar.textContent = "";
    const box = h("input", { type: "checkbox", checked: !!this.multi, on: { change: (e) => {
      this.multi = e.target.checked; if (!this.multi) this.picked.clear(); this.lastPick = null; this.render(); } } });
    bar.append(h("label.check.pick-toggle", { title: tt("Coche les vignettes d'un clic (Maj + clic : toute une suite), puis déplace-les ou supprime-les ensemble") }, box, tt("Multi-sélection")));
    if (!this.multi) return;
    const all = this.cards().filter((c) => c.style.display !== "none").map((c) => c.dataset.id);
    bar.append(h("button.mini", { on: { click: () => { all.forEach((x) => this.picked.add(x)); this.updatePick(); } } }, tt("Tout")),
      h("button.mini", { on: { click: () => { this.picked.clear(); this.lastPick = null; this.updatePick(); } } }, tt("Aucun")));
    if (!ids.length) { bar.append(h("span.muted", tt("Clique les vignettes à cocher (Maj + clic : toute une suite)."))); return; }
    const move = h("button.mini", { title: tt("Choisir d'un clic le dossier où ranger les éléments cochés"), on: { click: () => this.movePicked() } }, tt("📁 Ranger dans…"));
    bar.append(h("div.pick-acts", h("b", tt`${ids.length} sélectionné(s)`), move,
      h("button.mini.danger", { on: { click: () => this.deletePicked() } }, tt("🗑 Supprimer"))));
  }
  async movePicked() {
    const ids = this.pickedIds();
    if (!ids.length) return;
    const f = await this.pickFolder(this.tab, null, tt`Ranger ${ids.length} élément(s) dans…`);
    if (f === null) return;
    const route = ROUTE[this.tab] || "bank/";
    try { for (const id of ids) await put(route + id, { folder: f }); this.picked.clear(); this.lastPick = null; toast(tt`${ids.length} élément(s) déplacé(s) dans « ${f || tt("Sans dossier")} ».`); }
    catch (err) { toast(err.message, "error"); }
    this.reload();
  }
  async deletePicked() {
    const ids = this.pickedIds();
    if (!ids.length) return;
    const audio = this.tab === "audio", nameOf = (id) => this.thing(id).name;
    const names = ids.slice(0, 8).map((id) => "• " + nameOf(id)).join("\n") + (ids.length > 8 ? "\n…" : "");
    if (!confirm(this.tab === "case" ? tt`Retirer ${ids.length} case(s) de l'onglet Cases ? Tu es sûr ?\n\n${names}\n\nElles partent à la corbeille du dossier de données ; les storyboards où elles sont posées ne changent pas.`
      : audio ? tt`Retirer ${ids.length} son(s) de la banque audio ? Tu es sûr ?\n\n${names}\n\nLes montages qui s'en servent gardent leur copie.`
      : tt`Supprimer ${ids.length} élément(s) de la banque ? Tu es sûr ?\n\n${names}\n\nIls partent à la corbeille du dossier de données.`)) return;
    if (audio && this.player && ids.includes(this.playing)) this.player.pause();
    try { for (const id of ids) { await del((ROUTE[this.tab] || "bank/") + id); this.picked.delete(id); if (this.openId === id) this.openId = null; } toast(tt`${ids.length} élément(s) supprimé(s).`); }
    catch (err) { toast(err.message, "error"); }
    this.reload();
  }
  /** Choisir un dossier d'un clic : fenetre avec les dossiers de l'onglet (sous-dossiers en retrait), « Sans dossier » et
   *  « Nouveau dossier… » (seul cas ou l'on tape un nom). Rend le dossier choisi ("" = sans dossier), ou null. */
  pickFolder(kind, current, title) {
    return new Promise((done) => {
      let m = null;
      const choose = (f) => { m.close(); done(f); };
      const row = (f, label, depth = 0) => h("button.folder-pick" + (current != null && f === current ? ".on" : ""), { style: { paddingLeft: 10 + depth * 18 + "px" }, on: { click: () => choose(f) } }, label);
      const list = h("div.folder-picks", row("", tt("Sans dossier")),
        this.folders(kind).map((f) => { const p = f.split("/"); return row(f, (p.length > 1 ? "└ " : "📁 ") + p[p.length - 1], p.length - 1); }),
        h("button.folder-pick.new", { on: { click: () => {
          const f = (prompt(tt("Nom du nouveau dossier (sous-dossier : « Parent/Nom ») :"), "") || "").trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
          if (f) choose(f);
        } } }, tt("＋ Nouveau dossier…")));
      m = modal(title || tt("Ranger dans quel dossier ?"), list, [{ label: tt("Annuler"), click: () => { done(null); } }]);
      const x = m.box.querySelector("header button"); if (x) x.addEventListener("click", () => done(null));
    });
  }
  folders(kind = this.tab) {          // dossiers d'un onglet : ceux de ses elements, ceux crees vides, et leurs parents
    const things = this.pool(kind).filter((it) => it.kind === kind);
    const all = new Set([...((this.extraFolders || {})[kind] || []), ...things.map((it) => it.folder).filter(Boolean)]);
    for (const f of [...all]) { const p = f.split("/"); for (let i = 1; i < p.length; i++) all.add(p.slice(0, i).join("/")); }
    return [...all].sort((a, b) => a.localeCompare(b, "fr"));
  }
  async newFolder() {
    const parent = this.folder && this.folder !== "·" ? this.folder : "";
    const name = (prompt(parent ? tt`Nom du sous-dossier à créer dans « ${parent} » :` : tt("Nom du dossier à créer :")) || "").trim().replace(/[\/]+/g, " ");
    if (!name) return;
    const path = parent ? parent + "/" + name : name;
    await post("folders", { name: path, kind: this.tab });
    this.folder = path;
    await this.reload();
    toast(tt`Dossier « ${path} » créé. Les éléments importés ou générés maintenant y vont.`);
  }
  async renameFolder() {
    const f = this.folder, parts = f.split("/"), old = parts.pop();
    const name = (prompt(tt`Nouveau nom du dossier « ${old} » :`, old) || "").trim().replace(/[\/]+/g, " ");
    if (!name || name === old) return;
    const to = [...parts, name].join("/");
    if (this.folders().includes(to) && !confirm(tt`Le dossier « ${to} » existe déjà dans cet onglet. Y verser le contenu de « ${old} » ?`)) return;
    await put("folders", { name: f, to, kind: this.tab });
    this.folder = to;
    await this.reload();
    toast(tt`Dossier renommé en « ${name} ».`);
  }
  async deleteFolder() {
    const f = this.folder, n = this.pool(this.tab).filter((it) => it.kind === this.tab).filter((it) => it.folder === f || (it.folder || "").startsWith(f + "/")).length;
    const parent = f.split("/").slice(0, -1).join("/");
    if (!confirm(tt`Supprimer le dossier « ${f} » et ses sous-dossiers ?
` + (n ? tt`Ses ${n} élément(s) ne sont pas supprimés : ils vont dans ${parent ? "« " + parent + " »" : tt("« Sans dossier »")}.` : tt("Il est vide.")))) return;
    await del("folders?name=" + encodeURIComponent(f) + "&kind=" + this.tab);
    this.folder = parent;
    await this.reload();
    toast(tt`Dossier « ${f} » supprimé.`);
  }
  folderInput(value, kind = this.tab) {                // dossier ou ranger : deroulant des dossiers existants, plus « Nouveau dossier… »
    const opt = (f) => h("option", { value: f, selected: f === (value || "") }, "   ".repeat(f.split("/").length - 1) + f.replace(/\//g, " › "));
    const sel = h("select", { title: tt("Dossier où ranger l'élément") }, h("option", { value: "", selected: !value }, tt("Sans dossier")), this.folders(kind).map(opt),
      h("option", { value: "__new__" }, tt("＋ Nouveau dossier…")));
    let last = value || "";
    sel.addEventListener("change", () => {
      if (sel.value !== "__new__") { last = sel.value; return; }
      const f = (prompt(tt("Nom du nouveau dossier (sous-dossier : « Parent/Nom ») :"), "") || "").trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
      if (!f) { sel.value = last; return; }
      if (![...sel.options].some((o) => o.value === f)) sel.insertBefore(opt(f), sel.lastChild);
      sel.value = last = f;
    });
    return h("span.fin", sel);
  }
  reveal(id) {                       // montre ou se trouve un element : son onglet, son dossier, sa vignette mise en avant
    const it = this.app.bank.get(id);
    if (!it) return toast(tt("Cet élément n'est plus dans la banque."), "error");
    this.tab = it.kind; localStorage.setItem("bw.tab", it.kind);
    this.folder = it.folder || ""; this.query = "";
    this.render();
    const card = this.grid.querySelector(`.card[data-id="${id}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.remove("found"); void card.offsetWidth; card.classList.add("found");
    setTimeout(() => card.classList.remove("found"), 4000);
    toast(`« ${it.name} » : ${it.folder ? tt("dossier « ") + it.folder + " »" : tt("sans dossier")}.`);
  }
  renderGrid() {
    const q = this.query;
    for (const c of this.grid.children) if (c.dataset.name) c.style.display = !q || c.dataset.name.includes(q) ? "" : "none";
  }

  cover(it) {                         // variante principale : vignette de la banque et variante posee au glisser
    return it.cover && it.variants && it.variants[it.cover] ? it.cover : "base";
  }

  // Fiche : « Expressions à générer » (app/exprcards.py). Une expression = des cartes du visage posées sur l'orbite, sous la
  // bouche du lip sync ; il faut une bouche suivie (mouth.json) sur la pose. Calcul sur fal, coût annoncé avant.
  exprBox(item, id) {
    const app = this.app, cat = app.info.poses.expressions || [];
    if (!cat.length) return h("div");
    const tracked = Object.entries(item.variants).filter(([, v]) => v.orbit && v.orbit.mouth);
    const box = h("div.exprbox");
    if (!tracked.length) {
      box.append(h("h4", tt("Expressions à générer")), h("p.muted", tt("Il faut d'abord une bouche suivie sur l'orbite (montage : « Tracer la bouche »).")));
      return box;
    }
    const base = tracked.find(([k]) => k === "base") || tracked[0];
    const have = new Set(((base[1].orbit || {}).exprs) || []);
    const boxes = cat.map((p) => ({ p, el: h("input", { type: "checkbox", "data-expr": p.key, checked: have.has(p.key) }) }));
    const allPoses = h("input", { type: "checkbox" });
    const est = h("div.muted.pose-est");
    const picked = () => boxes.filter((b) => b.el.checked && !have.has(b.p.key)).map((b) => b.p.key);
    const vids = () => (allPoses.checked ? tracked.map(([k]) => k) : [base[0]]);
    let estT = 0, last = null;
    const estimate = () => { clearTimeout(estT); estT = setTimeout(async () => {
      const keys = picked();
      if (!keys.length) { est.textContent = ""; last = null; return; }
      try {
        const r = await post(`bank/${id}/estimate`, { kind: "item_expr", count: vids().length, exprs: keys, target: "fal" });
        last = r.estimate;
        est.textContent = tt`Coût estimé : ≈ ${r.estimate.toFixed(2)} $ pour ${keys.length} expression(s) sur ${vids().length} pose(s) · déjà dépensé ${r.spent.toFixed(2)} $ · plafond ${r.cap.toFixed(2)} $`;
        est.classList.toggle("warn", r.spent + r.queued + r.estimate > r.cap);
      } catch (err) { est.textContent = ""; last = null; } }, 250); };
    boxes.forEach((b) => b.el.addEventListener("change", estimate)); allPoses.addEventListener("change", estimate);
    const launch = async () => {
      const keys = picked();
      if (!keys.length) return toast(tt("Coche au moins une expression qui n'est pas encore faite."), "error");
      if (!confirm(tt`Générer ${keys.length} expression(s) sur ${vids().length} pose(s) ?\nCalcul sur fal (Nano Banana Pro) : environ ${(last ?? 0).toFixed(2)} $, compté sur ce personnage.`)) return;
      try { const r = await post(`bank/${id}/expr`, { exprs: keys, variants: vids() }); toast(tt`${r.jobs.length} tâche(s) lancée(s).`); app.pollSoon(); }
      catch (err) { toast(err.message, "error"); }
    };
    box.append(h("h4", tt("Expressions à générer")),
      h("div.tiers", [1, 2, 3].map((t) => h("button.mini", { on: { click: () => { boxes.forEach((b) => { if (!have.has(b.p.key)) b.el.checked = b.p.tier <= t; }); estimate(); } } }, tr(app.info.poses.tiers[t]))),
        h("button.mini", { on: { click: () => { boxes.forEach((b) => { if (!have.has(b.p.key)) b.el.checked = false; }); estimate(); } } }, tt("Rien"))),
      h("div.poselist", boxes.map((b) => h("label.check" + (have.has(b.p.key) ? ".done" : ""), b.el, tr(b.p.label)))),
      h("label.row.check", { title: tt("Chaque pose a sa propre orbite : ses expressions se calculent à part, au même prix que celles de la base.") }, allPoses,
        tt`Aussi sur les autres poses qui ont une bouche suivie (${tracked.length - 1})`),
      est,
      h("div.row.wrap.pose-go",
        h("button.primary", { title: tt("Sur quelques images de face de l'orbite, la tête est redessinée avec chaque expression ; au clic droit sur le personnage (case ou montage), on choisit l'expression."), on: { click: launch } }, tt("Générer les expressions")),
        have.size ? h("button.mini.danger", { title: tt("Retire toutes les expressions de cette pose"), on: { click: async () => {
          if (!confirm(tt("Retirer toutes les expressions de cette pose ?"))) return;
          try { const r = await post(`bank/${id}/expr`, { action: "remove", variants: [base[0]] }); if (r.item) app.bank.set(id, r.item); this.refreshItem && this.refreshItem(); }
          catch (err) { toast(err.message, "error"); } } } }, tt("Retirer les expressions")) : null));
    return box;
  }

  thumb(it, vid = "base") {
    const v = variantOf(it, vid);
    if (!v) return "";
    if (v.orbit) return sprite(it, vid, 0).url;
    if (v.cut) return `/bank/${it.id}/${v.cut}?t=${v.t || 0}`;
    return `/bank/${it.id}/${v.ref}?t=${v.t || 0}`;
  }

  // ---- banque audio
  async importAudio(files) {
    const folder = this.folder && this.folder !== "·" ? this.folder : "";
    let n = 0;
    for (const f of files) {
      try { await upload(`audio?name=${encodeURIComponent(f.name)}&source=import&folder=${encodeURIComponent(folder)}`, f); n++; }
      catch (e) { toast(tt`${f.name} refusé : ${e.message}`, "error"); }
    }
    await this.reload();
    if (n) toast(tt`${n} son${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} à la banque audio.`);
  }
  playAudio(a, btn) {                 // un seul son a la fois ; recliquer l'arrete
    const p = this.player || (this.player = new Audio());
    const same = this.playing === a.id && !p.paused;
    p.pause();
    if (this.playBtn && this.playBtn.isConnected) this.playBtn.textContent = "▶";
    if (same) { this.playing = null; return; }
    p.src = `/audio/${a.file}`; p.currentTime = 0;
    p.onloadedmetadata = () => { if (!a.dur && isFinite(p.duration)) { a.dur = +p.duration.toFixed(2); put("audio/" + a.id, { dur: a.dur }).catch(() => {}); } };
    p.onended = () => { if (btn.isConnected) btn.textContent = "▶"; this.playing = null; };
    p.play().catch((e) => toast(tt("Lecture impossible : ") + e.message, "error"));
    this.playing = a.id; this.playBtn = btn; btn.textContent = "■";
  }
  audioCard(a) {
    const play = h("button.mini.aplay", { title: tt("Écouter"), on: { click: () => this.playAudio(a, play) } }, this.playing === a.id && this.player && !this.player.paused ? "■" : "▶");
    const info = [a.dur ? a.dur.toFixed(1) + " s" : null, SOURCES[a.source] || a.source, a.voice || null].filter(Boolean).join(" · ");
    return h("div.acard", { "data-id": a.id, "data-name": (a.name + " " + (a.text || "")).toLowerCase(), title: a.text ? `« ${a.text} »` : a.name,
      on: { click: (e) => { if (this.multi && !e.target.closest("button")) { e.preventDefault(); this.pickCard(a.id, e.shiftKey); } } } },
      this.multi ? h("span.card-check", "✓") : null,
      play,
      h("div.ainfo", h("div.aname", a.name), h("div.ameta", info + (a.folder ? " · 📁 " + a.folder : ""))),
      h("button.mini", { title: tt("Renommer"), on: { click: async () => { const n = (prompt(tt("Nom du son :"), a.name) || "").trim(); if (n && n !== a.name) { await put("audio/" + a.id, { name: n }); this.reload(); } } } }, "✎"),
      h("button.mini", { title: tt("Ranger dans un dossier de l'onglet Audio : un clic sur le dossier"), on: { click: async () => { const f = await this.pickFolder("audio", a.folder || "", tt`Ranger « ${a.name} » dans…`); if (f !== null && f !== (a.folder || "")) { await put("audio/" + a.id, { folder: f }); this.reload(); } } } }, "📁"),
      h("button.mini.danger", { title: tt("Retirer de la banque audio (les montages qui s'en servent gardent leur copie)"), on: { click: async () => { if (!confirm(tt`Retirer « ${a.name} » de la banque audio ?`)) return; if (this.playing === a.id && this.player) this.player.pause(); await del("audio/" + a.id); this.reload(); } } }, "🗑"));
  }
  // une case enregistree : vignette, glisser dans une case (ou clic : dans la case choisie)
  caseCard(c) {
    return h("div.card.case", { draggable: true, "data-id": c.id, "data-name": c.name.toLowerCase(), title: c.name + tt(" : glisser dans une case, ou cliquer pour la poser dans la case choisie"),
      on: {
        dragstart: (e) => { e.dataTransfer.setData("application/x-bw-case", c.id); e.dataTransfer.effectAllowed = "copy"; },
        click: (e) => { if (e.target.closest("button")) return; if (this.multi) { e.preventDefault(); this.pickCard(c.id, e.shiftKey); } else this.app.dropCase(this.app.sel.panel, c.id); },
      } },
      this.multi ? h("span.card-check", "✓") : null,
      h("img", { src: `/cases/${c.id}/thumb.png?t=${c.created || 0}`, loading: "lazy", draggable: false, alt: "", style: { aspectRatio: String(1 / (c.ratio || 1)) } }),
      h("div.card-name", c.name),
      h("div.card-meta", h("span.b", tt`${c.n || 0} élément(s)`),
        h("button.mini", { title: tt("Renommer"), on: { click: async () => { const n = (prompt(tt("Nom de la case :"), c.name) || "").trim(); if (n && n !== c.name) { await put("cases/" + c.id, { name: n }); this.reload(); } } } }, "✎"),
        h("button.mini", { title: tt("Ranger dans un dossier de l'onglet Cases"), on: { click: async () => { const f = await this.pickFolder("case", c.folder || "", tt`Ranger « ${c.name} » dans…`); if (f !== null && f !== (c.folder || "")) { await put("cases/" + c.id, { folder: f }); this.reload(); } } } }, "📁"),
        h("button.mini.danger", { title: tt("Retirer de l'onglet Cases (les storyboards où elle est posée ne changent pas)"), on: { click: async () => { if (!confirm(tt`Retirer « ${c.name} » de l'onglet Cases ?`)) return; await del("cases/" + c.id); this.reload(); } } }, "🗑")));
  }
  /** Choisir un element de la banque (« Remplacer par… ») : onglets Personnages, Decors, Assets, dossiers, recherche.
   *  Rend { id, v } ou null. */
  pickItem(kind = "character", title = tt("Remplacer par…")) {
    return new Promise((done) => {
      let tab = ["character", "decor", "asset"].includes(kind) ? kind : "character", folder = (this.folderBy || {})[tab] || "", q = "", m = null, ended = false;
      const end = (x) => { if (ended) return; ended = true; if (m) m.close(); done(x); };
      const body = h("div.item-pick");
      const paint = () => {
        const fs = this.folders(tab);
        if (folder && folder !== "·" && !fs.includes(folder)) folder = "";
        const inF = (it) => !folder || (folder === "·" ? !it.folder : it.folder === folder || (it.folder || "").startsWith(folder + "/"));
        const list = [...this.app.bank.values()].filter((it) => it.kind === tab && inF(it) && (!q || (it.name + " " + (it.tags || []).join(" ")).toLowerCase().includes(q)))
          .sort((a, b) => a.name.localeCompare(b.name, "fr"));
        const sel = h("select.folder", { on: { change: (e) => { folder = e.target.value; paint(); } } }, h("option", { value: "" }, tt("Tous les dossiers")),
          fs.map((f) => { const p = f.split("/"); return h("option", { value: f, selected: f === folder }, "   ".repeat(p.length - 1) + (p.length > 1 ? "└ " : "📁 ") + p[p.length - 1]); }),
          h("option", { value: "·", selected: folder === "·" }, tt("Sans dossier")));
        const search = h("input.search", { type: "search", placeholder: tt("Chercher…"), value: q, on: { input: (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; paint(); const s = body.querySelector("input.search"); s.focus(); s.setSelectionRange(pos, pos); } } });
        body.textContent = "";
        body.append(h("div.tabs", [["character", tt("Personnages")], ["decor", tt("Décors")], ["asset", tt("Assets")]].map(([k, label]) =>
          h("button" + (k === tab ? ".on" : ""), { on: { click: () => { tab = k; folder = (this.folderBy || {})[k] || ""; paint(); } } }, label))),
          h("div.bank-bar", sel, search),
          h("div.bank-grid.pick-grid", list.length ? list.map((it) => h("div.card." + it.kind, { title: it.name, on: { click: () => end({ id: it.id, v: this.cover(it) }) } },
            it.face ? portraitThumb(h("div.card-svg"), it) : h("img", { src: this.thumb(it, this.cover(it)), loading: "lazy", draggable: false, alt: "" }),
            h("div.card-name", it.name))) : h("p.muted", tt("Rien dans ce dossier."))));
      };
      paint();
      m = modal(title, body, [{ label: tt("Annuler"), click: () => end(null) }]);
      m.box.classList.add("wide");
      const x = m.box.querySelector("header button"); if (x) x.addEventListener("click", () => end(null));
    });
  }
  card(it) {
    const vs = Object.values(it.variants || {}), orbits = vs.filter((v) => v.orbit).length;
    const busy = this.app.jobsFor(it.id);
    const c = h("div.card." + it.kind, { draggable: true, "data-id": it.id, title: it.name + tt(" : glisser dans une case, cliquer pour la fiche"),
      "data-name": (it.name + " " + (it.tags || []).join(" ")).toLowerCase(),
      on: {
        dragstart: (e) => { e.dataTransfer.setData("application/x-bw-item", JSON.stringify({ id: it.id, v: this.cover(it) })); e.dataTransfer.effectAllowed = "copy"; },
        click: (e) => { if (this.multi) { e.preventDefault(); this.pickCard(it.id, e.shiftKey); } else this.openItem(it.id); },
      } },
      this.multi ? h("span.card-check", "✓") : null,
      it.face ? portraitThumb(h("div.card-svg"), it) : h("img", { src: this.thumb(it, this.cover(it)), loading: "lazy", draggable: false, alt: "" }),
      h("div.card-name", it.name),
      h("div.card-meta", orbits ? h("span.b.ok", { title: tt("orbites prêtes") }, "↻ " + orbits) : h("span.b", tt("fixe")),
        vs.length > 1 ? h("span.b", tt`${vs.length - 1} var.`) : null,
        busy ? h("span.b.busy", { title: tt("en calcul") }, "⏳ " + busy) : null));
    return c;
  }

  // ---------------------------------------------------------------- paquets (.bwpack) et bibliotheque en ligne
  download(query) {                  // le navigateur enregistre le paquet fabrique par le serveur
    const a = h("a", { href: "/api/bank/export?" + query, download: "" });
    document.body.append(a); a.click(); a.remove();
    toast(tt("Le paquet se prépare : le téléchargement démarre quand il est prêt (un personnage complet pèse environ 150 Mo)."), "info", 8000);
  }
  async importPacks(files, replace = false) {
    const again = [];
    for (const f of files) {
      toast(tt`Import de ${f.name} (${(f.size / 1e6).toFixed(0)} Mo)…`, "info", 8000);
      try {
        const r = await upload("bank/import" + (replace ? "?replace=1" : ""), f);
        const n = r.added.length + r.replaced.length;
        if (n) toast(tt`${f.name} : ${n} élément${n > 1 ? "s" : ""} ${replace ? tt("remplacé") : tt("ajouté")}${n > 1 ? "s" : ""} (${[...r.added, ...r.replaced].map((x) => x.name).slice(0, 6).join(", ")}${n > 6 ? "…" : ""}).`);
        if (r.skipped.length) { again.push(f); toast(tt`${f.name} : ${r.skipped.length} élément(s) déjà dans la banque, laissé(s) tel(s) quel(s).`); }
      } catch (e) { toast(tt`${f.name} refusé : ${e.message}`, "error", 9000); }
    }
    await this.reload();
    if (again.length && !replace && confirm(tt("Certains éléments de ces paquets existent déjà dans la banque.\nLes remplacer par ceux du paquet ? (les anciens partent à la corbeille du dossier de données)"))) await this.importPacks(again, true);
  }
  packDialog() {
    const folder = this.folder && this.folder !== "·" ? this.folder : "", label = KINDS.find(([k]) => k === this.tab)[1].toLowerCase();
    const n = [...this.app.bank.values()].filter((it) => it.kind === this.tab && (!folder || it.folder === folder || (it.folder || "").startsWith(folder + "/"))).length;
    const pick = h("input", { type: "file", accept: ".bwpack", multiple: true, style: { display: "none" }, on: { change: (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) { m.close(); this.importPacks(fs); } } } });
    const libBox = h("div.libbox", h("p.muted", tt("Chargement de la bibliothèque…")));
    const m = modal(tt("Paquets de personnages"), h("div.form",
      h("p.muted", tt("Un paquet (.bwpack) contient un élément entier : image de base, détourages, toutes ses poses, leurs orbites et leurs tracés. On peut aussi glisser un paquet dans la banque.")),
      h("div.row.wrap", h("button.mini", { disabled: !n, title: tt("Un seul fichier avec tout le dossier affiché. Pour un seul élément : bouton « Exporter » de sa fiche."), on: { click: () => this.download(new URLSearchParams({ folder, kind: this.tab })) } },
          tt`⬇ Exporter ${folder ? tt("le dossier « ") + folder + " »" : tt("tous les ") + label} (${n})`),
        h("button.mini", { on: { click: () => pick.click() } }, tt("⬆ Importer un paquet…")), pick),
      h("h4", tt("Bibliothèque en ligne")), libBox), [{ label: tt("Fermer") }]);
    m.box.classList.add("wide");
    const vip = this.app.info?.me?.vip !== false;                    // invite sans acces : on ne demande meme pas
    if (!vip) { libBox.textContent = ""; libBox.append(h("p.muted", tt("La bibliothèque en ligne est réservée aux comptes VIP : demande l'accès à l'administrateur."))); return; }
    get("library").then((idx) => {
      const rows = idx.items.map((e) => ({ e, box: h("input", { type: "checkbox" }) }));
      const go = h("button.primary", tt("Importer la sélection"));
      go.addEventListener("click", async () => {
        const sel = rows.filter((r) => r.box.checked);
        if (!sel.length) return toast(tt("Coche au moins un élément."), "error");
        go.disabled = true;
        let done = 0;
        for (const r of sel) {
          go.textContent = tt`Import ${done + 1}/${sel.length} : ${r.e.name}…`;
          try { await post("library/import", { id: r.e.id, replace: !!r.e.have }); done++; r.e.have = true; r.box.checked = false; r.tag.textContent = tt("✓ dans la banque"); }
          catch (err) { toast(`${r.e.name} : ${err.message}`, "error", 9000); }
        }
        go.disabled = false; go.textContent = tt("Importer la sélection");
        await this.reload();
        toast(tt`${done} élément${done > 1 ? "s" : ""} importé${done > 1 ? "s" : ""} de la bibliothèque.`);
      });
      libBox.textContent = "";
      libBox.append(h("p.muted", tt`« ${idx.name || tt("Bibliothèque")} » : ${idx.items.length} élément(s). Cocher un élément déjà dans la banque le remplace.`),
        h("div.row.wrap", h("button.mini", { on: { click: () => rows.forEach((r) => { r.box.checked = !r.e.have; }) } }, tt("Cocher ce qui manque")), h("button.mini", { on: { click: () => rows.forEach((r) => { r.box.checked = false; }) } }, tt("Rien"))),
        h("div.liblist", rows.map((r) => h("label.libitem", r.box,
          r.e.thumb ? h("img", { src: "/api/library/thumb/" + encodeURIComponent(r.e.thumb), loading: "lazy", alt: "" }) : h("span.libno", "🧩"),
          h("span.libname", r.e.name, h("small", tt`${r.e.folder ? "📁 " + r.e.folder + " · " : ""}${r.e.variants} pose(s), ${r.e.orbits} orbite(s) · ${((r.e.bytes || r.e.size || 0) / 1e6).toFixed(0)} Mo`)),
          (r.tag = h("span.muted", r.e.have ? tt("✓ dans la banque") : ""))))), go);
    }).catch((err) => { libBox.textContent = ""; libBox.append(h("p.muted", err.message + tt(". L'adresse, l'identifiant et le mot de passe de la bibliothèque se donnent dans les réglages (⚙)."))); });
  }

  // ---------------------------------------------------------------- import
  importDialog(files) {
    const kind = h("select", KINDS.map(([k, l]) => h("option", { value: k, selected: k === this.tab }, l)));
    const style = h("select", STYLES.map(([k, l]) => h("option", { value: k }, l)));
    const facing = h("select", AXES.map((a) => h("option", { value: a, selected: a === "3/4 face gauche" && false }, tr(a))));
    const name = h("input", { type: "text", value: files.length === 1 ? cleanName(files[0].name) : "", placeholder: files.length > 1 ? tt("(nom de chaque fichier)") : tt("Nom") });
    const orbit = h("input", { type: "checkbox", checked: true });
    const folder = this.folderInput(this.folder && this.folder !== "·" ? this.folder : "");
    const tier = h("select", h("option", { value: 0 }, tt("Aucune pose pour l'instant")), h("option", { value: 1 }, tt("Poses essentielles (7)")),
                   h("option", { value: 2 }, tt("Poses complètes (16)")), h("option", { value: 3 }, tt("Toutes les poses (26)")));
    const tierRow = h("label.row", tt("Poses à générer"), tier);
    const review = h("select", { title: tt("Lancer les orbites : seul le contrôle automatique trie, les orbites partent directement. Vérifier avant : les poses attendent dans la fiche que tu gardes, refasses ou jettes chacune.") },
      h("option", { value: "1" }, tt("Vérifier avant les orbites")), h("option", { value: "0" }, tt("Lancer les orbites sans vérifier")));
    const reviewRow = h("label.row", tt("Orbites des poses"), review);
    const sync = () => { tierRow.style.display = kind.value === "character" ? "" : "none"; reviewRow.style.display = kind.value === "character" && +tier.value > 0 ? "" : "none"; };
    tier.addEventListener("change", sync);
    kind.addEventListener("change", sync); sync();
    modal(tt`Ajouter à la banque (${files.length} image${files.length > 1 ? "s" : ""})`, h("div.form",
      h("div.previews", files.slice(0, 8).map((f) => h("img", { src: URL.createObjectURL(f) }))),
      h("label.row", tt("Type"), kind), h("label.row", tt("Nom"), name), h("label.row", tt("Dossier"), folder), h("label.row", tt("Rendu"), style),
      h("label.row", tt("L'image montre le sujet de"), facing),
      h("label.row.check", orbit, tt("Générer l'orbite 360° (≈ 3 min par machine)")), tierRow, reviewRow,
      h("p.muted", tt("Le mieux : un seul sujet, entier, sur un fond simple. L'orbite est détourée image par image."))),
      [{ label: tt("Annuler") }, { label: tt("Ajouter"), primary: true, click: async () => {
        const keys = this.app.info.poses.character.filter((p) => p.tier <= +tier.value).map((p) => p.key);
        for (const f of files) {
          const q = new URLSearchParams({ kind: kind.value, name: files.length === 1 ? (name.value || cleanName(f.name)) : cleanName(f.name),
                                          style: style.value, facing: facing.value, orbit: orbit.checked ? "1" : "0", target: target(), file: f.name,
                                          folder: folder.querySelector("select").value });
          try {
            const it = await upload("bank?" + q, f);
            if (kind.value === "character" && keys.length) await post(`bank/${it.id}/prepare`, { orbit: orbit.checked, review: review.value === "1", poses: keys, target: target() });
          } catch (err) { toast(`${f.name} : ${err.message}`, "error"); }
        }
        this.tab = kind.value;
        await this.reload(); this.app.pollSoon();
      } }]);
  }

  generateDialog() {
    const kind = h("select", KINDS.map(([k, l]) => h("option", { value: k, selected: k === this.tab }, l)));
    const style = h("select", STYLES.map(([k, l]) => h("option", { value: k }, l)));
    const name = h("input", { type: "text", placeholder: tt("Nom dans la banque") });
    const prompt = h("textarea", { rows: 4, placeholder: tt("Un marteau de charpentier usé, manche en bois…") });
    const orbit = h("input", { type: "checkbox", checked: true });
    const folder = this.folderInput(this.folder && this.folder !== "·" ? this.folder : "");
    modal(tt("Générer un élément"), h("div.form", h("label.row", tt("Type"), kind), h("label.row", tt("Nom"), name), h("label.row", tt("Dossier"), folder), h("label.row", tt("Rendu"), style),
      h("label.col", tt("Description"), prompt), h("label.row.check", orbit, tt("Puis son orbite 360°"))),
      [{ label: tt("Annuler") }, { label: tt("Générer"), primary: true, click: async () => {
        if (!prompt.value.trim()) { toast(tt("Décris ce qu'il faut générer."), "error"); return false; }
        await post("bank/generate", { kind: kind.value, name: name.value.trim() || prompt.value.trim().slice(0, 30), prompt: prompt.value.trim(),
                                      style: style.value, orbit: orbit.checked, target: target(), folder: folder.querySelector("select").value });
        toast(tt("Génération lancée : l'élément apparaîtra dans la banque.")); this.app.pollSoon();
      } }]);
  }

  // ---------------------------------------------------------------- fiche d'un element
  openItem(id) {
    const app = this.app;
    if (app.bank.get(id)?.face) return openPortrait(this, app.bank.get(id));       // personnage assemble : sa fiche est le portrait-robot
    this.openId = id;
    let vid = "base", frame = 0;
    const it = () => app.bank.get(id);
    const stage = h("div.stage"), img = h("img", { draggable: false, alt: "" });
    const slider = h("input", { type: "range", min: 0, max: 0, value: 0 });
    const axisLabel = h("span.muted");
    const snapBar = h("div.snapbar");
    const variants = h("div.variants");
    const poseBox = h("div.posebox");
    const reviewBox = h("div.reviewbox");          // poses a valider avant leur orbite
    const keyBox = h("div.reviewbox");             // fiche sur fond de couleur : pose en A a valider, vues des poses a valider
    const head = h("div.item-head");
    // loupe : la molette agrandit autour du pointeur (jusqu'a 10 fois) ; bouton du milieu, ou la main, pour se deplacer
    const zwrap = h("div.zoomwrap"); zwrap.append(img); stage.append(zwrap);
    let zoom = 1, ztx = 0, zty = 0, panMode = false, pan = null;
    const zoomApply = () => {
      const W = stage.clientWidth, H = stage.clientHeight;
      if (zoom <= 1.001) { zoom = 1; ztx = zty = 0; }
      ztx = Math.min(0, Math.max(W * (1 - zoom), ztx)); zty = Math.min(0, Math.max(H * (1 - zoom), zty));
      zwrap.style.transform = `translate(${ztx}px, ${zty}px) scale(${zoom})`;
      zwrap.style.setProperty("--z", zoom);       // les traits du lasso et des zones restent fins a tout zoom
      zoomLabel.textContent = Math.round(zoom * 100) + " %";
    };
    const zoomAt = (factor, cx, cy) => {      // cx, cy : point de l'ecran qui ne doit pas bouger
      const r = stage.getBoundingClientRect(), px = (cx ?? r.left + r.width / 2) - r.left, py = (cy ?? r.top + r.height / 2) - r.top;
      const z2 = Math.min(10, Math.max(1, zoom * factor)), qx = (px - ztx) / zoom, qy = (py - zty) / zoom;
      zoom = z2; ztx = px - z2 * qx; zty = py - z2 * qy; zoomApply();
    };
    stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 1 && !panMode) return;
      e.preventDefault(); e.stopImmediatePropagation(); stage.setPointerCapture(e.pointerId);
      pan = { x: e.clientX, y: e.clientY, tx: ztx, ty: zty };
    }, true);
    stage.addEventListener("pointermove", (e) => { if (pan) { ztx = pan.tx + e.clientX - pan.x; zty = pan.ty + e.clientY - pan.y; zoomApply(); e.stopImmediatePropagation(); } }, true);
    stage.addEventListener("pointerup", (e) => { if (pan) { pan = null; e.stopImmediatePropagation(); } }, true);
    const zoomLabel = h("span.muted.zoomlabel", "100 %");
    const handBtn = h("button.mini", { title: tt("Main : glisser pour se déplacer dans l'image agrandie (ou bouton du milieu de la souris). Recliquer pour revenir à l'outil."), on: { click: () => { panMode = !panMode; handBtn.classList.toggle("on", panMode); stage.classList.toggle("panning", panMode); } } }, "✋");
    const zoomBar = h("div.zoombar", { title: tt("Molette sur l'image : agrandir ou réduire autour du pointeur") },
      h("span.muted", { title: tt("Molette : agrandir. Barre d'espace tenue + glisser : se déplacer dans l'image.") }, tt("🔍 Loupe :")), h("button.mini", { on: { click: () => zoomAt(0.8) } }, "−"), zoomLabel, h("button.mini", { on: { click: () => zoomAt(1.25) } }, "+"),
      h("button.mini", { title: tt("Revenir à l'image entière"), on: { click: () => { zoom = 1; zoomApply(); } } }, "1:1"), handBtn);
    const show = () => {
      const item = it(), v = variantOf(item, vid);
      if (!item || !v) return;
      const sp = sprite(item, vid, frame);
      const pre = v.orbit ? preload(item, vid) : null, ready = !pre || !pre[sp.i] || pre[sp.i].complete;
      if (ready) img.src = sp.url;            // image pas encore arrivee : on garde la precedente, sans saccade
      else pre[sp.i].addEventListener("load", () => { if (frame === sp.i && it() === item) show(); }, { once: true });
      if (pre) { const got = pre.filter((x) => x.complete).length; loadLabel.textContent = got < pre.length ? tt`chargement ${got}/${pre.length}` : ""; if (got < pre.length) setTimeout(() => { if (document.body.contains(stage)) loadLabel.textContent = pre.every((x) => x.complete) ? "" : tt`chargement ${pre.filter((x) => x.complete).length}/${pre.length}`; }, 600); }
      drawZones();
      slider.max = Math.max(0, sp.n - 1); slider.value = sp.i; slider.disabled = sp.n < 2;
      axisLabel.textContent = v.orbit ? tt`image ${sp.i + 1}/${sp.n} · ${nearestAxis(v.orbit, sp.i)}` : (v.cut ? tt("image fixe détourée") : tt("image d'origine (pas encore détourée)"));
    };
    slider.addEventListener("input", () => { frame = +slider.value; show(); });
    // lecture : l'orbite tourne en boucle (24 images par seconde), en attendant les images pas encore arrivees
    const loadLabel = h("span.muted.loadlabel");
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; playBtn.textContent = "▶"; };
    const playBtn = h("button.mini.playbtn", { title: tt("Faire tourner l'orbite en boucle (barre d'espace). Recliquer pour arrêter."), on: { click: () => {
      if (timer) return stop();
      playBtn.textContent = "⏸";
      timer = setInterval(() => {
        if (!document.body.contains(stage)) return stop();
        const v = variantOf(it(), vid);
        if (!v || !v.orbit) return stop();
        const pre = preload(it(), vid), next = (frame + 1) % v.orbit.n;
        if (pre && pre[next] && !pre[next].complete) return;        // on attend l'image suivante
        frame = next; show();
      }, 1000 / 24);
    } } }, "▶");
    let drag = null;
    // lasso : on entoure une zone a la souris, elle est videe (ou remplie) sur l'image affichee
    // lasso par points : Maj tenue, chaque clic pose un point (lassoOpen : le lasso attend le suivant, lassoA = indice du
    // bout provisoire qui suit la souris) ; Maj relachee, ou clic sur le premier point, ferme et applique. Pendant un trace a
    // main levee, Maj tire une droite ; relacher le bouton en gardant Maj continue par points
    let lassoMode = "", lassoPts = null, lassoA = null, lassoOpen = false;
    const lassoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lassoSvg.setAttribute("class", "lasso"); lassoSvg.style.display = "none"; zwrap.append(lassoSvg);
    const lassoDraw = () => {
      Object.assign(lassoSvg.style, { display: lassoPts ? "" : "none", left: img.offsetLeft + "px", top: img.offsetTop + "px", width: img.offsetWidth + "px", height: img.offsetHeight + "px" });
      if (!lassoPts) return;
      lassoSvg.setAttribute("viewBox", "0 0 1000 1000"); lassoSvg.setAttribute("preserveAspectRatio", "none");
      lassoSvg.innerHTML = `<polygon points="${lassoPts.map((q) => (q[0] * 1000).toFixed(1) + "," + (q[1] * 1000).toFixed(1)).join(" ")}" class="${lassoMode}"/>`;
    };
    const lassoSet = (m) => { lassoMode = lassoMode === m ? "" : m; lassoPts = null; lassoA = null; lassoOpen = false; lassoDraw(); stage.style.cursor = lassoMode ? "crosshair" : ""; fixBar.querySelectorAll("[data-lasso]").forEach((b) => b.classList.toggle("on", b.dataset.lasso === lassoMode)); };
    const lassoPt = (e) => { const r = img.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    const lassoSend = async () => {
      const pts = lassoPts; lassoPts = null; lassoA = null; lassoOpen = false;
      // surface du contour (formule du lacet) : un clic sans glisser ne retouche rien
      const area = pts ? Math.abs(pts.reduce((s, q, i) => { const r = pts[(i + 1) % pts.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2 : 0;
      if (!pts || pts.length < 3 || area < 2e-5) { lassoDraw(); return; }
      try {
        const keepLines = !(fixBar.querySelector("input[data-lines]") || {}).checked;
        await post(`bank/${id}/lasso`, { variant: vid, frame, points: pts, mode: lassoMode, lines: !keepLines });
        await this.reload();                                        // l'outil reste arme : on passe a l'image suivante et on recommence
      } catch (err) { toast(err.message, "error", 9000); }
      lassoDraw();
    };
    stage.addEventListener("pointermove", (e) => {
      if (!lassoPts) return;
      const p = lassoPt(e);
      if (e.shiftKey || lassoOpen) {                // droite : le bout provisoire suit la souris
        if (lassoA == null) lassoA = lassoPts.length;
        lassoPts.length = lassoA; lassoPts.push(p);
      } else {                                      // Maj relachee : la droite est fixee, on repart a main levee
        lassoA = null; lassoPts.push(p);
      }
      lassoDraw();
    });
    stage.addEventListener("pointerup", (e) => {
      if (!lassoPts) return;
      if (e.shiftKey) { if (lassoA == null) { lassoA = lassoPts.length; lassoPts.push(lassoPt(e)); } lassoOpen = true; lassoDraw(); return; }
      lassoSend();
    });
    const lassoKey = (e) => {                       // Maj relachee, lasso ouvert : on ferme et on applique
      if (!document.body.contains(stage)) return document.removeEventListener("keyup", lassoKey);
      if (e.key !== "Shift" || !lassoOpen || !lassoPts) return;
      lassoPts.length = lassoA; lassoSend();
    };
    document.addEventListener("keyup", lassoKey);
    const stepKey = (e) => {                   // fleches : image precedente / suivante, pour retoucher a la chaine
      if (!document.body.contains(stage)) return document.removeEventListener("keydown", stepKey);
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target !== slider) return;
      const v = variantOf(it(), vid);
      if (!v || !v.orbit || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault(); frame = (frame + (e.key === "ArrowRight" ? 1 : -1) + v.orbit.n) % v.orbit.n; show();
    };
    document.addEventListener("keydown", stepKey);
    // annuler / retablir une retouche du detourage (lasso, zone videe, images d'origine) : 15 pas par orbite, cote serveur
    const retouchUndo = async (redo) => {
      const v = variantOf(it(), vid);
      if (!v || !v.orbit) return;
      try {
        const r = await post(`bank/${id}/undo`, { variant: vid, redo });
        if (r.frames && r.frames.length === 1) frame = r.frames[0];        // on montre l'image remise
        await this.reload();
        toast(redo ? tt`Retouche rétablie (encore ${r.redo} à rétablir).` : tt`Retouche annulée (encore ${r.undo} à annuler).`);
      } catch (err) { toast(err.message, "error"); }
    };
    const undoKey = (e) => {
      if (!document.body.contains(stage)) return document.removeEventListener("keydown", undoKey);
      if (!(e.ctrlKey || e.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      const backs = document.querySelectorAll(".modal-back");
      if (backs[backs.length - 1] !== stage.closest(".modal-back")) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      e.preventDefault(); retouchUndo(k === "y" || e.shiftKey);
    };
    document.addEventListener("keydown", undoKey);
    // barre d'espace tenue : la main, pour se deplacer dans l'image agrandie sans quitter le lasso
    let spaceHeld = false, handLocked = false;
    const spaceKey = (e) => {
      if (!document.body.contains(stage)) { document.removeEventListener("keydown", spaceKey); document.removeEventListener("keyup", spaceKey); return; }
      if (e.code !== "Space" || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      e.preventDefault();
      if (e.target && e.target.blur && e.target.tagName === "BUTTON") e.target.blur();      // sinon l'espace « clique » le dernier bouton
      const down = e.type === "keydown";
      if (down === spaceHeld) return;
      spaceHeld = down;
      if (down) handLocked = panMode;
      panMode = down || handLocked; stage.classList.toggle("panning", panMode); handBtn.classList.toggle("on", panMode);
    };
    document.addEventListener("keydown", spaceKey); document.addEventListener("keyup", spaceKey);
    let punching = false;
    let zones = null, zonesFor = "";           // zones suspectes proposees par l'analyse, pour la variante affichee
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "zones"); stage.style.position = "relative"; zwrap.append(overlay);
    const drawZones = () => {
      const list = zones && zonesFor === vid ? zones.frames[String(frame)] || [] : [];
      overlay.style.display = list.length ? "" : "none";
      if (!list.length) return;
      overlay.setAttribute("viewBox", `0 0 ${zones.w} ${zones.h}`);
      Object.assign(overlay.style, { left: img.offsetLeft + "px", top: img.offsetTop + "px", width: img.offsetWidth + "px", height: img.offsetHeight + "px" });
      overlay.innerHTML = list.map((z, i) => tt`<path d="${z.d}" class="${z.cls === "sur" ? "sure" : "doubt"}" data-i="${i}"><title>${z.cls === "sur" ? tt("Probablement un vide") : tt("Peut-être un vide")} : cliquer pour le vider (ici et sur les images voisines)</title></path>`).join("");
    };
    img.addEventListener("load", drawZones);
    overlay.addEventListener("pointerdown", (e) => {
      const i = e.target.dataset && e.target.dataset.i;
      if (i === undefined) return;
      e.stopPropagation(); e.preventDefault();
      const z = zones.frames[String(frame)][+i];
      punchAt(null, z);
    });
    const loadZones = async (quiet) => {
      if (!quiet) toast(tt("Analyse de l'orbite : recherche des vides remplis à tort (jusqu'à une minute)…"), "info", 9000);
      try {
        zones = await get(`bank/${id}/zones?variant=${encodeURIComponent(vid)}`); zonesFor = vid;
        const fs = Object.keys(zones.frames).map(Number).sort((a, b) => a - b);
        if (!quiet) toast(fs.length ? tt`Zones suspectes sur ${fs.length} image(s). Rouge : probablement un vide. Orange : peut-être. Fais tourner l'orbite et clique celles à vider.` : tt("Aucune zone suspecte trouvée sur cette orbite."), "info", 9000);
        if (!quiet && fs.length && !zones.frames[String(frame)]) frame = fs[0];
        show();
      } catch (err) { toast(err.message, "error", 9000); }
    };
    const punchAt = async (e, z) => {         // vider la zone cliquee (un vide rempli a tort), sur cette image et ses voisines
      let x, y;
      if (z) { x = z.x; y = z.y; } else {
        const r = img.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return toast(tt("Clique sur le personnage, dans la zone à vider."), "error");
        x = (e.clientX - r.left) / r.width; y = (e.clientY - r.top) / r.height;
      }
      punching = false; stage.style.cursor = "";
      toast(tt("Zone en cours de vidage sur les images voisines, puis l'orbite est retracée (30 s environ)…"), "info", 9000);
      try {
        const res = await post(`bank/${id}/punch`, { variant: vid, frame, x, y });
        toast(tt`Zone vidée sur ${res.frames.length} image(s) de l'orbite.`); await this.reload();
        if (zones) await loadZones(true);
      } catch (err) { toast(err.message, "error", 9000); }
    };
    stage.addEventListener("pointerdown", () => { if (timer && !punching) stop(); }, true);
    stage.addEventListener("pointerdown", (e) => { if (lassoMode && !punching) { e.preventDefault(); stage.setPointerCapture(e.pointerId);
        if (lassoOpen && lassoPts) {                 // lasso ouvert : le clic pose un point, ou ferme sur le premier
          lassoPts.length = lassoA; lassoA = null; lassoOpen = false;
          const r = img.getBoundingClientRect(), f = lassoPts[0];
          if (lassoPts.length >= 3 && Math.hypot(e.clientX - (r.left + f[0] * r.width), e.clientY - (r.top + f[1] * r.height)) < 9) { lassoSend(); return; }
          lassoPts.push(lassoPt(e));
        }
        else { lassoPts = [lassoPt(e)]; lassoA = null; }
        lassoDraw(); return; }
      if (punching) { e.preventDefault(); return punchAt(e); } drag = { x: e.clientX, f: frame }; stage.setPointerCapture(e.pointerId); e.preventDefault(); });
    stage.addEventListener("pointermove", (e) => {
      const v = variantOf(it(), vid);
      if (!drag || !v || !v.orbit) return;
      frame = (((drag.f + Math.round((e.clientX - drag.x) / 5)) % v.orbit.n) + v.orbit.n) % v.orbit.n; show();
    });
    stage.addEventListener("pointerup", () => { drag = null; });

    const build = (light) => {
      const item = it();
      if (!item) return;
      const v = variantOf(item, vid) || item.variants.base;
      if (!item.variants[vid]) vid = "base";
      if (v.orbit) preload(item, vid);
      // en-tete : nom, rendu, axe de l'image de depart
      if (!light) {
      head.textContent = "";
      const nameIn = h("input", { type: "text", value: item.name, on: { change: async (e) => { await put("bank/" + id, { name: e.target.value }); this.reload(); } } });
      const styleIn = h("select", { on: { change: async (e) => { await put("bank/" + id, { style: e.target.value }); this.reload(); } } },
        STYLES.map(([k, l]) => h("option", { value: k, selected: k === item.style }, l)));
      // dossier : deroulant de tous les dossiers de l'onglet (sous-dossiers en retrait), plus « Sans dossier » et « Nouveau dossier… »
      const fold = h("select", h("option", { value: "", selected: !item.folder }, tt("Sans dossier")),
        this.folders(item.kind).map((f) => h("option", { value: f, selected: f === item.folder }, "\u00a0\u00a0\u00a0".repeat(f.split("/").length - 1) + f.replace(/\//g, " \u203a "))),
        h("option", { value: "__new__" }, tt("＋ Nouveau dossier…")));
      fold.addEventListener("change", async () => {
        let f = fold.value;
        if (f === "__new__") {
          f = (prompt(tt("Nom du dossier (sous-dossier : « Parent/Nom ») :"), item.folder || "") || "").trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
          if (!f) { fold.value = item.folder || ""; return; }
        }
        if (![...fold.options].some((o) => o.value === f)) fold.insertBefore(h("option", { value: f }, f), fold.lastChild);
        fold.value = f; item.folder = f;
        await put("bank/" + id, { folder: f }); this.reload();
      });
      head.append(h("label.row", tt("Nom"), nameIn), h("label.row", tt("Dossier"), fold), h("label.row", tt("Rendu"), styleIn));
      // particularites a garder sur toutes les poses : ajoutees telles quelles a la fin des consignes (poses et vues
      // sur fond de couleur). En anglais de preference : le modele les lit sans traduction.
      if (item.kind === "character") {
        const keepIn = h("input", { type: "text", value: item.keep || "", placeholder: tt("ex. : long red cape from the shoulders to the calves, gloves, high-heeled boots"),
          on: { change: async (e) => { await put("bank/" + id, { keep: e.target.value }); this.reload(); toast(tt("Gardé pour les prochaines poses et vues.")); } } });
        head.append(h("label.row", { title: tt("Ce que le personnage garde sur toutes les poses (une cape, des gants, un accessoire…). Le texte est ajouté tel quel à la fin des consignes des poses et des vues sur fond de couleur : écris-le de préférence en anglais, par exemple « long red cape from the shoulders to the calves, gloves, high-heeled boots ». Vaut pour les poses lancées ensuite.") },
          tt("À garder sur toutes les poses ⓘ"), keepIn));
      }
      // depense du personnage (fal et intelligence, estimee d'apres les prix des reglages) et son plafond
      if (item.kind === "character") {
        const c = item.cost || {}, spentNow = +c.total || 0, cap = Math.max(+((app.info.settings || {}).budget || {}).cap || 10, +c.allow || 0);
        const lines = (c.lines || []).slice(-12).reverse().map((l) => `${new Date(l.t * 1000).toLocaleString()} · ${l.what} · ${(+l.usd).toFixed(3)} $`).join("\n");
        head.append(h("label.row", { title: lines ? tt("Dernières dépenses :") + "\n" + lines : tt("Aucune dépense comptée pour ce personnage.") }, tt("Dépense"),
          h("span.cost" + (spentNow >= cap * 0.8 ? ".warn" : ""), tt`${spentNow.toFixed(2)} $ sur ${cap.toFixed(2)} $ (plafond)`)));
      }
      }
      // reperes d'axes
      snapBar.textContent = "";
      if (v.orbit && v.orbit.audit) snapBar.append(auditTag(v.orbit.audit, tt("tournette")));
      if (v.orbit) {
        snapBar.append(h("span.muted", tt("Aller à :")), ...AXES.map((a) => h("button.mini", { title: tt("Afficher cet axe"),
          on: { click: () => { frame = v.orbit.snaps?.[a] ?? angleToFrame(v.orbit, AXES.indexOf(a) * 45); show(); } } }, tr(a))));
        const tag = h("select", h("option", { value: "" }, tt("Cette image est…")), AXES.map((a) => h("option", { value: a }, tr(a))));
        tag.addEventListener("change", async () => {
          if (!tag.value) return;
          const snaps = Object.assign({}, v.orbit.snaps); snaps[tag.value] = frame;
          await post(`bank/${id}/snaps`, { variant: vid, snaps });
          toast(tt`Repère « ${tag.value} » posé sur l'image ${frame + 1}.`); await this.reload();
        });
        snapBar.append(tag);
      }
      // variantes
      variants.textContent = "";
      const main = this.cover(item);
      for (const [k, vv] of Object.entries(item.variants)) {
        const busy = app.jobsFor(id, k);
        const star = h("button.var-star" + (k === main ? ".on" : ""), { title: k === main ? tt("Variante principale : c'est elle qu'on voit dans la banque et qui se pose quand on glisse la carte") : tt("Faire de cette variante la principale (vignette de la banque, variante posée quand on glisse la carte)"),
          on: { click: async (e) => { e.stopPropagation(); if (k === main) return;
            try { const r = await put("bank/" + id, { cover: k });
              if (r && r.cover === k) toast(tt`« ${tr(vv.label)} » devient la variante principale.`);
              else toast(tt("Le serveur n'enregistre pas encore la variante principale : il faut le redémarrer."), "error");
              await this.reload(); } catch (err) { toast(err.message, "error"); } } } }, k === main ? "★" : "☆");
        const cross = item.body ? null : h("button.var-del", { title: k === "base" ? tt("La variante de base ne se supprime pas : son image de départ sert aux poses et aux autres variantes") : tt("Supprimer cette variante"), disabled: k === "base",
          on: { click: async (e) => { e.stopPropagation(); if (k === "base" || !confirm(tt`Supprimer la variante « ${tr(vv.label)} » de « ${item.name} » ?`)) return;
            try { await del(`bank/${id}/variant/${k}`); if (vid === k) vid = "base"; await this.reload(); } catch (err) { toast(err.message, "error"); } } } }, "✕");
        variants.append(h("div.var" + (k === vid ? ".on" : "") + (k === main ? ".main" : ""), { draggable: true, title: tr(vv.label) + tt(" : cliquer pour voir, glisser dans une case"),
          on: { click: () => { vid = k; frame = 0; build(true); },
                dragstart: (e) => { e.dataTransfer.setData("application/x-bw-item", JSON.stringify({ id, v: k })); } } },
          star, cross,
          h("img", { src: this.thumb(item, k), draggable: false, loading: "lazy" }), h("div.var-name", tr(vv.label)),
          h("div.card-meta", vv.orbit ? h("span.b.ok", "↻") : h("span.b", tt("fixe")), busy ? h("span.b.busy", "⏳") : null)));
      }
      // actions sur la variante
      // retouches du detourage : bien en vue sous l'image
      fixBar.textContent = "";
      if (v.orbit) fixBar.append(h("b", tt("Corriger le détourage")),
        h("div.row.wrap",
          h("button.mini" + (lassoMode === "vider" ? ".on" : ""), { "data-lasso": "vider", title: tt("Entoure à la souris une zone blanche qui devrait être vide : elle devient transparente sur l'image affichée. L'outil reste actif : flèche droite pour l'image suivante, et on recommence. Recliquer le bouton pour le ranger."), on: { click: () => lassoSet("vider") } }, tt("✂ Lasso : vider")),
          h("button.mini" + (lassoMode === "remplir" ? ".on" : ""), { "data-lasso": "remplir", title: tt("Entoure à la souris un trou dans le personnage : il est rebouché en blanc sur l'image affichée."), on: { click: () => lassoSet("remplir") } }, tt("🩹 Lasso : remplir")),
          h("label.check", { title: tt("Coché : le lasso « vider » ne touche pas aux traits du dessin, seulement au blanc. Décoché : tout ce qui est entouré disparaît, traits compris.") }, h("input", { type: "checkbox", checked: true, "data-lines": "1" }), tt("garder les traits"))),
        h("p.muted", tt("Lasso : choisis un fond de couleur, clique « Lasso : vider », puis entoure la zone à la souris sur l'image. Molette : agrandir. Barre d'espace tenue + glisser : se déplacer. Flèches ← → : changer d'image.")),
        h("p.muted", tt("Lasso par points : Maj tenue, chaque clic pose un point, relié au précédent par une droite. Relâcher Maj (ou cliquer le premier point) ferme le contour et l'applique. On peut commencer à main levée et continuer par points : relâcher le bouton en gardant Maj.")),
        h("div.row.wrap",
          v.orbit ? h("button.mini", { title: tt("Analyse l'orbite et montre en couleur les zones blanches qui sont peut-être des vides remplis à tort (entre un bras et le corps, entre les jambes). Rouge : probablement. Orange : peut-être. Rien n'est vidé sans ton clic sur la zone."), on: { click: () => { if (zones && zonesFor === vid) { zones = null; drawZones(); } else loadZones(); } } }, tt("🔎 Vides suspects")) : null,
          v.orbit ? h("button.mini", { title: tt("Pour un vide rempli à tort (entre un bras et le corps, entre les jambes) : clique ce bouton, puis clique dans la zone sur l'image. Elle est vidée sur cette image et sur les voisines où elle existe. Mets un fond de couleur pour bien voir."), on: { click: () => { punching = true; stage.style.cursor = "crosshair"; toast(tt("Clique maintenant dans la zone à vider, sur l'image.")); } } }, tt("🕳 Vider une zone")) : null,
          v.orbit ? h("button.mini", { title: tt("Annule la dernière retouche de cette orbite (Ctrl+Z), jusqu'à 15 pas"), on: { click: () => retouchUndo(false) } }, tt("↶ Annuler la retouche")) : null,
          v.orbit ? h("button.mini", { title: tt("Rétablit la retouche annulée (Ctrl+Y)"), on: { click: () => retouchUndo(true) } }, tt("↷ Rétablir")) : null,
          v.orbit ? h("button.mini", { title: tt("Annule les retouches de cette orbite (zones vidées, rebouchage) : remet les images gardées avant"), on: { click: async () => { if (!confirm(tt("Remettre les images d'origine de cette orbite ?"))) return; try { const r = await post(`bank/${id}/restore`, { variant: vid }); toast(tt`${r.frames} image(s) remise(s).`); await this.reload(); } catch (err) { toast(err.message, "error"); } } } }, tt("↩ Images d'origine")) : null),
        h("p.muted", tt("1. Mets un fond de couleur. 2. « Vides suspects » colore les zones blanches qui devraient peut-être être vides (rouge : probable, orange : possible). 3. Fais tourner et clique une zone colorée pour la vider, ici et sur les images voisines. Si la zone n'est pas colorée : « Vider une zone », puis clic dedans.")));
      const acts = h("div.acts",
        h("button.mini", { on: { click: async () => { await post(`bank/${id}/orbit`, { variant: vid, seed: Math.floor(Math.random() * 1e6), target: target() });
          toast(tt("Orbite relancée avec une autre graine.")); app.pollSoon(); } } }, v.orbit ? tt("↻ Refaire l'orbite") : tt("↻ Générer l'orbite")),
        item.kind !== "decor" ? h("button.mini", { on: { click: async () => { await post(`bank/${id}/cut`, { variant: vid, target: target() }); app.pollSoon(); } } }, tt("✂ Refaire le détourage")) : null,
        vid !== "base" ? h("button.mini.danger", { on: { click: async () => { await del(`bank/${id}/variant/${vid}`); vid = "base"; await this.reload(); } } }, tt("Supprimer cette variante")) : null,
        item.drawn ? h("button.mini", { title: tt("Rouvre l'atelier de dessin avec le dessin de cet asset (formes, calques, images) pour le retoucher, et le temps réel ; à l'enregistrement, son image est remplacée"), on: { click: () => { m.close(); this.openId = null; app.drawAsset(item); } } }, tt("✏ Reprendre le dessin")) : null,
        item.kind === "character" && item.identikit ? h("button.mini", { title: tt("Rouvre l'atelier avec la composition de ce portrait-robot (éléments, places, miroirs, corps) ; à l'enregistrement : remplacer son image de base ou faire un nouveau personnage"), on: { click: () => { m.close(); this.openId = null; openIdentikit(this, { item }); } } }, tt("🧩 Éditer dans le portrait-robot")) : null,
        h("button.mini", { title: tt("Enregistre cet élément entier (poses, orbites, tracés) dans un fichier .bwpack à donner à quelqu'un"), on: { click: () => this.download(new URLSearchParams({ ids: id })) } }, tt("📦 Exporter")),
        h("button.mini.danger", { on: { click: async () => { if (!confirm(tt`Retirer « ${item.name} » de la banque ? (il part à la corbeille du dossier de données)`)) return;
          await del("bank/" + id); m.close(); this.openId = null; this.reload(); } } }, tt("Retirer de la banque")));
      if (item.kind === "character") {   // planche de vues : sert de reference a l'orbite (dos, profil)
        const sh = item.sheet || {}, names = { dos: "dos", profil: "profil", "trois-quarts-dos": "3/4 dos" };
        // voyant : la planche en file ou en calcul (tache « planche », ou orbite qui la fait d'abord), sur quelle machine, quelle vue
        let sent = 0;
        const sheetJob = () => app.jobs.find((j) => (j.status === "queued" || j.status === "running") && j.params.item === id &&
          (j.kind === "item_sheet" || (j.status === "running" && /^planche de vues/.test(j.progress || ""))));
        const state = h("span.sheet-state"), redo = h("button.mini", { title: tt("Recalcule les vues de dos et de profil ; relance ensuite l'orbite pour qu'elle s'en serve"), on: { click: async () => {
          sent = Date.now(); show();
          try { await post(`bank/${id}/sheet`, { redo: true, target: target() }); toast(tt("Planche de vues relancée.")); app.pollSoon(); }
          catch (err) { sent = 0; show(); toast(tt("Planche refusée : ") + err.message, "error"); }
        } } }, Object.keys(sh).length ? tt("↻ Refaire la planche") : tt("Faire la planche"));
        const asPose = (k) => Object.values(item.variants || {}).some((vv) => vv.view === k);
        const views = h("div.sheet-views", Object.entries(sh).map(([k, rel]) => h("figure", h("img", { src: `/bank/${id}/${rel}?t=${item.sheet_t || 0}`, loading: "lazy" }), h("figcaption", names[k] || k),
          asPose(k) ? h("span.muted", { title: tt("Cette vue est déjà une pose : elle se choisit dans les poses de l'élément, dans la case") }, tt("✓ pose"))
            : h("button.mini", { title: tt("Fait de cette vue une pose fixe (détourée, sans tournette), à choisir dans une case comme les autres poses"), on: { click: async () => {
                try { await post(`bank/${id}/viewpose`, { view: k, target: target() }); toast(tt("Pose créée : détourage en cours. Elle se choisit dans les poses de l'élément.")); await this.reload(); app.pollSoon(); }
                catch (err) { toast(err.message, "error"); } } } }, tt("➕ En faire une pose")))));
        const show = () => {
          const j = sheetJob(), wait = !j && sent && Date.now() - sent < 8000;   // juste envoyee : la file ne l'a pas encore montree
          if (j) sent = 0;
          let txt = "";
          if (wait) txt = tt("⏳ Demande envoyée…");
          else if (j && j.status === "queued") txt = tt("⏳ En file d'attente : elle partira dès qu'une machine sera libre.");
          else if (j) {
            const v = ((j.progress || "").match(/planche de vues : (.+)$/) || [])[1], sec = j.started ? Math.max(0, Math.round(Date.now() / 1000 - j.started)) : 0;
            txt = tt`⏳ Planche en calcul sur ${j.worker || "?"}` + (v ? tt` : vue ${names[v] || v}` : "") + (sec ? ` · ${sec} s` : "") + (j.kind === "item_orbit" ? tt(" (avant l'orbite)") : "");
          }
          state.textContent = txt; state.style.display = txt ? "" : "none";
          redo.disabled = !!(j || wait); views.classList.toggle("busy", !!(j || wait));
        };
        show();
        const tick = setInterval(() => { if (!document.body.contains(state)) return clearInterval(tick); show(); }, 1000);
        if (item.sheet_wait) {                               // portrait-robot : planche a valider avant la tournette
          const va = item.sheet_audit || {}, bad = Object.entries(va).filter(([, v]) => v && v !== "garder");
          acts.append(h("div.sheet-wait", h("b", tt("⏸ Planche à valider avant la tournette")),
            h("span.muted", Object.keys(va).some((k) => va[k]) ? (bad.length ? tt`Refusées au contrôle : ${bad.map(([k]) => names[k] || k).join(", ")}.` : tt("Contrôle passé."))
              : tt("Pas de contrôle automatique (intelligence non configurée) : regarde chaque vue. Même personnage, mêmes proportions, rien d'ajouté ?")),
            h("div.row.wrap",
              h("button.mini.primary", { title: tt("La planche est bonne : la tournette part"), on: { click: async () => { try { await post(`bank/${id}/sheet`, { ok: true, target: target() }); toast(tt("Tournette en file.")); app.pollSoon(); await this.reload(); } catch (err) { toast(err.message, "error"); } } } }, tt("✓ Valider la planche et lancer la tournette")),
              h("button.mini", { on: { click: async () => { try { await post(`bank/${id}/sheet`, { redo: true, gate: true, target: target() }); toast(tt("Planche relancée.")); app.pollSoon(); } catch (err) { toast(err.message, "error"); } } } }, tt("↻ Refaire la planche")))));
        }
        acts.append(h("div.sheet", h("div.sheet-head", h("span.muted", Object.keys(sh).length ? tt("Planche de vues (référence des orbites)") : tt("Pas encore de planche de vues : elle se fait avant la prochaine orbite.")), redo),
          state, views));
      }
      // fiche sur fond de couleur : la pose en A (et la base) sur un fond uni, validees avant tout le reste. Ensuite les
      // poses, leurs vues et leurs orbites gardent ce fond : le detourage se fait par la couleur, les vides restent ouverts.
      keyBox.textContent = "";
      if (item.kind === "character" && !item.body && !item.face) {
        const ap = item.apose;
        const running = (kind, k) => app.jobs.some((j) => (j.status === "queued" || j.status === "running") && j.kind === kind && j.params.item === id && (k == null || j.params.variant === k));
        const call = async (path, body, msg) => { try { await post(`bank/${id}/${path}`, { ...body, target: target() }); if (msg) toast(msg); await this.reload(); app.pollSoon(); } catch (err) { toast(err.message, "error"); } };
        const damier = "background: repeating-conic-gradient(#8884 0 25%, #0000 0 50%) 0 0 / 16px 16px; border-radius: 6px;";
        const pic = (rel, cap, t) => h("figure", { style: "margin:0; text-align:center;" }, h("img", { src: `/bank/${id}/${rel}?t=${t || 0}`, loading: "lazy", style: "height: 240px; max-width: 100%; object-fit: contain; " + damier }), h("figcaption.muted", cap));
        // une image sur fond de couleur, montree sur son fond, a cote de sa decoupe ; si son fond n'est pas de la couleur
        // attendue (fond blanc d'un tirage rate), « fond raté » a la place des deux
        const keyName = (k) => (k === "magenta" ? tt("sur fond magenta") : tt("sur fond vert"));
        const pair = (title, keyRel, cutRel, t, key, hgt = 240) => {
          const img = h("img", { src: `/bank/${id}/${keyRel}?t=${t || 0}`, style: `height: ${hgt}px; max-width: 100%; object-fit: contain;` });
          const row = h("div.row", { style: "gap: 6px; align-items: flex-end;" },
            h("figure", { style: "margin:0; text-align:center;" }, img, h("figcaption.muted", keyName(key))),
            cutRel ? h("figure", { style: "margin:0; text-align:center;" }, h("img", { src: `/bank/${id}/${cutRel}?t=${t || 0}`, style: `height: ${hgt}px; max-width: 100%; object-fit: contain; ` + damier }), h("figcaption.muted", tt("découpée"))) : null);
          img.addEventListener("load", () => {
            try {
              const c = document.createElement("canvas"), w = (c.width = 64), hh = (c.height = Math.max(1, Math.round(64 * img.naturalHeight / img.naturalWidth)));
              const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, hh);
              const d = x.getImageData(0, 0, w, hh).data;
              let n = 0;
              for (let i = 0; i < d.length; i += 4) { const dom = key === "magenta" ? Math.min(d[i], d[i + 2]) - d[i + 1] : d[i + 1] - Math.max(d[i], d[i + 2]); if (dom > 80) n++; }
              if (n / (w * hh) < 0.2) row.replaceChildren(h("div.fond-rate", { style: `height: ${hgt}px;`, title: tt("Ce tirage n'a pas le fond de couleur demandé (fond blanc ou transparent) : la découpe par la couleur n'en tirera rien. Refais-le.") }, tt("fond raté")));
            } catch (err) { /* image illisible : on la laisse */ }
          }, { once: true });
          return h("div.kpair", h("div.kpair-title", title), row);
        };
        const color = h("select", { title: tt("Couleur du fond : vert, ou magenta si le personnage porte du vert") }, h("option", { value: "vert" }, tt("fond vert")), h("option", { value: "magenta" }, tt("fond magenta")));
        if (ap && ap.key) color.value = ap.key;
        const make = () => call("apose", { action: "make", key: color.value, seed: Math.floor(Math.random() * 1e6) }, tt("Pose en A demandée (2 images)."));
        if (running("item_apose")) keyBox.append(h("h4", tt("Pose en A")), h("p.muted", tt("⏳ La pose en A et la base sur fond de couleur sont en calcul…")));
        else if (!ap) keyBox.append(h("h4", tt("Pose en A (fond de couleur)")),
          h("p.muted", tt("Avant les poses : ton dessin reposé sur un fond uni, qui sert de référence aux poses, et une pose en A qui sert seulement à contrôler la silhouette ; tu valides. Ensuite les poses, leurs vues et leurs orbites gardent ce fond et sont découpées par la couleur : les vides (bras sur les hanches, entre les jambes) restent ouverts, sans rebouchage ni halo. Demande un moteur des poses fal (2 images payantes).")),
          h("div.row.wrap", color, h("button.mini.primary", { on: { click: make } }, tt("Faire la pose en A"))));
        else if (ap.state !== "ok") keyBox.append(h("h4", tt("Pose en A à valider")),
          h("p.muted", tt("Le dessin sur fond de couleur est la référence des poses : même visage, même trait, même remplissage, mêmes proportions que ton dessin ? La pose en A n'est qu'un contrôle de la silhouette (elle a tendance à amaigrir les caricatures). Le fond doit être uni partout, y compris entre les membres. Tant que tu ne valides pas, rien ne change pour cet élément.")),
          h("div.row.wrap", { style: "gap: 14px; align-items: flex-end;" }, h("div.kpair", h("div.kpair-title", tt("ton dessin")), pic(item.variants.base.ref, tt("d'origine"), item.variants.base.t)),
            ap.base ? pair(tt("ton dessin sur fond de couleur : la référence"), ap.base, ap.base_cut, ap.t, ap.key) : null,
            pair(tt("pose en A : contrôle"), ap.img, ap.cut, ap.t, ap.key)),
          h("div.row.wrap", propTag(ap.prop), auditTag(ap.audit)),
          h("div.row.wrap", h("button.mini.primary", { on: { click: () => call("apose", { action: "ok" }, tt("Pose en A validée : les prochaines poses partent sur fond de couleur.")) } }, tt("✓ Valider")),
            color, h("button.mini", { on: { click: make } }, tt("↻ Refaire")),
            h("button.mini.danger", { on: { click: () => call("apose", { action: "drop" }) } }, tt("Abandonner"))));
        else {
          keyBox.append(h("h4", tt("Fond de couleur")),
            h("div.row.wrap", { style: "gap: 12px; align-items: center;" }, ap.base ? pair(tt("la référence"), ap.base, ap.base_cut, ap.t, ap.key, 90) : h("img", { src: `/bank/${id}/${ap.cut}?t=${ap.t || 0}`, style: "height: 90px; " + damier }),
              h("span.muted", tt`Fond ${ap.key} validé : les nouvelles poses partent de ton dessin sur ce fond (la pose en A n'est qu'un contrôle), et leurs vues et leurs orbites le gardent. Les poses déjà faites ne changent pas.`),
              color, h("button.mini", { on: { click: make } }, tt("↻ Refaire la pose en A")),
              h("button.mini.danger", { title: tt("Les prochaines poses repassent par le détourage habituel ; celles déjà faites restent"), on: { click: () => { if (confirm(tt("Revenir au détourage habituel pour cet élément ?"))) call("apose", { action: "drop" }); } } }, tt("Désactiver"))));
          // vues d'une pose (dos, profil, 3/4 dos) sur le fond de couleur : vues avant son orbite
          const names = { dos: "dos", profil: "profil", "trois-quarts-dos": "3/4 dos" };
          const keyed = Object.entries(item.variants).filter(([, vv]) => vv.keyimg && !vv.review);
          const cards = keyed.filter(([k, vv]) => (vv.views && vv.views.state === "pending") || running("item_views", k) || !vv.sheet).map(([k, vv]) => {
            const busy = running("item_views", k), wait = vv.views && vv.views.state === "pending";
            return h("div.rev", { style: "grid-column: 1 / -1;" }, h("div.var-name", tr(vv.label)),
              h("div.row.wrap", { style: "gap: 8px;" }, pic(vv.keyimg, tt("la pose"), vv.t), ...(wait ? Object.entries(vv.sheet || {}).map(([n, rel]) => h("div", pic(rel, names[n] || n, vv.views.t), auditTag(((vv.views || {}).audit || {})[n]),
                h("button.mini.danger", { title: tt("Écarter cette vue seulement (un vêtement ajouté, un bras en trop) : l'orbite se fera avec les autres"), on: { click: () => call("review", { variant: k, action: "view_drop", view: n }) } }, tt("✕ écarter")))) : [])),
              ...Object.entries((vv.views || {}).audit || {}).filter(([n]) => wait && !(vv.sheet || {})[n]).map(([n, a]) =>
                h("div.muted", tt`Vue « ${names[n] || n} » écartée par l'intelligence : ${a.raison || (a.defauts || []).join(", ")}`)),
              busy ? h("div.muted", tt("⏳ vues en calcul")) : h("div.rev-acts",
                wait ? h("button.mini.primary", { title: tt("Les vues sont bonnes (rien d'ajouté, bon nombre de bras, du volume) : l'orbite part en file"), on: { click: () => call("review", { variant: k, action: "views_ok" }, tt("Orbite en file.")) } }, tt("✓ Valider les vues")) : null,
                h("button.mini", { title: tt("Trois images payantes : dos, profil, trois-quarts dos"), on: { click: () => call(wait ? "review" : "views", wait ? { variant: k, action: "views_redo" } : { variant: k }, tt("Vues demandées (3 images).")) } }, wait ? tt("↻ Refaire les vues") : tt("Faire les vues"))));
          });
          if (cards.length) keyBox.append(h("h4", tt("Vues à valider avant l'orbite")),
            h("p.muted", tt("Chaque pose a ses vues de dos et de profil, sur le même fond. Regarde-les : un vêtement ajouté, un bras en trop ou un profil plat se retrouverait dans l'orbite.")),
            h("div.revgrid", cards));
        }
      }
      // poses a valider : generees et detourees, leur orbite attend « Garder » (reglage « attendre ma validation »)
      reviewBox.textContent = "";
      const rev = Object.entries(item.variants).filter(([k, vv]) => k !== "base" && vv.review);
      if (rev.length) {
        const busyOf = (k) => app.jobs.filter((j) => (j.status === "queued" || j.status === "running") && j.params.item === id && j.params.variant === k).length;
        const act = async (k, action) => {
          try { const r = await post(`bank/${id}/review`, { variant: k, action, target: target() });
            if (action !== "redo") toast(tt`${r.jobs.length} orbite(s) en file.`); await this.reload(); app.pollSoon(); }
          catch (err) { toast(err.message, "error"); }
        };
        const drop = async (k, vv) => {
          if (!confirm(tt`Jeter la pose « ${tr(vv.label)} » ?`)) return;
          try { await del(`bank/${id}/variant/${k}`); if (vid === k) vid = "base"; await this.reload(); } catch (err) { toast(err.message, "error"); }
        };
        const card = ([k, vv]) => {
          const st = vv.review.state, sc = vv.review.score, busy = busyOf(k);
          return h("div.rev" + (st === "rejected" ? ".bad" : "") + (k === vid ? ".on" : ""),
            h("img", { src: this.thumb(item, k), loading: "lazy", draggable: false, title: tt("Voir cette pose en grand"), on: { click: () => { vid = k; frame = 0; build(true); } } }),
            h("div.var-name", tr(vv.label)),
            sc != null ? h("div.rev-score" + (sc < 0.85 ? ".warn" : ""), { title: tt("Ressemblance du visage avec le dessin d'origine (1 = identique). Sous 0,85, un dessin au trait est écarté ; pour les autres styles (lavis, couleur), c'est un signalement : regarde le visage.") }, sc < 0.85 && item.style !== "dessin" ? tt`visage à vérifier (${sc.toFixed(2)})` : tt`fidélité ${sc.toFixed(2)}`) : null,
            vv.review.line != null ? h("div.rev-score" + (vv.review.line < 0.72 || vv.review.line > 1.45 ? ".warn" : ""), { title: tt("Épaisseur du trait de la pose par rapport au dessin d'origine, à taille égale (1 = le même trait ; sous 0,72 ou au-dessus de 1,45 la pose est écartée)") }, tt`trait × ${vv.review.line.toFixed(2)}`) : null,
            propTag(vv.review.prop),
            auditTag(vv.review.audit),
            busy ? h("div.muted", tt("⏳ en calcul")) : h("div.rev-acts",
              st === "redo" ? h("div.rev-note", tt("La nouvelle génération n'a pas abouti.")) : null,
              h("button.mini.primary", { title: tt("Garder cette pose : son orbite part en file"), on: { click: () => act(k, "keep") } }, st === "rejected" ? tt("Repêcher") : tt("Garder")),
              h("button.mini", { title: tt("Refaire cette pose (nouvelle génération, autre graine)"), on: { click: () => act(k, "redo") } }, tt("Refaire")),
              h("button.mini.danger", { title: tt("Supprimer cette pose"), on: { click: () => drop(k, vv) } }, tt("Jeter"))));
        };
        // le personnage d'origine, en tete de la grille : chaque pose se compare a lui d'un coup d'oeil
        const refCard = () => h("div.rev.ref", h("img", { src: this.thumb(item, "base"), draggable: false, title: tt("Le personnage d'origine : chaque pose doit avoir le même visage et le même trait") }), h("div.var-name", tt("Référence")));
        const ok = rev.filter(([, vv]) => vv.review.state !== "rejected"), bad = rev.filter(([, vv]) => vv.review.state === "rejected");
        const waiting = ok.filter(([k, vv]) => vv.review.state === "pending" && !busyOf(k));
        reviewBox.append(...[h("h4", tt("Poses à valider")),
          h("p.muted", tt("Les poses sont générées et détourées ; leur orbite ne part que quand tu cliques « Garder ».")),
          waiting.length > 1 ? h("button.mini.primary", { on: { click: () => act(null, "keep_all") } }, tt`✓ Tout garder (${waiting.length})`) : null,
          ok.length ? h("div.revgrid", refCard(), ok.map(card)) : null,
          bad.length ? h("h4", tt("Écartées par le contrôle automatique")) : null,
          bad.length > 1 ? h("button.mini", { title: tt("Toutes les poses écartées passent comme si tu cliquais « Repêcher » sur chacune : leurs vues ou leur orbite partent en file."),
            on: { click: () => { if (confirm(tt`Repêcher les ${bad.length} poses écartées ?\nLeurs vues ou leur orbite partent en file, comme avec « Repêcher » sur chacune.`)) act(null, "keep_rejected"); } } }, tt`↺ Repêcher toutes les écartées (${bad.length})`) : null,
          bad.length ? h("p.muted", tt("Leur visage ressemblait moins au dessin d'origine (fidélité sous 0,85), ou leur trait n'avait pas la même épaisseur. Repêche celles qui te vont, ou refais-les.")) : null,
          bad.length ? h("div.revgrid", ok.length ? null : refCard(), bad.map(card)) : null].filter(Boolean));
      }
      // catalogue de poses
      const cat = app.info.poses[item.kind] || [];
      if (light) {                       // seulement les poses devenues disponibles
        const have = new Set(Object.values(item.variants).map((x) => x.pose));
        poseBox.querySelectorAll("input[data-pose]").forEach((el) => { if (have.has(el.dataset.pose)) { el.checked = el.disabled = true; el.parentElement.classList.add("done"); } });
      } else if (cat.length) {
        poseBox.textContent = "";
        const have = new Set(Object.values(item.variants).map((x) => x.pose));
        const boxes = cat.map((p) => ({ p, el: h("input", { type: "checkbox", "data-pose": p.key, disabled: have.has(p.key), checked: have.has(p.key) }) }));
        const custom = h("input", { type: "text", placeholder: item.kind === "decor" ? tt("Autre ambiance (en anglais de préférence)…") : tt("Autre pose : « leaning on a wall, smoking »…") });
        // estimation avant de lancer : nombre de poses cochees x prix d'une pose (tous ses tirages, au pire)
        const est = h("div.muted.pose-est");
        let estT = 0;
        const estimate = () => { clearTimeout(estT); estT = setTimeout(async () => {
          const n = boxes.filter((b) => b.el.checked && !b.el.disabled).length + (custom.value.trim() ? 1 : 0);
          if (!n) { est.textContent = ""; return; }
          try { const r = await post(`bank/${id}/estimate`, { kind: "item_pose", count: n, target: target() });
            est.textContent = r.estimate > 0 ? tt`Coût estimé : ≈ ${r.estimate.toFixed(2)} $ au pire pour ${n} pose(s) · déjà dépensé ${r.spent.toFixed(2)} $${r.queued > 0 ? tt` (+ ${r.queued.toFixed(2)} $ en file)` : ""} · plafond ${r.cap.toFixed(2)} $`
              : tt`${n} pose(s) : sur tes machines, sans frais fal.`;
            est.classList.toggle("warn", r.spent + r.queued + r.estimate > r.cap); }
          catch (err) { est.textContent = ""; } }, 250); };
        boxes.forEach((b) => b.el.addEventListener("change", estimate)); custom.addEventListener("input", estimate);
        const launch = async (review) => {
          const keys = boxes.filter((b) => b.el.checked && !b.el.disabled).map((b) => b.p.key);
          if (!keys.length && !custom.value.trim()) return toast(tt("Coche au moins une pose."), "error");
          const r = await post(`bank/${id}/prepare`, { orbit: true, review, poses: keys, custom: custom.value.trim() ? [custom.value.trim()] : [], target: target() });
          toast(tt`${r.jobs.length} tâche(s) lancée(s).`); custom.value = ""; app.pollSoon();
        };
        poseBox.append(h("h4", item.kind === "decor" ? tt("Ambiances à générer") : tt("Poses à générer")),
          h("div.tiers", [1, 2, 3].map((t) => h("button.mini", { on: { click: () => { boxes.forEach((b) => { if (!b.el.disabled) b.el.checked = b.p.tier <= t; }); estimate(); } } },
            tr(app.info.poses.tiers[t]))), h("button.mini", { on: { click: () => { boxes.forEach((b) => { if (!b.el.disabled) b.el.checked = false; }); estimate(); } } }, tt("Rien"))),
          h("div.poselist", boxes.map((b) => h("label.check" + (b.el.disabled ? ".done" : ""), b.el, tr(b.p.label)))),
          custom, est,
          h("div.row.wrap.pose-go",
            h("button.primary", { title: tt("Les poses sont générées et détourées, puis attendent : tu gardes, refais ou jettes chacune ; seules celles que tu gardes partent en orbite."), on: { click: () => launch(true) } }, tt("Générer les poses (à valider avant l'orbite)")),
            h("button.mini", { title: tt("Seul le contrôle automatique trie les poses ; l'orbite de chaque pose retenue part tout de suite, sans que tu la voies. À éviter : une pose qui ne ressemble pas au personnage coûte une orbite pour rien."), on: { click: () => { if (confirm(tt("Lancer les orbites sans voir les poses ?\nUne pose qui ne ressemble pas au personnage donnera une orbite à jeter."))) launch(false); } } }, tt("Sans vérifier"))));
        if (item.kind === "character") poseBox.append(this.exprBox(item, id));
      }
      body.querySelector(".acts")?.remove();
      left.append(acts);
      show();
    };
    // fond de controle : sur une couleur vive, les trous du detourage (invisibles sur blanc) sautent aux yeux
    const FONDS = [["", tt("Damier")], ["#ffffff", tt("Blanc")], ["#111111", tt("Noir")], ["#ff2bd6", tt("Magenta")], ["#19d14a", tt("Vert")], ["#f2c230", tt("Jaune")]];
    const setBg = (c) => { stage.style.background = c || ""; localStorage.setItem("bw.ficheFond", c); bgBar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.c === c)); };
    const bgBar = h("div.bgbar", { title: tt("Fond de contrôle : sur une couleur vive, un trou dans le personnage se voit tout de suite. Fais tourner l'orbite pour vérifier chaque angle.") },
      h("span.muted", tt("Fond :")), FONDS.map(([c, l]) => h("button.mini", { "data-c": c, on: { click: () => setBg(c) } }, c ? h("i", { style: { background: c } }) : null, l)));
    setBg(localStorage.getItem("bw.ficheFond") || "");
    const fixBar = h("div.fixbar");
    const left = h("div.item-left", stage, h("div.scrub", playBtn, slider, axisLabel, loadLabel), zoomBar, bgBar, fixBar, snapBar);
    const body = h("div.item", left, h("div.item-right", head, keyBox, reviewBox, h("h4", tt("Variantes")), variants, poseBox));
    const m = modal(tt("Fiche"), body, [{ label: tt("Fermer"), click: () => { this.openId = null; } }]);
    m.box.classList.add("wide");
    this.refreshItem = () => { if (document.body.contains(body)) build(true); else { this.openId = null; } };
    build();
  }
}

// avis de l'intelligence (app/brain.py) sur une image : une etiquette courte, le detail en bulle
const aiWord = (v) => ({ garder: tt("garder"), refaire: tt("à refaire"), ecarter: tt("à écarter") })[v] || v;
function auditTag(a, what = "") {
  if (!a) return null;
  if (!a.final && !a.verdict) return a.erreur ? h("div.rev-score.ai", { title: a.erreur }, tt("IA : pas d'avis")) : null;
  const v = a.final || a.verdict, bad = v !== "garder";
  const lines = [...(a.defauts || []).map((d) => "• " + d), a.reprises ? tt`${a.reprises} reprise(s) automatique(s)` : "",
    (a.non_verifie || []).length ? tt("Pas vérifié : ") + a.non_verifie.join(", ") : "", a.erreur || "", a.modele ? `${a.modele}` : ""].filter(Boolean);
  return h("div.rev-score.ai" + (bad ? ".warn" : ""), { title: lines.join("\n") || tt("Rien à signaler") }, (what ? what + " · " : "") + tt("IA : ") + aiWord(v));
}

// proportions de la caricature (app/proportions.py) : tete dans la hauteur et largeur de tete, rapportees au dessin
function propTag(pr) {
  if (!pr || pr.tete_h == null) return null;
  const pc = (v) => `${Math.round(v * 100)} %`;
  return h("div.rev-score" + (!pr.ok ? ".warn" : ""), { title: tt("Proportions comparées au dessin d'origine sur le même fond : hauteur de la tête dans le personnage, puis largeur de la tête (100 % = identique, ± 8 % toléré). Un simple signalement, mesuré seulement sur les poses debout bras le long du corps ou écartés : il n'écarte jamais une pose. La masse du corps (épaules, bras) se juge à l'œil.") },
    !pr.ok ? tt`proportions à vérifier (tête ${pc(pr.tete_h)} · ${pc(pr.tete_l)})` : tt`tête ${pc(pr.tete_h)} · ${pc(pr.tete_l)}`);
}

function cleanName(f) {
  return f.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}
export { frameToAngle };
