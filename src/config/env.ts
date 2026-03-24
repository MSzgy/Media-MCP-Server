import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

export interface AppEnv {
  serverName: string;
  mcpPort: number;
  mcpAuthToken?: string;
  outputDir: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiImageModel: string;
  replicateApiToken?: string;
  replicateBaseUrl: string;
  elevenLabsApiKey?: string;
  elevenLabsBaseUrl: string;
  elevenLabsDefaultVoiceId?: string;
  elevenLabsTtsModel: string;
  apiMartApiKey?: string;
  apiMartBaseUrl: string;
}

export const appEnv: AppEnv = {
  serverName: process.env.MCP_SERVER_NAME ?? "media-mcp-server",
  mcpPort: parseInt(process.env.MCP_PORT ?? "3333", 10),
  mcpAuthToken: process.env.MCP_AUTH_TOKEN,
  outputDir: path.resolve(process.cwd(), process.env.MEDIA_OUTPUT_DIR ?? "outputs"),
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openAiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
  replicateApiToken: process.env.REPLICATE_API_TOKEN,
  replicateBaseUrl: process.env.REPLICATE_BASE_URL ?? "https://api.replicate.com/v1",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsBaseUrl: process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io",
  elevenLabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID,
  elevenLabsTtsModel: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2",
  apiMartApiKey: process.env.APIMART_API_KEY,
  apiMartBaseUrl: process.env.APIMART_BASE_URL ?? "https://api.apimart.ai/v1"
};
