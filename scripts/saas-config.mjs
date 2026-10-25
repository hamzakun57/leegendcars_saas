export const LEGACY_PROJECT_REF = "dqygspzmndcsbkxeiulm";

export const isLegacyProject = (projectRef) =>
  String(projectRef || "").trim().toLowerCase() === LEGACY_PROJECT_REF;

export const databaseTargetsProject = (connectionString, projectRef) => {
  try {
    const databaseUrl = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) return false;
    const directRef = databaseUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
    const poolerRef = databaseUrl.hostname.match(/(?:^|\.)pooler\.supabase\.com$/i)
      ? decodeURIComponent(databaseUrl.username).match(/^postgres\.([a-z0-9]+)$/i)?.[1]
      : "";
    const targetRef = directRef || poolerRef;
    return !!targetRef && targetRef.toLowerCase() === String(projectRef || "").trim().toLowerCase();
  } catch {
    return false;
  }
};
