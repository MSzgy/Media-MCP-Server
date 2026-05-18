import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

export interface AppEnv {
  serverName: string;
  mcpPort: number;
  mcpAuthToken?: string;
  outputDir: string;
  apiMartApiKey?: string;
  apiMartBaseUrl: string;
  googleApiKeys?: string[];
  googleApiKey?: string;
  googleImageModel: string;
  googleVideoModel: string;
  googleTtsModel: string;
  googleTtsVoice: string;
}

export const appEnv: AppEnv = {
  serverName: process.env.MCP_SERVER_NAME ?? "media-mcp-server",
  mcpPort: parseInt(process.env.MCP_PORT ?? "3333", 10),
  mcpAuthToken: process.env.MCP_AUTH_TOKEN,
  outputDir: path.resolve(process.cwd(), process.env.MEDIA_OUTPUT_DIR ?? "outputs"),
  apiMartApiKey: process.env.APIMART_API_KEY,
  apiMartBaseUrl: process.env.APIMART_BASE_URL ?? "https://api.apimart.ai/v1",
  googleApiKeys: process.env.GOOGLE_API_KEYS
    ? process.env.GOOGLE_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined,
  googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  googleImageModel: process.env.GOOGLE_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview",
  googleVideoModel: process.env.GOOGLE_VIDEO_MODEL ?? "veo-3.1-generate-preview",
  googleTtsModel: process.env.GOOGLE_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
  googleTtsVoice: process.env.GOOGLE_TTS_VOICE ?? "Kore"
};
