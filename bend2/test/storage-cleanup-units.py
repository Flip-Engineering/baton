"""Scheduled log-cleanup unit checks (issue #912).

The templates are OS wiring only. They target the Bend2 `logs-clean-all`
command with the authoritative database argument and stay uninstalled until
the command contract is published and root approves deployment.
"""
import pathlib
import plistlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SERVICE = ROOT / 'deploy/storage/systemd/baton-logs-cleanup.service'
TIMER = ROOT / 'deploy/storage/systemd/baton-logs-cleanup.timer'
AGENT = ROOT / 'deploy/storage/launchd/com.flip.baton.logs-cleanup.plist'


class ScheduledLogCleanup(unittest.TestCase):
    def test_service_runs_logs_clean_all_with_the_database(self):
        service = SERVICE.read_text(encoding='utf-8')
        self.assertIn(
            'ExecStart=/path/to/qualified-release/libexec/baton2/logs-clean-all '
            '/path/to/state.db',
            service)
        self.assertIn('Deployment template', service)
        self.assertIn('StandardOutput=journal', service)
        self.assertIn('MemoryMax=2G', service)
        self.assertIn('MemorySwapMax=0', service)
        self.assertIn('TimeoutStartSec=infinity', service)
        self.assertNotIn('Environment=', service)
        self.assertNotIn('storage-policy', service)
        self.assertNotIn('storage-preview', service)
        self.assertNotIn('storage-apply', service)
        self.assertNotIn('--exec', service)

    def test_timer_is_daily_and_persistent(self):
        timer = TIMER.read_text(encoding='utf-8')
        self.assertIn('OnCalendar=daily', timer)
        self.assertIn('Persistent=true', timer)

    def test_launchd_agent_runs_logs_clean_all_with_the_database(self):
        with open(AGENT, 'rb') as handle:
            agent = plistlib.load(handle)
        self.assertEqual(agent['Label'], 'com.flip.baton.logs-cleanup')
        self.assertEqual(agent['ProgramArguments'],
                         ['/path/to/qualified-release/libexec/baton2/'
                          'logs-clean-all', '/path/to/state.db'])
        self.assertIn('StartCalendarInterval', agent)
        self.assertNotIn('EnvironmentVariables', agent)
        self.assertNotIn('--exec', agent['ProgramArguments'])
        self.assertNotIn('storage-policy', ' '.join(agent['ProgramArguments']))


if __name__ == '__main__':
    unittest.main()
