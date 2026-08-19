#!/usr/bin/env python3
"""
Storytel Book Availability Checker

This module provides functionality to check book availability on Storytel
across different regional markets using their JSON API.
"""

import re
import json
import time
import random
import unicodedata
from typing import Optional, List, Dict, Any
from urllib.parse import quote, urljoin

import httpx
from bs4 import BeautifulSoup
from rapidfuzz import fuzz


class StorytelNetworkError(Exception):
    """Raised when network errors occur during Storytel requests."""
    pass


class StorytelRateLimitError(Exception):
    """Raised when Storytel returns HTTP 429 (Too Many Requests)."""
    pass


class StorytelParsingError(Exception):
    """Raised when parsing Storytel HTML/JSON responses fails."""
    pass


def normalize_string(text: str) -> str:
    """
    Normalize string for comparison: lowercase, remove diacritics, punctuation.

    Args:
        text: Input string to normalize

    Returns:
        Normalized string
    """
    if not text:
        return ""

    # Lowercase and strip
    normalized = text.lower().strip()

    # Remove diacritics using NFD (Canonical Decomposition) + filtering combining marks
    normalized = ''.join(c for c in unicodedata.normalize('NFD', normalized)
                         if unicodedata.category(c) != 'Mn')

    # Remove common punctuation
    normalized = re.sub(r'[\.,!?;:"\'()\[\]{}]', '', normalized)

    # Replace multiple spaces with single space
    normalized = re.sub(r'\s+', ' ', normalized)

    return normalized


def calculate_similarity(str1: str, str2: str) -> float:
    """
    Calculate string similarity using rapidfuzz's partial ratio.
    
    Args:
        str1: First string
        str2: Second string
        
    Returns:
        Similarity score between 0.0 and 1.0
    """
    if not str1 or not str2:
        return 0.0
    
    return fuzz.partial_ratio(str1, str2) / 100.0


def get_store_info(country_code: str) -> Dict[str, str]:
    """
    Get store information for a given country code.
    
    Args:
        country_code: Two-letter ISO country code
        
    Returns:
        Dictionary with store information
    """
    # Map country codes to store identifiers
    store_map = {
        'pl': 'STHP-PL',
        'us': 'STHP-US',
        'se': 'STHP-SE',
        'nl': 'STHP-NL',
        'dk': 'STHP-DK',
        'no': 'STHP-NO',
        'fi': 'STHP-FI',
        'es': 'STHP-ES',
        'it': 'STHP-IT',
        'de': 'STHP-DE',
        'fr': 'STHP-FR',
        'br': 'STHP-BR',
        'mx': 'STHP-MX',
        'in': 'STHP-IN',
    }
    
    store = store_map.get(country_code.lower(), f'STHP-{country_code.upper()}')
    
    return {
        'sthpName': store,
        'countryIso': country_code.lower(),
        'languageIso': country_code.lower(),
    }


def search_storytel_api(
    query: str, 
    country_code: str, 
    timeout: float = 10.0
) -> List[Dict[str, Any]]:
    """
    Search Storytel using their API.
    
    Args:
        query: Search query
        country_code: Two-letter ISO country code
        timeout: Request timeout
        
    Returns:
        List of book items from API response
    """
    store_info = get_store_info(country_code)
    
    api_url = 'https://api.storytel.net/search/client/web'
    params = {
        'query': query,
        'limit': 20,
        'offset': 0,
        'country': country_code.lower(),
        'store': store_info['sthpName']
    }
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
    }
    
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(api_url, params=params, headers=headers)
            
            if response.status_code != 200:
                raise StorytelNetworkError(f"API error: {response.status_code}")
            
            data = response.json()
            return data.get('items', [])
            
    except (httpx.TimeoutException, httpx.NetworkError) as e:
        raise StorytelNetworkError(f"Network error: {e}")
    except json.JSONDecodeError as e:
        raise StorytelParsingError(f"Failed to parse API response: {e}")


def check_storytel_availability(
    title: str,
    author: Optional[str] = None,
    isbn: Optional[str] = None,
    country_code: str = "pl",
    timeout: float = 10.0
) -> Dict[str, Any]:
    """
    Check if a book is available on Storytel in the specified region.

    Args:
        title: Main title of the book to search (required)
        author: Name of the author for refined search
        isbn: ISBN-10 or ISBN-13 string
        country_code: Two-letter ISO country code (default: "pl")
        timeout: Network timeout in seconds
        
    Returns:
        Dictionary with availability information
        
    Raises:
        ValueError: For invalid input parameters
        StorytelNetworkError: For network issues
        StorytelRateLimitError: For rate limiting
        StorytelParsingError: For parsing failures
    """
    
    # Step 1: Input validation and normalization
    title = title.strip()
    if not title:
        raise ValueError("Title cannot be empty")
    
    author = author.strip() if author else None
    isbn = isbn.strip() if isbn else None
    
    country_code = country_code.lower().strip()
    if len(country_code) != 2 or not country_code.isalpha():
        raise ValueError("country_code must be a valid two-letter ISO code")
    
    # Step 2: Query formulation
    if isbn:
        query = isbn
    elif author:
        query = f"{title} {author}"
    else:
        query = title

    # Step 3: Search using Storytel API
    items = search_storytel_api(query, country_code, timeout)

    # Step 4: Similarity scoring
    normalized_title = normalize_string(title)
    normalized_author = normalize_string(author) if author else None

    best_match = None
    best_score = 0.0

    for item in items:
        item_title = item.get('title', '')
        item_authors = item.get('authorNames', [])
        item_author = item_authors[0] if item_authors else None

        norm_item_title = normalize_string(item_title)
        norm_item_author = normalize_string(item_author) if item_author else None

        # Check for ISBN match (highest confidence)
        if isbn and item.get('isbn') and isbn in item['isbn']:
            best_match = item
            best_score = 1.0
            break

        # Calculate similarity scores
        title_similarity = calculate_similarity(normalized_title, norm_item_title)

        if normalized_author and norm_item_author:
            author_similarity = calculate_similarity(normalized_author, norm_item_author)
            confidence = 0.7 * title_similarity + 0.3 * author_similarity
        else:
            confidence = title_similarity

        if confidence > best_score:
            best_score = confidence
            best_match = item

    # Step 5: Output construction
    formats = []
    storytel_url = None
    cover_image_url = None

    if best_match:
        # Extract available formats
        format_items = best_match.get('formats', [])
        for fmt in format_items:
            if fmt.get('isReleased', False):
                formats.append(fmt.get('type', ''))

        # Construct URL (API doesn't provide canonicalUrl, so we construct it)
        if best_match.get('id'):
            storytel_url = f"https://www.storytel.com/{country_code}/books/{best_match['id']}"

        # Get cover image
        format_items = best_match.get('formats', [])
        if format_items and format_items[0].get('cover'):
            cover_image_url = format_items[0]['cover'].get('url')

    result = {
        'is_available': best_score >= 0.85 if best_match else False,
        'confidence_score': best_score if best_match else 0.0,
        'matched_title': best_match.get('title') if best_match else None,
        'matched_author': ', '.join([a['name'] for a in best_match.get('authors', [])]) if best_match and best_match.get('authors') else None,
        'formats': formats,
        'storytel_url': storytel_url,
        'cover_image_url': cover_image_url,
    }

    return result


# Example usage and testing
if __name__ == "__main__":
    # Test the function
    try:
        result = check_storytel_availability(
            title="The Three-Body Problem",
            author="Cixin Liu",
            country_code="us"
        )
        print("Availability check result:")
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        print(f"Error: {e}")