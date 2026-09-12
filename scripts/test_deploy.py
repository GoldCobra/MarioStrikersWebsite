"""Release safety tests: fake subprocesses and HTTP, never contact Docker or GitHub."""

import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import Mock, patch

from deploy import CHECKS, Deployer, DeployError, verify_ci


COMMIT = "a" * 40
PREVIOUS = "bootstrap-20260912T120000Z"


class CIValidationTests(unittest.TestCase):
    def responses(self, **changes):
        workflow = {"head_sha": COMMIT, "head_branch": "gc-updates", "event": "push", "run_number": 1,
                    "run_attempt": 1, "id": 42, "status": "completed", "conclusion": "success",
                    "html_url": "https://github.com/GoldCobra/MarioStrikersWebsite/actions/runs/42"}
        workflow.update(changes)
        return [{"workflow_runs": [workflow]}, {"jobs": [{"name": name, "conclusion": "success"} for name in CHECKS]}]

    def test_accepts_all_exact_required_jobs(self):
        get = Mock(side_effect=self.responses())
        self.assertIn("/42", verify_ci(COMMIT, get))
        self.assertIn("/attempts/1/jobs", get.call_args.args[0])

    def test_fails_closed_for_wrong_sha_branch_event_and_incomplete_run(self):
        for changes in ({"head_sha": "b" * 40}, {"head_branch": "feature/example"}, {"event": "pull_request"},
                        {"status": "in_progress"}, {"conclusion": "failure"}):
            with self.subTest(changes=changes), self.assertRaises(DeployError):
                verify_ci(COMMIT, Mock(side_effect=self.responses(**changes)))

    def test_missing_and_skipped_checks_are_not_success(self):
        for jobs in ([], [{"name": name, "conclusion": "skipped"} for name in CHECKS]):
            responses = self.responses()
            responses[1]["jobs"] = jobs
            with self.subTest(jobs=jobs), self.assertRaises(DeployError):
                verify_ci(COMMIT, Mock(side_effect=responses))

    def test_new_failed_run_blocks_an_older_success(self):
        responses = self.responses()
        responses[0]["workflow_runs"].append(dict(responses[0]["workflow_runs"][0], run_number=2, conclusion="failure"))
        with self.assertRaises(DeployError):
            verify_ci(COMMIT, Mock(side_effect=responses))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.compose_file = self.root / "docker-compose.prod.yml"
        self.compose_file.write_text("services: {}\n", encoding="utf-8")
        self.runner = Mock(return_value="")
        self.deployer = Deployer(self.root, runner=self.runner)
        self.deployer.state.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, release):
        images = {service: {"tag": service + ":" + release, "id": "sha256:" + service + release}
                  for service in ("backend", "frontend")}
        self.deployer.save(release, images, self.compose_file)
        return images

    def prepare_current(self):
        self.save(PREVIOUS)
        self.deployer.record_current(PREVIOUS)
        self.deployer.image = Mock(side_effect=lambda tag: {"Id": "sha256:" + tag.replace(":", "")})

    def test_invalid_release_paths_are_rejected(self):
        for release in ("../outside", "a" * 39, "A" * 40, "a" * 40 + "/extra"):
            with self.subTest(release=release), self.assertRaises(DeployError):
                self.deployer.read(release)

    def test_requires_bootstrap_before_any_git_or_build(self):
        with self.assertRaises(DeployError):
            self.deployer.deploy(COMMIT)
        self.runner.assert_not_called()

    def test_deploy_lock_prevents_overlapping_changes(self):
        with self.deployer.lock():
            with self.assertRaises(DeployError):
                with self.deployer.lock():
                    self.fail("Second lock was acquired")
        self.assertFalse((self.deployer.state / "lock").exists())

    def source_runner(self, args, **kwargs):
        command = args[1:]
        responses = {("remote", "get-url", "origin"): "https://github.com/GoldCobra/MarioStrikersWebsite.git",
                     ("symbolic-ref", "--short", "HEAD"): "gc-updates",
                     ("status", "--porcelain", "--untracked-files=all"): "",
                     ("rev-parse", "refs/remotes/origin/gc-updates"): COMMIT}
        return responses.get(tuple(command), "")

    def test_successful_fetch_precedes_sha_comparison(self):
        self.runner.side_effect = self.source_runner
        self.deployer.verify_source(COMMIT)
        commands = [call.args[0] for call in self.runner.call_args_list]
        fetch = next(i for i, cmd in enumerate(commands) if cmd[1] == "fetch")
        compare = next(i for i, cmd in enumerate(commands) if cmd[1] == "rev-parse")
        self.assertLess(fetch, compare)
        self.assertFalse(any("checkout" in cmd or "reset" in cmd or "pull" in cmd for cmd in commands))

    def test_fetch_failure_cannot_use_stale_remote_reference(self):
        def failed_fetch(args, **kwargs):
            if args[1] == "fetch":
                raise DeployError("fetch failed")
            return self.source_runner(args, **kwargs)
        self.runner.side_effect = failed_fetch
        with self.assertRaises(DeployError):
            self.deployer.verify_source(COMMIT)
        self.assertFalse(any("rev-parse" in call.args[0] for call in self.runner.call_args_list))

    def test_dirty_checkout_and_non_head_release_are_rejected(self):
        for failed_command, result in (("status", " M index.html"), ("rev-parse", "b" * 40)):
            def altered(args, **kwargs):
                return result if args[1] == failed_command else self.source_runner(args, **kwargs)
            self.runner.side_effect = altered
            with self.subTest(command=failed_command), self.assertRaises(DeployError):
                self.deployer.verify_source(COMMIT)

    def test_bootstrap_tags_running_images_without_restarting(self):
        def inspect(args, **kwargs):
            if args[1:3] == ["container", "inspect"]:
                service = args[-1].removeprefix("msc-website-")
                return json.dumps([{"Image": "sha256:" + service, "State": {"Running": True},
                                    "Config": {"Labels": {"com.docker.compose.project": "mario-strikers-website",
                                                            "com.docker.compose.service": service}}}])
            return ""
        self.runner.side_effect = inspect
        self.deployer.bootstrap()
        self.assertTrue(self.deployer.current().startswith("bootstrap-"))
        self.assertEqual(len([c for c in self.runner.call_args_list if c.args[0][1:3] == ["image", "tag"]]), 2)
        self.assertFalse(any("compose" in c.args[0] for c in self.runner.call_args_list))
        with self.assertRaises(DeployError):
            self.deployer.bootstrap()

    def test_application_activation_preserves_dependencies_and_volumes(self):
        images = self.save(COMMIT)
        self.deployer.image = Mock(side_effect=lambda tag: {"Id": next(i["id"] for i in images.values() if i["tag"] == tag)})
        self.deployer.activate(COMMIT)
        command = self.runner.call_args.args[0]
        self.assertEqual(command[-8:], ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "backend", "frontend"])
        self.assertNotIn("down", command)
        self.assertNotIn("--volumes", command)
        self.assertEqual(self.runner.call_args.kwargs["env"]["RELEASE_SHA"], COMMIT)

    def test_changed_image_tag_blocks_activation(self):
        self.save(COMMIT)
        self.deployer.image = Mock(return_value={"Id": "sha256:unexpected"})
        with self.assertRaises(DeployError):
            self.deployer.activate(COMMIT)
        self.runner.assert_not_called()

    def test_failed_health_restores_previous_images_and_record(self):
        self.prepare_current()
        self.save(COMMIT)
        self.deployer.activate = Mock()
        self.deployer.healthy = Mock(side_effect=[DeployError("unhealthy"), None])
        with self.assertRaisesRegex(DeployError, "restored and verified"):
            self.deployer.change(COMMIT)
        self.assertEqual([c.args[0] for c in self.deployer.activate.call_args_list], [COMMIT, PREVIOUS])
        self.assertEqual(self.deployer.current(), PREVIOUS)

    def test_failed_recovery_is_reported_and_record_is_not_changed(self):
        self.prepare_current()
        self.save(COMMIT)
        self.deployer.activate = Mock()
        self.deployer.healthy = Mock(side_effect=DeployError("unhealthy"))
        with self.assertRaisesRegex(DeployError, "automatic recovery failed"):
            self.deployer.change(COMMIT)
        self.assertEqual(self.deployer.current(), PREVIOUS)

    def test_healthy_release_updates_record_only_after_health(self):
        self.prepare_current()
        self.save(COMMIT)
        self.deployer.activate = Mock()
        self.deployer.healthy = Mock(side_effect=lambda _: self.assertEqual(self.deployer.current(), PREVIOUS))
        self.deployer.change(COMMIT)
        self.assertEqual(self.deployer.current(), COMMIT)

    def test_manual_rollback_uses_saved_images_without_ci_or_git(self):
        self.prepare_current()
        self.save(COMMIT)
        self.deployer.record_current(COMMIT)
        self.deployer.activate = Mock()
        self.deployer.healthy = Mock()
        with patch("deploy.verify_ci") as ci:
            self.deployer.change(PREVIOUS)
        self.assertEqual(self.deployer.current(), PREVIOUS)
        ci.assert_not_called()
        self.runner.assert_not_called()

    def build_setup(self):
        self.prepare_current()
        self.deployer.verify_source = Mock()
        self.deployer.change = Mock()
        self.deployer.image = Mock(side_effect=lambda tag: {"Id": "sha256:" + tag,
                                   "Config": {"Labels": {"org.opencontainers.image.revision": COMMIT}}})

        def create_archive(args, **kwargs):
            if args[:2] == ["git", "archive"]:
                target = next(arg.removeprefix("--output=") for arg in args if arg.startswith("--output="))
                with tarfile.open(target, "w") as archive:
                    archive.add(self.compose_file, arcname="docker-compose.prod.yml")
            return ""

        self.runner.side_effect = create_archive

    def test_build_uses_approved_archive_revision_then_advances_checkout(self):
        self.build_setup()
        with patch("deploy.verify_ci", return_value="https://example.test/ci"):
            self.deployer.deploy(COMMIT)
        commands = [call.args[0] for call in self.runner.call_args_list]
        archive = next(cmd for cmd in commands if cmd[:2] == ["git", "archive"])
        self.assertEqual(archive[-1], COMMIT)
        builds = [cmd for cmd in commands if cmd[:2] == ["docker", "build"]]
        self.assertEqual(len(builds), 2)
        self.assertTrue(all("RELEASE_SHA=" + COMMIT in cmd for cmd in builds))
        self.assertEqual(commands[-1], ["git", "merge", "--ff-only", COMMIT])
        self.assertEqual(self.deployer.verify_source.call_count, 2)
        self.deployer.change.assert_called_once_with(COMMIT)
        self.assertEqual(self.deployer.read(COMMIT)["ci_url"], "https://example.test/ci")

    def test_ci_failure_never_builds_or_changes_production(self):
        self.build_setup()
        with patch("deploy.verify_ci", side_effect=DeployError("CI failed")), self.assertRaises(DeployError):
            self.deployer.deploy(COMMIT)
        self.runner.assert_not_called()
        self.deployer.change.assert_not_called()

    def test_branch_moving_during_build_prevents_activation_and_checkout_change(self):
        self.build_setup()
        self.deployer.verify_source.side_effect = [None, DeployError("New branch head")]
        with patch("deploy.verify_ci", return_value="https://example.test/ci"), self.assertRaises(DeployError):
            self.deployer.deploy(COMMIT)
        self.deployer.change.assert_not_called()
        self.assertFalse(any(c.args[0][:2] == ["git", "merge"] for c in self.runner.call_args_list))
        self.assertEqual(self.deployer.current(), PREVIOUS)


if __name__ == "__main__":
    unittest.main()
