"""
CRM Email Service

Simple SMTP email service using Python's smtplib.
Handles sending emails through a configured SMTP server with TLS support.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

logger = logging.getLogger(__name__)


def send_email(smtp_config, to_email: str, subject: str, body: str) -> bool:
    """Send an email using the configured SMTP server.

    Args:
        smtp_config: SmtpConfig model instance with smtp_server, smtp_port,
                     email_address, password, use_tls, from_name
        to_email: Recipient email address
        subject: Email subject line
        body: Email body content (HTML supported)

    Returns:
        True if sent successfully, False otherwise
    """
    if not smtp_config or not smtp_config.smtp_server or not smtp_config.email_address:
        logger.error("[EmailService] SMTP not configured. Cannot send email.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["To"] = to_email

        if smtp_config.from_name:
            msg["From"] = f"{smtp_config.from_name} <{smtp_config.email_address}>"
        else:
            msg["From"] = smtp_config.email_address

        html_part = MIMEText(body, "html")
        msg.attach(html_part)

        logger.info(
            f"[EmailService] Connecting to {smtp_config.smtp_server}:{smtp_config.smtp_port}"
        )

        if smtp_config.use_tls:
            server = smtplib.SMTP(smtp_config.smtp_server, smtp_config.smtp_port)
            server.ehlo()
            server.starttls()
            server.ehlo()
        else:
            server = smtplib.SMTP(smtp_config.smtp_server, smtp_config.smtp_port)
            server.ehlo()

        if smtp_config.password:
            server.login(smtp_config.email_address, smtp_config.password)

        server.sendmail(smtp_config.email_address, to_email, msg.as_string())
        server.quit()

        logger.info(f"[EmailService] Email sent successfully to {to_email}")
        return True

    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"[EmailService] SMTP authentication failed: {e}")
        return False
    except smtplib.SMTPConnectError as e:
        logger.error(f"[EmailService] Could not connect to SMTP server: {e}")
        return False
    except smtplib.SMTPRecipientsRefused as e:
        logger.error(f"[EmailService] Recipient refused: {to_email} - {e}")
        return False
    except smtplib.SMTPException as e:
        logger.error(f"[EmailService] SMTP error sending to {to_email}: {e}")
        return False
    except Exception as e:
        logger.error(f"[EmailService] Unexpected error sending email to {to_email}: {e}")
        return False
