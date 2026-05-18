# Media MCP Server

一个基于 Node.js + TypeScript 的 MCP Server，用 MCP 工具接口接入 ApiMart 的图片生成、视频生成、音频生成 API。

当前内置的 provider：

- `apimart`：图片/视频/音频生成

## 工具列表

- `list_media_providers`
- `generate_image_apimart_gemini_3_1_flash_image_preview`
- `generate_image_apimart_gemini_3_pro_image_preview`
- `generate_image_apimart_imagen_4_0_apimart`
- `generate_image_apimart_gpt_image_2`
- `generate_image_apimart_gpt_image_2_official`
- `generate_image_apimart_z_image_turbo`
- `generate_image_apimart_wan2_7_image_pro`
- `generate_video_apimart_doubao_seedance_2_0`
- `generate_video_apimart_doubao_seedance_2_0_private_avatar`
- `generate_video_apimart_doubao_seedance_2_0_real_avatar`
- `generate_video_apimart_sora_2`
- `generate_video_apimart_veo3_1_fast`
- `generate_video_apimart_veo3_1_fast_remix`
- `generate_video_apimart_veo3_1_fast_official`
- `generate_video_apimart_happyhorse_1_0`
- `generate_video_apimart_wan2_7`
- `generate_video_apimart_wan2_7_r2v`
- `generate_video_apimart_wan2_7_videoedit`
- `generate_video_apimart_wan2_6`
- `generate_video_apimart_wan2_6_i2v_flash`
- `generate_video_apimart_kling_v2_6`
- `generate_video_apimart_grok_imagine_1_0_video_apimart`
- `generate_video`
- `generate_audio`
- `check_task_status`
- `check_apimart_balance`

## Reference 图片上传

生图和生视频工具里的 `imageUrls` / `imageWithRoles` / `firstFrameImage` / `lastFrameImage` 需要可访问的图片 URL。ApiMart 文档说明不再推荐直接把 base64 图片塞进 generation API；本地图片应先上传，再把返回的 URL 用作 reference。

上传工具：

- `upload_apimart_image`

参数：

| 参数 | 说明 |
| --- | --- |
| `filePath` | 本地图片路径，支持绝对路径或项目相对路径。格式支持 JPEG、PNG、WebP、GIF。最大 20MB。 |
| `provider` | 可选。当前只支持 `apimart`，通常省略即可。 |

返回：

| 字段 | 说明 |
| --- | --- |
| `url` | 可直接用于 `imageUrls` 等参数的公开 URL，有效期 72 小时。 |
| `filename` | 原始文件名。 |
| `contentType` | 检测到的 MIME 类型。 |
| `bytes` | 文件大小。 |
| `createdAt` | 上传时间，Unix 秒。 |

典型流程：

1. 调用 `upload_apimart_image` 上传本地 reference 图。
2. 把返回的 `url` 放进图片工具的 `imageUrls`，或视频工具的 `imageUrls` / `imageWithRoles` / `firstFrameImage`。
3. 调用对应的 `generate_<capability>_apimart_<model>` 工具。

## 图片工具参数

图片工具命名遵循 `generate_<capability>_<provider>_<model>`。所有图片工具都会固定写入对应 ApiMart `model`，调用方不需要再传模型名。

通用参数：

| 参数 | ApiMart 字段 | 说明 |
| --- | --- | --- |
| `prompt` | `prompt` | 必填。生图提示词，建议写清主体、风格、构图、约束。 |
| `size` | `size` | 画幅、分辨率关键字或像素尺寸，取决于模型。常见值：`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3840x2160`。 |
| `resolution` | `resolution` | 分辨率档位。Gemini/Z/Wan 常用 `1K`、`2K`、`4K`；GPT Image 2 文档使用 `1k`、`2k`、`4k`。 |
| `count` | `n` | 输出图片数量。多数模型 1-4；Imagen 4.0 和 GPT Image 2 standard 仅支持 1；Wan2.7 sequential 模式最多 12。 |
| `imageUrls` | `image_urls` | 参考图 URL，用于图生图、编辑、角色/风格一致性。本地图片先用 `upload_apimart_image` 上传。 |
| `input` | 透传 | 兜底扩展参数，会在命名参数之后合并进请求体。 |

模型专属参数：

