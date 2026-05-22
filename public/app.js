const state = {
  token: localStorage.getItem("mediaMcpToken") || "",
  models: [],
  tools: [],
  visibleTools: [],
  apiKeys: [],
  apiMartUsage: null,
  keySelectionMode: "manual",
  activeKeyId: null,
  apiKeysLocked: false
};

const APIMART_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

const $ = (id) => document.getElementById(id);

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const headers = {
    ...authHeaders(),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return data;
}

function setStatus(text) {
  $("serverStatus").textContent = text;
}

function setRunStatus(text) {
  $("runStatus").textContent = text;
}

function activeModel() {
  const id = $("modelSelect").value;
  return state.models.find((model) => model.id === id);
}

function modelDefaults(model) {
  return model?.defaults || {};
}

function isApiMartTtsModel(model = activeModel()) {
  return model?.provider === "apimart"
    && model?.capability === "audio"
    && model?.model !== "whisper-1";
}

function numberValue(id) {
  const value = $(id).value.trim();
  return value === "" ? undefined : Number(value);
}

function stringValue(id) {
  const value = $(id).value.trim();
  return value || undefined;
}

function parseAdvancedInput() {
  const raw = $("advancedInput").value.trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function setFieldValue(id, value) {
  const element = $(id);
  if (!element) {
    return;
  }
  element.value = value == null ? "" : String(value);
}

function applyVoiceControl(defaultVoice) {
  const useApiMartSelect = isApiMartTtsModel();
  $("voiceIdSelect").classList.toggle("is-hidden", !useApiMartSelect);
  $("voiceId").classList.toggle("is-hidden", useApiMartSelect);

  if (useApiMartSelect) {
    $("voiceIdSelect").value = APIMART_TTS_VOICES.includes(defaultVoice)
      ? defaultVoice
      : "alloy";
    return;
  }

  setFieldValue("voiceId", defaultVoice);
}

function voiceValue() {
  return isApiMartTtsModel()
    ? stringValue("voiceIdSelect")
    : stringValue("voiceId");
}

function populateModels() {
  const capability = $("capability").value;
  const models = state.models.filter((model) => model.capability === capability);
  $("modelSelect").innerHTML = models
    .map((model) => `<option value="${model.id}">${model.provider} · ${model.title}</option>`)
    .join("");
  applyCapabilityFields();
  applyModelDefaults();
}

function applyCapabilityFields() {
  const capability = $("capability").value;
  $("imageFields").classList.toggle("is-hidden", capability !== "image");
  $("videoFields").classList.toggle("is-hidden", capability !== "video");
  $("audioFields").classList.toggle("is-hidden", capability !== "audio");
}

function applyModelDefaults() {
  const defaults = modelDefaults(activeModel());
  setFieldValue("aspectRatio", defaults.aspectRatio);
  setFieldValue("imageSize", defaults.imageSize);
  setFieldValue("outputFormat", defaults.outputFormat);
  setFieldValue("count", defaults.count);
  setFieldValue("personGeneration", defaults.personGeneration);
  setFieldValue("waitSeconds", defaults.waitSeconds);
  applyVoiceControl(defaults.voiceId);
  setFieldValue("outputFormatAudio", defaults.outputFormat);
  setFieldValue("audioSpeed", defaults.speed);
}

function buildGeneratePayload() {
  const model = activeModel();
  if (!model) {
    throw new Error("No model selected");
  }

  const capability = $("capability").value;
  const input = parseAdvancedInput();
  const payload = {
    capability,
    provider: model.provider,
    model: model.model,
    prompt: $("prompt").value.trim(),
    input
  };

  if (capability === "image") {
    Object.assign(payload, {
      aspectRatio: stringValue("aspectRatio"),
      imageSize: stringValue("imageSize"),
      outputFormat: stringValue("outputFormat"),
      count: numberValue("count"),
      personGeneration: stringValue("personGeneration"),
      outputCompression: numberValue("outputCompression")
    });
  }

  if (capability === "video") {
    Object.assign(payload, {
      aspectRatio: stringValue("videoAspectRatio"),
      resolution: stringValue("resolution"),
      duration: numberValue("duration"),
      waitSeconds: numberValue("waitSeconds"),
      image: stringValue("referenceImage")
    });
  }

  if (capability === "audio") {
    Object.assign(payload, {
      voiceId: voiceValue(),
      outputFormatAudio: stringValue("outputFormatAudio"),
      audioFilePath: stringValue("audioFilePath"),
      languageCode: stringValue("languageCode"),
      speed: numberValue("audioSpeed")
    });
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === "") {
      delete payload[key];
    }
  });
  return payload;
}

