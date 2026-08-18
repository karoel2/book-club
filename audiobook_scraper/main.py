#!/usr/bin/env python3
"""
Main CLI entry point for Polish Audiobook Availability Checker.
"""

import asyncio
import sys
from audiobook_scraper import main

if __name__ == "__main__":
    asyncio.run(main())