| 工具 | 额外参数 |
| --- | --- |
| `generate_image_apimart_gemini_3_1_flash_image_preview` | `officialFallback`、`imageUrls`、`googleSearch`、`googleImageSearch`。`googleImageSearch` 应与 `googleSearch=true` 一起使用。 |
| `generate_image_apimart_gemini_3_pro_image_preview` | `officialFallback`、`imageUrls`。参考图最多 14 张。 |
| `generate_image_apimart_imagen_4_0_apimart` | `count` 固定只能为 1；`size` 支持 `16:9`、`9:16`。 |
| `generate_image_apimart_gpt_image_2` | `imageUrls`、`officialFallback`；`count` 固定只能为 1。 |
| `generate_image_apimart_gpt_image_2_official` | `quality`、`background`、`moderation`、`outputFormat`、`outputCompression`、`imageUrls`、`maskUrl`。`maskUrl` 用于局部重绘，需配合 `imageUrls`。 |
| `generate_image_apimart_z_image_turbo` | `promptExtend`；`prompt` 最多 800 字符；固定生成 1 张，不支持 `count`。 |
| `generate_image_apimart_wan2_7_image_pro` | `negativePrompt`、`watermark`、`seed`、`thinkingMode`、`enableSequential`、`bboxList`、`colorPalette`。标准模式 `count` 为 1-4，连续生成模式为 1-12。 |

字段命名说明：

| MCP 参数 | ApiMart 字段 |
| --- | --- |
| `officialFallback` | `official_fallback` |
| `googleSearch` | `google_search` |
| `googleImageSearch` | `google_image_search` |
| `outputFormat` | `output_format` |
| `outputCompression` | `output_compression` |
| `maskUrl` | `mask_url` |
| `promptExtend` | `prompt_extend` |
| `negativePrompt` | `negative_prompt` |
| `thinkingMode` | `thinking_mode` |
| `enableSequential` | `enable_sequential` |
| `bboxList` | `bbox_list` |
| `colorPalette` | `color_palette` |

## 视频工具参数

视频工具同样遵循 `generate_<capability>_<provider>_<model>`。优先使用按模型拆分的工具；`generate_video` 只保留为兼容入口。

常用参数映射：

| MCP 参数 | ApiMart 字段 | 说明 |
| --- | --- | --- |
| `prompt` | `prompt` | 视频描述。部分 I2V/编辑工具可省略，但建议填写动作、镜头、风格。 |
| `duration` | `duration` | 视频秒数，范围随模型变化。 |
| `size` | `size` | 使用 `size` 的模型画幅，如 Seedance/Wan/HappyHorse/Grok。 |
| `aspectRatio` | `aspect_ratio` | 使用 `aspect_ratio` 的模型画幅，如 Sora/Veo/Kling。 |
| `resolution` | `resolution` | 分辨率，注意不同模型大小写不同，如 `720p`、`1080p`、`720P`、`1080P`、`4k`、`4K`。 |
| `imageUrls` | `image_urls` | 参考图或首帧图数组。本地图片先用 `upload_apimart_image` 上传。 |
| `imageWithRoles` | `image_with_roles` | 带角色的图片数组，如 `first_frame`、`last_frame`、`reference_image`。 |
| `videoUrls` | `video_urls` | 参考视频或源视频数组。 |
| `audioUrls` | `audio_urls` | Seedance 2.0 参考音频数组。 |
| `audioUrl` | `audio_url` | Wan 自定义音频 URL。 |
| `firstFrameImage` | `first_frame_image` | Veo official / HappyHorse 首帧图。 |
| `lastFrameImage` | `last_frame_image` | Veo official 尾帧图。 |
| `negativePrompt` | `negative_prompt` | 负向提示词。 |
| `generateAudio` | `generate_audio` | Seedance/Veo official 自动生成音频。 |
| `audio` | `audio` | Wan/Kling 自动音频开关。 |
| `promptExtend` | `prompt_extend` | Wan prompt 智能扩写。 |
| `watermark` | `watermark` | 是否添加 AI watermark。 |
| `waitSeconds` | 本地轮询 | 提交后最多轮询多少秒；设为 `0` 可立即返回任务 ID。 |
| `input` | 透传 | 兜底扩展参数，最后合并进请求体。 |

模型专属说明：

