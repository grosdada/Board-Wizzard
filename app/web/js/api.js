// Appels au serveur local + petit utilitaire DOM.
import { tt, tr } from "./i18n.js";

export async function api(method, path, body, raw) {
  const opt = { method, headers: {} };
  const falKey = localStorage.getItem("bw.falKey");      // cle fal de ce navigateur (collegue) : jamais ecrite cote serveur
  if (falKey) opt.headers["X-Fal-Key"] = falKey;
  if (raw !== undefined) { opt.body = raw; opt.headers["Content-Type"] = "application/octet-stream"; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  const r = await fetch("/api/" + path, opt);
  if (r.status === 401) { location.href = "/login"; throw new Error(tt("connexion requise")); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(tr(data.error) || (tt("erreur ") + r.status)); err.status = r.status; err.data = data; throw err; }
  return data;
}
export const get = (p) => api("GET", p);
export const post = (p, b) => api("POST", p, b ?? {});
export const put = (p, b) => api("PUT", p, b);
export const upload = (p, blob) => api("POST", p, undefined, blob);
export const del = (p) => api("DELETE", p);

// h("div.cls#id", {attr, on: {click}}, enfants...)
export function h(sel, props, ...kids) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "class") el.className = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export function toast(msg, kind = "info", ms = 4500) {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div#toasts"); document.body.append(box); }
  const t = h("div.toast." + kind, msg);
  box.append(t);
  setTimeout(() => t.classList.add("out"), ms);
  setTimeout(() => t.remove(), ms + 600);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// deplace une fenetre en la saisissant par son en-tete (translate : marche pour une fenetre centree ou fixe)
export function dragByHeader(box, handle) {
  let o = null, x = 0, y = 0;
  handle.style.cursor = "move";
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, input, select, textarea")) return;
    o = { px: e.clientX - x, py: e.clientY - y };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!o) return;
    x = e.clientX - o.px; y = e.clientY - o.py;
    box.style.transform = `translate(${x}px, ${y}px)`;
  });
  const end = () => { o = null; };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/** Annulation dans un atelier (dessin du fond, montage) : get() rend l'etat, set(etat) le remet. `max` actions gardees.
 *  watch(el) : note l'etat peu apres chaque geste dans el. keydown(e) : Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y ; vrai si traite. */
export function history(get, set, max = 5) {
  let stack = [JSON.stringify(get())], at = 0, timer = 0;
  const snap = () => {
    clearTimeout(timer);
    const s = JSON.stringify(get());
    if (s === stack[at]) return;
    stack = stack.slice(0, at + 1); stack.push(s);
    if (stack.length > max + 1) stack = stack.slice(-(max + 1));
    at = stack.length - 1;
  };
  const go = (d) => { snap(); const j = at + d; if (j < 0 || j >= stack.length) { toast(d < 0 ? tt("Rien de plus à annuler.") : tt("Rien à rétablir.")); return; } at = j; set(JSON.parse(stack[at])); };
  const soon = () => { clearTimeout(timer); timer = setTimeout(snap, 300); };
  return {
    snap, undo: () => go(-1), redo: () => go(1),
    watch(el) { for (const ev of ["pointerup", "change", "click", "keyup", "input", "wheel"]) el.addEventListener(ev, soon, { passive: true }); },
    keydown(e) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      const k = e.key.toLowerCase(), t = e.target;
      if (k !== "z" && k !== "y") return false;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && /^(text|number|search)$/.test(t.type)))) return false;   // le champ annule sa propre saisie
      e.preventDefault(); e.stopPropagation();
      go(k === "y" || e.shiftKey ? 1 : -1);
      return true;
    },
  };
}

export function modal(title, body, buttons) {
  const back = h("div.modal-back");
  const close = () => back.remove();
  const box = h("div.modal", h("header", h("h2", title), h("button.icon", { title: tt("Fermer"), on: { click: close } }, "✕")),
                h("div.modal-body", body),
                h("footer", (buttons || []).map(b => h("button" + (b.primary ? ".primary" : ""),
                  { on: { click: async () => { if ((await b.click?.(close)) !== false) close(); } } }, b.label))));
  dragByHeader(box, box.querySelector("header"));
  back.append(box);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, box };
}

export function loadImage(url) {
  return new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => ok(im); im.onerror = () => ko(new Error(tt("image illisible : ") + url));
    im.src = url;
  });
}
