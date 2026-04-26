import os
import json
import logging
import httpx
from dotenv import load_dotenv

load_dotenv()

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
logger = logging.getLogger(__name__)


async def tavily_fact_check(question: str, ai_draft: str) -> dict | None:
    if not TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY not set, skipping automated fact-check")
        return None

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": f"fact check: {question}",
                    "search_depth": "advanced",
                    "include_answer": True,
                    "max_results": 3,
                },
            )
            response.raise_for_status()
            data = response.json()

            tavily_answer = data.get("answer", "")
            sources = []
            for result in data.get("results", [])[:3]:
                sources.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "snippet": result.get("content", "")[:200],
                })

            return {
                "tavily_answer": tavily_answer,
                "sources": sources,
            }
    except Exception as e:
        logger.error(f"Tavily fact-check failed: {e}")
        return None