| 工具 | 重点参数 |
| --- | --- |
| `generate_video_apimart_doubao_seedance_2_0` | `duration` 4-15；`size` 支持 `adaptive`；`imageUrls`、`imageWithRoles`、`videoUrls`、`audioUrls` 支持多模态参考；`returnLastFrame` 可用于连续生成。 |
| `generate_video_apimart_doubao_seedance_2_0_private_avatar` | 提交虚拟 avatar 资产审核；用 `group` 或 `groupId`，`assets` 最多 20 个，审核通过后拿 `asset://...` 给 Seedance 2.0 使用。 |
| `generate_video_apimart_doubao_seedance_2_0_real_avatar` | 真实人物 avatar 三步流程：`callbackUrl` 创建验证会话，`bytedToken` 查询验证结果，`groupId + assets` 提交资产审核。 |
| `generate_video_apimart_sora_2` | `duration` 支持 4/8/12/16/20；`imageUrls` 最多 1 张。 |
| `generate_video_apimart_veo3_1_fast` | 固定 8 秒；`generationType` 可为 `frame` 或 `reference`；`enableGif` 不可和 1080p/4k 同用。 |
| `generate_video_apimart_veo3_1_fast_remix` | 需要 `sourceTaskId`，原视频任务必须已完成；`raw` 控制只返回延展片段还是合并视频。 |
| `generate_video_apimart_veo3_1_fast_official` | 支持 `firstFrameImage`/`lastFrameImage`、`personGeneration`、`resizeMode`、`sampleCount`。 |
| `generate_video_apimart_happyhorse_1_0` | 自动路由 T2V/I2V/R2V/EDIT；`videoUrl` 进入编辑模式，可配 `audioSetting`。 |
| `generate_video_apimart_wan2_7` | 支持 T2V/I2V/视频续写；`audioUrl` 与图片/视频输入互斥。 |
| `generate_video_apimart_wan2_7_r2v` | 至少传 `imageWithRoles` 或 `videoUrls`；总参考素材最多 5 个。 |
| `generate_video_apimart_wan2_7_videoedit` | `videoUrls` 必填且只使用第 1 个；`metadata.audio_setting` 可设为 `origin` 保留原音频。 |
| `generate_video_apimart_wan2_6` | `duration` 仅 5/10/15；`template` 可触发特效模式。 |
| `generate_video_apimart_wan2_6_i2v_flash` | `imageUrls` 必填且只能 1 张；默认生成音频，可用 `audio=false` 静音。 |
| `generate_video_apimart_kling_v2_6` | `mode=std` 为 720P 静音；`mode=pro` 支持 1080P 和自动音频；2 张图尾帧控制需要 pro。 |
| `generate_video_apimart_grok_imagine_1_0_video_apimart` | `duration` 6-30；`quality` 支持 `480p`、`720p`；`imageUrls` 最多 7 张且不支持 base64。 |

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

## Docker 部署

构建镜像：

```bash
docker build -t media-mcp-server:local .
```

直接运行容器：

```bash
docker run -d \
  --name media-mcp-server \
  -p 3333:3333 \
  -e MCP_AUTH_TOKEN=your_secret_token_here \
  -e APIMART_API_KEY=your_apimart_key \
  -e APIMART_BASE_URL=https://api.apimart.ai/v1 \
  -v media_outputs:/app/outputs \
  media-mcp-server:local
```

使用 compose：

```bash
cp .env.example .env
docker compose up -d --build
```

健康检查：

```bash
curl http://localhost:3333/health
```

## GitHub Actions 自动部署

合入或 push 到 `main` 会触发 `.github/workflows/deploy.yml`：

1. 构建 `linux/arm64` Docker 镜像
2. 推送到 GitHub Container Registry，镜像名为 `ghcr.io/<owner>/<repo>:<commit-sha>`，同时更新 `latest`
3. SSH 登录服务器
4. 拉取本次 commit 镜像
5. 停掉占用主机端口 `3333` 的旧容器或进程
6. 重建容器并映射主机端口 `3333` 到容器端口 `3333`

需要在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 配置这些 Secrets：

| Secret | 说明 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 IP 或域名。 |
| `DEPLOY_USER` | SSH 用户，例如 `ubuntu`。workflow 会用该用户登录后执行 `sudo -i` 跑 Docker 部署命令。 |
| `DEPLOY_SSH_KEY` | SSH 私钥内容。 |
| `DEPLOY_PORT` | 可选，SSH 端口；不填默认 `22`。 |
| `MCP_AUTH_TOKEN` | MCP HTTP 访问 token。客户端调用 `/mcp` 时用 `Authorization: Bearer <token>`。 |
| `APIMART_API_KEY` | ApiMart API Key。 |
| `APIMART_BASE_URL` | 可选，不填默认 `https://api.apimart.ai/v1`。 |

服务器要求：

- 已安装 Docker
- `DEPLOY_USER` 可免密码执行 `sudo -i`
- 服务器架构为 arm64，或 Docker 可运行 arm64 镜像
- 如果主机端口 `3333` 已被占用，workflow 会先停止占用该端口的 Docker 容器或监听进程

部署后的服务地址：

```text
http://<server-host>:3333/mcp
```

## 环境变量

配置 ApiMart API Key：

- `APIMART_API_KEY`
- `APIMART_BASE_URL`，可选，默认 `https://api.apimart.ai/v1`

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
        "APIMART_API_KEY": "your-key"
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
- 增加更多 ApiMart 模型的独立工具
- 增加集成测试
