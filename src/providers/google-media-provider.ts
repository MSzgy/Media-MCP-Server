import { readFile } from "node:fs/promises";
import {
  GenerateVideosOperation,
  GoogleGenAI,
  PersonGeneration,
  ThinkingLevel
} from "@google/genai";
import type {
  GenerateContentConfig,
  GenerateImagesConfig,
  GenerateVideosConfig,
  Image as GoogleImage,
  Part,
  SpeechConfig,
  Video as GoogleVideo
} from "@google/genai";
import { AppEnv } from "../config/env.js";
import type { GoogleKeyResolver } from "../config/google-key-resolver.js";
import {
  createArtifactPath,
  extensionFromContentType,
  saveBase64Artifact,
  saveBinaryArtifact
} from "../lib/files.js";
import { fetchBinary } from "../lib/http.js";
import {
  AudioGenerationParams,
  GeneratedAsset,
  ImageGenerationParams,
  MediaGenerationResult,
  MediaProvider,
  ProviderAvailability,
  VideoGenerationParams
} from "./base.js";

const IMAGE_MODELS_USING_GENERATE_IMAGES = /^(models\/)?imagen-/i;
const GEMINI_FLASH_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const IMAGEN_FAST_MODEL = "models/imagen-4.0-fast-generate-001";

export class GoogleMediaProvider implements MediaProvider {
  readonly name = "google";
  readonly capabilities = ["image", "video", "audio"] as const;

  private readonly clientCache = new Map<string, GoogleGenAI>();

  constructor(
    private readonly env: AppEnv,
    private readonly keyResolver: GoogleKeyResolver
  ) {}

  getAvailability(): ProviderAvailability {
    return this.keyResolver.hasKey()
      ? { configured: true, missingEnv: [] }
      : { configured: false, missingEnv: ["GOOGLE_API_KEYS or GOOGLE_API_KEY or GEMINI_API_KEY"] };
  }

  async generateImage(params: ImageGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? this.env.googleImageModel;

    if (IMAGE_MODELS_USING_GENERATE_IMAGES.test(model)) {
      return this.generateImagenImage(params, model);
    }

    return this.generateGeminiImage(params, model);
  }

