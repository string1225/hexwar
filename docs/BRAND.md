# HEXWAR 视觉设计

## Logo

文件：[`assets/logo.png`](../assets/logo.png)。1254 × 1254，透明背景，已用于双端标题区、战役准备窗口和浏览器图标。

设计将**六边形疆域、城堡垛口、中央六边形负空间**合为一个图形。翡翠绿代表玩家的扩张与成长，暖白外框强调边界。中文标题「六边形战争」与英文「HEXWAR」由界面字体渲染，避免把文字固化到图形中。

界面采用深绿黑底、青绿玩家势力、暖金选择反馈，以及赤焰 / 流金 / 紫雾 / 苍蓝 / 银月的敌方颜色。地块同时有数字和势力简称，避免仅依赖颜色识别。

Logo 通过内置 `image_gen` 工具生成，没有调用付费 API CLI 回退；原图保留透明通道，作为项目资产复制到仓库。

## 最终生成提示词

```text
Use case: logo-brand. Asset type: primary icon for a Chinese hexagonal turn-based strategy WeChat mini game named 六边形战争 (HEXWAR). Primary request: create a premium, highly legible geometric emblem combining a hexagonal territory border and an abstract fortress / three crenellated battlements, with one small hexagonal tile inset as negative space. Style: crisp flat vector-like geometry, restrained contemporary tactical board-game identity, confident and simple, recognizable at 40px. Center a single unified mark in a square canvas with ample transparent margin; emblem occupies about 78% width. Use pale warm ivory for outer hexagonal outline and rich jade green / mint for the fortress facets. Subtle two-tone geometry allowed. Transparent background. No words, no letters, no typography, no mockup, no shadows, no gradients, no ornament, no watermark. Deliver the emblem alone.
```
