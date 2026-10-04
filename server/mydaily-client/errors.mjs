export function redactSecrets(value, secrets = []) {
  let text = String(value ?? '');
  text = text.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(
    /((?:app_secret|tenant_access_token|access_token)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    '$1[REDACTED]',
  );
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text;
}

export class FeishuApiError extends Error {
  constructor(message, { code = null, status = null, requestId = null, secrets = [], cause } = {}) {
    super(redactSecrets(message, secrets), { cause });
    this.name = 'FeishuApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}
