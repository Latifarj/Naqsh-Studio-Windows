#!/usr/bin/env python3
"""Render the in-repository multi-motif sample and its in-app starter thumbnail."""
from pathlib import Path
import cairosvg

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "examples" / "sample-composed.svg"
if not SOURCE.is_file():
    raise FileNotFoundError(f"Build the sample SVG first: {SOURCE}")

cairosvg.svg2png(
    url=str(SOURCE),
    write_to=str(ROOT / "examples" / "sample-composed-preview.png"),
    output_width=2400,
    output_height=1440,
    background_color="#ffffff",
)
cairosvg.svg2png(
    url=str(SOURCE),
    write_to=str(ROOT / "web" / "starter-preview.png"),
    output_width=900,
    output_height=540,
    background_color="#ffffff",
)
print("Rendered full-sheet sample preview and in-app starter thumbnail.")
