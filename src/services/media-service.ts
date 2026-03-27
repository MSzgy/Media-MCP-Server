import { ProviderConfigurationError } from "../lib/errors.js";
import {
  AudioGenerationParams,
  ImageGenerationParams,
  MediaCapability,
  MediaGenerationResult,
  MediaProvider,
  VideoGenerationParams
} from "../providers/base.js";

export class MediaService {
  private readonly providers = new Map<string, MediaProvider>();
  private readonly defaultProviders: Record<MediaCapability, string> = {
    image: "apimart",
    video: "apimart",
    audio: "apimart"
  };

  constructor(providers: MediaProvider[]) {
    providers.forEach((provider) => this.providers.set(provider.name, provider));
  }

  listProviders(): Array<Record<string, unknown>> {
    return Array.from(this.providers.values()).map((provider) => ({
      name: provider.name,
      capabilities: provider.capabilities,
      ...provider.getAvailability()
    }));
  }

  generateImage(params: ImageGenerationParams): Promise<MediaGenerationResult> {
    const provider = this.resolveProvider("image", params.provider);
    return provider.generateImage!(params);
  }

  generateVideo(params: VideoGenerationParams): Promise<MediaGenerationResult> {
    const provider = this.resolveProvider("video", params.provider);
    return provider.generateVideo!(params);
  }

  generateAudio(params: AudioGenerationParams): Promise<MediaGenerationResult> {
    const provider = this.resolveProvider("audio", params.provider);
    return provider.generateAudio!(params);
  }

  async checkTaskStatus(providerName: string, jobId: string): Promise<MediaGenerationResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    if (!provider.checkTaskStatus) {
      throw new Error(`Provider ${providerName} does not support checkTaskStatus.`);
    }

    const availability = provider.getAvailability();
    if (!availability.configured) {
      throw new ProviderConfigurationError(
        `Provider ${providerName} is not configured.`
      );
    }

    return provider.checkTaskStatus(jobId);
  }

  private resolveProvider(capability: MediaCapability, requested?: string): MediaProvider {
    const providerName = requested ?? this.defaultProviders[capability];
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    if (!provider.capabilities.includes(capability)) {
      throw new Error(`Provider ${providerName} does not support ${capability}.`);
    }

    const availability = provider.getAvailability();
    if (!availability.configured) {
      throw new ProviderConfigurationError(
        `Provider ${providerName} is not configured. Missing env: ${availability.missingEnv.join(", ")}`
      );
    }

    return provider;
  }
}
