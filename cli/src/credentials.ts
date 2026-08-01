import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredSession {
  username: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface CredentialStore {
  version: 1;
  profiles: Record<string, StoredSession>;
}

export const credentialsPath = () =>
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "bombe",
    "credentials.json",
  );

const emptyStore = (): CredentialStore => ({ version: 1, profiles: {} });

const readStore = async (): Promise<CredentialStore> => {
  try {
    return JSON.parse(await readFile(credentialsPath(), "utf8")) as CredentialStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
};

const writeStore = async (store: CredentialStore): Promise<void> => {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
};

export const loadStoredSession = async (
  userPoolId: string,
): Promise<StoredSession | undefined> => (await readStore()).profiles[userPoolId];

export const saveStoredSession = async (
  userPoolId: string,
  session: StoredSession,
): Promise<void> => {
  const store = await readStore();
  store.profiles[userPoolId] = session;
  await writeStore(store);
};

export const deleteStoredSession = async (userPoolId: string): Promise<void> => {
  const store = await readStore();
  delete store.profiles[userPoolId];
  await writeStore(store);
};
