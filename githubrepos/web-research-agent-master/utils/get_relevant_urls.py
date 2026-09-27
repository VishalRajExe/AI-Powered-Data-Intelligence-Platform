import numpy as np

def get_relevant_urls(query: str, embeddings, search_results, M: int) -> list:
    """
    Get relevant URLs based on the query and search results.
    """
    main_query_embedding = embeddings.embed_query(query)
    snippets = [result["snippet"] for result in search_results]
    snippet_embeddings = embeddings.embed_documents(snippets)
    main_query_vec = np.array(main_query_embedding)
    snippet_vecs = np.array(snippet_embeddings)
    similarities = np.dot(snippet_vecs, main_query_vec) / (np.linalg.norm(snippet_vecs, axis=1) * np.linalg.norm(main_query_vec))

    # rank and deduplicate URLs
    url_scores = {}
    for result, sim in zip(search_results, similarities):
        url = result["url"]
        if url not in url_scores or sim > url_scores[url]:
            url_scores[url] = sim
    sorted_urls = sorted(url_scores.items(), key=lambda x: x[1], reverse=True)

    # select top M relevant urls
    selected_urls = [url for url, score in sorted_urls[:M]]
    return selected_urls