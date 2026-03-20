import { AppEnv } from "../config/env.js";
import { fetchJson } from "../lib/http.js";
import {
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability,
  VideoGenerationParams
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
  readonly capabilities = ["video"] as const;

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

  async checkTaskStatus(jobId: string): Promise<MediaGenerationResult> {
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
      const videos = pollResponse.data?.result?.videos;
      if (videos && videos.length > 0 && videos[0].url && videos[0].url.length > 0) {
        finalUrl = videos[0].url[0];
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
