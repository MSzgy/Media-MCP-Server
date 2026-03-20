import { AppEnv } from "../config/env.js";
import { saveBase64Artifact } from "../lib/files.js";
import { fetchJson } from "../lib/http.js";
import {
  ImageGenerationParams,
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability
} from "./base.js";

interface OpenAiImagesResponse {
  created?: number;
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export class OpenAiImageProvider implements MediaProvider {
  readonly name = "openai";
  readonly capabilities = ["image"] as const;

  constructor(private readonly env: AppEnv) {}

  getAvailability(): ProviderAvailability {
    return this.env.openAiApiKey
      ? { configured: true, missingEnv: [] }
      : { configured: false, missingEnv: ["OPENAI_API_KEY"] };
  }

  async generateImage(params: ImageGenerationParams): Promise<MediaGenerationResult> {
    const response = await fetchJson<OpenAiImagesResponse>(
      `${this.env.openAiBaseUrl}/images/generations`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.env.openAiApiKey ?? ""}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: params.model ?? this.env.openAiImageModel,
          prompt: params.prompt,
          size: params.size ?? "auto",
          quality: params.quality ?? "auto",
          background: params.background ?? "auto",
          output_format: params.outputFormat ?? "png",
          output_compression: params.outputCompression,
          n: params.count ?? 1,
          ...(params.input ?? {})
        })
      }
    );

    const artifacts = await Promise.all(
      (response.data ?? [])
        .filter((item): item is { b64_json: string; revised_prompt?: string } => Boolean(item.b64_json))
        .map((item) =>
          saveBase64Artifact({
            outputDir: this.env.outputDir,
            prefix: "image",
            base64: item.b64_json,
            extension: params.outputFormat ?? "png",
            contentType: `image/${params.outputFormat ?? "png"}`
          })
        )
    );

    return {
      provider: this.name,
      capability: "image",
      model: params.model ?? this.env.openAiImageModel,
      status: artifacts.length > 0 ? "completed" : "empty",
      assets: artifacts.map((artifact) => ({
        kind: "file",
        path: artifact.path,
        contentType: artifact.contentType
      })),
      metadata: {
        created: response.created,
        revisedPrompts: (response.data ?? [])
          .map((item) => item.revised_prompt)
          .filter((value): value is string => Boolean(value))
      }
    };
  }
}
