import { readdir } from "node:fs/promises";

// Explicit operator-owned input, not a release migration. Keep the file on disk
// untouched and do not execute it even in disposable replay fixtures.
export const protectedUntrackedMigration = "20260903150000_unblock_shopee_second_oauth_deadlock.sql";
export async function listMigrationSourceFiles(directory) {
  return (await readdir(directory)).filter((name) => name !== protectedUntrackedMigration);
}
