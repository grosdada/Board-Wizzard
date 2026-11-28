// Explications repliees : les longs textes d'aide gris (p.muted) prennent beaucoup de place, a l'ecran comme pour la tete.
// Partout dans l'appli, ils se rangent derriere une petite icone ⓘ, posee au bout de la ligne de boutons ou du titre juste
// au-dessus (sinon a leur place) ; un clic deplie l'explication. Les paragraphes longs qui se suivent vont sous la meme
// icone. Restent toujours visibles : les textes courts, ceux qui parlent d'argent (« $ », « payant »), et ce qui est dans
// un element marque data-noinfo. Seuls les elements ajoutes a la page sont ranges : un texte d'etat mis a jour plus tard
// par le code ne disparait pas. Deplie / replie est garde pour la session (l'inspecteur se redessine souvent).
import { tt } from "./i18n.js";

const MIN = 110;                                         // en dessous : texte court, laisse en vue
const opened = new Set();
const long = (p) => p.matches("p.muted") && !p.dataset.it && !p.closest("[data-noinfo], .it-body") &&
  p.textContent.trim().length >= MIN && !/\$|payant|€/i.test(p.textContent);

function fold(p) {
  if (!long(p) || !p.parentNode) return;
  const group = [p];
  for (let n = p.nextElementSibling; n && long(n); n = n.nextElementSibling) group.push(n);
  const key = p.textContent.trim().slice(0, 60);
  const body = document.createElement("div");
  body.className = "it-body";
  body.hidden = !opened.has(key);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "it-btn" + (body.hidden ? "" : " on");
  btn.textContent = "ⓘ";
  btn.title = tt("Afficher l'explication");
  btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    body.hidden = !body.hidden;
    btn.classList.toggle("on", !body.hidden);
    if (body.hidden) opened.delete(key); else opened.add(key);
  });
  const prev = p.previousElementSibling;
  p.before(body);
  for (const x of group) { x.dataset.it = "1"; body.append(x); }
  if (prev && prev.matches("h3, h4, b, div.row, label.row") && !prev.querySelector(":scope > .it-btn")) prev.append(btn);
  else { btn.classList.add("alone"); body.before(btn); }
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches("p.muted")) fold(root);
  root.querySelectorAll("p.muted").forEach(fold);
}

export function startInfoTips() {
  scan(document.body);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(scan); })
    .observe(document.body, { childList: true, subtree: true });
}
