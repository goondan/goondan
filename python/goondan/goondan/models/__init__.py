"""Official Goondan model adapters for the Anthropic Messages API and OpenAI Chat Completions.

The rules these adapters follow are in `spec/model-adapters.md`; the TypeScript package
`@goondan/models` implements the same rules, and `fixtures/models` checks that both make the
same requests, results, text chunks and error codes.

    from goondan.models import anthropic_model

    model = anthropic_model(model="claude-sonnet-5")
    result = await model.generate(model_input, ctx)

httpx is an optional dependency. Install it with `pip install "goondan[models]"`, or pass an
`httpx.AsyncClient` as `http_client`.
"""

from ._anthropic import AnthropicModel, anthropic_model
from ._errors import ModelError
from ._openai import OpenAIChatModel, openai_chat_model

__all__ = [
    "AnthropicModel",
    "ModelError",
    "OpenAIChatModel",
    "anthropic_model",
    "openai_chat_model",
]
