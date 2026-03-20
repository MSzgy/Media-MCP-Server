import { AppEnv } from "../config/env.js";
import { fetchJson } from "../lib/http.js";
import {
  ImageGenerationParams,
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability,
  VideoGenerationParams
} from "./base.js";

interface ReplicatePrediction {
  id: string;
  model?: string;
  version?: string;
  status: string;
  error?: string | null;
  output?: unknown;
  urls?: {
    get?: string;
    web?: string;
    cancel?: string;
  };
}

export class ReplicateProvider implements MediaProvider {
  readonly name = "replicate";
  readonly capabilities = ["image", "video"] as const;

  constructor(private readonly env: AppEnv) {}

  getAvailability(): ProviderAvailability {
    return this.env.replicateApiToken
      ? { configured: true, missingEnv: [] }
      : { configured: false, missingEnv: ["REPLICATE_API_TOKEN"] };
  }

  generateImage(params: ImageGenerationParams): Promise<MediaGenerationResult> {
    return this.createPrediction({
      prompt: params.prompt,
      model: params.model,
      version: (params.input?.version as string | undefined) ?? undefined,
      waitSeconds: 30,
      input: {
        prompt: params.prompt,
        ...(params.input ?? {})
      },
      capability: "image"
    });
  }

  generateVideo(params: VideoGenerationParams): Promise<MediaGenerationResult> {
    return this.createPrediction({
      prompt: params.prompt,
      model: params.model,
      version: params.version,
      waitSeconds: params.waitSeconds ?? 30,
      input: {
        prompt: params.prompt,
        ...(params.image ? { image: params.image } : {}),
        ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        ...(typeof params.duration === "number" ? { duration: params.duration } : {}),
        ...(params.input ?? {})
      },
      capability: "video"
    });
  }

  private async createPrediction(args: {
    prompt: string;
    capability: "image" | "video";
    model?: string;
    version?: string;
    waitSeconds: number;
    input: Record<string, unknown>;
  }): Promise<MediaGenerationResult> {
    const endpoint = this.resolveEndpoint(args.model, args.version);
    const body = args.version
      ? { version: args.version, input: args.input }
      : { input: args.input };

    const prediction = await fetchJson<ReplicatePrediction>(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.env.replicateApiToken ?? ""}`,
        "Content-Type": "application/json",
        "Prefer": `wait=${args.waitSeconds}`
      },
      body: JSON.stringify(body),
      timeoutMs: Math.max(30_000, args.waitSeconds * 1_000 + 5_000)
    });

    return {
      provider: this.name,
      capability: args.capability,
      model: prediction.model ?? args.model,
      jobId: prediction.id,
      status: prediction.status,
      assets: extractUrlAssets(prediction.output),
      metadata: {
        version: prediction.version ?? args.version,
        error: prediction.error ?? undefined,
        pollUrl: prediction.urls?.get,
        webUrl: prediction.urls?.web,
        cancelUrl: prediction.urls?.cancel
      }
    };
  }

  private resolveEndpoint(model?: string, version?: string): string {
    if (version) {
      return `${this.env.replicateBaseUrl}/predictions`;
    }

    if (!model || !model.includes("/")) {
      throw new Error("Replicate provider requires either model=owner/name or version.");
    }

    const [owner, name] = model.split("/", 2);
    return `${this.env.replicateBaseUrl}/models/${owner}/${name}/predictions`;
  }

  async checkTaskStatus(jobId: string): Promise<MediaGenerationResult> {
    const endpoint = `${this.env.replicateBaseUrl}/predictions/${jobId}`;
    const prediction = await fetchJson<ReplicatePrediction>(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.env.replicateApiToken ?? ""}`
      }
    });

    return {
      provider: this.name,
      capability: "video", // Fallback as we handle mostly video polling
      model: prediction.model,
      jobId: prediction.id,
      status: prediction.status,
      assets: extractUrlAssets(prediction.output),
      metadata: {
        version: prediction.version,
        error: prediction.error ?? undefined,
        pollUrl: prediction.urls?.get,
        webUrl: prediction.urls?.web,
        cancelUrl: prediction.urls?.cancel
      }
    };
  }
}

function extractUrlAssets(output: unknown): Array<{ kind: "url"; url: string }> {
  const urls = new Set<string>();
  collectUrls(output, urls);
  return Array.from(urls).map((url) => ({ kind: "url" as const, url }));
}

function collectUrls(value: unknown, urls: Set<string>): void {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    urls.add(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      collectUrls(nestedValue, urls);
    }
  }
}
