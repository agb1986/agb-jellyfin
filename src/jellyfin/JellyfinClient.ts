import type {
  AuthenticationResult,
  BaseItemDto,
  BaseItemDtoQueryResult,
  DeviceProfile,
  PlaybackInfoResponse,
  PublicSystemInfo,
  UserDto,
} from '@jellyfin/sdk/lib/generated-client/models';
import { ClientInfo, DeviceInfo } from './authorization';
import { buildDeviceProfile } from './deviceProfile';
import { JellyfinHttp, JellyfinHttpOptions } from './JellyfinHttp';
import {
  initiateQuickConnect,
  isQuickConnectEnabled,
  QuickConnectInitiation,
  waitForQuickConnect,
  WaitForQuickConnectOptions,
} from './quickConnect';

/**
 * The Jellyfin API surface this client uses.
 *
 * Everything here is plain HTTP and runs under Node, so it is testable without
 * a device — which matters, because the device half of this project needs
 * hardware the API half does not.
 *
 * Types come from `@jellyfin/sdk`, which is a devDependency: they are imported
 * with `import type` and erased at build time, so none of the SDK's runtime
 * (or its axios dependency) reaches the bundle.
 */

export interface JellyfinClientOptions extends JellyfinHttpOptions {
  /** Overrides the profile sent with PlaybackInfo requests. */
  deviceProfile?: DeviceProfile;
}

export class JellyfinClient {
  readonly http: JellyfinHttp;

  private readonly deviceProfile: DeviceProfile;
  private userId?: string;

  constructor(options: JellyfinClientOptions) {
    this.http = new JellyfinHttp(options);
    this.deviceProfile = options.deviceProfile ?? buildDeviceProfile();
  }

  get clientInfo(): ClientInfo {
    return this.http.clientInfo;
  }

  get deviceInfo(): DeviceInfo {
    return this.http.deviceInfo;
  }

  get isAuthenticated(): boolean {
    return this.http.isAuthenticated;
  }

  /** The signed-in user's id, once known. Needed by most library endpoints. */
  get currentUserId(): string | undefined {
    return this.userId;
  }

  // --- Reachability -------------------------------------------------------

  /**
   * Unauthenticated. Use it to check an address the user typed before asking
   * them to go and approve a code — a wrong URL and an unapproved code look
   * identical from the sign-in screen otherwise.
   */
  async getPublicSystemInfo(): Promise<PublicSystemInfo> {
    return this.http.request<PublicSystemInfo>('/System/Info/Public');
  }

  // --- Authentication -----------------------------------------------------

  async isQuickConnectEnabled(): Promise<boolean> {
    return isQuickConnectEnabled(this.http);
  }

  async initiateQuickConnect(): Promise<QuickConnectInitiation> {
    return initiateQuickConnect(this.http);
  }

  /**
   * Waits for the user to approve the code, then adopts the resulting token
   * so subsequent calls on this client are authenticated.
   */
  async completeQuickConnect(
    secret: string,
    options?: WaitForQuickConnectOptions,
  ): Promise<AuthenticationResult> {
    const result = await waitForQuickConnect(this.http, secret, options);
    this.adoptAuthentication(result);
    return result;
  }

  /**
   * Restores a session from a stored token. The token alone is not enough —
   * the DeviceId that obtained it must match, or the server treats it as a
   * different device.
   */
  setAccessToken(accessToken: string, userId?: string): void {
    this.http.setAccessToken(accessToken);
    this.userId = userId;
  }

  /** Drops local credentials. Does not revoke the token server-side. */
  clearAccessToken(): void {
    this.http.setAccessToken('');
    this.userId = undefined;
  }

  async getCurrentUser(): Promise<UserDto> {
    const user = await this.http.request<UserDto>('/Users/Me');
    if (user?.Id) {
      this.userId = user.Id;
    }
    return user;
  }

  // --- Library ------------------------------------------------------------