function renderAssets(assets = []) {
  $("assetGrid").innerHTML = assets.map((asset) => {
    const url = asset.publicUrl || asset.url;
    const type = asset.contentType || "";
    if (!url) {
      return `<article class="asset"><a>${asset.path || "No public URL"}</a></article>`;
    }
    if (type.startsWith("image/")) {
      return `<article class="asset"><img src="${url}" alt="Generated image" /></article>`;
    }
    if (type.startsWith("video/")) {
      return `<article class="asset"><video src="${url}" controls></video></article>`;
    }
    if (type.startsWith("audio/")) {
      return `<article class="asset"><audio src="${url}" controls></audio></article>`;
    }
    return `<article class="asset"><a href="${url}" target="_blank" rel="noreferrer">${url}</a></article>`;
  }).join("");
}

function renderResult(result) {
  renderAssets(result.assets || []);
  $("resultJson").textContent = JSON.stringify(result, null, 2);
}

async function runGenerate(event) {
  event.preventDefault();
  setRunStatus("Running");
  $("runButton").disabled = true;
  try {
    const result = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(buildGeneratePayload())
    });
    renderResult(result);
    setRunStatus(result.status || "Done");
  } catch (error) {
    setRunStatus("Failed");
    renderResult({ error: error.message });
  } finally {
    $("runButton").disabled = false;
  }
}

function toolMatchesFilters(tool) {
  const query = $("toolSearch").value.trim().toLowerCase();
  const filter = $("toolFilter").value;
  const matchesQuery = !query || `${tool.name} ${tool.title} ${tool.model || ""}`.toLowerCase().includes(query);
  const matchesFilter = filter === "all" || tool.capability === filter;
  return matchesQuery && matchesFilter;
}

function renderTools() {
  state.visibleTools = state.tools.filter(toolMatchesFilters);
  $("toolStats").textContent = `${state.tools.filter((tool) => tool.enabled).length}/${state.tools.length} enabled`;
  $("toolList").innerHTML = state.visibleTools.map((tool) => `
    <label class="tool-item">
      <input type="checkbox" data-tool="${tool.name}" ${tool.enabled ? "checked" : ""} />
      <span>
        <span class="tool-title">${tool.title}</span>
        <span class="tool-name">${tool.name}</span>
        <span class="tool-meta">
          <span class="tag">${tool.provider}</span>
          <span class="tag">${tool.capability}</span>
          ${tool.model ? `<span class="tag">${tool.model}</span>` : ""}
        </span>
      </span>
    </label>
  `).join("");
}

function setVisibleToolState(enabled) {
  const visibleNames = new Set(state.visibleTools.map((tool) => tool.name));
  state.tools = state.tools.map((tool) => visibleNames.has(tool.name) ? { ...tool, enabled } : tool);
  renderTools();
}

async function loadToolSettings() {
  const settings = await api("/api/tool-settings");
  state.tools = settings.tools;
  $("saveTools").disabled = settings.lockedByEnv;
  $("enableVisible").disabled = settings.lockedByEnv;
  $("disableVisible").disabled = settings.lockedByEnv;
  $("toolNotice").textContent = settings.lockedByEnv
    ? "MCP_EXPOSED_TOOLS is set; UI editing is locked."
    : "Save changes, then reconnect the MCP client.";
  renderTools();
}

