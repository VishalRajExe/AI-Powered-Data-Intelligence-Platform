from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List

class ResearchRequest(BaseModel):
    query: str = Field(..., description="The user’s search query")

class Document(BaseModel):
    content: str
    sources: Optional[List[HttpUrl]] = Field(
        default_factory=list,
        description="List of URLs where the content was found"
    )

class ResearchResponse(BaseModel):
    query: str
    result: Optional[Document]
