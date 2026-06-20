import { describe, expect, it } from "vitest";
import { loadMcpConfig } from "./config.js";

describe("loadMcpConfig", () => {
  it("uses MCP_API_BASE_URL and strips trailing slashes", () => {
    const cfg = loadMcpConfig({ MCP_API_BASE_URL: "http://api.local:9000//" });
    expect(cfg.apiBaseUrl).toBe("http://api.local:9000");
  });

  it("falls back to API_PORT on localhost when base url is unset", () => {
    const cfg = loadMcpConfig({ API_PORT: "3005" });
    expect(cfg.apiBaseUrl).toBe("http://localhost:3005");
  });

  it("defaults to localhost:3001 with no env", () => {
    const cfg = loadMcpConfig({});
    expect(cfg.apiBaseUrl).toBe("http://localhost:3001");
    expect(cfg.defaultAgentProfileId).toBeUndefined();
    expect(cfg.requestTimeoutMs).toBe(15000);
  });

  it("reads the default agent profile and timeout", () => {
    const cfg = loadMcpConfig({
      MCP_DEFAULT_AGENT_PROFILE_ID: "agent-x",
      MCP_REQUEST_TIMEOUT_MS: "5000",
    });
    expect(cfg.defaultAgentProfileId).toBe("agent-x");
    expect(cfg.requestTimeoutMs).toBe(5000);
  });

  it("ignores invalid timeout and keeps default", () => {
    const cfg = loadMcpConfig({ MCP_REQUEST_TIMEOUT_MS: "not-a-number" });
    expect(cfg.requestTimeoutMs).toBe(15000);
  });
});
