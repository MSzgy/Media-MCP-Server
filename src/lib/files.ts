import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface SavedArtifact {
  path: string;
  contentType?: string;
}

export async function saveBase64Artifact(args: {
  outputDir: string;
  prefix: string;
  base64: string;
  extension: string;
  contentType?: string;
}): Promise<SavedArtifact> {
  await mkdir(args.outputDir, { recursive: true });

  const filePath = path.resolve(
    args.outputDir,
    `${args.prefix}-${randomUUID()}.${stripDot(args.extension)}`
  );

  await writeFile(filePath, Buffer.from(args.base64, "base64"));

  return {
    path: filePath,
    contentType: args.contentType
  };
}

export async function saveBinaryArtifact(args: {
  outputDir: string;
  prefix: string;
  data: Buffer;
  extension: string;
  contentType?: string;
}): Promise<SavedArtifact> {
  await mkdir(args.outputDir, { recursive: true });

  const filePath = path.resolve(
    args.outputDir,
    `${args.prefix}-${randomUUID()}.${stripDot(args.extension)}`
  );

  await writeFile(filePath, args.data);

  return {
    path: filePath,
    contentType: args.contentType
  };
}

export function extensionFromContentType(contentType?: string | null, fallback = "bin"): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    default:
      return fallback;
  }
}

function stripDot(value: string): string {
  return value.startsWith(".") ? value.slice(1) : value;
}
