#!/usr/bin/env python3
"""按真实视频帧提取接管图，并记录可供网页使用的时间及素材哈希。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def run(command):
    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    return result.stdout


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def extract(video, output, frame_index=None, at=None):
    if not video.is_file():
        raise ValueError(f"视频不存在: {video}")
    if output.suffix.lower() != ".png":
        raise ValueError("接管帧输出必须是 PNG")
    report_path = output.with_suffix(".json")
    if output.exists() or report_path.exists():
        raise ValueError("输出已存在，请使用新版本文件名")
    payload = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
        "-of", "json", str(video)]))
    frames = payload.get("frames", [])
    if not frames:
        raise ValueError("未找到可解码视频帧")
    times = [float(item["best_effort_timestamp_time"]) for item in frames]
    origin = times[0]
    times = [t - origin for t in times]
    index = len(times) - 1
    if frame_index is not None:
        index = frame_index
    elif at is not None:
        if at < 0 or at > times[-1]:
            raise ValueError("时间超出视频帧范围")
        # 对应覆盖该时间的帧，不取未来一帧。
        index = max(i for i, t in enumerate(times) if t <= at)
    if index < 0 or index >= len(times):
        raise ValueError("帧号超出范围（帧号从 0 开始）")
    output.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-v", "error", "-n", "-i", str(video), "-map", "0:v:0",
         "-vf", f"select=eq(n\\,{index})", "-fps_mode", "vfr",
         "-frames:v", "1", str(output)])
    if not output.is_file() or output.stat().st_size == 0:
        raise ValueError("FFmpeg 没有生成有效图片")
    image = json.loads(run(["ffprobe", "-v", "error", "-show_streams",
                           "-of", "json", str(output)]))["streams"][0]
    report = {
        "schemaVersion": 1, "video": video.name, "videoSha256": digest(video),
        "frame": index, "handoffTime": times[index], "sourceStartTime": origin,
        "frameCount": len(times), "image": output.name, "imageSha256": digest(output),
        "width": image["width"], "height": image["height"],
        "visualApproval": "pending",
        "note": "handoffTime 使用视频时间轴秒数；浏览器 seek 有解码精度差异，仍需人工验收。"
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--frame", type=int, help="从 0 开始的实际帧号；默认最后一帧")
    group.add_argument("--at", type=float, help="从视频开始计算的秒数")
    args = parser.parse_args()
    try:
        print(json.dumps(extract(args.video, args.output, args.frame, args.at), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
