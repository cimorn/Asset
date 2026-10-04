import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { envPath as defaultEnvFilePath } from '../config-path.mjs';

const DEFAULT_API_BASE_URL = 'https://open.feishu.cn/open-apis';
const TOKEN_REFRESH_SKEW_MS = 60_000;
const AUTH_ERROR_CODES = new Set([99991661, 99991663, 99991668]);
const TRANSIENT_CODES = new Set([
  99991400,
  99991401,
  99991402,
  1254290,
  1255001,
  1255002,
  1255003,
]);
const REQUIRED_ENV_KEYS = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_WIKI_ROOT_TOKEN',
  'FEISHU_DRIVE_ROOT_TOKEN',
  'FEISHU_WEB_BASE_URL',
];
const ALLOWED_ENV_KEYS = new Set([...REQUIRED_ENV_KEYS, 'FEISHU_API_BASE_URL']);
const OFFICIAL_API_BASE_URLS = new Set([
  'https://open.feishu.cn/open-apis',
  'https://open.larksuite.com/open-apis',
]);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATIC_PATH_SEGMENTS = new Set([
  'apps', 'auth', 'batch_create', 'batch_query', 'batch_update', 'bitable', 'blocks',
  'children', 'create_folder', 'docx', 'documents', 'drive', 'fields', 'files', 'get_node',
  'metas', 'move_docs_to_wiki', 'nodes', 'records', 'search', 'spaces', 'tables', 'tasks',
  'update_title',
  'v1', 'v2', 'v3', 'views', 'wiki',
]);

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function hasText(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function normalizedText(value) {
  return hasText(value) ? value.trim() : null;
}

function trimBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a finite integer between ${min} and ${max}`);
  }
  return value;
}

function officialApiBaseUrl(value) {
  const baseUrl = trimBaseUrl(requireText(value, 'FEISHU_API_BASE_URL'));
  if (!OFFICIAL_API_BASE_URLS.has(baseUrl)) {
    throw new TypeError('FEISHU_API_BASE_URL must be an official HTTPS API base');
  }
  return baseUrl;
}

function officialTenantWebBaseUrl(value) {
  const raw = requireText(value, 'FEISHU_WEB_BASE_URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError('FEISHU_WEB_BASE_URL must be an official Feishu tenant HTTPS origin');
  }
  const officialHost = /(?:^|\.)(?:feishu\.cn|larksuite\.com)$/iu.test(url.hostname);
  if (
    url.protocol !== 'https:'
    || !officialHost
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || !['', '/'].includes(url.pathname)
  ) throw new TypeError('FEISHU_WEB_BASE_URL must be an official Feishu tenant HTTPS origin');
  return url.origin;
}

function requireClientToken(value, label = 'clientToken') {
  const token = requireText(value, label);
  if (!UUID_V4_PATTERN.test(token)) throw new TypeError(`${label} must be a UUIDv4`);
  return token;
}

function requirePersistedClientToken(value, label = 'clientToken') {
  if (!hasText(value)) {
    throw new TypeError(`caller must provide a persisted ${label}`);
  }
  return requireClientToken(value, label);
}

function serializeJsonBody(value, label = 'request body') {
  const ancestors = new Set();
  const validate = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('non-finite number');
      return;
    }
    if (typeof item !== 'object') throw new TypeError('unsupported JSON value');
    if (ancestors.has(item)) throw new TypeError('cyclic JSON value');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('unsupported JSON object');
    }
    ancestors.add(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable) continue;
      if (typeof key === 'symbol') throw new TypeError('symbol JSON key');
      validate(item[key]);
    }
    ancestors.delete(item);
  };

  try {
    validate(value);
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new TypeError('empty JSON serialization');
    return serialized;
  } catch {
    throw new TypeError(`${label} must contain only JSON-serializable values and finite JSON numbers`);
  }
}

function safeResourceId(value) {
  return `id:${createHash('sha256').update(requireText(value, 'resource ID')).digest('hex').slice(0, 12)}`;
}

function addSecretVariants(target, value) {
  const text = String(value ?? '');
  if (text.length < 4) return;
  target.add(text);
  target.add(encodeURIComponent(text));
}

function addExplicitSecretVariants(target, value) {
  const text = String(value ?? '');
  if (!text) return;
  target.add(text);
  target.add(encodeURIComponent(text));
}

function collectStrings(target, value) {
  if (typeof value === 'string') {
    addSecretVariants(target, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(target, item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(target, item);
  }
}

function requestSecrets(pathname, query, body, serializedBody, url) {
  const secrets = new Set();
  addSecretVariants(secrets, String(url));
  addSecretVariants(secrets, serializedBody);
  for (const segment of pathname.split('/').filter(Boolean)) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Keep the encoded segment; invalid paths will fail at the API boundary.
    }
    if (!STATIC_PATH_SEGMENTS.has(decoded)) addSecretVariants(secrets, decoded);
  }
  collectStrings(secrets, query);
  collectStrings(secrets, body);
  return [...secrets].sort((left, right) => right.length - left.length);
}

function explicitlySensitiveRequestSecrets(values) {
  if (!Array.isArray(values)) throw new TypeError('sensitiveValues must be an array');
  const secrets = new Set();
  for (const value of values) addExplicitSecretVariants(secrets, value);
  return [...secrets].sort((left, right) => right.length - left.length);
}

function ambiguousHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMilliseconds(response, now = Date.now) {
  const value = response?.headers?.get?.('retry-after');
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60_000, Math.ceil(seconds * 1000));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(60_000, Math.max(0, timestamp - now()));
}

function recoveryForClientToken(clientToken, chunkIndex = null) {
  if (!clientToken) return null;
  return Object.freeze({
    instruction: 'retry_with_persisted_client_token',
    clientTokenId: safeResourceId(clientToken),
    ...(chunkIndex === null ? {} : { chunkIndex }),
  });
}

function redact(value, secrets = []) {
  let text = String(value ?? '');
  text = text.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]');
  text = text.replace(
    /((?:authorization|app_secret|tenant_access_token|access_token|client_secret|secret)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    '$1[REDACTED]',
  );
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

function readSafeJson(response, secrets) {
  return response.json().catch((cause) => {
    throw new FeishuApiError('Feishu returned a non-JSON response', {
      status: response.status,
      requestId: response.headers?.get?.('x-tt-logid') ?? null,
      secrets,
      cause,
    });
  });
}

function safeName(item, key) {
  if (typeof key === 'function') return key(item);
  return item?.[key];
}

function page(data, itemKey = 'items', { allowMissingEmptyItems = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FeishuApiError('Feishu pagination data was malformed', { code: 'malformed_response' });
  }
  const tokenKeys = ['page_token', 'next_page_token'].filter((key) => Object.hasOwn(data, key));
  const terminalTokenIsEmpty = tokenKeys.length === 0
    || tokenKeys.every((key) => typeof data[key] === 'string' && data[key].trim() === '');
  const missingTerminalItems = allowMissingEmptyItems
    && !Object.hasOwn(data, itemKey)
    && data.has_more === false
    && terminalTokenIsEmpty;
  if ((!Array.isArray(data[itemKey]) && !missingTerminalItems) || typeof data.has_more !== 'boolean') {
    throw new FeishuApiError('Feishu pagination shape was malformed', { code: 'malformed_response' });
  }
  const pageToken = data.page_token ?? data.next_page_token ?? null;
  if (data.has_more && !hasText(pageToken)) {
    throw new FeishuApiError('Feishu pagination continuation was malformed', { code: 'malformed_response' });
  }
  return {
    items: missingTerminalItems ? [] : data[itemKey],
    hasMore: data.has_more,
    pageToken: hasText(pageToken) ? pageToken.trim() : null,
  };
}

function encode(value) {
  return encodeURIComponent(requireText(value, 'Feishu resource identifier'));
}

function normalizeFile(item = {}) {
  return {
    token: normalizedText(item.token ?? item.file_token ?? item.folder_token ?? item.doc_token),
    name: normalizedText(item.name ?? item.title),
    type: normalizedText(item.type ?? item.doc_type),
    url: normalizedText(item.url),
  };
}

function normalizeApp(item = {}) {
  return {
    appToken: normalizedText(item.app_token ?? item.token),
    name: normalizedText(item.name),
    url: normalizedText(item.url),
    ...(hasText(item.default_table_id) ? { defaultTableId: item.default_table_id.trim() } : {}),
  };
}

function normalizeTable(item = {}) {
  return { tableId: normalizedText(item.table_id ?? item.id), name: normalizedText(item.name) };
}

function normalizeFieldProperty(property) {
  if (property === null || property === undefined) return null;
  const cloned = structuredClone(property);
  if (
    cloned
    && typeof cloned === 'object'
    && !Array.isArray(cloned)
    && Object.keys(cloned).length === 0
  ) return null;
  return cloned;
}

function normalizeField(item = {}) {
  return {
    fieldId: normalizedText(item.field_id ?? item.id),
    name: normalizedText(item.field_name ?? item.name),
    type: item.type ?? null,
    isPrimary: item.is_primary === true,
    property: normalizeFieldProperty(item.property),
  };
}

function normalizeView(item = {}) {
  return {
    viewId: normalizedText(item.view_id ?? item.id),
    name: normalizedText(item.view_name ?? item.name),
    type: normalizedText(item.view_type ?? item.type),
  };
}

function normalizeRecord(item = {}) {
  return { recordId: normalizedText(item.record_id ?? item.id), fields: item.fields ?? {} };
}

function normalizeWikiNode(item = {}) {
  return {
    ...(item.space_id === undefined ? {} : { spaceId: normalizedText(item.space_id) }),
    nodeToken: normalizedText(item.node_token),
    objToken: normalizedText(item.obj_token),
    type: normalizedText(item.obj_type),
    parentNodeToken: normalizedText(item.parent_node_token),
    nodeType: normalizedText(item.node_type),
    title: normalizedText(item.title),
  };
}

export class FeishuApiError extends Error {
  constructor(message, {
    code = null,
    status = null,
    requestId = null,
    uncertain = false,
    retriable = false,
    partialReceipt = null,
    recovery = null,
    secrets = [],
    cause,
  } = {}) {
    const safeCause = cause === undefined
      ? undefined
      : new Error(redact(cause instanceof Error ? cause.message : cause, secrets));
    super(redact(message, secrets), safeCause === undefined ? undefined : { cause: safeCause });
    this.name = 'FeishuApiError';
    this.code = typeof code === 'string' ? redact(code, secrets) : code;
    this.status = status;
    this.requestId = requestId === null ? null : redact(requestId, secrets);
    this.uncertain = Boolean(uncertain);
    this.retriable = Boolean(retriable);
    this.partialReceipt = partialReceipt;
    this.recovery = recovery;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      requestId: this.requestId,
      uncertain: this.uncertain,
      retriable: this.retriable,
      ...(this.partialReceipt === null ? {} : { partialReceipt: this.partialReceipt }),
      ...(this.recovery === null ? {} : { recovery: this.recovery }),
    };
  }
}

export function loadFeishuEnvironment({ envFilePath = defaultEnvFilePath } = {}) {
  let source;
  try {
    source = readFileSync(envFilePath, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      throw new FeishuApiError('Feishu environment file was not found');
    }
    throw new FeishuApiError('Feishu environment file could not be read');
  }

  return parseFeishuEnvironment(source);
}

export function parseFeishuEnvironment(source) {
  const parsed = parseEnv(source);
  const selected = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (ALLOWED_ENV_KEYS.has(key)) selected[key] = value;
  }
  for (const key of REQUIRED_ENV_KEYS) requireText(selected[key], key);

  const config = {
    appId: selected.FEISHU_APP_ID.trim(),
    apiBaseUrl: officialApiBaseUrl(selected.FEISHU_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL),
    tenantWebBaseUrl: officialTenantWebBaseUrl(selected.FEISHU_WEB_BASE_URL),
  };
  for (const [property, value] of [
    ['appSecret', selected.FEISHU_APP_SECRET],
    ['wikiRootToken', selected.FEISHU_WIKI_ROOT_TOKEN],
    ['driveRootToken', selected.FEISHU_DRIVE_ROOT_TOKEN],
  ]) {
    Object.defineProperty(config, property, {
      value: value.trim(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(config);
}

export function exactNameSingleton(items, name, { nameKey = 'name', kind = 'resource' } = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  const matches = items.filter((item) => safeName(item, nameKey) === name);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  throw new FeishuApiError(`Ambiguous ${kind}: multiple exact-name matches`, {
    code: 'ambiguous_resource',
  });
}

export function chunkItems(items, size = 500) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Number.isInteger(size) || size < 1 || size > 500) {
    throw new RangeError('chunk size must be an integer between 1 and 500');
  }
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function resourceNameSuffix(appId) {
  return createHash('sha256').update(requireText(appId, 'appId')).digest('hex').slice(0, 8);
}

function safeReceiptChunk(chunk, status) {
  return Object.freeze({
    chunkIndex: requireInteger(chunk.chunkIndex, 'chunkIndex'),
    status,
    clientTokenId: safeResourceId(requireClientToken(chunk.clientToken)),
    resourceIds: Object.freeze((chunk.resourceIds ?? []).map(safeResourceId)),
    recordIds: Object.freeze((chunk.recordIds ?? []).map(safeResourceId)),
  });
}

export function makeWriteReceipt({ operation, completedChunks = [], currentChunk = null }) {
  if (!Array.isArray(completedChunks)) throw new TypeError('completedChunks must be an array');
  const receipt = {
    operation: requireText(operation, 'operation'),
    completedChunks: Object.freeze(completedChunks.map((chunk) => safeReceiptChunk(chunk, 'completed'))),
    currentChunk: currentChunk === null ? null : safeReceiptChunk(currentChunk, 'uncertain'),
    recovery: 'reuse_caller_persisted_client_tokens_by_chunk_index',
  };
  return Object.freeze(receipt);
}

export class FeishuApiClient {
  #appId;
  #appSecret;
  #apiBaseUrl;
  #fetch;
  #now;
  #sleep;
  #random;
  #maxRetries;
  #authMaxRetries;
  #retryBaseMs;
  #requestTimeoutMs;
  #createAbortSignal;
  #maxPages;
  #maxItems;
  #tokenCache = null;
  #tokenRefreshPromise = null;

  constructor({
    appId,
    appSecret,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    random = Math.random,
    maxRetries = 2,
    authMaxRetries = 2,
    retryBaseMs = 100,
    requestTimeoutMs = 15_000,
    createAbortSignal = (milliseconds) => AbortSignal.timeout(milliseconds),
    maxPages = 1_000,
    maxItems = 10_000,
  }) {
    this.#appId = requireText(appId, 'appId');
    this.#appSecret = requireText(appSecret, 'appSecret');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
    if (typeof random !== 'function') throw new TypeError('random must be a function');
    if (typeof createAbortSignal !== 'function') throw new TypeError('createAbortSignal must be a function');
    this.#apiBaseUrl = trimBaseUrl(requireText(apiBaseUrl, 'apiBaseUrl'));
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#sleep = sleep;
    this.#random = random;
    this.#maxRetries = requireInteger(maxRetries, 'maxRetries', { max: 10 });
    this.#authMaxRetries = requireInteger(authMaxRetries, 'authMaxRetries', { max: 10 });
    this.#retryBaseMs = requireInteger(retryBaseMs, 'retryBaseMs', { max: 60_000 });
    this.#requestTimeoutMs = requireInteger(requestTimeoutMs, 'requestTimeoutMs', { min: 1, max: 300_000 });
    this.#createAbortSignal = createAbortSignal;
    this.#maxPages = requireInteger(maxPages, 'maxPages', { min: 1, max: 10_000 });
    this.#maxItems = requireInteger(maxItems, 'maxItems', { min: 1, max: 1_000_000 });
  }

  async getTenantAccessToken({ forceRefresh = false } = {}) {
    if (
      !forceRefresh
      && this.#tokenCache
      && this.#tokenCache.expiresAt - this.#now() > TOKEN_REFRESH_SKEW_MS
    ) return this.#tokenCache.token;

    if (this.#tokenRefreshPromise) return this.#tokenRefreshPromise;
    const refresh = this.#fetchTenantAccessToken();
    this.#tokenRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.#tokenRefreshPromise === refresh) this.#tokenRefreshPromise = null;
    }
  }

  invalidateTenantAccessToken(token) {
    if (token !== undefined && this.#tokenCache?.token !== token) return;
    this.#tokenCache = null;
  }

  async #fetchTenantAccessToken() {
    const url = `${this.#apiBaseUrl}/auth/v3/tenant_access_token/internal`;
    const body = JSON.stringify({ app_id: this.#appId, app_secret: this.#appSecret });
    let retryCount = 0;
    while (true) {
      let response;
      try {
        response = await this.#fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: this.#createAbortSignal(this.#requestTimeoutMs),
        });
      } catch (cause) {
        if (retryCount < this.#authMaxRetries) {
          await this.#backoff(retryCount);
          retryCount += 1;
          continue;
        }
        throw new FeishuApiError('Feishu authentication request failed after retries', {
          retriable: true,
          secrets: [this.#appSecret],
          cause,
        });
      }

      let payload;
      try {
        payload = await readSafeJson(response, [this.#appSecret]);
      } catch (cause) {
        const transient = ambiguousHttpStatus(response.status) || response.ok;
        if (transient && retryCount < this.#authMaxRetries) {
          await this.#backoff(retryCount, response);
          retryCount += 1;
          continue;
        }
        throw new FeishuApiError('Feishu authentication returned a non-JSON response', {
          status: response.status,
          requestId: response.headers?.get?.('x-tt-logid') ?? null,
          retriable: transient,
          secrets: [this.#appSecret],
          cause,
        });
      }

      const transient = ambiguousHttpStatus(response.status) || TRANSIENT_CODES.has(payload?.code);
      if ((!response.ok || payload?.code !== 0) && transient && retryCount < this.#authMaxRetries) {
        await this.#backoff(retryCount, response);
        retryCount += 1;
        continue;
      }
      if (!response.ok || payload?.code !== 0 || !hasText(payload?.tenant_access_token)) {
        throw this.#responseError('Feishu authentication failed', response, payload, [this.#appSecret], {
          retriable: transient,
        });
      }
      const expireSeconds = Number(payload.expire);
      if (!Number.isFinite(expireSeconds) || expireSeconds <= 0) {
        throw new FeishuApiError('Feishu authentication response was malformed', {
          code: 'malformed_response',
          secrets: [this.#appSecret, payload.tenant_access_token],
        });
      }
      this.#tokenCache = {
        token: payload.tenant_access_token.trim(),
        expiresAt: this.#now() + expireSeconds * 1000,
      };
      return this.#tokenCache.token;
    }
  }

  async #request(pathname, {
    method = 'GET',
    query,
    body,
    preSerializedBody,
    clientToken,
    idempotent = false,
    isWrite = false,
    chunkIndex = null,
    returnEnvelope = false,
    sensitiveValues = [],
  } = {}) {
    const upperMethod = String(method).toUpperCase();
    const validatedClientToken = clientToken === undefined
      ? undefined
      : requireClientToken(clientToken);
    const safeToRetry = !isWrite || idempotent || Boolean(validatedClientToken);
    const recovery = recoveryForClientToken(validatedClientToken, chunkIndex);
    const finalQuery = { ...(query ?? {}) };
    if (validatedClientToken) finalQuery.client_token = validatedClientToken;
    const url = this.#makeUrl(pathname, finalQuery);
    if (preSerializedBody !== undefined && (body === undefined || typeof preSerializedBody !== 'string')) {
      throw new TypeError('preSerializedBody requires a request body and must be a string');
    }
    const serializedBody = body === undefined
      ? undefined
      : (preSerializedBody ?? serializeJsonBody(body));
    const dynamicSecrets = [
      ...new Set([
        ...requestSecrets(pathname, finalQuery, body, serializedBody, url),
        ...explicitlySensitiveRequestSecrets(sensitiveValues),
      ]),
    ].sort((left, right) => right.length - left.length);
    let retryCount = 0;
    let authRetried = false;

    while (true) {
      const token = await this.getTenantAccessToken();
      const secrets = [this.#appSecret, token, ...dynamicSecrets];
      const headers = { authorization: `Bearer ${token}` };
      if (serializedBody !== undefined) headers['content-type'] = 'application/json';
      let response;
      try {
        response = await this.#fetch(url, {
          method: upperMethod,
          headers,
          ...(serializedBody === undefined ? {} : { body: serializedBody }),
          signal: this.#createAbortSignal(this.#requestTimeoutMs),
        });
      } catch (cause) {
        if (safeToRetry && retryCount < this.#maxRetries) {
          await this.#backoff(retryCount);
          retryCount += 1;
          continue;
        }
        throw new FeishuApiError(
          safeToRetry ? 'Feishu request failed after safe retries' : 'Feishu write outcome is uncertain; re-list before retrying',
          {
            uncertain: isWrite,
            retriable: safeToRetry,
            recovery,
            secrets,
            cause,
          },
        );
      }

      let payload;
      try {
        payload = await readSafeJson(response, secrets);
      } catch (cause) {
        const transientStatus = ambiguousHttpStatus(response.status);
        const ambiguousOutcome = transientStatus || response.ok;
        if (transientStatus && safeToRetry && retryCount < this.#maxRetries) {
          await this.#backoff(retryCount, response);
          retryCount += 1;
          continue;
        }
        throw new FeishuApiError('Feishu returned a non-JSON response', {
          status: response.status,
          requestId: response.headers?.get?.('x-tt-logid') ?? null,
          uncertain: isWrite && ambiguousOutcome,
          retriable: transientStatus && safeToRetry,
          recovery,
          secrets,
          cause,
        });
      }
      const code = payload?.code ?? null;
      if (!authRetried && (response.status === 401 || AUTH_ERROR_CODES.has(code))) {
        authRetried = true;
        this.invalidateTenantAccessToken(token);
        continue;
      }
      const transient = ambiguousHttpStatus(response.status) || TRANSIENT_CODES.has(code);
      const ambiguousOutcome = transient;
      if ((!response.ok || code !== 0) && transient && safeToRetry && retryCount < this.#maxRetries) {
        await this.#backoff(retryCount, response);
        retryCount += 1;
        continue;
      }
      if (!response.ok || code !== 0) {
        throw this.#responseError('Feishu API request failed', response, payload, secrets, {
          uncertain: isWrite && ambiguousOutcome,
          retriable: transient && safeToRetry,
          recovery,
        });
      }
      return returnEnvelope ? payload : (payload.data ?? {});
    }
  }

  async getBotInfo() {
    const payload = await this.#request('/bot/v3/info/', { returnEnvelope: true });
    const name = normalizedText(payload?.bot?.app_name);
    if (!name) throw this.#malformedResponse('Bot info read');
    return Object.freeze({ name });
  }

  async listDriveFiles(folderToken, { pageToken, pageSize = 50 } = {}) {
    const files = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request('/drive/v1/files', {
        query: {
          folder_token: requireText(folderToken, 'folderToken'),
          page_size: Math.min(200, Math.max(1, Number(pageSize) || 50)),
          page_token: nextPageToken,
        },
      });
      return page(data, 'files');
    }, pageToken, normalizeFile);
    if (files.some((file) => !hasText(file.token))) throw this.#malformedResponse('Drive file list');
    return files;
  }

  async createFolder(parentToken, name) {
    const safeParentToken = requireText(parentToken, 'parentToken');
    const safeName = requireText(name, 'name');
    const data = await this.#request('/drive/v1/files/create_folder', {
      method: 'POST',
      isWrite: true,
      body: { name: safeName, folder_token: safeParentToken },
    });
    const folder = normalizeFile(data.folder ?? data);
    if (!hasText(folder.token)) throw this.#malformedResponse('folder create', { isWrite: true });
    return { token: folder.token, name: safeName, url: folder.url };
  }

  async deleteDriveFile(fileToken, type) {
    const safeFileToken = requireText(fileToken, 'fileToken');
    const safeType = requireText(type, 'type');
    if (safeType !== 'bitable') throw new TypeError('type must be bitable');
    const data = await this.#request(`/drive/v1/files/${encode(safeFileToken)}`, {
      method: 'DELETE',
      isWrite: true,
      query: { type: safeType },
      sensitiveValues: [safeFileToken],
    });
    return Object.freeze({
      deleted: true,
      taskId: normalizedText(data.task_id) || null,
    });
  }

  async queryDriveMeta(token, type) {
    const safeToken = requireText(token, 'token');
    const data = await this.#request('/drive/v1/metas/batch_query', {
      method: 'POST',
      idempotent: true,
      body: { request_docs: [{ doc_token: safeToken, doc_type: requireText(type, 'type') }] },
    });
    if (Array.isArray(data.failed_list) && data.failed_list.length > 0) {
      throw new FeishuApiError('Feishu Drive metadata query failed', {
        code: 'drive_meta_query_failed',
        secrets: [safeToken, ...data.failed_list.flatMap((item) => [item?.token, item?.msg])],
      });
    }
    const meta = normalizeFile(data.metas?.[0] ?? {});
    if (!hasText(meta.token)) throw this.#malformedResponse('Drive metadata query');
    return meta;
  }

  async getBitableApp(appToken) {
    const data = await this.#request(`/bitable/v1/apps/${encode(appToken)}`);
    const app = normalizeApp(data.app ?? data);
    if (!hasText(app.appToken)) throw this.#malformedResponse('Bitable app read');
    return app;
  }

  async updateBitableApp(appToken, { name }) {
    const safeAppToken = requireText(appToken, 'appToken');
    const safeName = requireText(name, 'name');
    const data = await this.#request(`/bitable/v1/apps/${encode(safeAppToken)}`, {
      method: 'PUT',
      idempotent: true,
      isWrite: true,
      body: { name: safeName },
      sensitiveValues: [safeAppToken],
    });
    const app = normalizeApp(data.app ?? data);
    if (!hasText(app.appToken) || app.name !== safeName) {
      throw this.#malformedResponse('Bitable app update', { isWrite: true });
    }
    return Object.freeze({ name: safeName });
  }

  async createBitableApp(name, folderToken) {
    const data = await this.#request('/bitable/v1/apps', {
      method: 'POST',
      isWrite: true,
      body: { name: requireText(name, 'name'), folder_token: requireText(folderToken, 'folderToken') },
    });
    const app = normalizeApp(data.app ?? data);
    if (!hasText(app.appToken)) throw this.#malformedResponse('Bitable app create', { isWrite: true });
    return app;
  }

  async listTables(appToken, { pageToken, pageSize = 100 } = {}) {
    const tables = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(`/bitable/v1/apps/${encode(appToken)}/tables`, {
        query: { page_size: Math.min(100, Math.max(1, Number(pageSize) || 100)), page_token: nextPageToken },
      });
      return page(data);
    }, pageToken, normalizeTable);
    if (tables.some((table) => !hasText(table.tableId))) throw this.#malformedResponse('table list');
    return tables;
  }

  async createTable(appToken, table) {
    if (!table || typeof table !== 'object') throw new TypeError('table must be an object');
    const data = await this.#request(`/bitable/v1/apps/${encode(appToken)}/tables`, {
      method: 'POST',
      isWrite: true,
      body: { table: structuredClone(table) },
    });
    if (!hasText(data.table_id)) {
      throw this.#malformedResponse('table create', { isWrite: true });
    }
    return {
      tableId: data.table_id.trim(),
      name: table.name ?? null,
      defaultViewId: data.default_view_id ?? null,
      fieldIds: Array.isArray(data.field_id_list) ? [...data.field_id_list] : [],
    };
  }

  async patchTable(appToken, tableId, changes) {
    if (!changes || typeof changes !== 'object') throw new TypeError('changes must be an object');
    const data = await this.#request(`/bitable/v1/apps/${encode(appToken)}/tables/${encode(tableId)}`, {
      method: 'PATCH',
      idempotent: true,
      isWrite: true,
      body: structuredClone(changes),
    });
    if (!hasText(data.name)) throw this.#malformedResponse('table patch', { isWrite: true });
    return { tableId: requireText(tableId, 'tableId'), name: data.name.trim() };
  }

  async listFields(appToken, tableId, { pageToken, pageSize = 100 } = {}) {
    const fields = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(this.#tablePath(appToken, tableId, '/fields'), {
        query: { page_size: Math.min(100, Math.max(1, Number(pageSize) || 100)), page_token: nextPageToken },
      });
      return page(data);
    }, pageToken, normalizeField);
    if (fields.some((field) => !hasText(field.fieldId))) throw this.#malformedResponse('field list');
    return fields;
  }

  async createField(appToken, tableId, field, { clientToken } = {}) {
    const safeClientToken = requirePersistedClientToken(clientToken);
    const data = await this.#request(this.#tablePath(appToken, tableId, '/fields'), {
      method: 'POST',
      isWrite: true,
      clientToken: safeClientToken,
      body: structuredClone(field),
    });
    const normalized = normalizeField(data.field ?? data);
    if (!hasText(normalized.fieldId)) throw this.#malformedResponse('field create', { isWrite: true, clientToken: safeClientToken });
    return normalized;
  }

  async updateField(appToken, tableId, fieldId, field, { clientToken } = {}) {
    const safeClientToken = requirePersistedClientToken(clientToken);
    const data = await this.#request(`${this.#tablePath(appToken, tableId, '/fields')}/${encode(fieldId)}`, {
      method: 'PUT',
      isWrite: true,
      clientToken: safeClientToken,
      body: structuredClone(field),
    });
    const normalized = normalizeField(data.field ?? data);
    if (!hasText(normalized.fieldId)) throw this.#malformedResponse('field update', { isWrite: true, clientToken: safeClientToken });
    return normalized;
  }

  async deleteField(appToken, tableId, fieldId) {
    const safeFieldId = requireText(fieldId, 'fieldId');
    await this.#request(`${this.#tablePath(appToken, tableId, '/fields')}/${encode(safeFieldId)}`, {
      method: 'DELETE',
      isWrite: true,
    });
    return Object.freeze({ deleted: true });
  }

  async listViews(appToken, tableId, { pageToken, pageSize = 100 } = {}) {
    const views = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(this.#tablePath(appToken, tableId, '/views'), {
        query: { page_size: Math.min(100, Math.max(1, Number(pageSize) || 100)), page_token: nextPageToken },
      });
      return page(data);
    }, pageToken, normalizeView);
    if (views.some((view) => !hasText(view.viewId))) throw this.#malformedResponse('view list');
    return views;
  }

  async createView(appToken, tableId, { name, type }) {
    if (type !== 'kanban' && type !== 'grid') {
      throw new TypeError('view type must be kanban or grid');
    }
    const data = await this.#request(this.#tablePath(appToken, tableId, '/views'), {
      method: 'POST',
      isWrite: true,
      body: { view_name: requireText(name, 'name'), view_type: type },
    });
    const normalized = normalizeView(data.view ?? data);
    if (!hasText(normalized.viewId)) throw this.#malformedResponse('view create', { isWrite: true });
    return normalized;
  }

  async patchView(appToken, tableId, viewId, { name }) {
    const data = await this.#request(
      `${this.#tablePath(appToken, tableId, '/views')}/${encode(viewId)}`,
      {
        method: 'PATCH',
        idempotent: true,
        isWrite: true,
        body: { view_name: requireText(name, 'name') },
      },
    );
    const normalized = normalizeView(data.view ?? data);
    if (!hasText(normalized.viewId)) throw this.#malformedResponse('view patch', { isWrite: true });
    return normalized;
  }

  async searchRecords(appToken, tableId, search = {}, { pageToken, pageSize = 500 } = {}) {
    const records = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(this.#tablePath(appToken, tableId, '/records/search'), {
        method: 'POST',
        idempotent: true,
        query: { page_size: Math.min(500, Math.max(1, Number(pageSize) || 500)), page_token: nextPageToken },
        body: structuredClone(search),
      });
      return page(data);
    }, pageToken, normalizeRecord);
    if (records.some((record) => !hasText(record.recordId))) throw this.#malformedResponse('record search');
    return records;
  }

  async batchCreateRecords(appToken, tableId, records, options = {}) {
    const safeAppToken = requireText(appToken, 'appToken');
    const safeTableId = requireText(tableId, 'tableId');
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const preparedRecords = records.map((record, index) => {
      const fields = record && Object.hasOwn(record, 'fields') ? record.fields : record;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        throw new TypeError(`records[${index}].fields must be an object`);
      }
      return { fields: structuredClone(fields) };
    });
    const chunks = chunkItems(preparedRecords, 500);
    if (chunks.length === 0) return [];
    const clientTokens = this.#persistedClientTokens(options, chunks.length);
    const chunkRequests = chunks.map((chunk, index) => {
      const body = { records: chunk };
      return {
        body,
        preSerializedBody: serializeJsonBody(body, `record batch create chunk ${index} body`),
      };
    });
    const result = [];
    const completedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const clientToken = clientTokens[index];
      const currentChunk = {
        chunkIndex: index,
        clientToken,
        resourceIds: [safeAppToken, safeTableId],
        recordIds: [],
      };
      try {
        const data = await this.#request(this.#tablePath(safeAppToken, safeTableId, '/records/batch_create'), {
          method: 'POST',
          isWrite: true,
          clientToken,
          chunkIndex: index,
          ...chunkRequests[index],
        });
        const responseRecords = Array.isArray(data.records) ? data.records : [];
        currentChunk.recordIds = responseRecords.map((record) => record?.record_id).filter(hasText);
        if (
          responseRecords.length !== chunks[index].length
          || responseRecords.some((record) => !hasText(record?.record_id))
        ) {
          throw this.#malformedResponse('record batch create', {
            isWrite: true,
            clientToken,
            chunkIndex: index,
          });
        }
        const normalized = responseRecords.map(normalizeRecord);
        result.push(...normalized);
        completedChunks.push({ ...currentChunk, recordIds: normalized.map((record) => record.recordId) });
      } catch (error) {
        throw this.#attachPartialReceipt(error, 'record.batch_create', completedChunks, currentChunk);
      }
    }
    return result;
  }

  async batchUpdateRecords(appToken, tableId, records, options = {}) {
    const safeAppToken = requireText(appToken, 'appToken');
    const safeTableId = requireText(tableId, 'tableId');
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const preparedRecords = records.map((record, index) => {
      const recordId = requireText(record?.recordId ?? record?.record_id, `records[${index}].recordId`);
      const fields = record?.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        throw new TypeError(`records[${index}].fields must be an object`);
      }
      return { record_id: recordId, fields: structuredClone(fields) };
    });
    const chunks = chunkItems(preparedRecords, 500);
    if (chunks.length === 0) return [];
    const clientTokens = this.#persistedClientTokens(options, chunks.length);
    const chunkRequests = chunks.map((chunk, index) => {
      const body = { records: chunk };
      return {
        body,
        preSerializedBody: serializeJsonBody(body, `record batch update chunk ${index} body`),
      };
    });
    const result = [];
    const completedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const clientToken = clientTokens[index];
      const currentChunk = {
        chunkIndex: index,
        clientToken,
        resourceIds: [safeAppToken, safeTableId],
        recordIds: chunks[index].map((record) => record.record_id),
      };
      try {
        const data = await this.#request(this.#tablePath(safeAppToken, safeTableId, '/records/batch_update'), {
          method: 'POST',
          isWrite: true,
          clientToken,
          chunkIndex: index,
          ...chunkRequests[index],
        });
        const responseRecords = Array.isArray(data.records) ? data.records : [];
        if (
          responseRecords.length !== chunks[index].length
          || responseRecords.some((record, recordIndex) => (
            normalizedText(record?.record_id) !== chunks[index][recordIndex].record_id
          ))
        ) {
          currentChunk.recordIds = responseRecords.map((record) => record?.record_id).filter(hasText);
          throw this.#malformedResponse('record batch update', {
            isWrite: true,
            clientToken,
            chunkIndex: index,
          });
        }
        const normalized = responseRecords.map(normalizeRecord);
        result.push(...normalized);
        completedChunks.push({ ...currentChunk, recordIds: normalized.map((record) => record.recordId) });
      } catch (error) {
        throw this.#attachPartialReceipt(error, 'record.batch_update', completedChunks, currentChunk);
      }
    }
    return result;
  }

  async batchDeleteRecords(appToken, tableId, recordIds) {
    const safeAppToken = requireText(appToken, 'appToken');
    const safeTableId = requireText(tableId, 'tableId');
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      throw new TypeError('recordIds must be a non-empty array');
    }
    const chunks = chunkItems(recordIds.map((recordId, index) => (
      requireText(recordId, `recordIds[${index}]`)
    )), 500);
    let deleted = 0;
    for (const records of chunks) {
      const data = await this.#request(
        this.#tablePath(safeAppToken, safeTableId, '/records/batch_delete'),
        {
          method: 'POST',
          isWrite: true,
          body: { records },
          sensitiveValues: [safeAppToken, safeTableId, ...records],
        },
      );
      if (!Array.isArray(data.records) || data.records.length !== records.length) {
        throw this.#malformedResponse('record batch delete', { isWrite: true });
      }
      deleted += records.length;
    }
    return Object.freeze({ deleted });
  }

  async resolveWikiNode(token, objType = 'wiki') {
    const data = await this.#request('/wiki/v2/spaces/get_node', {
      query: { token: requireText(token, 'token'), obj_type: requireText(objType, 'objType') },
    });
    const node = normalizeWikiNode(data.node ?? data);
    if (!hasText(node.nodeToken) || !hasText(node.objToken)) throw this.#malformedResponse('Wiki node read');
    return node;
  }

  async listWikiChildNodes(spaceId, parentNodeToken, { pageToken, pageSize = 50 } = {}) {
    const nodes = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(`/wiki/v2/spaces/${encode(spaceId)}/nodes`, {
        query: {
          parent_node_token: requireText(parentNodeToken, 'parentNodeToken'),
          page_size: Math.min(50, Math.max(1, Number(pageSize) || 50)),
          page_token: nextPageToken,
        },
      });
      return page(data, 'items', { allowMissingEmptyItems: true });
    }, pageToken, normalizeWikiNode);
    if (nodes.some((node) => !hasText(node.nodeToken) || !hasText(node.objToken))) {
      throw this.#malformedResponse('Wiki child node list');
    }
    return nodes;
  }

  async listWikiTopLevelNodes(spaceId, { pageToken, pageSize = 50 } = {}) {
    const safePageSize = Math.min(50, Math.max(1, Math.trunc(Number(pageSize) || 50)));
    const nodes = await this.#collectPages(async (nextPageToken) => {
      const data = await this.#request(`/wiki/v2/spaces/${encode(spaceId)}/nodes`, {
        query: {
          page_size: safePageSize,
          page_token: nextPageToken,
        },
      });
      return page(data, 'items', { allowMissingEmptyItems: true });
    }, pageToken, normalizeWikiNode);
    if (nodes.some((node) => !hasText(node.nodeToken) || !hasText(node.objToken))) {
      throw this.#malformedResponse('Wiki top-level node list');
    }
    return nodes;
  }

  async updateWikiNodeTitle(spaceId, nodeToken, title) {
    const safeSpaceId = requireText(spaceId, 'spaceId');
    const safeNodeToken = requireText(nodeToken, 'nodeToken');
    const safeTitle = requireText(title, 'title');
    await this.#request(
      `/wiki/v2/spaces/${encode(safeSpaceId)}/nodes/${encode(safeNodeToken)}/update_title`,
      {
        method: 'POST',
        idempotent: true,
        isWrite: true,
        body: { title: safeTitle },
        sensitiveValues: [safeSpaceId, safeNodeToken, safeTitle],
      },
    );
    return Object.freeze({ title: safeTitle });
  }

  async createWikiChildNode(spaceId, {
    parentNodeToken,
    title,
    objType = 'docx',
    nodeType = 'origin',
  }) {
    const data = await this.#request(`/wiki/v2/spaces/${encode(spaceId)}/nodes`, {
      method: 'POST',
      isWrite: true,
      body: {
        obj_type: requireText(objType, 'objType'),
        node_type: requireText(nodeType, 'nodeType'),
        parent_node_token: requireText(parentNodeToken, 'parentNodeToken'),
        title: requireText(title, 'title'),
      },
    });
    const normalized = normalizeWikiNode(data.node ?? data);
    if (!hasText(normalized.nodeToken) || !hasText(normalized.objToken)) {
      throw this.#malformedResponse('Wiki node create', { isWrite: true });
    }
    return normalized;
  }

  async moveDocsToWiki(spaceId, {
    parentNodeToken,
    objType = 'bitable',
    objToken,
    apply = false,
  }) {
    if (typeof apply !== 'boolean') throw new TypeError('apply must be a boolean');
    const body = {
      ...(parentNodeToken === undefined
        ? {}
        : { parent_wiki_token: requireText(parentNodeToken, 'parentNodeToken') }),
      obj_type: requireText(objType, 'objType'),
      obj_token: requireText(objToken, 'objToken'),
      apply,
    };
    const data = await this.#request(
      `/wiki/v2/spaces/${encode(spaceId)}/nodes/move_docs_to_wiki`,
      { method: 'POST', isWrite: true, body },
    );
    if (Object.hasOwn(data, 'applied') && typeof data.applied !== 'boolean') {
      throw this.#malformedResponse('Wiki document move', { isWrite: true });
    }
    const result = {
      wikiToken: normalizedText(data.wiki_token),
      taskId: normalizedText(data.task_id),
      applied: data.applied === true,
    };
    if (!result.wikiToken && !result.taskId && !result.applied) {
      throw this.#malformedResponse('Wiki document move', { isWrite: true });
    }
    return result;
  }

  async getWikiTask(taskId, { taskType = 'move' } = {}) {
    const safeTaskId = requireText(taskId, 'taskId');
    const data = await this.#request(`/wiki/v2/tasks/${encode(safeTaskId)}`, {
      query: { task_type: requireText(taskType, 'taskType') },
    });
    const task = data.task;
    if (!task || typeof task !== 'object' || Array.isArray(task)
      || (task.move_result !== undefined && task.move_result !== null && !Array.isArray(task.move_result))) {
      throw this.#malformedResponse('Wiki task read');
    }
    const moveResult = (task.move_result ?? []).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !Number.isInteger(item.status)) {
        throw this.#malformedResponse('Wiki task read');
      }
      if (item.node !== undefined && item.node !== null
        && (typeof item.node !== 'object' || Array.isArray(item.node))) {
        throw this.#malformedResponse('Wiki task read');
      }
      const node = item.node === undefined || item.node === null ? null : normalizeWikiNode(item.node);
      if (item.status === 0 && (!node || !hasText(node.nodeToken) || !hasText(node.objToken))) {
        throw this.#malformedResponse('Wiki task read');
      }
      return {
        status: item.status,
        statusMessage: normalizedText(item.status_msg),
        node,
      };
    });
    if (moveResult.length === 0) {
      return {
        taskId: normalizedText(task.task_id) ?? safeTaskId,
        status: 1,
        statusMessage: 'processing',
        ready: false,
        failed: false,
        wikiToken: null,
        node: null,
        moveResult,
      };
    }
    const failedResult = moveResult.find((result) => result.status < 0);
    const pendingResult = moveResult.find((result) => result.status !== 0);
    const summary = failedResult ?? pendingResult ?? moveResult[0];
    const node = moveResult.find((result) => result.node !== null)?.node ?? null;
    const failed = Boolean(failedResult);
    const ready = !failed && moveResult.every((result) => result.status === 0);
    return {
      taskId: normalizedText(task.task_id) ?? safeTaskId,
      status: summary.status,
      statusMessage: summary.statusMessage,
      ready,
      failed,
      wikiToken: node?.nodeToken ?? null,
      node,
      moveResult,
    };
  }

  async appendDocxBlocks(documentId, parentBlockId, blocks, {
    documentRevisionId = -1,
    index,
    clientToken,
    clientTokens,
  } = {}) {
    const safeDocumentId = requireText(documentId, 'documentId');
    const safeParentBlockId = requireText(parentBlockId, 'parentBlockId');
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new TypeError('blocks must be a non-empty array');
    }
    requireInteger(documentRevisionId, 'documentRevisionId', { min: -1 });
    if (index !== undefined) requireInteger(index, 'index');
    const children = blocks.map(({ text, url }) => {
      const textRun = { content: requireText(text, 'block text') };
      if (url !== undefined) {
        textRun.text_element_style = { link: { url: encodeURIComponent(requireText(url, 'block url')) } };
      }
      return { block_type: 2, text: { elements: [{ text_run: textRun }] } };
    });
    const chunks = chunkItems(children, 50);
    const persistedTokens = this.#persistedClientTokens({ clientToken, clientTokens }, chunks.length);
    const chunkRequests = chunks.map((chunk, chunkIndex) => {
      const body = {
        children: chunk,
        ...(index === undefined ? {} : { index: index + chunkIndex * 50 }),
      };
      return {
        body,
        preSerializedBody: serializeJsonBody(body, `Docx children chunk ${chunkIndex} body`),
      };
    });
    const completedChunks = [];
    const result = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const currentChunk = {
        chunkIndex,
        clientToken: persistedTokens[chunkIndex],
        resourceIds: [safeDocumentId, safeParentBlockId],
        recordIds: [],
      };
      try {
        const data = await this.#request(
          `/docx/v1/documents/${encode(safeDocumentId)}/blocks/${encode(safeParentBlockId)}/children`,
          {
            method: 'POST',
            isWrite: true,
            clientToken: persistedTokens[chunkIndex],
            chunkIndex,
            query: { document_revision_id: documentRevisionId },
            ...chunkRequests[chunkIndex],
          },
        );
        const responseChildren = Array.isArray(data.children) ? data.children : [];
        currentChunk.recordIds = responseChildren.map((block) => block?.block_id).filter(hasText);
        if (
          responseChildren.length !== chunks[chunkIndex].length
          || responseChildren.some((block) => !hasText(block?.block_id))
        ) {
          throw this.#malformedResponse('Docx children create', {
            isWrite: true,
            clientToken: persistedTokens[chunkIndex],
            chunkIndex,
          });
        }
        const normalized = responseChildren.map((block) => ({
          blockId: block.block_id.trim(),
          type: block.block_type ?? null,
        }));
        result.push(...normalized);
        completedChunks.push({ ...currentChunk, recordIds: normalized.map((block) => block.blockId) });
      } catch (error) {
        throw this.#attachPartialReceipt(
          error,
          'docx.children.create',
          completedChunks,
          currentChunk,
        );
      }
    }
    return result;
  }

  async #collectPages(loadPage, initialPageToken, normalize) {
    const items = [];
    const seen = new Set(initialPageToken ? [initialPageToken] : []);
    let pageToken = initialPageToken;
    let pageCount = 0;
    while (true) {
      const current = await loadPage(pageToken);
      pageCount += 1;
      if (items.length + current.items.length > this.#maxItems) {
        throw new FeishuApiError('Feishu pagination exceeded maxItems');
      }
      items.push(...current.items.map(normalize));
      if (!current.hasMore) return items;
      if (pageCount >= this.#maxPages) {
        throw new FeishuApiError('Feishu pagination exceeded maxPages');
      }
      if (!current.pageToken || seen.has(current.pageToken)) {
        throw new FeishuApiError('Feishu pagination returned an invalid or repeated page token');
      }
      seen.add(current.pageToken);
      pageToken = current.pageToken;
    }
  }

  #persistedClientTokens(options, chunkCount) {
    if (Array.isArray(options.clientTokens)) {
      if (options.clientTokens.length !== chunkCount) {
        throw new TypeError(`clientTokens must contain exactly ${chunkCount} persisted tokens`);
      }
      return options.clientTokens.map((token, index) => requireClientToken(token, `clientTokens[${index}]`));
    }
    if (options.clientToken !== undefined) {
      if (chunkCount !== 1) {
        throw new TypeError('a single clientToken cannot be reused for different chunk bodies; pass persisted clientTokens');
      }
      return [requireClientToken(options.clientToken)];
    }
    throw new TypeError('caller must provide persisted clientTokens before a batch write');
  }

  #attachPartialReceipt(error, operation, completedChunks, currentChunk) {
    const uncertain = Boolean(error?.uncertain);
    const partialReceipt = makeWriteReceipt({
      operation,
      completedChunks,
      currentChunk: uncertain ? currentChunk : null,
    });
    if (error instanceof FeishuApiError) {
      error.partialReceipt = partialReceipt;
      return error;
    }
    return new FeishuApiError('Feishu batch write failed after partial completion', {
      uncertain,
      partialReceipt,
      cause: error,
    });
  }

  #tablePath(appToken, tableId, suffix) {
    return `/bitable/v1/apps/${encode(appToken)}/tables/${encode(tableId)}${suffix}`;
  }

  #makeUrl(pathname, query) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
      throw new TypeError('Feishu API path must be relative to the configured API base');
    }
    const url = new URL(`${this.#apiBaseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async #backoff(retryCount, response) {
    const retryAfter = retryAfterMilliseconds(response, this.#now);
    if (retryAfter !== null) {
      await this.#sleep(retryAfter);
      return;
    }
    const randomValue = this.#random();
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
      throw new TypeError('random must return a finite number between 0 and 1');
    }
    const exponential = this.#retryBaseMs * (2 ** retryCount);
    const jitter = Math.floor(this.#retryBaseMs * randomValue);
    await this.#sleep(Math.min(60_000, exponential + jitter));
  }

  #malformedResponse(operation, {
    isWrite = false,
    clientToken = null,
    chunkIndex = null,
  } = {}) {
    return new FeishuApiError(`Feishu ${operation} response was malformed`, {
      code: 'malformed_response',
      uncertain: isWrite,
      recovery: recoveryForClientToken(clientToken, chunkIndex),
      secrets: clientToken ? [clientToken] : [],
    });
  }

  #responseError(prefix, response, payload, secrets, extra = {}) {
    return new FeishuApiError(prefix, {
      code: payload?.code ?? null,
      status: response.status,
      requestId: response.headers?.get?.('x-tt-logid') ?? null,
      secrets,
      ...extra,
    });
  }
}
