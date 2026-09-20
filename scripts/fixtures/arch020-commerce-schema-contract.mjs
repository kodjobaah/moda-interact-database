// Independent expected physical contract: ? nullable; varchar lengths explicit.
const identity='id:text createdAt:timestamptz updatedAt:timestamptz';
const revision='revisionNumber:int4 status:CommerceCapabilityRevisionStatus contractVersion:varchar64 editVersion:int4 contentHash:varchar64? createdByAdminId:text publishedByAdminId:text? publishedAt:timestamptz?';
export const columns={
 CommerceCapability:`${identity} key:varchar128 displayName:varchar255 description:text? selectionBinding:CommerceCapabilitySelectionBinding featureId:text? enabled:bool`,
 CommerceCapabilityRevision:`${identity} capabilityId:text ${revision} promptTemplate:text configuration:jsonb toolBindings:jsonb`,
 CommerceRelease:'id:text releaseNumber:int4 description:text? runnerCompatibility:varchar128 contractVersion:varchar64 responseContract:jsonb responseContractHash:varchar64 createdByAdminId:text createdAt:timestamptz',
 CommerceReleaseCapability:'releaseId:text capabilityId:text capabilityRevisionId:text position:int4',
 CommerceReleasePointer:'environment:CommerceEnvironment releaseId:text editVersion:int4 updatedByAdminId:text updatedAt:timestamptz',
 CommerceAuditEvent:'id:text actorAdminId:text action:CommerceAuditAction capabilityId:text? revisionId:text? releaseId:text? toolId:text? toolRevisionId:text? environment:CommerceEnvironment? reason:varchar1000 metadata:jsonb createdAt:timestamptz',
 CommerceConversationGrant:'id:text shopId:text conversationId:text initialInboundVersion:int4 releaseId:text selectedCapabilityKeys:jsonb grantedTools:jsonb runnerVersion:varchar64 createdAt:timestamptz expiresAt:timestamptz?',
 CommerceTool:`${identity} name:varchar128 displayName:varchar255 description:text? enabled:bool`,
 CommerceToolRevision:`${identity} toolId:text ${revision} definitionVersion:varchar64 definition:jsonb`,
};
export const enums={
 CommerceCapabilitySelectionBinding:['BASE','FEATURE','RECOVERY_POLICY'],
 CommerceCapabilityRevisionStatus:['DRAFT','PUBLISHED'],
 CommerceEnvironment:['LOCAL','TEST','DEVELOPMENT','STAGING','PRODUCTION'],
 CommerceAuditAction:['CREATE_CAPABILITY','UPDATE_CAPABILITY','CREATE_DRAFT','UPDATE_DRAFT','PUBLISH_REVISION','CREATE_RELEASE','ACTIVATE_RELEASE','ROLLBACK_RELEASE','ENABLE_CAPABILITY','DISABLE_CAPABILITY','CREATE_TOOL','UPDATE_TOOL','CREATE_TOOL_DRAFT','UPDATE_TOOL_DRAFT','PUBLISH_TOOL_REVISION','ENABLE_TOOL','DISABLE_TOOL'],
};
export const indexFields={
 CommerceCapability:['key','featureId'],
 CommerceCapabilityRevision:['capabilityId,revisionNumber','id,capabilityId','capabilityId,status,revisionNumber'],
 CommerceRelease:['releaseNumber','createdAt,id'],
 CommerceReleaseCapability:['releaseId,capabilityId','releaseId,position','capabilityRevisionId,capabilityId'],
 CommerceReleasePointer:['releaseId'],
 CommerceAuditEvent:['createdAt,id','capabilityId,createdAt,id','releaseId,createdAt,id','actorAdminId,createdAt,id','toolId,createdAt,id'],
 CommerceConversationGrant:['conversationId','shopId,createdAt,id','releaseId','expiresAt'],
 CommerceTool:['name','createdAt,id'],
 CommerceToolRevision:['toolId,revisionNumber','toolId,definitionVersion','id,toolId','toolId,status,revisionNumber'],
};
