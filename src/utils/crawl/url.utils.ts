// src/utils/crawl/url.utils.ts
import { URL } from 'url';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../errorUtils';

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

    if (wasLinkArgumentProvided && isLinkEffectivelyEmpty) {
        logger?.trace({ link, event: 'normalize_link_invalid_input', context: logContext }, "Link argument provided but is empty or 'none'. Returning empty string.");
        return "";
    }

    if (!isLinkEffectivelyEmpty && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedLink)) {
        try {
            // Đối với URL tuyệt đối, chỉ cần parse để xác thực và trả về chuỗi gốc
            const validatedUrl = new URL(trimmedLink);
            logger?.trace({ link: trimmedLink, event: 'normalize_link_is_absolute', context: logContext }, "Link is an absolute URL and valid. Returning as is.");
            // TRẢ VỀ CHUỖI GỐC ĐÃ TRIM, KHÔNG PHẢI TỪ OBJECT URL
            return trimmedLink;
        } catch (e: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(e);
            logger?.warn({ link: trimmedLink, err: { message: errorMessage }, event: 'normalize_link_absolute_parse_failed', context: logContext }, `Absolute link parsing failed: "${errorMessage}". Returning empty string.`);
            return "";
        }
    }

    if (!isLinkEffectivelyEmpty && trimmedBaseUrl && /^https?:\/\//i.test(trimmedBaseUrl)) {
        try {
            const base = new URL(trimmedBaseUrl);
            const resolvedUrl = new URL(trimmedLink, base);
            // === THAY ĐỔI CỐT LÕI ===
            // Luôn trả về thuộc tính .href, nó đảm bảo giữ lại phần hash.
            const finalUrl = resolvedUrl.href;
            logger?.trace({ base: trimmedBaseUrl, link: trimmedLink, resolved: finalUrl, event: 'normalize_link_joined', context: logContext }, `Relative link resolved successfully: ${finalUrl}.`);
            return finalUrl;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            logger?.error({ base: trimmedBaseUrl, link: trimmedLink, err: { message: errorMessage }, event: 'normalize_link_join_failed', context: logContext }, `Failed to join relative link with base URL: "${errorMessage}". Returning empty string.`);
            return "";
        }
    }

    if (!wasLinkArgumentProvided && trimmedBaseUrl && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedBaseUrl)) {
        try {
            const validatedBase = new URL(trimmedBaseUrl);
            logger?.trace({ base: trimmedBaseUrl, event: 'normalize_base_url', context: logContext }, "Only base URL provided and valid. Returning base URL.");
            // TRẢ VỀ CHUỖI GỐC ĐÃ TRIM
            return trimmedBaseUrl;
        } catch (e: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(e);
            logger?.warn({ base: trimmedBaseUrl, err: { message: errorMessage }, event: 'normalize_base_url_parse_failed', context: logContext }, `Base URL parsing failed: "${errorMessage}". Returning empty string.`);
            return "";
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