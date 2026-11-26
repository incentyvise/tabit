import { describe, it, expect } from "vitest";
import { describeOAuthClient } from "./mcp-clients.js";

describe("describeOAuthClient", () => {
  it("verifies a CIMD client by its client_id host", () => {
    const d = describeOAuthClient({ clientId: "https://claude.ai/oauth/mcp.json", name: "Claude" });
    expect(d.verifiedAs).toBe("Claude");
    expect(d.label).toBe("Claude");
  });

  it("verifies a DCR client only when every redirect URI is on the known host", () => {
    const ok = describeOAuthClient({
      clientId: "abc",
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(ok.verifiedAs).toBe("Claude");

    const spoof = describeOAuthClient({
      clientId: "abc",
      name: "Claude",
      redirectUris: ["https://claude.ai/x", "https://evil.example/cb"],
    });
    expect(spoof.verifiedAs).toBeNull();
    expect(spoof.label).toBe("Claude (unverified)");
  });

  it("qualifies self-declared names with their host", () => {
    const d = describeOAuthClient({
      clientId: "abc",
      name: "Tab Support",
      redirectUris: ["https://evil.example/cb"],
    });
    expect(d.verifiedAs).toBeNull();
    expect(d.label).toBe("Tab Support (evil.example)");
  });
});
