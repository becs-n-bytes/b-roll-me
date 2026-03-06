import { Innertube, ProtoUtils, Utils } from "youtubei.js";
import { BG } from "bgutils-js";
import { fetch } from "@tauri-apps/plugin-http";

let instance: Innertube | null = null;

function createYouTubeFetch(): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", "https://www.youtube.com");
    headers.set("Referer", "https://www.youtube.com/");
    return fetch(input as Parameters<typeof fetch>[0], { ...init, headers });
  }) as unknown as typeof globalThis.fetch;
}

async function generatePoToken(visitorData: string): Promise<string | undefined> {
  const requestKey = "O43z0dpjhgX20SCx4KAo";

  const bgConfig = {
    fetch: createYouTubeFetch(),
    globalObj: globalThis as Record<string, unknown>,
    requestKey,
    identifier: visitorData,
  };

  const bgChallenge = await BG.Challenge.create(bgConfig);
  if (!bgChallenge) return undefined;

  const interpreterJs =
    bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreterJs) return undefined;

  new Function(interpreterJs)();

  const result = await BG.PoToken.generate({
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    bgConfig,
  });

  return result.poToken;
}

export async function getInnertube(): Promise<Innertube> {
  if (!instance) {
    const visitorData = ProtoUtils.encodeVisitorData(
      Utils.generateRandomString(11),
      Math.floor(Date.now() / 1000)
    );

    let poToken: string | undefined;

    try {
      poToken = await generatePoToken(visitorData);
    } catch {
      // BotGuard challenge failed; fall back to placeholder token
    }

    instance = await Innertube.create({
      po_token: poToken || BG.PoToken.generatePlaceholder(visitorData),
      visitor_data: visitorData,
      generate_session_locally: true,
      retrieve_player: false,
      fetch: createYouTubeFetch(),
    });
  }
  return instance;
}
