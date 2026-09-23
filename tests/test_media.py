"""使用临时合成素材检查媒体工具，不访问用户素材。"""
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from extract_tail import extract
from validate_handoff import validate


class MediaTests(unittest.TestCase):
    def test_extract_and_binding(self):
        with tempfile.TemporaryDirectory(prefix="hero-intro-test-") as directory:
            root = Path(directory)
            video, frame = root / "测试.mp4", root / "接管.png"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=160x120:rate=24:duration=1", "-c:v", "libx264",
                str(video)], check=True)
            report = extract(video, frame)
            self.assertEqual(report["frame"], 23)
            self.assertAlmostEqual(report["handoffTime"], 23 / 24, places=5)
            self.assertTrue(frame.is_file())
            result = validate(frame, video, frame.with_suffix(".json"))
            self.assertEqual(result["status"], "media-specs-passed")
            self.assertTrue(result["staticIsExtractedFrame"])
            with self.assertRaises(ValueError):
                extract(video, frame)
            early = extract(video, root / "early.png", at=0.5)
            self.assertEqual(early["frame"], 12)
            with self.assertRaises(ValueError):
                extract(video, root / "invalid.png", frame_index=900)
            video.write_bytes(video.read_bytes() + b"version-change")
            result = validate(frame, video, frame.with_suffix(".json"))
            self.assertEqual(result["status"], "blocked")

if __name__ == "__main__":
    unittest.main()
