#!/usr/bin/env python3
"""Prepare isolated CS worktrees from one uncommitted source snapshot; no commits."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
from datetime import datetime, timezone

ROOT = Path("/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908")
SNAPSHOTS = Path("/Users/kimchangheemac/dev/sellerpilot-cs-snapshots")
NODE = Path("/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node")
OWNER_PATH = "docs/cs-parallel/ownership.json"
CONTROL = {OWNER_PATH, "docs/cs-parallel/WORKSPACES.json"}
EXCLUDED_PREFIXES = (
    ".git/", ".openai/", ".vercel/", ".next/", ".vinext/", ".wrangler/",
    "node_modules/", "output/", "outputs/", "out/", "dist/", "coverage/",
    "tmp/", "work/", ".local/", "supabase/.temp/", "docs/evidence/",
    "docs/cs-parallel/reports/", "docs/cs-parallel/proposals/",
)
SECRET_PATTERNS = {
    "private_key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "github_token": rb"\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b",
    "openai_key": rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b",
    "aws_key": rb"\bAKIA[A-Z0-9]{16}\b",
    "jwt": rb"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b",
}
def run(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()
def digest(data):
    return hashlib.sha256(data).hexdigest()
def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".preparing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)
def names():
    raw = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    return sorted({item.decode() for item in raw.split(b"\0") if item})
def exclusion(name):
    if name in CONTROL:
        return "coordination metadata published after verification"
    if name == ".git" or name.startswith(EXCLUDED_PREFIXES):
        return "generated, operational metadata, raw evidence or work output"
    path = Path(name)
    if any(part.startswith(".env") for part in path.parts) and name != ".env.example":
        return "environment credentials"
    if path.suffix.lower() in {".pem", ".p12", ".pfx", ".key", ".log"} or name.endswith(".tsbuildinfo"):
        return "secret or generated file"
    return None
def inspect_files():
    entries, excluded, deleted = [], [], []
    for name in names():
        reason = exclusion(name)
        if reason:
            excluded.append({"path": name, "reason": reason})
            continue
        path = ROOT / name
        if not path.exists():
            deleted.append(name)
            continue
        if path.is_symlink():
            raise RuntimeError("Source symlink needs explicit review: " + name)
        if not path.is_file():
            raise RuntimeError("Unexpected source entry: " + name)
        data = path.read_bytes()
        if path.suffix.lower() in {".ts", ".tsx", ".js", ".mjs", ".py", ".sql", ".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".example"}:
            hits = [kind for kind, expression in SECRET_PATTERNS.items() if re.search(expression, data)]
            if hits:
                raise RuntimeError("Potential secret; review locally without printing values: " + name + " (" + ",".join(hits) + ")")
        entries.append({"path": name, "sha256": digest(data), "bytes": len(data),
                        "mode": stat.S_IMODE(path.stat().st_mode)})
    return entries, excluded, deleted
def verify(directory, entries):
    errors = []
    for item in entries:
        path = directory / item["path"]
        if not path.is_file() or digest(path.read_bytes()) != item["sha256"]:
            errors.append(item["path"])
        elif (stat.S_IMODE(path.stat().st_mode) & 0o111) != (item["mode"] & 0o111):
            errors.append(item["path"] + " (mode)")
    if errors:
        raise RuntimeError("Snapshot mismatch: " + ", ".join(errors[:15]))
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    owner = json.loads((ROOT / OWNER_PATH).read_text())
    if owner.get("workspacesPrepared"):
        raise RuntimeError("Already prepared; verify existing manifest rather than recreating.")
    for key, channel in owner["channels"].items():
        if Path(channel["workdir"]).exists():
            raise RuntimeError("Do not overwrite existing workspace: " + channel["workdir"])
        existing = run(["git", "branch", "--list", channel["branch"]])
        if existing:
            raise RuntimeError("Do not replace existing branch: " + channel["branch"])
    head = run(["git", "rev-parse", "HEAD"])
    if head != owner["sourceHead"]:
        raise RuntimeError("Source HEAD changed; re-review before snapshot.")
    entries, excluded, deleted = inspect_files()
    canonical = json.dumps({"head": head, "files": entries, "deleted": deleted},
                           sort_keys=True, ensure_ascii=False).encode()
    snapshot_id = "S0-20260908-" + digest(canonical)[:16]
    dependency_source = (ROOT / "node_modules").resolve()
    dependency_project = dependency_source.parent
    for name in ("package.json", "pnpm-lock.yaml"):
        if digest((ROOT / name).read_bytes()) != digest((dependency_project / name).read_bytes()):
            raise RuntimeError("Installed dependency contract differs: " + name)
    print(json.dumps({"mode": "execute" if args.execute else "preview",
                      "snapshotId": snapshot_id, "files": len(entries),
                      "sourceBytes": sum(item["bytes"] for item in entries),
                      "excluded": len(excluded), "deleted": deleted,
                      "workspaceCount": len(owner["channels"]),
                      "dependencyStrategy": "independent APFS copy-on-write clones; matching package and lockfile"},
                     ensure_ascii=False), flush=True)
    if not args.execute:
        return
    SNAPSHOTS.mkdir(mode=0o700, parents=True, exist_ok=True)
    snapshot = SNAPSHOTS / snapshot_id
    snapshot.mkdir(mode=0o700)
    tree = snapshot / "tree"
    tree.mkdir()
    for item in entries:
        src = ROOT / item["path"]
        data = src.read_bytes()
        if digest(data) != item["sha256"]:
            raise RuntimeError("Source changed while snapshotting: " + item["path"])
        dst = tree / item["path"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        dst.chmod(item["mode"])
    verify(tree, entries)
    latest, _, latest_deleted = inspect_files()
    if latest != entries or latest_deleted != deleted or run(["git", "rev-parse", "HEAD"]) != head:
        raise RuntimeError("Source changed during snapshot; no workspace release.")
    manifest = {"schemaVersion": 1, "snapshotId": snapshot_id, "sourceRoot": str(ROOT),
                "head": head, "createdAt": datetime.now(timezone.utc).isoformat(),
                "files": entries, "deleted": deleted, "excluded": excluded,
                "coordinationFiles": sorted(CONTROL),
                "environmentFilesCopied": False, "productionRuntimeConfigured": False,
                "dependencySource": str(dependency_source)}
    atomic_json(snapshot / "manifest.json", manifest)
    snapshot_owner = dict(owner)
    snapshot_owner.update(snapshotId=snapshot_id, workspacesPrepared=False)
    atomic_json(tree / OWNER_PATH, snapshot_owner)
    results = {}
    for key, channel in owner["channels"].items():
        workdir = Path(channel["workdir"])
        if workdir.exists():
            raise RuntimeError("Workspace appeared concurrently: " + str(workdir))
        print(json.dumps({"channel": key, "stage": "create_worktree"}, ensure_ascii=False), flush=True)
        subprocess.run(["git", "worktree", "add", "--no-checkout", "-b", channel["branch"],
                        str(workdir), head], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "read-tree", "HEAD"], cwd=workdir, check=True)
        shutil.copytree(tree, workdir, dirs_exist_ok=True)
        verify(workdir, entries)
        for name in deleted:
            if (workdir / name).exists():
                raise RuntimeError("Deleted baseline file restored: " + name)
        print(json.dumps({"channel": key, "stage": "clone_dependencies"}, ensure_ascii=False), flush=True)
        # -c is macOS clonefile: independent files sharing APFS blocks until written.
        # No fallback to an ordinary 8 x 3.9 GB copy on a space-limited workstation.
        subprocess.run(["/bin/cp", "-cR", str(dependency_source), str(workdir / "node_modules")], check=True)
        if (workdir / "node_modules").is_symlink():
            raise RuntimeError("Dependencies must be a separate directory.")
        result = subprocess.run([str(NODE), "--import", "tsx", "-e",
            "for (const n of ['next','tsx','typescript','@electric-sql/pglite']) process.stdout.write(n+'='+require.resolve(n)+'\\n')"],
            cwd=workdir, check=True, capture_output=True, text=True)
        # Avoid inheriting generated .next references from the source workspace.
        next_env = workdir / "next-env.d.ts"
        next_env.write_text('/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n')
        results[key] = {"workdir": str(workdir), "branch": channel["branch"], "port": channel["port"],
                        "snapshotId": snapshot_id, "filesVerified": len(entries),
                        "dependencies": "independent_apfs_clone", "dependencyResolution": result.stdout.splitlines(),
                        "environmentFilesCopied": False, "schedulerStarted": False,
                        "verifiedAt": datetime.now(timezone.utc).isoformat()}
        atomic_json(snapshot / "preparation-progress.json", results)
        print(json.dumps({"channel": key, "stage": "verified", "files": len(entries)}), flush=True)
    # Verify once more before allowing channel owners to edit.
    for channel in owner["channels"].values():
        verify(Path(channel["workdir"]), entries)
    readiness = {"schemaVersion": 1, "snapshotId": snapshot_id,
                 "manifestPath": str(snapshot / "manifest.json"), "snapshotTree": str(tree),
                 "coordinatorRoot": str(ROOT), "prepared": True, "channels": results}
    owner.update(snapshotId=snapshot_id, workspacesPrepared=True, snapshotManifestPath=str(snapshot / "manifest.json"))
    for channel in owner["channels"].values():
        atomic_json(Path(channel["workdir"]) / OWNER_PATH, owner)
        atomic_json(Path(channel["workdir"]) / "docs/cs-parallel/WORKSPACES.json", readiness)
    atomic_json(ROOT / "docs/cs-parallel/WORKSPACES.json", readiness)
    atomic_json(ROOT / OWNER_PATH, owner)
    atomic_json(snapshot / "prepared.json", readiness)
    print(json.dumps({"complete": True, "snapshotId": snapshot_id, "workspaces": len(results),
                      "manifestPath": str(snapshot / "manifest.json")}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()

