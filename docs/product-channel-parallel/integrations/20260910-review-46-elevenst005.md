# Elevenst005 credential-version CAS integration

Verified frozen patch SHA-256 `c76445a706816b7146560b70826f6950e93ea430e09b0712823773634a6438f2`, all seven current central before hashes and four absent new paths. Migration `20260910014500_elevenst_credential_version_cas.sql` was already reserved for this task and was integrated locally with the ten code/test changes.

An existing 11st credential edit now rotates only when the selected active credential ID and version still match under the same advisory transaction lock as the shared rotation RPC. Local and serverless workers fetch the current database version immediately before provider preparation, and the database trigger checks the active unexpired credential again when `provider_mutation_started_at` changes. A rotation between the receipt and final provider boundary therefore fails closed. Other channels and non-CREATE operations retain the previous paths.

Root independently ran focused scratch tests `29/29` and the central 11st product plus shared gateway, Temu and Qoo10 regression set `231/231`. Full nonincremental TypeScript and ESLint for all changed files passed. A first broad glob also selected two unrelated legacy/CS tests whose fixtures require a deliberately deleted recovery module or a special `server-only` loader; those were excluded rather than counted as product failures.

No production migration, credential rotation, Vault update, provider call, deployment, commit or push was performed by this integration. The operating 11st seller credential and a new authorized CREATE with official readback remain unverified.
