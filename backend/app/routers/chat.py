import json
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.db import chat as chat_db
from app.db.rls import rls_connection
from app.deps import get_current_claims
from app.models.chat import (
    ChatMessageRequest,
    ConversationCreate,
    ConversationListResponse,
    ConversationResponse,
    MessageListResponse,
)
from app.services import chat as chat_svc

router = APIRouter(prefix="/conversations", tags=["chat"])

Claims = Annotated[dict, Depends(get_current_claims)]

_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")


def _sse(event: dict) -> str:
    """Serialize one event dict as a single SSE frame."""
    return f"data: {json.dumps(event)}\n\n"


@router.get("", response_model=ConversationListResponse)
async def list_conversations(
    claims: Claims,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ConversationListResponse:
    async with rls_connection(claims) as conn:
        rows = await chat_db.list_conversations(conn, limit=limit, offset=offset)
        total = await chat_db.count_conversations(conn)
    return ConversationListResponse(items=[dict(r) for r in rows], total=total)


@router.post("", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(payload: ConversationCreate, claims: Claims) -> ConversationResponse:
    async with rls_connection(claims) as conn:
        row = await chat_db.insert_conversation(conn, claims["sub"], payload.title)
    return ConversationResponse(**dict(row))


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(conversation_id: UUID, claims: Claims) -> ConversationResponse:
    async with rls_connection(claims) as conn:
        row = await chat_db.get_conversation(conn, str(conversation_id))
    if row is None:
        raise _NOT_FOUND
    return ConversationResponse(**dict(row))


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: UUID, claims: Claims) -> None:
    async with rls_connection(claims) as conn:
        deleted = await chat_db.delete_conversation(conn, str(conversation_id))
    if deleted is None:
        raise _NOT_FOUND


@router.get("/{conversation_id}/messages", response_model=MessageListResponse)
async def list_messages(
    conversation_id: UUID,
    claims: Claims,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MessageListResponse:
    async with rls_connection(claims) as conn:
        conv = await chat_db.get_conversation(conn, str(conversation_id))
        if conv is None:
            raise _NOT_FOUND
        rows = await chat_db.list_messages(conn, str(conversation_id), limit=limit, offset=offset)
        total = await chat_db.count_messages(conn, str(conversation_id))
    return MessageListResponse(items=rows, total=total)


@router.post("/{conversation_id}/messages")
async def post_message(
    conversation_id: UUID, payload: ChatMessageRequest, claims: Claims
) -> StreamingResponse:
    # Confirm ownership before opening the stream so a non-existent/hidden
    # conversation gets a clean 404 rather than an in-stream error (and doesn't
    # consume a daily counter).
    async with rls_connection(claims) as conn:
        if await chat_db.get_conversation(conn, str(conversation_id)) is None:
            raise _NOT_FOUND

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in chat_svc.stream_turn(
                claims, str(conversation_id), payload.content, onboarding=payload.onboarding
            ):
                yield _sse(event)
        except chat_svc.ConversationNotFoundError:
            yield _sse(
                {"type": "error", "reason": "not_found", "message": "Conversation not found"}
            )

    # Explicit anti-buffering headers: Container Apps ingress can otherwise buffer
    # SSE, defeating incremental streaming. Verified live at deploy time.
    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