  private async generateGeminiImage(
    params: ImageGenerationParams,
    model: string
  ): Promise<MediaGenerationResult> {
    const response = await this.getClient().models.generateContentStream({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }]
        }
      ],
      config: this.buildImageGenerateContentConfig(params, model)
    });

    const parts: Part[] = [];
    const metadata: Record<string, unknown> = {};
    let chunkCount = 0;

    for await (const chunk of response) {
      chunkCount++;
      parts.push(...extractParts(chunk.candidates));
      metadata.modelVersion = chunk.modelVersion ?? metadata.modelVersion;
      metadata.responseId = chunk.responseId ?? metadata.responseId;
      metadata.usageMetadata = chunk.usageMetadata ?? metadata.usageMetadata;
      metadata.promptFeedback = chunk.promptFeedback ?? metadata.promptFeedback;
      metadata.modelStatus = chunk.modelStatus ?? metadata.modelStatus;
    }

    const imageParts = parts.filter(hasInlineData);
    const artifacts = await Promise.all(
      imageParts.map((part) =>
        saveBase64Artifact({
          outputDir: this.env.outputDir,
          prefix: "image",
          base64: part.inlineData.data!,
          extension: extensionFromContentType(
            part.inlineData.mimeType,
            params.outputFormat ?? "png"
          ),
          contentType: part.inlineData.mimeType ?? contentTypeFromImageFormat(params.outputFormat)
        })
      )
    );

    return {
      provider: this.name,
      capability: "image",
      model,
      status: artifacts.length > 0 ? "completed" : "empty",
      assets: artifacts.map((artifact) => ({
        kind: "file",
        path: artifact.path,
        contentType: artifact.contentType
      })),
      metadata: {
        ...metadata,
        chunkCount,
        text: parts.map((part) => part.text).filter(Boolean),
      }
    };
  }

  async generateVideo(params: VideoGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? this.env.googleVideoModel;
    let operation = await this.getClient().models.generateVideos({
      model,
      prompt: params.prompt,
      ...(params.image ? { image: await loadImage(params.image) } : {}),
      config: buildVideoConfig(params)
    });

    operation = await this.pollVideoOperation(operation, params.waitSeconds ?? 30);
    return this.videoOperationToResult(operation, model);
  }

  async generateAudio(params: AudioGenerationParams): Promise<MediaGenerationResult> {
    const model = params.model ?? this.env.googleTtsModel;
    const response = await this.getClient().models.generateContent({
      model,
      contents: [{ parts: [{ text: params.prompt }] }],
      config: this.buildAudioConfig(params)
    });

    const parts = extractParts(response.candidates);
    const audioPart = parts.find(hasInlineData);
    if (!audioPart?.inlineData?.data) {
      return {
        provider: this.name,
        capability: "audio",
        model,
        status: "empty",
        assets: [],
        metadata: {
          modelVersion: response.modelVersion,
          responseId: response.responseId,
          text: parts.map((part) => part.text).filter(Boolean),
          usageMetadata: response.usageMetadata,
          promptFeedback: response.promptFeedback
        }
      };
    }

    const rawAudio = Buffer.from(audioPart.inlineData.data, "base64");
    const sourceContentType = audioPart.inlineData.mimeType ?? "audio/L16;codec=pcm;rate=24000";
    const outputFormat = params.outputFormat?.toLowerCase() ?? "wav";
    const shouldSaveRawPcm = outputFormat === "pcm" || outputFormat === "l16";
    const isPcmAudio = isPcmContentType(sourceContentType);
    const data = shouldSaveRawPcm
      ? rawAudio
      : isPcmAudio
        ? wrapPcmAsWav(rawAudio, parsePcmMimeType(sourceContentType))
        : rawAudio;
    const contentType = shouldSaveRawPcm
      ? sourceContentType
      : isPcmAudio
        ? "audio/wav"
        : sourceContentType;
    const extension = shouldSaveRawPcm
      ? "pcm"
      : isPcmAudio
        ? "wav"
        : extensionFromContentType(sourceContentType, outputFormat);
    const artifact = await saveBinaryArtifact({
      outputDir: this.env.outputDir,
      prefix: "audio",
      data,
      extension,
      contentType
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
        modelVersion: response.modelVersion,
        responseId: response.responseId,
        voiceId: params.voiceId ?? this.env.googleTtsVoice,
        sourceContentType,
        outputFormat: shouldSaveRawPcm ? "pcm" : "wav",
        requestedOutputFormat: params.outputFormat,
        usageMetadata: response.usageMetadata
      }
    };
  }

  async checkTaskStatus(jobId: string): Promise<MediaGenerationResult> {
    const operation = new GenerateVideosOperation();
    operation.name = jobId;

    const latest = await this.getClient().operations.getVideosOperation({ operation });
    return this.videoOperationToResult(latest);
  }

  private async generateImagenImage(
    params: ImageGenerationParams,
    model: string
  ): Promise<MediaGenerationResult> {
    const response = await this.getClient().models.generateImages({
      model,
      prompt: params.prompt,
      config: buildImagenConfig(params, model)
    });

    const generatedImages = response.generatedImages ?? [];
    const artifacts = await Promise.all(
      generatedImages
        .filter((item) => Boolean(item.image?.imageBytes))
        .map((item) =>
          saveBase64Artifact({
            outputDir: this.env.outputDir,
            prefix: "image",
            base64: item.image!.imageBytes!,
            extension: extensionFromContentType(
              item.image?.mimeType,
              params.outputFormat ?? "jpeg"
            ),
            contentType: item.image?.mimeType ?? contentTypeFromImageFormat(params.outputFormat ?? "jpeg")
          })
        )
    );

    return {
      provider: this.name,
      capability: "image",
      model,
      status: artifacts.length > 0 ? "completed" : "empty",
      assets: artifacts.map((artifact) => ({
        kind: "file",
        path: artifact.path,
        contentType: artifact.contentType
      })),
      metadata: {
        positivePromptSafetyAttributes: response.positivePromptSafetyAttributes,
        filteredReasons: generatedImages
          .map((image) => image.raiFilteredReason)
          .filter(Boolean),
        enhancedPrompts: generatedImages
          .map((image) => image.enhancedPrompt)
          .filter(Boolean)
      }
    };
  }

  private async pollVideoOperation(
    operation: GenerateVideosOperation,
    waitSeconds: number
  ): Promise<GenerateVideosOperation> {
    const deadline = Date.now() + waitSeconds * 1000;
    let latest = operation;

    while (!latest.done && Date.now() < deadline) {
      await delay(Math.min(10_000, deadline - Date.now()));
      latest = await this.getClient().operations.getVideosOperation({ operation: latest });
    }

    return latest;
  }

  private async videoOperationToResult(
    operation: GenerateVideosOperation,
    model?: string
  ): Promise<MediaGenerationResult> {
    const assets: GeneratedAsset[] = [];

    if (operation.done && !operation.error) {
      for (const generatedVideo of operation.response?.generatedVideos ?? []) {
        const asset = await this.saveVideo(generatedVideo.video);
        if (asset) {
          assets.push(asset);
        }
      }
    }

    return {
      provider: this.name,
      capability: "video",
      model,
      status: operation.error ? "failed" : operation.done ? "completed" : "running",
      jobId: operation.name,
      assets,
      metadata: {
        operationName: operation.name,
        done: operation.done,
        error: operation.error,
        metadata: operation.metadata,
        raiMediaFilteredCount: operation.response?.raiMediaFilteredCount,
        raiMediaFilteredReasons: operation.response?.raiMediaFilteredReasons
      }
    };
  }

  private async saveVideo(video?: GoogleVideo): Promise<GeneratedAsset | undefined> {
    if (!video) {
      return undefined;
    }

    const contentType = video.mimeType ?? "video/mp4";
    if (video.videoBytes) {
      const artifact = await saveBase64Artifact({
        outputDir: this.env.outputDir,
        prefix: "video",
        base64: video.videoBytes,
        extension: extensionFromContentType(contentType, "mp4"),
        contentType
      });
      return {
        kind: "file",
        path: artifact.path,
        contentType: artifact.contentType
      };
    }

    if (video.uri) {
      const downloadPath = await createArtifactPath({
        outputDir: this.env.outputDir,
        prefix: "video",
        extension: extensionFromContentType(contentType, "mp4")
      });
      await this.getClient().files.download({ file: video, downloadPath });
      return {
        kind: "file",
        path: downloadPath,
        contentType
      };
    }

    return undefined;
  }

  private buildImageGenerateContentConfig(
    params: ImageGenerationParams,
    model: string
  ): GenerateContentConfig {
    const input = params.input ?? {};
    const configInput = asRecord(input.config);
    const config = {
      ...configInput,
      responseModalities: configInput.responseModalities ?? ["IMAGE", "TEXT"],
      ...(params.count != null ? { candidateCount: params.count } : {})
    } as GenerateContentConfig;

    if (model === GEMINI_FLASH_IMAGE_MODEL && configInput.thinkingConfig == null) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.MINIMAL
      };
    }

    const imageConfig = {
      ...asRecord(configInput.imageConfig),
      ...buildNativeImageConfig(params),
      ...asRecord(input.imageConfig)
    };

    if (Object.keys(imageConfig).length > 0) {
      config.imageConfig = imageConfig;
    }

    return config;
  }

  private buildAudioConfig(params: AudioGenerationParams): GenerateContentConfig {
    const input = params.input ?? {};
    const configInput = asRecord(input.config);
    return {
      ...configInput,
      responseModalities: ["AUDIO"],
      speechConfig: buildSpeechConfig(params, this.env.googleTtsVoice)
    };
  }

  private getClient(): GoogleGenAI {
    const apiKey = this.keyResolver.resolveApiKey();
    let client = this.clientCache.get(apiKey);
    if (!client) {
      client = new GoogleGenAI({ apiKey });
      this.clientCache.set(apiKey, client);
    }
    return client;
  }
}

