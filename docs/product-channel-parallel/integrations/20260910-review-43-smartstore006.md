# SmartStore006 serverless source fence integration

Verified canonical patch SHA-256 9510f01ea1a286b26566e2306a6119865ec441b8240f2bdd7b56f73cfa81c807. Migration version 20260910014000 passed local collision/date validation and is reserved for SmartStore006; Elevenst005 retains 20260910014500. Both submitted files were new, and their before/after hashes were checked before central application.

The serverless provider-begin RPC is a separate boundary from the local worker RPC. The new wrapper invokes the existing SmartStore source predicate before delegating, rejecting a changed product/SKU/detail/credential/owner/claim and retaining the common ledger-then-SmartStore lock order. This installs no operating data or provider mutation.

The submitted test reproduces the old serverless bypass using a minimal predecessor. Root additionally expanded the existing composition regression to install actual SmartStore005, Shopee0130 and SmartStore006 SQL together in one PGlite database. Both local and serverless entry points reject a one-microsecond product revision drift, allow the restored source once, and reject replay. The base transport remains a fixture; this is not the complete historical migration chain.

Combined SmartStore source, serverless and Shopee execution-lineage tests passed 12/12; both changed test files passed ESLint. Source receipts and root test adjustment hashes are recorded in `.local/product-channel-inbox/review43-smartstore006.json`. No TypeScript production source was changed in this patch. No production SQL, deployment, provider PUT/CREATE, commit or push was performed by this integration.
