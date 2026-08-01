import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import type { ClientConfig } from "./config.js";
import {
  deleteStoredSession,
  loadStoredSession,
  saveStoredSession,
  type StoredSession,
} from "./credentials.js";
import { CliError } from "./errors.js";

export interface AuthContext {
  accessToken: string;
  idToken: string;
  userId: string;
  username: string;
}

const userPool = (config: ClientConfig) =>
  new CognitoUserPool({
    UserPoolId: config.auth.userPoolId,
    ClientId: config.auth.userPoolClientId,
  });

const fromCognitoSession = (
  username: string,
  session: CognitoUserSession,
): StoredSession => ({
  username,
  accessToken: session.getAccessToken().getJwtToken(),
  idToken: session.getIdToken().getJwtToken(),
  refreshToken: session.getRefreshToken().getToken(),
  expiresAt: session.getAccessToken().getExpiration(),
});

export const jwtPayload = (token: string): Record<string, unknown> => {
  const encoded = token.split(".")[1];
  if (!encoded) throw new CliError("Cognito returned an invalid access token.");
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new CliError("Cognito returned an invalid access token.");
  }
};

const authenticate = async (
  config: ClientConfig,
  username: string,
  password: string,
): Promise<StoredSession> =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: userPool(config) });
    const details = new AuthenticationDetails({ Username: username, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(fromCognitoSession(user.getUsername(), session)),
      onFailure: (error) => reject(error),
      newPasswordRequired: () =>
        reject(
          new CliError(
            "This account must reset its password on the BOMBE website before using the CLI.",
          ),
        ),
      mfaRequired: () =>
        reject(new CliError("MFA login is not supported by this CLI version.")),
      totpRequired: () =>
        reject(new CliError("MFA login is not supported by this CLI version.")),
    });
  });

const refresh = async (
  config: ClientConfig,
  stored: StoredSession,
): Promise<StoredSession> =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({
      Username: stored.username,
      Pool: userPool(config),
    });
    user.refreshSession(
      new CognitoRefreshToken({ RefreshToken: stored.refreshToken }),
      (error, session) => {
        if (error || !session) {
          reject(
            new CliError(
              "Your BOMBE login has expired. Run `bombe auth login` again.",
            ),
          );
          return;
        }
        resolve(fromCognitoSession(stored.username, session));
      },
    );
  });

const authContext = (stored: StoredSession): AuthContext => {
  const payload = jwtPayload(stored.accessToken);
  const identity = jwtPayload(stored.idToken);
  if (typeof payload.sub !== "string") {
    throw new CliError("Cognito access token does not contain a user id.");
  }
  return {
    accessToken: stored.accessToken,
    idToken: stored.idToken,
    userId: payload.sub,
    username:
      typeof identity.email === "string" ? identity.email : stored.username,
  };
};

export const login = async (
  config: ClientConfig,
  username: string,
  password: string,
): Promise<AuthContext> => {
  const session = await authenticate(config, username, password);
  await saveStoredSession(config.auth.userPoolId, session);
  return authContext(session);
};

export const requireAuth = async (config: ClientConfig): Promise<AuthContext> => {
  let stored = await loadStoredSession(config.auth.userPoolId);
  if (!stored) throw new CliError("Run `bombe auth login` first.");
  if (stored.expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    stored = await refresh(config, stored);
    await saveStoredSession(config.auth.userPoolId, stored);
  }
  return authContext(stored);
};

export const logout = async (config: ClientConfig): Promise<void> =>
  deleteStoredSession(config.auth.userPoolId);
