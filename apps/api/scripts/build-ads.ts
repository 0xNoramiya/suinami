/**
 * Suinami ad factory — generate short (10–15s) vertical video ads from AI sources
 * and render them with ffmpeg (HyperFrames can't render here: no headless browser
 * and the CLI/browser won't download at this connection speed).
 *
 * Per ad:  gpt-image-2 (2 images) → ElevenLabs TTS (VO) → ElevenLabs sound-generation
 * (BGM bed + SFX) → ffmpeg (Ken Burns pan + xfade + scrim + captions + audio mix) → MP4.
 *
 * Assets are cached on disk, so re-running only re-renders ffmpeg (no re-spend on APIs).
 * Run from repo root:  pnpm ads            (all)
 *                      pnpm ads a1 a3       (subset)
 */
import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
loadEnv({ path: resolve(REPO, ".env") });

const OPENAI = process.env.OPENAI_API_KEY ?? "";
const EL = process.env.ELEVENLABS_API_KEY ?? "";
const VOICES = {
  jpF: process.env.EL_VOICE_JP_F ?? "",
  jpM: process.env.EL_VOICE_JP_M ?? "",
  enM: process.env.EL_VOICE_EN_M ?? "",
  enF: process.env.EL_VOICE_EN_F ?? "",
} as const;

const OUT = "/tmp/suinami-ads";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

type Voice = keyof typeof VOICES;
interface Ad {
  id: string;
  voice: Voice;
  /** VO script (JP or EN per voice). */
  vo: string;
  /** Two gpt-image-2 prompts (hero → secondary). */
  images: [string, string];
  /** ElevenLabs sound-generation prompt for the ambient BGM bed. */
  bgm: string;
  /** ElevenLabs sound-generation prompt for a single SFX hit. */
  sfx: string;
  /** Burned-in caption (latin only — DejaVu has no CJK glyphs; JP stays VO-only). */
  title: string;
  subtitle: string;
  /** Accent for the subtitle (foam/aqua/coral/sui hex). */
  accent: string;
}

const ABYSS_LOOK =
  "Cinematic vertical 2:3 poster, deep-ocean abyssal aesthetic, near-black navy (#0A1428) to deep blue (#0E2A47), " +
  "bioluminescent aqua (#6FE6E1) and electric sui-blue (#4DA2FF) glows, volumetric god-rays through dark water, " +
  "fine particulate, high contrast, moody, premium, photoreal-meets-abstract, NO text, NO words, NO letters, NO watermark.";

