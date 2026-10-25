/* Page publique /sign/:token — zone de signature + envoi au serveur. */
(function () {
  "use strict";

  const body = document.body;
  const token = body.dataset.token;
  const pad = document.getElementById("sig-pad");
  const hint = document.getElementById("sig-hint");
  const msg = document.getElementById("sig-msg");
  const saveBtn = document.getElementById("sig-save");
  const clearBtn = document.getElementById("sig-clear");
  const iframe = document.getElementById("doc");
  const printBtn = document.querySelector("[data-print-iframe]");
  let signaturePad = null;

  function say(text, kind) {
    if (!msg) return;
    msg.className = "msg " + (kind || "");
    msg.textContent = text;
  }

  function hideHint() {
    if (hint) hint.classList.add("gone");
  }

  if (pad) {
    signaturePad = new window.SignaturePad(pad);
    pad.addEventListener("pointerdown", hideHint);
  }

  clearBtn?.addEventListener("click", () => {
    signaturePad?.clear();
    if (hint) hint.classList.remove("gone");
    say("");
  });

  saveBtn?.addEventListener("click", async () => {
    const data = signaturePad ? signaturePad.toDataURL(480) : "";
    if (!data) {
      say("La zone de signature est vide : dessinez votre signature avant d'enregistrer.", "err");
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement…";
    try {
      const res = await fetch(`/sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: data }),
      });
      const data2 = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data2.error || "Enregistrement impossible.");
      say("Signature enregistrée. Le contrat ci-dessous est mis à jour.", "ok");
      /* Rechargement : le serveur renvoie la page avec la signature déjà posée. */
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      say(e.message, "err");
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer ma signature";
    }
  });

  /* Le bouton du bandeau imprime le contrat seul, pas la page de signature. */
  printBtn?.addEventListener("click", () => {
    const win = iframe?.contentWindow;
    if (!win) {
      window.print();
      return;
    }
    win.focus();
    win.print();
  });
})();