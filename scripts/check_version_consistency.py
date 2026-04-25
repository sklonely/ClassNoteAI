#!/usr/bin/env python3
"""Validate release-version consistency across source files and updater manifests."""

from __future__ import annotations

import argparse
import io
import json
import os
import plistlib
import re
import sys
import tarfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


def extract_cargo_toml_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not find root package version in {path}")
    return match.group(1)


def extract_cargo_lock_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'\[\[package\]\]\nname = "classnoteai"\nversion = "([^"]+)"', text)
    if not match:
        raise ValueError(f'Could not find [[package]] name = "classnoteai" in {path}')
    return match.group(1)


SOURCE_VERSION_FILES = {
    "ClassNoteAI/VERSION": lambda root: (root / "ClassNoteAI" / "VERSION").read_text(encoding="utf-8").strip(),
    "ClassNoteAI/package.json": lambda root: json.loads(
        (root / "ClassNoteAI" / "package.json").read_text(encoding="utf-8")
    )["version"],
    "ClassNoteAI/package-lock.json#version": lambda root: json.loads(
        (root / "ClassNoteAI" / "package-lock.json").read_text(encoding="utf-8")
    )["version"],
    "ClassNoteAI/package-lock.json#packages[\"\"]": lambda root: json.loads(
        (root / "ClassNoteAI" / "package-lock.json").read_text(encoding="utf-8")
    )["packages"][""]["version"],
    "ClassNoteAI/src-tauri/Cargo.toml": lambda root: extract_cargo_toml_version(
        root / "ClassNoteAI" / "src-tauri" / "Cargo.toml"
    ),
    "ClassNoteAI/src-tauri/Cargo.lock#classnoteai": lambda root: extract_cargo_lock_version(
        root / "ClassNoteAI" / "src-tauri" / "Cargo.lock"
    ),
    "ClassNoteAI/src-tauri/tauri.conf.json": lambda root: json.loads(
        (root / "ClassNoteAI" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
    )["version"],
}

PLATFORM_SUFFIXES = {
    "darwin-aarch64": "_aarch64.app.tar.gz",
    "windows-x86_64": "_x64-setup.exe",
    "windows-x86_64-cuda": "_x64-cuda-setup.exe",
}

REQUIRED_PLATFORMS = ("darwin-aarch64", "windows-x86_64")


class ValidationError(Exception):
    """Raised when validation fails."""


class Validator:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def expect(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)

    def finish(self) -> None:
        if self.errors:
            raise ValidationError("\n".join(f"- {error}" for error in self.errors))


def normalize_version(value: str) -> str:
    return value[1:] if value.startswith("v") else value


def expected_channels(version: str) -> list[str]:
    if "-alpha" in version:
        return ["alpha"]
    if "-beta" in version:
        return ["alpha", "beta"]
    return ["alpha", "beta", "stable"]


def build_headers() -> dict[str, str]:
    headers = {"User-Agent": "classnoteai-version-consistency-check"}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_bytes(url: str, retries: int, retry_delay_seconds: int) -> bytes:
    headers = build_headers()
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == retries:
                break
            print(
                f"[version-check] fetch failed ({attempt}/{retries}) for {url}: {exc}",
                file=sys.stderr,
            )
            time.sleep(retry_delay_seconds)
    raise ValidationError(f"Failed to fetch {url}: {last_error}")


def fetch_json(url: str, retries: int, retry_delay_seconds: int) -> Any:
    payload = fetch_bytes(url, retries=retries, retry_delay_seconds=retry_delay_seconds)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{url} did not return valid JSON: {exc}") from exc


def validate_iso8601(value: str, label: str, validator: Validator) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        validator.expect(False, f"{label} has invalid pub_date: {value}")


def validate_manifest_payload(
    payload: dict[str, Any],
    *,
    expected_version: str,
    label: str,
    validator: Validator,
) -> None:
    version = payload.get("version")
    validator.expect(version == expected_version, f"{label} version is {version!r}, expected {expected_version!r}")

    notes = payload.get("notes")
    validator.expect(isinstance(notes, str) and expected_version in notes, f"{label} notes do not mention {expected_version}")

    pub_date = payload.get("pub_date")
    validator.expect(isinstance(pub_date, str) and pub_date != "", f"{label} is missing pub_date")
    if isinstance(pub_date, str) and pub_date:
        validate_iso8601(pub_date, label, validator)

    platforms = payload.get("platforms")
    validator.expect(isinstance(platforms, dict), f"{label} is missing platforms")
    if not isinstance(platforms, dict):
        return

    for platform in REQUIRED_PLATFORMS:
        validator.expect(platform in platforms, f"{label} is missing platforms.{platform}")

    for platform, metadata in platforms.items():
        if platform not in PLATFORM_SUFFIXES:
            continue
        validator.expect(isinstance(metadata, dict), f"{label} platforms.{platform} is not an object")
        if not isinstance(metadata, dict):
            continue

        signature = metadata.get("signature")
        validator.expect(isinstance(signature, str) and signature != "", f"{label} platforms.{platform}.signature is missing")

        url = metadata.get("url")
        validator.expect(isinstance(url, str) and url != "", f"{label} platforms.{platform}.url is missing")
        if not isinstance(url, str) or not url:
            continue

        expected_fragment = f"/releases/download/v{expected_version}/"
        validator.expect(expected_fragment in url, f"{label} platforms.{platform}.url does not point at v{expected_version}")
        expected_filename = f"ClassNoteAI_{expected_version}{PLATFORM_SUFFIXES[platform]}"
        validator.expect(
            url.endswith(expected_filename),
            f"{label} platforms.{platform}.url does not end with {expected_filename}",
        )


def validate_source_versions(repo_root: Path, expected_version: str | None) -> None:
    observed = {label: reader(repo_root) for label, reader in SOURCE_VERSION_FILES.items()}
    validator = Validator()

    if expected_version is None:
        distinct = sorted(set(observed.values()))
        validator.expect(
            len(distinct) == 1,
            "Source version files diverged:\n"
            + "\n".join(f"  {label}: {value}" for label, value in observed.items()),
        )
    else:
        for label, value in observed.items():
            validator.expect(value == expected_version, f"{label} is {value!r}, expected {expected_version!r}")

    validator.finish()
    print("[version-check] source versions OK")
    for label, value in observed.items():
        print(f"  {label}: {value}")


def validate_local_manifests(repo_root: Path, expected_version: str) -> None:
    validator = Validator()
    manifests: dict[str, dict[str, Any]] = {}

    for channel in expected_channels(expected_version):
        path = repo_root / "docs" / "updater" / channel / "latest.json"
        validator.expect(path.exists(), f"Missing local manifest for channel {channel}: {path}")
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        manifests[channel] = payload
        validate_manifest_payload(
            payload,
            expected_version=expected_version,
            label=f"docs/updater/{channel}/latest.json",
            validator=validator,
        )

    if manifests:
        baseline = next(iter(manifests.values()))
        for channel, payload in manifests.items():
            validator.expect(
                payload == baseline,
                f"docs/updater/{channel}/latest.json does not exactly match the other channel manifests for {expected_version}",
            )

    validator.finish()
    print("[version-check] local channel manifests OK")
    for channel in manifests:
        print(f"  docs/updater/{channel}/latest.json -> {expected_version}")


def fetch_release_metadata(repo: str, version: str, retries: int, retry_delay_seconds: int) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/releases/tags/v{version}"
    payload = fetch_json(url, retries=retries, retry_delay_seconds=retry_delay_seconds)
    if not isinstance(payload, dict):
        raise ValidationError(f"Unexpected GitHub release payload from {url}")
    return payload


def inspect_macos_bundle_version(url: str, expected_version: str, retries: int, retry_delay_seconds: int) -> None:
    payload = fetch_bytes(url, retries=retries, retry_delay_seconds=retry_delay_seconds)
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        member = next((item for item in archive.getmembers() if item.name.endswith("Contents/Info.plist")), None)
        if member is None:
            raise ValidationError(f"Could not find Contents/Info.plist inside {url}")
        extracted = archive.extractfile(member)
        if extracted is None:
            raise ValidationError(f"Could not extract Contents/Info.plist from {url}")
        plist = plistlib.load(extracted)

    errors = []
    if plist.get("CFBundleShortVersionString") != expected_version:
        errors.append(
            f"CFBundleShortVersionString is {plist.get('CFBundleShortVersionString')!r}, expected {expected_version!r}"
        )
    if plist.get("CFBundleVersion") != expected_version:
        errors.append(f"CFBundleVersion is {plist.get('CFBundleVersion')!r}, expected {expected_version!r}")
    if errors:
        raise ValidationError("macOS bundle version mismatch:\n- " + "\n- ".join(errors))


def validate_published_release(
    repo: str,
    expected_version: str,
    retries: int,
    retry_delay_seconds: int,
) -> None:
    release = fetch_release_metadata(repo, expected_version, retries, retry_delay_seconds)
    validator = Validator()
    validator.expect(
        release.get("tag_name") == f"v{expected_version}",
        f"GitHub release tag is {release.get('tag_name')!r}, expected v{expected_version}",
    )
    assets = {asset.get("name") for asset in release.get("assets", []) if isinstance(asset, dict)}
    validator.expect("latest.json" in assets, f"GitHub release v{expected_version} is missing latest.json asset")
    validator.finish()

    release_manifest = fetch_json(
        f"https://github.com/{repo}/releases/download/v{expected_version}/latest.json",
        retries=retries,
        retry_delay_seconds=retry_delay_seconds,
    )
    if not isinstance(release_manifest, dict):
        raise ValidationError("Release latest.json did not return an object")

    release_manifest_validator = Validator()
    validate_manifest_payload(
        release_manifest,
        expected_version=expected_version,
        label=f"release latest.json ({expected_version})",
        validator=release_manifest_validator,
    )
    release_manifest_validator.finish()

    inspect_macos_bundle_version(
        release_manifest["platforms"]["darwin-aarch64"]["url"],
        expected_version,
        retries,
        retry_delay_seconds,
    )

    for channel in expected_channels(expected_version):
        channel_manifest = fetch_json(
            f"https://sklonely.github.io/ClassNoteAI/updater/{channel}/latest.json",
            retries=retries,
            retry_delay_seconds=retry_delay_seconds,
        )
        if not isinstance(channel_manifest, dict):
            raise ValidationError(f"Channel manifest for {channel} did not return an object")

        channel_validator = Validator()
        validate_manifest_payload(
            channel_manifest,
            expected_version=expected_version,
            label=f"https://sklonely.github.io/ClassNoteAI/updater/{channel}/latest.json",
            validator=channel_validator,
        )
        channel_validator.expect(
            channel_manifest == release_manifest,
            f"Channel manifest {channel} does not exactly match release latest.json for {expected_version}",
        )
        channel_validator.finish()

    print("[version-check] published release + channel manifests OK")
    print(f"  release tag: v{expected_version}")
    print(f"  channels: {', '.join(expected_channels(expected_version))}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (defaults to current directory).",
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)

    source_parser = subparsers.add_parser("source", help="Validate version-bearing source files.")
    source_parser.add_argument("--expected-version", help="Assert that every source file matches this version.")

    manifest_parser = subparsers.add_parser("manifest", help="Validate local docs/updater channel manifests.")
    manifest_parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.6.0-alpha.10.")

    published_parser = subparsers.add_parser("published", help="Validate published release + GH Pages manifests.")
    published_parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.6.0-alpha.10.")
    published_parser.add_argument(
        "--github-repository",
        default=os.getenv("GITHUB_REPOSITORY", "sklonely/ClassNoteAI"),
        help="GitHub repository in owner/name form.",
    )
    published_parser.add_argument("--retries", type=int, default=12, help="How many times to retry remote fetches.")
    published_parser.add_argument(
        "--retry-delay-seconds",
        type=int,
        default=15,
        help="Seconds to sleep between remote fetch retries.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()

    try:
        if args.mode == "source":
            expected = normalize_version(args.expected_version) if args.expected_version else None
            validate_source_versions(repo_root, expected)
        elif args.mode == "manifest":
            validate_local_manifests(repo_root, normalize_version(args.tag))
        elif args.mode == "published":
            validate_published_release(
                args.github_repository,
                normalize_version(args.tag),
                args.retries,
                args.retry_delay_seconds,
            )
        else:  # pragma: no cover - argparse guards this
            raise AssertionError(f"Unsupported mode: {args.mode}")
    except ValidationError as exc:
        print(f"[version-check] FAILED\n{exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
