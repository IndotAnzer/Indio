import type { Track } from "@indio/contracts";
import { durationLabel } from "../lib/format";

interface QueuePanelProps {
  queue: Track[];
}

export function QueuePanel({ queue }: QueuePanelProps) {
  return (
    <section className="deck-panel queue-panel">
      <div className="panel-head">
        <p className="station-kicker">Coming Up</p>
        <span>{queue.length} 首待播</span>
      </div>
      <div className="coming-list">
        {queue.length > 0 ? (
          queue.map((track, index) => (
            <div className="coming-item" key={track.neteaseId ?? track.id}>
              <span className="coming-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{track.title}</strong>
                <p>
                  {track.artist} · {durationLabel(track.durationSec)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="coming-empty">下一首还没排好，先让这一首慢慢往下走。</p>
        )}
      </div>
    </section>
  );
}
