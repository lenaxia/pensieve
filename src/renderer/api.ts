import { RemoteWhisperConfig } from "./types";

export const mainApi = {
  getSettings: async () => {
    const response = await window.ipcApi.main.invoke({
      type: "getSettings",
    });
    return response;
  },
  saveSettings: async (settings: any) => {
    await window.ipcApi.main.invoke({
      type: "saveSettings",
      payload: settings,
    });
  },
  testRemoteWhisperConnection: async (config: RemoteWhisperConfig) => {
    const response = await window.ipcApi.main.invoke({
      type: "testRemoteWhisperConnection",
      payload: config,
    });
    return response;
  },
};

export const modelsApi = {
  listModels: async () => {
    const response = await window.ipcApi.models.invoke({
      type: "listModels",
    });
    return response;
  },
};
