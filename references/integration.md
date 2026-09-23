# 网页接入与参数

## 选择接入策略

已有可靠控制器时优先局部修复，不复制第二套控制器。

同一场景容器：视频和原图共享尺寸、蒙版和背景，适合能安全移动整个场景的页面。
Agent 按既有布局实现位移和等比缩放，保持原布局占位。不要复制作者网站的百分比坐标。

独立 fixed 层：可避开父级裁剪，但必须核对目标画面区域、祖先滤镜/蒙版/混合、圆角和图像裁剪。
当前 templates/hero-intro.js 只实现此方案：目标须是无 padding/border、没有自身 transform 的图片画布，图像以完整画幅显示。
不直接支持任意 object-fit:cover、旋转容器、祖先复杂蒙版或 3D 变换。遇到这些情况先创建明确的画面锚点或改用同容器方案。
模板复制目标自身的标准圆角、clip-path 与 mask 样式；复杂祖先效果需显式适配。

## 初始化

复制模板 JS/CSS 到项目公开资源目录，参考 templates/integration.example.html。
确保脚本使用 type="module"，在 DOM 就绪后显式调用 createHeroIntro。
scene 可传入 DOM 元素；它仍须具有 data-hero-intro-static 属性，使 CSS 和测量目标一致。
所有需要恢复的 UI 标记 data-hero-intro-ui；不要把静态场景嵌在该 UI 元素中。
已有永久 inert 元素会保留原状态。

必须配置 handoffTime（来自接管 JSON）。其他参数：

| 配置 | 默认 | 作用 |
|---|---|---|
| src | 根元素 data-intro-src | 视频地址 |
| scene | data-hero-intro-static | 落位画面元素 |
| handoffTime | 必填 | 接管帧的秒数 |
| returnMs | 1150 | 接管前多久开始回位 |
| revealLeadMs | 1000 | 接管前多久显示文字 |
| revealMs | 400 | UI 出现时长 |
| crossfadeMs | 160 | 视频淡出时长 |
| margin | 0.9 | 居中画面占可用视口的上限 |
| once | true | 同 session 只播放一次 |
| key | 页面路径和视频地址 | 播放记录标识 |
| loadTimeoutMs | 10000 | 加载/解码/寻帧超时 |
| stallTimeoutMs | 5000 | 播放没有进展的超时 |

margin 控制完整视频画布，画布内部的主体留白不会自动裁掉。用户觉得主体太小时，先核对素材留白再改尺寸。
带 ?intro=replay 可绕过只播放一次。控制器返回 start()、skip()、destroy()、state。
组件卸载调用 destroy()；重复挂载前销毁旧实例。模板不依赖任何框架。

## 首屏防闪与恢复

示例在根节点加入 data-intro-pending，并在头部设短超时：主脚本未加载也会撤掉隐藏标记。
根据项目 CSP 使用 nonce 或外部脚本；不要为示例削弱站点 CSP。
无 JS 时 noscript 恢复静态页面。初始化异常也需移除 pending 标记。

## 事件

hero-intro:ready 表示页面恢复可用，成功、跳过或错误均只发一次；detail.reason 和 detail.root 标识结果及实例。
hero-intro:started 表示 play() 成功；hero-intro:error / skipped 提供失败或跳过原因。
这些是网页事件，不会启动任何其他 Skill。
