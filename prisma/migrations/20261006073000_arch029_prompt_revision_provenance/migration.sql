-- ARCH-029 DATABASE-003: preserve immutable prompt-generation provenance.
--
-- Store Category prompt generation materialises conditional templates into concrete
-- CommerceAgentPromptRevision.promptText. sourceContext records the immutable,
-- versioned source-selection snapshot that produced that concrete prompt, including
-- selected Store Category mappings. Existing revisions remain valid with NULL
-- sourceContext; historical mapping selections must not be inferred from prompt text.

ALTER TABLE "commerce"."CommerceAgentPromptRevision"
  ADD COLUMN "sourceContext" JSONB;
