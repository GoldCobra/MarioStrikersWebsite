#!/usr/bin/env python3
"""Owner-operated application releases. Never runs migrations or deletes volumes."""

import argparse
import contextlib
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid


REPOSITORY = "GoldCobra/MarioStrikersWebsite"
BRANCH = "gc-updates"
CHECKS = {"backend (ubuntu-latest)", "backend (windows-latest)", "frontend", "containers", "deployment"}
SERVICES = ("backend", "frontend")
SHA = re.compile(r"[0-9a-f]{40}\Z")
RELEASE = re.compile(r"(?:[0-9a-f]{40}|bootstrap-[0-9]{8}T[0-9]{6}Z)\Z")


class DeployError(RuntimeError):
    pass


def run(args, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode:
        # Do not print tool output: Docker/Git errors can contain credentials.
        raise DeployError("Command failed: " + " ".join(args[:3]))
    return result.stdout.strip()


def api(path):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "mario-strikers-release"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def verify_ci(sha, get=api):
    runs = get("/actions/workflows/ci.yml/runs?branch=" + BRANCH + "&event=push&per_page=100")["workflow_runs"]
    matching = [r for r in runs if r["head_sha"] == sha and r["head_branch"] == BRANCH and r["event"] == "push"]
    if not matching:
        raise DeployError("No CI push run found for this exact gc-updates commit.")
    latest = max(matching, key=lambda r: (r["run_number"], r["run_attempt"]))
    if latest["status"] != "completed" or latest["conclusion"] != "success":
        raise DeployError("The latest CI run for this commit has not succeeded.")
    jobs = get(f'/actions/runs/{latest["id"]}/attempts/{latest["run_attempt"]}/jobs?per_page=100')["jobs"]
    by_name = {job["name"]: job for job in jobs}
    if not all(name in by_name and by_name[name]["conclusion"] == "success" for name in CHECKS):
        raise DeployError("Required CI jobs are missing, skipped, or unsuccessful.")
    return latest["html_url"]


class Deployer:
    def __init__(self, root, project="mario-strikers-website", public_url="https://mariostrikers.gg", runner=run):
        self.root = Path(root).resolve()
        self.state = self.root / ".deploy"
        self.project = project
        self.public_url = public_url.rstrip("/")
        self.run = runner

    def git(self, *args):
        return self.run(["git", *args], cwd=self.root)

    @contextlib.contextmanager
    def lock(self):
        self.state.mkdir(mode=0o700, exist_ok=True)
        lock = self.state / "lock"
        try:
            lock.mkdir(mode=0o700)
        except FileExistsError:
            raise DeployError("A deployment lock exists. Check for a running release before removing .deploy/lock.") from None
        try:
            yield
        finally:
            lock.rmdir()

    def read(self, release):
        if not RELEASE.fullmatch(release):
            raise DeployError("Invalid release ID.")
        directory = self.state / "releases" / release
        with (directory / "release.json").open(encoding="utf-8") as file:
            record = json.load(file)
        if record["project"] != self.project:
            raise DeployError("Release belongs to a different Compose project.")
        return record

    def current(self):
        path = self.state / "current"
        return path.read_text(encoding="utf-8").strip() if path.exists() else None

    def record_current(self, release):
        temporary = self.state / "current.tmp"
        temporary.write_text(release + "\n", encoding="utf-8")
        temporary.replace(self.state / "current")
        with (self.state / "history.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps({"release": release, "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}) + "\n")

    def image(self, reference):
        return json.loads(self.run(["docker", "image", "inspect", reference]))[0]

    def running(self, service):
        container = json.loads(self.run(["docker", "container", "inspect", "msc-website-" + service]))[0]
        labels = container["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.project") != self.project or labels.get("com.docker.compose.service") != service:
            raise DeployError("Running container is not owned by the expected Compose project/service.")
        if not container["State"]["Running"]:
            raise DeployError("Expected application container is not running.")
        return container

    def save(self, release, images, compose_file, ci_url=None):
        directory = self.state / "releases" / release
        directory.mkdir(parents=True)
        shutil.copyfile(compose_file, directory / "compose.yml")
        record = {"release": release, "project": self.project, "images": images, "ci_url": ci_url}
        (directory / "release.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        overrides = {"services": {service: {"image": info["tag"]} for service, info in images.items()}}
        (directory / "images.json").write_text(json.dumps(overrides, indent=2) + "\n", encoding="utf-8")

    def bootstrap(self):
        if self.current():
            raise DeployError("Already bootstrapped; the current release record is preserved.")
        release = "bootstrap-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        images = {}
        for service in SERVICES:
            container = self.running(service)
            image_id = container["Image"]
            tag = f"mario-strikers-website-{service}:{release}"
            self.run(["docker", "image", "tag", image_id, tag])
            images[service] = {"tag": tag, "id": image_id}
        self.save(release, images, self.root / "docker-compose.prod.yml")
        self.record_current(release)
        print("Preserved running images as " + release + "; containers were not restarted.")

    def verify_source(self, sha):
        if not SHA.fullmatch(sha):
            raise DeployError("Supply the full lowercase 40-character commit SHA approved for release.")
        remote = self.git("remote", "get-url", "origin").removesuffix(".git").rstrip("/")
        if remote not in ("https://github.com/" + REPOSITORY, "git@github.com:" + REPOSITORY):
            raise DeployError("Origin is not the canonical GoldCobra repository.")
        if self.git("symbolic-ref", "--short", "HEAD") != BRANCH:
            raise DeployError("Server checkout must be on gc-updates.")
        if self.git("status", "--porcelain", "--untracked-files=all"):
            raise DeployError("Server checkout is not clean; preserve and resolve local changes first.")
        self.git("fetch", "--no-tags", "origin", f"refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}")
        if self.git("rev-parse", "refs/remotes/origin/" + BRANCH) != sha:
            raise DeployError("Approved SHA differs from the successfully fetched gc-updates HEAD.")
        self.git("merge-base", "--is-ancestor", "HEAD", sha)

    def compose(self, release, *args):
        directory = self.state / "releases" / release
        env = os.environ.copy()
        env["RELEASE_SHA"] = release
        env["BACKEND_ENV_FILE"] = str(self.root / "backend" / ".env")
        return self.run(["docker", "compose", "--project-directory", str(self.root), "--project-name", self.project,
                         "-f", str(directory / "compose.yml"), "-f", str(directory / "images.json"), *args],
                        cwd=self.root, env=env)

    def activate(self, release):
        record = self.read(release)
        for info in record["images"].values():
            if self.image(info["tag"])["Id"] != info["id"]:
                raise DeployError("A recorded release image is missing or its tag changed.")
        # This never starts/stops sidecars, removes volumes, or rebuilds a rollback image.
        self.compose(release, "config", "--quiet")
        self.compose(release, "up", "-d", "--no-deps", "--no-build", "--pull", "never", *SERVICES)

    def health_once(self, release):
        record = self.read(release)
        for service, info in record["images"].items():
            if self.running(service)["Image"] != info["id"]:
                raise DeployError("A running container does not match the selected release image.")
        self.run(["docker", "exec", "msc-website-frontend", "nginx", "-t"])
        javascript = """(async()=>{for(const p of ['/api/health','/']){
const r=await fetch('http://frontend:8080'+p,{signal:AbortSignal.timeout(15000)});
if(!r.ok)throw Error('local health failed');
if(p==='/api/health'){const j=await r.json();if(j.status!=='ok'||j.source!=='mssql')throw Error('database health failed');}
}})().catch(()=>process.exit(1));"""
        self.run(["docker", "exec", "msc-website-backend", "node", "-e", javascript])
        for path in ("/", "/api/health"):
            request = urllib.request.Request(self.public_url + path + "?release_check=" + uuid.uuid4().hex,
                                             headers={"Cache-Control": "no-cache", "User-Agent": "mario-strikers-release"})
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status != 200:
                    raise DeployError("Public HTTP health check failed.")
                if path == "/api/health":
                    body = json.load(response)
                    if body.get("status") != "ok" or body.get("source") != "mssql":
                        raise DeployError("Public database health check failed.")

    def healthy(self, release):
        for attempt in range(12):
            try:
                self.health_once(release)
                return
            except (DeployError, OSError, ValueError, KeyError):
                if attempt == 11:
                    raise DeployError("Release health checks did not pass; inspect application logs on the server.") from None
                time.sleep(5)

    def change(self, release):
        previous = self.current()
        if not previous:
            raise DeployError("Run bootstrap once to preserve the existing production images.")
        # Validate the fallback before touching running services.
        for info in self.read(previous)["images"].values():
            if self.image(info["tag"])["Id"] != info["id"]:
                raise DeployError("Previous release images are unavailable; refusing an unsafe deployment.")
        try:
            self.activate(release)
            self.healthy(release)
        except (DeployError, OSError, ValueError, KeyError, KeyboardInterrupt):
            print("Activation failed; restoring " + previous + ".", file=sys.stderr)
            try:
                self.activate(previous)
                self.healthy(previous)
            except (DeployError, OSError, ValueError, KeyError):
                raise DeployError("Release and automatic recovery failed. Current record remains unchanged; inspect the server immediately.") from None
            raise DeployError("Release failed; previous application images restored and verified.") from None
        self.record_current(release)

    def deploy(self, sha):
        if not self.current():
            raise DeployError("Run bootstrap once before the first deployment.")
        self.verify_source(sha)
        ci_url = verify_ci(sha)
        directory = self.state / "releases" / sha
        if directory.exists():
            # Exact release tags are immutable; reuse the saved images instead of rebuilding.
            self.git("merge", "--ff-only", sha)
            self.change(sha)
            print("Released " + sha)
            return
        with tempfile.TemporaryDirectory(prefix="mario-strikers-release-") as staging:
            archive = Path(staging) / "source.tar"
            source = Path(staging) / "source"
            source.mkdir()
            self.git("archive", "--format=tar", "--output=" + str(archive), sha)
            with tarfile.open(archive) as files:
                files.extractall(source, filter="data")
            images = {}
            for service in SERVICES:
                tag = f"mario-strikers-website-{service}:{sha}"
                self.run(["docker", "build", "--build-arg", "RELEASE_SHA=" + sha, "--tag", tag,
                          "--file", str(source / ("Dockerfile." + service)), str(source)])
                image = self.image(tag)
                if (image["Config"].get("Labels") or {}).get("org.opencontainers.image.revision") != sha:
                    raise DeployError("Built image revision does not match approved SHA.")
                images[service] = {"tag": tag, "id": image["Id"]}
            self.save(sha, images, source / "docker-compose.prod.yml", ci_url)
        # Catch an owner merge that happened while the builds were running.
        self.verify_source(sha)
        self.git("merge", "--ff-only", sha)
        self.change(sha)
        print("Released " + sha)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="mario-strikers-website")
    parser.add_argument("--public-url", default="https://mariostrikers.gg")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("bootstrap")
    commands.add_parser("list")
    commands.add_parser("deploy").add_argument("sha")
    commands.add_parser("rollback").add_argument("release")
    args = parser.parse_args(argv)
    deployer = Deployer(Path(__file__).resolve().parent.parent, args.project, args.public_url)
    try:
        if args.command == "list":
            for path in sorted((deployer.state / "releases").glob("*/release.json")):
                release = path.parent.name
                print(release + (" (current)" if release == deployer.current() else ""))
            return 0
        with deployer.lock():
            if args.command == "bootstrap":
                deployer.bootstrap()
            elif args.command == "deploy":
                deployer.deploy(args.sha)
            else:
                deployer.read(args.release)
                deployer.change(args.release)
                print("Rolled back to " + args.release)
        return 0
    except (DeployError, OSError, ValueError, KeyError) as error:
        if isinstance(error, DeployError):
            print(str(error), file=sys.stderr)
        else:
            print("Operation failed. Check local files, Docker, and GitHub/network access; no credentials are printed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
