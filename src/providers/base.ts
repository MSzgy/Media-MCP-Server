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

export interface UploadedImage {
  provider: string;
  url: string;
  filename: string;
  contentType: string;
  bytes: number;
  createdAt: number;
}

export interface ImageGenerationParams {
  prompt: string;
  provider?: string;
  model?: string;
  size?: string;
  quality?: string;
  background?: string;
  moderation?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  count?: number;
  resolution?: string;
  imageUrls?: string[];
  maskUrl?: string;
  officialFallback?: boolean;
  googleSearch?: boolean;
  googleImageSearch?: boolean;
  promptExtend?: boolean;
  negativePrompt?: string;
  watermark?: boolean;
  seed?: number;
  thinkingMode?: boolean;
  enableSequential?: boolean;
  bboxList?: unknown[];
  colorPalette?: Array<{
    hex: string;
    ratio: string;
  }>;
  input?: Record<string, unknown>;
}

export interface VideoGenerationParams {
  prompt?: string;
  provider?: string;
  model?: string;
  version?: string;
  image?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  size?: string;
  quality?: string;
  mode?: string;
  imageUrls?: string[];
  imageWithRoles?: unknown[];
  videoUrls?: string[];
  audioUrls?: string[];
  audioUrl?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  negativePrompt?: string;
  seed?: number;
  generateAudio?: boolean;
  audio?: boolean;
  returnLastFrame?: boolean;
  tools?: unknown[];
  generationType?: string;
  enableGif?: boolean;
  officialFallback?: boolean;
  raw?: boolean;
  sourceTaskId?: string;
  sampleCount?: number;
  personGeneration?: string;
  resizeMode?: string;
  enhancePrompt?: boolean;
  promptExtend?: boolean;
  watermark?: boolean;
  shotType?: string;
  template?: string;
  videoUrl?: string;
  audioSetting?: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
  projectName?: string;
  group?: Record<string, unknown>;
  groupId?: string;
  assetType?: string;
  assets?: Array<{
    url: string;
    name: string;
  }>;
  url?: string;
  name?: string;
  bytedToken?: string;
  endpointPath?: string;
  omitModel?: boolean;
  waitSeconds?: number;
  input?: Record<string, unknown>;
}

export interface AudioGenerationParams {
  prompt?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  outputFormat?: string;
  languageCode?: string;
  filePath?: string;
  responseFormat?: string;
  temperature?: number;
  speed?: number;
  input?: Record<string, unknown>;
}

export interface MediaProvider {
  readonly name: string;
  readonly capabilities: readonly MediaCapability[];
  getAvailability(): ProviderAvailability;
  uploadImage?(filePath: string): Promise<UploadedImage>;
  generateImage?(params: ImageGenerationParams): Promise<MediaGenerationResult>;
  generateVideo?(params: VideoGenerationParams): Promise<MediaGenerationResult>;
  generateAudio?(params: AudioGenerationParams): Promise<MediaGenerationResult>;
  checkTaskStatus?(jobId: string): Promise<MediaGenerationResult>;
}
