// =====================================================================
// Suinami — on-chain feed module (Sui Move 2024).
//
// This is §4 of the spec: the social graph + gifting layer for a
// vertical short-video app. Videos themselves are NOT stored on chain —
// they are uploaded to Walrus, and only their content-addressed
// `blob_id` (and a poster-frame `poster_blob`) are recorded here.
//
//   >>> WALRUS <-> SUI BRIDGE <<<
//   The ENTIRE link between Walrus storage and the Sui object graph is
//   the `blob_id` / `poster_blob` Strings on `Video`. The client uploads
//   bytes to a Walrus publisher, gets back a blob id, then calls
//   `post_video` with that id. To play a video the client resolves
//   `${aggregatorUrl}/v1/blobs/${blob_id}`. There is no other coupling.
// =====================================================================
module suinami::feed;

use std::string::String;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::sui::SUI;
use sui::transfer;
use sui::tx_context::{Self, TxContext};

// --- Abort error constants -------------------------------------------
/// Gift payment was below the selected tier's floor price.
const EInsufficientGift: u64 = 0;
/// `tier` argument was not one of 0..=3.
const EBadTier: u64 = 1;
/// Caller is not the owner of the Profile they tried to mutate.
const ENotProfileOwner: u64 = 2;
/// The supplied `creator_profile` does not belong to the video's creator.
const EProfileVideoMismatch: u64 = 3;
/// The `Like` being burned does not belong to the supplied `Video`.
const ELikeVideoMismatch: u64 = 4;

// --- Gift tier floor prices (MIST) -----------------------------------
// Mirrors GIFT_TIERS in @suinami/shared. Keep these in sync.
const TIER0_RIPPLE_MIST: u64 = 10_000_000;       // 0.01 SUI
const TIER1_SPLASH_MIST: u64 = 100_000_000;      // 0.1  SUI
const TIER2_WAVE_MIST: u64 = 500_000_000;        // 0.5  SUI
const TIER3_TSUNAMI_MIST: u64 = 1_000_000_000;   // 1.0  SUI

// =====================================================================
// Objects
// =====================================================================

/// A creator profile. SHARED so anyone can read it and creators can be
/// tipped by referencing it in `send_gift`.
public struct Profile has key {
    id: UID,
    owner: address,
    handle: String,
    display_name: String,
    /// Walrus blob id of the avatar image (see WALRUS<->SUI BRIDGE above).
    avatar_blob: String,
    bio: String,
    video_count: u64,
    total_tips_received: u64,
    total_likes_received: u64,
    created_at_ms: u64,
}

/// A posted video. SHARED (and `store`-able) so any fan can like / view /
/// gift it. Holds NO bytes — only the Walrus pointers + social counters.
public struct Video has key, store {
    id: UID,
    creator: address,
    // >>> WALRUS <-> SUI BRIDGE <<<
    // `blob_id` is the Walrus content id of the actual video bytes.
    // `poster_blob` is the Walrus content id of the still poster frame.
    // These two Strings are the only connection between this Sui object
    // and the media living on Walrus. Resolve via the aggregator URL.
    blob_id: String,
    poster_blob: String,
    caption: String,
    duration_ms: u64,
    width: u16,
    height: u16,
    like_count: u64,
    view_count: u64,
    tip_total: u64,
    created_at_ms: u64,
}

/// Singleton registry created in `init`. SHARED. Tracks how many videos
/// have ever been posted (cheap global counter / discovery anchor).
public struct Feed has key {
    id: UID,
    video_count: u64,
}

/// Proof-of-like object held by a fan. Burning it (unlike) decrements the
/// video's like counter. One per (fan, video) by client convention.
public struct Like has key {
    id: UID,
    video_id: ID,
    fan: address,
}

/// Receipt minted to a tipper recording a gift. `store` so it can live in
/// collections / be displayed in wallets.
public struct GiftReceipt has key, store {
    id: UID,
    video_id: ID,
    from: address,
    to: address,
    amount_mist: u64,
    tier: u8,
    sent_at_ms: u64,
}

