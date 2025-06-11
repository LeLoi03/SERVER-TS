/**
 * @fileoverview Định nghĩa các kiểu dữ liệu cho việc phân tích nhật ký (log analysis) của quá trình thu thập dữ liệu (crawl pipeline).
 * Bao gồm các tóm tắt tổng thể, chi tiết phân tích từng hội nghị, và kết quả phân tích tổng hợp từ các thành phần khác nhau.
 */

import { RequestTimings, LogError } from './common.types';
import { GoogleSearchAnalysis } from './search.types';
import { GeminiApiAnalysis } from './gemini.types';
import { PlaywrightAnalysis } from './playwright.types';
import { BatchProcessingAnalysis } from './batchProcessing.types';
import { FileOutputAnalysis } from './fileOutput.types';
import { ValidationStats, DataQualityInsight } from './validation.types';

/**
 * @interface OverallAnalysis
 * @description Tóm tắt tổng thể về phân tích nhật ký.
 */
export interface OverallAnalysis {
    /**
     * @property {string | null} startTime - Thời gian bắt đầu của giai đoạn phân tích (chuỗi ISO), hoặc null nếu không xác định.
     */
    startTime: string | null;
    /**
     * @property {string | null} endTime - Thời gian kết thúc của giai đoạn phân tích (chuỗi ISO), hoặc null nếu không xác định.
     */
    endTime: string | null;
    /**
     * @property {number | null} durationSeconds - Tổng thời lượng của giai đoạn phân tích tính bằng giây, hoặc null nếu không xác định.
     */
    durationSeconds: number | null;
    /**
     * @property {number} totalConferencesInput - Tổng số hội nghị được cung cấp ban đầu làm đầu vào.
     */
    totalConferencesInput: number;
    /**
     * @property {number} processedConferencesCount - Tổng số hội nghị đã được xử lý hoàn tất (bất kể lỗi nội bộ).
     */
    processedConferencesCount: number;
    /**
     * @property {number} completedTasks - Số lượng tác vụ đã hoàn thành thành công.
     */
    completedTasks: number;
    /**
     * @property {number} failedOrCrashedTasks - Số lượng tác vụ đã thất bại hoặc gặp sự cố.
     */
    failedOrCrashedTasks: number;
    /**
     * @property {number} processingTasks - Số lượng tác vụ hiện đang trong quá trình xử lý.
     */
    processingTasks: number;
    /**
     * @property {number} skippedTasks - Số lượng tác vụ đã bị bỏ qua hoàn toàn.
     */
    skippedTasks: number;
    /**
     * @property {number} successfulExtractions - Số lượng trích xuất thành công được thực hiện bởi các mô hình AI.
     */
    successfulExtractions: number;
}

/**
 * @typedef {'crawl' | 'update'} ConferenceCrawlType
 * @description Định nghĩa loại thu thập dữ liệu cho một hội nghị: 'crawl' (thu thập mới) hoặc 'update' (cập nhật).
 */
export type ConferenceCrawlType = 'crawl' | 'update';

/**
 * @interface ConferenceAnalysisDetail
 * @description Phân tích chi tiết quá trình xử lý của một hội nghị cụ thể trong một lô.
 * Cung cấp cái nhìn chi tiết về từng bước thu thập dữ liệu cho một hội nghị duy nhất.
 */
