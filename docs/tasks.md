# Media MCP Server Tasks

## 已完成

- [x] 初始化 TypeScript Node.js 项目结构
- [x] 搭建 stdio MCP Server 入口
- [x] 设计统一 provider 抽象
- [x] 接入 OpenAI 图片生成
- [x] 接入 Replicate 图片/视频生成
- [x] 接入 ElevenLabs 文字转语音
- [x] 增加环境变量模板与输出目录策略
- [x] 编写需求、设计、任务文档

## 待办

- [ ] 增加 `get_generation_job` 工具，统一轮询异步任务
- [ ] 增加更多 provider，例如 Runway、Fal、Luma、MiniMax
- [ ] 增加 webhook 模式处理长视频任务
- [ ] 为每个 provider 增加集成测试
- [ ] 增加 HTTP transport 供远程调用
