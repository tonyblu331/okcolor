#!/usr/bin/env python3
"""Generate ColorAide oracle fixtures for okcolor tests.

The repository does not depend on Python at test time. This script is a reproducible
fixture generator: install ColorAide separately, run it, and commit the generated JSON.

Example:
  python -m pip install --target .tmp/pydeps coloraide==8.8.1
  $env:PYTHONPATH = ".tmp/pydeps"
  python scripts/generate-coloraide-fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    import coloraide
    from coloraide import Color
except ImportError as exc:  # pragma: no cover - developer helper path
    raise SystemExit(
        "ColorAide is required to regenerate fixtures. "
        "Run: python -m pip install --target .tmp/pydeps coloraide==8.8.1"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "oracles" / "color-aide-fixtures.json"

FIXTURE_INPUTS: list[dict[str, Any]] = [
    {
        "name": "out-of-sRGB green",
        "gamut": "srgb",
        "oklch": {"l": 0.7, "c": 0.35, "h": 145},
    },
    {
        "name": "out-of-P3 cyan",
        "gamut": "display-p3",
        "oklch": {"l": 0.75, "c": 0.32, "h": 210},
    },
    {
        "name": "out-of-P3 blue",
        "gamut": "display-p3",
        "oklch": {"l": 0.45, "c": 0.35, "h": 265},
    },
]

METHODS = ["raytrace", "oklch-chroma", "minde-chroma", "clip"]


def rounded(coords: list[float]) -> dict[str, float]:
    return {
        "l": round(coords[0], 12),
        "c": round(coords[1], 12),
        "h": round(coords[2] % 360, 12),
    }


def generate() -> dict[str, Any]:
    fixtures: list[dict[str, Any]] = []
    for fixture in FIXTURE_INPUTS:
        source = Color("oklch", [fixture["oklch"]["l"], fixture["oklch"]["c"], fixture["oklch"]["h"]])
        methods: dict[str, Any] = {}
        for method in METHODS:
            fitted = source.clone().fit(fixture["gamut"], method=method).convert("oklch")
            methods[method] = {
                "oklch": rounded(fitted.coords()),
                "inGamut": fitted.in_gamut(fixture["gamut"]),
            }

        fixtures.append(
            {
                **fixture,
                "sourceInGamut": source.in_gamut(fixture["gamut"]),
                "methods": methods,
            }
        )

    return {
        "generatedBy": "scripts/generate-coloraide-fixtures.py",
        "oracle": {
            "name": "ColorAide",
            "version": coloraide.__version__,
            "docs": "https://facelessuser.github.io/coloraide/gamut/",
        },
        "fixtures": fixtures,
    }


def main() -> None:
    OUT.write_text(json.dumps(generate(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
