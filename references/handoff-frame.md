# 接管帧与高清底图

## 两条路径

- 实际帧：用视频选定帧作为静态底图，位置更容易匹配，但清晰度受视频限制。
- 高清图：保留满意的高清原图作为静态底图；对比实际帧的姿态、位置、背景和颜色，必要时校准接入样式或调整素材。

不为消除差异擅自覆盖用户高清原图。不用长淡出掩盖构图错误。

## 记录实际接管依据

extract_tail.py 解码实际帧时间戳，以帧号提取 PNG，并输出同名 JSON：
frame 从 0 开始；handoffTime 为视频时间轴秒数；另含视频和帧哈希、尺寸、人工确认状态。

    python -X utf8 scripts/extract_tail.py intro.mp4 handoff-v1.png
    python -X utf8 scripts/extract_tail.py intro.mp4 handoff-v2.png --at 5.8
    python -X utf8 scripts/extract_tail.py intro.mp4 handoff-v3.png --frame 139

将 JSON 中 handoffTime 传给网页控制器。不要把“生成用尾帧”误认为“视频实际尾帧”。
更换视频后重新提取；validate_handoff.py --report 可检测旧记录与新视频的哈希不一致。
高清图路径下 staticIsExtractedFrame=false 是预期情况，需要人工对比，不是自动阻塞。

模板按记录时间寻帧后淡出。浏览器与 FFmpeg 的解码及颜色表现可能有差异，需实际验收。
复杂时间戳、旋转信息、非标准像素比例的视频，应先规范化为独立交付副本，再以该副本提取记录；保留源文件。
