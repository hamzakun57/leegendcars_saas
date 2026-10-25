/**
 * Fichiers : validation et stockage.
 *
 * La validation se fait sur la SIGNATURE BINAIRE du fichier, jamais sur son
 * nom ni sur le type déclaré par le navigateur — un fichier renommé en .jpg
 * n'est pas une image. C'est le même contrôle que celui du serveur
 * (server/uploads.js), et il est exécuté ici parce que c'est cette fonction
 * qui touche au stockage.
 */

export const BUCKET = "uploads";

/* Photos de flotte : bucket public, séparé des pièces de dossier. Le premier
   contenait tout ; sur Netlify il n'y a plus de serveur pour les servir, donc
   la vitrine de l.Positive était invisible. Les documents des clients, eux,
   doivent rester hors de portée : ils ne quittent pas « uploads ». */
export const BUCKET_PHOTOS = "photos";
const DOSSIER_PHOTOS = "photos";

/* Les chemins publics et les clés de stockage commencent tous deux par
   « uploads/ » : c'est ce qui permet à l'admin d'afficher /uploads/… sans
   changement et à la base de ne retenir que le nom du fichier.
   Conséquence à connaître : la clé contient déjà le nom du bucket, donc
   l'API de stockage attend /object/uploads/uploads/… . Ne pas « corriger » ce
   doublon d'un seul côté — l'envoi et la suppression doivent rester symétriques. */
const PREFIXE = "uploads/";

export const MAX_PHOTO = 5 * 1024 * 1024; // 5 Mo
export const MAX_DOC = 5 * 1024 * 1024; // 5 Mo
export const MAX_ENVOI = 4 * 1024 * 1024; // total par requête

