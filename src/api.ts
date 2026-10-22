export type GreenConfig = {
  apiUrl: string;
  idInstance: string;
  apiTokenInstance: string;
};

export type ApiResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function endpoint(config: GreenConfig, method: string) {
  const base = config.apiUrl.trim().replace(/\/+$/, '');
  return `${base}/waInstance${encodeURIComponent(config.idInstance.trim())}/${method}/${encodeURIComponent(config.apiTokenInstance.trim())}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const raw = await response.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'message' in data
      ? String((data as { message: unknown }).message)
      : (typeof data === 'string' ? data : response.statusText);
    throw new Error(`HTTP ${response.status}: ${detail || 'Request failed'}`);
  }
  return data as T;
}

export async function checkInstance(config: GreenConfig) {
  return request(endpoint(config, 'getStateInstance'));
}

export async function sendText(config: GreenConfig, chatId: string, message: string) {
  return request<{ idMessage?: string }>(endpoint(config, 'sendMessage'), {
    method: 'POST',
    body: JSON.stringify({ chatId, message }),
  });
}

export type GreenNotification = {
  receiptId: number;
  body?: {
    typeWebhook?: string;
    senderData?: { chatId?: string; sender?: string; senderName?: string };
    messageData?: {
      typeMessage?: string;
      textMessageData?: { textMessage?: string };
      extendedTextMessageData?: { text?: string };
    };
    message?: string;
  };
};

export async function receiveNotification(config: GreenConfig) {
  return request<GreenNotification | null>(endpoint(config, 'receiveNotification'));
}

export async function deleteNotification(config: GreenConfig, receiptId: number) {
  return request(endpoint(config, `deleteNotification/${receiptId}`), { method: 'DELETE' });
}
