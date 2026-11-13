"""docker/db_backup/backup.sh(prod 的 backup sidecar / make prod-backup)。

用假的 pg_dump / aws / wget / sleep 跑真的腳本:不需要 Docker、資料庫或 AWS,也不會連外。
"""

import os
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

SCRIPT = Path(__file__).resolve().parent / "backup.sh"


def _run(tmp_path: Path, *, pg_dump_ok: bool = True, upload_ok: bool = True, **env: str):
    """跑一次腳本,回傳 (exit code, 輸出, 假 aws 收到的參數, 假 wget 收到的參數, 暫存目錄剩下的檔案)。"""
    fake_bin, work = tmp_path / "bin", tmp_path / "work"
    fake_bin.mkdir()
    work.mkdir()
    aws_log, wget_log, env_log = tmp_path / "aws", tmp_path / "wget", tmp_path / "env"
    fakes = {
        # 成功時寫出完整檔案,失敗時留下寫到一半的檔案(腳本必須清掉它、且不能上傳)
        "pg_dump": (
            'for a; do case "$a" in --file=*) f="${a#--file=}";; esac; done; '
            f'echo partial > "$f"; exit {0 if pg_dump_ok else 1}'
        ),
        "aws": f'echo "$@" >> "{aws_log}"; env | grep ^AWS_ >> "{env_log}"; exit {0 if upload_ok else 1}',
        "wget": f'echo "$@" >> "{wget_log}"',
        # 常駐模式跑完第一輪就結束:sleep 被放到背景,它的父行程就是腳本本身
        "sleep": "kill $PPID",
    }
    for name, body in fakes.items():
        path = fake_bin / name
        path.write_text(f"#!/bin/sh\n{body}\n")
        path.chmod(0o755)
    run_env = {
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "TMPDIR": str(work),
        "DATABASE_URL": "postgresql://u:p@db:5432/app",
        "BACKUP_S3_URI": "s3://test-bucket/db-backups/",
        **env,
    }
    result = subprocess.run(  # noqa: S603 — fixed script path, test-controlled env
        ["/bin/sh", str(SCRIPT)], env=run_env, capture_output=True, text=True, timeout=20, check=False
    )

    def read(p: Path) -> str:
        return p.read_text() if p.exists() else ""

    return (
        result.returncode,
        result.stdout + result.stderr,
        read(aws_log),
        read(wget_log),
        read(env_log),
        list(work.iterdir()),
    )


def test_oneshot_uploads_timestamped_dump_and_cleans_up(tmp_path):
    code, output, aws, wget, _, leftovers = _run(tmp_path, BACKUP_ONESHOT="1", BACKUP_HEARTBEAT_URL="https://hc/x")
    assert code == 0
    assert "OK: uploaded s3://test-bucket/db-backups/db_" in output
    assert aws.startswith("s3 cp --only-show-errors ")
    assert aws.strip().endswith(".dump")
    assert wget.strip().endswith("https://hc/x")  # heartbeat only after success
    assert leftovers == []  # the temp file is a full plaintext DB copy


def test_failed_dump_is_not_uploaded_and_fails_oneshot(tmp_path):
    code, output, aws, wget, _, leftovers = _run(
        tmp_path, pg_dump_ok=False, BACKUP_ONESHOT="1", BACKUP_HEARTBEAT_URL="https://hc/x"
    )
    assert code == 1  # make prod-backup / CD must stop before migrating
    assert "FAILED" in output
    assert (aws, wget, leftovers) == ("", "", [])


def test_failed_upload_fails_oneshot(tmp_path):
    code, output, _, wget, _, leftovers = _run(tmp_path, upload_ok=False, BACKUP_ONESHOT="1")
    assert code == 1
    assert "FAILED" in output
    assert (wget, leftovers) == ("", [])


def test_missing_bucket_disables_with_warning(tmp_path):
    code, output, aws, *_ = _run(tmp_path, BACKUP_ONESHOT="1", BACKUP_S3_URI="")
    assert code == 0
    assert "DISABLED" in output
    assert aws == ""


def test_empty_aws_keys_fall_back_to_instance_role(tmp_path):
    _, _, _, _, env, _ = _run(tmp_path, BACKUP_ONESHOT="1", AWS_ACCESS_KEY_ID="", AWS_SECRET_ACCESS_KEY="")
    assert "AWS_ACCESS_KEY_ID" not in env  # an empty key would stop aws-cli from trying the instance role


def test_daemon_mode_backs_up_immediately(tmp_path):
    _, output, aws, *_ = _run(tmp_path)
    assert "OK: uploaded" in output
    assert aws.count("s3 cp") == 1
