#!/usr/bin/env python3
"""只检查媒体规格与接管记录，不将技术通过当作视觉一致。"""
import argparse
import json
from pathlib import Path
import sys
from probe_intro import probe
from extract_tail import digest


def validate(static, video, report_path=None):
    a, b = probe(static), probe(video)
    errors = []
    if not all(item.get("width", 0) and item.get("height", 0) for item in (a, b)):
        errors.append("媒体尺寸无效")
    elif abs(a["width"] / a["height"] / (b["width"] / b["height"]) - 1) > 0.02:
        errors.append("静态图与视频画幅不匹配，需要明确裁剪方案")
    if b["duration"] <= 0:
        errors.append("视频时长无效")
    report = None
    if report_path:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("videoSha256") != digest(video):
            errors.append("视频与接管帧记录不属于同一版本")
        time = report.get("handoffTime")
        if not isinstance(time, (int, float)) or not 0 <= time < b["duration"]:
            errors.append("接管时间不在视频范围内")
    return {"status": "blocked" if errors else "media-specs-passed",
        "static": a, "video": b, "errors": errors,
        "handoffTime": report.get("handoffTime") if report else None,
        "staticIsExtractedFrame": digest(static) == report.get("imageSha256") if report else None,
        "pending": ["构图、姿态、颜色、边缘与接缝由用户确认",
                    "网页实际容器的裁剪及比例需在接入阶段核对"] +
                   ([] if report else ["尚未绑定接管帧记录"])}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--static", required=True, type=Path)
    p.add_argument("--video", required=True, type=Path)
    p.add_argument("--report", type=Path)
    args = p.parse_args()
    try:
        result = validate(args.static, args.video, args.report)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result["errors"] else 0
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
