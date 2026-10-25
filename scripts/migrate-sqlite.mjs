/**
 * Migre les données de l'ancien serveur vers Supabase.
 *
 *   npm run migrate:sqlite              -> refuse de s'exécuter si la base cible
 *                                          contient déjà des données
 *   npm run migrate:sqlite -- --agency <slug> --confirm-target
 *
 * Les données sont importées dans une agence vide du projet SaaS dédié. Les
 * comptes Auth ne sont pas copiés : les propriétaires sont créés séparément.
 * Tout est repris : flotte, fiches clients, dossiers, règlements,
 * signatures et compteurs. Les photos et pièces jointes locales sont copiées
 * dans des chemins de stockage propres à l'agence.
 */
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { databaseTargetsProject, isLegacyProject } from "./saas-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SQLITE_PATH = join(ROOT, "server", "data", "leegend.db");
const UPLOAD_DIR = join(ROOT, "uploads");

const projectRef = (process.env.SAAS_PROJECT_REF || "").trim();
const supabaseUrl = (process.env.SAAS_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SAAS_SUPABASE_SERVICE_ROLE_KEY || "";
const databaseUrl = process.env.SAAS_DATABASE_URL || "";
const agencyArg = process.argv.indexOf("--agency");
const agencySlug = agencyArg >= 0 ? String(process.argv[agencyArg + 1] || "").trim().toLowerCase() : "";
const confirmed = process.argv.includes("--confirm-target");
const hostRef = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase() || "";

if (process.argv.includes("--force")) {
  throw new Error("--force est désactivé : l'import ne supprime jamais les données.");
}
if (
  !projectRef ||
  isLegacyProject(projectRef) ||
  hostRef !== projectRef.toLowerCase() ||
  !serviceKey ||
  !databaseUrl ||
  !databaseTargetsProject(databaseUrl, projectRef) ||
  !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agencySlug) ||
  !confirmed
) {
  throw new Error(
    "Import refusé. Utilisez le nouveau projet SAAS_* puis " +
    "`npm run migrate:sqlite -- --agency <slug> --confirm-target`."
  );
}

/* L'ordre suit les clés étrangères : un dossier doit exister avant son règlement. */
const TABLES = [
  "vehicles", "maintenance", "clients", "reservations", "payments", "attachments",
  "blocked_dates", "counters",
];

if (!existsSync(SQLITE_PATH)) {
  console.error("Base SQLite introuvable :", SQLITE_PATH);
  process.exit(1);
}

const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

const pgColumns = async (table) => {
  const { rows } = await pool.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
    [table]
  );
  return rows.map((r) => r.column_name);
};

