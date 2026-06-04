# Move functions

All entry functions in `suinami::feed`. The package id is injected at call time; the module
name is `feed` and the call target is `${PACKAGE_ID}::feed::<function>`. Move call targets and
event names are centralized in `@suinami/shared` (`MOVE`, `MOVE_EVENTS`) so the on‑chain model,
API, and UI never drift.

## Profiles

### `create_profile`

```move
public entry fun create_profile(
    handle: String,
    display_name: String,
    avatar_blob: String,   // Walrus blob id of the avatar image
    bio: String,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Creates and **shares** a `Profile` for the sender, then emits `ProfileCreated`. `avatar_blob`
is a Walrus pointer.

### `update_profile`

```move
public entry fun update_profile(
    profile: &mut Profile,
    display_name: String,
    avatar_blob: String,
    bio: String,
    ctx: &mut TxContext,
)
```

Updates the mutable fields. Aborts with `ENotProfileOwner` unless `sender == profile.owner`.

## Videos

### `post_video`

```move
public entry fun post_video(
    feed: &mut Feed,
    blob_id: String,       // Walrus content id of the video bytes
    poster_blob: String,   // Walrus content id of the poster frame
    caption: String,
    duration_ms: u64,
    width: u16,
    height: u16,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Builds and **shares** a `Video` (holding only the Walrus pointers + zeroed counters), bumps
`feed.video_count`, and emits `VideoPosted` with the pointers carried inline. → [Posting flow](../architecture/posting.md)

### `like_video` / `unlike_video`

```move
public entry fun like_video(video: &mut Video, ctx: &mut TxContext)
public entry fun unlike_video(video: &mut Video, like: Like, ctx: &mut TxContext)
```

`like_video` mints a `Like` to the sender, increments `video.like_count`, and emits
`VideoLiked`. `unlike_video` burns the caller's `Like` (aborts `ELikeVideoMismatch` if it
doesn't reference this video), decrements the counter, and emits `VideoUnliked`.

### `record_view`

```move
public entry fun record_view(video: &mut Video)
```

Permissionless, best‑effort view counter — no signer check, so a public read path can bump it.
Emits `VideoViewed`.

## Gifts

### `send_gift`

```move
public entry fun send_gift(
    video: &mut Video,
    creator_profile: &mut Profile,
    payment: Coin<SUI>,
    tier: u8,              // 0..=3
    clock: &Clock,
    ctx: &mut TxContext,
)
```

The value‑transfer path. In one call it:

1. Resolves the tier floor and asserts `coin::value(payment) >= floor` (`EInsufficientGift`).
2. Asserts `creator_profile.owner == video.creator` (`EProfileVideoMismatch`).
3. `public_transfer`s the **full** coin to the creator.
4. Increments `video.tip_total` and `creator_profile.total_tips_received`.
5. Mints a `GiftReceipt` to the tipper.
6. Emits `GiftSent` carrying both running totals.

See [gift tiers](gifts.md) for floor prices and [the gifting flow](../architecture/gifting.md)
for the end‑to‑end sequence.

## Calling from TypeScript

Transaction builders live in `@suinami/sui` (`tx.ts`); they assemble the `Transaction`, and the
wallet signs + executes it **through Tatum**. Because of a gateway gap, gas is resolved
explicitly rather than via the SDK's default path — see [Tatum](../tatum.md).