function buildNativeImageConfig(params: ImageGenerationParams): Record<string, unknown> {
  const input = params.input ?? {};
  return compactObject({
    aspectRatio: getNonEmptyString(input.aspectRatio) ?? aspectRatioFromSize(params.size),
    imageSize: params.resolution ?? getNonEmptyString(input.imageSize) ?? "1K",
    personGeneration: getNonEmptyString(input.personGeneration)
  });
}

function buildImagenConfig(params: ImageGenerationParams, model: string): GenerateImagesConfig {
  const input = params.input ?? {};
  const configInput = asRecord(input.config);
  const defaultImageSize = model === IMAGEN_FAST_MODEL ? undefined : "1K";
  return {
    ...configInput,
    ...compactObject({
      numberOfImages: params.count ?? getNumber(configInput.numberOfImages) ?? 1,
      aspectRatio: getNonEmptyString(input.aspectRatio)
        ?? aspectRatioFromSize(params.size)
        ?? getNonEmptyString(configInput.aspectRatio)
        ?? "1:1",
      imageSize: params.resolution
        ?? getNonEmptyString(input.imageSize)
        ?? getNonEmptyString(configInput.imageSize)
        ?? defaultImageSize,
      outputMimeType: contentTypeFromImageFormat(params.outputFormat)
        ?? getNonEmptyString(configInput.outputMimeType)
        ?? "image/jpeg",
      outputCompressionQuality: params.outputCompression
        ?? getNumber(configInput.outputCompressionQuality),
      personGeneration: normalizePersonGeneration(
        getNonEmptyString(input.personGeneration) ?? getNonEmptyString(configInput.personGeneration)
      ) ?? PersonGeneration.ALLOW_ADULT
    })
  } as GenerateImagesConfig;
}

