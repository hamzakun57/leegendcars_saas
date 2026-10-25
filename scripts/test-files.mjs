/**
 * Teste la validation des fichiers — la barrière qui empêche un visiteur
 * d'envoyer n'importe quoi dans le bucket.
 *
 * Cette logique vit dans une Edge Function (Deno) mais n'utilise que des API
 * disponibles dans les deux environnements : elle se teste ici, en Node.
 */
import {
  decoder, MAX_DOC, nomSure, tailleLot, valider,
} from "../supabase/functions/_shared/fichiers.ts";

let pass = 0, fail = 0;
const check = (nom, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "ECHEC"} ${nom}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

const b64 = (octets) => "data:image/png;base64," + Buffer.from(octets).toString("base64");

/* Un PNG 1x1 authentique */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
/* Un JPEG : les trois premiers octets ff d8 ff suffisent au contrôle */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n", "utf8");
const RIFF_WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"), Buffer.from([0, 0, 0, 0]),
]);

console.log("— formats acceptés —");
for (const [nom, octets, attendu] of [["PNG", PNG, ".png"], ["JPEG", JPEG, ".jpg"], ["WebP", RIFF_WEBP, ".webp"]]) {
  try {
    const f = valider(b64(octets), { max: MAX_DOC });
    check(`${nom} accepté`, f.nom.endsWith(attendu) && !!f.mime, `${f.nom} · ${f.mime} · ${f.taille} o`);
  } catch (e) {
    check(`${nom} accepté`, false, e.message);
  }
}

try {
  const f = valider("data:application/pdf;base64," + PDF.toString("base64"), { allowPdf: true });
  check("PDF accepté en pièce jointe", f.nom.endsWith(".pdf") && f.mime === "application/pdf");
} catch (e) {
  check("PDF accepté en pièce jointe", false, e.message);
}

console.log("\n— ce qui doit être refusé —");
const refus = [
  ["PDF sans autorisation", "data:application/pdf;base64," + PDF.toString("base64"), {}],
  ["script PHP renommé .png", b64(Buffer.from("<?php system($_GET['c']); ?>", "utf8")), {}],
  ["HTML déguisé en .png", b64(Buffer.from("<script>alert(1)</script>", "utf8")), {}],
  ["binaire quelconque", b64(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), {}],
  ["fichier vide", "", {}],
  ["null", null, {}],
];
for (const [nom, entree, opts] of refus) {
  let refuse = false, pourquoi = "";
  try {
    valider(entree, opts);
  } catch (e) {
    refuse = true;
    pourquoi = e.message;
  }
  check(`${nom} refusé`, refuse, pourquoi);
}

/* Un fichier trop lourd doit être refusé avant tout traitement. */
let tropGros = false, message = "";
try {
  valider(b64(Buffer.alloc(MAX_DOC + 1024)), { max: MAX_DOC });
} catch (e) {
  tropGros = e.message.indexOf("trop lourd") >= 0;
  message = e.message;
}
check("fichier trop lourd refusé", tropGros, message);

console.log("\n— noms et chemins —");
for (const [nom, attendu] of [
  ["photo-de-voiture.jpg", true],
  ["reservations/contrat-2026.pdf", true],
  ["../../etc/passwd", false],
  ["/etc/passwd", false],
  ["photo.png.exe", false],
  ["photo.php", false],
  ["uploads/../secret.png", false],
  ["", false],
  [null, false],
]) {
  check(`nom ${JSON.stringify(nom)} ${attendu ? "accepté" : "refusé"}`, !!nomSure(nom) === attendu);
}
check("nom renvoyant le chemin complet", nomSure("photo.jpg") === "uploads/photo.jpg", String(nomSure("photo.jpg")));
check("nom avec préfixe déjà présent", nomSure("uploads/reservations/a.png") === "uploads/reservations/a.png");
const agenceTest = "123e4567-e89b-12d3-a456-426614174000";
const clePrivee = `uploads/${agenceTest}/reservations/dossier.pdf`;
const clePhoto = `photos/photos/${agenceTest}/voiture.jpg`;
check("nom de pièce tenant-aware accepté", nomSure(clePrivee) === clePrivee);
check("URL photo tenant-aware normalisée", nomSure(`https://exemple.supabase.co/storage/v1/object/public/${clePhoto}`) === clePhoto);
check("fichier d'une agence reste sous son UUID", !nomSure("uploads/autre-agence/reservations/dossier.pdf"));

console.log("\n— noms attribués —");
const v1 = valider(b64(PNG), {});
const v2 = valider(b64(PNG), {});
check("deux fichiers portent des noms différents", v1.nom !== v2.nom, `${v1.nom} / ${v2.nom}`);
check("le sous-dossier est respecté", valider(b64(PNG), { sousDossier: "reservations" }).chemin.startsWith("uploads/reservations/"));
check("les pièces sont rangées dans le tenant", valider(b64(PDF), { allowPdf: true, sousDossier: "reservations", agencyId: agenceTest }).chemin.startsWith(`uploads/${agenceTest}/reservations/`));
check("les photos sont rangées dans le tenant", valider(b64(PNG), { sousDossier: "photos", agencyId: agenceTest }).chemin.startsWith(`photos/photos/${agenceTest}/`));
check("décodage cohérent", decoder(b64(PNG)).length === PNG.length);

console.log("\n— taille d'un lot —");
check("lot vide = 0", tailleLot([]) === 0);
check("lot calculé à partir du base64", tailleLot([b64(PNG), b64(PDF)]) === PNG.length + PDF.length, `${tailleLot([b64(PNG), b64(PDF)])} o`);
check("entrées invalides ignorées", tailleLot([null, 42, undefined]) === 0);

console.log(`\n${pass} reussis, ${fail} echecs`);
if (fail) process.exitCode = 1;