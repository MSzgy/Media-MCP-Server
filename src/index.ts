import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { appEnv } from "./config/env.js";
import { ApiMartVideoProvider } from "./providers/apimart-video-provider.js";
import { MediaService } from "./services/media-service.js";

// ── helpers ──────────────────────────────────────────────────────────

function createMediaService() {
  return new MediaService([
    new ApiMartVideoProvider(appEnv)
  ]);
}

const apiMartImageFields = {
  prompt: z.string().min(1).describe("Required text prompt. Supports English and Chinese for ApiMart image models; describe subject, style, composition, and constraints clearly."),
  size: z.string().optional().describe("Output aspect ratio, resolution keyword, or pixel size depending on the model. Common ratios: '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'. GPT Image 2 also accepts 'auto' and pixel strings such as '3840x2160'. Wan2.7 also accepts resolution keywords like '1K', '2K', '4K'."),
  resolution: z.string().optional().describe("Output resolution tier. Gemini/Z/Wan docs use uppercase values such as '0.5K', '1K', '2K', '4K'; GPT Image 2 docs use lowercase '1k', '2k', '4k'."),
  count: z.number().int().min(1).max(4).optional().describe("Number of images to generate. Sent to ApiMart as 'n'. Most models support 1-4, but some tool schemas narrow this range when the model is stricter."),
  imageUrls: z.array(z.string()).optional().describe("Reference images for image-to-image, editing, or style/character consistency. Sent as 'image_urls'. Use public HTTP/HTTPS URLs; for local files, call upload_apimart_image first. ApiMart upload URLs are valid for 72 hours."),
  officialFallback: z.boolean().optional().describe("ApiMart official-channel fallback. Sent as 'official_fallback'. Supported by Gemini 3.x and gpt-image-2 standard; do not use when directly calling an official-channel model."),
  googleSearch: z.boolean().optional().describe("Gemini 3.1 Flash only. Enable Google text search enhancement for real-world information. Sent as 'google_search'."),
  googleImageSearch: z.boolean().optional().describe("Gemini 3.1 Flash only. Enable Google image search enhancement. Sent as 'google_image_search' and should be used together with googleSearch=true."),
  quality: z.enum(["auto", "low", "medium", "high"]).optional().describe("GPT Image 2 Official only. Image quality: 'auto', 'low', 'medium', or 'high'. Higher quality is slower and more expensive."),
  background: z.enum(["auto", "opaque", "transparent"]).optional().describe("GPT Image 2 Official only. Background mode: 'auto', 'opaque', or 'transparent'. ApiMart notes transparent is silently downgraded for gpt-image-2-official."),
  moderation: z.enum(["auto", "low"]).optional().describe("GPT Image 2 Official only. Moderation strength: 'auto' for default moderation or 'low' for more lenient moderation."),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional().describe("GPT Image 2 Official only. Output file format. Sent as 'output_format'. Use 'jpeg' or 'webp' when outputCompression is needed."),
  outputCompression: z.number().int().min(0).max(100).optional().describe("GPT Image 2 Official only. Compression level from 0 to 100. Sent as 'output_compression' and only affects jpeg/webp outputs."),
  maskUrl: z.string().optional().describe("GPT Image 2 Official only. Mask image URL for inpainting. Sent as 'mask_url' and must be used with imageUrls; mask dimensions should match the first reference image."),
  promptExtend: z.boolean().optional().describe("Z Image Turbo only. Enable smart prompt rewriting for better results at higher cost. Sent as 'prompt_extend'."),
  negativePrompt: z.string().optional().describe("Wan2.7 only. Negative prompt describing elements to avoid, such as 'blurry, distorted, low quality'. Sent as 'negative_prompt'."),
  watermark: z.boolean().optional().describe("Wan2.7 only. Add an AI-generated watermark to the bottom-right corner. Sent as 'watermark'."),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Wan2.7 only. Random seed in range 0-2147483647 for more reproducible outputs."),
  thinkingMode: z.boolean().optional().describe("Wan2.7 only. Enhanced reasoning mode for image quality, usually slower. Sent as 'thinking_mode'. Ignored in sequential mode or when image input is provided."),
  enableSequential: z.boolean().optional().describe("Wan2.7 only. Sequential image generation for coherent series/storyboards. Sent as 'enable_sequential'. Supports up to 12 outputs; 4K is not supported in sequential mode."),
  bboxList: z.array(z.unknown()).optional().describe("Wan2.7 only. Bounding boxes for targeted editing. Sent as 'bbox_list'. Shape: one entry per input image, e.g. [[], [[989, 515, 1138, 681]]]."),
  colorPalette: z.array(z.object({
    hex: z.string().describe("Hex color value, e.g. '#C2D1E6'."),
    ratio: z.string().describe("Color ratio percentage, e.g. '23.51%'.")
  })).min(3).max(10).optional().describe("Wan2.7 only. Custom color theme for standard mode. Sent as 'color_palette'. Provide 3-10 entries; ratios should sum to 100.00%. Ignored in sequential mode."),
  input: z.record(z.unknown()).optional().describe("Escape hatch for ApiMart model-specific parameters not yet modeled by this server. Values are merged into the request body after named fields, so they can override generated fields if necessary.")
};

