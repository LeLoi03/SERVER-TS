import { inject, injectable } from 'tsyringe';
import fs from 'fs';
import readline from 'readline';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '../config';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import http from 'http'; // <<< THÊM IMPORT NÀY

// Interface cho một dòng trong file jsonl
interface JournalJsonlData {
    [key: string]: any;
}

// Interface cho kết quả từ Database API
interface DbImportResultItem {
    success: boolean;
    message: string;
    data?: {
        id: string;
        title: string;
        issn: string;
    };
    // Giả sử Database API trả về một định danh để khớp lại
    sourceId?: string;
    title?: string;
}

interface DbImportResponse {
    results: DbImportResultItem[];
    totalProcessed: number;
    totalSuccess: number;
    totalFailed: number;
}

// TẠO MỘT HTTP AGENT TÙY CHỈNH
// keepAlive: true - Bật tính năng keep-alive
// maxSockets: 100 - Số lượng socket tối đa trong pool
// maxFreeSockets: 10 - Số lượng socket rảnh rỗi tối đa được giữ lại
// timeout: 60000 - Timeout cho việc tạo socket (ms)
// freeSocketTimeout: 30000 - Thời gian một socket rảnh rỗi được giữ lại trước khi bị hủy (ms)
// TẠO MỘT HTTP AGENT TÙY CHỈNH DỰA TRÊN AGENTOPTIONS
// Cấu hình này được tối ưu hóa để tái sử dụng kết nối một cách hiệu quả
// nhưng cũng tránh các vấn đề về socket "cũ".
const httpAgent = new http.Agent({
    keepAlive: true,        // Bật tính năng tái sử dụng socket.
    maxSockets: 50,         // Giới hạn 50 kết nối đồng thời tới CÙNG MỘT host.
    // Giúp tránh làm quá tải server đích.
    maxFreeSockets: 10,     // Giữ lại tối đa 10 socket rảnh rỗi trong pool.
    // Khi có request mới, nó sẽ ưu tiên dùng socket rảnh.
    // Nếu không có, nó sẽ tạo socket mới (tối đa 50).
    timeout: 60000,         // Timeout để thiết lập một kết nối TCP (ms).
    // Nếu không kết nối được trong 60s, nó sẽ báo lỗi.
    keepAliveMsecs: 1000,   // Gửi một tín hiệu "keep-alive" trên socket mỗi giây
    // để giữ cho kết nối không bị ngắt bởi firewall/proxy.
});

