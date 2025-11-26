"""Pytest configuration for integration tests"""

import pytest


def pytest_addoption(parser):
    """Add custom pytest command-line options"""
    parser.addoption(
        "--save-debug-files",
        action="store_true",
        default=False,
        help="Save exported files to debug directory for inspection"
    )

