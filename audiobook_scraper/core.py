#!/usr/bin/env python3
"""
Core framework for Polish audiobook availability checking system.
Defines abstract interfaces, data models, and utility functions.
"""

import re
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from urllib.parse import quote

import httpx
from rapidfuzz import fuzz


@dataclass
class AudiobookResult:
    """Standardized output schema for audiobook availability results."""
    provider: str
    title_matched: Optional[str] = None
    matched_author: Optional[str] = None
    is_available: bool = False
    confidence_score: float = 0.0
    direct_url: Optional[str] = None
    narrator: Optional[str] = None
    error_message: Optional[str] = None


class BaseAudiobookScraper(ABC):
    """Abstract base class defining the contract for all platform scrapers."""
    
    def __init__(self):
        self.provider_name = self.__class__.__name__.replace('Scraper', '')
    
    @abstractmethod
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> AudiobookResult:
        """
        Check audiobook availability on this platform.
        
        Args:
            title: Book title to search
            author: Optional author name for refined search
            isbn: Optional ISBN for precise matching
            
        Returns:
            AudiobookResult with availability information
        """
        pass


def normalize_string(text: str) -> str:
    """
    Normalize string for comparison: lowercase, remove diacritics, punctuation.
    Uses Unicode NFKD decomposition to strip diacritics.
    
    Args:
        text: Input string to normalize
        
    Returns:
        Normalized string
    """
    if not text:
        return ""
    
    # Unicode NFKD decomposition to separate diacritics
    normalized = unicodedata.normalize('NFKD', text)
    
    # Remove diacritics and convert to lowercase
    normalized = ''.join(
        c for c in normalized 
        if not unicodedata.combining(c)
    ).lower()
    
    # Remove common punctuation
    normalized = re.sub(r'[\.,!?;:"\'()\[\]{}]', '', normalized)
    
    # Replace multiple spaces with single space
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
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


def get_http_client() -> httpx.AsyncClient:
    """
    Create a configured HTTP client with proper headers for Polish content.
    
    Returns:
        Configured httpx.AsyncClient instance
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    
    return httpx.AsyncClient(headers=headers, timeout=30.0, follow_redirects=True)


def is_polish_audiobook(item: Dict[str, Any]) -> bool:
    """
    Check if an item represents a Polish-language audiobook.
    
    Args:
        item: Book/item metadata from provider
        
    Returns:
        True if item is a Polish audiobook
    """
    # This should be implemented by each scraper based on their specific
    # metadata structure. Base implementation returns True as fallback.
    return True