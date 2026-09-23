export const tables = [
  'CommerceModelCatalogueEntry','CommercePlatformModelSelection','CommerceShopModelSelection',
  'CommercePromptTemplateCategory','CommercePromptTemplate','CommercePromptTemplateRevision',
  'CommerceAgentPrompt','CommerceAgentPromptRevision','CommercePlatformPromptPointer','CommerceShopPromptPointer',
];
export const enums = ['CommerceModelProvider','CommerceAgentPromptScope','CommercePromptRevisionStatus'];
export const auditActions = [
  'CREATE_MODEL_CATALOGUE_ENTRY','UPDATE_MODEL_CATALOGUE_ENTRY','ENABLE_MODEL_CATALOGUE_ENTRY','DISABLE_MODEL_CATALOGUE_ENTRY',
  'SET_PLATFORM_MODEL_SELECTION','SET_SHOP_MODEL_SELECTION','CLEAR_SHOP_MODEL_SELECTION','CREATE_PROMPT_TEMPLATE_CATEGORY',
  'UPDATE_PROMPT_TEMPLATE_CATEGORY','ENABLE_PROMPT_TEMPLATE_CATEGORY','DISABLE_PROMPT_TEMPLATE_CATEGORY','CREATE_PROMPT_TEMPLATE',
  'UPDATE_PROMPT_TEMPLATE','ENABLE_PROMPT_TEMPLATE','DISABLE_PROMPT_TEMPLATE','CREATE_PROMPT_TEMPLATE_DRAFT',
  'UPDATE_PROMPT_TEMPLATE_DRAFT','PUBLISH_PROMPT_TEMPLATE_REVISION','CREATE_AGENT_PROMPT','CREATE_AGENT_PROMPT_DRAFT',
  'CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE','UPDATE_AGENT_PROMPT_DRAFT','PUBLISH_AGENT_PROMPT_REVISION',
  'SET_PLATFORM_PROMPT_POINTER','SET_SHOP_PROMPT_POINTER','CLEAR_SHOP_PROMPT_POINTER',
];
export const functions = tables.map(name => ({
  CommerceModelCatalogueEntry:'model_catalogue', CommercePlatformModelSelection:'shop_model_selection', CommerceShopModelSelection:'shop_model_selection',
  CommercePromptTemplateCategory:'prompt_template_category', CommercePromptTemplate:'prompt_template', CommercePromptTemplateRevision:'prompt_template_revision',
  CommerceAgentPrompt:'agent_prompt', CommerceAgentPromptRevision:'agent_prompt_revision', CommercePlatformPromptPointer:'platform_prompt_pointer', CommerceShopPromptPointer:'shop_prompt_pointer',
}[name])).filter((name,index,array) => array.indexOf(name) === index).map(name => `commerce.arch021_${name}_guard`);
export const triggerNames = functions.map(name => name.replace('commerce.',''));
export const checkNames = [
  'CommerceModelCatalogueEntry_provider_model_id_check','CommerceModelCatalogueEntry_display_name_check','CommerceModelCatalogueEntry_description_length_check','CommerceModelCatalogueEntry_edit_version_check',
  'CommercePlatformModelSelection_edit_version_check','CommerceShopModelSelection_edit_version_check','CommercePromptTemplateCategory_slug_check','CommercePromptTemplateCategory_display_name_check',
  'CommercePromptTemplateCategory_description_length_check','CommercePromptTemplateCategory_display_order_check','CommercePromptTemplateCategory_edit_version_check','CommercePromptTemplate_key_check',
  'CommercePromptTemplate_display_name_check','CommercePromptTemplate_description_length_check','CommercePromptTemplate_edit_version_check','CommercePromptTemplateRevision_revision_check',
  'CommercePromptTemplateRevision_edit_version_check','CommercePromptTemplateRevision_prompt_text_check','CommercePromptTemplateRevision_hash_check','CommercePromptTemplateRevision_publication_shape_check',
  'CommerceAgentPrompt_scope_check','CommerceAgentPromptRevision_revision_check','CommerceAgentPromptRevision_edit_version_check','CommerceAgentPromptRevision_prompt_text_check',
  'CommerceAgentPromptRevision_hash_check','CommerceAgentPromptRevision_publication_shape_check','CommercePlatformPromptPointer_edit_version_check','CommerceShopPromptPointer_edit_version_check',
];
export const requiredFields = {
  CommerceModelCatalogueEntry:['id','provider','providerModelId','displayName','description','enabled','editVersion','createdByAdminId','updatedByAdminId'],
  CommercePlatformModelSelection:['environment','modelId','editVersion','updatedByAdminId'], CommerceShopModelSelection:['environment','shopId','modelId','generationId','editVersion','updatedByAdminId'],
  CommercePromptTemplateCategory:['id','slug','displayName','description','enabled','displayOrder','editVersion'], CommercePromptTemplate:['id','key','categoryId','displayName','description','enabled','editVersion'],
  CommercePromptTemplateRevision:['id','templateId','revisionNumber','status','editVersion','promptText','contentHash'], CommerceAgentPrompt:['id','scope','shopId','createdByAdminId'],
  CommerceAgentPromptRevision:['id','promptId','revisionNumber','status','editVersion','promptText','contentHash','sourceTemplateRevisionId'],
  CommercePlatformPromptPointer:['environment','promptId','promptRevisionId','editVersion'], CommerceShopPromptPointer:['environment','shopId','promptId','promptRevisionId','generationId','editVersion'],
};
