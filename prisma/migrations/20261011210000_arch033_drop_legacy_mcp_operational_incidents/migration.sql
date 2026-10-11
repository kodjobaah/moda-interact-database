-- ARCH-033 forward-only cleanup: retire MCP-specific operational tables.
-- Existing migration history is preserved; generic operational incident state is unaffected.
DROP TABLE "support"."McpOperationalEvent";
DROP TABLE "support"."McpOperationalIncident";
