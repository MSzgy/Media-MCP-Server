export type MediaCapability = "image" | "video" | "audio";

export interface ProviderAvailability {
  configured: boolean;
  missingEnv: string[];
}

export interface GeneratedAsset {
  kind: "file" | "url";
  path?: string;
  url?: string;
  contentType?: string;
}

export interface MediaGenerationResult {
  provider: string;
  capability: MediaCapability;
  model?: string;
  status: string;
  jobId?: string;
  assets: GeneratedAsset[];
  metadata?: Record<string, unknown>;
}

export interface ImageGenerationParams {
  prompt: string;
  provider?: string;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  count?: number;
  resolution?: string;
  input?: Record<string, unknown>;
}

export interface VideoGenerationParams {
  prompt: string;
  provider?: string;
  model?: string;
  version?: string;
  image?: string;
  aspectRatio?: string;
  duration?: number;
  waitSeconds?: number;
  input?: Record<string, unknown>;
}

export interface AudioGenerationParams {
  prompt: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  outputFormat?: string;
  languageCode?: string;
  input?: Record<string, unknown>;
}

export interface MediaProvider {
  readonly name: string;
  readonly capabilities: readonly MediaCapability[];
  getAvailability(): ProviderAvailability;
  generateImage?(params: ImageGenerationParams): Promise<MediaGenerationResult>;
  generateVideo?(params: VideoGenerationParams): Promise<MediaGenerationResult>;
  generateAudio?(params: AudioGenerationParams): Promise<MediaGenerationResult>;
  checkTaskStatus?(jobId: string): Promise<MediaGenerationResult>;
}
