import posthog from "posthog-js";
import { getPostHogHost, getPostHogKey, isPostHogEnabled } from "@/lib/config";
import {
  ACTIONS,
  consentDenied,
  redactEvent,
  stripHandoff,
} from "./analytics-policy";

type Identity = {
  email: string;
  name?: string;
  source: "member" | "commenter" | "signal" | "shared_cookie";
};
let initialized = false;
let ready = false;
let generation = 0;
let refreshing: Promise<void> | null = null;
let refreshRequested = false;
let pendingPageview = false;
let lastRoute = "";
let editAt = 0;
let lastAuthenticated: string | null = null;
const AUTH_KEY = "mxd_docs_analytics_auth";

function denied() {
  return consentDenied(document.cookie);
}
function register() {
  posthog.register({
    surface: "docs",
    environment:
      window.CONFIG?.ENV ||
      (import.meta.env.PROD ? "production" : "development"),
  });
}
function reset() {
  posthog.reset();
  register();
}
function rememberAuthenticated(value: string | null) {
  lastAuthenticated = value;
  try {
    value
      ? sessionStorage.setItem(AUTH_KEY, value)
      : sessionStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage may be blocked */
  }
}

function initialize() {
  if (initialized) return;
  posthog.init(getPostHogKey(), {
    api_host: getPostHogHost(),
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    persistence: "cookie",
    cross_subdomain_cookie: true,
    secure_cookie: location.protocol === "https:",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    save_campaign_params: false,
    save_referrer: false,
    before_send: (event) =>
      ready ? redactEvent(event, location.href, denied()) : null,
  });
  initialized = true;
  register();
}

function identify(identity: Identity) {
  if (denied()) return;
  const email = identity.email.trim().toLowerCase();
  const current = posthog.get_distinct_id();
  const state = posthog.get_property("$user_state");
  const identified = state !== "anonymous" || current?.includes("@");
  if (identified && current !== email) reset();
  posthog.identify(
    email,
    { email, ...(identity.name ? { name: identity.name } : {}) },
    { first_seen_surface: "docs" },
  );
  posthog.register({ identity_source: identity.source });
  rememberAuthenticated(
    ["signal", "shared_cookie"].includes(identity.source) ? null : email,
  );
}

function sharedIdentity(): { email: string } | null {
  const name = `ph_${getPostHogKey()}_posthog=`;
  const value = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name));
  if (!value) return null;
  try {
    const props = JSON.parse(decodeURIComponent(value.slice(name.length)));
    if (
      typeof props.distinct_id !== "string" ||
      props.distinct_id.length > 254 ||
      !/^[^\s@]+@[^\s@]+$/.test(props.distinct_id)
    )
      return null;
    return { email: props.distinct_id.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function refreshAnalyticsIdentity(pageview = false): Promise<void> {
  pendingPageview ||= pageview;
  refreshRequested = true;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    do {
      refreshRequested = false;
      await resolveIdentity();
    } while (refreshRequested);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function resolveIdentity() {
  if (!isPostHogEnabled()) return;
  const version = generation;
  ready = false;
  // The server normally removes these before rendering; never trust leftovers.
  const clean = stripHandoff(location.href);
  if (clean !== location.pathname + location.search + location.hash)
    history.replaceState(history.state, "", clean);
  try {
    const response = await fetch("/api/analytics/identity", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || version !== generation) return;
    const { data } = await response.json();
    if (version !== generation) return;
    if (denied()) {
      if (initialized) posthog.opt_out_capturing();
      // Keep the prior auth marker so expiry/logout while opted out cannot
      // resurrect that person when measurement is restored.
      return;
    }
    // Read before any SDK persistence writes: a sibling tab may have replaced
    // the shared cookie while this tab retained an older in-memory identity.
    const shared = sharedIdentity();
    const priorAuth = lastAuthenticated;
    initialize();
    posthog.opt_in_capturing({ captureEventName: false });
    ready = true;
    const identity: Identity | null = data?.identity;
    if (identity) identify(identity);
    else {
      if (lastAuthenticated) {
        reset();
        rememberAuthenticated(null);
      }
      if (shared && shared.email !== priorAuth)
        identify({ ...shared, source: "shared_cookie" });
      else if (
        !shared &&
        posthog.get_property("$user_state") === "identified" &&
        !priorAuth
      )
        reset();
    }
    if (pendingPageview && lastRoute !== location.pathname) {
      lastRoute = location.pathname;
      editAt = 0;
      posthog.capture("$pageview");
    }
    pendingPageview = false;
  } catch {
    /* Analytics failure must never block the editor. */
  }
}

export function resetAnalyticsIdentity() {
  generation++;
  ready = false;
  lastRoute = "";
  if (initialized) reset();
  rememberAuthenticated(null);
}

export function captureApiAction(path: string) {
  if (!ready || denied()) return;
  const event = ACTIONS[path];
  if (event) posthog.capture(event);
}

export function startAnalyticsListeners() {
  if (!isPostHogEnabled()) return () => {};
  try {
    lastAuthenticated = sessionStorage.getItem(AUTH_KEY);
  } catch {
    /* optional */
  }
  const focus = () => {
    void refreshAnalyticsIdentity();
  };
  const input = (event: Event) => {
    if (
      !event.isTrusted ||
      !ready ||
      denied() ||
      !(event.target instanceof Element) ||
      !event.target.closest('.tiptap[contenteditable="true"]') ||
      Date.now() - editAt < 30_000
    )
      return;
    editAt = Date.now();
    // Activity only, not a claim that persistence has completed. No content/keystrokes.
    posthog.capture("docs_edit_started");
  };
  window.addEventListener("focus", focus);
  document.addEventListener("input", input);
  const visible = () => {
    if (document.visibilityState === "visible") focus();
  };
  document.addEventListener("visibilitychange", visible);
  return () => {
    window.removeEventListener("focus", focus);
    document.removeEventListener("input", input);
    document.removeEventListener("visibilitychange", visible);
  };
}