const SIGNATURES = [
  { ext: ".jpg", mime: "image/jpeg", test: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: ".png",
    mime: "image/png",
    test: (b: Uint8Array) => {
      const t = [137, 80, 78, 71, 13, 10, 26, 10];
      return t.every((v, i) => b[i] === v);
    },
  },
  {
    ext: ".webp",
    mime: "image/webp",
    test: (b: Uint8Array) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
];

function ascii(b: Uint8Array, debut: number, fin: number): string {
  let s = "";
  for (let i = debut; i < fin && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** base64 -> octets. atob existe dans Deno comme dans Node. */
export function decoder(dataUrl: string): Uint8Array {
  const virgule = dataUrl.indexOf(",");
  const base64 = virgule >= 0 ? dataUrl.slice(virgule + 1) : dataUrl;
  /* atob lève un message anglais (« Failed to decode base64 ») qui remonte
     jusqu'à l'écran de l'agent. Le fichier est renvoyé tel quel, sans
     explication utile : on le dit en français et on nomme le coupable. */
  let binaire: string;
  try {
    binaire = atob(base64.replace(/\s/g, ""));
  } catch {
    throw new Error("image illisible : le fichier n'a pas pu être décodé");
  }
  const sortie = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) sortie[i] = binaire.charCodeAt(i);
  return sortie;
}

/** Taille réelle, en octets, d'un lot encodé en base64.
 *  Le remplissage final « = » compte pour rien : sans cette correction, un
 *  fichier est surestimé de deux octets et la garde « envoi trop lourd »
 *  finirait par refuser un envoi qui passe. */
export function tailleLot(dataUrls: unknown[]): number {
  return (dataUrls || []).reduce((total: number, d) => {
    const s = typeof d === "string" ? d : "";
    const i = s.indexOf(",");
    const base64 = (i >= 0 ? s.slice(i + 1) : s).replace(/\s/g, "");
    if (!base64) return total;
    const remplissage = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return total + Math.floor((base64.length * 3) / 4) - remplissage;
  }, 0);
}

export type FichierValide = { nom: string; chemin: string; mime: string; taille: number; contenu: Uint8Array };

/**
 * Valide un fichier et lui attribue un nom inexploitable.
 * @param sousDossier dossier dans le bucket (« » ou « reservations »)
 */
export function valider(
  dataUrl: unknown,
  { max = MAX_DOC, allowPdf = false, sousDossier = "", agencyId = "" }: {
    max?: number;
    allowPdf?: boolean;
    sousDossier?: string;
    agencyId?: string;
  } = {}
): FichierValide {
  if (typeof dataUrl !== "string" || !dataUrl) throw new Error("fichier vide");

  const contenu = decoder(dataUrl);
  if (!contenu.length) throw new Error("fichier vide");
  if (contenu.length > max) {
    throw new Error(`fichier trop lourd (max ${Math.round(max / 1048576)} Mo par fichier)`);
  }

  const signature = SIGNATURES.find((s) => s.test(contenu));
  const estPdf = ascii(contenu, 0, 5) === "%PDF-";
  if (!signature && !(allowPdf && estPdf)) {
    throw new Error("format non supporté (JPEG, PNG, WebP" + (allowPdf ? " ou PDF" : "") + ")");
  }

  const ext = signature ? signature.ext : ".pdf";
  const mime = signature ? signature.mime : "application/pdf";
  const nom = `${Date.now().toString(36)}-${jeton(12)}${ext}`;
  /* Le nom de bucket fait déjà partie de la clé (cf. PREFIXE) : même règle ici,
   sinon l'image serait cherchée à un emplacement qui n'a jamais existé. */
/* Même convention que PREFIXE : la clé porte le nom du bucket, une fois.
     Pour « photos », la clé est donc « photos/<nom> » — l'URL publique se
     compose ensuite bucket + clé, d'où « /public/photos/photos/<nom> ».
     Un niveau de trop et l'image est introuvable, sans la moindre erreur. */
const bucket = sousDossier === DOSSIER_PHOTOS ? BUCKET_PHOTOS : BUCKET;
  const chemin = sousDossier === DOSSIER_PHOTOS
    ? agencyId
      ? `${bucket}/${DOSSIER_PHOTOS}/${agencyId}/${nom}`
      : `${bucket}/${nom}`
    : agencyId
      ? `${bucket}/${agencyId}/${sousDossier || "documents"}/${nom}`
      : sousDossier
      ? `${bucket}/${sousDossier}/${nom}`
      : `${bucket}/${nom}`;
  return { nom, chemin, mime, taille: contenu.length, contenu };
}

function jeton(longueur: number): string {
  const octets = new Uint8Array(longueur);
  crypto.getRandomValues(octets);
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
}

/** Envoie un fichier validé dans le bucket. */
export async function envoyer(client: any, fichier: FichierValide): Promise<FichierValide> {
  const bucket = fichier.chemin.startsWith(`${BUCKET_PHOTOS}/`) ? BUCKET_PHOTOS : BUCKET;
  const { error } = await client.storage.from(bucket).upload(fichier.chemin, fichier.contenu, {
    contentType: fichier.mime,
    upsert: false,
  });
  if (error) throw new Error("Stockage refusé : " + error.message);

  /* Le stockage accuse réception sans toujours écrire : l'envoi paraissait
     réussi alors que l'image n'existait pas, et le site montrait des photos
     cassées. On relit donc la liste du dossier pour ne rapporter un succès
     que sur un fichier réellement présent. */
  const barre = fichier.chemin.lastIndexOf("/");
  const dossier = barre >= 0 ? fichier.chemin.slice(0, barre) : "";
  const attendu = fichier.chemin.slice(barre + 1);
  const { data: presents, error: e2 } = await client.storage.from(bucket).list(dossier, { limit: 1000 });
  if (e2) throw new Error("Stockage illisible : " + e2.message);
  if (!Array.isArray(presents) || !presents.some((o) => o.name === attendu)) {
    throw new Error(`Le fichier ${attendu} n'a pas pu être enregistré.`);
  }
  return fichier;
}

/**
 * Chemin public conservé en base et affiché dans l'admin.
 *
 * Les photos de flotte sont servies par le CDN : le chemin devient une URL
 * absolue, sinon le navigateur chercherait « photos/… » sur le site lui-même
 * et n'obtiendrait jamais d'image. Les pièces de dossier, privées, gardent un
 * chemin relatif — l'ancien serveur les lisait, et seul lui y a accès.
 */
export const cheminPublic = (sousDossier: string, nom: string, agencyId = "") => {
  /* Bucket « photos », clé « photos/<nom> » : l'URL porte donc les deux. */
  if (sousDossier === DOSSIER_PHOTOS) {
    const cle = agencyId
      ? `${BUCKET_PHOTOS}/${sousDossier}/${agencyId}/${nom}`
      : `${BUCKET_PHOTOS}/${sousDossier}/${nom}`;
    return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${cle}`;
  }
  return sousDossier ? `${BUCKET}/${sousDossier}/${nom}` : `${BUCKET}/${nom}`;
};

/**
 * Normalise un nom de fichier en clé de stockage, ou renvoie null.
 *
 * Les clés tenant-aware portent l'UUID de l'agence dans le chemin; les anciennes
 * formes restent reconnues pour le nettoyage contrôlé des fichiers importés.
 *
 * Aucun segment « .. », aucun préfixe inconnu : la valeur renvoyée est
 * reconstruite, jamais recopiée telle quelle.
 */
export function nomSure(nom: unknown): string | null {
  if (typeof nom !== "string" || !nom || nom.length > 300) return null;
  /* URL publique d'une photo de flotte → sa clé de stockage. */
  const brut = nom.includes("/storage/v1/object/public/")
    ? nom.split("/storage/v1/object/public/")[1]
    : nom;
  if (brut.includes("..") || brut.includes("//")) return null;

  const segments = brut.split("/").filter(Boolean);
  const dernier = segments[segments.length - 1] || "";
  if (!/^[\w-]+\.(jpg|jpeg|png|webp|pdf)$/.test(dernier)) return null;

  /* Le nom du bucket peut déjà être là ou pas : on le retire pour raisonner
     ensuite uniquement sur le dossier et le fichier. */
  let bucket = BUCKET;
  let reste = segments;
  if (segments[0] === BUCKET || segments[0] === BUCKET_PHOTOS) {
    bucket = segments[0];
    reste = segments.slice(1);
  }

  if (reste.length === 1) return `${bucket}/${reste[0]}`;
  if (reste.length === 2 && reste[0] === "reservations") return `${bucket}/reservations/${reste[1]}`;
  if (reste.length === 2 && reste[0] === DOSSIER_PHOTOS) return `${BUCKET_PHOTOS}/${reste[1]}`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (reste.length === 3 && uuid.test(reste[0]) && ["reservations", "documents"].includes(reste[1])) {
    return `${bucket}/${reste[0]}/${reste[1]}/${reste[2]}`;
  }
  if (bucket === BUCKET_PHOTOS && reste.length === 3 && reste[0] === DOSSIER_PHOTOS && uuid.test(reste[1])) {
    return `${BUCKET_PHOTOS}/${reste[0]}/${reste[1]}/${reste[2]}`;
  }
  return null;
}
