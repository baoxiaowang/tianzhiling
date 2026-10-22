import { Config, Provide } from '@midwayjs/core';

interface DouyinReviewConfig {
  baseUrl?: string;
  password?: string;
  timeoutMs?: number;
}

/**
 * 抖评（comment-admin）客户端：读取「每日费用」。
 *
 * 抖评系统就在同一台服务器的 `tzl-network` 里（容器别名 comment-admin，端口 8890），
 * 它按「有效评论数 × 当日单价 + 当天奖励 + 周奖励」算出每人每天的推广费，
 * `/api/stats/by-date` 的 `total` 即该日合计——和《抖评记录.xlsx》里「总费用 + 当天奖励」口径一致。
 *
 * 认证是共享密码 + HMAC cookie：这里用 `DOUYIN_REVIEW_PASSWORD` 登录一次，
 * cookie 缓存在进程内（20 小时），401 时自动重登一次。
 * 未配置密码或抖评不可用时返回空结果，调用方回退到内置静态表，不影响主流程。
 */
@Provide()
export class DouyinReviewService {
  @Config('douyinReview')
  douyinReviewConfig: DouyinReviewConfig;

  private cookie: { value: string; expiresAt: number } | null = null;

  private get baseUrl(): string {
    return String(this.douyinReviewConfig?.baseUrl || '').replace(/\/+$/, '');
  }

  private get password(): string {
    return String(this.douyinReviewConfig?.password || '');
  }

  isEnabled(): boolean {
    return this.baseUrl.length > 0 && this.password.length > 0;
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(this.douyinReviewConfig?.timeoutMs) || 5000
    );
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureCookie(forceRefresh = false): Promise<string | null> {
    if (!this.isEnabled()) return null;
    if (
      !forceRefresh &&
      this.cookie &&
      this.cookie.expiresAt > Date.now()
    ) {
      return this.cookie.value;
    }
    try {
      const res = await this.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: this.password }),
      });
      if (!res.ok) {
        this.cookie = null;
        return null;
      }
      const setCookie = res.headers.get('set-cookie') || '';
      const matched = /ca_sess=([^;]+)/.exec(setCookie);
      if (!matched) {
        this.cookie = null;
        return null;
      }
      this.cookie = {
        value: matched[1],
        // 抖评 cookie 有效期 30 天，这里 20 小时刷新一次，避免长期失效
        expiresAt: Date.now() + 20 * 60 * 60 * 1000,
      };
      return this.cookie.value;
    } catch (error) {
      this.cookie = null;
      return null;
    }
  }

  /** 某一天的抖评「合计」（推广费 + 当天奖励 + 周奖励）；拿不到返回 null */
  async getDailyExpense(date: string): Promise<number | null> {
    const map = await this.getDailyExpenses(date, date);
    const value = map.get(date);
    return typeof value === 'number' ? value : null;
  }

  /** 区间内每天的抖评「合计」，date -> 元 */
  async getDailyExpenses(from: string, to: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!this.isEnabled()) return result;

    for (const forceRefresh of [false, true]) {
      const cookie = await this.ensureCookie(forceRefresh);
      if (!cookie) continue;
      try {
        const res = await this.request(
          `/api/stats/by-date?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { headers: { Cookie: `ca_sess=${cookie}` } }
        );
        if (res.status === 401) {
          // cookie 失效：清掉后重试一次
          this.cookie = null;
          continue;
        }
        if (!res.ok) return result;
        const body = (await res.json()) as {
          ok?: boolean;
          rows?: Array<{ date?: string; total?: number }>;
        };
        for (const row of body.rows || []) {
          const value = Number(row.total);
          if (row.date && Number.isFinite(value)) {
            result.set(row.date, value);
          }
        }
        return result;
      } catch (error) {
        // 网络异常/超时：返回已拿到的部分，调用方回退静态表
      }
    }
    return result;
  }
}
