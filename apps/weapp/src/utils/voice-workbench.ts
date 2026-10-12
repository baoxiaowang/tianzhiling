import { brand } from '../config/brand';

export interface VoiceWorkbenchCard { kind: 'voice_clone'; agentId: string; title: string; showCard: boolean }
export function parseVoiceWorkbenchCard(value: unknown): VoiceWorkbenchCard | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'voice_clone' || typeof raw.agentId !== 'string' || !/^[a-f\d]{24}$/i.test(raw.agentId) || typeof raw.title !== 'string' || !raw.title.trim()) return undefined;
  return { kind: 'voice_clone', agentId: raw.agentId, title: raw.title.trim().slice(0, 80), showCard: raw.showCard === true };
}
export function validateVoiceWorkbenchUrl(value: string): string {
  // Only the existing voice workbench may be opened. Bearer URLs never enter message history or storage.
  // 白名单主机按品牌注入（未了言 admin.voloian.cn / 天之灵 admin.tianzhiling.chat），不写死任一品牌。
  return validateVoiceWorkbenchUrlWithHost(value, brand.adminDomain);
}

export function validateVoiceWorkbenchUrlWithHost(value: string, adminDomain: string): string {
  const escapedHost = adminDomain
    .trim()
    .replace(/\./g, '\\.')
    .replace(/[^a-zA-Z0-9.\\-]/g, '');

  if (
    !escapedHost ||
    !new RegExp(
      `^https://${escapedHost}/admin_api/agent_vt/p/avt_[a-f\\d]{48}$`
    ).test(value)
  ) {
    throw new Error('声音工作台地址不可用');
  }

  return value;
}
