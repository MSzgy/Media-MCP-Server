import { HttpRequestError } from "./errors.js";

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
}

export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000)
  });

  const text = await response.text();
  const payload = text.length > 0 ? safeParseJson(text) : undefined;

  if (!response.ok) {
    throw new HttpRequestError(
      `Request failed with status ${response.status}`,
      response.status,
      payload ?? text
    );
  }

  return (payload as T) ?? ({} as T);
}

export async function fetchBinary(
  url: string,
  options: RequestOptions = {}
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new HttpRequestError(
      `Request failed with status ${response.status}`,
      response.status,
      safeParseJson(errorText) ?? errorText
    );
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")
  };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
