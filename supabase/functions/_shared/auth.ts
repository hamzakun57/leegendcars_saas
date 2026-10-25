/**
 * Contrôle d'accès des fonctions.
 *
 * Ces fonctions utilisent la clé « service_role », qui contourne toutes les
 * règles RLS. C'est précisément pour cela qu'elles ne doivent répondre qu'à un
 * administrateur identifié : chaque appel vérifie le jeton, puis le rôle.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ErreurHttp } from "./http.ts";

const projet = () => Deno.env.get("SUPABASE_URL") || "";
const service = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * Renvoie l'utilisateur authentifié, ou lève une erreur.
 * Le jeton est validé par Supabase lui-même : c'est lui qui vérifie la
 * signature et l'expiration, nous ne faisons que le lire.
 */
export async function exigerAdmin(requete: Request) {
  const entete = requete.headers.get("authorization") || "";
  const jeton = entete.replace(/^Bearer\s+/i, "").trim();
  if (!jeton) throw new ErreurHttp(401, "Session requise.");

  const serviceClient = createClient(projet(), service(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await serviceClient.auth.getUser(jeton);
  if (error || !data?.user) throw new ErreurHttp(401, "Session expirée, reconnectez-vous.");

  const agence = requete.headers.get("x-agency-id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agence)) {
    throw new ErreurHttp(400, "Agence manquante ou invalide.");
  }

  const { data: profil, error: e2 } = await serviceClient
    .from("agency_memberships")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("agency_id", agence)
    .eq("active", true)
    .maybeSingle();
  if (e2) throw e2;
  if (!profil || !["owner", "admin", "agent"].includes(profil.role)) {
    throw new ErreurHttp(403, "Ce compte n'appartient pas à cette agence.");
  }

  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!anon) throw new Error("SUPABASE_ANON_KEY manquante.");
  const client = createClient(projet(), anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${jeton}`,
        "x-agency-id": agence,
      },
    },
  });
  return { user: data.user, agencyId: agence, role: profil.role, client };
}

/** Client privilégié, à n'utiliser qu'après exigerAdmin(). */
export const clientService = () =>
  createClient(projet(), service(), { auth: { persistSession: false, autoRefreshToken: false } });
