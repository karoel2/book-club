#!/usr/bin/env python3
"""
Storytel audiobook availability scraper.
Implements async API-based checking for Polish audiobooks.
"""

import json
from typing import Optional, Dict, Any, List
from urllib.parse import quote

import httpx
from ..core import BaseAudiobookScraper, AudiobookResult, normalize_string, calculate_similarity


class StorytelScraper(BaseAudiobookScraper):
    """Scraper for Storytel platform using their public REST API."""
    
    def __init__(self):
        super().__init__()
        self.provider_name = "Storytel"
    
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> AudiobookResult:
        """
        Check audiobook availability on Storytel.
        """
        result = AudiobookResult(provider=self.provider_name)
        
        try:
            # Step 1: Input validation and query formulation
            title = title.strip()
            if not title:
                result.error_message = "Title cannot be empty"
                return result
            
            author = author.strip() if author else None
            isbn = isbn.strip() if isbn else None
            
            # Step 2: Search using Storytel API
            items = await self._search_storytel_api(title, author, isbn)
            
            # Step 3: Find best match with similarity scoring
            best_match, best_score = self._find_best_match(items, title, author, isbn)
            
            # Step 4: Populate result
            if best_match:
                result.title_matched = best_match.get('title')
                result.matched_author = ', '.join([a['name'] for a in best_match.get('authors', [])]) if best_match.get('authors') else None
                result.confidence_score = best_score
                result.is_available = best_score >= 0.85 and self._is_polish_audiobook(best_match)
                result.direct_url = self._construct_url(best_match)
                result.narrator = self._extract_narrator(best_match)
            
        except Exception as e:
            result.error_message = f"Error checking Storytel: {e}"
        
        return result
    
    async def _search_storytel_api(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search Storytel using their API."""
        if isbn:
            query = isbn
        elif author:
            query = f"{title} {author}"
        else:
            query = title
        
        api_url = 'https://api.storytel.net/search/client/web'
        params = {
            'query': query,
            'limit': 20,
            'offset': 0,
            'country': 'pl',  # Polish store
            'store': 'STHP-PL'
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(api_url, params=params)
            
            if response.status_code != 200:
                raise Exception(f"API error: {response.status_code}")
            
            data = response.json()
            return data.get('items', [])
    
    def _find_best_match(
        self,
        items: List[Dict[str, Any]],
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> tuple:
        """Find the best matching item with similarity scoring."""
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
        
        return best_match, best_score
    
    def _is_polish_audiobook(self, item: Dict[str, Any]) -> bool:
        """Check if item is a Polish audiobook."""
        formats = item.get('formats', [])
        
        for fmt in formats:
            # Check if it's an audiobook format
            # Storytel uses 'abook' for audiobooks, 'ebook' for e-books
            format_type = fmt.get('type', '').lower()
            if format_type == 'abook':
                # Additional checks for Polish content
                # 1. Check explicit language info if available
                language = fmt.get('language', '').lower()
                if language in ['pl', 'polish', 'polski']:
                    return True
                
                # 2. Check if format is released and available
                if fmt.get('isReleased', False):
                    return True
        
        return False
    
    def _construct_url(self, item: Dict[str, Any]) -> Optional[str]:
        """Construct direct URL to the audiobook."""
        if item.get('id'):
            return f"https://www.storytel.com/pl/books/{item['id']}"
        return None
    
    def _extract_narrator(self, item: Dict[str, Any]) -> Optional[str]:
        """Extract narrator information if available."""
        # Storytel API doesn't provide narrator in search results
        # This would require additional API calls to book details
        return None