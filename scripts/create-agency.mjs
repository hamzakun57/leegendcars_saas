/* Crée un tenant SaaS et son propriétaire sans toucher aux autres agences. */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { databaseTargetsProject, isLegacyProject } from "./saas-config.mjs";

const ref = (process.env.SAAS_PROJECT_REF || "").trim();
const url = (process.env.SAAS_SUPABASE_URL || "").replace(/\/+$/, "");
const service = process.env.SAAS_SUPABASE_SERVICE_ROLE_KEY || "";
const database = process.env.SAAS_DATABASE_URL || "";
const slug = (process.argv[2] || "").trim().toLowerCase();
const name = (process.argv[3] || "").trim();
const email = (process.argv[4] || "").trim().toLowerCase();
const hostRef = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i)?.[1]?.toLowerCase() || "";

if (
  !ref ||
  isLegacyProject(ref) ||
  hostRef !== ref.toLowerCase() ||
  !service ||
  !database ||
  !databaseTargetsProject(database, ref)
) {
  throw new Error("Configurez les variables SAAS_* du nouveau projet avant de créer une agence.");
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  throw new Error("Usage : node scripts/create-agency.mjs <slug> <nom-agence> <email-propriétaire>");
}

const headers = {
  apikey: service,
  Authorization: `Bearer ${service}`,
  "Content-Type": "application/json",
};
const pool = new pg.Pool({ connectionString: database, ssl: { rejectUnauthorized: false } });
let authUserId = null;
let authUserCreated = false;
let initialPassword = "";

try {
  const existing = await pool.query("SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1", [email]);
  if (existing.rowCount) {
    authUserId = existing.rows[0].id;
  } else {
    initialPassword = randomBytes(18).toString("base64url");
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password: initialPassword, email_confirm: true }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id) {
      throw new Error(`Création du compte propriétaire refusée (${response.status}).`);
    }
    authUserId = body.id;
    authUserCreated = true;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const agencyResult = await client.query(
      `INSERT INTO public.agencies (slug, name, settings)
       VALUES ($1, $2, jsonb_build_object('brand', $2::text))
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, name`,
      [slug, name]
    );
    let agency = agencyResult.rows[0];
    if (!agency) {
      const existingAgency = await client.query(
        "SELECT id, name FROM public.agencies WHERE slug = $1 FOR UPDATE",
        [slug]
      );
      agency = existingAgency.rows[0];
      if (!agency || agency.name !== name) {
        throw new Error("Ce slug existe déjà avec un autre nom; aucun changement n'a été effectué.");
      }
    }

    const existingMembership = await client.query(
      "SELECT role, active FROM public.agency_memberships WHERE agency_id = $1 AND user_id = $2 FOR UPDATE",
      [agency.id, authUserId]
    );
    if (existingMembership.rowCount) {
      if (existingMembership.rows[0].role !== "owner" || !existingMembership.rows[0].active) {
        throw new Error("Ce compte possède déjà une adhésion non-propriétaire ou inactive pour cette agence.");
      }
    } else {
      const defaultResult = await client.query(
        "SELECT 1 FROM public.agency_memberships WHERE user_id = $1 AND active AND is_default LIMIT 1",
        [authUserId]
      );
      await client.query(
        `INSERT INTO public.agency_memberships (agency_id, user_id, role, active, is_default)
         VALUES ($1, $2, 'owner', true, $3)`,
        [agency.id, authUserId, defaultResult.rowCount === 0]
      );
    }
    await client.query("COMMIT");
    console.log(`Agence « ${agency.name} » prête (${slug}); propriétaire associé.`);
    if (authUserCreated) {
      console.log(`Mot de passe initial (à transmettre au propriétaire) : ${initialPassword}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  if (authUserCreated && authUserId) {
    const response = await fetch(`${url}/auth/v1/admin/users/${authUserId}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok && response.status !== 404) {
      console.error("Le compte Auth créé n'a pas pu être supprimé automatiquement.");
    }
  }
  throw error;
} finally {
  await pool.end();
}
