// src/utils/url.utils.ts
import { URL } from 'url';
import { Logger } from 'pino'; // Optional: Pass logger for warnings

/**
 * Normalizes a URL or joins a potentially relative link with a base URL.
 * Uses URL constructor for robustness. Returns empty string on failure.
 */
export const normalizeAndJoinLink = (
    baseUrl: string | undefined | null,
    link: string | undefined | null,
    logger?: Logger // Optional logger for warnings
): string => {
    const trimmedLink = (typeof link === 'string' ? link.trim() : '');
    const trimmedBaseUrl = (typeof baseUrl === 'string' ? baseUrl.trim() : '');
    const wasLinkArgumentProvided = link !== null && link !== undefined;
    const isLinkEffectivelyEmpty = !trimmedLink || trimmedLink.toLowerCase() === "none";

    if (wasLinkArgumentProvided && isLinkEffectivelyEmpty) {
        logger?.trace({ link, event: 'normalize_link_invalid_input' }, "Link is explicitly invalid.");
        return "";
    }

    if (!isLinkEffectivelyEmpty && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedLink)) {
        try {
            new URL(trimmedLink);
            logger?.trace({ link: trimmedLink, event: 'normalize_link_is_absolute' });
            return trimmedLink;
        } catch (e) {
            logger?.warn({ link: trimmedLink, err: e, event: 'normalize_link_absolute_parse_failed' });
            return "";
        }
    }

    if (!isLinkEffectivelyEmpty && trimmedBaseUrl && /^https?:\/\//i.test(trimmedBaseUrl)) {
        try {
            const base = new URL(trimmedBaseUrl);
            const resolvedUrl = new URL(trimmedLink, base);
            logger?.trace({ base: trimmedBaseUrl, link: trimmedLink, resolved: resolvedUrl.toString(), event: 'normalize_link_joined' });
            return resolvedUrl.toString();
        } catch (error: unknown) {
            logger?.error({ base: trimmedBaseUrl, link: trimmedLink, err: error, event: 'normalize_link_join_failed' });
            return "";
        }
    }

     if (!wasLinkArgumentProvided && trimmedBaseUrl && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedBaseUrl)) {
         try {
            new URL(trimmedBaseUrl);
            logger?.trace({ base: trimmedBaseUrl, event: 'normalize_base_url' });
            return trimmedBaseUrl;
         } catch (e) {
             logger?.warn({ base: trimmedBaseUrl, err: e, event: 'normalize_base_url_parse_failed' });
             return "";
         }
    }

    if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && !trimmedBaseUrl) {
         logger?.warn({ link: trimmedLink, event: 'normalize_link_relative_no_base' });
    } else if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) {
         logger?.warn({ link: trimmedLink, base: trimmedBaseUrl, event: 'normalize_link_relative_bad_base' });
    }
    logger?.trace({ link, baseUrl, event: 'normalize_link_no_valid_url' });
    return "";
};