"""Errors the engine answers with: a code the app maps to an HTTP status and
a sentence for the person (or the AI agent) that says what to change."""


class ImgError(Exception):
    def __init__(self, code, message, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra

    def to_dict(self):
        out = {"code": self.code, "message": self.message}
        out.update(self.extra)
        return out


def invalid(message, **extra):
    return ImgError("param_invalid", message, **extra)
