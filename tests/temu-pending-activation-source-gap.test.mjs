import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { PGlite } = await import(
  process.env.PGLITE_MODULE ?? "@electric-sql/pglite"
);

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260831133000_expand_verified_publication_to_temu.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourcePatch = migration.match(
  /do \$temu_pending_activation_source_patch\$[\s\S]*?\$temu_pending_activation_source_patch\$;/,
)?.[0];
assert.ok(sourcePatch, "Temu pending activation patch must be extractable");

const productionMd5 = {
  current: "4765c255abb7e84d7054c56b4cb1fc3d",
  gapSource: "e3f30aa629b5a1a2bb4f46a3722ec115",
  chronologicalSource: "0d7330a053d24a3ee02855a63d13780d",
  guard: "1216480d14bbda832778f8b9f82ee55d",
  registerAtPatch: "ffc6745ae02af71c199772a685746d37",
  apply: "43c702a316401a65f952f02352e948c2",
  isCurrent: "ddce8cb84825f978def563631ee031e7",
};

const compatibilitySql = String.raw`
create schema sellerpilot_private;

create function sellerpilot_private.qoo10_definition_occurrences(
  p_haystack text,
  p_needle text
)
returns integer language sql immutable strict as $$
  select case when p_needle = '' then 0 else
    (length(p_haystack) - length(replace(p_haystack,p_needle,''))) /
    length(p_needle) end
$$;

create function sellerpilot_private.guard_listing_publication_review()
returns boolean language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  perform array['listing.create', 'listing.update'];
  return true;
end $$;
create function sellerpilot_private.register_pending_listing_publication_review(uuid)
returns boolean language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  return true;
end $$;
create function sellerpilot_private.apply_listing_publication_verifier_completion(uuid)
returns boolean language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  perform array['listing.create', 'listing.update'];
  return true;
end $$;
create function sellerpilot_private.listing_publication_review_is_current(uuid)
returns boolean language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  return true;
end $$;

create function public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(
  text,uuid,uuid
)
returns text language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  return 'gap-source';
end $$;
create function public.sellerpilot_service_listing_publication_verification_source(
  text,uuid,uuid
)
returns text language plpgsql as $$ begin
  return public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(
    $1,$2,$3
  );
end $$;
`;

const chronologicalSourceSql = String.raw`
create function public.sellerpilot_310540_listing_publication_verification_source(
  text,uuid,uuid
)
returns text language plpgsql as $$ begin
  perform array['listing.create', 'listing.update'];
  return 'chronological-source';
end $$;
`;

const signatures = {
  current:
    "public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)",
  gapSource:
    "public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(text,uuid,uuid)",
  chronologicalSource:
    "public.sellerpilot_310540_listing_publication_verification_source(text,uuid,uuid)",
  guard: "sellerpilot_private.guard_listing_publication_review()",
  registerAtPatch:
    "sellerpilot_private.register_pending_listing_publication_review(uuid)",
  apply:
    "sellerpilot_private.apply_listing_publication_verifier_completion(uuid)",
  isCurrent:
    "sellerpilot_private.listing_publication_review_is_current(uuid)",
};

async function definition(db, signature) {
  const { rows } = await db.query(
    `select pg_get_functiondef(to_regprocedure($1)) definition`,
    [signature],
  );
  return rows[0]?.definition;
}

async function setup() {
  const db = new PGlite();
  await db.exec(compatibilitySql);
  await db.exec(chronologicalSourceSql);
  const fixtureMd5 = {};
  for (const [name, signature] of Object.entries(signatures)) {
    const { rows } = await db.query(
      `select md5(pg_get_functiondef(to_regprocedure($1))) value`,
      [signature],
    );
    fixtureMd5[name] = rows[0]?.value;
  }
  await db.exec(
    `drop function public.sellerpilot_310540_listing_publication_verification_source(text,uuid,uuid)`,
  );
  let executablePatch = sourcePatch;
  for (const [name, value] of Object.entries(productionMd5)) {
    executablePatch = executablePatch.replaceAll(value, fixtureMd5[name]);
  }
  return { db, executablePatch };
}

test("Temu activation source patch follows the exact 310540-gap predecessor", async () => {
  const { db, executablePatch } = await setup();
  try {
    const currentBefore = await definition(db, signatures.current);
    assert.equal(
      (await db.query(`select to_regprocedure($1) value`, [signatures.chronologicalSource])).rows[0].value,
      null,
    );
    await db.exec(executablePatch);
    assert.equal(await definition(db, signatures.current), currentBefore);
    assert.match(
      await definition(db, signatures.gapSource),
      /'listing\.create', 'listing\.update', 'listing\.activate'/,
    );
    for (const signature of [
      signatures.guard,
      signatures.registerAtPatch,
      signatures.apply,
      signatures.isCurrent,
    ]) {
      assert.match(
        await definition(db, signature),
        /'listing\.create', 'listing\.update', 'listing\.activate'/,
      );
    }
  } finally {
    await db.close();
  }
});

const driftCases = [
  [
    "current delegate wrapper drifts",
    `create or replace function public.sellerpilot_service_listing_publication_verification_source(
       text,uuid,uuid
     ) returns text language sql as $$ select 'drift'::text $$`,
    /current source wrapper drifted/,
  ],
  [
    "gap predecessor drifts",
    `create or replace function public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(
       text,uuid,uuid
     ) returns text language sql as $$ select 'drift'::text $$`,
    /source predecessor drifted/,
  ],
  [
    "private review source drifts",
    `create or replace function sellerpilot_private.listing_publication_review_is_current(uuid)
     returns boolean language sql as $$ select false $$`,
    /private source preimage drifted/,
  ],
  [
    "inconsistent chronological and gap predecessors coexist",
    chronologicalSourceSql,
    /chronological wrapper drifted/,
  ],
];

for (const [name, driftSql, error] of driftCases) {
  test(`Temu activation source patch rejects when ${name}`, async () => {
    const { db, executablePatch } = await setup();
    try {
      await db.exec(driftSql);
      await assert.rejects(db.exec(executablePatch), error);
    } finally {
      await db.close();
    }
  });
}
