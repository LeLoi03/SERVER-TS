// src/utils/crawl/searchFilter.ts
import { GoogleSearchResult } from "../../types/crawl/crawl.types"; // Using GoogleSearchResult as the type for search results.
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

/**
 * Filters an array of search results based on unwanted domains in the link
 * and skip keywords in the title.
 *
 * @param results - An array of search result objects to filter. Expected to conform to the SearchResult interface.
 * @param unwantedDomains - An array of domain strings (case-insensitive match) to exclude.
 * @param skipKeywords - An array of keyword strings (used as case-insensitive regex) to exclude based on the title.
 * @returns A new array containing the filtered search results. If filtering removes all results,
 *          it returns an array containing only the *first* original result (if it's minimally valid).
 *          Returns an empty array if the initial 'results' input is invalid or no valid fallback can be provided.
 */
export function filterSearchResults(
  results: unknown, // Use 'unknown' initially for robust runtime validation
  unwantedDomains: unknown,
  skipKeywords: unknown
): GoogleSearchResult[] { // The function *intends* to return GoogleSearchResult[]
    // const logContext = '[SearchFilter]';
    // console.log(`${logContext} Bắt đầu lọc kết quả tìm kiếm.`);

    // 1. Validate and cast 'results' input
    if (!Array.isArray(results)) {
        // console.warn(`${logContext} Đầu vào 'results' không phải là mảng. Trả về mảng rỗng.`);
        return [];
    }
    const validResults: GoogleSearchResult[] = results as GoogleSearchResult[];
    // console.log(`${logContext} Tổng số kết quả ban đầu: ${validResults.length}`);

    // 2. Validate and process 'unwantedDomains'
    let validUnwantedDomains: string[];
    if (!Array.isArray(unwantedDomains)) {
        // console.warn(`${logContext} Đầu vào 'unwantedDomains' không phải là mảng. Sử dụng mảng trống.`);
        validUnwantedDomains = [];
    } else {
        const nonStringDomains = unwantedDomains.filter(d => typeof d !== 'string');
        if (nonStringDomains.length > 0) {
            // console.warn(`${logContext} Phát hiện các phần tử không phải chuỗi trong 'unwantedDomains':`, nonStringDomains);
        }
        validUnwantedDomains = unwantedDomains.filter((d): d is string => typeof d === 'string');
    }
    // console.log(`${logContext} Tên miền không mong muốn: [${validUnwantedDomains.join(', ')}]`);

    // 3. Validate and process 'skipKeywords'
    let validSkipKeywords: string[];
    if (!Array.isArray(skipKeywords)) {
        // console.warn(`${logContext} Đầu vào 'skipKeywords' không phải là mảng. Sử dụng mảng trống.`);
        validSkipKeywords = [];
    } else {
        const nonStringKeywords = skipKeywords.filter(k => typeof k !== 'string');
        if (nonStringKeywords.length > 0) {
            // console.warn(`${logContext} Phát hiện các phần tử không phải chuỗi trong 'skipKeywords':`, nonStringKeywords);
        }
        validSkipKeywords = skipKeywords.filter((k): k is string => typeof k === 'string');
    }
    // console.log(`${logContext} Từ khóa bỏ qua: [${validSkipKeywords.join(', ')}]`);

    // 4. Perform the filtering operation
    const filteredResults = validResults.filter((resultItem: GoogleSearchResult, index: number) => {
        // console.log(`\n${logContext} --- Đang xử lý kết quả #${index + 1} ---`);
        try {
            if (!resultItem || typeof resultItem !== 'object' || resultItem === null) {
                // console.warn(`${logContext} Kết quả #${index + 1} không hợp lệ (object is null/undefined/not object). Loại bỏ.`);
                return false;
            }

            if (typeof resultItem.link !== 'string' || !resultItem.link.trim()) {
                // console.warn(`${logContext} Kết quả #${index + 1} có link không hợp lệ hoặc trống: '${resultItem.link}'. Loại bỏ.`);
                return false;
            }

            const link = resultItem.link.toLowerCase();
            const title = (typeof resultItem.title === 'string' ? resultItem.title.toLowerCase() : "");
            // console.log(`${logContext} Kiểm tra Link: '${link}', Title: '${title}'`);

            const hasUnwantedDomain = validUnwantedDomains.some(domain => {
                const domainLower = domain.toLowerCase();
                if (link.includes(domainLower)) {
                    // console.log(`${logContext} Link chứa tên miền không mong muốn: '${domainLower}'.`);
                    return true;
                }
                return false;
            });

            if (hasUnwantedDomain) {
                // console.log(`${logContext} Kết quả #${index + 1} bị loại bỏ do chứa tên miền không mong muốn.`);
                return false;
            }

            const hasSkipKeyword = validSkipKeywords.some(keyword => {
                try {
                    const regex = new RegExp(keyword, "i");
                    if (regex.test(title)) {
                        // console.log(`${logContext} Tiêu đề chứa từ khóa bỏ qua: '${keyword}'.`);
                        return true;
                    }
                    return false;
                } catch (regexCreationError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(regexCreationError);
                    // console.error(`${logContext} Lỗi tạo RegExp cho từ khóa '${keyword}': ${errorMessage}. Bỏ qua kiểm tra này cho mục hiện tại.`);
                    return false;
                }
            });

            if (hasSkipKeyword) {
                // console.log(`${logContext} Kết quả #${index + 1} bị loại bỏ do tiêu đề chứa từ khóa bỏ qua.`);
                return false;
            }

            // console.log(`${logContext} Kết quả #${index + 1} được giữ lại.`);
            return true;

        } catch (filterItemError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(filterItemError);
            // console.error(`${logContext} Lỗi không mong muốn khi xử lý kết quả #${index + 1}: ${errorMessage}\n${errorStack}. Loại bỏ.`);
            return false;
        }
    });

    // 5. Handle cases where all results were filtered out
    if (filteredResults.length === 0 && validResults.length > 0) {
        // console.warn(`${logContext} Tất cả các kết quả đã bị loại bỏ. Cố gắng trả về kết quả gốc đầu tiên làm dự phòng.`);
        const firstResult = validResults[0];
        if (firstResult && typeof firstResult === 'object' && typeof firstResult.link === 'string' && firstResult.link.trim()) {
            // console.log(`${logContext} Trả về kết quả gốc đầu tiên làm dự phòng: '${firstResult.link}'.`);
            return [firstResult];
        } else {
            // console.warn(`${logContext} Kết quả gốc đầu tiên không hợp lệ hoặc trống. Trả về mảng rỗng.`);
            return [];
        }
    }

    // console.log(`${logContext} Kết thúc lọc. Tổng số kết quả sau khi lọc: ${filteredResults.length}.`);
    return filteredResults;
}