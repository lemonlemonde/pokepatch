# `discord-clamperl-hop`

Hop-only peer for [`discord-clamperl`](../discord-clamperl/README.md). Not a Discord interactions endpoint — `/clamperl` still points at `discord-clamperl`. Consecutive stitch/gallery hops ping-pong here so a spent isolate never handles the next heavy request.

`verify_jwt = false` is set in `supabase/config.toml`.
