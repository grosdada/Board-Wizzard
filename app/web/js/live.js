// Croquis -> image en direct (essai) : le dessin de l'atelier part a fal (FLUX.2 klein, temps reel) par WebSocket, l'image
// revient a cote. Sans la bibliotheque fal : un petit msgpack (le protocole de fal) et un jeton court delivre par le serveur
// (POST /api/fal/realtime-token : la cle reste sur le serveur). Facture a la seconde de calcul (0,00194 $ annonce par fal) :
// pause automatique apres 30 s sans changement, compteur de secondes affiche.
import { tt } from "./i18n.js";
import { h, post, toast } from "./api.js";

export const LIVE_APP = "fal-ai/flux-2/klein/realtime";
const PRICE = 0.00194;                                      // $ par seconde de calcul (page du modele fal)
const IDLE = 30;                                            // secondes sans changement avant la pause automatique

// ---- msgpack (sous-ensemble suffisant : nil, booleens, nombres, chaines, tableaux, objets, binaire)
const te = new TextEncoder(), td = new TextDecoder();
function pack(v) {
  const out = [];
  const u8 = (n) => out.push(n & 255), be = (n, k) => { for (let i = k - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 255); };
  const enc = (x) => {
    if (x === null || x === undefined) u8(0xc0);
    else if (x === true) u8(0xc3);
    else if (x === false) u8(0xc2);
    else if (typeof x === "number") {
      if (Number.isInteger(x) && x >= 0 && x < 2 ** 32) { if (x < 128) u8(x); else if (x < 256) { u8(0xcc); u8(x); } else if (x < 65536) { u8(0xcd); be(x, 2); } else { u8(0xce); be(x, 4); } }
      else if (Number.isInteger(x) && x < 0 && x >= -(2 ** 31)) { if (x >= -32) u8(x); else { u8(0xd2); const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, x); for (let i = 0; i < 4; i++) u8(b.getUint8(i)); } }
      else { u8(0xcb); const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); for (let i = 0; i < 8; i++) u8(b.getUint8(i)); }
    } else if (typeof x === "string") {
      const b = te.encode(x), n = b.length;
      if (n < 32) u8(0xa0 | n); else if (n < 256) { u8(0xd9); u8(n); } else if (n < 65536) { u8(0xda); be(n, 2); } else { u8(0xdb); be(n, 4); }
      for (const c of b) out.push(c);
    } else if (x instanceof Uint8Array) {
      const n = x.length;
      if (n < 256) { u8(0xc4); u8(n); } else if (n < 65536) { u8(0xc5); be(n, 2); } else { u8(0xc6); be(n, 4); }
      for (const c of x) out.push(c);
    } else if (Array.isArray(x)) {
      const n = x.length;
      if (n < 16) u8(0x90 | n); else if (n < 65536) { u8(0xdc); be(n, 2); } else { u8(0xdd); be(n, 4); }
      x.forEach(enc);
    } else {
      const ks = Object.keys(x).filter((k) => x[k] !== undefined), n = ks.length;
      if (n < 16) u8(0x80 | n); else { u8(0xde); be(n, 2); }
      for (const k of ks) { enc(k); enc(x[k]); }
    }
  };
  enc(v);
  return new Uint8Array(out);
}
function unpack(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  const str = (n) => { const s = td.decode(b.subarray(i, i + n)); i += n; return s; };
  const bin = (n) => { const s = b.slice(i, i + n); i += n; return s; };
  const arr = (n) => { const a = []; for (let k = 0; k < n; k++) a.push(dec()); return a; };
  const map = (n) => { const o = {}; for (let k = 0; k < n; k++) { const key = dec(); o[key] = dec(); } return o; };
  const dec = () => {
    const t = b[i++];
    if (t < 0x80) return t;
    if (t >= 0xe0) return t - 256;
    if ((t & 0xf0) === 0x80) return map(t & 15);
    if ((t & 0xf0) === 0x90) return arr(t & 15);
    if ((t & 0xe0) === 0xa0) return str(t & 31);
    let v;
    switch (t) {
      case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
      case 0xc4: v = b[i]; i += 1; return bin(v); case 0xc5: v = dv.getUint16(i); i += 2; return bin(v); case 0xc6: v = dv.getUint32(i); i += 4; return bin(v);
      case 0xca: v = dv.getFloat32(i); i += 4; return v; case 0xcb: v = dv.getFloat64(i); i += 8; return v;
      case 0xcc: return b[i++]; case 0xcd: v = dv.getUint16(i); i += 2; return v; case 0xce: v = dv.getUint32(i); i += 4; return v;
      case 0xcf: v = Number(dv.getBigUint64(i)); i += 8; return v;
      case 0xd0: v = dv.getInt8(i); i += 1; return v; case 0xd1: v = dv.getInt16(i); i += 2; return v; case 0xd2: v = dv.getInt32(i); i += 4; return v;
      case 0xd3: v = Number(dv.getBigInt64(i)); i += 8; return v;
      case 0xd9: v = b[i]; i += 1; return str(v); case 0xda: v = dv.getUint16(i); i += 2; return str(v); case 0xdb: v = dv.getUint32(i); i += 4; return str(v);
      case 0xdc: v = dv.getUint16(i); i += 2; return arr(v); case 0xdd: v = dv.getUint32(i); i += 4; return arr(v);
      case 0xde: v = dv.getUint16(i); i += 2; return map(v); case 0xdf: v = dv.getUint32(i); i += 4; return map(v);
      case 0xd4: i += 2; return null; case 0xd5: i += 3; return null; case 0xd6: i += 5; return null; case 0xd7: i += 9; return null; case 0xd8: i += 17; return null;
      case 0xc7: v = b[i]; i += 2 + v; return null; case 0xc8: v = dv.getUint16(i); i += 3 + v; return null; case 0xc9: v = dv.getUint32(i); i += 5 + v; return null;
      default: throw new Error("msgpack : type inconnu " + t);
    }
  };
  return dec();
}