  /** The user's libraries — Movies, Shows, Music and so on. */
  async getUserViews(): Promise<BaseItemDtoQueryResult> {
    return this.http.request<BaseItemDtoQueryResult>('/UserViews', {
      query: { userId: this.requireUserId() },
    });
  }

  /**
   * Queries items. `parentId` scopes to a library; `fields` asks for the extra
   * metadata the details screen needs but the grid does not.
   */
  async getItems(query: ItemsQuery = {}): Promise<BaseItemDtoQueryResult> {
    return this.http.request<BaseItemDtoQueryResult>('/Items', {
      query: {
        userId: this.requireUserId(),
        parentId: query.parentId,
        includeItemTypes: query.includeItemTypes?.join(','),
        recursive: query.recursive,
        sortBy: query.sortBy?.join(','),
        sortOrder: query.sortOrder,
        startIndex: query.startIndex,
        limit: query.limit,
        fields: query.fields?.join(','),
        searchTerm: query.searchTerm,
      },
    });
  }

  async getItem(itemId: string): Promise<BaseItemDto> {
    return this.http.request<BaseItemDto>(`/Items/${encodeURIComponent(itemId)}`, {
      query: { userId: this.requireUserId() },
    });
  }

  /** Absolute URL for an item's artwork, for an <Image source={{ uri }} />. */
  getImageUrl(
    itemId: string,
    imageType: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo' = 'Primary',
    options: { maxWidth?: number; maxHeight?: number; tag?: string } = {},
  ): string {
    return this.http.buildUrl(
      `/Items/${encodeURIComponent(itemId)}/Images/${imageType}`,
      {
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        tag: options.tag,
      },
    );
  }

  // --- Playback -----------------------------------------------------------

  /**
   * Asks the server how it intends to deliver a title.
   *
   * This is the call the whole project turns on. The response's MediaSources
   * carry `SupportsDirectPlay`, `SupportsDirectStream`, `TranscodingUrl` and —
   * when the answer is "transcode" — `TranscodeReasons` naming the offending
   * codec or container. Tuning the DeviceProfile until the library's worst
   * offenders come back as DirectStream is Phase 2 of the plan, and it can be
   * done entirely from a laptop.
   */
  async getPlaybackInfo(
    itemId: string,
    options: PlaybackInfoOptions = {},
  ): Promise<PlaybackInfoResponse> {
    return this.http.request<PlaybackInfoResponse>(
      `/Items/${encodeURIComponent(itemId)}/PlaybackInfo`,
      {
        method: 'POST',
        body: {
          UserId: this.requireUserId(),
          DeviceProfile: options.deviceProfile ?? this.deviceProfile,
          MaxStreamingBitrate:
            options.maxStreamingBitrate ??
            this.deviceProfile.MaxStreamingBitrate,
          StartTimeTicks: options.startTimeTicks ?? 0,
          MediaSourceId: options.mediaSourceId,
          AudioStreamIndex: options.audioStreamIndex,
          SubtitleStreamIndex: options.subtitleStreamIndex,
          EnableDirectPlay: options.enableDirectPlay ?? true,
          EnableDirectStream: options.enableDirectStream ?? true,
          EnableTranscoding: options.enableTranscoding ?? true,
          AllowVideoStreamCopy: true,
          AllowAudioStreamCopy: true,
        },
      },
    );
  }

  /**
   * Absolute URL of a media source the server said can be played as-is.
   *
   * `TranscodingUrl` from PlaybackInfo takes precedence when present — it is
   * already a complete relative URL and encodes the server's chosen settings.
   */
  getStreamUrl(
    itemId: string,
    mediaSourceId: string,
    playSessionId?: string,
  ): string {
    // api_key in the query string, not the Authorization header: Shaka and the
    // static player fetch media through their own networking, which never sees
    // the headers this client sets. Jellyfin's own TranscodingUrl does the
    // same. It does mean playback URLs can end up in a proxy or server log,
    // which is a reason to keep the token per-device and revocable rather than
    // to reach for a server-wide API key.
    return this.http.buildUrl(`/Videos/${encodeURIComponent(itemId)}/stream`, {
      static: true,
      mediaSourceId,
      playSessionId,
      deviceId: this.deviceInfo.id,
      api_key: this.http.accessToken || undefined,
    });
  }

