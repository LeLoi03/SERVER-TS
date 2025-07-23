// src/types/logAnalysisChatbot/logAnalysisChatbot.types.ts

/**
 * Đại diện cho một cặp câu hỏi-trả lời từ file test của client.
 */
export interface ChatbotClientTestEntry {
    frontendMessageId: string;
    payload: {
        question: string;
        model?: string;
    };
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
    startTime_iso: string; // <<< THÊM MỚI: Thời gian bắt đầu thực tế từ client

    roundTripTime_ms?: number;
    error?: string;
    response?: string;
}

/**
 * Đại diện cho một log entry hiệu năng từ server.
 */
export interface ChatbotServerPerfLog {
    level: string;
    time: string;
    event: 'performance_log';
    // <<< SỬA ĐỔI QUAN TRỌNG: Thêm các stage mới vào đây >>>
    stage:
    | 'request_received'
    | 'ai_call_start'
    | 'ai_first_token_received' // Thêm mới
    | 'ai_stream_completed'     // Thêm mới (thay cho ai_call_end)
    | 'response_completed'
    | 'ai_function_call_completed'
    requestId: string;
    userId: string;
    conversationId: string;
    details?: {
        isStreaming?: boolean;
        language?: string;
        model?: string;
        messageLength?: number;
        hasPageContext?: boolean;
        turn?: number;
        requestedModel?: string;
        actualModel?: string;
    };
    metrics?: {
        totalServerDuration_ms?: number;
        prepDuration_ms?: number;
        aiCallDuration_ms?: number; // Đây là tổng thời gian stream từ log response_completed
        postProcessingDuration_ms?: number;
        totalStreamDuration_ms?: number; // Đây là thời gian của một lần stream từ log ai_stream_completed
        duration_ms?: number; // Thời gian của một lần gọi function call
    };
    msg: string;
}

/**
 * Dữ liệu được hợp nhất cho một request hoàn chỉnh.
 */
export interface AnalyzedChatbotRequest {
    requestId: string;
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'INCOMPLETE'; // INCOMPLETE: có log server nhưng không có kết quả client
    startTime: string; // Thời gian bắt đầu từ log 'request_received'

    // Dữ liệu từ Client
    question: string;
    clientRequestedModel?: string;
    clientResponse?: string;
    clientError?: string;

    serverMetrics: {
        roundTripTime_ms?: number;
        networkAndQueueTime_ms?: number;
        totalServerDuration_ms?: number;
        prepDuration_ms?: number;
        // <<< THÊM MỚI >>>
        timeToFirstToken_ms?: number; // Thời gian từ lúc gọi AI đến khi có token đầu tiên
        // <<< SỬA ĐỔI >>>
        aiTotalStreamDuration_ms?: number; // Đổi tên từ aiCallDuration_ms cho rõ nghĩa
        postProcessingDuration_ms?: number;
    };

    // Chi tiết về các lần gọi AI
    aiCalls: {
        turn: number;
        requestedModel?: string;
        actualModel?: string;
        duration_ms?: number;
    }[];
}

/**
 * Kết quả cuối cùng của toàn bộ quá trình phân tích.
 */
export interface ChatbotLogAnalysisResult {
    status: 'success' | 'error' | 'partial_success';
    errorMessage?: string;
    analysisStartTime: string;
    analysisEndTime: string;
    totalFilesAnalyzed: number;
    totalRequestsFound: number;
    analyzedRequests: AnalyzedChatbotRequest[];
    summary: {
        successCount: number;
        errorCount: number;
        timeoutCount: number;
        incompleteCount: number;
        averageResponseTime_ms: number; // Trung bình của roundTripTime_ms
        averageServerTime_ms: number; // Trung bình của totalServerDuration_ms
        averageTimeToFirstToken_ms: number;
        averageAiTime_ms: number; // Trung bình của aiCallDuration_ms
        requestsByModel: {
            [modelName: string]: {
                count: number;
                avgResponseTime_ms: number;
            }
        }

    };
}