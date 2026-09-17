// Route categories supplement the full visited URL; they are not link targets.
export function routeProperties(pathname: string) {
  const page = pathname.match(/\/p\/[^/]*-([A-Za-z0-9]{10,12})\/?$/)?.[1];
  const shared = pathname.startsWith("/share/");
  const known = new Set([
    "home",
    "recent",
    "search",
    "settings",
    "spaces",
    "members",
    "groups",
    "account",
    "profile",
    "security",
    "notifications",
    "preferences",
    "trash",
    "login",
    "signup",
    "forgot-password",
    "password-reset",
  ]);
  const route = shared
    ? page
      ? "/share/:share/p/:page"
      : "/share/:share"
    : page
      ? "/s/:space/p/:page"
      : "/" +
        pathname
          .split("/")
          .filter(Boolean)
          .map((part) => (known.has(part) ? part : ":id"))
          .join("/");
  return {
    route,
    surface: "docs",
    area: shared
      ? "public_share"
      : pathname.startsWith("/s/")
        ? "workspace"
        : pathname.startsWith("/settings")
          ? "settings"
          : "app",
    ...(page ? { page_ref: page } : {}),
  };
}

export function consentDenied(cookies: string): boolean {
  return cookies.split(";").some((cookie) => {
    const [name, ...value] = cookie.trim().split("=");
    if (name !== "mxd_consent") return false;
    try {
      return (
        decodeURIComponent(value.join("=")).trim().toLowerCase() === "denied"
      );
    } catch {
      return false;
    }
  });
}

export function stripHandoff(location: string): string {
  const url = new URL(location);
  ["ph_distinct_id", "ph_exp", "ph_sig"].forEach((key) =>
    url.searchParams.delete(key),
  );
  return url.pathname + url.search + url.hash;
}

export const ACTIONS: Record<string, string> = {
  "/pages/create": "docs_page_created",
  "/pages/update": "docs_page_updated",
  "/pages/delete": "docs_page_deleted",
  "/pages/search": "docs_search_performed",
  "/search": "docs_search_performed",
  "/search/suggest": "docs_search_performed",
  "/comments/create": "docs_comment_created",
  "/comments/update": "docs_comment_updated",
  "/comments/resolve": "docs_comment_resolved",
  "/shares/comments/create": "docs_comment_created",
  "/shares/comments/update": "docs_comment_updated",
  "/shares/comments/resolve": "docs_comment_resolved",
  "/shares/create": "docs_share_created",
  "/shares/update": "docs_share_updated",
  "/shares/delete": "docs_share_revoked",
  "/files/upload": "docs_attachment_uploaded",
  "/files/share-upload": "docs_attachment_uploaded",
};

const EVENTS = new Set([
  "$pageview",
  "$identify",
  "$set",
  "docs_edit_started",
  ...Object.values(ACTIONS),
]);
const PROPERTIES = new Set([
  "token",
  "distinct_id",
  "$anon_distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$insert_id",
  "$time",
  "$timezone",
  "$timezone_offset",
  "$process_person_profile",
  "$is_identified",
  "environment",
  "surface",
  "area",
  "route",
  "page_ref",
  "identity_source",
]);

// Defense in depth for SDK-added properties, $identify, persisted sibling-site props,
// and future captures. Opt-out is checked on every event, including queued captures.
export function redactEvent<
  T extends { event: string; properties: Record<string, any> },
>(event: T | null, url: string, denied: boolean): T | null {
  if (!event || denied || !EVENTS.has(event.event)) return null;
  const location = new URL(url);
  const route = routeProperties(location.pathname);
  const properties = Object.fromEntries(
    Object.entries(event.properties).filter(
      ([key, value]) =>
        PROPERTIES.has(key) &&
        ["string", "number", "boolean"].includes(typeof value),
    ),
  );
  for (const key of ["$set", "$set_once"]) {
    const original = event.properties[key];
    if (original && typeof original === "object") {
      const allowed =
        key === "$set" ? ["email", "name"] : ["first_seen_surface"];
      properties[key] = Object.fromEntries(
        allowed
          .filter((name) => typeof original[name] === "string")
          .map((name) => [name, original[name].slice(0, 254)]),
      );
    }
  }
  // Override rather than trusting any persisted route/current_url from another site.
  const top = event as T & {
    uuid?: string;
    timestamp?: unknown;
    $set?: any;
    $set_once?: any;
  };
  const person = (value: any, keys: string[]) =>
    Object.fromEntries(
      keys
        .filter((key) => typeof value?.[key] === "string")
        .map((key) => [key, value[key].slice(0, 254)]),
    );
  return {
    event: event.event,
    uuid: top.uuid,
    timestamp: top.timestamp,
    ...(top.$set && { $set: person(top.$set, ["email", "name"]) }),
    ...(top.$set_once && {
      $set_once: person(top.$set_once, ["first_seen_surface"]),
    }),
    properties: {
      ...properties,
      ...route,
      $current_url: location.href,
      $pathname: location.pathname,
      $host: location.host,
    },
  } as unknown as T;
}
