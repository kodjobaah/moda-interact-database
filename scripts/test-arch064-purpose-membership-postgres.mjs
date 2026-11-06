import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const name = `moda-arch064-${randomUUID()}`;
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 16*1024*1024 });
const sql = (input) => docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','fixture'], input);
function rejects(statement, state) {
 sql(`DO $test$ DECLARE caught text; BEGIN BEGIN ${statement}; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; IF caught <> '${state}' THEN RAISE; END IF; END; IF caught IS NULL THEN RAISE EXCEPTION 'Expected ${state}'; END IF; END $test$;`);
}
try {
 docker(['run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fixture','pgvector/pgvector:pg17']);
 let ready=false; for(let n=0;n<60;n++){try{sql('SELECT 1');ready=true;break;}catch{await delay(1000);}} assert.ok(ready);
 // Fresh full migration-chain proof in a separate disposable database.
 sql('CREATE DATABASE migration_chain');
 const migrations = new URL('../prisma/migrations/', import.meta.url);
 for (const entry of readdirSync(migrations).filter(n => /^\d{14}_/.test(n)).sort()) {
   docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','migration_chain'],readFileSync(new URL(`${entry}/migration.sql`,migrations),'utf8'));
 }
 console.log('PASS fresh full migration chain including ARCH-064');
 // Minimal accepted parent-key fixture: test actual new migration, without any service/tenant authorisation claims.
 sql(`CREATE SCHEMA billing; CREATE SCHEMA commerce;
 CREATE TABLE billing."Feature"(id text PRIMARY KEY);
 CREATE TABLE commerce."CommerceCapability"(id text PRIMARY KEY, "featureId" text REFERENCES billing."Feature");
 CREATE TABLE commerce."CommerceReleaseFeature"("releaseId" text,"featureId" text,PRIMARY KEY("releaseId","featureId"));
 CREATE TABLE commerce."CommerceReleaseCapability"("releaseId" text,"capabilityId" text,PRIMARY KEY("releaseId","capabilityId"));
 CREATE FUNCTION commerce.arch020_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable' USING ERRCODE='23514'; END $$;
 INSERT INTO billing."Feature" VALUES('purpose'),('owner');
 INSERT INTO commerce."CommerceCapability" VALUES('one','owner'),('two','owner');
 INSERT INTO commerce."CommerceReleaseFeature" VALUES('release-a','purpose'),('release-b','purpose');
 INSERT INTO commerce."CommerceReleaseCapability" VALUES('release-a','one'),('release-a','two'),('release-b','one');`);
 sql(readFileSync(new URL('../prisma/migrations/20261106192000_arch064_purpose_capability_membership/migration.sql',import.meta.url),'utf8'));
 sql(`INSERT INTO commerce."CommercePurposeCapability" VALUES('purpose','one',0); INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-a','purpose','one',0);`);
 rejects(`INSERT INTO commerce."CommercePurposeCapability" VALUES('purpose','two',0)`, '23505');
 rejects(`INSERT INTO commerce."CommercePurposeCapability" VALUES('purpose','two',-1)`, '23514');
 rejects(`INSERT INTO commerce."CommercePurposeCapability" VALUES('purpose','missing',1)`, '23503');
 rejects(`INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-b','purpose','two',1)`, '23503');
 rejects(`INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-c','purpose','one',1)`, '23503');
 rejects(`INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-a','missing','one',1)`, '23503');
 rejects(`INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-a','purpose','two',0)`, '23505');
 rejects(`INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-a','purpose','two',-1)`, '23514');
 rejects(`UPDATE commerce."CommerceReleasePurposeCapability" SET position=1`, '23514');
 rejects(`DELETE FROM commerce."CommerceReleasePurposeCapability"`, '23514');
 rejects(`DELETE FROM commerce."CommerceReleaseCapability" WHERE "releaseId"='release-a' AND "capabilityId"='one'`, '23503');
 rejects(`DELETE FROM commerce."CommerceReleaseFeature" WHERE "releaseId"='release-a'`, '23503');
 rejects(`DELETE FROM commerce."CommerceCapability" WHERE id='one'`, '23503');
 rejects(`DELETE FROM billing."Feature" WHERE id='purpose'`, '23503');
 sql(`UPDATE commerce."CommercePurposeCapability" SET position=2; DELETE FROM commerce."CommercePurposeCapability"; INSERT INTO commerce."CommerceReleasePurposeCapability" VALUES('release-a','purpose','two',1);`);
 assert.equal(sql(`SELECT "featureId" FROM commerce."CommerceCapability" WHERE id='one'`).includes('owner'),true);
 console.log('PASS ARCH-064 migration: same-release references, ownership preserved, editable draft, checks/uniqueness/restrict/immutability (14 rejected mutations).');
} finally { docker(['rm','-f',name]); }
