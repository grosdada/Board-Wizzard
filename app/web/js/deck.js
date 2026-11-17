// Deck de montage global (maquette) : les cases animees envoyees depuis le mode montage, mises bout a bout.
// project.deck = { clips: [{ id, page (id de la page), panel (id de la case) }] }. La duree d'un plan est celle de son
// montage ; le deck ne garde que l'ordre.
import { h, modal, toast } from "./api.js";
import { makeScene } from "./montage.js";
import { W } from "./draw.js";
import { compute } from "./geometry.js";

const f1 = (n) => (+n).toFixed(1);
const uid = () => Math.random().toString(36).slice(2, 8);

export function openDeck(app) {
  const project = app.project, deck = project.deck || (project.deck = { clips: [] });
  let sel = 0, T = 0, playing = false, raf = 0, last = 0, scenes = [];
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "mt-stage dk-stage");
  const track = h("div.dk-track"), clock = h("span.mt-clock"), info = h("div.dk-info");
  const playBtn = h("button.mini.mt-play", { on: { click: () => (playing ? stop() : play()) } }, "▶ Lecture");

  function build() {                                       // une scene par plan ; les cases disparues sont signalees
    scenes = deck.clips.map((c, i) => {
      const pg = project.pages.find((p) => p.id === c.page), pan = pg && pg.panels[c.panel];
      if (!pan) return { missing: true, dur: 1, label: "case supprimée" };
      const geo = compute(pg.page, pg.layout).panels.find((g) => g.id === c.panel);
      if (!geo) return { missing: true, dur: 1, label: "case supprimée" };
      const sc = makeScene(app, pg, JSON.parse(JSON.stringify(pan)), geo.bbox.h / geo.bbox.w, "dk" + i);
      const pageNo = project.pages.indexOf(pg) + 1;
      return Object.assign(sc, { dur: (pan.anim && pan.anim.dur) || 4, still: !pan.anim, label: `Page ${pageNo} · case ${geo.order}`, pageIndex: pageNo - 1, panel: c.panel });
    });
  }
  const total = () => scenes.reduce((n, s) => n + s.dur, 0);
  const locate = (x) => { let a = 0; for (let i = 0; i < scenes.length; i++) { if (x < a + scenes[i].dur || i === scenes.length - 1) return [i, Math.min(x - a, scenes[i].dur)]; a += scenes[i].dur; } return [0, 0]; };
  const startOf = (i) => scenes.slice(0, i).reduce((n, s) => n + s.dur, 0);

  function paint() {
    if (!scenes.length) { svg.setAttribute("viewBox", "0 0 1000 600"); svg.innerHTML = `<rect width="1000" height="600" fill="#1c1e1f"/><text x="500" y="300" text-anchor="middle" fill="#8b9392" font-size="26">Le deck est vide</text>`; return; }
    const [i, t] = locate(T), s = scenes[i];
    if (s.missing) { svg.setAttribute("viewBox", "0 0 1000 600"); svg.innerHTML = `<rect width="1000" height="600" fill="#1c1e1f"/><text x="500" y="300" text-anchor="middle" fill="#d6736b" font-size="26">Cette case n'existe plus</text>`; return; }
    svg.setAttribute("viewBox", `0 0 ${W} ${f1(s.H)}`);
    svg.innerHTML = s.markup(t, null, paint);
  }
  function strip() {
    track.textContent = "";
    const tot = Math.max(0.1, total());
    scenes.forEach((s, i) => {
      const move = (d) => { const j = i + d; if (j < 0 || j >= deck.clips.length) return; const c = deck.clips.splice(i, 1)[0]; deck.clips.splice(j, 0, c); sel = j; changed(); };
      track.append(h("div.dk-clip" + (i === sel ? ".on" : "") + (s.missing ? ".missing" : ""), { style: `flex:${s.dur} 1 0`, title: `${s.label} · ${s.dur} s`, on: { click: () => { stop(); sel = i; T = startOf(i); refresh(); } } },
        h("div.dk-name", `${i + 1}. ${s.label}`), h("div.dk-sub", `${s.dur.toFixed(1)} s${s.still ? " · sans animation" : ""}`),
        h("div.dk-acts", h("button", { title: "Plus tôt", on: { click: (e) => { e.stopPropagation(); move(-1); } } }, "◀"),
          h("button", { title: "Plus tard", on: { click: (e) => { e.stopPropagation(); move(1); } } }, "▶"),
          h("button", { title: "Retirer du deck (la case et son montage restent)", on: { click: (e) => { e.stopPropagation(); deck.clips.splice(i, 1); sel = Math.max(0, Math.min(sel, deck.clips.length - 1)); changed(); } } }, "✕"))));
    });
    if (!scenes.length) track.append(h("p.muted.dk-empty", "Aucun plan. Ouvre une case en « Mode montage » puis « Enregistrer et envoyer dans le deck »."));
    else track.append(h("div.mt-head", { style: `left:${(T / tot * 100).toFixed(3)}%` }));
    clock.textContent = `${T.toFixed(2)} s / ${total().toFixed(1)} s`;
    info.textContent = "";
    const s = scenes[sel];
    if (s && !s.missing) info.append(h("span.muted", `Plan ${sel + 1} : ${s.label}`),
      h("button.mini", { title: "Ferme le deck et ouvre le montage de cette case", on: { click: () => { done(); m.close(); app.openPanelMontage(s.pageIndex, s.panel); } } }, "🎬 Ouvrir son montage"));
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
  function play() { if (!scenes.length) return; playing = true; playBtn.textContent = "⏸ Pause"; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { if (!playing) return; playing = false; cancelAnimationFrame(raf); playBtn.textContent = "▶ Lecture"; refresh(); }
  track.addEventListener("pointerdown", (e) => {            // clic dans la bande : on se place a cet instant
    if (e.target.closest("button") || !scenes.length) return;
    const r = track.getBoundingClientRect();
    stop(); T = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total(); sel = locate(T)[0]; refresh();
  });
  const key = (e) => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return; if (e.key === " ") { e.preventDefault(); e.stopPropagation(); playing ? stop() : play(); } };
  document.addEventListener("keydown", key, true);
  const done = () => { playing = false; cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); };
  const fullBtn = h("button.mini", { on: { click: () => { const on = m.box.classList.toggle("modal-full"); fullBtn.textContent = on ? "🗗 Fenêtre" : "⛶ Plein écran"; } } }, "⛶ Plein écran");
  build(); refresh();
  const m = modal("Deck de montage", h("div.mt-editor.dk-editor", h("div.mt-view", svg),
    h("div.mt-bar", h("button.mini", { title: "Revenir au début", on: { click: () => { stop(); T = 0; sel = 0; refresh(); } } }, "⏮"), playBtn, clock, info, h("span.spacer"), fullBtn), track,
    h("p.muted", "Maquette : les plans s'enchaînent en coupe franche, dans l'ordre de la bande. Pas encore de transitions, de son ni d'export vidéo.")),
    [{ label: "Fermer", primary: true, click: done }]);
  m.box.classList.add("modal-wide", "modal-montage");
  return m;
}

/** Ajoute une case au deck du storyboard. */
export function addClip(app, pid) {
  const deck = app.project.deck || (app.project.deck = { clips: [] });
  deck.clips.push({ id: uid(), page: app.page().id, panel: pid });
  app.commit("deck");
  toast(`Case envoyée dans le deck (${deck.clips.length} plan${deck.clips.length > 1 ? "s" : ""}).`);
}
