// Banque : personnages, decors, assets. Vignettes a glisser dans les cases, import, generation, fiche d'un element
// (orbite a faire tourner, reperes d'axes, poses a generer).
import { h, get, post, put, del, upload, toast, modal } from "./api.js";
import { sprite, preload, variantOf, AXES, nearestAxis, angleToFrame, frameToAngle } from "./model.js";

const KINDS = [["character", "Personnages"], ["decor", "Décors"], ["asset", "Assets"]];
const STYLES = [["photo", "Photoréaliste"], ["dessin", "Dessin"], ["3d", "3D"]];
const KIND_ONE = { character: "personnage", decor: "décor", asset: "asset" };

export function target() { return localStorage.getItem("bw.target") || "auto"; }

export class Bank {
  constructor(app, host) {
    this.app = app; this.host = host;
    this.tab = localStorage.getItem("bw.tab") || "character";
    this.query = "";
    this.folder = localStorage.getItem("bw.folder") || "";       // "" = tous les dossiers
    host.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); host.classList.add("drop"); } });
    host.addEventListener("dragleave", () => host.classList.remove("drop"));
    host.addEventListener("drop", (e) => {
      host.classList.remove("drop");
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); this.importDialog(files); }
    });
  }

  async reload() {
    const items = await get("bank");
    this.app.bank = new Map(items.map((it) => [it.id, it]));
    this.render();
    if (this.openId && this.refreshItem) this.refreshItem();
  }

  render() {
    const app = this.app, folders = this.folders();
    if (this.folder && this.folder !== "·" && !folders.includes(this.folder)) this.folder = "";
    const inFolder = (it) => !this.folder || (this.folder === "·" ? !it.folder : it.folder === this.folder);
    const items = [...app.bank.values()].filter((it) => it.kind === this.tab && inFolder(it) &&
      (!this.query || (it.name + " " + (it.tags || []).join(" ")).toLowerCase().includes(this.query)));
    const pick = h("input", { type: "file", accept: "image/*", multiple: true, style: { display: "none" },
                              on: { change: (e) => { if (e.target.files.length) this.importDialog([...e.target.files]); e.target.value = ""; } } });
    const grid = h("div.bank-grid", items.map((it) => this.card(it)));
    if (!items.length) grid.append(h("p.muted.bank-empty", `Aucun ${KIND_ONE[this.tab]} pour l'instant. Glisse des images ici, ou « Générer ».`));
    const search = h("input.search", { type: "search", placeholder: "Chercher…", value: this.query,
                                       on: { input: (e) => { this.query = e.target.value.toLowerCase(); this.renderGrid(); } } });
    const folderSel = h("select.folder", { title: "Dossier de la banque (un par projet, par exemple)",
      on: { change: (e) => { this.folder = e.target.value; localStorage.setItem("bw.folder", this.folder); this.render(); } } },
      h("option", { value: "" }, "Tous les dossiers"), folders.map((f) => h("option", { value: f, selected: f === this.folder }, "📁 " + f)),
      h("option", { value: "·", selected: this.folder === "·" }, "Sans dossier"));
    this.host.textContent = "";
    this.host.append(
      h("div.tabs", KINDS.map(([k, label]) => h("button" + (k === this.tab ? ".on" : ""), {
        on: { click: () => { this.tab = k; localStorage.setItem("bw.tab", k); this.render(); } } },
        label, h("span.count", String([...app.bank.values()].filter((x) => x.kind === k && inFolder(x)).length))))),
      h("div.bank-bar", folderSel),
      h("div.bank-bar", search, h("button.mini", { title: "Importer des images", on: { click: () => pick.click() } }, "＋ Importer"),
        h("button.mini", { title: "Générer à partir d'une description", on: { click: () => this.generateDialog() } }, "✨ Générer"), pick),
      grid);
    this.grid = grid;
  }
  folders() { return [...new Set([...this.app.bank.values()].map((it) => it.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")); }
  folderInput(value) {                // champ « dossier » avec les dossiers existants en suggestion
    const id = "bwf" + Math.random().toString(36).slice(2, 7);
    return h("span.fin", h("input", { type: "text", value: value || "", placeholder: "Dossier (projet)…", list: id }),
      h("datalist", { id }, this.folders().map((f) => h("option", { value: f }))));
  }
  renderGrid() {
    const q = this.query;
    for (const c of this.grid.children) if (c.dataset.name) c.style.display = !q || c.dataset.name.includes(q) ? "" : "none";
  }

  thumb(it, vid = "base") {
    const v = variantOf(it, vid);
    if (!v) return "";
    if (v.orbit) return sprite(it, vid, 0).url;
    if (v.cut) return `/bank/${it.id}/${v.cut}?t=${v.t || 0}`;
    return `/bank/${it.id}/${v.ref}`;
  }

  card(it) {
    const vs = Object.values(it.variants || {}), orbits = vs.filter((v) => v.orbit).length;
    const busy = this.app.jobsFor(it.id);
    const c = h("div.card." + it.kind, { draggable: true, title: it.name + " : glisser dans une case, cliquer pour la fiche",
      "data-name": (it.name + " " + (it.tags || []).join(" ")).toLowerCase(),
      on: {
        dragstart: (e) => { e.dataTransfer.setData("application/x-bw-item", JSON.stringify({ id: it.id, v: "base" })); e.dataTransfer.effectAllowed = "copy"; },
        click: () => this.openItem(it.id),
      } },
      h("img", { src: this.thumb(it), loading: "lazy", draggable: false, alt: "" }),
      h("div.card-name", it.name),
      h("div.card-meta", orbits ? h("span.b.ok", { title: "orbites prêtes" }, "↻ " + orbits) : h("span.b", "fixe"),
        vs.length > 1 ? h("span.b", vs.length - 1 + " var.") : null,
        busy ? h("span.b.busy", { title: "en calcul" }, "⏳ " + busy) : null));
    return c;
  }

  // ---------------------------------------------------------------- import
  importDialog(files) {
    const kind = h("select", KINDS.map(([k, l]) => h("option", { value: k, selected: k === this.tab }, l)));
    const style = h("select", STYLES.map(([k, l]) => h("option", { value: k }, l)));
    const facing = h("select", AXES.map((a) => h("option", { value: a, selected: a === "3/4 face gauche" && false }, a)));
    const name = h("input", { type: "text", value: files.length === 1 ? cleanName(files[0].name) : "", placeholder: files.length > 1 ? "(nom de chaque fichier)" : "Nom" });
    const orbit = h("input", { type: "checkbox", checked: true });
    const folder = this.folderInput(this.folder && this.folder !== "·" ? this.folder : "");
    const tier = h("select", h("option", { value: 0 }, "Aucune pose pour l'instant"), h("option", { value: 1 }, "Poses essentielles (7)"),
                   h("option", { value: 2 }, "Poses complètes (16)"), h("option", { value: 3 }, "Toutes les poses (26)"));
    const tierRow = h("label.row", "Poses à générer", tier);
    const sync = () => { tierRow.style.display = kind.value === "character" ? "" : "none"; };
    kind.addEventListener("change", sync); sync();
    modal(`Ajouter à la banque (${files.length} image${files.length > 1 ? "s" : ""})`, h("div.form",
      h("div.previews", files.slice(0, 8).map((f) => h("img", { src: URL.createObjectURL(f) }))),
      h("label.row", "Type", kind), h("label.row", "Nom", name), h("label.row", "Dossier", folder), h("label.row", "Rendu", style),
      h("label.row", "L'image montre le sujet de", facing),
      h("label.row.check", orbit, "Générer l'orbite 360° (≈ 3 min par machine)"), tierRow,
      h("p.muted", "Le mieux : un seul sujet, entier, sur un fond simple. L'orbite est détourée image par image.")),
      [{ label: "Annuler" }, { label: "Ajouter", primary: true, click: async () => {
        const keys = this.app.info.poses.character.filter((p) => p.tier <= +tier.value).map((p) => p.key);
        for (const f of files) {
          const q = new URLSearchParams({ kind: kind.value, name: files.length === 1 ? (name.value || cleanName(f.name)) : cleanName(f.name),
                                          style: style.value, facing: facing.value, orbit: orbit.checked ? "1" : "0", target: target(), file: f.name,
                                          folder: folder.querySelector("input").value.trim() });
          try {
            const it = await upload("bank?" + q, f);
            if (kind.value === "character" && keys.length) await post(`bank/${it.id}/prepare`, { orbit: orbit.checked, poses: keys, target: target() });
          } catch (err) { toast(`${f.name} : ${err.message}`, "error"); }
        }
        this.tab = kind.value;
        await this.reload(); this.app.pollSoon();
      } }]);
  }

  generateDialog() {
    const kind = h("select", KINDS.map(([k, l]) => h("option", { value: k, selected: k === this.tab }, l)));
    const style = h("select", STYLES.map(([k, l]) => h("option", { value: k }, l)));
    const name = h("input", { type: "text", placeholder: "Nom dans la banque" });
    const prompt = h("textarea", { rows: 4, placeholder: "Un marteau de charpentier usé, manche en bois…" });
    const orbit = h("input", { type: "checkbox", checked: true });
    const folder = this.folderInput(this.folder && this.folder !== "·" ? this.folder : "");
    modal("Générer un élément", h("div.form", h("label.row", "Type", kind), h("label.row", "Nom", name), h("label.row", "Dossier", folder), h("label.row", "Rendu", style),
      h("label.col", "Description", prompt), h("label.row.check", orbit, "Puis son orbite 360°")),
      [{ label: "Annuler" }, { label: "Générer", primary: true, click: async () => {
        if (!prompt.value.trim()) { toast("Décris ce qu'il faut générer.", "error"); return false; }
        await post("bank/generate", { kind: kind.value, name: name.value.trim() || prompt.value.trim().slice(0, 30), prompt: prompt.value.trim(),
                                      style: style.value, orbit: orbit.checked, target: target(), folder: folder.querySelector("input").value.trim() });
        toast("Génération lancée : l'élément apparaîtra dans la banque."); this.app.pollSoon();
      } }]);
  }

  // ---------------------------------------------------------------- fiche d'un element
  openItem(id) {
    const app = this.app;
    this.openId = id;
    let vid = "base", frame = 0;
    const it = () => app.bank.get(id);
    const stage = h("div.stage"), img = h("img", { draggable: false, alt: "" });
    const slider = h("input", { type: "range", min: 0, max: 0, value: 0 });
    const axisLabel = h("span.muted");
    const snapBar = h("div.snapbar");
    const variants = h("div.variants");
    const poseBox = h("div.posebox");
    const head = h("div.item-head");
    stage.append(img);
    const show = () => {
      const item = it(), v = variantOf(item, vid);
      if (!item || !v) return;
      const sp = sprite(item, vid, frame);
      img.src = sp.url;
      slider.max = Math.max(0, sp.n - 1); slider.value = sp.i; slider.disabled = sp.n < 2;
      axisLabel.textContent = v.orbit ? `image ${sp.i + 1}/${sp.n} · ${nearestAxis(v.orbit, sp.i)}` : (v.cut ? "image fixe détourée" : "image d'origine (pas encore détourée)");
    };
    slider.addEventListener("input", () => { frame = +slider.value; show(); });
    let drag = null;
    stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, f: frame }; stage.setPointerCapture(e.pointerId); e.preventDefault(); });
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
      const fold = this.folderInput(item.folder);
      fold.querySelector("input").addEventListener("change", async (e) => { await put("bank/" + id, { folder: e.target.value.trim() }); this.reload(); });
      head.append(h("label.row", "Nom", nameIn), h("label.row", "Dossier", fold), h("label.row", "Rendu", styleIn));
      }
      // reperes d'axes
      snapBar.textContent = "";
      if (v.orbit) {
        snapBar.append(h("span.muted", "Aller à :"), ...AXES.map((a) => h("button.mini", { title: "Afficher cet axe",
          on: { click: () => { frame = v.orbit.snaps?.[a] ?? angleToFrame(v.orbit, AXES.indexOf(a) * 45); show(); } } }, a)));
        const tag = h("select", h("option", { value: "" }, "Cette image est…"), AXES.map((a) => h("option", { value: a }, a)));
        tag.addEventListener("change", async () => {
          if (!tag.value) return;
          const snaps = Object.assign({}, v.orbit.snaps); snaps[tag.value] = frame;
          await post(`bank/${id}/snaps`, { variant: vid, snaps });
          toast(`Repère « ${tag.value} » posé sur l'image ${frame + 1}.`); await this.reload();
        });
        snapBar.append(tag);
      }
      // variantes
      variants.textContent = "";
      for (const [k, vv] of Object.entries(item.variants)) {
        const busy = app.jobsFor(id, k);
        variants.append(h("div.var" + (k === vid ? ".on" : ""), { draggable: true, title: vv.label + " : cliquer pour voir, glisser dans une case",
          on: { click: () => { vid = k; frame = 0; build(true); },
                dragstart: (e) => { e.dataTransfer.setData("application/x-bw-item", JSON.stringify({ id, v: k })); } } },
          h("img", { src: this.thumb(item, k), draggable: false, loading: "lazy" }), h("div.var-name", vv.label),
          h("div.card-meta", vv.orbit ? h("span.b.ok", "↻") : h("span.b", "fixe"), busy ? h("span.b.busy", "⏳") : null)));
      }
      // actions sur la variante
      const acts = h("div.acts",
        h("button.mini", { on: { click: async () => { await post(`bank/${id}/orbit`, { variant: vid, seed: Math.floor(Math.random() * 1e6), target: target() });
          toast("Orbite relancée avec une autre graine."); app.pollSoon(); } } }, v.orbit ? "↻ Refaire l'orbite" : "↻ Générer l'orbite"),
        item.kind !== "decor" ? h("button.mini", { on: { click: async () => { await post(`bank/${id}/cut`, { variant: vid, target: target() }); app.pollSoon(); } } }, "✂ Refaire le détourage") : null,
        vid !== "base" ? h("button.mini.danger", { on: { click: async () => { await del(`bank/${id}/variant/${vid}`); vid = "base"; await this.reload(); } } }, "Supprimer cette variante") : null,
        h("button.mini.danger", { on: { click: async () => { if (!confirm(`Retirer « ${item.name} » de la banque ? (il part à la corbeille du dossier de données)`)) return;
          await del("bank/" + id); m.close(); this.openId = null; this.reload(); } } }, "Retirer de la banque"));
      // catalogue de poses
      const cat = app.info.poses[item.kind] || [];
      if (light) {                       // seulement les poses devenues disponibles
        const have = new Set(Object.values(item.variants).map((x) => x.pose));
        poseBox.querySelectorAll("input[data-pose]").forEach((el) => { if (have.has(el.dataset.pose)) { el.checked = el.disabled = true; el.parentElement.classList.add("done"); } });
      } else if (cat.length) {
        poseBox.textContent = "";
        const have = new Set(Object.values(item.variants).map((x) => x.pose));
        const boxes = cat.map((p) => ({ p, el: h("input", { type: "checkbox", "data-pose": p.key, disabled: have.has(p.key), checked: have.has(p.key) }) }));
        const custom = h("input", { type: "text", placeholder: item.kind === "decor" ? "Autre ambiance (en anglais de préférence)…" : "Autre pose : « leaning on a wall, smoking »…" });
        const orbit = h("input", { type: "checkbox", checked: true });
        poseBox.append(h("h4", item.kind === "decor" ? "Ambiances à générer" : "Poses à générer"),
          h("div.tiers", [1, 2, 3].map((t) => h("button.mini", { on: { click: () => boxes.forEach((b) => { if (!b.el.disabled) b.el.checked = b.p.tier <= t; }) } },
            app.info.poses.tiers[t])), h("button.mini", { on: { click: () => boxes.forEach((b) => { if (!b.el.disabled) b.el.checked = false; }) } }, "Rien")),
          h("div.poselist", boxes.map((b) => h("label.check" + (b.el.disabled ? ".done" : ""), b.el, b.p.label))),
          custom, h("label.row.check", orbit, "Avec l'orbite 360° de chaque pose"),
          h("button.primary", { on: { click: async () => {
            const keys = boxes.filter((b) => b.el.checked && !b.el.disabled).map((b) => b.p.key);
            if (!keys.length && !custom.value.trim()) return toast("Coche au moins une pose.", "error");
            const r = await post(`bank/${id}/prepare`, { orbit: orbit.checked, poses: keys, custom: custom.value.trim() ? [custom.value.trim()] : [], target: target() });
            toast(`${r.jobs.length} tâche(s) lancée(s).`); custom.value = ""; app.pollSoon();
          } } }, "Générer la sélection"));
      }
      body.querySelector(".acts")?.remove();
      left.append(acts);
      show();
    };
    const left = h("div.item-left", stage, h("div.scrub", slider, axisLabel), snapBar);
    const body = h("div.item", left, h("div.item-right", head, h("h4", "Variantes"), variants, poseBox));
    const m = modal("Fiche", body, [{ label: "Fermer", click: () => { this.openId = null; } }]);
    m.box.classList.add("wide");
    this.refreshItem = () => { if (document.body.contains(body)) build(true); else { this.openId = null; } };
    build();
  }
}

function cleanName(f) {
  return f.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}
export { frameToAngle };
