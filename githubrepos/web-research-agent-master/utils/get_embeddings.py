import os
from langchain_openai import AzureOpenAIEmbeddings

def get_embeddings():
    embeddings = AzureOpenAIEmbeddings(
    deployment="text-embedding-3-small",
    openai_api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    openai_api_type="azure",
    openai_api_version="2024-02-01",
    chunk_size=1024 
)
    return embeddings
