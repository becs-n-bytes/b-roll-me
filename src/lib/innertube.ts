import { Innertube } from "youtubei.js";
import { fetch } from "@tauri-apps/plugin-http";

let instance: Innertube | null = null;

export async function getInnertube(): Promise<Innertube> {
  if (!instance) {
    instance = await Innertube.create({
      generate_session_locally: true,
      retrieve_player: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
  }
  return instance;
}
