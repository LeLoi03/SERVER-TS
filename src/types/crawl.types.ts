// src/types/crawl.types.ts

// --------------------- CHUNG CHO TOÀN BỘ LUỒNG CRAWL ---------------------

/**
 * Loại model được sử dụng cho các API của Gemini (hoặc các API AI khác).
 * - 'non-tuned': Model cơ sở, chưa được fine-tune.
 * - 'tuned': Model đã được fine-tune cho tác vụ cụ thể.
 */
export type CrawlModelType = 'non-tuned' | 'tuned'; // CHUẨN HÓA: Sử dụng 'non-tuned' và 'tuned'

// --------------------- DỮ LIỆU ĐẦU VÀO BAN ĐẦU ---------------------

/**
 * Dữ liệu hội nghị đầu vào, có thể từ CSV hoặc khi người dùng chọn "Crawl Again".
 */
export interface ConferenceData {
    Title: string;
    Acronym: string;
    id?: string | number;         // ID tùy chọn từ nguồn (ví dụ: dòng CSV)
    originalRequestId?: string; // ID của request gốc nếu đây là một re-crawl
    // Các trường này có thể có nếu ConferenceData được dùng cho cả luồng update từ đầu
    mainLink?: string;
    cfpLink?: string;
    impLink?: string;
}

/**
 * Dữ liệu đầu vào cho luồng UPDATE, khi các link chính đã được xác định.
 */
export interface ConferenceUpdateData {
    Title: string;
    Acronym: string;
    mainLink: string;        // Link chính của hội nghị
    cfpLink: string;         // Link Call for Papers
    impLink: string;         // Link Important Dates
    originalRequestId?: string; // ID của request gốc nếu đây là re-crawl
}

// --------------------- DỮ LIỆU TRUNG GIAN TRONG BATCH PROCESSING ---------------------

/**
 * Đại diện cho một entry sau khi xử lý một link ban đầu trong luồng SAVE.
 * Mang thông tin cần thiết để gọi API determine_links.
 */
export interface BatchEntry {
    conferenceTitle: string;
    conferenceAcronym: string;
    conferenceLink: string;             // Link đã được xử lý (có thể là final URL)
    conferenceTextPath: string | null;  // Đường dẫn đến file text của link này
    originalRequestId?: string;          // Mang theo từ ConferenceData gốc
    linkOrderIndex?: number;
    // Các trường này có thể được điền sau khi API determine_links chạy và xử lý kết quả
    cfpLink?: string;                    // Link CFP được xác định (nếu có)
    impLink?: string;                    // Link IMP được xác định (nếu có)
    cfpTextPath?: string | null;         // Path đến text của link CFP (nếu có và xử lý được)
    impTextPath?: string | null;         // Path đến text của link IMP (nếu có và xử lý được)

    // Metadata từ các bước xử lý (tùy chọn, có thể thêm sau)
    // determineMetaData?: any; // Sẽ được thêm vào BatchEntryWithIds
}

/**
 * Dữ liệu đầu vào cho các tác vụ xử lý batch trong luồng UPDATE,
 * chứa đường dẫn đến các file text đã được trích xuất.
 */
export interface BatchUpdateEntry {
    conferenceTitle: string;
    conferenceAcronym: string;
    conferenceTextPath: string;       // Path đến text của mainLink
    cfpTextPath: string | null;       // Path đến text của cfpLink
    impTextPath: string | null;       // Path đến text của impLink
    originalRequestId?: string;      // Mang theo từ ConferenceUpdateData gốc
}


// --------------------- DỮ LIỆU GHI RA FILE JSONL (SAU BATCH PROCESSING) ---------------------

/**
 * Dữ liệu hoàn chỉnh của một entry sau luồng SAVE, sẵn sàng để ghi vào JSONL.
 * Bao gồm batchRequestId và tất cả metadata từ các API calls.
 */
export interface BatchEntryWithIds extends BatchEntry { // Kế thừa từ BatchEntry
    batchRequestId: string;              // ID của batch API đã xử lý item này
    // originalRequestId đã có trong BatchEntry

    // Kết quả từ API determine_links
    determineResponseTextPath?: string;  // Path đến file response text của API determine
    determineMetaData?: any;             // Metadata từ API determine

    // Kết quả từ API extract_information và extract_cfp (sau khi determine xong)
    extractResponseTextPath?: string;  // Path đến file response text của API extract
    extractMetaData?: any;             // Metadata từ API extract
    cfpResponseTextPath?: string;      // Path đến file response text của API cfp
    cfpMetaData?: any;                 // Metadata từ API cfp
}

/**
 * Dữ liệu hoàn chỉnh của một entry sau luồng UPDATE, sẵn sàng để ghi vào JSONL.
 */
export interface BatchUpdateDataWithIds extends BatchUpdateEntry { // Kế thừa từ BatchUpdateEntry
    batchRequestId: string;              // ID của batch API đã xử lý item này
    // originalRequestId đã có trong BatchUpdateEntry

    // Kết quả từ API extract_information và extract_cfp
    extractResponseTextPath?: string;
    extractMetaData?: any;
    cfpResponseTextPath?: string;
    cfpMetaData?: any;
}


// --------------------- DỮ LIỆU CHO RESULT PROCESSING (ĐỌC JSONL, GHI CSV) ---------------------

