#!/usr/bin/env python3
"""
Polish Audiobook Availability Checker
Modular system for checking audiobook availability across multiple platforms.
"""

import asyncio
import json
from typing import List, Optional
from .core import AudiobookResult
from .providers.storytel import StorytelScraper
from .providers.bookbeat import BookBeatScraper
from .providers.audioteka import AudiotekaScraper
from .providers.legimi import LegimiScraper
from .providers.biblioteka_raczynskich import BibliotekaRaczynskichScraper


class AudiobookChecker:
    """Orchestrator for concurrent audiobook availability checking."""
    
    def __init__(self):
        self.scrapers = [
            StorytelScraper(),
            BookBeatScraper(),
            AudiotekaScraper(),
            LegimiScraper(),
            BibliotekaRaczynskichScraper(),
        ]
    
    async def check_availability(
        self,
        title: str,
        author: Optional[str] = None,
        isbn: Optional[str] = None
    ) -> List[AudiobookResult]:
        """
        Check audiobook availability across all platforms concurrently.
        
        Args:
            title: Book title to search
            author: Optional author name
            isbn: Optional ISBN
            
        Returns:
            List of AudiobookResult objects from all providers
        """
        tasks = [
            scraper.check_availability(title, author, isbn)
            for scraper in self.scrapers
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Convert exceptions to error results
        final_results = []
        for result in results:
            if isinstance(result, Exception):
                final_results.append(AudiobookResult(
                    provider="Unknown",
                    error_message=f"Error: {result}",
                    is_available=False
                ))
            else:
                final_results.append(result)
        
        return final_results


def format_results_table(results: List[AudiobookResult]) -> str:
    """Format results as a CLI table."""
    table_lines = []
    table_lines.append("=" * 80)
    table_lines.append(f"{'Provider':<12} {'Available':<10} {'Confidence':<10} {'Title':<30} {'URL'}")
    table_lines.append("-" * 80)
    
    for result in results:
        available = "✓" if result.is_available else "✗"
        confidence = f"{result.confidence_score:.2f}" if result.confidence_score > 0 else "-"
        title = result.title_matched or "-"
        title = (title[:27] + "...") if len(title) > 30 else title
        url = result.direct_url or "-"
        
        if result.error_message:
            table_lines.append(f"{result.provider:<12} {'ERROR':<10} {'-':<10} {'-':<30} {result.error_message[:40]}...")
        else:
            table_lines.append(f"{result.provider:<12} {available:<10} {confidence:<10} {title:<30} {url}")
    
    table_lines.append("=" * 80)
    return "\n".join(table_lines)


async def main():
    """Main CLI entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Check Polish audiobook availability across platforms")
    parser.add_argument("--title", required=True, help="Book title to search")
    parser.add_argument("--author", help="Author name")
    parser.add_argument("--isbn", help="ISBN number")
    parser.add_argument("--format", choices=["table", "json"], default="table", 
                       help="Output format")
    
    args = parser.parse_args()
    
    checker = AudiobookChecker()
    results = await checker.check_availability(args.title, args.author, args.isbn)
    
    if args.format == "json":
        # Convert results to JSON-serializable dicts
        output = []
        for result in results:
            output.append({
                "provider": result.provider,
                "title_matched": result.title_matched,
                "matched_author": result.matched_author,
                "is_available": result.is_available,
                "confidence_score": result.confidence_score,
                "direct_url": result.direct_url,
                "narrator": result.narrator,
                "error_message": result.error_message
            })
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(format_results_table(results))


if __name__ == "__main__":
    asyncio.run(main())