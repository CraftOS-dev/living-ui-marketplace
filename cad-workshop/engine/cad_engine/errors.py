"""Typed engine errors.

Every failure the engine reports carries a closed `code`, a sentence a person
can act on, and the measured context (found and expected counts, candidate
keys) so the caller can fix the call in one step.
"""

CODES = (
    "param_invalid",
    "stale_reference",
    "reference_order",
    "kernel_failed",
    "no_effect",
    "invalid_solid",
    "empty_result",
    "sketch_invalid",
    "unsupported",
    "import_failed",
)


class CadError(Exception):
    def __init__(self, code, message, **extra):
        if code not in CODES:
            raise ValueError("unknown error code " + code)
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra

    def to_dict(self, feature=None):
        out = {"code": self.code, "message": self.message}
        if feature is not None:
            out["feature"] = feature
        for k, v in self.extra.items():
            if v is not None:
                out[k] = v
        return out


def invalid(message, **extra):
    return CadError("param_invalid", message, **extra)
