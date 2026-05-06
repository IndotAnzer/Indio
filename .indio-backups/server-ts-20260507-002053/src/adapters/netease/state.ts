import type {
  NeteasePlaylistSummary,
  NeteaseQrLoginSession,
  NeteaseUserSummary,
  Track
} from "@indio/contracts";
import { StateStore } from "../../core/state.js";

const AUTH_KEY = "netease_auth";
const LIBRARY_KEY = "netease_library";
const QR_SESSION_KEY = "netease_qr_session";
const PENDING_AUTH_KEY = "netease_pending_auth_cookie";

export interface StoredNeteaseAuth {
  cookie: string;
  user: NeteaseUserSummary;
  loggedInAt: string;
}

export interface StoredMusicLibrary<TTrack extends Track = Track> {
  user: NeteaseUserSummary | null;
  playlists: NeteasePlaylistSummary[];
  tracks: TTrack[];
  refreshedAt: string | null;
}

export function defaultMusicLibrary<TTrack extends Track = Track>(): StoredMusicLibrary<TTrack> {
  return {
    user: null,
    playlists: [],
    tracks: [],
    refreshedAt: null
  };
}

export class MusicStateRepository {
  constructor(private readonly state: StateStore) {}

  getAuth(): StoredNeteaseAuth | null {
    return this.state.getJson<StoredNeteaseAuth | null>(AUTH_KEY, null);
  }

  saveAuth(auth: StoredNeteaseAuth | null): void {
    this.state.setJson(AUTH_KEY, auth);
  }

  getLibrary<TTrack extends Track = Track>(): StoredMusicLibrary<TTrack> {
    return this.state.getJson<StoredMusicLibrary<TTrack>>(LIBRARY_KEY, defaultMusicLibrary<TTrack>());
  }

  saveLibrary<TTrack extends Track>(library: StoredMusicLibrary<TTrack>): void {
    this.state.setJson(LIBRARY_KEY, library);
  }

  getQrSession(): NeteaseQrLoginSession | null {
    return this.state.getJson<NeteaseQrLoginSession | null>(QR_SESSION_KEY, null);
  }

  saveQrSession(session: NeteaseQrLoginSession | null): void {
    this.state.setJson(QR_SESSION_KEY, session);
  }

  getPendingAuthCookie(): string | null {
    return this.state.getJson<string | null>(PENDING_AUTH_KEY, null);
  }

  savePendingAuthCookie(cookie: string | null): void {
    this.state.setJson(PENDING_AUTH_KEY, cookie);
  }
}