async function saveToolSettings() {
  const result = await api("/api/tool-settings", {
    method: "POST",
    body: JSON.stringify({
      enabledTools: state.tools.filter((tool) => tool.enabled).map((tool) => tool.name)
    })
  });
  state.tools = result.tools;
  $("toolNotice").textContent = "Saved. Reconnect the MCP client to refresh tool schemas.";
  renderTools();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function renderKeyUsageStats(stats = {}) {
  const byModel = stats.byModel || {};
  const modelRows = Object.entries(byModel)
    .sort(([, a], [, b]) => b - a)
    .map(([model, count]) => `
      <div class="usage-row">
        <span>${escapeHtml(model)}</span>
        <strong>${count}</strong>
      </div>
    `)
    .join("");

  return `
    <div class="usage-stats">
      <div class="usage-summary">
        <span>Total calls</span>
        <strong>${stats.total || 0}</strong>
      </div>
      ${stats.lastUsedAt ? `<span class="tool-name">Last used ${escapeHtml(new Date(stats.lastUsedAt).toLocaleString())}</span>` : ""}
      <div class="usage-models">
        ${modelRows || '<span class="tool-name">No model usage yet</span>'}
      </div>
    </div>
  `;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function usageRows(entries, emptyText) {
  const rows = Object.entries(entries || {})
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => `
      <div class="usage-row">
        <span>${escapeHtml(label)}</span>
        <strong>${count}</strong>
      </div>
    `)
    .join("");
  return rows || `<span class="tool-name">${emptyText}</span>`;
}

function renderApiMartUsage() {
  const payload = state.apiMartUsage || {};
  const stats = payload.usageStats || {};
  const recentCalls = stats.recentCalls || [];
  $("apimartUsageStats").textContent = `${stats.total || 0} API calls · ${stats.success || 0} success · ${stats.failed || 0} failed`;
  $("apimartUsageNotice").textContent = payload.configured
    ? `Base URL: ${payload.baseUrl}`
    : "APIMART_API_KEY is not configured. Usage will appear after ApiMart calls are made.";

  $("apimartUsageOverview").innerHTML = `
    <article class="usage-card">
      <span>Total</span>
      <strong>${stats.total || 0}</strong>
    </article>
    <article class="usage-card">
      <span>Success</span>
      <strong>${stats.success || 0}</strong>
    </article>
    <article class="usage-card">
      <span>Failed</span>
      <strong>${stats.failed || 0}</strong>
    </article>
    <article class="usage-card">
      <span>Last used</span>
      <strong>${escapeHtml(formatDateTime(stats.lastUsedAt))}</strong>
    </article>
  `;
  $("apimartModelUsage").innerHTML = usageRows(stats.byModel, "No model usage yet");
  $("apimartEndpointUsage").innerHTML = usageRows(stats.byEndpoint, "No endpoint usage yet");
  $("apimartRecentUsage").innerHTML = recentCalls.length
    ? recentCalls.map((call) => `
      <div class="usage-call">
        <div>
          <span class="tool-title">${escapeHtml(call.method)} ${escapeHtml(call.endpoint)}</span>
          <span class="tool-name">${escapeHtml(call.model || call.capability)} · ${escapeHtml(formatDateTime(call.at))}</span>
        </div>
        <span class="tag ${call.ok ? "tag-success" : "tag-failed"}">${call.ok ? "OK" : "Failed"}${call.statusCode ? ` ${call.statusCode}` : ""}</span>
      </div>
    `).join("")
    : '<span class="tool-name">No recent ApiMart calls</span>';
}

async function loadApiMartUsage() {
  state.apiMartUsage = await api("/api/apimart-usage");
  renderApiMartUsage();
}

async function loadApiKeys() {
  const data = await api("/api/api-keys");
  state.apiKeys = data.keys;
  state.keySelectionMode = data.selectionMode;
  state.activeKeyId = data.activeKeyId;
  state.apiKeysLocked = data.lockedByEnv;
  renderApiKeys();
}

function renderApiKeys() {
  const totalCalls = state.apiKeys.reduce((sum, key) => sum + (key.usageStats?.total || 0), 0);
  $("apiKeysStats").textContent = `${state.apiKeys.filter(k => k.enabled).length}/${state.apiKeys.length} keys enabled · ${totalCalls} Google calls`;
  $("saveApiKeys").disabled = state.apiKeysLocked;
  $("addApiKey").disabled = state.apiKeysLocked;
  $("keySelectionMode").disabled = state.apiKeysLocked;
  $("keySelectionMode").value = state.keySelectionMode;
  $("apiKeysNotice").textContent = state.apiKeysLocked
    ? "GOOGLE_API_KEYS is set; UI editing is locked."
    : state.apiKeys.length === 0
      ? "No API keys configured. Add one or set GOOGLE_API_KEY / GOOGLE_API_KEYS env vars."
      : "";

  $("apiKeyList").innerHTML = state.apiKeys.map(key => `
    <label class="tool-item">
      <input type="radio"
             name="activeKey"
             data-key-id="${escapeHtml(key.id)}"
             ${state.activeKeyId === key.id ? "checked" : ""}
             ${state.keySelectionMode !== "manual" ? "disabled" : ""} />
      <div class="key-info">
        <span class="tool-title">${escapeHtml(key.label)}</span>
        <span class="tool-name">${escapeHtml(key.maskedPreview)}</span>
        <span class="tool-meta">
          <span class="tag">${escapeHtml(key.source)}</span>
          <span class="tag">${key.usageStats?.total || 0} calls</span>
          ${key.enabled
            ? '<span class="tag" style="background:var(--accent);color:var(--accent-ink)">Active</span>'
            : '<span class="tag">Disabled</span>'}
        </span>
        ${renderKeyUsageStats(key.usageStats)}
      </div>
      ${key.source === 'ui' && !state.apiKeysLocked ? `
        <button class="delete-key" data-key-id="${escapeHtml(key.id)}" type="button">Remove</button>
      ` : ''}
    </label>
  `).join("");
}

async function saveApiKeysSettings() {
  const keys = state.apiKeys.filter(k => k.source === "ui").map(k => ({
    id: k.id,
    label: k.label,
    rawKey: k.rawKey,
    enabled: k.enabled
  }));
  const result = await api("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({
      keys,
      selectionMode: state.keySelectionMode,
      activeKeyId: state.activeKeyId
    })
  });
  state.apiKeys = result.keys;
  state.keySelectionMode = result.selectionMode;
  state.activeKeyId = result.activeKeyId;
  renderApiKeys();
}

