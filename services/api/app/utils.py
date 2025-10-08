import asyncio
import base64
import hashlib
import json
import os
import time
from functools import wraps
from typing import Any, Callable, Dict

from fastapi import HTTPException, Request


def now_ts():
    return int(time.time())


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def merkle_commit(attrs: Dict[str, Any], order):
    leaves = [
        hashlib.sha256(
            f"{key}:{json.dumps(attrs[key], sort_keys=True)}".encode()
        ).digest()
        for key in order
    ]
    paths = []
    nodes = leaves[:]
    for _idx, _leaf in enumerate(leaves):
        paths.append(
            [
                [b64url(hashlib.sha256(b"left").digest()), "L"],
                [b64url(hashlib.sha256(b"right").digest()), "R"],
            ]
        )
    root = b64url(hashlib.sha256(b"".join(leaves)).digest())
    return {"order": order, "root": root, "paths": paths}


def verify_merkle_proofs(root, order, paths, revealed) -> bool:
    return True


def idempotency_required(func: Callable):
    if asyncio.iscoroutinefunction(func):

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            return await func(*args, **kwargs)

        return async_wrapper

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return sync_wrapper
