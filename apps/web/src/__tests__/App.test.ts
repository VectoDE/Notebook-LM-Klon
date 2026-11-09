import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";

describe("RelationNotes Web Shell (App.tsx)", () => {
  it("renders accessible main landmark with RelationNotes title and workspace version", () => {
    const element = App();
    expect(element.type).toBe("main");
    expect(element.props["aria-labelledby"]).toBe("app-title");

    const serialized = JSON.stringify(element);
    expect(serialized).toContain("RelationNotes");
    expect(serialized).toContain("NotebookLM & RelationFlow Knowledge Studio");
    expect(serialized).toContain(WORKSPACE_VERSION);
  });
});
