import { tenantHeaders } from './tenant-header';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type AdminRole = 'owner' | 'admin' | 'soporte';

export interface AdminOverview {
  liveVisitors: number;
  totalSessions: number;
  totalConversations: number;
  totalMessages: number;
  conversationsToday: number;
  messagesToday: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  impressions: number;
}

export interface UnmetDemandRow {
  requestedCategory: string | null;
  requestedBrand: string | null;
  count: number;
  sampleQuery: string;
}

export interface IntentBreakdownRow {
  intent: string;
  count: number;
}

export interface RatingSummary {
  count: number;
  average: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/** Pedido explicito del usuario: chats atendidos por soporte "en tiempo real" y verificar que las respuestas lleguen rápido. */
export interface SupportStats {
  handledToday: number;
  escalatedToday: number;
  answeredToday: number;
  averageResponseSeconds: number | null;
  rating: RatingSummary;
}

export type ConversationStatus = 'active' | 'needs_support' | 'resolved' | 'closed' | 'cancelled';

export interface SupportConversationSummary {
  conversationId: string;
  status: ConversationStatus;
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface SupportMessage {
  role: 'user' | 'assistant' | 'support_agent';
  content: string;
  createdAt: string;
}

export class AdminUnauthorizedError extends Error {}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...tenantHeaders(), ...init?.headers },
  });
  if (res.status === 401 || res.status === 403) {
    throw new AdminUnauthorizedError('No autenticado.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message;
    throw new Error(Array.isArray(message) ? message[0] : message || 'Error consultando el panel admin.');
  }
  return res.json();
}