  // --- Playback reporting -------------------------------------------------

  /**
   * Reporting is what makes resume, watched state and Continue Watching work,
   * and it is server-side on purpose: five sticks sharing one server should
   * agree on where a film was paused, which local storage cannot deliver.
   *
   * Positions are in ticks — 10,000,000 per second.
   */
  async reportPlaybackStart(progress: PlaybackProgress): Promise<void> {
    await this.http.request<void>('/Sessions/Playing', {
      method: 'POST',
      body: this.buildProgressBody(progress),
    });
  }

  /** Call roughly every ten seconds while playing, and on pause or seek. */
  async reportPlaybackProgress(progress: PlaybackProgress): Promise<void> {
    await this.http.request<void>('/Sessions/Playing/Progress', {
      method: 'POST',
      body: this.buildProgressBody(progress),
    });
  }

  async reportPlaybackStopped(progress: PlaybackProgress): Promise<void> {
    await this.http.request<void>('/Sessions/Playing/Stopped', {
      method: 'POST',
      body: this.buildProgressBody(progress),
    });
  }

  private buildProgressBody(progress: PlaybackProgress): Record<string, unknown> {
    return {
      ItemId: progress.itemId,
      MediaSourceId: progress.mediaSourceId ?? progress.itemId,
      PlaySessionId: progress.playSessionId,
      PositionTicks: progress.positionTicks,
      IsPaused: progress.isPaused ?? false,
      IsMuted: progress.isMuted ?? false,
      AudioStreamIndex: progress.audioStreamIndex,
      SubtitleStreamIndex: progress.subtitleStreamIndex,
      PlayMethod: progress.playMethod,
    };
  }

  /**
   * Most library endpoints are user-scoped. Failing loudly here beats sending
   * `userId=undefined` and debugging an opaque 400 from the server.
   */
  private requireUserId(): string {
    if (!this.userId) {
      throw new Error(
        'No Jellyfin user id — sign in with Quick Connect, or call setAccessToken with the stored user id, before querying the library',
      );
    }
    return this.userId;
  }

  private adoptAuthentication(result: AuthenticationResult): void {
    if (result?.AccessToken) {
      this.http.setAccessToken(result.AccessToken);
    }
    if (result?.User?.Id) {
      this.userId = result.User.Id;
    }
  }
}

export interface ItemsQuery {
  parentId?: string;
  includeItemTypes?: string[];
  recursive?: boolean;
  sortBy?: string[];
  sortOrder?: 'Ascending' | 'Descending';
  startIndex?: number;
  limit?: number;
  fields?: string[];
  searchTerm?: string;
}

export interface PlaybackInfoOptions {
  deviceProfile?: DeviceProfile;
  maxStreamingBitrate?: number | null;
  startTimeTicks?: number;
  mediaSourceId?: string;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  enableDirectPlay?: boolean;
  enableDirectStream?: boolean;
  enableTranscoding?: boolean;
}

export interface PlaybackProgress {
  itemId: string;
  playSessionId?: string;
  mediaSourceId?: string;
  /** 10,000,000 ticks per second. */
  positionTicks: number;
  isPaused?: boolean;
  isMuted?: boolean;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  playMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode';
}

/** Ticks per second, as used by every position field in the Jellyfin API. */
export const TICKS_PER_SECOND = 10_000_000;

export const secondsToTicks = (seconds: number): number =>
  Math.round(seconds * TICKS_PER_SECOND);

export const ticksToSeconds = (ticks: number): number =>
  ticks / TICKS_PER_SECOND;
