# Storytel Book Availability Checker

This Python module provides a function to check book availability on Storytel across different regional markets by using their public API.

## Features

- Checks book availability on Storytel for any supported country
- Returns detailed information including formats (audiobook/ebook), cover image URL, and direct link
- Handles network errors, rate limiting, and parsing errors
- Provides confidence scores for matching accuracy
- Supports search by title, author, and ISBN

## Installation

1. Create a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

```python
import check_storytel_availability

# Check availability of a book
result = check_storytel_availability.check_storytel_availability(
    title="Harry Potter i Kamień Filozoficzny",
    author="J.K. Rowling", 
    country_code="pl"
)

print(f"Available: {result['is_available']}")
print(f"Confidence: {result['confidence_score']}")
print(f"Title: {result['matched_title']}")
print(f"Author: {result['matched_author']}")
print(f"Formats: {result['formats']}")
print(f"URL: {result['storytel_url']}")
print(f"Cover: {result['cover_image_url']}")
```

## Function Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | String | Yes | - | Main title of the book to search |
| `author` | String | No | None | Name of the author for refined search |
| `isbn` | String | No | None | ISBN-10 or ISBN-13 string |
| `country_code` | String | No | "pl" | Two-letter ISO country code (e.g., "pl", "se", "us") |
| `timeout` | Float | No | 10.0 | Network timeout in seconds |

## Return Value

The function returns a dictionary with the following structure:

| Key | Type | Description |
|-----|------|-------------|
| `is_available` | Boolean | True if book is available, False otherwise |
| `confidence_score` | Float | Confidence score between 0.0 and 1.0 |
| `matched_title` | String | Canonical title as listed on Storytel |
| `matched_author` | String | Author name(s) as listed on Storytel |
| `formats` | List | Available formats (["audiobook"], ["ebook"], or both) |
| `storytel_url` | String | Direct link to the book page on Storytel |
| `cover_image_url` | String | URL to the high-resolution cover image |

## Supported Countries

The module supports the following country codes with their corresponding Storytel stores:

- `pl` - Poland (STHP-PL)
- `se` - Sweden (STHP-SE) 
- `nl` - Netherlands (STHP-NL)
- `dk` - Denmark (STHP-DK)
- `no` - Norway (STHP-NO)
- `fi` - Finland (STHP-FI)
- `es` - Spain (STHP-ES)
- `it` - Italy (STHP-IT)
- `de` - Germany (STHP-DE)
- `fr` - France (STHP-FR)
- `br` - Brazil (STHP-BR)
- `mx` - Mexico (STHP-MX)
- `in` - India (STHP-IN)

## Error Handling

The function raises the following custom exceptions:

- `ValueError` - Invalid input parameters
- `StorytelNetworkError` - Network issues or HTTP errors
- `StorytelRateLimitError` - Rate limiting (HTTP 429)
- `StorytelParsingError` - Failed to parse API responses

## Examples

### Basic Usage
```python
result = check_storytel_availability.check_storytel_availability(
    title="Problem trzech ciał",
    author="Cixin Liu",
    country_code="pl"
)
```

### With ISBN
```python
result = check_storytel_availability.check_storytel_availability(
    title="Some Book",
    isbn="9781234567890",
    country_code="se"
)
```

### Error Handling
```python
try:
    result = check_storytel_availability.check_storytel_availability(
        title="",  # Empty title
        country_code="pl"
    )
except ValueError as e:
    print(f"Input error: {e}")
```

## Testing

Run the test script to see examples:
```bash
python test_storytel.py
```

## Implementation Details

The module uses Storytel's public API endpoint at `https://api.storytel.net/search/client/web` with proper store identification and request headers to mimic browser behavior.

- **Input Validation**: Validates and normalizes input parameters
- **Query Formulation**: Constructs search queries based on title, author, or ISBN
- **API Integration**: Uses authenticated API requests with proper store parameters
- **Similarity Scoring**: Uses rapidfuzz for string matching with weighted scores
- **Error Handling**: Implements retries with exponential backoff for network issues

## Dependencies

- `httpx` - HTTP client for API requests
- `beautifulsoup4` - HTML parsing (fallback mechanism)
- `rapidfuzz` - String similarity scoring

## License

This project is provided as-is for educational and research purposes.