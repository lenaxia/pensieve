import path from "path";
import log from "electron-log/main";
import axios from "axios";
import {
  buildArgs,
  getExtraResourcesFolder,
  getMillisecondsFromTimeString,
} from "../../main-utils";
import { getModelPath } from "./models";
import * as ffmpeg from "./ffmpeg";
import * as runner from "./runner";
import * as postprocess from "./postprocess";
import { getSettings } from "./settings";

const whisperPath = path.join(getExtraResourcesFolder(), "whisper.exe");

const sendToRemoteWhisper = async (
  wavFile: string,
  remoteConfig: RemoteWhisperConfig,
) => {
  try {
    const wavData = await fs.promises.readFile(wavFile);
    const response = await axios.post(remoteConfig.serverUrl, wavData, {
      headers: {
        "Content-Type": "audio/wav",
        Authorization: remoteConfig.authToken ? `Bearer ${remoteConfig.authToken}` : undefined,
      },
      timeout: remoteConfig.timeout,
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      log.error("Error sending request to remote Whisper server:", error.message);
      throw new Error(`Remote Whisper server error: ${error.message}`);
    } else {
      log.error("Unexpected error:", error);
      throw new Error("Unexpected error occurred while sending request to remote Whisper server");
    }
  }
};

export const processWavFile = async (
  input: string,
  output: string,
  modelId: string,
  useRemoteWhisper: boolean,
) => {
  postprocess.setStep("whisper");

  const out = path.join(
    path.dirname(output),
    path.basename(output, path.extname(output)),
  );
  const inputTime = await ffmpeg.getDuration(input);

  if (useRemoteWhisper) {
    const { remoteWhisper } = await getSettings();
    if (!remoteWhisper) {
      throw new Error("Remote Whisper configuration is missing");
    }

    const transcriptionResult = await sendToRemoteWhisper(input, remoteWhisper);
    // Process the transcription result from the remote server
    // ...

    return;
  }

  const settings = (await getSettings()).whisper;
  const args = buildArgs({
    _0: input,
    t: settings.threads,
    p: settings.processors,
    mc: settings.maxContext,
    ml: settings.maxLen,
    sow: settings.splitOnWord,
    bo: settings.bestOf,
    bs: settings.beamSize,
    ac: settings.audioCtx,
    wt: settings.wordThold,
    et: settings.entropyThold,
    lpt: settings.logprobThold,
    tr: settings.translate,
    di: settings.diarize,
    nf: settings.noFallback,
    l: settings.language,
    oj: true,
    of: out,
    m: getModelPath(modelId),
  });

  log.info("Processing wav file", whisperPath, args);

  const process = runner.execute(whisperPath, args);
  process.stdout?.on("data", (data) => {
    const line = data.toString();
    const match = line.matchAll(
      /\[\d{2}:\d{2}:\d{2}\.\d{3} --> (\d{2}:\d{2}:\d{2}\.\d{3})\]/g,
    );
    const time = Array.from(match).map((m: any) => m[1]);
    const duration = getMillisecondsFromTimeString(time[0]);
    if (duration > 0) {
      postprocess.setProgress("whisper", duration / inputTime);
    }
  });
  await process;
  log.info("Processed Wav File");
};
