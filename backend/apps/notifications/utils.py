"""純函式:LINE webhook 驗簽、email 標題前綴。不碰 DB、不連外。"""

import base64
import hashlib
import hmac

DEV_SUBJECT_PREFIX = "[DEV] "


def line_signature(body: bytes, channel_secret: str) -> str:
    """LINE 的簽章:以 channel secret 對「原始 request body」做 HMAC-SHA256,再 base64。"""
    digest = hmac.new(channel_secret.encode("utf-8"), body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def verify_line_signature(body: bytes, signature: str, channel_secret: str) -> bool:
    """``X-Line-Signature`` 是否吻合。用 ``hmac.compare_digest`` 做定時比較,不洩漏比對到第幾個字元。

    ``body`` 必須是收到的原始 bytes——先 parse 再 dump 回 JSON 會改變位元組(空白、key 順序),簽章就對不上。
    """
    if not signature or not channel_secret:
        return False
    return hmac.compare_digest(signature.encode("ascii", "ignore"), line_signature(body, channel_secret).encode())


def email_subject(subject: str, env: str) -> str:
    """非 prod 環境的信件標題加 ``[DEV]``:測試站誤寄到真人信箱時,收件人一眼看得出不是正式通知。"""
    if env == "prod" or subject.startswith(DEV_SUBJECT_PREFIX):
        return subject
    return f"{DEV_SUBJECT_PREFIX}{subject}"
