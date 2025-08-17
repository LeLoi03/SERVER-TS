import numpy as np
import os
import time
from itertools import cycle
from typing import List
from dotenv import load_dotenv
from google.genai import types

# --- LOAD ENVIRONMENT VARIABLES ---
load_dotenv()

# Gemini Configuration
GEMINI_ENV_PREFIX = "GEMINI_API_KEY_"
EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT"
EMBEDDING_DIM = 768
EMBEDDING_BATCH_SIZE = 50

# --- Gemini Service (Remains the same) ---
class KeyManager:
    """Manages and cycles through a list of Gemini API keys."""
    def __init__(self, env_prefix: str):
        self.keys = [v for k, v in os.environ.items() if k.startswith(env_prefix)]
        if not self.keys:
            raise ValueError(f"No API keys found with prefix '{env_prefix}' in .env file.")
        self._key_cycler = cycle(self.keys)
        print(f"🔑 KeyManager initialized with {len(self.keys)} API keys.")

    def get_next_key(self) -> str:
        return next(self._key_cycler)

class GeminiService:
    """A service class for handling Gemini API embedding operations."""
    def __init__(self, env_prefix: str, model: str, task_type: str, dim: int):
        try:
            from google import genai
            from google.api_core import exceptions as google_exceptions
            self.genai = genai
            self.google_exceptions = google_exceptions
        except ImportError:
            raise ImportError("Please install google-generativeai: pip install google-generativeai")
            
        self.key_manager = KeyManager(env_prefix)
        self.model = model
        self.task_type = task_type
        self.output_dim = dim

    @staticmethod
    def _normalize_embedding(embedding: list) -> list:
        np_embedding = np.array(embedding)
        norm = np.linalg.norm(np_embedding)
        return (np_embedding / norm).tolist() if norm != 0 else embedding

    def embed_content(self, batch_docs: List[str]) -> List[List[float]] | None:
        retries, max_retries, backoff_delay = 0, 3, 5
        while retries < max_retries:
            api_key = self.key_manager.get_next_key()
            client = self.genai.Client(api_key=api_key)
            try:
                result = client.models.embed_content(
                    model=self.model,
                    contents=batch_docs,
                    config=types.EmbedContentConfig(task_type=self.task_type, output_dimensionality=self.output_dim)
                )
                return [self._normalize_embedding(e.values) for e in result.embeddings]
            except (self.google_exceptions.InternalServerError, self.google_exceptions.ResourceExhausted, self.google_exceptions.PermissionDenied) as e:
                retries += 1
                print(f"\n⚠️ Gemini API error (key ...{api_key[-4:]}): {type(e).__name__}. "
                      f"Retrying in {backoff_delay}s... ({retries}/{max_retries})")
                time.sleep(backoff_delay)
                backoff_delay *= 2
            except Exception as e:
                print(f"\n⚠️ An unexpected error occurred during embedding with key ...{api_key[-4:]}: {e}")
                break
        
        print(f"Skipping batch after failing all retry attempts.")
        return None
