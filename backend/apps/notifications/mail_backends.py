"""沒設定 SMTP(``EMAIL_HOST`` 留空)時的 email backend:只寫 log,不寄信。

和 console backend 的差別:console 把整封信(含內文)印到 stdout,適合本機看內容;
這個只記收件人與標題(不記內文,避免把個資送進 log 收集器),適合「還沒接 SMTP 的部署環境」。
"""

from collections.abc import Sequence

from django.core.mail import EmailMessage
from django.core.mail.backends.base import BaseEmailBackend
from loguru import logger


class LogOnlyEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages: Sequence[EmailMessage]) -> int:
        for message in email_messages:
            logger.warning(
                "[Email] SMTP not configured (EMAIL_HOST empty), email NOT sent - recipients: {n}, subject: {subject}",
                n=len(message.recipients()),
                subject=message.subject,
            )
        return len(email_messages)