// =====================================================================
// Events (copy, drop) — indexed off-chain to build the feed/leaderboards.
// =====================================================================

public struct VideoPosted has copy, drop {
    video_id: ID,
    creator: address,
    // Walrus pointers carried in the event so the indexer never needs to
    // re-read the object to build a playable FeedCard.
    blob_id: String,
    poster_blob: String,
    caption: String,
    created_at_ms: u64,
}

public struct VideoLiked has copy, drop {
    video_id: ID,
    fan: address,
    new_count: u64,
}

public struct VideoUnliked has copy, drop {
    video_id: ID,
    fan: address,
    new_count: u64,
}

public struct VideoViewed has copy, drop {
    video_id: ID,
    new_count: u64,
}

public struct ProfileCreated has copy, drop {
    profile_id: ID,
    owner: address,
    handle: String,
}

public struct GiftSent has copy, drop {
    video_id: ID,
    from: address,
    to: address,
    amount_mist: u64,
    tier: u8,
    video_tip_total: u64,
    creator_tip_total: u64,
    sent_at_ms: u64,
}

// =====================================================================
// Init — create + share the singleton Feed registry.
// =====================================================================

fun init(ctx: &mut TxContext) {
    let feed = Feed {
        id: object::new(ctx),
        video_count: 0,
    };
    // SHARED so any account can post into it concurrently.
    transfer::share_object(feed);
}

// =====================================================================
// Profiles
// =====================================================================

/// Create + share a new Profile for the sender and emit `ProfileCreated`.
public entry fun create_profile(
    handle: String,
    display_name: String,
    avatar_blob: String, // Walrus blob id of the avatar image.
    bio: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let owner = tx_context::sender(ctx);
    let profile = Profile {
        id: object::new(ctx),
        owner,
        handle,
        display_name,
        avatar_blob,
        bio,
        video_count: 0,
        total_tips_received: 0,
        total_likes_received: 0,
        created_at_ms: clock::timestamp_ms(clock),
    };
    let profile_id = object::id(&profile);
    event::emit(ProfileCreated { profile_id, owner, handle });
    transfer::share_object(profile);
}

/// Update mutable Profile fields. Only the owner may call.
public entry fun update_profile(
    profile: &mut Profile,
    display_name: String,
    avatar_blob: String, // Walrus blob id of the new avatar image.
    bio: String,
    ctx: &mut TxContext,
) {
    assert!(tx_context::sender(ctx) == profile.owner, ENotProfileOwner);
    profile.display_name = display_name;
    profile.avatar_blob = avatar_blob;
    profile.bio = bio;
}

// =====================================================================
// Videos
// =====================================================================

/// Post a video: build + share a `Video`, bump the registry, emit event.
///
/// `blob_id` / `poster_blob` are Walrus content ids — see the
/// WALRUS<->SUI BRIDGE comment at the top of this file. They are the only
/// link from this on-chain object to the media bytes on Walrus.
public entry fun post_video(
    feed: &mut Feed,
    blob_id: String,
    poster_blob: String,
    caption: String,
    duration_ms: u64,
    width: u16,
    height: u16,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = tx_context::sender(ctx);
    let created_at_ms = clock::timestamp_ms(clock);
    let video = Video {
        id: object::new(ctx),
        creator,
        blob_id,
        poster_blob,
        caption,
        duration_ms,
        width,
        height,
        like_count: 0,
        view_count: 0,
        tip_total: 0,
        created_at_ms,
    };
    let video_id = object::id(&video);

    feed.video_count = feed.video_count + 1;

    event::emit(VideoPosted {
        video_id,
        creator,
        blob_id,
        poster_blob,
        caption,
        created_at_ms,
    });

    // SHARED so any fan can like / view / gift it.
    transfer::share_object(video);
}

