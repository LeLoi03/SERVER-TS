// src/utils/crawl/url.utils.ts
import { URL } from 'url';
import { Logger } from 'pino'; // Keep Pino Logger type
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

/**
 * Normalizes a URL or joins a potentially relative link with a base URL.
 * Uses the native URL constructor for robustness.
 * Handles various scenarios: absolute links, relative links with base, and invalid inputs.
 *
 * @param {string | undefined | null} baseUrl - The base URL to resolve relative links against. Can be undefined or null.
 * @param {string | undefined | null} link - The link to normalize or join. Can be undefined, null, or "none".
 * @param {Logger} [logger] - Optional Pino logger instance for warnings and errors.
 * @returns {string} The normalized and resolved URL as a string. Returns an empty string on failure or invalid input.
 */
export const normalizeAndJoinLink = (
    baseUrl: string | undefined | null,
    link: string | undefined | null,
    logger?: Logger
): string => {
    const logContext = '[URL Utility]';

    const trimmedLink = (typeof link === 'string' ? link.trim() : '');
    const trimmedBaseUrl = (typeof baseUrl === 'string' ? baseUrl.trim() : '');

    const wasLinkArgumentProvided = link !== null && link !== undefined;
    const isLinkEffectivelyEmpty = !trimmedLink || trimmedLink.toLowerCase() === "none";

    // Scenario 1: Link argument was explicitly provided but is empty or "none"
    if (wasLinkArgumentProvided && isLinkEffectivelyEmpty) {
        logger?.trace({ link, event: 'normalize_link_invalid_input', context: logContext }, "Link argument provided but is empty or 'none'. Returning empty string.");
        return "";
    }

    // Scenario 2: Link is an absolute URL (http(s)://, mailto:, tel:)
    if (!isLinkEffectivelyEmpty && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedLink)) {
        try {
            // Attempt to parse the absolute link to validate it
            new URL(trimmedLink);
            logger?.trace({ link: trimmedLink, event: 'normalize_link_is_absolute', context: logContext }, "Link is an absolute URL and valid. Returning as is.");
            return trimmedLink;
        } catch (e: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(e);
            logger?.warn({ link: trimmedLink, err: { message: errorMessage, stack: errorStack }, event: 'normalize_link_absolute_parse_failed', context: logContext }, `Absolute link parsing failed: "${errorMessage}". Returning empty string.`);
            return ""; // Return empty string if absolute link is malformed
        }
    }

    // Scenario 3: Link is relative, and a valid base URL is available
    if (!isLinkEffectivelyEmpty && trimmedBaseUrl && /^https?:\/\//i.test(trimmedBaseUrl)) {
        try {
            // Attempt to resolve the relative link against the base URL
            const base = new URL(trimmedBaseUrl);
            const resolvedUrl = new URL(trimmedLink, base);
            logger?.trace({ base: trimmedBaseUrl, link: trimmedLink, resolved: resolvedUrl.toString(), event: 'normalize_link_joined', context: logContext }, `Relative link resolved successfully: ${resolvedUrl.toString()}.`);
            return resolvedUrl.toString();
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger?.error({ base: trimmedBaseUrl, link: trimmedLink, err: { message: errorMessage, stack: errorStack }, event: 'normalize_link_join_failed', context: logContext }, `Failed to join relative link with base URL: "${errorMessage}". Returning empty string.`);
            return ""; // Return empty string on resolution failure
        }
    }

    // Scenario 4: Only a base URL was provided (link is empty/null/undefined), try to normalize the base itself
    if (!wasLinkArgumentProvided && trimmedBaseUrl && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedBaseUrl)) {
        try {
            // Attempt to parse the base URL to validate it
            new URL(trimmedBaseUrl);
            logger?.trace({ base: trimmedBaseUrl, event: 'normalize_base_url', context: logContext }, "Only base URL provided and valid. Returning base URL.");
            return trimmedBaseUrl;
        } catch (e: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(e);
            logger?.warn({ base: trimmedBaseUrl, err: { message: errorMessage, stack: errorStack }, event: 'normalize_base_url_parse_failed', context: logContext }, `Base URL parsing failed: "${errorMessage}". Returning empty string.`);
            return ""; // Return empty string if base URL is malformed
        }
    }

    // Scenario 5: Edge cases or invalid combinations
    if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && !trimmedBaseUrl) {
         logger?.warn({ link: trimmedLink, event: 'normalize_link_relative_no_base', context: logContext }, "Relative link provided but no valid base URL. Cannot resolve. Returning empty string.");
    } else if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) {
         logger?.warn({ link: trimmedLink, base: trimmedBaseUrl, event: 'normalize_link_relative_bad_base', context: logContext }, "Relative link provided with invalid base URL (not http/https). Cannot resolve. Returning empty string.");
    }

    // Fallback: If none of the above scenarios resulted in a valid URL, return empty string.
    logger?.trace({ link, baseUrl, event: 'normalize_link_no_valid_url', context: logContext }, "No valid URL could be determined from provided link and base URL. Returning empty string.");
    return "";
};