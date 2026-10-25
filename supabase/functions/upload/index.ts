/**
 * Envoi et suppression de fichiers.
 *
 * Tout passe par ici : les photos de véhicules et les pièces jointes des
 * dossiers. C'est volontaire — la validation des octets ne peut pas être
 * exécutée dans le navigateur, donc le stockage n'est accessible qu'à cette
 * fonction, qui exige un administrateur authentifié.
 */
import { corps, ErreurHttp, gerer, json } from "../_shared/http.ts";
import { exigerAdmin } from "../_shared/auth.ts";
import {
  BUCKET, BUCKET_PHOTOS, cheminPublic, envoyer, MAX_DOC, MAX_ENVOI, MAX_PHOTO, nomSure, tailleLot, valider,
} from "../_shared/fichiers.ts";

Deno.serve((requete) =>
  gerer(requete, async () => {
    const { client, agencyId } = await exigerAdmin(requete);
    const data = await corps(requete);

    /* ---------- lecture temporaire d'une pièce de dossier ---------- */
    if (data.action === "signed-url") {
      const cle = nomSure(data.stored_name);
      const nomFichier = cle?.split("/").pop() || "";
      if (
        !cle ||
        !cle.startsWith(`${BUCKET}/${agencyId}/`) ||
        !/^[\w-]+\.(jpg|jpeg|png|webp|pdf)$/.test(nomFichier)
      ) {
        throw new ErreurHttp(400, "Fichier non reconnu.");
      }
      const { data: signe, error } = await client.storage
        .from(BUCKET)
        .createSignedUrl(cle, 5 * 60);
      if (error) throw error;
      if (!signe?.signedUrl) throw new Error("Impossible de créer le lien temporaire du fichier.");
      return json({ url: new URL(signe.signedUrl, Deno.env.get("SUPABASE_URL")).toString() });
    }

    /* ---------- suppression ---------- */
    if (data.action === "delete") {
      /* La clé est reconstruite par nomSure, jamais recopiée : une URL, un
         préfixe de bucket ou un nom nu donnent tous la même clé sûre. */
      const cle = nomSure(data.stored_name);
      if (!cle) throw new ErreurHttp(400, "Fichier non reconnu.");
      /* Deux emplacements possibles, tous deux contraints : la photo de flotte
         dans le bucket public, la pièce de dossier dans le bucket privé. */
      const nomFichier = cle.split("/").pop() as string;
      const estPhoto = cle.startsWith(`${BUCKET_PHOTOS}/photos/${agencyId}/`);
      const estPiece = cle.startsWith(`${BUCKET}/${agencyId}/`);
      if (!estPhoto && !estPiece) throw new ErreurHttp(400, "Fichier non reconnu.");
      const bucket = estPhoto ? BUCKET_PHOTOS : BUCKET;
      const dossier = cle.slice(0, cle.lastIndexOf("/"));

      let supprime = false;
      const { data: objets, error: erreurListe } = await client.storage
        .from(bucket)
        .list(dossier, { search: nomFichier, limit: 1000 });
      if (erreurListe) throw new Error(`Impossible de rechercher le fichier dans ${bucket} : ${erreurListe.message}`);
      if (objets?.some((objet) => objet.name === nomFichier)) {

        const { error: erreurSuppression } = await client.storage.from(bucket).remove([cle]);
        if (erreurSuppression) throw new Error(`Impossible de supprimer le fichier de ${bucket} : ${erreurSuppression.message}`);

        const { data: restants, error: erreurVerification } = await client.storage
          .from(bucket)
          .list(dossier, { search: nomFichier, limit: 1000 });
        if (erreurVerification) throw new Error(`Impossible de vérifier la suppression dans ${bucket} : ${erreurVerification.message}`);
        if (restants?.some((objet) => objet.name === nomFichier)) {
          throw new Error(`Le fichier ${nomFichier} est toujours présent dans ${bucket}.`);
        }
        supprime = true;
      }
      /* Suppression idempotente : une pièce déjà absente peut encore avoir
         une ligne de métadonnées, que l'administration doit pouvoir retirer. */
      return json({ ok: true, supprime });
    }

    const fichiers = Array.isArray(data.files) ? data.files : [];
    const avertissements: string[] = [];

    /* ---------- photos de véhicules ---------- */
    if (Array.isArray(data.photos)) {
      if (tailleLot(data.photos) > MAX_ENVOI) {
        throw new ErreurHttp(413, `Photos trop lourdes (max ${Math.round(MAX_ENVOI / 1048576)} Mo par envoi).`);
      }
      const chemins: string[] = [];
      for (const dataUrl of data.photos.slice(0, 12)) {
        try {
          const f = await envoyer(client, valider(dataUrl, { max: MAX_PHOTO, sousDossier: "photos", agencyId }));
          chemins.push(cheminPublic("photos", f.nom, agencyId));
        } catch (e) {
          avertissements.push(e instanceof Error ? e.message : String(e));
        }
      }
      return json({ ok: true, paths: chemins, warnings: avertissements });
    }

    /* ---------- pièces jointes d'un dossier ---------- */
    if (!data.reservation_id) throw new ErreurHttp(400, "Dossier manquant.");
    const { data: dossier, error } = await client
      .from("reservations")
      .select("id, status")
      .eq("id", Number(data.reservation_id))
      .maybeSingle();
    if (error) throw error;
    if (!dossier) throw new ErreurHttp(404, "Réservation introuvable.");
    if (dossier.status !== "confirmee" && dossier.status !== "livree") {
      throw new ErreurHttp(409, "Confirmez la réservation avant d'ajouter une pièce jointe.");
    }

    if (tailleLot(fichiers) > MAX_ENVOI) {
      throw new ErreurHttp(413, `Envoi trop lourd (max ${Math.round(MAX_ENVOI / 1048576)} Mo par envoi).`);
    }

    const kind = ["piece", "contrat", "facture", "permis"].includes(String(data.kind)) ? String(data.kind) : "piece";
    const nom = String(data.name || "").slice(0, 120) || "document";

    for (const dataUrl of fichiers.slice(0, 6)) {
      try {
        const f = await envoyer(client, valider(dataUrl, { max: MAX_DOC, allowPdf: true, sousDossier: "reservations", agencyId }));
        await client.from("attachments").insert({
          reservation_id: Number(data.reservation_id),
          kind,
          stored_name: f.chemin,
          original_name: nom,
          mime: f.mime,
          size: f.taille,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        avertissements.push(e instanceof Error ? e.message : String(e));
      }
    }

    const { data: pieces } = await client
      .from("attachments")
      .select("*")
      .eq("reservation_id", Number(data.reservation_id))
      .order("id", { ascending: false });

    if (!pieces || !pieces.length) {
      throw new ErreurHttp(422, avertissements.join(" ; ") || "Aucun fichier reçu.");
    }
    return json({ ok: true, attachments: pieces, warnings: avertissements }, 201);
  })
);
