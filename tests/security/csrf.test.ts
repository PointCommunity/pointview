import { describe, expect, it } from "vitest";

import { createCsrfToken, verifyCsrfRequest } from "@/server/auth/csrf";

describe("browser mutation CSRF boundary", () => {
  it("requires the exact trusted origin and double-submit token", () => {
    const token = createCsrfToken();
    const headers = new Headers({ origin: "https://view.pointatx.org", "x-csrf-token": token });
    expect(() => verifyCsrfRequest(headers, "https://view.pointatx.org", token)).not.toThrow();
    expect(() => verifyCsrfRequest(new Headers({ origin: "https://evil.test", "x-csrf-token": token }), "https://view.pointatx.org", token))
      .toThrow(/origin/i);
    expect(() => verifyCsrfRequest(headers, "https://view.pointatx.org", createCsrfToken())).toThrow(/token/i);
  });
});
