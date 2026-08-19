#!/usr/bin/env python3
"""
Legimi audiobook availability scraper.
Implements web scraping for Polish audiobooks.
"""

from typing import Optional, Dict, Any, List
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup
from ..core import BaseAudiobookScraper, AudiobookResult, normalize_string, calculate_similarity


class LegimiScraper(BaseAudiobookScraper):
    """Scraper for Legimi platform using web scraping."""
    
    def __init__(self):
        super().__init__()
        self.provider_name = "Legimi"
    
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> AudiobookResult:
        """
        Check audiobook availability on Legimi.
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
            
            # Step 2: Search using Legimi web scraping
            items = await self._search_legimi(title, author, isbn)
            
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
            result.error_message = f"Error checking Legimi: {e}"
        
        return result
    
    async def _search_legimi(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search Legimi using web scraping."""
        if isbn:
            query = isbn
        elif author:
            query = f"{title} {author}"
        else:
            query = title
        
        # Legimi search URL for audiobooks
        search_url = f'https://www.legimi.pl/ebooki/?format=unlimited_audio&query={quote(query)}'
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        }
        
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(search_url, headers=headers)
            
            if response.status_code != 200:
                raise Exception(f"HTTP error: {response.status_code}")
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract book items from search results
            items = []
            book_elements = soup.select('.product-item, .book-item, [data-product]')
            
            for element in book_elements:
                book_data = {
                    'title': self._extract_text(element, '.title, .product-title, h3'),
                    'author': self._extract_text(element, '.author, .product-author'),
                    'url': self._extract_url(element),
                    'narrator': self._extract_narrator_from_element(element),
                }
                
                if book_data['title']:
                    items.append(book_data)
            
            return items
    
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
                return f'https://www.legimi.pl{href}'
            return href
        return ""
    
    def _extract_narrator_from_element(self, element) -> str:
        """Extract narrator information from element."""
        # Look for narrator information in the element
        narrator = self._extract_text(element, '.narrator, .lektor, [data-narrator]')
        
        # Also check for "Czyta:" or "Lektor:" patterns in the text
        if not narrator:
            text = element.get_text()
            if 'Czyta:' in text or 'Lektor:' in text:
                # Try to extract narrator name
                import re
                match = re.search(r'(Czyta|Lektor):\s*([^\n\r]+)', text)
                if match:
                    narrator = match.group(2).strip()
        
        return narrator
    
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
        """Check if item is a Polish audiobook on Legimi."""
        # Legimi is a Polish platform focused on audiobooks
        # Check URL patterns for audiobook indicators
        url = item.get('url', '')
        
        # Legimi uses specific paths for audiobooks
        if '/audiobook/' in url or '/ebooki/' in url:
            return True
        
        # Check for Polish language indicators in title/author
        title = item.get('title', '').lower()
        author = item.get('author', '').lower()
        
        # Common Polish words that might appear
        polish_indicators = ['książka', 'audio', 'audiobook', 'czyta', 'lektor', 'polski', 'abonament']
        
        for indicator in polish_indicators:
            if indicator in title or indicator in author:
                return True
        
        # Default to True for Polish audiobook platform
        return True
    
    def _construct_url(self, item: Dict[str, Any]) -> Optional[str]:
        """Construct direct URL to the audiobook."""
        return item.get('url')
    
    def _extract_narrator(self, item: Dict[str, Any]) -> Optional[str]:
        """Extract narrator information if available."""
        return item.get('narrator')