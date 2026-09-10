# Global PostgREST RPC identifier audit

## Finding

The global identifier test found one remaining 69-byte runtime RPC literal in
the Qoo10 legacy Lotte postwrite reconciliation path. PostgreSQL truncates
identifiers after 63 bytes, so the application literal could not address the
catalog function exactly through PostgREST.

The same audit also exposed stale assertions for two retired Qoo10 adopted
localization RPCs. Those assertions no longer represented the active new
registration path.

## Correction

- Renamed the not-yet-deployed legacy requirement RPC to the 53-byte
  `sellerpilot_service_record_qoo10_existing_requirement` in the migration,
  runtime constant and focused fixtures.
- Updated the global identifier test anchors to the current Qoo10 CREATE
  boundary and SmartStore category collector RPCs.
- Preserved provider mutation behavior and performed no remote call, production
  migration, commit, push or deployment.

The legacy exact-product runtime remains scheduled for deletion after the
current cumulative channel patches are integrated, because several pending
patches still use shared-file before hashes from the current central tree.

## Verification

- Global literal/dispatched RPC identifier test: passed.
- Qoo10 legacy postwrite fixture: 7/7 passed.
- Every runtime `sellerpilot_*` literal under app/lib/scripts is now at most 63
  UTF-8 bytes.

