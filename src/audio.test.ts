import { describe, expect, it } from "vitest";

import { mergePcmChunks } from "./audio";

describe("mergePcmChunks", () => {
  it("joins captured audio without changing sample order", () => {
    const result = mergePcmChunks([
      new Float32Array([0.1, -0.2]),
      new Float32Array([]),
      new Float32Array([0.3, 0.4]),
    ]);

    expect(Array.from(result)).toEqual([
      Math.fround(0.1),
      Math.fround(-0.2),
      Math.fround(0.3),
      Math.fround(0.4),
    ]);
  });

  it("returns an empty buffer when the microphone produced no samples", () => {
    expect(mergePcmChunks([])).toEqual(new Float32Array());
  });
});
