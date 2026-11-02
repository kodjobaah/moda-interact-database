const q = value => `'${String(value).replaceAll("'", "''")}'`;
const hash = n => `decode(repeat('${Number(n).toString(16).padStart(2, '0')}', 32), 'hex')`;

export function legacyBaseSql() {
  return `
INSERT INTO "commerce"."Shop" ("id","domain","platform","updatedAt") VALUES
 ('a55-shop','a55.example.invalid','WOOCOMMERCE',clock_timestamp());
INSERT INTO "woocommerce"."WooCommerceInstallation"
 ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES
 ('a55-install','a55-shop','https://a55.example.invalid',${hash(55)},clock_timestamp());
INSERT INTO "woocommerce"."WooCommerceRestReadAttempt"
 ("id","installationId","shopId","tokenDigest","credentialVersionSnapshot","expiresAt") VALUES
 ('a55-attempt','a55-install','a55-shop',${hash(56)},1,clock_timestamp()+interval '5 minutes');
INSERT INTO "commerce"."CheckoutRecovery" ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt")
 VALUES ('a55-recovery','a55-shop','a55-checkout',clock_timestamp(),clock_timestamp());
INSERT INTO "whatsapp"."Conversation" ("id","shopId","checkoutRecoveryId","type","updatedAt")
 VALUES ('a55-conversation',NULL,'a55-recovery','RECOVERY',clock_timestamp());
INSERT INTO "commerce"."RecoveryOutreachAttempt"
 ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","updatedAt")
 VALUES ('a55-outreach-attempt','a55-recovery','447700900055',2,'POST_WINDOW_FOLLOW_UP','NONE',clock_timestamp());
INSERT INTO "whatsapp"."ConversationMessage" ("id","conversationId","direction","senderType","content")
 VALUES ('a55-outbound','a55-conversation','OUTBOUND','HUMAN','fixture');
INSERT INTO "commerce"."MerchantKnowledgePurpose" ("id","key","displayName")
 VALUES ('a55-purpose','catalogue','Catalogue');
INSERT INTO "commerce"."MerchantKnowledgeDataFormat"
 ("id","key","displayName","inputKind","acceptedContentTypes")
 VALUES ('a55-format','pdf','PDF','UPLOAD','["application/pdf"]'::jsonb);
INSERT INTO "commerce"."MerchantKnowledgePurposeDataFormat" ("purposeId","dataFormatId")
 VALUES ('a55-purpose','a55-format');
INSERT INTO "commerce"."MerchantKnowledgeSource"
 ("id","shopId","purposeId","dataFormatId","name","languageTag","position","updatedAt")
 VALUES ('a55-source','a55-shop','a55-purpose','a55-format','Fixture','en',1,clock_timestamp());
INSERT INTO "commerce"."MerchantKnowledgeUploadedAsset"
 ("id","shopId","dataFormatId","status","objectKey","originalFileName","contentType","sizeBytes","sha256","uploadExpiresAt","availableAt","updatedAt") VALUES
 ('a55-pending-asset','a55-shop','a55-format','PENDING_UPLOAD','a55/pending','pending.pdf',NULL,NULL,NULL,clock_timestamp()+interval '1 hour',NULL,clock_timestamp()),
 ('a55-complete-asset','a55-shop','a55-format','AVAILABLE','a55/complete','complete.pdf','application/pdf',128,repeat('a',64),clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp()),
 ('a55-deleted-asset','a55-shop','a55-format','DELETED','a55/deleted','deleted.pdf',NULL,NULL,NULL,clock_timestamp()+interval '1 hour',NULL,clock_timestamp());
INSERT INTO "commerce"."MerchantKnowledgeSourceRevision"
 ("id","sourceId","uploadedAssetId","generation","reason","status","requestedUrl","requestedAt","updatedAt") VALUES
 ('a55-intake','a55-source','a55-complete-asset',1,'CREATE','PENDING',NULL,clock_timestamp(),clock_timestamp()),
 ('a55-reprocess','a55-source','a55-complete-asset',2,'REPROCESS','PENDING',NULL,clock_timestamp(),clock_timestamp()),
 ('a55-entitlement','a55-source','a55-complete-asset',3,'ENTITLEMENT_CHANGE','PENDING',NULL,clock_timestamp(),clock_timestamp()),
 ('a55-web-revision','a55-source',NULL,4,'CREATE','PENDING','https://example.invalid/a55',clock_timestamp(),clock_timestamp());
`;
}

export function templateCommandSql(id, key, stateSetup = '') {
  return `INSERT INTO "whatsapp"."MerchantConversationSendCommand"
    ("id","shopId","conversationId","idempotencyKey","payloadSha256","expectedControlRevision",
     "kind","recipientSnapshot","templateName","templateLanguageCode","templateParameters",
     "recoveryOutreachAttemptId","updatedAt") VALUES
    (${q(id)},'a55-shop',${q(`conv-${id}`)},${q(key)},repeat('a',64),1,'RECOVERY_FOLLOW_UP_TEMPLATE',
     '447700900055','approved_template','en_GB','{"body":[]}'::jsonb,${q(`attempt-${id}`)},clock_timestamp());
  ${stateSetup}`;
}
