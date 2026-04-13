export type PanelType = "admin" | "tournament" | "team";

export interface PanelDataChangeEvent {
  reason: string;
  guildId?: string;
  tournamentInstanceId?: number;
  teamId?: number;
  panelTypes?: PanelType[];
}

type PanelDataChangeListener = (event: PanelDataChangeEvent) => void;

const listeners = new Set<PanelDataChangeListener>();

export function onPanelDataChanged(listener: PanelDataChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyPanelDataChanged(event: PanelDataChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("[panel-refresh-bus] listener failed", error);
    }
  }
}
