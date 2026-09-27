/**
 * Resilient sign-in (client-safe, unit-tested).
 *
 * Convex's react client throws "[CONVEX A(auth:signIn)] Connection lost while
 * action was in flight" when the WebSocket drops while the sign-in mutation
 * runs (flaky network, dev function push…). The mutation may or may not have
 * landed server-side, so the only safe client behaviour is to simply call
 * signIn again — the providers are idempotent enough for that:
 *  - "device" re-exchanges the same token,
 *  - "email-otp" re-uses the same still-valid code (15 min),
 *  - the first "email-otp" call (send code) just sends a fresh code.
 *
 * Real auth rejections (wrong/expired code) must surface immediately —
 * retrying those would only confuse the user.
 */

/**
 * Convex's `signIn` accepts FormData (form flows) or provider-specific param
 * objects; `any` keeps the helper compatible with every provider signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SignInFn = (provider: string, params: any) => Promise<unknown>;

/** Transient transport problems that are worth another attempt. */
const CONNECTION_ERROR_RE =
  /connection lost|in flight|websocket|network|failed to fetch|fetch failed|timed? ?out|aborted|econn|disconnect|unreachable|server error|internal server error/i;

/** Definitive auth rejections — never retried, shown to the user as-is. */
const AUTH_REJECTION_RE =
  /incorrect|invalid|expired|wrong code|no user|not found|already|unauthorized|forbidden/i;

export function isTransientConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return CONNECTION_ERROR_RE.test(msg);
}

export function isAuthRejectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return AUTH_REJECTION_RE.test(msg);
}

/**
 * Call `signIn(provider, params)` and retry transient connection losses
 * (default 3 attempts, 300ms → 600ms backoff). Anything that is not a
 * connection error — above all wrong-code rejections — rethrows immediately.
 */
export async function signInWithRetry(
  signIn: SignInFn,
  provider: string,
  params: FormData | Record<string, unknown>,
  opts: {
    attempts?: number;
    delayMs?: (attempt: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const wait =
    opts.delayMs ??
    ((a: number) => new Promise((r) => setTimeout(r, 300 * 2 ** (a - 1))));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await signIn(provider, params);
      return;
    } catch (err) {
      lastErr = err;
      if (
        attempt === attempts ||
        isAuthRejectionError(err) ||
        !isTransientConnectionError(err)
      ) {
        throw err;
      }
      await wait(attempt);
    }
  }
  throw lastErr;
}
