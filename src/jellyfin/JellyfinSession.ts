import type { AuthenticationResult } from '@jellyfin/sdk/lib/generated-client/models';
import { ClientInfo } from './authorization';
import { JellyfinApiError } from './errors';
import { JellyfinClient } from './JellyfinClient';
import { QuickConnectInitiation, WaitForQuickConnectOptions } from './quickConnect';
import {
  clearCredentials,
  JellyfinCredentials,
  loadCredentials,
  saveCredentials,
} from './storage/credentialStore';
import { loadDeviceInfo } from './storage/deviceIdentity';
import { KeyValueStore } from './storage/KeyValueStore';

/**
 * Ties the API client to what persists across launches: this device's identity
 * and, once the user has signed in, its credentials.
 *
 * Two things are separated on purpose. The **device id** is created once and
 * then never changes — including across sign-out, because it is what the
 * server uses to recognise this stick. The **credentials** come and go with
 * sign-in. Clearing the two together would hand the server a new device on
 * every sign-out and litter the dashboard with orphans.
 *
 * The store is injected rather than defaulted, which keeps this file free of
 * React Native imports; the app passes `asyncKeyValueStore`.
 */

export interface JellyfinSessionOptions {
  store: KeyValueStore;
  clientInfo: ClientInfo;
  /** Shown in the dashboard and on the approval prompt: "Living Room". */
  deviceName: string;
  /**
   * Used when nothing is stored yet — from `getDevServerUrl()` or a setup
   * screen. A stored server URL always wins, since the stored token is only
   * valid against the server that issued it.
   */
  serverUrl?: string;
  fetchImpl?: typeof fetch;
}

export class JellyfinSession {
  readonly client: JellyfinClient;

  private readonly store: KeyValueStore;
  private credentials: JellyfinCredentials | null;

  private constructor(
    client: JellyfinClient,
    store: KeyValueStore,
    credentials: JellyfinCredentials | null,
  ) {
    this.client = client;
    this.store = store;
    this.credentials = credentials;
  }

  /**
   * Builds a session, restoring a stored one where possible.
   *
   * Restoring does not verify the token — that would put a network round trip
   * in front of the first frame. Call `verify()` once the UI is up, and treat
   * a false result as "show the sign-in screen".
   *
   * @throws if no server URL is known, from storage or options. There is
   *   nothing sensible to do with a client that has no address.
   */
  static async create(
    options: JellyfinSessionOptions,
  ): Promise<JellyfinSession> {
    const deviceInfo = await loadDeviceInfo(options.store, options.deviceName);
    const credentials = await loadCredentials(options.store);
    const serverUrl = credentials?.serverUrl ?? options.serverUrl;

    if (!serverUrl) {
      throw new Error(
        'No Jellyfin server URL: nothing is stored, and none was supplied (see JELLYFIN_SERVER_URL in .env, or the setup screen)',
      );
    }

    const client = new JellyfinClient({
      serverUrl,
      clientInfo: options.clientInfo,
      deviceInfo,
      accessToken: credentials?.accessToken,
      fetchImpl: options.fetchImpl,
    });

    if (credentials) {
      client.setAccessToken(credentials.accessToken, credentials.userId);
    }

    return new JellyfinSession(client, options.store, credentials);
  }

  get isSignedIn(): boolean {
    return this.client.isAuthenticated;
  }

  /** The restored session, or null. Read `userName` for a "signed in as". */
  get storedCredentials(): JellyfinCredentials | null {
    return this.credentials;
  }

  /**
   * Checks a restored token against the server.
   *
   * A token can be revoked from the dashboard or invalidated by a server
   * rebuild, and the failure otherwise surfaces as an unexplained 401 on
   * whatever screen happens to load first. A 401 here clears the stored
   * credentials; anything else — the server being down, say — leaves them
   * alone, because an unreachable server is not a reason to make the user
   * sign in again.
   */
  async verify(): Promise<boolean> {
    if (!this.isSignedIn) {
      return false;
    }

    try {
      await this.client.getCurrentUser();
      return true;
    } catch (error) {
      if (error instanceof JellyfinApiError && error.isUnauthorized) {
        await this.signOut();
        return false;
      }
      throw error;
    }
  }

  /** Starts Quick Connect. Show the returned code on screen. */
  async beginSignIn(): Promise<QuickConnectInitiation> {
    return this.client.initiateQuickConnect();
  }

  /**
   * Waits for approval, then persists the resulting session.
   *
   * The server URL is stored alongside the token because the token is only
   * valid against the server that issued it.
   */
  async completeSignIn(
    secret: string,
    options?: WaitForQuickConnectOptions,
  ): Promise<AuthenticationResult> {
    const result = await this.client.completeQuickConnect(secret, options);

    const accessToken = result?.AccessToken;
    const userId = result?.User?.Id;
    if (!accessToken || !userId) {
      throw new Error(
        'Quick Connect completed without an access token or user id',
      );
    }

    this.credentials = {
      serverUrl: this.client.http.serverUrl,
      accessToken,
      userId,
      userName: result.User?.Name ?? undefined,
      serverName: result.ServerId ?? undefined,
    };
    await saveCredentials(this.store, this.credentials);

    return result;
  }

  /**
   * Signs out on this device. The device id survives, and the token stays
   * valid server-side until revoked from the Jellyfin dashboard.
   */
  async signOut(): Promise<void> {
    this.client.clearAccessToken();
    this.credentials = null;
    await clearCredentials(this.store);
  }
}
