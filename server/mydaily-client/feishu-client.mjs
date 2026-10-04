import { FeishuApiError } from './errors.mjs';

const TOKEN_REFRESH_SKEW_MS = 60_000;
const TOKEN_ERROR_CODES = new Set([99991661, 99991663, 99991668]);

function trimBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function pageResult(data, itemKey = 'items') {
  return {
    items: data?.[itemKey] ?? [],
    hasMore: Boolean(data?.has_more),
    pageToken: data?.page_token ?? data?.next_page_token ?? null,
  };
}

function paragraphBlocks(paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.some((text) => typeof text !== 'string')) {
    throw new TypeError('paragraphs must be an array of strings');
  }
  return paragraphs.map((text) => ({
    block_type: 2,
    text: { elements: [{ text_run: { content: text } }] },
  }));
}

export class FeishuClient {
  #appId;
  #appSecret;
  #apiBaseUrl;
  #fetch;
  #now;
  #tokenCache = null;

  constructor({
    appId,
    appSecret,
    apiBaseUrl = 'https://open.feishu.cn/open-apis',
    fetchImpl = globalThis.fetch,
    now = Date.now,
  }) {
    if (!appId || !appSecret) throw new TypeError('Feishu appId and appSecret are required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    this.#appId = appId;
    this.#appSecret = appSecret;
    this.#apiBaseUrl = trimBaseUrl(apiBaseUrl);
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  async getTenantAccessToken() {
    if (
      this.#tokenCache
      && this.#tokenCache.expiresAt - this.#now() > TOKEN_REFRESH_SKEW_MS
    ) {
      return this.#tokenCache.token;
    }

    const response = await this.#fetch(
      `${this.#apiBaseUrl}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: this.#appId, app_secret: this.#appSecret }),
      },
    );
    const payload = await this.#readJson(response, [this.#appSecret]);
    if (!response.ok || payload?.code !== 0 || !payload?.tenant_access_token) {
      throw this.#apiError('Feishu authentication failed', response, payload, [this.#appSecret]);
    }

    const token = payload.tenant_access_token;
    const expiresInSeconds = Number(payload.expire) || 0;
    this.#tokenCache = {
      token,
      expiresAt: this.#now() + expiresInSeconds * 1000,
    };
    return token;
  }

  invalidateToken() {
    this.#tokenCache = null;
  }

  async request(path, {
    method = 'GET', query, body, raw = false, headers = {}, retryAuth = true,
  } = {}) {
    const token = await this.getTenantAccessToken();
    const url = this.#makeUrl(path, query);
    const requestHeaders = { authorization: `Bearer ${token}`, ...headers };
    const init = { method, headers: requestHeaders };
    if (body !== undefined) {
      requestHeaders['content-type'] ??= 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await this.#fetch(url, init);
    if (raw && response.ok) {
      return new Uint8Array(await response.arrayBuffer());
    }

    const payload = await this.#readJson(response, [this.#appSecret, token]);
    const code = payload?.code ?? null;
    if (retryAuth && (response.status === 401 || TOKEN_ERROR_CODES.has(code))) {
      this.invalidateToken();
      return this.request(path, { method, query, body, raw, headers, retryAuth: false });
    }
    if (!response.ok || code !== 0) {
      throw this.#apiError('Feishu API request failed', response, payload, [this.#appSecret, token]);
    }
    return payload.data ?? {};
  }

  async getWikiNode(token, objType = 'wiki') {
    const data = await this.request('/wiki/v2/spaces/get_node', {
      query: { token, obj_type: objType },
    });
    return data.node ?? data;
  }

  async getWikiNodesPage(spaceId, {
    parentNodeToken, pageSize = 50, pageToken,
  } = {}) {
    const data = await this.request(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      query: {
        parent_node_token: parentNodeToken,
        page_size: Math.min(50, Math.max(1, Number(pageSize) || 50)),
        page_token: pageToken,
      },
    });
    return pageResult(data);
  }

  async listWikiNodes(spaceId, options = {}) {
    return this.#collectPages((pageToken) => this.getWikiNodesPage(spaceId, { ...options, pageToken }));
  }

  async getSpreadsheet(spreadsheetToken) {
    const data = await this.request(
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}`,
    );
    return data.spreadsheet ?? data;
  }

  async listSpreadsheetSheets(spreadsheetToken) {
    const data = await this.request(
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`,
    );
    if (!Array.isArray(data.sheets)) {
      throw new FeishuApiError(
        'Feishu Sheets API returned a malformed response: sheets must be an array',
      );
    }
    return data.sheets;
  }

  async getSpreadsheetValues(spreadsheetToken, range) {
    const data = await this.request(
      `/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}`,
    );
    return data.valueRange ?? data.value_range ?? data;
  }

  async getBitableApp(appToken) {
    const data = await this.request(`/bitable/v1/apps/${encodeURIComponent(appToken)}`);
    return data.app ?? data;
  }

  async getBitableTablesPage(appToken, { pageSize = 100, pageToken } = {}) {
    const data = await this.request(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`, {
      query: {
        page_size: Math.min(100, Math.max(1, Number(pageSize) || 100)),
        page_token: pageToken,
      },
    });
    return pageResult(data);
  }

