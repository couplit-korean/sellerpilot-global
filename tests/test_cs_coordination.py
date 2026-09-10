import importlib.util
import hashlib
import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location('collector', Path(__file__).parents[1] / 'scripts/cs-coordination.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.docs = self.root / 'docs/cs-review-20260909'
        self.channel = self.root / 'worker/docs/cs-review-20260909/test'
        self.channel.mkdir(parents=True)
        self.state = self.root / '.local/cs-coordination'
        collector.write(self.docs / 'ownership.json', {'channels': [{'key': 'test', 'title': 'test', 'threadId': 'thread', 'worktree': str(self.root / 'worker')}]})
        collector.write(self.docs / 'work-items.json', {'version': 1, 'scope': 'fixture', 'items': [{'id': 'task', 'channel': 'test', 'centralAccepted': False}]})
        collector.write(self.state / 'report-state.json', {'nextReportAt': (collector.now() + timedelta(minutes=30)).isoformat(), 'lastPercent': {'test': 0}})
        for name in ['status.json', 'progress.json']:
            collector.write(self.channel / name, {'channel': 'test', 'revision': 1})
        (self.channel / 'review.md').write_text('Reviewed fixture')

    def tearDown(self):
        self.tmp.cleanup()

    def test_repeat_collection_deduplicates(self):
        first = collector.collect(self.root)
        second = collector.collect(self.root)
        self.assertEqual([x['id'] for x in first['pending']], [x['id'] for x in second['pending']])
        self.assertEqual(len(second['pending']), 3)

    def test_new_revision_survives_old_ack(self):
        first = collector.collect(self.root)
        event = next(e for e in first['pending'] if e['file'] == 'progress.json')
        collector.acknowledge(self.root, event['id'], 'reviewed', 'old version received')
        collector.write(self.channel / 'progress.json', {'channel': 'test', 'revision': 2})
        second = collector.collect(self.root)
        self.assertEqual(len([e for e in second['pending'] if e['file'] == 'progress.json']), 1)
        self.assertNotIn(event['id'], [e['id'] for e in second['pending']])

    def test_archived_submission_survives_latest_replacement_between_polls(self):
        collector.write(self.channel / 'submission-old.json', {
            'channel': 'test', 'submissionId': 'old'})
        collector.write(self.channel / 'submission.json', {
            'channel': 'test', 'submissionId': 'new'})
        result = collector.collect(self.root)
        submitted = [e for e in result['pending'] if e['file'].startswith('submission')]
        self.assertEqual({e['file'] for e in submitted}, {'submission-old.json', 'submission.json'})
        for event in submitted:
            collector.acknowledge(self.root, event['id'], 'reviewed', 'received')
        self.assertFalse(any(e['file'].startswith('submission') for e in collector.collect(self.root)['pending']))

    def test_invalid_report_does_not_erase_prior_event(self):
        first = collector.collect(self.root)
        (self.channel / 'progress.json').write_text('{broken')
        second = collector.collect(self.root)
        self.assertEqual(len(first['pending']), len(second['pending']))
        self.assertTrue(any(e['file'] == 'progress.json' for e in second['errors']))

    def test_missing_progress_is_visible(self):
        (self.channel / 'progress.json').unlink()
        result = collector.collect(self.root)
        self.assertIn({'channel': 'test', 'file': 'progress.json', 'error': 'missing'}, result['errors'])
        self.assertEqual(result['channels'][0]['threadStatus'], 'unknown')

    def test_self_report_cannot_raise_progress(self):
        collector.write(self.channel / 'progress.json', {'channel': 'test', 'centralAccepted': True, 'percent': 100})
        self.assertEqual(collector.collect(self.root)['percent'], 0)

    def test_local_readiness_is_reported_without_promoting_external_acceptance(self):
        proof = self.root / 'local-proof.json'
        proof.write_text('{}')
        collector.write(self.docs / 'work-items.json', {
            'version': 1,
            'scope': 'fixture',
            'items': [{
                'id': 'task',
                'channel': 'test',
                'state': 'external_evidence_pending',
                'centralAccepted': False,
                'localCodeIntegrated': True,
                'currentAssignedLocalWorkIntegrated': True,
                'evidence': {
                    'localImplementationScopeExhausted': True,
                    'latestCentralReview': 'local-proof.json',
                },
            }],
        })
        result = collector.collect(self.root)
        self.assertEqual(result['localReady'], 1)
        self.assertEqual(result['localReadyPercent'], 100)
        self.assertEqual(result['accepted'], 0)
        self.assertEqual(result['percent'], 0)

    def test_failed_unloaded_turn_overrides_running_progress(self):
        collector.write(self.channel / 'progress.json', {'channel': 'test', 'state': 'running'})
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'notLoaded'}},
                       'latestTurn': {'status': 'failed', 'error': {'message': 'usage limit'}}}]})
        result = collector.collect(self.root)
        self.assertEqual(result['channels'][0]['threadStatus'], 'failed')
        self.assertEqual(result['channels'][0]['idleAction'], 'record_failure_and_recover_saved_work')
        self.assertEqual(result['errors'][0]['error'], 'thread_execution_failed')

    def test_old_active_snapshot_requires_refresh(self):
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': (collector.now() - timedelta(minutes=6)).isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'active'}}}]})
        result = collector.collect(self.root)['channels'][0]
        self.assertEqual(result['threadStatus'], 'unknown')
        self.assertEqual(result['idleAction'], 'refresh_thread_snapshot')

    def test_completed_idle_snapshot_remains_valid_through_report_window(self):
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': (collector.now() - timedelta(minutes=30)).isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'notLoaded'}},
                       'latestTurn': {'status': 'completed', 'error': None}}]})
        result = collector.collect(self.root)['channels'][0]
        self.assertFalse(result['snapshotStale'])
        self.assertEqual(result['threadStatus'], 'idle')

    def test_completed_idle_snapshot_expires_after_report_window_buffer(self):
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': (collector.now() - timedelta(minutes=36)).isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'notLoaded'}},
                       'latestTurn': {'status': 'completed', 'error': None}}]})
        result = collector.collect(self.root)['channels'][0]
        self.assertTrue(result['snapshotStale'])
        self.assertEqual(result['idleAction'], 'refresh_thread_snapshot')

    def test_completed_unloaded_turn_is_idle(self):
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'notLoaded'}},
                       'latestTurn': {'status': 'completed', 'error': None}}]})
        self.assertEqual(collector.collect(self.root)['channels'][0]['threadStatus'], 'idle')

    def test_idle_queue_excludes_completed_and_blocked_checkpoints(self):
        collector.write(self.docs / 'queues/test.json', {'items': [
            {'assignmentId': key, 'state': 'ready'} for key in ['done', 'blocked', 'next']]})
        collector.write(self.channel / 'progress.json', {
            'channel': 'test', 'completedQueueAssignmentIds': ['done'],
            'blockedQueueAssignments': {'blocked': 'external dependency'}})
        collector.write(self.state / 'thread-snapshot.json', {
            'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        result = collector.collect(self.root)['channels'][0]
        self.assertEqual(result['readyQueueAssignmentIds'], ['next'])
        self.assertEqual(result['idleAction'], 'resume_ready_queue')
        self.assertEqual(result['percent'], 0)

    def test_completed_channel_does_not_redispatch_stale_ready_queue(self):
        (self.root / 'proof.md').write_text('Verified central record')
        collector.write(self.docs / 'work-items.json', {'version': 1, 'scope': 'fixture', 'items': [{
            'id': 'task', 'channel': 'test', 'centralAccepted': True,
            'evidence': {'acceptanceTestsPassed': True, 'integratedSha': 'a' * 40, 'centralRecord': 'proof.md'}}]})
        collector.write(self.docs / 'queues/test.json', {'items': [{'assignmentId': 'old', 'state': 'ready'}]})
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        self.assertEqual(collector.collect(self.root)['channels'][0]['idleAction'], 'completed_no_redispatch')

    def test_submitted_and_permission_pending_are_not_unassigned_idle(self):
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        for state, action in [
            ('submitted', 'central_review_pending'),
            ('permission_pending', 'blocked_external_evidence'),
            ('central_local_integrated_external_pending', 'blocked_external_evidence'),
        ]:
            collector.write(self.channel / 'progress.json', {'channel': 'test', 'state': state, 'blockers': ['contract unavailable']})
            self.assertEqual(collector.collect(self.root)['channels'][0]['idleAction'], action)

    def test_backlog_external_evidence_state_overrides_stale_worker_submission(self):
        collector.write(self.docs / 'work-items.json', {'version': 1, 'scope': 'fixture', 'items': [{
            'id': 'task', 'channel': 'test', 'state': 'external_evidence_pending',
            'centralAccepted': False,
        }]})
        collector.write(self.channel / 'progress.json', {
            'channel': 'test', 'state': 'submitted', 'blockers': [],
        })
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        self.assertEqual(
            collector.collect(self.root)['channels'][0]['idleAction'],
            'blocked_external_evidence',
        )

    def test_central_acceptance_requires_evidence(self):
        item = {'id': 'task', 'channel': 'test', 'centralAccepted': True, 'evidence': {'acceptanceTestsPassed': True, 'integratedSha': 'a' * 40, 'centralRecord': 'proof.md'}}
        collector.write(self.docs / 'work-items.json', {'version': 1, 'scope': 'fixture', 'items': [item]})
        self.assertEqual(collector.collect(self.root)['percent'], 0)
        (self.root / 'proof.md').write_text('Verified central record')
        result = collector.collect(self.root)
        self.assertEqual(result['percent'], 100)
        self.assertEqual(result['channels'][0]['deltaPercentagePoints'], 100)

    def test_missed_report_slots_collapse(self):
        collector.write(self.state / 'report-state.json', {'nextReportAt': (collector.now() - timedelta(minutes=95)).isoformat(), 'lastPercent': {'test': 0}})
        self.assertTrue(collector.collect(self.root)['reportDue'])
        saved = collector.mark_report(self.root)
        self.assertFalse(collector.collect(self.root)['reportDue'])
        self.assertEqual(
            collector.timestamp(saved['nextReportAt']) - collector.timestamp(saved['lastReportAt']),
            timedelta(minutes=30),
        )

    def test_local_integration_requires_current_content_hashes(self):
        (self.root / 'proof.md').write_text('Central tests passed on local tree')
        source = self.root / 'source.ts'
        source.write_text('verified source')
        item = {'centralAccepted': True, 'evidence': {
            'acceptanceTestsPassed': True, 'centralRecord': 'proof.md',
            'localIntegration': {'baseCommit': 'a' * 40, 'files': {
                'source.ts': hashlib.sha256(source.read_bytes()).hexdigest()}}}}
        self.assertTrue(collector.accepted(item, self.root))
        source.write_text('changed after verification')
        self.assertFalse(collector.accepted(item, self.root))
        source.unlink()
        self.assertFalse(collector.accepted(item, self.root))

    def test_unknown_ack_rejected(self):
        with self.assertRaises(ValueError):
            collector.acknowledge(self.root, 'missing', 'reviewed', 'not observed')

    def test_dispatch_is_reserved_once_and_receipt_is_bound(self):
        collector.write(self.docs / 'assignments/test.json', {'threadId': 'thread', 'dispatchState': 'prepared'})
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(), 'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        collector.reserve_dispatch(self.root, 'test')
        with self.assertRaises(ValueError):
            collector.reserve_dispatch(self.root, 'test')
        with self.assertRaises(ValueError):
            collector.confirm_dispatch(self.root, 'test', {'threadId': 'wrong'})
        self.assertEqual(collector.confirm_dispatch(self.root, 'test', {'threadId': 'thread'})['dispatchState'], 'accepted')

    def test_active_thread_not_dispatched(self):
        collector.write(self.docs / 'assignments/test.json', {'threadId': 'thread', 'dispatchState': 'prepared'})
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(), 'polls': [{'thread': {'id': 'thread', 'status': {'type': 'active'}}}]})
        with self.assertRaises(ValueError):
            collector.reserve_dispatch(self.root, 'test')

    def test_partial_poll_merge_preserves_other_threads_age_and_cursor(self):
        old = (collector.now() - timedelta(minutes=40)).isoformat()
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': old,
            'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}, 'cursor': 'old-cursor'}]})
        ownership = collector.read(self.docs / 'ownership.json')
        ownership['channels'].append({'threadId': 'second'})
        collector.write(self.docs / 'ownership.json', ownership)
        result = collector.merge_thread_polls(self.root, {'observedAt': collector.now().isoformat(),
            'polls': [{'thread': {'id': 'second', 'status': {'type': 'active'}}, 'cursor': 'new-cursor'}]})
        original = next(p for p in result['polls'] if p['thread']['id'] == 'thread')
        self.assertEqual(original['observedAt'], old)
        self.assertEqual(original['cursor'], 'old-cursor')
        collector.write(self.docs / 'assignments/test.json', {'threadId': 'thread', 'dispatchState': 'prepared'})
        with self.assertRaisesRegex(ValueError, 'refresh thread snapshot'):
            collector.reserve_dispatch(self.root, 'test')

    def test_poll_merge_rejects_stale_unknown_and_duplicate_observations(self):
        for incoming in [
            {'observedAt': (collector.now() - timedelta(minutes=6)).isoformat(), 'polls': []},
            {'observedAt': collector.now().isoformat(), 'polls': [{'thread': {'id': 'unknown'}}]},
            {'observedAt': collector.now().isoformat(), 'polls': [{'thread': {'id': 'thread'}}] * 2},
        ]:
            with self.assertRaises(ValueError):
                collector.merge_thread_polls(self.root, incoming)

    def test_unloaded_completed_thread_can_receive_next_assignment_but_unknown_cannot(self):
        for latest in [None, 'inProgress', 'failed', 'completed']:
            collector.write(self.docs / 'assignments/test.json', {'threadId': 'thread', 'dispatchState': 'prepared'})
            collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat(),
                'polls': [{'thread': {'id': 'thread', 'status': {'type': 'notLoaded'}},
                           'latestTurn': {'status': latest}}]})
            if latest == 'completed':
                self.assertEqual(collector.reserve_dispatch(self.root, 'test')['dispatchState'], 'sending')
            else:
                with self.assertRaises(ValueError):
                    collector.reserve_dispatch(self.root, 'test')

    def test_app_utc_z_timestamp_dispatch(self):
        collector.write(self.docs / 'assignments/test.json', {'threadId': 'thread', 'dispatchState': 'prepared'})
        collector.write(self.state / 'thread-snapshot.json', {'observedAt': collector.now().isoformat().replace('+00:00', 'Z'), 'polls': [{'thread': {'id': 'thread', 'status': {'type': 'idle'}}}]})
        self.assertEqual(collector.reserve_dispatch(self.root, 'test')['dispatchState'], 'sending')


    def test_invalid_submission_is_preserved_and_exact_rejection_is_observable(self):
        source = self.channel / 'submission-invalid.json'
        source.write_text('{"submissionId":"missing-channel"}')
        first = collector.collect(self.root)
        event = next(e for e in first['pending'] if e['file'] == source.name)
        saved = collector.read(self.state / 'events' / (event['id'] + '.json'))
        self.assertEqual(saved['body'], source.read_text())
        self.assertEqual(saved['validationError'], 'channel mismatch')
        for disposition in ['integrated', 'reviewed']:
            with self.assertRaises(ValueError):
                collector.acknowledge(self.root, event['id'], disposition, 'invalid source')
        collector.acknowledge(self.root, event['id'], 'needs_changes', 'corrected envelope required')
        second = collector.collect(self.root)
        self.assertFalse(any(e['file'] == source.name for e in second['pending']))
        self.assertFalse(any(e['file'] == source.name for e in second['errors']))
        self.assertEqual(second['reviewedValidationErrors'][0]['eventId'], event['id'])
        self.assertEqual(second['accepted'], 0)

    def test_changed_invalid_submission_cannot_reuse_previous_rejection(self):
        source = self.channel / 'submission-changing.json'
        source.write_text('{broken')
        first = collector.collect(self.root)
        prior = next(e for e in first['pending'] if e['file'] == source.name)
        collector.acknowledge(self.root, prior['id'], 'needs_changes', 'broken JSON reviewed')
        source.write_text('{"channel":"wrong"}')
        second = collector.collect(self.root)
        fresh = next(e for e in second['pending'] if e['file'] == source.name)
        self.assertNotEqual(fresh['id'], prior['id'])
        self.assertTrue(any(e['file'] == source.name for e in second['errors']))
        collector.write(source, {'channel': 'test', 'submissionId': 'corrected'})
        third = collector.collect(self.root)
        events = [e for e in third['pending'] if e['file'] == source.name]
        self.assertEqual(len(events), 2)
        self.assertFalse(any(e['file'] == source.name for e in third['errors']))

    def test_nonobject_submission_is_captured_without_crashing_other_reports(self):
        source = self.channel / 'submission-array.json'
        source.write_text('[]')
        result = collector.collect(self.root)
        self.assertTrue(any(e['file'] == 'progress.json' for e in result['pending']))
        invalid = next(e for e in result['pending'] if e['file'] == source.name)
        saved = collector.read(self.state / 'events' / (invalid['id'] + '.json'))
        self.assertEqual(saved['validationError'], 'report must be a JSON object')


if __name__ == '__main__':
    unittest.main()
