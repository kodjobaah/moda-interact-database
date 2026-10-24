// ARCH-047 task-owned exact persistence contract. Only technical schema facts live here.
// This is an independent test fixture, not an application/runtime policy module.
export const CONTRACT = {
  "models": {
    "WhatsAppTemplateDefinition": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "kind": "String @db.VarChar(40)",
        "purpose": "String? @db.VarChar(96)",
        "offerType": "String? @db.VarChar(32)",
        "audience": "String? @db.VarChar(24)",
        "providerTemplateName": "String? @db.VarChar(255)",
        "category": "String? @db.VarChar(32)",
        "sourceLanguageTag": "String @db.VarChar(16)",
        "astSchemaVersion": "Int",
        "sourceHash": "String @db.VarChar(64)",
        "status": "String @db.VarChar(32)",
        "publishedAt": "DateTime? @db.Timestamptz(3)",
        "retiredAt": "DateTime? @db.Timestamptz(3)",
        "createdByAdminId": "String @db.Text",
        "clonedFromDefinitionId": "String? @db.Text",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "createdByAdmin": "PlatformAdmin @relation(\"WhatsAppTemplateDefinitionCreator\", fields: [createdByAdminId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "clonedFrom": "WhatsAppTemplateDefinition? @relation(\"WhatsAppTemplateDefinitionClone\", fields: [clonedFromDefinitionId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "clones": "WhatsAppTemplateDefinition[] @relation(\"WhatsAppTemplateDefinitionClone\")",
        "locales": "WhatsAppTemplateLocale[]",
        "translationRuns": "WhatsAppTemplateTranslationRun[]",
        "publications": "WhatsAppTemplatePublicationOperation[]",
        "activeWrappers": "WhatsAppConversationWrapperActiveSlot[]"
      },
      "directives": [
        "@@index([clonedFromDefinitionId])",
        "@@index([createdByAdminId, createdAt])",
        "@@index([kind, purpose, createdAt])",
        "@@index([status, publishedAt])",
        "@@schema(\"whatsapp\")"
      ]
    },
    "WhatsAppTemplateLocale": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "definitionId": "String @db.Text",
        "languageTag": "String @db.VarChar(16)",
        "providerLanguageCode": "String? @db.VarChar(16)",
        "localeAst": "Json? @db.JsonB",
        "contentHash": "String? @db.VarChar(64)",
        "status": "String @db.VarChar(32)",
        "reviewedByAdminId": "String? @db.Text",
        "reviewedAt": "DateTime? @db.Timestamptz(3)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "definition": "WhatsAppTemplateDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "reviewedByAdmin": "PlatformAdmin? @relation(\"WhatsAppTemplateLocaleReviewer\", fields: [reviewedByAdminId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "metaRegistrations": "WhatsAppTemplateMetaRegistration[]",
        "translationResults": "WhatsAppTemplateTranslationItem[] @relation(\"WhatsAppTemplateTranslationResultLocale\")"
      },
      "directives": [
        "@@index([reviewedByAdminId, reviewedAt])",
        "@@index([status, updatedAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([definitionId, languageTag])"
      ]
    },
    "WhatsAppTemplateTranslationRun": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "definitionId": "String @db.Text",
        "translationModelConfigurationId": "String @db.Text",
        "provider": "String @db.VarChar(64)",
        "providerModelId": "String @db.VarChar(255)",
        "modelConfigurationVersion": "Int",
        "sourceSchemaVersion": "Int",
        "sourceHash": "String @db.VarChar(64)",
        "sourceSnapshot": "Json @db.JsonB",
        "status": "String @db.VarChar(32)",
        "requestedByAdminId": "String @db.Text",
        "requestedAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "startedAt": "DateTime? @db.Timestamptz(3)",
        "completedAt": "DateTime? @db.Timestamptz(3)",
        "failureCode": "String? @db.VarChar(128)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "definition": "WhatsAppTemplateDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "translationModel": "CommerceTranslationModelConfiguration @relation(fields: [translationModelConfigurationId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "requestedBy": "PlatformAdmin @relation(\"WhatsAppTemplateTranslationRunRequester\", fields: [requestedByAdminId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "items": "WhatsAppTemplateTranslationItem[]",
        "batches": "WhatsAppTemplateTranslationBatch[]"
      },
      "directives": [
        "@@index([definitionId, status, requestedAt])",
        "@@index([status, requestedAt])",
        "@@index([translationModelConfigurationId, requestedAt])",
        "@@schema(\"whatsapp\")"
      ]
    },
    "WhatsAppTemplateTranslationItem": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "runId": "String @db.Text",
        "targetLanguageTag": "String @db.VarChar(16)",
        "translatedAst": "Json? @db.JsonB",
        "outputContentHash": "String? @db.VarChar(64)",
        "resultLocaleId": "String? @db.Text",
        "status": "String @db.VarChar(32)",
        "failureCode": "String? @db.VarChar(128)",
        "retryCount": "Int @default(0)",
        "nextAttemptAt": "DateTime? @db.Timestamptz(3)",
        "currentBatchId": "String? @db.Text",
        "completedAt": "DateTime? @db.Timestamptz(3)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "run": "WhatsAppTemplateTranslationRun @relation(fields: [runId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "resultLocale": "WhatsAppTemplateLocale? @relation(\"WhatsAppTemplateTranslationResultLocale\", fields: [resultLocaleId], references: [id], onDelete: SetNull, onUpdate: Restrict)",
        "currentBatch": "WhatsAppTemplateTranslationBatch? @relation(\"WhatsAppTemplateTranslationItemCurrentBatch\", fields: [currentBatchId], references: [id], onDelete: SetNull, onUpdate: Restrict)",
        "batchItems": "WhatsAppTemplateTranslationBatchItem[]"
      },
      "directives": [
        "@@index([resultLocaleId])",
        "@@index([status, currentBatchId, nextAttemptAt, createdAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([runId, targetLanguageTag])"
      ]
    },
    "WhatsAppTemplateTranslationBatch": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "runId": "String @db.Text",
        "provider": "String @db.VarChar(64)",
        "model": "String @db.VarChar(255)",
        "status": "String @db.VarChar(32)",
        "providerBatchId": "String? @db.Text",
        "inputFileId": "String? @db.Text",
        "outputFileId": "String? @db.Text",
        "errorFileId": "String? @db.Text",
        "submissionStartedAt": "DateTime? @db.Timestamptz(3)",
        "lastSubmitAttemptAt": "DateTime? @db.Timestamptz(3)",
        "submitAttemptCount": "Int @default(0)",
        "nextSubmitAt": "DateTime? @db.Timestamptz(3)",
        "submittedAt": "DateTime? @db.Timestamptz(3)",
        "lastPolledAt": "DateTime? @db.Timestamptz(3)",
        "nextPollAt": "DateTime? @db.Timestamptz(3)",
        "pollSequence": "Int @default(0)",
        "completedAt": "DateTime? @db.Timestamptz(3)",
        "failureCode": "String? @db.VarChar(128)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "run": "WhatsAppTemplateTranslationRun @relation(fields: [runId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "currentItems": "WhatsAppTemplateTranslationItem[] @relation(\"WhatsAppTemplateTranslationItemCurrentBatch\")",
        "items": "WhatsAppTemplateTranslationBatchItem[]"
      },
      "directives": [
        "@@index([runId, status, createdAt])",
        "@@index([status, nextPollAt, createdAt])",
        "@@index([status, nextSubmitAt, createdAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([provider, providerBatchId])"
      ]
    },
    "WhatsAppTemplateTranslationBatchItem": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "batchId": "String @db.Text",
        "translationItemId": "String @db.Text",
        "providerCustomId": "String @unique @db.VarChar(255)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "batch": "WhatsAppTemplateTranslationBatch @relation(fields: [batchId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "translationItem": "WhatsAppTemplateTranslationItem @relation(fields: [translationItemId], references: [id], onDelete: Restrict, onUpdate: Restrict)"
      },
      "directives": [
        "@@index([translationItemId, createdAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([batchId, translationItemId])"
      ]
    },
    "WhatsAppTemplateMetaRegistration": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "localeId": "String @db.Text",
        "wabaId": "String @db.VarChar(191)",
        "providerTemplateName": "String @db.VarChar(255)",
        "providerLanguageCode": "String @db.VarChar(16)",
        "category": "String @db.VarChar(32)",
        "componentsSnapshot": "Json @db.JsonB",
        "parameterBindingsSnapshot": "Json @db.JsonB",
        "submittedContentHash": "String @db.VarChar(64)",
        "providerTemplateId": "String? @db.VarChar(191)",
        "submissionState": "String @db.VarChar(32)",
        "providerStatus": "String? @db.VarChar(32)",
        "failureCode": "String? @db.VarChar(128)",
        "lastSubmittedAt": "DateTime? @db.Timestamptz(3)",
        "nextRetryAt": "DateTime? @db.Timestamptz(3)",
        "lastReconciledAt": "DateTime? @db.Timestamptz(3)",
        "lastObservedContentHash": "String? @db.VarChar(64)",
        "lastObservedCategory": "String? @db.VarChar(32)",
        "driftDetectedAt": "DateTime? @db.Timestamptz(3)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "locale": "WhatsAppTemplateLocale @relation(fields: [localeId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "events": "WhatsAppTemplateMetaEvent[]",
        "variants": "WhatsAppTemplateVariant[] @relation(\"WhatsAppTemplateVariantMetaRegistration\")",
        "publicationTargets": "WhatsAppTemplatePublicationTarget[] @relation(\"WhatsAppTemplatePublicationTargetMetaRegistration\")"
      },
      "directives": [
        "@@index([driftDetectedAt])",
        "@@index([localeId, createdAt])",
        "@@index([providerStatus, updatedAt])",
        "@@index([submissionState, nextRetryAt, createdAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([wabaId, providerTemplateId])",
        "@@unique([wabaId, providerTemplateName, providerLanguageCode])"
      ]
    },
    "WhatsAppTemplateMetaEvent": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "eventIdentity": "String @unique @db.VarChar(191)",
        "registrationId": "String? @db.Text",
        "source": "String @db.VarChar(32)",
        "eventType": "String @db.VarChar(64)",
        "outcome": "String? @db.VarChar(32)",
        "attemptNumber": "Int?",
        "wabaId": "String @db.VarChar(191)",
        "providerTemplateId": "String? @db.VarChar(191)",
        "providerTemplateName": "String? @db.VarChar(255)",
        "providerLanguageCode": "String? @db.VarChar(16)",
        "requestDigest": "String? @db.VarChar(64)",
        "providerRequestId": "String? @db.VarChar(191)",
        "httpStatus": "Int?",
        "providerStatus": "String? @db.VarChar(32)",
        "failureCode": "String? @db.VarChar(128)",
        "reasonCode": "String? @db.VarChar(128)",
        "evidence": "Json? @db.JsonB",
        "receivedAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "processedAt": "DateTime? @db.Timestamptz(3)",
        "registration": "WhatsAppTemplateMetaRegistration? @relation(fields: [registrationId], references: [id], onDelete: SetNull, onUpdate: Restrict)"
      },
      "directives": [
        "@@index([processedAt, receivedAt])",
        "@@index([registrationId, receivedAt])",
        "@@index([wabaId, providerTemplateName, providerLanguageCode, receivedAt])",
        "@@schema(\"whatsapp\")"
      ]
    },
    "WhatsAppTemplatePublicationOperation": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "definitionId": "String @db.Text",
        "requestedByAdminId": "String @db.Text",
        "operationKey": "String @unique @db.VarChar(128)",
        "scopeSnapshot": "Json @db.JsonB",
        "status": "String @db.VarChar(32)",
        "totalTargets": "Int?",
        "succeededTargets": "Int @default(0)",
        "failedTargets": "Int @default(0)",
        "nextPageCursor": "String? @db.Text",
        "failureCode": "String? @db.VarChar(128)",
        "requestedAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "completedAt": "DateTime? @db.Timestamptz(3)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "definition": "WhatsAppTemplateDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "requestedBy": "PlatformAdmin @relation(\"WhatsAppTemplatePublicationRequester\", fields: [requestedByAdminId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "targets": "WhatsAppTemplatePublicationTarget[]"
      },
      "directives": [
        "@@index([definitionId, status, createdAt])",
        "@@index([status, updatedAt])",
        "@@schema(\"whatsapp\")"
      ]
    },
    "WhatsAppTemplatePublicationTarget": {
      "fields": {
        "id": "String @id @default(cuid()) @db.Text",
        "operationId": "String @db.Text",
        "shopId": "String @db.Text",
        "languageTag": "String @db.VarChar(16)",
        "metaRegistrationId": "String @db.Text",
        "previousVariantId": "String? @db.Text",
        "newVariantId": "String? @db.Text",
        "status": "String @db.VarChar(32)",
        "failureCode": "String? @db.VarChar(128)",
        "retryCount": "Int @default(0)",
        "processedAt": "DateTime? @db.Timestamptz(3)",
        "createdAt": "DateTime @default(now()) @db.Timestamptz(3)",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "operation": "WhatsAppTemplatePublicationOperation @relation(fields: [operationId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "shop": "Shop @relation(\"WhatsAppTemplatePublicationTargetShop\", fields: [shopId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "metaRegistration": "WhatsAppTemplateMetaRegistration @relation(\"WhatsAppTemplatePublicationTargetMetaRegistration\", fields: [metaRegistrationId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "previousVariant": "WhatsAppTemplateVariant? @relation(\"WhatsAppTemplatePublicationPreviousVariant\", fields: [previousVariantId], references: [id], onDelete: SetNull, onUpdate: Restrict)",
        "newVariant": "WhatsAppTemplateVariant? @relation(\"WhatsAppTemplatePublicationNewVariant\", fields: [newVariantId], references: [id], onDelete: SetNull, onUpdate: Restrict)"
      },
      "directives": [
        "@@index([metaRegistrationId])",
        "@@index([shopId, status, createdAt])",
        "@@index([status, updatedAt])",
        "@@schema(\"whatsapp\")",
        "@@unique([operationId, shopId, languageTag])"
      ]
    },
    "WhatsAppConversationWrapperActiveSlot": {
      "fields": {
        "audience": "String @id @db.VarChar(24)",
        "definitionId": "String @db.Text",
        "editVersion": "Int @default(0)",
        "updatedByAdminId": "String @db.Text",
        "updatedAt": "DateTime @default(now()) @updatedAt @db.Timestamptz(3)",
        "definition": "WhatsAppTemplateDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
        "updatedBy": "PlatformAdmin @relation(\"WhatsAppConversationWrapperSlotUpdater\", fields: [updatedByAdminId], references: [id], onDelete: Restrict, onUpdate: Restrict)"
      },
      "directives": [
        "@@index([definitionId])",
        "@@schema(\"whatsapp\")"
      ]
    }
  },
  "existingFields": {
    "Shop": {
      "whatsAppTemplatePublicationTargets": "WhatsAppTemplatePublicationTarget[] @relation(\"WhatsAppTemplatePublicationTargetShop\")"
    },
    "PlatformAdmin": {
      "createdWhatsAppTemplateDefinitions": "WhatsAppTemplateDefinition[] @relation(\"WhatsAppTemplateDefinitionCreator\")",
      "reviewedWhatsAppTemplateLocales": "WhatsAppTemplateLocale[] @relation(\"WhatsAppTemplateLocaleReviewer\")",
      "requestedWhatsAppTemplateTranslationRuns": "WhatsAppTemplateTranslationRun[] @relation(\"WhatsAppTemplateTranslationRunRequester\")",
      "requestedWhatsAppTemplatePublications": "WhatsAppTemplatePublicationOperation[] @relation(\"WhatsAppTemplatePublicationRequester\")",
      "updatedWhatsAppConversationWrapperSlots": "WhatsAppConversationWrapperActiveSlot[] @relation(\"WhatsAppConversationWrapperSlotUpdater\")"
    },
    "CommerceTranslationModelConfiguration": {
      "whatsAppTemplateTranslationRuns": "WhatsAppTemplateTranslationRun[]"
    },
    "WhatsAppTemplateVariant": {
      "metaRegistrationId": "String? @db.Text",
      "metaRegistration": "WhatsAppTemplateMetaRegistration? @relation(\"WhatsAppTemplateVariantMetaRegistration\", fields: [metaRegistrationId], references: [id], onDelete: Restrict, onUpdate: Restrict)",
      "publicationPreviousTargets": "WhatsAppTemplatePublicationTarget[] @relation(\"WhatsAppTemplatePublicationPreviousVariant\")",
      "publicationNewTargets": "WhatsAppTemplatePublicationTarget[] @relation(\"WhatsAppTemplatePublicationNewVariant\")"
    }
  },
  "actions": [
    "CREATE_WHATSAPP_TEMPLATE_DEFINITION",
    "CLONE_WHATSAPP_TEMPLATE_DEFINITION",
    "REQUEST_WHATSAPP_TEMPLATE_TRANSLATION",
    "REVIEW_WHATSAPP_TEMPLATE_LOCALE",
    "REQUEST_WHATSAPP_TEMPLATE_META_SUBMISSION",
    "PUBLISH_WHATSAPP_TEMPLATE_DEFINITION",
    "ASSIGN_WHATSAPP_TEMPLATE_DEFINITION",
    "RETIRE_WHATSAPP_TEMPLATE_DEFINITION",
    "ACTIVATE_WHATSAPP_CONVERSATION_WRAPPER",
    "DEACTIVATE_WHATSAPP_CONVERSATION_WRAPPER"
  ],
  "obsoleteModels": [
    "WhatsAppTemplateRelease",
    "WhatsAppTemplateReleaseLocale",
    "WhatsAppTemplateMetaSubmission",
    "WhatsAppTemplateMetaSubmissionAttempt",
    "WhatsAppTemplateMetaStatusReceipt"
  ]
};
