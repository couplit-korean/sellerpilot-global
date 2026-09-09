"""Snapshot channel reports into a durable review inbox; never apply code or call providers."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pending-")
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update_inbox(registry_path, state_dir, acknowledgement=None):
    registry = json.loads(Path(registry_path).read_text())
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    with (state_dir / "collector.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        index = state_dir / "inbox.json"
        state = json.loads(index.read_text()) if index.exists() else {"version": 1, "items": {}}
        if state.get("version") != 1 or not isinstance(state.get("items"), dict):
            raise ValueError("Invalid inbox; existing state was preserved")
        now = datetime.now(timezone.utc).isoformat()
        added, channels = [], {}
        for channel in registry["channels"]:
            key = channel["key"]
            worktree = Path(channel["worktree"]).resolve()
            folder = worktree / channel["report"]
            if worktree not in folder.resolve().parents or folder.is_symlink():
                raise ValueError("Report directory escaped its worktree")
            observed = {"reportPresent": folder.is_dir(), "files": 0, "issues": []}
            channels[key] = observed
            if not folder.is_dir():
                continue
            for path in sorted(folder.rglob("*")):
                if path.suffix not in {".md", ".json", ".patch", ".diff"} or not path.is_file():
                    continue
                relative = str(path.relative_to(folder))
                if path.is_symlink() or folder.resolve() not in path.resolve().parents:
                    observed["issues"].append({"file": relative, "reason": "symlink_or_escape"})
                    continue
                try:
                    if path.stat().st_size > 8 * 1024 * 1024:
                        raise ValueError("report_too_large")
                    before = path.stat()
                    data = path.read_bytes()
                    after = path.stat()
                    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                        raise ValueError("report_changing_retry_next_scan")
                    if path.suffix == ".json":
                        json.loads(data)
                except (OSError, ValueError) as error:
                    observed["issues"].append({"file": relative, "reason": type(error).__name__})
                    continue
                observed["files"] += 1
                digest = hashlib.sha256(data).hexdigest()
                identity = hashlib.sha256((key + "\0" + relative + "\0" + digest).encode()).hexdigest()
                if identity in state["items"]:
                    continue
                snapshot = state_dir / "snapshots" / (identity + path.suffix)
                atomic_write(snapshot, data)
                state["items"][identity] = {
                    "channel": key, "source": str(path), "relativePath": relative,
                    "sha256": digest, "snapshot": str(snapshot), "observedAt": now,
                    "state": "pending", "kind": "status" if path.name in {"status.md", "status.json"} else "submission",
                }
                added.append(identity)
        if acknowledgement:
            identity, decision, note = acknowledgement
            if identity not in state["items"] or decision not in {"reviewed", "integrated", "blocked", "superseded"} or not note.strip():
                raise ValueError("Acknowledgement needs an existing item, valid decision and evidence note")
            item = state["items"][identity]
            item["state"], item["note"], item["reviewedAt"] = decision, note, now
        state["channels"], state["scannedAt"] = channels, now
        atomic_write(index, (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode())
        return {"index": str(index), "added": len(added), "pending": sum(i["state"] == "pending" for i in state["items"].values()), "channels": channels}


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=root / "docs/product-channel-parallel/ownership.json")
    parser.add_argument("--state-dir", type=Path, default=root / ".local/product-channel-inbox")
    parser.add_argument("--ack", nargs=3, metavar=("ID", "STATE", "EVIDENCE_NOTE"))
    arguments = parser.parse_args()
    print(json.dumps(update_inbox(arguments.registry, arguments.state_dir, arguments.ack), ensure_ascii=False, indent=2))
