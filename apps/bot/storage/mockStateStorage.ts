import fs from "fs";
import path from "path";

const dataDirectory = path.resolve(process.cwd(), "data");

function ensureDataDirectory() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
}

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}

export function loadStoredState<T>(filename: string, defaultState: T): T {
  ensureDataDirectory();

  const filePath = path.join(dataDirectory, filename);

  if (!fs.existsSync(filePath)) {
    const initialState = cloneState(defaultState);
    fs.writeFileSync(filePath, JSON.stringify(initialState, null, 2));
    return initialState;
  }

  try {
    const storedContents = fs.readFileSync(filePath, "utf8");
    const parsedState = JSON.parse(storedContents) as Partial<T>;

    if (
      parsedState &&
      typeof parsedState === "object" &&
      defaultState &&
      typeof defaultState === "object"
    ) {
      return {
        ...cloneState(defaultState),
        ...parsedState,
      };
    }

    return parsedState as T;
  } catch {
    const fallbackState = cloneState(defaultState);
    fs.writeFileSync(filePath, JSON.stringify(fallbackState, null, 2));
    return fallbackState;
  }
}

export function saveStoredState<T>(filename: string, state: T) {
  ensureDataDirectory();

  const filePath = path.join(dataDirectory, filename);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}
