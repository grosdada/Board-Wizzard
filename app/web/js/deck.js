// Deck de montage global (maquette) : les cases animees envoyees depuis le mode montage, mises bout a bout.
// project.decks = [{ id, name, clips }] : plusieurs decks par storyboard. Un deck = { clips: [{ id, page (id de la page), panel (id de la case), in, out }] }. in et out (secondes dans le
// montage de la case) raccourcissent le plan par ses deux bouts ; sans eux, le plan dure tout son montage.
import { tt, tr } from "./i18n.js";
import { h, modal, toast } from "./api.js";
import { makeScene } from "./montage.js";
import { W } from "./draw.js";
import { compute } from "./geometry.js";

const f1 = (n) => (+n).toFixed(1);
const uid = () => Math.random().toString(36).slice(2, 8);
const MIN = 0.2;                                         // duree minimale d'un plan raccourci, en secondes

export function openDeck(app, deckId) {
  const project = app.project, deck = app.deckOf(deckId);
  project.deckCur = deck.id;                              // les prochains envois vont dans ce deck
  let sel = 0, T = 0, playing = false, raf = 0, last = 0, scenes = [];
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "mt-stage dk-stage");
  const track = h("div.dk-track"), clock = h("span.mt-clock"), info = h("div.dk-info");
  const playBtn = h("button.mini.mt-play", { on: { click: () => (playing ? stop() : play()) } }, tt("▶ Lecture"));

  function build() {                                       // une scene par plan ; les cases disparues sont signalees
    scenes = deck.clips.map((c, i) => {
      const pg = project.pages.find((p) => p.id === c.page), pan = pg && pg.panels[c.panel];
      if (!pan) return { missing: true, dur: 1, label: tt("case supprimée") };
      const geo = compute(pg.page, pg.layout).panels.find((g) => g.id === c.panel);
      if (!geo) return { missing: true, dur: 1, label: tt("case supprimée") };
      const sc = makeScene(app, pg, JSON.parse(JSON.stringify(pan)), geo.bbox.h / geo.bbox.w, "dk" + i);
      const pageNo = project.pages.indexOf(pg) + 1;
      const src = (pan.anim && pan.anim.dur) || 4, a = Math.max(0, Math.min(c.in ?? 0, src - MIN)), b = Math.max(a + MIN, Math.min(c.out ?? src, src));
      return Object.assign(sc, { src, in: a, out: b, dur: b - a, still: !pan.anim, label: tt`Page ${pageNo} · case ${geo.order}`, pageIndex: pageNo - 1, panel: c.panel });
    });
  }
  const total = () => scenes.reduce((n, s) => n + s.dur, 0);
  const sub = (s) => `${s.dur.toFixed(1)} s` + (s.missing ? "" : s.dur < s.src - 0.01 ? tt` sur ${s.src.toFixed(1)} · de ${s.in.toFixed(1)} à ${s.out.toFixed(1)}` : "") + (s.still ? tt(" · sans animation") : "");
  const locate = (x) => { let a = 0; for (let i = 0; i < scenes.length; i++) { if (x < a + scenes[i].dur || i === scenes.length - 1) return [i, Math.min(x - a, scenes[i].dur)]; a += scenes[i].dur; } return [0, 0]; };
  const startOf = (i) => scenes.slice(0, i).reduce((n, s) => n + s.dur, 0);

  function paint() {
    if (!scenes.length) { svg.setAttribute("viewBox", "0 0 1000 600"); svg.innerHTML = tt`<rect width="1000" height="600" fill="#1c1e1f"/><text x="500" y="300" text-anchor="middle" fill="#8b9392" font-size="26">Le deck est vide</text>`; return; }
    const [i, t] = locate(T), s = scenes[i];
    if (s.missing) { svg.setAttribute("viewBox", "0 0 1000 600"); svg.innerHTML = tt`<rect width="1000" height="600" fill="#1c1e1f"/><text x="500" y="300" text-anchor="middle" fill="#d6736b" font-size="26">Cette case n'existe plus</text>`; return; }
    svg.setAttribute("viewBox", `0 0 ${W} ${f1(s.H)}`);
    svg.innerHTML = s.markup(s.in + t, null, paint);
  }
  function strip() {
    track.textContent = "";
    const tot = Math.max(0.1, total());
    scenes.forEach((s, i) => {
      const move = (d) => { const j = i + d; if (j < 0 || j >= deck.clips.length) return; const c = deck.clips.splice(i, 1)[0]; deck.clips.splice(j, 0, c); sel = j; changed(); };
      track.append(h("div.dk-clip" + (i === sel ? ".on" : "") + (s.missing ? ".missing" : ""), { style: `flex:${s.dur} 1 0`, title: `${s.label} · ${s.dur.toFixed(1)} s`, on: { click: (e) => { if (e.target.closest(".dk-h")) return; stop(); sel = i; T = startOf(i); refresh(); } } },
        s.missing ? "" : h("span.dk-h.l", { title: tt("Glisser pour raccourcir le début du plan"), "data-trim": "in", "data-i": i }),
        s.missing ? "" : h("span.dk-h.r", { title: tt("Glisser pour raccourcir la fin du plan"), "data-trim": "out", "data-i": i }),
        h("div.dk-name", `${i + 1}. ${s.label}`), h("div.dk-sub", sub(s)),
        h("div.dk-acts", h("button", { title: tt("Plus tôt"), on: { click: (e) => { e.stopPropagation(); move(-1); } } }, "◀"),
          h("button", { title: tt("Plus tard"), on: { click: (e) => { e.stopPropagation(); move(1); } } }, "▶"),
          h("button", { title: tt("Retirer du deck (la case et son montage restent)"), on: { click: (e) => { e.stopPropagation(); deck.clips.splice(i, 1); sel = Math.max(0, Math.min(sel, deck.clips.length - 1)); changed(); } } }, "✕"))));
    });
    if (!scenes.length) track.append(h("p.muted.dk-empty", tt("Aucun plan. Ouvre une case en « Mode montage » puis « Enregistrer et envoyer dans le deck ».")));
    else track.append(h("div.mt-head", { style: `left:${(T / tot * 100).toFixed(3)}%` }));
    clock.textContent = `${T.toFixed(2)} s / ${total().toFixed(1)} s`;
    info.textContent = "";
    const s = scenes[sel];
    if (s && !s.missing) info.append(h("span.muted", tt`Plan ${sel + 1} : ${s.label}`),
      h("button.mini", { title: tt("Ferme le deck et ouvre le montage de cette case"), on: { click: () => { done(); m.close(); app.openPanelMontage(s.pageIndex, s.panel); } } }, tt("🎬 Ouvrir son montage")));
  }
  const head = () => { const hd = track.querySelector(".mt-head"); if (hd) hd.style.left = (T / Math.max(0.1, total()) * 100).toFixed(3) + "%"; clock.textContent = `${T.toFixed(2)} s / ${total().toFixed(1)} s`; };
  const refresh = () => { paint(); strip(); };
  const changed = () => { app.commit("deck"); build(); T = Math.min(T, total()); refresh(); };
  function tick(now) {
    if (!playing) return;
    T += (now - last) / 1000; last = now;
    if (T >= total()) { T = 0; }
    const i = locate(T)[0];
    if (i !== sel) { sel = i; strip(); }
    paint(); head();
    raf = requestAnimationFrame(tick);
  }
  function play() { if (!scenes.length) return; playing = true; playBtn.textContent = tt("⏸ Pause"); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { if (!playing) return; playing = false; cancelAnimationFrame(raf); playBtn.textContent = tt("▶ Lecture"); refresh(); }
  // poignees : on raccourcit un plan par le debut ou par la fin, a l'interieur de son montage
  let trim = null;
  track.addEventListener("pointerdown", (e) => {
    const hd = e.target.closest(".dk-h");
    if (!hd) return;
    e.stopPropagation(); e.preventDefault(); stop();
    const i = +hd.dataset.i, sc = scenes[i], r = track.getBoundingClientRect();
    trim = { i, side: hd.dataset.trim, x: e.clientX, in0: sc.in, out0: sc.out, pps: r.width / Math.max(0.1, total()), el: hd.closest(".dk-clip") };
    sel = i;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
  }, true);
  track.addEventListener("pointermove", (e) => {
    if (!trim) return;
    const sc = scenes[trim.i], d = (e.clientX - trim.x) / trim.pps;
    if (trim.side === "in") sc.in = Math.max(0, Math.min(trim.in0 + d, sc.out - MIN));
    else sc.out = Math.max(sc.in + MIN, Math.min(trim.out0 + d, sc.src));
    sc.dur = sc.out - sc.in;
    trim.el.style.flex = `${sc.dur} 1 0`;
    trim.el.querySelector(".dk-sub").textContent = sub(sc);
    T = startOf(trim.i) + (trim.side === "in" ? 0 : Math.max(0, sc.dur - 0.001));   // on voit l'image ou le plan commence, ou finit
    paint(); head();
  });
  const endTrim = () => {
    if (!trim) return;
    const sc = scenes[trim.i], c = deck.clips[trim.i];
    c.in = +sc.in.toFixed(3); c.out = +sc.out.toFixed(3);
    if (c.in < 0.005) delete c.in;
    if (c.out > sc.src - 0.005) delete c.out;
    trim = null; changed();
  };
  track.addEventListener("pointerup", endTrim);
  track.addEventListener("pointercancel", endTrim);
  track.addEventListener("pointerdown", (e) => {            // clic dans la bande : on se place a cet instant
    if (e.target.closest("button") || e.target.closest(".dk-h") || !scenes.length) return;
    const r = track.getBoundingClientRect();
    stop(); T = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total(); sel = locate(T)[0]; refresh();
  });
  const key = (e) => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return; if (e.key === " ") { e.preventDefault(); e.stopPropagation(); playing ? stop() : play(); } };
  document.addEventListener("keydown", key, true);
  const done = () => { playing = false; cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); };
  const fullBtn = h("button.mini", { on: { click: () => { const on = m.box.classList.toggle("modal-full"); fullBtn.textContent = on ? tt("🗗 Fenêtre") : tt("⛶ Plein écran"); } } }, tt("⛶ Plein écran"));
  build(); refresh();
  const name = h("input.dk-title", { type: "text", value: deck.name, title: tt("Nom du deck"), on: { change: (e) => { deck.name = e.target.value.trim() || deck.name; e.target.value = deck.name; app.commit("deck"); app.refreshTop(); } } });
  const head2 = h("div.mt-bar", h("span.muted", tt("Deck :")), name,
    h("button.mini", { title: tt("Enregistre une copie de ce deck sous un autre nom, et l'ouvre"), on: { click: () => { const n = (prompt(tt("Nom de la copie :"), deck.name + tt(" (copie)")) || "").trim(); if (!n) return; const c = app.newDeck(n, JSON.parse(JSON.stringify(deck.clips))); done(); m.close(); openDeck(app, c.id); } } }, tt("Enregistrer sous…")),
    h("button.mini.danger", { title: tt("Supprime ce deck (les cases et leurs montages restent)"), on: { click: () => { if (!confirm(tt`Supprimer le deck « ${deck.name} » ?`)) return; project.decks = project.decks.filter((d) => d !== deck); if (project.deckCur === deck.id) delete project.deckCur; app.commit("deck"); app.refreshTop(); done(); m.close(); toast(tt("Deck supprimé.")); } } }, tt("Supprimer ce deck")),
    h("span.muted", tt("Chaque changement est enregistré tout seul avec le storyboard.")));
  const m = modal(tt("Deck de montage"), h("div.mt-editor.dk-editor", head2, h("div.mt-view", svg),
    h("div.mt-bar", h("button.mini", { title: tt("Revenir au début"), on: { click: () => { stop(); T = 0; sel = 0; refresh(); } } }, "⏮"), playBtn, clock, info), track,
    h("p.muted", tt("Maquette : les plans s'enchaînent en coupe franche, dans l'ordre de la bande. Les poignées aux deux bouts d'un plan le raccourcissent. Pas encore de transitions, de son ni d'export vidéo."))),
    [{ label: tt("Fermer"), primary: true, click: done }]);
  m.box.classList.add("modal-wide", "modal-montage");
  { const hd = m.box.querySelector("header"); fullBtn.classList.add("head-full"); hd.insertBefore(fullBtn, hd.querySelector("button.icon")); }   // plein ecran : en haut a droite, a cote de la croix
  return m;
}

/** Ajoute une case au deck en cours du storyboard (le dernier ouvert, ou le premier, ou un deck neuf). */
export function addClip(app, pid) {
  const deck = app.deckOf();
  deck.clips.push({ id: uid(), page: app.page().id, panel: pid });
  app.commit("deck");
  toast(tt`Case envoyée dans « ${deck.name} » (${deck.clips.length} plan${deck.clips.length > 1 ? "s" : ""}).`);
}