function buildVideoConfig(params: VideoGenerationParams): GenerateVideosConfig {
  const input = params.input ?? {};
  const configInput = asRecord(input.config);
  return {
    ...configInput,
    ...compactObject({
      aspectRatio: params.aspectRatio,
      durationSeconds: params.duration,
      resolution: getString(input.resolution),
      personGeneration: getString(input.personGeneration),
      negativePrompt: getString(input.negativePrompt),
      generateAudio: getBoolean(input.generateAudio),
      numberOfVideos: getNumber(input.numberOfVideos)
    })
  } as GenerateVideosConfig;
}

function buildSpeechConfig(params: AudioGenerationParams, defaultVoice: string): SpeechConfig {
  const input = params.input ?? {};
  const speechConfigInput = asRecord(input.speechConfig);
  if (Object.keys(speechConfigInput).length > 0) {
    return {
      ...speechConfigInput,
      ...(params.languageCode && !speechConfigInput.languageCode
        ? { languageCode: params.languageCode }
        : {})
    } as SpeechConfig;
  }

  const multiSpeakerVoiceConfig = asRecord(input.multiSpeakerVoiceConfig);
  if (Object.keys(multiSpeakerVoiceConfig).length > 0) {
    return compactObject({
      multiSpeakerVoiceConfig,
      languageCode: params.languageCode
    }) as SpeechConfig;
  }

  return compactObject({
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: params.voiceId ?? defaultVoice
      }
    },
    languageCode: params.languageCode
  }) as SpeechConfig;
}

async function loadImage(source: string): Promise<GoogleImage> {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(source);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      imageBytes: dataUrlMatch[2]
    };
  }

  if (/^https?:\/\//i.test(source)) {
    const { buffer, contentType } = await fetchBinary(source);
    return {
      mimeType: contentType?.split(";", 1)[0] ?? "image/png",
      imageBytes: buffer.toString("base64")
    };
  }

  const buffer = await readFile(source);
  return {
    mimeType: contentTypeFromFileName(source) ?? "image/png",
    imageBytes: buffer.toString("base64")
  };
}

function extractParts(
  candidates: Array<{ content?: { parts?: Part[] } }> | undefined
): Part[] {
  return candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
}

function hasInlineData(part: Part): part is Part & { inlineData: { data: string; mimeType?: string } } {
  return Boolean(part.inlineData?.data);
}

function aspectRatioFromSize(size?: string): string | undefined {
  return size && /^\d+:\d+$/.test(size) ? size : undefined;
}

function contentTypeFromImageFormat(format?: string): string | undefined {
  if (!format) {
    return undefined;
  }

  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function contentTypeFromFileName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return undefined;
}

function parsePcmMimeType(contentType: string): {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
} {
  const rate = /rate=(\d+)/i.exec(contentType)?.[1];
  const channels = /channels=(\d+)/i.exec(contentType)?.[1];
  return {
    channels: channels ? parseInt(channels, 10) : 1,
    sampleRate: rate ? parseInt(rate, 10) : 24_000,
    bitsPerSample: 16
  };
}

function isPcmContentType(contentType: string): boolean {
  return /^audio\/(l16|pcm)\b/i.test(contentType) || /codec=pcm/i.test(contentType);
}

function wrapPcmAsWav(
  pcmData: Buffer,
  format: { channels: number; sampleRate: number; bitsPerSample: number }
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = format.sampleRate * format.channels * (format.bitsPerSample / 8);
  const blockAlign = format.channels * (format.bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePersonGeneration(value?: string): PersonGeneration | undefined {
  switch (value?.toUpperCase()) {
    case "ALLOW_ADULT":
      return PersonGeneration.ALLOW_ADULT;
    case "ALLOW_ALL":
      return PersonGeneration.ALLOW_ALL;
    case "DONT_ALLOW":
    case "DON'T_ALLOW":
    case "ALLOW_NONE":
    case "DISALLOW":
      return PersonGeneration.DONT_ALLOW;
    default:
      return undefined;
  }
}