/**
 * Dữ liệu được đọc từ mỗi dòng của file JSONL bởi ResultProcessingService.
 * Cấu trúc này phải khớp với BatchEntryWithIds hoặc BatchUpdateDataWithIds.
 * Chúng ta có thể dùng union type nếu cấu trúc khác nhau nhiều, nhưng ở đây chúng khá tương đồng.
 * Để đơn giản, dùng một interface bao quát.
 */
export interface InputRowData { // Dữ liệu đọc từ JSONL
    conferenceTitle: string;
    conferenceAcronym: string;
    conferenceLink?: string;         // Có trong BatchEntryWithIds
    conferenceTextPath?: string | null;// Có trong cả hai
    cfpLink?: string;                // Có trong BatchEntryWithIds (sau determine)
    impLink?: string;                // Có trong BatchEntryWithIds (sau determine)
    cfpTextPath?: string | null;     // Có trong cả hai
    impTextPath?: string | null;     // Có trong cả hai

    // Paths đến API responses
    determineResponseTextPath?: string;
    extractResponseTextPath?: string;
    cfpResponseTextPath?: string;

    // Metadata từ API calls
    determineMetaData?: any;
    extractMetaData?: any;
    cfpMetaData?: any;

    // IDs quan trọng
    batchRequestId: string;          // Bắt buộc phải có trong JSONL
    originalRequestId?: string;      // Có thể có
}

/**
 * Dữ liệu đã được xử lý và chuẩn hóa từ Gemini API response.
 */
export interface ProcessedResponseData { // Dữ liệu sau khi _processApiResponse
    conferenceDates: string;
    year: string;
    location: string;
    cityStateProvince: string;
    country: string;
    continent: string;
    type: string;
    submissionDate: Record<string, string | undefined>; // Sửa lại type cho DateDetails
    notificationDate: Record<string, string | undefined>;
    cameraReadyDate: Record<string, string | undefined>;
    registrationDate: Record<string, string | undefined>;
    otherDate: Record<string, string | undefined>;
    topics: string;
    publisher: string;
    summary: string;
    callForPapers: string;
    information: string; // Tổng hợp thông tin không thuộc các trường cụ thể
}

/**
 * Dữ liệu cuối cùng được ghi vào file CSV và trả về cho frontend.
 */
export interface ProcessedRowData extends ProcessedResponseData { // Kế thừa từ ProcessedResponseData
    title: string;                    // Từ InputRowData.conferenceTitle
    acronym: string;                  // Từ InputRowData.conferenceAcronym
    link: string;                     // Từ InputRowData.conferenceLink (hoặc link được determine)
    cfpLink: string;                  // Từ InputRowData.cfpLink (hoặc link được determine)
    impLink: string;                  // Từ InputRowData.impLink (hoặc link được determine)

    determineLinks: Record<string, any>; // Có thể là object từ parsedDetermineInfo của ResultProcessingService

    // IDs để theo dõi và hiển thị
    requestId: string;                // Chính là batchRequestId của lần crawl tạo ra dòng này
    originalRequestId?: string;      // Giữ lại để frontend biết nguồn gốc (từ InputRowData)

    // inputConference?: ConferenceData; // Tùy chọn: nếu muốn giữ lại toàn bộ input ban đầu
}


// --------------------- GOOGLE SEARCH TYPES ---------------------

export class GoogleSearchError extends Error {
    details: any;
    constructor(message: string, details: any = {}) {
        super(message);
        this.name = 'GoogleSearchError';
        this.details = details;
        Object.setPrototypeOf(this, GoogleSearchError.prototype);
    }
}

export interface GoogleSearchResult { // Dùng chung cho SearchResult từ link_filtering
    title: string;
    link: string;
    // snippet?: string; // Tùy chọn
}

// Google Custom Search API Response (partial)
export interface GoogleCSEApiResponse {
    items?: GoogleApiItem[];
    error?: GoogleApiErrorBody;
}
interface GoogleApiItem {
    title?: string;
    link?: string;
}
interface GoogleApiErrorBody {
    code: number;
    message: string;
    errors: GoogleApiErrorDetail[];
}
interface GoogleApiErrorDetail {
    message: string;
    domain: string;
    reason: string;
}

// Type SearchResult từ 4_link_filtering.ts có thể dùng GoogleSearchResult nếu cấu trúc giống hệt.
// Nếu SearchResult có thể không có title, thì định nghĩa riêng hoặc làm title optional trong GoogleSearchResult.
// Hiện tại GoogleSearchResult đã có title là required, link là required.

// --------------------- PLAYWRIGHT TYPES ---------------------
// import { Browser, BrowserContext as PlaywrightBrowserContext } from "playwright"; // Tránh xung đột tên
// export interface PlaywrightSetupResult {
//     browser: Browser | null;
//     browserContext: PlaywrightBrowserContext | null;
// }
// Comment lại PlaywrightSetupResult nếu nó chỉ dùng trong file playwright_setup.ts và không cần export ra ngoài.

// --------------------- DATA MANAGER TYPES (CHO CSV DATASET CỦA GEMINI) ---------------------
// Các type này liên quan đến việc chuẩn bị dataset cho Gemini, có thể giữ nguyên nếu không ảnh hưởng.
export interface CsvRowData {
    input: string;
    output: string;
}
export interface InputsOutputs {
    inputs: Record<string, string>;
    outputs: Record<string, string>;
}