const ADS: Ad[] = [
  {
    id: "a1",
    voice: "enF",
    vo: "Suinami. A wave of shorts — where every video rides the chain.",
    images: [
      `A single colossal glowing ocean wave cresting at night, translucent aqua and sui-blue light inside the curl, sea spray as glittering particles. ${ABYSS_LOOK}`,
      `Abstract ribbons of liquid light flowing downward like a vertical feed of waves through deep dark water, sense of endless scroll. ${ABYSS_LOOK}`,
    ],
    bgm: "dreamy weightless underwater ambient pad, slow swelling synth, deep sub hum, calm and cinematic, seamless",
    sfx: "smooth cinematic water whoosh with a soft sparkle tail",
    title: "suinami",
    subtitle: "a wave of shorts",
    accent: "0x6FE6E1",
  },
  {
    id: "a2",
    voice: "enM",
    vo: "Your videos live on Walrus — decentralized storage that never washes away.",
    images: [
      `Dozens of glowing translucent data orbs suspended in deep dark water like a vault of light, each orb holding luminous footage, connected by faint aqua threads. ${ABYSS_LOOK}`,
      `A luminous data-vault deep undersea, geometric glass blocks of teal light anchored to the seabed, protected and permanent. ${ABYSS_LOOK}`,
    ],
    bgm: "deep ambient drone, secure and vast, slow low pulse, distant sonar shimmer, cinematic underwater",
    sfx: "single clean sonar ping with long underwater reverb tail",
    title: "stored on Walrus",
    subtitle: "you own the blob",
    accent: "0x4DA2FF",
  },
  {
    id: "a3",
    voice: "jpF",
    vo: "波を贈ろう。さざ波から、津波まで。想いは、本物のSUIで届く。",
    images: [
      `A giant radiant tsunami wave rising in the dark, coins and droplets of pure light streaming up its face toward a creator silhouette, generous and emotional. ${ABYSS_LOOK}`,
      `Four ascending tiers of water from a tiny ripple to a towering wave, each glowing brighter, a gift rising through them. ${ABYSS_LOOK}`,
    ],
    bgm: "emotional cinematic ambient swell, gentle piano-like tones over deep water pad, building warmth, seamless",
    sfx: "large oceanic wave crash with a shimmering coin-sparkle tail",
    title: "send a tsunami",
    subtitle: "ripple to tsunami, real SUI",
    accent: "0xFF6B6B",
  },
  {
    id: "a4",
    voice: "enM",
    vo: "Climb the Tide Charts. The biggest waves rise to the very top.",
    images: [
      `Tall glowing columns of water rising at different heights like a podium bar chart made of luminous ocean, the tallest central column blazing aqua. ${ABYSS_LOOK}`,
      `A leaderboard rendered as cresting waves of light ranked by height in the deep dark sea, sense of competition and ascent. ${ABYSS_LOOK}`,
    ],
    bgm: "building triumphant ambient, rising arpeggio under deep pad, momentum and ascent, cinematic, seamless",
    sfx: "rising oceanic swell building to a bright crest",
    title: "the tide charts",
    subtitle: "rise to the top",
    accent: "0x6FE6E1",
  },
  {
    id: "a5",
    voice: "jpM",
    vo: "水の波に、乗れ。スイナミ。次の波は、君だ。",
    images: [
      `A lone luminous surfer silhouette riding the inside of a vast moonlit wave, trail of aqua light, serene and powerful, vertical. ${ABYSS_LOOK}`,
      `Calm moonlit open ocean at night with concentric glowing ripples spreading from a single point, infinite and inviting. ${ABYSS_LOOK}`,
    ],
    bgm: "serene meditative ambient, soft shimmering pad, slow gentle waves, spacious and calm, seamless",
    sfx: "gentle lapping water with a soft airy whoosh",
    title: "ride the wave",
    subtitle: "the next wave is you",
    accent: "0x4DA2FF",
  },
  {
    id: "a6",
    voice: "enF",
    vo: "Dive into Suinami. Your wallet is your key — and the water's warm.",
    images: [
      `First-person plunge descending into glowing deep blue water, shafts of aqua light from above, a luminous doorway of light waiting far below. ${ABYSS_LOOK}`,
      `A bright aqua portal of light glowing at the bottom of the dark ocean, streams of bubbles rising, welcoming and warm. ${ABYSS_LOOK}`,
    ],
    bgm: "inviting warm ambient, soft uplifting pad, gentle bubbles, cinematic underwater, seamless",
    sfx: "underwater dive plunge whoosh with rising bubbles",
    title: "dive in",
    subtitle: "connect and ride",
    accent: "0x6FE6E1",
  },
];

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let a = 1; a <= tries; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`   ⟳ ${label} attempt ${a}/${tries}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2500 * a));
    }
  }
  throw last;
}

async function genImage(prompt: string, outPath: string): Promise<void> {
  if (existsSync(outPath)) return;
  await withRetry(`image ${outPath.split("/").pop()}`, async () => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENAI}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1536", quality: "medium", n: 1 }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64_json in OpenAI response");
    writeFileSync(outPath, Buffer.from(b64, "base64"));
  });
}

async function genTTS(text: string, voiceId: string, outPath: string): Promise<void> {
  if (existsSync(outPath)) return;
  await withRetry(`tts ${outPath.split("/").pop()}`, async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": EL, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25 },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  });
}

async function genSound(text: string, seconds: number, outPath: string): Promise<void> {
  if (existsSync(outPath)) return;
  await withRetry(`sound ${outPath.split("/").pop()}`, async () => {
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: { "xi-api-key": EL, "content-type": "application/json" },
      body: JSON.stringify({ text, duration_seconds: Math.min(22, Math.max(1, seconds)), prompt_influence: 0.4 }),
    });
    if (!res.ok) throw new Error(`ElevenLabs SFX ${res.status}: ${(await res.text()).slice(0, 200)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  });
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

function alphaExpr(d: number): string {
  // fade in over 0.6s, hold, fade out over last 0.8s
  return `if(lt(t\\,0.6)\\,t/0.6\\,if(gt(t\\,${(d - 0.8).toFixed(2)})\\,max(0\\,(${d.toFixed(2)}-t)/0.8)\\,1))`;
}

