from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[2]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))


def main() -> int:
    try:
        import pytest  # type: ignore
    except ModuleNotFoundError:
        suite = unittest.defaultTestLoader.discover("tests")
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    return int(pytest.main(["tests"]))


if __name__ == "__main__":
    raise SystemExit(main())
