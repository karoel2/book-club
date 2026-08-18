#!/usr/bin/env python3
"""
Biblioteka Raczyńskich (Poznań) audiobook availability scraper.
Implements Ex Libris Primo VE API integration for library audiobooks.
"""

import asyncio
import json
import re
from typing import Optional, Dict, Any, List
from urllib.parse import quote

import httpx
from ..core import BaseAudiobookScraper, AudiobookResult, normalize_string, calculate_similarity


class BibliotekaRaczynskichScraper(BaseAudiobookScraper):
    """Scraper for Biblioteka Raczyńskich using Ex Libris Primo VE API."""
    
    def __init__(self):
        super().__init__()
        self.provider_name = "Biblioteka Raczyńskich"
    
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> AudiobookResult:
        """
        Check audiobook availability in Biblioteka Raczyńskich.
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
            
            # Step 2: Search using Primo VE API
            items = await self._search_primo_ve(title, author, isbn)
            
            # Step 3: Find best match with similarity scoring
            best_match, best_score = self._find_best_match(items, title, author, isbn)
            
            # Step 4: Populate result
            if best_match:
                result.title_matched = best_match.get('title')
                result.matched_author = best_match.get('author')
                result.confidence_score = best_score
                result.is_available = best_score >= 0.85 and self._is_polish_book(best_match)
                result.direct_url = self._construct_url(best_match)
                result.narrator = self._extract_narrator(best_match)
            
        except Exception as e:
            result.error_message = f"Error checking {self.provider_name}: {e}"
        
        return result
    
    async def _search_primo_ve(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search Biblioteka Raczyńskich using Ex Libris Primo VE API."""
        # Build query using Primo VE syntax - use simple title search only
        # The API seems to have issues with complex queries
        query = f"any,contains,{title}"
        
        # Primo VE API endpoint
        api_url = 'https://omnis-br.primo.exlibrisgroup.com/primaws/rest/pub/pnxs'
        params = {
            'vid': '48OMNIS_BRP:BRACZ',
            'q': query,
            'limit': 10,
            # Use minimal parameters to avoid API issues
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        }
        
        # Use subprocess to call curl directly since the API blocks Python requests
        import subprocess
        import shlex
        
        # Build curl command with proper URL encoding
        from urllib.parse import urlencode
        query_string = urlencode(params, quote_via=quote)
        curl_cmd = f"curl -s '{api_url}?{query_string}'"
        
        try:
            result = subprocess.run(shlex.split(curl_cmd), capture_output=True, text=True, timeout=15.0)
            
            if result.returncode != 0:
                raise Exception(f"Curl failed with return code {result.returncode}")
            
            if not result.stdout:
                raise Exception("Empty response from Primo VE API")
            
            # Try to parse the response
            try:
                data = json.loads(result.stdout)
                if 'docs' in data:
                    return data.get('docs', [])
                else:
                    raise Exception("Invalid response format from Primo VE API")
            except json.JSONDecodeError:
                raise Exception("Cannot parse JSON response from Primo VE API")
                
        except subprocess.TimeoutExpired:
            raise Exception("Primo VE API timeout")
        except Exception as e:
            raise Exception(f"Curl error: {e}")
    
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
            # Extract title and author from Primo VE response structure
            item_title = self._extract_from_primo(item, 'title')
            item_author = self._extract_from_primo(item, 'creator')
            
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
    
    def _extract_from_primo(self, item: Dict[str, Any], field: str) -> str:
        """Extract field from Primo VE response structure."""
        try:
            return item.get('pnx', {}).get('display', {}).get(field, [''])[0]
        except (IndexError, KeyError, TypeError):
            return ""
    
    def _is_polish_book(self, item: Dict[str, Any]) -> bool:
        """Check if item is a Polish paper book in Biblioteka Raczyńskich."""
        # Check language
        language = self._extract_from_primo(item, 'language')
        if language and language.lower() not in ['pl', 'pol', 'polski', 'polish']:
            return False
        
        # Check format - we want physical books, not ebooks or other formats
        format_type = self._extract_from_primo(item, 'type')
        if format_type:
            format_lower = format_type.lower()
            # Accept book formats, reject non-book formats
            if any(x in format_lower for x in ['ebook', 'electronic', 'online', 'digital', 'video', 'audio', 'sound', 'journal', 'score']):
                return False
            # Accept physical book formats
            if any(x in format_lower for x in ['book', 'książka', 'druk', 'print']):
                return True
        
        # Check availability
        availability = self._extract_from_primo(item, 'availstatus')
        if availability and 'available' not in availability.lower():
            return False
        
        # Additional availability check in delivery section
        delivery = item.get('delivery', {})
        holdings = delivery.get('holding', [])
        
        if holdings:
            # Check if any holding is available
            for holding in holdings:
                if holding.get('availability') == 'available':
                    return True
        
        return False
    
    def _construct_url(self, item: Dict[str, Any]) -> Optional[str]:
        """Construct URL to the book."""
        # Get the source record ID from the control section
        sourcerecordid = item.get('pnx', {}).get('control', {}).get('sourcerecordid')
        if sourcerecordid and isinstance(sourcerecordid, list) and len(sourcerecordid) > 0:
            record_id = sourcerecordid[0]
            # Use the working search URL format with correct scope
            title = self._extract_from_primo(item, 'title')
            if title:
                from urllib.parse import quote
                # Extract just the main title part (before slash if exists)
                main_title = title.split('/')[0].strip()
                # URL encode properly
                encoded_title = quote(main_title)
                return f"https://omnis-br.primo.exlibrisgroup.com/discovery/search?query=any,contains,{encoded_title}&tab=LibraryCatalog&search_scope=MyInstitution2&vid=48OMNIS_BRP:BRACZ&offset=0"
        return "https://www.bracz.edu.pl/katalogi-online"
    
    def _extract_narrator(self, item: Dict[str, Any]) -> Optional[str]:
        """Extract narrator information from Primo VE response."""
        # Check contributors for narrator information
        contributors = item.get('pnx', {}).get('display', {}).get('contributor', [])
        
        for contributor in contributors:
            # Look for narrator patterns
            narrator_match = re.search(r'(?i)(czyta|lektor):\s*([^,;(]+)', contributor)
            if narrator_match:
                return narrator_match.group(2).strip()
        
        # Check addata section for narrator info
        addata = item.get('pnx', {}).get('addata', {})
        if isinstance(addata, dict):
            for key, value in addata.items():
                if isinstance(value, str) and re.search(r'(?i)(czyta|lektor)', value):
                    narrator_match = re.search(r'(?i)(czyta|lektor):\s*([^,;(]+)', value)
                    if narrator_match:
                        return narrator_match.group(2).strip()
        
        return None