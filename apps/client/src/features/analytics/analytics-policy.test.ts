import { describe, it, expect } from "vitest";
import {
  consentDenied,
  redactEvent,
  routeProperties,
  stripHandoff,
} from "./analytics-policy";

describe("Docs analytics privacy boundary", () => {
  it("keeps route categories and page references as separate grouping metadata", () => {
    expect(
      routeProperties("/share/g6qbcygjqy/p/private-client-brief-nDJwhZWybH"),
    ).toEqual({
      route: "/share/:share/p/:page",
      surface: "docs",
      area: "public_share",
      page_ref: "nDJwhZWybH",
    });
    expect(
      routeProperties("/s/private-client/p/private-brief-nDJwhZWybH").route,
    ).toBe("/s/:space/p/:page");
    expect(routeProperties("/password-reset/private-token").route).toBe(
      "/password-reset/:id",
    );
  });
  it.each([
    "https://docs.mxd.digital/s/marketing/p/kitchens-writing-brief-nDJwhZWybH?view=outline#section-2",
    "https://docs.mxd.digital/share/g6qbcygjqy/p/kitchens-writing-brief-nDJwhZWybH?view=outline#section-2",
    "https://docs.mxd.digital/settings/account/preferences",
  ])("records the full visited URL: %s", (url) => {
    const result = redactEvent(
      { event: "$pageview", properties: {} },
      url,
      false,
    );
    expect(result.properties).toMatchObject({
      $current_url: url,
      $pathname: new URL(url).pathname,
    });
  });
  it("removes handoff parameters without affecting document access", () => {
    expect(
      stripHandoff(
        "https://docs.mxd.digital/share/secret?ph_distinct_id=x%40y.com&ph_exp=1&ph_sig=bad&view=1#comment",
      ),
    ).toBe("/share/secret?view=1#comment");
  });
  it("redacts SDK, nested person, sibling-site and arbitrary properties on every event", () => {
    const input = {
      event: "$identify",
      uuid: "event-id",
      $set: { name: "Reader", content: "private" },
      $set_once: { $initial_current_url: "secret" },
      properties: {
        distinct_id: "reader@example.com",
        $anon_distinct_id: "anonymous",
        $current_url: "https://docs.mxd.digital/share/secret?token=private",
        $referrer: "https://other.test/token",
        $set: {
          email: "reader@example.com",
          name: "Reader",
          phone: "123",
          content: "private",
          $initial_current_url: "secret",
        },
        $set_once: {
          first_seen_surface: "docs",
          $initial_current_url: "secret",
        },
        content: "document body",
        query: "private search",
        $elements: ["private text"],
        inherited: { password: "secret" },
      },
    };
    const result = redactEvent(
      input,
      "https://docs.mxd.digital/share/g6qbcygjqy/p/writing-brief-nDJwhZWybH?view=outline#section-2",
      false,
    );
    const serialized = JSON.stringify(result);
    for (const blocked of [
      "private",
      "secret",
      "phone",
      "content",
      "query",
      "$elements",
      "$referrer",
    ])
      expect(serialized).not.toContain(blocked);
    expect(result.properties.$current_url).toBe(
      "https://docs.mxd.digital/share/g6qbcygjqy/p/writing-brief-nDJwhZWybH?view=outline#section-2",
    );
    expect(result.properties.$set).toEqual({
      email: "reader@example.com",
      name: "Reader",
    });
    expect(result.properties.distinct_id).toBe("reader@example.com");
  });
  it("rejects unexpected event kinds and honours withdrawal", () => {
    expect(
      redactEvent(
        { event: "$snapshot", properties: {} },
        "https://docs.mxd.digital",
        false,
      ),
    ).toBeNull();
    expect(
      redactEvent(
        { event: "$pageview", properties: {} },
        "https://docs.mxd.digital",
        true,
      ),
    ).toBeNull();
    expect(consentDenied("other=yes; mxd_consent=%20DENIED%20")).toBe(true);
    expect(consentDenied("mxd_consent=granted")).toBe(false);
    expect(consentDenied("")).toBe(false);
  });
});
