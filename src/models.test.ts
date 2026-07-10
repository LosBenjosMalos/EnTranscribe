import { describe, expect, it } from "vitest";
import { MODELS, formatBytes, getModel } from "./models";

describe("model registry", () => {
  it("provides integrity hashes for every supported model", () => {
    for (const model of Object.values(MODELS)) {
      expect(model.sha1).toMatch(/^[a-f0-9]{40}$/);
      expect(model.url).toMatch(/^https:\/\//);
    }
  });

  it("rejects unknown models", () => expect(() => getModel("large")).toThrow("Unknown model"));
  it("formats model sizes", () => expect(formatBytes(75 * 1024 * 1024)).toBe("75 MB"));
});
