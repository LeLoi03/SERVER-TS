// /**
//  * Generates a unique message ID.
//  * Combines timestamp and a random alphanumeric string for better uniqueness.
//  * @returns {string} A unique message ID string.
//  */
// export const generateMessageId = (): string =>
//     `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// /**
//  * Constructs the full URL for internal navigation, considering the current locale.
//  * This ensures URLs are correctly prefixed with the locale if one is provided.
//  *
//  * @param {string} baseUrl - The base web URL (e.g., `http://localhost:8386`).
//  * @param {string} locale - The current language locale (e.g., 'en', 'vi'). Can be an empty string if no locale prefix is desired.
//  * @param {string} relativeUrl - The relative path (e.g., `/products/1`) OR a full URL (e.g., `https://example.com`).
//  * @returns {string} The full URL for navigation, correctly formatted with the locale.
//  */
// export const constructNavigationUrl = (baseUrl: string, locale: string, relativeUrl: string): string => {
//     console.log(`[constructNavigationUrl] Input - baseUrl: ${baseUrl}, locale: ${locale}, relativeUrl: ${relativeUrl}`); // Thêm log đầu vào

//     // 1. Kiểm tra nếu relativeUrl đã là một URL đầy đủ
//     if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
//         // Nếu đã là URL đầy đủ, trả về nguyên bản
//         console.log(`[constructNavigationUrl] Returning absolute URL directly: ${relativeUrl}`);
//         return relativeUrl; // <<< DÒNG NÀY QUAN TRỌNG
//     }

//     // 2. Xử lý đường dẫn tương đối (logic hiện tại của bạn)
//     console.log(`[constructNavigationUrl] Processing as relative URL.`); // Thêm log để biết nó vào nhánh nào
//     const cleanedRelativeUrl = relativeUrl.startsWith('/') ? relativeUrl.substring(1) : relativeUrl;
//     console.log(`[constructNavigationUrl] cleanedRelativeUrl: ${cleanedRelativeUrl}`);

//     const finalPath = locale ? `${locale}/${cleanedRelativeUrl}` : cleanedRelativeUrl;
//     console.log(`[constructNavigationUrl] finalPath: ${finalPath}`);

//     const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
//     console.log(`[constructNavigationUrl] base: ${base}`);

//     const fullUrl = `${base}/${finalPath}`;
//     console.log(`[constructNavigationUrl] Output - fullUrl (with locale): ${fullUrl}`);
//     return fullUrl;
// };

// /**
//  * Opens a given URL in a new browser tab safely.
//  * This function specifically checks if the `window` object is available (i.e., not in a server-side rendering environment).
//  * It uses `window.open` with recommended security attributes (`noopener`, `noreferrer`) to prevent tabnabbing.
//  *
//  * @param {string} url - The URL to be opened in a new tab.
//  */
// export const openUrlInNewTab = (url: string): void => {
//     if (typeof window !== 'undefined') {
//         console.log(`[ChatUtils] Attempting to open URL in new tab: ${url}`);
//         // `window.open` with '_blank' is the standard way to open in a new tab.
//         // `noopener` and `noreferrer` are crucial security features.
//         window.open(url, '_blank', 'noopener,noreferrer');
//     } else {
//         // Log a warning if attempting to open a URL in a non-browser environment.
//         console.warn("[ChatUtils] Cannot open URL: 'window' object not available. This function is intended for client-side execution (e.g., in a browser).");
//     }
// }