export interface ConferenceAnalysisDetail {
    /**
     * @property {string} batchRequestId - ID yêu cầu lô mà hội nghị này thuộc về.
     */
    batchRequestId: string;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID yêu cầu gốc nếu hội nghị này là một phần của quá trình thu thập lại.
     */
    originalRequestId?: string;
    /**
     * @property {ConferenceCrawlType} crawlType - Loại thu thập dữ liệu (crawl hoặc update).
     */
    crawlType: ConferenceCrawlType;
    /**
     * @property {'SAVED_TO_DATABASE' | string} [persistedSaveStatus] - Trạng thái lưu trữ bền vững (ví dụ: 'SAVED_TO_DATABASE').
     */
    persistedSaveStatus?: 'SAVED_TO_DATABASE' | string;
    /**
     * @property {string} [persistedSaveTimestamp] - Thời điểm ghi nhận lưu trữ bền vững (từ clientTimestamp), định dạng ISO string.
     */
    persistedSaveTimestamp?: string;
    /**
     * @property {string} title - Tiêu đề của hội nghị.
     */
    title: string;
    /**
     * @property {string} acronym - Từ viết tắt của hội nghị.
     */
    acronym: string;
    /**
     * @property {'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped'} status - Trạng thái xử lý của hội nghị cụ thể này.
     */
    status: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped';
    /**
     * @property {string | null} startTime - Thời gian bắt đầu xử lý cho hội nghị này (chuỗi ISO), hoặc null.
     */
    startTime: string | null;
    /**
     * @property {string | null} endTime - Thời gian kết thúc xử lý cho hội nghị này (chuỗi ISO), hoặc null.
     */
    endTime: string | null;
    /**
     * @property {number | null} durationSeconds - Thời lượng xử lý cho hội nghị này tính bằng giây, hoặc null.
     */
    durationSeconds: number | null;
    /**
     * @property {string | null} [crawlEndTime] - Tùy chọn: Thời gian kết thúc của quá trình thu thập dữ liệu tổng thể cho hội nghị này (chuỗi ISO).
     */
    crawlEndTime?: string | null;
    /**
     * @property {boolean | null} [crawlSucceededWithoutError] - Tùy chọn: Cho biết liệu việc thu thập dữ liệu có thành công mà không có lỗi cho hội nghị cụ thể này hay không.
     */
    crawlSucceededWithoutError?: boolean | null;
    /**
     * @property {boolean | null} [jsonlWriteSuccess] - Tùy chọn: Cho biết liệu việc ghi vào JSONL có thành công cho hội nghị này hay không.
     */
    jsonlWriteSuccess?: boolean | null;
    /**
     * @property {boolean | null} [csvWriteSuccess] - Tùy chọn: Cho biết liệu việc ghi vào CSV có thành công cho hội nghị này hay không.
     */
    csvWriteSuccess?: boolean | null;
    /**
     * @property {object} steps - Phân tích chi tiết từng bước được thực hiện cho hội nghị này.
     * @property {boolean} steps.search_attempted - Cho biết liệu tìm kiếm có được thử hay không.
     * @property {boolean | null} steps.search_success - Cho biết liệu tìm kiếm có thành công hay không.
     * @property {number} steps.search_attempts_count - Số lần thử tìm kiếm.
     * @property {number | null} steps.search_results_count - Số lượng kết quả tìm kiếm.
     * @property {number | null} steps.search_filtered_count - Số lượng kết quả tìm kiếm đã được lọc.
     * @property {boolean} steps.html_save_attempted - Cho biết liệu việc lưu HTML có được thử hay không.
     * @property {boolean | 'skipped' | null} steps.html_save_success - Cho biết liệu việc lưu HTML có thành công, bị bỏ qua hay không.
     * @property {number} steps.link_processing_attempted_count - Số lượng liên kết đã cố gắng xử lý.
     * @property {number} steps.link_processing_success_count - Số lượng liên kết đã xử lý thành công.
     * @property {Array<{ timestamp: string; url?: string; error?: string; event?: string }>} steps.link_processing_failed_details - Chi tiết các liên kết xử lý thất bại.
     * @property {boolean} steps.gemini_determine_attempted - Cho biết liệu API Gemini 'determine' có được thử hay không.
     * @property {boolean | null} steps.gemini_determine_success - Cho biết liệu API Gemini 'determine' có thành công hay không.
     * @property {boolean | null} steps.gemini_determine_cache_used - Cho biết liệu cache có được sử dụng cho API Gemini 'determine' hay không.
     * @property {boolean} steps.gemini_extract_attempted - Cho biết liệu API Gemini 'extract' có được thử hay không.
     * @property {boolean | null} steps.gemini_extract_success - Cho biết liệu API Gemini 'extract' có thành công hay không.
     * @property {boolean | null} steps.gemini_extract_cache_used - Cho biết liệu cache có được sử dụng cho API Gemini 'extract' hay không.
     * @property {boolean} [steps.gemini_cfp_attempted] - Tùy chọn: Cho biết liệu API Gemini 'cfp' có được thử hay không.
     * @property {boolean | null} [steps.gemini_cfp_success] - Tùy chọn: Cho biết liệu API Gemini 'cfp' có thành công hay không.
     * @property {boolean | null} [steps.gemini_cfp_cache_used] - Tùy chọn: Cho biết liệu cache có được sử dụng cho API Gemini 'cfp' hay không.
     */
    steps: {
        search_attempted: boolean;
        search_success: boolean | null;
        search_attempts_count: number;
        search_results_count: number | null;
        search_filtered_count: number | null;
        search_limited_count: number | null; // <<<< THÊM TRƯỜNG MỚI


        html_save_attempted: boolean;
        html_save_success: boolean | 'skipped' | null;
        link_processing_attempted_count: number;
        link_processing_success_count: number;
        link_processing_failed_details: Array<{
            timestamp: string; // ISO string
            url?: string;
            error?: string;
            event?: string;
        }>;

        gemini_determine_attempted: boolean;
        gemini_determine_success: boolean | null;
        gemini_determine_cache_used: boolean | null;
        gemini_extract_attempted: boolean;
        gemini_extract_success: boolean | null;
        gemini_extract_cache_used: boolean | null;
        gemini_cfp_attempted?: boolean;
        gemini_cfp_success?: boolean | null;
        gemini_cfp_cache_used?: boolean | null;
    };
    /**
     * @property {LogError[]} errors - Một mảng các lỗi cụ thể gặp phải cho hội nghị này trong quá trình xử lý.
     */
    errors: LogError[];
    /**
     * @property {DataQualityInsight[]} [dataQualityInsights] - Tùy chọn: Một mảng các thông tin chi tiết về chất lượng dữ liệu được tạo ra cho hội nghị này.
     */
    dataQualityInsights?: DataQualityInsight[];
    /**
     * @property {any} [finalResultPreview] - Tùy chọn: Bản xem trước của kết quả cuối cùng đã xử lý cho hội nghị này.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    finalResultPreview?: any;
    /**
     * @property {any} [finalResult] - Tùy chọn: Kết quả cuối cùng đã xử lý đầy đủ cho hội nghị này.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    finalResult?: any;
}

/**
 * @interface ConferenceLogAnalysisResult
 * @description Cấu trúc kết quả toàn diện cho một hoạt động phân tích nhật ký hoàn chỉnh.
 * Tổng hợp tất cả các thông tin chi tiết từ các thành phần khác nhau của pipeline thu thập dữ liệu.
 */
export interface ConferenceLogAnalysisResult {
    /**
     * @property {string} analysisTimestamp - Dấu thời gian ISO khi phân tích này được tạo.
     */
    analysisTimestamp: string;
    /**
     * @property {string} logFilePath - Đường dẫn tệp của (các) tệp nhật ký đã được phân tích.
     */
    logFilePath: string | undefined;
    /**
     * @property {'Completed' | 'Failed' | 'Processing' | 'CompletedWithErrors' | 'PartiallyCompleted' | 'NoRequestsAnalyzed' | 'Unknown'} [status] - Trạng thái tổng thể của quá trình phân tích.
     * - 'Completed': Phân tích đã chạy hoàn tất. (Tất cả tác vụ hoàn thành)
     * - 'Failed': Quá trình phân tích thất bại. (Tất cả tác vụ thất bại).
     * - 'Processing': Phân tích vẫn đang chạy.
     * - 'CompletedWithErrors': Phân tích hoàn thành, nhưng gặp lỗi nội bộ.
     * - 'PartiallyCompleted': Phân tích hoàn thành một phần.
     * - 'NoRequestsAnalyzed': Không tìm thấy hoặc phân tích được yêu cầu nào dựa trên bộ lọc.
     * - 'Unknown': Không thể xác định trạng thái.
     */
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors'
    | 'PartiallyCompleted'
    | 'NoRequestsAnalyzed'
    | 'Unknown';
    /**
     * @property {string} [errorMessage] - Tùy chọn: Thông báo lỗi nếu quá trình phân tích thất bại.
     */
    errorMessage?: string;
    /**
     * @property {string} [filterRequestId] - Tùy chọn: ID yêu cầu cụ thể đã được lọc để phân tích.
     */
    filterRequestId?: string;
    /**
     * @property {string[]} analyzedRequestIds - Một mảng tất cả các ID yêu cầu lô đã được bao gồm trong phân tích này.
     */
    analyzedRequestIds: string[];

