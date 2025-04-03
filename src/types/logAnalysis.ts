// ../types/logAnalysis.ts

/** Thông tin chi tiết về quá trình xử lý một conference cụ thể */
export interface ConferenceAnalysisDetail {
    acronym: string;
    status: 'completed' | 'failed' | 'processing' | 'unknown'; // Trạng thái cuối cùng
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    steps: { // Theo dõi các bước chính
        search_attempted: boolean;
        search_success: boolean | null;
        search_attempts_count: number;
        search_results_count: number | null;
        search_filtered_count: number | null;
        html_save_attempted: boolean;
        html_save_success: boolean | null; // Có thể cần logic phức tạp hơn để xác định chính xác
        link_processing_attempted: number;
        link_processing_success: number;
        gemini_determine_attempted: boolean;
        gemini_determine_success: boolean | null;
        gemini_determine_cache_used: boolean | null;
        gemini_extract_attempted: boolean;
        gemini_extract_success: boolean | null;
        gemini_extract_cache_used: boolean | null;
    };
    errors: Array<{ timestamp: string; message: string; details?: any }>; // Lưu lỗi cụ thể của conference này
    finalResultPreview?: any; // Lưu kết quả cuối cùng nếu có log 'crawlConferences finished successfully'
}

/** Cấu trúc kết quả phân tích log tổng thể và chi tiết theo conference */
// --- Cập nhật cấu trúc kết quả để bao gồm bộ lọc ---
export interface LogAnalysisResult {
    analysisTimestamp: string;
    logFilePath: string;
    filterStartTime?: string; // Thời gian bắt đầu lọc (nếu có)
    filterEndTime?: string;   // Thời gian kết thúc lọc (nếu có)
    totalLogEntriesInFile: number; // Tổng số dòng trong file (không đổi)
    parsedLogEntriesInFile: number; // Tổng số dòng parse thành công trong file (không đổi)
    processedEntriesInRange: number; // Số dòng được xử lý trong khoảng thời gian lọc
    parseErrors: number;
    errorLogCount: number; // Lỗi >= ERROR trong khoảng thời gian lọc
    fatalLogCount: number; // Lỗi >= FATAL trong khoảng thời gian lọc

    // --- Tổng hợp chung (cho khoảng thời gian lọc) ---
    overall: {
        startTime: string | null; // Log sớm nhất trong khoảng thời gian
        endTime: string | null;   // Log muộn nhất trong khoảng thời gian
        durationSeconds: number | null; // Khoảng thời gian giữa log sớm nhất và muộn nhất
        totalConferencesInput: number | null; // Input ban đầu (có thể lấy từ log 'crawl_start' đầu tiên trong khoảng)
        processedConferencesCount: number; // Số conference có log trong khoảng
        completedTasks: number;         // Tasks Completed (Ran without fatal errors logged by task_finish or inferred)
        failedOrCrashedTasks: number;   // Tasks Failed/Crashed (Logged fatal errors or task_finish success=false or inferred failure)
        successfulExtractions: number;  // Tasks with Successful Gemini Extraction API calls
    };
    googleSearch: {
        totalRequests: number;
        successfulSearches: number; // Tổng số event search_success
        failedSearches: number; // Tổng số event search_ultimately_failed
        skippedSearches: number;
        quotaErrors: number;
        keyUsage: { [key: string]: number };
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Google Search
    };
    playwright: {
        setupSuccess: boolean | null;
        setupError: boolean | null;
        htmlSaveAttempts: number; // Tổng số event save_html_start
        successfulSaves: number; // Tổng số event save_html_step_completed (cần xem xét lại độ chính xác)
        failedSaves: number; // Tổng số event save_html_failed
        linkProcessing: {
            totalLinksAttempted: number;
            successfulAccess: number;
            failedAccess: number;
            redirects: number;
        };
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Playwright
    };
    geminiApi: {
        totalCalls: number;
        callsByType: { [apiType: string]: number };
        callsByModel: { [modelName: string]: number };
        successfulCalls: number;
        failedCalls: number;
        retriesByType: { [apiType: string]: number };
        retriesByModel: { [modelName: string]: number };
        cacheAttempts: number;
        cacheHits: number;
        cacheMisses: number;
        cacheCreationSuccess: number;
        cacheCreationFailed: number;
        cacheInvalidations: number;
        blockedBySafety: number;
        totalTokens: number; // Có thể tính tổng token nếu log có thông tin
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Gemini
        rateLimitWaits: number;
    };
    batchProcessing: {
        totalBatchesAttempted: number;
        successfulBatches: number;
        failedBatches: number;
        aggregatedResultsCount: number | null;
    };
    errorsAggregated: { [key: string]: number }; // Tổng hợp tất cả các lỗi cuối cùng (task failed, api failed, etc.)
    logProcessingErrors: string[]; // Lỗi khi parse dòng log

    // --- Phân tích chi tiết theo từng Conference ---
    conferenceAnalysis: {
        [acronym: string]: ConferenceAnalysisDetail;
    };
}