import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

import "../shared/date-utils.js";

process.env.TZ = "Pacific/Auckland";
const dates = globalThis.LCDateUtils;
assert.ok(dates, "date utilities are loaded");
assert.equal(dates.isIsoDate("2012-06-13"), true);
assert.equal(dates.isIsoDate("2024-02-29"), true);
assert.equal(dates.isIsoDate("2023-02-29"), false);
assert.equal(dates.isIsoDate("2012-13-06"), false);
assert.equal(dates.normalizeIsoDate("2012-06-13T00:00:00.000Z"), "2012-06-13");
assert.equal(dates.normalizeIsoDate("06/13/2012"), "");

const utilityPath = fileURLToPath(new URL("../shared/date-utils.js", import.meta.url));
for (const timezone of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import ${JSON.stringify(pathToFileURL(utilityPath).href)};
    assert.equal(globalThis.LCDateUtils.isIsoDate("2012-06-13"), true);
    assert.equal(globalThis.LCDateUtils.normalizeIsoDate("2012-06-13"), "2012-06-13");
    console.log(Intl.DateTimeFormat().resolvedOptions().timeZone);
  `], {
    encoding: "utf8",
    env: { ...process.env, TZ: timezone },
  });
  assert.equal(result.status, 0, `${timezone}: ${result.stderr}`);
  assert.match(result.stdout, new RegExp(timezone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const publicSource = readFileSync(new URL("../assets/js/pages.js", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../server/public/admin.js", import.meta.url), "utf8");
assert.match(publicSource, /name="licenceDate" type="date"/);
assert.match(adminSource, /field\("Date de délivrance", "c-licd", dateClientInput\(c\.licence_date\), "date"\)/);
assert.match(adminSource, /licence_date: \$\("#c-licd"\)\.value/);

const wPublic = new JSDOM(readFileSync(new URL("../index.html", import.meta.url), "utf8"), {
  url: "https://leegendcars.test/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
}).window;
wPublic.console = console;
wPublic.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
wPublic.requestAnimationFrame = (callback) => setTimeout(callback, 0);
wPublic.cancelAnimationFrame = clearTimeout;
wPublic.scrollTo = () => {};
wPublic.Element.prototype.scrollIntoView = () => {};
wPublic.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
wPublic.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
wPublic.document.documentElement.lang = "en-US";

const vehicle = {
  slug: "date-validation-test",
  name: "Date validation test",
  price_from: 500,
  deposit: 5000,
  approx: 50,
  tiers: "[]",
  gallery: "[]",
  description: "[]",
  ideal_for: "[]",
  active: 1,
  sort_order: 1,
  transmission: "Automatique",
  fuel: "Essence",
  doors: 5,
  seats: 5,
};
let reservationInserted = null;
wPublic.supabase = {
  createClient: () => ({
    from(table) {
      const query = {
        filters: {},
        select() { return this; },
        eq(key, value) { this.filters[key] = value; return this; },
        order() { return this; },
        maybeSingle() { return Promise.resolve({ data: vehicle, error: null }); },
        insert(row) {
          if (table === "reservations") reservationInserted = row;
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          const data = table === "vehicles"
            ? [vehicle]
            : table === "blocked_dates"
              ? []
              : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  }),
};
wPublic.LCRuntimeConfig = {
  source: "supabase",
  supabaseUrl: "https://saas-example.supabase.co",
  supabaseAnonKey: "test-public-key",
  agencySlug: "date-validation-test",
};

for (const file of [
  "../shared/date-utils.js",
  "../assets/js/icons.js",
  "../assets/js/data.js",
  "../assets/js/data-source.js",
  "../assets/js/pages.js",
  "../assets/js/app.js",
]) {
  wPublic.eval(readFileSync(new URL(file, import.meta.url), "utf8"));
}

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(predicate(), message);
};

await waitFor(() => wPublic.DATA.VEHICLES.some((item) => item.slug === vehicle.slug), "public fleet loaded");
wPublic.location.hash = `#/vehicules/${vehicle.slug}`;
await waitFor(() => wPublic.document.querySelector("[data-rform]"), "customer reservation form rendered");
const reservationForm = wPublic.document.querySelector("[data-rform]");
for (const [name, value] of Object.entries({
  firstName: "Date",
  lastName: "Locale",
  phone: "612345678",
  licenceNumber: "AB123456",
  licenceDate: "2012-06-13",
  pickup: "À convenir avec l'agence",
  ret: "À convenir avec l'agence",
  pickupDate: "2026-12-01",
  pickupTime: "10:00",
  returnDate: "2026-12-05",
  returnTime: "10:00",
  babySeat: "0",
  notes: "",
  botcheck: "",
})) {
  reservationForm.elements.namedItem(name).value = value;
}
for (const name of ["licenceDate", "pickupDate", "returnDate"]) {
  const value = reservationForm.elements.namedItem(name).value;
  assert.equal(dates.isIsoDate(value), true, `${name} is ISO in the customer form despite en-US display locale`);
}
await new Promise((resolve) => setTimeout(resolve, 650));
reservationForm.dispatchEvent(new wPublic.Event("submit", { bubbles: true, cancelable: true }));
await waitFor(() => !!reservationInserted, `customer form created a reservation (${reservationForm.querySelector("[data-form-alert]")?.textContent || "no form error"})`);
assert.equal(reservationInserted.licence_date, "2012-06-13");
assert.equal(reservationInserted.pickup_date, "2026-12-01");
assert.equal(reservationInserted.return_date, "2026-12-05");
wPublic.close();

const adminDom = new JSDOM("<!doctype html><html lang=\"en-US\"></html>", {
  url: "https://leegendcars.test/admin",
  runScripts: "outside-only",
});
const wAdmin = adminDom.window;
wAdmin.LCAdminConfig = {
  source: "supabase",
  supabaseUrl: "https://example.invalid",
  supabaseAnonKey: "test-public-key",
};
wAdmin.LCDateUtils = dates;
let clientInserted = null;
wAdmin.supabase = {
  createClient: () => ({
    from(table) {
      let row = null;
      return {
        insert(value) { row = value; if (table === "clients") clientInserted = value; return this; },
        select() { return this; },
        maybeSingle() { return Promise.resolve({ data: { id: 7, ...row }, error: null }); },
      };
    },
  }),
};
wAdmin.eval(readFileSync(new URL("../server/public/admin-api.js", import.meta.url), "utf8"));
const clientDates = {
  client_type: "particulier",
  last_name: "AdminDate",
  birthdate: "1990-05-12",
  licence_date: "2012-06-13",
  cin_date: "2018-07-14",
  passport_date: "2020-08-15",
  entry_date: "2024-09-16",
};
const createdClient = await wAdmin.LCAdmin.api("/api/admin/clients", { method: "POST", body: clientDates });
assert.equal(createdClient.client.id, 7);
for (const key of ["birthdate", "licence_date", "cin_date", "passport_date", "entry_date"]) {
  assert.equal(clientInserted[key], clientDates[key], `admin form/API retains ${key} unchanged`);
  assert.equal(dates.isIsoDate(clientInserted[key]), true);
}
await assert.rejects(
  wAdmin.LCAdmin.api("/api/admin/clients", { method: "POST", body: { last_name: "BadDate", birthdate: "2023-02-29" } }),
  /date client est invalide/i,
);
adminDom.window.close();

console.log("OK: customer reservation form creates a reservation with ISO dates and no day shift.");
console.log("OK: admin client creation saves all five ISO date fields and rejects impossible dates.");
console.log("OK: date validation and normalization remain correct in UTC, UTC+12, and UTC-7.");
