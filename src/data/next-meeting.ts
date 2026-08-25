import data from './next-meeting.json';

/**
 * The "next meeting" card. Written by email (azure/src/functions/next-book.mjs)
 * or by hand (`npm run next -- "Tytuł, Autor"`), never edited in the template —
 * so a new book is one line of mail, not a code change.
 */
export interface RawNextMeeting {
  title: string;
  author: string | null;
  /** cover slug: src/assets/covers/<cover>.(jpg|png|…), placeholder if absent */
  cover: string;
  /** dd/mm/yy, as shown on the card */
  date: string;
  /** HH:MM */
  time: string;
  /** when availability was last checked (YYYY-MM-DD), or null */
  checkedAt: string | null;
  availability: Record<string, { available: boolean | null; url: string | null }>;
}

export interface ProviderStatus {
  id: string;
  label: string;
  /** true = confirmed there, false = confirmed absent, null = not checked */
  available: boolean | null;
  url: string | null;
  /** which glyph to draw: the library isn't an audiobook service */
  icon: 'headphones' | 'book';
  /** screen-reader sentence, e.g. "dostępna na Storytel" */
  description: string;
}

export interface NextMeeting {
  title: string;
  author: string | null;
  cover: string;
  date: string;
  time: string;
  checkedAt: string | null;
  providers: ProviderStatus[];
}

/**
 * Display order, labels and grammar. Ids are the contract with
 * scripts/lib/availability.mjs, which writes the JSON — renaming one means
 * renaming both.
 */
const PROVIDERS: { id: string; label: string; where: string; icon: 'headphones' | 'book' }[] = [
  { id: 'storytel', label: 'Storytel', where: 'na Storytel', icon: 'headphones' },
  { id: 'bookbeat', label: 'BookBeat', where: 'na BookBeat', icon: 'headphones' },
  { id: 'audioteka', label: 'Audioteka', where: 'na Audiotece', icon: 'headphones' },
  { id: 'legimi', label: 'Legimi', where: 'na Legimi', icon: 'headphones' },
  {
    id: 'biblioteka_raczynskich',
    label: 'B. Raczyńskich',
    where: 'w Bibliotece Raczyńskich',
    icon: 'book',
  },
];

function describe(available: boolean | null, where: string): string {
  if (available === true) return `dostępna ${where}`;
  if (available === false) return `niedostępna ${where}`;
  return `nie wiadomo, czy jest ${where}`;
}

export function getNextMeeting(): NextMeeting | null {
  const raw = data as RawNextMeeting | null;
  if (!raw?.title) return null;
  return {
    title: raw.title,
    author: raw.author ?? null,
    cover: raw.cover,
    date: raw.date,
    time: raw.time,
    checkedAt: raw.checkedAt ?? null,
    providers: PROVIDERS.map(({ id, label, where, icon }) => {
      // A provider missing from the file was never checked — same as null.
      const entry = raw.availability?.[id];
      const available = entry?.available ?? null;
      return { id, label, available, url: entry?.url ?? null, icon, description: describe(available, where) };
    }),
  };
}
