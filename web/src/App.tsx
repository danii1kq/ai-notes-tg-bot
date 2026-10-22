import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConfig,
  fetchNote,
  fetchNotes,
  fetchSummaries,
  fileToken,
  type NoteSummary,
  type SearchHit,
  type SummaryEntry,
  searchNotes,
} from "./api";
import {
  AlertIcon,
  BackIcon,
  ChevronIcon,
  CloseIcon,
  InboxIcon,
  NoteIcon,
  ReportIcon,
  RetryIcon,
  SearchIcon,
} from "./icons";
import { renderMarkdown } from "./markdown";

type View = { name: "list" } | { name: "note"; path: string; title: string };

const telegram = window.Telegram?.WebApp;

function haptic(kind: "light" | "medium" | "success" = "light"): void {
  try {
    if (kind === "success") telegram?.HapticFeedback.notificationOccurred("success");
    else telegram?.HapticFeedback.impactOccurred(kind);
  } catch {
    // The haptics are not everywhere.
  }
}

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [summaries, setSummaries] = useState<SummaryEntry[]>([]);
  const [botUsername, setBotUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNotes(await fetchNotes(80));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "не удалось загрузить заметки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    telegram?.ready();
    telegram?.expand();
    // The header of Telegram takes the colour of the app, so there is no seam.
    try {
      if (telegram?.themeParams?.bg_color) {
        telegram.setHeaderColor?.(telegram.themeParams.bg_color);
      }
    } catch {
      // The colour of the header is not important enough to fail for.
    }
    void loadNotes();
    fetchSummaries()
      .then(setSummaries)
      .catch(() => setSummaries([]));
    fetchConfig()
      .then((config) => setBotUsername(config.botUsername))
      .catch(() => setBotUsername(""));
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
        .then(setHits)
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

  const openNote = (path: string, title: string) => {
    haptic();
    setView({ name: "note", path, title });
  };

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
              <SearchIcon size={18} />
              <input
                type="search"
                inputMode="search"
                placeholder="Поиск по заметкам"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Поиск по заметкам"
              />
              {query ? (
                <button
                  className="clear"
                  type="button"
                  onClick={() => {
                    setQuery("");
                    haptic();
                  }}
                  aria-label="Очистить поиск"
                >
                  <CloseIcon size={16} />
                </button>
              ) : null}
            </div>
          </header>

          {error ? (
            <State
              icon={<AlertIcon size={26} />}
              danger
              title="Не удалось загрузить"
              hint={error}
              action={
                <button className="action" type="button" onClick={() => void loadNotes()}>
                  <RetryIcon size={18} />
                  Повторить
                </button>
              }
            />
          ) : loading ? (
            <div className="list">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : searching ? (
            <HitList hits={hits} onOpen={openNote} />
          ) : notes.length === 0 ? (
            <State
              icon={<InboxIcon size={26} />}
              title="Пока пусто"
              hint="Напиши боту в Telegram, и заметка появится здесь."
              action={
                botUsername ? (
                  <button className="action" type="button" onClick={() => openBotChat(botUsername)}>
                    Написать боту
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <SummaryCard summaries={summaries} onOpen={openNote} />
              <NoteList notes={notes} onOpen={openNote} />
            </>
          )}
        </>
      ) : (
        <NoteView path={view.path} title={view.title} onBack={() => setView({ name: "list" })} />
      )}
    </div>
  );
}

/** Opens the chat with the bot, from the Mini App or from the browser. */
function openBotChat(username: string): void {
  const url = `https://t.me/${username}`;
  if (telegram?.openTelegramLink) {
    telegram.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function SummaryCard({
  summaries,
  onOpen,
}: {
  summaries: SummaryEntry[];
  onOpen: (path: string, title: string) => void;
}) {
  const latest = summaries[0];
  if (!latest) return null;

  return (
    <ul className="list">
      <li>
        <button
          className="card card-summary"
          type="button"
          onClick={() => onOpen(latest.file, "Итоги дня")}
          aria-label={`Итоги дня, ${formatDate(latest.date)}`}
        >
          <span className="card-icon">
            <ReportIcon size={20} />
          </span>
          <span className="card-body">
            <span className="card-title">Итоги дня</span>
            <span className="card-meta">
              <span>{formatDate(latest.date)}</span>
              {summaries.length > 1 ? <span>дней: {summaries.length}</span> : null}
            </span>
            <span className="card-snippet">{latest.summary}</span>
          </span>
          <span className="card-chevron">
            <ChevronIcon size={18} />
          </span>
        </button>
      </li>
    </ul>
  );
}

function NoteList({
  notes,
  onOpen,
}: {
  notes: NoteSummary[];
  onOpen: (path: string, title: string) => void;
}) {
  return (
    <ul className="list">
      {notes.map((note) => (
        <li key={note.path}>
          <button
            className="card"
            type="button"
            onClick={() => onOpen(note.path, note.title)}
            aria-label={`Открыть заметку ${note.title}`}
          >
            <span className="card-icon">
              <NoteIcon size={20} />
            </span>
            <span className="card-body">
              <span className="card-title">{note.title}</span>
              <span className="card-meta">
                {note.date ? <span>{formatDate(note.date)}</span> : null}
                {note.tags.slice(0, 3).map((tag) => (
                  <span className="chip" key={tag}>
                    #{tag}
                  </span>
                ))}
              </span>
              {note.snippet ? <span className="card-snippet">{note.snippet}</span> : null}
            </span>
            <span className="card-chevron">
              <ChevronIcon size={18} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function HitList({
  hits,
  onOpen,
}: {
  hits: SearchHit[];
  onOpen: (path: string, title: string) => void;
}) {
  if (hits.length === 0) {
    return (
      <State
        icon={<SearchIcon size={26} />}
        title="Ничего не нашлось"
        hint="Попробуй другое слово."
      />
    );
  }

  return (
    <ul className="list">
      {hits.map((hit) => (
        <li key={hit.path}>
          <button
            className="card"
            type="button"
            onClick={() => onOpen(hit.path, hit.title)}
            aria-label={`Открыть заметку ${hit.title}`}
          >
            <span className="card-icon">
              <NoteIcon size={20} />
            </span>
            <span className="card-body">
              <span className="card-title">{hit.title}</span>
              <span className="card-meta">
                <span>{hit.path}</span>
                {hit.line ? <span>строка {hit.line}</span> : null}
              </span>
              {hit.snippet ? <span className="card-snippet">{hit.snippet}</span> : null}
            </span>
            <span className="card-chevron">
              <ChevronIcon size={18} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function State({
  icon,
  title,
  hint,
  action,
  danger = false,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="state">
      <span className={danger ? "state-icon state-icon-danger" : "state-icon"}>{icon}</span>
      <span className="state-title">{title}</span>
      <span className="state-hint">{hint}</span>
      {action}
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
      <button
        className="back"
        type="button"
        onClick={() => {
          haptic();
          onBack();
        }}
      >
        <BackIcon size={18} />
        Назад
      </button>
      <h1 className="note-title">{title}</h1>
      {error ? (
        <State icon={<AlertIcon size={26} />} danger title="Не удалось открыть" hint={error} />
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
