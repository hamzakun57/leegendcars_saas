/**
 * Outils communs aux fonctions : réponses HTTP, erreurs et en-têtes CORS.
 *
 * Le navigateur appelle ces fonctions depuis le site Netlify : sans
 * en-têtes CORS explicites, la requête serait bloquée par le navigateur
 * avant même d'atteindre la fonction.
 */

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agency-id, x-agency-slug",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export class ErreurHttp extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function html(contenu: string): Response {
  return new Response(contenu, {
    headers: {
      ...CORS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      /* La passerelle sert en text/plain et confine la page dès qu'elle ne
         voit pas de politique de sécurité de contenu explicite : le client
         recevait le code source de la page de signature au lieu de la page.
         On déclare donc une politique qui autorise exactement ce qu'elle
         utilise — un style en ligne, un canevas, et le script local. */
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
    },
  });
}

/** Réponse à la requête de pré-vérification envoyée par le navigateur. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Enveloppe commune : le pré-vol, le JSON, et aucune fuite d'erreur interne. */
export function gerer(requete: Request, traitement: () => Promise<Response>): Promise<Response> {
  if (requete.method === "OPTIONS") return Promise.resolve(preflight());
  return traitement().catch((e) => {
    const status = e instanceof ErreurHttp ? e.status : 500;
    if (status >= 500) console.error("[erreur]", e);
    return json({ error: status >= 500 ? "Erreur du service." : e.message }, status);
  });
}

/** Lit un corps JSON sans planter si le client a envoyé autre chose. */
export async function corps(requete: Request): Promise<Record<string, unknown>> {
  try {
    return await requete.json();
  } catch {
    throw new ErreurHttp(400, "Requête illisible.");
  }
}
