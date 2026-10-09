# Provider Chain & Fallback

The Mission Barisal gateway server side (the 7-agent server) uses a provider
chain so that if one inference provider is rate-limited or down, the next one
takes over automatically.

## Priority order (server-side)

| Priority | Provider    | Notes                                                          |
| -------- | ----------- | -------------------------------------------------------------- |
| 1        | opencode    | Primary; subject to per-IP rate limits.                        |
| 2        | groq        | Secondary; OpenAI-compatible, model-masked.                    |
| 3        | gemini      | Tertiary; non-OpenAI format, normalized by the gateway.        |
| 4        | WorldBusiness | Custom provider via env vars (priority configurable).        |

Custom providers are configured via environment variables:

```
CUSTOM_PROVIDER_N_NAME
CUSTOM_PROVIDER_N_URL
CUSTOM_PROVIDER_N_KEY
CUSTOM_PROVIDER_N_MODELS
CUSTOM_PROVIDER_N_PRIORITY   # lower number = higher priority (default 10)
CUSTOM_PROVIDER_N_TYPE       # "openai" (default) or "gemini"
```

## Rate-limit reality check

- Rate limits are **per-IP**, not per-API-key.
- The **server** makes the API calls, so providers see the server's IP.
- Multiple keys from the same IP share the same rate-limit bucket.
- Spreading load across machines (different public IPs) gives separate buckets.

## Fallback strategies

1. **IP rotation** — route outbound calls through a proxy pool.
2. **Multi-server load balancing** — use `m.skilltoearn.org` as a provider proxy
   (different IP = different bucket).
3. **Request queuing** — insert delays to stay under limits.
4. **Smart provider rotation** — skip rate-limited providers, weight by availability.

## Client-side fallback (this extension)

On the extension side, the fallback is per-request: if an empty response is
returned while tool calling is enabled (70+ tools can overwhelm small models),
the request is retried **once without tools** before showing a diagnostic.
