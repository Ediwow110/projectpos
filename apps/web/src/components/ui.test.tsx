import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DangerButton, GhostButton, PrimaryButton } from "./ui";

describe("shared button interaction feedback", () => {
  it("gives all shared buttons an immediate pressed-state transform", () => {
    for (const button of [
      <PrimaryButton>Save</PrimaryButton>,
      <GhostButton>Cancel</GhostButton>,
      <DangerButton>Delete</DangerButton>,
    ]) {
      const html = renderToStaticMarkup(button);
      expect(html).toContain("active:scale-[0.98]");
      expect(html).toContain("motion-reduce:transform-none");
    }
  });
});
