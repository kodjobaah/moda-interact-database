import {columns,enums} from './arch020-commerce-schema-contract.mjs';
// Synthetic direct-SQL fixtures. These are database tests, not Commerce services.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Fixture-only canonical serialization: these definitions contain ASCII keys and
// strings, objects and arrays; no numbers requiring RFC 8785 number handling.
const canonicalFixture = v => Array.isArray(v) ? `[${v.map(canonicalFixture).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonicalFixture(v[k])}`).join(',')}}` : JSON.stringify(v);
const responseHash = v => createHash('sha256').update(canonicalFixture(v)).digest('hex');
const baselineResponse = {version:'response.v1',instructions:'Write a concise, natural WhatsApp reply supported by the available facts. Return an empty details object.',detailsSchema:{type:'object',properties:{},required:[],additionalProperties:false}};
const customResponse = {...baselineResponse,instructions:'Provide a concise reply and a brief reason.',detailsSchema:{type:'object',properties:{reason:{type:'string',maxLength:200}},required:['reason'],additionalProperties:false}};
export const lit = v => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'${typeof v === 'object' ? '::jsonb' : ''}`;
export const insertSql = (table, row) => `INSERT INTO ${table} (${Object.keys(row).map(k=>`"${k}"`).join(',')}) VALUES (${Object.values(row).map(lit).join(',')})`;
const c = name => `commerce."${name}"`;
// Prisma's raw-query adapter omits PostgreSQL constraint names for some codes.
// Preserve the server's own stacked diagnostics; never infer the violated guard.
const diagnosed = text => `DO $arch020_test$ DECLARE failure_code text; failure_message text; failure_constraint text; failure_column text;
BEGIN ${text};
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE,failure_message=MESSAGE_TEXT,failure_constraint=CONSTRAINT_NAME,failure_column=COLUMN_NAME;
  RAISE EXCEPTION USING ERRCODE=failure_code,MESSAGE=failure_message,DETAIL=format('%s; constraint=%s; column "%s"',failure_message,failure_constraint,failure_column);
END $arch020_test$`;
const now = '2026-09-20T00:00:00.000Z';
export async function seedLegacy(db) {
  const rows = [
    ['commerce."Shop"',{id:'s1',domain:'arch020-one.invalid',updatedAt:now}],
    ['commerce."Shop"',{id:'s2',domain:'arch020-two.invalid',updatedAt:now}],
    ['public."PlatformAdmin"',{id:'admin2',email:'arch020-alternate@example.invalid',role:'SUPER_ADMIN',updatedAt:now}],
    ['public."PlatformAdmin"',{id:'admin',email:'arch020@example.invalid',role:'SUPER_ADMIN',updatedAt:now}],
    ['billing."Feature"',{id:'feature',key:'arch020_fixture',displayName:'Synthetic feature',activationMode:'MERCHANT_OPT_IN',updatedAt:now}],
    ['billing."ShopFeaturePreference"',{id:'preference',shopId:'s1',featureId:'feature',enabled:true,updatedAt:now}],
    ['shopify."ShopSettings"',{id:'settings',shopId:'s1',recoveryOfferMode:'NONE',updatedAt:now}],
    ['shopify."ShopifyDiscountCatalogue"',{id:'catalogue',shopId:'s1',updatedAt:now}],
    ['shopify."ShopifyDiscount"',{id:'discount',shopId:'s1',shopifyDiscountNodeId:'fixture-discount',providerType:'DiscountAutomaticBasic',method:'AUTOMATIC',providerStatus:'ACTIVE',title:'Synthetic offer',providerSnapshot:{fixture:true},lastSeenSyncGeneration:0,lastSyncedAt:now,updatedAt:now}],
    ['shopify."ShopRecoveryPolicyOverride"',{id:'policy',shopId:'s1',recoveryDelayMinutes:30,recoveryOfferMode:'NONE',followUpEnabled:false,reason:'Synthetic policy',updatedByPlatformAdminId:'admin',updatedAt:now}],
  ];
  for (const row of rows) await db.$executeRawUnsafe(insertSql(...row));
  for (let i=1;i<=12;i++) {
    await db.$executeRawUnsafe(insertSql('commerce."CheckoutRecovery"',{id:`r${i}`,shopId:i===12?'s2':'s1',checkoutToken:`fixture-${i}`,lastExternalActivityAt:now,updatedAt:now}));
    await db.$executeRawUnsafe(insertSql('whatsapp."Conversation"',{id:`v${i}`,checkoutRecoveryId:`r${i}`,type:'RECOVERY',inboundVersion:2,updatedAt:now}));
  }
  await db.$executeRawUnsafe(insertSql('commerce."CheckoutRecovery"',{id:'unlinked',shopId:'s1',checkoutToken:'unlinked',lastExternalActivityAt:now,updatedAt:now}));
  await db.$executeRawUnsafe(insertSql('whatsapp."Conversation"',{id:'standalone',shopId:'s1',type:'RECOVERY',inboundVersion:1,updatedAt:now}));
}
export async function runCases(db, second) {
  let passed=0;
  const pass = name => { passed++; console.log(`PASS ${name}`); };
  const sql = text => db.$executeRawUnsafe(text);
  const add = (table,row) => sql(insertSql(c(table),row));
  const controls = {};
  let sequence=0;
  const rollback = Symbol('fixture rollback');
  async function isolated(action) {
    try { await db.$transaction(async tx=>{await action(tx);throw rollback;},{timeout:20000}); }
    catch(error) {if(error!==rollback) throw error;}
  }
  // Exact expected SQLSTATE and constraint/trigger diagnostic. No catch-all codes.
  const expected = new Map();
  const expect = (code,diagnostic,names) => names.forEach(name=>expected.set(name,{code,diagnostic}));
  const check = (name,error,contract=expected.get(name)) => {
    assert.ok(contract,`${name}: missing explicit failure contract`);
    assert.equal(error.meta?.code,contract.code,`${name}: wrong SQLSTATE: ${error.meta?.message}`);
    assert.ok(error.meta?.message?.includes(contract.diagnostic),`${name}: expected ${contract.diagnostic}; got ${error.meta?.message}`);
  };
  async function rejectsExactly(name,action,contract) {
    try {await action();} catch(error) {check(name,error,contract);return;}
    assert.fail(`${name}: invalid SQL succeeded`);
  }
  const reject = async (name,text) => {
    await rejectsExactly(name,()=>isolated(tx=>tx.$executeRawUnsafe(diagnosed(text)))); pass(name);
  };
  const bad = async (name,table,row,valid) => {
    const unique=++sequence;
    const setup = async (tx,invalid) => {
      let control={...controls[table],...(valid??{})};
      let candidate={...row};
      if ('id' in candidate) {candidate.id=`negative_${unique}`;control.id=candidate.id;}
      // Every malformed revision gets a real, unique owner, leaving uniqueness
      // violations exclusively to the three explicitly named duplicate tests.
      if (!name.startsWith('duplicate') && table==='CommerceToolRevision') {
        const toolId=`negative_tool_${unique}`;
        await tx.$executeRawUnsafe(insertSql(c('CommerceTool'),{id:toolId,name:toolId,displayName:'Control'}));
        for(const entry of [candidate,control]) {
          entry.toolId=toolId;
          if(entry.definition?.name==='read_product') entry.definition={...entry.definition,name:toolId};
        }
      }
      if (!name.startsWith('duplicate') && table==='CommerceCapabilityRevision') {
        const capabilityId=`negative_cap_${unique}`;
        await tx.$executeRawUnsafe(insertSql(c('CommerceCapability'),{id:capabilityId,key:capabilityId,displayName:'Control',selectionBinding:'FEATURE',featureId:'feature'}));
        candidate.capabilityId=capabilityId;control.capabilityId=capabilityId;
      }
      if(invalid&&['bindings count bound','bindings byte bound insert'].includes(name)) {
        for(const [index,binding] of candidate.toolBindings.entries()) {
          const toolName=`size_tool_${index}`;
          await tx.$executeRawUnsafe(insertSql(c('CommerceTool'),{id:binding.toolId,name:toolName,displayName:'Size control'}));
          await tx.$executeRawUnsafe(insertSql(c('CommerceToolRevision'),{...controls.CommerceToolRevision,id:binding.toolRevisionId,toolId:binding.toolId,definition:{...controls.CommerceToolRevision.definition,name:toolName},status:'PUBLISHED',publishedByAdminId:'admin',publishedAt:now,createdAt:now,contentHash:'a'.repeat(64)}));
        }
      }
      if(invalid&&name==='selected keys count') {
        const releaseId='selected-count-release';
        await tx.$executeRawUnsafe(insertSql(c('CommerceRelease'),{...controls.CommerceRelease,id:releaseId}));
        await tx.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId,capabilityId:'core',capabilityRevisionId:'cr0',position:0}));
        for(const [index,key] of candidate.selectedCapabilityKeys.slice(1).entries()) {
          await tx.$executeRawUnsafe(insertSql(c('CommerceCapability'),{id:key,key,displayName:key,selectionBinding:'FEATURE',featureId:'feature'}));
          await tx.$executeRawUnsafe(insertSql(c('CommerceCapabilityRevision'),{...controls.CommerceCapabilityRevision,id:`rev_${key}`,capabilityId:key,status:'PUBLISHED',publishedByAdminId:'admin',publishedAt:now,createdAt:now,contentHash:'a'.repeat(64)}));
          await tx.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId,capabilityId:key,capabilityRevisionId:`rev_${key}`,position:index+1}));
        }
        candidate.releaseId=releaseId;
      }
      if(invalid&&name==='grant tools byte bound') {
        const releaseId='wide-grant-release';
        await tx.$executeRawUnsafe(insertSql(c('CommerceRelease'),{...controls.CommerceRelease,id:releaseId}));
        const bindings=[];
        for(let index=0;index<32;index++) {
          const toolId=`wide_tool_${index}`,toolRevisionId=`wide_revision_${index}`;
          await tx.$executeRawUnsafe(insertSql(c('CommerceTool'),{id:toolId,name:toolId,displayName:'Wide control'}));
          await tx.$executeRawUnsafe(insertSql(c('CommerceToolRevision'),{...controls.CommerceToolRevision,id:toolRevisionId,toolId,definition:{...controls.CommerceToolRevision.definition,name:toolId},status:'PUBLISHED',createdAt:now,publishedAt:now,publishedByAdminId:'admin',contentHash:'a'.repeat(64)}));
          bindings.push({toolId,toolRevisionId});
        }
        const keys=['conversation_core',...Array.from({length:31},(_,index)=>`wide_${String(index).padStart(2,'0')}_${'x'.repeat(120)}`)].sort();
        for(const [index,key] of keys.entries()) {
          const capabilityId=key==='conversation_core'?'core':`wide_cap_${index}`;
          if(capabilityId!=='core') await tx.$executeRawUnsafe(insertSql(c('CommerceCapability'),{id:capabilityId,key,displayName:'Wide control',selectionBinding:'FEATURE',featureId:'feature'}));
          const revisionId=`wide_cap_rev_${index}`;
          await tx.$executeRawUnsafe(insertSql(c('CommerceCapabilityRevision'),{...controls.CommerceCapabilityRevision,id:revisionId,capabilityId,revisionNumber:100,toolBindings:bindings,status:'PUBLISHED',createdAt:now,publishedAt:now,publishedByAdminId:'admin',contentHash:'a'.repeat(64)}));
          await tx.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId,capabilityId,capabilityRevisionId:revisionId,position:index}));
        }
        candidate.releaseId=releaseId;candidate.selectedCapabilityKeys=keys;
        candidate.grantedTools=bindings.map(binding=>({...binding,toolName:binding.toolId,definitionVersion:'1.0.0',capabilityKeys:keys}));
        assert.ok(Buffer.byteLength(JSON.stringify(candidate.grantedTools))>65536);
      }
      if(table==='CommerceCapability'&&!name.startsWith('duplicate')&&['conversation_core','discount_assistance'].includes(candidate.key)) await tx.$executeRawUnsafe(`DELETE FROM ${c(table)} WHERE key=${lit(candidate.key)}`);
      await tx.$executeRawUnsafe(invalid?diagnosed(insertSql(c(table),candidate)):insertSql(c(table),control));
    };
    // A successful control is required for every non-uniqueness insertion case.
    if (!name.startsWith('duplicate') && !['release number unique','member position unique','one lifetime grant despite later turn'].includes(name)) {
      await isolated(tx=>setup(tx,false));pass(`${name}: valid control`);
    }
    await rejectsExactly(name,()=>isolated(tx=>setup(tx,true)));pass(name);
  };
  expect('23514','arch020_capability_selection',['invalid base','core requires BASE','feature without FK','non-feature with FK','recovery-policy key']);
  expect('23514','arch020_capability_bounds',['capability description bound','capability nonblank','capability key regex']);
  expect('22001','character varying(255)',['capability display bound']);
  expect('23505','CommerceCapability_key_key',['duplicate capability key']);
  expect('23505','CommerceToolRevision_toolId_revisionNumber_key',['duplicate tool revision']);
  expect('23505','CommerceToolRevision_toolId_definitionVersion_key',['duplicate definition version']);
  expect('23514','ARCH020 definition identity mismatch',['definition wrong name','definition wrong version','definition array']);
  expect('23514','arch020_tool_revision_bounds',['definition extra key','definition missing key','definition input scalar','definition execution scalar','definition template scalar','definition size bound','tool revision number positive','tool edit version nonnegative']);
  expect('23514','arch020_tool_publication',['draft publication fields']);
  expect('23514','ARCH020 revision identity or editVersion',['tool draft increment required','tool creator immutable','capability draft increment required','capability revision creator immutable','capability revision identity immutable']);
  expect('23514','ARCH020 tool identity',['tool identity immutable']);
  expect('23505','CommerceCapabilityRevision_capabilityId_revisionNumber_key',['duplicate capability revision']);
  expect('23514','arch020_capability_revision_bounds',['prompt nonblank','prompt whitespace only','prompt length bound','configuration object','configuration byte bound','capability revision positive','capability edit nonnegative','contract nonblank']);
  expect('23514','ARCH020 malformed bindings',['bindings array','bindings exact keys','bindings duplicate tools','bindings count bound','bindings ID bound','bindings byte bound insert']);
  expect('23514','ARCH020 binding requires matching published tool',['bindings wrong tool','bindings missing revision','draft tool cannot bind']);
  expect('23514','arch020_capability_publication',['publication missing attribution','publication hash invalid','publication before creation']);
  expect('23514','ARCH020 capability selection immutable',['capability identity immutable']);
  expect('23505','CommerceRelease_releaseNumber_key',['release number unique']);
  expect('23514','arch020_release_bounds',['release number positive','release description bound','runner compatibility nonblank']);
  expect('23514','ARCH020 member requires matching published capability',['draft membership','wrong capability membership']);
  expect('23505','CommerceReleaseCapability_releaseId_position_key',['member position unique']);
  expect('23514','arch020_member_position',['member position nonnegative']);
  expect('23514','ARCH020 conflicting release tool revisions',['conflicting tool revisions in release']);
  expect('23514','ARCH020 empty release',['empty release activation']);
  expect('23514','ARCH020 pointer identity or editVersion',['pointer increment required']);
  expect('23514','arch020_audit_targets',['audit requires capability','audit release target','audit environment target','audit tool target','audit tool revision target']);
  expect('23514','ARCH020 audit capability mismatch',['audit revision ownership']);
  expect('23514','ARCH020 audit tool mismatch',['audit tool revision ownership']);
  expect('23514','arch020_audit_bounds',['audit reason nonblank','audit metadata object','audit metadata bytes']);
  expect('22001','character varying(1000)',['audit reason bound']);
  expect('23514','ARCH020 recovery conversation required',['standalone conversation','missing conversation','sentinel recovery cannot grant']);
  expect('23514','ARCH020 grant owner or inbound version mismatch',['wrong shop','future inbound version','conflicting legacy conversation shop']);
  expect('23514','arch020_grant_bounds',['positive inbound version','grant invalid retention time','grant runner nonblank']);
  expect('23514','ARCH020 selected key outside release',['empty release grant','foreign selected key']);
  expect('23514','ARCH020 grant shape',['selected keys require base','selected keys unique','selected keys type','selected keys count','grant tools byte bound','grant duplicate tool','grant duplicate name','grant unsorted provenance','grant extra keys']);
  expect('23514','ARCH020 grant must equal complete tool union',['grant tool omission','grant wrong revision','grant wrong name','grant wrong version','grant missing provenance','grant unselected provenance']);
  expect('23505','CommerceConversationGrant_conversationId_key',['one lifetime grant despite later turn']);
  for(const table of ['CommerceCapabilityRevision','CommerceToolRevision']) expect('23514','ARCH020 published revision immutable',[`${table} update immutable`,`${table} delete immutable`]);
  for(const table of ['CommerceRelease','CommerceAuditEvent','CommerceConversationGrant']) expect('23514',`ARCH020 immutable ${table}`,[`${table} update immutable`,`${table} delete immutable`]);
  expect('23514','ARCH020 immutable CommerceReleaseCapability',['member update immutable','member delete immutable']);
  expect('23514','ARCH020 tool name immutable',['tool rename immutable']);
  expect('23514','ARCH020 immutable CommerceConversationGrant',['grant tool update immutable']);
  expect('23514','ARCH020 retained grant recovery link/owner immutable',['retained recovery link detach','retained recovery link reassign','retained legacy owner change']);
  expect('23514','ARCH020 retained grant recovery owner immutable',['retained recovery owner change']);
  for(const [name,fields] of Object.entries(columns)) {
    const actual=await db.$queryRawUnsafe(`SELECT column_name,udt_name,is_nullable,character_maximum_length,datetime_precision,column_default FROM information_schema.columns WHERE table_schema='commerce' AND table_name=${lit(name)}`);
    assert.equal(actual.length,fields.split(' ').length);
    for(const entry of fields.split(' ')) {
      const [field,type]=entry.split(':');const row=actual.find(r=>r.column_name===field);
      assert.ok(row,`${name}.${field}`); const base=type.replace('?','');
      assert.equal(row.is_nullable,type.endsWith('?')?'YES':'NO');
      assert.equal(row.udt_name,base.startsWith('varchar')?'varchar':base);
      if(base.startsWith('varchar')) assert.equal(row.character_maximum_length,Number(base.slice(7)));
      if(base==='timestamptz') assert.equal(row.datetime_precision,3);
      if(field==='id') assert.equal(row.column_default,null,'cuid generated by Prisma only');
      if(field==='responseContract'||field==='responseContractHash') assert.equal(row.column_default,null,'C16 has no implicit response default');
      if(field==='createdAt'||field==='updatedAt') assert.match(row.column_default,/CURRENT_TIMESTAMP|now/);
    } pass(`physical columns ${name}`);
  }
  for(const [name,values] of Object.entries(enums)) {
    const actual=await db.$queryRawUnsafe(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='commerce' AND t.typname=${lit(name)} ORDER BY e.enumsortorder`);
    assert.deepEqual(actual.map(v=>v.enumlabel),values); pass(`physical enum ${name}`);
  }
  const foreignKeys=await db.$queryRawUnsafe(`SELECT r.relname,k.confdeltype,k.confupdtype FROM pg_constraint k JOIN pg_class r ON r.oid=k.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE k.contype='f' AND n.nspname='commerce' AND r.relname LIKE 'Commerce%'`);
  assert.equal(foreignKeys.length,21);
  assert.equal(foreignKeys.filter(k=>k.confdeltype==='c').length,2);
  assert.ok(foreignKeys.every(k=>k.confupdtype==='r' && (k.confdeltype==='r'||k.relname==='CommerceConversationGrant'&&k.confdeltype==='c')));pass('all FK update/delete actions');
  const cap = {id:'core',key:'conversation_core',displayName:'Core',selectionBinding:'BASE'};
  await add('CommerceCapability',cap);
  await add('CommerceCapability',{id:'a',key:'feature_a',displayName:'A',selectionBinding:'FEATURE',featureId:'feature'});
  await add('CommerceCapability',{id:'b',key:'feature_b',displayName:'B',selectionBinding:'FEATURE',featureId:'feature'});
  await add('CommerceCapability',{id:'d',key:'discount_assistance',displayName:'D',selectionBinding:'RECOVERY_POLICY'});
  controls.CommerceCapability={id:'control',key:'negative_control',displayName:'Control',selectionBinding:'FEATURE',featureId:'feature'};
  for (const [name,patch] of [
    ['duplicate capability key',{...cap,featureId:null}],['invalid base',{key:'other_core',selectionBinding:'BASE',featureId:null}],
    ['core requires BASE',{key:'conversation_core'}],['feature without FK',{featureId:null}],
    ['non-feature with FK',{key:'discount_assistance',selectionBinding:'RECOVERY_POLICY'}],['recovery-policy key',{key:'test',selectionBinding:'RECOVERY_POLICY',featureId:null}],
    ['capability description bound',{id:'bad',description:'x'.repeat(4001)}],['capability nonblank',{id:'bad',displayName:' '}],
    ['capability key regex',{id:'bad',key:'Bad'}],['capability display bound',{id:'bad',displayName:'x'.repeat(256)}]
  ]) await bad(name,'CommerceCapability',{...controls.CommerceCapability,...patch});
  await isolated(async tx=>{
    await tx.$executeRawUnsafe('ALTER TABLE commerce."CommerceCapability" DROP CONSTRAINT arch020_capability_bounds');
    const row={...controls.CommerceCapability,id:'mutation-control',key:'mutation_control'};
    await tx.$executeRawUnsafe(insertSql(c('CommerceCapability'),row));
    await assert.rejects(rejectsExactly('capability nonblank',()=>tx.$executeRawUnsafe(insertSql(c('CommerceCapability'),{...row,id:'mutation-negative',key:'mutation_negative',displayName:' '}))),/capability nonblank: invalid SQL succeeded/);
  });
  assert.equal((await db.$queryRawUnsafe("SELECT count(*)::int n FROM pg_constraint WHERE conname='arch020_capability_bounds'"))[0].n,1);
  pass('mutation removing capability guard makes its named rejection fail; guard restored');
  await add('CommerceTool',{id:'tool',name:'read_product',displayName:'Read'});
  await add('CommerceTool',{id:'tool2',name:'other_product',displayName:'Other'});
  const definition={name:'read_product',definitionVersion:'1.0.0',description:'Synthetic product read',inputSchema:{type:'object',properties:{handle:{type:'string'}},additionalProperties:false},execution:{kind:'POLICY_OPERATION',operation:'shopify.searchProducts',operationVersion:'1.0.0',arguments:{query:{input:'handle'}}},responseTemplate:{kind:'text',text:'{{result.title}}',unavailable:'Unknown'}};
  const toolrev={id:'tr1',toolId:'tool',revisionNumber:1,definitionVersion:'1.0.0',definition,contractVersion:'commerce.v1',createdByAdminId:'admin'};
  controls.CommerceToolRevision=toolrev;
  await add('CommerceToolRevision',toolrev);
  assert.deepEqual((await db.commerceToolRevision.findUniqueOrThrow({where:{id:'tr1'}})).definition,definition); pass('Prisma definition roundtrip');
  for (const [name,patch] of [
    ['duplicate tool revision',{id:'bad'}],['duplicate definition version',{id:'bad',revisionNumber:2}],
    ['definition wrong name',{id:'bad',revisionNumber:2,definitionVersion:'2.0.0',definition:{...definition,name:'other_product',definitionVersion:'2.0.0'}}],
    ['definition wrong version',{id:'bad',revisionNumber:2,definitionVersion:'2.0.0'}],
    ['definition extra key',{id:'bad',definition:{...definition,extra:1}}],['definition missing key',{id:'bad',definition:{...definition,execution:undefined}}],
    ['definition array',{id:'bad',definition:[]}],['definition input scalar',{id:'bad',definition:{...definition,inputSchema:'bad'}}],
    ['definition execution scalar',{id:'bad',definition:{...definition,execution:1}}],['definition template scalar',{id:'bad',definition:{...definition,responseTemplate:null}}],
    ['definition size bound',{id:'bad',definition:{...definition,description:'x'.repeat(65536)}}],
    ['tool revision number positive',{id:'bad',revisionNumber:0}],['tool edit version nonnegative',{id:'bad',editVersion:-1}],
    ['draft publication fields',{id:'bad',contentHash:'a'.repeat(64)}]
  ]) await bad(name,'CommerceToolRevision',{...toolrev,...patch});
  await reject('tool draft increment required',`UPDATE ${c('CommerceToolRevision')} SET "definition"="definition" WHERE id='tr1'`);
  await reject('tool creator immutable',`UPDATE ${c('CommerceToolRevision')} SET "createdByAdminId"='admin2',"editVersion"=1 WHERE id='tr1'`);
  await reject('tool identity immutable',`UPDATE ${c('CommerceToolRevision')} SET "toolId"='tool2',"definition"=jsonb_set("definition",'{name}','"other_product"'),"editVersion"=1 WHERE id='tr1'`);
  const pub = table => sql(`UPDATE ${c(table)} SET status='PUBLISHED',"publishedByAdminId"='admin',"publishedAt"=now(),"contentHash"='${'a'.repeat(64)}',"editVersion"="editVersion"+1 WHERE status='DRAFT'`);
  await pub('CommerceToolRevision');
  await add('CommerceToolRevision',{...toolrev,id:'tr2',revisionNumber:2,definitionVersion:'2.0.0',definition:{...definition,definitionVersion:'2.0.0'}});
  await pub('CommerceToolRevision');
  const cr = {id:'cr0',capabilityId:'core',revisionNumber:1,promptTemplate:'Synthetic prompt',contractVersion:'commerce.v1',createdByAdminId:'admin'};
  controls.CommerceCapabilityRevision=cr;
  await add('CommerceCapabilityRevision',cr);
  const binding={toolId:'tool',toolRevisionId:'tr1'};
  for (const [name,patch] of [
    ['duplicate capability revision',{id:'bad'}],['prompt nonblank',{id:'bad',promptTemplate:' '}],['prompt whitespace only',{id:'bad',promptTemplate:'\t\n'}],['prompt length bound',{id:'bad',promptTemplate:'x'.repeat(32001)}],
    ['configuration object',{id:'bad',configuration:[]}],['configuration byte bound',{id:'bad',configuration:{x:'é'.repeat(8200)}}],
    ['bindings array',{id:'bad',toolBindings:{}}],['bindings exact keys',{id:'bad',toolBindings:[{...binding,x:1}]}],
    ['bindings duplicate tools',{id:'bad',toolBindings:[binding,binding]}],['bindings count bound',{id:'bad',toolBindings:Array.from({length:33},(_,i)=>({toolId:`count-tool-${i}`,toolRevisionId:`count-revision-${i}`}))}],
    ['bindings wrong tool',{id:'bad',toolBindings:[{...binding,toolId:'tool2'}]}],['bindings missing revision',{id:'bad',toolBindings:[{...binding,toolRevisionId:'absent'}]}],
    ['bindings ID bound',{id:'bad',toolBindings:[{...binding,toolId:'x'.repeat(129)}]}],
    ['capability revision positive',{id:'bad',revisionNumber:0}],['capability edit nonnegative',{id:'bad',editVersion:-1}],
    ['contract nonblank',{id:'bad',contractVersion:' '}],['publication missing attribution',{id:'bad',status:'PUBLISHED'}],
    ['publication hash invalid',{id:'bad',status:'PUBLISHED',publishedByAdminId:'admin',createdAt:now,publishedAt:now,contentHash:'X'.repeat(64)}],
    ['publication before creation',{id:'bad',status:'PUBLISHED',publishedByAdminId:'admin',createdAt:'2026-09-21',publishedAt:now,contentHash:'a'.repeat(64)}]
  ]) await bad(name,'CommerceCapabilityRevision',{...cr,...patch});
  await add('CommerceCapabilityRevision',{...cr,id:'identity-control',capabilityId:'a',revisionNumber:90});
  await reject('capability identity immutable',`UPDATE ${c('CommerceCapability')} SET key='feature_a_changed' WHERE id='a'`);
  await reject('capability draft increment required',`UPDATE ${c('CommerceCapabilityRevision')} SET "promptTemplate"='New' WHERE id='cr0'`);
  await reject('capability revision creator immutable',`UPDATE ${c('CommerceCapabilityRevision')} SET "createdByAdminId"='admin2',"editVersion"=1 WHERE id='cr0'`);
  await reject('capability revision identity immutable',`UPDATE ${c('CommerceCapabilityRevision')} SET "revisionNumber"=2,"editVersion"=1 WHERE id='cr0'`);
  await sql(`UPDATE ${c('CommerceCapabilityRevision')} SET "promptTemplate"='New',"editVersion"=1 WHERE id='cr0'`); pass('valid draft update');
  for (const [id,capabilityId,toolRevisionId] of [['cra','a','tr1'],['crb','b','tr1'],['crd','d','tr2']]) await add('CommerceCapabilityRevision',{...cr,id,capabilityId,toolBindings:[{toolId:'tool',toolRevisionId}]});
  await pub('CommerceCapabilityRevision');
  await add('CommerceCapabilityRevision',{...cr,id:'draft',revisionNumber:2});
  await add('CommerceToolRevision',{...toolrev,id:'drafttool',revisionNumber:3,definitionVersion:'3.0.0',definition:{...definition,definitionVersion:'3.0.0'}});
  await bad('draft tool cannot bind','CommerceCapabilityRevision',{...cr,id:'bad',revisionNumber:3,toolBindings:[{toolId:'tool',toolRevisionId:'drafttool'}]});
  const release={id:'rel',responseContract:baselineResponse,responseContractHash:responseHash(baselineResponse),runnerCompatibility:'^1.0.0',contractVersion:'commerce.v1',createdByAdminId:'admin'};
  controls.CommerceRelease=release;
  await add('CommerceRelease',release); await add('CommerceRelease',{...release,id:'empty'});
  const relnum=(await db.commerceRelease.findUniqueOrThrow({where:{id:'rel'}})).releaseNumber;
  await bad('release number unique','CommerceRelease',{...release,id:'bad',releaseNumber:relnum});
  await bad('release number positive','CommerceRelease',{...release,id:'bad',releaseNumber:0});
  await bad('release description bound','CommerceRelease',{...release,id:'bad',description:'x'.repeat(4001)});
  await bad('runner compatibility nonblank','CommerceRelease',{...release,id:'bad',runnerCompatibility:' '});
  for(const [label,response] of [['baseline',baselineResponse],['custom',customResponse]]) {
    const row={...release,id:`response-${label}`,responseContract:response,responseContractHash:responseHash(response)};
    await add('CommerceRelease',row);
    const direct=(await db.$queryRawUnsafe(`SELECT "responseContract","responseContractHash" FROM ${c('CommerceRelease')} WHERE id=${lit(row.id)}`))[0];
    const prisma=await db.commerceRelease.findUniqueOrThrow({where:{id:row.id}});
    assert.deepEqual(direct.responseContract,response);assert.deepEqual(prisma.responseContract,response);
    assert.equal(direct.responseContractHash,row.responseContractHash);assert.equal(prisma.responseContractHash,row.responseContractHash);
    pass(`C16 ${label} SQL and Prisma roundtrip`);
  }
  for(const [label,value] of [
    ['array',[]],['scalar',JSON.stringify('invalid')],['JSON null',null],['missing version',{instructions:'Reply',detailsSchema:{}}],
    ['missing instructions',{version:'response.v1',detailsSchema:{}}],['missing schema',{version:'response.v1',instructions:'Reply'}],
    ['extra key',{...baselineResponse,extra:true}],['wrong version',{...baselineResponse,version:'response.v2'}],
    ['nonstring version',{...baselineResponse,version:1}],['nonstring instructions',{...baselineResponse,instructions:5}],
    ['empty instructions',{...baselineResponse,instructions:''}],['long instructions',{...baselineResponse,instructions:'x'.repeat(8001)}],
    ['schema array',{...baselineResponse,detailsSchema:[]}],['schema null',{...baselineResponse,detailsSchema:null}],
  ]) {
    const name=`C16 rejects ${label}`;expect('23514','arch020_release_response_contract',[name]);
    if(value===null) {
      await isolated(tx=>tx.$executeRawUnsafe(insertSql(c('CommerceRelease'),{...release,id:'json-null-control'})));pass(`${name}: valid control`);
      await reject(name,insertSql(c('CommerceRelease'),{...release,id:'json-null',responseContract:'C16_JSON_NULL'}).replace("'C16_JSON_NULL'","'null'::jsonb"));
    } else await bad(name,'CommerceRelease',{...release,responseContract:value});
  }
  for(const field of ['responseContract','responseContractHash']) {
    for(const missing of [true,false]) {
      const name=`C16 ${field} ${missing?'missing':'SQL NULL'}`;
      expect('23502',`column "${field}"`,[name]);
      const row={...release};if(missing) delete row[field];else row[field]=null;
      await bad(name,'CommerceRelease',row);
    }
    const replacement=field==='responseContract'?customResponse:responseHash(customResponse);
    const name=`C16 ${field} immutable`;expect('23514','ARCH020 immutable CommerceRelease',[name]);
    await reject(name,`UPDATE ${c('CommerceRelease')} SET "${field}"=${lit(replacement)} WHERE id='rel'`);
  }
  for(const hash of ['','a'.repeat(63),'A'.repeat(64),'z'.repeat(64)]) {
    const name=`C16 hash format ${hash.slice(0,1)} ${hash.length}`;expect('23514','arch020_release_response_hash',[name]);
    await bad(name,'CommerceRelease',{...release,responseContractHash:hash});
  }
  const overlong='C16 overlong hash';expect('22001','character varying(64)',[overlong]);await bad(overlong,'CommerceRelease',{...release,responseContractHash:'a'.repeat(65)});
  // The 8000 limit counts characters, not bytes. Boundary controls are retained.
  for(const length of [1,8000]) {
    const responseContract={...baselineResponse,instructions:'é'.repeat(length)};
    await add('CommerceRelease',{...release,id:`boundary-${length}`,responseContract,responseContractHash:responseHash(responseContract)});
  }
  pass('C16 instructions inclusive character boundaries');
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(insertSql(c('CommerceRelease'),{...release,id:'atomic-release',responseContract:customResponse,responseContractHash:responseHash(customResponse)}));
    await tx.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId:'atomic-release',capabilityId:'core',capabilityRevisionId:'cr0',position:0}));
  });
  assert.equal(await db.commerceReleaseCapability.count({where:{releaseId:'atomic-release'}}),1);pass('C16 atomic release and members commit');
  await rejectsExactly('C16 atomic rollback',()=>db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(insertSql(c('CommerceRelease'),{...release,id:'rolled-back-release'}));
    await tx.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId:'rolled-back-release',capabilityId:'core',capabilityRevisionId:'draft',position:0}));
  }),{code:'23514',diagnostic:'ARCH020 member requires matching published capability'});
  assert.equal(await db.commerceRelease.count({where:{id:'rolled-back-release'}}),0);
  assert.equal(await db.commerceReleaseCapability.count({where:{releaseId:'rolled-back-release'}}),0);pass('C16 atomic release and members rollback');
  const member={releaseId:'rel',capabilityId:'core',capabilityRevisionId:'cr0',position:0};
  controls.CommerceReleaseCapability={...member,releaseId:'empty'};
  await add('CommerceReleaseCapability',member);
  await bad('draft membership','CommerceReleaseCapability',{...member,releaseId:'empty',capabilityRevisionId:'draft'});
  await bad('wrong capability membership','CommerceReleaseCapability',{...member,releaseId:'empty',capabilityId:'a'});
  await bad('member position unique','CommerceReleaseCapability',{...member,capabilityId:'a',capabilityRevisionId:'cra'});
  await bad('member position nonnegative','CommerceReleaseCapability',{...member,releaseId:'empty',position:-1});
  await add('CommerceReleaseCapability',{releaseId:'rel',capabilityId:'a',capabilityRevisionId:'cra',position:1});
  await add('CommerceReleaseCapability',{releaseId:'rel',capabilityId:'b',capabilityRevisionId:'crb',position:2});
  await bad('conflicting tool revisions in release','CommerceReleaseCapability',{releaseId:'rel',capabilityId:'d',capabilityRevisionId:'crd',position:3});
  const pointer={environment:'TEST',releaseId:'rel',updatedByAdminId:'admin'};
  controls.CommerceReleasePointer=pointer;
  await bad('empty release activation','CommerceReleasePointer',{...pointer,releaseId:'empty'});
  await add('CommerceReleasePointer',pointer);
  await reject('pointer increment required',`UPDATE ${c('CommerceReleasePointer')} SET "releaseId"='rel' WHERE environment='TEST'`);
  await sql(`UPDATE ${c('CommerceReleasePointer')} SET "editVersion"=1 WHERE environment='TEST' AND "editVersion"=0`); pass('valid pointer CAS');
  const audit={id:'audit',actorAdminId:'admin',action:'PUBLISH_REVISION',capabilityId:'core',revisionId:'cr0',reason:'Synthetic publish'};
  controls.CommerceAuditEvent=audit;
  await add('CommerceAuditEvent',audit);
  for (const [name,patch] of [
    ['audit requires capability',{id:'bad',capabilityId:null}],['audit revision ownership',{id:'bad',capabilityId:'a'}],
    ['audit reason nonblank',{id:'bad',reason:' '}],['audit reason bound',{id:'bad',reason:'x'.repeat(1001)}],
    ['audit metadata object',{id:'bad',metadata:[]}],['audit metadata bytes',{id:'bad',metadata:{x:'x'.repeat(8192)}}],
    ['audit release target',{id:'bad',action:'CREATE_RELEASE'}],['audit environment target',{id:'bad',action:'ACTIVATE_RELEASE',releaseId:'rel'}],
    ['audit tool target',{id:'bad',action:'CREATE_TOOL'}],['audit tool revision target',{id:'bad',action:'PUBLISH_TOOL_REVISION',toolId:'tool'}],
    ['audit tool revision ownership',{id:'bad',action:'PUBLISH_TOOL_REVISION',toolId:'tool2',toolRevisionId:'tr1'}]
  ]) await bad(name,'CommerceAuditEvent',{...audit,...patch});
  const granted={toolId:'tool',toolRevisionId:'tr1',toolName:'read_product',definitionVersion:'1.0.0',capabilityKeys:['feature_a','feature_b']};
  const grant={id:'g1',shopId:'s1',conversationId:'v1',initialInboundVersion:1,releaseId:'rel',selectedCapabilityKeys:['conversation_core','feature_a','feature_b'],grantedTools:[granted],runnerVersion:'1.0.0'};
  controls.CommerceConversationGrant=grant;
  for (const [name,patch] of [
    ['standalone conversation',{conversationId:'standalone'}],['missing conversation',{conversationId:'absent'}],['wrong shop',{shopId:'s2'}],
    ['future inbound version',{initialInboundVersion:3}],['positive inbound version',{initialInboundVersion:0}],
    ['empty release grant',{releaseId:'empty'}],['foreign selected key',{selectedCapabilityKeys:['conversation_core','other']}],
    ['selected keys require base',{selectedCapabilityKeys:['feature_a'],grantedTools:[{...granted,capabilityKeys:['feature_a']}]}],['selected keys unique',{selectedCapabilityKeys:['conversation_core','conversation_core'],grantedTools:[]}],
    ['selected keys type',{selectedCapabilityKeys:{}}],['selected keys count',{selectedCapabilityKeys:['conversation_core',...Array.from({length:32},(_,i)=>`count_cap_${i}`)],grantedTools:[]}],
    ['grant tools byte bound',{grantedTools:Array.from({length:32},(_,i)=>({...granted,toolId:`t${i}`,toolName:`t${i}`,capabilityKeys:Array.from({length:32},(_,k)=>`key_${String(k).padStart(2,'0')}_${'x'.repeat(110)}`)}))}],
    ['grant tool omission',{grantedTools:[]}],['grant duplicate tool',{grantedTools:[granted,granted]}],['grant duplicate name',{grantedTools:[granted,{...granted,toolId:'tool2'}]}],
    ['grant wrong revision',{grantedTools:[{...granted,toolRevisionId:'tr2'}]}],['grant wrong name',{grantedTools:[{...granted,toolName:'other_product'}]}],
    ['grant wrong version',{grantedTools:[{...granted,definitionVersion:'2.0.0'}]}],['grant missing provenance',{grantedTools:[{...granted,capabilityKeys:['feature_a']}]}],
    ['grant unselected provenance',{grantedTools:[{...granted,capabilityKeys:['feature_a','feature_b','other']}]}],
    ['grant unsorted provenance',{grantedTools:[{...granted,capabilityKeys:['feature_b','feature_a']}]}],['grant extra keys',{grantedTools:[{...granted,x:1}]}],
    ['grant invalid retention time',{createdAt:now,expiresAt:now}],['grant runner nonblank',{runnerVersion:' '}]
  ]) await bad(name,'CommerceConversationGrant',{...grant,...patch});
  await sql(`UPDATE whatsapp."Conversation" SET "shopId"='s2' WHERE id='v2'`);
  await bad('conflicting legacy conversation shop','CommerceConversationGrant',{...grant,id:'bad',conversationId:'v2'});
  // A sentinel ID remains invalid even if a legacy recovery happens to exist.
  await sql(insertSql('commerce."CheckoutRecovery"',{id:'product-only',shopId:'s1',checkoutToken:'sentinel',lastExternalActivityAt:now,updatedAt:now}));
  await sql(insertSql('whatsapp."Conversation"',{id:'sentinel',checkoutRecoveryId:'product-only',type:'RECOVERY',inboundVersion:1,updatedAt:now}));
  await bad('sentinel recovery cannot grant','CommerceConversationGrant',{...grant,id:'bad',conversationId:'sentinel'});
  // Exercise byte limits independently from count, key shape and ownership.
  const wideBindings=Array.from({length:32},(_,i)=>({toolId:`${i}${'😀'.repeat(120)}`,toolRevisionId:`${i}${'😀'.repeat(120)}`}));
  assert.ok(Buffer.byteLength(JSON.stringify(wideBindings))>16384);
  assert.equal((await db.$queryRawUnsafe(`SELECT commerce.arch020_bindings(${lit(wideBindings)}) AS valid`))[0].valid,false); pass('independent bindings byte bound');
  const wideTools=Array.from({length:32},(_,i)=>({...granted,toolId:`t${i}`,toolName:`t${i}`,capabilityKeys:Array.from({length:32},(_,k)=>`key_${String(k).padStart(2,'0')}_${'x'.repeat(110)}`)}));
  assert.ok(Buffer.byteLength(JSON.stringify(wideTools))>65536);
  assert.equal((await db.$queryRawUnsafe(`SELECT commerce.arch020_grant_tools(${lit(wideTools)}) AS valid`))[0].valid,false); pass('independent grantedTools byte bound');
  await bad('bindings byte bound insert','CommerceCapabilityRevision',{...cr,id:'bad',revisionNumber:4,toolBindings:wideBindings});
  await add('CommerceConversationGrant',grant);
  await add('CommerceReleasePointer',{environment:'PRODUCTION',releaseId:'rel',updatedByAdminId:'admin'});
  for(const [editVersion,releaseId] of [[1,'atomic-release'],[2,'rel']]) {
    await sql(`UPDATE ${c('CommerceReleasePointer')} SET "releaseId"=${lit(releaseId)},"editVersion"=${editVersion} WHERE environment='PRODUCTION' AND "editVersion"=${editVersion-1}`);
    const pinned=await db.commerceConversationGrant.findUniqueOrThrow({where:{id:'g1'},include:{release:true}});
    assert.equal(pinned.releaseId,'rel');assert.deepEqual(pinned.release.responseContract,baselineResponse);
    assert.equal(pinned.release.responseContractHash,responseHash(baselineResponse));
    pass(`C16 old grant retains response after ${editVersion===1?'activation':'rollback'}`);
  }
  const stored=await db.commerceConversationGrant.findUniqueOrThrow({where:{conversationId:'v1'}});
  assert.deepEqual(stored.grantedTools,[granted]); pass('shared tool deduplicated with full provenance');
  await add('CommerceConversationGrant',{...grant,id:'g3',conversationId:'v3',selectedCapabilityKeys:['conversation_core'],grantedTools:[]}); pass('prompt-only zero tools');
  await bad('one lifetime grant despite later turn','CommerceConversationGrant',{...grant,id:'other',initialInboundVersion:2});
  for (const [table,id] of [['CommerceCapabilityRevision','cr0'],['CommerceToolRevision','tr1'],['CommerceRelease','rel'],['CommerceAuditEvent','audit'],['CommerceConversationGrant','g1']]) {
    await reject(`${table} update immutable`,`UPDATE ${c(table)} SET id=id WHERE id=${lit(id)}`);
    if (['CommerceCapabilityRevision','CommerceToolRevision','CommerceAuditEvent'].includes(table)) await reject(`${table} delete immutable`,`DELETE FROM ${c(table)} WHERE id=${lit(id)}`);
  }
  await reject('member update immutable',`UPDATE ${c('CommerceReleaseCapability')} SET position=position WHERE "releaseId"='rel'`);
  await reject('member delete immutable',`DELETE FROM ${c('CommerceReleaseCapability')} WHERE "releaseId"='rel'`);
  await reject('tool rename immutable',`UPDATE ${c('CommerceTool')} SET name='renamed' WHERE id='tool'`);
  await reject('grant tool update immutable',`UPDATE ${c('CommerceConversationGrant')} SET "grantedTools"='[]' WHERE id='g1'`);
  await reject('retained recovery link detach',`UPDATE whatsapp."Conversation" SET "checkoutRecoveryId"=NULL WHERE id='v1'`);
  await reject('retained recovery link reassign',`UPDATE whatsapp."Conversation" SET "checkoutRecoveryId"='unlinked' WHERE id='v1'`);
  await reject('retained legacy owner change',`UPDATE whatsapp."Conversation" SET "shopId"='s2' WHERE id='v1'`);
  await reject('retained recovery owner change',`UPDATE commerce."CheckoutRecovery" SET "shopId"='s2' WHERE id='r1'`);
  // Isolate each RESTRICT edge from older billing/policy foreign keys.
  await sql(insertSql('billing."Feature"',{id:'restrict-feature',key:'restrict_feature',displayName:'Restrict',activationMode:'MERCHANT_OPT_IN',updatedAt:now}));
  await add('CommerceCapability',{id:'restrict-cap',key:'restrict_cap',displayName:'Restrict',selectionBinding:'FEATURE',featureId:'restrict-feature'});
  await add('CommerceRelease',{...release,id:'restrict-release',createdByAdminId:'admin2'});
  for(const [name,text,constraint] of [
    ['referenced feature delete restricted',`DELETE FROM billing."Feature" WHERE id='restrict-feature'`,'CommerceCapability_featureId_fkey'],
    ['referenced admin delete restricted',`DELETE FROM public."PlatformAdmin" WHERE id='admin2'`,'CommerceRelease_createdByAdminId_fkey'],
    ['referenced release delete restricted',`DELETE FROM ${c('CommerceRelease')} WHERE id='rel'`,'CommerceReleaseCapability_releaseId_fkey'],
    ['referenced capability delete restricted',`DELETE FROM ${c('CommerceCapability')} WHERE id='b'`,'CommerceCapabilityRevision_capabilityId_fkey'],
    ['referenced tool delete restricted',`DELETE FROM ${c('CommerceTool')} WHERE id='tool'`,'CommerceToolRevision_toolId_fkey'],
    ['referenced admin key update restricted',`UPDATE public."PlatformAdmin" SET id='moved' WHERE id='admin2'`,'CommerceRelease_createdByAdminId_fkey'],
    ['referenced feature key update restricted',`UPDATE billing."Feature" SET id='moved' WHERE id='restrict-feature'`,'CommerceCapability_featureId_fkey'],
  ]) {expect('23503',constraint,[name]);await reject(name,text);}
  await sql(`UPDATE whatsapp."Conversation" SET "inboundVersion"=5 WHERE id='v1'`);
  assert.deepEqual((await db.commerceConversationGrant.findUniqueOrThrow({where:{conversationId:'v1'}})).grantedTools,[granted]); pass('later turns retain original grant');
  // Two independent connections: one grant winner, loser rereads, never upserts.
  const results=await Promise.allSettled([db,second].map((conn,i)=>conn.$executeRawUnsafe(diagnosed(insertSql(c('CommerceConversationGrant'),{...grant,id:`race${i}`,conversationId:'v4'})))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const loser=results.find(r=>r.status==='rejected'); check('grant race',loser.reason,{code:'23505',diagnostic:'CommerceConversationGrant_conversationId_key'});
  assert.deepEqual(await second.commerceConversationGrant.findUnique({where:{conversationId:'v4'}}),await db.commerceConversationGrant.findUnique({where:{conversationId:'v4'}})); pass('two-connection grant conflict/read winner');
  const cas=await Promise.all([db,second].map(conn=>conn.$executeRawUnsafe(`UPDATE ${c('CommerceReleasePointer')} SET "editVersion"=2 WHERE environment='TEST' AND "editVersion"=1`)));
  assert.deepEqual(cas.sort(),[0,1]); pass('two-connection pointer CAS');
  const drafts=await Promise.all([db,second].map(conn=>conn.$executeRawUnsafe(`UPDATE ${c('CommerceCapabilityRevision')} SET "editVersion"=1 WHERE id='draft' AND "editVersion"=0`)));
  assert.deepEqual(drafts.sort(),[0,1]); pass('two-connection draft CAS');
  // Hold a grant INSERT uncommitted, prove the owner UPDATE blocks, then
  // commit the winner and verify the waiting UPDATE sees the retained grant.
  async function ownerRace(name,conversationId,ownerUpdate) {
    let announce,release;
    const inserted=new Promise(r=>{announce=r}); const commit=new Promise(r=>{release=r});
    const writer=db.$transaction(async tx=>{await tx.$executeRawUnsafe(insertSql(c('CommerceConversationGrant'),{...grant,id:`race-${conversationId}`,conversationId}));announce();await commit;},{timeout:10000});
    await Promise.race([inserted,writer]);
    const updater=second.$executeRawUnsafe(ownerUpdate).then(()=>({ok:true}),e=>({ok:false,error:e}));
    try {
      let blocked=false;
      for(let i=0;i<100;i++) {
        const rows=await db.$queryRawUnsafe("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
        if(rows[0].n>0){blocked=true;break;}
        await new Promise(r=>setTimeout(r,10));
      }
      assert.ok(blocked,'Expected overlapping blocked owner UPDATE');
    } finally {release();}
    await writer; const outcome=await updater; assert.equal(outcome.ok,false);check(name,outcome.error,{code:'23514',diagnostic:conversationId==='v5'?'ARCH020 retained grant recovery owner immutable':'ARCH020 retained grant recovery link/owner immutable'});pass(name);
  }
  await ownerRace('concurrent recovery owner change rejected','v5',`UPDATE commerce."CheckoutRecovery" SET "shopId"='s2' WHERE id='r5'`);
  await ownerRace('concurrent conversation detach rejected','v6',`UPDATE whatsapp."Conversation" SET "checkoutRecoveryId"=NULL WHERE id='v6'`);
  const memberRace=await Promise.allSettled([
    db.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId:'empty',capabilityId:'a',capabilityRevisionId:'cra',position:0})),
    second.$executeRawUnsafe(insertSql(c('CommerceReleaseCapability'),{releaseId:'empty',capabilityId:'d',capabilityRevisionId:'crd',position:1})),
  ]);
  assert.equal(memberRace.filter(r=>r.status==='fulfilled').length,1);
  check('member race',memberRace.find(r=>r.status==='rejected').reason,{code:'23514',diagnostic:'ARCH020 conflicting release tool revisions'});pass('concurrent conflicting release tool revisions rejected');
  for(const statement of [
    insertSql(c('CommerceConversationGrant'),{...grant,id:'rr',conversationId:'v7'}),
    `UPDATE commerce."CheckoutRecovery" SET "shopId"='s2' WHERE id='r1'`,
    `UPDATE whatsapp."Conversation" SET "checkoutRecoveryId"=NULL WHERE id='v1'`,
    `UPDATE ${c('CommerceCapability')} SET "enabled"=false WHERE id='a'`,
    insertSql(c('CommerceCapabilityRevision'),{...cr,id:'rr',revisionNumber:9}),
  ]) {
    await assert.rejects(db.$transaction(tx=>tx.$executeRawUnsafe(statement),{isolationLevel:'RepeatableRead'}),e=>{check('repeatable read',e,{code:'23514',diagnostic:'ARCH020 relational guards require READ COMMITTED or SERIALIZABLE'});return true;});
  } pass('repeatable-read relational writes fail closed');
  await db.$transaction(tx=>tx.$executeRawUnsafe(insertSql(c('CommerceConversationGrant'),{...grant,id:'serial',conversationId:'v7'})),{isolationLevel:'Serializable'});pass('serializable grant supported');
  await sql(`DELETE FROM whatsapp."Conversation" WHERE id='v3'`);
  assert.equal(await db.commerceConversationGrant.count({where:{conversationId:'v3'}}),0); pass('conversation deletion cascades grant');
  await add('CommerceConversationGrant',{...grant,id:'g12',shopId:'s2',conversationId:'v12'});
  await sql(`DELETE FROM commerce."Shop" WHERE id='s2'`);
  assert.equal(await db.commerceConversationGrant.count({where:{shopId:'s2'}}),0);
  assert.equal(await db.commerceRelease.count({where:{id:'rel'}}),1); assert.equal(await db.commerceAuditEvent.count(),1); pass('shop cascade preserves release/audit');
  return passed;
}
