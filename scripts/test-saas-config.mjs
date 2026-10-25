import assert from "node:assert/strict";
import { databaseTargetsProject, isLegacyProject } from "./saas-config.mjs";

assert.equal(
  databaseTargetsProject("postgresql://postgres:secret@db.saastest123.supabase.co:5432/postgres", "saastest123"),
  true
);
assert.equal(
  databaseTargetsProject(
    "postgresql://postgres.saastest123:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "saastest123"
  ),
  true
);
assert.equal(
  databaseTargetsProject(
    "postgresql://postgres.wrongproject:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "saastest123"
  ),
  false
);
assert.equal(
  databaseTargetsProject("postgresql://postgres:secret@db.saastest123.supabase.co:5432/postgres", "wrongproject"),
  false
);
assert.equal(isLegacyProject("dqygspzmndcsbkxeiulm"), true);
assert.equal(isLegacyProject("DQYGSPZMNDCSBKXEIULM"), true);
assert.equal(isLegacyProject("saastest123"), false);

console.log("Configuration SaaS validée : URL DB alignée et projet historique refusé.");
