/**
 * Generates a unique message ID.
 * Combines timestamp and a random alphanumeric string for better uniqueness.
 * @returns {string} A unique message ID string.
 */
export const generateMessageId = (): string =>
    `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/**
 * Constructs the full URL for internal navigation, considering the current locale.
 * This ensures URLs are correctly prefixed with the locale if one is provided.
 *
 * @param {string} baseUrl - The base web URL (e.g., `http://localhost:8386`).
 * @param {string} locale - The current language locale (e.g., 'en', 'vi'). Can be an empty string if no locale prefix is desired.
 * @param {string} relativeUrl - The relative path (e.g., `/products/1`). Must start with `/`.
 * @returns {string} The full URL for navigation, correctly formatted with the locale.
 */
export const constructNavigationUrl = (baseUrl: string, locale: string, relativeUrl: string): string => {
    // Ensure relativeUrl starts with '/'
    if (!relativeUrl.startsWith('/')) {
        // Log a warning or throw an error if relativeUrl is not valid, depending on strictness
        console.warn(`[ChatUtils] constructNavigationUrl received relativeUrl "${relativeUrl}" that does not start with '/'. Attempting to fix.`);
        relativeUrl = `/${relativeUrl}`; // Prepend '/' to make it a valid path
    }

    // Construct locale path, ensuring it's not empty or just a slash
    const localePath = locale ? `/${locale}` : '';

    // If the relativeUrl already starts with the localePath, avoid double-prefixing.
    // E.g., if locale is 'en' and relativeUrl is '/en/products/1', we don't want '/en/en/products/1'.
    if (localePath && relativeUrl.startsWith(localePath)) {
        return `${baseUrl}${relativeUrl}`;
    }

    // Otherwise, combine base URL, locale path, and relative URL.
    // Ensure no double slashes between baseUrl and localePath, or localePath and relativeUrl.
    // Use URL's internal logic or simple string concatenation assuming proper trimming/handling.
    // The current concatenation `baseUrl + localePath + relativeUrl` generally works
    // if `baseUrl` does not end with `/` and `localePath` starts with `/` (which it does here).
    return `${baseUrl}${localePath}${relativeUrl}`;
};

/**
 * Opens a given URL in a new browser tab safely.
 * This function specifically checks if the `window` object is available (i.e., not in a server-side rendering environment).
 * It uses `window.open` with recommended security attributes (`noopener`, `noreferrer`) to prevent tabnabbing.
 *
 * @param {string} url - The URL to be opened in a new tab.
 */
export const openUrlInNewTab = (url: string): void => {
    if (typeof window !== 'undefined') {
        console.log(`[ChatUtils] Attempting to open URL in new tab: ${url}`);
        // `window.open` with '_blank' is the standard way to open in a new tab.
        // `noopener` and `noreferrer` are crucial security features.
        window.open(url, '_blank', 'noopener,noreferrer');
    } else {
        // Log a warning if attempting to open a URL in a non-browser environment.
        console.warn("[ChatUtils] Cannot open URL: 'window' object not available. This function is intended for client-side execution (e.g., in a browser).");
    }
}