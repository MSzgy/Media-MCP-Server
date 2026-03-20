# Media MCP Server

一个基于 Node.js + TypeScript 的 MCP Server，用统一工具接口接入图片生成、视频生成、音频生成 API。

当前内置的 provider：

- `openai`：图片生成
- `replicate`：图片/视频生成
- `elevenlabs`：音频生成

## 工具列表

- `list_media_providers`
- `generate_image`
- `generate_video`
- `generate_audio`

## 快速开始

```bash
cp .env.example .env
npm install
npm run build
```

开发模式：

```bash
npm run dev
```

## 环境变量

至少配置你要使用的 provider 对应的 API Key：

- `OPENAI_API_KEY`
- `REPLICATE_API_TOKEN`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_DEFAULT_VOICE_ID`

## MCP 客户端配置示例

```json
{
  "mcpServers": {
    "media": {
      "command": "node",
      "args": [
        "/Users/zouguoyang/Media-MCP-Server/dist/index.js"
      ],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "REPLICATE_API_TOKEN": "your-token",
        "ELEVENLABS_API_KEY": "your-key",
        "ELEVENLABS_DEFAULT_VOICE_ID": "your-voice-id"
      }
    }
  }
}
```

## 目录结构

```text
src/
  config/
  lib/
  providers/
  services/
docs/
outputs/
```

## 后续建议

- 增加异步任务查询工具
- 增加更多媒体 provider
- 增加集成测试和 HTTP transport
