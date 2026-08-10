import { describe, expect, it } from "vitest";
import { mapAuthError } from "./auth-error";

/** Minimal ApiError-like shape — the real class lives in data/api.ts. */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("mapAuthError", () => {
  it("maps known invalid-code shapes to friendly copy", () => {
    expect(mapAuthError(apiError(400, "invalid or expired code"), "fb")).toBe(
      "That code didn't match. Double-check and try again.",
    );
  });

  it("maps expired codes", () => {
    expect(mapAuthError(apiError(400, "code has expired"), "fb")).toBe(
      "That code has expired. Tap resend to get a new one.",
    );
  });

  it("maps rate-limit / throttle to a wait message", () => {
    expect(mapAuthError(apiError(429, "please wait before requesting another code"), "fb")).toBe(
      "Too many attempts. Wait a moment and try again.",
    );
  });

  it("maps 401 to a session-expired message", () => {
    expect(mapAuthError(apiError(401, "unauthorized"), "fb")).toBe(
      "Your session has expired. Please sign in again.",
    );
  });

  it("surfaces the concrete server message + status for unrecognised errors", () => {
    expect(mapAuthError(apiError(500, "failed to send verification code"), "fb")).toBe(
      "Something went wrong (500): failed to send verification code",
    );
  });

  it("returns the fallback for non-Error input", () => {
    expect(mapAuthError("nope", "fb")).toBe("fb");
  });

  it("returns the error message for a plain Error (no status)", () => {
    expect(mapAuthError(new Error("boom"), "fb")).toBe("boom");
  });
});
