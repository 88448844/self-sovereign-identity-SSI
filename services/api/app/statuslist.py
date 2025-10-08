import math

from sqlalchemy import text


class StatusListManager:
    def __init__(self, Session):
        self.Session = Session

    def _get_or_create_list(self, issuer_did: str) -> str:
        list_id = f"status:{issuer_did}"
        with self.Session.begin() as session:
            row = session.execute(
                text("SELECT list_id FROM statuslists WHERE list_id=:l"), {"l": list_id}
            ).first()
            if not row:
                session.execute(
                    text(
                        "INSERT INTO statuslists (list_id, issuer, bitmap) "
                        "VALUES (:l,:iss, :bm)"
                    ),
                    {"l": list_id, "iss": issuer_did, "bm": b""},
                )
        return list_id

    def allocate(self, issuer_did: str):
        list_id = self._get_or_create_list(issuer_did)
        with self.Session.begin() as session:
            row = session.execute(
                text(
                    "SELECT COALESCE(MAX((status->>'index')::int), -1) "
                    "FROM credentials WHERE status->>'list_id'=:l"
                ),
                {"l": list_id},
            ).first()
            idx = (row[0] or -1) + 1
        return list_id, idx

    def publish(self, list_id: str):
        with self.Session() as session:
            mx = session.execute(
                text(
                    "SELECT COALESCE(MAX((status->>'index')::int),0) "
                    "FROM credentials WHERE status->>'list_id'=:l"
                ),
                {"l": list_id},
            ).scalar()
            if mx is None:
                mx = 0
            size = mx + 1
            bytes_len = math.ceil(size / 8)
            bitmap = bytearray(bytes_len)
            for (idx,) in session.execute(
                text("SELECT idx FROM revocations WHERE list_id=:l"), {"l": list_id}
            ):
                byte = idx // 8
                bit = idx % 8
                bitmap[byte] |= 1 << bit
            with self.Session.begin() as update_session:
                update_session.execute(
                    text("UPDATE statuslists SET bitmap=:bm WHERE list_id=:l"),
                    {"bm": bytes(bitmap), "l": list_id},
                )
        return {"id": list_id, "encoding": "bitset", "data": bytes(bitmap).hex()}

    def is_revoked(self, list_id: str, idx: int) -> bool:
        with self.Session() as session:
            row = session.execute(
                text("SELECT bitmap FROM statuslists WHERE list_id=:l"), {"l": list_id}
            ).first()
            if not row:
                return False
            bitmap = bytearray(row[0])
        byte = idx // 8
        bit = idx % 8
        if byte >= len(bitmap):
            return False
        return (bitmap[byte] & (1 << bit)) != 0
