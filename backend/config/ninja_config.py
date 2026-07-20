"""orjson-based parser/renderer for Django Ninja — faster than stdlib json."""

import orjson
from ninja.errors import HttpError
from ninja.parser import Parser
from ninja.renderers import BaseRenderer
from ninja.responses import NinjaJSONEncoder

# orjson can't serialize Decimal, lazy strings (Promise), etc. Delegate those
# to ninja's own JSON encoder so fallback behaviour matches the framework.
_fallback_encoder = NinjaJSONEncoder()


class ORJSONParser(Parser):
    def parse_body(self, request):
        # A malformed or empty JSON body is a client error: translate orjson's
        # decode error into a 400 instead of letting it bubble to the generic
        # 500 handler (stock ninja likewise surfaces parse errors as 4xx).
        try:
            return orjson.loads(request.body)
        except orjson.JSONDecodeError as exc:
            raise HttpError(400, "Invalid or malformed JSON body") from exc


class ORJSONRenderer(BaseRenderer):
    media_type = "application/json"

    def render(self, request, data, *, response_status):
        return orjson.dumps(data, option=orjson.OPT_NON_STR_KEYS, default=_fallback_encoder.default)
