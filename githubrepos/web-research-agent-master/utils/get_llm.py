import os
from openai import AzureOpenAI

def get_llm():
    llm = AzureOpenAI(
        api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    )
    return llm