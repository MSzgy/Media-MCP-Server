import { AppEnv } from "../config/env.js";
import { fetchJson, fetchBinary } from "../lib/http.js";
import { saveBinaryArtifact, extensionFromContentType } from "../lib/files.js";
import {
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability,
  VideoGenerationParams,
  AudioGenerationParams
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
  "doubao-seedance-1-5-pro",
  "sora-2",
  "veo3.1-fast",
  "wan2.6",
  "kling-v3-omni"
] as const;

const DEFAULT_MODEL = "doubao-seedance-1-5-pro";

interface ApiMartVideoResponse {
  code: number;
  data: Array<{
    status: string;
    task_id: string;
  }>;
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

export class ApiMartVideoProvider implements MediaProvider {
  readonly name = "apimart";
  readonly capabilities = ["video", "image", "audio"] as const;

  constructor(private readonly env: AppEnv) {}

  getAvailability(): ProviderAvailability {
    return this.env.apiMartApiKey
      ? { configured: true, missingEnv: [] }
      : { configured: false, missingEnv: ["APIMART_API_KEY"] };
  }

  async generateVideo(params: VideoGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? DEFAULT_MODEL;
    const extra = params.input ?? {};

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      ...(params.duration != null ? { duration: params.duration } : {}),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.image ? { image_urls: [params.image] } : {}),
      ...extra
    };

    const response = await fetchJson<ApiMartVideoResponse>(
      `${this.env.apiMartBaseUrl}/videos/generations`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const first = response.data?.[0];
    if (!first || !first.task_id) {
      throw new Error("No task_id returned from ApiMart");
    }

    const taskId = first.task_id;
    const maxWaitMs = (params.waitSeconds ?? 30) * 1000; // default 30s wait limit
    const startMs = Date.now();
    let taskStatus = first.status;
    let finalUrl: string | undefined;

    // Poll the task endpoint
    while (taskStatus !== "completed" && taskStatus !== "failed") {
      if (Date.now() - startMs > maxWaitMs) {
        break; // timed out waiting
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // poll every 5s

      const pollResponse = await fetchJson<ApiMartTaskResponse>(
        `${this.env.apiMartBaseUrl}/tasks/${taskId}`,
        {
          headers: {
            "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
          }
        }
      );

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

  async generateImage(params: import("./base.js").ImageGenerationParams): Promise<import("./base.js").MediaGenerationResult> {
    const model = params.model ?? "gpt-4o-image";
    const extra = params.input ?? {};

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      ...(params.size ? { size: params.size } : {}),
      ...(params.count != null ? { n: params.count } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...extra
    };

    const response = await fetchJson<ApiMartVideoResponse>(
      `${this.env.apiMartBaseUrl}/images/generations`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const first = response.data?.[0];
    if (!first || !first.task_id) {
      throw new Error("No task_id returned from ApiMart");
    }

    const taskId = first.task_id;
    const maxWaitMs = 120 * 1000;
    const startMs = Date.now();
    let taskStatus = first.status;
    let finalUrl: string | undefined;

    while (taskStatus !== "completed" && taskStatus !== "failed") {
      if (Date.now() - startMs > maxWaitMs) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const pollResponse = await fetchJson<ApiMartTaskResponse>(
        `${this.env.apiMartBaseUrl}/tasks/${taskId}`,
        {
          headers: {
            "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
          }
        }
      );

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
    const model = params.model ?? "gpt-4o-mini-tts";
    const extra = params.input ?? {};

    const body: Record<string, unknown> = {
      model,
      input: params.prompt,
      voice: params.voiceId ?? "alloy",
      ...(params.outputFormat ? { response_format: params.outputFormat } : {}),
      ...extra
    };

    const { buffer, contentType } = await fetchBinary(
      `${this.env.apiMartBaseUrl}/audio/speech`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`,
          "Content-Type": "application/json",
          "Accept": "*/*"
        },
        body: JSON.stringify(body)
      }
    );

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
        outputFormat: params.outputFormat
      }
    };
  }

  async checkTaskStatus(jobId: string): Promise<import("./base.js").MediaGenerationResult> {
    const pollResponse = await fetchJson<ApiMartTaskResponse>(
      `${this.env.apiMartBaseUrl}/tasks/${jobId}`,
      {
        headers: {
          "Authorization": `Bearer ${this.env.apiMartApiKey ?? ""}`
        }
      }
    );

    const taskStatus = pollResponse.data?.status ?? "unknown";
    let finalUrl: string | undefined;

    if (taskStatus === "completed") {
      const result = pollResponse.data?.result as any;
      if (result?.videos && result.videos.length > 0 && result.videos[0].url && result.videos[0].url.length > 0) {
        finalUrl = result.videos[0].url[0];
      } else if (result?.images && result.images.length > 0 && result.images[0].url) {
        finalUrl = Array.isArray(result.images[0].url) ? result.images[0].url[0] : result.images[0].url;
      } else if (result?.image_urls && result.image_urls.length > 0) {
        finalUrl = result.image_urls[0];
      }
    }

    const assets = finalUrl ? [{ kind: "url" as const, url: finalUrl }] : [];

    return {
      provider: this.name,
      capability: "video",
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
}
