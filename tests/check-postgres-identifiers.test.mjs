import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_IDENTIFIER_MAX_BYTES,
  collectPostgresIdentifiers,
  postgresIdentifierViolations,
} from "../scripts/check-postgres-identifiers.mjs";

test("PostgreSQL identifier scan covers functions, indexes, constraints and PL/pgSQL bodies", () => {
  const source = `
    create function public.${"f".repeat(64)}() returns void language plpgsql as $body$
    begin
      create temporary table ${"t".repeat(64)} (id integer constraint ${"c".repeat(64)} check (id > 0));
    end;
    $body$;
    create index ${"i".repeat(64)} on public.items (id);
  `;
  assert.deepEqual(
    postgresIdentifierViolations(source).map(({ name, bytes }) => ({ name, bytes })),
    ["f", "t", "c", "i"].map((letter) => ({
      name: letter.repeat(64),
      bytes: POSTGRES_IDENTIFIER_MAX_BYTES + 1,
    })),
  );
});

test("identifier scan ignores comments and string values but checks quoted UTF-8 identifiers", () => {
  const longCommentName = "ignored_comment_".repeat(8);
  const longStringName = "ignored_string_".repeat(8);
  const quotedName = "가".repeat(22);
  const source = `
    -- create function ${longCommentName}()
    select '${longStringName}';
    create table "${quotedName}" (short_name integer);
  `;
  const names = collectPostgresIdentifiers(source).map(({ name }) => name);
  assert.equal(names.includes(longCommentName), false);
  assert.equal(names.includes(longStringName), false);
  assert.deepEqual(postgresIdentifierViolations(source), [{
    name: quotedName,
    line: 4,
    quoted: true,
    bytes: 66,
  }]);
});
