import { describe, expect, it } from "vitest";
import { cleanTranscript, formatDuration, formatMilliseconds } from "./format";

describe("cleanTranscript", () => {
  it("removes known non-speech markers and fixes punctuation spacing", () => {
    expect(cleanTranscript("  Hello ,  world ! [BLANK_AUDIO] ")).toBe("Hello, world!");
  });

  it("keeps paragraph breaks while trimming surrounding whitespace", () => {
    expect(cleanTranscript(" First line  \n   Second line ")).toBe("First line\nSecond line");
  });
});

describe("time formatting", () => {
  it("formats recorder durations", () => expect(formatDuration(65.9)).toBe("01:05"));
  it("formats inference durations", () => expect(formatMilliseconds(1520)).toBe("1.52 s"));
});
