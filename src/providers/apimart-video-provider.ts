import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AppEnv } from "../config/env.js";
import { ApiMartUsageStore } from "../config/apimart-usage-store.js";
import { fetchJson, fetchBinary } from "../lib/http.js";
import { saveBinaryArtifact, extensionFromContentType } from "../lib/files.js";
import {
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability,
  VideoGenerationParams,
  AudioGenerationParams,
  ImageGenerationParams,
  MediaCapability
} from "./base.js";

/**
 * Supported ApiMart video models.
 *
 * | Model      | Value                      | Notable Params              |
 * |------------|----------------------------|-----------------------------|
 * | Seedance   | doubao-seedance-1-5-pro    | resolution, audio           |
 * | Sora 2     | sora-2                     | image_urls                  |
 * | Veo 3.1    | veo3.1-fast                | image_urls                  |
 * | Wan 2.6    | wan2.6                     | resolution                  |
 * | Kling v3   | kling-v3-omni              | image_urls, mode            |
 */
export const APIMART_VIDEO_MODELS = [
  "doubao-seedance-2.0",
  "sora-2",
  "veo3.1-fast",
  "veo3.1-fast-official",
  "happyhorse-1.0",
  "wan2.7",
  "wan2.7-r2v",
  "wan2.7-videoedit",
  "wan2.6",
  "wan2.6-i2v-flash",
  "kling-v2-6",
  "grok-imagine-1.0-video-apimart"
] as const;

export const APIMART_IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "imagen-4.0-apimart",
  "gpt-image-2",
  "gpt-image-2-official",
  "z-image-turbo",
  "wan2.7-image-pro"
] as const;

const DEFAULT_VIDEO_MODEL = "doubao-seedance-2.0";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const MAX_VIDEO_WAIT_SECONDS = 300;
const MAX_IMAGE_WAIT_SECONDS = 180;

interface ApiMartGenerationResponse {
  code: number;
  data: Array<{
    status: string;
    task_id: string;
  }> | {
    id?: string;
    task_id?: string;
    status?: string;
    progress?: number;
    [key: string]: unknown;
  };
}

interface ApiMartTaskResponse {
  code: number;
  data: {
    id: string;
    status: string;
    progress?: number;
    result?: {
      videos?: Array<{
        url?: string[];
        expires_at?: number;
      }>;
    };
    actual_time?: number;
    completed?: number;
    created?: number;
    estimated_time?: number;
  };
}

interface ApiMartUploadImageResponse {
  url: string;
  filename: string;
  content_type: string;
  bytes: number;
  created_at: number;
}

export class ApiMartVideoProvider implements MediaProvider {
  readonly name = "apimart";
  readonly capabilities = ["video", "image", "audio"] as const;

  constructor(
    private readonly env: AppEnv,
    private readonly usageStore?: ApiMartUsageStore
  ) { }

  getAvailability(): ProviderAvailability {
    return this.env.apiMartApiKey
      ? { configured: true, missingEnv: [] }
      : { configured: false, missingEnv: ["APIMART_API_KEY"] };
  }

  async uploadImage(filePath: string) {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }
    if (stats.size > 20 * 1024 * 1024) {
      throw new Error("ApiMart image upload limit is 20MB.");
    }

    const filename = path.basename(filePath);
    const contentType = contentTypeFromImagePath(filename);
    if (!contentType) {
      throw new Error("Unsupported image format. ApiMart supports JPEG, PNG, WebP, and GIF.");
    }