function adminPost<T>(path: string, body?: unknown): Promise<T> {
  return adminFetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function adminPatch<T>(path: string, body?: unknown): Promise<T> {
  return adminFetch(path, {
    method: 'PATCH',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function adminDelete<T>(path: string): Promise<T> {
  return adminFetch(path, { method: 'DELETE' });
}

export async function adminLogin(username: string, password: string): Promise<{ ok: boolean; role?: AdminRole; message?: string }> {
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    return { ok: false };
  }
  return res.json();
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_BASE}/admin/auth/logout`, { method: 'POST', credentials: 'include', headers: tenantHeaders() });
}

/** null = no autenticado. */
export async function checkAdminSession(): Promise<AdminRole | null> {
  try {
    const data = await adminFetch<{ ok: boolean; role?: AdminRole }>('/admin/auth/me');
    return data.role ?? null;
  } catch {
    return null;
  }
}

export function getOverview(): Promise<AdminOverview> {
  return adminFetch('/admin/stats/overview');
}

export function getTopProducts(): Promise<TopProduct[]> {
  return adminFetch('/admin/stats/top-products');
}

export function getUnmetDemand(): Promise<UnmetDemandRow[]> {
  return adminFetch('/admin/stats/unmet-demand');
}

export function getIntentBreakdown(): Promise<IntentBreakdownRow[]> {
  return adminFetch('/admin/stats/intent-breakdown');
}

export function getSupportStats(): Promise<SupportStats> {
  return adminFetch('/admin/stats/support');
}

// --- Bandeja de soporte (rol "admin" o "soporte") ---

export function listSupportConversations(status: ConversationStatus = 'needs_support'): Promise<SupportConversationSummary[]> {
  return adminFetch(`/admin/support/conversations?status=${status}`);
}

export function getSupportMessages(conversationId: string): Promise<SupportMessage[]> {
  return adminFetch(`/admin/support/conversations/${conversationId}/messages`);
}

export function replyToSupportConversation(conversationId: string, content: string): Promise<{ ok: boolean }> {
  return adminPost(`/admin/support/conversations/${conversationId}/reply`, { content });
}

export function resolveSupportConversation(conversationId: string): Promise<{ ok: boolean }> {
  return adminPost(`/admin/support/conversations/${conversationId}/resolve`);
}

export function closeSupportConversation(conversationId: string): Promise<{ ok: boolean }> {
  return adminPost(`/admin/support/conversations/${conversationId}/close`);
}

export function cancelSupportConversation(conversationId: string): Promise<{ ok: boolean }> {
  return adminPost(`/admin/support/conversations/${conversationId}/cancel`);
}

// --- Gestion de usuarios (solo rol "owner") ---

export type ManagedAdminRole = 'admin' | 'soporte';

export interface AdminUserRow {
  id: string;
  username: string;
  role: ManagedAdminRole;
  createdAt: string;
}

export interface SeatUsage {
  used: number;
  limit: number;
}

export interface AdminUsersOverview {
  users: AdminUserRow[];
  seats: { admin: SeatUsage; soporte: SeatUsage };
}

export function listAdminUsers(): Promise<AdminUsersOverview> {
  return adminFetch('/admin/users');
}

export function createAdminUser(username: string, password: string, role: ManagedAdminRole): Promise<{ ok: boolean; user: AdminUserRow }> {
  return adminPost('/admin/users', { username, password, role });
}

export function deleteAdminUser(id: string): Promise<{ ok: boolean }> {
  return adminDelete(`/admin/users/${id}`);
}

/** Solo el owner puede hacer esto — admin y soporte no tienen forma de cambiar su propia contraseña. */
export function resetAdminUserPassword(id: string, password: string): Promise<{ ok: boolean }> {
  return adminPatch(`/admin/users/${id}/password`, { password });
}

// --- Solo owner: impacto de negocio y diagnostico del sistema ---

export type ImpactWindow = 'week' | 'month' | 'year';

export interface ImpactReport {
  window: ImpactWindow;
  days: number;
  conversations: number;
  customerMessages: number;
  offTopicDeflected: number;
  supportEscalations: number;
  averageSupportResponseSeconds: number | null;
  averageRating: number | null;
  ratingCount: number;
  unmetDemandSignals: number;
}

export function getImpactReport(window: ImpactWindow): Promise<ImpactReport> {
  return adminFetch(`/admin/owner/impact?window=${window}`);
}

export interface SystemHealth {
  llmProviders: Array<{ provider: string; configured: boolean; ok: boolean; model: string; message?: string }>;
  database: { ok: boolean; error?: string };
}

export function getSystemHealth(): Promise<SystemHealth> {
  return adminFetch('/admin/owner/health');
}

// --- Gestion de tenants/clientes y su base de conocimiento (solo owner) ---

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  host: string;
  crawlerBaseUrl: string;
  extraCorsOrigins: string | null;
  maxAdminSeats: number;
  maxSupportSeats: number;
  isActive: boolean;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  host: string;
  crawlerBaseUrl: string;
  extraCorsOrigins?: string;
  maxAdminSeats?: number;
  maxSupportSeats?: number;
}

export function listTenants(): Promise<TenantRow[]> {
  return adminFetch('/admin/tenants');
}

export function createTenant(input: CreateTenantInput): Promise<{ ok: boolean; tenant: TenantRow }> {
  return adminPost('/admin/tenants', input);
}

export type KnowledgeSourceKind = 'heading' | 'frequent-questions-api';

export interface TenantKnowledgeSource {
  id: string;
  tenantId: string;
  url: string;
  kind: KnowledgeSourceKind;
  sourceUrl: string | null;
  headers: Record<string, string> | null;
}

export interface AddKnowledgeSourceInput {
  url: string;
  kind?: KnowledgeSourceKind;
  sourceUrl?: string;
  headers?: Record<string, string>;
}

export function listTenantKnowledgeSources(tenantId: string): Promise<TenantKnowledgeSource[]> {
  return adminFetch(`/admin/tenants/${tenantId}/knowledge-sources`);
}

export function addTenantKnowledgeSource(
  tenantId: string,
  input: AddKnowledgeSourceInput,
): Promise<{ ok: boolean; source: TenantKnowledgeSource }> {
  return adminPost(`/admin/tenants/${tenantId}/knowledge-sources`, input);
}

export function deleteTenantKnowledgeSource(tenantId: string, sourceId: string): Promise<{ ok: boolean }> {
  return adminDelete(`/admin/tenants/${tenantId}/knowledge-sources/${sourceId}`);
}
