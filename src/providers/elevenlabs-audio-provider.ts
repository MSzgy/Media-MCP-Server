import { AppEnv } from "../config/env.js";
import { extensionFromContentType, saveBinaryArtifact } from "../lib/files.js";
import { fetchBinary } from "../lib/http.js";
import {
  AudioGenerationParams,
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability
} from "./base.js";

export class ElevenLabsAudioProvider implements MediaProvider {
  readonly name = "elevenlabs";
  readonly capabilities = ["audio"] as const;

  constructor(private readonly env: AppEnv) {}

  getAvailability(): ProviderAvailability {
    const missingEnv = [];

    if (!this.env.elevenLabsApiKey) {
      missingEnv.push("ELEVENLABS_API_KEY");
    }

    if (!this.env.elevenLabsDefaultVoiceId) {
      missingEnv.push("ELEVENLABS_DEFAULT_VOICE_ID");
    }

    return {
      configured: missingEnv.length === 0,
      missingEnv
    };
  }

  async generateAudio(params: AudioGenerationParams): Promise<MediaGenerationResult> {
    const voiceId = params.voiceId ?? this.env.elevenLabsDefaultVoiceId;

    if (!voiceId) {
      throw new Error("ElevenLabs requires voiceId or ELEVENLABS_DEFAULT_VOICE_ID.");
    }

    const outputFormat = params.outputFormat ?? "mp3_44100_128";
    const query = new URLSearchParams({ output_format: outputFormat });
    const endpoint = `${this.env.elevenLabsBaseUrl}/v1/text-to-speech/${voiceId}?${query.toString()}`;

    const { buffer, contentType } = await fetchBinary(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": this.env.elevenLabsApiKey ?? "",
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: params.prompt,
        model_id: params.model ?? this.env.elevenLabsTtsModel,
        language_code: params.languageCode,
        ...(params.input ?? {})
      })
    });

    const artifact = await saveBinaryArtifact({
      outputDir: this.env.outputDir,
      prefix: "audio",
      data: buffer,
      extension: extensionFromContentType(contentType, outputFormat.split("_", 1)[0] ?? "mp3"),
      contentType: contentType ?? "audio/mpeg"
    });

    return {
      provider: this.name,
      capability: "audio",
      model: params.model ?? this.env.elevenLabsTtsModel,
      status: "completed",
      assets: [
        {
          kind: "file",
          path: artifact.path,
          contentType: artifact.contentType
        }
      ],
      metadata: {
        voiceId,
        outputFormat
      }
    };
  }
}
