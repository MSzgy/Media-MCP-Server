# Media MCP Server Design

## 架构概览

系统分为三层：

1. MCP Tool Layer
   - 对外暴露 `list_media_providers`、多个独立图片模型工具、`generate_video`、`generate_audio`
   - 负责参数校验与结果序列化
2. Media Service Layer
   - 负责默认 provider 选择
   - 校验 provider 是否支持对应能力
   - 校验 provider 配置是否完整
3. Provider Adapter Layer
   - 负责和上游 API 通信
   - 统一返回标准化媒体结果

## Provider 策略

- `apimart`
  - 能力：`image`, `video`, `audio`
  - 图片工具按模型拆分，命名为 `generate_<capability>_<provider>_<model>`，便于后续接入官方 API 时区分来源
  - 视频和图片长任务保留任务 ID，并可通过任务状态工具查询
  - 音频结果保存为本地音频文件

## 标准化返回结构

每个 provider 输出统一结构：

```json
{
  "provider": "apimart",
  "capability": "image",
  "model": "gemini-3.1-flash-image-preview",
  "status": "submitted",
  "jobId": "task_...",
  "assets": [
    {
      "kind": "url",
      "url": "https://..."
    }
  ],
  "metadata": {}
}
```

## 扩展方式

新增 provider 时：

1. 在 `src/providers/` 增加一个实现 `MediaProvider` 接口的适配器
2. 在 `src/index.ts` 注册 provider
3. 如需新增环境变量，在 `.env.example` 与 `src/config/env.ts` 中补充

## 风险点

- ApiMart 不同模型参数差异较大，因此工具层保留 `input` 字段承载模型专属参数
- 视频任务往往是异步的，因此当前以返回任务状态和 URL 为主
- 音频会写入本地磁盘，需要控制输出目录与清理策略