function pickImageFields<T extends keyof typeof apiMartImageFields>(fields: readonly T[]) {
  return Object.fromEntries(fields.map((field) => [field, apiMartImageFields[field]])) as Pick<typeof apiMartImageFields, T>;
}

function createApiMartImageHandler(mediaService: MediaService, model: string) {
  return async (args: {
    prompt: string;
    size?: string;
    resolution?: string;
    count?: number;
    imageUrls?: string[];
    officialFallback?: boolean;
    googleSearch?: boolean;
    googleImageSearch?: boolean;
    quality?: string;
    background?: string;
    moderation?: string;
    outputFormat?: "png" | "jpeg" | "webp";
    outputCompression?: number;
    maskUrl?: string;
    promptExtend?: boolean;
    negativePrompt?: string;
    watermark?: boolean;
    seed?: number;
    thinkingMode?: boolean;
    enableSequential?: boolean;
    bboxList?: unknown[];
    colorPalette?: Array<{ hex: string; ratio: string }>;
    input?: Record<string, unknown>;
  }) => {
    try {
      return toToolResult(await mediaService.generateImage({
        provider: "apimart",
        model,
        ...args
      }));
    } catch (err: any) {
      const cause = err.cause ? ` (Cause: ${err.cause})` : "";
      const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
      return toToolResult(`Generation Failed: ${msg}${cause}`, true);
    }
  };
}

