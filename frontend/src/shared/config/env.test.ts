import { describe, expect, it } from "vitest";
import { env } from "@/shared/config";

describe("env", () => {
  it("exposes a string apiBaseUrl", () => {
    expect(typeof env.apiBaseUrl).toBe("string");
  });

  it("exposes mode flags", () => {
    expect(typeof env.isDev).toBe("boolean");
  });
});
