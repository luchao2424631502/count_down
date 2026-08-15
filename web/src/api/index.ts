/**
 * api/index.ts —— 对后端 /api 的 fetch 封装
 *
 * 端点（READ_MESOLUTION / READ_SOLUTION §5）：
 *   GET  /api/countdowns        拉全量（含已删标记）
 *   GET  /api/countdowns/:id    单条
 *   POST /api/countdowns        新建
 *   PUT  /api/countdowns/:id    更新
 *   DELETE /api/countdowns/:id  软删除
 *   GET  /api/categories        拉全量分类
 *   POST /api/categories        新建分类
 *   PUT  /api/categories/:id    更新分类
 *   DELETE /api/categories/:id  软删除分类
 *   POST /api/sync              全量 LWW 同步
 *
 * token 从 localStorage 读取（KEY=COUNTDOWN_TOKEN），自用可极简。
 */

import type { Category, CategoryInput, Countdown, CountdownInput, SyncPayload, SyncResult } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'COUNTDOWN_TOKEN';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const token = getToken();
  if (token) {
    // 兼容后端可能的 Authorization 头；若后端只用 bearer 可走这里
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    try {
      const data = await res.json();
      if (data?.message || data?.error) msg = data.message || data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------------------------- countdowns ---------------------------- */

export function fetchCountdowns(): Promise<Countdown[]> {
  return request<Countdown[]>('/countdowns');
}

export function fetchCountdown(id: string): Promise<Countdown> {
  return request<Countdown>(`/countdowns/${id}`);
}

/** 封装成 payload：后端可能要求完整对象，这里 POST body 传 CountdownInput + 空客户端字段由后端补 */
export function createCountdown(input: CountdownInput): Promise<Countdown> {
  return request<Countdown>('/countdowns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCountdown(id: string, input: Partial<CountdownInput>): Promise<Countdown> {
  return request<Countdown>(`/countdowns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteCountdown(id: string): Promise<void> {
  return request<void>(`/countdowns/${id}`, { method: 'DELETE' });
}

/* ---------------------------- categories ----------------------------- */

export function fetchCategories(): Promise<Category[]> {
  return request<Category[]>('/categories');
}

export function createCategory(input: CategoryInput): Promise<Category> {
  return request<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCategory(id: string, input: Partial<CategoryInput>): Promise<Category> {
  return request<Category>(`/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteCategory(id: string): Promise<void> {
  return request<void>(`/categories/${id}`, { method: 'DELETE' });
}

/* ------------------------------ sync -------------------------------- */

/** 全量 LWW 同步：上传本地全量，服务端返回合并结果 */
export function syncAll(payload: SyncPayload): Promise<SyncResult> {
  return request<SyncResult>('/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export { ApiError };
