import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

@pytest.mark.asyncio
@patch("main.analyze_query")
@patch("main.get_google_search_tool")
@patch("main.run_web_scraper_tool")
@patch("main.run_content_analyzer_tool")
@patch("main.run_result_aggregator_tool")
async def test_execute_research(
    mock_aggregator, mock_analyzer, mock_scraper, mock_google_search, mock_query_analysis
):
    # Mock input data
    query = "Rate of increase of air pollution in India"
    selected_urls = [
        "https://aqli.epic.uchicago.edu/country-spotlight/india/",
        "https://www.theguardian.com/environment/2016/may/12/air-pollution-rising-at-an-alarming-rate-in-worlds-cities",
        "https://www.worldbank.org/en/topic/pollution",
    ]

    # Mock outputs
    mock_query_analysis.return_value = {
        "intent": "factual",
        "subqueries": [query],
        "information_type": "facts",
        "search_strategy": "general search",
    }

    mock_google_search_tool = MagicMock()
    mock_google_search_tool.func.return_value = [
        {"link": url, "snippet": f"Snippet from {url}"} for url in selected_urls
    ]
    mock_google_search.return_value = mock_google_search_tool

    mock_scraper.return_value = [
        {"url": url, "content": f"Content from {url}"} for url in selected_urls
    ]

    mock_analyzer.return_value = [
        {"chunk": f"Relevant content from {url}"} for url in selected_urls
    ]

    mock_aggregator.return_value = (
        "Air pollution in India is increasing at an alarming rate.",
        ["https://aqli.epic.uchicago.edu/country-spotlight/india/"],
    )

    # Mock request payload
    payload = {"query": query}

    # Make the request
    response = client.post("/execute-research", json=payload)

    # Assertions
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == query
    assert "result" in data
    assert "content" in data["result"]
    assert "sources" in data["result"]
    assert data["result"]["content"] == "Air pollution in India is increasing at an alarming rate."
    assert data["result"]["sources"] == ["https://aqli.epic.uchicago.edu/country-spotlight/india/"]