/// Like a video: mint a `Like` to the sender, bump the counter, emit event.
public entry fun like_video(video: &mut Video, ctx: &mut TxContext) {
    let fan = tx_context::sender(ctx);
    let video_id = object::id(video);

    video.like_count = video.like_count + 1;

    let like = Like {
        id: object::new(ctx),
        video_id,
        fan,
    };

    event::emit(VideoLiked { video_id, fan, new_count: video.like_count });

    transfer::transfer(like, fan);
}

/// Unlike a video: burn the caller's `Like` and decrement the counter.
/// Aborts if the `Like` does not reference this `Video`.
public entry fun unlike_video(video: &mut Video, like: Like, ctx: &mut TxContext) {
    let video_id = object::id(video);
    assert!(like.video_id == video_id, ELikeVideoMismatch);

    let fan = tx_context::sender(ctx);

    // Destructure + delete the Like object.
    let Like { id, video_id: _, fan: _ } = like;
    object::delete(id);

    // Saturating-ish: like_count is always >= number of live Likes.
    video.like_count = video.like_count - 1;

    event::emit(VideoUnliked { video_id, fan, new_count: video.like_count });
}

/// Record a view. Best-effort, permissionless — no signer checks so a
/// public read path can bump it. (`&mut Video` is the shared object.)
public entry fun record_view(video: &mut Video) {
    video.view_count = video.view_count + 1;
    event::emit(VideoViewed {
        video_id: object::id(video),
        new_count: video.view_count,
    });
}

// =====================================================================
// Gifts
// =====================================================================

/// Resolve a tier id (0..=3) to its floor price in MIST; abort on bad tier.
fun tier_floor_mist(tier: u8): u64 {
    if (tier == 0) { TIER0_RIPPLE_MIST }
    else if (tier == 1) { TIER1_SPLASH_MIST }
    else if (tier == 2) { TIER2_WAVE_MIST }
    else if (tier == 3) { TIER3_TSUNAMI_MIST }
    else { abort EBadTier }
}

/// Send a gift (tip) to a video's creator.
///
/// - `payment` must satisfy the selected tier's floor price.
/// - `creator_profile` must belong to the video's creator (kept in sync so
///   the indexer can read aggregate tips from either object/event).
/// - The full coin is transferred to the creator; running totals on both
///   the `Video` and the `Profile` are bumped; a `GiftReceipt` is minted to
///   the sender; a `GiftSent` event carrying both totals is emitted.
public entry fun send_gift(
    video: &mut Video,
    creator_profile: &mut Profile,
    payment: Coin<SUI>,
    tier: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let floor = tier_floor_mist(tier);
    let amount = coin::value(&payment);
    assert!(amount >= floor, EInsufficientGift);
    assert!(creator_profile.owner == video.creator, EProfileVideoMismatch);

    let from = tx_context::sender(ctx);
    let to = video.creator;
    let video_id = object::id(video);
    let sent_at_ms = clock::timestamp_ms(clock);

    // Pay the creator the full amount.
    transfer::public_transfer(payment, to);

    // Bump running totals on both objects.
    video.tip_total = video.tip_total + amount;
    creator_profile.total_tips_received = creator_profile.total_tips_received + amount;

    // Mint a receipt to the tipper.
    let receipt = GiftReceipt {
        id: object::new(ctx),
        video_id,
        from,
        to,
        amount_mist: amount,
        tier,
        sent_at_ms,
    };
    transfer::public_transfer(receipt, from);

    event::emit(GiftSent {
        video_id,
        from,
        to,
        amount_mist: amount,
        tier,
        video_tip_total: video.tip_total,
        creator_tip_total: creator_profile.total_tips_received,
        sent_at_ms,
    });
}

// =====================================================================
// Tests
// =====================================================================

#[test_only]
use sui::test_scenario as ts;
#[test_only]
use std::string;

#[test_only]
const CREATOR: address = @0xCAFE;
#[test_only]
const FAN: address = @0xBEEF;

