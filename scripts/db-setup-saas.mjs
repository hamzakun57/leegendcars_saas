/* Prépare uniquement le projet Supabase SaaS, jamais le projet historique. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseTargetsProject, isLegacyProject } from "./saas-config.mjs";

const ref = (process.env.SAAS_PROJECT_REF || "").trim();
const url = (process.env.SAAS_SUPABASE_URL || "").replace(/\/+$/, "");
const anon = process.env.SAAS_SUPABASE_ANON_KEY || "";
const service = process.env.SAAS_SUPABASE_SERVICE_ROLE_KEY || "";
const database = process.env.SAAS_DATABASE_URL || "";
const hostRef = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase() || "";

if (
  !ref ||
  isLegacyProject(ref) ||
  !hostRef ||
  hostRef !== ref.toLowerCase() ||
  !anon ||
  !service ||
  !database ||
  !databaseTargetsProject(database, ref)
) {
  throw new Error(
    "Refus de configurer la base : SAAS_PROJECT_REF, SAAS_SUPABASE_URL, " +
    "SAAS_SUPABASE_ANON_KEY, SAAS_SUPABASE_SERVICE_ROLE_KEY et SAAS_DATABASE_URL " +
    "doivent tous viser un nouveau projet Supabase SaaS."
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const files = [
  "schema.sql",
  "policies.sql",
  "functions.sql",
  join("migrations", "20261013000000_multi_agence.sql"),
];
const pool = new pg.Pool({ connectionString: database, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  for (const file of files) {
    const sql = await readFile(join(projectRoot, "supabase", file), "utf8");
    await client.query(sql);
    console.log(`${file} appliqué.`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Échec de l'installation SaaS :", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

if (process.exitCode) process.exit(process.exitCode);

const headers = {
  apikey: service,
  Authorization: `Bearer ${service}`,
  "Content-Type": "application/json",
};
for (const bucket of [
  { id: "uploads", name: "uploads", public: false, file_size_limit: 26214400 },
  { id: "photos", name: "photos", public: true, file_size_limit: 5242880 },
]) {
  const response = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify(bucket),
  });
  if (response.ok || response.status === 409 || response.status === 400) {
    console.log(`Bucket « ${bucket.name} » prêt.`);
  } else {
    throw new Error(`Création du bucket ${bucket.name} refusée (${response.status}).`);
  }
}
