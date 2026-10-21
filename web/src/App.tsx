import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNote,
  fetchNotes,
  fileToken,
  type NoteSummary,
  type SearchHit,
  searchNotes,
} from "./api";
import { renderMarkdown } from "./markdown";

type View = { name: "list" } | { name: "note"; path: string; title: string };

const telegram = window.Telegram?.WebApp;

function haptic(kind: "light" | "medium" | "success" = "light"): void {
  try {
    if (kind === "success") telegram?.HapticFeedback.notificationOccurred("success");
    else telegram?.HapticFeedback.impactOccurred(kind);
  } catch {
    // The haptics are not available everywhere.
  }
}

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The list of the notes.
  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchNotes(80);
      setNotes(list);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "не удалось загрузить заметки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    telegram?.ready();
    telegram?.expand();
    void loadNotes();
  }, [loadNotes]);

  // The search waits for a pause in the typing.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      searchNotes(trimmed)
        .then((found) => setHits(found))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // The back button of Telegram leads back to the list.
  useEffect(() => {
    if (view.name !== "note") return;
    telegram?.BackButton.show();
    const handler = () => setView({ name: "list" });
    telegram?.BackButton.onClick(handler);
    return () => {
      telegram?.BackButton.offClick(handler);
      telegram?.BackButton.hide();
    };
  }, [view.name]);

  const searching = query.trim().length > 0;

  return (
    <div className="app">
      {view.name === "list" ? (
        <>
          <header className="header">
            <h1 className="title">Заметки</h1>
            <p className="subtitle">
              {loading
                ? "Загружаю..."
                : `${notes.length} ${plural(notes.length, "заметка", "заметки", "заметок")}`}
            </p>
            <div className="search">
              <span aria-hidden="true">🔍</span>
              <input
                type="search"
                inputMode="search"
                placeholder="Поиск по заметкам"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Поиск по заметкам"
              />
            </div>
          </header>

          {error ? (
            <div className="state">
              <div className="state-icon">⚠️</div>
              <div className="state-title">Не удалось загрузить</div>
              <div className="state-hint">{error}</div>
            </div>
          ) : loading ? (
            <div className="list">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : searching ? (
            <HitList hits={hits} onOpen={(hit) => openNote(hit.path, hit.title, setView)} />
          ) : notes.length === 0 ? (
            <div className="state">
              <div className="state-icon">🗂</div>
              <div className="state-title">Пока пусто</div>
              <div className="state-hint">Напиши боту в Telegram, и заметка появится здесь.</div>
            </div>
          ) : (
            <NoteList notes={notes} onOpen={(note) => openNote(note.path, note.title, setView)} />
          )}
        </>
      ) : (
        <NoteView path={view.path} title={view.title} onBack={() => setView({ name: "list" })} />
      )}
    </div>
  );
}

function openNote(path: string, title: string, setView: (view: View) => void): void {
  haptic();
  setView({ name: "note", path, title });
}

function NoteList({
  notes,
  onOpen,
}: {
  notes: NoteSummary[];
  onOpen: (note: NoteSummary) => void;
}) {
  return (
    <div className="list">
      {notes.map((note) => (
        <button key={note.path} className="card" type="button" onClick={() => onOpen(note)}>
          <h2 className="card-title">{note.title}</h2>
          <div className="card-meta">
            {note.date ? <span>{formatDate(note.date)}</span> : null}
            {note.tags.slice(0, 3).map((tag) => (
              <span className="chip" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
          {note.snippet ? <p className="card-snippet">{note.snippet}</p> : null}
        </button>
      ))}
    </div>
  );
}

function HitList({ hits, onOpen }: { hits: SearchHit[]; onOpen: (hit: SearchHit) => void }) {
  if (hits.length === 0) {
    return (
      <div className="state">
        <div className="state-icon">🔍</div>
        <div className="state-title">Ничего не нашлось</div>
        <div className="state-hint">Попробуй другое слово.</div>
      </div>
    );
  }
  return (
    <div className="list">
      {hits.map((hit) => (
        <button key={hit.path} className="card" type="button" onClick={() => onOpen(hit)}>
          <h2 className="card-title">{hit.title}</h2>
          <div className="card-meta">
            <span>{hit.path}</span>
            {hit.line ? <span>строка {hit.line}</span> : null}
          </div>
          {hit.snippet ? <p className="card-snippet">{hit.snippet}</p> : null}
        </button>
      ))}
    </div>
  );
}

function NoteView({ path, title, onBack }: { path: string; title: string; onBack: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchNote(path)
      .then((note) => {
        if (mounted.current) setContent(note.content);
      })
      .catch((cause: unknown) => {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : "не удалось открыть заметку");
        }
      });
    return () => {
      mounted.current = false;
    };
  }, [path]);

  const html = useMemo(() => {
    if (!content) return "";
    // The frontmatter of the note is not shown to the reader.
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return renderMarkdown(body, fileToken);
  }, [content]);

  return (
    <div className="note">
      <button className="back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Назад
      </button>
      <h1 className="title">{title}</h1>
      {error ? (
        <div className="state">
          <div className="state-icon">⚠️</div>
          <div className="state-title">Не удалось открыть</div>
          <div className="state-hint">{error}</div>
        </div>
      ) : content === null ? (
        <div className="list">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the renderer escapes the text of the note, only the marks of the note become html
        <div className="note-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