  async getBitableFieldsPage(appToken, tableId, { pageSize = 100, pageToken } = {}) {
    const data = await this.request(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      {
        query: {
          page_size: Math.min(100, Math.max(1, Number(pageSize) || 100)),
          page_token: pageToken,
        },
      },
    );
    return pageResult(data);
  }

  async getBitableRecordsPage(appToken, tableId, { pageSize = 100, pageToken } = {}) {
    const data = await this.request(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      {
        query: {
          page_size: Math.min(500, Math.max(1, Number(pageSize) || 100)),
          page_token: pageToken,
        },
      },
    );
    return { ...pageResult(data), total: data.total ?? null };
  }

  async createWikiNode(spaceId, {
    parentNodeToken, title, objType = 'docx', nodeType = 'origin',
  }) {
    return this.request(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      method: 'POST',
      body: {
        obj_type: objType,
        node_type: nodeType,
        parent_node_token: parentNodeToken,
        title,
      },
    });
  }

  async getDocument(documentId) {
    const data = await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}`);
    return data.document ?? data;
  }

  async getDocumentBlocksPage(documentId, {
    pageSize = 100, pageToken, documentRevisionId,
  } = {}) {
    const data = await this.request(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
      {
        query: {
          page_size: pageSize,
          page_token: pageToken,
          document_revision_id: documentRevisionId,
        },
      },
    );
    return pageResult(data);
  }

  async listDocumentBlocks(documentId, options = {}) {
    return this.#collectPages(
      (pageToken) => this.getDocumentBlocksPage(documentId, { ...options, pageToken }),
    );
  }

  async createDocument({ folderToken, title }) {
    return this.request('/docx/v1/documents', {
      method: 'POST',
      body: { folder_token: folderToken, title },
    });
  }

  async createChildBlocks(documentId, parentBlockId, children, {
    documentRevisionId = -1, index,
  } = {}) {
    return this.request(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`,
      {
        method: 'POST',
        query: { document_revision_id: documentRevisionId },
        body: { children, ...(index === undefined ? {} : { index }) },
      },
    );
  }

  async updateTextBlock(documentId, blockId, text, { documentRevisionId = -1 } = {}) {
    return this.request(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`,
      {
        method: 'PATCH',
        query: { document_revision_id: documentRevisionId },
        body: {
          update_text_elements: {
            elements: [{ text_run: { content: text } }],
          },
        },
      },
    );
  }

  async updateBlockText(documentId, blockId, text, documentRevisionId = -1) {
    return this.updateTextBlock(documentId, blockId, text, { documentRevisionId });
  }

  async appendParagraphs(documentId, parentBlockId, paragraphs, documentRevisionId = -1) {
    return this.createChildBlocks(
      documentId,
      parentBlockId,
      paragraphBlocks(paragraphs),
      { documentRevisionId },
    );
  }

  async insertParagraphsAfter(
    documentId,
    anchorBlockId,
    paragraphs,
    documentRevisionId = -1,
  ) {
    const { parentId, index } = await this.#locateBlock(
      documentId,
      anchorBlockId,
      documentRevisionId,
    );
    return this.createChildBlocks(
      documentId,
      parentId,
      paragraphBlocks(paragraphs),
      { documentRevisionId, index: index + 1 },
    );
  }

  async deleteChildBlocks(documentId, parentBlockId, startIndex, endIndex, {
    documentRevisionId = -1,
  } = {}) {
    return this.request(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children/batch_delete`,
      {
        method: 'DELETE',
        query: { document_revision_id: documentRevisionId },
        body: { start_index: startIndex, end_index: endIndex },
      },
    );
  }

  async deleteDocumentBlock(documentId, blockId, documentRevisionId = -1) {
    const { parentId, index } = await this.#locateBlock(documentId, blockId, documentRevisionId);
    return this.deleteChildBlocks(documentId, parentId, index, index + 1, {
      documentRevisionId,
    });
  }

  async getDriveFilesPage(folderToken, { pageSize = 50, pageToken, orderBy, direction } = {}) {
    const data = await this.request('/drive/v1/files', {
      query: {
        folder_token: folderToken,
        page_size: pageSize,
        page_token: pageToken,
        order_by: orderBy,
        direction,
      },
    });
    return pageResult(data, 'files');
  }

  async listDriveFiles(folderToken, options = {}) {
    return this.#collectPages(
      (pageToken) => this.getDriveFilesPage(folderToken, { ...options, pageToken }),
    );
  }

  async getDriveMeta(token, docType = 'folder') {
    const data = await this.request('/drive/v1/metas/batch_query', {
      method: 'POST',
      body: { request_docs: [{ doc_token: token, doc_type: docType }] },
    });
    return data.metas?.[0] ?? null;
  }

  async downloadDriveFile(fileToken) {
    return this.request(`/drive/v1/files/${encodeURIComponent(fileToken)}/download`, { raw: true });
  }

  async #collectPages(loadPage) {
    const items = [];
    const seen = new Set();
    let pageToken;
    do {
      const page = await loadPage(pageToken);
      items.push(...page.items);
      if (!page.hasMore) return items;
      if (!page.pageToken || seen.has(page.pageToken)) {
        throw new FeishuApiError('Feishu pagination returned an invalid or repeated page token');
      }
      seen.add(page.pageToken);
      pageToken = page.pageToken;
    } while (true);
  }

  async #locateBlock(documentId, blockId, documentRevisionId) {
    const blocks = await this.listDocumentBlocks(documentId, { documentRevisionId });
    const block = blocks.find((item) => item.block_id === blockId || item.blockId === blockId);
    const parentId = block?.parent_id ?? block?.parentId;
    const parent = blocks.find((item) => item.block_id === parentId || item.blockId === parentId);
    const children = parent?.children ?? [];
    const index = children.indexOf(blockId);
    if (!block || !parentId || !parent || index < 0) {
      throw new FeishuApiError('Cannot safely locate the document block in its current parent');
    }
    return { parentId, index };
  }

  #makeUrl(path, query) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new TypeError('Feishu API path must be relative to the configured API base');
    }
    const url = new URL(`${this.#apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async #readJson(response, secrets) {
    try {
      return await response.json();
    } catch (cause) {
      throw new FeishuApiError('Feishu returned a non-JSON response', {
        status: response.status,
        requestId: response.headers.get('x-tt-logid'),
        secrets,
        cause,
      });
    }
  }

  #apiError(prefix, response, payload, secrets) {
    const code = payload?.code ?? null;
    const detail = typeof payload?.msg === 'string' ? `: ${payload.msg}` : '';
    return new FeishuApiError(`${prefix}${detail}`, {
      code,
      status: response.status,
      requestId: response.headers.get('x-tt-logid'),
      secrets,
    });
  }
}

