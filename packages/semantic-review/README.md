# @design-warden/semantic-review

Part of [Design Warden](https://www.npmjs.com/package/design-warden), which checks frontend pull requests against a design-system policy. Install `design-warden` for the command line; you rarely need this package directly.

This package runs the optional AI design review: the Anthropic SDK, any OpenAI-compatible endpoint (including a local Ollama), or a recorded replay. It is the only code that calls a model provider, and it runs only when asked (`--semantic`). Model output is parsed as data, its citations are verified against the files it was shown, and its findings are capped at "review": they can never fail a build.

MIT licensed.
