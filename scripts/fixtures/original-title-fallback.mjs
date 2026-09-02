/**
 * Fixtures and mocked responses for original-title fallback testing.
 *
 * Contains mocked API responses for the worked example:
 * - Polish title: "Pierwszych piętnaście żywotów Harry'ego Augusta" (empty categories)
 * - Original title: "Reincarnation" (rich categories: Fiction, Time travel, End of the world)
 */

/** Mocked Google Books response for Polish title (empty categories) */
export const MOCK_GOOGLE_PL = {
  description: null,
  categories: [],
  isbn: '9788379437924',
  coverUrls: ['https://example.com/polish-cover.jpg'],
  sources: ['Google Books']
};

/** Mocked Open Library response for Polish title (empty subjects) */
export const MOCK_OPENLIB_PL = {
  description: null,
  categories: [],
  isbn: '9788379437924',
  coverUrls: ['https://covers.openlibrary.org/b/isbn/9788379437924-L.jpg'],
  sources: ['Open Library']
};

/** Mocked Open Library response for original title "Reincarnation" */
export const MOCK_OPENLIB_ORIGINAL = {
  description: "A novel about a man who relives his life repeatedly with full memory of past lives.",
  categories: ['Fiction', 'Time travel', 'End of the world', 'Reincarnation'],
  isbn: '9780007541149',
  coverUrls: ['https://covers.openlibrary.org/b/isbn/9780007541149-L.jpg'],
  sources: ['Open Library']
};

/** Test book data for the worked example */
export const TEST_BOOK = {
  title: "Pierwszych piętnaście żywotów Harry'ego Augusta",
  author: "C. North",
  originalTitle: "Reincarnation",
  scores: { "TestUser": 8 }
};

/** Expected fallback result merging primary empty with original rich */
export const EXPECTED_MERGED_RESULT = {
  description: null, // Must remain null from primary
  categories: ['Fiction', 'Time travel', 'End of the world'], // From fallback, within the four-item cap
  isbn: '9788379437924', // From primary
  coverUrls: [
    'https://example.com/polish-cover.jpg',
    'https://covers.openlibrary.org/b/isbn/9788379437924-L.jpg',
    'https://covers.openlibrary.org/b/isbn/9780007541149-L.jpg'
  ],
  sources: ['Google Books', 'Open Library']
};

/** Mock fetch responses for testing */
export async function mockFetchMetadata(title, author) {
  const polishTitle = "Pierwszych piętnaście żywotów Harry'ego Augusta";
  const originalTitle = "Reincarnation";

  if (title === polishTitle && author === "C. North") {
    // Primary lookup returns empty categories
    return MOCK_GOOGLE_PL;
  }

  if (title === originalTitle && author === "C. North") {
    // Fallback lookup returns rich categories
    return MOCK_OPENLIB_ORIGINAL;
  }

  return null;
}

/** Test cases for different scenarios */
export const TEST_CASES = [
  {
    name: "Worked example - Polish empty, original rich",
    title: "Pierwszych piętnaście żywotów Harry'ego Augusta",
    author: "C. North",
    originalTitle: "Reincarnation",
    expectedCategories: ['Fiction', 'Time travel', 'End of the world'],
    expectedDescription: null
  },
  {
    name: "Same title skip",
    title: "Reincarnation",
    author: "C. North",
    originalTitle: "Reincarnation", // Same as title
    expectedCategories: [], // Should skip fallback lookup
    expectedDescription: null
  },
  {
    name: "No original title",
    title: "Some Book",
    author: "Some Author",
    originalTitle: null,
    expectedCategories: [], // Should behave as today
    expectedDescription: null
  }
];
