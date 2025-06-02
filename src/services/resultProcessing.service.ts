// src/services/resultProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import readline from 'readline';
import { ParserOptions, Transform as Json2CsvTransform } from '@json2csv/node';
import { Readable, Transform as NodeTransform } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import path from 'path';

import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { ProcessedRowData, InputRowData, ProcessedResponseData } from '../types/crawl/crawl.types';
import { FileSystemService } from './fileSystem.service';


@singleton()
export class ResultProcessingService {
    private readonly serviceBaseLogger: Logger;

    private readonly VALID_CONTINENTS = new Set(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']);
    private readonly VALID_TYPES = new Set(['Hybrid', 'Online', 'Offline']);
    private readonly YEAR_REGEX = /^\d{4}$/;
    private readonly CSV_FIELDS: (keyof ProcessedRowData | { label: string; value: keyof ProcessedRowData })[] = [
        "requestId", "originalRequestId",
        "title", "acronym", "mainLink", "cfpLink", "impLink",
        "information", "conferenceDates", "year",
        "location", "cityStateProvince", "country", "continent", "type",
        "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
        "otherDate", "topics", "publisher", "summary", "callForPapers"
        // "determineLinks" // Object, cần formatter đặc biệt hoặc chuyển thành string trong _processJsonlStream
    ];

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'ResultProcessingServiceBase' });
        // this.finalJsonlPath = this.configService.finalOutputJsonlPath; // Bỏ
        // this.evaluateCsvPath = this.configService.evaluateCsvPath; // Bỏ
        this.serviceBaseLogger.info("ResultProcessingService initialized.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `ResultProcessingService.${methodName}`, ...additionalContext });
    }

    private _toCamelCase(str: string, logger: Logger): string {
        if (!str) return "";
        try {
            return String(str).replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (match, index) => {
                if (+match === 0) return ""; // Bỏ qua số 0 đứng đầu
                return index === 0 ? match.toLowerCase() : match.toUpperCase();
            }).replace(/[^a-zA-Z0-9]+/g, ''); // Loại bỏ các ký tự không phải chữ và số
        } catch (camelCaseError: unknown) {
            const message = camelCaseError instanceof Error ? camelCaseError.message : String(camelCaseError);
            logger.error({ err: message, input: str, func: '_toCamelCase' }, "Error converting to camelCase");
            return ""; // Trả về chuỗi rỗng nếu có lỗi
        }
    }

    private _isDateDetailKey(key: string): key is keyof Pick<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate'> {
        return ["submissionDate", "notificationDate", "cameraReadyDate", "registrationDate", "otherDate"].includes(key);
    }

    private _isDirectStringKey(key: string): key is keyof Omit<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate' | 'information' | 'summary' | 'callForPapers'> {
        return ["conferenceDates", "year", "location", "cityStateProvince", "country", "continent", "type", "topics", "publisher"].includes(key);
    }

    private _processApiResponse(response: Record<string, any> | null | undefined, logger: Logger): Omit<ProcessedResponseData, 'summary' | 'callForPapers'> {
        const result: Omit<ProcessedResponseData, 'summary' | 'callForPapers'> & { information: string } = {
            conferenceDates: "", year: "", location: "", cityStateProvince: "", country: "",
            continent: "", type: "", submissionDate: {}, notificationDate: {}, cameraReadyDate: {},
            registrationDate: {}, otherDate: {}, topics: "", publisher: "", information: ""
        };

        if (!response) return result;

        try {
            for (const key in response) {
                if (Object.prototype.hasOwnProperty.call(response, key)) {
                    const value = response[key];
                    const camelCaseKey = this._toCamelCase(key, logger);

                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        if (this._isDateDetailKey(camelCaseKey)) {
                            result[camelCaseKey] = {}; // Khởi tạo object cho date detail
                            for (const subKey in value) {
                                if (Object.prototype.hasOwnProperty.call(value, subKey)) {
                                    const subValue = String(value[subKey] ?? '');
                                    result[camelCaseKey][subKey] = subValue;
                                    result.information += `${key}.${subKey}: ${subValue}\n`; // Thêm key gốc để dễ hiểu
                                }
                            }
                        } else {
                            // Các object khác không phải date detail (trừ summary, callForPapers)
                            if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                                try {
                                    result.information += `${key}: ${JSON.stringify(value)}\n`;
                                } catch (stringifyError) {
                                    logger.warn({ err: stringifyError, key, func: '_processApiResponse' }, "Error stringifying object for information field");
                                    result.information += `${key}: [Error stringifying object]\n`;
                                }
                            }
                        }
                    } else {
                        // Giá trị không phải object (hoặc là array, null)
                        const stringValue = String(value ?? '');
                        if (this._isDirectStringKey(camelCaseKey)) {
                            result[camelCaseKey] = stringValue;
                        }
                        // Luôn thêm vào information (trừ summary, callForPapers)
                        if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                            result.information += `${key}: ${stringValue}\n`;
                        }
                    }
                }
            }
            result.information = result.information.trim();
        } catch (responseProcessingError: unknown) {
            logger.error({ err: responseProcessingError, func: '_processApiResponse' }, "Error processing API response content");
        }
        return result;
    }

    private async *_processJsonlStream(jsonlFilePath: string, parentProcLogger: Logger): AsyncGenerator<ProcessedRowData | null> {
        const fileStream = fs.createReadStream(jsonlFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        const streamLogger = parentProcLogger.child({ streamProcess: 'jsonlStreamProcessing', file: path.basename(jsonlFilePath) });
        let lineNumber = 0;

        for await (const line of rl) {
            lineNumber++;
            const lineLogger = streamLogger.child({ lineNumber });
            if (!line.trim()) {
                lineLogger.trace("Skipping empty line.");
                continue;
            }

            let inputRow: InputRowData | null = null;
            try { // Try cho việc parse dòng JSONL
                inputRow = JSON.parse(line) as InputRowData;
                if (!inputRow || !inputRow.batchRequestId || !inputRow.conferenceAcronym || !inputRow.conferenceTitle) {
                    lineLogger.warn({
                        event: 'jsonl_missing_core_or_batchid_data',
                        hasInputRow: !!inputRow,
                        hasAcronym: !!inputRow?.conferenceAcronym,
                        hasTitle: !!inputRow?.conferenceTitle,
                        hasBatchRequestId: !!inputRow?.batchRequestId,
                        lineContentSubstring: line.substring(0, 100)
                    }, "Parsed line missing essential data (acronym, title, or batchRequestId), skipping row.");
                    yield null;
                    continue;
                }
            } catch (parseError: any) {
                lineLogger.error({ err: parseError, lineContentSubstring: line.substring(0, 100), event: 'jsonl_parse_error' }, "Failed to parse line in JSONL file, skipping row.");
                yield null;
                continue;
            }

            // inputRow đã được parse thành công ở đây
            const acronym = inputRow.conferenceAcronym!; // Thêm ! vì đã kiểm tra ở trên
            const title = inputRow.conferenceTitle!;   // Thêm ! vì đã kiểm tra ở trên
            const rowContextLogger = lineLogger.child({ acronym, title, batchRequestId: inputRow.batchRequestId });

            // Gộp logic đọc file và xử lý finalRow vào một khối try...catch
            try {
                let parsedDetermineInfo: Record<string, any> = {};
                let parsedExtractInfo: Record<string, any> = {};
                let parsedCfpInfo: Record<string, any> = {};

                // Đọc content từ các path (vẫn giữ các try...catch con cho từng file để không dừng toàn bộ nếu 1 file lỗi)
                if (inputRow.determineResponseTextPath) {
                    try {
                        const content = await this.fileSystemService.readFileContent(inputRow.determineResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                        parsedDetermineInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedDetermineInfo !== 'object' || parsedDetermineInfo === null) parsedDetermineInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.determineResponseTextPath, type: 'determine', event: 'file_read_parse_warn' }, `Warning reading/parsing determine file, using empty object.`);
                    }
                }
                if (inputRow.extractResponseTextPath) {
                    try {
                        const content = await this.fileSystemService.readFileContent(inputRow.extractResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                        parsedExtractInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedExtractInfo !== 'object' || parsedExtractInfo === null) parsedExtractInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.extractResponseTextPath, type: 'extract', event: 'file_read_parse_warn' }, `Warning reading/parsing extract file, using empty object.`);
                    }
                }
                if (inputRow.cfpResponseTextPath) {
                    try {
                        const content = await this.fileSystemService.readFileContent(inputRow.cfpResponseTextPath);
                        const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                        parsedCfpInfo = cleaned ? JSON.parse(cleaned) : {};
                        if (typeof parsedCfpInfo !== 'object' || parsedCfpInfo === null) parsedCfpInfo = {};
                    } catch (e: any) {
                        rowContextLogger.warn({ err: e, path: inputRow.cfpResponseTextPath, type: 'cfp', event: 'file_read_parse_warn' }, `Warning reading/parsing CFP file, using empty object.`);
                    }
                }

                // Xử lý API response và tạo finalRow
                const processedExtractResponse = this._processApiResponse(parsedExtractInfo, rowContextLogger);
                const finalRow: ProcessedRowData = {
                    title: title,
                    acronym: acronym.replace(/_\d+$/, ''),
                    mainLink: inputRow.mainLink || "",
                    cfpLink: inputRow.cfpLink || "",
                    impLink: inputRow.impLink || "",
                    determineLinks: parsedDetermineInfo,
                    ...processedExtractResponse,
                    summary: String(parsedCfpInfo?.summary ?? parsedCfpInfo?.Summary ?? ''),
                    callForPapers: String(parsedCfpInfo?.callForPapers ?? parsedCfpInfo?.['Call for Papers'] ?? parsedCfpInfo?.['Call For Papers'] ?? parsedCfpInfo?.cfp ?? ''),
                    requestId: inputRow.batchRequestId,
                    originalRequestId: inputRow.originalRequestId,
                };

                // --- Validation & Normalization ---
                const originalContinent = finalRow.continent?.trim();
                if (!originalContinent) {
                    // NORMALIZE: Gán giá trị mặc định khi rỗng
                    finalRow.continent = "No continent";
                    // LOG NORMALIZATION (nếu muốn)
                    rowContextLogger.info({
                        event: 'normalization_applied', // EVENT
                        field: 'continent',
                        originalValue: originalContinent, // Là undefined hoặc ""
                        normalizedValue: "No continent",
                        reason: 'empty_value',
                        conferenceAcronym: acronym, // Đảm bảo context có trong log entry
                        conferenceTitle: title
                    }, `Continent was empty, normalized to "No continent".`);
                } else if (!this.VALID_CONTINENTS.has(originalContinent)) {
                    // VALIDATION WARNING và NORMALIZE
                    rowContextLogger.info({ // Giữ info vì nó cũng là 1 dạng "cảnh báo" về dữ liệu đầu vào
                        event: 'validation_warning', // EVENT
                        field: 'continent',
                        invalidValue: originalContinent,
                        action: 'normalized', // Hành động là normalize
                        normalizedTo: 'No continent', // Giá trị sau khi normalize
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid continent "${originalContinent}". Normalizing to "No continent".`);
                    finalRow.continent = "No continent";
                }

                const originalType = finalRow.type?.trim();
                if (!originalType) {
                    // NORMALIZE
                    finalRow.type = "Offline";
                    // LOG NORMALIZATION (nếu muốn)
                    rowContextLogger.info({
                        event: 'normalization_applied', // EVENT
                        field: 'type',
                        originalValue: originalType,
                        normalizedValue: "Offline",
                        reason: 'empty_value',
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Type was empty, normalized to "Offline".`);
                } else if (!this.VALID_TYPES.has(originalType)) {
                    // VALIDATION WARNING và NORMALIZE
                    rowContextLogger.info({
                        event: 'validation_warning', // EVENT
                        field: 'type',
                        invalidValue: originalType,
                        action: 'normalized',
                        normalizedTo: 'Offline',
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid type "${originalType}". Normalizing to "Offline".`);
                    finalRow.type = "Offline";
                }

                // Normalization cho các trường text rỗng
                const fieldsToNormalizeIfEmpty: { field: keyof ProcessedRowData, defaultValue: string }[] = [
                    { field: 'location', defaultValue: "No location" },
                    { field: 'cityStateProvince', defaultValue: "No city/state/province" },
                    { field: 'country', defaultValue: "No country" },
                    { field: 'publisher', defaultValue: "No publisher" },
                    { field: 'topics', defaultValue: "No topics" },
                    { field: 'summary', defaultValue: "No summary available" },
                    { field: 'callForPapers', defaultValue: "No call for papers available" }
                ];

                for (const item of fieldsToNormalizeIfEmpty) {
                    const currentValue = String(finalRow[item.field] ?? '').trim(); // Ép kiểu về string trước khi trim
                    if (!currentValue) {
                        (finalRow as any)[item.field] = item.defaultValue; // Gán giá trị mặc định
                        // LOG NORMALIZATION
                        rowContextLogger.info({
                            event: 'normalization_applied', // EVENT
                            field: item.field,
                            originalValue: currentValue, // Là ""
                            normalizedValue: item.defaultValue,
                            reason: 'empty_value',
                            conferenceAcronym: acronym,
                            conferenceTitle: title
                        }, `${item.field} was empty, normalized to "${item.defaultValue}".`);
                    }
                }

                const originalYear = finalRow.year?.trim();
                if (originalYear && !this.YEAR_REGEX.test(originalYear)) {
                    // VALIDATION WARNING (chỉ log, không normalize ở đây)
                    rowContextLogger.info({ // Giữ info vì nó cũng là 1 dạng "cảnh báo" về dữ liệu đầu vào
                        event: 'validation_warning', // EVENT
                        field: 'year',
                        invalidValue: originalYear,
                        action: 'logged_only', // Hành động chỉ là log
                        conferenceAcronym: acronym,
                        conferenceTitle: title
                    }, `Invalid year format "${originalYear}". Value kept as is.`);
                }
                rowContextLogger.trace({ event: 'row_processed_successfully' }, "Row processed for yielding.");
                yield finalRow;

            } catch (rowProcessingError: any) { // Catch cho toàn bộ quá trình đọc file và xử lý row
                rowContextLogger.error({ err: rowProcessingError, event: 'row_data_or_content_processing_error' }, "Error processing row data or its content files, skipping row.");
                yield null;
            }
        } // Kết thúc for await

        streamLogger.info({ totalLinesProcessed: lineNumber, event: 'jsonl_processing_finished' }, 'Finished processing JSONL file stream');
    }

    // ++ MODIFIED: Nhận đường dẫn JSONL và CSV cụ thể của batch
    private async _writeCSVAndCollectDataInternal(
        jsonlFilePathForBatch: string,    // Đường dẫn JSONL cụ thể của batch
        csvFilePathForBatch: string,      // Đường dẫn CSV cụ thể của batch sẽ được tạo
        batchRequestId: string,           // ID của batch (chủ yếu để logging context)
        parentProcLogger: Logger
    ): Promise<ProcessedRowData[]> {
        const taskLogger = parentProcLogger.child({
            csvTask: 'writeCSVAndCollectData',
            jsonlInputFile: path.basename(jsonlFilePathForBatch),
            csvOutputFile: path.basename(csvFilePathForBatch),
            batchRequestId: batchRequestId // Đảm bảo batchRequestId có trong context log
        });

        taskLogger.info({
            event: 'csv_stream_collect_start',
            finalCsvPath: csvFilePathForBatch // Sử dụng csvFilePathForBatch
        }, `Bắt đầu stream ghi CSV (file: ${path.basename(csvFilePathForBatch)}) và thu thập dữ liệu`);

        const collectedData: ProcessedRowData[] = [];
        let rowObjectStream: Readable | null = null;
        let filterLogCollectTransform: NodeTransform | null = null;
        let csvTransform: Json2CsvTransform<ProcessedRowData, ProcessedRowData> | null = null;
        let csvWriteStream: fs.WriteStream | null = null;
        let recordsProcessed = 0;
        let recordsWrittenToCsv = 0;


        try {
            // Đọc từ file JSONL cụ thể của batch
            rowObjectStream = Readable.from(this._processJsonlStream(jsonlFilePathForBatch, taskLogger));

            filterLogCollectTransform = new NodeTransform({
                objectMode: true,
                transform: (chunk: ProcessedRowData | null, encoding, callback) => {
                    recordsProcessed++;
                    if (chunk !== null && chunk.acronym && chunk.title) {
                        taskLogger.info({
                            event: 'csv_record_processed_for_writing',
                            conferenceAcronym: chunk.acronym,
                            conferenceTitle: chunk.title,
                        }, `Bản ghi cho ${chunk.acronym} đã xử lý và đang chuẩn bị để ghi vào CSV.`);

                        taskLogger.trace({ event: 'csv_record_to_write_internal', acronym: chunk.acronym, title: chunk.title }, `Chuyển bản ghi sang CSV transform (internal trace)`);
                        collectedData.push(chunk);
                        recordsWrittenToCsv++;
                        callback(null, chunk);
                    } else {
                        if (chunk !== null) {
                            taskLogger.warn({ event: 'csv_invalid_record_skipped_in_transform', recordData: { acronym: chunk.acronym, title: chunk.title } }, 'Bản ghi không hợp lệ bị bỏ qua trong transform để ghi CSV');
                        } else {
                            taskLogger.warn({ event: 'csv_null_record_skipped_in_transform' }, 'Bản ghi null bị bỏ qua trong transform để ghi CSV');
                        }
                        callback();
                    }
                }
            });


            // ++ DI CHUYỂN KHỞI TẠO csvTransform VÀO ĐÂY ++
            const csvOptions: ParserOptions<ProcessedRowData, ProcessedRowData> = { fields: this.CSV_FIELDS };
            csvTransform = new Json2CsvTransform(csvOptions, {}, { objectMode: true });
            // ++++++++++++++++++++++++++++++++++++++++++++++

            const csvDir = path.dirname(csvFilePathForBatch);
            if (!fs.existsSync(csvDir)) {
                taskLogger.info({ directory: csvDir, event: 'create_csv_directory' }, "Tạo thư mục cho output CSV.");
                // Giả sử FileSystemService được inject vào ConfigService và có sẵn ở đây
                // hoặc bạn inject FileSystemService trực tiếp vào ResultProcessingService
                // Ví dụ nếu FileSystemService có sẵn trong ConfigService:
                // await this.configService.fileSystemService.ensureDirExists(csvDir, taskLogger);
                // Hoặc nếu bạn inject FileSystemService trực tiếp vào class này:
                await this.fileSystemService.ensureDirExists(csvDir, taskLogger); // << GIẢ SỬ bạn đã inject FileSystemService
            }
            csvWriteStream = fs.createWriteStream(csvFilePathForBatch);

            csvWriteStream.on('error', (err) => {
                taskLogger.error({ err, event: 'csv_writestream_error', finalCsvFile: csvFilePathForBatch }, 'Lỗi từ WriteStream của CSV.');
            });
            csvWriteStream.on('finish', () => {
                taskLogger.info({ event: 'csv_writestream_finish', finalCsvFile: csvFilePathForBatch }, 'WriteStream của CSV đã hoàn thành.');
            });

            // Bây giờ các stream đã được khởi tạo đúng
            if (!rowObjectStream || !filterLogCollectTransform || !csvTransform || !csvWriteStream) {
                // Thêm một kiểm tra an toàn, mặc dù không nên xảy ra nếu logic đúng
                throw new Error("Một hoặc nhiều stream cần thiết cho pipeline không được khởi tạo.");
            }

            await streamPipeline(
                rowObjectStream,
                filterLogCollectTransform,
                csvTransform,
                csvWriteStream
            );

            taskLogger.info({
                event: 'csv_stream_collect_success',
                recordsProcessed, recordsWrittenToCsv, recordsCollected: collectedData.length,
                finalCsvFile: csvFilePathForBatch
            }, 'Stream ghi CSV và thu thập dữ liệu hoàn thành thành công.');
            return collectedData;

        } catch (error: any) {
            taskLogger.error({
                err: error, recordsProcessed, recordsWrittenToCsv, recordsCollected: collectedData.length,
                event: 'csv_stream_collect_failed', finalCsvFile: csvFilePathForBatch
            }, 'Lỗi trong quá trình stream ghi CSV và thu thập dữ liệu');

            const destroyStream = (stream: Readable | NodeTransform | fs.WriteStream | null, streamName: string, err?: Error) => {
                if (stream && !stream.destroyed) {
                    stream.destroy(err);
                    taskLogger.info({ event: 'stream_destroyed', streamName, error: !!err }, `Stream ${streamName} đã được hủy.`);
                }
            };

            destroyStream(rowObjectStream, 'rowObjectStream', error instanceof Error ? error : undefined);
            destroyStream(filterLogCollectTransform, 'filterLogCollectTransform', error instanceof Error ? error : undefined);
            destroyStream(csvTransform, 'csvTransform', error instanceof Error ? error : undefined); // csvTransform có thể vẫn là null nếu lỗi xảy ra trước khi nó được gán
            destroyStream(csvWriteStream, 'csvWriteStream', error instanceof Error ? error : new Error(String(error)));

            if (csvFilePathForBatch && fs.existsSync(csvFilePathForBatch)) {
                try {
                    await fs.promises.unlink(csvFilePathForBatch);
                    taskLogger.info({ event: 'incomplete_csv_deleted', file: csvFilePathForBatch }, 'Đã xóa file CSV chưa hoàn chỉnh do lỗi.');
                } catch (unlinkError) {
                    taskLogger.warn({ err: unlinkError, event: 'incomplete_csv_delete_failed', file: csvFilePathForBatch }, 'Không thể xóa file CSV chưa hoàn chỉnh.');
                }
            }
            throw error;
        }
    }



    // ++ MODIFIED: Nhận batchRequestId
    public async processOutput(parentLogger: Logger | undefined, batchRequestId: string): Promise<ProcessedRowData[]> {
        // Lấy đường dẫn file JSONL và CSV động cho batch này
        const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestId);
        const csvPathForThisBatch = this.configService.getEvaluateCsvPathForBatch(batchRequestId); // Mặc định tên file là 'evaluate'

        const logger = this.getMethodLogger(parentLogger, 'processOutput', {
            jsonlPathForBatch: jsonlPathForThisBatch,
            csvPathForBatch: csvPathForThisBatch,
            batchRequestId // Thêm batchRequestId vào context của logger này
        });
        logger.info(`Processing output for batch ${batchRequestId} (JSONL: ${path.basename(jsonlPathForThisBatch)}, CSV: ${path.basename(csvPathForThisBatch)})...`);


        try {
            // Kiểm tra sự tồn tại và kích thước của file JSONL cụ thể của batch
            if (!fs.existsSync(jsonlPathForThisBatch)) {
                logger.warn(`JSONL file for batch ${batchRequestId} not found at ${jsonlPathForThisBatch}. No CSV will be generated, returning empty results.`);
                return [];
            }
            const stats = await fs.promises.stat(jsonlPathForThisBatch);
            if (stats.size === 0) {
                logger.warn(`JSONL file for batch ${batchRequestId} (${path.basename(jsonlPathForThisBatch)}) is empty. No CSV will be generated, returning empty results.`);
                // Tùy chọn: Tạo file CSV rỗng với headers
                // await fs.promises.writeFile(csvPathForThisBatch, this.CSV_FIELDS.map(f => typeof f === 'string' ? f : f.label).join(',') + '\n');
                return [];
            }
        } catch (error: any) {
            logger.error({ err: error, batchRequestId }, `Error checking JSONL file for batch ${batchRequestId}. Cannot proceed.`);
            throw error;
        }

        try {
            const collectedData = await this._writeCSVAndCollectDataInternal(
                jsonlPathForThisBatch,    // Đường dẫn JSONL của batch
                csvPathForThisBatch,      // Đường dẫn CSV sẽ được tạo cho batch
                batchRequestId,           // ID của batch (cho logging context)
                logger                    // Logger của processOutput
            );
            logger.info({ collectedCount: collectedData.length, batchRequestId }, `CSV generation and data collection for batch ${batchRequestId} completed.`);
            return collectedData;
        } catch (processingError: any) {
            logger.error({ err: processingError, batchRequestId }, `Final output processing for batch ${batchRequestId} failed.`);
            return [];
        }
    }
}