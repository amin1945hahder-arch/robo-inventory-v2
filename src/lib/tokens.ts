/**
 * Device quick sign-in tokens.
 *
 * The raw 64-hex-char token is generated once per device and stored ONLY in
 * that browser's localStorage. The backend stores only its SHA-256 hash, so
 * the database holds no usable credential.
 */
export const DEVICE_TOKEN_KEY = "roboshelf.deviceToken";
export const DEVICE_ACCOUNT_KEY = "roboshelf.deviceAccount";

export type SavedAccount = {
  token: string;
  name: string;
  email: string;
  image?: string;
  role?: string;
  savedAt: number;
};

/** Read the saved account for THIS device (null when absent). useState-safe. */
export function getSavedAccount(): SavedAccount | null {
  try {
    const raw = localStorage.getItem(DEVICE_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedAccount;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: SavedAccount) {
  localStorage.setItem(DEVICE_ACCOUNT_KEY, JSON.stringify(account));
  localStorage.setItem(DEVICE_TOKEN_KEY, account.token);
}

export function clearSavedAccount() {
  localStorage.removeItem(DEVICE_ACCOUNT_KEY);
  localStorage.removeItem(DEVICE_TOKEN_KEY);
}
