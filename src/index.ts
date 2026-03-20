import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { appEnv } from "./config/env.js";
import { ElevenLabsAudioProvider } from "./providers/elevenlabs-audio-provider.js";
import { OpenAiImageProvider } from "./providers/openai-image-provider.js";
import { ReplicateProvider } from "./providers/replicate-provider.js";
import { ApiMartVideoProvider } from "./providers/apimart-video-provider.js";
import { MediaService } from "./services/media-service.js";

// ── helpers ──────────────────────────────────────────────────────────

function createMediaService() {
  return new MediaService([
    new OpenAiImageProvider(appEnv),
    // new ReplicateProvider(appEnv),
    new ElevenLabsAudioProvider(appEnv),
    new ApiMartVideoProvider(appEnv)
  ]);
}

function createMcpServer() {
  const server = new McpServer({
    name: appEnv.serverName,
    version: "0.1.0"
  });

  const mediaService = createMediaService();

  server.tool(
    "list_media_providers",
    "List all available media generation providers and their capabilities/status.",
    async () => toToolResult(mediaService.listProviders())
  );

  server.tool(
    "generate_image",
    "Generate an image from a text prompt. Available providers: 'openai' (default), 'replicate'.",
    {
      prompt: z.string().min(1).describe("The text prompt describing the image to generate"),
      provider: z.string().optional().describe("The provider to use: 'openai' or 'replicate'"),
      model: z.string().optional().describe("The model to use (for replicate, e.g., 'stability-ai/sdxl')"),
      size: z.string().optional(),
      quality: z.string().optional(),
      background: z.string().optional(),
      outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
      outputCompression: z.number().int().min(0).max(100).optional(),
      count: z.number().int().min(1).max(4).optional(),
      input: z.record(z.unknown()).optional().describe("Extra model-specific parameters")
    },
    async (args) => toToolResult(await mediaService.generateImage(args))
  );

  server.tool(
    "generate_video",
    "Generate a video from a text prompt and optionally an image. Available providers: 'replicate' (default), 'apimart'. For apimart, available models are: 'doubao-seedance-1-5-pro', 'sora-2', 'veo3.1-fast', 'wan2.6', 'kling-v3-omni'.",
    {
      prompt: z.string().min(1).describe("The text prompt describing the video"),
      provider: z.string().optional().describe("The provider to use: 'replicate' or 'apimart'"),
      model: z.string().optional().describe("The model to use. For apimart, you can pass 'sora-2', 'veo3.1-fast', etc."),
      version: z.string().optional(),
      image: z.string().optional().describe("URL of an initial image to animate (supported by some models)"),
      aspectRatio: z.string().optional().describe("Aspect ratio, e.g., '16:9', '9:16'"),
      duration: z.number().positive().optional().describe("Duration of the video in seconds"),
      waitSeconds: z.number().int().min(5).max(300).optional(),
      input: z.record(z.unknown()).optional().describe("Extra model-specific parameters")
    },
    async (args) => toToolResult(await mediaService.generateVideo(args))
  );

  server.tool(
    "generate_audio",
    "Generate audio/speech from text. Available providers: 'elevenlabs' (default).",
    {
      prompt: z.string().min(1).describe("The text to synthesize into speech"),
      provider: z.string().optional().describe("The provider to use: 'elevenlabs'"),
      model: z.string().optional().describe("The TTS model to use"),
      voiceId: z.string().optional().describe("The voice ID to use"),
      outputFormat: z.string().optional(),
      languageCode: z.string().optional(),
      input: z.record(z.unknown()).optional().describe("Extra model-specific parameters")
    },
    async (args) => toToolResult(await mediaService.generateAudio(args))
  );

  server.tool(
    "check_task_status",
    "Check the status of a long-running media generation task using its job ID.",
    {
      provider: z.string().describe("The provider used for generation, e.g., 'apimart', 'replicate'"),
      jobId: z.string().describe("The task/job ID returned from the generation tool")
    },
    async (args) => toToolResult(await mediaService.checkTaskStatus(args.provider, args.jobId))
  );

  return server;
}

function toToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

// ── Streamable HTTP transport ────────────────────────────────────────

const app = express();
app.use(express.json());

// Track transports by session ID for session reuse
const transports = new Map<string, StreamableHTTPServerTransport>();

app.all("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      }
    });

    transport.onclose = () => {
      if (transport!.sessionId) {
        transports.delete(transport!.sessionId);
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(appEnv.mcpPort, () => {
  console.log(`MCP Server listening on http://localhost:${appEnv.mcpPort}/mcp`);
});