#[test]
fun test_post_like_unlike_view() {
    let mut scenario = ts::begin(CREATOR);
    {
        init(ts::ctx(&mut scenario));
    };

    // Post a video into the shared Feed.
    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut feed = ts::take_shared<Feed>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        post_video(
            &mut feed,
            string::utf8(b"blob_video_1"),
            string::utf8(b"blob_poster_1"),
            string::utf8(b"hello suinami"),
            15_000,
            1080,
            1920,
            &clock,
            ts::ctx(&mut scenario),
        );
        assert!(feed.video_count == 1, 100);
        clock::destroy_for_testing(clock);
        ts::return_shared(feed);
    };

    // Fan likes it.
    ts::next_tx(&mut scenario, FAN);
    {
        let mut video = ts::take_shared<Video>(&scenario);
        like_video(&mut video, ts::ctx(&mut scenario));
        assert!(video.like_count == 1, 101);
        record_view(&mut video);
        assert!(video.view_count == 1, 102);
        ts::return_shared(video);
    };

    // Fan unlikes it (burns the Like).
    ts::next_tx(&mut scenario, FAN);
    {
        let mut video = ts::take_shared<Video>(&scenario);
        let like = ts::take_from_sender<Like>(&scenario);
        unlike_video(&mut video, like, ts::ctx(&mut scenario));
        assert!(video.like_count == 0, 103);
        ts::return_shared(video);
    };

    ts::end(scenario);
}

#[test]
fun test_create_and_gift() {
    let mut scenario = ts::begin(CREATOR);
    {
        init(ts::ctx(&mut scenario));
    };

    // Creator makes a profile.
    ts::next_tx(&mut scenario, CREATOR);
    {
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        create_profile(
            string::utf8(b"creator"),
            string::utf8(b"Creator One"),
            string::utf8(b"blob_avatar"),
            string::utf8(b"i make waves"),
            &clock,
            ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
    };

    // Creator posts a video.
    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut feed = ts::take_shared<Feed>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        post_video(
            &mut feed,
            string::utf8(b"blob_video"),
            string::utf8(b"blob_poster"),
            string::utf8(b"tip me"),
            10_000,
            720,
            1280,
            &clock,
            ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(feed);
    };

    // Fan gifts a tier-1 (0.1 SUI) tip.
    ts::next_tx(&mut scenario, FAN);
    {
        let mut video = ts::take_shared<Video>(&scenario);
        let mut profile = ts::take_shared<Profile>(&scenario);
        let payment = coin::mint_for_testing<SUI>(TIER1_SPLASH_MIST, ts::ctx(&mut scenario));
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        send_gift(&mut video, &mut profile, payment, 1, &clock, ts::ctx(&mut scenario));
        assert!(video.tip_total == TIER1_SPLASH_MIST, 200);
        assert!(profile.total_tips_received == TIER1_SPLASH_MIST, 201);
        clock::destroy_for_testing(clock);
        ts::return_shared(video);
        ts::return_shared(profile);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = EInsufficientGift)]
fun test_gift_below_floor_aborts() {
    let mut scenario = ts::begin(CREATOR);
    { init(ts::ctx(&mut scenario)); };

    ts::next_tx(&mut scenario, CREATOR);
    {
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        create_profile(
            string::utf8(b"creator"),
            string::utf8(b"Creator One"),
            string::utf8(b"blob_avatar"),
            string::utf8(b"bio"),
            &clock,
            ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
    };

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut feed = ts::take_shared<Feed>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        post_video(
            &mut feed,
            string::utf8(b"blob_video"),
            string::utf8(b"blob_poster"),
            string::utf8(b"tip me"),
            10_000,
            720,
            1280,
            &clock,
            ts::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        ts::return_shared(feed);
    };

    ts::next_tx(&mut scenario, FAN);
    {
        let mut video = ts::take_shared<Video>(&scenario);
        let mut profile = ts::take_shared<Profile>(&scenario);
        // 1 MIST is far below the tier-3 floor -> aborts.
        let payment = coin::mint_for_testing<SUI>(1, ts::ctx(&mut scenario));
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        send_gift(&mut video, &mut profile, payment, 3, &clock, ts::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        ts::return_shared(video);
        ts::return_shared(profile);
    };

    ts::end(scenario);
}