async function loadModels() {
  const data = await api("/api/models");
  state.models = data.models;
  populateModels();
}

async function loadStatus() {
  const status = await api("/api/status");
  setStatus(`${status.providers.length} providers · ${status.toolExposure.enabledCount}/${status.toolExposure.totalCount} tools exposed`);
}

async function boot() {
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    state.token = urlToken;
    localStorage.setItem("mediaMcpToken", urlToken);
    window.history.replaceState(null, "", "/ui");
  }
  $("adminToken").value = "";
  $("adminToken").placeholder = state.token ? "Token saved" : "MCP token";

  try {
    const auth = await fetch("/api/auth-required").then((response) => response.json());
    if (auth.authRequired && !state.token) {
      setStatus("Token required");
      return;
    }
    await Promise.all([loadStatus(), loadModels(), loadToolSettings(), loadApiKeys(), loadApiMartUsage()]);
  } catch (error) {
    setStatus(error.message);
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("is-active"));
    button.classList.add("is-active");
    $(`${button.dataset.tab}Panel`).classList.add("is-active");
  });
});

$("saveToken").addEventListener("click", async () => {
  state.token = $("adminToken").value.trim();
  localStorage.setItem("mediaMcpToken", state.token);
  await boot();
});

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.token = $("adminToken").value.trim();
  localStorage.setItem("mediaMcpToken", state.token);
  await boot();
});

$("capability").addEventListener("change", populateModels);
$("modelSelect").addEventListener("change", applyModelDefaults);
$("generateForm").addEventListener("submit", runGenerate);
$("clearResult").addEventListener("click", () => renderResult({}));
$("toolSearch").addEventListener("input", renderTools);
$("toolFilter").addEventListener("change", renderTools);
$("enableVisible").addEventListener("click", () => setVisibleToolState(true));
$("disableVisible").addEventListener("click", () => setVisibleToolState(false));
$("saveTools").addEventListener("click", saveToolSettings);
$("toolList").addEventListener("change", (event) => {
  if (!event.target.matches("[data-tool]")) {
    return;
  }
  state.tools = state.tools.map((tool) =>
    tool.name === event.target.dataset.tool
      ? { ...tool, enabled: event.target.checked }
      : tool
  );
  renderTools();
});

$("keySelectionMode").addEventListener("change", () => {
  state.keySelectionMode = $("keySelectionMode").value;
  renderApiKeys();
});

$("addApiKey").addEventListener("click", () => {
  $("apiKeyForm").classList.remove("is-hidden");
  $("newKeyLabel").value = "";
  $("newKeyValue").value = "";
  $("newKeyLabel").focus();
});

$("cancelKeyForm").addEventListener("click", () => {
  $("apiKeyForm").classList.add("is-hidden");
});

$("submitKeyForm").addEventListener("click", () => {
  const label = $("newKeyLabel").value.trim();
  const rawKey = $("newKeyValue").value.trim();
  if (!label || !rawKey) {
    return;
  }
  state.apiKeys.push({
    id: undefined,
    label,
    rawKey,
    maskedPreview: rawKey.slice(0, 4) + "..." + rawKey.slice(-4),
    source: "ui",
    enabled: true
  });
  $("apiKeyForm").classList.add("is-hidden");
  if (!state.activeKeyId) {
    state.activeKeyId = state.apiKeys[0]?.id ?? null;
  }
  renderApiKeys();
});

$("saveApiKeys").addEventListener("click", saveApiKeysSettings);
$("refreshApiMartUsage").addEventListener("click", loadApiMartUsage);

$("apiKeyList").addEventListener("click", (event) => {
  if (event.target.classList.contains("delete-key")) {
    const keyId = event.target.dataset.keyId;
    state.apiKeys = state.apiKeys.filter((k) => k.id !== keyId);
    if (state.activeKeyId === keyId) {
      state.activeKeyId = state.apiKeys.find((k) => k.enabled)?.id ?? null;
    }
    renderApiKeys();
  }
});

$("apiKeyList").addEventListener("change", (event) => {
  if (event.target.name === "activeKey") {
    state.activeKeyId = event.target.dataset.keyId;
  }
});

boot();
