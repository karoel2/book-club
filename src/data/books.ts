import booksData from './books.json';

/** Shape of each entry in books.json (the file you edit to add books). */
export interface RawBook {
  title: string;
  author: string | null;
  /** member name -> score 1..10, or null = took part but left no score */
  scores: Record<string, number | null>;
  /** short blurb (from Google Books / Open Library); optional */
  description?: string | null;
  /** genre/category tags; optional */
  categories?: string[];
}

export interface MemberScore {
  name: string;
  score: number | null;
}

export interface Book {
  slug: string;
  title: string;
  author: string | null;
  /** members in the order they were recorded */
  scores: MemberScore[];
  /** mean of the numeric scores, or null when nobody rated it */
  average: number | null;
  /** Polish-formatted average, e.g. "7,71", "8" — or "—" when unrated */
  averageLabel: string;
  /** how many members actually gave a number */
  ratingsCount: number;
  description: string | null;
  categories: string[];
  /** source index from books.json for archive-addition order */
  archiveIndex: number;
}

const PL_DIACRITICS: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

/** URL-safe slug from a Polish title (ł→l, ś→s, ż/ź→z, …). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Average / score formatted with a Polish decimal comma. */
export function formatScore(n: number): string {
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
}

/** Correct Polish form of "ocena" for a count: 1 ocena, 2 oceny, 5 ocen. */
export function ratingsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return 'ocena';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'oceny';
  return 'ocen';
}

/** Correct Polish form of "książka" for a count: 1 książka, 2 książki, 5 książek. */
export function booksLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return 'książka';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'książki';
  return 'książek';
}

function buildBook(raw: RawBook, usedSlugs: Set<string>, archiveIndex: number): Book {
  const scores: MemberScore[] = Object.entries(raw.scores).map(([name, score]) => ({
    name,
    score: typeof score === 'number' ? score : null,
  }));

  const rated = scores.filter((s): s is { name: string; score: number } => s.score !== null);
  const ratingsCount = rated.length;
  const average = ratingsCount
    ? rated.reduce((sum, s) => sum + s.score, 0) / ratingsCount
    : null;

  // guarantee a unique slug even if two titles collide
  let slug = slugify(raw.title) || 'ksiazka';
  if (usedSlugs.has(slug)) {
    let i = 2;
    while (usedSlugs.has(`${slug}-${i}`)) i += 1;
    slug = `${slug}-${i}`;
  }
  usedSlugs.add(slug);

  return {
    slug,
    title: raw.title,
    author: raw.author ?? null,
    scores,
    average,
    averageLabel: average === null ? '—' : formatScore(average),
    ratingsCount,
    description: raw.description ?? null,
    categories: raw.categories ?? [],
    archiveIndex,
  };
}

const usedSlugs = new Set<string>();
const books: Book[] = (booksData as RawBook[]).map((raw, index) => buildBook(raw, usedSlugs, index));

/** All books, sorted for the leaderboard: highest average first. */
export function getBooks(): Book[] {
  return [...books].sort((a, b) => {
    const byAverage = (b.average ?? -1) - (a.average ?? -1);
    if (byAverage !== 0) return byAverage;
    const byCount = b.ratingsCount - a.ratingsCount;
    if (byCount !== 0) return byCount;
    return a.title.localeCompare(b.title, 'pl');
  });
}

export function getBookBySlug(slug: string): Book | undefined {
  return books.find((b) => b.slug === slug);
}

/* ---- Members ---- */

export interface Member {
  slug: string;
  name: string;
  /** how many books this member scored */
  ratedCount: number;
  /** mean score this member gives */
  average: number;
  averageLabel: string;
}

export interface UserStatistics {
  slug: string;
  name: string;
  /** count of valid numeric grades */
  ratedCount: number;
  /** average of valid grades, or null when zero */
  average: number | null;
  averageLabel: string;
  /** highest valid grade, or null when none */
  highestScore: number | null;
  /** lowest valid grade, or null when none */
  lowestScore: number | null;
  /** longest consecutive grading streak in archive order */
  longestStreak: number;
  /** true only when ratedCount >= 3 for average ranking eligibility */
  averageEligible: boolean;
}

export interface MemberRating {
  book: Book;
  score: number;
  /** archive index for chronological ordering */
  archiveIndex: number;
}

function buildMembers(): Member[] {
  const order: string[] = [];
  const scoresByName = new Map<string, number[]>();
  for (const book of books) {
    for (const { name, score } of book.scores) {
      if (score === null) continue;
      if (!scoresByName.has(name)) {
        scoresByName.set(name, []);
        order.push(name);
      }
      scoresByName.get(name)!.push(score);
    }
  }

  const used = new Set<string>();
  return order.map((name) => {
    const scores = scoresByName.get(name)!;
    let slug = slugify(name) || 'osoba';
    if (used.has(slug)) {
      let i = 2;
      while (used.has(`${slug}-${i}`)) i += 1;
      slug = `${slug}-${i}`;
    }
    used.add(slug);
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    return { slug, name, ratedCount: scores.length, average, averageLabel: formatScore(average) };
  });
}

const members = buildMembers();
const memberSlugByName = new Map(members.map((m) => [m.name, m.slug]));

