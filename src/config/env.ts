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
}

export const appEnv: AppEnv = {
  serverName: process.env.MCP_SERVER_NAME ?? "media-mcp-server",
  mcpPort: parseInt(process.env.MCP_PORT ?? "3333", 10),
  mcpAuthToken: process.env.MCP_AUTH_TOKEN,
  outputDir: path.resolve(process.cwd(), process.env.MEDIA_OUTPUT_DIR ?? "outputs"),
  apiMartApiKey: process.env.APIMART_API_KEY,
  apiMartBaseUrl: process.env.APIMART_BASE_URL ?? "https://api.apimart.ai/v1"
};
