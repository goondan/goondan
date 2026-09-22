from __future__ import annotations

import re
from pathlib import Path

from goondan import SPEC_VERSION

SPECIFICATION = Path(__file__).resolve().parents[3] / "spec" / "goondan.md"


def test_exported_spec_version_matches_the_normative_version():
    versions = re.findall(
        r"^규범 버전: (\d+\.\d+)$",
        SPECIFICATION.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )

    assert versions == [SPEC_VERSION]
