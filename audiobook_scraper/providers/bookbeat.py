#!/usr/bin/env python3
"""
BookBeat audiobook availability scraper.
Implements async API-based checking for Polish audiobooks.
"""

import json
from typing import Optional, Dict, Any, List
from urllib.parse import quote

import httpx
from ..core import BaseAudiobookScraper, AudiobookResult, normalize_string, calculate_similarity


class BookBeatScraper(BaseAudiobookScraper):
    """Scraper for BookBeat platform using their JSON Search API."""
    
    def __init__(self):
        super().__init__()
        self.provider_name = "BookBeat"
    
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> AudiobookResult:
        """
        Check audiobook availability on BookBeat.
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
            
            # Step 2: Search using BookBeat API
            items = await self._search_bookbeat_api(title, author, isbn)
            
            # Step 3: Find best match with similarity scoring
            best_match, best_score = self._find_best_match(items, title, author, isbn)
            
            # Step 4: Populate result
            if best_match:
                result.title_matched = best_match.get('title')
                result.matched_author = best_match.get('author')
                result.confidence_score = best_score
                result.is_available = best_score >= 0.85 and self._is_polish_audiobook(best_match)
                result.direct_url = self._construct_url(best_match)
                result.narrator = self._extract_narrator(best_match)
            
        except Exception as e:
            result.error_message = f"Error checking BookBeat: {e}"
        
        return result
    
    async def _search_bookbeat_api(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search BookBeat using their internal API endpoint."""
        if isbn:
            query = isbn
        elif author:
            query = f"{title} {author}"
        else:
            query = title
        
        # BookBeat's internal API endpoint
        api_url = 'https://www.bookbeat.com/api/search'
        params = {
            'query': query,
            'market': 'pl',
            'limit': 10,
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
            'Referer': 'https://www.bookbeat.com/pl/szukaj',
        }
        
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(api_url, params=params, headers=headers)
            
            if response.status_code != 200:
                # Fallback to HTML scraping if API fails
                return await self._fallback_bookbeat_search(query)
            
            try:
                data = response.json()
                return data.get('books', [])
            except:
                return await self._fallback_bookbeat_search(query)
    
    async def _fallback_bookbeat_search(self, query: str) -> List[Dict[str, Any]]:
        """Fallback to HTML scraping for BookBeat."""
        from bs4 import BeautifulSoup
        
        search_url = f'https://www.bookbeat.com/pl/szukaj?query={quote(query)}'
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        }
        
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(search_url, headers=headers)
            
            if response.status_code != 200:
                return []
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Try to find JSON data in script tags
            script_data = soup.find('script', {'id': '__NEXT_DATA__'})
            if script_data:
                try:
                    data = json.loads(script_data.string)
                    # Extract books from Next.js data
                    books = data.get('props', {}).get('pageProps', {}).get('books', [])
                    return books
                except:
                    pass
            
            return []
    
    def _extract_text(self, element, selector: str) -> str:
        """Extract text from element using selector."""
        found = element.select_one(selector)
        return found.get_text(strip=True) if found else ""
    
    def _extract_url(self, element) -> str:
        """Extract URL from element."""
        link = element.select_one('a[href]')
        if link and link.get('href'):
            href = link['href']
            if href.startswith('/'):
                return f'https://www.bookbeat.pl{href}'
            return href
        return ""
    
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
            item_author = item.get('author', '')
            
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
        """Check if item is a Polish audiobook on BookBeat."""
        # Check book format
        book_format = item.get('bookFormat', '').upper()
        if book_format == 'AUDIO_BOOK':
            # Check language for Polish content
            language = item.get('language', '').lower()
            if language in ['pl', 'polish', 'polski']:
                return True
            
            # For Polish market, assume audiobooks are in Polish
            return True
        
        # Check title/author for Polish language indicators
        title = item.get('title', '').lower()
        author = item.get('author', '').lower()
        
        # Common Polish words that might appear
        polish_indicators = ['książka', 'audio', 'audiobook', 'czyta', 'lektor', 'polski']
        
        for indicator in polish_indicators:
            if indicator in title or indicator in author:
                return True
        
        return False
    
    def _construct_url(self, item: Dict[str, Any]) -> Optional[str]:
        """Construct direct URL to the audiobook."""
        url = item.get('url')
        if url:
            return url
        
        book_id = item.get('id')
        if book_id:
            return f"https://www.bookbeat.pl/ksiazka-audio/{book_id}"
        return None
    
    def _extract_narrator(self, item: Dict[str, Any]) -> Optional[str]:
        """Extract narrator information if available."""
        # BookBeat API might provide narrator in metadata
        return item.get('narrator') or item.get('reader')