import { COMPANY } from "./company.js";

const champ = (settings: Record<string, unknown>, name: string, fallback: string): string => {
  const value = settings[name];
  return typeof value === "string" ? value.slice(0, 500) : fallback;
};

export async function companyForAgency(client: any, agencyId: string) {
  const { data, error } = await client
    .from("agencies")
    .select("name, settings")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Agence introuvable.");
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  return {
    ...COMPANY,
    legalName: champ(settings, "legalName", data.name),
    shortName: champ(settings, "brand", data.name),
    phone: champ(settings, "phonePrimary", ""),
    email: champ(settings, "email", ""),
    addressOneLine: champ(settings, "address", ""),
    ice: champ(settings, "ice", ""),
    rc: champ(settings, "rc", ""),
  };
}
