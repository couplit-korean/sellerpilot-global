import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collector", Path(__file__).resolve().parents[1] / "scripts/collect-product-channel-reports.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class InboxTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = self.root / "channel/reports"
        self.report.mkdir(parents=True)
        self.registry = self.root / "ownership.json"
        self.registry.write_text(json.dumps({"channels": [{"key": "test", "worktree": str(self.root / "channel"), "report": "reports"}]}))
        self.state = self.root / "state"

    def collect(self, ack=None):
        return collector.update_inbox(self.registry, self.state, ack)

    def items(self):
        return json.loads((self.state / "inbox.json").read_text())["items"]

    def test_repeated_scan_does_not_duplicate_or_forget_ack(self):
        (self.report / "status.json").write_text('{"stage":"local"}')
        self.assertEqual(self.collect()["added"], 1)
        identity = next(iter(self.items()))
        self.assertEqual(self.collect((identity, "reviewed", "Local status checked"))["pending"], 0)
        self.assertEqual(self.collect()["added"], 0)
        self.assertEqual(self.items()[identity]["state"], "reviewed")

    def test_changed_or_deleted_report_retains_prior_snapshot(self):
        report = self.report / "proposal.patch"
        report.write_text("first patch")
        self.collect()
        first = next(iter(self.items().values()))
        report.write_text("second patch")
        self.assertEqual(self.collect()["pending"], 2)
        report.unlink()
        self.assertEqual(self.collect()["pending"], 2)
        self.assertEqual(Path(first["snapshot"]).read_text(), "first patch")

    def test_partial_json_and_temporary_files_wait_without_losing_items(self):
        (self.report / "status.json").write_text('{"unfinished":')
        (self.report / "status.json.tmp").write_text("pending")
        self.assertEqual(self.collect()["added"], 0)
        (self.report / "status.json").write_text('{"ready":true}')
        self.assertEqual(self.collect()["added"], 1)

    def test_symlink_outside_report_is_not_copied(self):
        secret = self.root / "private.json"
        secret.write_text('{"private":"not a report"}')
        (self.report / "decoy.json").symlink_to(secret)
        self.assertEqual(self.collect()["added"], 0)

    def test_invalid_ack_or_corrupt_index_cannot_reset_existing_queue(self):
        (self.report / "status.md").write_text("working")
        self.collect()
        index = self.state / "inbox.json"
        before = index.read_bytes()
        with self.assertRaises(ValueError):
            self.collect(("unknown", "integrated", "no evidence"))
        self.assertEqual(index.read_bytes(), before)
        index.write_text("broken JSON")
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(index.read_text(), "broken JSON")


if __name__ == "__main__":
    unittest.main()