/** Everyone who has given at least one score, sorted by name. */
export function getMembers(): Member[] {
  return [...members].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export function getMemberBySlug(slug: string): Member | undefined {
  return members.find((m) => m.slug === slug);
}

/** Stable slug for linking to a member's page. */
export function getMemberSlug(name: string): string {
  return memberSlugByName.get(name) ?? slugify(name);
}

/** Books a member scored, paired with that score, highest first. */
export function getMemberRatings(name: string): MemberRating[] {
  const ratings: MemberRating[] = [];
  for (const book of books) {
    const entry = book.scores.find((s) => s.name === name);
    if (entry && entry.score !== null) ratings.push({ book, score: entry.score, archiveIndex: book.archiveIndex });
  }
  return ratings.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    const byAverage = (b.book.average ?? -1) - (a.book.average ?? -1);
    if (byAverage !== 0) return byAverage;
    return a.book.title.localeCompare(b.book.title, 'pl');
  });
}

/** Get all valid member ratings with archive indices for chronological ordering */
export function getMemberRatingsChronological(name: string): MemberRating[] {
  const ratings: MemberRating[] = [];
  for (const book of books) {
    const entry = book.scores.find((s) => s.name === name);
    if (entry && entry.score !== null) {
      ratings.push({ book, score: entry.score, archiveIndex: book.archiveIndex });
    }
  }
  return ratings.sort((a, b) => a.archiveIndex - b.archiveIndex);
}

/** Calculate user statistics including counts, averages, extrema, and streaks */
export function getUserStatistics(name: string): UserStatistics {
  const ratings = getMemberRatingsChronological(name);
  const validScores = ratings.map(r => r.score);

  if (validScores.length === 0) {
    return {
      slug: getMemberSlug(name),
      name,
      ratedCount: 0,
      average: null,
      averageLabel: '—',
      highestScore: null,
      lowestScore: null,
      longestStreak: 0,
      averageEligible: false
    };
  }

  const ratedCount = validScores.length;
  const average = validScores.reduce((sum, score) => sum + score, 0) / ratedCount;
  const highestScore = Math.max(...validScores);
  const lowestScore = Math.min(...validScores);

  // Calculate longest consecutive streak in archive order
  let longestStreak = 0;
  let currentStreak = 0;
  let prevIndex = -1;

  for (const rating of ratings) {
    if (prevIndex === -1 || rating.archiveIndex === prevIndex + 1) {
      currentStreak++;
    } else {
      longestStreak = Math.max(longestStreak, currentStreak);
      currentStreak = 1;
    }
    prevIndex = rating.archiveIndex;
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  return {
    slug: getMemberSlug(name),
    name,
    ratedCount,
    average,
    averageLabel: formatScore(average),
    highestScore,
    lowestScore,
    longestStreak,
    averageEligible: ratedCount >= 3
  };
}

/** Get all users with complete statistics */
export function getAllUserStatistics(): UserStatistics[] {
  const memberNames = new Set<string>();
  for (const book of books) {
    for (const score of book.scores) {
      if (score.score !== null) {
        memberNames.add(score.name);
      }
    }
  }

  return Array.from(memberNames).map(name => getUserStatistics(name));
}

/** Leaderboard category types */
export type LeaderboardCategory = 'activity' | 'highest-average' | 'lowest-average' | 'streak';

/** Leaderboard entry with user statistics and ranking metadata */
export interface LeaderboardEntry {
  user: UserStatistics;
  rank: number;
  isLeader: boolean;
}

/** Get leaderboard for a specific category */
export function getLeaderboard(category: LeaderboardCategory): LeaderboardEntry[] {
  const allStats = getAllUserStatistics();

  // Filter based on category eligibility
  let eligibleStats = allStats;
  if (category === 'highest-average' || category === 'lowest-average') {
    eligibleStats = allStats.filter(stat => stat.averageEligible);
  } else {
    eligibleStats = allStats.filter(stat => stat.ratedCount > 0);
  }

  if (eligibleStats.length === 0) {
    return [];
  }

  // Sort based on category
  let sortedStats: UserStatistics[];
  switch (category) {
    case 'activity':
      sortedStats = [...eligibleStats].sort((a, b) => b.ratedCount - a.ratedCount);
      break;
    case 'highest-average':
      sortedStats = [...eligibleStats].sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
      break;
    case 'lowest-average':
      sortedStats = [...eligibleStats].sort((a, b) => (a.average ?? 11) - (b.average ?? 11));
      break;
    case 'streak':
      sortedStats = [...eligibleStats].sort((a, b) => b.longestStreak - a.longestStreak);
      break;
  }

  // Determine leaders (ties)
  const leaderValue = getLeaderValue(sortedStats[0], category);
  const leaders = sortedStats.filter(stat => getLeaderValue(stat, category) === leaderValue);

  return sortedStats.map((stat, index) => ({
    user: stat,
    rank: index + 1,
    isLeader: leaders.some(leader => leader.name === stat.name)
  }));
}

/** Get the metric value for a user in a specific category */
function getLeaderValue(user: UserStatistics, category: LeaderboardCategory): number {
  switch (category) {
    case 'activity': return user.ratedCount;
    case 'highest-average': return user.average ?? -1;
    case 'lowest-average': return user.average ?? 11;
    case 'streak': return user.longestStreak;
  }
}

/** Get all tied leaders for a category */
export function getCategoryLeaders(category: LeaderboardCategory): UserStatistics[] {
  const leaderboard = getLeaderboard(category);
  if (leaderboard.length === 0) return [];

  return leaderboard
    .filter(entry => entry.isLeader)
    .map(entry => entry.user);
}
