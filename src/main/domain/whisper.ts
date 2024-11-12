import path from "path";
import log from "electron-log/main";
import axios from "axios";
import fs from "fs";
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
import { RecordingTranscript, RecordingTranscriptItem, RemoteWhisperConfig, Settings } from "../../types";

const whisperPath = path.join(getExtraResourcesFolder(), "whisper.exe");

const sendToRemoteWhisper = async (
  wavFile: string,
  remoteConfig: RemoteWhisperConfig,
  whisperConfig: Settings["whisper"]
): Promise<RecordingTranscript> => {
  try {
    const wavData = await fs.promises.readFile(wavFile);
    const requestPayload = {
      audio: wavData,
      options: {
        task: "transcribe",
        model: whisperConfig.model,
        language: whisperConfig.language,
        threads: whisperConfig.threads,
        processors: whisperConfig.processors,
        maxContext: whisperConfig.maxContext,
        maxLen: whisperConfig.maxLen,
        splitOnWord: whisperConfig.splitOnWord,
        bestOf: whisperConfig.bestOf,
        beamSize: whisperConfig.beamSize,
        audioCtx: whisperConfig.audioCtx,
        wordThold: whisperConfig.wordThold,
        entropyThold: whisperConfig.entropyThold,
        logprobThold: whisperConfig.logprobThold,
        translate: whisperConfig.translate,
        diarize: whisperConfig.diarize,
        noFallback: whisperConfig.noFallback,
      },
    };

    const response = await axios.post(remoteConfig.serverUrl, requestPayload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: remoteConfig.authToken ? `Bearer ${remoteConfig.authToken}` : undefined,
      },
      timeout: remoteConfig.timeout,
    });

    const transcriptionResult = response.data;
    const transcriptItems: RecordingTranscriptItem[] = transcriptionResult.segments.map(
      (segment: any) => ({
        timestamps: {
          from: segment.start,
          to: segment.end,
        },
        offsets: {
          from: segment.start_offset,
          to: segment.end_offset,
        },
        text: segment.text,
        speaker: segment.speaker,
      }),
    );

    const result: RecordingTranscript = {
      result: { language: transcriptionResult.language },
      transcription: transcriptItems,
    };

    return result;
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
): Promise<void> => {
  postprocess.setStep("whisper");

  const out = path.join(
    path.dirname(output),
    path.basename(output, path.extname(output)),
  );
  const inputTime = await ffmpeg.getDuration(input);

  if (useRemoteWhisper) {
    const { remoteWhisper, whisper } = await getSettings();
    if (!remoteWhisper) {
      throw new Error("Remote Whisper configuration is missing");
    }

    try {
      const transcriptionResult = await sendToRemoteWhisper(input, remoteWhisper, whisper);
      // Process the transcription result
      const transcriptItems = transcriptionResult.transcription;
      const totalDuration = Math.max(...transcriptItems.map(item => item.offsets.to));
      for (const item of transcriptItems) {
        const progress = item.offsets.to / totalDuration;
        postprocess.setProgress("whisper", progress);
      }

      return;
    } catch (error) {
      log.error("Error using remote Whisper server:", error);
      log.info("Falling back to local Whisper processing");
      postprocess.setError("whisper", "Error using remote Whisper server. Falling back to local processing.");
      // Fall back to local Whisper processing
    }
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