@injectable()
export class JournalImportService {
    private readonly dbApiUrl: string;
    private readonly saveEventLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        // Lấy URL từ biến môi trường hoặc config
        this.dbApiUrl = `${process.env.DATABASE_URL}/journals/import`;
        this.saveEventLogger = this.loggingService.getLogger('saveJournalEvent');
    }

    /**
     * Đọc file jsonl, gọi API database để import, và ghi log kết quả.
     * @param batchRequestId ID của batch để xử lý.
     */
    public async importJournalsFromLogFile(batchRequestId: string): Promise<DbImportResponse> {
        const jsonlPath = this.configService.getJournalOutputJsonlPathForBatch(batchRequestId);

        // 1. Đọc và parse file .jsonl
        const journalsToImport = await this.parseJsonlFile(jsonlPath);

        if (journalsToImport.length === 0) {
            return {
                results: [],
                totalProcessed: 0,
                totalSuccess: 0,
                totalFailed: 0,
            };
        }

        // 2. Gọi API của Database
        const dbApiResponse = await this.callDatabaseImportApi(journalsToImport);

        // 3. Ghi log các kết quả thành công và ĐỢI cho nó hoàn thành
        // Thêm 'await' ở đây
        await this.persistSuccessfulImports(dbApiResponse.results, batchRequestId);

        // 4. Trả về kết quả cho controller
        // `journalsToImport` là mảng đọc từ file .jsonl, có chứa `sourceId`
        // `dbApiResponse.results` là mảng kết quả từ DB, có chứa `data.id` và `data.title`

        // TẠO RESPONSE CUỐI CÙNG CHO FRONTEND
        const finalResultsForFrontend = dbApiResponse.results.map(dbResult => {
            // Tìm lại journal gốc trong mảng đầu vào để lấy sourceId
            // Giả sử DB API trả về title để khớp lại
            const originalJournal = journalsToImport.find(j => j.Title === dbResult.data?.title);

            return {
                ...dbResult,
                sourceId: originalJournal?.Sourceid || null // Lấy Sourceid từ file jsonl
            };
        });

        // Trả về kết quả đã được bổ sung sourceId
        return {
            ...dbApiResponse,
            results: finalResultsForFrontend
        };
    }


    private async parseJsonlFile(filePath: string): Promise<JournalJsonlData[]> {
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            throw new Error(`Log file for batch not found.`);
        }

        const fileStream = fs.createReadStream(filePath); // Mở stream

        try {
            const journals: JournalJsonlData[] = [];
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                if (line.trim()) {
                    try {
                        journals.push(JSON.parse(line));
                    } catch (error) {
                        console.warn(`Skipping invalid JSON line in ${filePath}: ${line}`);
                    }
                }
            }
            return journals;
        } finally {
            // LUÔN LUÔN ĐÓNG STREAM TRONG FINALLY
            fileStream.close((err) => {
                if (err) {
                    // Ghi log lỗi nếu không đóng được stream, nhưng không ném lỗi để tránh che mất lỗi gốc
                    console.error(`[JournalImportService] Error closing file stream for ${filePath}:`, err);
                } else {
                    console.log(`[JournalImportService] Closed file stream for: ${filePath}`);
                }
            });
        }
    }


    private async callDatabaseImportApi(journals: JournalJsonlData[]): Promise<DbImportResponse> {
        try {
            console.log(`[JournalImportService] Calling Database API with ${journals.length} journals...`);

            const response = await axios.post<DbImportResponse>(
                this.dbApiUrl,
                journals,
                {
                    // SỬ DỤG HTTP AGENT ĐÃ ĐƯỢC CẤU HÌNH CHÍNH XÁC
                    httpAgent: httpAgent,

                    // Timeout cho TOÀN BỘ request (bao gồm cả thời gian xử lý của server)
                    // Đặt giá trị này đủ lớn để server có thời gian xử lý.
                    timeout: 60000 // 60 giây
                }
            );

            console.log(`[JournalImportService] Database API call successful. Status: ${response.status}`);
            return response.data;

        } catch (err) {
            const error = err as AxiosError;
            console.error('Error calling Database Import API:', {
                message: error.message,
                code: error.code,
                url: this.dbApiUrl,
                requestConfig: error.config,
                response: error.response?.data
            });
            throw new Error('Failed to import journals to the database.');
        }
    }

    // THAY ĐỔI HÀM NÀY
    private async persistSuccessfulImports(results: DbImportResultItem[], batchRequestId: string): Promise<void> {
        const successfulJournals = results.filter(r => r.success && r.data);

        if (successfulJournals.length === 0) {
            return; // Không có gì để ghi, thoát sớm
        }

        for (const journalResult of successfulJournals) {
            // Điều kiện if (journalResult.data) đã được bao hàm bởi filter ở trên
            const logData = {
                event: "JOURNAL_SAVE_EVENT_RECORDED",
                details: {
                    batchRequestId: batchRequestId,
                    sourceId: journalResult.data!.id, // Sử dụng non-null assertion `!` vì đã filter
                    journalTitle: journalResult.data!.title,
                    status: 'SAVED_TO_DATABASE',
                    clientTimestamp: new Date().toISOString(),
                    serverTimestamp: new Date().toISOString(),
                },
            };
            this.saveEventLogger.info(logData, `Journal save event recorded for: ${journalResult.data!.title}`);
        }

        // ĐÂY LÀ THAY ĐỔI QUAN TRỌNG NHẤT
        // `flush()` sẽ trả về một Promise, giải quyết khi tất cả log trong buffer đã được ghi.
        // Bọc nó trong try/catch để xử lý các lỗi có thể xảy ra trong quá trình ghi file.
        try {
            await this.saveEventLogger.flush();
            console.log(`[JournalImportService] Flushed ${successfulJournals.length} save events to log successfully.`);
        } catch (err) {
            console.error('[JournalImportService] CRITICAL: Failed to flush logs to file.', err);
            // Ném lỗi lên để controller có thể bắt và trả về lỗi 500,
            // thay vì để ứng dụng bị crash.
            throw new Error('Failed to persist save event logs.');
        }
    }
}