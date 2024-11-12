import { app } from "electron";
import { getSettings, saveSettings } from "../domain/settings";
import { IpcInterface } from "./ipc-connector";
import axios from "axios";
import { RemoteWhisperConfig } from "../../types";

export const mainApi: IpcInterface = {
  getSettings: async () => {
    return await getSettings();
  },
  saveSettings: async (payload) => {
    await saveSettings(payload);
  },
  testRemoteWhisperConnection: async (config: RemoteWhisperConfig) => {
    try {
      const response = await axios.post(config.serverUrl, new ArrayBuffer(0), {
        headers: {
          "Content-Type": "audio/wav",
          Authorization: config.authToken ? `Bearer ${config.authToken}` : undefined,
        },
        timeout: config.timeout,
      });
      return response.status === 200;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Remote Whisper server error: ${error.message}`);
      } else {
        throw new Error("Unexpected error occurred while testing remote Whisper server connection");
      }
    }
  },
};