/** Panneau « En direct » de l'atelier de dessin. snap() : le dessin en data URI JPEG 704 x 704 ; keep(blob) : garder l'image. */
export function liveBox({ snap, keep, bank }) {
  let lastImg = null, lastPr = null, ws = null, on = false, t0 = 0, secs = 0, frames = 0, lastChange = 0, timer = null, pending = false, busy = false, lastUrl = null, lastBlob = null, sentAt = 0, lat = 0;
  const out = h("img.draw-live-out", { alt: "" });
  const prompt = h("textarea", { rows: 2, value: "", placeholder: tt("Consigne : ce que doit devenir le croquis") });
  prompt.value = "Turn this rough sketch into a clean finished character drawing in black ink line art on white paper, same pose, same proportions, same composition";
  const status = h("span.muted.draw-live-status", tt("Prêt"));
  const go = h("button.mini", { type: "button", title: tt("Envoie le dessin, reçoit l'image, puis coupe la connexion : relancer à chaque fois") }, tt("▶ Générer"));
  const keepBtn = h("button.mini", { type: "button", title: tt("Pose l'image en direct dans le dessin, comme une image importée") }, tt("⬇ Garder l'image"));
  const tick = () => {
    if (on) secs = (performance.now() - t0) / 1000;
    status.textContent = (on ? tt("● En cours") : tt("Prêt")) + tt` · session ${Math.round(secs)} s · ${frames} images` + (lat ? tt` · ${Math.round(lat)} ms` : "") +
      tt` · ≤ ${(secs * PRICE).toFixed(3)} $`;
    if (on && performance.now() - lastChange > IDLE * 1000) { stop(); toast(tt("En direct : pause automatique après 30 s sans changement.")); }
  };
  async function start() {
    if (on) return;
    let tok;
    try { tok = (await post("fal/realtime-token", { app: LIVE_APP })).token; } catch (e) { return toast(tt("En direct refusé : ") + e.message, "error"); }
    on = true; t0 = performance.now() - secs * 1000; lastChange = performance.now(); lastImg = null; go.textContent = tt("⏳ En cours…");
    ws = new WebSocket(`wss://fal.run/${LIVE_APP}?` + new URLSearchParams({ fal_jwt_token: tok, max_buffering: "2" }));
    ws.binaryType = "arraybuffer";
    ws.onopen = () => send();
    ws.onmessage = (ev) => {
      let d;
      try { d = typeof ev.data === "string" ? JSON.parse(ev.data) : unpack(ev.data); } catch (e) { return; }
      if (!d || typeof d !== "object") return;
      if (d.type === "x-fal-message") return;
      if (d.type === "x-fal-error" || d.status === "error") { if (d.error !== "TIMEOUT") toast(tt("En direct : ") + (d.error || "") + " " + (d.reason || ""), "error"); busy = false; return; }
      const im = (d.images || [])[d.images && d.images.length > 1 ? 1 : 0];
      if (!im) return;
      const c = im.content;
      const blob = c instanceof Uint8Array ? new Blob([c], { type: im.content_type || "image/jpeg" })
        : typeof c === "string" && c.startsWith("data:") ? null : typeof c === "string" ? new Blob([Uint8Array.from(atob(c), (x) => x.charCodeAt(0))], { type: im.content_type || "image/jpeg" }) : null;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = blob ? URL.createObjectURL(blob) : c; lastBlob = blob; out.src = lastUrl;
      frames++; busy = false; lat = performance.now() - sentAt;
      stop();                                               // une generation puis on coupe : rien ne tourne entre deux
      tick();
    };
    ws.onerror = () => toast(tt("En direct : la connexion a échoué."), "error");
    ws.onclose = (ev) => { if (on) { stop(); if (ev.code !== 1000) toast(tt`En direct : connexion fermée (${ev.code}) ${ev.reason || ""}`, "error"); } };
    timer = setInterval(tick, 500);
  }
  function stop() {
    on = false; go.textContent = tt("▶ Générer");
    if (ws) { try { ws.close(); } catch (e) { /* rien */ } ws = null; }
    clearInterval(timer); timer = null; busy = false; pending = false; tick();
  }
  async function send() {                                   // une image a la fois : la suivante part quand le resultat revient
    if (!on || !ws || ws.readyState !== 1) return;
    if (busy) { pending = true; return; }
    pending = false; busy = true;
    const img = await snap(), pr = prompt.value.trim() || "a clean drawing";
    if (!img || !ws || ws.readyState !== 1) { busy = false; return; }
    if (img === lastImg && pr === lastPr) { busy = false; return; }   // rien n'a change : rien a payer
    lastImg = img; lastPr = pr;
    sentAt = performance.now();
    ws.send(pack({ image_url: img, prompt: pr, image_size: "square", num_inference_steps: 3, seed: 35, output_feedback_strength: 1 }));
    setTimeout(() => { if (busy && performance.now() - sentAt > 8000) { busy = false; if (pending) send(); } }, 8200);   // reponse perdue : on repart
  }
  go.addEventListener("click", () => { if (!on) start(); });
  keepBtn.addEventListener("click", () => { if (!lastBlob) return toast(tt("Pas encore d'image en direct.")); keep(lastBlob); });
  const bankBtn = h("button.mini", { type: "button", title: tt("Range l'image en direct dans la banque (Assets, dossier « En direct »), avec ce croquis gardé pour le reprendre plus tard") }, tt("⇪ Dans la banque"));
  bankBtn.addEventListener("click", () => { if (!lastBlob) return toast(tt("Pas encore d'image en direct.")); bank(lastBlob); });
  prompt.addEventListener("input", () => { lastChange = performance.now(); });
  prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!on) start(); } });
  const box = h("div.draw-live", h("div.row.wrap", h("b", tt("⚡ En direct")), go, keepBtn, bankBtn, status), out, prompt,
    h("p.muted", tt("« Générer » (ou Ctrl+Entrée dans la consigne) envoie le dessin à fal (FLUX.2 klein temps réel, environ 0,002 $ par seconde de calcul), reçoit l'image et coupe la connexion.")));
  return {
    el: box,
    changed() { lastChange = performance.now(); },
    close: stop,
  };
}
