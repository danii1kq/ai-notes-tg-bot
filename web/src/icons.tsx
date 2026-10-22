/**
 * The icons of the Mini App.
 *
 * Every icon is a line icon of the same family: the frame is 24, the stroke is
 * the same everywhere, the ends are round. The icons take the colour of the
 * text, so they follow the theme of Telegram without any extra work.
 */

export interface IconProps {
  size?: number;
  className?: string;
  /** The name of the icon for the readers of the screen. */
  title?: string;
}

function Icon({
  size = 20,
  className,
  title,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** The magnifier of the search field. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}

/** A sheet of paper with lines, a note. */
export function NoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </Icon>
  );
}

/** The report of the day. */
export function ReportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </Icon>
  );
}

/** The arrow back, the way out of a note. */
export function BackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m11 18-6-6 6-6" />
      <path d="M19 12H5" />
    </Icon>
  );
}

/** The chevron to the right, a sign that the card opens. */
export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

/** The warning of the error state. */
export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

/** The cross of the empty state and of the clear button. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

/** The inbox, the notes that are not sorted out yet. */
export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12h-5l-2 3h-4l-2-3H3" />
      <path d="M5.5 5.1 3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-2.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" />
    </Icon>
  );
}

/** The repeat, a second try. */
export function RetryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 11a8 8 0 1 0-.6 3" />
      <path d="M20 4v7h-7" />
    </Icon>
  );
}
