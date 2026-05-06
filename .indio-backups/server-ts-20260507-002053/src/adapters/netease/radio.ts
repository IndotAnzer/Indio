import type { Track } from "@indio/contracts";

export interface RadioLibraryTrack extends Track {
  playlistNames: string[];
}

function scoreLibraryTrack(track: RadioLibraryTrack, query: string): number {
  const normalized = query.toLowerCase();
  const haystacks = [
    track.title.toLowerCase(),
    track.artist.toLowerCase(),
    track.album.toLowerCase(),
    ...track.playlistNames.map((playlist) => playlist.toLowerCase())
  ];

  let score = 0;

  for (const haystack of haystacks) {
    if (haystack.includes(normalized)) {
      score += 6;
    }
  }

  if (normalized.includes("focus") || normalized.includes("专注") || normalized.includes("工作")) {
    score += track.playlistNames.some((name) => /专注|focus|工作|coding|study/i.test(name)) ? 5 : 0;
  }

  if (normalized.includes("quiet") || normalized.includes("安静") || normalized.includes("轻")) {
    score += track.playlistNames.some((name) => /安静|轻|night|sleep|chill/i.test(name)) ? 5 : 0;
  }

  if (normalized.includes("morning") || normalized.includes("早")) {
    score += track.playlistNames.some((name) => /早|morning|sunrise/i.test(name)) ? 5 : 0;
  }

  if (normalized.includes("evening") || normalized.includes("晚") || normalized.includes("夜")) {
    score += track.playlistNames.some((name) => /夜|晚|midnight|evening|late/i.test(name)) ? 5 : 0;
  }

  return score;
}

export function trackKey(track: Track): string {
  return track.neteaseId ?? track.id;
}

export function primaryArtistKey(track: Track): string {
  return track.artist
    .split(/[\/,，、&＆]/)[0]
    ?.replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? track.artist.toLowerCase();
}

function trackText(track: RadioLibraryTrack): string {
  return [
    track.title,
    track.artist,
    track.album,
    track.mood,
    track.sourcePlaylists?.join(" "),
    track.playlistNames.join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

export function samePrimaryArtist(left: Track | null | undefined, right: Track): boolean {
  if (!left?.artist || !right.artist) {
    return false;
  }

  const leftArtist = primaryArtistKey(left);
  const rightArtist = primaryArtistKey(right);
  return Boolean(leftArtist && rightArtist && leftArtist === rightArtist);
}

function sharedPlaylistCount(track: RadioLibraryTrack, currentTrack?: Track | null): number {
  if (!currentTrack?.sourcePlaylists?.length) {
    return 0;
  }

  const currentPlaylists = new Set(currentTrack.sourcePlaylists);
  return track.playlistNames.filter((name) => currentPlaylists.has(name)).length;
}

export function radioSortLibraryTracks<TTrack extends RadioLibraryTrack>(params: {
  tracks: TTrack[];
  hint: string;
  recentTrackIds: Set<string>;
  currentTrack?: Track | null;
  avoidTrackIds?: Set<string>;
}): TTrack[] {
  const normalizedHint = params.hint.toLowerCase();
  const hintWords = normalizedHint
    .split(/[\s,，。/|·:：;；]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  return [...params.tracks]
    .map((track) => {
      const key = trackKey(track);
      const text = trackText(track);
      const directScore = scoreLibraryTrack(track, params.hint);
      const wordScore = hintWords.reduce((score, word) => score + (text.includes(word) ? 1.2 : 0), 0);
      const currentArtistScore = samePrimaryArtist(params.currentTrack, track) ? Math.random() * 2 - 2.5 : 0;
      const playlistScore = Math.min(3, sharedPlaylistCount(track, params.currentTrack) * 1.5);
      const multiPlaylistScore = Math.min(2, track.playlistNames.length * 0.35);
      const recentPenalty = params.recentTrackIds.has(key) ? 12 : 0;
      const avoidPenalty = params.avoidTrackIds?.has(key) ? 4 : 0;
      const sameTrackPenalty = params.currentTrack && trackKey(params.currentTrack) === key ? 100 : 0;
      const radioJitter = Math.random() * 6;

      return {
        track,
        score:
          directScore +
          wordScore +
          currentArtistScore +
          playlistScore +
          multiPlaylistScore +
          radioJitter -
          recentPenalty -
          avoidPenalty -
          sameTrackPenalty
      };
    })
    .filter((entry) => entry.score > -5)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.track);
}
