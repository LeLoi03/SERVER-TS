import { singleton } from 'tsyringe';
import path from 'path';
import { AppConfig } from './types';
import { LevelWithSilent } from 'pino';

@singleton()
export class AppConfiguration {
    public readonly nodeEnv: 'development' | 'production' | 'test';
    public readonly port: number;
    public readonly jwtSecret: string;
    public readonly mongodbUri: string;
    public readonly databaseUrl: string;
    public readonly databaseImportEndpoint: string;
    public readonly corsAllowedOrigins: string[];

    public readonly logAnalysisCronSchedule: string;
    public readonly cronTimezone: string;

    public readonly logLevel: LevelWithSilent;
    public readonly logsDirectoryPath: string; // Thư mục logs chính, ví dụ: D:\NEW-SERVER-TS\logs

    // Tên file log chung (nếu vẫn dùng)
    public readonly appLogFileName: string;
    // public readonly conferenceLogFileName: string; // Sẽ không dùng file chung nữa
    // public readonly journalLogFileName: string;   // Sẽ không dùng file chung nữa
    public readonly saveConferenceEventLogFileName: string = 'conference_save_events.jsonl';
    public readonly saveJournalEventLogFileName: string = 'journal_save_events.jsonl';

    public readonly requestSpecificLogSubdir: string = 'by_request_id'; // Thư mục con cho log theo request

    public readonly logToConsole: boolean;

    // Cấu hình xoay vòng cho các file log chung (app, saveEvents)
    // public readonly logRotationFrequency: string;
    // public readonly logRotationSize: string;
    public readonly logArchiveSubdir: string;
    public readonly logRotationDateFormat?: string;
    public readonly logRotationLimitCount?: number;

    public readonly analysisCacheEnabled: boolean;
    public readonly analysisCacheTTLSeconds: number;
    public readonly analysisCacheSubdir: string;

    public readonly baseOutputDirPath: string;
    public readonly jsonlOutputSubdir: string;
    public readonly csvOutputSubdir: string;
    public readonly saveConferenceStatusOutputSubdir: string;
    public readonly saveJournalStatusOutputSubdir: string;

    public readonly crawlConcurrency: number;
    public readonly globalCrawlConcurrency: number;

    public readonly apiBaseUrl: string | undefined;

     // <<< THÊM MỚI: Thuộc tính cho thư mục log của client test >>>
    public readonly chatbotClientTestLogDirectoryPath: string;

    constructor(private appConfig: AppConfig) {
        this.nodeEnv = appConfig.NODE_ENV;
        this.port = appConfig.PORT;
        this.jwtSecret = appConfig.JWT_SECRET;
        this.mongodbUri = appConfig.MONGODB_URI;
        this.databaseUrl = appConfig.DATABASE_URL;
        this.databaseImportEndpoint = appConfig.DATABASE_IMPORT_ENDPOINT;
        this.corsAllowedOrigins = appConfig.CORS_ALLOWED_ORIGINS!;

        this.logAnalysisCronSchedule = appConfig.LOG_ANALYSIS_CRON_SCHEDULE;
        this.cronTimezone = appConfig.CRON_TIMEZONE;

        this.logLevel = appConfig.LOG_LEVEL;
        this.logsDirectoryPath = path.resolve(appConfig.LOGS_DIRECTORY);

        this.appLogFileName = appConfig.APP_LOG_FILE_NAME || 'app.log';
        // Không cần conferenceLogFileName và journalLogFileName nếu không có file log chung nữa

        this.logToConsole = appConfig.LOG_TO_CONSOLE;
        // this.logRotationFrequency = appConfig.LOG_ROTATION_FREQUENCY || 'daily';
        // this.logRotationSize = appConfig.LOG_ROTATION_SIZE || '50M';
        this.logArchiveSubdir = appConfig.LOG_ARCHIVE_SUBDIR || 'archive';
        // this.logRotationDateFormat = appConfig.LOG_ROTATION_DATE_FORMAT;
        // this.logRotationLimitCount = appConfig.LOG_ROTATION_LIMIT_COUNT;

        this.analysisCacheEnabled = appConfig.ANALYSIS_CACHE_ENABLED !== undefined ? appConfig.ANALYSIS_CACHE_ENABLED : true;
        this.analysisCacheTTLSeconds = appConfig.ANALYSIS_CACHE_TTL_SECONDS || 86400;
        this.analysisCacheSubdir = appConfig.ANALYSIS_CACHE_SUBDIR || 'analysis_cache'; // Sẽ nằm trong baseOutputDirPath/analysis_cache

        this.baseOutputDirPath = path.resolve(appConfig.BASE_OUTPUT_DIR);
        this.jsonlOutputSubdir = appConfig.JSONL_OUTPUT_SUBDIR;
        this.csvOutputSubdir = appConfig.CSV_OUTPUT_SUBDIR;
        this.saveConferenceStatusOutputSubdir = appConfig.SAVE_CONFERENCE_STATUS_OUTPUT_SUBDIR; // Sẽ nằm trong baseOutputDirPath
        this.saveJournalStatusOutputSubdir = appConfig.SAVE_JOURNAL_STATUS_OUTPUT_SUBDIR;       // Sẽ nằm trong baseOutputDirPath

        this.crawlConcurrency = appConfig.CRAWL_CONCURRENCY;
        this.globalCrawlConcurrency = appConfig.GLOBAL_CRAWL_CONCURRENCY;

        this.apiBaseUrl = appConfig.API_BASE_URL;
         // <<< THÊM MỚI: Gán giá trị từ biến môi trường hoặc một giá trị mặc định >>>
        // Giả sử biến môi trường là CHATBOT_CLIENT_TEST_LOG_DIR
        // Giá trị mặc định là thư mục 'test-logs' ở gốc dự án.
        this.chatbotClientTestLogDirectoryPath = path.resolve(
            appConfig.CHATBOT_CLIENT_TEST_LOG_DIR || 'test-logs'
        );
    }

