import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260916100000_arch012_inbound_whatsapp_media_transcription_state/migration.sql",
  "utf8",
);

const enumBody = (name) => {
  const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing enum ${name}`);
  return match[1];
};

const modelBody = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[1];
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const conversation = modelBody("Conversation");
const message = modelBody("ConversationMessage");

for (const member of ["TEXT", "AUDIO", "UNSUPPORTED"]) {
  assert.match(enumBody("MessageContentType"), new RegExp(`\\b${member}\\b`));
}
for (const member of ["NOT_REQUIRED", "PENDING", "COMPLETED", "REJECTED", "FAILED"]) {
  assert.match(enumBody("MessageTranscriptionStatus"), new RegExp(`\\b${member}\\b`));
}

for (const [name, type, suffix] of [
  ["contentType", "MessageContentType", "@default(TEXT)"],
  ["providerMediaId", "String?", ""],
  ["providerMediaMimeType", "String?", ""],
  ["providerMediaSha256", "String?", ""],
  ["mediaDurationMs", "Int?", ""],
  ["transcriptionStatus", "MessageTranscriptionStatus", "@default(NOT_REQUIRED)"],
  ["transcriptionProvider", "String?", ""],
  ["transcriptionModel", "String?", ""],
  ["transcriptionFailureCode", "String?", ""],
  ["transcriptionCompletedAt", "DateTime?", ""],
]) {
  const expected = suffix
    ? `${escapeRegex(name)}\\s+${escapeRegex(type)}\\s+${escapeRegex(suffix)}`
    : `${escapeRegex(name)}\\s+${escapeRegex(type)}(?=\\s|$)`;
  assert.match(message, new RegExp(`\\b${expected}`));
}

assert.match(message, /providerMessageId\s+String\?\s+@unique/);
assert.match(message, /content\s+String/);
for (const forbidden of ["audioBytes", "rawAudio", "audioBlob", "mediaUrl", "downloadUrl", "providerMediaUrl"]) {
  assert.doesNotMatch(message, new RegExp(`\\b${forbidden}\\b`, "i"));
}
for (const field of ["inboundVersion", "lastProcessedVersion", "processingInboundVersion", "processingStartedAt", "lastInboundAt", "lastMessageAt"]) {
  assert.match(conversation, new RegExp(`\\b${field}\\b`));
}

assert.match(migration, /CREATE TYPE "whatsapp"\."MessageContentType" AS ENUM/);
assert.match(migration, /CREATE TYPE "whatsapp"\."MessageTranscriptionStatus" AS ENUM/);
for (const field of ["contentType", "providerMediaId", "providerMediaMimeType", "providerMediaSha256", "mediaDurationMs", "transcriptionStatus", "transcriptionProvider", "transcriptionModel", "transcriptionFailureCode", "transcriptionCompletedAt"]) {
  assert.match(migration, new RegExp(`ADD COLUMN "${field}"`));
}
assert.match(migration, /ck_arch012_conversation_message_media_duration_nonnegative/);
assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT)\s/im);

console.log("ARCH-012 inbound WhatsApp media/transcription schema validated");