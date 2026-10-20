import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductMediaEditor } from "./ProductMediaEditor";

describe("Atlas V4 managed product photo editor", () => {
  it("never renders owner photo-management controls to a cashier", () => {
    const html = renderToStaticMarkup(<ProductMediaEditor productId="p1" productName="Milk" role="cashier" imageUrl={null} onChanged={() => {}} />);
    expect(html).toBe("");
  });

  it("has accessible photo preview and a safe disabled-by-default state", () => {
    const html = renderToStaticMarkup(<ProductMediaEditor productId="p1" productName="Milk" role="owner" imageUrl={null} onChanged={() => {}} />);
    expect(html).toContain("Product photo");
    expect(html).toContain("Owner-managed photo");
    expect(html).toContain("Photo uploads are not enabled");
    expect(html).not.toContain("SUPABASE_SECRET_KEY");
    expect(html).not.toContain('type="file"');
  });
});