const apiMartVideoFields = {
  prompt: z.string().min(1).describe("Video prompt. Describe subject, action, camera movement, style, and constraints. Some I2V/edit tools allow omitting it, but it is recommended."),
  duration: z.number().int().positive().optional().describe("Video duration in seconds. Allowed values depend on the model."),
  size: z.string().optional().describe("Video aspect ratio for models that use ApiMart field 'size'. Examples: '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'."),
  aspectRatio: z.string().optional().describe("Video aspect ratio for models that use ApiMart field 'aspect_ratio'. Examples: '16:9', '9:16', '1:1', 'landscape', 'portrait'."),
  resolution: z.string().optional().describe("Video resolution. Examples: '480p', '720p', '1080p', '1024p', '4k', '4K', '720P', '1080P'. Use the casing from the target model docs."),
  imageUrls: z.array(z.string()).optional().describe("Reference image URLs. Sent as 'image_urls'. Use public HTTP/HTTPS URLs; for local files, call upload_apimart_image first. ApiMart upload URLs are valid for 72 hours."),
  imageWithRoles: z.array(z.unknown()).optional().describe("Role-tagged images. Sent as 'image_with_roles'. Common shape: [{ url, role }], where role can be 'first_frame', 'last_frame', or 'reference_image' depending on model."),
  videoUrls: z.array(z.string()).optional().describe("Reference/source videos. Sent as 'video_urls'. Used for Seedance reference-video, Wan continuation/R2V, and Wan video edit."),
  audioUrls: z.array(z.string()).optional().describe("Reference audio URLs. Sent as 'audio_urls'. Seedance 2.0 supports up to 3 audio references in compatible modes."),
  audioUrl: z.string().optional().describe("Single custom audio URL. Sent as 'audio_url'. Used by Wan models for BGM or driving audio."),
  firstFrameImage: z.string().optional().describe("First frame image URL. Sent as 'first_frame_image'. Used by Veo official and HappyHorse I2V."),
  lastFrameImage: z.string().optional().describe("Last frame image URL. Sent as 'last_frame_image'. Used with firstFrameImage for first/last frame control."),
  negativePrompt: z.string().optional().describe("Negative prompt. Sent as 'negative_prompt'. Use to exclude blur, distortion, watermarks, text, and other unwanted content."),
  seed: z.number().int().min(0).optional().describe("Random seed for more reproducible outputs. Model-specific max values may apply."),
  generateAudio: z.boolean().optional().describe("Generate audio track. Sent as 'generate_audio'. Used by Seedance 2.0 and Veo official."),
  audio: z.boolean().optional().describe("Automatic audio flag. Sent as 'audio'. Used by Wan2.6 and Kling; model-specific mode restrictions apply."),
  returnLastFrame: z.boolean().optional().describe("Seedance 2.0 only. Return the generated video's last frame for continuous generation. Sent as 'return_last_frame'."),
  tools: z.array(z.unknown()).optional().describe("Seedance 2.0 enhancement tools. Example: [{ type: 'web_search' }]."),
  generationType: z.enum(["frame", "reference"]).optional().describe("Veo 3.1 only. Sent as 'generation_type'. 'frame' uses start/end frames; 'reference' uses reference images."),
  enableGif: z.boolean().optional().describe("Veo 3.1 only. Sent as 'enable_gif'. GIF output cannot be combined with 1080p/4k."),
  officialFallback: z.boolean().optional().describe("Veo 3.1 non-official only. Sent as 'official_fallback'."),
  raw: z.boolean().optional().describe("Veo remix only. Return only the extended segment instead of the combined video. Sent as 'raw'."),
  sourceTaskId: z.string().optional().describe("Veo remix only. Original completed task_id to extend; used in path /videos/{task_id}/remix."),
  quality: z.string().optional().describe("Grok Imagine video quality. Common values: '480p', '720p'."),
  mode: z.enum(["std", "pro"]).optional().describe("Kling 2.6 mode. 'std' is 720P silent video; 'pro' is 1080P and supports audio."),
  sampleCount: z.number().int().min(1).max(4).optional().describe("Veo official sample count. Sent as 'sample_count'. Recommended value is 1."),
  personGeneration: z.enum(["allow_adult", "disallow"]).optional().describe("Veo official person generation policy. Sent as 'person_generation'."),
  resizeMode: z.enum(["pad", "crop"]).optional().describe("Veo official image resize strategy for I2V. Sent as 'resize_mode'."),
  enhancePrompt: z.boolean().optional().describe("Veo official prompt enhancement. Sent as 'enhance_prompt'. ApiMart notes false can error; omit unless setting true."),
  promptExtend: z.boolean().optional().describe("Wan prompt rewriting. Sent as 'prompt_extend'. Improves short prompts but may add latency."),
  watermark: z.boolean().optional().describe("Add AI-generated watermark where supported. Sent as 'watermark'."),
  shotType: z.enum(["single", "multi"]).optional().describe("Wan2.6 shot type. Sent as 'shot_type'. Requires promptExtend=true."),
  template: z.string().optional().describe("Wan2.6 effect template for image-to-video effects mode, e.g. 'squish', 'rotation', 'poke', 'inflate', 'dissolve', 'melt', 'icecream', 'flying'."),
  videoUrl: z.string().optional().describe("HappyHorse source video URL for EDIT mode. Sent as 'video_url'."),
  audioSetting: z.enum(["auto", "origin"]).optional().describe("HappyHorse or Wan video edit audio handling. 'auto' regenerates audio; 'origin' keeps source audio."),
  metadata: z.record(z.unknown()).optional().describe("Additional metadata object. Wan video edit supports metadata.audio_setting."),
  callbackUrl: z.string().optional().describe("Seedance real-avatar Step 1 callback URL. Sent as 'callback_url'."),
  projectName: z.string().optional().describe("Seedance avatar project name. Sent as 'project_name'; default is usually 'default'."),
  group: z.record(z.unknown()).optional().describe("Seedance private-avatar group object when creating a new asset group. Shape: { name, description }."),
  groupId: z.string().optional().describe("Seedance avatar existing group ID. Sent as 'group_id'."),
  assetType: z.enum(["Image", "Video", "Audio"]).optional().describe("Seedance avatar asset type. Sent as 'asset_type'."),
  assets: z.array(z.object({
    url: z.string().describe("Publicly accessible asset URL."),
    name: z.string().describe("Asset name.")
  })).max(20).optional().describe("Seedance avatar asset list. Supports up to 20 assets for private-avatar."),
  url: z.string().optional().describe("Seedance private-avatar single asset shorthand URL."),
  name: z.string().optional().describe("Seedance private-avatar single asset shorthand name."),
  bytedToken: z.string().optional().describe("Seedance real-avatar Step 2 token obtained from Step 1 task status. Sent as 'byted_token'."),
  waitSeconds: z.number().int().min(0).max(300).optional().describe("Optional polling time. Use 0 to return immediately after submission."),
  input: z.record(z.unknown()).optional().describe("Escape hatch for ApiMart video parameters not yet modeled. Merged last, so it can override named fields.")
};

