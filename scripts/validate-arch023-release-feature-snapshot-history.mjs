import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20260930200000_arch023_release_feature_snapshot_history/migration.sql', import.meta.url), 'utf8');
const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const schema = readFileSync(schemaPath, 'utf8');

assert.match(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+commerce\.arch021_release_feature_guard\s*\(/i,
  'The fixed migration must replace the existing release Feature guard function');
assert.match(migration, /^\s*CREATE\s+OR\s+REPLACE\s+FUNCTION\s+commerce\.arch021_release_feature_guard\s*\(\)\s+RETURNS\s+trigger\s+LANGUAGE\s+plpgsql\s+AS\s+\$\$[\s\S]*\$\$;\s*$/i,
  'The migration must contain only the replacement body for the named guard function');
assert.match(migration, /PERFORM\s+1\s+FROM\s+billing\."Feature"\s+WHERE\s+id\s*=\s*NEW\."featureId"\s+FOR\s+SHARE/i,
  'The Feature FOR SHARE concurrency lock must remain');
assert.match(migration, /SELECT\s+"behaviourPrompt"\s+INTO\s+current_prompt[\s\S]*?FROM\s+commerce\."CommerceFeatureConfiguration"[\s\S]*?WHERE\s+"featureId"\s*=\s*NEW\."featureId"/i,
  'Current Feature behaviour lookup must remain scoped to the incoming Feature');
assert.match(migration, /IF\s+NOT\s+FOUND\s+THEN\s+current_prompt\s*:=\s*''\s*;\s*END\s+IF/i,
  'A missing current configuration must retain the empty-string fallback');
assert.match(migration, /IF\s+NEW\."behaviourPrompt"\s+IS\s+DISTINCT\s+FROM\s+current_prompt\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+commerce\."CommerceReleaseFeature"\s+AS\s+prior\s+WHERE\s+prior\."featureId"\s*=\s*NEW\."featureId"\s+AND\s+prior\."behaviourPrompt"\s*=\s*NEW\."behaviourPrompt"\s*\)/i,
  'Historical prompt admission must exactly match both Feature identity and prompt text');
assert.match(migration, /RAISE\s+EXCEPTION[\s\S]*?USING\s+ERRCODE\s*=\s*'23514'/i,
  'A prompt matching neither current nor persisted Feature history must raise SQLSTATE 23514');
assert.doesNotMatch(migration, /\b(?:DROP\s+TRIGGER|DISABLE\s+TRIGGER|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i,
  'The migration must not alter tables or remove/disable triggers');
assert.doesNotMatch(migration, /\b(?:current_setting|set_config|session_user|bypass|disable_trigger)\b/i,
  'The migration must not introduce a session or bypass flag');
assert.equal((migration.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).length, 1,
  'The migration must replace exactly one function and add no other function');

try {
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'prisma/schema.prisma'], {
    cwd: new URL('..', import.meta.url),
  });
} catch {
  assert.fail('This task must not modify prisma/schema.prisma');
}
assert.ok(schema.includes('model CommerceReleaseFeature'), 'The existing release Feature Prisma model must remain present');

console.log('ARCH-023 release Feature snapshot history static contract passed.');