import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  path.join(
    root,
    "prisma/migrations/20261006073000_arch029_prompt_revision_provenance/migration.sql",
  ),
  "utf8",
);

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

const revision = prismaBlock("model", "CommerceAgentPromptRevision");
assert.match(
  revision,
  /^\s*sourceContext\s+Json\?\s+@db\.JsonB/m,
  "prompt revisions must expose nullable JSONB sourceContext provenance",
);
assert.match(revision, /^\s*sourceTemplateId\s+String\?/m);
assert.match(revision, /^\s*sourceTemplateEditVersion\s+Int\?/m);

assert.match(
  migration,
  /ALTER TABLE "commerce"\."CommerceAgentPromptRevision"[\s\S]*ADD COLUMN "sourceContext" JSONB;/,
);
assert.doesNotMatch(
  migration,
  /"sourceContext" JSONB NOT NULL/,
  "existing prompt revisions must remain valid without fabricated provenance",
);
assert.doesNotMatch(
  migration,
  /UPDATE\s+"commerce"\."CommerceAgentPromptRevision"/i,
  "DATABASE-003 must not infer historical sourceContext from existing prompt text",
);
assert.doesNotMatch(
  migration,
  /(?:ALTER|CREATE|DROP) TABLE "support"\./,
  "DATABASE-003 must not touch support translation persistence",
);

console.log("ARCH-029 prompt revision provenance schema validation passed.");
