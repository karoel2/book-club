#!/usr/bin/env python3
"""
Test script for Storytel availability checker
"""

import check_storytel_availability

def demo_book_availability():
    """Test various book availability scenarios"""
    
    print("Testing Storytel Book Availability Checker")
    print("=" * 50)
    
    # Test 1: Available book
    print("\n1. Testing available book:")
    result = check_storytel_availability.check_storytel_availability(
        title='Harry Potter i Kamień Filozoficzny',
        author='J.K. Rowling',
        country_code='pl'
    )
    print(f"   Available: {result['is_available']}")
    print(f"   Confidence: {result['confidence_score']:.2f}")
    print(f"   Title: {result['matched_title']}")
    print(f"   Author: {result['matched_author']}")
    print(f"   Formats: {result['formats']}")
    print(f"   URL: {result['storytel_url']}")
    
    # Test 2: Another available book
    print("\n2. Testing 'Problem trzech ciał':")
    result = check_storytel_availability.check_storytel_availability(
        title='Problem trzech ciał',
        author='Cixin Liu',
        country_code='pl'
    )
    print(f"   Available: {result['is_available']}")
    print(f"   Confidence: {result['confidence_score']:.2f}")
    print(f"   Title: {result['matched_title']}")
    print(f"   Author: {result['matched_author']}")
    print(f"   Formats: {result['formats']}")
    print(f"   URL: {result['storytel_url']}")
    
    # Test 3: Non-existent book
    print("\n3. Testing non-existent book:")
    result = check_storytel_availability.check_storytel_availability(
        title='This Book Definitely Does Not Exist',
        author='Unknown Author',
        country_code='pl'
    )
    print(f"   Available: {result['is_available']}")
    print(f"   Confidence: {result['confidence_score']:.2f}")
    print(f"   Title: {result['matched_title']}")
    print(f"   Author: {result['matched_author']}")
    
    # Test 4: Different country (Sweden)
    print("\n4. Testing SE store:")
    result = check_storytel_availability.check_storytel_availability(
        title='Harry Potter',
        author='J.K. Rowling',
        country_code='se'
    )
    print(f"   Available: {result['is_available']}")
    print(f"   Confidence: {result['confidence_score']:.2f}")
    print(f"   Title: {result['matched_title']}")
    print(f"   Author: {result['matched_author']}")
    print(f"   Formats: {result['formats']}")

if __name__ == "__main__":
    demo_book_availability()