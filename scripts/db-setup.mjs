/* Prépare la base Supabase historique pour Leegend Cars : applique le schéma puis crée le
   bucket de stockage. Le schéma est idempotent : relancer la commande ne casse
   rien et ne perd aucune donnée.
   Usage : npm run db:setup */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = await readFile(join(here, "..", "supabase", "schema.sql"), "utf8");

try {
  await pool.query(sql);

  /* Les règles d'accès ne sont appliquées qu'une fois, après la création des
     tables : elles font référence à des fonctions qui doivent déjà exister. */
  for (const fichier of ["policies.sql", "functions.sql"]) {
    try {
      const sql = await readFile(join(here, "..", "supabase", fichier), "utf8");
      await pool.query(sql);
      console.log(`${fichier} applique.`);
    } catch (e) {
      console.error(`Echec de ${fichier} :`, e.message);
      process.exitCode = 1;
    }
  }

  const { rows } = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
  );
  console.log("Tables :", rows.map((r) => r.table_name).join(", "));
} catch (e) {
  console.error("Echec du schema :", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

/* ---------- bucket de stockage ---------- */
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SB_URL || !SB_KEY) {
  console.log("\nStockage : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents -> fichiers sur disque (dev).");
} else {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const r = await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: "uploads", name: "uploads", public: false, file_size_limit: 26214400 }),
  });
  if (r.ok) console.log("Bucket « uploads » cree.");
  else if (r.status === 400 || r.status === 409) console.log("Bucket « uploads » deja present.");
  else console.error("Bucket : echec", r.status, (await r.text()).slice(0, 200));
}