const client = await pool.connect();
let agencyId = "";
const uploadedFiles = [];
const photoFiles = new Set();
try {
  const { rows: agencyRows } = await client.query(
    "SELECT id FROM public.agencies WHERE slug = $1 AND active",
    [agencySlug]
  );
  if (!agencyRows.length) throw new Error(`Agence SaaS « ${agencySlug} » introuvable ou inactive.`);
  agencyId = agencyRows[0].id;
  const { rows: occupied } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM public.vehicles WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.reservations WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.clients WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.payments WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.attachments WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.blocked_dates WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.maintenance WHERE agency_id = $1
       UNION ALL SELECT 1 FROM public.counters WHERE agency_id = $1
     ) AS occupied`,
    [agencyId]
  );
  if (occupied[0].occupied) {
    console.error(
      `L'agence « ${agencySlug} » contient déjà des données; aucun écrasement n'est autorisé.`
    );
    process.exitCode = 1;
  } else {
    const walk = async (dir) => {
      const out = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.isFile()) out.push(full);
      }
      return out;
    };
    const files = existsSync(UPLOAD_DIR) ? await walk(UPLOAD_DIR) : [];
    const filesByName = new Map();
    for (const file of files) {
      const name = file.split(/[\\/]/).pop();
      if (!/^[\w.-]{1,200}$/.test(name) || name.includes("..")) {
        throw new Error(`Nom de fichier non pris en charge dans uploads/: ${name}`);
      }
      if (filesByName.has(name)) throw new Error(`Nom de fichier dupliqué dans uploads/: ${name}`);
      filesByName.set(name, file);
    }
    const missingPhotos = new Set();
    const parseGallery = (value) => {
      if (Array.isArray(value)) return value;
      if (!value) return [];
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("La galerie d'un véhicule n'est pas une liste.");
      return parsed;
    };
    for (const row of sqlite.prepare("SELECT gallery FROM vehicles").all()) {
      const gallery = parseGallery(row.gallery);
      for (const item of Array.isArray(gallery) ? gallery : []) {
        const value = typeof item === "string" ? item : item?.publicPath || item?.storedName || "";
        const name = String(value).split(/[\\/]/).pop();
        if (filesByName.has(name)) photoFiles.add(name);
        else if (value) missingPhotos.add(value);
      }
    }
    if (missingPhotos.size) {
      throw new Error(
        `Import refusé : ${missingPhotos.size} photo(s) de galerie sont absentes du dossier uploads/.`
      );
    }
    for (const row of sqlite.prepare(
      "SELECT stored_name FROM attachments WHERE stored_name IS NOT NULL AND stored_name <> ''"
    ).all()) {
      const name = String(row.stored_name).split(/[\\/]/).pop();
      if (!filesByName.has(name)) {
        throw new Error(`Import refusé : la pièce jointe locale « ${name} » est absente de uploads/.`);
      }
    }
    const mime = (file) => ({
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
    })[file.slice(file.lastIndexOf(".")).toLowerCase()] || "application/octet-stream";
    for (const [name, file] of filesByName) {
      const photo = photoFiles.has(name);
      const bucket = photo ? "photos" : "uploads";
      const key = photo
        ? `photos/photos/${agencyId}/${name}`
        : `uploads/${agencyId}/legacy/${name}`;
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": mime(file),
          },
          body: readFileSync(file),
        }
      );
      if (!response.ok) throw new Error(`Upload refusé pour ${key} (HTTP ${response.status}).`);
      uploadedFiles.push({ bucket, key });
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('request.headers', $1, true)", [
      JSON.stringify({ "x-agency-slug": agencySlug }),
    ]);

    let total = 0;
    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) {
        console.log(`  ${table.padEnd(14)} 0`);
        continue;
      }
      const target = new Set(await pgColumns(table));
      const cols = Object.keys(rows[0]).filter((c) => target.has(c));
      if (target.has("agency_id")) cols.push("agency_id");
      if (!cols.length) continue;

      // PGSQL n'accepte pas plus de 65535 paramètres par requête : on découpe.
      const CHUNK = Math.max(1, Math.floor(60000 / cols.length));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const values = [];
        const tuples = slice.map((row, r) => {
          const marks = cols.map((c, ci) => {
            let value = row[c] === undefined ? null : row[c];
            if (c === "agency_id") value = agencyId;
            if (table === "attachments" && c === "stored_name" && value) {
              value = `uploads/${agencyId}/legacy/${String(value).split(/[\\/]/).pop()}`;
            }
            if (table === "vehicles" && c === "gallery") {
              const gallery = Array.isArray(value) ? value : JSON.parse(value || "[]");
              value = JSON.stringify(
                (Array.isArray(gallery) ? gallery : []).flatMap((item) => {
                  const path = typeof item === "string" ? item : item?.publicPath || item?.storedName || "";
                  const name = String(path).split(/[\\/]/).pop();
                  return photoFiles.has(name)
                    ? [`${supabaseUrl}/storage/v1/object/public/photos/photos/${agencyId}/${encodeURIComponent(name)}`]
                    : [];
                })
              );
            }
            values.push(value);
            return `$${r * cols.length + ci + 1}`;
          });
          return `(${marks.join(", ")})`;
        });
        await client.query(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`,
          values
        );
      }
      total += rows.length;
      console.log(`  ${table.padEnd(14)} ${rows.length}`);
    }

    // Les identifiants viennent de SQLite : on recale les séquences PostgreSQL
    // sur le maximum réellement importé, sinon le prochain INSERT se heurte à la
    // clé primaire.
    for (const table of ["blocked_dates", "maintenance", "reservations", "payments", "attachments", "clients"]) {
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence($1, 'id'),
           COALESCE((SELECT MAX(id) FROM ${table}), 1),
           (SELECT MAX(id) FROM ${table}) IS NOT NULL
         )`,
        [table]
      );
    }
    await client.query("COMMIT");
    console.log(`\n${total} ligne(s) migree(s) vers Supabase.`);
  }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  for (const file of uploadedFiles) {
    const path = file.key.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${file.bucket}/${path}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) console.error(`Nettoyage du fichier importé impossible: ${file.key}`);
  }
  console.error("Echec de la migration :", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
}

if (!process.exitCode) console.log(`\n${uploadedFiles.length} fichier(s) importé(s) pour l'agence ${agencySlug}.`);