#!/usr/bin/env python3
"""Inspect image/video media with ffprobe and emit compact JSON."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def probe(path: Path) -> dict:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe was not found on PATH") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.strip() or "ffprobe failed"
        raise RuntimeError(f"{path}: {message}") from exc

    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError(f"{path}: no video/image stream found")

    return {
        "path": str(path),
        "format": payload.get("format", {}).get("format_name"),
        "duration": float(video.get("duration") or payload.get("format", {}).get("duration", 0) or 0),
        "width": video.get("width"),
        "height": video.get("height"),
        "codec": video.get("codec_name"),
        "pixel_format": video.get("pix_fmt"),
        "frame_rate": video.get("r_frame_rate"),
        "frames": video.get("nb_frames"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()

    reports = []
    for path in args.inputs:
        if not path.is_file():
            print(f"missing: {path}", file=sys.stderr)
            return 2
        try:
            reports.append(probe(path))
        except (RuntimeError, json.JSONDecodeError) as exc:
            print(str(exc), file=sys.stderr)
            return 2

    print(json.dumps(reports, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
