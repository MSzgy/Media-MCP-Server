# Media MCP Server Design

## 架构概览

系统分为三层：

1. MCP Tool Layer
   - 对外暴露 `list_media_providers`、`generate_image`、`generate_video`、`generate_audio`
   - 负责参数校验与结果序列化
2. Media Service Layer
   - 负责默认 provider 选择
   - 校验 provider 是否支持对应能力
   - 校验 provider 配置是否完整
3. Provider Adapter Layer
   - 负责和上游 API 通信
   - 统一返回标准化媒体结果

## Provider 策略

- `openai`
  - 能力：`image`
  - 走 OpenAI Image API
  - 结果保存为本地图片文件

- `replicate`
  - 能力：`image`, `video`
  - 走 Replicate Prediction API
  - 支持官方模型路径或 version 模式
  - 长任务保留任务 ID 与轮询地址

- `elevenlabs`
  - 能力：`audio`
  - 走 ElevenLabs Text-to-Speech API
  - 返回本地音频文件路径

## 标准化返回结构

每个 provider 输出统一结构：

```json
{
  "provider": "openai",
  "capability": "image",
  "model": "gpt-image-1.5",
  "status": "completed",
  "jobId": "optional",
  "assets": [
    {
      "kind": "file",
      "path": "/absolute/path/to/output.png",
      "contentType": "image/png"
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

- 各家媒体 API 参数差异很大，因此工具层保留 `input` 字段承载 provider 专属参数
- 视频任务往往是异步的，因此当前以返回任务状态和 URL 为主
- 图片和音频会写入本地磁盘，需要控制输出目录与清理策略
