import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

function blankCharacter(character) {
  return character === "\n" || character === "\r" ? character : " ";
}

/**
 * Remove SQL comments, string literals, and dollar-quote delimiters while
 * preserving line numbers and the PL/pgSQL body between dollar delimiters.
 * Static identifiers inside function bodies must be checked too.
 */
export function sqlForIdentifierScan(source) {
  const output = [...source];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      let end = source.indexOf("\n", index + 2);
      if (end < 0) end = source.length;
      for (let cursor = index; cursor < end; cursor += 1) {
        output[cursor] = blankCharacter(source[cursor]);
      }
      index = end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < source.length && depth > 0) {
        if (source.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (source.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      for (let blank = index; blank < cursor; blank += 1) {
        output[blank] = blankCharacter(source[blank]);
      }
      index = cursor;
      continue;
    }
    if (source[index] === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "'" && source[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === "'") {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      for (let blank = index; blank < cursor; blank += 1) {
        output[blank] = blankCharacter(source[blank]);
      }
      index = cursor;
      continue;
    }
    if (source[index] === "$") {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(source.slice(index));
      if (delimiter) {
        for (let cursor = index; cursor < index + delimiter[0].length; cursor += 1) {
          output[cursor] = " ";
        }
        index += delimiter[0].length;
        continue;
      }
    }
    index += 1;
  }
  return output.join("");
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

export function collectPostgresIdentifiers(source) {
  const sql = sqlForIdentifierScan(source);
  const identifiers = [];
  let index = 0;
  while (index < sql.length) {
    if (sql[index] === '"') {
      const start = index;
      index += 1;
      let value = "";
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        if (sql[index] === '"') {
          index += 1;
          break;
        }
        value += sql[index];
        index += 1;
      }
      identifiers.push({ name: value, line: lineNumberAt(sql, start), quoted: true });
      continue;
    }
    if (/[A-Za-z_]/u.test(sql[index])) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/u.test(sql[index])) index += 1;
      identifiers.push({
        name: sql.slice(start, index),
        line: lineNumberAt(sql, start),
        quoted: false,
      });
      continue;
    }
    index += 1;
  }
  return identifiers;
}

export function postgresIdentifierViolations(source) {
  return collectPostgresIdentifiers(source)
    .map((identifier) => ({
      ...identifier,
      bytes: Buffer.byteLength(identifier.name, "utf8"),
    }))
    .filter((identifier) => identifier.bytes > POSTGRES_IDENTIFIER_MAX_BYTES);
}

async function main(paths) {
  if (paths.length === 0) {
    throw new Error("Usage: node scripts/check-postgres-identifiers.mjs <migration.sql> [...]");
  }
  let failures = 0;
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    const violations = postgresIdentifierViolations(source);
    if (violations.length === 0) {
      console.log(`PASS ${path}: every static PostgreSQL identifier is <= 63 UTF-8 bytes`);
      continue;
    }
    failures += violations.length;
    for (const violation of violations) {
      console.error(
        `FAIL ${path}:${violation.line}: ${violation.name} is ${violation.bytes} UTF-8 bytes`,
      );
    }
  }
  if (failures > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "PostgreSQL identifier check failed");
    process.exitCode = 1;
  });
}
