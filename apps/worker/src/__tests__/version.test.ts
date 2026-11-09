import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import { WORKER_VERSION } from "../index.js";

describe("Worker Entry Version", () => {
  it("matches the shared workspace version", () => {
    expect(WORKER_VERSION).toBe(WORKSPACE_VERSION);
  });
});
