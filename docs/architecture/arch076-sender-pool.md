# ARCH-076 sender storage

The additive migration adds five routing records, not checkout Conversations.
`Conversation.checkoutRecoveryId` uniqueness and all billing/allowance tables stay unchanged.

- Inventory holds verified sender identity; both provider IDs are immutable.
- A thread is an immutable recipient/sender generation; a route is a shop generation on that thread.
- One assignment pins an existing recovery Conversation to one route for its lifetime. Deferred deletion checks permit whole Conversation/shop cascades, while preventing detached/recreated assignments.
- An unresolved routing turn is keyed by the original provider message ID. It carries exact thread ownership and independent bound-shop and admitted-prompt scope stamps. A neutral prompt remains neutral when the original later binds to a shop.
- Routing decisions contain structural versioned evidence, never plaintext question clauses. Authentic content remains in the pending input until application admission into existing messages. Terminal raw input, candidate/moderation payloads and prompt text are destructively scrubbed; transient private configuration payloads may only be destructively cleared, while revision-only evidence may remain. Evidence and original identities cannot be replaced during replay.
- Classification remains frozen when a later selection child resolves an original. An explicit immutable resolution self-FK records that authorizing child; direct attribution resolves itself. A deferred witness guard validates exact thread, route, original, parent, selected owner and the explicitly named confirmed prompt. A multi-stage shop-then-basket clarification may use a direct child prompt holder, while every selection remains rooted at the substantive original; no newest-prompt or recursive ownership inference is used. One child may witness its own admission and its original, without a global unique resolver constraint.
- Parent links bind once and use deferred NO ACTION. Retention removes eligible parent/dependent cohorts together; individual parent deletion must not erase provenance. Deleting an actual selected Conversation may clear its live pointer, without changing the frozen decision or allowing rebinding.

Partial unique indexes enforce one live thread per recipient/sender and one live route per recipient/shop. Application allocation and last-member release must serialize the recipient using the same transaction advisory lock across replicas, then lock generation rows consistently. This migration supplies durable uniqueness and immutable boundaries; it does not implement allocation or authorize provider calls.

Query-specific indexes support recipient uniqueness, sender allocation order, thread/shop lookup, live assignment scans, pending turn expiry/repair, and deletion cleanup by historical route/prompt scope. The two scope indexes keep physical shop deletion selective instead of scanning the entire retained turn table. No indexes are added to the high-volume unrelated Shopify ingress path.

Historical NULL dispatch sender fields remain valid for old writers. New paired dispatch identity is immutable after binding; ordered physical delivery parts and status receipts remain authoritative and unchanged. No synthetic backfill assigns sender ownership to old messages.

Run `npm run test:arch076-sender-pool:postgres` for an invocation-owned local pgvector/PostgreSQL container, actual Prisma authoring/deploy, all 80 predecessors, fresh/seeded upgrade, constraints, frozen evidence, concurrency and deletion checks. Containers and temporary files are removed in `finally`. No hosted database or system-test task is used.
