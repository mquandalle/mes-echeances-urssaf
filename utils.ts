// Service principal pour le trousseau macOS
const KEYCHAIN_SERVICE = "cli-administratif";

// Noms des services supportés
export type ServiceName = "kbis" | "urssaf";

interface Credentials {
  login: string;
  password: string;
}

interface SessionData {
  token: string;
  expiresAt: number;
}

// Headers HTTP communs
export const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
};

// === CREDENTIALS (permanents) ===

export async function getCredentials(name: ServiceName): Promise<Credentials | null> {
  const stored = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name });
  return stored ? JSON.parse(stored) : null;
}

export async function setCredentials(
  name: ServiceName,
  login: string,
  password: string
): Promise<void> {
  await Bun.secrets.set({
    service: KEYCHAIN_SERVICE,
    name,
    value: JSON.stringify({ login, password }),
  });
}

export async function deleteCredentials(name: ServiceName): Promise<void> {
  await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name });
}

export async function getOrPromptCredentials(
  name: ServiceName,
  loginPrompt: string
): Promise<Credentials> {
  const stored = await getCredentials(name);
  if (stored) return stored;

  const login = await ask(loginPrompt);
  const password = await askPassword("Mot de passe: ");
  process.stdin.pause();

  await setCredentials(name, login, password);
  console.log("Identifiants sauvegardés dans le trousseau.");
  return { login, password };
}

// === SESSION TOKENS (avec TTL) ===

const sessionKey = (name: ServiceName) => `${name}-session`;

export async function getSessionToken(name: ServiceName): Promise<string | null> {
  const stored = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: sessionKey(name) });
  if (!stored) return null;

  const data: SessionData = JSON.parse(stored);
  if (Date.now() > data.expiresAt) {
    await deleteSessionToken(name);
    return null;
  }
  return data.token;
}

export async function setSessionToken(
  name: ServiceName,
  token: string,
  ttlMinutes: number
): Promise<void> {
  const data: SessionData = {
    token,
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
  };
  await Bun.secrets.set({
    service: KEYCHAIN_SERVICE,
    name: sessionKey(name),
    value: JSON.stringify(data),
  });
}

export async function deleteSessionToken(name: ServiceName): Promise<void> {
  await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name: sessionKey(name) });
}

// === PROMPTS INTERACTIFS ===

export async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) =>
    process.stdin.once("data", (data) => resolve(data.toString().trim()))
  );
}

export async function askPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  await Bun.$`stty -echo`;
  const password = await new Promise<string>((resolve) =>
    process.stdin.once("data", (data) => resolve(data.toString().trim()))
  );
  await Bun.$`stty echo`;
  process.stdout.write("\n");
  return password;
}

// === HELPERS HTTP ===

export function parseCookies(response: Response): Bun.CookieMap {
  return new Bun.CookieMap(response.headers.getSetCookie().join("; "));
}
