/**
 * Map backend auth errors to user-facing strings. Known shapes get friendly
 * copy; anything unrecognised surfaces the CONCRETE server message + HTTP
 * status instead of a generic fallback, so the user (and support) can always
 * see what actually went wrong — e.g. a misconfigured mail service returning
 * "failed to send verification code" is no longer hidden.
 */
export function mapAuthError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;

  // 401 → treated by the platform as "session expired"; surface it clearly.
  if (isApiError(err) && err.status === 401) {
    return "Your session has expired. Please sign in again.";
  }

  const msg = err.message.toLowerCase();
  if (/invalid|incorrect|wrong/.test(msg)) {
    return "That code didn't match. Double-check and try again.";
  }
  if (/expired/.test(msg)) {
    return "That code has expired. Tap resend to get a new one.";
  }
  if (/rate.?limit|too many|throttle|please wait|before requesting another/.test(msg)) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (/network|fetch|timeout|unreachable/.test(msg)) {
    return "Can't reach Multica. Check your connection and retry.";
  }

  // Unrecognised → show the real server message (with its status) so an
  // error is never silently swallowed behind a vague default.
  if (isApiError(err)) {
    return `Something went wrong (${err.status}): ${err.message}`;
  }
  return err.message || fallback;
}

function isApiError(err: Error): err is Error & { status: number } {
  return typeof (err as { status?: unknown }).status === "number";
}