    /**
     * @property {{[batchRequestId: string]: RequestTimings}} requests - Một từ điển các `RequestTimings` được lập chỉ mục bởi `batchRequestId`.
     */
    requests: {
        [batchRequestId: string]: RequestTimings;
    };

    /**
     * @property {number} totalLogEntries - Tổng số mục nhật ký thô đã đọc.
     */
    totalLogEntries: number;
    /**
     * @property {number} parsedLogEntries - Số lượng mục nhật ký đã được phân tích cú pháp thành công.
     */
    parsedLogEntries: number;
    /**
     * @property {number} parseErrors - Số lượng lỗi gặp phải trong quá trình phân tích cú pháp nhật ký.
     */
    parseErrors: number;
    /**
     * @property {number} errorLogCount - Số lượng mục nhật ký được phân loại là cấp độ 'error'.
     */
    errorLogCount: number;
    /**
     * @property {number} fatalLogCount - Số lượng mục nhật ký được phân loại là cấp độ 'fatal'.
     */
    fatalLogCount: number;

    /**
     * @property {GoogleSearchAnalysis} googleSearch - Phân tích cụ thể cho các hoạt động tìm kiếm của Google.
     */
    googleSearch: GoogleSearchAnalysis;
    /**
     * @property {PlaywrightAnalysis} playwright - Phân tích cụ thể cho các hoạt động Playwright (cạo web).
     */
    playwright: PlaywrightAnalysis;
    /**
     * @property {GeminiApiAnalysis} geminiApi - Phân tích cụ thể cho các tương tác API Gemini.
     */
    geminiApi: GeminiApiAnalysis;
    /**
     * @property {BatchProcessingAnalysis} batchProcessing - Phân tích cụ thể cho các hoạt động xử lý lô.
     */
    batchProcessing: BatchProcessingAnalysis;
    /**
     * @property {FileOutputAnalysis} fileOutput - Phân tích cụ thể cho các hoạt động đầu ra tệp (JSONL, CSV).
     */
    fileOutput: FileOutputAnalysis;
    /**
     * @property {ValidationStats} validationStats - Thống kê tổng hợp về xác thực và chuẩn hóa dữ liệu.
     */
    validationStats: ValidationStats;

    /**
     * @property {OverallAnalysis} overall - Thống kê tóm tắt tổng thể.
     */
    overall: OverallAnalysis;

    /**
     * @property {{[normalizedErrorKey: string]: number}} errorsAggregated - Tổng số lỗi duy nhất gặp phải, đã được chuẩn hóa.
     */
    errorsAggregated: { [normalizedErrorKey: string]: number };
    /**
     * @property {string[]} logProcessingErrors - Một mảng các lỗi chung gặp phải trong quá trình xử lý nhật ký (ví dụ: lỗi đọc tệp).
     */
    logProcessingErrors: string[];

    /**
     * @property {{[compositeKey: string]: ConferenceAnalysisDetail}} conferenceAnalysis - Một từ điển các đối tượng `ConferenceAnalysisDetail`, được lập chỉ mục bởi một khóa tổng hợp (ví dụ: `batchRequestId-conferenceTitle`).
     */
    conferenceAnalysis: {
        [compositeKey: string]: ConferenceAnalysisDetail;
    };
}