async function render(ad: Ad, dir: string): Promise<string> {
  const out = `${dir}/${ad.id}.mp4`;
  const voDur = await probeDuration(`${dir}/vo.mp3`);
  const D = Math.min(15, Math.max(10.5, voDur + 1.9)); // VO + lead-in/out padding
  const XF = 0.9;
  const L = (D + XF) / 2; // each image clip length
  const OFF = L - XF; // xfade offset
  const Ls = L.toFixed(2);
  const ka = `scale=864:1536:force_original_aspect_ratio=increase,crop=864:1536`;
  const alpha = alphaExpr(D);

  const fc = [
    // Ken Burns pans (different direction per image), then xfade
    `[0:v]${ka},crop=720:1280:x='(864-720)*(t/${Ls})':y='(1536-1280)*0.5',fps=30,setsar=1[v0]`,
    `[1:v]${ka},crop=720:1280:x='(864-720)*(1-t/${Ls})':y='(1536-1280)*(t/${Ls})',fps=30,setsar=1[v1]`,
    `[v0][v1]xfade=transition=fade:duration=${XF}:offset=${OFF.toFixed(2)}[vx]`,
    // mood + legibility: vignette, full dim, bottom scrim
    `[vx]vignette=PI/5,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.16:t=fill,` +
      `drawbox=x=0:y=ih*0.50:w=iw:h=ih*0.50:color=black@0.20:t=fill,` +
      `drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.28:t=fill,` +
      `drawbox=x=0:y=ih*0.72:w=iw:h=ih*0.28:color=black@0.40:t=fill,` +
      `drawtext=fontfile=${FONT_BOLD}:text='${ad.title}':x=(w-text_w)/2:y=h*0.72:fontsize=78:fontcolor=0xEAF6FF:alpha='${alpha}':shadowcolor=black@0.6:shadowx=0:shadowy=3,` +
      `drawtext=fontfile=${FONT_REG}:text='${ad.subtitle}':x=(w-text_w)/2:y=h*0.72+104:fontsize=40:fontcolor=${ad.accent}:alpha='${alpha}'[vout]`,
    // audio: VO (delayed) + ducked BGM bed + one SFX hit, faded out
    `[2:a]volume=1.25,adelay=450|450[vo]`,
    `[3:a]volume=0.22,afade=t=in:st=0:d=1.2[bg]`,
    `[4:a]volume=0.55,adelay=150|150[sx]`,
    `[vo][bg][sx]amix=inputs=3:duration=longest:normalize=0,afade=t=out:st=${(D - 0.7).toFixed(2)}:d=0.7[a]`,
  ].join(";");

  await exec(
    "ffmpeg",
    [
      "-y",
      "-loop", "1", "-t", Ls, "-i", `${dir}/img0.png`,
      "-loop", "1", "-t", Ls, "-i", `${dir}/img1.png`,
      "-i", `${dir}/vo.mp3`,
      "-i", `${dir}/bgm.mp3`,
      "-i", `${dir}/sfx.mp3`,
      "-filter_complex", fc,
      "-map", "[vout]", "-map", "[a]",
      "-t", D.toFixed(2),
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
      out,
    ],
    { maxBuffer: 1 << 26 },
  );
  return out;
}

async function buildAd(ad: Ad): Promise<void> {
  const dir = `${OUT}/${ad.id}`;
  mkdirSync(dir, { recursive: true });
  console.log(`\n=== ${ad.id} (${ad.voice}) — "${ad.title}" ===`);
  console.log(`  • images (gpt-image-2) …`);
  await genImage(ad.images[0], `${dir}/img0.png`);
  await genImage(ad.images[1], `${dir}/img1.png`);
  console.log(`  • voiceover (ElevenLabs ${VOICES[ad.voice]}) …`);
  await genTTS(ad.vo, VOICES[ad.voice], `${dir}/vo.mp3`);
  const voDur = await probeDuration(`${dir}/vo.mp3`);
  console.log(`    vo = ${voDur.toFixed(1)}s`);
  console.log(`  • bgm + sfx (ElevenLabs sound-generation) …`);
  await genSound(ad.bgm, Math.ceil(voDur + 2), `${dir}/bgm.mp3`);
  await genSound(ad.sfx, 3, `${dir}/sfx.mp3`);
  console.log(`  • rendering with ffmpeg …`);
  const out = await render(ad, dir);
  const d = await probeDuration(out);
  console.log(`  ✓ ${out} (${d.toFixed(1)}s)`);
}

async function main(): Promise<void> {
  if (!OPENAI || !EL) {
    console.error("✗ OPENAI_API_KEY / ELEVENLABS_API_KEY missing in .env");
    process.exit(1);
  }
  const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
  const ads = wanted.length ? ADS.filter((a) => wanted.includes(a.id)) : ADS;
  if (!ads.length) {
    console.error(`✗ no matching ads. ids: ${ADS.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`building ${ads.length} ad(s): ${ads.map((a) => a.id).join(", ")}`);
  for (const ad of ads) await buildAd(ad);
  console.log(`\n✓ done. outputs in ${OUT}/<id>/<id>.mp4`);
}

main().catch((e: unknown) => {
  console.error("✗ build-ads failed:", e);
  process.exit(1);
});
