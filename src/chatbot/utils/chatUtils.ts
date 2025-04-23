
/**
 * Generates a unique message ID.
 * Combines timestamp and random number for better uniqueness.
 */
export const generateMessageId = (): string =>
    `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  /**
   * Constructs the full URL for internal navigation, considering locale.
   * @param baseUrl The base web URL (e.g., http://localhost:8386)
   * @param locale The current language locale (e.g., 'en', 'vi')
   * @param relativeUrl The relative path from the backend (e.g., /products/1)
   * @returns The full URL for navigation.
   */
  export const constructNavigationUrl = (baseUrl: string, locale: string, relativeUrl: string): string => {
      if (relativeUrl.startsWith('/')) {
          // Ensure no double slashes if locale is empty or already included
          const localePath = locale ? `/${locale}` : '';
          // Avoid double slashes if relativeUrl starts with locale already
          if (relativeUrl.startsWith(localePath)) {
               return `${baseUrl}${relativeUrl}`;
          }
          return `${baseUrl}${localePath}${relativeUrl}`;
      }
      // Assume it's an absolute URL or handle other cases if needed
      return relativeUrl;
  };
  
  /**
   * Opens a URL in a new tab safely.
   * Uses window.open with security attributes.
   * Handles server-side rendering gracefully.
   * @param url The URL to open.
   */
  export const openUrlInNewTab = (url: string): void => {
       if (typeof window !== 'undefined') {
          console.log(`[ChatUtils] Navigating (window.open): ${url}`);
          // Using setTimeout helps ensure state updates might render first, though not guaranteed.
          // Consider if a more robust solution is needed for complex UI updates before navigation.
          // setTimeout(() => {
              window.open(url, '_blank', 'noopener,noreferrer');
          // }, 0);
      } else {
          console.warn("[ChatUtils] Cannot navigate: 'window' object not available (SSR?).");
      }
  }