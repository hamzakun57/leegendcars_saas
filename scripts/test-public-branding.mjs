import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "https://saas-example.test/",
  runScripts: "outside-only",
});
const { window } = dom;

for (const path of ["../assets/js/icons.js", "../assets/js/data.js", "../assets/js/pages.js"]) {
  window.eval(readFileSync(new URL(path, import.meta.url), "utf8"));
}

window.DATA.CFG.brand = 'Agence <img src=x onerror="alert(1)">';
const home = window.Pages.home();

assert.match(home, /Agence &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
assert.doesNotMatch(home, /<img src=x onerror=/);
assert.doesNotMatch(home, /Leegend Cars|4\.9\/5|200\+/);
assert.deepEqual(Array.from(window.DATA.PICKUP_LOCATIONS), ["À convenir avec l'agence"]);

window.DATA.CFG.phonePrimary = '<img src=x onerror="alert(1)">';
window.DATA.CFG.phonePrimaryTel = '123" onclick="alert';
window.DATA.CFG.address = '<svg onload="alert(1)">';
window.DATA.CFG.hours = '<script>alert(1)</script>';
window.DATA.CFG.mapsUrl = "javascript:alert(1)";
const contact = window.Pages.contact();

assert.doesNotMatch(contact, /<img src=x onerror=|<svg onload=|<script>alert/);
assert.doesNotMatch(contact, /tel:[^"]*onclick=|href="javascript:/);
assert.match(contact, /href="tel:123"/);
assert.match(contact, /href="" target="_blank"/);

console.log("Marque publique dynamique échappée, liens sûrs et contenu d'exemple non affiché.");
dom.window.close();
