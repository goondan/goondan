"""The shared execution cases of `fixtures/conformance` on the Python host.

Every case directory becomes one test. Nothing is skipped and no failure is marked as
expected: a case the Python host cannot express fails with `unsupported by Python
runner`. The last test checks that the cases cite every section of the specification.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TESTS_DIRECTORY = Path(__file__).resolve().parent
if str(TESTS_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(TESTS_DIRECTORY))

from conformance.coverage import coverage_problems, spec_headings  # noqa: E402
from conformance.errors import CaseFailure, CaseFormatError  # noqa: E402
from conformance.runner import discover_cases, fixtures_root, library_problems, run_case  # noqa: E402

REPOSITORY = Path(__file__).resolve().parents[3]
FIXTURES = fixtures_root()
CASES = discover_cases(FIXTURES)


def test_case_library_holds_only_cases_and_the_readme():
    problems = library_problems(FIXTURES)
    assert not problems, "fixtures/conformance holds entries that are not cases:\n" + "\n".join(problems)


@pytest.mark.parametrize("case_directory", CASES, ids=lambda directory: directory.name)
async def test_conformance_case(case_directory: Path):
    report: str | None = None
    try:
        await run_case(case_directory)
    except (CaseFailure, CaseFormatError) as error:
        report = f"{case_directory.name}\n{error}"
    if report is not None:
        pytest.fail(report, pytrace=False)


def test_cases_cite_every_section_of_the_specification():
    headings = spec_headings((REPOSITORY / "spec" / "goondan.md").read_text(encoding="utf-8"))
    citations: dict[str, list[str]] = {}
    for case_directory in CASES:
        case_file = case_directory / "case.json"
        if not case_file.is_file():
            citations[case_directory.name] = []
            continue
        try:
            cited = json.loads(case_file.read_text(encoding="utf-8")).get("spec")
        except json.JSONDecodeError:
            cited = None
        citations[case_directory.name] = [item for item in cited if isinstance(item, str)] if isinstance(cited, list) else []
    problems = coverage_problems(headings, citations)
    assert not problems, "the cases do not cover the specification:\n" + "\n".join(problems)
