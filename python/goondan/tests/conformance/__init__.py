"""Python conformance runner for `fixtures/conformance`.

The package implements `fixtures/conformance/README.md`. `tests/test_conformance.py`
is the pytest entry point; every other module here is a building block of the runner.
Nothing in this package imports from the other test modules, so the whole suite can be
excluded with the `tests/conformance` path or the `test_conformance.py` name.
"""
