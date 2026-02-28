import { describe, it, expect } from "vitest";
import { validateModel, DEFAULT_MODEL } from "../copilot.js";

const AVAILABLE_MODELS = ["gpt-4.1", "gpt-4o", "claude-sonnet-4.5", "o3-mini"];

describe("validateModel", () => {
  it("accepts the default model when it is available", () => {
    expect(validateModel(DEFAULT_MODEL, AVAILABLE_MODELS)).toBe("gpt-4.1");
  });

  it("accepts a custom model when it is available", () => {
    expect(validateModel("claude-sonnet-4.5", AVAILABLE_MODELS)).toBe("claude-sonnet-4.5");
  });

  it("throws when the requested model is not available", () => {
    expect(() => validateModel("nonexistent-model", AVAILABLE_MODELS)).toThrow(
      'Model "nonexistent-model" is not available. Available models: gpt-4.1, gpt-4o, claude-sonnet-4.5, o3-mini'
    );
  });

  it("throws when the available model list is empty", () => {
    expect(() => validateModel("gpt-4.1", [])).toThrow(
      'Model "gpt-4.1" is not available'
    );
  });
});

describe("DEFAULT_MODEL", () => {
  it("is gpt-4.1", () => {
    expect(DEFAULT_MODEL).toBe("gpt-4.1");
  });
});
