import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// MXD regression — the share-edit defect.
//
// The bug was NOT that the fork ShareModal (with the view/comment/edit selector)
// didn't exist — it did. It was that the *production caller*, the page header,
// mounted the EE PageShareModal instead, which has no concept of share modes, so
// the selector never rendered. Verification against ShareModal in isolation
// passed while the real UI was broken.
//
// This guards the caller/integration boundary: the page header MUST mount the
// fork ShareModal and MUST NOT mount the EE modal. It is deliberately a source
// assertion on the real caller, not an isolated render of ShareModal — the
// latter is exactly the check that missed the original defect.
const relPath = "src/features/page/components/header/page-header-menu.tsx";
const headerPath = [
  resolve(process.cwd(), relPath), // run from apps/client (CI + local)
  resolve(process.cwd(), "apps/client", relPath), // run from repo root
].find(existsSync);
if (!headerPath) {
  throw new Error(`page-header-menu.tsx not found from cwd ${process.cwd()}`);
}
const headerSource = readFileSync(headerPath, "utf8");

describe("page header → share modal wiring", () => {
  it("imports the fork-owned ShareModal", () => {
    expect(headerSource).toMatch(
      /import\s+ShareModal\s+from\s+["']@\/features\/share\/components\/share-modal/,
    );
  });

  it("mounts <ShareModal /> in the header render", () => {
    expect(headerSource).toMatch(/<ShareModal\b/);
  });

  it("does NOT import from the EE page-permission module (the original defect)", () => {
    // Assert on the actual import statement, not incidental mentions — an
    // explanatory comment naming the old component must not trip this.
    expect(headerSource).not.toMatch(/from\s+["']@\/ee\/page-permission["']/);
  });

  it("does NOT mount <PageShareModal /> (the EE modal)", () => {
    expect(headerSource).not.toMatch(/<PageShareModal\b/);
  });
});
