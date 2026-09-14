"""Read-only, redacted release audit of reachable Git blobs and working files.

This is a heuristic review aid, not a proof that a repository contains no secrets.
It never prints matched values. Reports stay in ignored local output by default.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


RULES = {
    "provider-key": re.compile(rb"(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{24,}|tvly-[A-Za-z0-9_-]{24,}|lsv2_[A-Za-z0-9_]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "credential-url": re.compile(rb"(?:postgres(?:ql)?|redis|https?)://[^\s/:]+:[^\s/@]{3,}@[^\s]+"),
    "private-host-path": re.compile(rb"[A-Za-z]:[\\/](?:Users|realProject)[\\/][^\s\"'`<>]+|/Users/[^\s\"'`<>]+|/home/[^\s\"'`<>]+"),
    "runtime-product-data": re.compile(rb"(?:product-contexts/[^\s]+\.json|\.agent-summaries/)"),
}


def git(*args):
    return subprocess.check_output(["git", *args])


def scan(data, location, findings):
    for rule, pattern in RULES.items():
        for match in pattern.finditer(data):
            findings.append({**location, "rule": rule,
                "line": data[:match.start()].count(b"\n") + 1,
                "fingerprint": hashlib.sha256(match.group()).hexdigest()[:16]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=".release-audit/report.json")
    parser.add_argument("--fail-on-secrets", action="store_true")
    args = parser.parse_args()
    findings = []
    allowlist = json.loads(Path("scripts/release-audit-allowlist.json").read_text(encoding="utf8"))
    objects = git("rev-list", "--objects", "--all").decode("utf8", "replace").splitlines()
    # 使用 batch 按 blob 扫描所有可达版本，不打印原始 Git 内容。
    proc = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    blobs = 0
    for row in objects:
        sha, _, path = row.partition(" ")
        proc.stdin.write((sha + "\n").encode()); proc.stdin.flush()
        header = proc.stdout.readline().decode().split()
        if len(header) != 3:
            raise RuntimeError("Unexpected git cat-file response")
        size = int(header[2]); data = proc.stdout.read(size); proc.stdout.read(1)
        if header[1] == "blob":
            blobs += 1
            scan(data, {"source": "history", "blob": sha, "path": path}, findings)
            if path.startswith(("resources/product-contexts/", ".agent-summaries/")) and path.endswith(".json"):
                findings.append({"source": "history", "blob": sha, "path": path, "rule": "runtime-product-file"})
    proc.stdin.close(); proc.wait()
    files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode("utf8").split("\0")
    for name in set(files) - {""}:
        path = Path(name)
        if path.is_file():
            scan(path.read_bytes(), {"source": "working-tree", "path": name}, findings)
    for finding in findings:
        entry = allowlist.get(finding.get("fingerprint"))
        if entry and entry["rule"] == finding["rule"]:
            finding["reviewed_reason"] = entry["reason"]
    report = {"refs": git("for-each-ref", "--format=%(refname)").decode().splitlines(),
        "history_blobs": blobs, "working_files": len(set(files) - {""}), "findings": findings,
        "limitations": ["Only locally reachable refs were scanned; remote-only refs, deleted objects, GitHub logs/artifacts and binary image contents need separate review.",
            "Keyword patterns cannot establish whether fixtures contain real product/customer data; review flagged paths and examples manually.",
            "Matches are candidates, including placeholders and test values, not confirmed leaked credentials."]}
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf8")
    counts = {rule: sum(f["rule"] == rule for f in findings) for rule in sorted({f["rule"] for f in findings})}
    print(json.dumps({"report": str(output), "history_blobs": blobs, "candidate_counts": counts}))
    if args.fail_on_secrets and any(f["rule"] in {"provider-key", "private-key", "credential-url"} and not f.get("reviewed_reason") for f in findings):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
