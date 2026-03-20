# Media MCP Server Requirements

## 目标

建立一个基于 Node.js 的 MCP Server，用统一工具接口对接图片生成、视频生成、音频生成 API，优先满足本地桌面客户端通过 stdio 调用的场景。

## 核心用户故事

1. 作为 MCP 客户端，我可以查询当前支持的媒体 provider，以及每个 provider 是否已正确配置。
2. 作为 MCP 客户端，我可以调用统一的生图工具，而不需要分别适配每家图片 API。
3. 作为 MCP 客户端，我可以调用统一的视频生成工具，并拿到任务状态、结果链接或轮询地址。
4. 作为 MCP 客户端，我可以调用统一的音频生成工具，并得到本地输出文件路径。
5. 作为维护者，我可以新增 provider，而不需要改动大部分工具层逻辑。

## MVP 范围

- stdio 模式 MCP Server
- 统一的 `generate_image` / `generate_video` / `generate_audio` 工具
- provider 列表与配置检查工具
- OpenAI 图片生成接入
- Replicate 图片/视频生成接入
- ElevenLabs 文字转语音接入
- 本地产物保存到 `outputs/`

## 非目标

- 鉴权 UI
- Webhook 回调服务
- 数据库存储
- 队列系统
- 多租户隔离

## 验收标准

- 项目可通过 `npm run build` 编译
- 启动后 MCP 客户端可发现 4 个工具
- 未配置 API Key 时，工具会返回明确配置错误
- 已配置 API Key 时，可至少跑通每类媒体一个 provider
