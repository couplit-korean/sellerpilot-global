# SmartStore collector RPC identifier correction

## Problem

The integrated SmartStore collector used the 72-byte PostgreSQL function name
`sellerpilot_service_smartstore_create_category_source_collection_context`.
PostgreSQL stores at most 63 bytes for an identifier, so the database would
silently truncate this name while the PostgREST client continued to request the
untruncated name.

## Correction

- Renamed the not-yet-deployed migration function to the 58-byte
  `sellerpilot_service_smartstore_create_category_collect_ctx`.
- Updated the admin route and PGlite/runtime fixtures to use that exact name.
- Kept the function signature, service-role-only ACL, source digest checks and
  category collection behavior unchanged.
- Did not change CS, shipping, another marketplace module, production DB,
  provider data, commit, push or deployment state.

## Verification

- SmartStore focused contract and collector tests: 29/29 passed.
- Changed-file ESLint: passed.
- Full nonincremental TypeScript check: passed after the central integrations.
- Product/CS/shipping dependency audit: six cross-domain counts are zero.
- Eight-channel module audit: no missing module or cross-channel dependency.

