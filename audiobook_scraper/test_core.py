#!/usr/bin/env python3
"""
Test script for the core audiobook scraper functionality.
"""

import asyncio
from audiobook_scraper import AudiobookChecker


async def test_scraper():
    """Test the audiobook scraper with various books."""
    
    checker = AudiobookChecker()
    
    print("Testing Polish Audiobook Availability Checker")
    print("=" * 60)
    
    # Test 1: Available Polish audiobook
    print("\n1. Testing 'Problem trzech ciał' by Cixin Liu:")
    results = await checker.check_availability(
        title="Problem trzech ciał",
        author="Cixin Liu"
    )
    
    for result in results:
        if result.error_message:
            print(f"   {result.provider}: ERROR - {result.error_message}")
        else:
            status = "AVAILABLE" if result.is_available else "NOT AVAILABLE"
            print(f"   {result.provider}: {status} (confidence: {result.confidence_score:.2f})")
            if result.title_matched:
                print(f"     Title: {result.title_matched}")
            if result.direct_url:
                print(f"     URL: {result.direct_url}")
    
    # Test 2: Another Polish book
    print("\n2. Testing 'Wiedźmin' by Andrzej Sapkowski:")
    results = await checker.check_availability(
        title="Wiedźmin",
        author="Andrzej Sapkowski"
    )
    
    for result in results:
        if result.error_message:
            print(f"   {result.provider}: ERROR - {result.error_message}")
        else:
            status = "AVAILABLE" if result.is_available else "NOT AVAILABLE"
            print(f"   {result.provider}: {status} (confidence: {result.confidence_score:.2f})")


if __name__ == "__main__":
    asyncio.run(test_scraper())