// MXD: the only identity a share guest has lives in their browser — a display
// name, and one ownership token per comment they posted (the server returns
// it once at create time and requires it to edit/delete that comment).
// Storage can be unavailable (private mode, blocked site data): every access
// is guarded and degrades to "not owned" / "no name yet".
const NAME_KEY = "mxdGuestName";
const TOKENS_KEY = "mxdGuestCommentTokens";

function readTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getGuestName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGuestName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // name then lasts only for this page view
  }
}

export function getGuestCommentToken(commentId: string): string | undefined {
  return readTokens()[commentId];
}

export function saveGuestCommentToken(commentId: string, token: string): void {
  try {
    const tokens = readTokens();
    tokens[commentId] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // without storage the guest can't edit/delete later; posting still works
  }
}

export function forgetGuestCommentToken(commentId: string): void {
  try {
    const tokens = readTokens();
    delete tokens[commentId];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // ignore
  }
}