    // --- Thư mục con cho từng loại log chính (trong logsDirectoryPath) ---
    get appLogDirectory(): string {
        return path.join(this.logsDirectoryPath, 'app');
    }
    // Thư mục gốc cho conference logs (chứa thư mục con by_request_id)
    get baseConferenceLogDirectory(): string {
        return path.join(this.logsDirectoryPath, 'conference');
    }
    // Thư mục gốc cho journal logs (chứa thư mục con by_request_id)
    get baseJournalLogDirectory(): string {
        return path.join(this.logsDirectoryPath, 'journal');
    }

    // --- Đường dẫn thư mục cho log theo request ID ---
    get conferenceRequestLogDirectory(): string {
        return path.join(this.baseConferenceLogDirectory, this.requestSpecificLogSubdir);
    }
    get journalRequestLogDirectory(): string {
        return path.join(this.baseJournalLogDirectory, this.requestSpecificLogSubdir);
    }

    // --- Đường dẫn đầy đủ đến file log chung (app, saveEvents) mà pino-roll sẽ quản lý ---
    get appLogFilePathForWriting(): string {
        return path.join(this.appLogDirectory, this.appLogFileName);
    }
    // Không còn file log conference/journal chung để ghi nữa

    // --- Đường dẫn đến symlink 'current.log' cho file log chung (app, saveEvents) ---
    get appLogFilePathForReading(): string {
        return path.join(this.appLogDirectory, 'current.log');
    }
    // Không còn symlink cho conference/journal chung nữa

    // --- Đường dẫn cho save event logs (vẫn có thể dùng pino-roll) ---
    get saveConferenceEventLogDirectory(): string {
        return path.join(this.baseOutputDirPath, this.saveConferenceStatusOutputSubdir);
    }
    get saveJournalEventLogDirectory(): string {
        return path.join(this.baseOutputDirPath, this.saveJournalStatusOutputSubdir);
    }
    get saveConferenceEventLogFilePath(): string {
        return path.join(this.saveConferenceEventLogDirectory, this.saveConferenceEventLogFileName);
    }
    get saveJournalEventLogFilePath(): string {
        return path.join(this.saveJournalEventLogDirectory, this.saveJournalEventLogFileName);
    }

    // --- Phương thức lấy đường dẫn file log cho một request cụ thể ---
    public getRequestSpecificLogFilePath(type: 'conference' | 'journal', batchRequestId: string): string {
        const safeBatchRequestId = batchRequestId.replace(/[^a-z0-9_.-]/gi, '_'); // Sanitize ID
        const dir = type === 'conference' ? this.conferenceRequestLogDirectory : this.journalRequestLogDirectory;
        return path.join(dir, `${safeBatchRequestId}.log`);
    }

    // --- Các getter cũ có thể cần được cập nhật hoặc thay thế ---
    // Các getter này giờ sẽ không còn ý nghĩa cho conference/journal nếu không có file log chung
    // get conferenceLogFilePath(): string {
    //     // Sẽ được thay thế bằng logic đọc file cụ thể theo request ID trong service phân tích
    //     throw new Error("General conference log file path is deprecated. Use request-specific paths.");
    // }
    // get journalLogFilePath(): string {
    //     throw new Error("General journal log file path is deprecated. Use request-specific paths.");
    // }
    get appLogFilePath(): string { // Vẫn giữ cho app log chung
        return this.appLogFilePathForReading;
    }

    // ... (các getter khác giữ nguyên hoặc điều chỉnh nếu cần) ...
    get logArchiveDirectoryPath(): string {
        return path.join(this.logsDirectoryPath, this.logArchiveSubdir);
    }

    get analysisCacheDirectory(): string {
        return path.join(this.baseOutputDirPath, this.analysisCacheSubdir);
    }
    get conferenceAnalysisCacheDirectory(): string {
        return path.join(this.analysisCacheDirectory, 'conference');
    }
    get journalAnalysisCacheDirectory(): string {
        return path.join(this.analysisCacheDirectory, 'journal');
    }

    get jsonlOutputDir(): string {
        return path.join(this.baseOutputDirPath, this.jsonlOutputSubdir);
    }
    get csvOutputDir(): string {
        return path.join(this.baseOutputDirPath, this.csvOutputSubdir);
    }

    // Các thư mục này đã được định nghĩa gián tiếp qua saveConferenceEventLogDirectory và saveJournalEventLogDirectory
    // get saveConferenceStatusDir(): string {
    //     return this.saveConferenceEventLogDirectory;
    // }
    // get saveJournalStatusDir(): string {
    //     return this.saveJournalEventLogDirectory;
    // }

    // Derived paths that were previously getters in ConfigService
    get conferenceListPath(): string { return path.join(this.baseOutputDirPath, 'conference_list.json'); }
    get customSearchDir(): string { return path.join(this.baseOutputDirPath, 'custom_search'); }
    get batchesDir(): string { return path.join(this.baseOutputDirPath, 'batches'); }
    get tempDir(): string { return path.join(this.baseOutputDirPath, 'temp'); }
    get errorAccessLinkPath(): string { return path.join(this.baseOutputDirPath, 'error_access_link_log.txt'); }
}