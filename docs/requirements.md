# Media MCP Server Requirements

## 目标

建立一个基于 Node.js 的 MCP Server，用 MCP 工具接口对接 ApiMart 图片生成、视频生成、音频生成 API，优先满足本地桌面客户端调用的场景。

## 核心用户故事

1. 作为 MCP 客户端，我可以查询当前支持的媒体 provider，以及每个 provider 是否已正确配置。
2. 作为 MCP 客户端，我可以按图片模型调用独立生图工具，降低下游 agent 的工具选择难度。
3. 作为 MCP 客户端，我可以调用统一的视频生成工具，并拿到任务状态、结果链接或轮询地址。
4. 作为 MCP 客户端，我可以调用统一的音频生成工具，并得到本地输出文件路径。
5. 作为维护者，我可以新增 ApiMart 模型工具，而不需要改动 provider 核心逻辑。

## MVP 范围

- HTTP 模式 MCP Server
- 按模型拆分的图片生成工具
- 统一的 `generate_video` / `generate_audio` 工具
- provider 列表与配置检查工具
- ApiMart 图片/视频/音频生成接入
- 本地产物保存到 `outputs/`

## 非目标

- 鉴权 UI
- Webhook 回调服务
- 数据库存储
- 队列系统
- 多租户隔离

## 验收标准

- 项目可通过 `npm run build` 编译
- 启动后 MCP 客户端可发现 provider 查询、图片模型、视频、音频、任务查询和余额查询工具
- 未配置 API Key 时，工具会返回明确配置错误
- 已配置 API Key 时，可至少跑通每类媒体一个 ApiMart 模型
