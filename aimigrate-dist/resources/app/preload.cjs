const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aimigrate", {
  getSources: () => ipcRenderer.invoke("sources"),
  getTargets: () => ipcRenderer.invoke("targets"),
  getSessions: (source) => ipcRenderer.invoke("sessions", source),
  getSourceStatus: (source) => ipcRenderer.invoke("source-status", source),
  startLogin: (source) => ipcRenderer.invoke("login-start", { source }),
  getLoginStatus: () => ipcRenderer.invoke("login-status"),
  getHistory: (source, sessionPath) => ipcRenderer.invoke("history", { source, path: sessionPath }),
  plan: (body) => ipcRenderer.invoke("plan", body),
  startMigration: (body) => ipcRenderer.invoke("migration-start", body),
  getMigrationStatus: () => ipcRenderer.invoke("migration-status"),
  startArchive: (body) => ipcRenderer.invoke("archive-start", body),
  getArtifacts: () => ipcRenderer.invoke("artifacts"),
  getArtifactFile: (type, name) => ipcRenderer.invoke("artifact-file", { type, name }),
});