function pickVideoFields<T extends keyof typeof apiMartVideoFields>(fields: readonly T[]) {
  return Object.fromEntries(fields.map((field) => [field, apiMartVideoFields[field]])) as Pick<typeof apiMartVideoFields, T>;
}

function createApiMartVideoHandler(mediaService: MediaService, model: string, defaults: Record<string, unknown> = {}) {
  return async (args: Record<string, unknown>) => {
    try {
      return toToolResult(await mediaService.generateVideo({
        provider: "apimart",
        model,
        ...defaults,
        ...args
      }));
    } catch (err: any) {
      const cause = err.cause ? ` (Cause: ${err.cause})` : "";
      const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
      return toToolResult(`Generation Failed: ${msg}${cause}`, true);
    }
  };
}

function createMcpServer() {
  const server = new McpServer({
    name: appEnv.serverName,
    version: "0.1.0"
  });

  const mediaService = createMediaService();

  server.tool(
    "list_media_providers",
    "List all available media generation providers and their capabilities/status.",
    async () => toToolResult(mediaService.listProviders())
  );

  server.tool(
    "upload_apimart_image",
    "Upload a local image file to ApiMart and get a temporary public URL for image/video reference parameters.",
    {
      filePath: z.string().min(1).describe("Absolute or project-relative path to a JPEG, PNG, WebP, or GIF image. Maximum file size is 20MB."),
      provider: z.string().optional().describe("Provider to use. Only 'apimart' is configured; omit unless you need to be explicit.")
    },
    async (args) => {
      try {
        return toToolResult(await mediaService.uploadImage(args.provider ?? "apimart", args.filePath));
      } catch (err: any) {
        const cause = err.cause ? ` (Cause: ${err.cause})` : "";
        const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
        return toToolResult(`Upload Failed: ${msg}${cause}`, true);
      }
    }
  );

  server.tool(
    "generate_image_apimart_gemini_3_1_flash_image_preview",
    "Generate an image with ApiMart model gemini-3.1-flash-image-preview.",
    pickImageFields([
      "prompt",
      "size",
      "resolution",
      "count",
      "officialFallback",
      "imageUrls",
      "googleSearch",
      "googleImageSearch",
      "input"
    ]),
    createApiMartImageHandler(mediaService, "gemini-3.1-flash-image-preview")
  );

  server.tool(
    "generate_image_apimart_gemini_3_pro_image_preview",
    "Generate an image with ApiMart model gemini-3-pro-image-preview.",
    pickImageFields([
      "prompt",
      "size",
      "count",
      "resolution",
      "officialFallback",
      "imageUrls",
      "input"
    ]),
    createApiMartImageHandler(mediaService, "gemini-3-pro-image-preview")
  );

  server.tool(
    "generate_image_apimart_imagen_4_0_apimart",
    "Generate an image with ApiMart model imagen-4.0-apimart.",
    {
      ...pickImageFields([
        "prompt",
        "size",
        "input"
      ]),
      count: z.number().int().min(1).max(1).optional().describe("Imagen 4.0 ApiMart only supports one image per request. Sent to ApiMart as 'n'.")
    },
    createApiMartImageHandler(mediaService, "imagen-4.0-apimart")
  );

  server.tool(
    "generate_image_apimart_gpt_image_2",
    "Generate an image with ApiMart model gpt-image-2.",
    {
      ...pickImageFields([
        "prompt",
        "size",
        "resolution",
        "imageUrls",
        "officialFallback",
        "input"
      ]),
      count: z.number().int().min(1).max(1).optional().describe("ApiMart gpt-image-2 standard only supports one image per request. Sent to ApiMart as 'n'.")
    },
    createApiMartImageHandler(mediaService, "gpt-image-2")
  );

  server.tool(
    "generate_image_apimart_gpt_image_2_official",
    "Generate an image with ApiMart model gpt-image-2-official.",
    pickImageFields([
      "prompt",
      "size",
      "resolution",
      "quality",
      "background",
      "moderation",
      "outputFormat",
      "outputCompression",
      "count",
      "imageUrls",
      "maskUrl",
      "input"
    ]),
    createApiMartImageHandler(mediaService, "gpt-image-2-official")
  );

  server.tool(
    "generate_image_apimart_z_image_turbo",
    "Generate an image with ApiMart model z-image-turbo.",
    {
      ...pickImageFields([
        "size",
        "resolution",
        "promptExtend",
        "input"
      ]),
      prompt: z.string().min(1).max(800).describe("Required text prompt for Z Image Turbo, up to 800 characters. Supports Chinese and English.")
    },
    createApiMartImageHandler(mediaService, "z-image-turbo")
  );

  server.tool(
    "generate_image_apimart_wan2_7_image_pro",
    "Generate an image with ApiMart model wan2.7-image-pro.",
    {
      ...pickImageFields([
        "prompt",
        "imageUrls",
        "size",
        "resolution",
        "negativePrompt",
        "watermark",
        "seed",
        "thinkingMode",
        "enableSequential",
        "bboxList",
        "colorPalette",
        "input"
      ]),
      count: z.number().int().min(1).max(12).optional().describe("Wan2.7 output count. Standard mode supports 1-4; sequential mode with enableSequential=true supports 1-12. Sent to ApiMart as 'n'.")
    },
    createApiMartImageHandler(mediaService, "wan2.7-image-pro")
  );

  server.tool(
    "generate_video_apimart_doubao_seedance_2_0",
    "Generate a video with ApiMart model doubao-seedance-2.0.",
    pickVideoFields([
      "prompt",
      "duration",
      "size",
      "resolution",
      "seed",
      "generateAudio",
      "returnLastFrame",
      "tools",
      "imageUrls",
      "imageWithRoles",
      "videoUrls",
      "audioUrls",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "doubao-seedance-2.0")
  );

  server.tool(
    "generate_video_apimart_doubao_seedance_2_0_private_avatar",
    "Submit Seedance 2.0 private-domain virtual avatar assets for review.",
    {
      ...pickVideoFields([
        "group",
        "groupId",
        "projectName",
        "assetType",
        "assets",
        "url",
        "name",
        "waitSeconds",
        "input"
      ])
    },
    createApiMartVideoHandler(mediaService, "doubao-seedance-2.0-private-avatar", {
      endpointPath: "/seedance2/private-avatar",
      omitModel: true
    })
  );

  server.tool(
    "generate_video_apimart_doubao_seedance_2_0_real_avatar",
    "Create/query/submit Seedance 2.0 real-person avatar assets.",
    {
      ...pickVideoFields([
        "callbackUrl",
        "bytedToken",
        "groupId",
        "projectName",
        "assetType",
        "assets",
        "waitSeconds",
        "input"
      ])
    },
    createApiMartVideoHandler(mediaService, "doubao-seedance-2.0-real-avatar", {
      endpointPath: "/seedance2/real-avatar",
      omitModel: true
    })
  );

  server.tool(
    "generate_video_apimart_sora_2",
    "Generate a video with ApiMart model sora-2.",
    pickVideoFields([
      "prompt",
      "duration",
      "resolution",
      "aspectRatio",
      "imageUrls",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "sora-2")
  );

  server.tool(
    "generate_video_apimart_veo3_1_fast",
    "Generate a video with ApiMart model veo3.1-fast.",
    pickVideoFields([
      "prompt",
      "duration",
      "aspectRatio",
      "generationType",
      "imageUrls",
      "resolution",
      "enableGif",
      "officialFallback",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "veo3.1-fast")
  );

  server.tool(
    "generate_video_apimart_veo3_1_fast_remix",
    "Remix/extend a completed ApiMart veo3.1-fast video task.",
    {
      ...pickVideoFields([
        "sourceTaskId",
        "prompt",
        "raw",
        "aspectRatio",
        "resolution",
        "waitSeconds",
        "input"
      ]),
      sourceTaskId: z.string().min(1).describe("Required original completed veo3.1-fast task_id. Used in /videos/{task_id}/remix.")
    },
    createApiMartVideoHandler(mediaService, "veo3.1-fast")
  );

  server.tool(
    "generate_video_apimart_veo3_1_fast_official",
    "Generate a video with ApiMart model veo3.1-fast-official.",
    pickVideoFields([
      "prompt",
      "negativePrompt",
      "duration",
      "aspectRatio",
      "resolution",
      "firstFrameImage",
      "lastFrameImage",
      "seed",
      "sampleCount",
      "generateAudio",
      "personGeneration",
      "resizeMode",
      "enhancePrompt",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "veo3.1-fast-official")
  );

  server.tool(
    "generate_video_apimart_happyhorse_1_0",
    "Generate or edit video with ApiMart model happyhorse-1.0.",
    pickVideoFields([
      "prompt",
      "firstFrameImage",
      "imageUrls",
      "videoUrl",
      "audioSetting",
      "resolution",
      "duration",
      "size",
      "watermark",
      "seed",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "happyhorse-1.0")
  );

  server.tool(
    "generate_video_apimart_wan2_7",
    "Generate a video with ApiMart model wan2.7.",
    pickVideoFields([
      "prompt",
      "imageUrls",
      "imageWithRoles",
      "videoUrls",
      "negativePrompt",
      "resolution",
      "duration",
      "size",
      "audioUrl",
      "promptExtend",
      "watermark",
      "seed",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "wan2.7")
  );

  server.tool(
    "generate_video_apimart_wan2_7_r2v",
    "Generate reference-to-video with ApiMart model wan2.7-r2v.",
    pickVideoFields([
      "prompt",
      "imageWithRoles",
      "videoUrls",
      "negativePrompt",
      "resolution",
      "duration",
      "size",
      "promptExtend",
      "watermark",
      "seed",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "wan2.7-r2v")
  );

  server.tool(
    "generate_video_apimart_wan2_7_videoedit",
    "Edit a source video with ApiMart model wan2.7-videoedit.",
    pickVideoFields([
      "videoUrls",
      "prompt",
      "negativePrompt",
      "imageUrls",
      "resolution",
      "duration",
      "size",
      "promptExtend",
      "watermark",
      "seed",
      "metadata",
      "audioSetting",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "wan2.7-videoedit")
  );

  server.tool(
    "generate_video_apimart_wan2_6",
    "Generate a video with ApiMart model wan2.6.",
    pickVideoFields([
      "prompt",
      "imageUrls",
      "negativePrompt",
      "aspectRatio",
      "resolution",
      "duration",
      "seed",
      "promptExtend",
      "audio",
      "audioUrl",
      "shotType",
      "watermark",
      "template",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "wan2.6")
  );

  server.tool(
    "generate_video_apimart_wan2_6_i2v_flash",
    "Generate image-to-video with ApiMart model wan2.6-i2v-flash.",
    {
      ...pickVideoFields([
        "prompt",
        "negativePrompt",
        "resolution",
        "duration",
        "audio",
        "audioUrl",
        "promptExtend",
        "shotType",
        "seed",
        "watermark",
        "waitSeconds",
        "input"
      ]),
      imageUrls: z.array(z.string()).min(1).max(1).describe("Required first-frame image URL or base64 data URI. Sent as 'image_urls'; exactly one image is supported.")
    },
    createApiMartVideoHandler(mediaService, "wan2.6-i2v-flash")
  );

  server.tool(
    "generate_video_apimart_kling_v2_6",
    "Generate a video with ApiMart model kling-v2-6.",
    pickVideoFields([
      "prompt",
      "mode",
      "duration",
      "aspectRatio",
      "negativePrompt",
      "imageUrls",
      "audio",
      "watermark",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "kling-v2-6")
  );

  server.tool(
    "generate_video_apimart_grok_imagine_1_0_video_apimart",
    "Generate a video with ApiMart model grok-imagine-1.0-video-apimart.",
    pickVideoFields([
      "prompt",
      "size",
      "duration",
      "quality",
      "imageUrls",
      "waitSeconds",
      "input"
    ]),
    createApiMartVideoHandler(mediaService, "grok-imagine-1.0-video-apimart")
  );

  server.tool(
    "generate_video",
    "Generate a video from a text prompt and optionally an image with ApiMart. Prefer the per-model generate_video_apimart_<model> tools for clearer parameters.",
    {
      prompt: z.string().min(1).describe("The text prompt describing the video"),
      provider: z.string().optional().describe("The provider to use. Only 'apimart' is configured."),
      model: z.string().optional().describe("The model to use. For apimart, you can pass 'sora-2', 'veo3.1-fast', etc."),
      version: z.string().optional(),
      image: z.string().optional().describe("URL of an initial image to animate (supported by some models)"),
      aspectRatio: z.string().optional().describe("Aspect ratio, e.g., '16:9', '9:16'"),
      duration: z.number().positive().optional().describe("Duration of the video in seconds"),
      waitSeconds: z.number().int().min(5).max(300).optional(),
      input: z.record(z.unknown()).optional().describe("Extra model-specific parameters")
    },
    async (args) => {
      try {
        return toToolResult(await mediaService.generateVideo(args));
      } catch (err: any) {
        const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
        return toToolResult(`Generation Failed: ${msg}`, true);
      }
    }
  );

  server.tool(
    "generate_audio",
    "Generate audio/speech from text with ApiMart. Models like 'gpt-4o-mini-tts' can be used.",
    {
      prompt: z.string().min(1).describe("The text to synthesize into speech"),
      provider: z.string().optional().describe("The provider to use. Only 'apimart' is configured."),
      model: z.string().optional().describe("The TTS model to use"),
      voiceId: z.string().optional().describe("The voice ID to use (e.g., 'alloy' for apimart)"),
      outputFormat: z.string().optional().describe("Output format, e.g., 'mp3', 'opus'"),
      languageCode: z.string().optional(),
      input: z.record(z.unknown()).optional().describe("Extra model-specific parameters")
    },
    async (args) => {
      try {
        return toToolResult(await mediaService.generateAudio(args));
      } catch (err: any) {
        const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
        return toToolResult(`Generation Failed: ${msg}`, true);
      }
    }
  );

  server.tool(
    "check_task_status",
    "Check the status of a long-running media generation task using its job ID.",
    {
      provider: z.string().describe("The provider used for generation. Only 'apimart' is configured."),
      jobId: z.string().describe("The task/job ID returned from the generation tool")
    },
    async (args) => {
      try {
        return toToolResult(await mediaService.checkTaskStatus(args.provider, args.jobId));
      } catch (err: any) {
        const cause = err.cause ? ` (Cause: ${err.cause})` : "";
        const msg = err.payload ? JSON.stringify(err.payload) : (err.message || String(err));
        return toToolResult(`Check Status Failed: ${msg}${cause}`, true);
      }
    }
  );

  server.tool(
    "check_apimart_balance",
    "Check the user's ApiMart account balance and quota.",
    async () => {
      if (!appEnv.apiMartApiKey) {
        return toToolResult({ error: "APIMART_API_KEY is not configured." });
      }
      try {
        const url = `${appEnv.apiMartBaseUrl}/user/balance`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${appEnv.apiMartApiKey}`
          }
        });
        if (!response.ok) {
          return toToolResult({ error: `ApiMart request failed with status ${response.status}` });
        }
        const data = await response.json();
        return toToolResult(data);
      } catch (err: any) {
        return toToolResult({ error: err.message || "Unknown error occurred" });
      }
    }
  );

  return server;
}

function toToolResult(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
      }
    ]
  };
}

// ── Streamable HTTP transport ────────────────────────────────────────

const app = express();
app.use(express.json());

// Debug logging for MCP requests
app.use("/mcp", (req, res, next) => {
  console.log(`\n--- [MCP Request] ${req.method} ${req.originalUrl} ---`);
  console.log("[Headers]:", JSON.stringify(req.headers, null, 2));
  console.log("[Payload]:", JSON.stringify(req.body, null, 2));

  const originalSend = res.send;
  res.send = function (body) {
    if (res.statusCode >= 400) {
      console.log(`[MCP Response Error] Status: ${res.statusCode}`);
      console.log("[Response Body]:", body);
    } else {
      console.log(`[MCP Response] Status: ${res.statusCode}`);
    }
    return originalSend.call(this, body);
  };
  next();
});

// Token Authentication Middleware for MCP endpoints
app.use("/mcp", (req, res, next) => {
  if (appEnv.mcpAuthToken) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : (req.query.token as string);

    if (!token || token !== appEnv.mcpAuthToken) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
      return;
    }
  }
  next();
});

// Track transports by session ID for session reuse
const transports = new Map<string, StreamableHTTPServerTransport>();

app.all("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        }
      });

      transport.onclose = () => {
        if (transport!.sessionId) {
          transports.delete(transport!.sessionId);
        }
      };

      const server = createMcpServer();
      server.server.onerror = (err) => console.error("[Server Error]:", err);
      await server.connect(transport);
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[HandleRequest Error]:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: String(error) });
      }
    }
  } catch (globalError) {
    console.error("[Global Route Error]:", globalError);
    if (!res.headersSent) {
      res.status(500).json({ error: String(globalError), stack: (globalError as Error).stack });
    }
  }
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(appEnv.mcpPort, () => {
  console.log(`MCP Server listening on http://localhost:${appEnv.mcpPort}/mcp`);
});
