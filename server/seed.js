/**
 * Remplit la table `vehicles` à partir de la flotte déclarée dans assets/js/data.js.
 *
 *   npm run seed             -> n'ajoute que les véhicules absents (les modifications
 *                               faites dans l'admin sont donc préservées)
 *   npm run seed -- --force  -> réimporte toute la flotte et écrase l'existant
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getVehicle, insertVehicle, listVehicles, updateVehicle } from "./db.js";
import { closeDb } from "./pg.js";

const here = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes("--force");

/* data.js est un IIFE navigateur qui écrit sur `window` : on l'évalue dans un
   contexte isolé pour récupérer DATA sans modifier le fichier. */
function loadFleet() {
  const src = readFileSync(join(here, "..", "assets", "js", "data.js"), "utf8");
  const ctx = vm.createContext({ window: {}, URLSearchParams, location: { search: "" } });
  vm.runInContext(src, ctx, { filename: "data.js" });
  if (!ctx.window.DATA || !Array.isArray(ctx.window.DATA.VEHICLES)) {
    throw new Error("VEHICLES introuvable dans assets/js/data.js");
  }
  return ctx.window.DATA.VEHICLES;
}

const toRow = (v, i) => ({
  slug: v.slug,
  name: v.name,
  tagline: v.tagline,
  transmission: v.transmission,
  fuel: v.fuel,
  doors: v.doors,
  seats: v.seats,
  price_from: v.priceFrom,
  deposit: v.deposit ?? 0,
  approx: v.approx,
  badge: v.badge,
  accent: v.accent,
  description: v.description,
  ideal_for: v.idealFor,
  gallery: v.gallery,
  tiers: v.tiers,
  active: true,
  sort_order: i,
});

const fleet = loadFleet();

/**
 * Importe la flotte déclarée dans data.js.
 * Utilisé au démarrage quand la base est vide (première installation, ou
 * hébergeur au disque éphémère comme Render gratuit) : sans cela, le site
 * afficherait un catalogue vide.
 */
export async function seedFleet({ force = false } = {}) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const [i, v] of fleet.entries()) {
    const existing = await getVehicle(v.slug);
    if (!existing) {
      await insertVehicle(toRow(v, i));
      added++;
    } else if (force) {
      await updateVehicle(v.slug, toRow(v, i));
      updated++;
    } else {
      skipped++;
    }
  }
  return { added, updated, skipped, total: (await listVehicles()).length };
}

/* Exécution directe : npm run seed [-- --force] */
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  const r = await seedFleet({ force });
  console.log(
    `Flotte : ${r.added} ajouté(s), ${r.updated} mis à jour${r.skipped ? `, ${r.skipped} ignoré(s)` : ""}. ` +
      `Total en base : ${r.total}.`
  );
  await closeDb();
}