    const buffer = await readFile(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: contentType }), filename);

    const response = await this.fetchJsonWithUsage<ApiMartUploadImageResponse>({
      endpoint: "/uploads/images",
      capability: "upload",
      method: "POST",
      body: formData,
      timeoutMs: 120_000
    });

    return {
      provider: this.name,
      url: response.url,
      filename: response.filename,
      contentType: response.content_type,
      bytes: response.bytes,
      createdAt: response.created_at
    };
  }

  async generateVideo(params: VideoGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? DEFAULT_VIDEO_MODEL;
    const extra = params.input ?? {};

    const body: Record<string, unknown> = {
      ...(params.omitModel ? {} : { model }),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      ...(params.duration != null ? { duration: params.duration } : {}),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.size ? { size: params.size } : {}),
      ...(params.quality ? { quality: params.quality } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.image ? { image_urls: [params.image] } : {}),
      ...(params.imageUrls ? { image_urls: params.imageUrls } : {}),
      ...(params.imageWithRoles ? { image_with_roles: params.imageWithRoles } : {}),
      ...(params.videoUrls ? { video_urls: params.videoUrls } : {}),
      ...(params.audioUrls ? { audio_urls: params.audioUrls } : {}),
      ...(params.audioUrl ? { audio_url: params.audioUrl } : {}),
      ...(params.firstFrameImage ? { first_frame_image: params.firstFrameImage } : {}),
      ...(params.lastFrameImage ? { last_frame_image: params.lastFrameImage } : {}),
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(params.generateAudio != null ? { generate_audio: params.generateAudio } : {}),
      ...(params.audio != null ? { audio: params.audio } : {}),
      ...(params.returnLastFrame != null ? { return_last_frame: params.returnLastFrame } : {}),
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.generationType ? { generation_type: params.generationType } : {}),
      ...(params.enableGif != null ? { enable_gif: params.enableGif } : {}),
      ...(params.officialFallback != null ? { official_fallback: params.officialFallback } : {}),
      ...(params.raw != null ? { raw: params.raw } : {}),
      ...(params.sampleCount != null ? { sample_count: params.sampleCount } : {}),
      ...(params.personGeneration ? { person_generation: params.personGeneration } : {}),
      ...(params.resizeMode ? { resize_mode: params.resizeMode } : {}),
      ...(params.enhancePrompt != null ? { enhance_prompt: params.enhancePrompt } : {}),
      ...(params.promptExtend != null ? { prompt_extend: params.promptExtend } : {}),
      ...(params.watermark != null ? { watermark: params.watermark } : {}),
      ...(params.shotType ? { shot_type: params.shotType } : {}),
      ...(params.template ? { template: params.template } : {}),
      ...(params.videoUrl ? { video_url: params.videoUrl } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(params.audioSetting ? { audio_setting: params.audioSetting } : {}),
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
      ...(params.projectName ? { project_name: params.projectName } : {}),
      ...(params.group ? { group: params.group } : {}),
      ...(params.groupId ? { group_id: params.groupId } : {}),
      ...(params.assetType ? { asset_type: params.assetType } : {}),
      ...(params.assets ? { assets: params.assets } : {}),
      ...(params.url ? { url: params.url } : {}),
      ...(params.name ? { name: params.name } : {}),
      ...(params.bytedToken ? { byted_token: params.bytedToken } : {}),
      ...extra
    };

    const endpointPath = params.sourceTaskId
      ? `/videos/${params.sourceTaskId}/remix`
      : (params.endpointPath ?? "/videos/generations");

    const response = await this.fetchJsonWithUsage<ApiMartGenerationResponse>({
      endpoint: endpointPath,
      capability: "video",
      model,
      method: "POST",
      body: JSON.stringify(body),
      contentType: "application/json"
    });

    const first = (Array.isArray(response.data) ? response.data[0] : response.data) as {
      id?: string;
      task_id?: string;
      status?: string;
    } | undefined;
    const taskId = first?.task_id ?? first?.id;
    if (!first || !taskId) {
      throw new Error("No task_id returned from ApiMart");
    }

    const maxWaitMs = normalizeWaitSeconds(params.waitSeconds, MAX_VIDEO_WAIT_SECONDS) * 1000;
    const startMs = Date.now();
    let taskStatus = first.status ?? "submitted";
    let finalUrl: string | undefined;

    // Poll the task endpoint
    while (taskStatus !== "completed" && taskStatus !== "failed") {
      const remainingMs = maxWaitMs - (Date.now() - startMs);
      if (remainingMs <= 0) {
        break; // timed out waiting
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, remainingMs))); // poll every 5s

      let pollResponse: ApiMartTaskResponse | undefined;
      try {
        pollResponse = await this.fetchJsonWithUsage<ApiMartTaskResponse>({
          endpoint: `/tasks/${taskId}`,
          endpointGroup: "/tasks/:taskId",
          capability: "status",
          model,
          method: "GET"
        });
      } catch (pollErr: any) {
        console.warn(`[ApiMart Polling] Warning: fetch failed for task ${taskId}:`, pollErr.message, pollErr.cause);
        continue;
      }

      taskStatus = pollResponse.data?.status ?? taskStatus;

      if (taskStatus === "completed") {
        const videos = pollResponse.data?.result?.videos;
        if (videos && videos.length > 0 && videos[0].url && videos[0].url.length > 0) {
          finalUrl = videos[0].url[0];
        }
      }
    }

    const assets = finalUrl ? [{ kind: "url" as const, url: finalUrl }] : [];

    return {
      provider: this.name,
      capability: "video",
      model,
      status: taskStatus,
      jobId: taskId,
      assets,
      metadata: {
        apiCode: response.code
      }
    };
  }

  async generateImage(params: ImageGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? DEFAULT_IMAGE_MODEL;
    const extra = params.input ?? {};

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      ...(params.size ? { size: params.size } : {}),
      ...(params.count != null ? { n: params.count } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.quality ? { quality: params.quality } : {}),
      ...(params.background ? { background: params.background } : {}),
      ...(params.moderation ? { moderation: params.moderation } : {}),
      ...(params.outputFormat ? { output_format: params.outputFormat } : {}),
      ...(params.outputCompression != null ? { output_compression: params.outputCompression } : {}),
      ...(params.imageUrls ? { image_urls: params.imageUrls } : {}),
      ...(params.maskUrl ? { mask_url: params.maskUrl } : {}),
      ...(params.officialFallback != null ? { official_fallback: params.officialFallback } : {}),
      ...(params.googleSearch != null ? { google_search: params.googleSearch } : {}),
      ...(params.googleImageSearch != null ? { google_image_search: params.googleImageSearch } : {}),
      ...(params.promptExtend != null ? { prompt_extend: params.promptExtend } : {}),
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
      ...(params.watermark != null ? { watermark: params.watermark } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(params.thinkingMode != null ? { thinking_mode: params.thinkingMode } : {}),
      ...(params.enableSequential != null ? { enable_sequential: params.enableSequential } : {}),
      ...(params.bboxList ? { bbox_list: params.bboxList } : {}),
      ...(params.colorPalette ? { color_palette: params.colorPalette } : {}),
      ...extra
    };

    const response = await this.fetchJsonWithUsage<ApiMartGenerationResponse>({
      endpoint: "/images/generations",
      capability: "image",
      model,
      method: "POST",
      body: JSON.stringify(body),
      contentType: "application/json"
    });

    const imageData = response.data as Array<{ status: string; task_id: string }> | undefined;
    const first = imageData?.[0];
    if (!first || !first.task_id) {
      throw new Error("No task_id returned from ApiMart");
    }

    const taskId = first.task_id;
    const maxWaitMs = MAX_IMAGE_WAIT_SECONDS * 1000;
    const startMs = Date.now();
    let taskStatus = first.status;
    let finalUrl: string | undefined;

    while (taskStatus !== "completed" && taskStatus !== "failed") {
      const remainingMs = maxWaitMs - (Date.now() - startMs);
      if (remainingMs <= 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, remainingMs)));

      let pollResponse: ApiMartTaskResponse | undefined;
      try {
        pollResponse = await this.fetchJsonWithUsage<ApiMartTaskResponse>({
          endpoint: `/tasks/${taskId}`,
          endpointGroup: "/tasks/:taskId",
          capability: "status",
          model,
          method: "GET"
        });
      } catch (pollErr: any) {
        console.warn(`[ApiMart Polling] Warning: fetch failed for task ${taskId}:`, pollErr.message, pollErr.cause);
        // On network failure or 5XX, wait 5s and try again without breaking the outer loop
        continue;
      }

      taskStatus = pollResponse.data?.status ?? taskStatus;

      if (taskStatus === "completed") {
        const result = pollResponse.data?.result as any;
        if (result?.images && result.images.length > 0 && result.images[0].url) {
          finalUrl = Array.isArray(result.images[0].url) ? result.images[0].url[0] : result.images[0].url;
        } else if (result?.image_urls && result.image_urls.length > 0) {
          finalUrl = result.image_urls[0];
        }
      }
    }

    const assets = finalUrl ? [{ kind: "url" as const, url: finalUrl }] : [];

    return {
      provider: this.name,
      capability: "image",
      model,
      status: taskStatus,
      jobId: taskId,
      assets,
      metadata: {
        apiCode: response.code
      }
    };
  }

  async generateAudio(params: AudioGenerationParams): Promise<MediaGenerationResult> {
    if ((params.model ?? "").toLowerCase() === "whisper-1" || params.filePath) {
      return this.transcribeAudio(params);
    }

    const model = params.model ?? "gpt-4o-mini-tts";
    const extra = params.input ?? {};
    const prompt = params.prompt?.trim();
    if (!prompt) {
      throw new Error("prompt is required for ApiMart TTS.");
    }

    const body: Record<string, unknown> = {
      model,
      input: prompt,
      voice: params.voiceId ?? "alloy",
      ...(params.outputFormat ? { response_format: params.outputFormat } : {}),
      ...(params.speed != null ? { speed: params.speed } : {}),
      ...extra
    };

    const { buffer, contentType } = await this.fetchBinaryWithUsage({
      endpoint: "/audio/speech",
      capability: "audio",
      model,
      method: "POST",
      body: JSON.stringify(body),
      contentType: "application/json"
    });

    const artifact = await saveBinaryArtifact({
      outputDir: this.env.outputDir,
      prefix: "audio",
      data: buffer,
      extension: extensionFromContentType(contentType, params.outputFormat ?? "mp3"),
      contentType: contentType ?? "audio/mpeg"
    });

    return {
      provider: this.name,
      capability: "audio",
      model,
      status: "completed",
      assets: [
        {
          kind: "file",
          path: artifact.path,
          contentType: artifact.contentType
        }
      ],
      metadata: {
        voiceId: params.voiceId ?? "alloy",
        outputFormat: params.outputFormat,
        speed: params.speed
      }
    };
  }

  async transcribeAudio(params: AudioGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? "whisper-1";
    const filePath = params.filePath ?? getString(params.input?.filePath);
    if (!filePath) {
      throw new Error("filePath is required for ApiMart Whisper transcription.");
    }

    const info = await stat(filePath);
    if (info.size > 25 * 1024 * 1024) {
      throw new Error("Audio file exceeds ApiMart Whisper 25 MB limit.");
    }

    const form = new FormData();
    const file = await readFile(filePath);
    form.set("file", new Blob([file], { type: contentTypeFromAudioPath(filePath) ?? "application/octet-stream" }), path.basename(filePath));
    form.set("model", model);
    const language = params.languageCode ?? getString(params.input?.language);
    if (language) {
      form.set("language", language);
    }
    if (params.prompt) {
      form.set("prompt", params.prompt);
    }
    const responseFormat = params.responseFormat ?? params.outputFormat ?? getString(params.input?.responseFormat) ?? "json";
    form.set("response_format", responseFormat);
    const temperature = params.temperature ?? getNumber(params.input?.temperature);
    if (temperature != null) {
      form.set("temperature", String(temperature));
    }

    const response = await this.fetchWithUsage({
      endpoint: "/audio/transcriptions",
      capability: "audio",
      model,
      method: "POST",
      body: form,
      timeoutMs: 120_000
    });

    const text = await response.text();
    const payload = responseFormat === "json" || responseFormat === "verbose_json"
      ? safeParseJson(text) ?? { text }
      : { text };

    if (!response.ok) {
      throw new Error(`ApiMart transcription failed with status ${response.status}: ${text}`);
    }

    return {
      provider: this.name,
      capability: "audio",
      model,
      status: "completed",
      assets: [],
      metadata: {
        responseFormat,
        language,
        filePath,
        bytes: info.size,
        transcription: payload
      }
    };
  }

  async checkTaskStatus(jobId: string): Promise<MediaGenerationResult> {
    const pollResponse = await this.fetchJsonWithUsage<ApiMartTaskResponse>({
      endpoint: `/tasks/${jobId}`,
      endpointGroup: "/tasks/:taskId",
      capability: "status",
      method: "GET"
    });

    const taskStatus = pollResponse.data?.status ?? "unknown";
    let finalUrl: string | undefined;
    let capability: MediaCapability = "video";

    if (taskStatus === "completed") {
      const result = pollResponse.data?.result as any;
      if (result?.videos && result.videos.length > 0 && result.videos[0].url && result.videos[0].url.length > 0) {
        finalUrl = result.videos[0].url[0];
      } else if (result?.images && result.images.length > 0 && result.images[0].url) {
        capability = "image";
        finalUrl = Array.isArray(result.images[0].url) ? result.images[0].url[0] : result.images[0].url;
      } else if (result?.image_urls && result.image_urls.length > 0) {
        capability = "image";
        finalUrl = result.image_urls[0];
      }
    }

    const assets = finalUrl ? [{ kind: "url" as const, url: finalUrl }] : [];

    return {
      provider: this.name,
      capability,
      status: taskStatus,
      jobId,
      assets,
      metadata: {
        apiCode: pollResponse.code,
        progress: pollResponse.data?.progress,
        estimatedTime: pollResponse.data?.estimated_time
      }
    };
  }

  private async fetchJsonWithUsage<T>(params: {
    endpoint: string;
    endpointGroup?: string;
    capability: "image" | "video" | "audio" | "upload" | "status" | "balance";
    model?: string;
    method: "GET" | "POST";
    body?: BodyInit;
    contentType?: string;
    timeoutMs?: number;
  }): Promise<T> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`
    };
    if (params.contentType) {
      headers["Content-Type"] = params.contentType;
    }

    try {
      const response = await fetchJson<T>(
        `${this.env.apiMartBaseUrl}${params.endpoint}`,
        {
          method: params.method,
          headers,
          body: params.body,
          timeoutMs: params.timeoutMs
        }
      );
      this.recordUsage(params, true);
      return response;
    } catch (error) {
      this.recordUsage(params, false);
      throw error;
    }
  }

  private async fetchBinaryWithUsage(params: {
    endpoint: string;
    capability: "audio";
    model?: string;
    method: "POST";
    body?: BodyInit;
    contentType?: string;
  }) {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
      "Accept": "*/*"
    };
    if (params.contentType) {
      headers["Content-Type"] = params.contentType;
    }

    try {
      const response = await fetchBinary(
        `${this.env.apiMartBaseUrl}${params.endpoint}`,
        {
          method: params.method,
          headers,
          body: params.body
        }
      );
      this.recordUsage(params, true);
      return response;
    } catch (error) {
      this.recordUsage(params, false);
      throw error;
    }
  }

  private async fetchWithUsage(params: {
    endpoint: string;
    capability: "audio";
    model?: string;
    method: "POST";
    body?: BodyInit;
    timeoutMs: number;
  }) {
    const response = await fetch(`${this.env.apiMartBaseUrl}${params.endpoint}`, {
      method: params.method,
      headers: {
        "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`
      },
      body: params.body,
      signal: AbortSignal.timeout(params.timeoutMs)
    });
    this.recordUsage(params, response.ok, response.status);
    return response;
  }

  private recordUsage(
    params: {
      endpoint: string;
      endpointGroup?: string;
      capability: "image" | "video" | "audio" | "upload" | "status" | "balance";
      model?: string;
      method: string;
    },
    ok: boolean,
    statusCode?: number
  ) {
    this.usageStore?.recordCall({
      method: params.method,
      endpoint: params.endpointGroup ?? params.endpoint,
      capability: params.capability,
      model: params.model,
      ok,
      statusCode
    });
  }
}

function contentTypeFromImagePath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return undefined;
  }
}

function contentTypeFromAudioPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "audio/mp4";
    case ".mpeg":
      return "audio/mpeg";
    case ".mpga":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    default:
      return undefined;
  }
}

function normalizeWaitSeconds(value: number | undefined, defaultValue: number): number {
  return Math.max(0, Math.min(value ?? defaultValue, defaultValue));
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
