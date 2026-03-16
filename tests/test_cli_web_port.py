import io
import tempfile
import unittest
from pathlib import Path
import sys
from unittest import mock

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker import cli


class CliWebPortTests(unittest.TestCase):
    def test_resolve_web_port_skips_unavailable_ports(self):
        checked_ports: list[int] = []

        def fake_is_port_available(port: int, host: str = "127.0.0.1") -> bool:
            checked_ports.append(port)
            return port == 3002

        with mock.patch.object(cli, "_is_port_available", side_effect=fake_is_port_available):
            resolved = cli._resolve_web_port(3000, max_port=3002)

        self.assertEqual(resolved, 3002)
        self.assertEqual(checked_ports, [3000, 3001, 3002])

    def test_web_command_falls_back_to_next_port_for_dev_server(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "usage.sqlite"
            stderr = io.StringIO()
            process = mock.Mock(returncode=0)

            with (
                mock.patch.object(sys, "argv", ["codex-track", "web", "--db", str(db_path)]),
                mock.patch.object(cli, "_resolve_web_port", return_value=3001),
                mock.patch.object(cli, "_resolve_ui_dist", return_value=None),
                mock.patch.object(cli, "_open_browser") as open_browser,
                mock.patch.object(cli.subprocess, "run", return_value=process) as run_mock,
                mock.patch("sys.stderr", new=stderr),
            ):
                with self.assertRaises(SystemExit) as exit_ctx:
                    cli.main()

        self.assertEqual(exit_ctx.exception.code, 0)
        open_browser.assert_called_once_with("http://localhost:3001")
        run_args, run_kwargs = run_mock.call_args
        self.assertEqual(
            run_args[0],
            ["pnpm", "--dir", str(Path(__file__).resolve().parents[1] / "ui"), "dev", "--port", "3001"],
        )
        self.assertEqual(run_kwargs["env"]["PORT"], "3001")
        self.assertIn("Port 3000 is unavailable; starting dashboard on 3001 instead.", stderr.getvalue())

    def test_web_command_falls_back_to_next_port_for_packaged_ui(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "usage.sqlite"
            dist_root = Path(tmpdir) / "dist" / "ui"
            server_js = dist_root / "standalone" / "server.js"
            server_js.parent.mkdir(parents=True, exist_ok=True)
            server_js.write_text("console.log('stub');", encoding="utf-8")
            stderr = io.StringIO()
            process = mock.Mock(returncode=0)

            with (
                mock.patch.object(sys, "argv", ["codex-track", "web", "--db", str(db_path)]),
                mock.patch.object(cli, "_resolve_web_port", return_value=3001),
                mock.patch.object(cli, "_resolve_ui_dist", return_value=dist_root),
                mock.patch.object(cli, "_open_browser"),
                mock.patch.object(cli.subprocess, "run", return_value=process) as run_mock,
                mock.patch("sys.stderr", new=stderr),
            ):
                with self.assertRaises(SystemExit) as exit_ctx:
                    cli.main()

        self.assertEqual(exit_ctx.exception.code, 0)
        run_args, run_kwargs = run_mock.call_args
        self.assertEqual(run_args[0], ["node", str(server_js)])
        self.assertEqual(run_kwargs["env"]["PORT"], "3001")
        self.assertEqual(run_kwargs["cwd"], str(server_js.parent))
        self.assertIn("Port 3000 is unavailable; starting dashboard on 3001 instead.", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
