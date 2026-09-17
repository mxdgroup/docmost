import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  get_distinct_id: vi.fn(),
  get_property: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: sdk }));
vi.mock("@/lib/config", () => ({
  getPostHogHost: () => "https://n.mxd.digital",
  getPostHogKey: () => "project-key",
  isPostHogEnabled: () => true,
}));
function response(identity: any) {
  return { ok: true, json: async () => ({ data: { identity } }) };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionStorage.clear();
  document.cookie = "mxd_consent=granted; path=/";
  history.replaceState({}, "", "/share/token/p/private-title-nDJwhZWybH");
  sdk.get_distinct_id.mockReturnValue("anonymous");
  sdk.get_property.mockReturnValue("anonymous");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(null)));
});

describe("Docs analytics identity lifecycle", () => {
  it("identifies before the first pageview and merges anonymous history without resetting", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ email: "Reader+Tag@Example.com", source: "signal" }) as any,
    );
    const { refreshAnalyticsIdentity } = await import("./docs-analytics");
    await refreshAnalyticsIdentity(true);
    expect(sdk.identify).toHaveBeenCalledWith(
      "reader+tag@example.com",
      { email: "reader+tag@example.com" },
      { first_seen_surface: "docs" },
    );
    expect(sdk.reset).not.toHaveBeenCalled();
    expect(sdk.identify.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.capture.mock.invocationCallOrder[0],
    );
    expect(sdk.init.mock.calls[0][1]).toMatchObject({
      persistence: "cookie",
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
    });
  });
  it("resets different identified people and restores shared event properties", async () => {
    sdk.get_distinct_id.mockReturnValue("previous@example.com");
    sdk.get_property.mockReturnValue("identified");
    vi.mocked(fetch).mockResolvedValue(
      response({ email: "next@example.com", source: "member" }) as any,
    );
    const { refreshAnalyticsIdentity } = await import("./docs-analytics");
    await refreshAnalyticsIdentity(true);
    expect(sdk.reset).toHaveBeenCalledOnce();
    expect(sdk.register).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "docs", environment: "development" }),
    );
    expect(sdk.reset.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.identify.mock.invocationCallOrder[0],
    );
  });
  it("consumes handoffs while denied without initializing or identifying, and resumes after consent returns", async () => {
    document.cookie = "mxd_consent=denied; path=/";
    vi.mocked(fetch).mockResolvedValue(
      response({ email: "reader@example.com", source: "signal" }) as any,
    );
    const { refreshAnalyticsIdentity } = await import("./docs-analytics");
    await refreshAnalyticsIdentity(true);
    expect(fetch).toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.identify).not.toHaveBeenCalled();
    document.cookie = "mxd_consent=granted; path=/";
    vi.mocked(fetch).mockResolvedValue(response(null) as any);
    await refreshAnalyticsIdentity(true);
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    });
    expect(sdk.identify).not.toHaveBeenCalled();
  });
  it("clears a previously authenticated identity after logout/session expiry", async () => {
    sessionStorage.setItem("mxd_docs_analytics_auth", "prior@example.com");
    const { refreshAnalyticsIdentity, startAnalyticsListeners } =
      await import("./docs-analytics");
    const stop = startAnalyticsListeners();
    await refreshAnalyticsIdentity(true);
    expect(sdk.reset).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("mxd_docs_analytics_auth")).toBeNull();
    stop();
  });
  it("drops captures if identity lookup fails and never trusts URL identities", async () => {
    history.replaceState(
      {},
      "",
      "/?ph_distinct_id=forged%40example.com&ph_exp=1&ph_sig=bad",
    );
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const { refreshAnalyticsIdentity, captureApiAction } =
      await import("./docs-analytics");
    await refreshAnalyticsIdentity(true);
    captureApiAction("/comments/create");
    expect(location.search).toBe("");
    expect(sdk.identify).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("records only successful allowlisted actions and drops events immediately after withdrawal", async () => {
    const { refreshAnalyticsIdentity, captureApiAction } =
      await import("./docs-analytics");
    await refreshAnalyticsIdentity();
    captureApiAction("/comments/create");
    captureApiAction("/unexpected/private");
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("docs_comment_created");
    document.cookie = "mxd_consent=denied; path=/";
    captureApiAction("/comments/create");
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    const hook = sdk.init.mock.calls[0][1].before_send;
    expect(hook({ event: "$identify", properties: {} })).toBeNull();
  });
});

it("does not resurrect an expired authenticated identity after consent is restored", async () => {
  vi.mocked(fetch).mockResolvedValue(
    response({ email: "prior@example.com", source: "member" }) as any,
  );
  const { refreshAnalyticsIdentity } = await import("./docs-analytics");
  await refreshAnalyticsIdentity(true);
  document.cookie = "mxd_consent=denied; path=/";
  vi.mocked(fetch).mockResolvedValue(response(null) as any);
  await refreshAnalyticsIdentity();
  document.cookie = "mxd_consent=granted; path=/";
  await refreshAnalyticsIdentity();
  expect(sdk.reset).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("mxd_docs_analytics_auth")).toBeNull();
});

it("serializes refreshes so focus cannot discard a consumed handoff or pageview", async () => {
  let resolve: (result: any) => void;
  vi.mocked(fetch)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue(response(null) as any);
  const { refreshAnalyticsIdentity } = await import("./docs-analytics");
  const initial = refreshAnalyticsIdentity(true);
  const focus = refreshAnalyticsIdentity(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(response({ email: "reader@example.com", source: "signal" }));
  await Promise.all([initial, focus]);
  expect(sdk.identify).toHaveBeenCalledWith(
    "reader@example.com",
    { email: "reader@example.com" },
    { first_seen_surface: "docs" },
  );
  expect(sdk.capture).toHaveBeenCalledExactlyOnceWith("$pageview");
});

it("adopts a sibling-domain identity when an already-open anonymous Docs tab resumes", async () => {
  const { refreshAnalyticsIdentity } = await import("./docs-analytics");
  await refreshAnalyticsIdentity(true);
  document.cookie = `ph_project-key_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: "sibling@example.com", $user_state: "identified" }))}; path=/`;
  await refreshAnalyticsIdentity();
  expect(sdk.identify).toHaveBeenCalledWith(
    "sibling@example.com",
    { email: "sibling@example.com" },
    { first_seen_surface: "docs" },
  );
  expect(sdk.reset).not.toHaveBeenCalled();
  document.cookie = "ph_project-key_posthog=; Max-Age=0; path=/";
});
