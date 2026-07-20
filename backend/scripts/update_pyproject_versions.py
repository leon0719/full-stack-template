"""Parse uv.lock and update pyproject.toml dependency lower bounds to match locked versions."""

import re
import sys
import tomllib
from pathlib import Path

_RE_NORMALIZE = re.compile(r"[-_.]+")
_RE_DEP_LINE = re.compile(r'^(\s*")([\w\-\[\]]+)(>=[\d.]+)(.*",?)$')
_RE_BASE_NAME = re.compile(r"[\w\-]+")


def _normalize(name: str) -> str:
    """Normalize package name for comparison (PEP 503)."""
    return _RE_NORMALIZE.sub("-", name).lower()


def parse_lock_versions(lock_path: Path) -> dict[str, str]:
    """Extract normalized package name -> version from uv.lock (TOML)."""
    data = tomllib.loads(lock_path.read_text())
    return {
        _normalize(pkg["name"]): pkg["version"] for pkg in data.get("package", []) if "name" in pkg and "version" in pkg
    }


def update_version_in_line(line: str, versions: dict[str, str]) -> str:
    """Update a single dependency line's lower bound."""
    if not (m := _RE_DEP_LINE.match(line)):
        return line
    prefix, pkg_raw, _old_bound, suffix = m.groups()
    if base_match := _RE_BASE_NAME.match(pkg_raw):
        norm = _normalize(base_match.group(0))
        if norm in versions:
            return f"{prefix}{pkg_raw}>={versions[norm]}{suffix}"
    return line


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    lock_path = root / "uv.lock"
    pyproject_path = root / "pyproject.toml"

    if not lock_path.exists():
        print("uv.lock not found. Run 'uv lock' first.")
        sys.exit(1)
    if not pyproject_path.exists():
        print("pyproject.toml not found.")
        sys.exit(1)

    versions = parse_lock_versions(lock_path)

    original = pyproject_path.read_text()
    lines = original.splitlines()
    updated = [update_version_in_line(line, versions) for line in lines]
    result = "\n".join(updated) + "\n"

    if result == original:
        print("pyproject.toml is already up to date.")
    else:
        pyproject_path.write_text(result)
        print("pyproject.toml updated with latest locked versions.")


if __name__ == "__main__":
    main()
